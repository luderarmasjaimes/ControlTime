# ADR-125 — `eye_analyzer.py`: recalibración por resolución de cámara, thread-safety de MediaPipe y groundwork de liveness activo por giro de cabeza

**Status**: implemented (2026-08-19/20, hallado y documentado en auditoría 2026-08-21)

**Fecha**: 2026-08-19

**Ámbito**: ia

**Relación**: extiende ADR-098 (aislamiento de sesión biométrica) y ADR-119
(fusión CV+ONNX de lentes); es el lado de backend/`ai_engine` de ADR-126
(liveness activo por desafío en frontend), que consume `head_yaw_ratio`.

## Contexto

Tres cambios independientes, todos en `ai_engine/eye_analyzer.py`, sin ADR
propio hasta esta auditoría:

1. **La resolución de captura de cámara subió de 640×480 a 960×720** (1.5x
   lineal, `FACIAL_ICAO.CAMERA` en `frontend/src/config/facialIcaoConfig.ts`,
   2026-08-19). Las constantes de calibración del EAR (Eye Aspect Ratio),
   medidas en píxeles, no escalaban solas con la resolución.
2. Datos reales de producción mostraron que, a mayor distancia de la cámara
   (IED — distancia interocular — baja), el EAR crudo medido ya baja por la
   propia pérdida de precisión de pocos píxeles (confirmado: EAR combinado
   ~0.15-0.24 a IED~78-90px, contra ~0.30-0.35 a IED~95px+), y que la
   medición de UN solo ojo se vuelve ruidosa a distancias mayores (caso real:
   EAR L:0.145 / R:0.071 en el mismo frame, sin evidencia de parpadeo real en
   el `blink` blendshape de ninguno de los dos).
3. `detector.detect()` de MediaPipe Tasks (`FaceLandmarker`) se llamaba en
   cada verify-frame — la ruta más caliente de todo el pipeline — **sin
   ningún lock**, a diferencia de `face_embedding_insight.py` (InsightFace,
   ya serializado con `_lock`) y del propio cálculo CV de lentes de este
   archivo (ya serializado con `_glasses_lock`). MediaPipe Tasks no garantiza
   que un mismo objeto sea seguro para llamadas concurrentes desde varios
   hilos; con `threaded=True` y un frame nuevo cada 175ms, dos `detect()` en
   vuelo al mismo tiempo (un frame que tarda más que el intervalo, o dos
   sesiones/pestañas concurrentes) podían corromper el estado interno
   compartido del detector o colgarlo sin ningún log de cierre — el mismo
   síntoma "llega a los frames requeridos y después no avanza, sin error,
   hasta el timeout" reportado en vivo para login/registro facial.
4. RRHH/negocio pidió, por separado, empezar a preparar el terreno para un
   futuro desafío activo de liveness "gira la cabeza" (ver ADR-126) — el
   backend necesitaba poder calcular y exponer un ángulo de giro de cabeza
   con signo, no solo el booleano "frontal/no frontal" que ya existía
   (`face_frontal_from_points`).

## Decisión

1. **Recalibración por resolución**: `EAR_IED_REF_PX` sube de 95 a 143
   (95×1.5, misma distancia física de referencia, medida ahora con más
   píxeles). `EAR_IED_SCALE_MAX` baja de 1.12 a 1.00 — el techo que antes
   exigía un umbral EAR *más alto* cuanto más lejos estaba la cara (IED
   bajo) se elimina: el umbral ya no sube por distancia; el piso
   `EAR_IED_SCALE_MIN=0.88` (más permisivo de cerca) se mantiene sin cambio.
2. **`combined_ear`/`both_open_robust`**: además de `left_open`/`right_open`
   individuales (que se mantienen, sin romper el contrato existente), se
   calcula `combined_ear = max(left_ear, right_ear)` y
   `combined_blink = min(blink_l, blink_r)` — si el **mejor** de los dos ojos
   confirma claramente "abierto", es evidencia confiable aunque el otro ojo
   mida ruido en ese frame puntual (un parpadeo real cierra ambos ojos casi
   simultáneamente; el ruido de un solo ojo a distancia no).
3. **`_mediapipe_lock` (`threading.Lock`)** envuelve ahora
   `detector.detect(mp_image)`, la única línea de la ruta caliente que
   corría sin serializar. Mismo criterio que `_lock` (InsightFace) y
   `_glasses_lock` (CV de lentes) ya aplicaban en este mismo archivo/stack.
4. **`head_yaw_ratio_from_points(points)`** (nueva función): misma geometría
   que `face_frontal_from_points` (posición de la nariz respecto al eje
   interocular) pero **con signo** — positivo si la nariz se desplaza hacia
   la derecha de la imagen (el usuario giró hacia su izquierda), negativo en
   sentido contrario. El límite de "no frontal" del chequeo ICAO existente
   es 0.42 (mucho más extremo); ~0.20-0.25 ya es un giro claro y visible sin
   perder la detección del rostro — ese es el rango pensado para un desafío
   de "gira la cabeza", no para el gate ICAO que ya existía. El valor se
   expone en la respuesta JSON (`head_yaw_ratio`) y se propaga hasta C++
   (`AiEngineFrameResult::headYawRatio` en `ai_engine_client.cpp`,
   `biometric_types.hpp`, expuesto en el JSON de estado de sesión en
   `biometric_routes.cpp`).
5. **Instrumentación de tiempos** (`EYE_AI_TIMING`, `print(...)` con
   `flush=True`): decodificación, MediaPipe, EAR/landmarks, CV de lentes,
   fusión ONNX y tiempo total por frame — para poder diagnosticar
   regresiones de latencia en producción sin necesidad de reproducir el
   problema localmente.

## Consecuencias

- La recalibración por resolución (1, 2) corrige directamente la causa de
  que "ojos abiertos" tardara demasiado en confirmarse a la distancia normal
  de uso tras el cambio de resolución de cámara — verificado con los mismos
  logs de producción que motivaron el cambio.
- `head_yaw_ratio` **se calcula y se expone de punta a punta, pero ningún
  gate o chequeo lo consume todavía para aceptar/rechazar nada** — es
  groundwork puro para ADR-126. Este ADR no introduce ningún desafío de
  giro de cabeza por sí solo; ver ADR-126 para el consumo real en frontend.
- El lock de MediaPipe (3) serializa el punto más caliente del pipeline entre
  sesiones concurrentes — el trade-off es una posible espera breve si dos
  capturas llegan al mismo instante exacto, aceptable frente al riesgo de
  corrupción de estado/cuelgue sin log que resolvía.
- La instrumentación de tiempos es puramente de diagnóstico (líneas de log),
  sin impacto funcional; no se agregó a un sistema de métricas estructurado
  (Prometheus/etc.) — decisión deliberada de mantenerlo simple mientras no
  haya evidencia de que haga falta más.

## Alternativas descartadas

- **Recalibrar el EAR con un factor de escala calculado en tiempo real a
  partir de la resolución real del frame** (en vez de una constante fija
  `EAR_IED_REF_PX`): más general, pero sin evidencia de que la resolución
  vaya a volver a cambiar con frecuencia — se prefirió el ajuste simple y
  verificable a ojo, mismo criterio que ya aplica el resto de este archivo
  para umbrales calibrados con datos reales en vez de fórmulas genéricas.
- **Lock por sesión en vez de un lock global de `detector`**: MediaPipe
  Tasks no garantiza concurrencia segura sobre el objeto compartido en sí
  (no es un problema de estado *por sesión*, es el objeto `FaceLandmarker`
  compartido entre todas), así que un lock por sesión no habría resuelto el
  problema real.

## Referencias

- `ai_engine/eye_analyzer.py` (`EAR_IED_REF_PX`, `EAR_IED_SCALE_MAX`,
  `combined_ear`, `both_open_robust`, `_mediapipe_lock`,
  `head_yaw_ratio_from_points`, instrumentación `EYE_AI_TIMING`)
- `frontend/src/config/facialIcaoConfig.ts` (`FACIAL_ICAO.CAMERA`, resolución
  960×720)
- `backend/src/biometric/ai_engine_client.cpp` (parseo de `head_yaw_ratio`)
- `backend/src/biometric/biometric_types.hpp` (`headYawRatio`)
- `backend/src/biometric/biometric_routes.cpp` (línea 187, 323 — exposición
  en el JSON de estado de sesión)
- ADR-098 (aislamiento de sesión), ADR-119 (fusión CV+ONNX de lentes),
  ADR-126 (liveness activo por desafío — consumidor real de `head_yaw_ratio`)
