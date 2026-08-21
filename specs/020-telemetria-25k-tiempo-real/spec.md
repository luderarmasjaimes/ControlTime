# SPEC 020 — Telemetría durable de 25.000 sensores en tiempo real

| Campo | Valor |
|---|---|
| **ID** | 020 |
| **Estado** | Aceptado con evidencia E2E (2026-08-12; auditado 2026-08-18) |
| **SPEC base** | SPEC-001 |
| **Decisiones vigentes complementarias** | ADR-008, ADR-032, ADR-108 |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-020**; fuente ADR: `docs/decisions/`.

- **ADR-008** — [`008-bus-eventos-redpanda-etapa2.md`](../../docs/decisions/008-bus-eventos-redpanda-etapa2.md)
- **ADR-023** — [`023-presupuestos-rendimiento-slas.md`](../../docs/decisions/023-presupuestos-rendimiento-slas.md)
- **ADR-032** — [`032-timescaledb-instancias-ingesta-lectura.md`](../../docs/decisions/032-timescaledb-instancias-ingesta-lectura.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-108** — [`108-capacidad-telemetria-25k-topologia-escalamiento.md`](../../docs/decisions/108-capacidad-telemetria-25k-topologia-escalamiento.md)

## Problema

La prueba E2E del 2026-08-11 demostró que el pipeline actual conserva datos en
operación normal hasta 25k/s, pero acumula 4–5 segundos de latencia y pierde un
lote si TimescaleDB falla: el consumidor descarta el batch fallido y un commit
posterior confirma offsets más nuevos.

## Objetivo

Soportar 25.000 sensores, una lectura por segundo, con procesamiento realmente
continuo, backpressure explícito y recuperación sin pérdida después de una caída
breve de TimescaleDB.

## Criterios de aceptación

- [x] **CA-1:** 25.000 eventos/s durante al menos 60 s; aceptados, producidos,
  consumidos e insertados coinciden exactamente en operación normal.
- [x] **CA-2:** ACK TLS p99 < 1.000 ms en el entorno local de referencia.
- [x] **CA-3:** Ante caída de TimescaleDB, el consumidor conserva el lote, no hace
  commit de offsets y recupera el 100% después del reinicio.
- [x] **CA-4:** `produce()` devuelve error al gateway si no logra aceptar el mensaje
  dentro del timeout de backpressure; nunca responde OK a un queue-full.
- [x] **CA-5:** Múltiples consumidores del mismo grupo usan conexiones COPY
  independientes y distribuyen las particiones.
- [x] **CA-6:** Métricas exponen deliveries, errores de delivery/commit, reintentos,
  workers bloqueados y out-queue del productor.
- [x] **CA-7:** Configuración reproducible en Docker Compose con límites de recursos,
  retención acotada y chunks de Timescale adecuados a 25k/s.
- [x] **CA-8:** Los datos de prueba están aislados y se eliminan sin escanear ni
  descomprimir el histórico.

## Restricciones

- Constitución: Art. 1, 2, 3, 5, 8, 9 y 10.
- Semántica Kafka at-least-once con persistencia idempotente: una reentrega
  conserva `captured_at`, partición y offset, y el índice único parcial impide
  duplicar la fila. Fuentes no Kafka mantienen columnas nulas y no cambian.
- El ACK del protocolo confirma aceptación por el productor local. La entrega
  al broker se observa mediante delivery reports; un ACK broker por mensaje
  requeriría una evolución versionada del protocolo asíncrono.

## Evidencia requerida

Generador reproducible, métricas antes/después, conteo SQL por tenant aislado,
lag del consumer group, prueba de caída/recuperación y reporte de recursos.

## Evidencia de cierre

`docs/PRUEBA_CAPACIDAD_TELEMETRIA_25K_2026-08-12.md`: 1.500.000/1.500.000
eventos persistidos a 25k/s, p99 149,8 ms, recuperación completa de 5.000
eventos tras caída de BD y replay de 5.000 con cero duplicados. La aceptación
se limita a la topología ensayada; ADR-108 declara 100k/s no aprobado.
