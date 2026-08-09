# PLAN 001 — Ingesta de telemetría durable

| Campo | Valor |
|---|---|
| **Spec** | `specs/001-ingesta-telemetria-durable/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |

## 1. Enfoque técnico
Desacoplar productor de consumidor con un **log durable (Redpanda, Kafka-API)**.
El gateway C++ produce cada lectura resuelta; un consumidor C++ las escribe en
TimescaleDB por lotes (COPY) y **confirma el offset sólo tras persistir**
(at-least-once → 0 pérdida).

## 2. Componentes
```
Sensor ──TLS(8443)──► mining_gateway (Boost.Asio, 6 hilos)
                         │ resuelve sensor→(sensor_id,tenant_id) desde caché RAM
                         ▼ produce async
                      REDPANDA topic "telemetry" (6 particiones, key=sensor_id)
                         ▼ consume (grupo telemetry-writers)
                      Consumidor C++ ── COPY por lotes ──► TimescaleDB.telemetry_raw
                         └ commitSync() tras COPY ok
```

## 3. Modelo de datos
- Hypertable `telemetry_raw(tenant_id, sensor_id, captured_at, value_numeric,
  quality_code, …)`; `chunk_time_interval=6h`.
- 2 índices (pkey + `sensor_id,captured_at`). Sin índices redundantes (Art. 9).
- ~205 B/fila sin comprimir; compresión columnar en chunks > 1 h.

## 4. Contratos
- **Ingesta:** línea TLS `"<sensor_code>,<value>[,<quality>]"`.
- **Mensaje Kafka:** `tenant_id \t sensor_id \t value \t quality` (key=sensor_id).
- **Métricas:** `mapas_backend_telemetry_*` (produced/consumed/inserted/commits/
  dropped_full/produce_errors) + `mode{kafka|direct}`.

## 5. Concurrencia / performance
- Productor async con `linger.ms=20`, batch interno de librdkafka.
- Consumidor: poll → acumula `batch_size` (1.000) o `flush_ms` (200) → COPY
  acotado a 10.000 filas → commit. La conexión de COPY usa `statement_timeout=0`.

## 6. Seguridad
- Conexión de ingesta con rol de escritura, sin timeout corto.
- TLS en el gateway de sensores.

## 7. ADR
| ADR | Decisión | Estado |
|---|---|---|
| ADR-001-1 | Broker durable (Redpanda) en vez de cola in-process | Aceptado |
| ADR-001-2 | COPY acotado a 10K filas/lote (límite de pérdida ante fallo) | Aceptado |

## 8. Plan de pruebas
| CA | Cómo se prueba | Evidencia |
|---|---|---|
| CA-1 | carga sostenida 1.000/s 1 h | 10,8M filas, 0 drops |
| CA-3 | `docker kill` del backend a media ingesta | replay recupera 30K, 0 pérdida |
| CA-5 | `curl /api/metrics` | contadores presentes |

## 9. Despliegue
- `docker-compose.yml`: servicio `redpanda`; env `TELEMETRY_INGEST_MODE=kafka`,
  `KAFKA_BROKERS`, `KAFKA_TOPIC`. Dockerfile backend: `librdkafka-dev`.
- Rollback: `TELEMETRY_INGEST_MODE=direct` (cola in-process).

## 10. Costo / recursos
- Redpanda: 2 CPU / 1,5 GB, retención topic 2 GB / 1 h.
- ~3,5 GB/día comprimido a 1.000/s.
