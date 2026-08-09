-- ============================================================================
-- 35_adr006_continuous_aggregates_sensor_history.sql
-- Completa ADR-006: (1) migra `mining_sensor_history` a hypertable — la
-- ÚNICA tabla de telemetría que las reglas duras del ADR nombraban
-- explícitamente y que 32_mineria_lecturas_hypertable.sql no cubrió (ese
-- script solo migró `mineria_lecturas`); (2) agrega continuous aggregates
-- hora/día sobre `mining_sensor_history` y `telemetry_raw`, la pieza de la
-- política de ADR-006 que faltaba por completo (cero `CREATE MATERIALIZED
-- VIEW ... WITH (timescaledb.continuous)` existía en el repo).
--
-- Dependencias verificadas antes de escribir este script (mismo criterio que
-- 32_mineria_lecturas_hypertable.sql):
--   - 0 FK de otras tablas hacia mining_sensor_history.id
--   - 0 vistas dependientes (pg_rewrite)
--   - 0 triggers propios sobre la tabla
--   - Único acceso desde backend: sensor_service.cpp (SELECT de solo lectura
--     por rango de tiempo reciente para el gráfico en vivo) — no rompe con el
--     swap de tabla, sigue funcionando por nombre.
--
-- Nota sobre alcance real vs. la regla dura "los KPIs de dashboard leen de
-- continuous aggregates, no de la tabla cruda": hoy NINGUNA query del backend
-- hace agregación hora/día sobre telemetría cruda (grep confirmado: sin
-- date_trunc/GROUP BY/time_bucket en mining/*.cpp) — el gráfico en vivo de
-- sensor_service.cpp lee ventana reciente sin agregar, correctamente (perdería
-- granularidad si leyera de un rollup horario). Este script deja lista la
-- infraestructura (caggs + refresh policy) para cuando se agregue una vista
-- de tendencia histórica real; no hay endpoint que redirigir todavía.
--
-- Idempotente: create_hypertable/policies con if_not_exists; el swap de tabla
-- detecta si mining_sensor_history ya es hypertable y no repite el swap.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'mining_sensor_history'
    ) THEN
        RAISE NOTICE 'mining_sensor_history ya es hypertable — nada que hacer.';
        RETURN;
    END IF;

    -- 1) Tabla nueva con PK compuesta (incluye la columna de partición) —
    --    mining_sensor_history.id es SERIAL PK sin timestamp, igual que
    --    mineria_lecturas antes de su migración; misma razón para el swap.
    CREATE TABLE mining_sensor_history_new (
        id         BIGINT GENERATED ALWAYS AS IDENTITY,
        sensor_id  INTEGER NOT NULL REFERENCES mining_sensors (id) ON DELETE CASCADE,
        value      NUMERIC,
        "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, "timestamp")
    );

    -- 2) Hypertable antes de copiar datos.
    PERFORM create_hypertable(
        'mining_sensor_history_new', 'timestamp',
        chunk_time_interval => INTERVAL '7 days'
    );

    -- 3) Copiar datos existentes preservando los id originales.
    INSERT INTO mining_sensor_history_new (id, sensor_id, value, "timestamp")
    OVERRIDING SYSTEM VALUE
    SELECT id, sensor_id, value, "timestamp"
    FROM mining_sensor_history;

    -- 4) Realinear la secuencia de identidad.
    PERFORM setval(
        pg_get_serial_sequence('mining_sensor_history_new', 'id'),
        COALESCE((SELECT MAX(id) FROM mining_sensor_history_new), 0) + 1,
        false
    );

    -- 5) Swap: la tabla vieja queda de respaldo con sufijo _old.
    ALTER INDEX idx_mining_sensor_history_sensor_ts RENAME TO idx_mining_sensor_history_sensor_ts_old;
    ALTER TABLE mining_sensor_history RENAME TO mining_sensor_history_old;
    ALTER TABLE mining_sensor_history_new RENAME TO mining_sensor_history;
    ALTER SEQUENCE mining_sensor_history_id_seq RENAME TO mining_sensor_history_old_id_seq;

    -- 6) Índice de acceso (mismo patrón que sensor_service.cpp usa hoy).
    CREATE INDEX idx_mining_sensor_history_sensor_ts
        ON mining_sensor_history (sensor_id, "timestamp" DESC);

    RAISE NOTICE 'mining_sensor_history migrada a hypertable. Tabla original conservada como mining_sensor_history_old.';
END $$;

-- ---------------------------------------------------------------------------
-- 7) Compresión: chunks > 7 días (tabla de telemetría de dashboard, mismo
--    umbral que las tablas `telemetry_*` en la política de ADR-006).
-- ---------------------------------------------------------------------------
ALTER TABLE mining_sensor_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby = '"timestamp" DESC'
);

SELECT add_compression_policy('mining_sensor_history', INTERVAL '7 days', if_not_exists => TRUE);

ANALYZE mining_sensor_history;

-- ============================================================================
-- Continuous aggregates — mining_sensor_history (dashboard de sensores)
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mining_sensor_history_hourly
WITH (timescaledb.continuous) AS
SELECT
    sensor_id,
    time_bucket(INTERVAL '1 hour', "timestamp") AS bucket,
    AVG(value)   AS avg_value,
    MIN(value)   AS min_value,
    MAX(value)   AS max_value,
    COUNT(*)     AS sample_count
FROM mining_sensor_history
GROUP BY sensor_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('mining_sensor_history_hourly',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval  => INTERVAL '1 hour',
    if_not_exists      => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS mining_sensor_history_daily
WITH (timescaledb.continuous) AS
SELECT
    sensor_id,
    time_bucket(INTERVAL '1 day', "timestamp") AS bucket,
    AVG(value)   AS avg_value,
    MIN(value)   AS min_value,
    MAX(value)   AS max_value,
    COUNT(*)     AS sample_count
FROM mining_sensor_history
GROUP BY sensor_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('mining_sensor_history_daily',
    start_offset      => INTERVAL '90 days',
    end_offset        => INTERVAL '1 day',
    schedule_interval  => INTERVAL '6 hours',
    if_not_exists      => TRUE);

-- ============================================================================
-- Continuous aggregates — telemetry_raw (ingesta de alta tasa, ADR-007/008)
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_raw_hourly
WITH (timescaledb.continuous) AS
SELECT
    tenant_id,
    sensor_id,
    time_bucket(INTERVAL '1 hour', captured_at) AS bucket,
    AVG(value_numeric)   AS avg_value,
    MIN(value_numeric)   AS min_value,
    MAX(value_numeric)   AS max_value,
    COUNT(*)             AS sample_count
FROM telemetry_raw
GROUP BY tenant_id, sensor_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_raw_hourly',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval  => INTERVAL '1 hour',
    if_not_exists      => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_raw_daily
WITH (timescaledb.continuous) AS
SELECT
    tenant_id,
    sensor_id,
    time_bucket(INTERVAL '1 day', captured_at) AS bucket,
    AVG(value_numeric)   AS avg_value,
    MIN(value_numeric)   AS min_value,
    MAX(value_numeric)   AS max_value,
    COUNT(*)             AS sample_count
FROM telemetry_raw
GROUP BY tenant_id, sensor_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_raw_daily',
    start_offset      => INTERVAL '90 days',
    end_offset        => INTERVAL '1 day',
    schedule_interval  => INTERVAL '6 hours',
    if_not_exists      => TRUE);
