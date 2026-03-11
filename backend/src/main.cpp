#include <boost/asio.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/version.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/json.hpp>

#include "vision_pipeline.hpp"
#include "websocket_session.hpp"
#include <opencv2/opencv.hpp>

#include <atomic>
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
#include <string>
#include <thread>
#include <vector>

namespace asio = boost::asio;
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

std::mutex gJobsMutex;
std::map<std::string, Job> gJobs;

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

std::string makeId() {
  static thread_local std::mt19937_64 rng{std::random_device{}()};
  std::uniform_int_distribution<unsigned long long> dist;
  std::ostringstream oss;
  oss << std::hex << dist(rng) << dist(rng);
  return oss.str();
}

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
  res.set(http::field::access_control_allow_headers, "content-type");
  res.set(http::field::access_control_allow_methods, "GET,POST,OPTIONS");
  res.body() = json::serialize(value);
  res.prepare_payload();
  return res;
}

http::response<http::string_body>
routeRequest(const http::request<http::string_body> &req,
             const std::string &dataRoot) {
  const std::string target = std::string(req.target());

  if (req.method() == http::verb::options) {
    return makeJsonResponse(http::status::ok, json::object{{"ok", true}});
  }

  if (req.method() == http::verb::get && target == "/health") {
    return makeJsonResponse(http::status::ok, json::object{{"status", "ok"}});
  }

  if (req.method() == http::verb::get && target == "/api/capabilities") {
    return makeJsonResponse(http::status::ok,
                            json::object{{"ecw_supported", gdalSupportsEcw()}});
  }

  if (req.method() == http::verb::get && target == "/api/demo-data") {
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
      target.starts_with("/api/demo-image")) {
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

  if (req.method() == http::verb::post && target == "/api/convert") {
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

  if (req.method() == http::verb::get && target.starts_with("/api/jobs/")) {
    std::string id = target.substr(std::string("/api/jobs/").size());
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

  if (req.method() == http::verb::post && target == "/api/analyze-core") {
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

    asio::io_context ioc{1};
    asio::ip::tcp::acceptor acceptor{
        ioc,
        {asio::ip::make_address(address), static_cast<unsigned short>(port)}};

    std::cout << "mapas_backend listening on " << address << ":" << port
              << std::endl;

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
