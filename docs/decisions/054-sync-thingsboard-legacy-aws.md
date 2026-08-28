# ADR-054 — Sync ThingsBoard (legacy, hoy en AWS) → plataforma propia

**Actualización 2026-08-25**: primer acceso real (VPN ZeroTier) a la BD Postgres
del ThingsBoard de producción del cliente (antes solo se había probado contra
una instancia local aislada, ver "Status" abajo — sin acceso al AWS real en esa
sesión). Análisis de solo lectura directo sobre `ts_kv`/`device`/`device_credentials`
(no vía la API de la aplicación, que sigue siendo el mecanismo de sync — este
acceso fue únicamente para inspección de esquema/volumen real):

- Confirma que es un ThingsBoard real (Postgres 12.22) con 2.645 dispositivos y
  ~1.067 millones de puntos de telemetría legítimos en `ts_kv` (2013-10 a
  2026-08, particionado mensual, 165 particiones "reales").
- **Hallazgo de calidad de datos**: 604 particiones adicionales (de 769 totales)
  contienen timestamps corruptos fuera de ese rango — de 1970 a 2279 — por tres
  causas de origen distintas identificadas por dispositivo: (1) `MS.Estantococha
  Inclinometro` manda `ts` en segundos en vez de milisegundos (cae en 1970); (2)
  `ZJ.BNV-MLZ-CLIMAVUE50.ResumenDiario` (estación meteorológica) tiene el
  RTC sin sincronizar, arrancado en enero de 1990; (3) el grupo de piezómetros
  `AL.Ps-1`..`AL.Ps-6` escribe un timestamp fijo `3009211340000` (año 2065) en
  varias keys que parecen de configuración (`shared_cf`, `shared_FreqIni`,
  `umbral2`..`umbral5`, la key literal `"timestamp"`), no telemetría real.
  En volumen es marginal (89.982 filas de 1.067.291.004, ~0,008%), pero explica
  por qué un `COUNT(*)` simple sobre `ts_kv` es extremadamente lento en la BD
  real (Postgres tiene que planear sobre las 769 particiones aunque 604 estén
  casi vacías).
- **Fix aplicado** en `thingsboard_sync.cpp` (`backfillLoop`/`realtimeLoop`):
  nuevo filtro `isSaneCapturedAt()` que descarta puntos con `captured_at_epoch_ms`
  anterior a 2000-01-01 o más de `BEEMETRY_TB_MAX_FUTURE_SKEW_MS` (default 24h)
  en el futuro, antes de encolarlos a `TelemetryIngestor`. Sin esto, este sync
  habría replicado el mismo patrón de timestamps corruptos —y el mismo riesgo de
  bloat de particiones si `telemetry_raw` también particiona por tiempo
  (ADR-006)— en la plataforma propia. Detalle no obvio: en el backfill, el
  watermark (`etl_sync_state.watermark_bigint`) solo avanza con puntos que
  pasan el filtro — dejar avanzar con un `ts` corrupto de año 2065 habría hecho
  que la siguiente corrida pidiera `startTs > endTs` y el stream quedara varado
  sin traer datos reales nunca más. Se agregaron dos contadores nuevos
  (`backfill_points_rejected_bad_ts`, `realtime_points_rejected_bad_ts`),
  expuestos también en `/api/metrics`.

**Actualización 2026-08-28 — verificación end-to-end real contra producción,
más dos hallazgos nuevos que bloqueaban por completo el sync antes de esta
sesión**: con credenciales reales de aplicación de ThingsBoard (login
`TENANT_ADMIN`, no las de Postgres) contra `board.beemetry.com`:

1. **TLS no estaba implementado** — `httpRequest()` (propio de este archivo)
   devolvía directo `tls_not_implemented_...` para cualquier `https://`, y el
   WebSocket ni siquiera chequeaba `u.tls` (intentaba un handshake WS en texto
   plano contra un puerto que espera TLS). El ThingsBoard real del cliente es
   HTTPS/WSS puro, sin balanceador que termine TLS antes — exactamente el
   caso que el propio comentario del código ya anticipaba como pendiente.
   Corregido: el REST (login + backfill) ahora usa el cliente HTTP(S)
   compartido `http_client` (ADR-103, ya probado con TLS real en la
   integración RP/TimeTelemetry) en vez de un cliente casero sin TLS; el
   WebSocket ahora rama explícita entre `websocket::stream<tcp_stream>` y
   `websocket::stream<ssl_stream<tcp_stream>>` según `u.tls`, mismo patrón SSL
   (SNI + `ctx.set_default_verify_paths()` + `verify_peer`) que `http_client.cpp`.
2. **Formato real del push WS confirmado** contra el servidor real (no solo
   documentación pública): `{"subscriptionId":1,"errorCode":0,"errorMsg":null,
   "data":{...},"latestValues":{...}}` — `subscriptionId` == `cmdId` de la
   suscripción, tal como asumía el fix de resolución O(1) de `realtimeLoop`
   (antes resolvía cada dato entrante recorriendo linealmente todo el mapa de
   streams comparando por nombre de key — costoso e impreciso a la escala de
   miles de dispositivos). Con esto verificado, ese fix pasa de "basado en
   protocolo documentado, no probado" a confirmado contra el servidor real.

**Prueba real, no simulada**: peer de prueba acotado a un solo dispositivo real
(`GF.RQ-04-I`, piezómetro, key `Freq`) contra `board.beemetry.com`, corrido en
un contenedor aislado del stack de desarrollo local. Resultado
(`/api/metrics`): `peers_authenticated=2`, `login_failures=0`,
`backfill_points_ingested=42` (histórico real de 7 días, cada 4h),
`backfill_errors=0`, `realtime_ws_connects=1`, `realtime_points_ingested=1`,
`realtime_points_dropped=0`. Verificado también a nivel de fila en
`telemetry_raw`: valores reales (~5672-5675), `captured_at` preservando la
fecha real de captura (no "ahora"), y el duplicado WS+backfill que ya predecía
este mismo ADR (mismo `captured_at`, dos `ingested_at` distintos) apareció
exactamente como estaba documentado — confirma ese trade-off ya aceptado, no
es un bug nuevo. Peer y sensor de prueba (con las credenciales) se eliminaron
de la BD local al terminar; el módulo compilado queda verificado end-to-end
pero **no se dejó corriendo sync activo contra producción** — requiere
decisión explícita de scope (todos los tenants/dispositivos, qué entorno
destino) antes de habilitarlo de forma persistente.

**Pendiente de análisis, no de este ADR todavía**: throughput a la escala
objetivo (25.000 sensores × 1 muestra/seg) no se probó con carga real — el
dispositivo de prueba reporta cada 4h, no a 1/seg. La corrección de
resolución O(1) y el batching del backfill por dispositivo (en vez de por
stream) están pensados para esa escala pero no hay número medido todavía;
se puede probar contra `tools/thingsboard-local` con carga sintética sin
tocar producción otra vez.

**Status**: implemented (2026-07-17). Verificado con prueba de carga real de 10 min
a ~10.000 puntos/seg contra un ThingsBoard local aislado (no el AWS del cliente,
sin acceso disponible en esta sesión): 0 errores, 0 pérdida en cola, réplica
sincronizada al 100% al cierre.
**Fecha**: 2026-07-17
**Autores**: EC
**Ámbito**: core-iot

## Contexto

El release R2 ("Motor operacional + seguridad base") incluye como entregable del
SOW la "sync inicial con AWS": el cliente tiene hoy una plataforma de telemetría
preexistente — investigada a fondo en esta sesión y confirmada como una instancia
**ThingsBoard** real (Java, hoy desplegada en AWS) — cuyo reemplazo progresivo por
el core C++ ya es la decisión vigente (ADR-034, "core-plataforma-iot-reemplazo-thingsboard").
ADR-034 ya anticipa explícitamente que **"ThingsBoard puede convivir detrás del
gateway mientras se estrangula"** (alcance v0.1) y descarta solo el **híbrido
permanente** como destino final — no la coexistencia transitoria. Este ADR es la
decisión concreta de **cómo** conviven ambas plataformas durante la transición:
un conector que sincroniza los datos de ThingsBoard hacia la BD propia en tiempo
real, sin exigir que los dispositivos migren de plataforma el mismo día.

Se investigó el esquema real de ThingsBoard (`ts_kv`/`ts_kv_latest`/`key_dictionary`/
`device`, ver Referencias) para entender qué mecanismos de sincronización expone
realmente: **no hay CDC/logical replication** nativo, y el mecanismo de tiempo real
soportado es una **API de suscripción WebSocket** (`/api/ws/plugins/telemetry`);
el histórico se consulta por **REST** (`/api/plugins/telemetry/{entityType}/{id}/values/timeseries`).

También se encontró, sin uso desde código, un esquema ya preparado para
exactamente este propósito en `db_scripts/18_tb_sensor_model_notify_etl_triggers.sql`:
`etl_sync_peer` / `etl_sync_state` / `etl_sync_run` y `sensors.external_id` — el
nombre del archivo referencia literalmente "tb" (ThingsBoard). Este ADR formaliza
el uso de ese esquema preexistente, en vez de crear tablas nuevas.

## Decisión

Nuevo módulo `backend/src/mining/thingsboard_sync.{hpp,cpp}`, con dos modos que
alimentan el mismo pipeline de ingesta ya probado a 10k/seg (ADR-007/008):

1. **Backfill histórico/incremental (REST)** — cada `BEEMETRY_TB_BACKFILL_INTERVAL_MS`
   (default 60s), pagina la API de histórico por dispositivo+key usando una marca
   de agua en `etl_sync_state.watermark_bigint` (no reprocesa lo ya traído).
2. **Tiempo real (WebSocket)** — suscripción persistente a
   `/api/ws/plugins/telemetry`, reenvía cada push apenas llega. Reconecta con
   backoff si se cae.

Ambos modos normalizan al mismo evento canónico y llaman a
`TelemetryIngestor::enqueue()` (mismo pipeline que usan MQTT/Modbus/OPC-UA,
ADR-034) — con una diferencia real necesaria: preservar la **fecha real de
captura** del dato histórico, no "ahora". Para esto se extendió `TelemetryRow`
con `captured_at_epoch_ms` (opcional, default 0 = comportamiento legacy sin
cambios para los adaptadores existentes) y `TelemetryIngestor::copyBatch()` lo
usa cuando está presente.

**Mapeo dispositivo+key → sensor propio**: se reutiliza `sensors.external_id`
(columna ya existente, pensada para esto) con la convención
`"tb:<device_uuid>:<key_name>"`. Un dispositivo ThingsBoard con varias keys de
telemetría se mapea a varias filas de `sensors`, una por key — coherente con el
modelo "1 sensor = 1 métrica" ya usado por el resto de la plataforma.

**Configuración**: fila(s) en `etl_sync_peer` con `auth_config->>'kind' = 'thingsboard'`
por `tenant_id` — un tenant sin peer activo simplemente no sincroniza (no hace
falta feature-flag por tenant aparte). Gated globalmente por
`BEEMETRY_THINGSBOARD_SYNC_ENABLED` (default `false`: es integración con un
sistema externo del cliente, no debe arrancar sola en un despliegue nuevo sin
credenciales reales).

### Reglas duras
- Es un **puente de transición**, no una arquitectura híbrida permanente (ADR-034
  ya descartó esa opción como destino final) — se retira cuando el estrangulamiento
  de ThingsBoard llegue a los dispositivos que hoy dependen de él.
- Autenticación vía `X-Authorization: Bearer <jwt>` (particularidad de la API REST
  de ThingsBoard, no el header `Authorization` estándar).
- La suscripción WS usa `"keys"` como **string separado por comas**, no arreglo
  JSON — con arreglo ThingsBoard v4.3.1.3 acepta la suscripción sin error pero
  nunca empuja datos (verificado con un cliente WS manual antes de implementar).

## Consecuencias

### Positivas
- Los dispositivos que hoy reportan a ThingsBoard quedan visibles en reportes/
  dashboards de la plataforma propia sin esperar su migración física.
- Reusa toda la infraestructura de ingesta ya probada (Kafka/Redpanda, COPY
  binario, réplica de lectura) — no es un pipeline paralelo.
- El esquema `etl_sync_peer/state/run` ya existía sin usar; este ADR le da un
  primer consumidor real, en vez de dejarlo como deuda de diseño no verificada.

### Negativas / Trade-offs
- **Redundancia WS+backfill intencional** (arquitectura tipo Lambda): un mismo
  punto puede llegar por ambos caminos y generar filas duplicadas en
  `telemetry_raw` (mismo `sensor_id`+`captured_at`, distinto `ingested_at`). No
  hay deduplicación en el insert — verificado en la prueba de carga: 2,44
  entregas promedio por punto lógico. Aceptado por ahora porque prioriza no
  perder datos (at-least-once) sobre almacenamiento; deduplicar en consulta
  (`DISTINCT ON`) o en insert es un fast-follow si el volumen de duplicados
  pesa en almacenamiento a largo plazo.
- Latencia real medida (ThingsBoard → `telemetry_raw`, primera llegada): p50 ≈
  760 ms, p95 ≈ 4,2 s, p99 ≈ 6,5 s bajo 10.000 puntos/seg sostenidos — el WS
  domina la cola rápida, el ciclo de backfill (15-60s) es el que empuja la cola
  alta cuando alcanza un punto que el WS ya entregó.
- No se probó contra el ThingsBoard real del cliente en AWS (sin acceso en esta
  sesión) — se probó contra una instancia ThingsBoard real pero local y aislada
  (misma imagen `thingsboard/tb-node`, misma API), con datos sintéticos.

### Neutras
- El puerto WS asume por ahora conexión en texto plano o TLS terminado por un
  balanceador delante (mismo supuesto que `ai_engine_client.cpp`); agregar
  `boost::asio::ssl` es un cambio acotado si el ThingsBoard real del cliente
  expone TLS directo.

## Alternativas descartadas

### Cambiar el protocolo de subscripción a "EntityDataQuery" unificado (TB 3.x+ moderno)
ThingsBoard documenta también un comando de suscripción unificado más nuevo.
Se descartó por ahora: el formato clásico por entidad (`tsSubCmds`) ya está
verificado funcionando contra la versión real desplegada localmente
(v4.3.1.3) y es el más ampliamente compatible entre versiones de ThingsBoard
en uso en campo.

### CDC / logical replication directo sobre la BD de ThingsBoard
Más eficiente en teoría, pero ThingsBoard no expone esto como mecanismo
soportado, y depender de la estructura interna de su esquema (fuera de su API
pública) sería frágil ante upgrades de versión. Se descarta.

### Solo backfill (sin WebSocket)
Más simple, pero introduce latencia mínima igual al intervalo de polling
(60s+) para todo dato nuevo — no cumple la expectativa de "tiempo real" del
requerimiento original. Se descarta como único mecanismo; se mantiene como
respaldo ante caídas del WS.

### Deduplicar en el insert (upsert por sensor_id+captured_at)
Evitaría los duplicados WS+backfill, pero cambia `telemetry_raw` de solo-append
a upsert para todas las fuentes de ingesta (MQTT/Modbus/OPC-UA también), un
cambio de mayor alcance que este ADR no necesita forzar. Se deja para un ADR
aparte si el volumen de duplicados lo justifica.

## Referencias
- `backend/src/mining/thingsboard_sync.hpp` / `.cpp`
- `backend/src/mining/telemetry_ingest.hpp` / `.cpp` (`TelemetryRow::captured_at_epoch_ms`)
- `db_scripts/18_tb_sensor_model_notify_etl_triggers.sql` (`etl_sync_peer`/`etl_sync_state`/`etl_sync_run`)
- ADR-034 (core como plataforma IoT, coexistencia transitoria con ThingsBoard)
- ADR-007/008 (pipeline de ingesta: gateway → Redpanda → COPY binario)
- ADR-032 (primaria + réplica de lectura — confirma que el requisito de "dos
  bases de datos" del pedido original ya estaba resuelto, sin trabajo nuevo)
- Prueba de carga real: 6.000.000 puntos / 10 min, 0 errores, réplica al día
  (reporte de sesión, no versionado en el repo)
