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
#include "liveness_challenge.hpp"

namespace biometric {

struct BiometricCaptureRuntimeState {
  int state = 1; // 1=starting, 4=liveness, 7=captured
  int captureCount = 0;
  /** Frames ICAO inválidos seguidos antes de resetear muestras (evita 0/3 por un solo fallo). */
  int captureInvalidStreak = 0;
  /** Frames seguidos con SOLO "lentes puestos" fallando (las otras 3
   * condiciones -- ojos/boca/frontal -- OK). Streak independiente de
   * captureInvalidStreak: ver kIcaoGlassesInvalidFramesBeforeReset. */
  int captureGlassesInvalidStreak = 0;
  /** Igual que captureGlassesInvalidStreak, pero para frames DESPUÉS de que
   * el candado (icaoReadsCompleted) ya se cerró -- ver comentario en
   * handleProcessFrame sobre por qué hace falta un streak separado ahí
   * (hallazgo real 2026-09-08: lentes detectados recién después de
   * completar ICAO + reto, sin ninguna ruta que invalidara lo ya "trabado"). */
  int postLockGlassesStreak = 0;
  /** Motivo del último reinicio forzado de la captura a la etapa 1 (vacío si
   * nunca se reinició, o si el último frame fue válido). Sólo informativo
   * para el frontend -- el backend nunca cambia su decisión por esto. */
  std::string lastResetReason;
  /** Total de frames procesados en la sesión (válidos o no). Ver
   * kGlassesHistWarmupFrames -- evita que el gate de calidad se cierre antes
   * de que la histéresis de lentes de eye_analyzer.py tenga evidencia. */
  int totalFramesSeen = 0;
  bool eyesOpen = false;
  bool mouthClosed = false;
  bool faceStraight = false;
  bool noGlasses = false;
  bool detected = false;
  /** Signo/magnitud del giro de cabeza del último frame -- ver
   * AiEngineFrameResult::headYawRatio. Usado por el desafío activo de
   * liveness "gira la cabeza" del frontend. */
  double headYawRatio = 0.0;
  /** Distancia interocular en píxeles del último frame -- ver
   * AiEngineFrameResult::interEyePx. Usado por el desafío activo de
   * liveness "acércate/aléjate de la cámara" (ADR-146). */
  double interEyePx = 0.0;
  bool hasFaceOval = false;
  bool faceOvalFastTracker = false;
  double faceOvalConfidence = 0.0;
  double faceOvalCx = 0.0;
  double faceOvalCy = 0.0;
  double faceOvalW = 0.0;
  double faceOvalH = 0.0;
  double faceOvalAngleDeg = 0.0;
  double faceOvalSourceW = 0.0;
  double faceOvalSourceH = 0.0;
  double livenessScore = 0.0;
  std::string stateName = "Estado actual: INICIANDO";
  std::chrono::steady_clock::time_point updatedAt = std::chrono::steady_clock::now();

  /**
   * Gate de calidad ICAO (5 lecturas válidas + histéresis de lentes madura,
   * ver kRequiredValidCaptureFrames/kGlassesHistWarmupFrames, + parpadeo
   * natural observado si gNaturalBlinkRequired, ver naturalBlink abajo)
   * cruzado una sola vez por sesión. A partir de aquí los desafíos de
   * liveness pueden incluir giros de cabeza que fallan "frontal" a
   * propósito -- por eso, una vez en true, captureInvalidStreak deja de
   * poder resetear captureCount (ver handleProcessFrame). ADR-142/143.
   */
  bool qualityGateReached = false;

  /** Cola/progreso de los 2 desafíos de liveness, sorteada y decidida por el
   * servidor al cruzar qualityGateReached (ver liveness_challenge.hpp).
   * Nunca la manda el cliente -- así no se puede fingir "ya cumplí los
   * desafíos" sin que MediaPipe haya visto el gesto. */
  LivenessChallengeState challenge;

  /** Parpadeo natural observado durante la MISMA ventana de lecturas ICAO
   * (ADR-143) -- a diferencia de `challenge`, no es una fase aparte: se
   * evalúa en simultáneo con eyesOpen/mouthClosed/frontal/noGlasses en cada
   * frame, tolerando un cierre de ojos breve sin penalizar el streak de
   * captura. Ver updateNaturalBlink en liveness_challenge.hpp. */
  NaturalBlinkState naturalBlink;
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
  /** Señal de parpadeo (ADR-148), MÁS SENSIBLE que bothOpen a propósito --
   * bothOpen usa max(EAR)/min(blink) entre ambos ojos para EVITAR falsos
   * "cerrado" por ruido de un solo ojo (protege el chequeo ICAO real de
   * rechazos falsos, ver ai_engine/eye_analyzer.py). Con esa fusión
   * conservadora, un parpadeo natural casi nunca hacía caer bothOpen
   * (confirmado con datos reales de producción: bothOpen se mantuvo true
   * durante un parpadeo real y sostenido). blinkSignalOpen usa min(EAR)/
   * max(blink): cualquiera de los dos ojos mostrando evidencia de cierre
   * cuenta. Sólo la usa updateNaturalBlink (liveness pasivo) -- el chequeo
   * ICAO real ("OJOS ABIERTOS" en pantalla, frameValid) sigue en bothOpen. */
  bool hasBlinkSignalOpen = false;
  bool blinkSignalOpen = true;
  bool mouthClosed = true;
  bool noGlasses = true;
  /** MediaPipe / analyze_eyes: nariz vs eje interocular (sustituye Haar+simetría para ICAO). */
  bool hasFaceFrontal = false;
  bool faceFrontal = true;
  /** Signo/magnitud del giro de cabeza (nariz vs eje interocular, ver
   * head_yaw_ratio_from_points en eye_analyzer.py): positivo = giro hacia la
   * izquierda del usuario, negativo = hacia su derecha. Usado por el
   * desafío activo de liveness "gira la cabeza" del frontend. */
  bool hasHeadYawRatio = false;
  double headYawRatio = 0.0;
  /** Distancia interocular en píxeles del frame actual (ver "inter_eye_px"
   * en eye_analyzer.py) -- proxy directo de la distancia física a la
   * cámara: sube si la persona se acerca, baja si se aleja. Usado por el
   * desafío activo de liveness "acércate/aléjate de la cámara" (ADR-146). */
  bool hasInterEyePx = false;
  double interEyePx = 0.0;
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

/**
 * Frames ICAO válidos consecutivos exigidos antes de dar por completada la
 * captura biométrica (registro/login). 5 lecturas (ADR-143; antes 3 en
 * ADR-142, antes de eso 5 también -- ver historial en el ADR). Un parpadeo
 * natural durante esta ventana NO cuenta como frame inválido (ver
 * updateNaturalBlink/NaturalBlinkState en liveness_challenge.hpp) así que
 * subir el número de lecturas no penaliza a alguien por parpadear con
 * normalidad -- sólo exige más evidencia de calidad ICAO sostenida.
 *
 * Debe coincidir con frontend/src/config/facialIcaoConfig.ts
 * (FACIAL_ICAO.REQUIRED_VALID_FRAMES).
 */
static constexpr int kRequiredValidCaptureFrames = 5;

/**
 * Frames totales de la sesión (válidos o no) exigidos, ADEMÁS de
 * kRequiredValidCaptureFrames, antes de marcar qualityGateReached. Iguala la
 * ventana de la histéresis de lentes en ai_engine/eye_analyzer.py
 * (GLASSES_SCORE_HIST_LEN/GLASSES_FUSION_HIST_LEN, por defecto 5): esa
 * histéresis empieza cada sesión asumiendo "sin lentes" y exige varias
 * muestras consistentes para voltear a "con lentes" -- deliberadamente lenta
 * para evitar falsos positivos por cejas/nariz/reflejos. Con
 * kRequiredValidCaptureFrames == 5 este warmup queda trivialmente
 * satisfecho en la práctica (totalFramesSeen siempre es >= captureCount),
 * pero se mantiene explícito por robustez si algún día el valor de arriba
 * vuelve a bajar.
 */
static constexpr int kGlassesHistWarmupFrames = 5;

/**
 * ADR-156 (2026-09-04, pedido explícito del usuario): frames ICAO inválidos
 * seguidos que se toleran antes de devolver captureCount a 0. Vale 1, o sea
 * NINGUNA tolerancia: las 5 lecturas tienen que ser 5 frames consecutivos
 * con las CUATRO condiciones (ojos, boca, frontal, sin lentes) en OK; basta
 * que una falle para volver a empezar la cuenta. Antes valía 5, y eso era
 * justamente lo que se veía en pantalla como "el contador sube igual sin
 * cumplir las condiciones": el progreso ya logrado sobrevivía a 4 frames
 * malos seguidos, así que un 3/5 podía llegar a 5/5 intercalando frames
 * inválidos. Un parpadeo natural NO cuenta como frame inválido (ver
 * updateNaturalBlink en liveness_challenge.hpp), así que quitar la
 * tolerancia no castiga a quien parpadea con normalidad -- que era el único
 * motivo real por el que existía.
 */
static constexpr int kIcaoInvalidFramesBeforeReset = 1;

/**
 * Tolerancia SEPARADA y temporal, solo para "lentes puestos"
 * (suspected_glasses): a diferencia de las otras 3 condiciones (ojos, boca,
 * frontal, sin tolerancia, ver kIcaoInvalidFramesBeforeReset), la detección
 * de lentes todavía no es 100% estable, así que un solo frame fallando esa
 * condición NO resetea el contador -- hacen falta 2 lecturas CONSECUTIVAS
 * con lentes detectados para volver captureCount a 0. Un frame válido en
 * medio (0 o 1 fallo seguido) limpia el streak de lentes sin penalizar el
 * progreso ya logrado. Este valor es temporal: cuando la detección de
 * lentes sea confiable, debe bajar a 1 para igualar la exigencia de las
 * otras 3 condiciones (pedido explícito del usuario, 2026-09-07).
 */
static constexpr int kIcaoGlassesInvalidFramesBeforeReset = 2;

/**
 * ADR-149: las 5 lecturas ICAO por sí solas (sin exigir el parpadeo natural
 * todavía) -- true en cuanto captureCount/totalFramesSeen alcanzan sus
 * mínimos, sin importar naturalBlink.observed. Se usa para arrancar el
 * desafío activo (evaluateLivenessChallenge) y exponerlo en GET /api/status
 * ("challenge.active") tan pronto termina la lectura, en PARALELO con la
 * espera del parpadeo -- no en secuencia. El gate final de
 * handleLoginFace/handleRegister sigue exigiendo AMBAS cosas
 * (qualityGateReached && challenge.complete, sin cambios), así que correrlas
 * en paralelo no baja el nivel de exigencia: sólo evita que la persona vea
 * la pantalla congelada en "5/5" mientras el sistema espera en silencio un
 * parpadeo que puede tardar más que la propia lectura ICAO (~875ms para 5
 * frames a ~175ms, muy por debajo del intervalo promedio entre parpadeos
 * involuntarios, 2-4s) -- hallazgo real 2026-09-04, ver ADR-149.
 */
inline bool icaoReadsCompleted(const BiometricCaptureRuntimeState &st) {
  return st.captureCount >= kRequiredValidCaptureFrames &&
         st.totalFramesSeen >= kGlassesHistWarmupFrames;
}

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
