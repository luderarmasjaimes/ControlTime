# Changelog — Beemetry / AURIXA Plataforma Minera

Insumo para la decisión de release v0.1. No implica que el equipo ya haya
decidido cortar la versión — ver `RUNBOOK.md` para lo que falta antes de
GO-LIVE.

## [Unreleased] — 2026-07-03 a 2026-07-05

### Seguridad (crítico)
- **Corregidos 2 IDOR** en gestión de usuarios (`GET /api/auth/users`,
  `POST /api/auth/users/maintenance`, `GET /api/auth/users/maintenance/audit`):
  el tenant ya no se toma de parámetros controlados por el cliente, siempre
  de la sesión autenticada. Verificado con ataque cruzado real de 2 tenants.
- **Auditoría append-only con hash encadenado** (`platform_audit_log`):
  trigger que bloquea `UPDATE`/`DELETE` incluso para el rol propietario de la
  tabla, cadena de hash SHA-256 verificable vía `fn_audit_log_verify_chain()`.
- **Comando/inyección**: `shellQuote()` aplicado a los 4 puntos que invocaban
  `std::system()` con datos externos (surveillance, biometría, GDAL).
- **Headers de seguridad HTTP** (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`) aplicados a toda respuesta de la API y a los assets
  estáticos del frontend. CSP completo queda pendiente (requiere auditar
  orígenes externos ya en uso antes de aplicar una política estricta).

### Datos y rendimiento
- **`mineria_lecturas` convertida a hypertable TimescaleDB** (chunks de 7
  días, compresión >30 días) — migración con integridad verificada byte a
  byte contra un dump real de producción.
- **Lecturas de dashboards/KPIs enrutadas a la réplica read-only**
  (`aurixa-db-replica`), aislando el primario de la carga de lectura.
- **Memory safety**: los 11 archivos backend con acceso a Postgres migrados
  de `PGresult*` crudo + `PQclear()` manual a `storage::PgResult` (RAII) —
  elimina la clase de fuga de memoria en cualquier `return`/`throw` temprano
  entre `PQexec` y `PQclear`.

### Workflow e informes (ADR-015, 017, 018)
- **Máquina de estados canónica** (`draft → in_review → approved → signed →
  archived`, con `rejected → draft`) validada server-side en cada
  transición — antes el cliente podía enviar cualquier string sin
  validación. Migración de datos legacy (`published` → `archived`) +
  `CHECK` constraint en `reports.status`.
- **Firma documental** (ADR-018): el estado `signed` ahora registra quién
  firmó (nombre/cargo resueltos server-side, nunca confiados del cliente) y
  cuándo, en columnas nuevas de `reports` — antes solo se cambiaba el string
  de estado sin ningún registro de aprobación humana.
- **Comentario de transición** (p.ej. motivo de rechazo) ahora llega al
  servidor y queda en la auditoría con hash encadenado — antes solo vivía en
  el navegador del usuario.
- **Versionado autoritativo en servidor** (ADR-015): cada guardado
  confirmado (autosave o manual) genera una revisión real en
  `report_content_revision`; el historial de versiones en la UI ya no se
  pierde al recargar la página.
- **Export PDF server-side** (ADR-016): nuevo sidecar Chromium headless que
  reutiliza el mismo componente de solo-lectura que ve el usuario —
  fidelidad visual garantizada, sin motor de render duplicado.
- **Serialización de bloques cover/toc** en el modelo de documento (antes no
  se guardaban al persistir el informe).

### Frontend / UX
- Barra de menú retráctil aplicada a **todos los menús** (no solo Informe
  Técnico), maximizando el área de trabajo.
- Corregido parpadeo de cámara/video en el modal de captura de imágenes.
- Corregido bug de sincronización: `handleOpenEdit` ahora carga el estado de
  workflow y la firma real al reabrir un informe existente (antes mostraba
  el estado residual de la sesión previa).
- Corregido bug de timezone en el filtro de fecha de "Mis Informes": excluía
  silenciosamente los informes creados "hoy" para usuarios en timezone
  UTC-negativo (incluye Perú, la región de despliegue real).
- Vocabulario de estados unificado en `ReportsAdminModal` (antes mostraba
  "Borrador" para cualquier informe firmado o rechazado).
- `PageCanvas` memoizado (`React.memo`): evita re-renderizar todas las
  páginas del documento al editar una sola.

### Documentación de código
- Comentarios Doxygen (`@brief`) agregados a los headers de lógica de
  negocio (auth, KPIs, informes, sensores, cámaras, motor de fórmulas,
  pool de conexiones).

## Cómo verificar este changelog
Cada ítem de esta lista fue probado contra contenedores reales (`aurixa-db`,
`aurixa-api`, `aurixa-web`) — no solo compilado. Ver `GAP_ANALYSIS_2026-07-04.md`
para la evidencia detallada (queries, respuestas HTTP, capturas) de cada fix.
