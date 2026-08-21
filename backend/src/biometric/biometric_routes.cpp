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

/** X-Capture-Session-Id: una por pestana (authApi.ts). Aisla el estado de
 * captura/histeresis de lentes entre capturas concurrentes -- sin esto,
 * gBiometricCaptureState era global de proceso y una segunda pestana (o
 * trafico de pruebas) resetaba/contaminaba la captura de otra. */
std::string captureSessionIdFromRequest(
    const http::request<http::string_body> &req) {
  auto it = req.find("X-Capture-Session-Id");
  if (it == req.end()) {
    return kBiometricCaptureDefaultSessionId;
  }
  std::string id(it->value());
  if (id.empty() || id.size() > 128) {
    return kBiometricCaptureDefaultSessionId;
  }
  return id;
}

static http::response<http::string_body>
handleBiometricStatus(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session || session->role != "admin") {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "admin access required"}});
  }

  auto &cfg = AppConfig::instance();
  const char *provider = cfg.gBiometricProvider == BiometricProvider::DermalogCli
                             ? "dermalog_cli"
                         : cfg.gBiometricProvider == BiometricProvider::SeetaFace6
                             ? "seetaface6_local"
                         : cfg.gBiometricProvider == BiometricProvider::DeepFaceSilent
                             ? "deepface_silentface"
                             : "legacy";
  return makeJsonResponse(
      http::status::ok,
      json::object{
          {"provider", provider},
          {"dermalog_required", cfg.gDermalogRequired},
          {"seetaface6_required", cfg.gSeetaFace6Required},
          {"seetaface6_timeout_ms", cfg.gSeetaFace6TimeoutMs},
          {"seetaface6_cosine_threshold", cfg.gFaceSeetaCosineThreshold},
          {"deepface_silentface_required", cfg.gDeepFaceSilentRequired},
          {"deepface_silentface_timeout_ms", cfg.gDeepFaceSilentTimeoutMs},
          {"deepface_silentface_dermalog_fallback", cfg.gDeepFaceSilentDermalogFallback},
          {"face_deepface_cosine_threshold", cfg.gFaceDeepfaceCosineThreshold},
          {"silentface_liveness_threshold", cfg.gSilentFaceLivenessThreshold},
          {"certification_claim", false},
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

    const std::string sessionId = captureSessionIdFromRequest(req);

    std::cerr << "[AI_OVAL] /api/process_frame decoded w=" << frame.cols
              << " h=" << frame.rows << std::endl;

    std::vector<unsigned char> jpg;
    cv::imencode(".jpg", frame, jpg, {cv::IMWRITE_JPEG_QUALITY, 60});
    const std::string base64 = encodeBase64(jpg);

    // computeEmbedding=false: este endpoint alimenta la vista previa en vivo
    // (checklist ICAO + óvalo) -- nunca lee eval.face.faceTemplate, así que
    // calcular el embedding InsightFace en cada frame (~0.5-0.7s de red+ONNX
    // por frame, medido en runtime) era trabajo puro desperdiciado. El
    // template real se calcula donde de verdad se usa: registro
    // (handleRegister) y login facial (handleLoginFace), en main.cpp.
    auto eval = runBiometricVerifyForImageBase64(base64, sessionId, false);

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
      auto &slot = getOrCreateBiometricCaptureSession(sessionId);
      auto &st = slot.state;
      auto &capturedImages = slot.capturedImages;

      st.detected = detected;
      st.eyesOpen = eyesOpen;
      st.mouthClosed = mouthClosed;
      st.noGlasses = noGlasses;
      st.faceStraight = frontal;
      st.hasFaceOval = false;
      if (eval.aiEval.has_value() && eval.aiEval->available &&
          eval.aiEval->hasHeadYawRatio) {
        st.headYawRatio = eval.aiEval->headYawRatio;
      }

      if (eval.aiEval.has_value() && eval.aiEval->available &&
          eval.aiEval->hasFaceOvalEllipse) {
        const auto &e = eval.aiEval->faceOvalEllipse;
        st.hasFaceOval = true;
        st.faceOvalCx = static_cast<double>(e.center.x);
        st.faceOvalCy = static_cast<double>(e.center.y);
        st.faceOvalW = static_cast<double>(e.size.width);
        st.faceOvalH = static_cast<double>(e.size.height);
        st.faceOvalAngleDeg = static_cast<double>(e.angle);
      }

      // `detected` ya es eval.ok cuando el motor IA no esta disponible (linea
      // 137) o aiEval->detected cuando si lo esta -- usar eval.ok aqui en vez
      // de `detected` reintroducia el heuristico Haar/CV legacy (siempre
      // activo desde que este endpoint dejo de calcular el embedding, ver
      // computeEmbedding=false arriba) como bloqueante en cada frame: sus
      // propios chequeos de lentes/gorro/accesorio/nitidez/simetria son mucho
      // menos fiables que MediaPipe y casi nunca se limpian a tiempo
      // (stripLegacyIssuesWhenAiIcaoPasses exige ojos+boca+lentes OK en el
      // MISMO frame para borrarlos), dejando eval.ok=false la mayoria de
      // frames aunque el motor IA ya confirmara sin lentes/ojos abiertos.
      const bool frameValid =
          detected && eyesOpen && mouthClosed && noGlasses && frontal;

      if (frameValid) {
        st.captureInvalidStreak = 0;
        if (st.captureCount < kRequiredValidCaptureFrames) {
          capturedImages.push_back("data:image/jpeg;base64," + base64);
          if (capturedImages.size() > kRequiredValidCaptureFrames) {
            capturedImages.erase(capturedImages.begin());
          }
        }
        st.captureCount = std::min(kRequiredValidCaptureFrames, st.captureCount + 1);
      } else {
        st.captureInvalidStreak++;
        if (st.captureInvalidStreak >= 5) {
          st.captureCount = 0;
          st.captureInvalidStreak = 0;
          capturedImages.clear();
        }
      }

      const double livenessScore = std::min(
          100.0,
          static_cast<double>(st.captureCount) * (100.0 / kRequiredValidCaptureFrames));
      st.livenessScore = livenessScore;

      if (st.captureCount >= kRequiredValidCaptureFrames) {
        st.state = 7;
      } else if (detected) {
        st.state = 4;
      } else {
        st.state = 1;
      }
      st.stateName = captureStateLabel(st.state);
      st.updatedAt = std::chrono::steady_clock::now();
      stateOut = st.state;
    }

    return makeJsonResponse(http::status::ok,
                            json::object{{"ok", true}, {"state", stateOut}});
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", ex.what()}});
  }
}

// Lectura de DNI por cámara (PDF417 del DNI antiguo 1997 + MRZ de todas las
// versiones, ver ai_engine/dni_scan.py). Público como /api/process_frame:
// el autoregistro (AuthGateway.tsx) ocurre antes de tener sesión. Nunca
// consulta RENIEC/SUNAT -- solo decodifica lo ya impreso en el documento.
static http::response<http::string_body>
handleScanDniDocument(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &) {
  if (req.body().empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "image body is required"}});
  }
  std::vector<unsigned char> frameRaw(req.body().begin(), req.body().end());
  const auto result = scanDocumentWithAiEngine(frameRaw);
  if (!result.error.empty()) {
    return makeJsonResponse(
        http::status::ok,
        json::object{{"found", false}, {"method", "none"}, {"error", result.error}});
  }
  return makeJsonResponse(
      http::status::ok,
      json::object{{"found", result.found},
                   {"method", result.method},
                   {"dni", result.dni},
                   {"first_name", result.firstName},
                   {"last_name", result.lastName},
                   {"sex", result.sex},
                   {"birth_date", result.birthDate},
                   {"expiry_date", result.expiryDate},
                   {"checksum_valid", result.checksumValid}});
}

static http::response<http::string_body>
handleStatus(const http::request<http::string_body> &req,
             const std::unordered_map<std::string, std::string> &) {
  const std::string sessionId = captureSessionIdFromRequest(req);
  BiometricCaptureRuntimeState s;
  {
    std::scoped_lock lk(gBiometricCaptureMutex);
    s = getOrCreateBiometricCaptureSession(sessionId).state;
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
          {"head_yaw_ratio", s.headYawRatio},
          {"liveness_score", s.livenessScore},
      });
}

void registerRoutes(router::Router &r) {
  r.get("/api/auth/biometric/status", handleBiometricStatus);
  r.post("/api/auth/biometric/verify-frame", handleVerifyFrame);
  r.post("/api/process_frame", handleProcessFrame);
  r.post("/api/dni/scan-document", handleScanDniDocument);
  r.get("/api/status", handleStatus);
}

} // namespace biometric
