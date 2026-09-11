# ADR-149 — Desafío activo arranca al completar las 5 lecturas ICAO, en paralelo con la espera del parpadeo (no en secuencia)

**Status**: implemented

**Fecha**: 2026-09-04

**Ámbito**: ia

**Relación**: corrige un efecto colateral real de ADR-145 (parpadeo natural)
+ ADR-148 (fusión de parpadeo/candado de lecturas), sin reabrir ninguno de
los dos.

## Contexto

Reporte del usuario sobre un login real (DNI 09637600, `beemetry-api` log
09:18:57–09:19:02): "hizo rápido 5/5 pero se demoró en activar el reto, que
si lo llego a pasar pero demoró en activarse". A diferencia del reporte
anterior (ADR-148, "nunca llega a salir"), acá el desafío sí terminaba
apareciendo y el usuario lo pasaba — el problema es la demora entre "5/5 en
pantalla" y que aparezca el reto.

Revisando el código tras ADR-148: el desafío activo sólo se arma/evalúa
cuando `st.qualityGateReached` es `true`, y esa bandera exige AMBAS cosas:
`captureCount`/`totalFramesSeen` completos (lecturas ICAO) Y
`naturalBlink.observed` (parpadeo natural, ADR-145). Es decir, el diseño
original encadenaba las dos pruebas de vida EN SECUENCIA: primero ICAO,
después esperar el parpadeo, y sólo entonces mostrar el desafío.

El problema de fondo: las 5 lecturas ICAO toman en la práctica **~875ms**
(5 frames a ~175ms de cadencia, la resolución de captura actual). Un
parpadeo involuntario ocurre en promedio cada **2-4 segundos** (15-20
parpadeos/minuto es la tasa fisiológica normal). El diseño de ADR-145 asumía
implícitamente que el parpadeo ocurriría *durante* esa misma ventana de
lecturas — pero la ventana es demasiado corta frente al intervalo real entre
parpadeos, así que casi SIEMPRE terminaba esperándose un parpadeo que
llegaba varios segundos DESPUÉS del 5/5, con la pantalla mostrando "5/5"
sin ningún aviso de qué se estaba esperando. Antes de ADR-148 esta espera
podía ser indefinida (el parpadeo casi nunca se detectaba, señal
demasiado conservadora) o resetearse en silencio; con ADR-148 corregido, la
espera pasó a ser real pero acotada (unos segundos) — visible ahora como
"se demora en activar el reto", el reporte de esta sesión.

## Decisión

El desafío activo (ADR-142/146) y el parpadeo natural (ADR-145) son **dos
pruebas de vida independientes** que no necesitan correr en secuencia — sólo
el gate FINAL de `handleLoginFace`/`handleRegister`
(`qualityGateReached && challenge.complete`, sin cambios en `main.cpp`)
exige que ambas se hayan cumplido antes de completar el login/registro.
Nada obliga a que el desafío espere a que el parpadeo ya haya ocurrido antes
de siquiera empezar a correr.

**Fix**: se separa la condición que arma/evalúa el desafío
(`evaluateLivenessChallenge`) de `qualityGateReached` (ICAO + parpadeo) a
`icaoReadsLocked`/`icaoReadsCompleted(st)` (sólo ICAO, ya existente desde
ADR-148 para el candado de `captureCount`). En cuanto terminan las 5
lecturas, el desafío arranca — en PARALELO con la espera (que puede seguir
en curso) del parpadeo natural. `GET /api/status` (`challenge.active`,
`deadline_ms_remaining`) se actualiza igual, para que el frontend (que ya
refleja `status.challenge.queue` sin lógica propia, `AuthGateway.tsx` /
`useLivenessChallengeSync.ts`) muestre el desafío en el mismo instante en
que el servidor lo arma.

`icaoReadsCompleted(const BiometricCaptureRuntimeState&)` — nuevo helper en
`biometric_types.hpp`, reemplaza la expresión duplicada
`captureCount >= kRequiredValidCaptureFrames && totalFramesSeen >=
kGlassesHistWarmupFrames` que antes vivía sólo en `handleProcessFrame`; ahora
también la usa `handleStatus` para las dos exposiciones nuevas.

## Consecuencias

- El desafío aparece de inmediato al completar las 5 lecturas ICAO, sin
  esperar un parpadeo que, por su naturaleza involuntaria, puede tardar
  varios segundos más. La persona ya no ve una pantalla "5/5" congelada sin
  explicación.
- **No baja el nivel de exigencia de seguridad**: el gate final sigue
  exigiendo ambas pruebas de vida (`qualityGateReached && challenge.complete`)
  exactamente igual que antes — sólo cambia el ORDEN en que pueden
  completarse (en paralelo, no en secuencia forzada). Si el parpadeo tarda
  más que el desafío, el login/registro sigue bloqueado hasta que también
  ocurra, sin cambios.
- `st.challenge.complete` ahora puede llegar a `true` antes de que
  `naturalBlink.observed` sea `true` (con el desafío activo desactivado,
  `BEEMETRY_LIVENESS_CHALLENGE_REQUIRED=false`, se marca completo de
  inmediato al llegar a 5/5) — sin impacto real porque el gate final sigue
  revisando `qualityGateReached` por separado.
- Sin test unitario nuevo: el cambio vive enteramente en `handleProcessFrame`/
  `handleStatus` (`biometric_routes.cpp`), sin cobertura Catch2 existente
  (mismo criterio que ADR-148) — `evaluateLivenessChallenge` en sí no cambió,
  sigue cubierta por `test_liveness_challenge.cpp` sin modificaciones.
  Verificado con build+ctest (lógica ya cubierta sin cambios) y despliegue
  real; pendiente de confirmación del usuario en un login real.
- Referencias: `backend/src/biometric/biometric_types.hpp`
  (`icaoReadsCompleted`), `backend/src/biometric/biometric_routes.cpp`
  (`handleProcessFrame`, `handleStatus`).
