# ADR-146 — Desafío activo reducido a 1 gesto, blink/mouth reemplazados por acercarse/alejarse de la cámara

**Status**: implemented

**Fecha**: 2026-09-03

**Ámbito**: ia

**Relación**: modifica ADR-142/126 (desafío activo 2-de-4: blink/mouth/turn_left/turn_right)
y coexiste con ADR-143 (parpadeo natural pasivo, sin cambios).

## Contexto

Pedido explícito del usuario, tras reactivar el desafío activo (ADR-145):
bajar la cantidad de desafíos de 2 a 1, y reemplazar los gestos de
parpadeo/boca. Primera iteración: movimiento de cabeza en las 4 direcciones
("izquierda, derecha, adelante, atrás"). El usuario reconsideró de inmediato
el eje adelante/atrás — pidió reemplazar "inclinar la cabeza" por
**acercarse/alejarse de la cámara**, "para lograr un mejor control y
facilidad de verificación". Esta versión final nunca llegó a desplegarse a
usuarios reales; se documenta directamente el diseño que sí se publicó.

Motivación adicional (no sólo preferencia): el parpadeo YA queda cubierto
—mejor, porque es pasivo e ininterrumpido— por el parpadeo NATURAL de
ADR-143 durante las 5 lecturas ICAO. Pedirlo TAMBIÉN como desafío activo era
redundante. Abrir la boca o inclinar sutilmente la cabeza, en cambio, son
gestos menos manejables de ejecutar de forma consistente que acercarse o
alejarse de la cámara — un movimiento grande, inequívoco y fácil de
autoevaluar por la propia persona ("¿me acerqué lo suficiente?").

## Diseño

### 1. Nuevo eje de medición: `interEyePx` (distancia interocular en píxeles)

`ai_engine/eye_analyzer.py` ya calculaba `inter_eye` (la distancia entre los
centros de ambos ojos en píxeles, usada internamente para
`adaptive_ear_threshold`) — ADR-146 sólo la EXPONE en la respuesta JSON como
`inter_eye_px`, sin ningún cálculo nuevo. Sube cuando la persona se acerca a
la cámara (la cara ocupa más píxeles), baja cuando se aleja. Se propaga por
el mismo camino ya establecido para `head_yaw_ratio` (ADR-125):
`AiEngineFrameResult` (backend, `hasInterEyePx`/`interEyePx`) →
`BiometricCaptureRuntimeState::interEyePx` → `evaluateLivenessChallenge`.

**Umbral relativo, no absoluto**: la distancia interocular en píxeles varía
mucho entre personas/cámaras/distancias de asiento, así que un umbral
absoluto de píxeles no serviría igual para todos. En su lugar,
`LivenessChallengeState` guarda `baselineInterEyePx` — el valor de
`interEyePx` capturado en el momento exacto en que el servidor sortea la
cola (una vez, al cruzar el gate de calidad + parpadeo natural) — y el
desafío exige un cambio proporcional respecto a esa referencia de la propia
sesión: `kLivenessMoveCloserRatio = 1.25` (25% más grande que la referencia)
para `move_closer`, `kLivenessMoveAwayRatio = 0.80` (20% más chica) para
`move_away`. **Sin validar con datos reales de producción todavía** (mismo
caveat que tuvo `kLivenessHeadYawTurnThreshold` al principio, ver
ADR-125/126) — a recalibrar con `gLivenessChallengeMetrics` por tipo.

### 2. Pool de desafíos y cantidad

`backend/src/biometric/liveness_challenge.hpp`:
`kLivenessChallengeTypes = {"turn_left", "turn_right", "move_closer", "move_away"}`
(antes `{"blink", "mouth", "turn_left", "turn_right"}`); `kLivenessChallengeCount: 2 → 1`.
`LivenessChallengeState` pierde `eyesWereClosedDuringChallenge`/
`mouthWasOpenDuringChallenge` (ya no hacen falta, sin tipos de gesto que los
usen) y gana `baselineInterEyePx`. `evaluateLivenessChallenge` cambia de
firma: ya no necesita `eyesOpen`/`prevEyesOpen`/`mouthClosed`/`prevMouthClosed`
(nada de eso decide un desafío ahora), sólo `headYawRatio`/`interEyePx`; la
captura del baseline ocurre en el mismo punto donde ya se sorteaba la cola
(primera llamada de la sesión, `st.queue.empty()`).

Frontend (`frontend/src/auth/livenessChallenge.ts`): `LivenessChallengeType`
pierde `'blink'`/`'mouth'`, gana `'move_closer'`/`'move_away'`;
`CHALLENGE_COUNT: 2 → 1`; nuevas constantes `MOVE_CLOSER_RATIO`/
`MOVE_AWAY_RATIO` (documentación, el servidor sigue siendo quien decide).
Textos de instrucción nuevos: `liveness.challenge.moveCloser`
("Acércate a la cámara"), `liveness.challenge.moveAway`
("Aléjate de la cámara").

### 3. Sin cambios de arquitectura

El mecanismo de sorteo/timeout/reintento/reemplazo, la separación de fases
respecto al gate de calidad ICAO (ADR-142), el parpadeo natural simultáneo
(ADR-143), y el gate de `handleLoginFace`/`handleRegister`
(`qualityGateReached && challenge.complete`) quedan exactamente iguales —
sólo cambió QUÉ gestos entran en la cola, CUÁNTOS hacen falta, y que ahora
uno de los ejes de medición necesita una referencia por sesión en vez de un
umbral absoluto.

## Consecuencias

- Login/registro facial más rápido que con 2 desafíos (un solo gesto).
- Umbrales de `move_closer`/`move_away` sin validar con uso real todavía —
  vigilar `liveness_challenge_metrics` (`GET /api/auth/biometric/status`)
  por esos dos tipos tras el despliegue; si `timedOut` es alto respecto a
  `succeeded`, es la primera señal a revisar antes de tocar nada más (mismo
  criterio que ADR-126).
- Referencias: `ai_engine/eye_analyzer.py` (campo `inter_eye_px` en la
  respuesta, reutiliza `inter_eye` ya calculado),
  `backend/src/biometric/liveness_challenge.hpp/.cpp`,
  `backend/src/biometric/biometric_types.hpp`
  (`AiEngineFrameResult::interEyePx`, `BiometricCaptureRuntimeState::interEyePx`),
  `backend/src/biometric/ai_engine_client.cpp`, `backend/src/biometric/biometric_routes.cpp`,
  `backend/tests/test_liveness_challenge.cpp`, `frontend/src/auth/livenessChallenge.ts`,
  `frontend/src/components/Auth/AuthGateway.tsx` (`syncChallengeFromServer`),
  `frontend/src/i18n/I18nProvider.tsx`.
