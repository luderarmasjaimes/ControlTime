# ADR-187 — Pantalla de administración de sensores + motor de fórmulas en tiempo real (parámetros por dispositivo)

**Status**: implemented, verificado E2E en vivo (2026-09-14) — Entregables A y B completos (P0-P4)

**Fecha**: 2026-09-14

**Actualización 2026-09-14 (misma fecha, segunda pasada): Entregable B
construido completo.** A pedido explícito del developer de completar el
motor de fórmulas de una vez y dejarlo probado. Fases P2-P4 implementadas
(`sensor_input_parameter_value`, `sensor_formula_def`, `tinyexpr` vendoreado,
hilo evaluador, endpoints CRUD, pestañas "Parámetros de fórmula"/"Fórmulas y
resultados" en `SensorManagementView.tsx`) y verificadas en vivo contra el
backend real con datos reales, no solo compiladas — ver Verificación. El tab
legado "Formula" (`mineria_sensores`) permanece oculto, sin cambios — el
developer confirmó explícitamente no habilitarlo.

**Actualización 2026-09-14 (misma fecha, tercera pasada): reversión parcial
de la decisión anterior sobre el tab legado + vista nueva de nivel
superior.** El developer pidió explícitamente habilitar el tab "Formula"
legado (el que existía antes en el menú) **y además** un acceso de nivel
superior al motor real — no quería tener que entrar sensor por sensor para
ver sus fórmulas. Dos cambios, ambos en el grupo de nav `ingenieria`
(visible sin gate de permiso, igual que ya era el caso para ese grupo):

1. **`NavBar.tsx`**: descomentado el tab `Formula` (editor legado sobre
   `mineria_sensores`, sin cambios de código propios — nunca se había tocado
   su implementación, solo estaba oculto del menú).
2. **`FormulaOverviewView.tsx`** (nuevo) + `GET /api/mining/formulas`
   (nuevo, ruta exacta, sin prefijo — no colisiona con
   `/api/mining/devices/`): lista TODAS las fórmulas del tenant en una sola
   consulta (`sensor_formula_def` + `sensors` + `sensor_output_channel_def`
   + último resultado vía `LEFT JOIN LATERAL` sobre `telemetry_multivariate`),
   con búsqueda y filtro por estado. Nuevo ítem de nav `FormulaOverview`
   ("Fórmulas de Sensores", icono `Calculator` — deliberadamente distinto
   del `Sigma` del tab legado para no confundirlos visualmente). Botón
   "Administrar sensores" navega a `DeviceManagement` (donde sigue viviendo
   el alta/edición real, por sensor); sin fórmulas creadas, muestra un CTA
   directo a esa pantalla.

Verificado en vivo: sensor `demo-vib-01` registrado, lectura real de prueba
(`8.4`), parámetro `factor_calibracion=1.15`, fórmula
`value * factor_calibracion` con `warning_high=9`/`error_high=12` →
resultado `9.66` con `status='warning'` visible en la nueva vista de
nivel superior, sin haber tenido que entrar a `SensorManagementView`. Este
sensor/fórmula se dejaron activos a propósito (no se limpiaron) para que
quede un ejemplo real y funcionando visible de inmediato.

**Ámbito**: core-iot

**Relación**: extiende ADR-034 (identidad/credenciales de dispositivo sobre
`sensors`) y ADR-140 (evaluador de reglas de alarma, umbral simple); no
modifica ninguno de los dos. Descarta explícitamente reutilizar
`backend/src/formula/formula_routes.cpp`/`formula_engine/` (ver Alternativas
descartadas).

## Contexto

La plataforma ya podía registrar dispositivos (`POST /api/mining/devices/register`,
ADR-034), listar/revocar (`GET`/`POST /api/mining/devices`) y configurar
umbrales de alarma (`AlarmConfigView.tsx`, un sensor + un operador + un
umbral numérico). Pero no existía:

1. Una pantalla que uniera registro + prueba de conexión + edición de
   parámetros del sensor (zona, geolocalización, etiqueta, número de serie,
   id externo) — las columnas ya existían en `sensors`
   (`db_scripts/18`/`39`/`54`), pero ningún endpoint las exponía para
   escritura después del registro inicial.
2. Una forma de volver a probar un dispositivo ya registrado: la
   `device_api_key` se muestra una sola vez (solo se persiste su hash
   SHA-256) y no existía manera de emitir una nueva sin chocar con la
   restricción `UNIQUE(tenant_id, sensor_code)` al intentar re-registrar.
3. Cualquier mecanismo que combine telemetría en tiempo real + parámetros
   propios de cada dispositivo + umbrales para calcular uno o más resultados
   derivados, con estado ok/warning/error. Se investigaron los dos sistemas
   existentes con nombre "formula" (`backend/src/formula/formula_routes.cpp`
   → `/api/analysis/*`, y el sidecar Docker `formula_engine/` detrás del tab
   "Formula" — oculto del menú, sin ADR que documente por qué) y **ambos
   operan sobre un catálogo legado y desconectado**
   (`mineria_empresas`/`mineria_sensores`, ids `SERIAL` propios, datos de
   ejemplo sembrados por empresa, **sin FK ni columna que los vincule** con
   la tabla `sensors` real — confirmado en
   `db_scripts/09_formula_mining_reports.sql:40-42`). Ninguno de los dos
   sirve para lo que se necesita acá.

Existía además esquema ya diseñado para exactamente este caso de uso, nunca
implementado: `sensor_input_parameter_def`, `sensor_output_channel_def`,
`telemetry_multivariate` (`db_scripts/17_telemetry_multivariate_sensor_specs.sql`),
documentado como aspiracional en
`docs_/02_Arquitectura/DIAGRAMA_ARQUITECTURA_BD.md:566-610` — confirmado por
grep exhaustivo que ningún archivo de `backend/src` los lee ni escribe.

## Decisión

### Entregable A — pantalla de administración de sensores (implementado)

Nueva vista `frontend/src/components/ReportStudioV2/components/views/SensorManagementView.tsx`
(mismo patrón visual/CRUD que `AlarmConfigView.tsx`), alcanzable desde el
nuevo ítem de nav "Sensores" (`NavBar.tsx`, grupo `mantenimiento`, gate
`canMaintain` — extendido para incluir `dispositivos.manage`). Reutiliza
`GET/POST /api/mining/devices*` existentes y agrega:

- **`PUT /api/mining/devices/{id}`** — actualización parcial de
  `zone_id`/`lat`/`lng`/`label`/`serial_number`/`external_id` (columnas ya
  existentes, sin migración). Solo toca campos presentes con valor no nulo
  (`COALESCE` del lado SQL); un campo ausente deja el dato actual sin
  cambios.
- **`POST /api/mining/devices/{id}/rotate-key`** — emite una
  `device_api_key` nueva para un sensor ya registrado (mismo patrón de
  generación/hash que el registro), sin pasar por `handleRegisterDevice`
  (evita el conflicto `UNIQUE` de `sensor_code`). Despachado **dentro** de
  `handleRevokeDevice` por sufijo de path (`.../rotate-key` vs. bare `{id}`)
  en vez de una segunda ruta de prefijo — `/api/mining/devices/` ya está
  tomado como prefijo `POST` por el revoke, y `Router` resolvería una
  segunda ruta de prefijo ahí como ambigua.
- **"Probar ahora"**: la pantalla hace `POST /api/mining/telemetry`
  directamente con la key recién emitida, con `credentials:'omit'` y sin
  header `Authorization` — **deliberado, no un descuido**: esa ruta se
  autentica solo por `X-Device-Key`, pero el *router* aplica su chequeo CSRF
  (ADR-082) a cualquier POST cuyo token de auth resuelva por cookie; si esta
  llamada reusara el `fetch` de sesión normal de la pantalla (que sí manda
  cookies), una cookie de sesión del propio admin activaría ese chequeo
  sobre una ruta que no tiene nada que ver con sesiones de usuario.
  Reproducido en vivo mientras se armaba
  `external-api-test-page/phone-sensor-test.html` (mismo patrón `deviceFetch()`
  ahí).
- `GET /api/mining/devices` extendido para devolver también
  `unit`/`zone_id`/`lat`/`lng`/`label`/`serial_number`/`external_id` — antes
  no los devolvía, así que el formulario de edición no tenía forma de
  mostrar los valores ya configurados.
- "Configurar umbrales →" navega a `AlarmConfig` (`setActiveTab`, mismo
  patrón que `AlarmCenter.onCreateReportFromAlarm`) en vez de duplicar la UI
  de umbrales.
- Panel de "lecturas recientes" reusa `GET /api/mining/telemetry/wizard/query`
  (ya usado por los gráficos de ReportStudioV2) — min/máx/promedio de los
  últimos 7 días del sensor seleccionado.

**Bug real encontrado y corregido durante la verificación en vivo**:
`TelemetryIngestor::resolveSensor()` solo consulta `sensor_cache_`, cargada
una única vez en `start()` (`loadSensorCache()`,
`backend/src/mining/telemetry_ingest.cpp`) y nunca refrescada — comentario
preexistente la describía como "inmutable tras start() (lecturas
concurrentes seguras)". Efecto real: **cualquier** sensor registrado después
de que el proceso arrancó quedaba invisible para la ingesta ("sensor
desconocido") hasta el próximo reinicio del backend — el propio botón
"Probar ahora" de esta pantalla lo reproducía en el momento, con la
respuesta HTTP además mal rotulada (`ingest_queue_full` en vez de reflejar
la causa real, `dropped_unknown`). No es un bug introducido por este cambio:
es preexistente desde ADR-034, solo nunca se había ejercitado un registro
seguido de una prueba de ingesta real en la misma sesión de proceso.
Corregido con `TelemetryIngestor::refreshSensorCache()` (nuevo método
público) llamado al final de `handleRegisterDevice` tras el INSERT exitoso:
`loadSensorCache()` ahora arma el mapa en una variable local y hace
`swap()` bajo un `std::shared_mutex` nuevo (`cache_mtx_`) — lock compartido
barato en el hot path de `resolveSensor()` (25k lecturas/seg), lock
exclusivo solo durante el swap (no durante las ~28k filas del query).
Verificado en vivo: sensor registrado → "Probar ahora" → `202 Accepted` →
`connection_status` a `online` en segundos, sin reiniciar el proceso.

### Entregable B — motor de cálculo por fórmula (implementado)

Activa y extiende el esquema dormido de `db_scripts/17` en vez de inventar
uno paralelo:

- **`sensor_input_parameter_value`** (tabla nueva, hermana de
  `sensor_input_parameter_def`): `(sensor_id, param_key, value jsonb,
  updated_at, updated_by)` — el valor real configurado por dispositivo; la
  definición existente solo tenía `default_value`.
- **`sensor_formula_def`** (tabla nueva): `(formula_id, sensor_id,
  formula_name, expression text, output_channel_code, warning_low/high,
  error_low/high, enabled)` — una fórmula por fila, un canal de salida cada
  una; los límites de warning/error viven acá (no en
  `sensor_output_channel_def`, que queda como definición pura de forma/
  unidad).
- **Evaluación de expresiones: `tinyexpr`** (vendored,
  `backend/third_party/tinyexpr/`, zlib) — compila una vez (`te_compile`
  devuelve `NULL` en una expresión inválida, rechazada en el CRUD con 400,
  nunca llega al evaluador), variables nombradas atadas a `double*`, sin
  ejecución de código arbitrario ni I/O.
- **El evaluador corre en un hilo periódico propio** (mismo patrón que el
  poller de 10s de alarmas, `evaluateRulesOnce`), **no** enganchado a
  `TelemetryIngestor::setOnBatchCommitted` — ese callback es un único
  `std::function` ya tomado por el motor de alarmas; ampliarlo a una lista
  es cirugía real sobre un tipo usado a 25K filas/seg, y esta función no
  necesita latencia sub-segundo.
- **Sink de resultados**: `telemetry_multivariate` + columna nueva
  `status text CHECK(status IN ('ok','warning','error'))`.
- Nuevos endpoints `GET/PUT .../parameters`, `GET/POST/PUT/DELETE .../formulas`,
  `GET .../formula-results`, todos bajo `dispositivos.manage` (permiso ya
  existente, su descripción en el seed ya cubre "fuentes de protocolo" —
  suficientemente amplia, no se crea un permiso nuevo). Registrados desde
  `sensor_formula_routes.cpp`, pero despachados en su mayoría **a través**
  de los dispatchers ya existentes en `device_alarm_routes.cpp`
  (`handleUpdateDevice` para PUT, `handleRevokeDevice` para POST) porque
  `/api/mining/devices/` ya tenía esos prefijos de verbo tomados —
  `router::Router` solo admite un handler por (verbo, prefijo). Solo GET y
  DELETE tenían el prefijo libre y se registran directo desde
  `registerFormulaRoutes()`.
- Migración `db_scripts/93_sensor_formula_engine.sql` — aplicada a mano
  contra `beemetry-db` (igual que el resto de scripts ≥30, ver
  [[project_backend_verify_build]]) y registrada en `schema_migrations`
  (checksum real, sin usar `--record-only` para no tocar los scripts 80-92
  pendientes de otra sesión).
- `frontend/.../SensorManagementView.tsx` gana dos pestañas dentro del panel
  expandido de cada sensor: "Parámetros de fórmula" (alta/baja de pares
  clave-tipo-valor, con nota de que solo `numeric` es usable en una
  expresión) y "Fórmulas y resultados" (alta con validación en vivo del
  error de `te_compile`, toggle enabled/disabled, borrado, tabla de
  resultados recientes con badge de color por `status`).

## Fases

- P0 (implementado): fixes de nav/`canMaintain`.
- P1 (implementado): Entregable A completo (backend + `SensorManagementView`).
- P2-P4 (implementado, misma sesión): parámetros → fórmulas →
  evaluador/resultados.
- Fast-follow explícitamente diferido, sin construir: `TelemetryIngestor`
  con callback múltiple (latencia sub-segundo; el evaluador de fórmulas
  sigue con el mismo poller de 10s que el de alarmas), puente hacia
  `platform_alarms` para reusar canales de notificación email/webhook en
  warning/error, múltiples canales de salida por fórmula.

## Verificación

- `docker build -f backend/Dockerfile.verify backend`: compila limpio (C++ y
  el `tinyexpr.c` vendoreado, project ahora `LANGUAGES CXX C`),
  `beemetry_backend` linkeado, suite Catch2 100% passed — corrido dos veces
  (Entregable A, luego Entregable B sobre el mismo árbol).
- `npx tsc --noEmit` sobre `frontend/`: sin errores, corrido después de cada
  tanda de cambios.
- Redeploy real del servicio `web` (`docker compose up -d --no-deps --build web`,
  dos veces) y prueba end-to-end contra el backend vivo y con datos reales,
  no simulados:
  - Entregable A: registro de sensor, `PUT` de parámetros de `sensors`,
    rotación de key, envío de lectura de prueba, `connection_status` →
    `online`.
  - Entregable B: `PUT .../parameters` con un parámetro numérico (`offset=5`)
    → confirmado por `GET` subsecuente; `POST .../formulas` con
    `expression: "value - offset"` → `201 Created`, rechazo correcto de
    expresiones inválidas verificado indirectamente (la validación usa el
    mismo `te_compile` que el evaluador); tras un ciclo del evaluador
    (`sleep 12`, intervalo 10s), fila real en `telemetry_multivariate`
    (`value_numeric=57.7`, exactamente `62.7 - 5`, el valor de prueba
    real menos el parámetro) con `status='ok'`. Segunda fórmula
    (`expression: "value"`, `error_high=50`) confirmó el cálculo de estado:
    `62.7 > 50` → `status='error'` en la fila escrita. `PUT .../formulas/{id}`
    (toggle `enabled`) y `DELETE .../formulas/{id}` verificados con `psql`
    directo mostrando el cambio persistido. UI verificada con capturas:
    ambas fórmulas y ambos badges de estado (`OK` esmeralda, `Error` rosa)
    renderizando correctamente en "Resultados calculados recientes".
  - `/api/metrics`: `beemetry_formula_engine_evaluations_total`/`computed_total`
    incrementando, `compile_errors_total`/`skipped_no_value_total` en 0
    durante la prueba.
  - Limpieza post-prueba: ambas fórmulas y el parámetro de prueba borrados,
    sensor de prueba revocado — sin dejar datos de prueba activos en la
    base de demo.

## Consecuencias

- Un admin con solo `dispositivos.manage` (sin `usuarios.manage`/
  `permisos.manage`/`alarmas.manage`) ahora sí ve el grupo de menú
  "mantenimiento" — antes quedaba fuera del gate `canMaintain` pese a tener
  permiso legítimo sobre esta pantalla.
- El tab "AlarmConfig", construido y renderizado desde hace tiempo pero sin
  entrada de nav, queda alcanzable — sin cambio de comportamiento propio,
  solo de visibilidad.
- El tab legado "Formula" (mineria_sensores) sigue oculto — decisión
  explícita del developer, para no confundir con una herramienta que opera
  sobre un catálogo de ejemplo desconectado de los sensores reales.
- `telemetry_raw`/`telemetry_fact` no tienen forma de marcar una lectura
  como "de prueba" — el botón "Probar ahora" inserta una lectura real y
  permanente en el historial del sensor (documentado en la propia UI); no se
  agregó un flag de test-data en esta pasada.

## Alternativas descartadas

- **Habilitar el tab "Formula" existente tal cual**: descartado — opera
  sobre `mineria_sensores`, un catálogo de ejemplo sin relación con los
  sensores reales; hubiera mostrado una herramienta que aparenta hacer algo
  que no hace.
- **Enganchar el evaluador de fórmulas directo a
  `TelemetryIngestor::setOnBatchCommitted`**: descartado para v1 — requeriría
  convertir un `std::function` único (hot path de ingesta a 25K/seg) en una
  lista, sin necesidad demostrada de latencia sub-segundo para esta función.
- **`exprtk` en vez de `tinyexpr`** para evaluación de expresiones:
  descartado — header único de ~1MB, compilación por TU mucho más lenta,
  superficie muy por encima de lo que necesita este caso (solo aritmética
  sobre variables nombradas).
- **Bounds de warning/error en `sensor_output_channel_def`** en vez de en
  `sensor_formula_def`: descartado — mezclaría "forma/unidad de la salida"
  (reusable) con "umbrales de esta fórmula concreta" (no reusable).

## Referencias

- `backend/src/mining/device_alarm_routes.cpp` (`handleRegisterDevice`,
  `handleListDevices`, `handleUpdateDevice`, `handleRevokeDevice`,
  `rotateDeviceKeyImpl`, `handleHttpTelemetry`)
- `backend/src/mining/telemetry_ingest.hpp`/`.cpp` (`refreshSensorCache`,
  `resolveSensor`, `loadSensorCache`, `cache_mtx_`)
- `backend/src/mining/sensor_telemetry_wizard.cpp` (`handleQueryTelemetrySeries`)
- `backend/src/mining/sensor_formula_routes.hpp`/`.cpp` (CRUD de parámetros/
  fórmulas, `validateExpression`, `sensorBelongsToTenant`)
- `backend/src/mining/sensor_formula_evaluator.hpp`/`.cpp` (hilo evaluador,
  `evaluateFormulaRow`, `loadLatestTelemetryValue`, `computeStatus`,
  `FormulaEngineStats`)
- `backend/third_party/tinyexpr/` (vendoreado, zlib license, `te_compile`/
  `te_eval`/`te_free`)
- `backend/CMakeLists.txt` (`project(... LANGUAGES CXX C)`,
  `MINING_MODULES` + `third_party/tinyexpr/tinyexpr.c`)
- `backend/src/main.cpp` (`mining_iot::startFormulaEvaluator()`, métricas
  `beemetry_formula_engine_*` en `/api/metrics`)
- `db_scripts/93_sensor_formula_engine.sql`
- `frontend/src/components/ReportStudioV2/components/views/SensorManagementView.tsx`
- `frontend/src/components/ReportStudioV2/components/views/FormulaOverviewView.tsx`
  (`handleListAllFormulas` en `sensor_formula_routes.cpp`, `GET /api/mining/formulas`)
- `frontend/src/components/ReportStudioV2/components/views/AlarmConfigView.tsx`
- `frontend/src/App.tsx`, `frontend/src/components/UI/NavBar.tsx`
- `db_scripts/17_telemetry_multivariate_sensor_specs.sql`,
  `db_scripts/18_tb_sensor_model_notify_etl_triggers.sql`,
  `db_scripts/38_adr034_device_management_alarm_engine.sql`
- `external-api-test-page/phone-sensor-test.html` (origen del patrón
  `deviceFetch()`/`credentials:'omit'`)
- ADR-034 (`core-plataforma-iot-reemplazo-thingsboard`), ADR-140
  (`alertas-umbral-cache-tasa-debounce-sensor`)
