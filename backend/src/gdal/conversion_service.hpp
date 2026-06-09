#pragma once

#include <boost/json.hpp>

#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace json = boost::json;

namespace gdal_mod {

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

extern std::mutex gJobsMutex;
extern std::map<std::string, Job> gJobs;

bool parseConvertRequest(const json::object &obj, ConvertRequest &out,
                         std::string &error);

bool gdalSupportsEcw();

std::optional<Job> getJob(const std::string &id);

json::object jobToJson(const Job &job);

void runConversionJob(const std::string &id, ConvertRequest req,
                      std::string dataRoot);

} // namespace gdal_mod
