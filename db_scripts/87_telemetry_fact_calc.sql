-- ============================================================================
-- 87_telemetry_fact_calc.sql
-- ADR-136: hypertable de métricas calculadas por lectura de sensor
-- (alert_level, rate_of_change, threshold_delta, etc.), derivadas 1:1 de una
-- fila de `telemetry_fact` (74_telemetry_fact_dimensions.sql, ADR-131).
--
-- No existía previamente ninguna tabla que persistiera métricas calculadas
-- POR LECTURA: `mining_runtime_kpis` es de grano KPI de negocio (no por
-- sensor/lectura), y `formula_engine`/`sp_proceso_temperatura` calcula
-- al vuelo sin persistir. Ver ADR-136 (docs/decisions/136-...) para el
-- contexto completo.
--
-- Interino deliberado: el cómputo lo hace un script externo (NO el backend
-- C++ -- sin scheduler/thread de cómputo agregado a main.cpp), que hace
-- INSERT directo aquí. El endpoint de lectura (GET
-- /api/mining/simulation/live-status) es puramente read-only sobre lo que
-- ese script ya escribió.
--
-- Mismas convenciones que telemetry_fact_formula (74_telemetry_fact_dimensions.sql):
-- volumen bajo/derivado, por eso SIN retention agresiva (a diferencia de
-- telemetry_fact crudo, que sí tiene retention de 190 días). Chunk interval
-- de 1h igual que telemetry_fact (no telemetry_fact_formula, que usa 7 días)
-- porque telemetry_fact_calc se deriva 1:1 de telemetry_fact -- mismo ritmo
-- de llegada esperado.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS telemetry_fact_calc (
    tenant_id_sk    SMALLINT    NOT NULL REFERENCES dim_tenant(tenant_id_sk),
    sensor_id_sk    INTEGER     NOT NULL REFERENCES dim_sensor(sensor_id_sk),
    metric_code     TEXT        NOT NULL,   -- p.ej. 'alert_level', 'rate_of_change', 'threshold_delta'
    captured_at     TIMESTAMPTZ NOT NULL,   -- timestamp de la fila telemetry_fact origen de este cálculo
    value_numeric   REAL,
    quality_code    SMALLINT    NOT NULL DEFAULT 0,
    alert_level     TEXT        NOT NULL DEFAULT 'normal' CHECK (alert_level IN ('normal', 'warning', 'critical')),
    PRIMARY KEY (sensor_id_sk, metric_code, captured_at)
);

SELECT create_hypertable('telemetry_fact_calc', 'captured_at',
    chunk_time_interval => INTERVAL '1 hour', if_not_exists => true);

-- tenant_id_sk no es parte de la PK (la identidad de fila es
-- sensor_id_sk+metric_code+captured_at, igual que telemetry_fact con
-- sensor_id_sk+channel_id+captured_at) -- este índice existe puramente para
-- los dos patrones de consulta del dashboard de simulación (ADR-136):
-- "últimas N filas de un tenant" y "conteo del tenant en la última hora".
-- Mismo patrón que telemetry_fact ya usa para consultas por tenant (ver
-- idx_dim_sensor_tenant + el join a dim_sensor en sensor_service.cpp) --
-- aquí se desnormaliza tenant_id_sk directo en la fila para no depender de
-- un JOIN a dim_sensor en el hot path de lectura del endpoint.
CREATE INDEX IF NOT EXISTS idx_telemetry_fact_calc_tenant_time
    ON telemetry_fact_calc (tenant_id_sk, captured_at DESC);

COMMENT ON TABLE telemetry_fact_calc IS
    'ADR-136: métricas calculadas por lectura de sensor (alert_level/rate_of_change/threshold_delta/...), 1 fila derivada de 1 fila de telemetry_fact. Poblada por un script externo (no el backend C++) -- interino, ver ADR-136.';
COMMENT ON COLUMN telemetry_fact_calc.metric_code IS
    'Identificador de la métrica calculada (texto libre por ahora, sin catálogo dim_ dedicado -- bajo volumen de códigos distintos no lo justifica todavía).';
COMMENT ON COLUMN telemetry_fact_calc.captured_at IS
    'Timestamp de la fila telemetry_fact origen de este cálculo (no el timestamp en que se ejecutó el cálculo).';

COMMIT;
