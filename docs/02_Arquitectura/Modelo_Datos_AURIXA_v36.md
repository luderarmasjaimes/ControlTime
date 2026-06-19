# MODELO DE DATOS — PLATAFORMA AURIXA

## Estructura de Bases de Datos: Temporal (Caliente) · Histórica (Permanente) · Operacional

**Versión:** v36 — alineada al SOW v3.0 y al estado real de `db_scripts/`
**Fecha:** 19 de junio de 2026
**Audiencia:** Gerencia TI, Arquitectura, DBA (BE3) y equipo técnico

> Hoy el proyecto ya tiene **2 bases de datos** (`sensors_db` en TimescaleDB y `formula`). Este documento define la **organización objetivo en 3 planos** según la naturaleza del dato (temporal / histórico / operacional) y las políticas de tiempo real, retención y resiliencia.

---

## 1. Estado actual (2 bases de datos)

| BD | Motor | Contenido | Hypertables |
|---|---|---|---|
| `sensors_db` | **TimescaleDB** (PG15) | Telemetría IoT v2, sensores, alertas, dashboards, auth, reports, mapas, KPIs | `telemetry_raw(captured_at)`, `telemetry_multivariate(captured_at)` |
| `formula` | PostgreSQL 15 | Motor FORMULA (bloques/conexiones/reglas), minería legacy (`mineria_*`), `mineria_lecturas`, `formula_sessions` | — |

**Hallazgos:**
- ✅ Separación lógica ya existe (sin claves foráneas cruzadas; convergen por `iot_sensor_id`, `site_id`, `tenant_id`).
- ❌ **Sin políticas de retención ni compresión** en las hypertables.
- ❌ **Sin continuous aggregates** (agregados pre-calculados por hora/día).
- ⚠️ `mineria_lecturas` y `mining_sensor_history` son **series temporales** pero todavía son tablas regulares.

---

## 2. Estructura objetivo: 3 planos de datos

```
┌──────────────────────────────────────────────────────────────────────┐
│  BD HOT  (temporal / caliente)   — TimescaleDB                         │
│  alta escritura · lecturas recientes (24-72h) · 10k sensores           │
│  telemetry_raw · telemetry_multivariate · mining_sensor_history ·      │
│  mineria_lecturas(reciente) · alerts(abiertas) · colas/outbox          │
│  Retención 30-45d · compresión >7d · continuous aggregates h/día       │
└──────────────────────────────────────────────────────────────────────┘
        │ archivado/rollup (>30-45d)              ▲ consultas en vivo
        ▼                                          │
┌──────────────────────────────────────────────────────────────────────┐
│  BD HISTÓRICA  (permanente)      — PG / columnar + MinIO               │
│  crecimiento indefinido · consulta a largo plazo · compliance          │
│  platform_audit_log · auth_audit_logs · report_content_revision ·      │
│  formula_sessions · etl_job_run · etl_sync_run · KPI points ·          │
│  lecturas archivadas (Parquet en MinIO)                                │
│  Retención 2-7 años · archivo a objeto · partición anual               │
└──────────────────────────────────────────────────────────────────────┘
        ▲ referencia de config
        │
┌──────────────────────────────────────────────────────────────────────┐
│  BD OPERACIONAL  (config / maestros)  — PostgreSQL ACID                │
│  baja escritura · alta consistencia · replicación full · DR < 15 min   │
│  tenants/sites/assets/sensors · sensor_profile · RBAC(sec_*) ·         │
│  reports/projects/dashboards · catálogos(ref_country/locale) ·         │
│  mineria_empresas/minas/variables/sensores · map/KPI config            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Clasificación de tablas por plano

### 3.1 BD HOT — Temporal / Caliente

| Tabla | Tiempo | Hypertable | Política objetivo |
|---|---|---|---|
| `telemetry_raw` | `captured_at` | ✅ | compresión >7d, retención 30-45d |
| `telemetry_multivariate` | `captured_at` | ✅ | compresión >7d, retención 30-45d |
| `mining_sensor_history` | `timestamp` | ➡️ migrar a hypertable | compresión >7d |
| `mineria_lecturas` | `timestamp_lectura` | ➡️ migrar a hypertable | compresión >30d |
| `alerts` (abiertas) | `triggered_at` | — | purga al resolver/archivar |
| `sensor_process_alarm_queue` | `created_at` | — | purga >7d |
| `org_notification_outbox` | `created_at` | — | purga sent >30d |
| `mining_runtime_kpi_points` | `point_ts` | — | rollup + archivo >6m |

### 3.2 BD HISTÓRICA — Permanente

| Tabla | Tiempo | Retención | Estrategia |
|---|---|---|---|
| `platform_audit_log` | `created_at` | 2-7 años | partición anual + archivo |
| `auth_audit_logs` | `event_time` | 2-7 años | partición anual |
| `report_content_revision` | `created_at` | indefinida | versiones (datos pequeños) |
| `report_sensitive_action_log` | `created_at` | compliance | partición anual |
| `formula_sessions` | `created_at` | 2 años | archivo >1 año |
| `etl_job_run` / `etl_sync_run` | `started_at` | 6-12 meses | archivo |
| Telemetría archivada | `captured_at` | 2-7 años | **Parquet en MinIO** (continuous aggregate → export) |

### 3.3 BD OPERACIONAL — Config / Maestros

| Grupo | Tablas |
|---|---|
| Multitenant raíz | `tenants`, `sites`, `assets`, `tenant_country` |
| Definición de sensores | `sensors`, `sensor_profile`, `sensor_input_parameter_def`, `sensor_output_channel_def`, `sensor_attribute_kv`, `sensor_ingest_credential`, `alert_rules` |
| RBAC / Seguridad | `sec_permission`, `sec_role`, `sec_role_permission`, `auth_user_role`, `auth_users`, `auth_user_tenant`, `auth_face_templates` |
| Informes | `reports`, `projects`, `report_acl`, `report_share_group(_member)`, `report_document_settings`, `report_embedded_asset` |
| Dashboards | `dashboards`, `dashboard_widgets`, `widget_queries` |
| Minería (FORMULA) | `mineria_empresas`, `mineria_minas`, `mineria_variables`, `mineria_sensores`, `blocks`, `connections`, `rules` |
| Mapas / KPIs config | `map_markers`, `mining_site_locations`, `mining_runtime_kpis`, `mining_sensor_zones` |
| Catálogos / i18n | `ref_country`, `ref_locale`, `i18n_entry`, `mining_sensor_categories/types` |
| Notificaciones / ETL config | `org_notify_*`, `etl_sync_peer`, `etl_job_definition`, `alarm_*` |
| Autorización supervisada | `authz_workflow(_step)`, `authz_case(_step)` |

---

## 4. Política por plano (tiempo real, retención y resiliencia)

| Plano | Motor | Retención | Replicación | Backup / DR |
|---|---|---|---|---|
| **HOT** | TimescaleDB (`sensors_db`) | 30-45 días | read-replica para dashboards | incremental diario |
| **HISTÓRICA** | PG dedicada + MinIO (Parquet) | 2-7 años | archivo a objeto | full semanal + incremental diario |
| **OPERACIONAL** | PostgreSQL ACID | indefinida | **streaming a standby** | continuo, **DR < 15 min** (O5) |

> El motor FORMULA (`formula`) puede mantenerse como BD independiente (aislamiento de ciclo de vida) o consolidarse como esquema dentro de la BD operacional. `mineria_lecturas` (serie temporal) pertenece conceptualmente al plano HOT/HISTÓRICA.

---

## 5. Optimizaciones TimescaleDB recomendadas

1. **Compresión** de chunks antiguos (>7d) — reduce 90%+ el almacenamiento de telemetría.
2. **Retención** automática (drop chunks >30-45d en HOT; los datos viven en HISTÓRICA/MinIO).
3. **Continuous aggregates** (avg/min/max/count por sensor y hora/día) — dashboards y KPIs **sub-segundo** sin recalcular sobre crudo.
4. **Migrar** `mineria_lecturas` y `mining_sensor_history` a hypertable.
5. **Chunk interval** de 7 días en las hypertables de telemetría.

> SQL listo para aplicar: `docs/02_Arquitectura/sql/30_timescale_policies.sql`.

---

## 6. Flujo del dato entre planos

```
Sensor → aurixa-telemetry (C++) → Redpanda → consumidor → BD HOT (telemetry_raw)
                                                   │
                continuous aggregate (hora/día) ───┤→ dashboards / KPIs (sub-seg)
                                                   │
                  retención >30-45d ──────────────►  export Parquet → MinIO (HISTÓRICA)
                                                   │
                          ml_engine lee HOT+HISTÓRICA → predicciones → BD OPERACIONAL
```

---

## 7. Responsables y sprints

| Acción | Rol | Sprint |
|---|---|---|
| Políticas compresión/retención | BE3 (DBA) | S9–S10 |
| Continuous aggregates + KPIs | BE3 + BE1 | S10–S11 |
| Migrar lecturas a hypertable | BE3 | S9 |
| Réplica + DR < 15 min | BE3 + SYS | S10 |
| Archivo Parquet a MinIO | BE3 + SYS | S11 |
