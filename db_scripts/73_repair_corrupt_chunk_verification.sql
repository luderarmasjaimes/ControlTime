-- ============================================================================
-- 73_repair_corrupt_chunk_verification.sql
-- Cierra el hallazgo de la auditoría 2026-08-13
-- (auditoria-base-datos-20260813-160844/auditoria-completa.log:78):
--
--   ERROR:  chunk compress_hyper_3_80_chunk has no dimension slices
--
-- Causa raíz identificada (verificado en vivo contra beemetry-db, 2026-08-23):
--   Auditar-Base-Datos-Completa.ps1:90-102 genera un SELECT 1 FROM %I.%I LIMIT 1
--   para TODAS las tablas de TODOS los esquemas no-sistema, incluyendo
--   `_timescaledb_internal` -- el esquema donde viven las tablas companion de
--   compresión (`compress_hyper_*`). Estas tablas NUNCA tienen `dimension_slice`
--   propio (son el formato columnar comprimido, no un chunk particionado real;
--   `_timescaledb_catalog.hypertable.num_dimensions=0` para las 3 hypertables
--   companion existentes: id 3/5/7). Consultarlas en medio de una ventana de
--   compresión automática (job en curso convirtiendo un chunk crudo a su
--   companion) puede producir este error de forma transitoria y autolimitada --
--   no indica corrupción persistente de datos.
--
-- Evidencia de verificación (2026-08-23, contra beemetry-db):
--   - _timescaledb_catalog.chunk id=80 -> hypertable_id=3 (_compressed_hypertable_3,
--     la companion de telemetry_raw), NO un chunk crudo.
--   - El chunk crudo real es _hyper_1_23_chunk (rango 2026-08-12 18:00-19:00 UTC),
--     384 filas, responde sin error, count() coincide con su companion comprimida.
--   - chunk_compression_stats('telemetry_raw'), chunks_detailed_size('telemetry_raw')
--     y hypertable_detailed_size('telemetry_raw') ejecutan limpio.
--   - SELECT 1 FROM _timescaledb_internal.compress_hyper_3_80_chunk LIMIT 1
--     (la query exacta del script de auditoría) responde 1 fila sin error hoy.
--
-- Conclusión: falso positivo de tooling. NO se ejecuta ninguna recompresión ni
-- recreación de chunk. Este script deja, en cambio, una rutina de verificación
-- de salud reutilizable (por muestreo real de datos, no por presencia de
-- dimension_slice en catálogo) para detectar un caso genuino en el futuro.
--
-- Idempotente: solo lectura + INSERT en tabla de log propia.
-- ============================================================================

CREATE TABLE IF NOT EXISTS chunk_health_check_log (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    hypertable_name TEXT NOT NULL,
    chunk_name    TEXT NOT NULL,
    range_start   TIMESTAMPTZ,
    range_end     TIMESTAMPTZ,
    status        TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
    error_message TEXT
);

DO $$
DECLARE
    r RECORD;
    v_error TEXT;
    v_failed_count INTEGER := 0;
    v_ok_count INTEGER := 0;
BEGIN
    FOR r IN
        SELECT hypertable_name, chunk_name, chunk_schema, range_start, range_end
        FROM timescaledb_information.chunks
        WHERE hypertable_schema = 'public'
    LOOP
        BEGIN
            EXECUTE format('SELECT 1 FROM %I.%I LIMIT 1', r.chunk_schema, r.chunk_name);
            v_ok_count := v_ok_count + 1;
            INSERT INTO chunk_health_check_log (hypertable_name, chunk_name, range_start, range_end, status)
            VALUES (r.hypertable_name, r.chunk_name, r.range_start, r.range_end, 'ok');
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
            v_failed_count := v_failed_count + 1;
            INSERT INTO chunk_health_check_log (hypertable_name, chunk_name, range_start, range_end, status, error_message)
            VALUES (r.hypertable_name, r.chunk_name, r.range_start, r.range_end, 'failed', v_error);
            RAISE WARNING 'chunk_health_check: % (%) fallo real: %', r.chunk_name, r.hypertable_name, v_error;
        END;
    END LOOP;

    RAISE NOTICE 'chunk_health_check: % chunks OK, % chunks con fallo real (ver chunk_health_check_log).', v_ok_count, v_failed_count;

    IF v_failed_count = 0 THEN
        RAISE NOTICE 'Sin chunks con fallo real -- confirma el hallazgo de auditoría 2026-08-13 como falso positivo de tooling. No se requiere reparación.';
    ELSE
        RAISE WARNING 'Hay % chunk(s) con fallo REAL de lectura -- revisar chunk_health_check_log antes de continuar con compresión/backfill. NO ejecutar decompress_chunk/compress_chunk automáticamente: revisar caso por caso.', v_failed_count;
    END IF;
END $$;
