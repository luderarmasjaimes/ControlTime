# TASKS 008 — Biometría facial para login de operación

| Campo | Valor |
|---|---|
| **Plan** | `specs/008-biometria-facial-login/plan.md` |
| **Sprint·Release** | S6, S11 · R3, R5 |
| **Responsables** | BE1 (routes/C++), ML (OpenCV/DNN), SYS (Dermalog), QA |
| **Última revisión** | 2026-07-27 (avatar local HD, ADR-074) |

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
| **T17** | Liveness detection (anti-spoofing, foto vs cara real) | S11/seguridad | ML | **Opus** | ☐ |
| **T18** | Avatar local MediaPipe/OpenCV + fallback ONNX, miniatura y maestro 4K privado | perfil | ML/BE1 | **Opus** | ☑ |
| **T19** | Endpoint self-only + modal doble clic/cierre exterior + pruebas | perfil/seguridad | BE1/FE1/QA | **Opus** | ☑ |

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
- [ ] T16-T17 (Dermalog real + liveness) — **Sprint S11 pendientes**.
- [x] ADR-008-1..4 registrados.

## Métricas

| KPI | Meta | Estado |
|---|---|---|
| O6 Latencia IA | < 1 s | ☑ OpenCV < 300 ms; ai_engine timeout 500 ms |
| Privacidad | 0 capturas faciales crudas persistidas | ☑ solo plantilla/metadata + avatar estilizado derivado (ADR-074) |
| Fallback | < 1 s con legacy | ☑ |
