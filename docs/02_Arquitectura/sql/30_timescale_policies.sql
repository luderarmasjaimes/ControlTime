-- =============================================================================
--  AURIXA - Políticas TimescaleDB (HOT) + continuous aggregates
--  ASSET DOCUMENTADO - NO se ejecuta en init (no está en db_scripts/).
--  Aplicar manualmente sobre sensors_db una vez creadas las hypertables:
--    psql "$DATABASE_URL" -f docs/02_Arquitectura/sql/30_timescale_policies.sql
--  Requiere extensión timescaledb. Idempotente donde es posible.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- 1) Intervalo de chunk (7 días) en las hypertables de telemetría
-- ---------------------------------------------------------------------------
SELECT set_chunk_time_interval('telemetry_raw',          INTERVAL '7 days');
SELECT set_chunk_time_interval('telemetry_multivariate', INTERVAL '7 days');

-- ---------------------------------------------------------------------------
-- 2) Compresión de chunks antiguos (>7 días)
-- ---------------------------------------------------------------------------
ALTER TABLE telemetry_raw SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tenant_id, sensor_id',
  timescaledb.compress_orderby    = 'captured_at DESC'
);
SELECT add_compression_policy('telemetry_raw', INTERVAL '7 days', if_not_exists => TRUE);

ALTER TABLE telemetry_multivariate SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tenant_id, sensor_id, channel_code',
  timescaledb.compress_orderby    = 'captured_at DESC'
);
SELECT add_compression_policy('telemetry_multivariate', INTERVAL '7 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- 3) Retención en el plano HOT (los datos viven luego en HISTÓRICA/MinIO)
--    Ajustar a la política de negocio (30-45 días).
-- ---------------------------------------------------------------------------
SELECT add_retention_policy('telemetry_raw',          INTERVAL '45 days', if_not_exists => TRUE);
SELECT add_retention_policy('telemetry_multivariate', INTERVAL '45 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- 4) Migrar series temporales regulares a hypertables
--    (migrate_data => TRUE convierte la tabla existente)
-- ---------------------------------------------------------------------------
SELECT create_hypertable('mining_sensor_history', 'timestamp',
       chunk_time_interval => INTERVAL '7 days',
       migrate_data => TRUE, if_not_exists => TRUE);

SELECT create_hypertable('mineria_lecturas', 'timestamp_lectura',
       chunk_time_interval => INTERVAL '30 days',
       migrate_data => TRUE, if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- 5) Continuous aggregates (KPIs sub-segundo, por sensor y hora)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_raw_hourly
WITH (timescaledb.continuous) AS
SELECT tenant_id,
       sensor_id,
       time_bucket(INTERVAL '1 hour', captured_at) AS bucket,
       count(*)               AS n,
       avg(value_numeric)     AS avg_value,
       min(value_numeric)     AS min_value,
       max(value_numeric)     AS max_value
FROM telemetry_raw
GROUP BY tenant_id, sensor_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_raw_hourly',
  start_offset       => INTERVAL '3 days',
  end_offset         => INTERVAL '1 hour',
  schedule_interval  => INTERVAL '30 minutes',
  if_not_exists      => TRUE);

-- Agregado diario (consultas históricas y reportes)
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_raw_daily
WITH (timescaledb.continuous) AS
SELECT tenant_id,
       sensor_id,
       time_bucket(INTERVAL '1 day', captured_at) AS bucket,
       count(*)           AS n,
       avg(value_numeric) AS avg_value,
       min(value_numeric) AS min_value,
       max(value_numeric) AS max_value
FROM telemetry_raw
GROUP BY tenant_id, sensor_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_raw_daily',
  start_offset       => INTERVAL '30 days',
  end_offset         => INTERVAL '1 day',
  schedule_interval  => INTERVAL '6 hours',
  if_not_exists      => TRUE);

-- =============================================================================
--  Nota: el archivado a Parquet/MinIO (plano HISTÓRICA) se realiza por job ETL
--  (aurixa-ml-training / etl) exportando los agregados antes de la retención.
-- =============================================================================
