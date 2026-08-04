# ADR-008 — Bus de eventos en Etapa 2: Redpanda + librdkafka + COPY binario

**Actualización 2026-07-17 — corrección de un bug real de enrutamiento**: se
encontró que `TelemetryIngestor::enqueue(TelemetryRow&&)` — la vía que usan
llamadores que ya traen la fila resuelta (a diferencia de `ingestLine()`, que
parsea texto) — **no verificaba `mode_`**: en modo Kafka seguía empujando a la
cola en memoria `queue_`, pero esa cola solo la drena el hilo `flusher_`, que
**no se arranca en modo Kafka** (en ese modo corre `consumer_thread_` en su
lugar). Resultado real observado: filas contadas como "recibidas" que quedaban
varadas en memoria para siempre, sin error visible, hasta que el proceso se
reiniciaba. El bug era preexistente y estaba dormido — MQTT/Modbus/OPC-UA
(ADR-034) siempre usaron `ingestLine()`, que sí tenía el branch correcto; lo
destapó el primer llamador que necesitó `enqueue()` directamente (el conector
ThingsBoard, ADR-054, que ya trae `sensor_id`/`tenant_id` resueltos y no
parsea una línea de texto). Corregido en `telemetry_ingest.cpp`: `enqueue()`
ahora produce a Kafka cuando `mode_ == Mode::Kafka`, igual que `ingestLine()`;
se extendió también el payload de Kafka con `captured_at_epoch_ms` (5to campo,
opcional, retrocompatible) para no perder la fecha real de captura al pasar
por el bus. Verificado con una prueba de carga real de 6.000.000 de filas en
10 min, 0 `flush_errors`, cola interna en 0 durante toda la corrida.

**Status**: implemented (completado 2026-07-07). Corrección sobre la nota anterior: la ruta de escritura ya usaba `COPY ... FROM STDIN` (no sentencias preparadas) — lo que faltaba era específicamente el **formato binario** (`COPY ... WITH (FORMAT binary)`); antes se enviaba COPY en modo texto (tab-separated). Implementado en `telemetry_ingest.cpp::copyBatch()`: cabecera de firma binaria de Postgres, codificación big-endian de cada campo según su tipo real de columna (uuid → 16 bytes crudos, timestamptz → int64 microsegundos desde el epoch de Postgres, float8 → bits de doble precisión, int16 → smallint), y trailer de fin de datos.

**Verificación end-to-end real** (no solo compilación): se envió una lectura de prueba (`STRESS-1,73.25,88`) por TLS al puerto 8443 del mining-gateway → Redpanda → consumidor Kafka → COPY binario → `telemetry_raw`. La fila resultante en la BD tiene `tenant_id`/`sensor_id` exactos, `value_numeric=73.25` exacto (sin corrupción de punto flotante), `quality_code=88` exacto, y `captured_at` con precisión de microsegundo real — confirma que la codificación/decodificación binaria de UUID, float8, int16 y timestamptz es correcta byte a byte. Prueba adicional de lote (20 lecturas): `mapas_backend_telemetry_received_total=21`, `inserted_total=21`, `flush_errors_total=0`, `produce_errors_total=0` — cero pérdidas ni errores en el pipeline completo Kafka→COPY binario.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: core-iot

## Contexto

La meta de 10.000 sensores/seg con SLA de latencia y resiliencia no la sostiene la ingesta directa libpq de Etapa 1 (ADR-007). El doc de optimización y la arquitectura objetivo proponen un bus de eventos que desacople picos, aporte back-pressure y resiliencia, y un consumidor que persista con máximo throughput. Esta capacidad está comprometida para **Etapa 2 (S9-S12)**, no para Etapa 1.

## Decisión

En **Etapa 2** se introduce un **bus de eventos Redpanda** (compatible Kafka, C++-friendly) con **librdkafka** como productor/consumidor en el gateway. Topología: sensores → gateway → **topics por tenant/zona** en Redpanda → consumidor C++ que persiste en TimescaleDB con **COPY binario** y prepared statements. El bus absorbe ráfagas y desacopla ingesta de persistencia.

### Reglas duras
- Topics particionados por tenant/zona para aislamiento y escalado.
- El consumidor persiste con COPY binario; se evalúa simdjson/FlatBuffers para el payload en el hot path.
- El contrato de payload es el mismo versionado desde Etapa 1 (ADR-007): migrar no rompe productores.

## Consecuencias

### Positivas
- Desacople, back-pressure y resiliencia ante picos → habilita el SLA de 10k.
- COPY binario maximiza el throughput de escritura a TimescaleDB.
- Redpanda no tiene dependencia de JVM/Zookeeper (vs Kafka clásico): menor huella operativa on-prem.

### Negativas / Trade-offs
- Un componente más que operar (bus, topics, lag) — justificado solo a la escala objetivo; por eso es Etapa 2.
- Complejidad de exactly-once / idempotencia en el consumidor — se diseña con claves de deduplicación.

### Neutras
- Redpanda es opcional en el build hoy (`HAVE_RDKAFKA`); se vuelve requerido en Etapa 2.

## Alternativas descartadas

### Kafka (Apache) clásico
Equivalente funcional, pero arrastra JVM + Zookeeper/KRaft y mayor huella operativa on-prem. Redpanda da la misma API con menos peso.

### Seguir con libpq directo a 10k
No sostiene el SLA bajo ráfaga sin desacople; es justamente lo que este ADR resuelve.

### Cola ligera (Redis Streams / NATS)
Menor peso, pero menos garantías de retención/replay y menos afinidad con el patrón COPY→Timescale. Se descarta para la ruta de telemetría crítica.

## Referencias
- `Referencias/docs/02_Arquitectura/Optimizacion_TiempoReal_CPP_AURIXA_v36.md` § 2.1, 3
- `Referencias/docs/02_Arquitectura/Arquitectura_Objetivo_Capas_AURIXA_v36.md` § 3-4
- `Referencias/backend/CMakeLists.txt` (`HAVE_RDKAFKA`)
- ADR-007 (ingesta Etapa 1), ADR-006 (TimescaleDB), ADR-034 (core como plataforma IoT: colas del subsistema de ingesta)
