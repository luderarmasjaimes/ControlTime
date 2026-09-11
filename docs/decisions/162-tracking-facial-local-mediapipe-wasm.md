# ADR-162 — Tracking facial local vía MediaPipe Tasks Vision (WASM), reemplazo de FaceDetector/Haar

**Status**: implemented en código; pendiente verificación visual en vivo con cámara real (no
disponible en el entorno donde se implementó, ver "Verificación" abajo)
**Fecha**: 2026-09-07
**Autores**: EC
**Ámbito**: plataforma

> Relacionado con [ADR-125](125-recalibracion-thread-safety-eye-analyzer.md) (recalibración EAR
> en `ai_engine/eye_analyzer.py`) y [ADR-142](142-liveness-challenge-verificado-en-servidor.md)
> (servidor como autoridad de liveness). Este ADR no cambia la autoridad del servidor sobre
> ICAO/liveness — solo el origen del óvalo VISIBLE y de las señales locales de parpadeo/boca
> (heurísticas de UX, no de seguridad).

## Contexto

El usuario reportó que el óvalo guía de la captura biométrica facial era lento (tardaba varios
segundos en "alcanzar" la cara al moverse) e impreciso (no cubría la frente completa, no encerraba
bien el rostro). Una sesión anterior había ajustado constantes (EMA, offsets del óvalo, timings)
sin resolver el problema de fondo.

Investigación de esta sesión (lectura completa de la pipeline, antes de cualquier cambio) encontró
**dos causas raíz de arquitectura**, no de tuning:

### 1. Lentitud: dos fuentes lentas compitiendo por el óvalo visible

- **Local**: `window.FaceDetector` (Shape Detection API nativa de Chromium) — pese al comentario
  de cabecera de `facialIcaoConfig.ts` (que decía "Navegador: FaceDetector API"), no es OpenCV ni
  MediaPipe: es una API experimental solo-Chromium que serializa por IPC (Mojo) el bitmap completo
  a un proceso aparte en cada llamada. Se invocaba cada ~33ms con un canvas de **hasta 1920×1440**
  (`AdaptiveEncodeResolution`, escalón más alto de `LONG_SIDE_LADDER`) — sin ROI ni downscale
  previo (`TRACKING_CANVAS_SCALE = 0.74` en `facialIcaoConfig.ts` existía pero no estaba conectado
  a ningún canvas real). Cada llamada podía tardar cientos de ms; como el loop esperaba (`await`)
  cada detección antes de programar el siguiente frame, el resultado mostrado siempre llegaba
  tarde.
- **Servidor**: `ovalForStage` en `AuthGateway.tsx` daba **prioridad** al óvalo que manda
  `/api/process_frame` cuando `source === "opencv_realtime_tracker"` con confianza ≥ 0.45 — es
  decir, el borde visible seguía mostrando muy seguido un resultado atado al round-trip de red
  (`VERIFY_SYNC_MS` = 80ms + latencia real), contra lo que sugería el historial de cambios
  anterior. Ese tracker (`backend/src/biometric/realtime_face_tracker.cpp`) es un **Haar Cascade**
  (`cv::CascadeClassifier::detectMultiScale`, Viola-Jones) — rápido de correr pero atado a la
  cadencia de red, y solo da bbox rectangular sin landmarks.

### 2. Imprecisión: ningún punto del pipeline visual usaba un contorno facial real

Tres lugares distintos "adivinaban" el óvalo inflando un bbox con factores fijos:
`FACIAL_OVAL_H_FACTOR=1.34` + offset `-13%` en `biometricOvalFrame.ts`; `ovalFromFaceBox` con
`1.14`/`1.34`/`-13%` en `realtime_face_tracker.cpp`; y otro bbox-ellipse con `1.26`/`1.42`/`-16%`
en `ai_engine_client.cpp`. De ahí que los ajustes sucesivos (`-3%→-8%→-11%`) de offset vertical
nunca terminaran de acertar: eran tres heurísticas independientes compitiendo, ninguna basada en
geometría real.

La pieza que sí es precisa ya existía en el backend Python (`ai_engine/eye_analyzer.py`): usa
`mediapipe.solutions.face_mesh.FACEMESH_FACE_OVAL`, un contorno real de 36 puntos (incluye el
punto 10, que cae en la línea de nacimiento del pelo — resuelve exactamente el "falta ~5% de
frente" reportado). Pero solo se calculaba cuando llegaba una respuesta del motor IA Python (lento,
no es el que dibuja el óvalo en tiempo real), y ni siquiera se mandaba tal cual al frontend: el
backend C++ lo reducía otra vez a un bbox-ellipse con factores inventados.

## Decisión

Migrar el tracking local (solo el que dibuja el óvalo guía y las señales de parpadeo/boca en el
cliente) a **MediaPipe Tasks Vision (WASM) corriendo en el navegador** — el mismo motor/topología
de 478 landmarks que ya usa `ai_engine/eye_analyzer.py` en Python. No es una pieza nueva y
desconectada: es llevar al cliente la misma fuente de verdad geométrica que el backend ya usa y
confía.

**Alcance: solo frontend.** No se tocó `backend/` — ni `realtime_face_tracker.cpp` (Haar) ni
`ai_engine_client.cpp` (bbox-ellipse desde MediaPipe Python). Ambos siguen existiendo y sirviendo
`/api/status`/liveness-fallback; solo se les quitó la prioridad de renderizado del óvalo VISIBLE en
`ovalForStage`. El servidor sigue siendo la autoridad real de ICAO/liveness para permitir
login/registro — sin cambios ahí.

### Implementación

- **Dependencia**: `@mediapipe/tasks-vision@1.0.1` (pin exacto).
- **Assets self-hosted** en `frontend/public/mediapipe/` (WASM + modelo `.task`, ~26MB total):
  obligatorio porque `frontend/nginx.conf` tiene `connect-src 'self'` estricto — no se puede
  apuntar al CDN de Google como hacen los ejemplos oficiales. Se vendorizan solo 2 de las 3
  variantes WASM del paquete (`vision_wasm_internal.*` para SIMD, `vision_wasm_nosimd_internal.*`
  de respaldo) — se omite `vision_wasm_module_internal.*` porque no se usa el modo ES-module
  (`FilesetResolver.forVisionTasks(basePath)` sin `useModule`), ahorrando ~11.7MB.
  `nginx.conf` gana un `location ^~ /mediapipe/` con `Cache-Control: public, max-age=31536000,
  immutable` (antes caían en el catch-all `location /` con `no-store`, re-descargando ~26MB en
  cada apertura del flujo facial).
- **`frontend/src/auth/mediapipeFaceTracker.ts`** (nuevo): carga perezosa única de
  `FaceLandmarker` (`runningMode: 'VIDEO'`, `numFaces: 1`, blendshapes/matrices desactivados por
  costo), delegate `GPU` con reintento a `CPU` si falla. Exporta los mismos índices de landmarks
  que `ai_engine/eye_analyzer.py` (copia literal, comentario cruzado en ambos archivos):
  `FACE_OVAL_INDICES` (36 puntos, `FACEMESH_FACE_OVAL`), `LEFT_EYE_EAR_INDICES`/
  `RIGHT_EYE_EAR_INDICES` (EAR de 6 puntos, fórmula Soukupová-Čech) e índices de MAR de boca
  (13/14 verticales, 78/308 horizontales, misma fórmula que `mar_inner_ratio()`).
- **`AuthGateway.tsx`**: se quitó la rama `window.FaceDetector`; el loop llama
  `landmarker.detectForVideo(pCanvas, timestamp)` reutilizando el mismo canvas que ya se armaba
  cada tick para luminancia/envío al servidor. El fallback heurístico de color de piel (para
  navegadores donde el WASM tarda en cargar o falla) se mantiene sin cambios. `ovalForStage`
  ya no prioriza el óvalo `opencv_realtime_tracker` del servidor — el tracking local es la única
  fuente del óvalo visible mientras haya `liveFaceBox`; el óvalo de servidor queda como último
  recurso solo si no hay tracking local en absoluto.
- **`biometricOvalFrame.ts`**: `getBiometricOvalVideoMetrics` usa el bbox del contorno real
  (`box.ovalPoints`) con un margen chico y documentado (+4%/+3%) en vez de inflar el bbox facial
  con un factor adivinado. Los factores viejos (`FACIAL_OVAL_W_FACTOR`/`H_FACTOR`) quedan como
  fallback solo para cuando aún no hay `ovalPoints` (WASM cargando o caído a heurística de piel).
- **`facialIcaoConfig.ts`**: `MOUTH_OPEN_LANDMARK_RATIO` bajó de `0.2` a `0.05` — el valor viejo
  estaba calibrado para un ratio ancho/alto tosco de FaceDetector; con MAR real (misma fórmula que
  el backend) la escala numérica es distinta y el umbral tuvo que recalibrarse, no solo migrarse.
  `EAR_OPEN_HINT` (0.18) no cambió: ya estaba calibrado para EAR real de MediaPipe (coincide con
  `EAR_THRESH_BASE=0.185` en `eye_analyzer.py`) — antes se comparaba contra un ratio ancho/alto de
  FaceDetector con una escala distinta, un desajuste que este cambio corrige de paso.

### Efecto colateral documentado (no es un problema de seguridad)

`hasLandmarks` pasa a ser `true` en todos los navegadores que logran cargar el WASM (antes solo en
Chrome/Edge de escritorio con `FaceDetector` nativo). Esto hace que `livenessFallbackRef` (un
proxy de liveness más débil, usado cuando no hay landmarks reales) deje de acumularse para
usuarios que antes caían siempre a ese camino — en la práctica es una mejora (parpadeo/boca con
EAR/MAR reales en vez de un heurístico de piel), y no reduce seguridad real porque el servidor
sigue validando ICAO/liveness de forma independiente antes de aceptar login/registro.

### Alternativas descartadas

- **Fix quirúrgico sin nueva dependencia** (conectar `TRACKING_CANVAS_SCALE`, recortar el canvas
  antes de `FaceDetector.detect()`): reduce el costo de IPC pero no resuelve el techo de precisión
  (`FaceDetector` no da contorno real) ni la dependencia de Chromium-only / fallback de piel en
  otros navegadores. Descartada porque el usuario pidió explícitamente la solución de fondo tras
  ver la comparación de opciones.
- **Mantener el óvalo de servidor (`opencv_realtime_tracker`) como fuente principal**: descartada
  porque es precisamente la rama que ataba el borde visible a la cadencia de red pese a dar peor
  precisión (bbox de Haar cascade, sin landmarks).

## Verificación

- `npm run type-check` y `npm test -- --run src/auth/livenessChallenge.test.ts
  src/auth/authApi.test.js`: verdes (26 tests).
- `npm run build`: OK, assets de `public/mediapipe/` presentes en `dist/mediapipe/` con los tamaños
  esperados.
- Verificado en `frontend-dev-verify` (Vite dev, puerto 5181, Browser pane): los 5 assets
  (`vision_wasm_internal.{js,wasm}`, `vision_wasm_nosimd_internal.{js,wasm}`,
  `face_landmarker.task`) sirven 200 desde rutas propias `/mediapipe/...`; `FaceLandmarker.
  createFromOptions` con delegate `GPU` inicializa sin error en el navegador de este entorno;
  `landmarksToFaceBox()` probado con un array sintético de 478 puntos no lanza excepciones ni
  produce `NaN` (índices de ojo/boca/óvalo dentro de rango).
- **Pendiente**: el entorno de implementación no tiene una webcam real disponible, así que la
  prueba visual real (el óvalo sigue la cara rápido y cubre la frente con una persona real,
  latencia percibida al mover la cabeza) queda para que el usuario la haga con su cámara. Si el
  margen de inferencia real medido en su hardware da margen de sobra, `DETECT_FRAME_MIN_MS`
  (`facialIcaoConfig.ts`) puede bajar más — no se tocó en esta entrega para no adivinar un número
  sin medir en hardware real, el mismo error de la sesión anterior.
