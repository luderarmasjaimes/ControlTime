# PLAN 002 — Dashboards mineros en tiempo real (revisión profunda)

| Campo | Valor |
|---|---|
| **Spec** | `specs/002-dashboards-tiempo-real/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Revisado por** | BE1 (C++/queries), BE3 (DBA/CAGG), FE1 (frontend) |
| **Sprint·Release** | S6 · R3 |
| **Constitución** | Art. 1 (multitenant), Art. 3 (aislamiento R/W), Art. 5 (observabilidad) |
| **Última revisión** | 2026-06-24 (auditado contra `kpi_service.cpp`, `sensor_service.cpp`, `mining_routes.cpp`) |

---

## 1. Enfoque técnico

Tres capas de optimización que trabajan juntas para cumplir el SLA O1 (<20 ms):

1. **Agregados continuos materializados (CAGG)** — `telemetry_kpi_1m` pre-materializa
   count/avg/min/max por `tenant_id` y minuto. Las queries de dashboard leen cubos
   de ~N filas en vez de escanear millones de filas crudas. Costo: O(cubos) vs O(filas).
2. **Réplica de lectura** (spec 004) — los 50+ dashboards concurrentes van a
   `db_replica`, **nunca** al primario. El primario queda libre para ingesta.
3. **Rol `dashboard_ro`** con `statement_timeout=15s` — dashboards no pueden
   ahogar ni la réplica con queries runaway, y el primario queda inmune.

> Resultado medido en test de 1h: primario **25% CPU** con ingesta a 3.000/s +
> 50 dashboards concurrentes en réplica. Antes de este diseño: primario al 620%
> con pérdida de 1,74M mensajes.

## 2. Arquitectura y flujo de datos

```
 Backend C++ (main.cpp · router)
      │
      ├── GET /api/dashboard/metrics  ──►  réplica (dashboard_ro, timeout=15s)
      │         SELECT tenant→ telemetry_kpi_1m (CAGG, materialized_only=true)
      │
      ├── GET /api/mining/kpis         ──►  réplica
      │         SELECT kpis_config WHERE tenant_id=$1
      │
      ├── GET /api/mining/kpis/points  ──►  réplica
      │         SELECT time_bucket, avg FROM telemetry_kpi_1m WHERE tenant=…
      │
      └── GET /api/sensors/data        ──►  réplica
                SELECT last value per sensor WHERE tenant=…

 PostgreSQL PRIMARIO                    db_replica (streaming, lag ~0 bytes)
      │                                       │
      ├── telemetry_raw (hypertable)          ├── telemetry_raw (read-only copy)
      └── telemetry_kpi_1m (CAGG)  ──────────└── telemetry_kpi_1m (replicated)
           materializes cada 1 min
           (policy: start -20min, end -1min)
```

## 3. Modelo de datos (CAGG)

```sql
-- Agregado continuo: pre-materializa por tenant + minuto
CREATE MATERIALIZED VIEW telemetry_kpi_1m
WITH (timescaledb.continuous) AS
SELECT
  tenant_id,
  time_bucket('1 minute', captured_at)   AS minuto,
  count(*)                                AS lecturas,
  avg(value_numeric)                      AS promedio,
  max(value_numeric)                      AS maximo,
  min(value_numeric)                      AS minimo,
  stddev(value_numeric)                   AS desviacion
FROM telemetry_raw
GROUP BY tenant_id, time_bucket('1 minute', captured_at)
WITH NO DATA;

-- Solo datos materializados (no escanea raw reciente → sin costo extra)
ALTER MATERIALIZED VIEW telemetry_kpi_1m
  SET (timescaledb.materialized_only = true);

-- Política de materialización automática (cada 1 min)
SELECT add_continuous_aggregate_policy('telemetry_kpi_1m',
  start_offset  => INTERVAL '20 minutes',
  end_offset    => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

-- Permiso a la réplica (rol de lectura)
GRANT SELECT ON telemetry_kpi_1m TO dashboard_ro;
GRANT USAGE ON SCHEMA _timescaledb_internal TO dashboard_ro;
```

**Índices del CAGG** (auto-generados por TimescaleDB):
- Índice primario en `(tenant_id, minuto)` — soporta filtros por empresa + rango.
- Sin índices manuales adicionales sobre el CAGG (ya están optimizados).

**Índice sobre `telemetry_raw`** para `GET /api/sensors/data` (último valor por sensor):
```sql
CREATE INDEX CONCURRENTLY ON telemetry_raw (sensor_id, captured_at DESC)
  WHERE captured_at > now() - interval '1 hour';
-- índice parcial: solo la ventana caliente, mínimo overhead
```

## 4. Contratos / endpoints (auditados 2026-06-24)

> ⚠️ **Corrección vs plan original:** `GET /api/mining/kpis` no consulta el CAGG
> `telemetry_kpi_1m` directamente. Usa la tabla **`mining_runtime_kpis`** (tabla
> operativa que los clientes actualizan via `/upsert` o `/sync-from-external`).
> El fallback es `dashboard_kpis`. El CAGG existe y se materializa, pero su lectura
> está en el SSE (spec 005) y en dashboards futuros, no en este endpoint aún.

| Endpoint | Lógica real (code) | Respuesta |
|---|---|---|
| `GET /api/dashboard/metrics` | `mining_routes.cpp::handleDashboardMetrics` → SELECT de `dashboard_kpis` + `dashboard_heatmap` | `{kpis:{…}, heatmap:[…]}` |
| `GET /api/mining/kpis[?category=]` | `kpi_service.cpp::handleGetKpis` → `mining_runtime_kpis` (activos, ordenados); fallback: `dashboard_kpis` | `{kpis:[{code,category,title,unit,current_value,trend_direction,…}]}` |
| `POST /api/mining/kpis/upsert` | `handleUpsertKpis` → INSERT/ON CONFLICT UPDATE en `mining_runtime_kpis` + punto en `mining_runtime_kpi_points` (auth requerida) | `{status:"ok", upserted:N}` |
| `POST /api/mining/kpis/sync-from-dashboard` | `handleSyncFromDashboard` → copia `dashboard_kpis` → `mining_runtime_kpis` | `{status:"ok", synced:N}` |
| `POST /api/mining/kpis/sync-from-external` | `handleSyncFromExternal` → consulta `KPI_EXTERNAL_DATABASE_URL` con `KPI_EXTERNAL_QUERY` y upserta local | `{status:"ok", synced:N}` |
| `GET /api/mining/kpis/points?code=X&days=N` | `handleGetKpiPoints` → `mining_runtime_kpi_points` (últimos N días, max 240 puntos) | `{points:[{label,value,ts}]}` |
| `GET /api/sensors/data[?tenant_id=X]` | `sensor_service.cpp::handleGetSensorData` → `mining_sensors`+`mining_sensor_categories`+`mining_sensor_types`+`mining_sensor_zones`+`mining_sensor_history` (7 días) | `{categories,zones,sensor_types,sensors,history}` |
| `GET /api/config/mining-locations` | `handleMiningLocations` → lista estática 12 minas peruanas | `[{company_name,latitude,longitude,zoom}]` |

**Tablas operativas de KPIs (no CAGG):**
```sql
-- Tabla principal de KPIs (no es CAGG — es tabla operativa)
mining_runtime_kpis (code PK, category, title, description, unit,
    current_value, target_value, trend_direction, trend_percent, status_color,
    active, sort_order, updated_at)

-- Histórico de puntos por KPI (para gráficos)
mining_runtime_kpi_points (kpi_code, point_label, point_value, point_ts)
```

**Variables de entorno para sync externo:**
- `KPI_EXTERNAL_DATABASE_URL` — URL de BD externa origen de KPIs
- `KPI_EXTERNAL_QUERY` — query personalizada (default: SELECT desde `mining_runtime_kpis`)

**Reglas de enrutamiento (Art. 3):**
- Lecturas (`GET`) → réplica (`REPLICA_DATABASE_URL`, rol `dashboard_ro`).
- Escrituras (`POST`) → primario (pool PgPool).

## 5. Concurrencia / performance

- **PgBouncer** (transaction pooling, `max_client_conn=10.000`) absorbe las 50+
  conexiones concurrentes de dashboards sin saturar la réplica.
- **`statement_timeout=15s`** en rol `dashboard_ro` — una query runaway no dura
  más de 15 s y no bloquea a las demás.
- **CAGG `materialized_only=true`** elimina el escaneo de datos crudos recientes
  en cada query de dashboard → query típica sobre el CAGG: **3-17 ms** (medido).

## 6. Seguridad (Art. 1, 6)

- Rol `dashboard_ro` en la réplica: `SELECT` únicamente; sin `INSERT/UPDATE/DELETE`.
  La réplica rechaza escrituras físicamente (standby mode).
- Todo query lleva `tenant_id` del JWT de sesión — imposible ver datos de otra empresa.
- `statement_timeout` impide exfiltración por timing attack de queries largas.

## 7. Decisiones de arquitectura (ADR)

| ADR | Decisión | Estado |
|---|---|---|
| ADR-002-1 | Dashboards leen de **CAGG, no de tabla cruda** (O(cubos) vs O(filas)) | Aceptado |
| ADR-002-2 | `materialized_only=true` — frescura máx 60 s, a cambio de 0 costo de escaneo | Aceptado |
| ADR-002-3 | Aislamiento físico R/W en réplica (no solo lógico con roles) | Aceptado (heredado de 004) |

## 8. Plan de pruebas (cada CA con evidencia)

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | Query sobre CAGG con rango 1 h, 5 tenants | tiempo de respuesta medido con `EXPLAIN ANALYZE` |
| CA-2 | 50 clientes concurrentes a `/api/dashboard/metrics` durante 5 min | CPU primario < 30%; 0 errores |
| CA-3 | Login empresa A → query → comparar con empresa B | 0 filas cruzadas |
| CA-4 | `/api/dashboard/metrics` + SSE activo | datos se actualizan sin recargar |
| CA-5 | `curl` de cada endpoint → HTTP 200 con payload real | respuestas adjuntas |
| CA-6 | Parar `db_replica` → dashboard consulta | degrada sin error 500 (fallback o mensaje) |
| Medición | `EXPLAIN ANALYZE` sobre `telemetry_kpi_1m` con 10M filas | plan `Index Scan` en CAGG |

## 9. Despliegue / rollback

- SQL: `db_scripts/28_continuous_aggregates.sql` + `db_scripts/64_telemetry_ingest_optimization.sql` (renumerado desde `29` el 2026-08-20, colisión de numeración resuelta — ver `docs/decisions/README.md`).
- Env: `REPLICA_DATABASE_URL` en el backend; rol `dashboard_ro` en `db_init/`.
- Rollback: cambiar queries a `materialized_only=false` (escanea raw) o a primario.

## 10. Costo / recursos (Art. 9)

- CAGG ocupa ~200 B/fila de agregado × N_tenants × N_minutos — pequeño vs raw.
- Materialización cada 1 min: trabajo leve sobre la ventana nueva (incremental).
- Réplica: 4 CPU / 4 GB, `statement_timeout=15s` (acotado por diseño).
