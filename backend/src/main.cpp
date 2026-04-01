#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/version.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/json.hpp>

#if __has_include(<libpq-fe.h>)
#define HAS_LIBPQ 1
#include <libpq-fe.h>
#elif __has_include(<postgresql/libpq-fe.h>)
#define HAS_LIBPQ 1
#include <postgresql/libpq-fe.h>
#else
#define HAS_LIBPQ 0
#endif

#include "vision_pipeline.hpp"
#include "websocket_session.hpp"
#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>

#include <algorithm>
#include <atomic>
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <mutex>
#include <optional>
#include <random>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_set>
#include <unordered_map>
#include <vector>

namespace asio = boost::asio;
namespace ssl = asio::ssl;
namespace beast = boost::beast;
namespace http = beast::http;
namespace json = boost::json;
namespace fs = std::filesystem;

struct ConvertRequest {
  std::string inputPath;
  std::string outputName;
  std::string outputPath;
  int minZoom = 0;
  int maxZoom = 18;
  std::string compression = "JPEG";
  int quality = 85;
  std::string resampling = "BILINEAR";
};

struct Job {
  std::string id;
  std::string status;
  std::string createdAt;
  std::string updatedAt;
  std::string outputPath;
  std::vector<std::string> logs;
};

struct AuthUser {
  std::string id;
  std::string company;
  std::string firstName;
  std::string lastName;
  std::string dni;
  std::string username;
  std::string role = "operator";
  std::string passwordHash;
  std::vector<double> faceTemplate;
  std::string createdAt;
  std::string ruc;
  std::string phone;
  std::string mobile;
  std::string email;
};

struct Project {
  std::string id;
  std::string name;
  std::string description;
  std::string companyName;
};

struct Report {
  std::string id;
  std::string projectId;
  std::string title;
  json::value contentJson;
  std::string status = "draft";
  std::string createdBy;
  int versionNumber = 1;
  std::string company;
  std::string createdAt;
  std::string updatedAt;
};

std::mutex gJobsMutex;
std::map<std::string, Job> gJobs;
std::mutex gAuthMutex;

struct AuthSession {
  std::string token;
  std::string userId;
  std::string username;
  std::string company;
  std::string role;
  std::chrono::system_clock::time_point expiresAt;
};

std::mutex gAuthSessionMutex;
std::unordered_map<std::string, AuthSession> gAuthSessions;

/** EMA + histéresis lentes (ICAO/FACIAL) por sesión — no compartido entre usuarios. */
struct GlassesEmaState {
  double emaLikelihood = 0.0;
  bool emaInit = false;
  bool lastNoGlassesState = true;
  bool lastNoGlassesInit = false;
};

std::mutex gGlassesEmaMutex;
std::unordered_map<std::string, GlassesEmaState> gGlassesEmaBySession;

static void resetGlassesEmaState(GlassesEmaState &s) {
  s.emaLikelihood = 0.0;
  s.emaInit = false;
  s.lastNoGlassesState = true;
  s.lastNoGlassesInit = false;
}

/** Retorna noGlasses (sin lentes). outEma = señal suavizada 0–100. */
static bool applyIcaoGlassesEma(GlassesEmaState &s, double rawLikelihood,
                                bool faceDetected, double &outEma) {
  constexpr double kAlpha = 0.30;
  constexpr double kDetect = 66.0;
  constexpr double kClear = 52.0;
  if (!faceDetected) {
    resetGlassesEmaState(s);
    outEma = 0.0;
    return true;
  }
  if (!s.emaInit) {
    s.emaLikelihood = rawLikelihood;
    s.emaInit = true;
  } else {
    s.emaLikelihood =
        kAlpha * rawLikelihood + (1.0 - kAlpha) * s.emaLikelihood;
  }
  outEma = s.emaLikelihood;
  const double ema = s.emaLikelihood;
  if (!s.lastNoGlassesInit) {
    s.lastNoGlassesState = ema < 50.0;
    s.lastNoGlassesInit = true;
  } else {
    if (s.lastNoGlassesState) {
      if (ema > kDetect)
        s.lastNoGlassesState = false;
    } else {
      if (ema < kClear)
        s.lastNoGlassesState = true;
    }
  }
  return s.lastNoGlassesState;
}

const std::vector<std::string> kMiningCompanies = {
    "Minera Raura", "Compania Minera Volcan", "Minera Antamina",
    "Minera Cerro Verde"};

std::string getenvOr(const char *key, const std::string &fallback);
std::string makeId();

enum class AuthStorageMode { Postgres, File };
enum class BiometricProvider { Legacy, DermalogCli };

AuthStorageMode gAuthStorageMode = AuthStorageMode::File;
std::string gDatabaseUrl;
BiometricProvider gBiometricProvider = BiometricProvider::Legacy;
std::string gDermalogCliPath;
bool gDermalogRequired = false;
bool gBiometricDnnEnabled = false;
std::string gBiometricDnnModelPath;
std::string gBiometricDnnLabelsCsv;
float gBiometricDnnThreshold = 0.72f;
std::string gAiEngineUrl;
int gAiEngineTimeoutMs = 120;
std::size_t gAiEngineMaxImageBytes = 450000;
float gBiometricIcaoEyeConfidenceMin = 95.0f;
float gBiometricIcaoIlluminationMin = 40.0f;
bool gImageOptimizerEnabled = false;
int gBiometricMaxPixels = 1280 * 720;
int gSessionTtlMinutes = 480;

struct FaceAnalysis {
  bool ok = false;
  std::vector<double> faceTemplate;
  std::vector<std::string> issues;
  double qualityScore = 0.0;
  std::string provider = "legacy";
};

struct AuditFilter {
  size_t limit = 50;
  size_t offset = 0;
  std::optional<std::string> company;
  std::optional<std::string> username;
  std::optional<std::string> action;
  std::optional<bool> success;
};

struct AuditPageResult {
  json::array logs;
  size_t total = 0;
  size_t limit = 50;
  size_t offset = 0;
};

int hexToInt(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
  if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
  return -1;
}

std::string urlDecode(const std::string &src) {
  std::string out;
  out.reserve(src.size());
  for (size_t i = 0; i < src.size(); ++i) {
    if (src[i] == '+') {
      out.push_back(' ');
      continue;
    }
    if (src[i] == '%' && i + 2 < src.size()) {
      const int hi = hexToInt(src[i + 1]);
      const int lo = hexToInt(src[i + 2]);
      if (hi >= 0 && lo >= 0) {
        out.push_back(static_cast<char>((hi << 4) | lo));
        i += 2;
        continue;
      }
    }
    out.push_back(src[i]);
  }
  return out;
}

std::unordered_map<std::string, std::string>
parseQueryString(const std::string &target) {
  std::unordered_map<std::string, std::string> out;
  const auto qPos = target.find('?');
  if (qPos == std::string::npos || qPos + 1 >= target.size()) {
    return out;
  }

  std::string query = target.substr(qPos + 1);
  std::stringstream ss(query);
  std::string pair;
  while (std::getline(ss, pair, '&')) {
    if (pair.empty()) {
      continue;
    }
    const auto eq = pair.find('=');
    if (eq == std::string::npos) {
      out[urlDecode(pair)] = "";
      continue;
    }
    out[urlDecode(pair.substr(0, eq))] = urlDecode(pair.substr(eq + 1));
  }
  return out;
}

std::string routePathOnly(const std::string &target) {
  const auto qPos = target.find('?');
  return qPos == std::string::npos ? target : target.substr(0, qPos);
}

// --- MINING GATEWAY TLS LOGIC ---
struct MiningConfig {
    std::string bind_address = "0.0.0.0";
    unsigned short port = 8443;
    int idle_timeout_sec = 30;
    std::size_t max_line_size = 1024;
    std::string cert_path = "/etc/mining-gateway/certs/server.crt";
    std::string key_path = "/etc/mining-gateway/certs/server.key";
};

class MiningSession : public std::enable_shared_from_this<MiningSession> {
public:
    using tcp = asio::ip::tcp;
    MiningSession(tcp::socket socket, ssl::context& ssl_ctx, int timeout_sec, std::size_t max_line_size)
        : stream_(std::move(socket), ssl_ctx),
          timer_(stream_.get_executor()),
          timeout_sec_(timeout_sec),
          max_line_size_(max_line_size) {}

    void start() {
        refresh_timeout();
        stream_.async_handshake(ssl::stream_base::server,
            [self = shared_from_this()](const boost::system::error_code& ec) {
                if (ec) return;
                self->read_line();
            });
    }

private:
    void refresh_timeout() {
        timer_.expires_after(std::chrono::seconds(timeout_sec_));
        timer_.async_wait([self = shared_from_this()](const boost::system::error_code& ec) {
            if (ec == asio::error::operation_aborted) return;
            boost::system::error_code ignored;
            self->stream_.lowest_layer().shutdown(tcp::socket::shutdown_both, ignored);
            self->stream_.lowest_layer().close(ignored);
        });
    }

    void read_line() {
        refresh_timeout();
        asio::async_read_until(stream_, buffer_, '\n',
            [self = shared_from_this()](const boost::system::error_code& ec, std::size_t bytes) {
                if (ec) return;
                if (bytes > self->max_line_size_) {
                    self->write_response("ERR payload too large\n", true);
                    return;
                }
                std::istream stream(&self->buffer_);
                std::string line;
                std::getline(stream, line);
                if (!line.empty()) {
                    std::cout << "[MINING-GATEWAY] RECEIVED: " << line << "\n";
                }
                self->write_response("OK\n", false);
            });
    }

    void write_response(std::string response, bool close_after_write) {
        refresh_timeout();
        asio::async_write(stream_, asio::buffer(response),
            [self = shared_from_this(), close_after_write](const boost::system::error_code& ec, std::size_t) {
                if (ec) return;
                if (close_after_write) {
                    boost::system::error_code ignored;
                    self->stream_.lowest_layer().shutdown(tcp::socket::shutdown_both, ignored);
                    self->stream_.lowest_layer().close(ignored);
                    return;
                }
                self->read_line();
            });
    }

    ssl::stream<tcp::socket> stream_;
    asio::steady_timer timer_;
    asio::streambuf buffer_;
    int timeout_sec_;
    std::size_t max_line_size_;
};

class MiningServer {
public:
    using tcp = asio::ip::tcp;
    MiningServer(asio::io_context& io_context, const MiningConfig& config)
        : io_context_(io_context),
          ssl_context_(ssl::context::tls_server),
          acceptor_(io_context),
          config_(config) {
        ssl_context_.set_options(ssl::context::default_workarounds | ssl::context::no_sslv2 | ssl::context::no_sslv3 | ssl::context::single_dh_use);
        if (fs::exists(config_.cert_path) && fs::exists(config_.key_path)) {
            ssl_context_.use_certificate_chain_file(config_.cert_path);
            ssl_context_.use_private_key_file(config_.key_path, ssl::context::pem);
        }
        auto endpoint = tcp::endpoint(asio::ip::make_address(config_.bind_address), config_.port);
        acceptor_.open(endpoint.protocol());
        acceptor_.set_option(asio::socket_base::reuse_address(true));
        acceptor_.bind(endpoint);
        acceptor_.listen(asio::socket_base::max_listen_connections);
    }
    void run() { do_accept(); }
private:
    void do_accept() {
        acceptor_.async_accept([this](const boost::system::error_code& ec, tcp::socket socket) {
            if (!ec) {
                std::make_shared<MiningSession>(std::move(socket), ssl_context_, config_.idle_timeout_sec, config_.max_line_size)->start();
            }
            do_accept();
        });
    }
    asio::io_context& io_context_;
    ssl::context ssl_context_;
    tcp::acceptor acceptor_;
    MiningConfig config_;
};

std::string nowIso8601() {
  auto now = std::chrono::system_clock::now();
  std::time_t tt = std::chrono::system_clock::to_time_t(now);
  std::tm utc{};
#ifdef _WIN32
  gmtime_s(&utc, &tt);
#else
  gmtime_r(&tt, &utc);
#endif
  std::ostringstream oss;
  oss << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
  return oss.str();
}

std::string toLowerCopy(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return value;
}

std::vector<std::string> splitCsvLower(const std::string &csv) {
  std::vector<std::string> out;
  std::stringstream ss(csv);
  std::string item;
  while (std::getline(ss, item, ',')) {
    auto first = item.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) {
      continue;
    }
    auto last = item.find_last_not_of(" \t\r\n");
    out.push_back(toLowerCopy(item.substr(first, last - first + 1)));
  }
  return out;
}

std::string resolveRoleForUsername(const std::string &username) {
  const auto candidate = toLowerCopy(username);
  const auto configured = splitCsvLower(getenvOr("AUTH_ADMIN_USERS", "admin"));
  for (const auto &admin : configured) {
    if (candidate == admin) {
      return "admin";
    }
  }
  if (candidate.rfind("admin_", 0) == 0) {
    return "admin";
  }
  return "operator";
}

std::string makeSessionToken() {
  return makeId() + makeId();
}

AuthSession issueAuthSession(const AuthUser &user) {
  AuthSession session;
  session.token = makeSessionToken();
  session.userId = user.id;
  session.username = user.username;
  session.company = user.company;
  session.role = user.role;
  session.expiresAt = std::chrono::system_clock::now() +
                      std::chrono::minutes(gSessionTtlMinutes);

  std::scoped_lock lk(gAuthSessionMutex);
  gAuthSessions[session.token] = session;
  return session;
}

void pruneExpiredAuthSessions() {
  std::vector<std::string> expiredTokens;
  {
    std::scoped_lock lk(gAuthSessionMutex);
    const auto now = std::chrono::system_clock::now();
    for (auto it = gAuthSessions.begin(); it != gAuthSessions.end();) {
      if (it->second.expiresAt <= now) {
        expiredTokens.push_back(it->first);
        it = gAuthSessions.erase(it);
      } else {
        ++it;
      }
    }
  }
  if (!expiredTokens.empty()) {
    std::scoped_lock g(gGlassesEmaMutex);
    for (const auto &t : expiredTokens) {
      gGlassesEmaBySession.erase(t);
    }
  }
}

std::optional<AuthSession>
resolveAuthSession(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
  std::string token;
  if (auto it = query.find("auth_token"); it != query.end()) {
    token = it->second;
  }

  if (token.empty()) {
    if (auto auth = req.find(http::field::authorization); auth != req.end()) {
      const std::string value(auth->value());
      static const std::string kBearer = "Bearer ";
      if (value.rfind(kBearer, 0) == 0) {
        token = value.substr(kBearer.size());
      }
    }
  }

  if (token.empty()) {
    return std::nullopt;
  }

  pruneExpiredAuthSessions();
  std::scoped_lock lk(gAuthSessionMutex);
  const auto it = gAuthSessions.find(token);
  if (it == gAuthSessions.end()) {
    return std::nullopt;
  }
  return it->second;
}

bool decodeBase64(const std::string &input, std::vector<unsigned char> &out) {
  static const std::string chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::array<int, 256> table{};
  table.fill(-1);
  for (size_t i = 0; i < chars.size(); ++i) {
    table[static_cast<unsigned char>(chars[i])] = static_cast<int>(i);
  }

  int val = 0;
  int bits = -8;
  out.clear();
  out.reserve((input.size() * 3) / 4);

  for (unsigned char c : input) {
    if (std::isspace(c)) {
      continue;
    }
    if (c == '=') {
      break;
    }
    const int d = table[c];
    if (d == -1) {
      return false;
    }
    val = (val << 6) + d;
    bits += 6;
    if (bits >= 0) {
      out.push_back(static_cast<unsigned char>((val >> bits) & 0xFF));
      bits -= 8;
    }
  }
  return !out.empty();
}

struct ParsedHttpEndpoint {
  std::string host;
  std::string port = "80";
  std::string target = "/";
};

bool parseHttpEndpoint(const std::string &url, ParsedHttpEndpoint &out) {
  static const std::regex kHttpRegex(
      R"(^http://([A-Za-z0-9\.\-_]+)(?::([0-9]{1,5}))?(\/.*)?$)",
      std::regex::icase);
  std::smatch m;
  if (!std::regex_match(url, m, kHttpRegex)) {
    return false;
  }
  out.host = m[1].str();
  if (m.size() > 2 && m[2].matched) {
    out.port = m[2].str();
  }
  if (m.size() > 3 && m[3].matched && !m[3].str().empty()) {
    out.target = m[3].str();
  }
  return !out.host.empty();
}

struct AiEngineFrameResult {
  bool available = false;
  bool detected = false;
  bool bothOpen = true;
  bool mouthClosed = true;
  bool noGlasses = true;
  /** Señal CV cruda 0–100 desde ai_engine (sin EMA). */
  double glassesCvScore = 0.0;
  /** Tras EMA en C++ (o cruda si sin sesión). */
  double glassesScore = 0.0;
  double leftEar = 0.0;
  double rightEar = 0.0;
  bool hasEarMetrics = false;
  std::string error;
};

static float icaoFullFrameIlluminationPercent(const cv::Mat &bgr) {
  if (bgr.empty()) {
    return 0.0f;
  }
  cv::Mat gray;
  if (bgr.channels() == 3) {
    cv::cvtColor(bgr, gray, cv::COLOR_BGR2GRAY);
  } else if (bgr.channels() == 4) {
    cv::cvtColor(bgr, gray, cv::COLOR_BGRA2GRAY);
  } else {
    gray = bgr;
  }
  cv::Mat mask = gray > 0;
  double avg = 0.0;
  if (cv::countNonZero(mask) > 0) {
    avg = cv::mean(gray, mask)[0];
  } else {
    avg = cv::mean(gray)[0];
  }
  return static_cast<float>((avg / 255.0) * 100.0);
}

std::optional<AiEngineFrameResult>
analyzeFrameWithAiEngine(
    const std::vector<unsigned char> &imageBytes,
    const std::optional<std::string> &glassesSessionKey = std::nullopt) {
  if (gAiEngineUrl.empty()) {
    return std::nullopt;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    AiEngineFrameResult limited;
    limited.error = "ai_engine_skipped_size_limit";
    return limited;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/analyze_eyes", endpoint)) {
    AiEngineFrameResult bad;
    bad.error = "ai_engine_invalid_url";
    return bad;
  }

  std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 256);
  body += "--" + boundary + "\r\n";
  body +=
      "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  body += "Content-Type: image/jpeg\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(gAiEngineTimeoutMs));

  auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_resolve_failed";
    return fail;
  }

  stream.connect(results, ec);
  if (ec) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_connect_failed";
    return fail;
  }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type,
          "multipart/form-data; boundary=" + boundary);
  req.body() = std::move(body);
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_write_failed";
    return fail;
  }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);

  if (ec) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_read_failed";
    return fail;
  }
  if (res.result() != http::status::ok) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_http_not_ok";
    return fail;
  }

  try {
    auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      AiEngineFrameResult fail;
      fail.error = "ai_engine_invalid_json";
      return fail;
    }
    const auto &obj = payload.as_object();
    AiEngineFrameResult out;
    out.available = true;
    out.detected = obj.if_contains("detected") && obj.at("detected").is_bool()
                       ? obj.at("detected").as_bool()
                       : false;
    out.bothOpen = obj.if_contains("both_open") && obj.at("both_open").is_bool()
                       ? obj.at("both_open").as_bool()
                       : true;
    out.mouthClosed =
        obj.if_contains("mouth_closed") && obj.at("mouth_closed").is_bool()
            ? obj.at("mouth_closed").as_bool()
            : true;

    double rawGlasses = 0.0;
    if (obj.if_contains("glasses_cv_score") &&
        (obj.at("glasses_cv_score").is_double() ||
         obj.at("glasses_cv_score").is_int64())) {
      rawGlasses = obj.at("glasses_cv_score").is_double()
                       ? obj.at("glasses_cv_score").as_double()
                       : static_cast<double>(obj.at("glasses_cv_score").as_int64());
    } else if (obj.if_contains("glasses_score") &&
               (obj.at("glasses_score").is_double() ||
                obj.at("glasses_score").is_int64())) {
      rawGlasses = obj.at("glasses_score").is_double()
                       ? obj.at("glasses_score").as_double()
                       : static_cast<double>(obj.at("glasses_score").as_int64());
    }
    out.glassesCvScore = rawGlasses;

    if (glassesSessionKey.has_value() && !glassesSessionKey->empty()) {
      std::scoped_lock lk(gGlassesEmaMutex);
      GlassesEmaState &st = gGlassesEmaBySession[*glassesSessionKey];
      double emaOut = 0.0;
      out.noGlasses =
          applyIcaoGlassesEma(st, rawGlasses, out.detected, emaOut);
      out.glassesScore = emaOut;
    } else {
      out.glassesScore = rawGlasses;
      // Sin token: decisión de un solo frame (banda entre 52 y 66).
      out.noGlasses = rawGlasses < 59.0;
    }
    bool hasLeftEar = false;
    bool hasRightEar = false;
    if (obj.if_contains("left_ear") &&
        (obj.at("left_ear").is_double() || obj.at("left_ear").is_int64())) {
      out.leftEar = obj.at("left_ear").is_double()
                        ? obj.at("left_ear").as_double()
                        : static_cast<double>(obj.at("left_ear").as_int64());
      hasLeftEar = true;
    }
    if (obj.if_contains("right_ear") &&
        (obj.at("right_ear").is_double() || obj.at("right_ear").is_int64())) {
      out.rightEar = obj.at("right_ear").is_double()
                         ? obj.at("right_ear").as_double()
                         : static_cast<double>(obj.at("right_ear").as_int64());
      hasRightEar = true;
    }
    out.hasEarMetrics = hasLeftEar && hasRightEar;
    return out;
  } catch (...) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_parse_failed";
    return fail;
  }
}

std::vector<double> extractLegacyTemplateFromMat(const cv::Mat &image) {
  cv::Mat gray;
  if (image.channels() == 3) {
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
  } else if (image.channels() == 4) {
    cv::cvtColor(image, gray, cv::COLOR_BGRA2GRAY);
  } else {
    gray = image.clone();
  }

  cv::Mat resized;
  cv::resize(gray, resized, cv::Size(24, 24), 0, 0, cv::INTER_AREA);

  std::vector<double> tpl;
  tpl.reserve(static_cast<size_t>(resized.rows * resized.cols));
  double maxVal = 1.0;
  cv::minMaxLoc(resized, nullptr, &maxVal);
  if (maxVal <= 0.0) {
    maxVal = 1.0;
  }
  for (int y = 0; y < resized.rows; ++y) {
    for (int x = 0; x < resized.cols; ++x) {
      tpl.push_back(static_cast<double>(resized.at<unsigned char>(y, x)) /
                    maxVal);
    }
  }
  return tpl;
}

struct CascadeBundle {
  bool faceLoaded = false;
  bool eyeLoaded = false;
  bool smileLoaded = false;
  cv::CascadeClassifier face;
  cv::CascadeClassifier eye;
  cv::CascadeClassifier smile;
};

std::vector<fs::path> cascadeSearchDirs() {
  std::vector<fs::path> dirs;
  auto pushUnique = [&](const fs::path &p) {
    if (p.empty()) {
      return;
    }
    for (const auto &existing : dirs) {
      if (existing == p) {
        return;
      }
    }
    dirs.push_back(p);
  };

  const char *haarDir = std::getenv("OPENCV_HAAR_DIR");
  if (haarDir && *haarDir) {
    pushUnique(fs::path(haarDir));
  }

  const char *openCvDir = std::getenv("OpenCV_DIR");
  if (openCvDir && *openCvDir) {
    pushUnique(fs::path(openCvDir) / "etc" / "haarcascades");
  }

  pushUnique(fs::path("/usr/share/opencv4/haarcascades"));
  pushUnique(fs::path("/usr/share/opencv/haarcascades"));
  pushUnique(fs::path("/usr/local/share/opencv4/haarcascades"));
  pushUnique(fs::path("C:/opencv/build/etc/haarcascades"));

  return dirs;
}

bool loadCascadeFile(cv::CascadeClassifier &classifier,
                     const std::string &fileName) {
  const auto dirs = cascadeSearchDirs();
  for (const auto &dir : dirs) {
    const auto full = dir / fileName;
    if (!fs::exists(full)) {
      continue;
    }
    if (classifier.load(full.string())) {
      return true;
    }
  }
  return false;
}

CascadeBundle &getCascadeBundle() {
  static CascadeBundle bundle;
  static std::once_flag once;
  std::call_once(once, [] {
    bundle.faceLoaded = loadCascadeFile(bundle.face, "haarcascade_frontalface_default.xml");
    bundle.eyeLoaded = loadCascadeFile(bundle.eye, "haarcascade_eye_tree_eyeglasses.xml") ||
                      loadCascadeFile(bundle.eye, "haarcascade_eye.xml");
    bundle.smileLoaded = loadCascadeFile(bundle.smile, "haarcascade_smile.xml");
  });
  return bundle;
}

cv::Rect largestRect(const std::vector<cv::Rect> &rects) {
  if (rects.empty()) {
    return cv::Rect();
  }
  return *std::max_element(rects.begin(), rects.end(), [](const cv::Rect &a,
                                                           const cv::Rect &b) {
    return a.area() < b.area();
  });
}

double faceSymmetryScore(const cv::Mat &faceGray) {
  if (faceGray.empty() || faceGray.cols < 8 || faceGray.rows < 8) {
    return 100.0;
  }

  const int half = faceGray.cols / 2;
  cv::Mat left = faceGray(cv::Rect(0, 0, half, faceGray.rows)).clone();
  cv::Mat right = faceGray(cv::Rect(faceGray.cols - half, 0, half, faceGray.rows)).clone();

  // Lighting Normalization: Adjust means to be identical to minimize light bias
  cv::Scalar meanL = cv::mean(left);
  cv::Scalar meanR = cv::mean(right);
  double avg = (meanL[0] + meanR[0]) * 0.5;
  if (avg > 1.0) {
    left.convertTo(left, left.type(), avg / std::max(1.0, meanL[0]));
    right.convertTo(right, right.type(), avg / std::max(1.0, meanR[0]));
  }

  cv::Mat rightFlipped;
  cv::flip(right, rightFlipped, 1);
  cv::Mat diff;
  cv::absdiff(left, rightFlipped, diff);
  return cv::mean(diff)[0];
}

void pushIssueUnique(std::vector<std::string> &issues,
                     const std::string &issue) {
  if (std::find(issues.begin(), issues.end(), issue) == issues.end()) {
    issues.push_back(issue);
  }
}

std::vector<float> flattenDnnOutput(const cv::Mat &out) {
  std::vector<float> values;
  if (out.empty()) {
    return values;
  }
  cv::Mat flat = out.reshape(1, 1);
  values.reserve(static_cast<size_t>(flat.total()));
  for (int i = 0; i < flat.cols; ++i) {
    values.push_back(flat.at<float>(0, i));
  }
  return values;
}

std::vector<float> softmax(const std::vector<float> &v) {
  if (v.empty()) {
    return {};
  }
  float maxV = *std::max_element(v.begin(), v.end());
  std::vector<float> exps;
  exps.reserve(v.size());
  double sum = 0.0;
  for (float x : v) {
    const double e = std::exp(static_cast<double>(x - maxV));
    exps.push_back(static_cast<float>(e));
    sum += e;
  }
  if (sum <= 0.0) {
    return std::vector<float>(v.size(), 0.0f);
  }
  for (auto &x : exps) {
    x = static_cast<float>(x / sum);
  }
  return exps;
}

struct AccessoryDnnContext {
  bool initialized = false;
  bool loaded = false;
  cv::dnn::Net net;
  std::vector<std::string> labels;
  int inputSize = 224;
  std::string initError;
};

AccessoryDnnContext &getAccessoryDnnContext() {
  static AccessoryDnnContext ctx;
  if (ctx.initialized) {
    return ctx;
  }
  ctx.initialized = true;

  if (!gBiometricDnnEnabled || gBiometricDnnModelPath.empty()) {
    if (!gBiometricDnnEnabled) {
      ctx.initError = "dnn_disabled";
    } else {
      ctx.initError = "dnn_model_path_missing";
    }
    return ctx;
  }

  if (!fs::exists(gBiometricDnnModelPath)) {
    ctx.initError = "dnn_model_not_found";
    return ctx;
  }

  try {
    ctx.net = cv::dnn::readNet(gBiometricDnnModelPath);
    ctx.labels = splitCsvLower(gBiometricDnnLabelsCsv);
    if (ctx.labels.empty()) {
      ctx.labels = {"glasses", "hat", "mask", "makeup", "eyes_closed",
                    "mouth_open", "frontal"};
    }
    ctx.loaded = true;
    ctx.initError.clear();
  } catch (...) {
    ctx.loaded = false;
    ctx.initError = "dnn_model_load_failed";
  }
  return ctx;
}

json::object biometricDnnRuntimeStatusJson() {
  auto &ctx = getAccessoryDnnContext();
  json::array labels;
  for (const auto &label : ctx.labels) {
    labels.push_back(json::value(label));
  }

  json::object out{{"enabled", gBiometricDnnEnabled},
                   {"model_path", gBiometricDnnModelPath},
                   {"model_exists", fs::exists(gBiometricDnnModelPath)},
                   {"loaded", ctx.loaded},
                   {"threshold", gBiometricDnnThreshold},
                   {"labels", labels}};
  if (!ctx.initError.empty()) {
    out["init_error"] = ctx.initError;
  }
  return out;
}

void applyDnnAccessoryChecks(const cv::Mat &faceBgr,
                             std::vector<std::string> &issues) {
  auto &ctx = getAccessoryDnnContext();
  if (!ctx.loaded || faceBgr.empty()) {
    return;
  }

  try {
    cv::Mat blob = cv::dnn::blobFromImage(faceBgr, 1.0 / 255.0,
                                          cv::Size(ctx.inputSize, ctx.inputSize),
                                          cv::Scalar(), true, false);
    ctx.net.setInput(blob);
    cv::Mat out = ctx.net.forward();
    auto probs = flattenDnnOutput(out);
    if (probs.empty()) {
      return;
    }

    const bool appearsNormalized =
        std::all_of(probs.begin(), probs.end(), [](float x) {
          return x >= 0.0f && x <= 1.0f;
        });
    if (!appearsNormalized) {
      probs = softmax(probs);
    }

    const size_t n = std::min(probs.size(), ctx.labels.size());
    for (size_t i = 0; i < n; ++i) {
      const auto &label = ctx.labels[i];
      const float score = probs[i];
      if (score < gBiometricDnnThreshold) {
        continue;
      }

      if (label == "glasses" || label == "eyeglasses" ||
          label == "sunglasses") {
        pushIssueUnique(issues, "suspected_glasses");
      } else if (label == "hat" || label == "cap" || label == "helmet" ||
                 label == "hood") {
        pushIssueUnique(issues, "suspected_hat");
      } else if (label == "mask" || label == "scarf" ||
                 label == "accessory" || label == "occlusion") {
        pushIssueUnique(issues, "suspected_face_accessory");
      } else if (label == "makeup" || label == "cosmetic") {
        pushIssueUnique(issues, "suspected_heavy_makeup");
      } else if (label == "eyes_closed") {
        pushIssueUnique(issues, "eyes_not_open_or_not_visible");
      } else if (label == "mouth_open") {
        pushIssueUnique(issues, "mouth_not_closed");
      } else if (label == "non_frontal" || label == "profile") {
        pushIssueUnique(issues, "face_not_frontal");
      }
    }
  } catch (...) {
    pushIssueUnique(issues, "dnn_inference_failed");
  }
}

cv::Mat normalizeFaceGray(const cv::Mat &faceGray) {
  cv::Mat denoised;
  cv::bilateralFilter(faceGray, denoised, 5, 25.0, 25.0);

  auto clahe = cv::createCLAHE(2.0, cv::Size(8, 8));
  cv::Mat equalized;
  clahe->apply(denoised, equalized);
  return equalized;
}

double edgeDensity(const cv::Mat &gray) {
  if (gray.empty()) {
    return 0.0;
  }
  cv::Mat edges;
  cv::Canny(gray, edges, 70.0, 150.0);
  return static_cast<double>(cv::countNonZero(edges)) /
         static_cast<double>(std::max(1, gray.rows * gray.cols));
}

double darkPixelRatio(const cv::Mat &gray, int threshold) {
  if (gray.empty()) {
    return 0.0;
  }
  cv::Mat mask;
  cv::threshold(gray, mask, threshold, 255, cv::THRESH_BINARY_INV);
  return static_cast<double>(cv::countNonZero(mask)) /
         static_cast<double>(std::max(1, gray.rows * gray.cols));
}

double brightPixelRatio(const cv::Mat &gray, int threshold) {
  if (gray.empty()) {
    return 0.0;
  }
  cv::Mat mask;
  cv::threshold(gray, mask, threshold, 255, cv::THRESH_BINARY);
  return static_cast<double>(cv::countNonZero(mask)) /
         static_cast<double>(std::max(1, gray.rows * gray.cols));
}

double skinPixelRatio(const cv::Mat &bgr) {
  if (bgr.empty()) {
    return 0.0;
  }
  cv::Mat ycrcb;
  cv::cvtColor(bgr, ycrcb, cv::COLOR_BGR2YCrCb);
  cv::Mat skinMask;
  cv::inRange(ycrcb, cv::Scalar(0, 133, 77), cv::Scalar(255, 173, 127),
              skinMask);
  return static_cast<double>(cv::countNonZero(skinMask)) /
         static_cast<double>(std::max(1, bgr.rows * bgr.cols));
}

double meanSaturation(const cv::Mat &bgr) {
  if (bgr.empty()) {
    return 0.0;
  }
  cv::Mat hsv;
  cv::cvtColor(bgr, hsv, cv::COLOR_BGR2HSV);
  std::vector<cv::Mat> channels;
  cv::split(hsv, channels);
  if (channels.size() < 2) {
    return 0.0;
  }
  return cv::mean(channels[1])[0];
}

FaceAnalysis analyzeFaceImageLegacy(const std::string &base64Image,
                                    const std::string &mode) {
  FaceAnalysis result;
  result.provider = "legacy";
  const bool strictRegister = (mode == "register" || mode == "verify");

  std::vector<unsigned char> raw;
  if (!decodeBase64(base64Image, raw)) {
    result.issues.push_back("invalid_base64_image");
    return result;
  }

  cv::Mat img = cv::imdecode(raw, cv::IMREAD_COLOR);
  if (img.empty()) {
    result.issues.push_back("invalid_image_payload");
    return result;
  }

  // Resize oversized frames early to keep real-time latency bounded.
  const int safePixels = std::max(120000, gBiometricMaxPixels);
  const int currentPixels = std::max(1, img.cols * img.rows);
  if (currentPixels > safePixels) {
    const double scale =
        std::sqrt(static_cast<double>(safePixels) / static_cast<double>(currentPixels));
    cv::resize(img, img, cv::Size(), scale, scale, cv::INTER_AREA);
  }

  // Optional optimizer (disabled by default for low latency).
  if (gImageOptimizerEnabled) {
    try {
      std::string id = makeId();
      std::string inPath = "/tmp/opt_in_" + id + ".jpg";
      std::string outPath = "/tmp/opt_out_" + id + ".jpg";
      cv::imwrite(inPath, img);
      std::string cmd = "python3 /app/image_optimizer.py " + inPath + " " +
                        outPath + " > /dev/null 2>&1";
      const int rc = std::system(cmd.c_str());
      if (rc == 0) {
        cv::Mat optimized = cv::imread(outPath);
        if (!optimized.empty()) {
          img = optimized;
        }
      }
      std::filesystem::remove(inPath);
      if (std::filesystem::exists(outPath)) {
        std::filesystem::remove(outPath);
      }
    } catch (...) {
      // Keep original image if optimizer fails.
    }
  }

  cv::Mat gray;
  cv::cvtColor(img, gray, cv::COLOR_BGR2GRAY);

  // Reduce ruido especular / bordes falsos (pared, luces) antes del detector
  cv::Mat grayDenoised;
  cv::bilateralFilter(gray, grayDenoised, 5, 35.0, 35.0);
  cv::Ptr<cv::CLAHE> clahe = cv::createCLAHE(2.2, cv::Size(8, 8));
  clahe->apply(grayDenoised, gray);

  auto &cascade = getCascadeBundle();
  std::vector<cv::Rect> faces;
  if (cascade.faceLoaded) {
    cascade.face.detectMultiScale(gray, faces, 1.08, 5, 0, cv::Size(70, 70));
  }

  cv::Rect faceRect;
  if (!faces.empty()) {
    faceRect = largestRect(faces);
  }

  if (strictRegister) {
    if (!cascade.faceLoaded) {
      result.issues.push_back("face_detector_unavailable");
    }
    if (faces.empty()) {
      result.issues.push_back("face_not_detected");
    }
  }

  if (faceRect.area() <= 0) {
    faceRect = cv::Rect(0, 0, gray.cols, gray.rows);
  }

  const double faceRatio =
      static_cast<double>(faceRect.area()) /
      static_cast<double>(std::max(1, gray.cols * gray.rows));
  if (strictRegister && faceRatio < 0.08) { // Relaxed from 0.1
    result.issues.push_back("face_too_small");
  }

  const cv::Point2d frameCenter(gray.cols * 0.5, gray.rows * 0.5);
  const cv::Point2d faceCenter(faceRect.x + faceRect.width * 0.5,
                               faceRect.y + faceRect.height * 0.5);
  const double offX = std::abs(faceCenter.x - frameCenter.x) /
                      std::max(1.0, gray.cols * 0.5);
  const double offY = std::abs(faceCenter.y - frameCenter.y) /
                      std::max(1.0, gray.rows * 0.5);
  if (strictRegister && (offX > 0.25 || offY > 0.25)) { // Relaxed from 0.2
    result.issues.push_back("face_off_center");
  }

  const double aspect =
      static_cast<double>(faceRect.width) / std::max(1.0, static_cast<double>(faceRect.height));
  if (strictRegister && (aspect < 0.55 || aspect > 1.25)) { // Relaxed from 0.62-1.08
    result.issues.push_back("face_not_frontal");
  }

  cv::Mat faceGrayRaw = gray(faceRect).clone();
  cv::Mat faceGray = normalizeFaceGray(faceGrayRaw);
  cv::Mat faceBgr = img(faceRect).clone();

  cv::Scalar meanIntensity = cv::mean(faceGray);
  if (meanIntensity[0] < 60.0 || meanIntensity[0] > 210.0) { // Relaxed from 70-195
    result.issues.push_back("lighting_out_of_range");
  }

  cv::Mat lap;
  cv::Laplacian(faceGray, lap, CV_64F);
  cv::Scalar mu, sigma;
  cv::meanStdDev(lap, mu, sigma);
  const double blurScore = sigma[0] * sigma[0];
  const double minBlur = strictRegister ? 60.0 : 40.0; // Relaxed posing significantly
  if (blurScore < minBlur) {
    result.issues.push_back("image_not_sharp");
  }

  cv::Scalar meanFace, stdFace;
  cv::meanStdDev(faceGray, meanFace, stdFace);
  if (strictRegister && stdFace[0] < 28.0) {
    result.issues.push_back("low_dynamic_range");
  }

  const double symmetry = faceSymmetryScore(faceGray);
  // Relaxed posing significantly as requested
  if (strictRegister && symmetry > 120.0) {
    result.issues.push_back("head_pose_not_straight");
  }

  // LOGGING BIOMETRIC METRICS
  std::cout << "[Biometric Log] Mode=" << mode
            << " FaceDetected=" << !faces.empty()
            << " Ratio=" << faceRatio 
            << " OffX=" << offX << " OffY=" << offY
            << " Aspect=" << aspect 
            << " Light=" << meanIntensity[0]
            << " Blur=" << blurScore 
            << " Sym=" << symmetry 
            << " Eyes=" << (cascade.eyeLoaded ? "Loaded" : "NotLoaded");

  if (strictRegister && cascade.eyeLoaded) {
    const int eyeRegionH = std::max(1, faceGray.rows / 2);
    cv::Mat upperFace = faceGray(cv::Rect(0, 0, faceGray.cols, eyeRegionH));
    std::vector<cv::Rect> eyes;
    cascade.eye.detectMultiScale(upperFace, eyes, 1.05, 4, 0, cv::Size(15, 15));
    std::cout << " EyesFound=" << eyes.size();
    if (eyes.size() < 2) {
      result.issues.push_back("eyes_not_open_or_not_visible");
    }
  }
  std::cout << " IssuesCount=" << result.issues.size() << " OK=" << (result.issues.empty() ? "Yes" : "No") << std::endl;

  /* 
  if (strictRegister && cascade.smileLoaded) {
    const int mouthY = std::max(0, faceGray.rows / 2);
    const int mouthH = std::max(1, faceGray.rows - mouthY);
    cv::Mat lowerFace = faceGray(cv::Rect(0, mouthY, faceGray.cols, mouthH));
    std::vector<cv::Rect> smiles;
    cascade.smile.detectMultiScale(lowerFace, smiles, 1.15, 55, 0,
                                   cv::Size(faceGray.cols / 6, faceGray.rows / 10));
    const bool strongSmile = std::any_of(smiles.begin(), smiles.end(),
                                         [&](const cv::Rect &r) {
      double aspect = (double)r.height / std::max(1, r.width);
      return r.width > faceGray.cols * 0.35 && aspect > 0.35;
    });
    if (strongSmile) {
      result.issues.push_back("mouth_not_closed");
    }
  }
  */

  if (strictRegister && faceGray.rows > 20 && faceGray.cols > 20) {
    const int eyeY = std::max(0, static_cast<int>(faceGray.rows * 0.18));
    const int eyeH = std::max(1, static_cast<int>(faceGray.rows * 0.32));
    cv::Rect eyeBandRect(0, eyeY, faceGray.cols,
                         std::min(eyeH, faceGray.rows - eyeY));
    cv::Mat eyeBandGray = faceGray(eyeBandRect);
    const double eyeEdges = edgeDensity(eyeBandGray);
    const double eyeDark = darkPixelRatio(eyeBandGray, 40);
    const double eyeBright = brightPixelRatio(eyeBandGray, 225);
    if ((eyeEdges > 0.24 && eyeBright > 0.015) || eyeDark > 0.62) {
      result.issues.push_back("suspected_glasses");
    }

    const int topH = std::max(1, static_cast<int>(faceGray.rows * 0.2));
    cv::Rect topRect(0, 0, faceGray.cols, topH);
    cv::Mat topGray = faceGray(topRect);
    cv::Mat topBgr = faceBgr(topRect);
    const double topDark = darkPixelRatio(topGray, 55);
    const double topSkin = skinPixelRatio(topBgr);
    if (topDark > 0.58 && topSkin < 0.1) {
      result.issues.push_back("suspected_hat");
    }

    const int sideY = std::max(0, static_cast<int>(faceGray.rows * 0.35));
    const int sideH = std::max(1, static_cast<int>(faceGray.rows * 0.45));
    const int sideW = std::max(1, static_cast<int>(faceGray.cols * 0.18));
    cv::Rect leftRect(0, sideY, sideW,
                      std::min(sideH, faceGray.rows - sideY));
    cv::Rect rightRect(std::max(0, faceGray.cols - sideW), sideY, sideW,
                       std::min(sideH, faceGray.rows - sideY));
    const double sideEdges =
        (edgeDensity(faceGray(leftRect)) + edgeDensity(faceGray(rightRect))) *
        0.5;
    const double sideDark =
        (darkPixelRatio(faceGray(leftRect), 48) +
         darkPixelRatio(faceGray(rightRect), 48)) *
        0.5;
    if (sideEdges > 0.27 && sideDark > 0.42) {
      result.issues.push_back("suspected_face_accessory");
    }

    const int cheekY = std::max(0, static_cast<int>(faceBgr.rows * 0.28));
    const int cheekH = std::max(1, static_cast<int>(faceBgr.rows * 0.34));
    const int cheekX = std::max(0, static_cast<int>(faceBgr.cols * 0.2));
    const int cheekW = std::max(1, static_cast<int>(faceBgr.cols * 0.6));
    cv::Rect cheekRect(cheekX, cheekY, std::min(cheekW, faceBgr.cols - cheekX),
                       std::min(cheekH, faceBgr.rows - cheekY));
    cv::Mat cheekBgr = faceBgr(cheekRect);
    const double cheekSat = meanSaturation(cheekBgr);
    const double cheekSkin = skinPixelRatio(cheekBgr);
    if (cheekSat > 120.0 && cheekSkin > 0.2) {
      result.issues.push_back("suspected_heavy_makeup");
    }

    applyDnnAccessoryChecks(faceBgr, result.issues);
  }

  result.faceTemplate = extractLegacyTemplateFromMat(faceGray);
  
  // THREE VALIDATIONS LOGIC - Ensure we only hard-fail on these if possible
  const bool hasFace = faces.size() > 0;
  const bool eyesOk = result.issues.end() == std::find(result.issues.begin(), result.issues.end(), "eyes_not_open_or_not_visible");
  const bool mouthOk = true; // Temporary mouth pass if it's too buggy
  
  const double blurNorm = std::clamp(blurScore / 260.0, 0.0, 1.0);
  const double lightNorm =
      1.0 - std::min(std::abs(meanIntensity[0] - 130.0) / 130.0, 1.0);
  const double symNorm = std::clamp((60.0 - symmetry) / 60.0, 0.0, 1.0);
  result.qualityScore = std::clamp((0.40 * blurNorm) + (0.40 * lightNorm) +
                                       (0.20 * symNorm),
                                   0.0, 1.0);
  
  // Final decision: if it has face and eyes and mouth (not checked strictly here yet), we say OK
  result.ok = hasFace && eyesOk && (result.issues.size() < 4); // Permissive: allow some minor issues
  return result;
}

FaceAnalysis analyzeFaceImageDermalogCli(const std::string &base64Image,
                                         const std::string &mode) {
  FaceAnalysis result;
  result.provider = "dermalog_cli";

  std::vector<unsigned char> raw;
  if (!decodeBase64(base64Image, raw)) {
    result.issues.push_back("invalid_base64_image");
    return result;
  }

  if (gDermalogCliPath.empty() || !fs::exists(gDermalogCliPath)) {
    result.issues.push_back("dermalog_cli_not_found");
    return result;
  }

  const auto tmpDir = fs::temp_directory_path();
  const auto imagePath = tmpDir / ("dermalog_face_" + makeId() + ".jpg");
  const auto jsonPath = tmpDir / ("dermalog_face_" + makeId() + ".json");

  {
    std::ofstream ofs(imagePath, std::ios::binary | std::ios::trunc);
    ofs.write(reinterpret_cast<const char *>(raw.data()),
              static_cast<std::streamsize>(raw.size()));
  }

  const std::string cmd = "\"" + gDermalogCliPath + "\" --input \"" +
                          imagePath.string() + "\" --mode " + mode +
                          " --output-json \"" + jsonPath.string() + "\"";

  const int rc = std::system(cmd.c_str());
  if (rc != 0 || !fs::exists(jsonPath)) {
    result.issues.push_back("dermalog_cli_execution_failed");
    fs::remove(imagePath);
    fs::remove(jsonPath);
    return result;
  }

  try {
    std::ifstream ifs(jsonPath);
    std::stringstream buffer;
    buffer << ifs.rdbuf();
    auto payload = json::parse(buffer.str());
    if (!payload.is_object()) {
      result.issues.push_back("dermalog_invalid_json");
    } else {
      const auto &obj = payload.as_object();
      if (auto q = obj.if_contains("quality"); q && q->is_object()) {
        const auto &qObj = q->as_object();
        if (auto score = qObj.if_contains("score"); score &&
            (score->is_double() || score->is_int64())) {
          result.qualityScore = score->is_double()
                                    ? score->as_double()
                                    : static_cast<double>(score->as_int64());
        }
        if (auto issues = qObj.if_contains("issues"); issues &&
            issues->is_array()) {
          for (const auto &issue : issues->as_array()) {
            if (issue.is_string()) {
              result.issues.push_back(
                  json::value_to<std::string>(issue));
            }
          }
        }
      }

      if (auto tpl = obj.if_contains("template"); tpl && tpl->is_array()) {
        for (const auto &v : tpl->as_array()) {
          if (v.is_double()) {
            result.faceTemplate.push_back(v.as_double());
          } else if (v.is_int64()) {
            result.faceTemplate.push_back(static_cast<double>(v.as_int64()));
          }
        }
      }

      if (auto pass = obj.if_contains("pass"); pass && pass->is_bool()) {
        result.ok = pass->as_bool();
      }
    }
  } catch (...) {
    result.issues.push_back("dermalog_json_parse_failed");
  }

  fs::remove(imagePath);
  fs::remove(jsonPath);

  if (result.faceTemplate.size() < 100) {
    result.issues.push_back("template_too_short");
  }
  if (!result.ok) {
    result.ok = result.issues.empty() && result.faceTemplate.size() >= 100;
  }
  return result;
}

FaceAnalysis analyzeFaceImage(const std::string &base64Image,
                              const std::string &mode) {
  if (gBiometricProvider == BiometricProvider::DermalogCli) {
    auto fromSdk = analyzeFaceImageDermalogCli(base64Image, mode);
    if (fromSdk.ok || gDermalogRequired) {
      return fromSdk;
    }
  }
  return analyzeFaceImageLegacy(base64Image, mode);
}

std::string makeId() {
  static thread_local std::mt19937_64 rng{std::random_device{}()};
  std::uniform_int_distribution<unsigned long long> dist;
  std::ostringstream oss;
  oss << std::hex << dist(rng) << dist(rng);
  return oss.str();
}

std::string hashPassword(const std::string &password) {
  static const std::string salt =
      getenvOr("AUTH_PASSWORD_SALT", "mining_local_salt_change_me");
  const auto mixed = salt + "::" + password;
  const auto hashed = std::hash<std::string>{}(mixed);
  std::ostringstream oss;
  oss << std::hex << hashed;
  return oss.str();
}

bool isValidDni(const std::string &dni) {
  if (dni.size() < 8 || dni.size() > 12) {
    return false;
  }
  return std::all_of(dni.begin(), dni.end(), [](unsigned char c) {
    return std::isdigit(c) != 0;
  });
}

fs::path authDirPath(const std::string &dataRoot) {
  return fs::path(dataRoot) / "auth";
}

fs::path authUsersFile(const std::string &dataRoot) {
  return authDirPath(dataRoot) / "users.json";
}

fs::path authAuditFile(const std::string &dataRoot) {
  return authDirPath(dataRoot) / "auth_audit.log";
}

json::object authUserToJson(const AuthUser &u) {
  json::array tpl;
  for (double v : u.faceTemplate) {
    tpl.push_back(v);
  }

  return { {"id", u.id},
           {"company", u.company},
           {"first_name", u.firstName},
           {"last_name", u.lastName},
           {"dni", u.dni},
           {"username", u.username},
           {"role", u.role},
           {"password_hash", u.passwordHash},
           {"face_template", tpl},
           {"created_at", u.createdAt} };
}

bool jsonToAuthUser(const json::object &obj, AuthUser &out) {
  if (!obj.if_contains("id") || !obj.if_contains("company") ||
      !obj.if_contains("first_name") || !obj.if_contains("last_name") ||
      !obj.if_contains("dni") || !obj.if_contains("username") ||
      !obj.if_contains("password_hash") || !obj.if_contains("face_template") ||
      !obj.if_contains("created_at")) {
    return false;
  }

  if (!obj.at("id").is_string() || !obj.at("company").is_string() ||
      !obj.at("first_name").is_string() || !obj.at("last_name").is_string() ||
      !obj.at("dni").is_string() || !obj.at("username").is_string() ||
      !obj.at("password_hash").is_string() ||
      !obj.at("face_template").is_array() ||
      !obj.at("created_at").is_string()) {
    return false;
  }

  out.id = json::value_to<std::string>(obj.at("id"));
  out.company = json::value_to<std::string>(obj.at("company"));
  out.firstName = json::value_to<std::string>(obj.at("first_name"));
  out.lastName = json::value_to<std::string>(obj.at("last_name"));
  out.dni = json::value_to<std::string>(obj.at("dni"));
  out.username = json::value_to<std::string>(obj.at("username"));
  if (obj.if_contains("role") && obj.at("role").is_string()) {
    out.role = json::value_to<std::string>(obj.at("role"));
  } else {
    out.role = resolveRoleForUsername(out.username);
  }
  out.passwordHash = json::value_to<std::string>(obj.at("password_hash"));
  out.createdAt = json::value_to<std::string>(obj.at("created_at"));

  out.faceTemplate.clear();
  for (const auto &v : obj.at("face_template").as_array()) {
    if (v.is_double()) {
      out.faceTemplate.push_back(v.as_double());
    } else if (v.is_int64()) {
      out.faceTemplate.push_back(static_cast<double>(v.as_int64()));
    } else {
      return false;
    }
  }
  return !out.faceTemplate.empty();
}

std::vector<AuthUser> loadAuthUsers(const std::string &dataRoot) {
  fs::create_directories(authDirPath(dataRoot));
  const auto path = authUsersFile(dataRoot);
  if (!fs::exists(path)) {
    return {};
  }

  std::ifstream ifs(path);
  if (!ifs.is_open()) {
    return {};
  }

  std::stringstream buffer;
  buffer << ifs.rdbuf();
  const auto raw = buffer.str();
  if (raw.empty()) {
    return {};
  }

  try {
    auto parsed = json::parse(raw);
    if (!parsed.is_array()) {
      return {};
    }

    std::vector<AuthUser> users;
    for (const auto &item : parsed.as_array()) {
      if (!item.is_object()) {
        continue;
      }
      AuthUser user;
      if (jsonToAuthUser(item.as_object(), user)) {
        users.push_back(std::move(user));
      }
    }
    return users;
  } catch (...) {
    return {};
  }
}

void saveAuthUsers(const std::string &dataRoot,
                   const std::vector<AuthUser> &users) {
  fs::create_directories(authDirPath(dataRoot));
  json::array arr;
  for (const auto &u : users) {
    arr.push_back(authUserToJson(u));
  }

  std::ofstream ofs(authUsersFile(dataRoot), std::ios::trunc);
  ofs << json::serialize(arr);
}

double cosineSimilarity(const std::vector<double> &a,
                        const std::vector<double> &b) {
  if (a.empty() || a.size() != b.size()) {
    return -1.0;
  }

  double dot = 0.0;
  double normA = 0.0;
  double normB = 0.0;

  for (size_t i = 0; i < a.size(); ++i) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA == 0.0 || normB == 0.0) {
    return -1.0;
  }

  return dot / (std::sqrt(normA) * std::sqrt(normB));
}

void appendAuthAuditLog(const std::string &dataRoot, const std::string &action,
                        const std::string &company,
                        const std::string &username, bool ok,
                        const std::string &detail) {
  fs::create_directories(authDirPath(dataRoot));
  std::ofstream ofs(authAuditFile(dataRoot), std::ios::app);
  ofs << nowIso8601() << "|action=" << action << "|company=" << company
      << "|username=" << username << "|ok=" << (ok ? "true" : "false")
      << "|detail=" << detail << "\n";
}

json::object parseAuditLine(const std::string &line) {
  json::object out;
  std::stringstream ss(line);
  std::string token;
  bool first = true;
  while (std::getline(ss, token, '|')) {
    if (first) {
      out["event_time"] = token;
      first = false;
      continue;
    }
    const auto eq = token.find('=');
    if (eq == std::string::npos) {
      continue;
    }
    const std::string key = token.substr(0, eq);
    const std::string value = token.substr(eq + 1);
    if (key == "action") out["event_action"] = value;
    else if (key == "company") out["company_name"] = value;
    else if (key == "username") out["username"] = value;
    else if (key == "ok") out["success"] = (value == "true");
    else if (key == "detail") out["detail"] = value;
  }
  return out;
}

bool matchAuditFilter(const json::object &entry, const AuditFilter &filter) {
  if (filter.company.has_value()) {
    auto p = entry.if_contains("company_name");
    if (!p || !p->is_string() || json::value_to<std::string>(*p) != *filter.company) {
      return false;
    }
  }
  if (filter.username.has_value()) {
    auto p = entry.if_contains("username");
    if (!p || !p->is_string() || json::value_to<std::string>(*p) != *filter.username) {
      return false;
    }
  }
  if (filter.action.has_value()) {
    auto p = entry.if_contains("event_action");
    if (!p || !p->is_string() || json::value_to<std::string>(*p) != *filter.action) {
      return false;
    }
  }
  if (filter.success.has_value()) {
    auto p = entry.if_contains("success");
    if (!p || !p->is_bool() || p->as_bool() != *filter.success) {
      return false;
    }
  }
  return true;
}

AuditPageResult readAuthAuditTail(const std::string &dataRoot,
                                  const AuditFilter &filter) {
  AuditPageResult page;
  page.limit = filter.limit;
  page.offset = filter.offset;

  const auto path = authAuditFile(dataRoot);
  if (!fs::exists(path)) {
    return page;
  }

  std::ifstream ifs(path);
  std::vector<json::object> entries;
  std::string line;
  while (std::getline(ifs, line)) {
    if (!line.empty()) {
      auto parsed = parseAuditLine(line);
      if (matchAuditFilter(parsed, filter)) {
        entries.push_back(std::move(parsed));
      }
    }
  }

  page.total = entries.size();
  if (entries.empty()) {
    return page;
  }

  std::reverse(entries.begin(), entries.end());

  const size_t start = std::min(filter.offset, entries.size());
  const size_t end = std::min(start + filter.limit, entries.size());
  for (size_t i = start; i < end; ++i) {
    page.logs.push_back(entries[i]);
  }
  return page;
}

std::string csvEscape(const std::string &v) {
  bool mustQuote = v.find(',') != std::string::npos ||
                   v.find('"') != std::string::npos ||
                   v.find('\n') != std::string::npos;
  if (!mustQuote) {
    return v;
  }
  std::string out = "\"";
  for (char c : v) {
    if (c == '"') out += "\"\"";
    else out.push_back(c);
  }
  out += "\"";
  return out;
}

std::string auditRowsToCsv(const json::array &logs) {
  std::ostringstream oss;
  oss << "event_time,event_action,company_name,username,success,detail\n";
  for (const auto &item : logs) {
    if (!item.is_object()) continue;
    const auto &obj = item.as_object();
    const auto getStr = [&](const char *k) {
      if (auto p = obj.if_contains(k); p && p->is_string()) {
        return json::value_to<std::string>(*p);
      }
      return std::string();
    };
    std::string success = "false";
    if (auto p = obj.if_contains("success"); p && p->is_bool()) {
      success = p->as_bool() ? "true" : "false";
    }

    oss << csvEscape(getStr("event_time")) << ','
        << csvEscape(getStr("event_action")) << ','
        << csvEscape(getStr("company_name")) << ','
        << csvEscape(getStr("username")) << ','
        << csvEscape(success) << ','
        << csvEscape(getStr("detail")) << '\n';
  }
  return oss.str();
}

#if HAS_LIBPQ
std::string pqEscapeLiteral(PGconn *conn, const std::string &value) {
  char *escaped = PQescapeLiteral(conn, value.c_str(), value.size());
  if (!escaped) {
    throw std::runtime_error("failed to escape sql literal");
  }
  std::string out(escaped);
  PQfreemem(escaped);
  return out;
}

bool pgExecOk(PGconn *conn, const std::string &sql) {
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res) {
    return false;
  }
  const auto status = PQresultStatus(res);
  const bool ok = (status == PGRES_COMMAND_OK || status == PGRES_TUPLES_OK);
  PQclear(res);
  return ok;
}

bool ensureAuthSchemaPg(PGconn *conn) {
  const char *sql = R"SQL(
CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    company_name VARCHAR(180) NOT NULL,
    first_name VARCHAR(120) NOT NULL,
    last_name VARCHAR(120) NOT NULL,
    dni VARCHAR(12) NOT NULL UNIQUE,
    username VARCHAR(80) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'operator',
    password_hash TEXT NOT NULL,
    face_template JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_name, username)
);
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_action VARCHAR(60) NOT NULL,
    company_name VARCHAR(180),
    username VARCHAR(80),
    success BOOLEAN NOT NULL,
    detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event_time ON auth_audit_logs(event_time DESC);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'operator';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS ruc VARCHAR(20) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mobile VARCHAR(30) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email VARCHAR(120) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS face_template JSONB NOT NULL DEFAULT '[]'::jsonb;
)SQL";
  return pgExecOk(conn, sql);
}

void appendAuthAuditLogPg(PGconn *conn, const std::string &action,
                          const std::string &company,
                          const std::string &username, bool ok,
                          const std::string &detail) {
  const std::string sql =
      "INSERT INTO auth_audit_logs(event_action, company_name, username, success, detail) VALUES(" +
      pqEscapeLiteral(conn, action) + "," + pqEscapeLiteral(conn, company) + "," +
      pqEscapeLiteral(conn, username) + "," + (ok ? "true" : "false") + "," +
      pqEscapeLiteral(conn, detail) + ")";
  (void)pgExecOk(conn, sql);
}

bool validateCompanyPg(const std::string &databaseUrl, const std::string &companyName, const std::string &ruc, std::string &error) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  std::string sql = "SELECT 1 FROM auth_users WHERE company_name = " + pqEscapeLiteral(conn, companyName);
  if (!ruc.empty()) {
    sql += " AND ruc = " + pqEscapeLiteral(conn, ruc);
  }
  PGresult *res = PQexec(conn, sql.c_str());
  bool exists = (res && PQresultStatus(res) == PGRES_TUPLES_OK && PQntuples(res) > 0);
  if (res) PQclear(res);
  PQfinish(conn);
  return exists;
}

std::vector<Project> listProjectsPg(const std::string &databaseUrl, std::string &error) {
  std::vector<Project> projects;
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return projects;
  }
  PGresult *res = PQexec(conn, "SELECT id, name, description FROM projects ORDER BY name ASC");
  if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
      for (int i = 0; i < PQntuples(res); ++i) {
          projects.push_back({PQgetvalue(res, i, 0), PQgetvalue(res, i, 1), PQgetvalue(res, i, 2), ""});
      }
  } else {
      error = PQerrorMessage(conn);
  }
  if (res) PQclear(res);
  PQfinish(conn);
  return projects;
}

std::vector<Report> listReportsPg(const std::string &databaseUrl, const std::string &company, std::string &error) {
  std::vector<Report> reports;
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
      error = PQerrorMessage(conn);
      PQfinish(conn);
      return reports;
  }
  std::string sql = "SELECT id, project_id, title, status, created_at, updated_at FROM reports";
  // The schema doesn't have a 'company' column in 'reports' directly, but we can filter by metadata or joins if needed.
  // For now, let's fetch all and filter in memory or assume public scope.
  PGresult *res = PQexec(conn, sql.c_str());
  if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
      for (int i = 0; i < PQntuples(res); ++i) {
          Report r;
          r.id = PQgetvalue(res, i, 0);
          r.projectId = PQgetvalue(res, i, 1);
          r.title = PQgetvalue(res, i, 2);
          r.status = PQgetvalue(res, i, 3);
          r.createdAt = PQgetvalue(res, i, 4);
          r.updatedAt = PQgetvalue(res, i, 5);
          reports.push_back(std::move(r));
      }
  }
  if (res) PQclear(res);
  PQfinish(conn);
  return reports;
}

bool getReportByIdPg(const std::string &databaseUrl, const std::string &id, Report &out,
                     std::string &error) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  std::string sql =
      "SELECT id, project_id::text, title, content_json::text, status, "
      "created_at::text, updated_at::text FROM reports WHERE id = " +
      pqEscapeLiteral(conn, id);
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) < 1) {
    error = "report_not_found";
    if (res)
      PQclear(res);
    PQfinish(conn);
    return false;
  }
  out.id = PQgetvalue(res, 0, 0);
  out.projectId =
      PQgetisnull(res, 0, 1) ? "" : std::string(PQgetvalue(res, 0, 1));
  out.title = PQgetvalue(res, 0, 2);
  const char *cj = PQgetvalue(res, 0, 3);
  try {
    out.contentJson =
        (cj && cj[0]) ? json::parse(std::string(cj)) : json::object{};
  } catch (...) {
    out.contentJson = json::object{};
  }
  out.status = PQgetvalue(res, 0, 4);
  out.createdAt = PQgetvalue(res, 0, 5);
  out.updatedAt = PQgetvalue(res, 0, 6);
  PQclear(res);
  PQfinish(conn);
  return true;
}

bool createReportPg(const std::string &databaseUrl, const Report &r,
                    std::string &outNewId, std::string &error) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  std::string contentStr = json::serialize(r.contentJson);
  std::string sql = "INSERT INTO reports (project_id, title, content_json, status) VALUES (" +
      (r.projectId.empty() ? "NULL" : pqEscapeLiteral(conn, r.projectId)) + "," +
      pqEscapeLiteral(conn, r.title) + "," +
      pqEscapeLiteral(conn, contentStr) + "," +
      pqEscapeLiteral(conn, r.status) + ") RETURNING id::text";
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) < 1) {
    error = PQerrorMessage(conn);
    PQclear(res);
    PQfinish(conn);
    return false;
  }
  outNewId = PQgetvalue(res, 0, 0);
  PQclear(res);
  PQfinish(conn);
  return true;
}

bool updateReportPg(const std::string &databaseUrl, const std::string &id, const Report &r, std::string &error) {
    PGconn *conn = PQconnectdb(databaseUrl.c_str());
    if (PQstatus(conn) != CONNECTION_OK) {
        error = PQerrorMessage(conn);
        PQfinish(conn);
        return false;
    }
    std::string contentStr = json::serialize(r.contentJson);
    std::string sql = "UPDATE reports SET title = " + pqEscapeLiteral(conn, r.title) +
        ", content_json = " + pqEscapeLiteral(conn, contentStr) +
        ", status = " + pqEscapeLiteral(conn, r.status) +
        " WHERE id = " + pqEscapeLiteral(conn, id);
    bool ok = pgExecOk(conn, sql);
    if (!ok) error = PQerrorMessage(conn);
    PQfinish(conn);
    return ok;
}

bool deleteReportPg(const std::string &databaseUrl, const std::string &id, std::string &error) {
    PGconn *conn = PQconnectdb(databaseUrl.c_str());
    if (PQstatus(conn) != CONNECTION_OK) {
        error = PQerrorMessage(conn);
        PQfinish(conn);
        return false;
    }
    std::string sql = "DELETE FROM reports WHERE id = " + pqEscapeLiteral(conn, id);
    bool ok = pgExecOk(conn, sql);
    if (!ok) error = PQerrorMessage(conn);
    PQfinish(conn);
    return ok;
}

bool registerUserPg(const std::string &databaseUrl, const AuthUser &user,
                    std::string &error) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }

  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    PQfinish(conn);
    return false;
  }

  std::ostringstream tpl;
  tpl << '[';
  for (size_t i = 0; i < user.faceTemplate.size(); ++i) {
    if (i > 0) tpl << ',';
    tpl << user.faceTemplate[i];
  }
  tpl << ']';

  const std::string checkSql = "SELECT 1 FROM auth_users WHERE dni=" +
                               pqEscapeLiteral(conn, user.dni) + " LIMIT 1";
  PGresult *checkRes = PQexec(conn, checkSql.c_str());
  if (!checkRes || PQresultStatus(checkRes) != PGRES_TUPLES_OK) {
    error = "failed to validate dni";
    if (checkRes) PQclear(checkRes);
    PQfinish(conn);
    return false;
  }
  if (PQntuples(checkRes) > 0) {
    PQclear(checkRes);
    error = "dni already exists";
    appendAuthAuditLogPg(conn, "register", user.company, user.username, false,
                         "dni_exists");
    PQfinish(conn);
    return false;
  }
  PQclear(checkRes);

  const std::string insertSql =
      "INSERT INTO auth_users(id,company_name,first_name,last_name,dni,username,role,password_hash,face_template,ruc,phone,mobile,email) VALUES(" +
      pqEscapeLiteral(conn, user.id) + "," + pqEscapeLiteral(conn, user.company) +
      "," + pqEscapeLiteral(conn, user.firstName) + "," +
      pqEscapeLiteral(conn, user.lastName) + "," + pqEscapeLiteral(conn, user.dni) +
      "," + pqEscapeLiteral(conn, user.username) + "," +
      pqEscapeLiteral(conn, user.role) + "," +
      pqEscapeLiteral(conn, user.passwordHash) + "," +
      pqEscapeLiteral(conn, tpl.str()) + "::jsonb," + 
      pqEscapeLiteral(conn, user.ruc) + "," + 
      pqEscapeLiteral(conn, user.phone) + "," + 
      pqEscapeLiteral(conn, user.mobile) + "," + 
      pqEscapeLiteral(conn, user.email) + ")";

  if (!pgExecOk(conn, insertSql)) {
    error = "failed to insert user";
    appendAuthAuditLogPg(conn, "register", user.company, user.username, false,
                         "insert_failed");
    PQfinish(conn);
    return false;
  }

  appendAuthAuditLogPg(conn, "register", user.company, user.username, true,
                       "ok");
  PQfinish(conn);
  return true;
}

std::optional<AuthUser> loginPasswordPg(const std::string &databaseUrl,
                                        const std::string &company,
                                        const std::string &username,
                                        const std::string &passwordHash,
                                        std::string &error) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);

  const std::string sql =
      "SELECT id, company_name, first_name, last_name, dni, username, role, password_hash, face_template::text, created_at::text "
      "FROM auth_users WHERE company_name=" +
      pqEscapeLiteral(conn, company) + " AND username=" +
      pqEscapeLiteral(conn, username) + " LIMIT 1";

  PGresult *res = PQexec(conn, sql.c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
    error = res ? PQresultErrorMessage(res) : PQerrorMessage(conn);
    if (error.empty()) {
      error = "query failed";
    }
    if (res) PQclear(res);
    PQfinish(conn);
    return std::nullopt;
  }

  if (PQntuples(res) == 0) {
    PQclear(res);
    appendAuthAuditLogPg(conn, "login_password", company, username, false,
                         "user_not_found");
    PQfinish(conn);
    error = "invalid credentials";
    return std::nullopt;
  }

  AuthUser u;
  u.id = PQgetvalue(res, 0, 0);
  u.company = PQgetvalue(res, 0, 1);
  u.firstName = PQgetvalue(res, 0, 2);
  u.lastName = PQgetvalue(res, 0, 3);
  u.dni = PQgetvalue(res, 0, 4);
  u.username = PQgetvalue(res, 0, 5);
  u.role = PQgetvalue(res, 0, 6);
  u.passwordHash = PQgetvalue(res, 0, 7);
  u.createdAt = PQgetvalue(res, 0, 9);

  if (u.passwordHash != passwordHash) {
    appendAuthAuditLogPg(conn, "login_password", company, username, false,
                         "invalid_password");
    PQclear(res);
    PQfinish(conn);
    error = "invalid credentials";
    return std::nullopt;
  }

  appendAuthAuditLogPg(conn, "login_password", company, username, true, "ok");
  PQclear(res);
  PQfinish(conn);
  return u;
}

std::optional<std::pair<AuthUser, double>>
loginFacePg(const std::string &databaseUrl, const std::string &company,
            const std::vector<double> &probeTemplate, double threshold,
            std::string &error) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);

  const std::string sql =
      "SELECT id, company_name, first_name, last_name, dni, username, role, password_hash, face_template::text, created_at::text, ruc, phone, mobile, email "
      "FROM auth_users WHERE company_name=" + pqEscapeLiteral(conn, company);
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
    error = res ? PQresultErrorMessage(res) : PQerrorMessage(conn);
    if (error.empty()) {
      error = "query failed";
    }
    if (res) PQclear(res);
    PQfinish(conn);
    return std::nullopt;
  }

  AuthUser best;
  bool found = false;
  double bestScore = -1.0;

  const int rows = PQntuples(res);
  for (int i = 0; i < rows; ++i) {
    std::string tplText = PQgetvalue(res, i, 8);
    try {
      auto parsed = json::parse(tplText);
      if (!parsed.is_array()) {
        continue;
      }
      std::vector<double> tpl;
      for (const auto &v : parsed.as_array()) {
        if (v.is_double()) tpl.push_back(v.as_double());
        else if (v.is_int64()) tpl.push_back(static_cast<double>(v.as_int64()));
      }
      const double score = cosineSimilarity(probeTemplate, tpl);
      if (score > bestScore) {
        bestScore = score;
        best.id = PQgetvalue(res, i, 0);
        best.company = PQgetvalue(res, i, 1);
        best.firstName = PQgetvalue(res, i, 2);
        best.lastName = PQgetvalue(res, i, 3);
        best.dni = PQgetvalue(res, i, 4);
        best.username = PQgetvalue(res, i, 5);
        best.role = PQgetvalue(res, i, 6);
        best.passwordHash = PQgetvalue(res, i, 7);
        best.createdAt = PQgetvalue(res, i, 9);
        best.ruc = PQgetvalue(res, i, 10);
        best.phone = PQgetvalue(res, i, 11);
        best.mobile = PQgetvalue(res, i, 12);
        best.email = PQgetvalue(res, i, 13);
        found = true;
      }
    } catch (...) {
      continue;
    }
  }

  if (!found || bestScore < threshold) {
    appendAuthAuditLogPg(conn, "login_face", company, "unknown", false,
                         "no_match");
    PQclear(res);
    PQfinish(conn);
    error = "face not recognized";
    return std::nullopt;
  }

  appendAuthAuditLogPg(conn, "login_face", company, best.username, true,
                       "ok score=" + std::to_string(bestScore));
  PQclear(res);
  PQfinish(conn);
  return std::make_pair(best, bestScore);
}

AuditPageResult readAuthAuditPg(const std::string &databaseUrl,
                                const AuditFilter &filter) {
  AuditPageResult out;
  out.limit = filter.limit;
  out.offset = filter.offset;
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    PQfinish(conn);
    return out;
  }
  (void)ensureAuthSchemaPg(conn);

  std::ostringstream where;
  where << " WHERE 1=1";
  if (filter.company.has_value()) {
    where << " AND company_name=" << pqEscapeLiteral(conn, *filter.company);
  }
  if (filter.username.has_value()) {
    where << " AND username=" << pqEscapeLiteral(conn, *filter.username);
  }
  if (filter.action.has_value()) {
    where << " AND event_action=" << pqEscapeLiteral(conn, *filter.action);
  }
  if (filter.success.has_value()) {
    where << " AND success=" << (*filter.success ? "true" : "false");
  }

  const std::string countSql = "SELECT COUNT(*) FROM auth_audit_logs" + where.str();
  PGresult *countRes = PQexec(conn, countSql.c_str());
  if (!countRes || PQresultStatus(countRes) != PGRES_TUPLES_OK ||
      PQntuples(countRes) == 0) {
    if (countRes) PQclear(countRes);
    PQfinish(conn);
    return out;
  }
  out.total = static_cast<size_t>(std::stoull(PQgetvalue(countRes, 0, 0)));
  PQclear(countRes);

  std::ostringstream sql;
  sql << "SELECT event_time::text,event_action,company_name,username,success,detail "
      << "FROM auth_audit_logs" << where.str()
      << " ORDER BY event_time DESC LIMIT " << filter.limit
      << " OFFSET " << filter.offset;

  PGresult *res = PQexec(conn, sql.str().c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
    if (res) PQclear(res);
    PQfinish(conn);
    return out;
  }

  const int rows = PQntuples(res);
  for (int i = 0; i < rows; ++i) {
    out.logs.push_back(json::object{{"event_time", PQgetvalue(res, i, 0)},
                                    {"event_action", PQgetvalue(res, i, 1)},
                                    {"company_name", PQgetvalue(res, i, 2)},
                                    {"username", PQgetvalue(res, i, 3)},
                                    {"success", std::string(PQgetvalue(res, i, 4)) == "t"},
                                    {"detail", PQgetvalue(res, i, 5)}});
  }

  PQclear(res);
  PQfinish(conn);
  return out;
}
#endif

std::string getenvOr(const char *key, const std::string &fallback) {
  const char *value = std::getenv(key);
  if (!value)
    return fallback;
  return value;
}

bool parseConvertRequest(const json::object &obj, ConvertRequest &out,
                         std::string &error) {
  if (!obj.contains("input_path") || !obj.at("input_path").is_string()) {
    error = "input_path is required (string)";
    return false;
  }

  out.inputPath = json::value_to<std::string>(obj.at("input_path"));

  if (obj.if_contains("output_path") && obj.at("output_path").is_string()) {
    out.outputPath = json::value_to<std::string>(obj.at("output_path"));
  }

  out.outputName =
      obj.if_contains("output_name") && obj.at("output_name").is_string()
          ? json::value_to<std::string>(obj.at("output_name"))
          : (fs::path(out.inputPath).stem().string() + ".mbtiles");
  if (!out.outputName.ends_with(".mbtiles")) {
    out.outputName += ".mbtiles";
  }
  if (!out.outputPath.empty() && !out.outputPath.ends_with(".mbtiles")) {
    out.outputPath += ".mbtiles";
  }

  if (obj.if_contains("min_zoom") && obj.at("min_zoom").is_int64()) {
    out.minZoom = static_cast<int>(obj.at("min_zoom").as_int64());
  }
  if (obj.if_contains("max_zoom") && obj.at("max_zoom").is_int64()) {
    out.maxZoom = static_cast<int>(obj.at("max_zoom").as_int64());
  }
  if (obj.if_contains("compression") && obj.at("compression").is_string()) {
    out.compression = json::value_to<std::string>(obj.at("compression"));
  }
  if (obj.if_contains("quality") && obj.at("quality").is_int64()) {
    out.quality = static_cast<int>(obj.at("quality").as_int64());
  }
  if (obj.if_contains("resampling") && obj.at("resampling").is_string()) {
    out.resampling = json::value_to<std::string>(obj.at("resampling"));
  }

  if (out.minZoom < 0 || out.maxZoom < out.minZoom || out.maxZoom > 24) {
    error = "invalid zoom range";
    return false;
  }
  if (out.quality < 1 || out.quality > 100) {
    error = "quality must be between 1 and 100";
    return false;
  }

  return true;
}

std::string quotePath(const std::string &path) { return "\"" + path + "\""; }

int runCommand(const std::string &cmd) { return std::system(cmd.c_str()); }

std::string runCommandCapture(const std::string &cmd) {
#ifdef _WIN32
  FILE *pipe = _popen(cmd.c_str(), "r");
#else
  FILE *pipe = popen(cmd.c_str(), "r");
#endif
  if (!pipe)
    return {};
  std::string output;
  char buffer[512];
  while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
    output += buffer;
  }
#ifdef _WIN32
  _pclose(pipe);
#else
  pclose(pipe);
#endif
  return output;
}

bool gdalSupportsEcw() {
  std::string formats = runCommandCapture("gdalinfo --formats 2>&1");
  if (formats.empty())
    return false;
  std::regex ecwPattern(R"((^|\n)\s*ECW\s*-)", std::regex::icase);
  return std::regex_search(formats, ecwPattern);
}

void appendLog(const std::string &id, const std::string &line) {
  std::scoped_lock lk(gJobsMutex);
  auto it = gJobs.find(id);
  if (it == gJobs.end())
    return;
  it->second.logs.push_back(line);
  it->second.updatedAt = nowIso8601();
}

void setStatus(const std::string &id, const std::string &status) {
  std::scoped_lock lk(gJobsMutex);
  auto it = gJobs.find(id);
  if (it == gJobs.end())
    return;
  it->second.status = status;
  it->second.updatedAt = nowIso8601();
}

std::optional<Job> getJob(const std::string &id) {
  std::scoped_lock lk(gJobsMutex);
  auto it = gJobs.find(id);
  if (it == gJobs.end())
    return std::nullopt;
  return it->second;
}

std::vector<int> buildOverviewFactors(int minZoom, int maxZoom) {
  std::vector<int> factors;
  int zoomSteps = std::max(0, maxZoom - minZoom);
  int factor = 2;
  for (int i = 0; i < zoomSteps; ++i) {
    factors.push_back(factor);
    factor *= 2;
  }
  return factors;
}

json::object jobToJson(const Job &job) {
  json::array logs;
  for (const auto &l : job.logs) {
    logs.emplace_back(l);
  }
  return {{"job_id", job.id},
          {"status", job.status},
          {"created_at", job.createdAt},
          {"updated_at", job.updatedAt},
          {"output_path", job.outputPath},
          {"logs", logs}};
}

void runConversionJob(const std::string &id, ConvertRequest req,
                      std::string dataRoot) {
  try {
    setStatus(id, "running");

    fs::path input(req.inputPath);
    fs::path output = req.outputPath.empty()
                          ? (fs::path(dataRoot) / "tiles" / req.outputName)
                          : fs::path(req.outputPath);
    fs::create_directories(output.parent_path());

    appendLog(id, "Starting conversion");
    appendLog(id, std::string("Input: ") + input.string());
    appendLog(id, std::string("Output: ") + output.string());

    bool isEcwInput =
        input.extension() == ".ecw" || input.extension() == ".ECW";
    if (isEcwInput && !gdalSupportsEcw()) {
      appendLog(id, "ECW driver is not available in this container.");
      appendLog(id, "Mount ECW plugin and set GDAL_DRIVER_PATH (see README), "
                    "or pre-convert ECW to GeoTIFF.");
      setStatus(id, "failed");
      return;
    }

    cv::Mat sample = cv::imread(input.string(), cv::IMREAD_UNCHANGED);
    if (!sample.empty()) {
      appendLog(id, "OpenCV sample read: " + std::to_string(sample.cols) + "x" +
                        std::to_string(sample.rows) +
                        " channels=" + std::to_string(sample.channels()));
    } else {
      appendLog(id, "OpenCV could not read source directly (normal for some "
                    "ECW setups). Continuing with GDAL.");
    }

    std::ostringstream translate;
    translate << "gdal_translate"
              << " -of MBTILES"
              << " -co TILE_FORMAT=" << req.compression
              << " -co QUALITY=" << req.quality
              << " -co ZOOM_LEVEL_STRATEGY=AUTO"
              << " -co BLOCKSIZE=256"
              << " -r " << req.resampling << " -oo NUM_THREADS=ALL_CPUS"
              << " -co MINZOOM=" << req.minZoom
              << " -co MAXZOOM=" << req.maxZoom << " "
              << quotePath(input.string()) << " " << quotePath(output.string());

    appendLog(id, "Running gdal_translate...");
    int rc1 = runCommand(translate.str());
    appendLog(id, "gdal_translate exit code: " + std::to_string(rc1));
    if (rc1 != 0) {
      setStatus(id, "failed");
      appendLog(id, "Conversion failed in gdal_translate");
      return;
    }

    const auto overviewFactors = buildOverviewFactors(req.minZoom, req.maxZoom);
    if (!overviewFactors.empty()) {
      std::ostringstream overviews;
      overviews << "gdaladdo -r average " << quotePath(output.string());
      for (int factor : overviewFactors) {
        overviews << ' ' << factor;
      }

      appendLog(id, "Building overviews...");
      int rc2 = runCommand(overviews.str());
      appendLog(id, "gdaladdo exit code: " + std::to_string(rc2));
      if (rc2 != 0) {
        setStatus(id, "failed");
        appendLog(id, "Overview generation failed");
        return;
      }
    } else {
      appendLog(id, "Skipping overviews because min_zoom == max_zoom.");
    }

    {
      std::scoped_lock lk(gJobsMutex);
      auto &job = gJobs[id];
      job.outputPath = output.string();
    }
    setStatus(id, "completed");
    appendLog(id, "Job completed successfully");
  } catch (const std::exception &ex) {
    setStatus(id, "failed");
    appendLog(id, std::string("Unhandled exception: ") + ex.what());
  }
}

http::response<http::string_body> makeJsonResponse(http::status status,
                                                   const json::value &value) {
  http::response<http::string_body> res{status, 11};
  res.set(http::field::content_type, "application/json");
  res.set(http::field::access_control_allow_origin, "*");
    res.set(http::field::access_control_allow_headers,
      "content-type,authorization");
  res.set(http::field::access_control_allow_methods, "GET,POST,OPTIONS");
  res.body() = json::serialize(value);
  res.prepare_payload();
  return res;
}

http::response<http::string_body> makeCsvResponse(const std::string &filename,
                                                  const std::string &csv) {
  http::response<http::string_body> res{http::status::ok, 11};
  res.set(http::field::content_type, "text/csv; charset=utf-8");
  res.set(http::field::access_control_allow_origin, "*");
    res.set(http::field::access_control_allow_headers,
      "content-type,authorization");
  res.set(http::field::access_control_allow_methods, "GET,OPTIONS");
  res.set(http::field::content_disposition,
          "attachment; filename=\"" + filename + "\"");
  res.body() = csv;
  res.prepare_payload();
  return res;
}

http::response<http::string_body>
routeRequest(const http::request<http::string_body> &req,
             const std::string &dataRoot) {
  const std::string target = std::string(req.target());
  const std::string pathOnly = routePathOnly(target);
  const auto query = parseQueryString(target);

  if (req.method() == http::verb::options) {
    return makeJsonResponse(http::status::ok, json::object{{"ok", true}});
  }

  if (req.method() == http::verb::get && pathOnly == "/health") {
    return makeJsonResponse(http::status::ok, json::object{{"status", "ok"}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/capabilities") {
    return makeJsonResponse(http::status::ok,
                            json::object{{"ecw_supported", gdalSupportsEcw()}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/auth/companies") {
    json::array companies;
    for (const auto &company : kMiningCompanies) {
      companies.push_back(json::value(company));
    }
    return makeJsonResponse(http::status::ok,
                            json::object{{"companies", companies}});
  }

  if (req.method() == http::verb::get &&
      pathOnly == "/api/auth/biometric/status") {
    const auto session = resolveAuthSession(req, query);
    if (!session || session->role != "admin") {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "admin access required"}});
    }

    return makeJsonResponse(
        http::status::ok,
        json::object{{"provider", gBiometricProvider == BiometricProvider::DermalogCli
                                     ? "dermalog_cli"
                                     : "legacy"},
                     {"dermalog_required", gDermalogRequired},
                     {"dnn", biometricDnnRuntimeStatusJson()}});
  }

  if (req.method() == http::verb::post && pathOnly == "/api/auth/biometric/verify-frame") {
    try {
      auto val = json::parse(req.body());
      if (!val.is_object() || !val.as_object().if_contains("face_image_base64")) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "face_image_base64 is required"}});
      }
      const std::string base64 = json::value_to<std::string>(val.as_object().at("face_image_base64"));
      auto face = analyzeFaceImage(base64, "verify");

      std::vector<unsigned char> frameRaw;
      const bool decoded = decodeBase64(base64, frameRaw);
      if (decoded && !frameRaw.empty()) {
        cv::Mat bgr = cv::imdecode(frameRaw, cv::IMREAD_COLOR);
        if (!bgr.empty()) {
          const float illumPct = icaoFullFrameIlluminationPercent(bgr);
          if (illumPct < gBiometricIcaoIlluminationMin) {
            pushIssueUnique(face.issues, "lighting_insufficient_icao");
            face.ok = false;
          }
        }
      }

      std::optional<AiEngineFrameResult> aiEval;
      if (decoded && !frameRaw.empty()) {
        const auto sessionBiometric = resolveAuthSession(req, query);
        std::optional<std::string> glassesEmaKey;
        if (sessionBiometric.has_value()) {
          glassesEmaKey = sessionBiometric->token;
        }
        aiEval = analyzeFrameWithAiEngine(frameRaw, glassesEmaKey);
      }

      if (aiEval.has_value()) {
        if (!aiEval->error.empty()) {
          pushIssueUnique(face.issues, aiEval->error);
        } else if (aiEval->available) {
          if (!aiEval->detected) {
            pushIssueUnique(face.issues, "ai_face_not_detected");
          }
          if (!aiEval->bothOpen) {
            pushIssueUnique(face.issues, "eyes_not_open_or_not_visible");
          }
          if (!aiEval->mouthClosed) {
            pushIssueUnique(face.issues, "mouth_not_closed");
          }
          if (!aiEval->noGlasses) {
            pushIssueUnique(face.issues, "suspected_glasses");
          }
          if (aiEval->detected && aiEval->hasEarMetrics) {
            const double earSum = aiEval->leftEar + aiEval->rightEar;
            const float eyeConf = static_cast<float>(
                std::clamp((earSum / 0.6) * 100.0, 0.0, 100.0));
            if (eyeConf < gBiometricIcaoEyeConfidenceMin) {
              pushIssueUnique(face.issues, "eye_open_confidence_low");
              face.ok = false;
            }
          }
          face.ok = face.ok && aiEval->detected && aiEval->bothOpen &&
                    aiEval->mouthClosed && aiEval->noGlasses;
        }
      }
      
      json::array issuesArr;
      for (const auto &issue : face.issues) {
        issuesArr.push_back(json::value(issue));
      }

      return makeJsonResponse(http::status::ok, json::object{
        {"ok", face.ok},
        {"issues", issuesArr},
        {"quality_score", face.qualityScore},
        {"provider", face.provider},
        {"ai_engine_enabled", !gAiEngineUrl.empty()},
        {"ai_engine_timeout_ms", gAiEngineTimeoutMs}
      });
    } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
    }
  }

  if (req.method() == http::verb::post && pathOnly == "/api/auth/register") {
    try {
      auto val = json::parse(req.body());
      if (!val.is_object()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid JSON body"}});
      }

      const auto &obj = val.as_object();
        const std::vector<std::string> required = {
          "company", "first_name", "last_name", "dni", "username",
          "password"};

      for (const auto &key : required) {
        if (!obj.if_contains(key.c_str())) {
          return makeJsonResponse(http::status::bad_request,
                                  json::object{{"error", key + " is required"}});
        }
      }

        if (!obj.at("company").is_string() || !obj.at("first_name").is_string() ||
          !obj.at("last_name").is_string() || !obj.at("dni").is_string() ||
          !obj.at("username").is_string() || !obj.at("password").is_string()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid auth payload"}});
      }

        const bool hasTemplate =
          obj.if_contains("face_template") && obj.at("face_template").is_array();
        const bool hasImage = obj.if_contains("face_image_base64") &&
                  obj.at("face_image_base64").is_string();
        if (!hasTemplate && !hasImage) {
        return makeJsonResponse(
          http::status::bad_request,
          json::object{{"error", "face_template or face_image_base64 is required"}});
        }

      const std::string company = json::value_to<std::string>(obj.at("company"));
      const std::string firstName = json::value_to<std::string>(obj.at("first_name"));
      const std::string lastName = json::value_to<std::string>(obj.at("last_name"));
      const std::string dni = json::value_to<std::string>(obj.at("dni"));
      const std::string username = json::value_to<std::string>(obj.at("username"));
      const std::string password = json::value_to<std::string>(obj.at("password"));
      
      std::string role = obj.if_contains("role") && obj.at("role").is_string() ? json::value_to<std::string>(obj.at("role")) : resolveRoleForUsername(username);
      std::string ruc = obj.if_contains("ruc") && obj.at("ruc").is_string() ? json::value_to<std::string>(obj.at("ruc")) : "";
      std::string phone = obj.if_contains("phone") && obj.at("phone").is_string() ? json::value_to<std::string>(obj.at("phone")) : "";
      std::string mobile = obj.if_contains("mobile") && obj.at("mobile").is_string() ? json::value_to<std::string>(obj.at("mobile")) : "";
      std::string email = obj.if_contains("email") && obj.at("email").is_string() ? json::value_to<std::string>(obj.at("email")) : "";

      std::vector<double> faceTemplate;
      std::string biometricProvider = "legacy";
      double qualityScore = 0.0;
      if (hasTemplate) {
        for (const auto &v : obj.at("face_template").as_array()) {
          if (v.is_double()) {
            faceTemplate.push_back(v.as_double());
          } else if (v.is_int64()) {
            faceTemplate.push_back(static_cast<double>(v.as_int64()));
          } else {
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "face_template must be a numeric array"}});
          }
        }
      } else {
        const std::string base64Image =
            json::value_to<std::string>(obj.at("face_image_base64"));
        auto face = analyzeFaceImage(base64Image, "register");
        if (face.faceTemplate.empty()) {
          json::array issues;
          for (const auto &issue : face.issues) {
            issues.push_back(json::value(issue));
          }
          return makeJsonResponse(
              http::status::bad_request,
              json::object{{"error", "face not detected"},
                           {"provider", face.provider},
                           {"issues", issues}});
        }
        // Proceed even if face.ok is false, per user request to "remove these validations"
        faceTemplate = std::move(face.faceTemplate);
        biometricProvider = face.provider;
        qualityScore = face.qualityScore;
      }

      if (faceTemplate.size() < 100) {
        return makeJsonResponse(
            http::status::bad_request,
            json::object{{"error", "face_template is too short"}});
      }

      if (!isValidDni(dni)) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "dni must be numeric"}});
      }

      if (username.size() < 4 || password.size() < 6) {
        return makeJsonResponse(
            http::status::bad_request,
            json::object{{"error", "username or password length is invalid"}});
      }

      AuthUser created;
      created.id = makeId();
      created.company = company;
      created.firstName = firstName;
      created.lastName = lastName;
      created.dni = dni;
      created.username = username;
      created.role = role;
      created.passwordHash = hashPassword(password);
      created.faceTemplate = std::move(faceTemplate);
      created.createdAt = nowIso8601();
      created.ruc = ruc;
      created.phone = phone;
      created.mobile = mobile;
      created.email = email;

      {
        std::scoped_lock lk(gAuthMutex);
        if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
          std::string dbError;
          if (!registerUserPg(gDatabaseUrl, created, dbError)) {
            return makeJsonResponse(http::status::conflict,
                                    json::object{{"error", dbError}});
          }
#else
          return makeJsonResponse(
              http::status::internal_server_error,
              json::object{{"error", "postgres support is not compiled"}});
#endif
        } else {
          auto users = loadAuthUsers(dataRoot);

          const auto sameDni =
              std::find_if(users.begin(), users.end(), [&](const auto &u) {
                return u.dni == dni;
              });
          if (sameDni != users.end()) {
            appendAuthAuditLog(dataRoot, "register", company, username, false,
                               "dni_exists");
            return makeJsonResponse(
                http::status::conflict,
                json::object{{"error", "dni already exists"}});
          }

          const auto sameUsername =
              std::find_if(users.begin(), users.end(), [&](const auto &u) {
                return u.username == username && u.company == company;
              });
          if (sameUsername != users.end()) {
            appendAuthAuditLog(dataRoot, "register", company, username, false,
                               "username_exists");
            return makeJsonResponse(http::status::conflict,
                                    json::object{{"error", "username already exists in this company"}});
          }

          users.push_back(created);
          saveAuthUsers(dataRoot, users);
          appendAuthAuditLog(dataRoot, "register", company, username, true,
                             "ok");
        }
      }

        const auto sessionToken = issueAuthSession(created);

        return makeJsonResponse(
          http::status::created,
          json::object{{"status", "registered"},
                 {"biometric_provider", biometricProvider},
                 {"quality_score", qualityScore},
                       {"user", json::object{{"id", created.id},
                                              {"company", created.company},
                                              {"username", created.username},
                                              {"role", created.role},
                            {"token", sessionToken.token},
                                              {"full_name", created.firstName +
                                                                " " +
                                                                created.lastName}}}});
    } catch (const std::exception &ex) {
      appendAuthAuditLog(dataRoot, "register", "unknown", "unknown", false,
                         ex.what());
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", ex.what()}});
    }
  }

  if (req.method() == http::verb::post && pathOnly == "/api/auth/login/password") {
    try {
      auto val = json::parse(req.body());
      if (!val.is_object()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid JSON body"}});
      }
      const auto &obj = val.as_object();
      if (!obj.if_contains("company") || !obj.if_contains("username") ||
          !obj.if_contains("password") || !obj.at("company").is_string() ||
          !obj.at("username").is_string() || !obj.at("password").is_string()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid auth payload"}});
      }

      const std::string company = json::value_to<std::string>(obj.at("company"));
      const std::string username = json::value_to<std::string>(obj.at("username"));
      const std::string password = json::value_to<std::string>(obj.at("password"));

      AuthUser found;
      bool ok = false;
      {
        std::scoped_lock lk(gAuthMutex);
        if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
          std::string dbError;
          auto user = loginPasswordPg(gDatabaseUrl, company, username,
                                      hashPassword(password), dbError);
          if (!user) {
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", dbError}});
          }
          found = *user;
          ok = true;
#else
          return makeJsonResponse(
              http::status::internal_server_error,
              json::object{{"error", "postgres support is not compiled"}});
#endif
        } else {
          const auto users = loadAuthUsers(dataRoot);
          const auto it =
              std::find_if(users.begin(), users.end(), [&](const auto &u) {
                return u.company == company && u.username == username;
              });

          if (it == users.end() || it->passwordHash != hashPassword(password)) {
            appendAuthAuditLog(dataRoot, "login_password", company, username,
                               false, "invalid_credentials");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{{"error", "invalid credentials"}});
          }
          appendAuthAuditLog(dataRoot, "login_password", company, username,
                             true, "ok");
          found = *it;
          ok = true;
        }
      }

      if (!ok) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "invalid credentials"}});
      }

        const auto sessionToken = issueAuthSession(found);

        return makeJsonResponse(
          http::status::ok,
          json::object{{"status", "authenticated"},
                       {"method", "password"},
                       {"user", json::object{{"id", found.id},
                                              {"company", found.company},
                                              {"username", found.username},
                                              {"role", found.role},
                            {"token", sessionToken.token},
                                              {"full_name", found.firstName +
                                                                " " +
                                                                found.lastName}}}});
    } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", ex.what()}});
    }
  }

  if (req.method() == http::verb::post && pathOnly == "/api/auth/login/face") {
    try {
      auto val = json::parse(req.body());
      if (!val.is_object()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid JSON body"}});
      }

      const auto &obj = val.as_object();
      if (!obj.if_contains("company") || !obj.at("company").is_string()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid auth payload"}});
      }

      const bool hasTemplate =
          obj.if_contains("face_template") && obj.at("face_template").is_array();
      const bool hasImage = obj.if_contains("face_image_base64") &&
                            obj.at("face_image_base64").is_string();
      if (!hasTemplate && !hasImage) {
        return makeJsonResponse(
            http::status::bad_request,
            json::object{{"error", "face_template or face_image_base64 is required"}});
      }

      const std::string company = json::value_to<std::string>(obj.at("company"));
      const auto threshold = obj.if_contains("threshold") &&
                                     obj.at("threshold").is_double()
                                 ? obj.at("threshold").as_double()
                                 : 0.89;

      std::vector<double> faceTemplate;
      std::string biometricProvider = "legacy";
      if (hasTemplate) {
        for (const auto &v : obj.at("face_template").as_array()) {
          if (v.is_double()) {
            faceTemplate.push_back(v.as_double());
          } else if (v.is_int64()) {
            faceTemplate.push_back(static_cast<double>(v.as_int64()));
          } else {
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "face_template must be a numeric array"}});
          }
        }
      } else {
        const std::string base64Image =
            json::value_to<std::string>(obj.at("face_image_base64"));
        auto face = analyzeFaceImage(base64Image, "verify");
        if (!face.ok) {
          json::array issues;
          for (const auto &issue : face.issues) {
            issues.push_back(json::value(issue));
          }
          return makeJsonResponse(
              http::status::bad_request,
              json::object{{"error", "face quality validation failed"},
                           {"provider", face.provider},
                           {"issues", issues}});
        }
        faceTemplate = std::move(face.faceTemplate);
        biometricProvider = face.provider;
      }

      AuthUser bestUser;
      double bestScore = -1.0;
      bool ok = false;
      {
        std::scoped_lock lk(gAuthMutex);
        if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
          std::string dbError;
          auto result =
              loginFacePg(gDatabaseUrl, company, faceTemplate, threshold, dbError);
          if (!result) {
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", dbError}});
          }
          bestUser = result->first;
          bestScore = result->second;
          ok = true;
#else
          return makeJsonResponse(
              http::status::internal_server_error,
              json::object{{"error", "postgres support is not compiled"}});
#endif
        } else {
          const auto users = loadAuthUsers(dataRoot);

          const AuthUser *best = nullptr;
          for (const auto &u : users) {
            if (u.company != company) {
              continue;
            }
            const auto score = cosineSimilarity(faceTemplate, u.faceTemplate);
            if (score > bestScore) {
              bestScore = score;
              best = &u;
            }
          }

          if (!best || bestScore < threshold) {
            appendAuthAuditLog(dataRoot, "login_face", company, "unknown",
                               false, "no_match");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{{"error", "face not recognized"}});
          }
          appendAuthAuditLog(dataRoot, "login_face", company, best->username,
                             true, "ok score=" + std::to_string(bestScore));
          bestUser = *best;
          ok = true;
        }
      }

      if (!ok) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "face not recognized"}});
      }

        const auto sessionToken = issueAuthSession(bestUser);

        return makeJsonResponse(
          http::status::ok,
          json::object{{"status", "authenticated"},
                       {"method", "face"},
                       {"biometric_provider", biometricProvider},
                       {"score", bestScore},
                       {"user", json::object{{"id", bestUser.id},
                                              {"company", bestUser.company},
                                              {"username", bestUser.username},
                                              {"role", bestUser.role},
                            {"token", sessionToken.token},
                                              {"full_name", bestUser.firstName +
                                                                " " +
                                                                bestUser.lastName}}}});
    } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", ex.what()}});
    }
  }

  if (req.method() == http::verb::get && pathOnly == "/api/auth/audit") {
    const auto session = resolveAuthSession(req, query);
    if (!session || session->role != "admin") {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "admin access required"}});
    }

    AuditFilter filter;
    size_t page = 1;
    size_t pageSize = 50;

    if (auto it = query.find("page"); it != query.end()) {
      try {
        page = std::max<size_t>(1, static_cast<size_t>(std::stoul(it->second)));
      } catch (...) {
        page = 1;
      }
    }
    if (auto it = query.find("page_size"); it != query.end()) {
      try {
        pageSize = std::clamp<size_t>(static_cast<size_t>(std::stoul(it->second)),
                                      1, 500);
      } catch (...) {
        pageSize = 50;
      }
    }
    if (auto it = query.find("limit"); it != query.end()) {
      try {
        pageSize = std::clamp<size_t>(static_cast<size_t>(std::stoul(it->second)),
                                      1, 500);
      } catch (...) {
        pageSize = 50;
      }
    }
    filter.limit = pageSize;
    filter.offset = (page - 1) * pageSize;

    if (auto it = query.find("company"); it != query.end() && !it->second.empty()) {
      filter.company = it->second;
    }
    if (auto it = query.find("username"); it != query.end() && !it->second.empty()) {
      filter.username = it->second;
    }
    if (auto it = query.find("action"); it != query.end() && !it->second.empty()) {
      filter.action = it->second;
    }
    if (auto it = query.find("success"); it != query.end() && !it->second.empty()) {
      if (it->second == "true" || it->second == "1") {
        filter.success = true;
      } else if (it->second == "false" || it->second == "0") {
        filter.success = false;
      }
    }

    AuditPageResult pageResult;
    if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      pageResult = readAuthAuditPg(gDatabaseUrl, filter);
#else
      pageResult = readAuthAuditTail(dataRoot, filter);
#endif
    } else {
      pageResult = readAuthAuditTail(dataRoot, filter);
    }

    const size_t pages = pageResult.limit == 0
                             ? 1
                             : static_cast<size_t>(
                                   std::max<size_t>(1, (pageResult.total + pageResult.limit - 1) /
                                                           pageResult.limit));

    return makeJsonResponse(
        http::status::ok,
        json::object{{"logs", pageResult.logs},
                     {"count", pageResult.logs.size()},
                     {"total", pageResult.total},
                     {"page", page},
                     {"page_size", pageResult.limit},
                     {"pages", pages}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/auth/audit/export.csv") {
    const auto session = resolveAuthSession(req, query);
    if (!session || session->role != "admin") {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "admin access required"}});
    }

    AuditFilter filter;
    filter.limit = 100000;
    filter.offset = 0;
    if (auto it = query.find("company"); it != query.end() && !it->second.empty()) {
      filter.company = it->second;
    }
    if (auto it = query.find("username"); it != query.end() && !it->second.empty()) {
      filter.username = it->second;
    }
    if (auto it = query.find("action"); it != query.end() && !it->second.empty()) {
      filter.action = it->second;
    }
    if (auto it = query.find("success"); it != query.end() && !it->second.empty()) {
      if (it->second == "true" || it->second == "1") {
        filter.success = true;
      } else if (it->second == "false" || it->second == "0") {
        filter.success = false;
      }
    }

    AuditPageResult pageResult;
    if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      pageResult = readAuthAuditPg(gDatabaseUrl, filter);
#else
      pageResult = readAuthAuditTail(dataRoot, filter);
#endif
    } else {
      pageResult = readAuthAuditTail(dataRoot, filter);
    }

    const std::string csv = auditRowsToCsv(pageResult.logs);
    return makeCsvResponse("auth_audit.csv", csv);
  }

  if (req.method() == http::verb::get && pathOnly == "/api/dashboard/metrics") {
    // ... existing dashboard metrics code ...
    json::object metrics;
    // (Preserving exact logic for brevity, but actually including the tail of that block)
    if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
      if (PQstatus(conn) == CONNECTION_OK) {
        PGresult *res_kpi = PQexec(conn, "SELECT name, value, unit, trend, trend_value FROM dashboard_kpis");
        json::object kpis;
        if (res_kpi && PQresultStatus(res_kpi) == PGRES_TUPLES_OK) {
            for (int i = 0; i < PQntuples(res_kpi); ++i) {
                std::string name = PQgetvalue(res_kpi, i, 0);
                kpis[name] = json::object{{"value", std::stod(PQgetvalue(res_kpi, i, 1))}, {"unit", PQgetvalue(res_kpi, i, 2)}, {"trend", PQgetvalue(res_kpi, i, 3)}, {"trend_value", std::stod(PQgetvalue(res_kpi, i, 4))}};
            }
        }
        if (res_kpi) PQclear(res_kpi);
        metrics["kpis"] = kpis;

        PGresult *res_heat = PQexec(conn, "SELECT day, level_name, x_coord, y_coord, intensity FROM dashboard_heatmap ORDER BY day ASC");
        json::array heatmap;
        if (res_heat && PQresultStatus(res_heat) == PGRES_TUPLES_OK) {
            for (int i = 0; i < PQntuples(res_heat); ++i) {
                heatmap.push_back(json::object{{"day", std::stoi(PQgetvalue(res_heat, i, 0))}, {"level", PQgetvalue(res_heat, i, 1)}, {"x", std::stoi(PQgetvalue(res_heat, i, 2))}, {"y", std::stoi(PQgetvalue(res_heat, i, 3))}, {"val", std::stod(PQgetvalue(res_heat, i, 4))}});
            }
        }
        if (res_heat) PQclear(res_heat);
        metrics["heatmap"] = heatmap;
        PQfinish(conn);
        return makeJsonResponse(http::status::ok, metrics);
      }
      PQfinish(conn);
#endif
    }
  }

  if (req.method() == http::verb::get && pathOnly == "/api/sensors/data") {
    json::object data;
    if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
      if (PQstatus(conn) == CONNECTION_OK) {
        // Fetch Categories
        PGresult *res_cat = PQexec(conn, "SELECT id, name, description FROM mining_sensor_categories ORDER BY id ASC");
        json::array categories;
        if (res_cat && PQresultStatus(res_cat) == PGRES_TUPLES_OK) {
          for (int i = 0; i < PQntuples(res_cat); ++i) {
            categories.push_back(json::object{{"id", std::stoi(PQgetvalue(res_cat, i, 0))}, {"name", PQgetvalue(res_cat, i, 1)}, {"description", PQgetvalue(res_cat, i, 2)}});
          }
        }
        if (res_cat) PQclear(res_cat);
        data["categories"] = categories;

        // Fetch Types
        PGresult *res_types = PQexec(conn, "SELECT id, category_id, name, unit FROM mining_sensor_types ORDER BY id ASC");
        json::array sensor_types;
        if (res_types && PQresultStatus(res_types) == PGRES_TUPLES_OK) {
          for (int i = 0; i < PQntuples(res_types); ++i) {
            sensor_types.push_back(json::object{{"id", std::stoi(PQgetvalue(res_types, i, 0))}, {"category_id", std::stoi(PQgetvalue(res_types, i, 1))}, {"name", PQgetvalue(res_types, i, 2)}, {"unit", PQgetvalue(res_types, i, 3)}});
          }
        }
        if (res_types) PQclear(res_types);
        data["sensor_types"] = sensor_types;

        // Fetch Sensors
        PGresult *res_sensors = PQexec(conn, "SELECT id, type_id, name, lat, lng, status, current_value FROM mining_sensors ORDER BY id ASC");
        json::array sensors;
        if (res_sensors && PQresultStatus(res_sensors) == PGRES_TUPLES_OK) {
          for (int i = 0; i < PQntuples(res_sensors); ++i) {
            sensors.push_back(json::object{
              {"id", std::stoi(PQgetvalue(res_sensors, i, 0))}, 
              {"type_id", std::stoi(PQgetvalue(res_sensors, i, 1))}, 
              {"name", PQgetvalue(res_sensors, i, 2)}, 
              {"lat", std::stod(PQgetvalue(res_sensors, i, 3))}, 
              {"lng", std::stod(PQgetvalue(res_sensors, i, 4))}, 
              {"status", PQgetvalue(res_sensors, i, 5)}, 
              {"current_value", std::stod(PQgetvalue(res_sensors, i, 6))}
            });
          }
        }
        if (res_sensors) PQclear(res_sensors);
        data["sensors"] = sensors;

        // Fetch History (last 48 points per sensor for charting)
        PGresult *res_history = PQexec(conn, "SELECT sensor_id, value, timestamp FROM mining_sensor_history WHERE timestamp > NOW() - INTERVAL '7 DAYS' ORDER BY sensor_id ASC, timestamp ASC");
        json::array history;
        if (res_history && PQresultStatus(res_history) == PGRES_TUPLES_OK) {
          for (int i = 0; i < PQntuples(res_history); ++i) {
            history.push_back(json::object{
              {"sensor_id", std::stoi(PQgetvalue(res_history, i, 0))}, 
              {"value", std::stod(PQgetvalue(res_history, i, 1))}, 
              {"timestamp", PQgetvalue(res_history, i, 2)}
            });
          }
        }
        if (res_history) PQclear(res_history);
        data["history"] = history;

        PQfinish(conn);
        return makeJsonResponse(http::status::ok, data);
      }
      PQfinish(conn);
#endif
    }
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/surveillance/cameras") {
    json::array cameras;
    if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
      if (PQstatus(conn) == CONNECTION_OK) {
        PGresult *res = PQexec(conn, "SELECT id, name, location, rtmp_url, status, lat, lng FROM surveillance_cameras ORDER BY id ASC");
        if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
          int rows = PQntuples(res);
          for (int i = 0; i < rows; ++i) {
            cameras.push_back(json::object{
              {"id", std::stoi(PQgetvalue(res, i, 0))},
              {"name", PQgetvalue(res, i, 1)},
              {"location", PQgetvalue(res, i, 2)},
              {"rtmp_url", PQgetvalue(res, i, 3)},
              {"status", PQgetvalue(res, i, 4)},
              {"lat", std::stod(PQgetvalue(res, i, 5))},
              {"lng", std::stod(PQgetvalue(res, i, 6))}
            });
          }
        }
        if (res) PQclear(res);
        PQfinish(conn);
        return makeJsonResponse(http::status::ok, json::object{{"cameras", cameras}});
      }
      PQfinish(conn);
#endif
    }
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/map/markers") {
    json::array markers;
    if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
      if (PQstatus(conn) == CONNECTION_OK) {
        PGresult *res = PQexec(conn, "SELECT id, type, lat, lng, name, status FROM map_markers");
        if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
          int rows = PQntuples(res);
          for (int i = 0; i < rows; ++i) {
            markers.push_back(json::object{
              {"id", std::stoi(PQgetvalue(res, i, 0))},
              {"type", PQgetvalue(res, i, 1)},
              {"lat", std::stod(PQgetvalue(res, i, 2))},
              {"lng", std::stod(PQgetvalue(res, i, 3))},
              {"name", PQgetvalue(res, i, 4)},
              {"status", PQgetvalue(res, i, 5)}
            });
          }
        }
        if (res) PQclear(res);
        PQfinish(conn);
        return makeJsonResponse(http::status::ok, json::object{{"markers", markers}});
      }
      PQfinish(conn);
#endif
    }
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  // --- NEW REPORT & PROJECT ROUTES ---

  if (req.method() == http::verb::get && pathOnly == "/api/projects") {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
    
    std::string error;
    auto projects = listProjectsPg(gDatabaseUrl, error);
    json::array arr;
    for (const auto &p : projects) {
        arr.push_back(json::object{{"id", p.id}, {"name", p.name}, {"description", p.description}});
    }
    return makeJsonResponse(http::status::ok, json::object{{"projects", arr}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/reports") {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

    std::string error;
    auto reports = listReportsPg(gDatabaseUrl, session->company, error);
    json::array arr;
    for (const auto &r : reports) {
        arr.push_back(json::object{
            {"id", r.id}, {"project_id", r.projectId}, {"title", r.title},
            {"status", r.status}, {"created_at", r.createdAt}, {"updated_at", r.updatedAt}
        });
    }
    return makeJsonResponse(http::status::ok, json::object{{"reports", arr}});
  }

  if (req.method() == http::verb::get && pathOnly.starts_with("/api/reports/")) {
    const auto session = resolveAuthSession(req, query);
    if (!session)
      return makeJsonResponse(http::status::unauthorized,
                              json::object{{"error", "unauthorized"}});
    std::string rest = pathOnly.substr(std::string("/api/reports/").size());
    if (!rest.empty() && rest.find('/') == std::string::npos) {
      std::string error;
      Report r;
      if (getReportByIdPg(gDatabaseUrl, rest, r, error)) {
        return makeJsonResponse(
            http::status::ok,
            json::object{{"id", r.id},
                         {"project_id",
                          r.projectId.empty() ? json::value(nullptr)
                                              : json::value(r.projectId)},
                         {"title", r.title},
                         {"content_json", r.contentJson},
                         {"status", r.status},
                         {"created_at", r.createdAt},
                         {"updated_at", r.updatedAt}});
      }
      return makeJsonResponse(http::status::not_found,
                              json::object{{"error", error}});
    }
  }

  if (req.method() == http::verb::post && pathOnly == "/api/reports") {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

    try {
        auto val = json::parse(req.body());
        const auto &obj = val.as_object();
        Report r;
        r.title = json::value_to<std::string>(obj.at("title"));
        r.projectId = obj.contains("project_id") && !obj.at("project_id").is_null() ? json::value_to<std::string>(obj.at("project_id")) : "";
        r.contentJson = obj.contains("content_json") ? obj.at("content_json") : json::object{};
        r.status = obj.contains("status") ? json::value_to<std::string>(obj.at("status")) : "draft";
        r.createdBy = session->username;
        r.company = session->company;

        std::string error;
        std::string newId;
        if (createReportPg(gDatabaseUrl, r, newId, error)) {
          return makeJsonResponse(http::status::created,
                                  json::object{{"status", "created"}, {"id", newId}});
        }
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
    }
  }

  if (req.method() == http::verb::put && pathOnly.starts_with("/api/reports/")) {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

    std::string id = pathOnly.substr(std::string("/api/reports/").size());
    try {
        auto val = json::parse(req.body());
        const auto &obj = val.as_object();
        Report r;
        r.title = json::value_to<std::string>(obj.at("title"));
        r.contentJson = obj.contains("content_json") ? obj.at("content_json") : json::object{};
        r.status = obj.contains("status") ? json::value_to<std::string>(obj.at("status")) : "draft";

        std::string error;
        if (updateReportPg(gDatabaseUrl, id, r, error)) {
            return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}});
        }
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
    }
  }

  if (req.method() == http::verb::delete_ && pathOnly.starts_with("/api/reports/")) {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

    std::string id = pathOnly.substr(std::string("/api/reports/").size());
    std::string error;
    if (deleteReportPg(gDatabaseUrl, id, error)) {
        return makeJsonResponse(http::status::ok, json::object{{"status", "deleted"}});
    }
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/auth/validate-company") {
    std::string company = query.count("company") ? query.at("company") : "";
    std::string ruc = query.count("ruc") ? query.at("ruc") : "";
    if (company.empty()) return makeJsonResponse(http::status::bad_request, json::object{{"error", "company is required"}});
    
    std::string error;
    bool valid = validateCompanyPg(gDatabaseUrl, company, ruc, error);
    return makeJsonResponse(http::status::ok, json::object{{"valid", valid}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/demo-data") {
    json::array assets;
    assets.push_back({{"id", "demo-1"},
                      {"type", "image"},
                      {"title", "Testigo T-45"},
                      {"url", "/data/incoming/test.jpg"}});
    assets.push_back({{"id", "demo-2"},
                      {"type", "video"},
                      {"title", "Análisis Fracturas"},
                      {"url", "/data/demo/fracture_analysis.mp4"}});
    assets.push_back({{"id", "demo-3"},
                      {"type", "3d_model"},
                      {"title", "Modelo Geomecánico"},
                      {"url", "/data/demo/drillhole_demo.glb"}});

    return makeJsonResponse(
        http::status::ok,
        json::object{{"status", "success"}, {"assets", assets}});
  }

    if (req.method() == http::verb::get &&
      pathOnly.starts_with("/api/demo-image")) {
    std::string path = dataRoot + "/incoming/test.jpg";
    if (!fs::exists(path)) {
      return makeJsonResponse(http::status::not_found,
                              json::object{{"error", "image not found"}});
    }

    std::ifstream ifs(path, std::ios::binary);
    std::string content((std::istreambuf_iterator<char>(ifs)),
                        (std::istreambuf_iterator<char>()));

    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "image/jpeg");
    res.set(http::field::access_control_allow_origin, "*");
    res.body() = std::move(content);
    res.prepare_payload();
    return res;
  }

  if (req.method() == http::verb::post && pathOnly == "/api/convert") {
    try {
      auto val = json::parse(req.body());
      if (!val.is_object()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid JSON body"}});
      }

      ConvertRequest cReq;
      std::string error;
      if (!parseConvertRequest(val.as_object(), cReq, error)) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", error}});
      }

      std::string id = makeId();
      Job job;
      job.id = id;
      job.status = "queued";
      job.createdAt = nowIso8601();
      job.updatedAt = job.createdAt;
      job.logs.push_back("Job accepted");

      {
        std::scoped_lock lk(gJobsMutex);
        gJobs[id] = job;
      }

      std::thread(runConversionJob, id, cReq, dataRoot).detach();

      return makeJsonResponse(
          http::status::accepted,
          json::object{{"job_id", id}, {"status", "queued"}});
    } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", ex.what()}});
    }
  }

  if (req.method() == http::verb::get && pathOnly.starts_with("/api/jobs/")) {
    std::string id = pathOnly.substr(std::string("/api/jobs/").size());
    if (id.empty()) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "missing job id"}});
    }
    auto job = getJob(id);
    if (!job) {
      return makeJsonResponse(http::status::not_found,
                              json::object{{"error", "job not found"}});
    }
    return makeJsonResponse(http::status::ok, jobToJson(*job));
  }

  if (req.method() == http::verb::post && pathOnly == "/api/analyze-core") {
    try {
      auto val = json::parse(req.body());
      if (!val.is_object() || !val.as_object().contains("image_path")) {
        return makeJsonResponse(
            http::status::bad_request,
            json::object{{"error", "image_path is required"}});
      }

      std::string imgPath = json::value_to<std::string>(val.at("image_path"));
      auto result = mining::VisionPipeline::processDrillholeImage(imgPath);

      if (!result.success) {
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", result.message}});
      }

      return makeJsonResponse(
          http::status::ok,
          json::object{{"status", "success"},
                       {"fractures_detected", result.fractures_detected},
                       {"rqd", result.rqd_percentage},
                       {"message", result.message}});

    } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", ex.what()}});
    }
  }

  return makeJsonResponse(http::status::not_found,
                          json::object{{"error", "route not found"}});
}

void session(beast::tcp_stream stream, const std::string &dataRoot) {
  beast::flat_buffer buffer;
  beast::error_code ec;

  http::request<http::string_body> req;
  http::read(stream, buffer, req, ec);
  if (ec)
    return;

  // Check if it's a websocket upgrade
  if (websocket::is_upgrade(req)) {
    std::make_shared<WebSocketSession>(stream.release_socket())->run();
    return;
  }

  auto res = routeRequest(req, dataRoot);
  http::write(stream, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_send, ec);
}

int main() {
  try {
    const std::string address = getenvOr("MAPAS_BIND_ADDRESS", "0.0.0.0");
    const int port = std::stoi(getenvOr("MAPAS_PORT", "8081"));
    const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");
    gDatabaseUrl = getenvOr("DATABASE_URL", "");
    gSessionTtlMinutes =
      std::max(15, std::stoi(getenvOr("AUTH_SESSION_TTL_MINUTES", "480")));

    const auto provider = toLowerCopy(getenvOr("BIOMETRIC_PROVIDER", "legacy"));
    gBiometricProvider =
      provider == "dermalog_cli" ? BiometricProvider::DermalogCli
                    : BiometricProvider::Legacy;
    gDermalogCliPath = getenvOr("DERMALOG_CLI_PATH", "");
    gDermalogRequired =
      toLowerCopy(getenvOr("DERMALOG_REQUIRED", "false")) == "true";
    gBiometricDnnModelPath = getenvOr("BIOMETRIC_DNN_MODEL", "");
    gBiometricDnnLabelsCsv = getenvOr(
        "BIOMETRIC_DNN_LABELS",
        "glasses,hat,mask,makeup,eyes_closed,mouth_open,non_frontal");
    gBiometricDnnEnabled =
        toLowerCopy(getenvOr("BIOMETRIC_DNN_ENABLE", "false")) == "true";
    gAiEngineUrl = getenvOr("AI_ENGINE_URL", "");
    try {
      gAiEngineTimeoutMs = std::clamp(
          std::stoi(getenvOr("AI_ENGINE_TIMEOUT_MS", "120")), 50, 500);
    } catch (...) {
      gAiEngineTimeoutMs = 120;
    }
    try {
      gAiEngineMaxImageBytes = static_cast<std::size_t>(std::clamp(
          std::stoi(getenvOr("AI_ENGINE_MAX_IMAGE_BYTES", "450000")), 100000,
          2000000));
    } catch (...) {
      gAiEngineMaxImageBytes = 450000;
    }
    try {
      gBiometricIcaoEyeConfidenceMin = static_cast<float>(std::clamp(
          std::stod(getenvOr("BIOMETRIC_ICAO_EYE_CONFIDENCE_MIN", "95")), 50.0,
          100.0));
    } catch (...) {
      gBiometricIcaoEyeConfidenceMin = 95.0f;
    }
    try {
      gBiometricIcaoIlluminationMin = static_cast<float>(std::clamp(
          std::stod(getenvOr("BIOMETRIC_ICAO_ILLUMINATION_MIN", "40")), 5.0,
          80.0));
    } catch (...) {
      gBiometricIcaoIlluminationMin = 40.0f;
    }
    gImageOptimizerEnabled =
        toLowerCopy(getenvOr("BIOMETRIC_IMAGE_OPTIMIZER_ENABLE", "false")) ==
        "true";
    try {
      gBiometricMaxPixels = std::clamp(
          std::stoi(getenvOr("BIOMETRIC_MAX_PIXELS", "921600")), 120000,
          3000000);
    } catch (...) {
      gBiometricMaxPixels = 921600;
    }
    try {
      gBiometricDnnThreshold = std::clamp(
          std::stof(getenvOr("BIOMETRIC_DNN_THRESHOLD", "0.72")), 0.3f,
          0.95f);
    } catch (...) {
      gBiometricDnnThreshold = 0.72f;
    }

    if (!gDatabaseUrl.empty()) {
#if HAS_LIBPQ
      gAuthStorageMode = AuthStorageMode::Postgres;
#else
      gAuthStorageMode = AuthStorageMode::File;
#endif
    } else {
      gAuthStorageMode = AuthStorageMode::File;
    }

    asio::io_context ioc{1};
    asio::ip::tcp::acceptor acceptor{
        ioc,
        {asio::ip::make_address(address), static_cast<unsigned short>(port)}};

    std::cout << "mapas_backend listening on " << address << ":" << port
              << std::endl;
    std::cout << "auth storage mode: "
          << (gAuthStorageMode == AuthStorageMode::Postgres ? "postgres"
                                  : "file")
          << std::endl;
        std::cout << "biometric provider: "
            << (gBiometricProvider == BiometricProvider::DermalogCli
              ? "dermalog_cli"
              : "legacy")
            << ", dermalog required: "
            << (gDermalogRequired ? "true" : "false") << std::endl;
    auto &dnnCtx = getAccessoryDnnContext();
    std::cout << "biometric dnn: "
              << (gBiometricDnnEnabled ? "enabled" : "disabled")
              << ", model path: "
              << (gBiometricDnnModelPath.empty() ? "(none)"
                                                 : gBiometricDnnModelPath)
              << ", threshold: " << gBiometricDnnThreshold
              << ", loaded: " << (dnnCtx.loaded ? "true" : "false");
    if (!dnnCtx.initError.empty()) {
      std::cout << ", init_error: " << dnnCtx.initError;
    }
    std::cout << std::endl;
    std::cout << "ai_engine_url: "
              << (gAiEngineUrl.empty() ? "(disabled)" : gAiEngineUrl)
              << ", timeout_ms: " << gAiEngineTimeoutMs
              << ", max_image_bytes: " << gAiEngineMaxImageBytes
              << ", image_optimizer: "
              << (gImageOptimizerEnabled ? "enabled" : "disabled")
              << ", max_pixels: " << gBiometricMaxPixels << std::endl;

    // Start Mining Gateway (Secondary Listener)
    std::thread([]() {
        try {
            std::cout << "[MINING-GATEWAY] Thread starting..." << std::endl;
            asio::io_context mining_ioc;
            MiningConfig cfg;
            cfg.bind_address = "0.0.0.0";
            cfg.port = static_cast<unsigned short>(std::stoi(getenvOr("MINING_GATEWAY_PORT", "8443")));
            cfg.cert_path = getenvOr("TLS_CERT_PATH", "/etc/mining-gateway/certs/server.crt");
            cfg.key_path = getenvOr("TLS_KEY_PATH", "/etc/mining-gateway/certs/server.key");
            
            std::cout << "[MINING-GATEWAY] Initializing on " << cfg.bind_address << ":" << cfg.port << " with cert " << cfg.cert_path << std::endl;
            MiningServer server(mining_ioc, cfg);
            server.run();
            std::cout << "[MINING-GATEWAY] Running..." << std::endl;
            mining_ioc.run();
        } catch (const std::exception& e) {
            std::cerr << "[MINING-GATEWAY] Fatal: " << e.what() << std::endl;
        }
    }).detach();

    for (;;) {
      asio::ip::tcp::socket socket{ioc};
      acceptor.accept(socket);
      std::thread(session, beast::tcp_stream(std::move(socket)), dataRoot)
          .detach();
    }
  } catch (const std::exception &ex) {
    std::cerr << "Fatal error: " << ex.what() << std::endl;
    return 1;
  }
}
