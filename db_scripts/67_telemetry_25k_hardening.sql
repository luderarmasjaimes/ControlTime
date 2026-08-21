-- SPEC-020 / ADR-008: 25.000 lecturas/s.
-- A 25k/s, un chunk de 6 h acumularía 540 millones de filas antes de cerrar.
-- Una hora limita el working set a 90 millones y reduce el impacto de índices,
-- compresión, retención y mantenimiento. Sólo afecta chunks nuevos.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM timescaledb_information.hypertables
        WHERE hypertable_schema = 'public' AND hypertable_name = 'telemetry_raw'
    ) THEN
        PERFORM set_chunk_time_interval('public.telemetry_raw', INTERVAL '1 hour');
    END IF;
END $$;

-- Idempotencia de consumo Kafka: TimescaleDB exige incluir la dimensión de
-- tiempo en todo índice UNIQUE. Las fuentes directas conservan NULL y no se
-- ven afectadas por el índice parcial.
ALTER TABLE telemetry_raw
    ADD COLUMN IF NOT EXISTS kafka_partition integer,
    ADD COLUMN IF NOT EXISTS kafka_offset bigint;

CREATE UNIQUE INDEX IF NOT EXISTS ux_telemetry_kafka_event
    ON telemetry_raw (captured_at, kafka_partition, kafka_offset)
    WHERE kafka_partition IS NOT NULL AND kafka_offset IS NOT NULL;
