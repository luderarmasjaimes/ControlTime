# ADR-145 — Parpadeo natural simultáneo con las 5 lecturas ICAO + reactivación del desafío activo

**Status**: implemented

**Fecha**: 2026-09-03

**Ámbito**: ia

**Relación**: extiende ADR-142 (liveness verificada en servidor) y ADR-126
(desafío activo 2-de-4). Vuelve a subir `kRequiredValidCaptureFrames` de 3 a
5 (ADR-142 lo había bajado desde el 5 original de ADR-119). Reactiva
`BEEMETRY_LIVENESS_CHALLENGE_REQUIRED` (había quedado en `false` tras una
prueba manual puntual documentada en el "Actualización 2026-09-03" de
ADR-142).

## Contexto

Pedido explícito del usuario: subir el gate de calidad ICAO de 3 a 5 lecturas
"con las mismas condiciones de implementación", y durante ESA MISMA ventana
de lectura evaluar el **parpadeo natural** de la persona (no un gesto pedido
a propósito) para probar que es una persona viva y no una foto/máscara/video
de celular, con "los mejores algoritmos" y "máxima precisión", dejando el
sistema listo para producción.

En la conversación se identificó y resolvió una tensión real: el desafío
activo de ADR-126 (girar cabeza / abrir boca a pedido) es, por naturaleza,
**incompatible en simultáneo** con "de frente" / "boca cerrada" — no hay
forma de que ambos sean verdad en el mismo instante, sólo pueden convivir en
*secuencia* (lo que ya resuelve el `qualityGateReached` sticky de ADR-142). El
parpadeo, en cambio, **sí es compatible en simultáneo**: dura ~100-300ms y no
mueve la cabeza ni la boca. El problema técnico real era otro: antes de este
ADR, un parpadeo real durante la ventana de lectura contaba como frame ICAO
inválido (`eyesOpen=false` ese frame) y podía resetear el contador de
lecturas — el sistema castigaba exactamente la señal biológica que ahora se
quiere exigir como prueba de vida.

Decisión de producto (confirmada con el usuario): parpadeo pasivo durante las
5 lecturas **+** desafío activo después, en secuencia. El parpadeo solo no
alcanza contra un video pre-grabado de la persona real reproducido desde un
celular (ese video puede mostrar parpadeos genuinos); el desafío activo sí,
porque el atacante no puede pre-grabar una respuesta a una instrucción
sorteada por sesión. El parpadeo pasivo queda **siempre activo** en
producción, con su propio interruptor (no atado al del desafío activo,
porque no le pide nada al usuario y no tiene motivo para desactivarse junto
con algo que sí es molesto).

## Diseño

### 1. Parpadeo natural tolerado, no penalizado

`backend/src/biometric/liveness_challenge.hpp/.cpp` suma `NaturalBlinkState`
y `updateNaturalBlink(st, eyesOpen, now)`: mientras los ojos están cerrados
por debajo de `kNaturalBlinkMaxDurationMs` (1500ms), el frame se sigue
tratando como "ojos OK" a efectos del streak de captura (`eyesOkForCapture`
en `handleProcessFrame`, biometric_routes.cpp) — no resetea el contador. El
mismo ciclo cerrado→abierto marca `st.naturalBlink.observed = true` (una
sola vez alcanza, no hace falta repetirlo). Un cierre que se sostiene más
allá de esa ventana (mirar hacia abajo, ojos genuinamente cerrados, o
directamente una foto con los ojos cerrados que nunca reabre) deja de
tolerarse y vuelve a contar como frame inválido, exactamente como antes de
este ADR.

El checklist ICAO visible (`icao.eyes_open` en `GET /api/status`) sigue
mostrando el valor crudo de MediaPipe sin tolerancia — la tolerancia es sólo
para el streak de captura, nunca para mentirle a la UI sobre el estado real
del frame.

### 2. `qualityGateReached` exige captura + parpadeo

`kRequiredValidCaptureFrames` vuelve a 5. `qualityGateReached` (biometric_routes.cpp)
pasa a exigir, además de `captureCount>=5` y el warmup de histéresis de
lentes: `!gNaturalBlinkRequired || naturalBlink.observed`. Nuevo toggle
`AppConfig::gNaturalBlinkRequired` (env `BEEMETRY_NATURAL_BLINK_REQUIRED`,
default `true`), independiente de `gLivenessChallengeRequired`.

No hace falta tocar el gate de `handleLoginFace`/`handleRegister` — sigue
siendo `qualityGateReached && challenge.complete`; ahora `qualityGateReached`
simplemente exige más antes de llegar a `true`, y el desafío activo
(`evaluateLivenessChallenge`, sin cambios) se dispara después exactamente
como ya hacía.

### 3. Reactivación del desafío activo

`docker-compose.yml`: `BEEMETRY_LIVENESS_CHALLENGE_REQUIRED` vuelve a
`true` por defecto (decisión explícita del usuario para cierre de
producción). Se agrega `BEEMETRY_NATURAL_BLINK_REQUIRED:-true`.

### 4. Frontend

- `FACIAL_ICAO.REQUIRED_VALID_FRAMES` (facialIcaoConfig.ts): 3 → 5.
- `AuthGateway.tsx`: `faceGuide` suma `qualityGateReached` (espejo de
  `status.quality_gate_reached`, poblado en el mismo callback que ya llena
  `captureCount`). `hasRequiredBiometricSamples` ahora exige también este
  campo, no sólo el conteo — evita que el auto-login/registro dispare un
  intento que el servidor va a rechazar por falta de parpadeo. Sin overlay
  ni prompt nuevo: el parpadeo es pasivo, no se le pide nada a la persona.

## Consecuencias

- Parpadear con normalidad durante la captura ya no compite con llegar a
  5/5 — al contrario, es necesario para completarlo.
- Volver a exigir el desafío activo alarga el login/registro facial (dos
  fases en vez de una), a cambio de cerrar el hueco de video/celular que el
  parpadeo solo no cubre.
- Referencias: `backend/src/biometric/liveness_challenge.hpp/.cpp`
  (`NaturalBlinkState`, `updateNaturalBlink`), `backend/src/biometric/biometric_types.hpp`
  (`BiometricCaptureRuntimeState::naturalBlink`, `kRequiredValidCaptureFrames`),
  `backend/src/biometric/biometric_routes.cpp` (`handleProcessFrame`, `handleStatus`),
  `backend/src/config/app_config.hpp/.cpp` (`gNaturalBlinkRequired`),
  `backend/tests/test_liveness_challenge.cpp`.
