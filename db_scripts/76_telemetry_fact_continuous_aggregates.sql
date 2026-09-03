-- ============================================================================
-- 76_telemetry_fact_continuous_aggregates.sql
-- ADR-131: continuous aggregates hora/dia sobre las 3 hypertables de hechos
-- nuevas, reemplazando (supersede parcial) a los 4 aggregates de
-- 35_adr006_continuous_aggregates_sensor_history.sql (mining_sensor_history_*,
-- telemetry_raw_*) que existian pero NUNCA fueron consultados por el backend
-- (confirmado por grep: sensor_service.cpp:136-141 sigue leyendo la tabla
-- cruda). Estos son los que el backend debe consumir a partir de ahora para
-- cualquier dashboard/reporte de rango >1 hora -- ver Fase 8 del plan
-- (cutover de sensor_service.cpp/kpi_service.cpp/sensor_telemetry_wizard.cpp).
--
-- Dimensionamiento (ADR-131): a 25.000 sensores unicos, el rollup horario pesa
-- ~81GB para 5 anios (~243x mas chico que el raw comprimido equivalente) y el
-- diario ~3.4GB para 5 anios (~5.800x mas chico) -- es la unica forma viable
-- de servir "dashboards con historicos de 5 anios" sin mantener 5 anios de
-- raw en el hypertable caliente (inviable: 43.800 chunks de 1h).
--
-- Idempotente: CREATE MATERIALIZED VIEW IF NOT EXISTS + add_continuous_
-- aggregate_policy con if_not_exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- telemetry_fact (25k/s)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_fact_hourly
WITH (timescaledb.continuous) AS
SELECT
    tenant_id_sk,
    sensor_id_sk,
    channel_id,
    time_bucket(INTERVAL '1 hour', captured_at) AS bucket,
    AVG(value_numeric)  AS avg_value,
    MIN(value_numeric)  AS min_value,
    MAX(value_numeric)  AS max_value,
    COUNT(*)            AS sample_count
FROM telemetry_fact
GROUP BY tenant_id_sk, sensor_id_sk, channel_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_fact_hourly',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval  => INTERVAL '1 hour',
    if_not_exists      => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_fact_daily
WITH (timescaledb.continuous) AS
SELECT
    tenant_id_sk,
    sensor_id_sk,
    channel_id,
    time_bucket(INTERVAL '1 day', captured_at) AS bucket,
    AVG(value_numeric)  AS avg_value,
    MIN(value_numeric)  AS min_value,
    MAX(value_numeric)  AS max_value,
    COUNT(*)            AS sample_count
FROM telemetry_fact
GROUP BY tenant_id_sk, sensor_id_sk, channel_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_fact_daily',
    start_offset      => INTERVAL '90 days',
    end_offset        => INTERVAL '1 day',
    schedule_interval  => INTERVAL '6 hours',
    if_not_exists      => TRUE);

-- ---------------------------------------------------------------------------
-- telemetry_fact_formula (ex mineria_lecturas)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_fact_formula_hourly
WITH (timescaledb.continuous) AS
SELECT
    tenant_id_sk, sensor_id_sk, channel_id,
    time_bucket(INTERVAL '1 hour', captured_at) AS bucket,
    AVG(value_numeric) AS avg_value, MIN(value_numeric) AS min_value,
    MAX(value_numeric) AS max_value, COUNT(*) AS sample_count
FROM telemetry_fact_formula
GROUP BY tenant_id_sk, sensor_id_sk, channel_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_fact_formula_hourly',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_fact_formula_daily
WITH (timescaledb.continuous) AS
SELECT
    tenant_id_sk, sensor_id_sk, channel_id,
    time_bucket(INTERVAL '1 day', captured_at) AS bucket,
    AVG(value_numeric) AS avg_value, MIN(value_numeric) AS min_value,
    MAX(value_numeric) AS max_value, COUNT(*) AS sample_count
FROM telemetry_fact_formula
GROUP BY tenant_id_sk, sensor_id_sk, channel_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_fact_formula_daily',
    start_offset => INTERVAL '90 days', end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '6 hours', if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- telemetry_fact_demo (ex mining_sensor_history)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_fact_demo_hourly
WITH (timescaledb.continuous) AS
SELECT
    tenant_id_sk, sensor_id_sk, channel_id,
    time_bucket(INTERVAL '1 hour', captured_at) AS bucket,
    AVG(value_numeric) AS avg_value, MIN(value_numeric) AS min_value,
    MAX(value_numeric) AS max_value, COUNT(*) AS sample_count
FROM telemetry_fact_demo
GROUP BY tenant_id_sk, sensor_id_sk, channel_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_fact_demo_hourly',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_fact_demo_daily
WITH (timescaledb.continuous) AS
SELECT
    tenant_id_sk, sensor_id_sk, channel_id,
    time_bucket(INTERVAL '1 day', captured_at) AS bucket,
    AVG(value_numeric) AS avg_value, MIN(value_numeric) AS min_value,
    MAX(value_numeric) AS max_value, COUNT(*) AS sample_count
FROM telemetry_fact_demo
GROUP BY tenant_id_sk, sensor_id_sk, channel_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_fact_demo_daily',
    start_offset => INTERVAL '90 days', end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '6 hours', if_not_exists => TRUE);
