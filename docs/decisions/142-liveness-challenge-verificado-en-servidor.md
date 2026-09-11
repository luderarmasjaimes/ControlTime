# ADR-142 — 3 lecturas ICAO + 2 desafíos de liveness verificados en el servidor (no en el cliente)

**Status**: implemented

**Fecha**: 2026-09-03

**Ámbito**: ia

## Actualización 2026-09-03 — reactivación + telemetría de calibración

`BEEMETRY_LIVENESS_CHALLENGE_REQUIRED` vuelve a `true` por defecto en
`docker-compose.yml` (estuvo en `false` unas horas para una prueba manual
puntual, ver sección 2 más abajo). Mientras estuvo en `false`, el bypass que
este ADR corrige (foto/máscara estática basta con solo pasar el chequeo de
calidad ICAO) volvía a existir; con la reactivación queda cerrado de nuevo.

Se agrega además la telemetría que ADR-126 dejaba pendiente ("recomendable
agregar un contador de finalización/timeout por tipo de desafío... en vez de
depender de observación manual"): `liveness_challenge.hpp`/`.cpp` suman
`LivenessChallengeTypeCounters` (atómicos de proceso `armed`/`succeeded`/
`timedOut`, uno por tipo de gesto), incrementados desde
`evaluateLivenessChallenge()` en los mismos puntos donde ya se decide sortear,
reintentar o dar por cumplido un desafío — sin tocar la máquina de estados en
sí. `GET /api/auth/biometric/status` (gated admin) ahora expone
`liveness_challenge_required` y `liveness_challenge_metrics` (por tipo:
`armed`/`succeeded`/`timed_out`). Con esto se puede por fin responder con
datos reales, y no con "se probó a mano y no llegó ninguna petición" (el
método usado en la ronda de 2026-08-19 de ADR-126), si `kLivenessChallengeTimeoutMs`
(8000 ms) sigue siendo insuficiente para algún tipo de gesto en particular.

Los contadores son de proceso (se reinician con el backend), no se
persisten: alcanza para decidir si hace falta una recalibración fina antes de
construir algo más permanente para algo que todavía no se sabe si hace falta
conservar entre reinicios.

Referencias nuevas: `backend/src/biometric/liveness_challenge.hpp/.cpp`
(`kLivenessChallengeTypes`, `gLivenessChallengeMetrics`,
`livenessChallengeTypeIndex`), `backend/src/biometric/biometric_routes.cpp`
(`handleBiometricStatus`).

**Relación**: reemplaza la fuente de verdad de ADR-126 (liveness activa por
desafío-respuesta) — la arquitectura de 2-de-4 desafíos sigue siendo la misma,
pero quién decide "se cumplió" cambia de cliente a servidor; ajusta el
`REQUIRED_VALID_FRAMES`/`kRequiredValidCaptureFrames` que subió ADR-119 (de 3
a 5, por la histéresis de lentes) volviéndolo a 3 sin reabrir esa carrera;
consume `head_yaw_ratio` de ADR-125 y la sesión de captura por pestaña de
ADR-098.

## Contexto

Pedido explícito del usuario: (1) la validación biométrica debe exigir
primero 3 lecturas faciales correctas de los 4 patrones ICAO (ojos, boca,
frontalidad, sin lentes); (2) esas 4 lecturas dejan de considerarse "la"
validación por sí solas — hay que exigir además que se cumplan los 2
desafíos de liveness activa (ADR-126: parpadeo/boca/giro de cabeza) para
probar que hay una persona viva frente a la cámara, no una foto, una máscara
u otro mecanismo de fraude facial.

Al auditar el estado real del sistema se encontró que **el frontend ya
bloqueaba el login/registro** con ambos gates (`hasRequiredBiometricSamples`
+ `challengesPassedRef.current` en `AuthGateway.tsx`) — no era código muerto
ni un gate roto. El hueco real estaba en el backend: `POST
/api/auth/login/face` y `POST /api/auth/register` (`main.cpp`) sólo recibían
`company` + `identity_login` + `face_image_base64`/`face_template`, **sin
ninguna referencia a la sesión de captura**. El backend sí mantenía una
sesión en vivo por pestaña (`X-Capture-Session-Id` →
`gBiometricCaptureSessions`, ADR-098) alimentada en cada frame vía `POST
/api/process_frame`, pero nada la consultaba al momento de loguear o
registrar. Consecuencia concreta: un cliente que le pegara directo a esos
dos endpoints (curl, replay de un frame de video, o una app propia) pasaba
sin haber cumplido ni las lecturas ICAO ni los 2 desafíos — toda la lógica de
liveness vivía sólo en JS del navegador, trivial de saltarse. El
`livenessScore` que ya calculaba `handleProcessFrame` tampoco medía gestos:
era `captureCount / kRequiredValidCaptureFrames * 100`, un reempaquetado del
streak de calidad ICAO, no evidencia de parpadeo/boca/giro.

Bajar `REQUIRED_VALID_FRAMES` de 5 a 3 sin más reabre la carrera contra la
histéresis de lentes que motivó subirlo a 5 (ADR-119): con sólo 3 frames
(~525ms a `VERIFY_SYNC_MS`) la captura podía completarse antes de que
`GLASSES_SCORE_HIST_LEN=5` en `eye_analyzer.py` tuviera evidencia para
confirmar "con lentes".

## Decisión

### 1. 3 lecturas, protección de lentes movida al backend

- `frontend/src/config/facialIcaoConfig.ts` (`REQUIRED_VALID_FRAMES`) y
  `backend/src/biometric/biometric_types.hpp`
  (`kRequiredValidCaptureFrames`): 5 → **3**.
- Nueva constante `kGlassesHistWarmupFrames = 5` (biometric_types.hpp):
  `BiometricCaptureRuntimeState` suma `totalFramesSeen` (incrementado en
  cada `/api/process_frame`, válido o no); el gate de calidad
  (`qualityGateReached`) sólo se marca cuando `captureCount >=
  kRequiredValidCaptureFrames` **y** `totalFramesSeen >=
  kGlassesHistWarmupFrames` — las 3 lecturas pedidas se mantienen, pero el
  detector de lentes ya tuvo su ventana completa de evidencia.
- `qualityGateReached` se cruza **una sola vez** por sesión: a partir de ahí
  `captureInvalidStreak` deja de poder resetear `captureCount`
  (`handleProcessFrame`, `biometric_routes.cpp`). Sin esto, los desafíos de
  giro de cabeza (que fallan "frontal" a propósito) habrían roto la sesión en
  cuanto el usuario girara la cabeza. Esto es, literalmente, el punto 2 del
  pedido: las 4 lecturas ICAO dejan de revalidarse en cada frame una vez
  cumplidas — son un gate que se cruza una vez, no la validación en curso.

### 2. Desafíos de liveness: el servidor decide, no el cliente

Nuevo módulo `backend/src/biometric/liveness_challenge.{hpp,cpp}` —
deliberadamente sin dependencia de OpenCV (a diferencia de
`biometric_types.hpp`) para poder testearlo con Catch2 en el target liviano
`beemetry_backend_tests` (mismo criterio que `mining/alarm_rule_evaluator.hpp`):

- `LivenessChallengeState`: cola de 2 desafíos, índice, intento, deadline,
  `complete`, y dos flags de flanco (`eyesWereClosedDuringChallenge`,
  `mouthWasOpenDuringChallenge`).
- `pickChallengeQueue()` / `pickReplacementChallenge()`: sortean 2 de
  `{blink, mouth, turn_left, turn_right}` **en el servidor** — nunca los
  manda el cliente, así no se puede fingir "ya cumplí los desafíos".
- `evaluateLivenessChallenge()`: consume `eyesOpen`/`mouthClosed` (booleans
  ya calculados por MediaPipe en `ai_engine/eye_analyzer.py`, vía
  `AiEngineFrameResult`) y `headYawRatio`, más los valores del frame
  anterior. `blink`/`mouth` exigen el flanco cerrado→abierto (una foto fija
  nunca lo genera, a diferencia de sólo chequear "ojos cerrados en algún
  frame"); `turn_left`/`turn_right` comparan `headYawRatio` contra
  `kLivenessHeadYawTurnThreshold` (0.20, igual que ADR-126). Timeout
  (`kLivenessChallengeTimeoutMs=8000`) y reintentos
  (`kLivenessChallengeMaxAttempts=4`) igualan las constantes de ADR-126.
- `BiometricCaptureRuntimeState` (biometric_types.hpp) suma un miembro
  `LivenessChallengeState challenge`; `handleProcessFrame`
  (`biometric_routes.cpp`) llama a `evaluateLivenessChallenge` en cada
  frame una vez `qualityGateReached`, y `GET /api/status` expone
  `challenge: {queue, index, attempt, deadline_ms_remaining, complete,
  active}` — el cliente sólo refleja este objeto, nunca decide.
- **Interruptor operativo** (`AppConfig::gLivenessChallengeRequired`, env
  `BEEMETRY_LIVENESS_CHALLENGE_REQUIRED`, default `true`): con `false`,
  `handleProcessFrame` marca `st.challenge.complete = true` en cuanto se
  cruza `qualityGateReached`, sin sortear cola ni pedir ningún gesto — el
  gate de calidad ICAO (3 lecturas) se sigue exigiendo igual. `handleLoginFace`/
  `handleRegister` no necesitan rama especial: como `challenge.complete` ya
  es `true`, el gate de la sección 3 pasa solo. El frontend tampoco necesita
  cambios: `syncChallengeFromServer` ya refleja `complete` sin importar si
  la cola quedó vacía, así que ningún overlay de desafío llega a pintarse.
  **Desactivado temporalmente el 2026-09-03** (pedido explícito del usuario,
  `docker-compose.yml`: `BEEMETRY_LIVENESS_CHALLENGE_REQUIRED:-false`) para
  facilitar la validación biométrica facial durante pruebas — pendiente
  reactivar (volver el default a `true`) antes de considerar el sistema
  listo para producción, ya que mientras esté en `false` vuelve a existir el
  bypass de fraude facial que este ADR corrige (una foto/máscara estática
  vuelve a bastar, sólo queda el chequeo de calidad de imagen ICAO).

### 3. El gate real: exigirlo al loguear o registrar

`handleLoginFace` y `handleRegister` (`main.cpp`) agregan, con el mismo
patrón que ya usaba el endpoint legacy `handleEnroll`:

```cpp
const std::string sessionId = captureSessionIdFromRequest(req);
std::scoped_lock lk(gBiometricCaptureMutex);
auto &slot = getOrCreateBiometricCaptureSession(sessionId);
if (!slot.state.qualityGateReached || !slot.state.challenge.complete) {
  return makeJsonResponse(http::status::bad_request,
    json::object{{"error", "liveness_challenge_incomplete"}});
}
```

Esto cierra el hueco para ambos caminos de `handleLoginFace` (imagen y el
`face_template` crudo que el propio código ya señalaba como "el camino de
menor resistencia de todo el sistema de auth") y para `handleRegister`: sin
una sesión real que haya cruzado el gate de calidad y completado los 2
desafíos, ninguno de los dos endpoints acepta el intento.

### 4. Frontend: deja de decidir, sólo refleja

- `authApi.ts`: `getCaptureSessionId()` (antes privada) ahora se exporta y
  viaja también en `loginWithFace`/`registerUser` (antes sólo en
  `/api/process_frame` y `/api/status`) vía el nuevo `headers` opcional de
  `postJson`.
- `AuthGateway.tsx`: `syncChallengeFromServer` reemplaza
  `advanceOrCompleteChallenge`/`trySatisfyGestureChallenge`/
  `trySatisfyYawChallenge`/`checkChallengeTimeout` — refleja el `challenge`
  de `GET /api/status` en `challengeUiState`/`challengesPassedRef`,
  preservando el mismo timing visual (flash de éxito 700ms, flash de
  timeout 1200ms) pero disparado por el cambio de `index`/`attempt` del
  servidor, no por detección local. El conteo de parpadeo/boca local
  (`livenessBlinkRef`/`livenessMouthEventsRef`) se mantiene intacto —
  sigue alimentando el score de liveness pasivo/fallback, un mecanismo
  aparte que este ADR no toca.
- `livenessChallenge.ts`: pierde `pickChallengeQueue`/
  `pickReplacementChallenge`/`yawSatisfiesChallenge` (la cola y su
  evaluación ahora son 100% servidor); conserva tipos, constantes
  (documentando qué debe coincidir con `liveness_challenge.hpp`) y
  `challengeInstructionKey` para la UI. `createInitialChallengeState` ahora
  arranca con cola vacía en vez de sortear una localmente.

## Consecuencias

### Positivas
- Cierra un bypass de autenticación real: antes, un cliente scripteado podía
  loguearse o registrarse con una imagen estática sin haber demostrado nunca
  un parpadeo, apertura de boca o giro de cabeza reales — ahora el servidor
  lo rechaza con `liveness_challenge_incomplete` sin importar qué mande el
  cliente.
- El mismo gate también cierra, de paso, el camino más débil ya documentado
  en el código (`face_template` crudo en login): sin sesión completa, ese
  camino tampoco pasa.
- 3 lecturas en vez de 5 (pedido del usuario) sin reabrir la carrera de
  lentes de ADR-119, gracias a `kGlassesHistWarmupFrames` como gate
  independiente.
- Máquina de estados de desafíos ahora cubierta por pruebas unitarias
  (`backend/tests/test_liveness_challenge.cpp`) — antes tenía cero
  cobertura en ningún lado (ni cliente ni servidor).

### Negativas / Trade-offs
- Nuevo endpoint de escritura server-side por request (login/registro) que
  toma `gBiometricCaptureMutex` — contención adicional mínima, mismo lock
  que ya usan `handleProcessFrame`/`handleStatus`/`handleEnroll`.
- El cliente ya no puede mostrar el desafío "instantáneamente" al cruzar el
  gate de calidad — depende de la próxima respuesta de `/api/status`
  (~175ms, `VERIFY_SYNC_MS`), un retraso imperceptible en la práctica pero
  real.
- La reproducción del flash visual de éxito/timeout a partir de las
  transiciones de `index`/`attempt` del servidor es una heurística
  (`syncChallengeFromServer` en `AuthGateway.tsx`), no una réplica exacta de
  una máquina de estados local — cubre los casos reales (avance, timeout con
  reintento) pero es más frágil ante reordenamientos de red que el diseño
  100% local anterior.

## Alternativas descartadas

- **Mandar el resultado del desafío desde el cliente (p.ej. "blink_ok:
  true") y confiar en él**: exactamente el problema que este ADR corrige —
  un valor booleano mandado por el cliente no prueba nada, se puede fabricar
  sin cámara ni gesto real, sin necesidad de mover la evaluación al
  servidor; sólo desplaza el hueco de lugar.
- **Streaming de video completo al servidor para análisis server-side
  independiente**: descartado por costo/latencia — el servidor ya recibe
  cada frame vía `/api/process_frame` (mismo flujo que ya usa la UI en vivo)
  y ya calcula `eyesOpen`/`mouthClosed`/`headYawRatio` por frame con
  MediaPipe; reevaluar esas mismas señales para los desafíos no agrega
  tráfico ni cómputo nuevo.
- **Mantener `REQUIRED_VALID_FRAMES=5`**: descartado — pedido explícito del
  usuario de bajarlo a 3; se resuelve el riesgo de ADR-119 con un gate de
  calentamiento independiente (`kGlassesHistWarmupFrames`) en vez de
  renunciar al pedido.

## Referencias

- `backend/src/biometric/liveness_challenge.hpp` / `.cpp` (nuevo)
- `backend/src/biometric/biometric_types.hpp`
  (`BiometricCaptureRuntimeState::challenge/qualityGateReached/totalFramesSeen`,
  `kRequiredValidCaptureFrames`, `kGlassesHistWarmupFrames`)
- `backend/src/biometric/biometric_routes.cpp` (`handleProcessFrame`,
  `handleStatus`)
- `backend/src/main.cpp` (`handleLoginFace`, `handleRegister`)
- `backend/tests/test_liveness_challenge.cpp` (nuevo)
- `frontend/src/config/facialIcaoConfig.ts` (`REQUIRED_VALID_FRAMES`)
- `frontend/src/auth/livenessChallenge.ts`
- `frontend/src/auth/livenessChallenge.test.ts` (nuevo)
- `frontend/src/auth/authApi.ts` (`getCaptureSessionId`, `loginWithFace`,
  `registerUser`, `postJson`)
- `frontend/src/components/Auth/AuthGateway.tsx` (`syncChallengeFromServer`)
- ADR-126 (arquitectura de 2-de-4 desafíos que este ADR mantiene, cambiando
  sólo quién decide el resultado)
- ADR-119 (motivo original de `REQUIRED_VALID_FRAMES=5`, ahora resuelto de
  otra forma)
- ADR-125 (`head_yaw_ratio_from_points`)
- ADR-098 (aislamiento de sesión de captura biométrica por pestaña)
