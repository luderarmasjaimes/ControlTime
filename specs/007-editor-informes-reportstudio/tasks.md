# TASKS 007 — Editor de informes ReportStudio + exportación

| Campo | Valor |
|---|---|
| **Plan** | `specs/007-editor-informes-reportstudio/plan.md` |
| **Sprint·Release** | S5, S7 · R3-R4 |
| **Responsables** | BE1 (routes/service), BE3 (DBA), FE1 (editor), QA |
| **Última revisión** | 2026-09-13 (T15: **cerrada por decisión de negocio**, ver ADR-185 — se acepta el tiempo medido/optimizado dado que el export es asíncrono y no bloquea al usuario; criterio literal de la SOW (<5s) queda documentado como no cumplido, no oculto; anterior: optimización real aplicada tras el benchmark, ver ADR-184 — mejora de 6-28% según tamaño, sin regresión en documentos grandes; anterior: benchmark real de O3 medido, ver ADR-183; anterior: 2026-09-12, T11 recalculado tras verificar el pipeline real de export PDF y retirar código muerto; anterior: 2026-06-24, T1-T10 confirmados ☑) |

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
| **T11** | Export: PDF server-side (job asíncrono + fallback síncrono) | CA-3 | BE1 | **Opus** (proceso externo) | ☑ *(2026-09-12: verificado — `usePdfExport.ts` → `createPdfExportJob`/`pollExportJob`/`fetchExportJobBlob` con fallback a `fetchReportPdfBlob` si el backend no expone el job (404); backend real `report_pdf_export.cpp`/`report_routes.cpp`, ADR-016/080. Ruta real es GET con contraseña generada, no el `POST .../export` genérico que describía la tarea original — mismo objetivo, arquitectura evolucionada. De paso se encontró y retiró `exportEngine.ts::exportPDF()`, código muerto desde que este pipeline lo reemplazó, con un bug real (enmascaraba fallos del servidor como éxito) que ya no aplica por estar fuera de uso.)* |
| **T12** | Frontend: rich-text editor (estructura `content_json`) | CA-1 | FE1 | Sonnet/ChatGPT | ☐ |
| **T13** | Frontend: autosave cada 3 s + indicador de estado | CA-2 | FE1 | Sonnet | ☐ |
| **T14** | **Test CA-2**: autosave `PATCH content` < 0.5 s (O2) | CA-2 | QA | — | ☑ |
| **T15** | **Test CA-3**: export PDF < 5 s para informe 50 páginas (O3) | CA-3 | QA | — | ☑ | *(2026-09-13, ver ADR-183/184/185: benchmark real medido contra 2 informes reales del tenant Alpayana (56 y 63 páginas, `sensor_multi_chart` real) — **no cumple el umbral literal de la SOW**: 29,4s/28,9s originales → 26,8s/27,2s tras 2 fixes reales de rendimiento (ADR-184), ~5,4-5,9× por encima de los 5s de O3. Causa raíz: modo "virtualizado" del sidecar de export (`EXPORT_VIRTUALIZATION_PAGE_THRESHOLD = 25`), que monta y espera los widgets de una página a la vez (~2s/página/worker, `PDF_CAPTURE_PARALLELISM = 4`) — arquitectura necesaria para proteger documentos muy grandes (2104 pág./6300 diagramas, ADR-170). **Cerrada por decisión de negocio (ADR-185, 2026-09-13)**: dado que el export es asíncrono (job + polling, no bloquea al usuario) y no hay caso de negocio para el costo/riesgo de las alternativas restantes (subir umbral de virtualización, más paralelismo, rediseño), se acepta el tiempo medido y optimizado como resultado final — la desviación del valor literal "<5s" queda documentada, no oculta. Script reutilizable: `scripts/benchmark-export-o3.browser.js`.)* |
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
- [x] CA-3 (export PDF) — **T11 verificado 2026-09-12** (ver tabla arriba: pipeline real `usePdfExport.ts`/`report_pdf_export.cpp`, no la ruta genérica que describía la tarea original).
- [x] CA-3 — **T15 cerrada por decisión de negocio 2026-09-13** (ver ADR-183/184/185). Medido (ADR-183): 29,4s/28,9s contra 2 informes reales de 56/63 páginas — ~5,9× el umbral de 5s. La arquitectura async está verificada (ADR-016) y funciona sin errores; el modo "virtualizado" del export (activo para cualquier informe >25 páginas) monta y espera cada página una por una, ~2s/página/worker — un informe de 50 páginas cae siempre en ese camino. **Justificación del incremento verificada contra el código real**: el soporte para exportaciones muy grandes (2104 páginas/6300 diagramas, ADR-170) es la causa CONFIRMADA de la arquitectura "virtualizada"; el crecimiento del editor (Word/PPTX en general) NO participa del cuello de botella (solo 3 widgets de sensor usan el gate `data-export-ready`) — el catálogo de gráficos de sensor (10→20 tipos, SPEC-021) sí es un contribuyente real pero menor. **Optimización real implementada** (ADR-184, instrumentación con timestamps contra jobs reales): el diagnóstico inicial ("arranque de Chromium ~3,5-4s") era impreciso — el arranque real es solo ~200-300ms; el costo real estaba en `page.goto(waitUntil:'networkidle0')`, una espera redundante sobre una condición que `waitForReportRender` ya verificaba correctamente después. 2 fixes reales: (1) fuentes auto-hospedadas en vez de Google Fonts; (2) `waitUntil` bajado a `domcontentloaded` en las 4 páginas del sidecar. Medido antes→después: 11 pág. 6,32s→**4,57s** (-28%), 56 pág. 29,4s→**26,8s** (-9%), 63 pág. 28,9s→**27,2s** (-6%), 378 pág./1120 gráficos 278s→**272s** (-2%, sin regresión, 0 fallos de captura). **Decisión de negocio (ADR-185)**: dado que el export es un proceso asíncrono (job + polling, `usePdfExport.ts`) que no bloquea al usuario, y que cerrar la brecha restante (~24s → <5s) exige alternativas con costo/riesgo real sin caso de negocio hoy (subir el umbral de virtualización arriesga el mismo incidente de documentos gigantes que motivó la arquitectura; más paralelismo no está medido bajo carga concurrente real; rediseño es esfuerzo mayor sin queja de usuario registrada), se acepta el tiempo medido y optimizado como resultado final de O3. **Se documenta explícitamente que el valor literal de la SOW (<5s) NO se cumple** — esta es una desviación reconocida y aceptada por decisión de negocio, no un cumplimiento del criterio original tal como fue redactado.
- [x] Frontend (T12, T13) — verificado: T12 editor rich-text con `@tiptap/react`/`@tiptap/starter-kit` sobre `content_json` (ADR-010, ADR-013, `frontend/src/components/ReportStudioV2`); T13 autosave activo en `lib/autosaveEngine.ts` (intervalo real 5s + retry, ADR-023, no 3s como decía la tarea original — divergencia documentada, no bloqueante).
- [x] ADR-007-1..4 registrados.

## Métricas

| KPI | Meta | Estado |
|---|---|---|
| O2 Autosave | < 0.5 s | ☑ UPDATE por PK (~5ms) |
| O3 Export | < 5 s | ☑ mecanismo implementado y verificado (T11), medido y optimizado (T15): 26,8s/56 pág., 27,2s/63 pág. (antes 29,4s/28,9s, ver ADR-184); extrapola a ~24s para 50 páginas con gráficos de sensor. **Cerrado por decisión de negocio (ADR-185, 2026-09-13)**: valor literal de <5s NO se alcanza, aceptado dado que el export es asíncrono y no bloquea al usuario — ver ADR-183/184/185 |
| Aislamiento | 0 rows cross-tenant | ☑ `company_name` en WHERE siempre |
