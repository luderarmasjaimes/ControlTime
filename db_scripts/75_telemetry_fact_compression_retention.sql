-- ============================================================================
-- 75_telemetry_fact_compression_retention.sql
-- ADR-131: compresion y retencion de las 3 hypertables de hechos, preservando
-- exactamente las politicas de negocio ya vigentes en telemetry_raw (compress
-- 1d->3h, retention 190d) / mineria_lecturas (compress 30d, SIN retencion) /
-- mining_sensor_history (compress 7d, SIN retencion) -- ver 64/44/32/35.
--
-- Cambio respecto al valor actual de telemetry_raw: compress_after baja de
-- 1 dia a 3 horas. A 25.000 filas/s sostenidas, 1 dia sin comprimir ocuparia
-- hasta ~130GB residentes (25000 * 86400 * 60 bytes/fila) -- muy por encima de
-- effective_cache_size=6GB (docker-compose.yml, servicio db). 3 horas (3x el
-- chunk_time_interval de 1h, margen para que el chunk cierre antes de
-- comprimir) acota el HOT residente a ~16GB.
--
-- Idempotente: ALTER TABLE SET compress es repetible; add_compression_policy/
-- add_retention_policy con if_not_exists.
-- ============================================================================

-- telemetry_fact (25k/s) -- segmentby sensor_id_sk (ya no UUID), orderby
-- incluye channel_id porque la PK ahora es (sensor_id_sk, channel_id, captured_at)
ALTER TABLE telemetry_fact SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id_sk',
    timescaledb.compress_orderby   = 'channel_id, captured_at DESC'
);
SELECT add_compression_policy('telemetry_fact', INTERVAL '3 hours', if_not_exists => true);
SELECT add_retention_policy('telemetry_fact', INTERVAL '190 days', if_not_exists => true);

ALTER TABLE telemetry_fact_detail SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id_sk',
    timescaledb.compress_orderby   = 'channel_id, captured_at DESC'
);
SELECT add_compression_policy('telemetry_fact_detail', INTERVAL '3 hours', if_not_exists => true);
SELECT add_retention_policy('telemetry_fact_detail', INTERVAL '190 days', if_not_exists => true);

-- telemetry_fact_formula (ex mineria_lecturas) -- mismo umbral 30 dias, SIN
-- retencion (decision de negocio deliberada que se preserva)
ALTER TABLE telemetry_fact_formula SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id_sk',
    timescaledb.compress_orderby   = 'channel_id, captured_at DESC'
);
SELECT add_compression_policy('telemetry_fact_formula', INTERVAL '30 days', if_not_exists => true);

-- telemetry_fact_demo (ex mining_sensor_history) -- mismo umbral 7 dias, SIN
-- retencion
ALTER TABLE telemetry_fact_demo SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id_sk',
    timescaledb.compress_orderby   = 'channel_id, captured_at DESC'
);
SELECT add_compression_policy('telemetry_fact_demo', INTERVAL '7 days', if_not_exists => true);
