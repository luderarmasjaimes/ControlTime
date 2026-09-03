# TASKS 007 — Editor de informes ReportStudio + exportación

| Campo | Valor |
|---|---|
| **Plan** | `specs/007-editor-informes-reportstudio/plan.md` |
| **Sprint·Release** | S5, S7 · R3-R4 |
| **Responsables** | BE1 (routes/service), BE3 (DBA), FE1 (editor), QA |
| **Última revisión** | 2026-06-24 (auditado contra `report_service.cpp` — T1-T10 confirmados ☑) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Schema SQL: `projects`, `reports` (con `company_name`, `content_json`, `deleted_at`) | CA-1,CA-4 | BE3 | Sonnet | ☑ |
| **T2** | Índice: `(company_name, created_at DESC) WHERE deleted_at IS NULL` | perf | BE3 | Haiku | ☑ |
| **T3** | `listReportsPg` — lista por empresa (usa company de sesión, no param URL) | CA-4 | BE1 | Sonnet | ☑ |
| **T4** | `getReportByIdPg` — verifica `company_name == sesión.company` | CA-4 | BE1 | Sonnet | ☑ |
| **T5** | `createReportPg` — INSERT con `company_name = sesión.company` | CA-4 | BE1 | Sonnet | ☑ |
| **T6** | `updateReportContentPg` — UPDATE `content_json + updated_at` (autosave) | CA-2 | BE1 | Sonnet | ☑ |
| **T7** | `deleteReportPg` — soft delete (`SET deleted_at = now()`) | CA-5 | BE1 | Haiku | ☑ |
| **T8** | `updateReportStatusPg` — cambio de estado (requiere rol ≥ manager) | CA-4 | BE1 | Sonnet | ☑ |
| **T9** | `GET /api/projects` + `POST /api/projects` | CA-1 | BE1 | Haiku | ☑ |
| **T10** | Route `report_routes.cpp`: todos los endpoints del plan §4 | CA-1..5 | BE1 | Sonnet | ☑ |
| **T11** | Export: `POST /api/reports/{id}/export` → PDF/DOCX stream | CA-3 | BE1 | **Opus** (proceso externo) | ☐ |
| **T12** | Frontend: rich-text editor (estructura `content_json`) | CA-1 | FE1 | Sonnet/ChatGPT | ☐ |
| **T13** | Frontend: autosave cada 3 s + indicador de estado | CA-2 | FE1 | Sonnet | ☐ |
| **T14** | **Test CA-2**: autosave `PATCH content` < 0.5 s (O2) | CA-2 | QA | — | ☑ |
| **T15** | **Test CA-3**: export PDF < 5 s para informe 50 páginas (O3) | CA-3 | QA | — | ☐ |
| **T16** | **Test CA-4**: empresa A no ve informes de empresa B | CA-4 | QA | — | ☑ |
| **T17** | **Test CA-5**: soft delete → no aparece en lista, persiste en BD | CA-5 | QA | — | ☑ |
| **T18** | **Test CA-6**: status change sin rol → 403 | CA-6 | QA | — | ☑ |

## Secuencia

```
T1 ─► T2                      (schema + índice)
T3 ─► T4 ─► T5 ─► T6 ─► T7 ─► T8   (service layer)
T9 ─► T10                    (projects + routing)
(T1-T10) ─► T14 ─► T16 ─► T17 ─► T18   (tests)
T11 ─► T15 (export, puede ir en paralelo con tests de CRUD)
T12 ─► T13 (frontend, post-backend)
```

## Definition of Done

- [x] T1-T10 completadas (CRUD funcional, aislamiento multitenant).
- [x] CA-2 (autosave < 0.5 s), CA-4 (aislamiento), CA-5 (soft delete), CA-6 (RBAC status).
- [ ] CA-3 (export PDF) — **T11 + T15 pendientes**
- [x] Frontend (T12, T13) — verificado: T12 editor rich-text con `@tiptap/react`/`@tiptap/starter-kit` sobre `content_json` (ADR-010, ADR-013, `frontend/src/components/ReportStudioV2`); T13 autosave activo en `lib/autosaveEngine.ts` (intervalo real 5s + retry, ADR-023, no 3s como decía la tarea original — divergencia documentada, no bloqueante).
- [x] ADR-007-1..4 registrados.

## Métricas

| KPI | Meta | Estado |
|---|---|---|
| O2 Autosave | < 0.5 s | ☑ UPDATE por PK (~5ms) |
| O3 Export | < 5 s | ☐ pendiente T11 |
| Aislamiento | 0 rows cross-tenant | ☑ `company_name` en WHERE siempre |
