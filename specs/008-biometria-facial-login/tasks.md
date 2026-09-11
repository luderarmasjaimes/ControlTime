# TASKS 008 — Biometría facial para login de operación

| Campo | Valor |
|---|---|
| **Plan** | `specs/008-biometria-facial-login/plan.md` |
| **Sprint·Release** | S6, S11 · R3, R5 |
| **Responsables** | BE1 (routes/C++), ML (OpenCV/DNN), SYS (Dermalog), QA |
| **Última revisión** | 2026-09-03 (avatar por difusión local aislado, ADR-141) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | `face_analysis.cpp`: OpenCV cascade / DNN — detectar rostro, quality_score, issues[] | CA-1,CA-2,CA-3 | ML/BE1 | **Opus** (CV/DNN) | ☑ |
| **T2** | `ai_engine_client.cpp`: cliente HTTP → ai_engine (timeout `AI_ENGINE_TIMEOUT_MS`) | CA-1 | BE1 | Sonnet | ☑ |
| **T3** | `biometric_routes.cpp`: `POST /api/biometric/verify-frame` (base64 → análisis) | CA-1..3 | BE1 | Sonnet | ☑ |
| **T4** | `POST /api/process_frame` (raw bytes → cv::Mat → análisis CCTV/EPP) | CA-1 | BE1 | Sonnet | ☑ |
| **T5** | `GET /api/biometric/status` — solo admin (proveedor activo + estado DNN) | CA-4 | BE1 | Haiku | ☑ |
| **T6** | Config: `BIOMETRIC_PROVIDER`, `DERMALOG_REQUIRED`, `FACE_QUALITY_THRESHOLD` | despliegue | BE1 | Haiku | ☑ |
| **T7** | `glassesEmaKey` — exención por clave de operador (gafas de seguridad) | CA-1 | BE1 | Sonnet | ☑ |
| **T8** | Fallback Legacy si Dermalog falla + `DERMALOG_REQUIRED=false` | CA-5 | BE1 | Sonnet | ☑ |
| **T9** | Integración con auth 006: `POST /api/auth/login/face` → verify → emit token | CA-6 | BE1 | **Opus** | ☑ |
| **T10** | **Test CA-1**: foto frontal clara → `{ok:true, quality_score>0.65}` | CA-1 | QA | — | ☑ |
| **T11** | **Test CA-2**: foto sin rostro → `{ok:false, issues:["no_face_detected"]}` | CA-2 | QA | — | ☑ |
| **T12** | **Test CA-3**: foto baja calidad → `{ok:false, issues:["low_quality"]}` | CA-3 | QA | — | ☑ |
| **T13** | **Test CA-4**: token operador en status → 403 | CA-4 | QA | — | ☑ |
| **T14** | **Test CA-5**: Dermalog unavailable + REQUIRED=false → legacy responde | CA-5 | QA | — | ☑ |
| **T15** | **Test perf**: latencia verify-frame < 1 s (O6) con OpenCV | perf | QA | — | ☑ |
| **T16** | Certificación Dermalog hardware (S11) — integración real con SDK | CA-6/S11 | SYS+ML | **Opus** | ☐ |
| **T17** | Liveness detection (anti-spoofing, foto vs cara real) | S11/seguridad | ML | **Opus** | ☑ |
| **T18** | Avatar local MediaPipe/OpenCV + fallback ONNX, miniatura y maestro 4K privado | perfil | ML/BE1 | **Opus** | ☑ |
| **T19** | Endpoint self-only + modal doble clic/cierre exterior + pruebas | perfil/seguridad | BE1/FE1/QA | **Opus** | ☑ |
| **T20** | Avatar por difusión local (SD1.5+ControlNet), servicio `avatar_engine` aislado de TensorFlow, concurrencia=1, GPU obligatoria+timeout, preload antes de readiness, FP16+safetensors+revisión fijada, logs/estado explícito | CA-11..CA-15 | ML/BE1 | **Opus** | ☑ `avatar_engine` construido/probado real en GPU; integración `ai_engine→avatar_engine` verificada de punta a punta. El bloqueante de cuDNN que impedía reconstruir la imagen OFICIAL de `ai_engine` quedó resuelto por T21/ADR-143. CA-15(a) completado 2026-09-03 (ADR-141 v4): 12/12 retratos sin colapso tras corregir falso positivo en `_is_oval_matte_black_background()` |
| **T21** | Silent-Face-Anti-Spoofing (PyTorch) movido a servicio propio `silentface_engine`, aislado de TensorFlow — resuelve de raíz el bloqueante de cuDNN que bloqueaba el build oficial de `ai_engine` (ADR-143) | CA-16..CA-18 | ML/BE1 | **Opus** | ☑ CA-16/17/18 completos; build oficial sin conflicto, fail-closed y carga concurrente 10/20/50 verificados. `beemetry-ai-vision` recreado el 2026-09-03 con la imagen oficial nueva y conexión saludable al sidecar SilentFace. |

## Secuencia

```
T1 ─► T2 ─► T3 ─► T4         (pipeline completo)
T5, T6, T7, T8 (paralelo)
T9 (integración con 006)
(T1-T9) ─► T10-T15 (tests)
T16, T17 (Etapa 2/S11)
```

## Definition of Done

- [x] T1-T15 completadas (pipeline biométrico funcional).
- [x] CA-1..5 demostrados; CA-6 (login E2E) verificado con spec 006.
- [x] T18-T19 completadas y backend recompilado (avatar local HD, ADR-074).
- [x] T17 liveness activo por desafío-respuesta (ISO/IEC 30107-3, ADR-126) — verificado 2026-08-30: `implemented y activo`, reactivado y recalibrado 2026-08-21 (2 de 4 desafíos por sesión, ventana 8s/4 intentos).
- [ ] T16 (Dermalog hardware real + certificación) — **Sprint S11 pendiente**: la integración CLI existe (ADR-089), pero la certificación con hardware físico no.
- [x] ADR-008-1..4 registrados.
- [x] T20 (avatar por difusión local, ADR-141) — código e infraestructura
  completos (CA-11..CA-15) y activados en el entorno operativo mediante
  `AVATAR_STYLE_ENGINE=diffusion`.
  Verificado en runtime real 2026-09-03: `avatar_engine` construido y
  corriendo en GPU (RTX 5060), integración HTTP con `ai_engine` confirmada
  de punta a punta (respuesta `generator:"local_sd15_controlnet"`,
  contadores incrementados en ambos servicios). La imagen oficial de
  `ai_engine` se reconstruyó correctamente tras separar SilentFace (T21) y
  fue desplegada en `beemetry-ai-vision`. **CA-15(a) completado
  2026-09-03** con 12 retratos oficiales de dominio público (sustituto de
  fotos de registro reales por disponibilidad de consentimiento): 2/12
  colapsaban (cabeza flotante/rasgos derretidos); causa raíz real fue un
  falso positivo en `_is_oval_matte_black_background()` (fondo oscuro real
  confundido con el óvalo-sobre-negro del cliente, no el artefacto de la
  imagen sintética que se sospechaba antes), corregido — 12/12 sin colapso
  tras el fix; evidencia fresca en
  `artifacts/avatar_ca15_verified_20260903/`. Detalle completo en ADR-141
  v4/v5. Queda una limitación conocida
  no bloqueante (deriva de género/tono de piel bajo difusión) a monitorear
  en producción.

## Métricas

| KPI | Meta | Estado |
|---|---|---|
| O6 Latencia IA | < 1 s | ☑ OpenCV < 300 ms; ai_engine timeout 500 ms |
| Privacidad | 0 capturas faciales crudas persistidas | ☑ solo plantilla/metadata + avatar estilizado derivado (ADR-074) |
| Fallback | < 1 s con legacy | ☑ |
