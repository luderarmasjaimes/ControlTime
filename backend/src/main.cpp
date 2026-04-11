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

#include "onnx_cartoon.hpp"
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
#include <future>
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
  /** PNG/JPEG en base64 (sin prefijo data:), generado en registro desde recorte óvalo. */
  std::string avatarCartoonBase64;
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
    "Activos Mineros",
    "Alpayana",
    "Anglo American Quellaveco",
    "Ares",
    "Bear Creek Mining",
    "Buenaventura",
    "Catalina Huanca",
    "Chinalco Peru",
    "Compania Minera Antamina",
    "Compania Minera Ares",
    "Compania Minera Poderosa",
    "Compania Minera Raura",
    "Compania Minera San Ignacio de Morococha",
    "Compania Minera Volcan",
    "Consorcio Minero Horizonte",
    "DOE Run Peru",
    "Dynacor",
    "El Brocal",
    "Gold Fields La Cima",
    "Hochschild Mining Peru",
    "Hudbay Peru",
    "Jinzhao Mining Peru",
    "Las Bambas",
    "Marcobre",
    "Minsur",
    "Minera Antamina",
    "Minera Antapaccay",
    "Minera Bateas",
    "Minera Boroo Misquichilca",
    "Minera Caraveli",
    "Minera Cerro Verde",
    "Minera Condestable",
    "Minera Corona",
    "Minera IRL",
    "Minera Los Quenuales",
    "Minera Poderosa",
    "Minera Raura",
    "Nexa Resources Peru",
    "Pan American Silver Peru",
    "Sierra Metals Yauricocha",
    "Shougang Hierro Peru",
    "Sociedad Minera El Brocal",
    "Southern Peru Copper Corporation",
    "Summa Gold",
    "Yanacocha"};

std::string getenvOr(const char *key, const std::string &fallback);
std::string makeId();
void pushIssueUnique(std::vector<std::string> &issues,
                     const std::string &issue);

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
int gAiEngineTimeoutMs = 500;
/** Timeout dedicado para /cartoon_avatar (OpenCV puede tardar más que analyze/embedding). */
int gAiEngineCartoonTimeoutMs = 8000;
std::size_t gAiEngineMaxImageBytes = 450000;
/** Modelo ONNX local (AnimeGANv2, etc.); si existe y el binario enlazó ORT, prevalece sobre ai_engine. */
std::string gCartoonOnnxModelPath;
/** Dimensión del vector InsightFace (buffalo_l); login/registro ONNX embedding. */
static constexpr std::size_t kFaceEmbeddingVectorDim = 512;
double gFaceEmbeddingCosineThreshold = 0.45;
/** Umbral coseno plantilla legacy (24×24); no debe mezclarse con el de embedding. */
double gFaceLegacyCosineThreshold = 0.82;
float gBiometricIcaoEyeConfidenceMin = 70.0f;
float gBiometricIcaoIlluminationMin = 40.0f;
bool gImageOptimizerEnabled = false;
int gBiometricMaxPixels = 1280 * 720;
int gSessionTtlMinutes = 480;
std::atomic<bool> gAuthSchemaReady{false};
std::mutex gAuthSchemaInitMutex;
std::atomic<bool> gFormulaSchemaReady{false};
std::mutex gFormulaSchemaInitMutex;

struct FaceAnalysis {
  bool ok = false;
  std::vector<double> faceTemplate;
  std::vector<std::string> issues;
  double qualityScore = 0.0;
  std::string provider = "legacy";
};

FaceAnalysis analyzeFaceImage(const std::string &base64Image,
                              const std::string &mode);

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

std::string encodeBase64(const std::vector<unsigned char> &input) {
  static const char table[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((input.size() + 2) / 3) * 4);
  for (size_t i = 0; i < input.size(); i += 3) {
    const unsigned int b0 = input[i];
    const unsigned int b1 = (i + 1 < input.size()) ? input[i + 1] : 0;
    const unsigned int b2 = (i + 2 < input.size()) ? input[i + 2] : 0;
    const unsigned int tri = (b0 << 16) | (b1 << 8) | b2;
    out.push_back(table[(tri >> 18) & 0x3F]);
    out.push_back(table[(tri >> 12) & 0x3F]);
    out.push_back((i + 1 < input.size()) ? table[(tri >> 6) & 0x3F] : '=');
    out.push_back((i + 2 < input.size()) ? table[tri & 0x3F] : '=');
  }
  return out;
}

static std::string stripDataUrlBase64(const std::string &in) {
  const auto pos = in.find("base64,");
  if (pos != std::string::npos) {
    return in.substr(pos + 7);
  }
  return in;
}

struct BiometricCaptureRuntimeState {
  int state = 1; // 1=starting, 4=liveness, 7=captured
  int captureCount = 0;
  /** Frames ICAO inválidos seguidos antes de resetear muestras (evita 0/3 por un solo fallo). */
  int captureInvalidStreak = 0;
  bool eyesOpen = false;
  bool mouthClosed = false;
  bool faceStraight = false;
  bool noGlasses = false;
  bool detected = false;
  bool hasFaceOval = false;
  double faceOvalCx = 0.0;
  double faceOvalCy = 0.0;
  double faceOvalW = 0.0;
  double faceOvalH = 0.0;
  double faceOvalAngleDeg = 0.0;
  double livenessScore = 0.0;
  std::string stateName = "Estado actual: INICIANDO";
  std::chrono::steady_clock::time_point updatedAt = std::chrono::steady_clock::now();
};

std::mutex gBiometricCaptureMutex;
BiometricCaptureRuntimeState gBiometricCaptureState;
std::vector<std::string> gBiometricCapturedImages; // data:image/jpeg;base64,...

struct LegacyFacialUserRecord {
  std::string id;
  std::string name;
  std::int64_t timestamp = 0;
  double confidence = 0.0;
};

static std::string captureStateLabel(int state) {
  switch (state) {
  case 7:
    return "Estado actual: CAPTURADO";
  case 4:
    return "Estado actual: EVALUANDO LIVENESS";
  case 2:
    return "Estado actual: ROSTRO DETECTADO";
  default:
    return "Estado actual: INICIANDO";
  }
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
  /** MediaPipe / analyze_eyes: nariz vs eje interocular (sustituye Haar+simetría para ICAO). */
  bool hasFaceFrontal = false;
  bool faceFrontal = true;
  /** Señal CV cruda 0–100 desde ai_engine (sin EMA). */
  double glassesCvScore = 0.0;
  /** Tras EMA en C++ (o cruda si sin sesión). */
  double glassesScore = 0.0;
  double leftEar = 0.0;
  double rightEar = 0.0;
  bool hasEarMetrics = false;
  /** ai_engine eye_analyzer: confidence 0..1 (MediaPipe EAR + blink). */
  bool hasAiEyeConfidence = false;
  double aiEyeConfidence01 = 0.0;
  bool hasFaceOvalPoints = false;
  std::vector<cv::Point2f> faceOvalPoints;
  bool hasFaceOvalEllipse = false;
  cv::RotatedRect faceOvalEllipse;
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
    const bool hasOvalField =
        obj.if_contains("face_oval_points") && obj.at("face_oval_points").is_array();
    if (hasOvalField) {
      std::cerr << "[AI_OVAL] face_oval_points raw size="
                << obj.at("face_oval_points").as_array().size() << std::endl;
    } else {
      std::cerr << "[AI_OVAL] face_oval_points missing in ai payload" << std::endl;
    }
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
    // Prioridad EMA: fusión CV+ONNX → glasses_score (alias de fusión) → CV
    if (obj.if_contains("glasses_fusion_score") &&
        (obj.at("glasses_fusion_score").is_double() ||
         obj.at("glasses_fusion_score").is_int64())) {
      rawGlasses = obj.at("glasses_fusion_score").is_double()
                       ? obj.at("glasses_fusion_score").as_double()
                       : static_cast<double>(obj.at("glasses_fusion_score").as_int64());
    } else if (obj.if_contains("glasses_score") &&
               (obj.at("glasses_score").is_double() ||
                obj.at("glasses_score").is_int64())) {
      rawGlasses = obj.at("glasses_score").is_double()
                       ? obj.at("glasses_score").as_double()
                       : static_cast<double>(obj.at("glasses_score").as_int64());
    } else if (obj.if_contains("glasses_cv_score") &&
               (obj.at("glasses_cv_score").is_double() ||
                obj.at("glasses_cv_score").is_int64())) {
      rawGlasses = obj.at("glasses_cv_score").is_double()
                       ? obj.at("glasses_cv_score").as_double()
                       : static_cast<double>(obj.at("glasses_cv_score").as_int64());
    }
    out.glassesCvScore = rawGlasses;
    if (obj.if_contains("glasses_cv_score") &&
        (obj.at("glasses_cv_score").is_double() ||
         obj.at("glasses_cv_score").is_int64())) {
      out.glassesCvScore = obj.at("glasses_cv_score").is_double()
                               ? obj.at("glasses_cv_score").as_double()
                               : static_cast<double>(obj.at("glasses_cv_score").as_int64());
    }

    const bool aiNoGlassesHint =
        obj.if_contains("no_glasses") && obj.at("no_glasses").is_bool();

    if (glassesSessionKey.has_value() && !glassesSessionKey->empty()) {
      std::scoped_lock lk(gGlassesEmaMutex);
      GlassesEmaState &st = gGlassesEmaBySession[*glassesSessionKey];
      double emaOut = 0.0;
      // Una sola pasada de EMA; si el motor Python (FACIAL) envía no_glasses con cara
      // detectada, esa histéresis manda sobre el umbral fijo del EMA.
      out.noGlasses =
          applyIcaoGlassesEma(st, rawGlasses, out.detected, emaOut);
      out.glassesScore = emaOut;
      if (aiNoGlassesHint && out.detected) {
        out.noGlasses = obj.at("no_glasses").as_bool();
      }
    } else {
      out.glassesScore = rawGlasses;
      if (aiNoGlassesHint && out.detected) {
        out.noGlasses = obj.at("no_glasses").as_bool();
      } else {
        // Sin token: decisión de un solo frame (banda entre 52 y 66).
        out.noGlasses = rawGlasses < 59.0;
      }
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
    if (obj.if_contains("confidence") &&
        (obj.at("confidence").is_double() || obj.at("confidence").is_int64())) {
      out.hasAiEyeConfidence = true;
      out.aiEyeConfidence01 =
          obj.at("confidence").is_double()
              ? obj.at("confidence").as_double()
              : static_cast<double>(obj.at("confidence").as_int64());
    }
    if (obj.if_contains("face_frontal") && obj.at("face_frontal").is_bool()) {
      out.hasFaceFrontal = true;
      out.faceFrontal = obj.at("face_frontal").as_bool();
    }
    if (obj.if_contains("face_oval_points") && obj.at("face_oval_points").is_array()) {
      const auto &arr = obj.at("face_oval_points").as_array();
      out.faceOvalPoints.reserve(arr.size());
      for (const auto &v : arr) {
        if (!v.is_array()) {
          continue;
        }
        const auto &pt = v.as_array();
        if (pt.size() < 2) {
          continue;
        }
        if (!((pt[0].is_double() || pt[0].is_int64()) &&
              (pt[1].is_double() || pt[1].is_int64()))) {
          continue;
        }
        const float x = static_cast<float>(
            pt[0].is_double() ? pt[0].as_double() : static_cast<double>(pt[0].as_int64()));
        const float y = static_cast<float>(
            pt[1].is_double() ? pt[1].as_double() : static_cast<double>(pt[1].as_int64()));
        out.faceOvalPoints.emplace_back(x, y);
      }
      out.hasFaceOvalPoints = out.faceOvalPoints.size() >= 5;
      std::cerr << "[AI_OVAL] parsed points=" << out.faceOvalPoints.size() << std::endl;
      if (!out.faceOvalPoints.empty()) {
        float minX = out.faceOvalPoints[0].x;
        float maxX = out.faceOvalPoints[0].x;
        float minY = out.faceOvalPoints[0].y;
        float maxY = out.faceOvalPoints[0].y;
        for (const auto &p : out.faceOvalPoints) {
          minX = std::min(minX, p.x);
          maxX = std::max(maxX, p.x);
          minY = std::min(minY, p.y);
          maxY = std::max(maxY, p.y);
        }
        std::cerr << "[AI_OVAL] pts bbox min=(" << minX << "," << minY
                  << ") max=(" << maxX << "," << maxY << ")" << std::endl;
      }
      if (out.hasFaceOvalPoints) {
        try {
          out.faceOvalEllipse = cv::fitEllipse(out.faceOvalPoints);
          out.hasFaceOvalEllipse = true;
          std::cerr << "[AI_OVAL] fitEllipse ok" << std::endl;
          std::cerr << "[AI_OVAL] ellipse cx=" << out.faceOvalEllipse.center.x
                    << " cy=" << out.faceOvalEllipse.center.y
                    << " w=" << out.faceOvalEllipse.size.width
                    << " h=" << out.faceOvalEllipse.size.height
                    << " ang=" << out.faceOvalEllipse.angle << std::endl;
        } catch (...) {
          out.hasFaceOvalEllipse = false;
          std::cerr << "[AI_OVAL] fitEllipse failed" << std::endl;
        }
      }
    }
    return out;
  } catch (...) {
    AiEngineFrameResult fail;
    fail.error = "ai_engine_parse_failed";
    return fail;
  }
}

struct AiEngineEmbeddingResult {
  std::vector<double> embedding;
  std::string error;
  bool ok() const { return embedding.size() == kFaceEmbeddingVectorDim && error.empty(); }
};

static AiEngineEmbeddingResult
fetchFaceEmbeddingFromAiEngine(const std::vector<unsigned char> &imageBytes) {
  AiEngineEmbeddingResult out;
  if (gAiEngineUrl.empty()) {
    out.error = "ai_engine_disabled";
    return out;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    out.error = "ai_engine_skipped_size_limit";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/face_embedding", endpoint)) {
    out.error = "ai_engine_invalid_url";
    return out;
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
    out.error = "ai_engine_resolve_failed";
    return out;
  }

  stream.connect(results, ec);
  if (ec) {
    out.error = "ai_engine_connect_failed";
    return out;
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
    out.error = "ai_engine_write_failed";
    return out;
  }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);

  if (ec) {
    out.error = "ai_engine_read_failed";
    return out;
  }
  if (res.result() != http::status::ok) {
    out.error = "ai_engine_http_not_ok";
    return out;
  }

  try {
    auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      out.error = "ai_engine_invalid_json";
      return out;
    }
    const auto &obj = payload.as_object();
    if (obj.if_contains("ok") && obj.at("ok").is_bool() && !obj.at("ok").as_bool()) {
      if (obj.if_contains("error") && obj.at("error").is_string()) {
        out.error = json::value_to<std::string>(obj.at("error"));
      } else {
        out.error = "face_embedding_failed";
      }
      return out;
    }
    if (!obj.if_contains("embedding") || !obj.at("embedding").is_array()) {
      out.error = "ai_engine_no_embedding";
      return out;
    }
    for (const auto &v : obj.at("embedding").as_array()) {
      if (v.is_double()) {
        out.embedding.push_back(v.as_double());
      } else if (v.is_int64()) {
        out.embedding.push_back(static_cast<double>(v.as_int64()));
      }
    }
    if (out.embedding.size() != kFaceEmbeddingVectorDim) {
      out.embedding.clear();
      out.error = "embedding_dim_mismatch";
      return out;
    }
    return out;
  } catch (...) {
    out.error = "ai_engine_parse_failed";
    return out;
  }
}

struct AiEngineCartoonResult {
  std::string imageBase64;
  std::string error;
  bool ok() const { return !imageBase64.empty() && error.empty(); }
};

static AiEngineCartoonResult
fetchCartoonAvatarFromAiEngine(const std::vector<unsigned char> &imageBytes) {
  AiEngineCartoonResult out;
  if (gAiEngineUrl.empty()) {
    out.error = "ai_engine_disabled";
    return out;
  }
  if (imageBytes.empty() || imageBytes.size() > gAiEngineMaxImageBytes) {
    out.error = "ai_engine_skipped_size_limit";
    return out;
  }

  ParsedHttpEndpoint endpoint;
  if (!parseHttpEndpoint(gAiEngineUrl + "/cartoon_avatar", endpoint)) {
    out.error = "ai_engine_invalid_url";
    return out;
  }

  std::string boundary = "----InformeBoundary" + makeId();
  std::string body;
  body.reserve(imageBytes.size() + 256);
  body += "--" + boundary + "\r\n";
  body +=
      "Content-Disposition: form-data; name=\"image\"; filename=\"portrait.jpg\"\r\n";
  body += "Content-Type: image/jpeg\r\n\r\n";
  body.append(reinterpret_cast<const char *>(imageBytes.data()),
              static_cast<std::streamsize>(imageBytes.size()));
  body += "\r\n--" + boundary + "--\r\n";

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(
      std::chrono::milliseconds(gAiEngineCartoonTimeoutMs));

  auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) {
    out.error = "ai_engine_resolve_failed";
    return out;
  }

  stream.connect(results, ec);
  if (ec) {
    out.error = "ai_engine_connect_failed";
    return out;
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
    out.error = "ai_engine_write_failed";
    return out;
  }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);

  if (ec) {
    out.error = "ai_engine_read_failed";
    return out;
  }
  if (res.result() != http::status::ok) {
    out.error = "ai_engine_http_not_ok";
    return out;
  }

  try {
    auto payload = json::parse(res.body());
    if (!payload.is_object()) {
      out.error = "ai_engine_invalid_json";
      return out;
    }
    const auto &obj = payload.as_object();
    if (obj.if_contains("ok") && obj.at("ok").is_bool() && !obj.at("ok").as_bool()) {
      if (obj.if_contains("error") && obj.at("error").is_string()) {
        out.error = json::value_to<std::string>(obj.at("error"));
      } else {
        out.error = "cartoon_avatar_failed";
      }
      return out;
    }
    if (!obj.if_contains("image_base64") ||
        !obj.at("image_base64").is_string()) {
      out.error = "ai_engine_no_image";
      return out;
    }
    out.imageBase64 = json::value_to<std::string>(obj.at("image_base64"));
    return out;
  } catch (...) {
    out.error = "ai_engine_parse_failed";
    return out;
  }
}

static AiEngineCartoonResult
fetchCartoonAvatarBestEffort(const std::vector<unsigned char> &imageBytes) {
  AiEngineCartoonResult out;
  if (informeCartoonOnnxRuntimeLinked() && !gCartoonOnnxModelPath.empty() &&
      fs::exists(gCartoonOnnxModelPath)) {
    std::string b64;
    std::string err;
    if (informeCartoonOnnxFromImageBytes(imageBytes, gCartoonOnnxModelPath, b64,
                                         err) &&
        !b64.empty()) {
      out.imageBase64 = std::move(b64);
      return out;
    }
  }
  return fetchCartoonAvatarFromAiEngine(imageBytes);
}

struct BiometricVerifyEval {
  bool ok = false;
  FaceAnalysis face;
  std::optional<AiEngineFrameResult> aiEval;
};

static void applyAiFrontalToFaceIssues(FaceAnalysis &face,
                                       const AiEngineFrameResult &ai) {
  if (!ai.available || !ai.detected || !ai.hasFaceFrontal) {
    return;
  }
  auto &iss = face.issues;
  iss.erase(std::remove(iss.begin(), iss.end(), "face_not_frontal"),
            iss.end());
  iss.erase(std::remove(iss.begin(), iss.end(), "head_pose_not_straight"),
            iss.end());
  if (!ai.faceFrontal) {
    pushIssueUnique(iss, "face_not_frontal");
  }
}

/**
 * El pipeline legacy (Haar + heurísticas OpenCV) suele dejar issues aunque MediaPipe/ai_engine
 * ya haya validado ojos/boca/lentes/frontal. Eso dejaba eval.ok=false y el contador 0/3 fijo
 * mientras la UI mostraba ICAO OK (estado tomado de la IA).
 */
static void stripLegacyIssuesWhenAiIcaoPasses(FaceAnalysis &face,
                                              const AiEngineFrameResult &ai) {
  if (!ai.available || !ai.detected || !ai.bothOpen || !ai.mouthClosed ||
      !ai.noGlasses) {
    return;
  }
  if (ai.hasFaceFrontal && !ai.faceFrontal) {
    return;
  }
  static const char *kLegacyStripCore[] = {
      "face_not_detected",
      "face_detector_unavailable",
      "eyes_not_open_or_not_visible",
      "mouth_not_closed",
      "suspected_glasses",
      "image_not_sharp",
      "lighting_out_of_range",
      "low_dynamic_range",
      "face_too_small",
      "face_off_center",
      "suspected_hat",
      "suspected_face_accessory",
      "suspected_heavy_makeup",
      "dnn_inference_failed",
  };
  static const char *kLegacyStripFrontal[] = {
      "face_not_frontal",
      "head_pose_not_straight",
  };
  auto &iss = face.issues;
  for (const char *tag : kLegacyStripCore) {
    const std::string s(tag);
    iss.erase(std::remove(iss.begin(), iss.end(), s), iss.end());
  }
  if (ai.hasFaceFrontal && ai.faceFrontal) {
    for (const char *tag : kLegacyStripFrontal) {
      const std::string s(tag);
      iss.erase(std::remove(iss.begin(), iss.end(), s), iss.end());
    }
  }
}

/**
 * Login con face_image_base64 usa analyzeFaceImage("verify"), que falla si el Haar de OpenCV
 * no está cargado o no ve el rostro (típico en contenedores), aunque el ai_engine sí valide
 * ICAO. Aquí se recupera: primero con IA (misma lógica que captura), si no con plantilla de
 * marco completo cuando los únicos issues son detector Haar.
 */
static bool trySalvageFaceLoginQuality(FaceAnalysis &face,
                                       const std::string &base64Image) {
  if (face.ok || face.faceTemplate.empty()) {
    return false;
  }
  if (!gAiEngineUrl.empty()) {
    std::vector<unsigned char> raw;
    if (decodeBase64(base64Image, raw) && !raw.empty()) {
      auto ai = analyzeFrameWithAiEngine(raw, std::nullopt);
      if (ai.has_value() && ai->available && ai->error.empty() &&
          ai->detected && ai->bothOpen && ai->mouthClosed && ai->noGlasses &&
          (!ai->hasFaceFrontal || ai->faceFrontal)) {
        if (ai->hasAiEyeConfidence && ai->detected && ai->bothOpen) {
          const float eyeConfPct = static_cast<float>(
              std::clamp(ai->aiEyeConfidence01 * 100.0, 0.0, 100.0));
          if (eyeConfPct < gBiometricIcaoEyeConfidenceMin) {
            return false;
          }
        }
        face.ok = true;
        face.issues.clear();
        face.provider = "mediapipe_ia";
        return true;
      }
    }
  }
  for (const auto &s : face.issues) {
    if (s != "face_not_detected" && s != "face_detector_unavailable") {
      return false;
    }
  }
  if (face.issues.empty()) {
    return false;
  }
  face.ok = true;
  face.issues.clear();
  face.provider =
      face.provider == "legacy" ? "legacy_fullframe" : face.provider;
  return true;
}

/**
 * Construye el vector de comparación para login: embedding ONNX (512) si el registro lo usa,
 * si no plantilla legacy desde imagen.
 */
static bool buildFaceLoginProbe(const std::vector<double> &clientProbeTemplate,
                                const std::optional<std::vector<unsigned char>> &rawImageBytes,
                                const std::optional<std::string> &base64ForLegacy,
                                const std::vector<double> &storedTemplate,
                                std::vector<double> &outProbe, std::string &outProvider,
                                double &outThreshold, double legacyThreshold,
                                double embeddingThreshold, std::string &error) {
  const bool storedIsEmbedding =
      (storedTemplate.size() == kFaceEmbeddingVectorDim);
  outThreshold = storedIsEmbedding ? embeddingThreshold : legacyThreshold;

  if (!clientProbeTemplate.empty()) {
    if (clientProbeTemplate.size() != storedTemplate.size()) {
      error =
          "La plantilla enviada no coincide con el tipo biométrico registrado "
          "para este usuario (embedding vs clásico).";
      return false;
    }
    outProbe = clientProbeTemplate;
    outProvider = storedIsEmbedding ? "client_embedding" : "client_legacy";
    return true;
  }

  if (!rawImageBytes.has_value() || rawImageBytes->empty()) {
    error = "No se recibió imagen para validar el rostro.";
    return false;
  }

  if (storedIsEmbedding) {
    auto em = fetchFaceEmbeddingFromAiEngine(*rawImageBytes);
    if (!em.ok()) {
      error =
          "No se pudo extraer el embedding facial de alta seguridad "
          "(InsightFace/ONNX). Compruebe cámara, iluminación y que el "
          "servicio ai_engine esté actualizado. Código: " +
          (em.error.empty() ? "unknown" : em.error);
      return false;
    }
    outProbe = std::move(em.embedding);
    outProvider = "insightface_onnx";
    return true;
  }

  if (!base64ForLegacy.has_value() || base64ForLegacy->empty()) {
    error = "Fallo interno al preparar la imagen para biometría clásica.";
    return false;
  }
  FaceAnalysis face = analyzeFaceImage(*base64ForLegacy, "verify");
  trySalvageFaceLoginQuality(face, *base64ForLegacy);
  if (!face.ok || face.faceTemplate.empty()) {
    error =
        "No se pudo validar la calidad de la imagen facial (modo clásico). "
        "Intente de nuevo.";
    return false;
  }
  outProbe = std::move(face.faceTemplate);
  outProvider = face.provider;
  return true;
}

static BiometricVerifyEval runBiometricVerifyForImageBase64(
    const std::string &base64,
    const std::optional<std::string> &glassesEmaKey = std::nullopt) {
  BiometricVerifyEval eval;
  eval.face = analyzeFaceImage(base64, "verify");
  eval.ok = eval.face.ok;

  std::vector<unsigned char> frameRaw;
  const bool decoded = decodeBase64(base64, frameRaw);
  if (decoded && !frameRaw.empty()) {
    cv::Mat bgr = cv::imdecode(frameRaw, cv::IMREAD_COLOR);
    if (!bgr.empty()) {
      const float illumPct = icaoFullFrameIlluminationPercent(bgr);
      if (illumPct < gBiometricIcaoIlluminationMin) {
        pushIssueUnique(eval.face.issues, "lighting_insufficient_icao");
        eval.ok = false;
      }
    }
    eval.aiEval = analyzeFrameWithAiEngine(frameRaw, glassesEmaKey);
  }

  if (eval.aiEval.has_value()) {
    if (!eval.aiEval->error.empty()) {
      pushIssueUnique(eval.face.issues, eval.aiEval->error);
    } else if (eval.aiEval->available) {
      if (!eval.aiEval->detected) {
        pushIssueUnique(eval.face.issues, "ai_face_not_detected");
      }
      if (!eval.aiEval->bothOpen) {
        pushIssueUnique(eval.face.issues, "eyes_not_open_or_not_visible");
      }
      if (!eval.aiEval->mouthClosed) {
        pushIssueUnique(eval.face.issues, "mouth_not_closed");
      }
      if (!eval.aiEval->noGlasses) {
        pushIssueUnique(eval.face.issues, "suspected_glasses");
      }
      if (eval.aiEval->detected && eval.aiEval->bothOpen &&
          eval.aiEval->hasAiEyeConfidence) {
        const float eyeConfPct = static_cast<float>(
            std::clamp(eval.aiEval->aiEyeConfidence01 * 100.0, 0.0, 100.0));
        if (eyeConfPct < gBiometricIcaoEyeConfidenceMin) {
          pushIssueUnique(eval.face.issues, "eye_open_confidence_low");
          eval.ok = false;
        }
      }
      eval.ok = eval.ok && eval.aiEval->detected && eval.aiEval->bothOpen &&
                eval.aiEval->mouthClosed && eval.aiEval->noGlasses;
      if (eval.aiEval->hasFaceFrontal && eval.aiEval->detected) {
        eval.ok = eval.ok && eval.aiEval->faceFrontal;
      }
      applyAiFrontalToFaceIssues(eval.face, *eval.aiEval);
    }
  }
  if (eval.aiEval.has_value() && eval.aiEval->available && eval.aiEval->error.empty()) {
    stripLegacyIssuesWhenAiIcaoPasses(eval.face, *eval.aiEval);
  }
  // Fuente única de verdad final: issues consolidados (legacy + IA).
  eval.ok = eval.face.issues.empty();
  eval.face.ok = eval.ok;
  return eval;
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
  cv::Mat fg;
  if (faceGray.empty()) {
    return faceGray;
  }
  if (faceGray.type() == CV_8UC1) {
    fg = faceGray;
  } else if (faceGray.type() == CV_8UC3) {
    cv::cvtColor(faceGray, fg, cv::COLOR_BGR2GRAY);
  } else if (faceGray.channels() == 1) {
    faceGray.convertTo(fg, CV_8U);
  } else {
    cv::cvtColor(faceGray, fg, cv::COLOR_BGR2GRAY);
    if (fg.type() != CV_8UC1) {
      fg.convertTo(fg, CV_8U);
    }
  }
  cv::Mat denoised;
  cv::bilateralFilter(fg, denoised, 5, 25.0, 25.0);

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

fs::path legacyFacialUsersFile(const std::string &dataRoot) {
  return authDirPath(dataRoot) / "facial_legacy_users.json";
}

json::object authUserToJson(const AuthUser &u) {
  json::array tpl;
  for (double v : u.faceTemplate) {
    tpl.push_back(v);
  }

  json::object jo{{"id", u.id},
                  {"company", u.company},
                  {"first_name", u.firstName},
                  {"last_name", u.lastName},
                  {"dni", u.dni},
                  {"username", u.username},
                  {"role", u.role},
                  {"password_hash", u.passwordHash},
                  {"face_template", tpl},
                  {"created_at", u.createdAt}};
  if (!u.avatarCartoonBase64.empty()) {
    jo["avatar_cartoon_base64"] = u.avatarCartoonBase64;
  }
  return jo;
}

static json::object authUserSessionJson(const AuthUser &u,
                                        const std::string &token) {
  json::object jo{{"id", u.id},
                  {"company", u.company},
                  {"username", u.username},
                  {"role", u.role},
                  {"token", token},
                  {"full_name", u.firstName + " " + u.lastName}};
  if (!u.avatarCartoonBase64.empty()) {
    jo["avatar_cartoon_base64"] = u.avatarCartoonBase64;
  }
  return jo;
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
  out.avatarCartoonBase64.clear();
  if (obj.if_contains("avatar_cartoon_base64") &&
      obj.at("avatar_cartoon_base64").is_string()) {
    out.avatarCartoonBase64 =
        json::value_to<std::string>(obj.at("avatar_cartoon_base64"));
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

static bool updateUserAvatarCartoonFile(const std::string &dataRoot,
                                        const std::string &userId,
                                        const std::string &avatarBase64) {
  auto users = loadAuthUsers(dataRoot);
  for (auto &u : users) {
    if (u.id == userId) {
      u.avatarCartoonBase64 = avatarBase64;
      saveAuthUsers(dataRoot, users);
      return true;
    }
  }
  return false;
}

std::vector<LegacyFacialUserRecord>
loadLegacyFacialUsers(const std::string &dataRoot) {
  fs::create_directories(authDirPath(dataRoot));
  const auto path = legacyFacialUsersFile(dataRoot);
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
    std::vector<LegacyFacialUserRecord> out;
    for (const auto &it : parsed.as_array()) {
      if (!it.is_object()) {
        continue;
      }
      const auto &obj = it.as_object();
      if (!obj.if_contains("id") || !obj.if_contains("name") ||
          !obj.if_contains("timestamp")) {
        continue;
      }
      if (!obj.at("id").is_string() || !obj.at("name").is_string()) {
        continue;
      }
      LegacyFacialUserRecord u;
      u.id = json::value_to<std::string>(obj.at("id"));
      u.name = json::value_to<std::string>(obj.at("name"));
      if (obj.at("timestamp").is_int64()) {
        u.timestamp = obj.at("timestamp").as_int64();
      } else if (obj.at("timestamp").is_double()) {
        u.timestamp = static_cast<std::int64_t>(obj.at("timestamp").as_double());
      }
      if (obj.if_contains("confidence")) {
        if (obj.at("confidence").is_double()) {
          u.confidence = obj.at("confidence").as_double();
        } else if (obj.at("confidence").is_int64()) {
          u.confidence = static_cast<double>(obj.at("confidence").as_int64());
        }
      }
      out.push_back(std::move(u));
    }
    return out;
  } catch (...) {
    return {};
  }
}

void saveLegacyFacialUsers(const std::string &dataRoot,
                          const std::vector<LegacyFacialUserRecord> &users) {
  fs::create_directories(authDirPath(dataRoot));
  json::array arr;
  for (const auto &u : users) {
    arr.push_back(json::object{{"id", u.id},
                               {"name", u.name},
                               {"timestamp", u.timestamp},
                               {"confidence", u.confidence}});
  }
  std::ofstream ofs(legacyFacialUsersFile(dataRoot), std::ios::trunc);
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

// Mensajes de login alineados con /api/auth/login/check-identity (Usuario/DNI/RUC por empresa).
static const char kAuthUserNotFoundMsg[] = "USUARIO NO EXISTE";
static const char kAuthWrongPasswordMsg[] = "La contraseña no es correcta.";
static const char kAuthAmbiguousIdentityMsg[] =
    "El identificador coincide con más de un registro en esa empresa. Use un "
    "dato único (por ejemplo el DNI) e intente de nuevo.";

static bool authIdentityKeyIsAllDigits(const std::string &s) {
  return !s.empty() &&
         std::all_of(s.begin(), s.end(), [](unsigned char c) {
           return std::isdigit(c) != 0;
         });
}

/** username / dni / ruc exacto, o DNI numérico equivalente (p. ej. 9637521 vs 09637521). */
static bool authIdentityKeyMatchesFsUser(const std::string &identityKey,
                                         const AuthUser &u) {
  if (u.username == identityKey || u.dni == identityKey ||
      (!u.ruc.empty() && u.ruc == identityKey)) {
    return true;
  }
  if (!authIdentityKeyIsAllDigits(identityKey) ||
      !authIdentityKeyIsAllDigits(u.dni) || u.dni.empty()) {
    return false;
  }
  try {
    return std::stoll(u.dni) == std::stoll(identityKey);
  } catch (const std::exception &) {
    return false;
  }
}

struct AuthLoginIdentityLookupResult {
  enum class Kind { Ok, NotFound, Ambiguous, DbError };
  Kind kind = Kind::DbError;
  std::string resolvedUsername;
  std::string diagnostic;
};

static AuthLoginIdentityLookupResult authLookupIdentityForCompanyFs(
    const std::string &dataRoot, const std::string &company,
    const std::string &identityKey) {
  AuthLoginIdentityLookupResult out;
  const auto users = loadAuthUsers(dataRoot);
  const AuthUser *match = nullptr;
  size_t matchCount = 0;
  for (const auto &u : users) {
    if (u.company != company) {
      continue;
    }
    if (authIdentityKeyMatchesFsUser(identityKey, u)) {
      match = &u;
      matchCount++;
    }
  }
  if (matchCount == 0) {
    out.kind = AuthLoginIdentityLookupResult::Kind::NotFound;
    return out;
  }
  if (matchCount > 1) {
    out.kind = AuthLoginIdentityLookupResult::Kind::Ambiguous;
    return out;
  }
  out.kind = AuthLoginIdentityLookupResult::Kind::Ok;
  out.resolvedUsername = match->username;
  return out;
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
  if (gAuthSchemaReady.load(std::memory_order_acquire)) {
    return true;
  }
  std::lock_guard<std::mutex> lk(gAuthSchemaInitMutex);
  if (gAuthSchemaReady.load(std::memory_order_relaxed)) {
    return true;
  }
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
CREATE TABLE IF NOT EXISTS auth_companies (
    name VARCHAR(180) PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event_time ON auth_audit_logs(event_time DESC);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'operator';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS ruc VARCHAR(20) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mobile VARCHAR(30) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email VARCHAR(120) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS face_template JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_cartoon_base64 TEXT;
)SQL";
  const bool ok = pgExecOk(conn, sql);
  if (ok) {
    for (const auto &company : kMiningCompanies) {
      const std::string seedSql =
          "INSERT INTO auth_companies(name, active) VALUES(" +
          pqEscapeLiteral(conn, company) +
          ", true) ON CONFLICT (name) DO NOTHING";
      (void)pgExecOk(conn, seedSql);
    }
  }
  if (ok) {
    gAuthSchemaReady.store(true, std::memory_order_release);
  }
  return ok;
}

static std::string trimCompanyName(const std::string &s) {
  size_t start = 0;
  while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start]))) {
    ++start;
  }
  size_t end = s.size();
  while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) {
    --end;
  }
  return s.substr(start, end - start);
}

bool ensureFormulaCatalogViewPg(PGconn *conn) {
  static const char *kDropCatalogView = "DROP VIEW IF EXISTS v_mineria_catalogos CASCADE;";
  static const char *kCreateCatalogView = R"SQL(
CREATE VIEW v_mineria_catalogos AS
SELECT
    e.id AS empresa_id, e.codigo AS empresa_codigo, e.nombre AS empresa_nombre,
    m.id AS mina_id, m.codigo AS mina_codigo, m.nombre AS mina_nombre, m.zona_tipo, m.umbral_temp_alerta,
    s.id AS sensor_id, s.codigo AS sensor_codigo, s.nombre AS sensor_nombre,
    v.id AS variable_id, v.codigo AS variable_codigo, v.nombre AS variable_nombre, v.unidad
FROM mineria_empresas e
JOIN mineria_minas m ON m.empresa_id = e.id AND m.activo = TRUE
JOIN mineria_variables v ON v.empresa_id = e.id AND v.activo = TRUE AND v.tipo = 'temperatura'
JOIN mineria_sensores s ON s.empresa_id = e.id AND s.mina_id = m.id AND s.variable_id = v.id AND s.activo = TRUE;
)SQL";
  (void)pgExecOk(conn, kDropCatalogView);
  return pgExecOk(conn, kCreateCatalogView);
}

bool ensureFormulaSchemaPg(PGconn *conn, const std::string &companyName) {
  if (!gFormulaSchemaReady.load(std::memory_order_acquire)) {
    std::lock_guard<std::mutex> lk(gFormulaSchemaInitMutex);
    if (!gFormulaSchemaReady.load(std::memory_order_relaxed)) {
      const char *sql = R"SQL(
CREATE TABLE IF NOT EXISTS mineria_empresas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(40) UNIQUE NOT NULL,
    nombre VARCHAR(200) UNIQUE NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mineria_minas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    codigo VARCHAR(40) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    zona_tipo VARCHAR(20) NOT NULL DEFAULT 'sierra',
    umbral_temp_alerta DECIMAL(6,2) NOT NULL DEFAULT 8.0,
    factor_ajuste DECIMAL(6,4) NOT NULL DEFAULT 0.82,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_id, codigo)
);
CREATE TABLE IF NOT EXISTS mineria_variables (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    codigo VARCHAR(30) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    unidad VARCHAR(20),
    tipo VARCHAR(50) DEFAULT 'temperatura',
    activo BOOLEAN DEFAULT TRUE,
    UNIQUE(empresa_id, codigo)
);
CREATE TABLE IF NOT EXISTS mineria_sensores (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    mina_id INTEGER NOT NULL REFERENCES mineria_minas(id),
    variable_id INTEGER NOT NULL REFERENCES mineria_variables(id),
    codigo VARCHAR(40) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    UNIQUE(empresa_id, codigo)
);
CREATE TABLE IF NOT EXISTS mineria_lecturas (
    id BIGSERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES mineria_empresas(id),
    mina_id INTEGER NOT NULL REFERENCES mineria_minas(id),
    variable_id INTEGER NOT NULL REFERENCES mineria_variables(id),
    timestamp_lectura TIMESTAMPTZ NOT NULL,
    valor DECIMAL(12,4),
    calidad SMALLINT DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mlect_lookup ON mineria_lecturas(empresa_id, mina_id, variable_id, timestamp_lectura DESC);
CREATE OR REPLACE FUNCTION sp_proceso_temperatura(
    p_empresa_id   INTEGER,
    p_mina_id      INTEGER,
    p_variable_id  INTEGER,
    p_fecha_inicio TIMESTAMPTZ,
    p_fecha_fin    TIMESTAMPTZ
)
RETURNS TABLE (
    timestamp_lectura   TIMESTAMPTZ,
    valor_original      DECIMAL(12,4),
    calidad             SMALLINT,
    umbral_alerta       DECIMAL(6,2),
    condicion_resultado VARCHAR(2),
    valor_procesado     DECIMAL(12,4),
    descripcion         TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_umbral DECIMAL(6,2);
    v_factor DECIMAL(6,4);
BEGIN
    SELECT m.umbral_temp_alerta, m.factor_ajuste
    INTO   v_umbral, v_factor
    FROM   mineria_minas m
    WHERE  m.id = p_mina_id AND m.empresa_id = p_empresa_id AND m.activo = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mina no encontrada para el tenant';
    END IF;

    RETURN QUERY
    SELECT
        l.timestamp_lectura,
        l.valor AS valor_original,
        l.calidad,
        v_umbral AS umbral_alerta,
        CASE WHEN l.valor > v_umbral THEN 'SI' ELSE 'NO' END::VARCHAR(2) AS condicion_resultado,
        CASE
            WHEN l.valor > v_umbral THEN ROUND(CAST(v_umbral + (l.valor - v_umbral) * v_factor AS NUMERIC), 4)
            ELSE ROUND(CAST(l.valor * 0.985 + 0.12 AS NUMERIC), 4)
        END AS valor_procesado,
        CASE
            WHEN l.valor > v_umbral THEN 'ALERTA: amortiguacion por umbral'
            ELSE 'NORMAL: calibracion lineal'
        END::TEXT AS descripcion
    FROM mineria_lecturas l
    WHERE l.empresa_id = p_empresa_id
      AND l.mina_id = p_mina_id
      AND l.variable_id = p_variable_id
      AND l.timestamp_lectura BETWEEN p_fecha_inicio AND p_fecha_fin
      AND l.calidad >= 50
    ORDER BY l.timestamp_lectura;
END;
$$;
CREATE TABLE IF NOT EXISTS formula_sessions (
    id BIGSERIAL PRIMARY KEY,
    usuario_nombre VARCHAR(200),
    accion VARCHAR(20) DEFAULT 'VISUALIZO',
    empresa_id INTEGER,
    empresa_nombre VARCHAR(200),
    mina_id INTEGER,
    mina_nombre VARCHAR(200),
    variable_id INTEGER,
    variable_nombre VARCHAR(200),
    fecha_inicio TIMESTAMPTZ,
    fecha_fin TIMESTAMPTZ,
    formula_json JSONB,
    sp_sql_text TEXT,
    total_lecturas INTEGER,
    total_si INTEGER,
    total_no INTEGER,
    pct_alertas DECIMAL(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fsess_empresa ON formula_sessions(empresa_id);
CREATE INDEX IF NOT EXISTS idx_fsess_mina ON formula_sessions(mina_id);
CREATE INDEX IF NOT EXISTS idx_fsess_created ON formula_sessions(created_at DESC);
)SQL";

      if (!pgExecOk(conn, sql)) {
        return false;
      }
      gFormulaSchemaReady.store(true, std::memory_order_release);
    }
  }

  // Seed tenant-scoped company, mine, variable and demo readings.
  std::string trimmed = trimCompanyName(companyName);
  std::string normalized = trimmed.empty() ? "Empresa Minera" : trimmed;
  std::string code = normalized;
  for (char &ch : code) {
    if (!std::isalnum(static_cast<unsigned char>(ch))) ch = '_';
  }
  const std::string upsertCompany =
      "INSERT INTO mineria_empresas(codigo,nombre,activo) VALUES(" +
      pqEscapeLiteral(conn, code) + "," + pqEscapeLiteral(conn, normalized) +
      ", true) ON CONFLICT (nombre) DO NOTHING";
  (void)pgExecOk(conn, upsertCompany);

  const std::string seedMine =
      "INSERT INTO mineria_minas(empresa_id,codigo,nombre,zona_tipo,umbral_temp_alerta,factor_ajuste,activo) "
      "SELECT id,'UNI-001','Unidad Minera Principal','sierra',8.0,0.82,true FROM mineria_empresas WHERE nombre=" +
      pqEscapeLiteral(conn, normalized) + " ON CONFLICT (empresa_id,codigo) DO NOTHING";
  (void)pgExecOk(conn, seedMine);

  const std::string seedVar =
      "INSERT INTO mineria_variables(empresa_id,codigo,nombre,unidad,tipo,activo) "
      "SELECT id,'TEMP-001','Temperatura Ambiente','C','temperatura',true FROM mineria_empresas WHERE nombre=" +
      pqEscapeLiteral(conn, normalized) + " ON CONFLICT (empresa_id,codigo) DO NOTHING";
  (void)pgExecOk(conn, seedVar);

  const std::string seedSensor =
      "INSERT INTO mineria_sensores(empresa_id,mina_id,variable_id,codigo,nombre,activo) "
      "SELECT e.id,m.id,v.id,'SEN-001','Sensor Temperatura Principal',true "
      "FROM mineria_empresas e "
      "JOIN mineria_minas m ON m.empresa_id=e.id "
      "JOIN mineria_variables v ON v.empresa_id=e.id AND v.codigo='TEMP-001' "
      "WHERE e.nombre=" + pqEscapeLiteral(conn, normalized) +
      " ON CONFLICT (empresa_id,codigo) DO NOTHING";
  (void)pgExecOk(conn, seedSensor);

  const std::string seedReadings = R"SQL(
INSERT INTO mineria_lecturas(empresa_id, mina_id, variable_id, timestamp_lectura, valor, calidad)
SELECT e.id, m.id, v.id, ts,
       ROUND(CAST(9.5 + 4.2 * SIN(EXTRACT(EPOCH FROM ts) / 86400.0 * 2 * PI()) + (random() * 2.5 - 1.2) AS NUMERIC), 2),
       100
FROM mineria_empresas e
JOIN mineria_minas m ON m.empresa_id = e.id
JOIN mineria_variables v ON v.empresa_id = e.id AND v.codigo = 'TEMP-001'
CROSS JOIN generate_series(NOW() - INTERVAL '30 days', NOW(), INTERVAL '30 minutes') ts
WHERE e.nombre = )SQL" + pqEscapeLiteral(conn, normalized) + R"SQL(
  AND NOT EXISTS (
  SELECT 1 FROM mineria_lecturas l
  WHERE l.empresa_id = e.id AND l.mina_id = m.id AND l.variable_id = v.id
);
)SQL";
  (void)pgExecOk(conn, seedReadings);
  if (!ensureFormulaCatalogViewPg(conn)) {
    return false;
  }
  return true;
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
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    PQfinish(conn);
    return reports;
  }
  std::string sql =
      "SELECT id, project_id, title, status, created_at, updated_at, "
      "COALESCE(company_name,'') "
      "FROM reports WHERE deleted_at IS NULL AND company_name = " +
      pqEscapeLiteral(conn, company) + " ORDER BY created_at DESC";
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
          r.company = PQgetisnull(res, i, 6) ? "" : std::string(PQgetvalue(res, i, 6));
          reports.push_back(std::move(r));
      }
  }
  if (res) PQclear(res);
  PQfinish(conn);
  return reports;
}

bool getReportByIdPg(const std::string &databaseUrl, const std::string &id, const std::string &company, Report &out,
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
  std::string sql =
      "SELECT id, project_id::text, title, content_json::text, status, "
      "created_at::text, updated_at::text, COALESCE(company_name,'') FROM reports WHERE id = " +
      pqEscapeLiteral(conn, id) + " AND company_name = " + pqEscapeLiteral(conn, company) +
      " AND deleted_at IS NULL";
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
  out.company = PQgetisnull(res, 0, 7) ? "" : std::string(PQgetvalue(res, 0, 7));
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
  if (!ensureAuthSchemaPg(conn)) {
    error = "failed to ensure auth schema";
    PQfinish(conn);
    return false;
  }
  std::string contentStr = json::serialize(r.contentJson);
  std::string sql = "INSERT INTO reports (project_id, title, content_json, status, company_name) VALUES (" +
      (r.projectId.empty() ? "NULL" : pqEscapeLiteral(conn, r.projectId)) + "," +
      pqEscapeLiteral(conn, r.title) + "," +
      pqEscapeLiteral(conn, contentStr) + "," +
      pqEscapeLiteral(conn, r.status) + "," +
      pqEscapeLiteral(conn, r.company) + ") RETURNING id::text";
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

bool updateReportPg(const std::string &databaseUrl, const std::string &id, const std::string &company, const Report &r, std::string &error) {
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
    std::string contentStr = json::serialize(r.contentJson);
    std::string sql = "UPDATE reports SET title = " + pqEscapeLiteral(conn, r.title) +
        ", content_json = " + pqEscapeLiteral(conn, contentStr) +
        ", status = " + pqEscapeLiteral(conn, r.status) +
        ", company_name = " + pqEscapeLiteral(conn, company) +
        " WHERE id = " + pqEscapeLiteral(conn, id) + " AND company_name = " + pqEscapeLiteral(conn, company) +
        " AND deleted_at IS NULL";
    bool ok = pgExecOk(conn, sql);
    if (!ok) error = PQerrorMessage(conn);
    PQfinish(conn);
    return ok;
}

bool deleteReportPg(const std::string &databaseUrl, const std::string &id, const std::string &company, std::string &error) {
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
    std::string sql = "UPDATE reports SET deleted_at = NOW() WHERE id = " + pqEscapeLiteral(conn, id) +
                      " AND company_name = " + pqEscapeLiteral(conn, company) + " AND deleted_at IS NULL";
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

  const std::string avatarSql =
      user.avatarCartoonBase64.empty()
          ? "NULL"
          : pqEscapeLiteral(conn, user.avatarCartoonBase64);
  const std::string insertSql =
      "INSERT INTO auth_users(id,company_name,first_name,last_name,dni,username,role,password_hash,face_template,ruc,phone,mobile,email,avatar_cartoon_base64) VALUES(" +
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
      pqEscapeLiteral(conn, user.email) + "," + avatarSql + ")";

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

#if HAS_LIBPQ
static bool updateUserAvatarCartoonPg(const std::string &databaseUrl,
                                      const std::string &userId,
                                      const std::string &avatarBase64,
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
  const std::string sql = "UPDATE auth_users SET avatar_cartoon_base64=" +
                          pqEscapeLiteral(conn, avatarBase64) + " WHERE id=" +
                          pqEscapeLiteral(conn, userId);
  if (!pgExecOk(conn, sql)) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return false;
  }
  PQfinish(conn);
  return true;
}
#endif

/** Condición SQL: usuario, DNI o RUC literal; si identity es solo dígitos, también DNI = valor bigint (ceros a la izquierda). */
static std::string pgSqlAuthIdentityMatch(PGconn *conn,
                                          const std::string &identityKey) {
  const std::string e = pqEscapeLiteral(conn, identityKey);
  std::string clause =
      "(username=" + e + " OR dni=" + e + " OR ruc=" + e;
  if (authIdentityKeyIsAllDigits(identityKey) && identityKey.size() <= 15) {
    clause +=
        " OR (dni ~ '^[0-9]+$' AND btrim(dni) <> '' AND "
        "btrim(dni)::bigint = " +
        e + "::bigint)";
  }
  clause += ")";
  return clause;
}

static AuthLoginIdentityLookupResult authLookupIdentityForCompanyPg(
    const std::string &databaseUrl, const std::string &company,
    const std::string &identityKey) {
  AuthLoginIdentityLookupResult out;
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    out.diagnostic = PQerrorMessage(conn);
    PQfinish(conn);
    return out;
  }
  (void)ensureAuthSchemaPg(conn);
  const std::string sql =
      "SELECT username FROM auth_users WHERE company_name=" +
      pqEscapeLiteral(conn, company) + " AND " +
      pgSqlAuthIdentityMatch(conn, identityKey) + " LIMIT 4";
  PGresult *res = PQexec(conn, sql.c_str());
  if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
    out.diagnostic = res ? PQresultErrorMessage(res) : PQerrorMessage(conn);
    if (out.diagnostic.empty()) {
      out.diagnostic = "query failed";
    }
    if (res) {
      PQclear(res);
    }
    PQfinish(conn);
    return out;
  }
  const int rows = PQntuples(res);
  if (rows == 0) {
    PQclear(res);
    PQfinish(conn);
    out.kind = AuthLoginIdentityLookupResult::Kind::NotFound;
    return out;
  }
  if (rows > 1) {
    PQclear(res);
    PQfinish(conn);
    out.kind = AuthLoginIdentityLookupResult::Kind::Ambiguous;
    return out;
  }
  out.kind = AuthLoginIdentityLookupResult::Kind::Ok;
  out.resolvedUsername = PQgetvalue(res, 0, 0);
  PQclear(res);
  PQfinish(conn);
  return out;
}

std::optional<AuthUser> loginPasswordPg(const std::string &databaseUrl,
                                        const std::string &company,
                                        const std::string &identityKey,
                                        const std::string &passwordHash,
                                        std::string &error,
                                        std::string *errorCodeOut = nullptr) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);

  const std::string sql =
      "SELECT id, company_name, first_name, last_name, dni, username, role, "
      "password_hash, face_template::text, created_at::text, avatar_cartoon_base64 "
      "FROM auth_users WHERE company_name=" +
      pqEscapeLiteral(conn, company) + " AND " +
      pgSqlAuthIdentityMatch(conn, identityKey) + " LIMIT 4";

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

  const int rowCount = PQntuples(res);
  if (rowCount == 0) {
    PQclear(res);
    appendAuthAuditLogPg(conn, "login_password", company, identityKey, false,
                         "user_not_found");
    PQfinish(conn);
    error = kAuthUserNotFoundMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "user_not_found";
    }
    return std::nullopt;
  }
  if (rowCount > 1) {
    PQclear(res);
    appendAuthAuditLogPg(conn, "login_password", company, identityKey, false,
                         "ambiguous_identity");
    PQfinish(conn);
    error = kAuthAmbiguousIdentityMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "ambiguous_identity";
    }
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
  u.avatarCartoonBase64.clear();
  if (!PQgetisnull(res, 0, 10)) {
    u.avatarCartoonBase64 = PQgetvalue(res, 0, 10);
  }

  if (u.passwordHash != passwordHash) {
    appendAuthAuditLogPg(conn, "login_password", company, u.username, false,
                         "invalid_password");
    PQclear(res);
    PQfinish(conn);
    error = kAuthWrongPasswordMsg;
    if (errorCodeOut != nullptr) {
      *errorCodeOut = "wrong_password";
    }
    return std::nullopt;
  }

  appendAuthAuditLogPg(conn, "login_password", company, u.username, true, "ok");
  PQclear(res);
  PQfinish(conn);
  return u;
}

std::optional<std::pair<AuthUser, double>>
loginFaceTargetedPg(const std::string &databaseUrl, const std::string &company,
                    const std::string &identityKey,
                    const std::vector<double> &clientProbeTemplate,
                    const std::optional<std::vector<unsigned char>> &rawImageBytes,
                    const std::optional<std::string> &base64ForLegacy,
                    double legacyThreshold, double embeddingThreshold,
                    std::string &error, std::string *probeProviderOut = nullptr) {
  PGconn *conn = PQconnectdb(databaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    error = PQerrorMessage(conn);
    PQfinish(conn);
    return std::nullopt;
  }
  (void)ensureAuthSchemaPg(conn);

  const std::string sql =
      "SELECT id, company_name, first_name, last_name, dni, username, role, "
      "password_hash, face_template::text, created_at::text, ruc, phone, mobile, email, "
      "avatar_cartoon_base64 "
      "FROM auth_users WHERE company_name=" +
      pqEscapeLiteral(conn, company) + " AND " +
      pgSqlAuthIdentityMatch(conn, identityKey) + " LIMIT 4";
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

  const int rows = PQntuples(res);
  if (rows == 0) {
    appendAuthAuditLogPg(conn, "login_face", company, "unknown", false,
                         "no_user_for_identity");
    PQclear(res);
    PQfinish(conn);
    error = kAuthUserNotFoundMsg;
    return std::nullopt;
  }
  if (rows > 1) {
    appendAuthAuditLogPg(conn, "login_face", company, "unknown", false,
                         "ambiguous_identity");
    PQclear(res);
    PQfinish(conn);
    error = "El identificador coincide con más de un registro en esa empresa. "
            "Use un dato único (por ejemplo el DNI) e intente de nuevo.";
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
  u.ruc = PQgetvalue(res, 0, 10);
  u.phone = PQgetvalue(res, 0, 11);
  u.mobile = PQgetvalue(res, 0, 12);
  u.email = PQgetvalue(res, 0, 13);
  u.avatarCartoonBase64.clear();
  if (!PQgetisnull(res, 0, 14)) {
    u.avatarCartoonBase64 = PQgetvalue(res, 0, 14);
  }

  std::vector<double> tpl;
  try {
    auto parsed = json::parse(PQgetvalue(res, 0, 8));
    if (!parsed.is_array()) {
      appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                           "invalid_template");
      PQclear(res);
      PQfinish(conn);
      error = "El usuario indicado no tiene una plantilla facial válida "
              "registrada. Complete el registro biométrico e intente de nuevo.";
      return std::nullopt;
    }
    for (const auto &v : parsed.as_array()) {
      if (v.is_double()) {
        tpl.push_back(v.as_double());
      } else if (v.is_int64()) {
        tpl.push_back(static_cast<double>(v.as_int64()));
      }
    }
  } catch (...) {
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "template_parse_failed");
    PQclear(res);
    PQfinish(conn);
    error = "El usuario indicado no tiene una plantilla facial válida "
            "registrada. Complete el registro biométrico e intente de nuevo.";
    return std::nullopt;
  }

  if (tpl.size() < 100) {
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "template_too_short");
    PQclear(res);
    PQfinish(conn);
    error = "El usuario indicado no tiene biometría facial registrada de forma "
            "completa. Registre el rostro e intente de nuevo.";
    return std::nullopt;
  }

  std::vector<double> probe;
  std::string probeProvider;
  double useThreshold = legacyThreshold;
  if (!buildFaceLoginProbe(clientProbeTemplate, rawImageBytes, base64ForLegacy,
                           tpl, probe, probeProvider, useThreshold,
                           legacyThreshold, embeddingThreshold, error)) {
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "probe_build_failed");
    PQclear(res);
    PQfinish(conn);
    return std::nullopt;
  }

  const double bestScore = cosineSimilarity(probe, tpl);
  if (bestScore < useThreshold) {
    std::cout << "[AUTH_FACE] no_match_pg company=" << company
              << " user=" << u.username << " stored_dim=" << tpl.size()
              << " probe_dim=" << probe.size() << " score=" << bestScore
              << " threshold=" << useThreshold << " probe_provider=" << probeProvider
              << std::endl;
    appendAuthAuditLogPg(conn, "login_face", company, u.username, false,
                         "no_match score=" + std::to_string(bestScore));
    PQclear(res);
    PQfinish(conn);
    error = "La biometría facial no coincide con el usuario indicado. "
            "Verifique su identidad y vuelva a intentar.";
    return std::nullopt;
  }

  appendAuthAuditLogPg(conn, "login_face", company, u.username, true,
                       "ok score=" + std::to_string(bestScore) + " probe=" +
                           probeProvider);
  if (probeProviderOut != nullptr) {
    *probeProviderOut = probeProvider;
  }
  PQclear(res);
  PQfinish(conn);
  return std::make_pair(u, bestScore);
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
  // Informes usan PUT/DELETE; el preflight CORS fallaba si solo se permitían GET/POST.
  res.set(http::field::access_control_allow_methods,
        "GET,POST,PUT,PATCH,DELETE,OPTIONS");
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
  res.set(http::field::access_control_allow_methods,
        "GET,POST,PUT,PATCH,DELETE,OPTIONS");
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
    json::object health{{"status", "ok"},
                        {"cartoon_onnx_linked", informeCartoonOnnxRuntimeLinked()},
                        {"cartoon_onnx_model", gCartoonOnnxModelPath},
                        {"cartoon_onnx_model_exists",
                         !gCartoonOnnxModelPath.empty() &&
                             fs::exists(gCartoonOnnxModelPath)}};
    return makeJsonResponse(http::status::ok, health);
  }

  if (req.method() == http::verb::get && pathOnly == "/api/capabilities") {
    return makeJsonResponse(http::status::ok,
                            json::object{{"ecw_supported", gdalSupportsEcw()}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/auth/companies") {
    json::array companies;
    bool loadedFromDb = false;
    if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
      if (PQstatus(conn) == CONNECTION_OK) {
        (void)ensureAuthSchemaPg(conn);
        PGresult *res = PQexec(
            conn,
            "SELECT name FROM auth_companies WHERE active=true ORDER BY name ASC");
        if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
          for (int i = 0; i < PQntuples(res); ++i) {
            companies.push_back(json::value(std::string(PQgetvalue(res, i, 0))));
          }
          loadedFromDb = PQntuples(res) > 0;
        }
        if (res) {
          PQclear(res);
        }
      }
      PQfinish(conn);
#endif
    }
    if (!loadedFromDb) {
      for (const auto &company : kMiningCompanies) {
        companies.push_back(json::value(company));
      }
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
      const auto sessionBiometric = resolveAuthSession(req, query);
      std::optional<std::string> glassesEmaKey;
      if (sessionBiometric.has_value()) {
        glassesEmaKey = sessionBiometric->token;
      }
      auto eval = runBiometricVerifyForImageBase64(base64, glassesEmaKey);
      auto &face = eval.face;
      
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

  if (req.method() == http::verb::post && pathOnly == "/api/process_frame") {
    try {
      if (req.body().empty()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "image body is required"}});
      }
      std::vector<unsigned char> frameRaw(req.body().begin(), req.body().end());
      cv::Mat frame = cv::imdecode(frameRaw, cv::IMREAD_COLOR);
      if (frame.empty()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid image data"}});
      }
      std::cerr << "[AI_OVAL] /api/process_frame decoded w=" << frame.cols
                << " h=" << frame.rows << std::endl;
      std::vector<unsigned char> jpg;
      cv::imencode(".jpg", frame, jpg, {cv::IMWRITE_JPEG_QUALITY, 60});
      const std::string base64 = encodeBase64(jpg);
      auto eval = runBiometricVerifyForImageBase64(base64, std::nullopt);

      bool eyesOpen = true;
      bool mouthClosed = true;
      bool noGlasses = true;
      bool detected = eval.ok;
      if (eval.aiEval.has_value() && eval.aiEval->available) {
        eyesOpen = eval.aiEval->bothOpen;
        mouthClosed = eval.aiEval->mouthClosed;
        noGlasses = eval.aiEval->noGlasses;
        detected = eval.aiEval->detected;
      }
      bool frontal = true;
      if (eval.aiEval.has_value() && eval.aiEval->available &&
          eval.aiEval->detected && eval.aiEval->hasFaceFrontal) {
        frontal = eval.aiEval->faceFrontal;
      } else {
        for (const auto &issue : eval.face.issues) {
          if (issue == "face_not_frontal" || issue == "head_pose_not_straight") {
            frontal = false;
          }
        }
      }

      int stateOut = 1;
      {
        std::scoped_lock lk(gBiometricCaptureMutex);
        gBiometricCaptureState.detected = detected;
        gBiometricCaptureState.eyesOpen = eyesOpen;
        gBiometricCaptureState.mouthClosed = mouthClosed;
        gBiometricCaptureState.noGlasses = noGlasses;
        gBiometricCaptureState.faceStraight = frontal;
        gBiometricCaptureState.hasFaceOval = false;
        if (eval.aiEval.has_value() && eval.aiEval->available &&
            eval.aiEval->hasFaceOvalEllipse) {
          const auto &e = eval.aiEval->faceOvalEllipse;
          gBiometricCaptureState.hasFaceOval = true;
          gBiometricCaptureState.faceOvalCx = static_cast<double>(e.center.x);
          gBiometricCaptureState.faceOvalCy = static_cast<double>(e.center.y);
          gBiometricCaptureState.faceOvalW = static_cast<double>(e.size.width);
          gBiometricCaptureState.faceOvalH = static_cast<double>(e.size.height);
          gBiometricCaptureState.faceOvalAngleDeg = static_cast<double>(e.angle);
        }
        const bool frameValid = eval.ok && eyesOpen && mouthClosed && noGlasses && frontal;
        if (frameValid) {
          gBiometricCaptureState.captureInvalidStreak = 0;
          if (gBiometricCaptureState.captureCount < 3) {
            gBiometricCapturedImages.push_back("data:image/jpeg;base64," + base64);
            if (gBiometricCapturedImages.size() > 3) {
              gBiometricCapturedImages.erase(gBiometricCapturedImages.begin());
            }
          }
          gBiometricCaptureState.captureCount =
              std::min(3, gBiometricCaptureState.captureCount + 1);
        } else {
          gBiometricCaptureState.captureInvalidStreak++;
          // ~5 ticks ≈ 1 s si el cliente envía cada 200 ms; evita borrar 1/3/2/3 por jitter ICAO.
          if (gBiometricCaptureState.captureInvalidStreak >= 5) {
            gBiometricCaptureState.captureCount = 0;
            gBiometricCaptureState.captureInvalidStreak = 0;
            gBiometricCapturedImages.clear();
          }
        }
        const double livenessScore =
            std::min(100.0, static_cast<double>(gBiometricCaptureState.captureCount) * 35.0);
        gBiometricCaptureState.livenessScore = livenessScore;
        if (gBiometricCaptureState.captureCount >= 3) {
          gBiometricCaptureState.state = 7;
        } else if (detected) {
          gBiometricCaptureState.state = 4;
        } else {
          gBiometricCaptureState.state = 1;
        }
        gBiometricCaptureState.stateName = captureStateLabel(gBiometricCaptureState.state);
        gBiometricCaptureState.updatedAt = std::chrono::steady_clock::now();
        stateOut = gBiometricCaptureState.state;
      }

      return makeJsonResponse(http::status::ok, json::object{
                                               {"ok", true},
                                               {"state", stateOut},
                                           });
    } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", ex.what()}});
    }
  }

  if (req.method() == http::verb::get && pathOnly == "/api/status") {
    BiometricCaptureRuntimeState s;
    {
      std::scoped_lock lk(gBiometricCaptureMutex);
      s = gBiometricCaptureState;
    }
    json::value faceOvalVal = nullptr;
    if (s.hasFaceOval) {
      faceOvalVal = json::object{
          {"cx", s.faceOvalCx},
          {"cy", s.faceOvalCy},
          {"w", s.faceOvalW},
          {"h", s.faceOvalH},
          {"angle_deg", s.faceOvalAngleDeg},
      };
    }
    return makeJsonResponse(http::status::ok,
                            json::object{
                                {"state", s.state},
                                {"state_name", s.stateName},
                                {"capture_count", s.captureCount},
                                {"active_engine",
                                 !gAiEngineUrl.empty() ? "MEDIAPIPE_IA" : "OPENCV_LEGACY"},
                                {"icao",
                                 json::object{{"eyes_open", s.eyesOpen},
                                              {"mouth_closed", s.mouthClosed},
                                              {"face_straight", s.faceStraight},
                                              {"no_glasses", s.noGlasses}}},
                                {"face_oval", faceOvalVal},
                                {"liveness_score", s.livenessScore},
                            });
  }

  if (req.method() == http::verb::get && pathOnly == "/api/reset_capture") {
    std::scoped_lock lk(gBiometricCaptureMutex);
    gBiometricCaptureState = BiometricCaptureRuntimeState{};
    gBiometricCapturedImages.clear();
    return makeJsonResponse(http::status::ok, json::object{{"status", "reset"}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/captured_images") {
    json::array arr;
    {
      std::scoped_lock lk(gBiometricCaptureMutex);
      for (const auto &img : gBiometricCapturedImages) {
        arr.push_back(json::value(img));
      }
    }
    return makeJsonResponse(http::status::ok, arr);
  }

  if (req.method() == http::verb::get && pathOnly == "/api/users") {
    const auto users = loadLegacyFacialUsers(dataRoot);
    json::array arr;
    for (const auto &u : users) {
      arr.push_back(json::object{{"id", u.id},
                                 {"name", u.name},
                                 {"timestamp", u.timestamp},
                                 {"confidence", u.confidence}});
    }
    return makeJsonResponse(http::status::ok, arr);
  }

  if (req.method() == http::verb::post && pathOnly == "/api/enroll") {
    try {
      auto val = json::parse(req.body());
      if (!val.is_object()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid JSON body"}});
      }
      const auto &obj = val.as_object();
      const std::string empresa =
          obj.if_contains("empresa") && obj.at("empresa").is_string()
              ? json::value_to<std::string>(obj.at("empresa"))
              : "EMPRESA";
      const std::string paterno =
          obj.if_contains("paterno") && obj.at("paterno").is_string()
              ? json::value_to<std::string>(obj.at("paterno"))
              : "";
      const std::string materno =
          obj.if_contains("materno") && obj.at("materno").is_string()
              ? json::value_to<std::string>(obj.at("materno"))
              : "";
      const std::string nombre =
          obj.if_contains("nombre") && obj.at("nombre").is_string()
              ? json::value_to<std::string>(obj.at("nombre"))
              : "";

      if (paterno.empty() || nombre.empty()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "paterno and nombre are required"}});
      }

      double confidence = 0.0;
      {
        std::scoped_lock lk(gBiometricCaptureMutex);
        if (gBiometricCaptureState.captureCount < 3 ||
            gBiometricCaptureState.state != 7) {
          return makeJsonResponse(http::status::bad_request,
                                  json::object{{"error", "Capture process not complete"}});
        }
        confidence = gBiometricCaptureState.livenessScore;
        gBiometricCaptureState = BiometricCaptureRuntimeState{};
        gBiometricCapturedImages.clear();
      }

      const std::string userId =
          empresa + "_" + paterno + "_" + materno + "_" + nombre;
      const std::string fullName =
          nombre + (paterno.empty() ? "" : " " + paterno) +
          (materno.empty() ? "" : " " + materno);
      auto users = loadLegacyFacialUsers(dataRoot);
      users.push_back(LegacyFacialUserRecord{
          userId,
          fullName,
          static_cast<std::int64_t>(std::chrono::system_clock::to_time_t(
              std::chrono::system_clock::now())),
          confidence});
      saveLegacyFacialUsers(dataRoot, users);

      return makeJsonResponse(http::status::ok,
                              json::object{{"status", "success"},
                                           {"userId", userId}});
    } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", ex.what()}});
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

      const auto regT0 = std::chrono::steady_clock::now();
      auto regLog = [&](const char *tag) {
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - regT0)
                            .count();
        std::cerr << "[AUTH_REGISTER] dni=" << dni << " user=" << username << " +"
                  << ms << "ms " << tag << std::endl;
      };
      regLog("parsed_payload");

      std::vector<unsigned char> rawRegImage;
      std::string regFaceBase64;
      if (!hasTemplate && hasImage) {
        regFaceBase64 =
            json::value_to<std::string>(obj.at("face_image_base64"));
        (void)decodeBase64(regFaceBase64, rawRegImage);
      }

      std::string portraitPayloadEarly;
      if (obj.if_contains("face_portrait_oval_base64") &&
          obj.at("face_portrait_oval_base64").is_string()) {
        portraitPayloadEarly = stripDataUrlBase64(json::value_to<std::string>(
            obj.at("face_portrait_oval_base64")));
      }
      std::vector<unsigned char> portraitBytes;
      if (!portraitPayloadEarly.empty()) {
        (void)decodeBase64(portraitPayloadEarly, portraitBytes);
      }
      std::string bustPayloadEarly;
      if (obj.if_contains("face_bust_rect_base64") &&
          obj.at("face_bust_rect_base64").is_string()) {
        bustPayloadEarly = stripDataUrlBase64(json::value_to<std::string>(
            obj.at("face_bust_rect_base64")));
      }
      std::vector<unsigned char> bustBytes;
      if (!bustPayloadEarly.empty()) {
        (void)decodeBase64(bustPayloadEarly, bustBytes);
      }

      std::optional<std::future<AiEngineCartoonResult>> cartoonFut;
      if (!bustBytes.empty()) {
        std::vector<unsigned char> bustCopy = bustBytes;
        cartoonFut.emplace(std::async(std::launch::async, [bustCopy]() {
          return fetchCartoonAvatarBestEffort(bustCopy);
        }));
        regLog("cartoon_async_started_parallel_with_embedding");
      }

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
        regLog("face_template_from_client_skip_ai_embedding");
      } else {
        if (!rawRegImage.empty() && !gAiEngineUrl.empty()) {
          regLog("embedding_ai_engine_begin");
          auto em = fetchFaceEmbeddingFromAiEngine(rawRegImage);
          regLog("embedding_ai_engine_end");
          if (em.ok()) {
            faceTemplate = std::move(em.embedding);
            biometricProvider = "insightface_onnx";
            qualityScore = 0.92;
          }
        }
        if (faceTemplate.empty()) {
          regLog("analyze_face_legacy_begin");
          auto face = analyzeFaceImage(regFaceBase64, "register");
          regLog("analyze_face_legacy_end");
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
          faceTemplate = std::move(face.faceTemplate);
          biometricProvider = face.provider;
          qualityScore = face.qualityScore;
        }
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

      regLog("post_validate");

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

      /* Avatar cartoon: se completa en hilo en segundo plano tras INSERT para no
         bloquear la respuesta HTTP en inferencia ONNX (p. ej. registro con plantilla). */
      created.avatarCartoonBase64.clear();

      regLog("pre_db_insert");

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

      regLog("db_insert_ok");

      const bool deferCartoonWork = cartoonFut.has_value() ||
                                    !rawRegImage.empty() ||
                                    !portraitBytes.empty();
      if (deferCartoonWork) {
        auto bgCartoonOpt = std::move(cartoonFut);
        std::vector<unsigned char> bgRawReg = std::move(rawRegImage);
        std::vector<unsigned char> bgPortrait = std::move(portraitBytes);
        std::thread(
            [bgCartoonOpt = std::move(bgCartoonOpt),
             bgRawReg = std::move(bgRawReg), bgPortrait = std::move(bgPortrait),
             userId = created.id, regDni = dni, regUser = username,
             dataRoot]() mutable {
              const auto t0 = std::chrono::steady_clock::now();
              auto bgLog = [&](const char *tag) {
                const auto ms =
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - t0)
                        .count();
                std::cerr << "[AUTH_REGISTER_CARTOON_BG] dni=" << regDni
                          << " user=" << regUser << " id=" << userId << " +"
                          << ms << "ms " << tag << std::endl;
              };
              bgLog("thread_start");
              std::string b64;
              if (bgCartoonOpt.has_value()) {
                try {
                  auto cartoonB = bgCartoonOpt->get();
                  bgLog("bust_future_done");
                  if (cartoonB.ok()) {
                    b64 = std::move(cartoonB.imageBase64);
                  }
                } catch (const std::exception &ex) {
                  std::cerr << "[AUTH_REGISTER_CARTOON_BG] future: " << ex.what()
                            << std::endl;
                } catch (...) {
                  std::cerr << "[AUTH_REGISTER_CARTOON_BG] future: unknown\n";
                }
              }
              if (b64.empty() && !bgRawReg.empty()) {
                bgLog("cartoon_sync_raw_bg");
                auto cartoon = fetchCartoonAvatarBestEffort(bgRawReg);
                if (cartoon.ok()) {
                  b64 = std::move(cartoon.imageBase64);
                }
              }
              if (b64.empty() && !bgPortrait.empty()) {
                bgLog("cartoon_sync_portrait_bg");
                auto cartoon2 = fetchCartoonAvatarBestEffort(bgPortrait);
                if (cartoon2.ok()) {
                  b64 = std::move(cartoon2.imageBase64);
                }
              }
              if (b64.empty()) {
                bgLog("cartoon_all_failed_bg");
                return;
              }
              bgLog("cartoon_ok_updating_store");
              std::scoped_lock lk(gAuthMutex);
              if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
                std::string err;
                if (!updateUserAvatarCartoonPg(gDatabaseUrl, userId, b64, err)) {
                  std::cerr << "[AUTH_REGISTER_CARTOON_BG] pg: " << err
                            << std::endl;
                } else {
                  bgLog("pg_avatar_updated");
                }
#else
                (void)b64;
#endif
              } else {
                if (!updateUserAvatarCartoonFile(dataRoot, userId, b64)) {
                  std::cerr << "[AUTH_REGISTER_CARTOON_BG] file: user id not "
                               "found\n";
                } else {
                  bgLog("file_avatar_updated");
                }
              }
            })
            .detach();
        regLog("cartoon_bg_detached");
      }

      const auto sessionToken = issueAuthSession(created);
      regLog("response_ready");

      return makeJsonResponse(
          http::status::created,
          json::object{{"status", "registered"},
                       {"biometric_provider", biometricProvider},
                       {"quality_score", qualityScore},
                       {"user", authUserSessionJson(created,
                                                    sessionToken.token)}});
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
          std::string errCode;
          auto user = loginPasswordPg(gDatabaseUrl, company, username,
                                      hashPassword(password), dbError,
                                      &errCode);
          if (!user) {
            json::object jo{{"error", dbError}};
            if (!errCode.empty()) {
              jo["code"] = errCode;
            }
            return makeJsonResponse(http::status::unauthorized, jo);
          }
          found = *user;
          ok = true;
#else
          return makeJsonResponse(
              http::status::internal_server_error,
              json::object{{"error", "postgres support is not compiled"}});
#endif
        } else {
          const AuthUser *match = nullptr;
          size_t matchCount = 0;
          const auto users = loadAuthUsers(dataRoot);
          for (const auto &u : users) {
            if (u.company != company) {
              continue;
            }
            if (authIdentityKeyMatchesFsUser(username, u)) {
              match = &u;
              matchCount++;
            }
          }
          if (matchCount == 0) {
            appendAuthAuditLog(dataRoot, "login_password", company, username,
                               false, "user_not_found");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{{"error", std::string(kAuthUserNotFoundMsg)},
                               {"code", "user_not_found"}});
          }
          if (matchCount > 1) {
            appendAuthAuditLog(dataRoot, "login_password", company, username,
                               false, "ambiguous_identity");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{{"error", std::string(kAuthAmbiguousIdentityMsg)},
                               {"code", "ambiguous_identity"}});
          }
          if (match->passwordHash != hashPassword(password)) {
            appendAuthAuditLog(dataRoot, "login_password", company,
                               match->username, false, "invalid_password");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{{"error", std::string(kAuthWrongPasswordMsg)},
                               {"code", "wrong_password"}});
          }
          appendAuthAuditLog(dataRoot, "login_password", company,
                             match->username, true, "ok");
          found = *match;
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
                       {"user", authUserSessionJson(found, sessionToken.token)}});
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
        std::cout << "[AUTH_FACE] reject: missing/invalid company field"
                  << std::endl;
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid auth payload"}});
      }

      const bool hasTemplate =
          obj.if_contains("face_template") && obj.at("face_template").is_array();
      const bool hasImage = obj.if_contains("face_image_base64") &&
                            obj.at("face_image_base64").is_string();
      if (!hasTemplate && !hasImage) {
        std::cout << "[AUTH_FACE] reject: missing face_template/face_image_base64"
                  << std::endl;
        return makeJsonResponse(
            http::status::bad_request,
            json::object{{"error", "face_template or face_image_base64 is required"}});
      }

      std::string identityLogin;
      if (obj.if_contains("identity_login") && obj.at("identity_login").is_string()) {
        identityLogin = json::value_to<std::string>(obj.at("identity_login"));
      } else if (obj.if_contains("username") && obj.at("username").is_string()) {
        identityLogin = json::value_to<std::string>(obj.at("username"));
      }
      {
        const char *ws = " \t\n\r";
        const auto start = identityLogin.find_first_not_of(ws);
        if (start == std::string::npos) {
          identityLogin.clear();
        } else {
          const auto end = identityLogin.find_last_not_of(ws);
          identityLogin = identityLogin.substr(start, end - start + 1);
        }
      }
      if (identityLogin.empty()) {
        std::cout << "[AUTH_FACE] reject: empty identity_login; company="
                  << json::value_to<std::string>(obj.at("company"))
                  << " has_template=" << (hasTemplate ? "1" : "0")
                  << " has_image=" << (hasImage ? "1" : "0") << std::endl;
        return makeJsonResponse(
            http::status::bad_request,
            json::object{{"error",
                          "Indique usuario, DNI o RUC (campo identity_login) "
                          "junto con la empresa para el login facial."}});
      }

      const std::string company = json::value_to<std::string>(obj.at("company"));
      std::cout << "[AUTH_FACE] request: company=" << company
                << " identity=" << identityLogin
                << " has_template=" << (hasTemplate ? "1" : "0")
                << " has_image=" << (hasImage ? "1" : "0") << std::endl;
      // Umbrales solo desde el servidor (el cliente ya no debe fijar similitud mínima).
      const double legacyThreshold = gFaceLegacyCosineThreshold;

      std::vector<double> clientProbeTemplate;
      std::optional<std::vector<unsigned char>> rawImageBytes;
      std::optional<std::string> base64ForLegacy;
      if (hasTemplate) {
        for (const auto &v : obj.at("face_template").as_array()) {
          if (v.is_double()) {
            clientProbeTemplate.push_back(v.as_double());
          } else if (v.is_int64()) {
            clientProbeTemplate.push_back(static_cast<double>(v.as_int64()));
          } else {
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "face_template must be a numeric array"}});
          }
        }
      } else {
        const std::string base64Image =
            json::value_to<std::string>(obj.at("face_image_base64"));
        std::vector<unsigned char> raw;
        if (!decodeBase64(base64Image, raw) || raw.empty()) {
          return makeJsonResponse(http::status::bad_request,
                                  json::object{{"error", "invalid base64 image"}});
        }
        rawImageBytes = std::move(raw);
        base64ForLegacy = base64Image;
      }

      AuthUser bestUser;
      double bestScore = -1.0;
      bool ok = false;
      std::string biometricProvider = "legacy";
      {
        std::scoped_lock lk(gAuthMutex);
        if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
          std::string dbError;
          std::string probeProv;
          auto result = loginFaceTargetedPg(
              gDatabaseUrl, company, identityLogin, clientProbeTemplate,
              rawImageBytes, base64ForLegacy, legacyThreshold,
              gFaceEmbeddingCosineThreshold, dbError, &probeProv);
          if (!result) {
            std::cout << "[AUTH_FACE] postgres login failed: company=" << company
                      << " identity=" << identityLogin << " reason=" << dbError
                      << std::endl;
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", dbError}});
          }
          bestUser = result->first;
          bestScore = result->second;
          biometricProvider = probeProv.empty() ? "legacy" : probeProv;
          ok = true;
#else
          return makeJsonResponse(
              http::status::internal_server_error,
              json::object{{"error", "postgres support is not compiled"}});
#endif
        } else {
          const auto users = loadAuthUsers(dataRoot);

          const AuthUser *match = nullptr;
          size_t matchCount = 0;
          for (const auto &u : users) {
            if (u.company != company) {
              continue;
            }
            if (authIdentityKeyMatchesFsUser(identityLogin, u)) {
              match = &u;
              matchCount++;
            }
          }

          if (matchCount == 0) {
            std::cout << "[AUTH_FACE] no user for identity in company: "
                      << company << " / " << identityLogin << std::endl;
            appendAuthAuditLog(dataRoot, "login_face", company, "unknown",
                               false, "no_user_for_identity");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{{"error", std::string(kAuthUserNotFoundMsg)}});
          }
          if (matchCount > 1) {
            std::cout << "[AUTH_FACE] ambiguous identity in company: " << company
                      << " / " << identityLogin << std::endl;
            appendAuthAuditLog(dataRoot, "login_face", company, "unknown",
                               false, "ambiguous_identity");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{
                    {"error",
                     "El identificador coincide con más de un registro en esa "
                     "empresa. Use un dato único e intente de nuevo."}});
          }

          if (match->faceTemplate.size() < 100) {
            appendAuthAuditLog(dataRoot, "login_face", company, match->username,
                               false, "template_too_short");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{
                    {"error",
                     "El usuario indicado no tiene biometría facial registrada "
                     "de forma completa. Registre el rostro e intente de "
                     "nuevo."}});
          }
          std::vector<double> probe;
          std::string probeProv;
          double useThr = legacyThreshold;
          std::string probeErr;
          if (!buildFaceLoginProbe(clientProbeTemplate, rawImageBytes,
                                   base64ForLegacy, match->faceTemplate, probe,
                                   probeProv, useThr, legacyThreshold,
                                   gFaceEmbeddingCosineThreshold, probeErr)) {
            std::cout << "[AUTH_FACE] probe build failed for user="
                      << match->username << " reason=" << probeErr << std::endl;
            appendAuthAuditLog(dataRoot, "login_face", company, match->username,
                               false, "probe_build_failed");
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", probeErr}});
          }
          bestScore = cosineSimilarity(probe, match->faceTemplate);
          if (bestScore < useThr) {
            std::cout << "[AUTH_FACE] score below threshold user="
                      << match->username << " score=" << bestScore
                      << " threshold=" << useThr << " provider=" << probeProv
                      << std::endl;
            appendAuthAuditLog(dataRoot, "login_face", company, match->username,
                               false, "no_match");
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{
                    {"error",
                     "La biometría facial no coincide con el usuario indicado. "
                     "Verifique su identidad y vuelva a intentar."}});
          }
          appendAuthAuditLog(
              dataRoot, "login_face", company, match->username, true,
              "ok score=" + std::to_string(bestScore) + " probe=" + probeProv);
          bestUser = *match;
          biometricProvider =
              probeProv.empty() ? "legacy" : probeProv;
          ok = true;
        }
      }

      if (!ok) {
        std::cout << "[AUTH_FACE] failed: unknown reason company=" << company
                  << " identity=" << identityLogin << std::endl;
        return makeJsonResponse(
            http::status::unauthorized,
            json::object{
                {"error",
                 "No se pudo completar el inicio de sesión facial. Intente de "
                 "nuevo."}});
      }

        const auto sessionToken = issueAuthSession(bestUser);
        std::cout << "[AUTH_FACE] success user=" << bestUser.username
                  << " company=" << bestUser.company
                  << " provider=" << biometricProvider
                  << " score=" << bestScore << std::endl;

        return makeJsonResponse(
          http::status::ok,
          json::object{{"status", "authenticated"},
                       {"method", "face"},
                       {"biometric_provider", biometricProvider},
                       {"score", bestScore},
                       {"user", authUserSessionJson(bestUser, sessionToken.token)}});
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
            {"status", r.status}, {"created_at", r.createdAt}, {"updated_at", r.updatedAt},
            {"company_name", r.company},
            {"createdAt", r.createdAt}, {"updatedAt", r.updatedAt}, {"company", r.company}
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
      if (getReportByIdPg(gDatabaseUrl, rest, session->company, r, error)) {
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
                         {"updated_at", r.updatedAt},
                         {"company_name", r.company},
                         {"createdAt", r.createdAt},
                         {"updatedAt", r.updatedAt},
                         {"company", r.company}});
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
        if (updateReportPg(gDatabaseUrl, id, session->company, r, error)) {
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
    if (deleteReportPg(gDatabaseUrl, id, session->company, error)) {
        return makeJsonResponse(http::status::ok, json::object{{"status", "deleted"}});
    }
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/formula/dictionary") {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
#if HAS_LIBPQ
    PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
    if (PQstatus(conn) == CONNECTION_OK) {
      if (ensureAuthSchemaPg(conn)) {
        PGresult *res = PQexec(conn, "SELECT code, display_name, category, data_type, unit, description, example_value, sort_order FROM formula_data_dictionary WHERE is_active = TRUE ORDER BY sort_order, display_name");
        if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
          json::array items;
          for (int i = 0; i < PQntuples(res); ++i) {
            items.push_back(json::object{
              {"code", PQgetvalue(res, i, 0)},
              {"display_name", PQgetvalue(res, i, 1)},
              {"category", PQgetvalue(res, i, 2)},
              {"data_type", PQgetvalue(res, i, 3)},
              {"unit", PQgetisnull(res, i, 4) ? "" : std::string(PQgetvalue(res, i, 4))},
              {"description", PQgetvalue(res, i, 5)},
              {"example_value", PQgetisnull(res, i, 6) ? "" : std::string(PQgetvalue(res, i, 6))},
              {"sort_order", std::atoi(PQgetvalue(res, i, 7))}
            });
          }
          PQclear(res);
          PQfinish(conn);
          return makeJsonResponse(http::status::ok, json::object{{"items", items}});
        }
        if (res) PQclear(res);
      }
    }
    if (conn) PQfinish(conn);
#endif
    return makeJsonResponse(http::status::ok, json::object{{"items", json::array()}});
  }

  if (req.method() == http::verb::get && pathOnly == "/api/analysis/catalogos") {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
    const std::string formulaCompany = trimCompanyName(session->company);
#if HAS_LIBPQ
    PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
    if (PQstatus(conn) == CONNECTION_OK && ensureFormulaSchemaPg(conn, formulaCompany)) {
      std::string sql =
          "SELECT empresa_id, empresa_codigo, empresa_nombre, mina_id, mina_codigo, mina_nombre, zona_tipo, "
          "umbral_temp_alerta, sensor_id, sensor_codigo, sensor_nombre, variable_id, variable_codigo, variable_nombre, unidad "
          "FROM v_mineria_catalogos WHERE empresa_nombre = " + pqEscapeLiteral(conn, formulaCompany) +
          " ORDER BY mina_codigo";
      PGresult *res = PQexec(conn, sql.c_str());
      if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
        json::array rows;
        for (int i = 0; i < PQntuples(res); ++i) {
          rows.push_back(json::object{
              {"empresa_id", std::atoi(PQgetvalue(res, i, 0))},
              {"empresa_codigo", PQgetvalue(res, i, 1)},
              {"empresa_nombre", PQgetvalue(res, i, 2)},
              {"mina_id", std::atoi(PQgetvalue(res, i, 3))},
              {"mina_codigo", PQgetvalue(res, i, 4)},
              {"mina_nombre", PQgetvalue(res, i, 5)},
              {"zona_tipo", PQgetisnull(res, i, 6) ? "" : std::string(PQgetvalue(res, i, 6))},
              {"umbral_temp_alerta", std::atof(PQgetvalue(res, i, 7))},
              {"sensor_id", std::atoi(PQgetvalue(res, i, 8))},
              {"sensor_codigo", PQgetvalue(res, i, 9)},
              {"sensor_nombre", PQgetvalue(res, i, 10)},
              {"variable_id", std::atoi(PQgetvalue(res, i, 11))},
              {"variable_codigo", PQgetvalue(res, i, 12)},
              {"variable_nombre", PQgetvalue(res, i, 13)},
              {"unidad", PQgetisnull(res, i, 14) ? "" : std::string(PQgetvalue(res, i, 14))}
          });
        }
        PQclear(res);
        std::string usersSql =
            "SELECT username FROM auth_users WHERE TRIM(company_name) = " + pqEscapeLiteral(conn, formulaCompany) +
            " ORDER BY username";
        PGresult *uRes = PQexec(conn, usersSql.c_str());
        json::array usuarios;
        if (uRes && PQresultStatus(uRes) == PGRES_TUPLES_OK) {
          for (int i = 0; i < PQntuples(uRes); ++i) {
            usuarios.push_back(PQgetvalue(uRes, i, 0));
          }
        }
        if (uRes) PQclear(uRes);
        PQfinish(conn);
        return makeJsonResponse(http::status::ok, json::object{{"rows", rows}, {"usuarios", usuarios}});
      }
      if (res) PQclear(res);
    }
    if (conn) PQfinish(conn);
#endif
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "analysis_catalog_error"}});
  }

  if (req.method() == http::verb::post && pathOnly == "/api/analysis/temperaturas") {
    const auto session = resolveAuthSession(req, query);
    if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
    try {
      auto body = json::parse(req.body()).as_object();
      int minaId = body.if_contains("mina_id") ? static_cast<int>(json::value_to<int64_t>(body.at("mina_id"))) : 0;
      int sensorId = body.if_contains("sensor_id") ? static_cast<int>(json::value_to<int64_t>(body.at("sensor_id"))) : 0;
      std::string usuario = body.if_contains("usuario") ? json::value_to<std::string>(body.at("usuario")) : "";
      std::string fechaInicio = body.if_contains("fecha_inicio") ? json::value_to<std::string>(body.at("fecha_inicio")) : "";
      std::string fechaFin = body.if_contains("fecha_fin") ? json::value_to<std::string>(body.at("fecha_fin")) : "";
      if (minaId <= 0 || sensorId <= 0 || usuario.empty() || fechaInicio.empty() || fechaFin.empty()) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "mina_id, sensor_id, usuario, fecha_inicio y fecha_fin son requeridos"}});
      }
      const std::string formulaCompany = trimCompanyName(session->company);
#if HAS_LIBPQ
      PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
      if (PQstatus(conn) == CONNECTION_OK && ensureFormulaSchemaPg(conn, formulaCompany)) {
        const std::string findEmpresa =
            "SELECT id::text FROM mineria_empresas WHERE nombre = " + pqEscapeLiteral(conn, formulaCompany) + " LIMIT 1";
        PGresult *empresaRes = PQexec(conn, findEmpresa.c_str());
        if (!empresaRes || PQresultStatus(empresaRes) != PGRES_TUPLES_OK || PQntuples(empresaRes) < 1) {
          if (empresaRes) PQclear(empresaRes);
          PQfinish(conn);
          return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "empresa_not_found"}});
        }
        const std::string empresaId = PQgetvalue(empresaRes, 0, 0);
        PQclear(empresaRes);
        const std::string findVariableSql =
            "SELECT variable_id::text FROM mineria_sensores WHERE id = " + pqEscapeLiteral(conn, std::to_string(sensorId)) +
            " AND empresa_id = " + pqEscapeLiteral(conn, empresaId) +
            " AND mina_id = " + pqEscapeLiteral(conn, std::to_string(minaId)) + " LIMIT 1";
        PGresult *varRes = PQexec(conn, findVariableSql.c_str());
        if (!varRes || PQresultStatus(varRes) != PGRES_TUPLES_OK || PQntuples(varRes) < 1) {
          if (varRes) PQclear(varRes);
          PQfinish(conn);
          return makeJsonResponse(http::status::bad_request, json::object{{"error", "sensor_no_valido_para_empresa_y_mina"}});
        }
        const std::string variableId = PQgetvalue(varRes, 0, 0);
        PQclear(varRes);
        std::string sql =
            "SELECT timestamp_lectura::text, valor_original::double precision, calidad, umbral_alerta::double precision, "
            "condicion_resultado, valor_procesado::double precision, descripcion "
            "FROM sp_proceso_temperatura(" + pqEscapeLiteral(conn, empresaId) + "::integer," +
            pqEscapeLiteral(conn, std::to_string(minaId)) + "::integer," +
            pqEscapeLiteral(conn, variableId) + "::integer," +
            pqEscapeLiteral(conn, fechaInicio) + "::timestamptz," +
            pqEscapeLiteral(conn, fechaFin) + "::timestamptz)";
        PGresult *res = PQexec(conn, sql.c_str());
        if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
          json::array data;
          int totalSi = 0;
          for (int i = 0; i < PQntuples(res); ++i) {
            const std::string cond = PQgetvalue(res, i, 4);
            if (cond == "SI") totalSi++;
            data.push_back(json::object{
              {"timestamp_lectura", PQgetvalue(res, i, 0)},
              {"valor_original", std::atof(PQgetvalue(res, i, 1))},
              {"calidad", std::atoi(PQgetvalue(res, i, 2))},
              {"umbral_alerta", std::atof(PQgetvalue(res, i, 3))},
              {"condicion_resultado", cond},
              {"valor_procesado", std::atof(PQgetvalue(res, i, 5))},
              {"descripcion", PQgetvalue(res, i, 6)}
            });
          }
          int total = PQntuples(res);
          PQclear(res);
          PQfinish(conn);
          double pctAlertas = total > 0 ? (100.0 * static_cast<double>(totalSi) / static_cast<double>(total)) : 0.0;
          return makeJsonResponse(http::status::ok, json::object{
            {"rows", data},
            {"summary", json::object{{"usuario", usuario}, {"total_lecturas", total}, {"total_si", totalSi}, {"total_no", total - totalSi}, {"pct_alertas", pctAlertas}}}
          });
        }
        if (res) PQclear(res);
      }
      if (conn) PQfinish(conn);
#endif
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "analysis_execution_error"}});
    } catch (...) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_payload"}});
    }
  }

  const auto buildAuthLoginCheckIdentityResponse =
      [&](std::string companyRaw, std::string identityRaw)
      -> http::response<http::string_body> {
        auto trimAuthParam = [](std::string s) -> std::string {
          const char *ws = " \t\n\r";
          const auto a = s.find_first_not_of(ws);
          if (a == std::string::npos) {
            return {};
          }
          const auto b = s.find_last_not_of(ws);
          return s.substr(a, b - a + 1);
        };
        std::string company = trimAuthParam(std::move(companyRaw));
        std::string identity = trimAuthParam(std::move(identityRaw));
        if (company.empty() || identity.empty()) {
          return makeJsonResponse(
              http::status::bad_request,
              json::object{
                  {"ok", false},
                  {"reason", "bad_request"},
                  {"error",
                   "Indique empresa e identificador (Usuario, DNI o RUC)."}});
        }
        AuthLoginIdentityLookupResult lu;
        {
          std::scoped_lock lk(gAuthMutex);
          if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
            lu = authLookupIdentityForCompanyPg(gDatabaseUrl, company, identity);
#else
            lu.kind = AuthLoginIdentityLookupResult::Kind::DbError;
            lu.diagnostic = "postgres support is not compiled";
#endif
          } else {
            lu = authLookupIdentityForCompanyFs(dataRoot, company, identity);
          }
        }
        using ILKind = AuthLoginIdentityLookupResult::Kind;
        if (lu.kind == ILKind::DbError) {
          return makeJsonResponse(
              http::status::internal_server_error,
              json::object{
                  {"ok", false},
                  {"reason", "server_error"},
                  {"error",
                   lu.diagnostic.empty() ? "No se pudo comprobar el usuario."
                                        : lu.diagnostic}});
        }
        if (lu.kind == ILKind::NotFound) {
          return makeJsonResponse(
              http::status::ok,
              json::object{{"ok", false},
                           {"reason", "not_found"},
                           {"error", std::string(kAuthUserNotFoundMsg)}});
        }
        if (lu.kind == ILKind::Ambiguous) {
          return makeJsonResponse(
              http::status::ok,
              json::object{{"ok", false},
                           {"reason", "ambiguous"},
                           {"error", std::string(kAuthAmbiguousIdentityMsg)}});
        }
        return makeJsonResponse(
            http::status::ok,
            json::object{{"ok", true}, {"username", lu.resolvedUsername}});
      };

  if (req.method() == http::verb::get &&
      pathOnly == "/api/auth/login/check-identity") {
    const std::string company =
        query.count("company") ? query.at("company") : "";
    const std::string identity =
        query.count("identity") ? query.at("identity") : "";
    return buildAuthLoginCheckIdentityResponse(company, identity);
  }

  if (req.method() == http::verb::post &&
      pathOnly == "/api/auth/login/check-identity") {
    try {
      auto val = json::parse(req.body());
      if (!val.is_object()) {
        return makeJsonResponse(
            http::status::bad_request,
            json::object{{"ok", false},
                         {"reason", "bad_request"},
                         {"error", "invalid JSON body"}});
      }
      const auto &obj = val.as_object();
      std::string company;
      std::string identity;
      if (obj.if_contains("company") && obj.at("company").is_string()) {
        company = json::value_to<std::string>(obj.at("company"));
      }
      if (obj.if_contains("identity") && obj.at("identity").is_string()) {
        identity = json::value_to<std::string>(obj.at("identity"));
      } else if (obj.if_contains("username") &&
                 obj.at("username").is_string()) {
        identity = json::value_to<std::string>(obj.at("username"));
      }
      return buildAuthLoginCheckIdentityResponse(std::move(company),
                                                 std::move(identity));
    } catch (const std::exception &) {
      return makeJsonResponse(
          http::status::bad_request,
          json::object{{"ok", false},
                       {"reason", "bad_request"},
                       {"error", "invalid JSON body"}});
    }
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
    gCartoonOnnxModelPath = getenvOr("CARTOON_ONNX_MODEL", "");
    try {
      gAiEngineTimeoutMs = std::clamp(
          std::stoi(getenvOr("AI_ENGINE_TIMEOUT_MS", "500")), 50, 5000);
    } catch (...) {
      gAiEngineTimeoutMs = 500;
    }
    try {
      gAiEngineCartoonTimeoutMs = std::clamp(
          std::stoi(getenvOr("AI_ENGINE_CARTOON_TIMEOUT_MS", "8000")), 500,
          600000);
    } catch (...) {
      gAiEngineCartoonTimeoutMs = 8000;
    }
    try {
      gAiEngineMaxImageBytes = static_cast<std::size_t>(std::clamp(
          std::stoi(getenvOr("AI_ENGINE_MAX_IMAGE_BYTES", "450000")), 100000,
          6000000));
    } catch (...) {
      gAiEngineMaxImageBytes = 450000;
    }
    try {
      gFaceEmbeddingCosineThreshold = std::clamp(
          std::stod(getenvOr("FACE_EMBEDDING_COSINE_THRESHOLD", "0.45")), 0.20,
          0.99);
    } catch (...) {
      gFaceEmbeddingCosineThreshold = 0.45;
    }
    try {
      gFaceLegacyCosineThreshold = std::clamp(
          std::stod(getenvOr("FACE_LEGACY_COSINE_THRESHOLD", "0.82")), 0.55,
          0.99);
    } catch (...) {
      gFaceLegacyCosineThreshold = 0.82;
    }
    try {
      gBiometricIcaoEyeConfidenceMin = static_cast<float>(std::clamp(
          std::stod(getenvOr("BIOMETRIC_ICAO_EYE_CONFIDENCE_MIN", "70")), 50.0,
          100.0));
    } catch (...) {
      gBiometricIcaoEyeConfidenceMin = 70.0f;
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
    std::cout << "cartoon_onnx: linked=" << (informeCartoonOnnxRuntimeLinked() ? "true" : "false")
              << ", model="
              << (gCartoonOnnxModelPath.empty() ? "(none)" : gCartoonOnnxModelPath)
              << ", exists="
              << ((!gCartoonOnnxModelPath.empty() && fs::exists(gCartoonOnnxModelPath))
                      ? "true"
                      : "false")
              << std::endl;
    std::cout << "ai_engine_url: "
              << (gAiEngineUrl.empty() ? "(disabled)" : gAiEngineUrl)
              << ", timeout_ms: " << gAiEngineTimeoutMs
              << ", cartoon_timeout_ms: " << gAiEngineCartoonTimeoutMs
              << ", max_image_bytes: " << gAiEngineMaxImageBytes
              << ", face_embed_cos_thr: " << gFaceEmbeddingCosineThreshold
              << ", face_legacy_cos_thr: " << gFaceLegacyCosineThreshold
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
