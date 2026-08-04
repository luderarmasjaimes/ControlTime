#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <boost/json.hpp>
#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>

#include "../auth/auth_types.hpp"
#include "../config/app_config.hpp"
#include "biometric_types.hpp"

namespace json = boost::json;

namespace biometric {

bool decodeBase64(const std::string &input, std::vector<unsigned char> &out);
std::string encodeBase64(const std::vector<unsigned char> &input);
std::string stripDataUrlBase64(const std::string &in);

bool parseHttpEndpoint(const std::string &url, ParsedHttpEndpoint &out);

float icaoFullFrameIlluminationPercent(const cv::Mat &bgr);

std::vector<double> extractLegacyTemplateFromMat(const cv::Mat &image);

std::vector<std::filesystem::path> cascadeSearchDirs();
bool loadCascadeFile(cv::CascadeClassifier &classifier, const std::string &fileName);
CascadeBundle &getCascadeBundle();

cv::Rect largestRect(const std::vector<cv::Rect> &rects);
double faceSymmetryScore(const cv::Mat &faceGray);

std::vector<float> flattenDnnOutput(const cv::Mat &out);
std::vector<float> softmax(const std::vector<float> &v);

AccessoryDnnContext &getAccessoryDnnContext();
json::object biometricDnnRuntimeStatusJson();
void applyDnnAccessoryChecks(const cv::Mat &faceBgr, std::vector<std::string> &issues);

cv::Mat normalizeFaceGray(const cv::Mat &faceGray);
double edgeDensity(const cv::Mat &gray);
double darkPixelRatio(const cv::Mat &gray, int threshold = 30);
double brightPixelRatio(const cv::Mat &gray, int threshold = 230);
double skinPixelRatio(const cv::Mat &bgr);
double meanSaturation(const cv::Mat &bgr);

FaceAnalysis analyzeFaceImageLegacy(const std::string &base64Image, const std::string &mode);
FaceAnalysis analyzeFaceImageDermalogCli(const std::string &base64Image, const std::string &mode);
FaceAnalysis analyzeFaceImage(const std::string &base64Image, const std::string &mode);

void applyAiFrontalToFaceIssues(FaceAnalysis &face, const AiEngineFrameResult &ai);
void stripLegacyIssuesWhenAiIcaoPasses(FaceAnalysis &face, const AiEngineFrameResult &ai);
bool trySalvageFaceLoginQuality(FaceAnalysis &face, const std::string &base64Image);
bool buildFaceLoginProbe(const std::vector<double> &clientProbeTemplate,
                         const std::optional<std::vector<unsigned char>> &rawImageBytes,
                         const std::optional<std::string> &base64ForLegacy,
                         const std::vector<double> &storedTemplate,
                         std::vector<double> &outProbe, std::string &outProvider,
                         double &outThreshold, double legacyThreshold,
                         double embeddingThreshold, std::string &error);
BiometricVerifyEval runBiometricVerifyForImageBase64(
    const std::string &base64,
    const std::optional<std::string> &glassesEmaKey = std::nullopt);

} // namespace biometric
