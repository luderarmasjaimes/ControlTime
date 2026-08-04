# ADR-054 — Sync ThingsBoard (legacy, hoy en AWS) → plataforma propia

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
