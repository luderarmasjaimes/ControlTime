-- ============================================================================
-- 78_telemetry_fact_backfill.sql
-- ADR-131: backfill historico de telemetry_raw / mineria_lecturas /
-- mining_sensor_history hacia las 3 hypertables de hechos consolidadas.
--
-- Idempotente y reanudable (ON CONFLICT DO NOTHING sobre la PK compuesta +
-- migration_watermark por tabla origen) -- seguro de re-ejecutar completo si
-- se corta a mitad de camino, y de correr de nuevo mas tarde para recoger
-- filas nuevas que hayan llegado por la via vieja mientras el dual-write del
-- backend (Fase A/6 del plan, requiere deploy C++, fuera de alcance de esta
-- sesion) todavia no este activo.
--
-- IMPORTANTE: esto NO reemplaza el dual-write en tiempo real. Hasta que
-- telemetry_ingest.cpp escriba tambien en telemetry_fact (Fase 6, pendiente),
-- cualquier fila nueva insertada en telemetry_raw despues de correr este
-- script NO aparece en telemetry_fact hasta la proxima corrida manual de este
-- mismo script. Ver ADR-131, seccion "Migracion de datos existentes".
-- ============================================================================

CREATE TABLE IF NOT EXISTS migration_watermark (
    source_table     TEXT PRIMARY KEY,
    last_migrated_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity'::timestamptz,
    rows_migrated     BIGINT NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO migration_watermark (source_table) VALUES
    ('telemetry_raw'), ('mineria_lecturas'), ('mining_sensor_history')
ON CONFLICT (source_table) DO NOTHING;

DO $$
DECLARE
    v_wm         TIMESTAMPTZ;
    v_max        TIMESTAMPTZ;
    v_rows       BIGINT;
    v_total_rows BIGINT := 0;
BEGIN
    -- ------------------------------------------------------------------
    -- telemetry_raw -> telemetry_fact (+ telemetry_fact_detail cuando hay
    -- payload variable no vacio)
    -- ------------------------------------------------------------------
    SELECT last_migrated_at INTO v_wm FROM migration_watermark WHERE source_table = 'telemetry_raw';
    SELECT max(captured_at) INTO v_max FROM telemetry_raw;

    IF v_max IS NOT NULL THEN
        INSERT INTO telemetry_fact (tenant_id_sk, sensor_id_sk, channel_id, captured_at, value_numeric, quality_code, kafka_partition, kafka_offset)
        SELECT ds.tenant_id_sk, ds.sensor_id_sk, 0, tr.captured_at, tr.value_numeric::real, tr.quality_code, tr.kafka_partition, tr.kafka_offset
        FROM telemetry_raw tr
        JOIN dim_sensor ds ON ds.sensor_id = tr.sensor_id
        WHERE tr.captured_at > v_wm
        ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total_rows := v_total_rows + v_rows;

        INSERT INTO telemetry_fact_detail (sensor_id_sk, channel_id, captured_at, value_text, raw_payload, tags)
        SELECT ds.sensor_id_sk, 0, tr.captured_at, tr.value_text, tr.raw_payload,
               NULLIF(tr.tags, '{}'::jsonb)
        FROM telemetry_raw tr
        JOIN dim_sensor ds ON ds.sensor_id = tr.sensor_id
        WHERE tr.captured_at > v_wm
          AND (tr.value_text IS NOT NULL OR tr.raw_payload IS NOT NULL OR NULLIF(tr.tags, '{}'::jsonb) IS NOT NULL)
        ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO NOTHING;

        UPDATE migration_watermark
        SET last_migrated_at = v_max, rows_migrated = rows_migrated + v_rows, updated_at = now()
        WHERE source_table = 'telemetry_raw';

        RAISE NOTICE 'telemetry_raw -> telemetry_fact: % filas nuevas migradas (watermark -> %).', v_rows, v_max;
    END IF;

    -- ------------------------------------------------------------------
    -- mineria_lecturas -> telemetry_fact_formula
    -- Nota: mineria_lecturas no tiene columna sensor_id directa -- se
    -- identifica el sensor por (empresa_id, mina_id, variable_id), igual que
    -- sp_proceso_temperatura() en 09_formula_mining_reports.sql. Si en el
    -- futuro existiera mas de un mineria_sensores por esa combinacion, este
    -- join produciria fan-out -- no ocurre hoy (1 sensor, 1 mina, verificado).
    -- ------------------------------------------------------------------
    SELECT last_migrated_at INTO v_wm FROM migration_watermark WHERE source_table = 'mineria_lecturas';
    SELECT max(timestamp_lectura) INTO v_max FROM mineria_lecturas;

    IF v_max IS NOT NULL THEN
        INSERT INTO telemetry_fact_formula (tenant_id_sk, sensor_id_sk, channel_id, captured_at, value_numeric, quality_code)
        SELECT ds.tenant_id_sk, ds.sensor_id_sk, 0, ml.timestamp_lectura, ml.valor::real, ml.calidad
        FROM mineria_lecturas ml
        JOIN mineria_sensores ms
            ON ms.empresa_id = ml.empresa_id AND ms.mina_id = ml.mina_id AND ms.variable_id = ml.variable_id
        JOIN dim_sensor ds ON ds.legacy_mineria_sensor_id = ms.id
        WHERE ml.timestamp_lectura > v_wm
        ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total_rows := v_total_rows + v_rows;

        UPDATE migration_watermark
        SET last_migrated_at = v_max, rows_migrated = rows_migrated + v_rows, updated_at = now()
        WHERE source_table = 'mineria_lecturas';

        RAISE NOTICE 'mineria_lecturas -> telemetry_fact_formula: % filas nuevas migradas (watermark -> %).', v_rows, v_max;
    END IF;

    -- ------------------------------------------------------------------
    -- mining_sensor_history -> telemetry_fact_demo
    -- ------------------------------------------------------------------
    SELECT last_migrated_at INTO v_wm FROM migration_watermark WHERE source_table = 'mining_sensor_history';
    SELECT max("timestamp") INTO v_max FROM mining_sensor_history;

    IF v_max IS NOT NULL THEN
        INSERT INTO telemetry_fact_demo (tenant_id_sk, sensor_id_sk, channel_id, captured_at, value_numeric, quality_code)
        SELECT ds.tenant_id_sk, ds.sensor_id_sk, 0, msh."timestamp", msh.value::real, 0
        FROM mining_sensor_history msh
        JOIN dim_sensor ds ON ds.legacy_mining_sensor_id = msh.sensor_id
        WHERE msh."timestamp" > v_wm
        ON CONFLICT (sensor_id_sk, channel_id, captured_at) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total_rows := v_total_rows + v_rows;

        UPDATE migration_watermark
        SET last_migrated_at = v_max, rows_migrated = rows_migrated + v_rows, updated_at = now()
        WHERE source_table = 'mining_sensor_history';

        RAISE NOTICE 'mining_sensor_history -> telemetry_fact_demo: % filas nuevas migradas (watermark -> %).', v_rows, v_max;
    END IF;

    RAISE NOTICE 'Backfill completo: % filas nuevas en total esta corrida.', v_total_rows;
END $$;
