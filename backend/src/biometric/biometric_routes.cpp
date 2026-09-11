#include "biometric_routes.hpp"
#include "biometric_types.hpp"
#include "liveness_challenge.hpp"
#include "face_analysis.hpp"
#include "ai_engine_client.hpp"
#include "realtime_face_tracker.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../security/security_alerts.hpp"

// HAS_LIBPQ no se propaga entre translation units (se define localmente por
// archivo, ver el mismo bloque en auth_storage_pg.hpp/device_alarm_routes.cpp).
#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"

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

// Forward-declarada: handleProcessFrame (definida antes en este archivo) y
// handleStatus (definida más abajo, donde vive su implementación completa)
// comparten el mismo armado de JSON -- ver la definición junto a
// handleStatus para el porqué (evita el round-trip extra de GET
// /api/status encadenado después de cada POST /api/process_frame).
static json::object buildBiometricStatusJson(const BiometricCaptureRuntimeState &s);

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

/**
 * Pedido explícito del usuario 2026-09-07: si el algoritmo de parpadeo
 * natural (updateNaturalBlink/isNaturalBlinkStale) determina que no hubo
 * NINGÚN parpadeo en kNaturalBlinkMaxSampleWindowMs, es evidencia de foto
 * estática o máscara (ninguna de las dos parpadea) -- se registra como
 * intento de fraude sospechado en el log de auditoría de la plataforma
 * (`auth_audit_logs`), SIN avisar nada al cliente: la respuesta HTTP de
 * /api/process_frame sigue igual, el contador simplemente deja de avanzar
 * (ver handleProcessFrame) mientras dure la falta de parpadeo. No se conoce
 * usuario/empresa en esta etapa (captura previa a resolver identidad, tanto
 * en registro como en login) -- se identifica por el X-Capture-Session-Id
 * y la IP de origen, igual que otros eventos de seguridad tempranos.
 */
static void reportSuspectedBlinkFraud(const std::string &sessionId,
                                      const std::string &sourceIp) {
#if HAS_LIBPQ
  auto &cfg = AppConfig::instance();
  if (!cfg.gDatabaseUrl.empty()) {
    auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    if (PQstatus(lease.get()) == CONNECTION_OK) {
      auth::appendAuthAuditLogPg(
          lease.get(), "biometric_capture_blink_fraud_suspected", "", "unknown",
          false, "sin parpadeo detectado en la ventana de muestreo, capture_session=" + sessionId,
          std::nullopt, std::nullopt, std::nullopt, sourceIp);
    }
  }
#endif
  // Además del log de auditoría: mismo criterio que otros puntos de detección
  // real (ADR-133/134) -- que alguien se entere en el momento, no sólo que
  // quede escrito. No-op si BEEMETRY_SECURITY_ALERT_WEBHOOK_URL no está
  // configurada.
  security::sendSecurityAlert(
      "biometric_capture_blink_fraud_suspected",
      "capture_session=" + sessionId + " ip=" + sourceIp);
}

/**
 * Hallazgo real 2026-09-09: el usuario reportó un reset a etapa 1 que
 * percibió como "en el segundo intento del reto" y pidió un log en tiempo
 * real para confirmar la causa exacta -- hasta ahora `lastResetReason`
 * solo quedaba en el JSON de `/api/status` (para el frontend) y, sólo para
 * "blink_stale", en `auth_audit_logs` (para auditoría). Ninguno de los dos
 * es "en tiempo real" desde la terminal (`docker logs beemetry-api`) sin
 * consultar la base o abrir devtools. Esta línea cubre los 4 motivos
 * (icao_failed/glasses_detected/blink_stale/challenge_exhausted) por igual,
 * con el dato que de verdad distingue la causa real encontrada esta
 * sesión: cuántos intentos del reto ya se habían consumido al momento del
 * reset (`challengeAttempt`) -- si el reset ocurre con challengeAttempt bajo
 * (1-2 de 5), la causa NO es agotar los intentos del reto.
 */
static void logStageResetRealtime(const std::string &sessionId,
                                  const std::string &reason,
                                  int challengeAttempt, int challengeMaxAttempts) {
  std::cerr << "[LIVENESS_RESET] capture_session=" << sessionId
            << " reason=" << reason
            << " challenge_attempt=" << challengeAttempt << "/" << challengeMaxAttempts
            << std::endl;
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

  // ADR-126/142: contadores de proceso por tipo de desafío (armado/cumplido/
  // vencido) -- evidencia real para saber si kLivenessChallengeTimeoutMs
  // sigue siendo insuficiente, en vez de depender de observación manual.
  json::object challengeMetrics;
  for (std::size_t i = 0; i < kLivenessChallengeTypes.size(); ++i) {
    auto &c = gLivenessChallengeMetrics[i];
    challengeMetrics[kLivenessChallengeTypes[i]] = json::object{
        {"armed", c.armed.load(std::memory_order_relaxed)},
        {"succeeded", c.succeeded.load(std::memory_order_relaxed)},
        {"timed_out", c.timedOut.load(std::memory_order_relaxed)},
    };
  }

  return makeJsonResponse(
      http::status::ok,
      json::object{
          {"provider", provider},
          {"liveness_challenge_required", cfg.gLivenessChallengeRequired},
          {"liveness_challenge_metrics", challengeMetrics},
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
    const auto nowFrame = std::chrono::steady_clock::now();
    const auto fastFace = updateRealtimeFaceTracker(sessionId, frame, nowFrame);

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
    // ADR-148: señal de parpadeo dedicada para el liveness pasivo
    // (updateNaturalBlink), deliberadamente MÁS SENSIBLE que `eyesOpen`
    // (que sigue siendo la del chequeo ICAO real, "OJOS ABIERTOS" en
    // pantalla). Ver AiEngineFrameResult::blinkSignalOpen -- si el motor IA
    // no la manda (versión vieja durante un deploy en curso), cae a
    // `eyesOpen` como antes (mejor que nunca detectar un parpadeo).
    bool blinkSignalEyesOpen = true;
    bool mouthClosed = true;
    bool noGlasses = true;
    bool detected = eval.ok;

    if (eval.aiEval.has_value() && eval.aiEval->available) {
      eyesOpen = eval.aiEval->bothOpen;
      blinkSignalEyesOpen =
          eval.aiEval->hasBlinkSignalOpen ? eval.aiEval->blinkSignalOpen : eyesOpen;
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
    bool challengesCompleteOut = false;
    BiometricCaptureRuntimeState stCopy;
    {
      std::scoped_lock lk(gBiometricCaptureMutex);
      auto &slot = getOrCreateBiometricCaptureSession(sessionId);
      auto &st = slot.state;
      auto &capturedImages = slot.capturedImages;

      const auto now = nowFrame;

      st.detected = detected;
      st.eyesOpen = eyesOpen;
      st.mouthClosed = mouthClosed;
      st.noGlasses = noGlasses;
      st.faceStraight = frontal;
      st.hasFaceOval = false;
      st.faceOvalFastTracker = false;
      st.faceOvalConfidence = 0.0;
      if (fastFace.detected) {
        const auto &e = fastFace.oval;
        st.hasFaceOval = true;
        st.faceOvalFastTracker = true;
        st.faceOvalConfidence = fastFace.confidence;
        st.faceOvalCx = static_cast<double>(e.center.x);
        st.faceOvalCy = static_cast<double>(e.center.y);
        st.faceOvalW = static_cast<double>(e.size.width);
        st.faceOvalH = static_cast<double>(e.size.height);
        st.faceOvalAngleDeg = static_cast<double>(e.angle);
        st.faceOvalSourceW = static_cast<double>(frame.cols);
        st.faceOvalSourceH = static_cast<double>(frame.rows);
      }
      if (eval.aiEval.has_value() && eval.aiEval->available &&
          eval.aiEval->hasHeadYawRatio) {
        st.headYawRatio = eval.aiEval->headYawRatio;
      }
      if (eval.aiEval.has_value() && eval.aiEval->available &&
          eval.aiEval->hasInterEyePx) {
        st.interEyePx = eval.aiEval->interEyePx;
      }

      if (eval.aiEval.has_value() && eval.aiEval->available &&
          eval.aiEval->hasFaceOvalEllipse) {
        const auto &e = eval.aiEval->faceOvalEllipse;
        st.hasFaceOval = true;
        st.faceOvalFastTracker = false;
        st.faceOvalConfidence = 1.0;
        st.faceOvalCx = static_cast<double>(e.center.x);
        st.faceOvalCy = static_cast<double>(e.center.y);
        st.faceOvalW = static_cast<double>(e.size.width);
        st.faceOvalH = static_cast<double>(e.size.height);
        st.faceOvalAngleDeg = static_cast<double>(e.angle);
        st.faceOvalSourceW = static_cast<double>(frame.cols);
        st.faceOvalSourceH = static_cast<double>(frame.rows);
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
      // ADR-143: un parpadeo natural breve no debe contar como frame ICAO
      // inválido -- de lo contrario, parpadear con normalidad durante la
      // captura resetea el streak de lecturas justo por la señal que ahora
      // se exige como prueba de vida. updateNaturalBlink tolera el cierre
      // mientras dure una ventana plausible de parpadeo humano y registra el
      // ciclo cerrado->abierto como st.naturalBlink.observed. Sin rostro
      // detectado no se evalúa (evita falsos parpadeos con datos basura).
      const bool eyesOkForCapture =
          detected ? updateNaturalBlink(st.naturalBlink, blinkSignalEyesOpen, now) : eyesOpen;

      // Pedido explícito del usuario 2026-09-07: el parpadeo natural no es
      // sólo "ocurrió una vez en la sesión" (eso es `naturalBlink.observed`,
      // sticky para siempre desde ADR-143) -- acá se exige que NO haya pasado
      // demasiado tiempo desde el ÚLTIMO parpadeo confirmado, como control
      // anti-fraude continuo contra foto estática/máscara (ninguna de las
      // dos parpadea nunca). Si al inicio la persona parpadeaba y en algún
      // momento deja de hacerlo (p. ej. sustitución de la imagen a mitad de
      // sesión), isNaturalBlinkStale pasa a true apenas se cumple la
      // ventana máxima sin parpadeo -- ver kNaturalBlinkMaxSampleWindowMs.
      const bool blinkStale =
          detected && isNaturalBlinkStale(st.naturalBlink, now);

      // ADR temporal 2026-09-07 (pedido explícito del usuario): la detección
      // de lentes puestos ("suspected_glasses") todavía no es 100% estable,
      // así que se separa de las otras 3 condiciones (ojos/boca/frontal) que
      // SÍ siguen sin tolerancia. `coreValid` es esa exigencia estricta;
      // `frameValid` (las 4 condiciones ICAO + parpadeo vigente) es lo único
      // que hace subir captureCount -- lentes puestos sigue bloqueando el
      // avance, sólo cambia CUÁNDO resetea el contador ya ganado (ver bloque
      // de abajo y kIcaoGlassesInvalidFramesBeforeReset).
      const bool coreValid = detected && eyesOkForCapture && mouthClosed && frontal;
      const bool frameValid = coreValid && noGlasses && !blinkStale;

      st.totalFramesSeen++;

      // ADR-148 -- hallazgo real 2026-09-04 ("problema de control de
      // secuencia"): las 5 lecturas ICAO (captureCount) y el parpadeo
      // natural (ADR-143) son DOS condiciones independientes que juntas
      // arman qualityGateReached. Antes de este fix, mientras captureCount
      // ya estaba en 5/5 pero el parpadeo natural TODAVÍA no ocurría
      // (qualityGateReached seguía false por esa sola razón), el mismo
      // bloque que acumula/resetea captureCount se seguía re-evaluando en
      // cada frame -- así que un solo chequeo ICAO fallando 5 veces seguidas
      // DURANTE esa espera (glasses/frontal/mouth parpadeando, algo tan
      // simple como la persona reacomodándose sin saber que hay que
      // parpadear, porque no hay ningún aviso visual de esa etapa) reseteaba
      // captureCount de vuelta a 0/5, deshaciendo el "5/5" ya logrado y
      // obligando a repetir toda la lectura ICAO. Eso se sentía como "el
      // reto nunca llega": no es que tardara, es que el progreso se
      // reiniciaba en silencio antes de que el parpadeo llegara a
      // registrarse. Fix: separar el candado de "lecturas ICAO ya
      // completas" (icaoReadsLocked, sólo depende de captureCount/
      // totalFramesSeen) del candado más amplio qualityGateReached (ICAO +
      // parpadeo) -- una vez las lecturas ICAO se completan, el contador
      // NUNCA vuelve a bajar mientras se espera el parpadeo, ni tampoco
      // durante el desafío activo posterior (que ya fallaba "frontal" a
      // propósito, motivo original de este candado en ADR-142).
      //
      // Esa tolerancia sigue existiendo SÓLO mientras el desafío activo va a
      // correr de verdad -- si está desactivado
      // (BEEMETRY_LIVENESS_CHALLENGE_REQUIRED=false) nadie va a girar la
      // cabeza a propósito, así que seguir "congelando" el gate ante un
      // chequeo que de verdad falla después (p.ej. la persona se puso
      // lentes) sólo deja la sesión trabada sin nunca completar el login y
      // sin ningún feedback -- hallazgo real 2026-09-03. Con el desafío
      // apagado se revalida cada frame, igual que antes de ADR-142.
      const bool stickyQualityGate = AppConfig::instance().gLivenessChallengeRequired;
      const bool icaoReadsLocked = icaoReadsCompleted(st);
      if (!icaoReadsLocked || !stickyQualityGate) {
        if (frameValid) {
          st.captureInvalidStreak = 0;
          st.captureGlassesInvalidStreak = 0;
          st.lastResetReason.clear();
          if (st.captureCount < kRequiredValidCaptureFrames) {
            capturedImages.push_back("data:image/jpeg;base64," + base64);
            if (capturedImages.size() > kRequiredValidCaptureFrames) {
              capturedImages.erase(capturedImages.begin());
            }
          }
          st.captureCount = std::min(kRequiredValidCaptureFrames, st.captureCount + 1);
        } else if (!coreValid) {
          // Ojos/boca/frontal: sin tolerancia. Un solo frame que no cumpla
          // alguna de estas 3 devuelve el contador a 0/5 de inmediato (ADR-156,
          // kIcaoInvalidFramesBeforeReset == 1). El streak de lentes no aplica
          // acá -- se limpia para no arrastrar un fallo de lentes viejo hacia
          // la próxima racha.
          st.captureGlassesInvalidStreak = 0;
          st.captureInvalidStreak++;
          if (st.captureInvalidStreak >= kIcaoInvalidFramesBeforeReset) {
            st.captureCount = 0;
            st.captureInvalidStreak = 0;
            capturedImages.clear();
            st.lastResetReason = "icao_failed";
            logStageResetRealtime(sessionId, "icao_failed", st.challenge.attempt,
                                  kLivenessChallengeMaxAttempts);
            if (!stickyQualityGate) {
              // Sin desafíos no hay motivo para seguir "capturado" con una
              // lectura ICAO que ya dejó de cumplirse -- re-arma desde cero.
              st.qualityGateReached = false;
              st.challenge = LivenessChallengeState{};
              st.naturalBlink = NaturalBlinkState{};
            }
          }
        } else if (blinkStale) {
          // Ojos/boca/frontal/lentes están OK, pero el parpadeo dejó de
          // observarse dentro de la ventana máxima -- pedido explícito del
          // usuario 2026-09-07: esto NO resetea lo ya logrado (una persona
          // real puede simplemente tardar en volver a parpadear), sólo
          // PAUSA el avance del contador mientras dure. Una foto estática o
          // máscara nunca vuelve a parpadear, así que queda pausada para
          // siempre; una persona real se destraba sola en cuanto parpadea de
          // nuevo (updateNaturalBlink limpia staleFraudReported). Se reporta
          // el intento de fraude sospechado UNA sola vez por racha sin
          // parpadeo (no en cada frame) al log de auditoría interno -- sin
          // avisar nada al usuario.
          if (!st.naturalBlink.staleFraudReported) {
            st.naturalBlink.staleFraudReported = true;
            reportSuspectedBlinkFraud(sessionId, http_utils::getClientIp(req));
          }
        } else {
          // Único fallo es "lentes puestos" (las otras 3 condiciones y el
          // parpadeo están OK): tolerancia temporal de
          // kIcaoGlassesInvalidFramesBeforeReset (2) lecturas CONSECUTIVAS
          // con lentes antes de resetear -- la detección de lentes todavía
          // no es 100% estable, ver la constante en biometric_types.hpp. El
          // frame no suma al contador (frameValid es false), pero tampoco lo
          // tira a 0 salvo que se repita seguido.
          st.captureInvalidStreak = 0;
          st.captureGlassesInvalidStreak++;
          if (st.captureGlassesInvalidStreak >= kIcaoGlassesInvalidFramesBeforeReset) {
            st.captureCount = 0;
            st.captureGlassesInvalidStreak = 0;
            capturedImages.clear();
            st.lastResetReason = "glasses_detected";
            logStageResetRealtime(sessionId, "glasses_detected", st.challenge.attempt,
                                  kLivenessChallengeMaxAttempts);
            if (!stickyQualityGate) {
              st.qualityGateReached = false;
              st.challenge = LivenessChallengeState{};
              st.naturalBlink = NaturalBlinkState{};
            }
          }
        }
      }

      // Fuera del bloque de arriba a propósito: el parpadeo puede tardar
      // unos segundos en ocurrir DESPUÉS de que las lecturas ICAO ya se
      // completaron, y ese chequeo tiene que seguir corriendo en cada frame
      // durante esa espera aunque icaoReadsLocked ya sea true (ver
      // comentario largo arriba).
      const bool activeChallengeRequired = AppConfig::instance().gLivenessChallengeRequired;
      const bool blinkOk =
          !AppConfig::instance().gNaturalBlinkRequired || st.naturalBlink.observed ||
          (activeChallengeRequired && st.challenge.complete);
      if (icaoReadsLocked && blinkOk) {
        st.qualityGateReached = true;
      }

      // ADR-149 -- hallazgo real 2026-09-04: "hizo rápido 5/5 pero se demoró
      // en activar el reto". El desafío activo se armaba recién con
      // qualityGateReached (ICAO + parpadeo), pero un parpadeo involuntario
      // tarda en promedio 2-4s entre uno y otro, mucho más que las 5 lecturas
      // ICAO (~875ms a ~175ms/frame) -- así que casi SIEMPRE había una espera
      // real, en silencio, entre "5/5 en pantalla" y que apareciera el reto,
      // aunque el parpadeo llegara segundos después sin ningún problema. El
      // desafío y el parpadeo son dos pruebas de vida independientes que no
      // necesitan correr en secuencia -- sólo el gate FINAL de
      // handleLoginFace/handleRegister (qualityGateReached &&
      // challenge.complete, sin cambios) exige ambas. Arrancar el desafío en
      // cuanto terminan las lecturas ICAO (icaoReadsLocked), en paralelo con
      // la espera del parpadeo, no baja el nivel de exigencia -- sólo evita
      // la demora visible sin motivo aparente para quien está frente a la
      // cámara.
      if (icaoReadsLocked) {
        if (activeChallengeRequired) {
          if (!st.challenge.complete) {
            evaluateLivenessChallenge(st.challenge, st.headYawRatio, st.interEyePx,
                                      st.faceOvalCx, now);
          }
          // Pedido explícito del usuario 2026-09-07: el control de parpadeo
          // CONTINÚA durante TODA la etapa 2, incluso después de completar
          // el reto -- razón original: si el gesto se cumplió rápido pero
          // todavía faltaba parpadeo, el servidor seguía esperando
          // `qualityGateReached`, y sin este chequeo post-completo no había
          // ninguna ruta que reseteara si el parpadeo nunca llegaba.
          //
          // Hallazgo real 2026-09-09: esa razón ya no aplica -- `blinkOk`
          // (arriba) da por cumplido el parpadeo con `challenge.complete`
          // SOLO (`activeChallengeRequired && st.challenge.complete`, sin
          // exigir `naturalBlink.observed`), así que `qualityGateReached` NO
          // depende de seguir parpadeando una vez completado el reto -- este
          // chequeo post-completo resetea una condición que la propia
          // `blinkOk` ya no exige. Confirmado en vivo con log en tiempo real
          // (`[LIVENESS_RESET]`, capture_session real): un reset de
          // "blink_stale" disparó 7s DESPUÉS de que el cliente ya había
          // enviado el registro (`parsed_payload`) usando el frame capturado
          // en la etapa 1 -- inofensivo para ese registro puntual (el envío
          // ya usa un frame congelado, no el frame en vivo), pero seguía
          // reseteando la sesión de captura visible en pantalla, sumando un
          // "error" más de los que reportó el usuario sin ningún beneficio
          // de seguridad real. Se restringe a `!st.challenge.complete`,
          // igual que el candado sticky (ADR-148/149) ya hace para ICAO.
          if (!st.challenge.complete && !st.challenge.queue.empty() &&
              AppConfig::instance().gNaturalBlinkRequired && blinkStale) {
            if (!st.naturalBlink.staleFraudReported) {
              st.naturalBlink.staleFraudReported = true;
              reportSuspectedBlinkFraud(sessionId, http_utils::getClientIp(req));
            }
            const int attemptAtReset = st.challenge.attempt;
            st.captureCount = 0;
            st.captureInvalidStreak = 0;
            st.captureGlassesInvalidStreak = 0;
            capturedImages.clear();
            st.qualityGateReached = false;
            st.challenge = LivenessChallengeState{};
            st.naturalBlink = NaturalBlinkState{};
            st.lastResetReason = "blink_stale";
            logStageResetRealtime(sessionId, "blink_stale", attemptAtReset,
                                  kLivenessChallengeMaxAttempts);
          } else if (st.challenge.exhausted) {
            // ADR-156: se pidieron kLivenessChallengeMaxAttempts retos
            // distintos y no se cumplió ninguno. En vez de seguir sorteando
            // para siempre (lo que dejaba la sesión colgada hasta el timeout
            // del navegador, sin explicación en pantalla), se vuelve entera a
            // la etapa 1: contador ICAO a 0/5, parpadeo natural y desafío
            // desde cero. La persona rehace la lectura y se le vuelve a
            // pedir un reto, cuantas veces haga falta.
            const int attemptAtReset = st.challenge.attempt;
            st.captureCount = 0;
            st.captureInvalidStreak = 0;
            st.captureGlassesInvalidStreak = 0;
            capturedImages.clear();
            st.qualityGateReached = false;
            st.challenge = LivenessChallengeState{};
            st.naturalBlink = NaturalBlinkState{};
            st.lastResetReason = "challenge_exhausted";
            logStageResetRealtime(sessionId, "challenge_exhausted", attemptAtReset,
                                  kLivenessChallengeMaxAttempts);
          }
        } else {
          // ADR-142, desactivado temporalmente (BEEMETRY_LIVENESS_CHALLENGE_REQUIRED=false):
          // el gate de calidad ICAO (3 lecturas) se sigue exigiendo igual --
          // sólo se salta el reto de gesto, nunca se le pide al usuario.
          st.challenge.complete = true;
        }
      }

      // Hallazgo real 2026-09-08: con el candado sticky (ADR-148/149), el
      // bloque de arriba (línea ~391) deja de revisar ojos/boca/frontal/
      // lentes en cuanto icaoReadsLocked -- a propósito, para no deshacer un
      // 5/5 ya logrado por ruido transitorio durante el reto. Pero eso
      // significa que si la histéresis de lentes de ai_engine (ADR-119,
      // deliberadamente lenta: exige varios frames consistentes para no dar
      // falsos positivos por cejas/reflejos) recién CONFIRMA "con lentes"
      // después de que ICAO y el reto ya completaron, nada volvía a mirar esa
      // confirmación -- el registro seguía "listo para enviar" con lentes
      // puestos de verdad, reportado en vivo: 0/5→5/5 y reto completados con
      // lentes puestos, detectado recién después y sin ninguna forma de
      // corregir el registro ya trabado (ni el backend lo invalidaba ni el
      // frontend daba un mensaje específico -- sólo un reintento silencioso
      // sin salida). Misma tolerancia que la usada para construir el candado
      // (kIcaoGlassesInvalidFramesBeforeReset consecutivos, no 1 solo frame
      // ruidoso) para no penalizar una lectura aislada.
      if (icaoReadsLocked && stickyQualityGate) {
        // Hallazgo real 2026-09-10 (caso en vivo: usuario SIN lentes,
        // completó 0/5→5/5 correctamente, se le pidió turn_right y luego
        // move_closer/move_away -- exactamente ahí volvió a aparecer "lentes
        // detectados" y la sesión quedó trabada en resets hasta agotar el
        // timeout). La heurística CV de gafas (eye_analyzer.py::
        // glasses_from_frame) está calibrada con caras FRONTALES a distancia
        // ESTABLE (ver ADR-156 ahí); un giro de cabeza o un cambio de
        // distancia deforma el ROI ojos/puente nasal (sombras,
        // foreshortening) y puede leerse como "montura" -- un falso positivo
        // justo en el gesto que turn_left/turn_right/move_closer/move_away
        // le piden al usuario que haga. El bloque de más arriba (línea ~404)
        // ya excluye a propósito "frontal" del candado sticky por el mismo
        // motivo; este veto de gafas post-lock se había quedado sin la misma
        // tolerancia. Sólo se cuenta el frame si la cabeza está
        // razonablemente frontal y la distancia sigue cerca de la línea base
        // del reto (mismos umbrales que usa evaluateLivenessChallenge para
        // considerar el gesto en curso) -- un giro/acercamiento activo no
        // puede por sí solo disparar el reinicio completo de la captura.
        const bool headNearFrontal =
            std::abs(st.headYawRatio) < kLivenessHeadYawTurnThreshold;
        const double baselineIED = st.challenge.baselineInterEyePx;
        const bool distanceStable =
            baselineIED <= 1e-6 ||
            (st.interEyePx / baselineIED >= kLivenessMoveAwayRatio &&
             st.interEyePx / baselineIED <= kLivenessMoveCloserRatio);
        if (!noGlasses && headNearFrontal && distanceStable) {
          st.postLockGlassesStreak++;
          if (st.postLockGlassesStreak >= kIcaoGlassesInvalidFramesBeforeReset) {
            const int attemptAtReset = st.challenge.attempt;
            st.postLockGlassesStreak = 0;
            st.captureCount = 0;
            st.captureInvalidStreak = 0;
            st.captureGlassesInvalidStreak = 0;
            capturedImages.clear();
            st.qualityGateReached = false;
            st.challenge = LivenessChallengeState{};
            st.naturalBlink = NaturalBlinkState{};
            st.lastResetReason = "glasses_detected";
            logStageResetRealtime(sessionId, "glasses_detected_post_lock", attemptAtReset,
                                  kLivenessChallengeMaxAttempts);
          }
        } else {
          st.postLockGlassesStreak = 0;
        }
      }

      const double livenessScore = std::min(
          100.0,
          static_cast<double>(st.captureCount) * (100.0 / kRequiredValidCaptureFrames));
      st.livenessScore = livenessScore;

      if (st.qualityGateReached && st.challenge.complete) {
        st.state = 7;
      } else if (st.qualityGateReached) {
        st.state = 4;
      } else if (detected) {
        st.state = 4;
      } else {
        st.state = 1;
      }
      st.stateName = captureStateLabel(st.state);
      st.updatedAt = std::chrono::steady_clock::now();
      stateOut = st.state;
      challengesCompleteOut = st.challenge.complete;
      stCopy = st;
    }

    // Pedido explícito del usuario 2026-09-07: se devuelve directamente el
    // mismo payload rico que antes exigía un GET /api/status SEPARADO
    // encadenado después de este POST -- el estado ya está recién
    // actualizado acá mismo (stCopy, copiado bajo el lock de arriba), así
    // que armar y devolver ese JSON ahora ahorra un round-trip de red
    // completo por cada frame procesado (el cliente ya no necesita llamar a
    // fetchBiometricStatus() después de processBiometricFrame() -- ver
    // AuthGateway.tsx). `ok`/`state`/`challenges_complete` se mantienen al
    // tope del objeto por compatibilidad con clientes que todavía sólo leen
    // esos 3 campos (MaintenanceBiometricModal.tsx/UserManagementView.tsx).
    json::object payload = buildBiometricStatusJson(stCopy);
    payload["ok"] = true;
    payload["state"] = stateOut;
    payload["challenges_complete"] = challengesCompleteOut;
    return makeJsonResponse(http::status::ok, payload);
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", ex.what()}});
  }
}

static http::response<http::string_body>
handleTrackFrameFast(const http::request<http::string_body> &req,
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
    const auto fastFace = updateRealtimeFaceTracker(sessionId, frame);
    json::value faceOvalVal = nullptr;
    if (fastFace.detected) {
      const auto &e = fastFace.oval;
      faceOvalVal = json::object{
          {"cx", static_cast<double>(e.center.x)},
          {"cy", static_cast<double>(e.center.y)},
          {"w", static_cast<double>(e.size.width)},
          {"h", static_cast<double>(e.size.height)},
          {"angle_deg", static_cast<double>(e.angle)},
          {"source_w", static_cast<double>(frame.cols)},
          {"source_h", static_cast<double>(frame.rows)},
          {"source", "opencv_realtime_tracker"},
          {"confidence", fastFace.confidence},
          {"predicted", fastFace.predicted},
      };
    }
    return makeJsonResponse(
        http::status::ok,
        json::object{{"detected", fastFace.detected}, {"face_oval", faceOvalVal}});
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

/**
 * Arma el mismo payload rico que antes sólo devolvía GET /api/status, a
 * partir de un BiometricCaptureRuntimeState ya leído (bajo lock o copiado).
 * Pedido explícito del usuario 2026-09-07 ("la detección... tiene que ser
 * rápida a tiempo real"): antes cada ciclo del cliente hacía POST
 * /api/process_frame Y LUEGO, encadenado, GET /api/status -- dos
 * round-trips de red SECUENCIALES por cada frame procesado, cuando
 * handleProcessFrame ya tenía en memoria (dentro del mismo lock) todo lo
 * necesario para construir esta misma respuesta. Extraído a función
 * compartida para que handleProcessFrame pueda devolverlo directamente en
 * su propia respuesta (ver más abajo) sin duplicar el armado del JSON, y
 * handleStatus siga sirviendo /api/status para quien sólo necesite
 * consultar sin mandar un frame nuevo.
 */
static json::object buildBiometricStatusJson(const BiometricCaptureRuntimeState &s) {
  json::value faceOvalVal = nullptr;
  if (s.hasFaceOval) {
    faceOvalVal = json::object{
        {"cx", s.faceOvalCx},
        {"cy", s.faceOvalCy},
        {"w", s.faceOvalW},
        {"h", s.faceOvalH},
        {"angle_deg", s.faceOvalAngleDeg},
        {"source_w", s.faceOvalSourceW},
        {"source_h", s.faceOvalSourceH},
        {"source", s.faceOvalFastTracker ? "opencv_realtime_tracker" : "mediapipe_landmarks"},
        {"confidence", s.faceOvalConfidence},
    };
  }

  // Desafíos de liveness (ADR-142): fuente de verdad server-side, calculada a
  // partir de eyesOpen/mouthClosed/headYawRatio ya vistos por MediaPipe -- el
  // cliente sólo la refleja (AuthGateway.tsx::syncChallengeFromServer), nunca
  // la decide. Se manda la cola completa (2 tipos) para que la UI pueda
  // mostrar "1/2", "2/2" sin adivinar el segundo desafío.
  json::array challengeQueueArr;
  for (const auto &c : s.challenge.queue) {
    challengeQueueArr.push_back(json::value(c));
  }
  // ADR-149: el desafío arranca en cuanto terminan las 5 lecturas ICAO
  // (icaoReadsCompleted), sin esperar al parpadeo natural -- deben reflejar
  // la MISMA condición que arma/evalúa el desafío en handleProcessFrame, o
  // la UI mostraría "cargando" mientras el desafío ya corre en el servidor.
  const bool icaoDone = icaoReadsCompleted(s);
  long long deadlineMsRemaining = 0;
  if (icaoDone && !s.challenge.queue.empty()) {
    const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
        s.challenge.deadline - std::chrono::steady_clock::now());
    deadlineMsRemaining = std::max<long long>(0, remaining.count());
  }
  const json::object challengeVal{
      {"active", icaoDone && !s.challenge.complete},
      {"queue", challengeQueueArr},
      {"index", s.challenge.index},
      {"count", static_cast<int>(s.challenge.queue.size())},
      {"attempt", s.challenge.attempt},
      // ADR-156: cuántos retos se piden como máximo antes de reiniciar la
      // captura a 0/5 -- la UI lo muestra como "intento 2 de 5" para que la
      // persona vea que el proceso avanza y no se quedó trabado.
      {"max_attempts", kLivenessChallengeMaxAttempts},
      {"deadline_ms_remaining", deadlineMsRemaining},
      {"complete", s.challenge.complete},
  };

  auto &cfg = AppConfig::instance();
  return json::object{
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
      {"inter_eye_px", s.interEyePx},
      {"liveness_score", s.livenessScore},
      {"quality_gate_reached", s.qualityGateReached},
      {"natural_blink_observed", s.naturalBlink.observed},
      {"challenge", challengeVal},
      // Motivo del último reinicio forzado a etapa 1 (vacío si el último
      // frame fue válido) -- "glasses_detected" | "icao_failed" |
      // "blink_stale" | "challenge_exhausted". Ver hallazgo real 2026-09-08
      // en handleProcessFrame: sin esto el frontend no podía distinguir un
      // reinicio por lentes de cualquier otro, y mostraba el mismo mensaje
      // genérico en un bucle sin salida.
      {"reset_reason", s.lastResetReason},
  };
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
  return makeJsonResponse(http::status::ok, buildBiometricStatusJson(s));
}

void registerRoutes(router::Router &r) {
  r.get("/api/auth/biometric/status", handleBiometricStatus);
  r.post("/api/auth/biometric/verify-frame", handleVerifyFrame);
  r.post("/api/process_frame", handleProcessFrame);
  r.post("/api/track_frame_fast", handleTrackFrameFast);
  r.post("/api/dni/scan-document", handleScanDniDocument);
  r.get("/api/status", handleStatus);
}

} // namespace biometric
