#include "face_analysis.hpp"
#include "ai_engine_client.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../security/validators.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <regex>
#include <sstream>

#include <boost/json.hpp>

namespace fs = std::filesystem;
namespace json = boost::json;

using http_utils::makeId;
using http_utils::pushIssueUnique;
using http_utils::splitCsvLower;
using config::BiometricProvider;

#define gBiometricDnnEnabled        config::AppConfig::instance().gBiometricDnnEnabled
#define gBiometricDnnThreshold      config::AppConfig::instance().gBiometricDnnThreshold
#define gBiometricDnnModelPath      config::AppConfig::instance().gBiometricDnnModelPath
#define gBiometricDnnLabelsCsv      config::AppConfig::instance().gBiometricDnnLabelsCsv
#define gBiometricMaxPixels         config::AppConfig::instance().gBiometricMaxPixels
#define gImageOptimizerEnabled      config::AppConfig::instance().gImageOptimizerEnabled
#define gDermalogCliPath            config::AppConfig::instance().gDermalogCliPath
#define gBiometricProvider          config::AppConfig::instance().gBiometricProvider
#define gDermalogRequired           config::AppConfig::instance().gDermalogRequired
#define gAiEngineUrl                config::AppConfig::instance().gAiEngineUrl
#define gBiometricIcaoEyeConfidenceMin  config::AppConfig::instance().gBiometricIcaoEyeConfidenceMin
#define gBiometricIcaoIlluminationMin   config::AppConfig::instance().gBiometricIcaoIlluminationMin

namespace biometric {

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

std::string stripDataUrlBase64(const std::string &in) {
  const auto pos = in.find("base64,");
  if (pos != std::string::npos) {
    return in.substr(pos + 7);
  }
  return in;
}

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

float icaoFullFrameIlluminationPercent(const cv::Mat &bgr) {
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

  json::object out;
  out["enabled"]      = gBiometricDnnEnabled;
  out["model_path"]   = gBiometricDnnModelPath;
  out["model_exists"] = fs::exists(gBiometricDnnModelPath);
  out["loaded"]       = ctx.loaded;
  out["threshold"]    = gBiometricDnnThreshold;
  out["labels"]       = labels;
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

  const int safePixels = std::max(120000, gBiometricMaxPixels);
  const int currentPixels = std::max(1, img.cols * img.rows);
  if (currentPixels > safePixels) {
    const double scale =
        std::sqrt(static_cast<double>(safePixels) / static_cast<double>(currentPixels));
    cv::resize(img, img, cv::Size(), scale, scale, cv::INTER_AREA);
  }

  if (gImageOptimizerEnabled) {
    try {
      std::string id = makeId();
      std::string inPath = "/tmp/opt_in_" + id + ".jpg";
      std::string outPath = "/tmp/opt_out_" + id + ".jpg";
      cv::imwrite(inPath, img);
      // Rutas citadas robustamente (defensa en profundidad, aunque son makeId).
      std::string cmd = "python3 /app/image_optimizer.py " +
                        security::Validator::shellQuote(inPath) + " " +
                        security::Validator::shellQuote(outPath) +
                        " > /dev/null 2>&1";
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
    }
  }

  cv::Mat gray;
  cv::cvtColor(img, gray, cv::COLOR_BGR2GRAY);

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
  if (strictRegister && faceRatio < 0.08) {
    result.issues.push_back("face_too_small");
  }

  const cv::Point2d frameCenter(gray.cols * 0.5, gray.rows * 0.5);
  const cv::Point2d faceCenter(faceRect.x + faceRect.width * 0.5,
                               faceRect.y + faceRect.height * 0.5);
  const double offX = std::abs(faceCenter.x - frameCenter.x) /
                      std::max(1.0, gray.cols * 0.5);
  const double offY = std::abs(faceCenter.y - frameCenter.y) /
                      std::max(1.0, gray.rows * 0.5);
  if (strictRegister && (offX > 0.25 || offY > 0.25)) {
    result.issues.push_back("face_off_center");
  }

  const double aspect =
      static_cast<double>(faceRect.width) / std::max(1.0, static_cast<double>(faceRect.height));
  if (strictRegister && (aspect < 0.55 || aspect > 1.25)) {
    result.issues.push_back("face_not_frontal");
  }

  cv::Mat faceGrayRaw = gray(faceRect).clone();
  cv::Mat faceGray = normalizeFaceGray(faceGrayRaw);
  cv::Mat faceBgr = img(faceRect).clone();

  cv::Scalar meanIntensity = cv::mean(faceGray);
  if (meanIntensity[0] < 60.0 || meanIntensity[0] > 210.0) {
    result.issues.push_back("lighting_out_of_range");
  }

  cv::Mat lap;
  cv::Laplacian(faceGray, lap, CV_64F);
  cv::Scalar mu, sigma;
  cv::meanStdDev(lap, mu, sigma);
  const double blurScore = sigma[0] * sigma[0];
  const double minBlur = strictRegister ? 60.0 : 40.0;
  if (blurScore < minBlur) {
    result.issues.push_back("image_not_sharp");
  }

  cv::Scalar meanFace, stdFace;
  cv::meanStdDev(faceGray, meanFace, stdFace);
  if (strictRegister && stdFace[0] < 28.0) {
    result.issues.push_back("low_dynamic_range");
  }

  const double symmetry = faceSymmetryScore(faceGray);
  if (strictRegister && symmetry > 120.0) {
    result.issues.push_back("head_pose_not_straight");
  }

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
  
  const bool hasFace = faces.size() > 0;
  const bool eyesOk = result.issues.end() == std::find(result.issues.begin(), result.issues.end(), "eyes_not_open_or_not_visible");
  const bool mouthOk = true;
  
  const double blurNorm = std::clamp(blurScore / 260.0, 0.0, 1.0);
  const double lightNorm =
      1.0 - std::min(std::abs(meanIntensity[0] - 130.0) / 130.0, 1.0);
  const double symNorm = std::clamp((60.0 - symmetry) / 60.0, 0.0, 1.0);
  result.qualityScore = std::clamp((0.40 * blurNorm) + (0.40 * lightNorm) +
                                       (0.20 * symNorm),
                                   0.0, 1.0);
  
  result.ok = hasFace && eyesOk && (result.issues.size() < 4);
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

  // Todos los argumentos citados robustamente (incluye `mode`), sin metacaracteres.
  const std::string cmd = security::Validator::shellQuote(gDermalogCliPath) +
                          " --input " +
                          security::Validator::shellQuote(imagePath.string()) +
                          " --mode " + security::Validator::shellQuote(mode) +
                          " --output-json " +
                          security::Validator::shellQuote(jsonPath.string());

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

void applyAiFrontalToFaceIssues(FaceAnalysis &face,
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
void stripLegacyIssuesWhenAiIcaoPasses(FaceAnalysis &face,
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
bool trySalvageFaceLoginQuality(FaceAnalysis &face,
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
bool buildFaceLoginProbe(const std::vector<double> &clientProbeTemplate,
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

BiometricVerifyEval runBiometricVerifyForImageBase64(
    const std::string &base64,
    const std::optional<std::string> &glassesEmaKey) {
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
  eval.ok = eval.face.issues.empty();
  eval.face.ok = eval.ok;
  return eval;
}

} // namespace biometric
