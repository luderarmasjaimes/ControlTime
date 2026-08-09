# PLAN 008 — Biometría facial para login de operación

| Campo | Valor |
|---|---|
| **Spec** | `specs/008-biometria-facial-login/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S6, S11 · R3, R5 |
| **Constitución** | Art. 6 (seguridad), Art. 7 (IA local), Art. 9 (recursos) |

---

## 1. Enfoque técnico

**Pipeline de verificación facial con dos modos de proveedor** (configurable en runtime):

1. **Legacy** — OpenCV DNN en proceso (rápido, sin dependencia externa): detecta rostro,
   extrae landmarks, calcula quality_score, decide `ok/issues`.
2. **Dermalog CLI** — llama al CLI externo `dermalog_verify` (hardware biométrico de alta
   precisión, requerido para ciertos contratos). `gDermalogRequired=true` fuerza que si
   Dermalog falla, el login también falla (no fallback al legacy).

El resultado se integra en el flujo de login de spec 006: la sesión se emite solo si el
facial score supera el umbral configurado.

## 2. Arquitectura del pipeline

```
 Sensor/cámara (frontend)
       │
       │  POST /api/biometric/verify-frame
       │  { face_image_base64: "..." }
       ▼
 biometric_routes.cpp
   ├── decodificar base64 → bytes → cv::Mat (OpenCV imdecode)
   ├── runBiometricVerifyForImageBase64(base64, glassesEmaKey)
   │         │
   │         ├── [Provider=Legacy]
   │         │     runOpenCvFaceAnalysis(mat) → FaceResult{ok, qualityScore, issues}
   │         │
   │         └── [Provider=Dermalog]
   │               exec dermalog_verify → parse JSON → FaceResult
   │
   └── respuesta: {ok, issues[], quality_score, provider, ai_engine_enabled}

 POST /api/process_frame (flujo alternativo de CCTV/EPP)
   ├── raw image bytes → cv::imdecode
   └── runBiometricVerify... (mismo pipeline)
```

## 3. Componentes C++

**`biometric/face_analysis.cpp`** — motor OpenCV:
- `cv::CascadeClassifier` (Haar) o DNN (ONNX/MobileNet) para detección.
- Evaluación de `qualityScore`: luminosidad, frontalidad, oclusión.
- Issues posibles: `"no_face_detected"`, `"low_quality"`, `"multiple_faces"`,
  `"face_too_small"`, `"glasses_detected"` (con exención por EMA key).

**`biometric/ai_engine_client.cpp`** — cliente HTTP al `ai_engine`:
- Si `AI_ENGINE_URL` está configurado, manda el frame al servicio Python (Ollama/OpenCV
  avanzado) para un análisis adicional de calidad o liveness.
- Timeout: `gAiEngineTimeoutMs` (default 500 ms → cumple O6 < 1 s total).

**`biometric/biometric_routes.cpp`** — routing:
- `GET /api/biometric/status` — solo admin; devuelve provider activo + estado DNN.
- `POST /api/biometric/verify-frame` — abierto a sesión válida o pre-login.
- `POST /api/process_frame` — usado internamente por el flujo de CCTV/EPP.

## 4. Configuración

```bash
BIOMETRIC_PROVIDER=legacy          # o dermalog_cli
DERMALOG_REQUIRED=false            # true = falla dura si Dermalog no disponible
AI_ENGINE_URL=http://ai_engine:8001 # vacío = sin AI engine externo
AI_ENGINE_TIMEOUT_MS=500
FACE_QUALITY_THRESHOLD=0.65        # 0.0-1.0
```

## Actualización 2026-07-27 — avatar derivado, sin retención de captura cruda

ADR-074 corrige el alcance de “no almacenar imágenes”: continúa prohibido
persistir la **captura facial cruda** usada para análisis/autenticación, pero
el runtime ya almacenaba una miniatura estilizada como avatar de perfil y
ahora puede conservar además un maestro HD privado. Ambos son derivados
visuales, no sustituyen el embedding, no se exponen desde endpoints de
verificación y permanecen sujetos al gate legal/retención de ADR-025.

## 5. Seguridad y privacidad (Art. 6)

- La captura facial cruda **no se almacena** en BD — se conserva el resultado
  (ok/issues/score), la plantilla y, cuando aplica, un avatar estilizado
  derivado separado conforme a ADR-074.
- El token de sesión se emite en `auth_routes.cpp` si `face.ok = true`.
- `glassesEmaKey` — operadores con gafas de seguridad pueden tener una clave de
  exención (`EMA` = Excepción Médica/Ambiental) registrada; el análisis la comprueba.
- Ningún endpoint de **verificación biométrica** devuelve la captura ni datos
  biométricos crudos. `/api/auth/avatar/hd` devuelve solo el avatar derivado
  del propio usuario autenticado.

## 6. Fallback y resiliencia (Art. 9)

- Si `ai_engine` no responde en `AI_ENGINE_TIMEOUT_MS`, se usa solo el resultado OpenCV.
- Si `DERMALOG_REQUIRED=false` y Dermalog falla → fallback al legacy automáticamente.
- Si `DERMALOG_REQUIRED=true` y Dermalog falla → devuelve `{ok:false, issues:["dermalog_unavailable"]}`.

## 7. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-008-1 | **No almacenar capturas faciales crudas**; avatar visual derivado permitido bajo ADR-074 | Refinado 2026-07-27 |
| ADR-008-2 | **Dual provider** (Legacy/Dermalog) con switch en runtime | Aceptado |
| ADR-008-3 | AI engine como **capa opcional** (timeout 500 ms) — no bloquea login | Aceptado |
| ADR-008-4 | `glassesEmaKey` — exención explícita, no bypass global | Aceptado |

## 8. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | Foto frontal clara → `{ok:true, quality_score>0.65}` | curl response |
| CA-2 | Foto sin rostro → `{ok:false, issues:["no_face_detected"]}` | curl response |
| CA-3 | Foto baja calidad → `{ok:false, issues:["low_quality"]}` | curl response |
| CA-4 | Token operador en `/api/biometric/status` → 403 | curl con rol operator |
| CA-5 | Dermalog unavailable + REQUIRED=false → legacy responde | test con mock |
| CA-6 | Login facial completo (check-identity + verify-frame → sesión) | flujo E2E |
| CA-7 | Doble clic avatar → HD self-only; clic exterior/Esc → cierre | Vitest + QA frontend |
| Perf | Latencia total verify-frame < 1 s (O6) | `time curl` |
