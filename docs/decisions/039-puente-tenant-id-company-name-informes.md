# ADR-039 — Puente de compatibilidad `tenant_id` ↔ `company_name` para búsqueda multitenant de informes

**Actualización 2026-07-13 (migración completa — cierra la deuda de este ADR)**:
tras el dual-write descrito abajo, se re-auditó el estado real de los datos (no
el estimado original de "~40 `company_name` legacy"): en la práctica solo
existían **5** `company_name` distintos en uso (todos datos de desarrollo/
prueba — "Activos Mineros", "Alpayana", "Compania Minera Raura", "LUDER",
"Minera Raura" — ninguno correspondiente a un tenant real, y los 6 informes
existentes eran todos artefactos de verificación de sesiones anteriores, no
datos de cliente). Consultado el usuario explícitamente (no se inventó una
decisión de negocio que no correspondía tomar unilateralmente), la resolución
elegida fue **borrar los 6 informes de prueba y completar la migración desde
cero** — no backfill de company_name legacy, no tenants inventados.

Se ejecutó la migración completa que este ADR dejaba como "trabajo futuro":
- `db_scripts/45_adr039_migracion_completa_tenant_id.sql`: `DELETE FROM reports`
  (los 6 de prueba) + `ALTER TABLE reports ALTER COLUMN tenant_id SET NOT NULL`.
- `report_service.cpp`/`.hpp`: las 5 funciones (`listReportsPg`,
  `getReportByIdPg`, `updateReportPg`, `deleteReportPg`,
  `listReportRevisionsPg`) migradas de filtrar por `company` (string) a
  filtrar por `tenantId` (UUID) — `tenant_id = $N::uuid` en cada query.
  `company_name` se conserva en la tabla solo como campo de **display legacy**
  (nunca más se usa para autorización ni se sobreescribe en `UPDATE`).
  `createReportPg` rechaza con `error="tenant_required"` si `r.tenantId` viene
  vacío, sin tocar la BD.
- `report_routes.cpp`: `resolveAllowedReportCompany` (verificaba
  `tenant_name` vía join) reemplazado por `resolveAllowedReportTenant`, que
  reutiliza `auth::userBelongsToTenant` (ya existente desde ADR-043) sobre
  `?tenant_id=` en vez de `?company=`. `handleCreateReport`/
  `handleUpdateReport`/`handleDeleteReport` exigen tenant real antes de
  tocar la BD.
- Frontend (`api.ts`, `reportsStorage.ts`, `ReportsAdminModal.tsx`): el
  selector multitenant de la búsqueda de informes ahora envía `tenant_id`
  (ya lo tenía disponible en `tenantOptions`, solo enviaba `tenant_name` por
  el parámetro `company`) en vez de `company`; `App.tsx` reenvía
  `report.tenantId` al abrir un resultado de búsqueda cross-tenant.

**Hallazgo real y crítico encontrado durante la verificación** (no
hipotético — el primer intento de probar "usuario sin tenant no puede crear
informes" pasó con 201 Created cuando debía dar 400): `AuthUser.tenantId` se
resuelve en `loginPasswordPg` vía `resolveTelemetryTenantIdPg`, que
**rellena con un tenant DEMO (`kMiningTelemetryDemoTenantId` = Antamina)
para cualquier usuario sin fila real en `auth_user_tenant`** — pensado para
que el dashboard de telemetría muestre datos de ejemplo a un usuario sin
tenant, pero ese mismo valor viajaba también en `session->tenantId`/el JWT,
haciendo que el chequeo `!tenantId.empty()` NUNCA rechazara a nadie (el
fallback garantiza que nunca esté vacío) — un usuario legacy sin tenant real
habría creado informes silenciosamente atribuidos a Antamina, mezclando
datos de unidades no relacionadas. Corregido agregando
`auth::userHasRealTenantMembership(userId, tenantId)`
(`permissions.hpp/cpp`, nuevo) — a diferencia de `userBelongsToTenant`, NO
acepta el atajo "coincide con el tenant de sesión" sin verificar en BD que
existe una fila real en `auth_user_tenant`. Usado en las 3 rutas de
escritura (`create`/`update`/`delete`) — las de lectura no lo necesitan
(un tenant fallback sin informes reales simplemente devuelve lista vacía,
comportamiento seguro).

**Verificado end-to-end contra el backend real** (7 casos, todos pasaron):
usuario sin tenant real → 400 `tenant_required` en creación; usuario con
tenant real (Antamina, `is_default`) → crea con `tenant_id` correcto; lectura
del propio informe recién creado devuelve el `tenant_id` correcto; listado
sin query param usa el tenant activo; el mismo usuario buscando por OTRO
tenant al que SÍ pertenece (Las Bambas) → 200 autorizado (vacío, sin
informes ahí); buscando por un tenant al que NO pertenece (Southern Copper)
→ 403 `no_pertenece_a_esa_unidad`; un usuario de una unidad distinta
intentando abrir directamente el informe de Antamina por id → 404
`report_not_found` (no revela ni existencia ni contenido). Datos de prueba
limpiados tras verificar (2 usuarios temporales, 3 filas de
`auth_user_tenant`, 2 informes).

**Status real: implemented — deuda técnica de este ADR cerrada por
completo.** `reports` ya se aísla exclusivamente por `tenant_id`, igual que
el resto de la plataforma; `company_name` sigue existiendo solo como
metadato de display, nunca como clave de acceso.

---
**Nota histórica (2026-07-13, antes del cierre completo de arriba)** — se
conserva por trazabilidad, ya no representa el estado real del sistema:

**Actualización 2026-07-13 (dual-write hacia adelante)**: al intentar ejecutar la
migración completa recomendada más abajo, se encontró que es **más profunda de lo
esperado**: la tabla `tenants` real solo tiene 5 filas (creadas para el RBAC
multitenant de esta sesión), mientras `auth_users.company_name` tiene ~40 valores
históricos distintos sin ningún tenant correspondiente — los 6 informes existentes NO
tienen forma de backfillearse sin **inventar** a qué tenant pertenece cada
`company_name` legacy, una decisión de negocio, no técnica.

Se implementó en su lugar la pieza segura: **dual-write hacia adelante**. `reports`
ya tenía una columna `tenant_id` (sin poblar). Ahora todo informe **nuevo** persiste
también el `tenant_id` real de la sesión que lo crea (`Report::tenantId`,
`backend/src/auth/auth_types.hpp`; poblado en
`report_routes.cpp::handleCreateReport` desde `session->tenantId`; INSERT en
`report_service.cpp::createReportPg`) — vacío → `NULL`, nunca inventado. Los 6
informes preexistentes quedan con `tenant_id NULL`, exactamente como antes, sin
ningún cambio de comportamiento para ellos.

Verificado end-to-end contra el backend real: usuario vinculado a un tenant real
(Antamina) vía `auth_user_tenant`, login real, `POST /api/reports` real → el informe
resultante quedó con `company_name='Minera Raura'` (legacy, sin cambios) **y**
`tenant_id` correctamente poblado con el UUID real de Antamina. Datos de prueba
limpiados tras verificar.

Esto no cierra la deuda completa (el puente `resolveAllowedReportCompany` sigue
siendo necesario para leer/buscar, ver más abajo) pero detiene la acumulación: cada
informe nuevo desde hoy ya tiene el dato correcto disponible para cuando el negocio
decida completar la migración de lectura.

**Status**: implemented — migración completa cerrada 2026-07-13 (ver
actualización al inicio del archivo). El status/nota original de abajo
("accepted como solución puente... deuda técnica de lectura documentada")
queda solo como registro histórico de la decisión intermedia.
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: reports / plataforma

> **Documenta y mitiga una desviación real frente al mandato de multitenancy por
> `tenant_id`** (`specs/adr/ADR-006` — "Todo dato de negocio incluye `tenant_id`. Toda
> query y endpoint filtra por tenant de sesión") y frente a ADR-035 ("Un tenant = una
> unidad minera... el `tenant_id` actual es la unidad de aislamiento"). Esta ADR es la
> respuesta explícita al pedido de auditar conflictos con decisiones previas.

## Contexto

El resto de la plataforma (mining/telemetría/alarmas/dispositivos) escopea
estrictamente por `tenant_id` (UUID), consistente con el mandato de multitenancy y con
ADR-029/035. La tabla `reports`, sin embargo, **predata ese modelo**: se construyó
originalmente escopeada por `company_name` (`character varying`), y hoy vive con esa
columna como clave de aislamiento — un mecanismo de multitenancy **paralelo y
distinto** al resto del sistema, no reconciliado hasta ahora.

Esta sesión implementó búsqueda **multitenant** de informes (un usuario que pertenece
a más de una unidad minera puede buscar informes de cualquiera de sus unidades, no
solo la activa). Migrar `reports.company_name` a `reports.tenant_id` habría sido la
solución arquitectónicamente correcta, pero es un cambio de esquema no trivial —
requiere backfill de datos existentes, tocar cada query de `report_service.cpp`, y
migrar el índice único que hoy depende de `company_name` — de un orden de riesgo
distinto al de la funcionalidad pedida (mismo criterio ya aplicado en ADR-033 para
diferir el rename de bases de datos: "difícil de revertir, afecta un sistema
compartido, amerita ventana y pruebas dedicadas, no un cierre apurado").

## Decisión

Se implementa un **puente de verificación** que permite honrar una búsqueda
cross-tenant por `company_name` **sin** migrar el esquema de `reports`, cerrando el
riesgo de IDOR que un puente ingenuo introduciría.

### `resolveAllowedReportCompany()` (`backend/src/reports/report_routes.cpp`)
Dado un query param `?company=X` en una request de búsqueda o lectura de informes:
1. Si `X` está vacío o es igual a `session.company` (la empresa por defecto de la
   sesión), se usa directamente — caso común, sin overhead.
2. Si `X` difiere, se verifica membresía real:
   `SELECT 1 FROM auth_user_tenant ut JOIN tenants t ON t.tenant_id = ut.tenant_id
   WHERE ut.user_id = $1 AND t.tenant_name = $2` — es decir, se confirma que el
   `tenant_name` solicitado corresponde a una unidad a la que el `user_id` de la
   sesión **realmente pertenece** (vía `auth_user_tenant`, el modelo de membresía real
   basado en `tenant_id`) antes de honrar el `company_name` pedido.
3. Si no hay membresía, `403 no_pertenece_a_esa_unidad` — nunca se ejecuta la query de
   informes con un `company_name` no verificado.

Esto se aplicó consistentemente a los **tres** puntos donde un `company_name` decide
qué informes son visibles: `GET /api/reports` (listado/búsqueda), `GET
/api/reports/{id}` (detalle — incluidas las subrutas `/revisions` y `/export/pdf`).
Un hallazgo real durante la verificación de esta pieza: el endpoint de detalle
inicialmente solo aplicaba este puente al listado, no a la apertura de un informe
específico — un resultado de búsqueda cross-tenant se encontraba correctamente, pero
al intentar **abrirlo** fallaba con `404` porque el detalle seguía filtrando solo por
`session->company` (el tenant activo, no el buscado). Corregido extendiendo el mismo
puente a los tres puntos.

### Reglas duras
- Ningún endpoint de informes ejecuta una query con un `company_name` de query param
  sin pasar primero por `resolveAllowedReportCompany()` (o su verificación
  equivalente).
- El frontend (`fetchReportById`, `fetchReports` en `ReportStudioV2/lib/api.ts`)
  reenvía el `company`/`company_name` del informe seleccionado como query param
  explícito — nunca asume que el tenant activo de la sesión coincide con el del
  informe que se está abriendo.

## Consecuencias

### Positivas
- Búsqueda y apertura de informes cross-tenant funcionan correctamente sin tocar el
  esquema de `reports` ni arriesgar una migración de datos en producción.
- El riesgo de IDOR que un puente ingenuo (confiar en `?company=X` sin verificar)
  habría introducido queda cerrado por la verificación de membresía real.

### Negativas / Trade-offs — deuda técnica explícita
- **La plataforma opera hoy con dos claves de aislamiento multitenant distintas y
  paralelas**: `tenant_id` (UUID, todo lo demás) y `company_name` (string, solo
  `reports`). Esto es una desviación real frente al mandato de multitenancy por
  `tenant_id` (`specs/adr/ADR-006`) — se documenta aquí en vez de dejarla implícita.
  El riesgo práctico no es un IDOR abierto (la verificación de membresía lo cierra),
  sino **complejidad cognitiva y de mantenimiento**: cualquier desarrollador nuevo que
  toque `reports/` debe saber que este módulo no sigue el patrón del resto del
  backend.
- Un `company_name` es mutable en teoría (renombrar una empresa) de una forma en que un
  `tenant_id` (UUID inmutable) no lo es — si `tenants.tenant_name` cambiara sin
  actualizar `reports.company_name` en cascada, informes existentes quedarían
  huérfanos de su unidad. No hay evidencia de que esto haya ocurrido, pero es un riesgo
  estructural del diseño actual que una migración a `tenant_id` eliminaría de raíz.

### Neutras
- El resto de la plataforma (mining/telemetría/alarmas) no se ve afectado — el puente
  es específico de `reports/`.

## Trabajo futuro recomendado (no implementado en esta sesión)

Migrar `reports.company_name` → `reports.tenant_id`, con:
1. Columna `tenant_id` nueva, backfill desde `company_name` vía join contra `tenants`.
2. Migrar cada query de `report_service.cpp` a filtrar por `tenant_id`.
3. Ventana de mantenimiento dedicada + verificación de que ningún informe queda sin
   `tenant_id` resuelto antes de eliminar `company_name`.
4. Mismo nivel de cautela que ADR-033 aplicó al diferir el rename de bases de datos:
   cambio de alto riesgo real, no cosmético, que merece su propia sesión de trabajo
   con ventana de prueba dedicada — **no se recomienda abordarlo apurado dentro de
   otra entrega**.

Hasta que esa migración ocurra, este ADR (039) es el que documenta y autoriza
explícitamente el puente `resolveAllowedReportCompany()` como la mitigación vigente.

## Alternativas descartadas

### Migrar `reports` a `tenant_id` ahora, dentro de esta misma sesión
Es la solución correcta a mediano plazo, pero de un orden de riesgo muy distinto al de
la funcionalidad pedida (búsqueda multitenant) — exactamente el mismo criterio que
ADR-033 ya usó para diferir el rename de bases de datos. Se prefiere resolver la
funcionalidad con un puente verificado y documentar la migración como trabajo futuro
explícito, no silencioso.

### Confiar en `?company=X` sin verificación de membresía
Habría sido un IDOR directo: cualquier usuario autenticado podría leer informes de
cualquier empresa con solo cambiar un query param. Rechazado sin ambigüedad.

## Referencias
- `db_scripts/45_adr039_migracion_completa_tenant_id.sql` (migración completa, nuevo)
- `backend/src/reports/report_routes.cpp` (`resolveAllowedReportTenant`,
  `handleGetReports`, `handleGetReportById`, `handleCreateReport`,
  `handleUpdateReport`, `handleDeleteReport` — todos migrados a `tenant_id`)
- `backend/src/reports/report_service.hpp/.cpp` (las 5 funciones migradas de
  `company` a `tenantId`)
- `backend/src/auth/permissions.hpp/.cpp` (`userHasRealTenantMembership`, nuevo
  — distingue tenant real de fallback demo)
- `backend/src/auth/auth_storage_pg.cpp` (`resolveTelemetryTenantIdPg`,
  `kMiningTelemetryDemoTenantId` — origen del fallback que motivó
  `userHasRealTenantMembership`)
- `frontend/src/components/ReportStudioV2/lib/api.ts` (`fetchReports`,
  `fetchReportById` — ahora envían `tenant_id`)
- `frontend/src/components/ReportStudioV2/components/modals/ReportsAdminModal.tsx`
  (selector de unidad minera en la búsqueda, ahora envía `tenant_id`)
- `specs/adr/ADR-006` (mandato de multitenancy por `tenant_id`, sistema de ADR previo
  al log único de `docs/decisions/`)
- ADR-029 (identidad/tenant_id de sesión), ADR-033 (mismo criterio de diferir cambios
  de alto riesgo), ADR-035 (tenant = unidad minera), ADR-038 (mismo principio de
  "nunca confiar en un tenant/company del cliente sin verificar" aplicado a
  delegación de acceso)
