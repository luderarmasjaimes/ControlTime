# SPEC 002 — Dashboards mineros en tiempo real

| Campo | Valor |
|---|---|
| **ID** | 002 · **Estado** | **Aprobado (retroactivo)** |
| **SOW** | KPI **O1** (retraso visual < 20 ms local), O4 (10k sensores) · Sprints S6, S9, S11 |
| **Constitución** | Art. 1 (multitenant), Art. 3 (aislamiento R/W), Art. 5 (observabilidad) |
| **Depende de** | 001 (ingesta), 004 (réplica), 005 (push) |
| **Última revisión** | 2026-06-24 (auditado contra `kpi_service.cpp`, `sensor_service.cpp`, `mining_routes.cpp`) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-002**; fuente ADR: `docs/decisions/`.

- **ADR-002** — [`002-backend-cpp-gateway-central.md`](../../docs/decisions/002-backend-cpp-gateway-central.md)
- **ADR-006** — [`006-timescaledb-hypertables-retencion.md`](../../docs/decisions/006-timescaledb-hypertables-retencion.md)
- **ADR-031** — [`031-backend-plataforma-compartida-multicomponente.md`](../../docs/decisions/031-backend-plataforma-compartida-multicomponente.md)
- **ADR-057** — [`057-dashboard-widgets-estilo-thingsboard.md`](../../docs/decisions/057-dashboard-widgets-estilo-thingsboard.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-108** — [`108-capacidad-telemetria-25k-topologia-escalamiento.md`](../../docs/decisions/108-capacidad-telemetria-25k-topologia-escalamiento.md)


## 1. Problema
El operador y la gerencia minera necesitan ver el estado de los sensores y los
KPIs de su empresa **en vivo**, sin recargar la página y sin que esas consultas
degraden la ingesta. Hoy una consulta ad-hoc sobre la tabla cruda a alta tasa de
ingesta tarda segundos y satura la BD.

## 2. Objetivo
Mostrar KPIs por empresa y tipo de sensor con **retraso < 20 ms** (SLA O1),
actualizándose solos, sin afectar la ruta de escritura.

## 3. Usuarios y contexto
- **Roles:** operador de mina, gerente, analista. **Multitenant:** cada dashboard
  ve solo su `tenant_id`. **Escala:** ≥ 50 dashboards concurrentes, 5+ empresas.

## 4. Alcance
**Incluye:** dashboard de KPIs (avg/min/max/p95 por tipo de sensor), conteo de
sensores activos, tendencia; lectura desde **réplica + agregados continuos**.
**NO incluye:** edición de informes (007), alertas (016), mapas (009).

## 5. Criterios de aceptación
- [ ] **CA-1:** Query de panel KPI responde **< 20 ms** (p95) leyendo de agregado materializado.
- [ ] **CA-2:** 50 dashboards concurrentes no superan el 30% de CPU del **primario** (van a la réplica).
- [ ] **CA-3:** (multitenant) Un dashboard nunca muestra datos de otra empresa.
- [ ] **CA-4:** El panel se actualiza solo (push, ver 005) sin recargar.
- [ ] **CA-5:** Endpoints existentes responden 200 con datos reales: `/api/dashboard/metrics`, `/api/mining/kpis`, `/api/sensors/data`.
- [ ] **CA-6:** (resiliencia) Si la réplica cae, el panel degrada con dato del primario o último valor, sin error duro al usuario.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Latencia query | < 20 ms p95 (SLA O1) |
| Concurrencia | ≥ 50 dashboards |
| Frescura del dato | ≤ 60 s (agregado de 1 min) |
| Aislamiento | dashboards NO tocan el primario |

## 7. Contratos (endpoints reales)
- `GET /api/dashboard/metrics` — KPIs agregados del tenant.
- `GET /api/mining/kpis[?category=]` — KPIs operativos.
- `GET /api/mining/kpis/points` — series para gráficos.
- `GET /api/sensors/data` — últimas lecturas por sensor.
- (lectura) → **réplica** vía rol `dashboard_ro` (`statement_timeout=15s`).

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Query escanea tabla cruda → satura | usar agregado continuo `telemetry_kpi_1m` (materialized_only) |
| Lag de réplica muestra dato viejo | mostrar timestamp del dato; lag objetivo < 1 s |
