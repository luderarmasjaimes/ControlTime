# ADR-126 — Liveness activa por desafío-respuesta (parpadear/boca/girar cabeza) en login y registro facial

**Status**: implemented y **activo** (reactivado y recalibrado 2026-08-21 —
ver "Estado de implementación"; hallado sin ADR propio y documentado en
auditoría 2026-08-21)

**Fecha**: 2026-08-19 (construcción original) / 2026-08-21 (reactivación)

**Ámbito**: ia

**Relación**: consume `head_yaw_ratio` de ADR-125 (`eye_analyzer.py`); es
liveness *activa*, complementaria (no reemplaza) al conteo pasivo de
parpadeo/apertura de boca que ya usaba el flujo ICAO existente; comparte el
detector de errores de cámara (`cameraErrorPolicy.ts`) con el resto del
flujo de `AuthGateway.tsx`.

## Contexto

El chequeo de liveness pasivo existente (contar cualquier parpadeo/apertura
de boca que ocurra en algún momento de la sesión, ventana acumulada de ~60s
sin exigir un gesto específico) es más débil que un desafío activo: un video
pregrabado de la persona real, reproducido frente a la cámara, puede cumplir
un conteo pasivo sin que nadie esté presente. ISO/IEC 30107-3 (estándar de
detección de presentación de ataques) considera la liveness activa —exigir
una respuesta específica e impredecible, no solo "estar presente en algún
momento"— más confiable que la pasiva, mismo criterio que usan proveedores
líderes del mercado.

Se construyó una arquitectura completa de liveness activa por
desafío-respuesta: sortear 2 de 4 gestos posibles (parpadear, abrir la boca,
girar la cabeza a la izquierda, girar a la derecha) en orden impredecible por
sesión, con una ventana de tiempo corta para cumplir cada uno. **En pruebas
reales (2026-08-19), con una ventana de 4.5s por desafío, cero intentos de
login/registro completaron la secuencia** (confirmado: cero peticiones al
backend durante toda la sesión de pruebas) — los 4 tipos de desafío se vieron
igual de afectados, indicando que el problema era el presupuesto de tiempo
total, no un gesto puntual fallando. Se dejó el código completo y el
plomo de backend (`head_yaw_ratio`, ADR-125) intactos, con un flag
`ACTIVE_CHALLENGE_ENABLED = false` — desactivado, pero listo para reactivar
sin rehacer la integración.

## Decisión

### Arquitectura (construida 2026-08-19)

1. **`frontend/src/auth/livenessChallenge.ts`**: sortea `CHALLENGE_COUNT=2`
   desafíos distintos de 4 posibles (`blink`, `mouth`, `turn_left`,
   `turn_right`) en orden aleatorio por sesión (`pickChallengeQueue`). Cada
   desafío tiene una ventana (`CHALLENGE_TIMEOUT_MS`) y hasta
   `CHALLENGE_MAX_ATTEMPTS` reintentos del **mismo** tipo antes de
   sortear un reemplazo (`pickReplacementChallenge`) — la sesión nunca
   queda trabada por un gesto que le cuesta a un usuario en particular.
   `yawSatisfiesChallenge` evalúa el giro contra `HEAD_YAW_TURN_THRESHOLD`
   (0.20, más laxo que el límite de 0.42 del gate ICAO "no frontal").
2. **`AuthGateway.tsx`**: `livenessChallengeRef` (fuente de verdad, leída en
   el loop de detección sin disparar render) + `challengeUiState` (espejo
   para pintar el overlay). `trySatisfyGestureChallenge` se cuelga de los
   mismos bordes de detección de parpadeo/boca que ya alimentaban el
   contador pasivo (no agrega un detector nuevo); `trySatisfyYawChallenge`
   evalúa `head_yaw_ratio` de forma continua (no de borde, a diferencia del
   parpadeo) mientras dura el desafío de giro. `checkChallengeTimeout`
   maneja el vencimiento: reintenta el mismo tipo hasta
   `CHALLENGE_MAX_ATTEMPTS`, luego reemplaza el desafío por otro tipo — la
   secuencia siempre converge, nunca se cuelga indefinidamente.
   `challengesPassedRef.current` gatea el submit real de login/registro:
   con el flag desactivado, se inicializa en `true` (equivalente a "ya
   pasó"), preservando el comportamiento anterior a este ADR sin ningún
   cambio de rama de código.
3. **`frontend/src/auth/cameraErrorPolicy.ts`** (nuevo, mismo commit):
   clasifica errores de `getUserMedia` — `NotAllowedError`/`SecurityError`
   (permiso denegado) nunca se reintentan (el navegador recuerda el rechazo
   por origen; reintentar solo produce un bucle sin ningún diálogo nuevo);
   `NotFoundError`/`OverconstrainedError` tampoco; `NotReadableError`/
   `TrackStartError` (cámara ocupada por otra app) sí son transitorios y se
   reintentan. Corrige un bug real de bucle infinito de reintentos ante
   permiso denegado, ortogonal al desafío de liveness pero introducido en la
   misma sesión de trabajo.
4. **UI**: overlay con la instrucción del desafío actual, progreso
   (`current`/`total`), contador regresivo y estados visuales
   (pendiente/éxito/timeout con colores distintos) — gateado por
   `ACTIVE_CHALLENGE_ENABLED` en el render, así que con el flag en `false`
   no se pintaba absolutamente nada nuevo en pantalla.

### Reactivación y recalibración (2026-08-21, esta auditoría)

A pedido explícito del developer tras revisar el hallazgo de "implementado
pero desactivado": se reactiva (`ACTIVE_CHALLENGE_ENABLED = true`) con un
**ensanchamiento conservador** de la ventana, no una recalibración fina —
no hay telemetría de campo nueva disponible en este momento para calibrar
con datos reales, y los 4 tipos de gesto fallaron por igual (apunta a
presupuesto de tiempo insuficiente, no a un detector específico):

- `CHALLENGE_TIMEOUT_MS`: 4500 → **8000** (casi el doble).
- `CHALLENGE_MAX_ATTEMPTS`: 3 → **4**.
- `HEAD_YAW_TURN_THRESHOLD` se deja sin cambio (0.20) — no hay evidencia de
  que el umbral de giro específicamente haya sido el gesto que fallaba más.

Esta recalibración es **best-effort, pendiente de verificación con
telemetría real post-reactivación** — si una nueva ronda de pruebas reales
vuelve a mostrar una tasa de finalización baja, el primer sospechoso a
revisar es el tiempo de *lectura/comprensión* de la instrucción por parte
del usuario (leer "gira a la izquierda" y luego ejecutar el gesto consume
buena parte de cualquier ventana), no necesariamente que el detector en sí
sea poco confiable.

## Consecuencias

### Positivas
- Login/registro facial gana liveness activa real, alineada con ISO/IEC
  30107-3, sin descartar el conteo pasivo existente (ambos conviven).
- El diseño de reintento con reemplazo garantiza que ningún usuario quede
  trabado indefinidamente por un solo tipo de gesto.
- La arquitectura completa (frontend + plomo de backend) ya existía y estaba
  probada en su fontanería antes de esta reactivación — el cambio de hoy es
  puramente de calibración de tiempos, no de arquitectura nueva.

### Negativas / Trade-offs
- La recalibración de hoy es una estimación conservadora, no una calibración
  validada con datos de campo reales — existe el riesgo real de que 8s
  siga siendo insuficiente para algunos dispositivos/cámaras/usuarios, o
  que sea ya demasiado permisivo desde el punto de vista de seguridad
  (una ventana más larga da más margen a un atacante para reaccionar a la
  instrucción también). Requiere monitoreo activo tras el despliegue.
- Un desafío de giro de cabeza exige más movimiento que el chequeo ICAO
  "frontal" habitual — riesgo de fricción de UX mayor que el conteo pasivo
  anterior, aceptado a cambio de la garantía de seguridad más fuerte.
- No hay telemetría estructurada (solo el hecho binario "llegó una petición
  al backend o no") para medir la tasa de éxito real tras esta reactivación
  — recomendable agregar un contador de finalización/timeout por tipo de
  desafío antes de la próxima recalibración, en vez de depender de
  observación manual como en la ronda de 2026-08-19.

## Alternativas descartadas

- **Mantenerlo desactivado indefinidamente**: descartado por el developer —
  el desafío activo ya está construido y probado en su fontanería; dejarlo
  apagado sin plan de reactivación desperdicia el trabajo ya hecho y deja la
  plataforma solo con liveness pasiva.
- **Retirar el código en vez de reactivar**: descartado por el mismo motivo
  — no hay evidencia de que la arquitectura esté mal diseñada, solo que la
  ventana de tiempo original era insuficiente.
- **Calibración fina basada en un modelo de tiempo de reacción humano
  específico por tipo de gesto**: descartada por falta de datos reales
  suficientes hoy — se prefiere un ensanchamiento uniforme y conservador,
  con una recalibración posterior basada en telemetría real si hace falta.

## Referencias

- `frontend/src/auth/livenessChallenge.ts`
- `frontend/src/auth/cameraErrorPolicy.ts`
- `frontend/src/components/Auth/AuthGateway.tsx`
  (`livenessChallengeRef`, `challengeUiState`, `trySatisfyGestureChallenge`,
  `trySatisfyYawChallenge`, `checkChallengeTimeout`, `challengesPassedRef`,
  overlay de UI ~línea 2685)
- ADR-125 (`head_yaw_ratio_from_points` en `eye_analyzer.py`, groundwork de
  backend que este ADR consume)
- ADR-119 (fusión CV+ONNX de lentes — mismo flujo de captura biométrica)
