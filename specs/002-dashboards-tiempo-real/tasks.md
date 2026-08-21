# TASKS 002 — Dashboards mineros en tiempo real

| Campo | Valor |
|---|---|
| **Plan** | `specs/002-dashboards-tiempo-real/plan.md` |
| **Sprint·Release** | S6 · R3 |
| **Responsables** | BE1 (C++/routing), BE3 (DBA/CAGG), FE1 (frontend), QA |
| **Última revisión** | 2026-06-24 v2 (T15 implementado — degradación graceful réplica caída) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Migración SQL: crear `telemetry_kpi_1m` (CAGG, materialized_only=true) | CA-1 | BE3 | **Opus** (CAGG delicado) | ☑ |
| **T2** | Política de materialización: `add_continuous_aggregate_policy` (1 min) | CA-1 | BE3 | Sonnet | ☑ |
| **T3** | Rol `dashboard_ro` + `statement_timeout=15s` + grants sobre CAGG | CA-2,CA-3 | BE3 | Sonnet | ☑ |
| **T4** | Índice parcial en `telemetry_raw(sensor_id, captured_at DESC)` para último valor | CA-1 | BE3 | Sonnet | ☑ |
| **T5** | Routing C++: leer `REPLICA_DATABASE_URL` en `kpi_service.cpp` | CA-2,CA-6 | BE1 | Sonnet | ☑ |
| **T6** | Routing C++: leer `REPLICA_DATABASE_URL` en `mining_routes.cpp` | CA-2 | BE1 | Sonnet | ☑ |
| **T7** | Routing C++: leer `REPLICA_DATABASE_URL` en `sensor_service.cpp` | CA-2 | BE1 | Sonnet | ☑ |
| **T8** | Routing C++: leer `REPLICA_DATABASE_URL` en `surveillance_service.cpp` | CA-2 | BE1 | Sonnet | ☑ |
| **T9** | Verificar aislamiento multitenant: query con `tenant_id` del JWT | CA-3 | BE1 | Sonnet | ☑ |
| **T10** | Medir latencia CAGG con `EXPLAIN ANALYZE` (10M filas) | CA-1 | BE3 | — | ☑ |
| **T11** | Test 50 dashboards concurrentes 5 min: CPU primario < 30%, 0 errores | CA-2 | QA | — | ☑ |
| **T12** | Test multitenant: empresa A no ve datos de B | CA-3 | QA | — | ☑ |
| **T13** | `materialized_only=true` en producción (ALTER MATERIALIZED VIEW) | CA-1 | BE3 | Haiku | ☑ |
| **T14** | Verificar endpoints con `curl`: 200 + payload real cada uno | CA-5 | QA | — | ☑ |
| **T15** | Degradación graceful: réplica parada → SSE fallback a primario + `degraded:true` | CA-6 | BE1 | Sonnet | ☑ |

> **Nota:** T1-T14 completadas y validadas en test de esfuerzo de 1h (2026-06).
> T15 implementado 2026-06-24: `handleLiveKpiSse` intenta réplica; si falla, conecta
> al primario y agrega `"degraded": true` en cada evento SSE. Registra en stderr.

## Secuencia (dependencias)

```
T1 ─► T2 ─► T3 ─► T13       (CAGG: crear → política → rol → activar)
T4                            (índice independiente)
T5 ─► T6 ─► T7 ─► T8        (routing réplica en cada service)
(T1-T8) ─► T9 ─► T10        (validar aislamiento + medir)
(T9-T10) ─► T11 ─► T12 ─► T14   (tests)
T15 (puede ir en paralelo con tests)
```

## Definition of Done (feature 002)

- [x] T1-T14 completadas y enlazadas a commits.
- [x] **CA demostrados:**
  - [x] CA-1 CAGG responde en 3-17 ms con 10M filas (`EXPLAIN ANALYZE` adjunto)
  - [x] CA-2 50 dashboards concurrentes, CPU primario < 30%, 0 errores (test 1h)
  - [x] CA-3 cero filas cruzadas entre empresas
  - [x] CA-4 SSE + dashboard actualizan sin recargar
  - [x] CA-5 todos los endpoints HTTP 200 con payload
- [x] CA-6 (degradación sin réplica) — SSE fallback a primario + flag `degraded:true` (implementado 2026-06-24)
- [x] ADR-002-1..3 registrados.
- [x] Sin violar Constitución (Art. 1, 3, 5).

## Métricas de éxito (KPIs SOW)

| KPI | Meta | Medido |
|---|---|---|
| O1 (query dashboard) | < 20 ms | **3-17 ms** (CAGG, `materialized_only=true`) |
| CPU primario bajo carga | < 30% | **25%** (50 dashboards + ingesta 3k/s) |
| CPU réplica bajo carga | < 80% | **3-20%** (50 dashboards) |
| Aislamiento multitenant | 0 filas cruzadas | **0** |

## Evidencias de implementación (retroactivas)

- Script SQL: `db_scripts/28_continuous_aggregates.sql` (CAGG + política)
- Script SQL: `db_scripts/64_telemetry_ingest_optimization.sql` (índice parcial, rol, grants; renumerado desde `29` el 2026-08-20)
- Código C++: `backend/src/mining/kpi_service.cpp` (REPLICA_DATABASE_URL)
- Código C++: `backend/src/mining/mining_routes.cpp` (REPLICA_DATABASE_URL)
- Código C++: `backend/src/mining/sensor_service.cpp` (REPLICA_DATABASE_URL)
- Código C++: `backend/src/mining/surveillance_service.cpp` (REPLICA_DATABASE_URL)
- Test esfuerzo 1h: reporte comparativo v1-v5 (generado en sesión 2026-06)
