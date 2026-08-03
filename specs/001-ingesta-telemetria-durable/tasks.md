# TASKS 001 — Ingesta de telemetría durable

| Campo | Valor |
|---|---|
| **Plan** | `specs/001-ingesta-telemetria-durable/plan.md` |
| **Última revisión** | 2026-06-24 (auditado contra `telemetry_ingest.hpp`, `mining_gateway.hpp/cpp`) |

## Tareas

| # | Tarea | Cubre CA | Estado | Commit |
|---|---|---|---|---|
| T1 | Servicio Redpanda en compose (retención acotada) | CA-6 | ✅ | — |
| T2 | librdkafka en Dockerfile + CMake | — | ✅ | — |
| T3 | Productor C++ en el gateway (`produceRow`) | CA-1,CA-4 | ✅ | — |
| T4 | Consumidor C++ (poll→COPY→commit) | CA-1,CA-3 | ✅ | — |
| T5 | COPY acotado a 10K filas | CA-3 | ✅ | — |
| T6 | Métricas Kafka en `/api/metrics` | CA-5 | ✅ | — |
| T7 | Prueba sostenida 1 h (1.000/s) | CA-1 | ✅ | — |
| T8 | Prueba de durabilidad (kill→replay) | CA-3 | ✅ | — |
| T9 | Manual operativo (arranque, rollback, métricas, escalamiento) | — | ✅ | `docs/09_Manuales_Operativos/Manual_Operativo_Ingesta_Telemetria.md` |

## Definition of Done
- [x] Todas las tasks técnicas cerradas.
- [x] CA-1..CA-6 demostrados con evidencia (ver `plan.md §8`).
- [x] Cumple Constitución Art. 1, 2, 5, 9.
- [x] T9 documentación operativa — `Manual_Operativo_Ingesta_Telemetria.md` (10 secciones, 2026-06-24).

## Detalle T9 — Manual operativo (pendiente)

El manual debe cubrir:
- **Arranque nominal:** `docker compose up -d redpanda db backend`; esperar healthchecks;
  verificar en `/api/metrics`: `telemetry_received > 0`, `telemetry_dropped_full = 0`.
- **Modo Direct vs Kafka:** `TELEMETRY_MODE=direct|kafka` en `.env`; cuándo usar cada uno.
- **Parámetros clave:** `TELEMETRY_BATCH_SIZE` (default 1000), `TELEMETRY_FLUSH_MS` (default 200),
  `TELEMETRY_MAX_QUEUE` (default 200000).
- **Rollback a modo Direct:** si Redpanda falla, cambiar `TELEMETRY_MODE=direct` y reiniciar backend.
- **Señales de alarma:** `dropped_full > 0` → aumento de `TELEMETRY_MAX_QUEUE`; `flush_errors > 0`
  → revisar conexión a BD.
- **Monitoreo del gateway:** puerto TLS 8443; certificados en `/etc/mining-gateway/certs/`;
  `idle_timeout=30s`, `max_line_size=1024 B`.

**Responsable:** OPS/BE3 · **Modelo IA:** ChatGPT/Haiku (documentación técnica)

## Modelo de IA usado (registro real · Art. 7)
| Task | Modelo apropiado |
|---|---|
| T3-T5 (concurrencia C++, librdkafka) | Opus (correcto) |
| T1-T2-T6 (compose, métricas) | Sonnet/Haiku habría bastado |
| T9 (docs) | ChatGPT/Haiku |
