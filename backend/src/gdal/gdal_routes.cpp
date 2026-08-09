#include "gdal_routes.hpp"
#include "conversion_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../security/validators.hpp"
#include "../onnx_cartoon.hpp"
#include "../vision_pipeline.hpp"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <thread>

namespace fs = std::filesystem;
using http_utils::makeJsonResponse;
using http_utils::makeJpegResponse;
using config::AppConfig;
using auth::resolveAuthSession;

namespace gdal_mod {

static bool isPathWithin(const fs::path &root, const fs::path &candidate) {
    std::error_code ec;
    const fs::path normalizedRoot = fs::weakly_canonical(root, ec);
    if (ec) return false;
    const fs::path normalizedCandidate = fs::weakly_canonical(candidate, ec);
    if (ec) return false;
    const fs::path rel = normalizedCandidate.lexically_relative(normalizedRoot);
    if (rel.empty()) return normalizedCandidate == normalizedRoot;
    if (rel.is_absolute()) return false;
    const auto first = rel.begin();
    return first == rel.end() || *first != fs::path("..");
}

static bool hasSupportedRasterExtension(const fs::path &path) {
    std::string ext = path.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return ext == ".ecw" || ext == ".tif" || ext == ".tiff";
}

static bool hasSupportedImageExtension(const fs::path &path) {
    std::string ext = path.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return ext == ".jpg" || ext == ".jpeg" || ext == ".png" ||
           ext == ".tif" || ext == ".tiff";
}

static http::response<http::string_body>
handleCapabilities(const http::request<http::string_body> & /*req*/,
                   const std::unordered_map<std::string, std::string> & /*query*/) {
    return makeJsonResponse(http::status::ok,
                            json::object{{"ecw_supported", gdalSupportsEcw()}});
}

static http::response<http::string_body>
handleConvert(const http::request<http::string_body> &req,
              const std::unordered_map<std::string, std::string> &query) {
    // Fix (auditoría de seguridad 2026-07-13): este endpoint no exigía sesión
    // — cualquiera sin login podía encolar un job de conversión con
    // input_path/output_path arbitrarios (lectura/escritura de archivos sin
    // restricción). Ahora exige sesión autenticada y rechaza paths con
    // traversal (..) o metacaracteres de shell antes de encolar el job.
    const auto session = resolveAuthSession(req, query);
    if (!session) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
    if (session->role != "admin") {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "admin_only"}});
    }
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
        if (!security::Validator::isShellSafe(cReq.inputPath) ||
            (!cReq.outputPath.empty() && !security::Validator::isShellSafe(cReq.outputPath))) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid_path"}});
        }
        const fs::path dataRoot =
            fs::path(config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data"));
        const fs::path inputPath = fs::path(cReq.inputPath).is_absolute()
                                       ? fs::path(cReq.inputPath)
                                       : dataRoot / cReq.inputPath;
        const fs::path outputPath = cReq.outputPath.empty()
                                        ? dataRoot / "tiles" / cReq.outputName
                                        : (fs::path(cReq.outputPath).is_absolute()
                                               ? fs::path(cReq.outputPath)
                                               : dataRoot / cReq.outputPath);
        if (!isPathWithin(dataRoot, inputPath) ||
            !isPathWithin(dataRoot / "tiles", outputPath) ||
            !fs::is_regular_file(inputPath) ||
            !hasSupportedRasterExtension(inputPath)) {
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "path_outside_allowed_root_or_invalid_raster"}});
        }
        cReq.inputPath = fs::weakly_canonical(inputPath).string();
        cReq.outputPath = fs::weakly_canonical(outputPath).string();

        std::string id = http_utils::makeId();
        Job job;
        job.id = id;
        job.ownerUserId = session->userId;
        job.ownerTenantId = session->tenantId;
        job.status = "queued";
        job.createdAt = http_utils::nowIso8601();
        job.updatedAt = job.createdAt;
        job.logs.push_back("Job accepted");

        {
            std::scoped_lock lk(gJobsMutex);
            gJobs[id] = job;
        }

        std::thread(runConversionJob, id, cReq, dataRoot.string()).detach();

        return makeJsonResponse(http::status::accepted,
                                json::object{{"job_id", id}, {"status", "queued"}});
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

static http::response<http::string_body>
handleGetJob(const http::request<http::string_body> &req,
             const std::unordered_map<std::string, std::string> &query) {
    const auto session = resolveAuthSession(req, query);
    if (!session) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
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
    if (session->role != "admin" &&
        (job->ownerUserId != session->userId ||
         job->ownerTenantId != session->tenantId)) {
        return makeJsonResponse(http::status::not_found,
                                json::object{{"error", "job not found"}});
    }
    return makeJsonResponse(http::status::ok, jobToJson(*job));
}

static http::response<http::string_body>
handleAnalyzeCore(const http::request<http::string_body> &req,
                  const std::unordered_map<std::string, std::string> &query) {
    // Fix (auditoría de seguridad 2026-07-13): sin sesión ni validación de
    // path — cualquiera podía pedir análisis de un image_path arbitrario del
    // sistema de archivos del servidor.
    const auto session = resolveAuthSession(req, query);
    if (!session) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
    if (session->role != "admin") {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "admin_only"}});
    }
    try {
        auto val = json::parse(req.body());
        if (!val.is_object() || !val.as_object().contains("image_path"))
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "image_path is required"}});

        std::string imgPath = json::value_to<std::string>(val.at("image_path"));
        if (!security::Validator::isShellSafe(imgPath)) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid_path"}});
        }
        const fs::path dataRoot =
            fs::path(config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data"));
        const fs::path requestedPath = fs::path(imgPath).is_absolute()
                                           ? fs::path(imgPath)
                                           : dataRoot / imgPath;
        if (!isPathWithin(dataRoot, requestedPath) ||
            !fs::is_regular_file(requestedPath) ||
            !hasSupportedImageExtension(requestedPath)) {
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "path_outside_allowed_root_or_invalid_image"}});
        }
        const std::string canonicalPath =
            fs::weakly_canonical(requestedPath).string();
        auto result =
            mining::VisionPipeline::processDrillholeImage(canonicalPath);

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
handleDemoData(const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &query) {
    if (!resolveAuthSession(req, query)) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
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
handleDemoImage(const http::request<http::string_body> &req,
                const std::unordered_map<std::string, std::string> &query) {
    if (!resolveAuthSession(req, query)) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
    std::string dataRoot = config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
    std::string path = dataRoot + "/incoming/test.jpg";
    if (!fs::exists(path))
        return makeJsonResponse(http::status::not_found,
                                json::object{{"error", "image not found"}});
    std::ifstream ifs(path, std::ios::binary);
    std::string content((std::istreambuf_iterator<char>(ifs)),
                        (std::istreambuf_iterator<char>()));
    http::response<http::string_body> res{http::status::ok, 11};
    res.set(http::field::content_type, "image/jpeg");
    res.set(http::field::access_control_allow_origin,
            http_utils::corsAllowedOrigin());
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
    // Alias bajo /api/: nginx solo proxifica location /api/ hacia el backend
    // (ver frontend/nginx.conf), así que el heartbeat de conectividad del
    // navegador (connectivityMonitor.ts) necesita esta ruta para llegar sin
    // agregar un location nuevo en nginx.
    r.get("/api/health", handleHealth);
    r.get("/api/capabilities", handleCapabilities);
    r.get("/api/demo-data", handleDemoData);
    r.get("/api/demo-image/", handleDemoImage);
    r.post("/api/convert", handleConvert);
    r.get("/api/jobs/", handleGetJob);
    r.post("/api/analyze-core", handleAnalyzeCore);
}

} // namespace gdal_mod
