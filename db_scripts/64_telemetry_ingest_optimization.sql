-- ==========================================================================
-- 29_telemetry_ingest_optimization.sql
-- Optimización de telemetry_raw para ingesta de alta tasa (10K+ sensores).
--   1. chunk_time_interval 7d -> 6h  (chunks manejables a ~1000 filas/s)
--   2. Recorte de índices redundantes en el hot path de escritura
--   3. Compresión columnar (segmentby sensor_id) + política a 1 día
-- Idempotente: seguro de re-ejecutar.
-- ==========================================================================

-- 1) Chunk interval -> 6 horas (aplica a chunks NUEVOS)
SELECT set_chunk_time_interval('telemetry_raw', INTERVAL '6 hours');

-- 2) Índices: conservar el de consulta principal (sensor_id, captured_at DESC)
--    y el pkey. Quitar los redundantes que penalizan cada INSERT.
--    - telemetry_raw_captured_at_idx: cubierto por queries con sensor/tenant.
--    - idx_telemetry_tenant_time: el filtrado por tenant casi siempre va con
--      sensor; el índice sensor_id+time + scan de chunk basta.
DROP INDEX IF EXISTS telemetry_raw_captured_at_idx;
DROP INDEX IF EXISTS idx_telemetry_tenant_time;

-- 3) Compresión columnar. segmentby sensor_id agrupa series por sensor;
--    orderby captured_at para runs comprimibles.
ALTER TABLE telemetry_raw SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'sensor_id',
  timescaledb.compress_orderby = 'captured_at DESC'
);

-- Política: comprimir chunks con > 1 día de antigüedad (no toca el chunk
-- caliente de ingesta). add_compression_policy es idempotente con if_not_exists.
SELECT add_compression_policy('telemetry_raw', INTERVAL '1 day', if_not_exists => true);

-- (Opcional, comentado) Retención: descartar datos > 1 año.
-- SELECT add_retention_policy('telemetry_raw', INTERVAL '365 days', if_not_exists => true);
