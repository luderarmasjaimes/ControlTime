# ADR-119 — Validación biométrica dejaba pasar con lentes puestos: login sin chequeo ICAO + fusión ONNX solo-veto + carrera de captura

**Status**: implemented, pendiente de verificación en producción con usuarios reales
**Fecha**: 2026-08-19
**Autores**: Luder Armas (reporte) + Claude Sonnet 5 (diagnóstico e implementación)
**Ámbito**: ia
**Relación**: se apoya en el aislamiento de sesión de ADR-098 y en la
recalibración de veto de ADR-100 (misma capa, corrige una laguna distinta);
interactúa con ADR-105 (DeepFace+SilentFace, proveedor por defecto
verificado en `docker-compose.yml`/`.env.example` como
`BEEMETRY_BIOMETRIC_PROVIDER=deepface_silentface`) y ADR-104 (SeetaFace6).

## Contexto

Reporte del usuario: "la validación biométrica está muy rápida... deja
pasar aunque tenga el lente puesto". Investigación end-to-end (sin acceso a
cámara real; código + `ai_engine_probe_logs/glasses_probe.jsonl`, un log de
producción/pruebas real con 10802 frames) encontró **tres causas
independientes**, todas necesarias para explicar el síntoma completo:

### 1. Login facial nunca validaba ICAO (ojos/boca/lentes/frontal) en el servidor

`buildFaceLoginProbe()` (`backend/src/biometric/face_analysis.cpp`), usado
por `handleLoginFace` (`main.cpp`) y por `loginFaceTargetedPg`
(`auth_storage_pg.cpp`, el camino real en producción con Postgres), tenía
tres ramas según `BEEMETRY_BIOMETRIC_PROVIDER`:

- `seetaface6` → `fetchSeetaFaceAnalysisFromAiEngine()` → `/seetaface_analyze`
- `deepface_silentface` (**default real**, ver `.env.example:101` y
  `docker-compose.yml:433`) → `fetchDeepFaceSilentAnalysisFromAiEngine()`
- fallback embedding InsightFace → `fetchFaceEmbeddingFromAiEngine()` →
  `/face_embedding`

Ninguna de las tres llamaba nunca a `analyzeFrameWithAiEngine()`
(`/analyze_eyes`, MediaPipe — el único lugar del sistema que sabe detectar
lentes). Confirmado además que **ni `seetaface6_adapter.py` ni
`deepface_silentface_adapter.py` mencionan lentes en absoluto** (`grep -i
glasses` sin resultados en ambos) — su `quality`/`pass` es anti-spoofing +
calidad de plantilla, una dimensión distinta de "foto tipo ICAO sin
lentes". `/face_embedding` solo extrae el vector 512-dim.

El registro (`runBiometricVerifyForImageBase64`, vía `/api/process_frame` y
`/api/auth/biometric/verify-frame`) sí exige `eval.aiEval->noGlasses`. El
LOGIN facial, con **cualquier** proveedor configurado, nunca lo volvía a
comprobar del lado servidor. El frontend (`AuthGateway.tsx`) filtra por JS
antes de enviar el frame elegido, pero eso es una preferencia de UI, no una
barrera de seguridad: un `POST /api/auth/login/face` directo con una foto
con lentes puestos nunca era rechazado por esta razón específica.

### 2. Carrera entre la captura (registro) y la histéresis de lentes

`FACIAL_ICAO.REQUIRED_VALID_FRAMES = 3` (frontend) y su espejo hardcodeado
`captureCount < 3` / `>= 3` (backend, tres puntos en
`biometric_routes.cpp` + uno en `main.cpp`) daban por completa la captura
de registro tras solo 3 frames válidos consecutivos (~3×`VERIFY_SYNC_MS` =
~525ms).

La histéresis de lentes en `ai_engine/eye_analyzer.py`
(`_glasses_from_frame_impl`) empieza cada sesión asumiendo `glasses_state_
prev = False` ("sin lentes") y exige que la MEDIANA de una ventana de
`GLASSES_SCORE_HIST_LEN` muestras (default 5) supere umbrales de entrada
deliberadamente conservadores (`stable > 50/51/54`, para evitar falsos
positivos por cejas/nariz/reflejos). Con solo 3 frames, la captura podía
completarse **antes** de que esa ventana alcanzara evidencia suficiente —
una carrera, no un fallo de calibración de los umbrales en sí.

### 3. La fusión CV+ONNX en modo `cv_primary` solo dejaba que ONNX VETARA, nunca CONFIRMARA

Esta fue la causa dominante, cuantificada con datos reales. `ai_engine_
probe_logs/glasses_probe.jsonl` contiene 9921 frames marcados
`probe_session=con_gafas` (persona con lentes puestos confirmados). En
estado ya estabilizado (`hist_len` en su máximo, 9235 de esos frames):

| hist_len | frames | detectado correctamente | falsos negativos | tasa |
|---|---|---|---|---|
| 9 (estable) | 9235 | 5720 | **3515** | 61.94% |

De esos 3515 falsos negativos, el 100% tenía `cv_glasses_hit=False`
(la CV nunca "entraba"), pero el clasificador ONNX (`GLASSES_ONNX_PATH`,
activo por defecto en `docker-compose*.yml`) daba `onnx_prob` en 0.7–0.9
en la inmensa mayoría de ellos — el clasificador **acertaba con alta
confianza en el mismo frame que la CV fallaba**. El código
(`apply_glasses_fusion_pipeline`, modo `cv_primary`) solo usaba ONNX para
vetar una detección CV existente hacia "sin lentes" (`GLASSES_ONNX_NO_
GLASSES_VETO`, umbral 0.45 desde ADR-100) o para confirmar una salida
sostenida (`GLASSES_ONNX_EXIT_CONFIRM_*`) — **no existía ningún mecanismo
simétrico para que ONNX promoviera "sin lentes" a "con lentes"** cuando la
CV nunca disparaba sus condiciones de entrada (gafas sin marco marcado,
cristal delgado, o sin brillo aprovechable en el ángulo de cámara).

## Decisión

1. **`buildFaceLoginProbe`**: se movió una llamada única a
   `analyzeFrameWithAiEngine(*rawImageBytes, std::nullopt)` al inicio de la
   sección "hay imagen cruda", antes de las tres ramas de proveedor. Exige
   `detected && bothOpen && mouthClosed && noGlasses` (+ `faceFrontal` si
   el motor lo reporta) para las tres, con mensajes de error específicos en
   español. **Fail-closed**: si el motor IA está configurado
   (`gAiEngineUrl` no vacío) pero la llamada falla (`aiEval->error` no
   vacío), se rechaza el login — no se degrada en silencio a "solo
   comparar plantilla/embedding". Si el motor IA no está configurado en
   absoluto (`std::nullopt`), el comportamiento no cambia respecto a antes
   (mismo criterio que `runBiometricVerifyForImageBase64` en registro).

2. **`kRequiredValidCaptureFrames`** (nueva constante,
   `biometric_types.hpp`, valor 5): reemplaza el `3` hardcodeado en
   `biometric_routes.cpp` (`captureCount` gate + ventana de
   `capturedImages` + fórmula de `livenessScore`) y en `main.cpp`
   (`handleRegister`, chequeo final `captureCount < N || state != 7`).
   Sincronizado con `FACIAL_ICAO.REQUIRED_VALID_FRAMES` (frontend,
   `facialIcaoConfig.ts`, también subido de 3 a 5) y con
   `GLASSES_SCORE_HIST_LEN`/`GLASSES_FUSION_HIST_LEN` (`eye_analyzer.py`,
   default 5) — para cuando la captura se da por completa, la histéresis
   de lentes ya tuvo una ventana completa de muestras para confirmar su
   veredicto.

3. **`apply_glasses_fusion_pipeline`** (`eye_analyzer.py`, modo
   `cv_primary`): nuevo bloque simétrico al de salida-por-ONNX-sostenido
   ya existente. Cuando `not st.glasses_state_prev` (CV no detecta) y
   `onnx_prob > GLASSES_ONNX_ENTRY_CONFIRM_PROB` (default 0.65) durante
   `GLASSES_ONNX_ENTRY_CONFIRM_FRAMES` (default 3) frames consecutivos,
   promueve `st.glasses_state_prev = True` y `hit = True`
   (`gdebug["onnx_confirmed_entry"] = True` para diagnóstico). Umbral
   0.65 elegido simétrico al de salida (0.35 alrededor del punto de
   decisión 0.5) y con margen bajo la distribución real observada
   (0.7–0.9) para evitar falsos positivos por ruido.

## Verificación

- **Build**: `docker build -f backend/Dockerfile.verify -t
  beemetry-backend-verify backend` — compila limpio con los tres cambios
  de C++ (login gate, constante compartida, refactor de
  `buildFaceLoginProbe`).
- **Sintaxis**: `python3 -c "import ast; ast.parse(...)"` sobre
  `eye_analyzer.py` tras el cambio — OK.
- **Replay contra datos reales** (`ai_engine_probe_logs/glasses_probe.jsonl`,
  script ad-hoc, no incluido en el repo): simulando la nueva lógica de
  confirmación de entrada sobre las 5 sesiones reales del log (227 a 7110
  frames cada una), **el 100% de los 3515 falsos negativos históricos se
  habrían detectado correctamente como "con lentes"**, y en las 5 sesiones
  la confirmación ocurre en el frame 3 (0-indexado: índice 2) — es decir,
  con el umbral y la ventana elegidos, la detección real habría sido casi
  inmediata, no solo "eventual".
- **Pendiente**: no se pudo probar con cámara real en este entorno (sin
  acceso a webcam/Docker Compose completo). Se recomienda una prueba
  manual end-to-end (registro y login, con y sin lentes, con el proveedor
  `deepface_silentface` real) antes de dar el fix por cerrado en
  producción, y monitorear `GLASSES_PROBE_LOG`/`glasses_probe.jsonl` en
  vivo para confirmar que no se introdujeron falsos positivos (alguien SIN
  lentes siendo rechazado) — no se disponía de un log equivalente
  "sin_gafas" para validar esa dirección con datos reales.

## Consecuencias

- El login facial ahora hace una llamada HTTP adicional a `ai_engine`
  (`/analyze_eyes`) antes de la llamada de matching/embedding —
  latencia adicional del mismo orden que ya paga el registro (unas
  decenas–cientos de ms), aceptada por ser el mismo patrón ya establecido
  ahí.
- La captura de registro tarda ~2 frames más en completarse
  (`REQUIRED_VALID_FRAMES` 3→5, ~350ms extra a `VERIFY_SYNC_MS=175`) —
  trade-off deliberado: UX ligeramente más lenta a cambio de que el gate
  de seguridad tenga evidencia real antes de aceptar.
- El código `applyIcaoGlassesEma`/`GlassesEmaState` en
  `ai_engine_client.cpp` (EMA + histéresis en C++, kDetect=66/kClear=52)
  se sigue calculando pero su resultado se sobrescribe siempre que
  `ai_engine` responda con un campo `no_glasses` booleano (rama
  `aiNoGlassesHint && out.detected`), lo cual ocurre en la práctica en
  todo frame con `detected=true`. Es decir, es efectivamente código muerto
  hoy — la histéresis real vive enteramente del lado Python
  (`_SessionState` por sesión). No se tocó en este ADR por no ser causa
  raíz confirmada del síntoma reportado y por no querer mezclar una
  limpieza de código con un fix de seguridad; queda como candidato a
  simplificación en un ADR futuro.

## Alternativas descartadas

- **Solo subir el umbral de veto (`GLASSES_ONNX_VETO_MAX_PROB`) o bajar
  los umbrales de entrada de la CV** (`stable > 50/51/54`,
  `frame_presence`, `matte_frame_signal`): descartado como fix principal
  — el log real muestra que el problema no es que la CV esté "cerca" del
  umbral y necesite un empujón; en el 100% de los falsos negativos
  analizados `cv_glasses_hit` era `False` con la CV simplemente sin señal
  suficiente, mientras ONNX ya tenía la respuesta correcta con alta
  confianza. Bajar más los umbrales de la CV sin usar la señal ONNX ya
  disponible habría sido reafinar por conjetura en vez de usar la
  evidencia ya capturada, y con alto riesgo de reintroducir los falsos
  positivos que ADR-100 corrigió.
- **Requerir sesión de captura (`X-Capture-Session-Id`) también en login
  facial** para reusar la histéresis multi-frame de `eye_analyzer.py` en
  vez de una llamada stateless: descartado por alcance — requeriría
  plomería nueva (el endpoint de login no tiene hoy noción de la sesión de
  captura que precedió al envío) y el fix de fusión ONNX (punto 3) ya
  resuelve la detección en pocos frames incluso sin estado de sesión
  acumulado del lado del login.

## Referencias

- `backend/src/biometric/face_analysis.cpp` (`buildFaceLoginProbe`,
  `runBiometricVerifyForImageBase64`)
- `backend/src/biometric/biometric_types.hpp` (`kRequiredValidCaptureFrames`)
- `backend/src/biometric/biometric_routes.cpp` (`handleProcessFrame`)
- `backend/src/main.cpp` (`handleRegister`, `handleLoginFace`)
- `backend/src/auth/auth_storage_pg.cpp` (`loginFaceTargetedPg`)
- `ai_engine/eye_analyzer.py` (`apply_glasses_fusion_pipeline`,
  `_glasses_from_frame_impl`)
- `ai_engine/seetaface6_adapter.py`, `ai_engine/deepface_silentface_adapter.py`
  (confirmado: sin lógica de lentes)
- `frontend/src/config/facialIcaoConfig.ts` (`REQUIRED_VALID_FRAMES`)
- `ai_engine_probe_logs/glasses_probe.jsonl` (evidencia real usada para
  diagnóstico y validación del fix)
- ADR-098 (`aislamiento-sesion-captura-biometrica`)
- ADR-100 (`onnxruntime-thread-limit-insightface`, veto ONNX original)
- ADR-105 (`deepface-silentface-proveedor-biometrico-primario`)
