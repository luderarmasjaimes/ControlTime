-- ============================================================================
-- 36_telemetry_kpi_1m_documentacion_drift.sql
-- Captura en control de versiones un continuous aggregate que YA EXISTÍA en
-- la base de datos en vivo (`telemetry_kpi_1m`, rollup de 1 minuto sobre
-- `telemetry_raw`) pero que no tenía ningún script correspondiente en
-- db_scripts/ — drift de esquema descubierto al verificar ADR-006
-- (2026-07-07): se creó en algún momento fuera del flujo de migraciones
-- versionadas. Este script no cambia nada en la base actual (todo
-- IF NOT EXISTS / if_not_exists); su único propósito es que un despliegue
-- nuevo desde cero (docker-entrypoint-initdb.d) reproduzca el mismo objeto.
--
-- Definición verificada contra `timescaledb_information.continuous_aggregates`
-- y `timescaledb_information.jobs` en el contenedor `aurixa-db` en vivo.
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_kpi_1m
WITH (timescaledb.continuous) AS
SELECT
    tenant_id,
    time_bucket('00:01:00'::interval, captured_at) AS minuto,
    COUNT(*)                    AS lecturas,
    AVG(value_numeric)          AS promedio,
    MIN(value_numeric)          AS minimo,
    MAX(value_numeric)          AS maximo,
    STDDEV(value_numeric)       AS desviacion
FROM telemetry_raw
GROUP BY tenant_id, minuto
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_kpi_1m',
    start_offset      => INTERVAL '30 minutes',
    end_offset        => INTERVAL '1 minute',
    schedule_interval  => INTERVAL '1 minute',
    if_not_exists      => TRUE);
