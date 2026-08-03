# TASKS 017 — Visión IA: detección de EPP

| Campo | Valor |
|---|---|
| **Plan** | `specs/017-vision-epp-seguridad/plan.md` |
| **Sprint·Release** | S11 · R5 |
| **Responsables** | ML (modelo/ONNX), BE1 (routes/pipeline), BE3 (DBA), FE1 (panel), QA |
| **Última revisión** | 2026-06-24 (plan y tasks revisados — todo ☐ pendiente, Sprint S11) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Exportar YOLOv8n a ONNX (opset 17) con clases EPP | CA-1,CA-2 | ML | **Opus** (ML) | ☐ |
| **T2** | `vision_pipeline.cpp`: InferenceSession ONNX + pre/post-processing | CA-1,CA-5 | BE1 | **Opus** (ONNX API) | ☐ |
| **T3** | NMS (Non-Max Suppression) sobre output YOLO | CA-1,CA-2 | ML | **Opus** | ☐ |
| **T4** | Clasificación EPP: presentes / violaciones[] desde detections | CA-1,CA-2 | BE1 | Sonnet | ☐ |
| **T5** | Schema SQL: `epp_violations` (tenant_id, camera_id, ts, violations, frame_ref) | CA-3,CA-4 | BE3 | Sonnet | ☐ |
| **T6** | `POST /api/vision/epp-check` — endpoint principal | CA-1,CA-2 | BE1 | Sonnet | ☐ |
| **T7** | `GET /api/vision/epp-violations` — historial paginado (tenant scoped) | CA-4 | BE1 | Sonnet | ☐ |
| **T8** | `POST /api/vision/epp-violations/{id}/dismiss` — descartar (auditable) | CA-4 | BE1 | Sonnet | ☐ |
| **T9** | `GET /api/vision/model-status` — solo admin | CA-1 | BE1 | Haiku | ☐ |
| **T10** | Alerta SSE cuando violación detectada (reutilizar canal spec 016) | CA-3 | BE1 | Sonnet | ☐ |
| **T11** | Job periódico: snapshot CCTV → epp-check (integración 013+017) | CA-6 | BE1 | **Opus** | ☐ |
| **T12** | Almacenamiento frames en MinIO (opt-in, `EPP_STORE_FRAMES=true`) | ADR-017-3 | BE1 | Sonnet | ☐ |
| **T13** | Config: `EPP_CONFIDENCE_THRESHOLD`, `EPP_STORE_FRAMES`, `EPP_MODEL_PATH` | despliegue | SYS | Haiku | ☐ |
| **T14** | Frontend: panel EPP (cámaras con status, violaciones recientes, badges) | CA-3,CA-4 | FE1 | Sonnet | ☐ |
| **T15** | **Test CA-1**: foto con casco → has_helmet:true | CA-1 | QA | — | ☐ |
| **T16** | **Test CA-2**: foto sin casco → violation no_helmet | CA-2 | QA | — | ☐ |
| **T17** | **Test CA-3**: violación → alerta SSE en < 2 s | CA-3 | QA | — | ☐ |
| **T18** | **Test CA-4**: aislamiento multitenant violaciones | CA-4 | QA | — | ☐ |
| **T19** | **Test CA-5**: latencia < 200 ms en CPU | CA-5 | QA | — | ☐ |
| **T20** | Fine-tuning con imágenes de la mina (dataset propio) | precisión | ML | **Opus** | ☐ |

## Secuencia

```
T1 ─► T2 ─► T3 ─► T4            (pipeline ML → C++)
T5 ─► T6 ─► T7 ─► T8 ─► T9     (BD + endpoints)
T10 (depende de spec 016 T7)
T11 (depende de spec 013 + T6)
T12, T13 (paralelo)
(T1-T13) ─► T15-T19 (tests)
T14 (frontend, post-backend)
T20 (S11 final, ML work)
```

## Definition of Done

- [ ] T1-T13, T15-T19 completadas.
- [ ] CA-1..6 demostrados con evidencia.
- [ ] ADR-017-1..4 registrados.
- [ ] Sin violar Constitución (Art. 7: IA 100% local, Art. 6: privacidad).
- [ ] Gate R5: demo EPP en cámara real en mina piloto.

## Dependencias externas

| Dependencia | De | Descripción |
|---|---|---|
| Canal SSE de alertas | spec 016 T7 | reutilizar `AlertChannel` para alertas EPP |
| Snapshots CCTV | spec 013 T4 | `handleGetSnapshot` → input para epp-check |
| MinIO | spec 003 T1 | bucket `epp-frames` (opt-in) |
