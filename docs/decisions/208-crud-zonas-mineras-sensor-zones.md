# ADR-208 — CRUD real de zonas mineras sobre `sensor_zones`

**Status**: implemented, verificado en build real (`docker build -f backend/Dockerfile.verify`, 100% tests) — pendiente verificación E2E en vivo contra Postgres con el tenant Alpayana.

**Fecha**: 2026-09-23

**Ámbito**: core-iot

**Relación**: extiende `db_scripts/54_sensor_zones_and_grouping.sql` (ADR
implícito de esa migración — catálogo `sensor_zones` sembrado por SQL) y
ADR-034 (identidad/credenciales de dispositivo, mismo patrón de sesión/
permiso que usa `device_alarm_routes.cpp`). No modifica el esquema.

## Contexto

Se pidió confirmar si la creación de zonas mineras estaba implementada al
100% para grabar una demo para el cliente Alpayana. Auditoría de código
(no solo de ADRs) encontró que **no lo estaba**: `sensor_zones` existía
como catálogo fijo, sembrado una sola vez por `db_scripts/54` (4 cuadrantes
automáticos por centroide + "Sin zona asignada"), y el único endpoint de
escritura relacionado era `PUT /api/mining/devices/{id}`, que permite
reasignar el `zone_id` de un sensor a una zona **ya existente** — no había
manera de crear, renombrar ni borrar una zona desde la plataforma. El
frontend (`ZoneSensorPicker.tsx`, `SensorManagementView.tsx`) solo consumía
zonas de lectura vía `GET /api/mining/telemetry/wizard/catalog`.

## Decisión

Se agrega CRUD completo de `sensor_zones`, mismo criterio de sesión/permiso
(`dispositivos.manage`) y patrón SQL (`PQexecParams` parametrizado,
tenant-scoped) que el resto de `device_alarm_routes.cpp`:

- `GET /api/mining/zones` — lista zonas del tenant + `sensor_count` por
  zona (subquery, no JOIN, para no duplicar filas).
- `POST /api/mining/zones` — crea `{code, name_es, sort_order?}`;
  violación de `UNIQUE(tenant_id, code)` se reporta como `409 zone_code_ya_existe`,
  no como 500.
- `PUT /api/mining/zones/{id}` — actualización parcial (`COALESCE`, mismo
  patrón que `handleUpdateDevice`) de `name_es`/`code`/`sort_order`.
- `DELETE /api/mining/zones/{id}` — borra la zona; los sensores que la
  tenían asignada quedan con `zone_id = NULL` ("Sin zona asignada" en la
  UI) vía el `ON DELETE SET NULL` que la FK ya declaraba desde
  `db_scripts/54` — no hace falta reasignar a mano ni se bloquea el borrado.

Frontend: `SensorManagementView.tsx` gana un panel "Zonas mineras"
(colapsable, mismo patrón visual que el panel "Registrar sensor") con
listado + renombrar inline + eliminar (con confirmación, avisando cuántos
sensores quedarán sin zona) + formulario de alta. `zones` ahora se carga
desde `GET /api/mining/zones` (antes `wizard/catalog`, que solo traía un
subconjunto de solo lectura sin `sensor_count`) — sin cambio funcional para
el resto de la pantalla, que solo usaba `id`/`code`/`name_es`.

## Evidencia de código

- `backend/src/mining/device_alarm_routes.cpp` — `handleListZones`,
  `handleCreateZone`, `handleUpdateZone`, `handleDeleteZone`, registradas en
  `registerRoutes()`.
- `frontend/src/components/ReportStudioV2/components/views/SensorManagementView.tsx` —
  panel "Zonas mineras" + `createZone`/`startEditZone`/`saveZoneEdit`/`deleteZone`.

## Verificación

`docker build -f backend/Dockerfile.verify --no-cache` (contexto `backend/`,
ver `[[project_backend_verify_build]]`): build limpio, `beemetry_backend` y
`beemetry_backend_tests` linkean sin error, **100% tests passed** (suite
existente, sin regresión). `npx tsc --noEmit` sobre
`SensorManagementView.tsx`: sin errores nuevos.

**Pendiente**: verificación E2E en vivo (crear zona → reasignar sensor →
confirmar en UI/BD → renombrar → eliminar) contra el stack Docker real con
el tenant Alpayana (usuario `09637521`), con evidencia grabada — es el
siguiente paso de esta sesión, no cerrado todavía por este ADR.
