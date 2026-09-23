-- ============================================================================
-- 107_telemetry_fact_tenant_index.sql
-- ADR-186 (bug real: chunk scan sin cota de tiempo) acotó 3 consultas con
-- WHERE captured_at para que TimescaleDB pueda excluir chunks por constraint
-- exclusion, pero ninguna de esas consultas -- ni ninguna futura que filtre
-- por tenant_id_sk -- tiene un índice que empiece por tenant_id_sk sobre
-- telemetry_fact. 74_telemetry_fact_dimensions.sql solo define
-- PRIMARY KEY (sensor_id_sk, channel_id, captured_at): ningún índice existente
-- sirve para "dame las filas del tenant X en esta ventana de tiempo" sin
-- escanear todas las filas de todos los sensor_id_sk/channel_id del chunk.
--
-- El comentario de 87_telemetry_fact_calc.sql:50-53 afirma que
-- idx_telemetry_fact_calc_tenant_time sigue "el mismo patrón que
-- telemetry_fact ya usa para consultas por tenant" -- esa afirmación es
-- falsa para la tabla RAW: telemetry_fact_calc sí tiene ese índice
-- (tenant_id_sk, captured_at DESC), telemetry_fact nunca lo tuvo. Este
-- script corrige el gap real, no solo el comentario.
--
-- Por qué CREATE INDEX simple y no CONCURRENTLY: los 3 índices que ya
-- existen sobre estas mismas hypertables (74_telemetry_fact_dimensions.sql,
-- 87_telemetry_fact_calc.sql, 17_telemetry_multivariate_sensor_specs.sql)
-- usan CREATE INDEX [UNIQUE] IF NOT EXISTS simple dentro de un bloque
-- BEGIN/COMMIT -- ninguno de ellos usa CONCURRENTLY, y CONCURRENTLY no puede
-- ejecutarse dentro de un bloque de transacción de todas formas. Se sigue el
-- mismo patrón para no introducir una convención nueva en un solo archivo.
-- Costo real de esta elección: sobre una hypertable con miles de chunks ya
-- acumulados (~10.900 según ADR-186), un CREATE INDEX no concurrente
-- construye el índice chunk por chunk y toma un lock que bloquea escrituras
-- en cada chunk mientras se construye sobre él -- en un entorno con ingesta
-- activa esto puede notarse brevemente, chunk a chunk, durante la aplicación
-- de esta migración. Se documenta el trade-off acá para quien la aplique;
-- convendría una ventana de bajo tráfico si el volumen de chunks lo amerita.
--
-- Idempotente: CREATE INDEX IF NOT EXISTS.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_telemetry_fact_tenant_time
    ON telemetry_fact (tenant_id_sk, captured_at DESC);

COMMIT;
