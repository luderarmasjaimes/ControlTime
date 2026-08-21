# SPEC 001 — Ingesta de telemetría durable en tiempo real

| Campo | Valor |
|---|---|
| **ID** | 001 |
| **Estado** | **Aprobado** |
| **Autor** | Arquitectura TI |
| **Aprobado por** | Producto + Arquitecto TI |
| **Fecha** | 2026-06-24 |
| **SOW relacionado** | `docs/00_SOW/SOW_Maestro_AURIXA_2026_v4.md` |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-001**; fuente ADR: `docs/decisions/`.

- **ADR-001** — [`001-despliegue-soberano-on-prem.md`](../../docs/decisions/001-despliegue-soberano-on-prem.md)
- **ADR-007** — [`007-ingesta-telemetria-etapa1-libpq.md`](../../docs/decisions/007-ingesta-telemetria-etapa1-libpq.md)
- **ADR-008** — [`008-bus-eventos-redpanda-etapa2.md`](../../docs/decisions/008-bus-eventos-redpanda-etapa2.md)
- **ADR-023** — [`023-presupuestos-rendimiento-slas.md`](../../docs/decisions/023-presupuestos-rendimiento-slas.md)
- **ADR-032** — [`032-timescaledb-instancias-ingesta-lectura.md`](../../docs/decisions/032-timescaledb-instancias-ingesta-lectura.md)
- **ADR-034** — [`034-core-plataforma-iot-reemplazo-thingsboard.md`](../../docs/decisions/034-core-plataforma-iot-reemplazo-thingsboard.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-108** — [`108-capacidad-telemetria-25k-topologia-escalamiento.md`](../../docs/decisions/108-capacidad-telemetria-25k-topologia-escalamiento.md)


## 1. Problema / Oportunidad
Las empresas mineras necesitan capturar la telemetría de **10.000+ sensores**
(vibración, temperatura, presión, flujo, gas) que reportan cada ~10 s, y tenerla
disponible para monitoreo en tiempo real y análisis. La pérdida de lecturas ante
picos o caídas de un componente es **inaceptable** (decisiones de seguridad de
mina dependen de ellas).

## 2. Objetivo
Ingestar la telemetría de 10.000 sensores **sin pérdida**, en tiempo real,
multitenant, con capacidad de recuperación ante caída del backend.

## 3. Usuarios y contexto
- **Rol(es):** sensores/dispositivos (productores), plataforma (consumidor).
- **Multitenant:** cada lectura pertenece a una empresa minera (`tenant_id`).
- **Escala:** 10.000 sensores × 1 lectura/10 s = **1.000 filas/s** sostenido;
  picos validados hasta **15.000/s**.

## 4. Alcance
**Incluye:** recepción TLS de sensores, resolución de sensor→tenant, persistencia
durable, recuperación por replay, métricas de ingesta.
**NO incluye:** dashboards (spec 002), tier frío (spec 003), informes históricos.

## 5. Criterios de aceptación
- [x] **CA-1:** A 1.000 filas/s sostenido, **0 mensajes perdidos** en operación normal.
- [x] **CA-2:** Latencia sensor→ack **< 50 ms** (p99).
- [x] **CA-3:** (resiliencia) Si el backend cae con mensajes en vuelo, al
      reiniciar se **recuperan por replay**, con pérdida **0**.
- [x] **CA-4:** (multitenant) Cada fila persiste con el `tenant_id` correcto; un
      tenant nunca recibe telemetría de otro.
- [x] **CA-5:** (observabilidad) Expone `produced/consumed/inserted/dropped/
      produce_errors/commits` en `/api/metrics`.
- [x] **CA-6:** (recursos) El pipeline no agota disco: log de mensajes con
      retención acotada.

## 6. Requisitos no funcionales
| Atributo | Objetivo | Resultado medido |
|---|---|---|
| Throughput | ≥ 1.000/s (pico 10×) | **15.000+/s** sin pérdida |
| Latencia ack | < 50 ms p99 | **3-6 ms** |
| Pérdida (normal) | 0 | **0** (1,5M y 10,8M msgs) |
| Resiliencia | replay sin pérdida | **probado**: 30K recuperados |

## 7. Restricciones
Cumple `CONSTITUTION.md` Art. 1 (multitenant), Art. 2 (durable), Art. 5
(observabilidad), Art. 9 (recursos acotados).

## 8. Riesgos
| Riesgo | Impacto | Mitigación |
|---|---|---|
| Pico supera capacidad de escritura | pérdida | log durable absorbe (retraso, no pérdida) |
| Disco del log se llena | caída | retención acotada (2 GB / 1 h) |

## 9. Preguntas abiertas (resueltas)
- ✅ ¿Cola in-process o broker? → **broker durable** (ADR-001-1).
- ✅ ¿acks=1 o all? → acks=1 (latencia); evaluar all si se exige durabilidad máxima.
