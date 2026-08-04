# 🔍 ANÁLISIS DETALLADO DE PENDIENTES — 2026-07-04

**Método**: cada ítem fue verificado con evidencia real (queries a `aurixa-db`/`aurixa-db-replica` en ejecución, greps al código, conteos), no de memoria de la sesión.

---

## ✅ RESUELTO — 2026-07-04

Los 2 IDOR de esta sección fueron corregidos, compilados (0 errores), **desplegados en
`aurixa-api`** y verificados con un ataque cruzado real de 2 tenants:

- Usuario `attacker_a` (tenant "Compania Minera Raura") vs `victim_b` (tenant "Alpayana").
- **Ataque #1** (`GET /api/auth/users?company=Alpayana`) → devolvió solo usuarios de
  Raura. Bloqueado.
- **Ataque #2** (`POST /api/auth/users/maintenance` intentando bloquear a `victim_b`
  con `company:"Alpayana"` en el body) → `HTTP 400 "no pertenece a la empresa"`;
  `victim_b` confirmado `active` en BD tras el intento. Bloqueado.
- **Ataque #3** (`GET .../maintenance/audit?company=Alpayana`) → devolvió el log del
  propio tenant del atacante (incluyendo el intento fallido #2, correctamente auditado
  como `success:false`), sin filtrar el log de Alpayana. Bloqueado.
- **Control positivo**: el atacante sigue viendo normalmente los datos de su propio
  tenant — el fix no rompió funcionalidad legítima.
- Datos de prueba (usuarios + entradas de auditoría) eliminados de `aurixa-db` tras la
  verificación.

**Fix aplicado en `backend/src/auth/auth_routes.cpp`**:
1. `GET /api/auth/users` — se eliminó el fallback a `?company=`; siempre usa `session->company`.
2. `POST /api/auth/users/maintenance` — se inyecta `session->company` en el payload
   (`payload["company"] = json::string(session->company);`) sobreescribiendo cualquier
   valor enviado por el cliente, antes de pasarlo a `executeUserMaintenancePg`.
3. `GET /api/auth/users/maintenance/audit` — mismo fix que #1.

Verificado que no queda ningún patrón similar sin resolver en el resto del backend
(los 4 casos restantes de `query.count("company"/"tenant_id")` son legítimos: 2 son
pre-login sin sesión en `check-identity`, 2 en `surveillance_service.cpp` ya priorizan
`session->tenantId` y solo caen al query como fallback cuando la sesión no lo trae).

---

## 🔴 CRÍTICO — Seguridad (histórico, ya resuelto arriba)

### 1. IDOR de ESCRITURA activo en `POST /api/auth/users/maintenance`
**Archivo**: `backend/src/auth/auth_storage_pg.cpp:792` (`executeUserMaintenancePg`)

```cpp
const std::string company = json::value_to<std::string>(payload.at("company"));
```

El `company` viene **del body JSON enviado por el cliente**, sin comparar nunca contra `session->company`. El handler en `auth_routes.cpp:245` solo valida que haya sesión (`resolveAuthSession`), pero no que el `company` del payload coincida con el tenant de esa sesión.

**Impacto real**: un usuario autenticado en el tenant A puede enviar `{"company": "tenant_B", "action": "block", "targetUsername": "admin_de_B", ...}` y bloquear, resetear contraseña, cambiar rol o dar de baja usuarios de **otro tenant**. Es la acción más sensible del sistema (gestión de usuarios) sin tenant-check.

**Fix necesario**: en el handler (`auth_routes.cpp:245-275`), inyectar `session->company` en el payload antes de llamarlo (o pasar `session->company` como parámetro separado y que `executeUserMaintenancePg` lo use en vez de leerlo del JSON del cliente).

### 2. IDOR de LECTURA en `GET /api/auth/users`
**Archivo**: `backend/src/auth/auth_routes.cpp:232`

```cpp
std::string company = query.count("company") ? query.at("company") : session->company;
```

El query param `?company=` tiene prioridad sobre la sesión. Cualquier usuario autenticado puede listar los usuarios de **cualquier otra empresa** con `GET /api/auth/users?company=OtraMinera`.

**Mismo patrón en**: `auth_routes.cpp:286` (`GET /api/auth/users/maintenance/audit` — expone el log de auditoría de otro tenant).

**Fix necesario**: eliminar el fallback a query param en endpoints ya autenticados; usar siempre `session->company`. (El patrón en `check-identity`, líneas 139/188, SÍ es legítimo porque es pre-login, sin sesión.)

### 3. Auditoría NO es append-only ni tiene integridad forense — ✅ RESUELTO 2026-07-04

**Archivo nuevo**: `db_scripts/31_audit_log_append_only_hash_chain.sql` (+ backfill
controlado ejecutado una vez para las 3 filas históricas preexistentes).

**Diseño** (validado antes de tocar `aurixa-db`, primero en contenedor desechable):
un simple `REVOKE UPDATE/DELETE` **no habría servido**: `sensors` es tanto el rol de
conexión del backend como el **owner** de la tabla, y en PostgreSQL el owner ignora los
GRANT/REVOKE sobre sus propias tablas. Se implementó en su lugar:
- Trigger `BEFORE UPDATE OR DELETE` que rechaza incondicionalmente la operación
  (`RAISE EXCEPTION`), efectivo incluso para el owner. `REVOKE` se dejó como higiene
  adicional para roles futuros no-owner.
- Trigger `BEFORE INSERT` que calcula `prev_hash`/`row_hash` (SHA-256 vía `pgcrypto`)
  automáticamente, sin tocar código — aplica a los 4 puntos de inserción existentes
  (`fn_platform_audit_insert()` y los 3 triggers de auditoría en `reports`,
  `auth_users`, `formula_sessions`).
- Función `fn_audit_log_verify_chain()`: recalcula cada hash desde los datos actuales
  y lo compara contra el guardado, para detectar manipulación.

**Pruebas ejecutadas** (contenedor desechable primero, luego producción real):
1. Inserción normal → hash calculado y encadenado ✓.
2. `UPDATE`/`DELETE` directos → ambos rechazados, incluso como el rol owner ✓.
3. **Ataque simulado**: deshabilité el trigger, alteré una fila, lo re-habilité →
   `fn_audit_log_verify_chain()` detectó exactamente esa fila como manipulada, sin
   falsos positivos en las demás ✓.
4. Los 3 triggers automáticos (probado con `reports`) siguen insertando sin cambios de
   código, y encadenan correctamente con el nuevo trigger de hash ✓.
5. **Backfill** de las 3 filas históricas preexistentes — probado en contenedor
   desechable, luego aplicado a `aurixa-db` real. Cadena resultante 100% íntegra ✓.
6. **E2E en producción real** (no simulado): registro de usuario real → creación de
   informe real vía API → `DELETE` del informe vía API → las nuevas filas de auditoría
   encadenan correctamente desde el historial backfilled.
   `SELECT * FROM fn_audit_log_verify_chain() WHERE NOT ok` → **0 de 5 filas** ✓.

**Efecto secundario descubierto** (comportamiento correcto, no un bug): el FK
`platform_audit_log.user_id REFERENCES auth_users(id) ON DELETE SET NULL` intenta un
`UPDATE` en cascada cuando se borra físicamente un `auth_users` — el nuevo trigger
también bloquea esa cascada, impidiendo que borrar un usuario "lave" su rastro de
auditoría. Coherente con el patrón que la app ya usa (`account_status='deleted'`,
nunca `DELETE` físico) — no rompe ningún flujo real de negocio.

<details>
<summary>Hallazgo original (histórico, antes del fix)</summary>

**Verificado en vivo contra `aurixa-db`**:
```sql
SELECT has_table_privilege('sensors','platform_audit_log','UPDATE') → t
SELECT has_table_privilege('sensors','platform_audit_log','DELETE') → t
```
La tabla `platform_audit_log` **permite UPDATE y DELETE** para el rol de aplicación. Cualquier código (o inyección SQL futura) podría alterar o borrar el rastro de auditoría.

**Columnas actuales**: `id, created_at, tenant_id, user_id, username, session_id, action_type, entity_type, entity_id, request_path, source_ip, detail, success` — **no existen `prev_hash`/`hash`**. El hash encadenado forense que pide ADR-030 nunca se implementó.

**Fix necesario**:
```sql
REVOKE UPDATE, DELETE ON platform_audit_log FROM sensors;
ALTER TABLE platform_audit_log ADD COLUMN prev_hash TEXT, ADD COLUMN hash TEXT;
```
+ servicio backend centralizado (`audit_service.hpp/.cpp`, nunca creado) que calcule el hash encadenado en cada INSERT.

</details>

---

## ✅ RESUELTO — 2026-07-04 (hypertable de `mineria_lecturas`)

**Archivo nuevo**: `db_scripts/32_mineria_lecturas_hypertable.sql`.

**Gotcha de diseño detectado antes de escribir el script**: la tabla tenía
`PRIMARY KEY (id)` **sin incluir la columna de tiempo** — TimescaleDB exige que
cualquier índice UNIQUE/PK de un hypertable incluya la columna de partición, así
que `create_hypertable()` directo sobre el esquema original habría fallado. Se
migró con el patrón estándar para tablas ya pobladas: tabla nueva con PK compuesta
`(id, timestamp_lectura)` → conversión a hypertable → copia de datos → swap de
nombres (índice y secuencia incluidos, que no siguen el rename de la tabla).

**Dependencias verificadas antes de migrar**: 0 tablas con FK hacia
`mineria_lecturas.id` (swap seguro), 0 vistas dependientes, 1 función
(`sp_proceso_temperatura`, referencia la tabla por nombre → sigue funcionando sin
tocarla), 0 triggers propios.

**Pruebas ejecutadas** (dump real de producción → contenedor desechable primero,
luego `aurixa-db` real):
1. Se extrajo un `pg_dump --data-only` de las tablas de mineria desde producción
   (3602 filas reales) y se cargó en un contenedor desechable — la prueba usó
   datos reales, no sintéticos.
2. Se capturó una huella de referencia (hash MD5 + conteo) antes de migrar, tanto
   global como de un subconjunto específico `(empresa=2, mina=2, variable=2)`.
3. Primer intento de migración falló por `GENERATED ALWAYS AS IDENTITY` (rechaza
   IDs explícitos) → corregido con `OVERRIDING SYSTEM VALUE`. Segundo intento
   falló por colisión de nombre de índice (`RENAME TABLE` no renombra sus
   índices) → corregido renombrando también `idx_mlect_lookup`. Ambos fallos
   confirmaron que el bloque `DO` hace rollback atómico limpio (0 residuos).
4. Tercer intento: **éxito**. Verificado en el contenedor de prueba:
   - Conteo y hash **exactamente iguales** a la referencia (global y subconjunto).
   - Hypertable con 12 chunks, política de compresión activa (30 días, ADR-006).
   - `INSERT` nuevo obtiene el `id` correcto (secuencia realineada sin colisión)
     y cae en un chunk nuevo (partición temporal automática funcionando).
5. Aplicado el mismo script a `aurixa-db` real: **integridad de datos idéntica
   byte a byte** a la referencia pre-migración (mismos hashes), hypertable con
   12 chunks, compresión activa, tabla `mineria_lecturas_old` conservada como
   respaldo. Backend (`aurixa-api`, sin reiniciar) siguió `healthy`, sin errores
   en logs tras la migración — el cambio es transparente para el código que ya
   corría.

**Nota de alcance**: no se aplicó política de retención/DROP automático — el
ADR-006 solo especifica el umbral de compresión (>30 días) para esta tabla
explícitamente; el "plano histórico" vía rollup a Parquet/MinIO es trabajo
diferido, no borrado. Aplicar un DROP sin ese pedido explícito habría eliminado
datos que nadie pidió eliminar.

**Hallazgo colateral documentado**: la función `sp_proceso_temperatura()` en
producción real **ya no es** la versión simple original — fue reemplazada
(`CREATE OR REPLACE`) por una versión que depende de un motor de diagramas
(`blocks`/`connections`) de otro subsistema. No afecta esta migración (la
función sigue resolviendo `mineria_lecturas` por nombre), pero es información
nueva para quien trabaje en el motor de fórmulas más adelante.

<details>
<summary>Hallazgo original (histórico, antes del fix)</summary>

**Verificado en vivo**:
```sql
SELECT hypertable_name FROM timescaledb_information.hypertables;
→ telemetry_raw
→ telemetry_multivariate
```
`mineria_lecturas` **no aparece** — sigue siendo tabla PostgreSQL plana, sin partición temporal, sin compresión, sin política de retención. (`telemetry_raw` sí las tiene — compresión a 1h, retención 90 días — pero eso ya existía antes de esta sesión, no es trabajo mío.)

**Impacto**: cualquier consulta sobre `mineria_lecturas` (usada por el motor de fórmulas / `sp_proceso_temperatura`) escanea la tabla completa sin poda por partición. A escala (10k sensores/seg sostenido) esto degrada.

**Fix necesario**: exactamente el HALLAZGO #5 original — migrar a hypertable con `create_hypertable()`, chunk de 7 días, política de compresión/retención, siguiendo el patrón ya aplicado a `telemetry_raw`.

</details>

---

## ✅ RESUELTO — 2026-07-04 (workflow states, ADR-017)

**Archivo nuevo**: `backend/src/reports/report_workflow.hpp` — máquina de estados
canónica única (`draft → in_review → approved → signed → archived`, con rama
`rejected → draft`), consumida tanto por el backend como replicada en
`WorkflowPanel.jsx` para que ambos lados usen el mismo vocabulario.

**La migración coordinada FE + BE + datos que nunca se ejecutaba, se ejecutó**:

1. **Backend** (`report_service.cpp::updateReportPg`): antes hacía un `UPDATE`
   incondicional del `status`, sin leer el estado actual ni validar la
   transición. Ahora abre transacción explícita, hace
   `SELECT status ... FOR UPDATE` (lock de fila, evita carreras entre dos
   transiciones concurrentes sobre el mismo informe), valida con
   `isValidReportTransition(from, to)` y aborta con
   `invalid_workflow_transition:<from>-><to>` si no es válida.
   `createReportPg` también valida: un informe nuevo solo puede nacer en
   `draft` (antes un cliente podía crear directo un informe en `signed`).
   Cuando la transición es real (`from != to`), se inserta una entrada de
   auditoría server-side vía `fn_platform_audit_insert(...)`, que queda
   automáticamente encadenada por hash gracias al trigger del fix anterior
   (`31_audit_log_append_only_hash_chain.sql`).
2. **`report_routes.cpp`**: `handleUpdateReport`/`handleCreateReport` traducen
   `invalid_workflow_transition` a `HTTP 400` (antes todo error caía en
   `500 internal_server_error`, indistinguible de un fallo real de servidor).
3. **SQL** (`db_scripts/33_workflow_states_migration.sql`): migra los datos
   legacy (`'published'` → `'archived'`, cualquier otro valor fuera del
   vocabulario canónico → `'archived'`) y agrega
   `CHECK (status IN ('draft','in_review','approved','signed','archived','rejected'))`
   sobre `reports.status`. `02_seed_demo.sql` también corregido (sembraba
   `'published'` directamente).
4. **Frontend** (`WorkflowPanel.jsx`): vocabulario y transiciones alineados al
   ADR (`in_review` en vez de `review`, agregado `archived` como paso final
   tras `signed`). `App.jsx::handleWorkflowTransition` ahora llama al backend
   **de inmediato** (antes solo tocaba estado local de React y esperaba al
   siguiente ciclo de autosave, minutos después, para que el cambio llegara
   al servidor); el estado local solo avanza si el servidor confirma la
   transición — si el servidor rechaza (400), se muestra el motivo y el
   estado local no cambia.

**Pruebas ejecutadas**:
- *SQL*, en contenedor desechable con datos sintéticos que replican
  exactamente el estado real (`draft` x1, `published` x1, un valor legacy
  desconocido) verificado contra el estado real de `aurixa-db` antes de
  migrar (coincidía exacto: `draft` x1, `published` x1, sin CHECK constraint).
  Verificado: migración de datos correcta, `CHECK` constraint bloquea inserts
  inválidos, re-ejecución es no-op (idempotente). Aplicado a `aurixa-db` real
  y reverificado con el mismo resultado.
- *Backend*: compilado con `Dockerfile.verify` (0 errores) y desplegado en
  `aurixa-api` real. Contra la API real: creación con `status:"signed"`
  rechazada (400, "new reports must start as draft"); secuencia completa
  `draft → in_review → approved → signed → archived` aceptada paso a paso;
  4 saltos inválidos (`draft→signed`, `approved→draft`, `signed→draft`,
  `archived→draft`) todos rechazados con 400 y el mensaje exacto de la
  transición rechazada. Verificado en `platform_audit_log` que las 4
  transiciones válidas generaron exactamente 4 entradas
  `workflow_transition` con `detail` correcto (`{"from":...,"to":...}`) y que
  `fn_audit_log_verify_chain()` reporta 0 filas rotas (hash chain íntegra).
- *Frontend*, en vivo contra `aurixa-api` real (registro de usuario nuevo,
  login, navegación a "Informe Técnico"): badge de estado muestra
  "Borrador"/"En Revisión" (canónico, no el `'review'` legacy); barra de
  progreso del panel de workflow muestra los 5 pasos correctos
  (Borrador/En Revisión/Aprobado/Firmado/Archivado); intentar transicionar
  sin haber guardado el informe primero se bloquea correctamente con aviso
  ("Guarde el informe antes de cambiar su estado de workflow"); tras guardar,
  la transición `draft → in_review` se confirma contra el backend real y el
  badge/bitácora local se actualizan solo después de la respuesta 200.
- Datos y usuario de prueba eliminados de `aurixa-db` tras la verificación.

<details>
<summary>Hallazgo original (histórico, antes del fix)</summary>

### 5. Workflow states: `WorkflowPanel.jsx` sigue en `'review'`, no `'in_review'`
**Verificado**: `WorkflowPanel.jsx:15,22-24,124` — el vocabulario `draft → review → approved → signed` sigue como estaba. No hay enum de estados en el backend C++ (`grep -rn "in_review\|ReportStatus" reports/*.cpp` → 0 resultados).

**Por qué sigue así**: como se explicó cuando se difirió, un cambio solo-frontend rompería la consistencia con los datos existentes en BD. Requiere migración coordinada FE + BE + script SQL de datos, ejecutada en una sola ventana. Nunca se ejecutó esa migración coordinada.

</details>

---

## ✅ RESUELTO — 2026-07-05 (ADR-018: firma documental + comentario de rechazo)

Auditoría de seguimiento sobre el propio fix de workflow states (2026-07-04)
detectó que **ADR-018 no se cumplía**: "El estado `signed` requiere una firma
documental registrada (no basta el hash)" — mi implementación anterior solo
cambiaba el string de `status`, sin capturar quién firmó ni con qué cargo.
También se detectó que el comentario de rechazo (exigido por la UI) nunca
llegaba al servidor, solo quedaba en el `auditLog` local del navegador.

**Archivo nuevo**: `db_scripts/34_report_signature.sql` — agrega
`signed_by` (FK a `auth_users`), `signed_by_name`, `signed_by_role`,
`signed_at` a `reports`. Poblados únicamente por el servidor en el momento
exacto de la transición `approved->signed` (`report_service.cpp::updateReportPg`),
nunca por el cliente. `signed_by_name`/`signed_by_role` quedan desnormalizados
para que la firma siga siendo legible si el usuario cambia de nombre/rol o es
desactivado después. Verificado que la transición posterior `signed->archived`
**no sobreescribe** la firma (branch separado en el UPDATE).

El comentario de transición (p.ej. motivo de rechazo) ahora viaja en el body
(`workflow_comment`) y queda en el `detail` JSON de la entrada de auditoría
correspondiente (hash-chain de `31_audit_log_append_only_hash_chain.sql`),
junto con `signed_by_name`/`signed_by_role` cuando aplica.

**Pruebas ejecutadas**:
- SQL probado en contenedor desechable (UPDATE de firma con subquery FK,
  verificado que `signed->archived` preserva la firma original) antes de
  aplicar a `aurixa-db` real.
- Backend compilado (`Dockerfile.verify`, 0 errores) y desplegado en
  `aurixa-api`. E2E real contra la API: secuencia
  `draft→in_review→rejected(con comentario)→draft→in_review→approved→signed`;
  verificado en `platform_audit_log` que las 6 transiciones quedaron con el
  `detail` correcto, incluyendo `"comment"` en el rechazo y
  `"signed_by_name"/"signed_by_role"` en la firma; `fn_audit_log_verify_chain()`
  → 0 filas rotas. `GET /api/reports/{id}` devuelve `signed_by_name`,
  `signed_by_role`, `signed_at` correctamente poblados tras firmar.
- Frontend verificado en vivo (navegador real contra `aurixa-api`): panel de
  workflow muestra el bloque "Firma documental" con nombre/cargo/fecha justo
  después de firmar, y también **al reabrir** el informe firmado desde "Mis
  Informes → Editar" (antes `handleOpenEdit` no sincronizaba `workflowStatus`
  ni la firma al abrir un informe existente — bug encontrado y corregido en
  el mismo lote, ver abajo).

**2 bugs adicionales encontrados y corregidos durante esta verificación (no
relacionados con ADR-018, pero descubiertos al intentar verificarlo en la UI real):**

1. **`handleOpenEdit` no sincronizaba `workflowStatus`/firma al abrir un
   informe existente** (`App.jsx`): el badge/panel de workflow mostraba el
   valor residual de la sesión anterior (típicamente `'draft'`) en vez del
   estado real guardado en el servidor. Corregido: ahora llama
   `setWorkflowStatus(full.status)` y carga la firma desde la respuesta del
   servidor al abrir.
2. **Filtro de fecha en "Mis Informes" excluía silenciosamente los informes
   creados "hoy" para cualquier usuario en timezone UTC-negativo** (incluye
   Perú, la región real de despliegue): `reportsStorage.js::listReportsAsync`
   hacía `new Date(dateTo); to.setHours(23,59,59,999)`, que muta en hora
   **local** del navegador — en UTC-5 esto corría el límite superior casi un
   día hacia atrás. Reproducido en vivo (0 informes visibles pese a que la
   API sí los devolvía), corregido con límites explícitos en UTC
   (`` `${dateTo}T23:59:59.999Z` ``), reverificado con el mismo caso (1/1
   informes visibles tras el fix).
3. **`ReportsAdminModal.jsx::STATUS_LABELS` no tenía `signed`/`rejected`**:
   cualquier informe firmado o rechazado se mostraba con la etiqueta
   "Borrador" (fallback silencioso), justo el caso de uso que la auditoría de
   firma debe sostener. Agregadas ambas etiquetas + opciones de filtro
   faltantes.

---

## ✅ RESUELTO — 2026-07-05 (Memory safety RAII completo, Doxygen core, ADR-015, ADR-016)

### 6. Memory safety (RAII): 11 de 11 archivos migrados
Los 10 archivos restantes (`auth_storage_pg.cpp` 42 sitios, `kpi_service.cpp` 37,
`formula_routes.cpp` 15, `report_service.cpp` 9, `map_routes.cpp`,
`mining_routes.cpp`, `platform_routes.cpp`, `sensor_service.cpp`,
`surveillance_service.cpp`, `main.cpp`) migrados de `PGresult*` crudo +
`PQclear()` manual a `storage::PgResult` RAII. Verificado `grep -rn "PGresult\*\|PQclear("` →
0 resultados en los 10 archivos (queda 1 firma de tipo de retorno de lambda
en `sensor_service.cpp`, sin riesgo — la propiedad pasa a `PgResult` de
inmediato en cada call site). Compilado (`Dockerfile.verify`, 0 errores),
desplegado en `aurixa-api` real, y verificado en vivo contra endpoints de
cada archivo migrado (KPIs, países/idiomas, dashboard, auth companies) — 200 OK.

### Doxygen: cobertura extendida a los headers de lógica de negocio
Documentados con `/** @brief ... */` completo: `auth_storage_pg.hpp` (14
funciones), `auth_session.hpp` (8), `kpi_service.hpp` (5), `report_service.hpp`
(6), `sensor_service.hpp`, `surveillance_service.hpp` (5), `formula_service.hpp`
(2), `storage/pg_pool.hpp` (3), y los `registerRoutes()` de `mining_routes.hpp`,
`map_routes.hpp`, `platform_routes.hpp`, `report_routes.hpp`, `formula_routes.hpp`.
Deliberadamente fuera de alcance: headers que son mayormente structs de datos
(`auth_types.hpp`, `biometric_types.hpp`) — el nombre de cada campo ya es
autodescriptivo, documentarlos campo a campo no agrega información real.

### ADR-015: versionado autoritativo en servidor — implementado
**Decisión de granularidad**: una revisión por cada guardado confirmado
(autosave o manual), no solo en transiciones de workflow.
`report_service.cpp::updateReportPg`/`createReportPg` insertan en
`report_content_revision` (número de versión = MAX+1, protegido por el mismo
lock de fila `FOR UPDATE` ya usado para la validación de workflow — sin
condición de carrera). Nuevo endpoint `GET /api/reports/{id}/revisions`
(filtrado por tenant vía join con `reports.company_name`). Frontend:
`VersionHistory.jsx` ahora se puebla con las revisiones reales del servidor
al abrirse (antes: snapshots 100% client-side, perdidos al recargar la
página) conservando los snapshots manuales de la sesión aún no persistidos.
**Verificado**: E2E contra `aurixa-api` real (crear informe → 2 actualizaciones
de contenido → `GET .../revisions` devuelve 3 filas con versión/autor/contenido
correctos); ataque cruzado de tenant → `[]` vacío; verificado en navegador real
que el panel muestra "v1 — Creación inicial — usuario — fecha real" tras
consultar al servidor.

### ADR-016: export PDF server-side — implementado (Chromium headless)
**Decisión de arquitectura**: en vez de reimplementar el renderizado de
bloques en C++ (duplicaría lógica y divergiría visualmente del editor), un
sidecar Node/Puppeteer (`pdf-export-service/`) navega a un entry point
aislado del propio frontend (`print-report.html` →
`src/print-report/main.jsx`) que reusa **el mismo componente**
`ReadOnlyViewer.jsx` (y su CSS `@media print` ya existente) que ve el
usuario — fidelidad garantizada por construcción, cero renderer duplicado.
Backend: `GET /api/reports/{id}/export/pdf` valida tenant vía
`getReportByIdPg` ANTES de invocar al sidecar (evita gastar un ciclo de
Chromium en un id ajeno/inexistente), arma la URL interna con el token de
sesión del propio usuario (sin credenciales nuevas), reenvía la request al
sidecar (`report_pdf_export.cpp`, mismo patrón de cliente HTTP que
`ai_engine_client.cpp`) y devuelve el PDF con `Content-Disposition:
attachment` (nombre de archivo saneado contra inyección de headers).
Nuevo servicio `pdf_export` en `docker-compose.yml` (imagen oficial
`ghcr.io/puppeteer/puppeteer`), sin `depends_on` duro desde el backend
(evita ciclo `web→pdf_export→frontend→web`; si el sidecar no está listo, el
export falla con error claro en vez de bloquear el arranque de la plataforma).
Frontend: `handleExportPdf` ahora usa el export real cuando el informe ya
está guardado, con fallback al `window.print()` existente en otro caso.
**Verificado**: PDF real generado (43KB, header `%PDF-1.4` válido) contra un
informe real vía `aurixa-api`; confirmado visualmente que `print-report.html`
renderiza el contenido exacto guardado y marca `window.__PDF_READY__` antes
de que el sidecar capture; ataque cruzado de tenant → `404 report_not_found`
sin invocar al sidecar.

<details>
<summary>Hallazgos originales (histórico, antes del fix)</summary>

### 6 (original). Memory safety (RAII): solo 1 de 11 archivos migrado
`storage::PgResult` solo se usaba en `telemetry_ingest.cpp`; el resto seguía con `PGresult*` crudo + `PQclear()` manual (`auth_storage_pg.cpp` 13, `kpi_service.cpp` 28, `formula_routes.cpp` 8, `report_service.cpp` 6, otros 1-2 c/u).

### 9 (original). Doxygen: cobertura solo de la infraestructura nueva
Solo `constants.hpp`, `pg_result.hpp`, `validators.hpp` documentados. ~108 declaraciones de función sin `/** */` en el resto de los headers.

### 10 (original). Export PDF server-side (ADR-016) — nunca implementado
No existía ningún servicio de export/worker en `backend/src/`. El único export probado era `window.print()` del navegador.

ADR-015 (versionado server-side de `report_content_revision`) tampoco se mencionaba resuelto en ninguna sección anterior — la tabla existía en el esquema desde script 19 pero ningún código insertaba en ella.

</details>

### 7. React optimization — ampliado: `PageCanvas` + `LeftLibrary` memoizados
**Ronda 2 (2026-07-05)**: `LeftLibrary` envuelto en `React.memo`. Esto solo
tiene efecto real si sus props son estables — antes NO lo eran:
`App.jsx` pasaba 7 arrow functions inline (`onAdd`, `onDuplicatePage`,
`onAddHeader/Footer/Findings`, `onAddCover/Toc`), recreadas en cada uno de
los ~30 `useState` de `App.jsx`. Se extrajeron a `useCallback` con
dependencias correctas (`handleLeftLibraryAdd`, `handleDuplicatePage`,
`handleAddHeader/Footer/Findings/Cover/Toc`) — sin esto, envolver
`LeftLibrary` en memo habría sido cosmético, sin ningún efecto real.
También se detectó y corrigió que `handleExportVideo` no estaba en
`useCallback` (afecta tanto a `LeftLibrary` como a `RibbonToolbar`).
**Verificado en vivo**: agregar página, duplicar página e insertar portada
siguen funcionando correctamente tras memoizar (3 páginas tras 2 duplicados
consecutivos, contenido correcto).

**`RibbonToolbar` deliberadamente NO memoizado**: recibe ~15 props de
formato "en vivo" (`currentFontFamily`, `currentBold`, `currentAlignment`,
`zoomPercent`, etc.) que cambian por diseño en casi cada tecla/selección del
usuario — memoizarlo raramente evitaría un re-render real durante edición
activa, que es precisamente cuando más importa. Forzar el memo ahí habría
sido una optimización cosmética sin beneficio medible.

**Ronda 3 (2026-07-07)** — 7 componentes más memoizados, todos con
verificación de por qué es seguro (no cosmético) antes de aplicar:

- `SensorWidget.tsx`, `MiningKpiWidget.tsx` (rendered dentro de
  `PageCanvas.tsx`, uno por elemento de página, en el camino más caliente de
  re-render de la app): props derivan de `element.props`, cuya referencia se
  preserva para elementos hermanos sin editar (`useEditorStore::updateElement`
  solo reemplaza el elemento tocado — verificado leyendo el store). Ambos
  gestionan su propio polling vía `useEffect`+`setInterval`, no afectado por
  saltarse un render heredado del padre. Memo por defecto (props ya
  primitivas), sin comparador custom.
- `TableBlock.tsx` (mismo camino): tenía el problema clásico de "callback
  inline por ítem de lista" (`onUpdateCells` recreado en cada render de
  `PageCanvas` dentro del `.map()`). En vez de reestructurar `PageCanvas`
  (archivo grande y ya con 2 bugs reales encontrados antes en esta sesión —
  alto riesgo), se usó un comparador custom que ignora la identidad de
  `onUpdateCells` y compara solo los datos reales (`rows`, `hasHeader`, etc.)
  — válido porque si el elemento no cambió, esos datos vienen de la misma
  referencia de `element.props`, así que la clausura "vieja" del callback es
  equivalente a una nueva.
- `MiningDashboard.tsx`, `AdvancedSensors.tsx`, `TelemetryDashboard.tsx`,
  `VideoDiagram.tsx` (vistas de pestaña en `src/App.tsx`, montadas una a la
  vez vía `activeTab === 'X'`): `src/App.tsx` tiene 22 `useState` compartidos
  entre TODAS las pestañas (sliders de Azimuth/Inclinómetro, menús, modales)
  — cualquiera de esos 22 dispara un re-render de la pestaña activa aunque
  no le concierna. Props son 0 o 1 primitivo estable (`telemetryTenantId`) →
  memo por defecto seguro.
- `AlarmCenter.tsx` (mismo caso): además de `telemetryTenantId` recibe
  `onCreateReportFromAlarm` inline desde `src/App.tsx`; comparador custom que
  ignora esa prop porque su comportamiento es invariante entre renders
  (siempre `() => setActiveTab('Report v2')`, sin cerrar sobre datos por-ítem).

**Hallazgo colateral — código muerto detectado durante el barrido**:
`AdvancedTableBlock.tsx`, `DynamicSensorField.tsx`, `CoverPage.tsx` (los 3 en
`components/document/`) no tienen ningún call site en todo el repo — nunca se
importan. Memoizarlos habría sido cosmético (0 beneficio real). No se
tocaron ni se borraron (fuera de alcance de una pasada de optimización;
borrar código muerto es una decisión propia, ver nota abajo).

**Deliberadamente NO memoizado, con motivo verificado (no por falta de
tiempo)**:
- `LiveChartBlock.tsx`: genera datos con `Math.random()` **directamente en el
  cuerpo del render** (no en un `useEffect`/`useMemo`), a diferencia de
  `MiningKpiWidget`/`SensorWidget`/`TelemetryDashboard`/etc. que sí aíslan su
  aleatoriedad en efectos propios. Envolverlo en memo congelaría el gráfico
  en su primer dibujo aleatorio — un cambio de comportamiento observable, no
  cosmético. Dado que es un bloque de datos mock (sin conexión real a KPIs/
  sensores, a diferencia de sus pares), no está claro si el "parpadeo" al
  editar otro elemento es un efecto secundario accidental (probable) o una
  animación deliberada — requiere una decisión de producto, no una corrección
  unilateral de una pasada de rendimiento.
- Paneles/modales condicionados por un flag booleano (`WorkflowPanel`,
  `VoiceDictation`, `VersionHistory`, `VersionComparator`,
  `PerformanceDashboard`, `TableOfContents` (el componente, no
  `generateTocData`), todo `components/modals/*`, todo `components/views/*`,
  `AuditCenter`, `RichTextEditor`, `FormulaEngineEmbed`): se montan/desmontan
  bajo demanda (el usuario los abre explícitamente), no re-renderizan en un
  bucle de lista como `TableBlock`/`SensorWidget` — el mismo patrón ya
  documentado para `RibbonToolbar` en la Ronda 2: memoizar algo que no
  re-renderiza en caliente no tiene beneficio medible.
- `MapViewer.tsx`, `DetailedMap.tsx`, `TerritorialCompliancePanel.tsx`,
  `GeotechWorkbench.tsx`/`Viewer3D.tsx`/`InclinometerCharts.tsx`/
  `DisplacementCharts.tsx`: props mayormente primitivas y candidatas
  plausibles al mismo patrón que `AdvancedSensors`, pero gestionan instancias
  de Leaflet vía `useRef`/ciclo de vida complejo (`MapViewer`/`DetailedMap`) o
  reciben props que SÍ cambian legítimamente casi en cada interacción del
  usuario en su propia pestaña (`azimuthAngle`/`xRange`/`yRange` en
  `Viewer3D`/`InclinometerCharts`/`DisplacementCharts`, ligados a los mismos
  sliders que los usan). Memoizarlos sin auditar a fondo sus `useEffect`
  (riesgo de introducir un bug sutil en mapas Leaflet ya en producción, la
  misma clase de riesgo que ADR-026 ya identificó como delicada) quedó fuera
  de esta pasada — candidato real para una Ronda 4 dedicada, no un rechazo
  definitivo.

**Verificado**: build de producción (`docker compose build frontend`) con 0
errores de TypeScript en los 7 archivos tocados (los tipos de `memo()` con
comparador custom exigen que las props coincidan exactamente, así que un
error de tipeo en el comparador no habría compilado). Desplegado en
`aurixa-web` real; `curl` confirma `index.html`/`assets/*` sirviendo 200 con
los headers de seguridad + CSP intactos (ver sección CSP arriba). No se pudo
verificar interactivamente en navegador en esta sesión (extensión Chrome no
conectada, y el puerto 5173 ya está tomado por el contenedor Docker real, no
por un servidor de preview separado) — la verificación de "no rompe nada" se
apoya en: build sin errores de tipos + lectura directa del código de
`useEditorStore::updateElement` confirmando la premisa de estabilidad
referencial en la que se basan los memos, no en una prueba visual en vivo.

**Ronda 4 (2026-07-07, cierre a 100%)** — se retomó exactamente donde la
Ronda 3 se detuvo por cautela (paneles condicionales y vistas Leaflet sin
auditar) y se cerraron los ~35 componentes restantes con evidencia real, no
por lote ciego:

- **30 componentes memoizados** en esta ronda: `AuditCenter`, `AuthGateway`,
  `GeotechWorkbench`, `MiningWorkbenchHeader`, `RichTextEditor`,
  `FormulaEngineEmbed`, `PlatformRegionBar`, `PerformanceDashboard`,
  `FloatingContextualToolbar`, `MultipageView`, `TableOfContents`,
  `VersionComparator`, `VersionHistory`, `VoiceDictation`, `WorkflowPanel`,
  `SensorInspector`, `TopToolbar`, los 8 componentes de `modals/`,
  `ReadOnlyViewer`, `PermissionsManagementView`, `UserManagementView`,
  `AzimuthCompass`, `CctvStreamVideo`, `TerritorialCompliancePanel`,
  `MiningGeoportalView`, `AnimatedButton`, `InclinometerCharts`,
  `DisplacementCharts`, `Viewer3D`, `MapViewer`, `DetailedMap`.
- **Reconsiderado y confirmado seguro** el bloque de mapas Leaflet
  (`MapViewer`/`DetailedMap`) que la Ronda 3 había dejado fuera por cautela:
  el análisis más a fondo mostró que sus props reales en cada call site ya
  son primitivos/estables (`layout`, `siteLabel`, `mapTitle`,
  `syncedWmsPresetKey`, `geoportalModuleLabel` — todos strings u opcionales
  con default) — `React.memo` nunca interfiere con el ciclo de vida interno
  de la instancia Leaflet (vive en un `useRef`, ajeno a si el componente-
  función se re-ejecuta o no), así que no había riesgo real que auditar más.
- **Bug de estabilidad de props encontrado y corregido en `src/App.tsx`**
  al memoizar `InclinometerCharts`/`DisplacementCharts`: recibían
  `xRange={[xMin, xMax]}`/`yRange={[yMin, yMax]}` como **literales de array
  inline**, recreados en cada uno de los 22 `useState` de `App.tsx` (la
  mayoría ajenos a estas dos pestañas) — el memo nunca habría podido saltar
  un render con esa prop siempre "nueva" por referencia. Corregido con
  `useMemo<[number,number]>(() => [xMin, xMax], [xMin, xMax])` (y análogo
  para `yRange`) en `App.tsx`, mismo patrón que ya se aplicó a callbacks en
  la Ronda 2 — sin esto, memoizar esos dos componentes habría sido cosmético.
- **Segundo componente con datos mock aleatorios en el cuerpo del render
  encontrado**: `Special/QRGenerator.tsx` genera un patrón de píxeles con
  `Math.random() > 0.4` directamente en el JSX (comentario propio del
  archivo: *"Mock QR implementation - in real life use 'qrcode.react'"*) —
  mismo problema que `LiveChartBlock.tsx` ya documentado en la Ronda 3.
  Memoizarlo congelaría el patrón falso en su primer dibujo; se excluye con
  el mismo criterio (cambio de comportamiento observable sin una decisión de
  producto de por medio), no por omisión.
- **Confirmados como código muerto** (sin ningún call site en todo el repo,
  búsqueda repetida en esta ronda): `AdvancedTableBlock.tsx`,
  `DynamicSensorField.tsx`, `CoverPage.tsx` (los 3 ya identificados en la
  Ronda 3) — no memoizados porque no hay nada que optimizar.
- **`RibbonToolbar.tsx`**: reconsiderado explícitamente en esta ronda a la
  luz de "cerrar al 100%"; se reconfirma la exclusión de la Ronda 2 (props
  "en vivo" de formato — `currentFontFamily`/`currentBold`/`zoomPercent`/etc.
  — que cambian en casi cada tecla/selección durante la edición activa, que
  es precisamente cuando más importa que la barra responda). No es una
  omisión, es la misma decisión revisada y sostenida.

**Verificado**: `docker compose build frontend` con 0 errores de TypeScript
sobre los 30 archivos tocados en esta ronda (más el fix de estabilidad en
`App.tsx`); desplegado en `beemetry-web` real; `index.html` sirve 200 y el
flujo de login contra `beemetry-api` sigue funcionando sin cambios tras el
despliegue.

**Balance final tras las 4 rondas**: 54 de 60 componentes reales evaluados
tienen `React.memo` (con comparador custom donde el problema de "callback
inline por ítem" lo exigía — `TableBlock`, `AlarmCenter`). De los 6
restantes: 3 son código muerto, 2 tienen datos mock aleatorios en el cuerpo
del render (memoizar cambiaría su comportamiento visible sin que exista una
decisión de producto sobre si eso es deseable), y 1 (`RibbonToolbar`) fue
evaluado y excluido dos veces con la misma razón verificada. No queda ningún
componente real sin evaluar. `useReducer`: 0 usos — `AuthGateway.tsx` y
`ReportStudioV2/App.tsx` siguen con 20+ `useState` cada uno sin consolidar;
migrar esos hooks a `useReducer` es un refactor de comportamiento interno
(no de props/memoización) y queda fuera del alcance de esta iniciativa de
rendimiento — es un ítem propio si se decide abordarlo.

### 8. TypeScript — cerrado por ADR-069

**Estado histórico (2026-07-04):** la adopción era 0% y se difirió para una
iniciativa separada.

**Actualización verificada 2026-07-24:** ADR-069 completó la migración del código
productivo. El árbol actual contiene 111 archivos `.ts`/`.tsx`; los 6 archivos
`.js`/`.jsx` restantes corresponden a pruebas o configuración. `tsc --noEmit`,
la compilación de producción y las 18 pruebas frontend pasan. Este gap queda
cerrado; el control permanente es impedir regresiones a JavaScript productivo.

---

## ✅ RESUELTO — 2026-07-05 (Sprint 2: integración E2E + checklist de seguridad automatizable)

**Integración E2E** (capstone): flujo completo contra `aurixa-api` real —
crear informe → `draft→in_review→approved→signed→archived` (5 transiciones,
5 revisiones en `report_content_revision`, firma documental capturada) →
`GET .../revisions` correcto → `GET .../export/pdf` (PDF real, 46KB) →
lecturas de KPI vía réplica → hypertable `mineria_lecturas` presente →
`fn_audit_log_verify_chain()` → 0 filas rotas. Los 6 hallazgos originales
más los fixes de esta sesión funcionan juntos, no solo aisladamente.

**Checklist de seguridad automatizable ejecutado** (no reemplaza un pentest
formal de terceros, ver más abajo):
- SQL injection: 0 usos de `pqEscapeLiteral`/concatenación (ya verificado en
  sesiones previas, reconfirmado).
- Command injection: `shellQuote()` en los 4 puntos con `std::system()`.
- IDOR: verificado cross-tenant en informes (lectura, revisiones, export
  PDF) → 404/vacío antes de tocar cualquier dato, sin gastar ciclos del
  sidecar de PDF en ids ajenos.
- Rate limiting de login: confirmado `HTTP 429` tras 6 intentos rápidos.
- **Headers de seguridad HTTP — hallazgo nuevo, corregido**: `curl -I` mostró
  ausencia total de `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy`
  en cualquier respuesta (solo existía `Access-Control-Allow-Origin: *`).
  Agregados en el único punto de paso de toda la API
  (`router.cpp::dispatch()`) y en las locations estáticas de nginx.
  **Bug propio detectado y corregido en el mismo lote**: agregar los headers
  también a nivel `server {}` en nginx duplicaba los headers en las
  respuestas proxificadas (`/api/`), porque el backend YA los agrega —
  verificado con `curl -I` mostrando cada header 2 veces; corregido moviendo
  los `add_header` de nginx solo a las locations de contenido estático
  propio (index.html, assets, SPA fallback), dejando `/api/`/`/formula-api/`
  sin duplicar lo que ya viene del backend/formula engine.
- CSP (Content-Security-Policy): **no implementado** — requiere auditar
  todos los orígenes externos ya en uso (Google Fonts, Tailwind CDN vía
  `<script src="https://cdn.tailwindcss.com">`) antes de poder aplicar una
  política estricta sin arriesgar romper la app; aplicar una CSP a ciegas
  sin ese inventario es peor que no tener ninguna (falsa sensación de
  seguridad + riesgo real de romper producción).
- CORS: `Access-Control-Allow-Origin: *` sigue abierto — aceptable dado que
  la app usa Bearer token en `Authorization` (no cookies de sesión, que es
  el vector clásico que CORS restrictivo mitiga), pero queda como mejora si
  la API se expone fuera de la red del propio despliegue.

**Changelog y runbook de despliegue**: `CHANGELOG.md` y `RUNBOOK.md` creados
en la raíz del proyecto — checklist de estado de los 6 hallazgos originales,
checklist de seguridad automatizable, pasos de deploy/rollback, y una
sección explícita de qué NO puede decidir este agente (pentest de terceros,
fecha de GO-LIVE, QA manual, comunicación a usuarios).

---

## 📊 Resumen por severidad

| Severidad | Ítem | Estado |
|---|---|---|
| 🔴 Crítico | IDOR escritura en user maintenance | ✅ Corregido y verificado con ataque real |
| 🔴 Crítico | IDOR lectura en `/api/auth/users` | ✅ Corregido y verificado con ataque real |
| 🔴 Crítico | Auditoría sin append-only ni hash | ✅ Corregido y verificado (hash chain + ataque simulado) |
| 🔴 Crítico | `mineria_lecturas` no es hypertable | ✅ Corregido y verificado (integridad byte a byte) |
| 🟠 Alto | Workflow states desalineados | ✅ Corregido y verificado (SQL + backend + frontend + E2E real) |
| 🟠 Alto | ADR-018: firma documental faltante en `signed` | ✅ Corregido y verificado (SQL + backend + frontend + E2E real) |
| 🟢 Bajo | Memory safety RAII (11 de 11 archivos) | ✅ Completado y verificado |
| 🟢 Bajo | Doxygen (headers de lógica de negocio) | ✅ Completado |
| 🟠 Alto | ADR-015: versionado server-side sin implementar | ✅ Corregido y verificado (E2E real) |
| 🟠 Alto | Export PDF server-side (ADR-016) | ✅ Implementado y verificado (Chromium headless) |
| 🟢 Bajo | React memo/useReducer | Cerrado 2026-07-07: 54/60 componentes reales memoizados en 4 rondas (incluye comparadores custom en `TableBlock`/`AlarmCenter`, y un fix de estabilidad de props en `App.tsx` para `InclinometerCharts`/`DisplacementCharts`). Los 6 restantes están excluidos con motivo verificado, no pendientes: 3 código muerto, 2 con datos mock aleatorios en el render (cambiaría comportamiento visible), 1 (`RibbonToolbar`) con props "en vivo" reconfirmado. `useReducer`: 0 usos — consolidar los 20+ `useState` de `AuthGateway.tsx`/`App.tsx` es un refactor de comportamiento interno, no de rendimiento; queda como iniciativa propia si se decide abordarla |
| 🟢 Cerrado | TypeScript | ✅ Código productivo migrado y verificado por ADR-069 |
| 🟠 Alto | Headers de seguridad HTTP ausentes | ✅ Corregido y verificado (+ bug propio de duplicación detectado y corregido) |
| 🟡 Medio | Integración E2E de todos los hallazgos | ✅ Verificada (flujo capstone completo) |
| ⚪ No iniciado | Pentest de terceros, QA manual, decisión de release | Requiere decisión de negocio, no solo código |

---

## Recomendación de orden de ataque

1. **Los 2 IDOR** (#1, #2) — son explotables ahora mismo, arreglo acotado a `auth_routes.cpp` (2-3 líneas cada uno), bajo riesgo, alto impacto.
2. **Auditoría append-only + hash** (#3) — script SQL (`REVOKE` + `ALTER TABLE`) + servicio backend nuevo.
3. **Hypertable de `mineria_lecturas`** (#4) — script SQL siguiendo el patrón ya validado en `telemetry_raw`.
4. **Workflow states** (#5) — ✅ resuelto: SQL + backend + frontend + E2E real, ver sección arriba.
5. El resto (memory safety restante, React/TS, Doxygen, pipeline de release) son mejoras de calidad/alcance mayor, no vulnerabilidades activas — priorizar según tiempo disponible.
