#pragma once

#include <chrono>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>

#include "../auth/auth_types.hpp"

namespace biometric {

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

struct ParsedHttpEndpoint {
  std::string host;
  std::string port = "80";
  std::string target = "/";
};

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

static constexpr std::size_t kFaceEmbeddingVectorDim = 512;

struct AiEngineEmbeddingResult {
  std::vector<double> embedding;
  std::string error;
  bool ok() const { return embedding.size() == kFaceEmbeddingVectorDim && error.empty(); }
};

struct AiEngineCartoonResult {
  std::string imageBase64;
  /** Maestro PNG 4K; no se incluye en JWT/session/localStorage. */
  std::string imageHdBase64;
  std::string error;
  bool ok() const { return !imageBase64.empty() && error.empty(); }
};

/** @brief Lectura de DNI por cámara (PDF417 del DNI antiguo + MRZ de todas
 * las versiones, ver ai_engine/dni_scan.py). Nunca consulta RENIEC/SUNAT. */
struct AiEngineDniScanResult {
  bool found = false;
  std::string method;  ///< "pdf417" | "mrz" | "none"
  std::string dni;
  std::string firstName;
  std::string lastName;
  std::string sex;
  std::string birthDate;
  std::string expiryDate;
  bool checksumValid = false;
  std::string error;
  bool ok() const { return found && error.empty(); }
};

struct FaceAnalysis {
  bool ok = false;
  std::vector<double> faceTemplate;
  std::vector<std::string> issues;
  double qualityScore = 0.0;
  std::string provider = "legacy";
};

struct BiometricVerifyEval {
  bool ok = false;
  FaceAnalysis face;
  std::optional<AiEngineFrameResult> aiEval;
};

struct CascadeBundle {
  bool faceLoaded = false;
  bool eyeLoaded = false;
  bool smileLoaded = false;
  cv::CascadeClassifier face;
  cv::CascadeClassifier eye;
  cv::CascadeClassifier smile;
};

struct AccessoryDnnContext {
  bool initialized = false;
  bool loaded = false;
  cv::dnn::Net net;
  std::vector<std::string> labels;
  int inputSize = 224;
  std::string initError;
};

/**
 * Estado de captura por sesion (X-Capture-Session-Id, generado por pestana
 * en el frontend). Antes gBiometricCaptureState/gBiometricCapturedImages
 * eran variables globales unicas de proceso: dos capturas concurrentes
 * (dos pestanas, o incluso trafico de pruebas) se pisaban entre si.
 */
struct BiometricCaptureSessionSlot {
  BiometricCaptureRuntimeState state;
  std::vector<std::string> capturedImages;
  std::chrono::steady_clock::time_point lastTouched =
      std::chrono::steady_clock::now();
};

/** Clave usada cuando el llamador no manda X-Capture-Session-Id (compat). */
extern const std::string kBiometricCaptureDefaultSessionId;

extern std::mutex gBiometricCaptureMutex;
extern std::unordered_map<std::string, BiometricCaptureSessionSlot>
    gBiometricCaptureSessions;

/** El llamador debe tener gBiometricCaptureMutex tomado. Limpia sesiones
 * inactivas por mas de 10 minutos antes de crear/devolver la pedida. */
BiometricCaptureSessionSlot &
getOrCreateBiometricCaptureSession(const std::string &sessionId);

std::string captureStateLabel(int state);

} // namespace biometric
