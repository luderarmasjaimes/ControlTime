# ADR-188 — Reconstrucción real del tab "Cálculo" sobre el motor de fórmulas de ADR-187

**Status**: implemented (P1 + cierre del gap de seguridad de autorización por tenant), pendiente verificación E2E en vivo del developer sobre el flujo completo con sesión real

**Fecha**: 2026-09-14

**Actualización 2026-09-14 (segunda pasada, mismo día): cerrado el gap de
autorización por tenant que P1 había dejado documentado como fast-follow.**
A pedido explícito del developer de implementar lo que quedaba pendiente.
Las rutas de lienzo del sidecar (`GET /api/state`, `POST /api/block`,
`/api/block/delete`, `/api/connection`, `/api/connection/update`,
`/api/connection/delete`, `GET /api/rules`, `POST /api/rule`,
`/api/rule/delete`) ahora validan, en cada request, que el `sensor_id`
codificado en el `diagram_id` (o resuelto por join a través de
`blocks`/`connections`/`rules`) pertenezca al tenant real de quien llama:

- `resolveSessionTenantId()` (nuevo, `formula_engine/src/main.cpp`) llama a
  `GET /api/internal/resolve-session` en el backend principal (`web:8081`,
  alcanzable directo dentro de la red Docker por defecto de compose, sin
  pasar por nginx), reenviando el header `Cookie` de la request original tal
  cual, más el segundo factor `X-Internal-Token` (mismo secreto compartido
  `AUTH_TOKEN`/`BEEMETRY_FORMULA_AUTH_TOKEN` que el sidecar ya usaba para su
  propia auth de WebSocket).
- `sensorBelongsToTenantId()` confirma contra la tabla `sensors` real (ya
  alcanzable, misma base desde el repunte de P1) que ese sensor pertenece al
  tenant resuelto.
- `authorizeDiagram()`/`authorizeByLookup()` (helpers nuevos) envuelven ambos
  pasos con **fail-closed en todos los casos ambiguos**: `diagram_id` con
  formato viejo/vacío → `400 invalid_diagram_id`; sin sesión resoluble (sin
  cookie, cookie inválida, o backend principal inalcanzable) → `401
  unauthorized`; sensor de otro tenant → `403 sensor_not_in_tenant`. Nunca se
  asume autorizado por defecto.
- Casos reforzados más allá del chequeo obvio: en el upsert de `/api/block`
  (`INSERT ... ON CONFLICT DO UPDATE`, que nunca reescribe la columna
  `diagram_id` de una fila existente), la autorización se hace contra el
  `diagram_id` YA GUARDADO del bloque si ya existe -- no contra el del
  payload -- para que un `id` de bloque ajeno adivinado no pueda
  actualizarse pasando un `diagram_id` propio en el body. Mismo criterio en
  `POST /api/rule`: en un UPDATE (id de regla presente) se autoriza tanto el
  `block_id` destino del payload como el bloque ORIGINAL de la regla que se
  sobreescribiría, para que no sea secuestrable vía un `id` de regla
  adivinado. `GET /api/rules` sin `block_id` (listado global) dejó de
  devolver las reglas de TODOS los tenants sin distinción -- ahora filtra
  por el tenant real resuelto (`JOIN sensors ON ... tenant_id = $1`).
- Verificado en vivo (sin sesión): `GET /formula-api/api/state?diagram_id=sensor_<uuid-real>`
  → `401 {"error":"unauthorized"}` (antes de este cambio hubiera devuelto
  200 con los bloques/conexiones reales, sin pedir nada). `diagram_id` con
  formato legado (`emp1_mina2`) → `400 {"error":"invalid_diagram_id"}`.
  Verificación con sesión real (que un usuario del tenant correcto sí pueda
  leer/escribir su propio diagrama, y que otro tenant reciba 403) queda para
  cuando el developer lo pruebe con su login real -- no se tiene una sesión
  de prueba disponible en este entorno de verificación.

**Ámbito**: core-iot

**Relación**: extiende ADR-187 (motor de fórmulas real, `sensor_formula_def`/
`sensor_input_parameter_def`, evaluador tinyexpr) y **revierte parcialmente**
una de sus decisiones ("Alternativas descartadas": no tocar el tab legado
"Formula"). No modifica ADR-034 (identidad/credenciales de dispositivo) ni
ADR-140 (motor de alarmas).

## Contexto

El toolbar "PARAMS" del tab legado "Cálculo" (`FormulaEngineEmbed.tsx` →
`frontend/public/formula/index.html`+`app.js`, iframe hacia el sidecar C++
`formula_engine/`) pedía seleccionar Empresa Minera y Unidad Minera antes de
poder hacer nada. El developer reportó esto como un error: ese contexto ya
se conoce por la sesión de login, no debería volver a pedirse.

Investigación previa a construir nada (ver también
[docs/INFORME_SESION_MOTOR_FORMULAS_ADR187_2026-09-14.md](../INFORME_SESION_MOTOR_FORMULAS_ADR187_2026-09-14.md)
para la cronología completa de la sesión anterior que construyó ADR-187):

1. **La identidad de cada diagrama guardado era `emp{empresa_id}_mina{mina_id}`**
   (`app.js`, `diagramContextKey()`) — esos IDs venían de un catálogo de
   demostración fabricado (`mineria_empresas`/`mineria_minas`/`mineria_variables`/
   `mineria_sensores`/`mineria_lecturas`, con datos de ejemplo de mineras
   peruanas — ANTAMINA, etc.), en su **propia base Postgres** (`formula_db`,
   contenedor `beemetry-formula-db`), completamente aislada de `beemetry-db`
   (la base real con `sensors`/`telemetry_fact`). Quitar los selectores no
   era cosmético: requería decidir una nueva identidad real para cada
   diagrama.
2. **La "lógica de fórmula" de ese editor nunca se evaluaba en ningún lado.**
   Exploración exhaustiva de `formula_engine/src/main.cpp` y `app.js`: la
   tabla `rules(block_id, expr)` solo se leía/escribía por su propio CRUD,
   nunca se parseaba ni evaluaba — ni servidor (C++) ni cliente (JS, que solo
   hacía split de texto para un preview cosmético). El único cómputo real
   era `POST /api/analysis/temperaturas`, un endpoint hardcodeado que
   llamaba a `sp_proceso_temperatura(...)` sobre `mineria_lecturas` (datos
   sintéticos de temperatura). Es decir: la pantalla que debía mostrar "la
   lógica de cálculo de la fórmula" nunca calculó nada de verdad.
3. El motor real de ADR-187 (tinyexpr, poller de 10s, `sensor_formula_def`)
   ya resuelve exactamente ese problema, contra sensores reales — reinventar
   un segundo evaluador de expresiones dentro del sidecar C++ hubiera
   duplicado trabajo ya construido y verificado en producción.
4. `GET /api/mining/telemetry/wizard/catalog` (usado por
   `ZoneSensorPicker.tsx` en el SPA para el wizard de gráficos multi-sensor)
   ya resolvía **exactamente** el flujo tipo→zona→sensor pedido, contra
   sensores reales, sin selectores de contexto (`resolveAllowedSensorTenant`
   ya sabe el tenant por la cookie de sesión).
5. No existía ningún catálogo gobernado de "tipo de sensor → parámetros
   habilitados". `sensors.sensor_type` es texto libre. `mining_sensor_types`
   (usado por `GET /api/mining/sensors`, `sensor_service.cpp`) es un
   catálogo de un sistema DEMO totalmente distinto (alimenta
   `telemetry_fact_demo`, nunca los sensores/telemetría reales) — no se
   reusó.
6. Los permisos `formula.view`/`formula.edit` ya estaban sembrados en
   `platform_permissions` (`db_scripts/42`) pero **nunca se usaban** en
   ningún `hasPermission(...)` del código — el gate obvio, ya disponible,
   para el "admin de plataforma" que el developer pidió para controlar qué
   parámetros están habilitados por tipo de sensor.

## Decisión

El sidecar `formula_engine/` (lienzo de bloques/conexiones con render 3D
OpenCV + colaboración WebSocket) se conserva **como capa visual**, pero deja
de operar sobre el catálogo fake:

### 1. Catálogo nuevo: tipo de sensor → parámetros habilitados

`db_scripts/94_sensor_type_parameter_catalog.sql`, en `beemetry-db`:
`sensor_type_def(type_code, display_name, description)` +
`sensor_type_parameter_def(type_code, param_key, data_type, is_enabled,
sort_order, description)`. Backfill automático de `sensor_type_def` con los
valores distintos ya usados en `sensors.sensor_type` (sin FK todavía —
aditivo, no rompe sensores con tipos no catalogados). No reemplaza
`sensor_input_parameter_def`/`_value` (ADR-187, valor real por sensor) — es
la plantilla que decide qué claves se OFRECEN al configurar un sensor de ese
tipo.

`backend/src/mining/sensor_type_catalog_routes.{hpp,cpp}` (nuevo):
- `GET /api/mining/sensor-types` — catálogo completo + parámetros
  habilitados, sesión válida (paridad con `GET /api/mining/formulas`).
- `PUT /api/mining/sensor-types/{type_code}/parameters` — upsert/enable-
  disable, gateado por `auth::hasPermission(..., "formula.edit")`. **Este es
  el "admin de plataforma"** que el developer pidió.

### 2. Resolución de sesión servicio-a-servicio para el sidecar

`frontend/nginx.conf` sobrescribe `Authorization` en `/formula-api/` con un
secreto fijo compartido (`BEEMETRY_FORMULA_AUTH_TOKEN`, autenticación
servicio-a-servicio histórica) — pero la cookie de sesión real SÍ llega
intacta (nginx no la limpia). `backend/src/mining/internal_session_routes.{hpp,cpp}`
(nuevo) expone `GET /api/internal/resolve-session`, protegido por el mismo
`BEEMETRY_FORMULA_AUTH_TOKEN` en el header `X-Internal-Token` (segundo
factor server-to-server), que reusa `auth::resolveAuthSession` tal cual la
usa cualquier handler real — para que el sidecar pueda, a futuro, resolver
tenant/usuario real a partir de esa cookie reenviada sin reimplementar el
parseo de JWT en C++. **Fast-follow**: el sidecar todavía no LLAMA a este
endpoint (ver Consecuencias) — queda construido y listo para la siguiente
pasada de hardening.

### 3. Sidecar `formula_engine`: repunte de base de datos

`docker-compose.yml`: `DATABASE_URL` de `formula_engine` pasa de apuntar a
`formula_db` (propia, fake) a `pgbouncer`/`sensors_db` (la real, mismo host
que usa `web`). `ensure_tables()` (`main.cpp`) ya no crea `formula_sessions`
(tabla de "sesiones de análisis" fake, con columnas `empresa_id`/`mina_id`);
sí crea (nuevo) `operators` con el mismo seed de operadores aritméticos/
lógicos/funciones que antes vivía en `formula_db/init.sql` — es vocabulario
agnóstico de sensor, sigue siendo legítimo. Las tablas `blocks`/
`connections`/`rules`/`events` no cambiaron de esquema: ya tenían una
columna `diagram_id TEXT` genérica — solo cambia el VALOR que el frontend le
pone.

Se retiraron por completo (sin reemplazo 1:1, porque nunca operaron sobre
datos reales): `GET /api/catalogos`, `GET /api/sensores`, `GET /api/analysis/catalogos`,
`POST /api/analysis/temperaturas`, `POST /api/analysis/guardar`, `GET /api/analysis/sesiones`,
`GET /api/analysis/sesiones/:id`, `POST /api/analysis/sesiones/:id/restaurar`.
`GET /api/variables` queda como código muerto inalcanzable (nada lo llama ya)
en vez de eliminarse, para no tocar más superficie del archivo legado de la
necesaria.

### 4. Frontend legado: tipo→zona→sensor real + "Guardar fórmula"

`frontend/public/formula/index.html`: toolbar "PARAMS" pasa de
`ctxEmpresa`/`ctxMina`/`ctxSensor` a `ctxTipoSensor`/`ctxSensor` (agrupado
por zona vía `<optgroup>`). Se retiraron los botones "⚗ Análisis SP" y
"🔍 Buscar Historial" (y su modal completo, ~330 líneas) — dependían por
completo de los endpoints retirados arriba. Nuevo botón "💾 Guardar
fórmula".

`frontend/public/formula/app.js`:
- `initContextSelectors()` reescrito: consume `GET /api/mining/telemetry/wizard/catalog`
  (con y sin `?sensor_type=`), agrupa sensores por `zone_name` igual que
  `ZoneSensorPicker.tsx::buildGroups()` (mismo criterio, portado a JS
  plano). `getDiagramId()`/`diagramContextKey()` ahora devuelven
  `'sensor_' + sensor_id` (UUID real) en vez de `'emp{X}_mina{Y}'` — un
  diagrama por sensor real, coincide 1:1 con cómo ya vive una fórmula por
  sensor en `sensor_formula_def`.
- `loadAllowedParamsForSensor()` (nuevo, compartida): variables usables =
  parámetros numéricos ya configurados en el sensor (`GET .../parameters`,
  ADR-187) filtrados por los habilitados en el catálogo de su tipo (`GET
  /api/mining/sensor-types`, ADR-188) — si el tipo aún no tiene catálogo
  cargado, no bloquea, ofrece lo que el sensor ya tiene. Reemplaza la lista
  fija anterior (`GET /api/variables`, "temperatura"/"humedad" genéricos sin
  relación con nada real) tanto en la paleta de la izquierda
  (`loadVariables()`, ahora se refresca en cada cambio de sensor) como en el
  formulario nuevo de guardado.
- Botón "Guardar fórmula": abre un formulario compacto (nombre, código de
  canal, expresión tinyexpr, límites warning/error) y hace
  `POST /api/mining/devices/{sensor_id}/formulas` (endpoint real de
  ADR-187) usando `X-CSRF-Token` (cookie `beemetry_csrf_token`, mismo patrón
  double-submit que `authApi.ts::csrfHeaders()`) — la fórmula guardada la
  evalúa de inmediato el poller real de 10s, cerrando un ciclo que el tab
  legado nunca tuvo.
- Los mensajes de guardia ("Seleccione empresa y mina...") se actualizaron a
  "Seleccione un tipo de sensor y un sensor...".

## Consecuencias

- El lienzo de bloques/conexiones/decisiones sigue siendo puramente visual
  (posiciones, colores, etiquetas) — no ejecuta la lógica de la fórmula; la
  ejecución real vive en `sensor_formula_def` + el evaluador de ADR-187, no
  en el diagrama. Esto es consistente con el estado real de la herramienta
  ANTES de este cambio (nunca ejecutó nada), pero es un cambio de expectativa
  frente a lo que un usuario podría asumir mirando un editor de diagramas de
  flujo — documentado acá para que quede explícito.
- **Gap de seguridad cerrado (actualización 2026-09-14, segunda pasada)**:
  las rutas del sidecar (`/api/state`, `/api/block`, `/api/block/delete`,
  `/api/connection`, `/api/connection/update`, `/api/connection/delete`,
  `/api/rules`, `/api/rule`, `/api/rule/delete`) ahora validan en cada
  request que el `sensor_id` involucrado pertenece al tenant real de quien
  llama, vía `GET /api/internal/resolve-session` + `sensors.tenant_id` — ver
  el bloque de actualización arriba para el detalle técnico completo y la
  verificación en vivo (401 sin sesión, 400 en formato de `diagram_id`
  legado). Antes de este cierre, un usuario autenticado de otro tenant
  hubiera podido leer/escribir la posición/etiqueta/color de bloques de un
  diagrama ajeno si adivinaba el UUID real de un sensor de otro tenant (no
  podía descubrirlo por la UI) — nunca expuso telemetría, fórmulas reales,
  ni resultados, porque esos siguen viviendo exclusivamente en el backend
  principal (ADR-187), no en el sidecar.
- Diagramas guardados bajo la vieja clave `emp{X}_mina{Y}` (en `formula_db`,
  ahora desconectada) quedan huérfanos — costo aceptado explícitamente por
  el developer al pedir la reescritura de fondo.
- `formula_db` (contenedor, volumen, credenciales) sigue definido en
  `docker-compose.yml` pero ya no lo usa nada — **no se retiró en esta
  pasada** (requiere confirmación explícita antes de borrar un volumen que
  podría tener datos que alguien quiera exportar primero).

## Fuera de alcance (fast-follow explícito, no construido en esta pasada)

- Retirar definitivamente `formula_db`/su volumen Docker y las tablas
  `mineria_*`/`init.sql`/`init_minas.sql`/`add_sensores.sql` que ya no las
  usa nada.
- Exponer `sensor_type_parameter_def` como mejora del selector de
  parámetros de `SensorManagementView.tsx` (hoy sigue siendo texto libre en
  esa pantalla — el catálogo de tipos solo se usa desde el tab "Cálculo"
  reconstruido).
- Migrar/retirar `frontend/public/formula/analisis.html` (página estática
  aparte, dependía de `/api/analysis/temperaturas`, quedó huérfana — no se
  tocó ni se referencia más desde el toolbar).
- Una interfaz de administración dedicada (pantalla, no solo el endpoint
  `PUT /api/mining/sensor-types/{type}/parameters`) para que un admin
  gestione el catálogo de tipos/parámetros visualmente.

## Alternativas descartadas

- **Portar un evaluador de expresiones al sidecar C++** (para que el
  lienzo de bloques ejecutara de verdad su propia lógica): descartado —
  hubiera duplicado `tinyexpr`/`sensor_formula_evaluator.cpp` (ADR-187), ya
  construido, verificado y corriendo contra sensores reales.
- **Mantener el catálogo `mineria_*`/`formula_db` y solo ocultar los
  selectores con valores por defecto**: descartado — el developer pidió
  explícitamente la reescritura de fondo tras confirmársele que los
  selectores no eran cosméticos.
- **Migrar los diagramas `emp_mina` existentes al nuevo esquema por
  sensor**: descartado — no hay ninguna correspondencia real entre una
  empresa/mina fake y un sensor real; no existe una migración con sentido,
  solo re-creación manual si alguien la necesita.

## Referencias

- `backend/src/mining/sensor_type_catalog_routes.hpp`/`.cpp` (nuevo)
- `backend/src/mining/internal_session_routes.hpp`/`.cpp` (nuevo)
- `db_scripts/94_sensor_type_parameter_catalog.sql` (nuevo)
- `formula_engine/src/main.cpp` (`ensure_tables()`, endpoints retirados)
- `docker-compose.yml` (`formula_engine.environment.DATABASE_URL`,
  `depends_on`, healthcheck)
- `frontend/public/formula/index.html`/`app.js` (toolbar, `initContextSelectors()`,
  `loadAllowedParamsForSensor()`, botón "Guardar fórmula")
- `frontend/src/components/ReportStudioV2/components/layout/ZoneSensorPicker.tsx`
  (patrón de agrupación por zona replicado en JS plano)
- `backend/src/mining/sensor_telemetry_wizard.cpp`
  (`GET /api/mining/telemetry/wizard/catalog`, reusado tal cual)
- `frontend/src/auth/authApi.ts` (`csrfHeaders()`, patrón replicado en `app.js`)
- ADR-187 (`administracion-sensores-motor-formulas-tiempo-real`)
- [docs/INFORME_SESION_MOTOR_FORMULAS_ADR187_2026-09-14.md](../INFORME_SESION_MOTOR_FORMULAS_ADR187_2026-09-14.md)
