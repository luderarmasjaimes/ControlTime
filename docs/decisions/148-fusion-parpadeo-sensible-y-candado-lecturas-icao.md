# ADR-148 — Señal de parpadeo dedicada (blink_signal_open) + candado de lecturas ICAO desacoplado del parpadeo

**Status**: implemented

**Fecha**: 2026-09-04

**Ámbito**: ia

**Relación**: corrige dos bugs reales en el mecanismo de ADR-145 (parpadeo
natural simultáneo a las 5 lecturas ICAO) y ADR-146 (desafío activo de 1
gesto), sin cambiar el diseño de ninguno de los dos.

## Contexto

Reporte del usuario: tras leer correctamente 5/5 la validación facial, la
pantalla del desafío de liveness "se demora demasiado o nunca llega a
salir". Pidió el máximo análisis posible en base a los LOGs reales antes de
proponer una solución.

Se revisaron los logs crudos de `beemetry-ai-vision` de una sesión real
afectada: la traza de EAR/blink mostraba un parpadeo real y sostenido (EAR
del ojo derecho cayendo 0.237→0.167 durante ~7 frames consecutivos,
`blink_r` sin superar ~0.32 en ningún momento) que el sistema nunca llegó a
registrar como parpadeo. Esto llevó a encontrar DOS bugs independientes,
ambos en el camino entre "5/5 ICAO" y "aparece el desafío":

### Bug 1 — la señal de "ojos abiertos" usada para detectar el parpadeo es demasiado conservadora

`both_open_robust` en `ai_engine/eye_analyzer.py` fusiona ambos ojos con
`combined_ear = max(left_ear, right_ear)` y `combined_blink =
min(blink_l, blink_r)` — a propósito: esta fusión existe para que el
chequeo ICAO real ("OJOS ABIERTOS" en pantalla, `frameValid` en
`biometric_routes.cpp`) no rechace un frame válido sólo porque UN ojo dio
una lectura ruidosa (reflejo, ángulo, pestaña). Es la fusión correcta para
ese propósito.

El problema: `updateNaturalBlink` (ADR-145) reutilizaba esa misma señal
(`eyesOpen`/`bothOpen`) para decidir si hubo un parpadeo. Con esa fusión
sesgada hacia "abierto", un parpadeo real de UN solo ojo —o incluso de
ambos, si el segundo ojo da una lectura ligeramente distinta en el frame
exacto del cierre— casi nunca hace caer `bothOpen` a `false`. Confirmado con
los datos reales: en la sesión logueada, `bothOpen` se mantuvo `true`
durante todo el parpadeo sostenido. Sin ese flanco cerrado→abierto,
`naturalBlink.observed` nunca pasa a `true`, `qualityGateReached` nunca se
cumple, y el desafío activo nunca se arma — "nunca llega a salir" tal como
lo describió el usuario.

**Fix**: nueva señal `blink_signal_open` en `eye_analyzer.py`, con fusión
OPUESTA a propósito: `blink_signal_ear = min(left_ear, right_ear)`,
`blink_signal_blink = max(blink_l, blink_r)` — cualquiera de los dos ojos
mostrando evidencia de cierre cuenta. Se expone en la respuesta JSON y en el
log `[EYE_AI]` junto a `both_open`, se propaga por el mismo camino ya
establecido (`AiEngineFrameResult::hasBlinkSignalOpen`/`blinkSignalOpen` →
`ai_engine_client.cpp` → `biometric_routes.cpp`), y **sólo** la usa
`updateNaturalBlink`. El chequeo ICAO real (`frameValid`, lo que ve el
checklist en pantalla) sigue usando `bothOpen` sin cambios — no se toca la
protección contra falsos rechazos por ruido de un solo ojo.

### Bug 2 — el candado de "lecturas ICAO completas" dependía del parpadeo, permitiendo que un fallo ICAO transitorio reseteara un 5/5 ya logrado

`captureCount` (las 5 lecturas) y el parpadeo natural son dos condiciones
independientes que juntas arman `qualityGateReached`. Antes de este fix, el
bloque que acumula/resetea `captureCount` sólo dejaba de re-evaluarse cuando
`qualityGateReached` ya era `true` (`!st.qualityGateReached ||
!stickyQualityGate`) — pero `qualityGateReached` se queda en `false` hasta
que TAMBIÉN ocurra el parpadeo. Es decir: durante la espera del parpadeo
(con `captureCount` ya en 5/5), el candado seguía abierto, y bastaba que la
persona se reacomodara sin saber que tenía que parpadear (lentes, ángulo,
boca) durante 5 frames seguidos para que `captureInvalidStreak >= 5`
reseteara `captureCount` de vuelta a 0 — deshaciendo el 5/5 ya logrado, sin
ningún aviso visual de por qué. Con el Bug 1 sumado (el parpadeo real casi
nunca se detectaba), esta ventana de espera podía alargarse indefinidamente,
maximizando la probabilidad de pisar el reset.

**Fix**: nuevo candado `icaoReadsLocked`, que depende SÓLO de
`captureCount`/`totalFramesSeen` (no del parpadeo):

```cpp
const bool icaoReadsLocked = st.captureCount >= kRequiredValidCaptureFrames &&
                              st.totalFramesSeen >= kGlassesHistWarmupFrames;
if (!icaoReadsLocked || !stickyQualityGate) {
  // ... acumular/resetear captureCount, como antes
}
```

La evaluación de `blinkOk`/`qualityGateReached` se movió FUERA de ese
bloque, para que siga corriendo en cada frame incluso cuando
`icaoReadsLocked` ya bloquea la re-acumulación:

```cpp
const bool blinkOk =
    !AppConfig::instance().gNaturalBlinkRequired || st.naturalBlink.observed;
if (st.captureCount >= kRequiredValidCaptureFrames &&
    st.totalFramesSeen >= kGlassesHistWarmupFrames && blinkOk) {
  st.qualityGateReached = true;
}
```

Una vez las 5 lecturas ICAO se completan, `captureCount` nunca vuelve a
bajar mientras se espera el parpadeo, ni tampoco durante el desafío activo
posterior (que ya fallaba "frontal" a propósito al girar la cabeza — motivo
original de este candado en ADR-142). Esa tolerancia sigue existiendo SÓLO
mientras `stickyQualityGate` es `true` (desafío activo habilitado,
`BEEMETRY_LIVENESS_CHALLENGE_REQUIRED=true`) — con el desafío desactivado el
gate se re-evalúa cada frame, sin cambios respecto al comportamiento ya
corregido en la reactivación de ADR-145.

## Consecuencias

- El "problema de control de secuencia" reportado por el usuario —el
  desafío tardando mucho o nunca apareciendo tras 5/5— tenía dos causas
  independientes y compuestas: una señal de parpadeo demasiado conservadora
  (nunca detectaba el parpadeo real) y un candado de progreso que no
  protegía la espera de ese parpadeo (podía resetear el 5/5 mientras
  esperaba). Ambas corregidas.
- `blink_signal_open` es deliberadamente MÁS sensible que `bothOpen` — puede
  registrar como "cerrado" algo que el ICAO real seguiría considerando
  "abierto" (ruido de un solo ojo). Eso es aceptable porque sólo alimenta
  `updateNaturalBlink`, que ya tolera un cierre breve (40–1500ms,
  `kNaturalBlinkMinDurationMs`/`kNaturalBlinkMaxDurationMs`, sin cambios) —
  un falso "cerrado" de un solo frame no alcanza esa ventana mínima para
  registrarse como parpadeo real, así que el riesgo de falso positivo queda
  acotado por el mismo mecanismo que ya protegía contra fotos con ojos
  siempre cerrados.
- No se modificó `updateNaturalBlink` en sí (su lógica de tolerancia de
  ventana sigue igual, ADR-145) — sólo cambió la señal de entrada que
  recibe, y el candado de reseteo que lo rodea en `handleProcessFrame`.
- Sin test unitario nuevo para el candado `icaoReadsLocked` en sí: vive en
  `handleProcessFrame` (`biometric_routes.cpp`), que depende de OpenCV/sesión
  HTTP/mutex y no tiene cobertura Catch2 existente (mismo criterio que el
  resto de esa función, nunca testeada a este nivel) — verificado en cambio
  con build+ctest de la lógica ya cubierta (`liveness_challenge.cpp`, sin
  cambios) y despliegue real con logs.
- Referencias: `ai_engine/eye_analyzer.py` (`blink_signal_open`),
  `backend/src/biometric/biometric_types.hpp`
  (`AiEngineFrameResult::hasBlinkSignalOpen`/`blinkSignalOpen`),
  `backend/src/biometric/ai_engine_client.cpp` (parsing),
  `backend/src/biometric/biometric_routes.cpp`
  (`blinkSignalEyesOpen`, `icaoReadsLocked`).
