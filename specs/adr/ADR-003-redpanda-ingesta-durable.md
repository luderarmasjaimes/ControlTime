# ADR-003 — Redpanda ingesta durable

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI |
| **Features** | `001`, `014`, `016` |

## Contexto
Art. 2 Constitución: cero pérdida de telemetría confirmada. Sensores en mina tienen conectividad intermitente.

## Decisión
Log durable **Redpanda** (compatible Kafka) entre sensores/gateway y persistencia TimescaleDB. Commit de offset **después** de persistir (at-least-once).

## Consecuencias
- Servicio `redpanda` en `docker-compose.yml`
- Cola offline cliente (SPEC-014) se reconcilia contra el mismo contrato de eventos
