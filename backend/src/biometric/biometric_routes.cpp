#include "biometric_routes.hpp"
#include "biometric_types.hpp"
#include "face_analysis.hpp"
#include "ai_engine_client.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"

#include <algorithm>
#include <cmath>
#include <iostream>

#include <boost/json.hpp>
#include <opencv2/opencv.hpp>

namespace json = boost::json;

using http_utils::makeJsonResponse;
using config::AppConfig;
using config::BiometricProvider;

namespace biometric {

static http::response<http::string_body>
handleBiometricStatus(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session || session->role != "admin") {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "admin access required"}});
  }

  auto &cfg = AppConfig::instance();
  return makeJsonResponse(
      http::status::ok,
      json::object{
          {"provider", cfg.gBiometricProvider == BiometricProvider::DermalogCli
                           ? "dermalog_cli"
                           : "legacy"},
          {"dermalog_required", cfg.gDermalogRequired},
          {"dnn", biometricDnnRuntimeStatusJson()}});
}

static http::response<http::string_body>
handleVerifyFrame(const http::request<http::string_body> &req,
                  const std::unordered_map<std::string, std::string> &query) {
  try {
    auto val = json::parse(req.body());
    if (!val.is_object() || !val.as_object().if_contains("face_image_base64")) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "face_image_base64 is required"}});
    }
    const std::string base64 =
        json::value_to<std::string>(val.as_object().at("face_image_base64"));

    const auto sessionBiometric = auth::resolveAuthSession(req, query);
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

    auto &cfg = AppConfig::instance();
    return makeJsonResponse(http::status::ok,
                            json::object{{"ok", face.ok},
                                         {"issues", issuesArr},
                                         {"quality_score", face.qualityScore},
                                         {"provider", face.provider},
                                         {"ai_engine_enabled", !cfg.gAiEngineUrl.empty()},
                                         {"ai_engine_timeout_ms", cfg.gAiEngineTimeoutMs}});
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", ex.what()}});
  }
}

static http::response<http::string_body>
handleProcessFrame(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &) {
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

      const bool frameValid =
          eval.ok && eyesOpen && mouthClosed && noGlasses && frontal;

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
        if (gBiometricCaptureState.captureInvalidStreak >= 5) {
          gBiometricCaptureState.captureCount = 0;
          gBiometricCaptureState.captureInvalidStreak = 0;
          gBiometricCapturedImages.clear();
        }
      }

      const double livenessScore = std::min(
          100.0, static_cast<double>(gBiometricCaptureState.captureCount) * 35.0);
      gBiometricCaptureState.livenessScore = livenessScore;

      if (gBiometricCaptureState.captureCount >= 3) {
        gBiometricCaptureState.state = 7;
      } else if (detected) {
        gBiometricCaptureState.state = 4;
      } else {
        gBiometricCaptureState.state = 1;
      }
      gBiometricCaptureState.stateName =
          captureStateLabel(gBiometricCaptureState.state);
      gBiometricCaptureState.updatedAt = std::chrono::steady_clock::now();
      stateOut = gBiometricCaptureState.state;
    }

    return makeJsonResponse(http::status::ok,
                            json::object{{"ok", true}, {"state", stateOut}});
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", ex.what()}});
  }
}

static http::response<http::string_body>
handleStatus(const http::request<http::string_body> &,
             const std::unordered_map<std::string, std::string> &) {
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

  auto &cfg = AppConfig::instance();
  return makeJsonResponse(
      http::status::ok,
      json::object{
          {"state", s.state},
          {"state_name", s.stateName},
          {"capture_count", s.captureCount},
          {"active_engine",
           !cfg.gAiEngineUrl.empty() ? "MEDIAPIPE_IA" : "OPENCV_LEGACY"},
          {"icao", json::object{{"eyes_open", s.eyesOpen},
                                {"mouth_closed", s.mouthClosed},
                                {"face_straight", s.faceStraight},
                                {"no_glasses", s.noGlasses}}},
          {"face_oval", faceOvalVal},
          {"liveness_score", s.livenessScore},
      });
}

void registerRoutes(router::Router &r) {
  r.get("/api/auth/biometric/status", handleBiometricStatus);
  r.post("/api/auth/biometric/verify-frame", handleVerifyFrame);
  r.post("/api/process_frame", handleProcessFrame);
  r.get("/api/status", handleStatus);
}

} // namespace biometric
