#pragma once

#include <array>
#include <atomic>
#include <chrono>
#include <string>
#include <vector>

namespace biometric {

/**
 * Liveness activa server-side (ADR-142/146): tras cruzar el gate de calidad
 * ICAO (ver kRequiredValidCaptureFrames en biometric_types.hpp) y el
 * parpadeo natural (ADR-143), el servidor sortea 1 desafío de
 * {"turn_left","turn_right","move_closer","move_away"} y exige cumplirlo con
 * los mismos headYawRatio/interEyePx que ya calcula MediaPipe por frame en
 * /api/process_frame -- nunca lo decide el cliente, así no se puede fingir
 * "ya cumplí el desafío" sin que nadie haya visto el giro/movimiento real.
 * ADR-146 (2026-09-03) reemplazó blink/mouth como tipos de desafío (el
 * parpadeo ya queda cubierto, mejor, por el parpadeo NATURAL pasivo de
 * ADR-143) y bajó la cantidad exigida de 2 a 1; una primera iteración probó
 * tilt_forward/tilt_back (inclinar la cabeza) pero se reemplazó de inmediato
 * por move_closer/move_away (acercarse/alejarse de la cámara) a pedido
 * explícito del usuario -- "mejor control y facilidad de verificación" que
 * una inclinación sutil de cabeza.
 *
 * Deliberadamente en su propio header/fuente sin dependencias de OpenCV (a
 * diferencia de biometric_types.hpp) para poder testear la máquina de
 * estados con Catch2 en el target liviano beemetry_backend_tests (ver
 * CMakeLists.txt) -- mismo criterio que mining/alarm_rule_evaluator.hpp.
 */
struct LivenessChallengeState {
  std::vector<std::string> queue;
  int index = 0;
  int attempt = 1;
  std::chrono::steady_clock::time_point deadline{};
  bool complete = false;
  /** ADR-156: se agotaron los kLivenessChallengeMaxAttempts retos de la
   * sesión sin cumplir ninguno. El llamador (handleProcessFrame) reacciona
   * reseteando TODA la captura a la etapa 1 (contador ICAO a 0/5, parpadeo
   * y desafío desde cero) -- antes de esto la máquina reintentaba para
   * siempre y la sesión se quedaba colgada hasta el timeout del navegador,
   * sin que la persona supiera nunca por qué. */
  bool exhausted = false;
  /** interEyePx capturado al sortear la cola (primera llamada de la sesión):
   * referencia de "distancia neutral" contra la que se mide el cambio
   * relativo que exigen move_closer/move_away -- la distancia interocular en
   * píxeles varía mucho entre personas/cámaras/asientos, así que un umbral
   * absoluto no serviría igual para todos; el umbral es siempre relativo a
   * esta referencia de la propia sesión. */
  double baselineInterEyePx = 0.0;
  /** Centro X (píxeles) del óvalo facial (AiEngineFrameResult::faceOvalEllipse
   * vía BiometricCaptureRuntimeState::faceOvalCx) capturado junto con
   * baselineInterEyePx -- referencia de "posición neutral" contra la que se
   * mide el desplazamiento lateral que exigen shift_left/shift_right (pedido
   * explícito del usuario 2026-09-07, distinto de turn_left/turn_right: ahí
   * la cabeza GIRA sobre su eje, acá se DESPLAZA de lado sin girar). */
  double baselineFaceCenterX = 0.0;
};

/** Cuántos desafíos hay que cumplir por sesión (ADR-146: bajado de 2 a 1 a
 * pedido explícito del usuario). Debe coincidir con CHALLENGE_COUNT en
 * frontend/src/auth/livenessChallenge.ts. */
static constexpr int kLivenessChallengeCount = 1;

/** Ventana para cumplir CADA desafío una vez mostrado (ms). Debe coincidir
 * con CHALLENGE_TIMEOUT_MS en frontend/src/auth/livenessChallenge.ts. */
static constexpr int kLivenessChallengeTimeoutMs = 8000;

/**
 * ADR-156 (2026-09-04, pedido explícito del usuario): cuántas VECES se le
 * pide un reto a la persona en una sesión antes de rendirse. Ya no son
 * "reintentos del mismo tipo": cada intento sortea un tipo DISTINTO al que
 * acaba de vencer (ver evaluateLivenessChallenge), así que el reto es
 * variado y aleatorio en cada pedido. Al vencer el intento número
 * kLivenessChallengeMaxAttempts sin cumplir ninguno se marca
 * `LivenessChallengeState::exhausted` y la captura vuelve entera a la etapa
 * 1 (0/5). Antes valía 4 reintentos del MISMO tipo seguidos de un reemplazo
 * con reintentos frescos -- es decir, un bucle infinito: nunca se rendía y
 * la sesión quedaba colgada hasta el timeout del navegador. Debe coincidir
 * con CHALLENGE_MAX_ATTEMPTS en frontend/src/auth/livenessChallenge.ts.
 */
static constexpr int kLivenessChallengeMaxAttempts = 5;

/** |headYawRatio| a partir del cual se considera un giro deliberado. Debe
 * coincidir con HEAD_YAW_TURN_THRESHOLD en
 * frontend/src/auth/livenessChallenge.ts. */
static constexpr double kLivenessHeadYawTurnThreshold = 0.20;

/**
 * Umbrales de move_closer/move_away (ADR-146), como proporción de
 * interEyePx respecto a `LivenessChallengeState::baselineInterEyePx` (la
 * distancia interocular en píxeles al momento de sortear la cola). Acercarse
 * agranda la cara en el frame (IED sube); alejarse la achica (IED baja).
 * 1.25 = 25% más grande que la referencia; 0.80 = 20% más chica -- pide un
 * movimiento claro e inequívoco sin exigir un desplazamiento extremo.
 * PENDIENTE DE VALIDAR con datos reales de producción, igual que
 * kLivenessHeadYawTurnThreshold en su momento (ver ADR-125/126).
 */
static constexpr double kLivenessMoveCloserRatio = 1.25;
static constexpr double kLivenessMoveAwayRatio = 0.80;

/**
 * Umbral de shift_left/shift_right (pedido explícito del usuario
 * 2026-09-07), como proporción del desplazamiento lateral del centro del
 * óvalo facial (`faceOvalCx`) respecto a `baselineFaceCenterX`, normalizado
 * por `baselineInterEyePx` (misma técnica que move_closer/move_away: un
 * umbral absoluto en píxeles no serviría igual para todas las cámaras/
 * distancias). A diferencia de turn_left/turn_right (headYawRatio, giro
 * sobre el propio eje -- nariz se mueve respecto al eje interocular DE LA
 * MISMA cara), esto mide un desplazamiento de TODA la cabeza sin girar --
 * nose y ojos se mueven juntos, headYawRatio se mantiene ~constante. 0.35 es
 * un punto de partida deliberadamente similar en orden de magnitud a
 * kLivenessHeadYawTurnThreshold; PENDIENTE DE VALIDAR con datos reales de
 * producción, igual que los demás umbrales de liveness activa (ver
 * ADR-125/126).
 */
static constexpr double kLivenessHeadShiftRatio = 0.35;

/** Los 6 tipos de desafío posibles, fuente única para sorteo y para indexar
 * las métricas de abajo (evita mantener dos listas iguales). */
constexpr std::array<const char *, 6> kLivenessChallengeTypes = {
    "turn_left", "turn_right", "shift_left", "shift_right", "move_closer", "move_away"};

/** Índice de `type` en kLivenessChallengeTypes, o -1 si no coincide con
 * ninguno (defensivo -- no debería pasar salvo bug). */
int livenessChallengeTypeIndex(const std::string &type);

/**
 * Telemetría de calibración (ADR-126: "recomendable agregar un contador de
 * finalización/timeout por tipo de desafío antes de la próxima
 * recalibración, en vez de depender de observación manual"). Contadores de
 * proceso, no persistidos -- alcanza para decidir con evidencia real si
 * kLivenessChallengeTimeoutMs sigue siendo insuficiente tras la reactivación
 * de 2026-09-03 (ADR-142), sin agregar una tabla nueva para algo que aún no
 * se sabe si hace falta conservar entre reinicios. Expuesto en
 * GET /api/auth/biometric/status (gated admin, ver biometric_routes.cpp).
 */
struct LivenessChallengeTypeCounters {
  std::atomic<long long> armed{0};      ///< ventana mostrada (intento nuevo o reintento)
  std::atomic<long long> succeeded{0};  ///< gesto cumplido dentro de la ventana
  std::atomic<long long> timedOut{0};   ///< ventana agotada sin cumplir el gesto
};

extern std::array<LivenessChallengeTypeCounters, kLivenessChallengeTypes.size()>
    gLivenessChallengeMetrics;

/** Sortea kLivenessChallengeCount desafíos distintos, en orden aleatorio.
 * Equivalente C++ de pickChallengeQueue en livenessChallenge.ts (antes del
 * ADR-142 vivía del lado del cliente; ahora sólo el servidor sortea). */
std::vector<std::string> pickChallengeQueue();

/** Sortea un tipo de desafío que NO esté en `exclude`. Se usa en cada
 * intento nuevo tras un timeout (ADR-156) para que el reto pedido sea
 * siempre distinto al que acaba de vencer. Si no queda ninguno fuera de
 * `exclude`, devuelve el último de la lista (repetir es preferible a
 * quedarse sin reto). */
std::string pickReplacementChallenge(const std::vector<std::string> &exclude);

/**
 * Evalúa/avanza la máquina de estados de `st` con headYawRatio/interEyePx/
 * faceOvalCx YA calculados por MediaPipe en este frame. No hace nada si
 * st.complete ya es true. Si st.queue está vacía, sortea la cola Y captura
 * interEyePx/faceOvalCx como `st.baselineInterEyePx`/`st.baselineFaceCenterX`
 * (primera llamada tras cruzar el gate de calidad + parpadeo natural).
 */
void evaluateLivenessChallenge(LivenessChallengeState &st, double headYawRatio,
                                double interEyePx, double faceOvalCx,
                                std::chrono::steady_clock::time_point now);

/**
 * Parpadeo natural (ADR-143): a diferencia del desafío de arriba (un gesto
 * PEDIDO a propósito, en su propia fase secuencial porque gira la cabeza o
 * abre la boca -- físicamente incompatible con "de frente"/"boca cerrada"),
 * el parpadeo natural es compatible en SIMULTÁNEO con el resto de chequeos
 * ICAO: no mueve la cabeza ni la boca, así que se evalúa durante la MISMA
 * ventana de 5 lecturas, sin pedirle ningún gesto especial a la persona.
 *
 * El problema que resuelve: sin esto, un parpadeo real justo durante la
 * captura cuenta como frame ICAO inválido (ojos cerrados) y puede resetear
 * el contador de lecturas -- castigando exactamente la señal biológica que
 * se quiere exigir como prueba de vida. La solución es tolerar un cierre de
 * ojos BREVE (duración plausible de parpadeo humano) como "ojos OK" a
 * efectos del contador, mientras esas mismas frames registran el ciclo
 * cerrado->abierto como parpadeo observado. Un cierre que se sostiene más
 * allá de la ventana plausible deja de tolerarse (ya no es un parpadeo).
 */
struct NaturalBlinkState {
  bool eyesClosedSinceSet = false;
  std::chrono::steady_clock::time_point eyesClosedSince{};
  bool observed = false;
  /** Arranca en el primer frame procesado de la sesión (con o sin rostro) --
   * punto de partida para medir "sin ningún parpadeo todavía" antes de que
   * exista un `lastBlinkAt`. Ver isNaturalBlinkStale. */
  bool windowStartSet = false;
  std::chrono::steady_clock::time_point windowStart{};
  /** Momento del último ciclo cerrado->abierto confirmado como parpadeo
   * plausible. A diferencia de `observed` (sticky para siempre, ADR-143),
   * esto SÍ se usa para exigir parpadeo CONTINUO -- pedido explícito del
   * usuario 2026-09-07: si al inicio la persona parpadeaba y luego deja de
   * hacerlo (p. ej. sustitución por una foto estática a mitad de sesión), la
   * ausencia de parpadeos recientes debe poder detectarse igual, no sólo la
   * ausencia total desde el arranque. */
  bool lastBlinkAtSet = false;
  std::chrono::steady_clock::time_point lastBlinkAt{};
  /** Ya se reportó el intento de fraude sospechado (ver
   * kNaturalBlinkMaxSampleWindowMs) para la racha actual sin parpadear --
   * evita escribir una fila de auditoría por cada frame mientras se
   * mantiene sin parpadear. Se limpia apenas vuelve a observarse un
   * parpadeo real. */
  bool staleFraudReported = false;
};

/** Formal, dado el muestreo ~175ms (VERIFY_SYNC_MS) -- no resuelve parpadeos
 * más cortos que eso de todos modos, pero documenta la intención. */
constexpr int kNaturalBlinkMinDurationMs = 40;
/** Por encima de esto ya no es un parpadeo -- es un cierre sostenido (mirar
 * hacia abajo, ojos genuinamente cerrados) y debe volver a contar como frame
 * ICAO inválido, igual que antes de este mecanismo. */
constexpr int kNaturalBlinkMaxDurationMs = 1500;

/**
 * Ventana máxima sin NINGÚN parpadeo confirmado (desde el último parpadeo, o
 * desde el arranque de la sesión si todavía no hubo ninguno) antes de
 * considerar la captura sospechosa de fraude por ausencia de vida real --
 * pedido explícito del usuario 2026-09-07, control anti-foto-estática/
 * máscara: ninguna de las dos parpadea, una persona real sí, en promedio
 * cada 2-4s en reposo (ver razonamiento de kLivenessChallengeTimeoutMs/
 * ADR-149).
 *
 * Hallazgo real 2026-09-09, con evidencia directa de `auth_audit_logs`
 * (`biometric_capture_blink_fraud_suspected`, capture_session real de un
 * registro real: 7 disparos en la misma sesión, cada ~14-27s): 12s no
 * alcanza, porque este chequeo corre durante TODA la etapa 2 (mientras se
 * cumple el reto activo, ver handleProcessFrame), y el ritmo de parpadeo de
 * una persona real BAJA de forma bien documentada mientras concentra la
 * mirada en una tarea visual/cognitiva (leer la instrucción y ejecutar el
 * gesto) -- 2-4s es el ritmo en reposo, no el de alguien concentrado
 * siguiendo instrucciones en pantalla. Con hasta 5 intentos de reto de 8s
 * cada uno (`kLivenessChallengeMaxAttempts` x `kLivenessChallengeTimeoutMs`
 * = 40s posibles de sesión legítima), una ventana de 12s se agota mucho
 * antes de que el usuario agote sus intentos reales del reto, y el reset
 * que dispara ("blink_stale") es indistinguible en pantalla de agotar los 5
 * intentos -- de ahí el reporte real del usuario de "se resetea en el
 * segundo intento", cuando la causa real era esta ventana, no el contador
 * de intentos del reto (ver `challenge.exhausted`, que si funciona
 * correctamente). Subida a 45s: cubre holgadamente el peor caso legítimo
 * (40s de reto completo) sin debilitar el control -- una foto estática o
 * máscara sigue sin parpadear NUNCA, tampoco en 45s.
 */
constexpr int kNaturalBlinkMaxSampleWindowMs = 45000;

/**
 * Actualiza `st` con el frame actual (eyesOpen ya calculado por MediaPipe,
 * mismo booleano que llega en AiEngineFrameResult::bothOpen) y devuelve si
 * este frame debe contar como "ojos OK" para el gate de calidad ICAO --
 * true si los ojos están abiertos, o si están dentro de una ventana de
 * parpadeo en curso. `st.observed` pasa a true la primera vez que se
 * completa un ciclo cerrado->abierto de duración plausible (esa es la
 * prueba de vida) y permanece true el resto de la sesión.
 */
bool updateNaturalBlink(NaturalBlinkState &st, bool eyesOpen,
                        std::chrono::steady_clock::time_point now);

/**
 * True si pasaron >= kNaturalBlinkMaxSampleWindowMs desde el último parpadeo
 * confirmado (o desde que arrancó la ventana de muestreo, si todavía no
 * hubo ninguno) sin que se complete un nuevo ciclo -- señal de que la imagen
 * dejó de parpadear (foto estática o máscara sustituida a mitad de sesión, o
 * nunca hubo un rostro vivo real frente a la cámara). No queda "trabado" en
 * true para siempre: apenas se confirma un parpadeo nuevo (updateNaturalBlink
 * pone lastBlinkAt al día), el reloj se reinicia.
 */
bool isNaturalBlinkStale(const NaturalBlinkState &st,
                        std::chrono::steady_clock::time_point now);

}  // namespace biometric
