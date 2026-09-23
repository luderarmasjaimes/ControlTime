# TASKS 014 — Modo offline con reconciliación

| Campo | Valor |
|---|---|
| **Plan** | `specs/014-modo-offline-reconciliacion/plan.md` (arquitectura planificada — ver nota de divergencia abajo, no coincide con lo realmente construido) |
| **Sprint·Release** | S8 · R4 (planificado) — la implementación real ocurrió antes, en S3-S4/R2 (2026-07-13, ver ADR-022/045) |
| **Responsables** | BE1 (API sync), BE3 (modelo/DB), FE1 (outbox/SW), FE2 (UX offline), QA |
| **Última revisión** | 2026-09-13 — CA-2/CA-3 cerrados (equivalencia de concurrencia optimista documentada, bug real de trazabilidad de conflictos corregido, ver act. ADR-022) y cobertura de test automatizado cerrada (13 tests nuevos, motor sql.js/WASM real + mock fiel de Cache API, `offlineSqlite.integration.test.ts`). Anterior: 2026-09-12 — corregido tras hallazgo de auditoría: este `tasks.md` seguía en "0/10, todo ☐" desde 2026-06-24 pese a que ADR-022 declara el modo offline **implementado y verificado end-to-end desde el 2026-07-13**. Anterior: 2026-06-24 (plan y tasks revisados — todo ☐ pendiente, Sprint S8). |

## ⚠️ Nota de arquitectura real (2026-09-12)

El `plan.md` de este SPEC y la tabla de tareas de abajo describen una
arquitectura de **cola de operaciones genérica** (tabla `sync_operations`,
endpoint `POST /api/sync`, `OutboxStore` en IndexedDB, `SyncEngine` con
Service Worker + Background Sync, feature flag `OFFLINE_SYNC_ENABLED`).
**Verificado por grep en todo el repo: ninguna de esas piezas existe** —
`sync_operations`, `OutboxStore`, `SyncEngine`, `OFFLINE_SYNC_ENABLED` dan
cero resultados fuera de este `tasks.md`/`plan.md`.

Lo que sí se construyó y verificó, por un camino distinto (ADR-022, cierre
2026-07-13; ADR-045, mismo día; ADR-127, aislamiento por usuario 2026-09-11),
es **edición offline de Informes Técnicos en ReportStudioV2** con SQLite
compilado a WASM (`sql.js`, no IndexedDB) y **concurrencia optimista por
versión** (`expected_version` + `409 version_conflict`, no una cola de
operaciones con `op_id`). Cumple el objetivo de negocio (0% pérdida,
conflicto siempre visible y resoluble, nunca last-write-wins silencioso) para
el caso de uso real de la plataforma (un informe, un editor por sesión) sin
construir la arquitectura genérica multi-dominio que este `plan.md`
imaginaba. No se reescribe el `plan.md` original (norma del proyecto); se
documenta la divergencia acá y en el `spec.md`.

**Alcance real vs. spec.md**: el spec dice "editar informes, **registrar
datos**" (plural) — lo implementado cubre solo la edición de Informes
Técnicos. Registro de datos de campo más general (formularios, evidencias
fotográficas) es hoy alcance de SPEC-022 (Operaciones de Campo, proyecto
derivado, 0/14, ADR-110).

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Migración SQL: `sync_operations` + columna `version` en tablas de negocio | CA-2,CA-3 | BE3 | Sonnet/Haiku | ☐ *(no construido — ver nota de arquitectura; `report_content_revision`/`version_number` ya existían desde ADR-015/021, anteriores a este SPEC)* |
| **T2** | Endpoint `POST /api/sync` — recepción de lote, validación, auth+tenant de sesión | CA-1,CA-4 | BE1 | **Opus** (concurrencia/TX) | ☐ *(no construido; equivalente funcional real: `PUT /api/reports/{id}` con `expected_version`)* |
| **T3** | Idempotencia: dedup por `op_id` (insert-or-skip en `sync_operations`) | CA-2 | BE1 | **Opus** | ☐ *(no aplica al modelo real — snapshot versionado por informe, no cola de operaciones con id)* |
| **T4** | Aplicación atómica por operación (TX individual) + incremento de `version` | CA-2 | BE1 | **Opus** | ☑ *(equivalente real: `updateReportPg` en TX con `SELECT ... FOR UPDATE`, compara e incrementa `version_number`)* |
| **T5** | Resolución de conflicto por entidad (server-wins+rama / append / rechazo) | CA-3 | BE1+BE3 | **Opus** | ☑ *(real: 409 → elegir versión servidor / seguir offline / guardar como informe nuevo — `App.tsx`, verificado en vivo)* |
| **T6** | Auditoría de cada sync y resolución (`result`,`resolution`) | CA-3,Art.6 | BE1 | Sonnet | ☐ *(solo fila genérica en `report_content_revision`, igual que cualquier guardado — no hay registro que etiquete "esto fue una resolución de conflicto offline")* |
| **T7** | Cliente `OutboxStore` (IndexedDB): encolar/persistir operaciones | CA-1 | FE1 | Sonnet | ☐ *(no construido — se usa SQLite/sql.js + Cache API en su lugar, ver `offlineSqlite.ts`)* |
| **T8** | Cliente `SyncEngine` (Service Worker + Background Sync + fallback online) | CA-1 | FE1 | Sonnet/Opus | ☐ *(no construido — la reconciliación se dispara desde un efecto de React sobre `connectivity.state`, no Background Sync de Service Worker)* |
| **T9** | Backoff exponencial + jitter + tope de reintentos (sin descartar) | CA-2 | FE1 | Sonnet | ☐ *(no construido — un fallo de sync al reconectar cae al siguiente autoguardado/checkpoint de 3 min, sin backoff dedicado)* |
| **T10** | UX offline: indicador de estado, cola pendiente, resolución de conflicto al usuario | CA-1,CA-3 | FE2 | Sonnet/ChatGPT | ☑ *(real: banner "FUERA DE LÍNEA desde...", banner "informe en modo OFFLINE", sección "Documentos sin conexión" en `ReportsAdminModal.tsx`, diálogos de conflicto)* |
| **T11** | Feature flag `OFFLINE_SYNC_ENABLED` + versionado del Service Worker | despliegue | FE1/SYS | Haiku | ☐ *(no construido — el modo offline es automático según conectividad detectada, sin flag propio)* |
| **T12** | Retención de `sync_operations` (archivar a frío 003 > 90 días) | Art.9 | BE3 | Haiku | ☐ *(no aplica — no existe tal tabla en el modelo real)* |
| **T13** | **Pruebas** de cada CA (ver plan §9), incl. edge cases | todas | QA | Sonnet | ☐ *(sin automatizar — solo `isLocalDraftId` tiene test unitario; el resto depende de sql.js/WASM + Cache API, no montados en el entorno de test, declarado en el propio `offlineSqlite.test.ts`)* |
| **T14** | Demo gate R4: editar sin internet → reconectar → sync sin pérdida | CA-5 | QA+ARQ | — | ☑ *(verificado end-to-end 2026-07-13 contra backend real vía curl y navegador real con "otra terminal" simulando edición concurrente — ADR-022; re-verificado manualmente 2026-09-12 con varios tipos de documento)* |
| **T15** | Manual operativo: cómo opera el modo offline + runbook de soporte | Art.8 | PAF | ChatGPT/Haiku | ☐ *(no existe — `RUNBOOK.md` no menciona el modo offline)* |

## Secuencia recomendada (dependencias)
```
T1 ─► T2 ─► T3 ─► T4 ─► T5 ─► T6        (servidor: base → idempotencia → conflicto → auditoría)
T1 ─► T7 ─► T8 ─► T9 ─► T10             (cliente: outbox → sync → UX)
(T2..T10) ─► T13 (pruebas) ─► T14 (demo R4)
T11, T12, T15 en paralelo
```
*(secuencia original del `plan.md`; el camino real construido no siguió T1/T2/T3/T7/T8/T9/T11/T12 — llegó a T4/T5/T10/T14 por la ruta de ADR-022/045/127, ver nota de arquitectura arriba)*

## Definition of Done

- [x] CA-1: edición offline con persistencia local durable — verificado en código y end-to-end (ADR-045/ADR-022, SQLite/sql.js vía Cache API). Alcance real: edición de Informes Técnicos en ReportStudioV2, no "registrar datos" de campo en general (ver nota de alcance arriba).
- [x] CA-2: sin pérdida y sin duplicar — cerrado 2026-09-13 (ver Actualización de ADR-022): el modelo real es un snapshot versionado por informe con concurrencia optimista (`expected_version`/`409`), no una cola de operaciones con idempotencia por `op_id` como pide la letra del criterio — pero analizado el mecanismo real, un reintento del mismo guardado con el mismo `expected_version` no puede aplicarse dos veces (el primero ya incrementó `version_number` dentro del `SELECT...FOR UPDATE`, el reintento ve versión desactualizada y recibe 409 en vez de duplicar). Satisface la intención real del criterio por un mecanismo equivalente, documentado como tal — no se reescribe el criterio original.
- [x] CA-3: conflicto con política explícita y visible (409 → elegir versión del servidor / seguir offline / guardar como informe nuevo), verificado en código y en vivo — **bug/gap real corregido 2026-09-13**: antes generaba la misma fila genérica de `report_content_revision` que cualquier guardado normal, indistinguible en el historial; ahora `updateReportPg`/`createReportPg` etiquetan la revisión con `offline_conflict_overwrite`/`offline_conflict_kept_as_new` cuando el guardado resuelve un conflicto, visible en el historial de versiones del frontend (`summaryLabels`). Cierra la trazabilidad de Art. 6 que faltaba. Verificado: build real (CTest 1/1), deploy real, `tsc --noEmit` limpio, 444/444 tests frontend sin regresión — ver Actualización de ADR-022 para el detalle completo.
- [x] CA-4: aislamiento multitenant — caché offline aislada por usuario+tenant (ADR-127) sobre los mismos endpoints autenticados por sesión/tenant.
- [x] CA-5: demo de gate R4 — verificada end-to-end contra backend real y navegador real el 2026-07-13 (ADR-022, incluye simulación de edición concurrente desde "otra terminal"), y re-verificada manualmente el 2026-09-12 con varios tipos de documento (sin test automatizado que lo respalde, ver siguiente punto).
- [x] Cobertura de test automatizado — **cerrado 2026-09-13**: `offlineSqlite.integration.test.ts` (nuevo, 13 tests) cubre el flujo real de punta a punta — round-trip de `saveOfflineSnapshot`/`loadOfflineSnapshot`, upsert sin duplicar, la regla de negocio de `base_version_number` preservado mientras la fila siga `dirty` (ADR-022), `markOfflineSnapshotSynced`, eventos de conectividad (`recordWentOffline`/`recordCameOnline`), `findOrphanedLocalDrafts` (orden y filtro), `deleteOfflineSnapshot`, migración de esquema real (`ensureSchemaUpgraded` agregando `base_version_number` a una plantilla vieja), persistencia real entre "sesiones" (reimportar el módulo con la misma caché), aislamiento por usuario+tenant (ADR-127), y las 2 ramas de `purgeOfflineCacheOnLogout` (preserva si hay `dirty`, purga si no — la regla dura de 0% pérdida). No se mockeó el motor SQLite: se usa el WASM real de `sql.js` (`node_modules/sql.js/dist/sql-wasm.wasm`, resuelto vía Node en vez de la ruta HTTP que usa el navegador) contra SQL real; solo se mockeó la Cache API (inexistente en jsdom) con una implementación fiel a la semántica real (bytes materializados por entrada, `Response` nuevo en cada `match()` — el cuerpo de `Response` es de un solo uso, igual que en un navegador real). Suite completa: 457/457, sin regresión.
- [ ] La arquitectura planificada en `plan.md` (tabla `sync_operations`, endpoint `POST /api/sync`, `OutboxStore`/`SyncEngine` con Service Worker Background Sync, feature flag `OFFLINE_SYNC_ENABLED`) nunca se construyó — se resolvió por un camino distinto y ya verificado (SQLite + concurrencia optimista, ADR-022/045/127). `plan.md` no se reescribe (norma del proyecto); la divergencia queda documentada acá.
- [ ] Alcance real vs. `spec.md`: el spec dice "editar informes, registrar datos" (plural); lo implementado cubre solo Informes Técnicos de ReportStudioV2. Registro de datos de campo más amplio queda en SPEC-022 (Operaciones de Campo, proyecto derivado, 0/14).
- [x] ADR-022/045/127 registrados, con verificación end-to-end documentada (2026-07-13 y 2026-09-11/12).

## Estimación gruesa

*(estimación original del plan, referida a la arquitectura no construida — se conserva sin cambios por trazabilidad histórica, no refleja el esfuerzo real de la ruta ADR-022/045/127 que sí se construyó)*

| Bloque | Esfuerzo aprox. |
|---|---|
| Servidor (T1-T6) | 5-7 d (BE1+BE3) |
| Cliente (T7-T11) | 5-7 d (FE1+FE2) |
| Pruebas + demo (T13-T14) | 3 d (QA+ARQ) |
| Docs (T15) | 1 d (PAF) |
