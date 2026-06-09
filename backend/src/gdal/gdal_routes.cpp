#include "gdal_routes.hpp"
#include "conversion_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../onnx_cartoon.hpp"
#include "../vision_pipeline.hpp"

#include <filesystem>
#include <fstream>
#include <thread>

namespace fs = std::filesystem;
using http_utils::makeJsonResponse;
using http_utils::makeJpegResponse;
using config::AppConfig;

namespace gdal_mod {

static http::response<http::string_body>
handleCapabilities(const http::request<http::string_body> & /*req*/,
                   const std::unordered_map<std::string, std::string> & /*query*/) {
    return makeJsonResponse(http::status::ok,
                            json::object{{"ecw_supported", gdalSupportsEcw()}});
}

static http::response<http::string_body>
handleConvert(const http::request<http::string_body> &req,
              const std::unordered_map<std::string, std::string> & /*query*/) {
    try {
        auto val = json::parse(req.body());
        if (!val.is_object())
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid JSON body"}});

        ConvertRequest cReq;
        std::string error;
        if (!parseConvertRequest(val.as_object(), cReq, error))
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", error}});

        std::string id = http_utils::makeId();
        Job job;
        job.id = id;
        job.status = "queued";
        job.createdAt = http_utils::nowIso8601();
        job.updatedAt = job.createdAt;
        job.logs.push_back("Job accepted");

        {
            std::scoped_lock lk(gJobsMutex);
            gJobs[id] = job;
        }

        std::string dataRoot = config::getenvOr("MAPAS_DATA_ROOT", "/data");
        std::thread(runConversionJob, id, cReq, dataRoot).detach();

        return makeJsonResponse(http::status::accepted,
                                json::object{{"job_id", id}, {"status", "queued"}});
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

static http::response<http::string_body>
handleGetJob(const http::request<http::string_body> &req,
             const std::unordered_map<std::string, std::string> & /*query*/) {
    const std::string target = std::string(req.target());
    const std::string pathOnly = http_utils::routePathOnly(target);
    std::string id = pathOnly.substr(std::string("/api/jobs/").size());
    if (id.empty())
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "missing job id"}});
    auto job = getJob(id);
    if (!job)
        return makeJsonResponse(http::status::not_found,
                                json::object{{"error", "job not found"}});
    return makeJsonResponse(http::status::ok, jobToJson(*job));
}

static http::response<http::string_body>
handleAnalyzeCore(const http::request<http::string_body> &req,
                  const std::unordered_map<std::string, std::string> & /*query*/) {
    try {
        auto val = json::parse(req.body());
        if (!val.is_object() || !val.as_object().contains("image_path"))
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "image_path is required"}});

        std::string imgPath = json::value_to<std::string>(val.at("image_path"));
        auto result = mining::VisionPipeline::processDrillholeImage(imgPath);

        if (!result.success)
            return makeJsonResponse(http::status::internal_server_error,
                                    json::object{{"error", result.message}});

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

static http::response<http::string_body>
handleDemoData(const http::request<http::string_body> & /*req*/,
               const std::unordered_map<std::string, std::string> & /*query*/) {
    json::array assets;
    assets.push_back({{"id", "demo-1"}, {"type", "image"},
                      {"title", "Testigo T-45"}, {"url", "/data/incoming/test.jpg"}});
    assets.push_back({{"id", "demo-2"}, {"type", "video"},
                      {"title", "Análisis Fracturas"}, {"url", "/data/demo/fracture_analysis.mp4"}});
    assets.push_back({{"id", "demo-3"}, {"type", "3d_model"},
                      {"title", "Modelo Geomecánico"}, {"url", "/data/demo/drillhole_demo.glb"}});
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "success"}, {"assets", assets}});
}

static http::response<http::string_body>
handleDemoImage(const http::request<http::string_body> & /*req*/,
                const std::unordered_map<std::string, std::string> & /*query*/) {
    std::string dataRoot = config::getenvOr("MAPAS_DATA_ROOT", "/data");
    std::string path = dataRoot + "/incoming/test.jpg";
    if (!fs::exists(path))
        return makeJsonResponse(http::status::not_found,
                                json::object{{"error", "image not found"}});
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

static http::response<http::string_body>
handleHealth(const http::request<http::string_body> & /*req*/,
             const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    json::object health{{"status", "ok"},
                        {"cartoon_onnx_linked", informeCartoonOnnxRuntimeLinked()},
                        {"cartoon_onnx_model", cfg.gCartoonOnnxModelPath},
                        {"cartoon_onnx_model_exists",
                         !cfg.gCartoonOnnxModelPath.empty() &&
                             fs::exists(cfg.gCartoonOnnxModelPath)},
                        {"text_spell_backend", true}};
    return makeJsonResponse(http::status::ok, health);
}

void registerRoutes(router::Router &r) {
    r.get("/health", handleHealth);
    r.get("/api/capabilities", handleCapabilities);
    r.get("/api/demo-data", handleDemoData);
    r.get("/api/demo-image/", handleDemoImage);
    r.post("/api/convert", handleConvert);
    r.get("/api/jobs/", handleGetJob);
    r.post("/api/analyze-core", handleAnalyzeCore);
}

} // namespace gdal_mod
