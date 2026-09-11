# ADR-156 — Contador ICAO sin tolerancia, retos variados y reinicio a la etapa 1 tras agotarlos

> **Actualización 2026-09-11 — "Defecto latente, no corregido" (sección de
> abajo) queda resuelto, según confirmación del developer.** El bug real que
> este ADR dejó documentado y sin corregir — una vez que el score de la
> heurística CV marcaba una sesión como "con lentes", el tope protector
> (54) nunca bajaba del umbral de salida (49), así que la sesión no podía
> volver a salir de esa marca ni aunque la persona se quitara los lentes,
> bloqueando por completo el registro biométrico — ya no ocurre en el flujo
> real. El propio texto original de este ADR (sección "Defecto latente")
> anticipaba que la corrección real requería "rediseño (apoyarse en el
> clasificador ONNX en vez de la heurística CV), no un ajuste de umbral" —
> coincide con el trabajo de reentrenamiento del clasificador ONNX de
> ADR-163/165, que se ejecutó en el mismo período sin citar a este ADR (ver
> hallazgo de coordinación en el bloque de auditoría 2026-09-10 de
> `README.md`). **Queda anotado explícitamente para más pruebas de QA antes
> de certificar la corrección al 100%** — esta actualización registra la
> corrección funcional confirmada por el developer, no un ensayo QA
> independiente con evidencia propia. No se edita el texto original de
> abajo.

**Status**: implemented, defecto latente corregido (2026-09-11) — pendiente certificación QA

**Fecha**: 2026-09-04

**Ámbito**: ia

**Relación**: ajusta ADR-142/146 (desafío activo server-side) y ADR-148/149
(candado de lecturas ICAO y arranque en paralelo del reto). No reabre
ADR-145 (parpadeo natural), que sigue igual.

## Contexto

Reporte del usuario tras probar el registro biométrico facial en vivo, con
tres síntomas:

1. **El contador 1/5, 2/5, 3/5 subía sin cumplirse las 4 condiciones
   básicas** (ojos abiertos, boca cerrada, rostro frontal, sin lentes).
2. **El reto de verificación no variaba** y no había un límite claro de
   cuántas veces se pedía.
3. **El proceso se quedaba colgado** hasta el timeout, sin que se entendiera
   cómo se aprobaba o por qué no avanzaba.

Las tres tienen causa en el mismo archivo (`handleProcessFrame` +
`evaluateLivenessChallenge`):

- El contador toleraba hasta 4 frames ICAO inválidos seguidos antes de
  resetearse (`captureInvalidStreak >= 5`). Esa tolerancia existía por el
  parpadeo — pero ADR-145 ya resolvió el parpadeo aparte
  (`updateNaturalBlink`), así que sólo quedaba su efecto secundario: el
  progreso sobrevivía a frames malos, y un 3/5 podía llegar a 5/5
  intercalando frames que no cumplían las condiciones. Eso es exactamente lo
  que se veía en pantalla.
- Al vencer la ventana de un reto, la máquina reintentaba **4 veces el mismo
  tipo** y después sorteaba un reemplazo **con reintentos frescos** — un
  bucle infinito: nunca se rendía. Si a la persona un gesto no le salía,
  quedaba pidiéndolo indefinidamente hasta que el navegador cortaba la
  sesión. Ese es el "se queda colgado hasta el timeout".

## Decisión

**1. El contador ICAO no tolera ningún frame inválido.**
`kIcaoInvalidFramesBeforeReset = 1` (antes 5): las 5 lecturas tienen que ser
5 frames consecutivos con las CUATRO condiciones en OK; basta que una falle
para volver a 0. Un parpadeo natural sigue sin contar como frame inválido
(ADR-145), que era el único motivo real por el que existía la tolerancia.

**2. Cada intento de reto es un tipo distinto, sorteado al azar.**
Al vencer la ventana, en vez de repetir el gesto que la persona acaba de no
lograr, se sortea otro tipo de
{`turn_left`,`turn_right`,`move_closer`,`move_away`} distinto al que venció.
Además de ser más usable, quita la posibilidad de preparar una única
respuesta ensayada para el gesto que se sabe que va a repetirse.

**3. Máximo 5 retos por sesión; agotados, se reinicia a la etapa 1.**
`kLivenessChallengeMaxAttempts = 5` (antes 4 reintentos + bucle). Al vencer
el quinto se marca `LivenessChallengeState::exhausted` y `handleProcessFrame`
devuelve **toda** la captura a la etapa 1: `captureCount = 0`,
`qualityGateReached = false`, desafío y parpadeo natural desde cero. La
persona rehace la lectura ICAO y se le vuelve a pedir un reto, cuantas veces
haga falta — pero nunca se queda sin salida ni en silencio.

**4. La UI dice en qué intento va.** El cartel del reto mostraba "Desafío 1
de 1" (inútil desde que `CHALLENGE_COUNT` bajó a 1 en ADR-146); ahora muestra
"Intento N de 5" con `challenge.max_attempts` que manda el servidor, para que
se vea que el proceso avanza y cuántos pedidos quedan antes del reinicio.

También se quitó el `std::cerr << "[CHALLENGE_DEBUG] ..."` de
`handleBiometricStatus`, diagnóstico temporal de ADR-149 que ya cumplió su
función (ahí mismo decía "quitar una vez confirmada la causa").

## Hallazgo derivado: el detector de lentes bloqueaba la etapa 1

Al probar la regla estricta en vivo apareció un efecto que la tolerancia
anterior venía tapando: el chequeo "sin lentes" daba falsos positivos
intermitentes sobre una cara SIN lentes (57,8% de los frames medidos), y con
cero tolerancia cada oscilación devolvía el contador a 0/5 — la captura
nunca llegaba a 5/5, el servidor nunca sorteaba un reto y la sesión moría en
el timeout de 120s. La regla estricta es correcta; deja al sistema a merced
de su señal más débil, y esa señal estaba rota.

Calibrado con dos sondas del propio repo (`GLASSES_PROBE_LOG` /
`GLASSES_PROBE_SIN_GAFAS_LOG`) sobre la misma cara y cámara: **1.466 frames
CON gafas** y **737 SIN**. Dos defectos reales en `eye_analyzer.py`:

**1. `glare_term` se otorgaba sin exigir brillo bilateral.**
`min(72.0, spec_density * 52000.0)` — el término más grande del puntaje — se
repartía a partir del brillo crudo. Con `spec_density = 0,0027` (mediana de
los falsos positivos) satura en sus 72 puntos y además levanta el tope
protector: score 100 sobre una cara sin lentes. El brillo no venía de gafas:
en los frames CON gafas hay hits especulares en el 0,1%, y SIN gafas en el
39,6% — y de un solo lado (`left_hits` 39,6% contra `right_hits` 1,3%): es el
contraluz de una ventana sobre la piel. `bilateral_glare` nunca se cumplía
(0,0% en ambos datasets), así que `strong_glare`/`medium_glare` eran código
muerto. Medido sobre la rama de entrada CV completa: se dispara en el 0,1%
de los frames CON gafas y en el 41,7% SIN. No aportaba detección y producía
casi todos los falsos positivos. Corrección: los puntos de brillo exigen que
sea bilateral — dos lentes reflejan en ambos ojos, una fuente lateral en uno.

**2. El umbral de la ruta mate estaba por debajo del ruido real.**
Cerrada la puerta del brillo, `matte_frame_signal` quedó como única entrada
CV activa y su umbral (`bridge_dark >= 0,14`) todavía disparaba en el 2,3%
de los frames sin lentes — que la histéresis pegajosa convierte en 15,6%
observado. Una primera corrección a 0,16 se sobreajustó a un solo dataset
(máximo 0,1559) y volvió a fallar cuando otra sesión, a distinta distancia,
llegó a 0,1781. Recalibrado con ambas: **0,20**, con 12% de margen sobre el
máximo observado sin lentes.

`bridge_dark` — la franja oscura sobre el puente de la nariz, donde apoya la
montura — resultó ser la única señal que discrimina de verdad:

| | CON gafas (1.466 frames) | SIN gafas (737 frames) |
|---|---|---|
| mediana | 0,263 | 0,073 |
| p05 / máx | p05 = 0,179 | máx = **0,178** |

`rim_density` NO discrimina (mediana 0,204 con gafas contra 0,195 sin), dato
que no se conocía y que explica por qué la heurística previa no funcionaba.

Validación final: **entrada autónoma 88,5% CON gafas, 0,0% SIN** (0/737).

### Defecto latente, no corregido

La salida del estado "con lentes" exige `stable < 49,0`, pero el tope
protector fija el score en 54 — y para cualquier cara cuyo `rim_density`
sature su término (>= 0,148), el score nunca baja de 52. **Una vez marcada
"con lentes", la sesión no puede salir nunca**, ni aunque la persona se quite
los lentes. Es el amplificador que convirtió un 2,3% de falsos positivos por
frame en un 15,6% observado. Se evaluó atar el tope alto al mismo criterio
mate y se descartó: con gafas reales el 70% de los frames caería al tope 48 y
la detección se perdería por parpadeo. Necesita rediseño (apoyarse en el
clasificador ONNX en vez de la heurística CV), no un ajuste de umbral.

### Alcance de esta calibración

Los umbrales salen de UNA cara y UNA cámara. Otra persona con sombra nasal
más marcada podría superar 0,20 sin lentes. Antes de generalizar conviene
repetir la captura con varias caras — las sondas ya están para eso.

## Consecuencias

- El 5/5 vuelve a significar lo que dice: cinco lecturas limpias seguidas.
  Se espera que llegar a 5/5 tarde algo más que antes, porque ya no se
  arrastra progreso sobre frames malos — es el costo buscado.
- Ninguna sesión puede quedarse colgada en el reto: o se cumple, o a los 5
  pedidos vuelve sola a 0/5 con el contador visible moviéndose.
- El gate final de `handleLoginFace`/`handleRegister`
  (`qualityGateReached && challenge.complete`) no cambia: el servidor sigue
  siendo la única fuente de verdad (ADR-142).
- Constantes espejadas frontend/backend
  (`CHALLENGE_MAX_ATTEMPTS` ↔ `kLivenessChallengeMaxAttempts`), verificadas
  por `livenessChallenge.test.ts`.
- Pendiente de validar con datos reales: si 5 retos resultan pocos en campo,
  el contador por tipo de `gLivenessChallengeMetrics` (ADR-126) ya expone
  armed/succeeded/timedOut para decidir con evidencia en vez de a ojo.

## Actualización 2026-09-09 — el reset real no venía de agotar los 5
intentos, sino del control de parpadeo (ADR-149) corriendo en paralelo

El usuario reportó (dos veces, con registros reales) que la captura se
reseteaba a etapa 1 mucho antes de agotar los `kLivenessChallengeMaxAttempts`
(5) intentos del reto, y pidió logs en tiempo real para confirmarlo con
certeza. Se agregó `[LIVENESS_RESET]` (log a stderr, visible con `docker
logs beemetry-api`) en los 4 puntos reales de reset a etapa 1
(`icao_failed`/`glasses_detected`/`blink_stale`/`challenge_exhausted`), con
el número de intento del reto consumido al momento del reset.

**Causa real, confirmada con dos rondas de evidencia real**:

1. Primera ronda: `auth_audit_logs` mostró 7 resets `blink_fraud_suspected`
   en una sola sesión real, espaciados 14-27s — la ventana de
   `kNaturalBlinkMaxSampleWindowMs` (12s, ver `liveness_challenge.hpp`) se
   agotaba mucho antes de que el usuario llegara a consumir sus 5 intentos
   del reto (hasta 40s posibles). Subida a 45s.
2. Segunda ronda (tras el fix anterior, con `[LIVENESS_RESET]` ya activo):
   2 resets en vez de 7 — mejora real, pero uno de los dos disparó
   `challenge_attempt=4/5` a las 22:12:53, **7 segundos DESPUÉS** de que el
   cliente ya había enviado el registro (`AUTH_REGISTER parsed_payload` a
   las 22:12:46) — es decir, el registro ya estaba en curso (y terminó
   exitoso: `db_insert_ok`, avatar generado) cuando este reset disparó. El
   reset en sí no dañó ESE registro (el envío usa un frame ya congelado de
   la etapa 1, no el frame en vivo), pero sí siguió reseteando la sesión de
   captura visible en pantalla, sumando un "error" más sin ningún beneficio
   real de seguridad.

**Causa raíz de ese segundo caso**: el chequeo de parpadeo corre incluso
DESPUÉS de `st.challenge.complete` a propósito (razón original documentada
en `biometric_routes.cpp`: si el reto se cumplía rápido pero el parpadeo
natural todavía no se había confirmado, había que seguir esperándolo). Pero
`blinkOk` (la condición real que decide `qualityGateReached`) YA da por
satisfecho el parpadeo con `challenge.complete` solo, sin exigir
`naturalBlink.observed` — así que ese chequeo post-completo resetea una
condición que la propia `blinkOk` ya no exige, puro efecto secundario sin
justificación real una vez completado el reto. Restringido a
`!st.challenge.complete` (mismo criterio del candado sticky de ADR-148/149
para ICAO): una vez completo el reto, dejar de exigir parpadeo continuo.

**Estado real, sin exagerar**: la ventana de 45s reduce mucho la frecuencia
del reset legítimo (durante el reto, antes de completarlo), pero no lo
elimina al 100% -- si una persona real concentrada tarda más de 45s sin
parpadear naturalmente, todavía puede disparar. Sin datos de campo
suficientes para saber si eso es un caso real frecuente o un caso límite;
`gLivenessChallengeMetrics` (ADR-126) y ahora `[LIVENESS_RESET]` en los
logs dan la evidencia para decidir si hace falta subir más la ventana, sin
adivinar.
