#include "conversion_service.hpp"
#include "../http/http_utils.hpp"
#include "../config/app_config.hpp"
#include "../security/validators.hpp"

#include <cstdio>
#include <cstdlib>
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <regex>
#include <set>
#include <sstream>

#include <opencv2/opencv.hpp>

namespace fs = std::filesystem;

namespace gdal_mod {

std::mutex gJobsMutex;
std::map<std::string, Job> gJobs;

bool parseConvertRequest(const json::object &obj, ConvertRequest &out,
                         std::string &error) {
    if (!obj.contains("input_path") || !obj.at("input_path").is_string()) {
        error = "input_path is required (string)";
        return false;
    }
    out.inputPath = json::value_to<std::string>(obj.at("input_path"));

    if (obj.if_contains("output_path") && obj.at("output_path").is_string())
        out.outputPath = json::value_to<std::string>(obj.at("output_path"));

    out.outputName =
        obj.if_contains("output_name") && obj.at("output_name").is_string()
            ? json::value_to<std::string>(obj.at("output_name"))
            : (fs::path(out.inputPath).stem().string() + ".mbtiles");
    if (!out.outputName.ends_with(".mbtiles")) out.outputName += ".mbtiles";
    if (!out.outputPath.empty() && !out.outputPath.ends_with(".mbtiles"))
        out.outputPath += ".mbtiles";

    if (obj.if_contains("min_zoom") && obj.at("min_zoom").is_int64())
        out.minZoom = static_cast<int>(obj.at("min_zoom").as_int64());
    if (obj.if_contains("max_zoom") && obj.at("max_zoom").is_int64())
        out.maxZoom = static_cast<int>(obj.at("max_zoom").as_int64());
    if (obj.if_contains("compression") && obj.at("compression").is_string())
        out.compression = json::value_to<std::string>(obj.at("compression"));
    if (obj.if_contains("quality") && obj.at("quality").is_int64())
        out.quality = static_cast<int>(obj.at("quality").as_int64());
    if (obj.if_contains("resampling") && obj.at("resampling").is_string())
        out.resampling = json::value_to<std::string>(obj.at("resampling"));

    std::transform(out.compression.begin(), out.compression.end(),
                   out.compression.begin(), [](unsigned char c) {
                       return static_cast<char>(std::toupper(c));
                   });
    std::transform(out.resampling.begin(), out.resampling.end(),
                   out.resampling.begin(), [](unsigned char c) {
                       return static_cast<char>(std::tolower(c));
                   });

    if (out.minZoom < 0 || out.maxZoom < out.minZoom || out.maxZoom > 24) {
        error = "invalid zoom range";
        return false;
    }
    if (out.quality < 1 || out.quality > 100) {
        error = "quality must be between 1 and 100";
        return false;
    }
    static const std::set<std::string> kCompression = {"JPEG", "PNG"};
    static const std::set<std::string> kResampling = {
        "nearest", "bilinear", "cubic", "cubicspline",
        "lanczos", "average", "rms", "mode",
    };
    if (!kCompression.contains(out.compression)) {
        error = "compression must be JPEG or PNG";
        return false;
    }
    if (!kResampling.contains(out.resampling)) {
        error = "invalid resampling algorithm";
        return false;
    }
    return true;
}

// Quoting robusto (comillas simples POSIX + escape) — evita inyección de shell.
static std::string quotePath(const std::string &path) {
    return security::Validator::shellQuote(path);
}

static int runCommand(const std::string &cmd) {
    return std::system(cmd.c_str());
}

static std::string runCommandCapture(const std::string &cmd) {
#ifdef _WIN32
    FILE *pipe = _popen(cmd.c_str(), "r");
#else
    FILE *pipe = popen(cmd.c_str(), "r");
#endif
    if (!pipe) return {};
    std::string output;
    char buffer[512];
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) output += buffer;
#ifdef _WIN32
    _pclose(pipe);
#else
    pclose(pipe);
#endif
    return output;
}

bool gdalSupportsEcw() {
    std::string formats = runCommandCapture("gdalinfo --formats 2>&1");
    if (formats.empty()) return false;
    std::regex ecwPattern(R"((^|\n)\s*ECW\s*-)", std::regex::icase);
    return std::regex_search(formats, ecwPattern);
}

static void appendLog(const std::string &id, const std::string &line) {
    std::scoped_lock lk(gJobsMutex);
    auto it = gJobs.find(id);
    if (it == gJobs.end()) return;
    it->second.logs.push_back(line);
    it->second.updatedAt = http_utils::nowIso8601();
}

static void setStatus(const std::string &id, const std::string &status) {
    std::scoped_lock lk(gJobsMutex);
    auto it = gJobs.find(id);
    if (it == gJobs.end()) return;
    it->second.status = status;
    it->second.updatedAt = http_utils::nowIso8601();
}

std::optional<Job> getJob(const std::string &id) {
    std::scoped_lock lk(gJobsMutex);
    auto it = gJobs.find(id);
    if (it == gJobs.end()) return std::nullopt;
    return it->second;
}

static std::vector<int> buildOverviewFactors(int minZoom, int maxZoom) {
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
    for (const auto &l : job.logs) logs.emplace_back(l);
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

        bool isEcwInput = input.extension() == ".ecw" || input.extension() == ".ECW";
        if (isEcwInput && !gdalSupportsEcw()) {
            appendLog(id, "ECW driver is not available in this container.");
            setStatus(id, "failed");
            return;
        }

        cv::Mat sample = cv::imread(input.string(), cv::IMREAD_UNCHANGED);
        if (!sample.empty()) {
            appendLog(id, "OpenCV sample read: " + std::to_string(sample.cols) + "x" +
                              std::to_string(sample.rows) +
                              " channels=" + std::to_string(sample.channels()));
        } else {
            appendLog(id, "OpenCV could not read source directly. Continuing with GDAL.");
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
            for (int factor : overviewFactors) overviews << ' ' << factor;

            appendLog(id, "Building overviews...");
            int rc2 = runCommand(overviews.str());
            appendLog(id, "gdaladdo exit code: " + std::to_string(rc2));
            if (rc2 != 0) {
                setStatus(id, "failed");
                appendLog(id, "Overview generation failed");
                return;
            }
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

} // namespace gdal_mod
