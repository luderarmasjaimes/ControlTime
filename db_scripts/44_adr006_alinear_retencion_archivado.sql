-- ============================================================================
-- 44_adr006_alinear_retencion_archivado.sql
-- Corrige un riesgo real de pérdida de datos encontrado en auditoría
-- (2026-07-13, ver nota en docs/decisions/006-timescaledb-hypertables-retencion.md
-- y docs/decisions/009-almacenamiento-objetos-minio-parquet.md):
--
--   - Política nativa de retención de `telemetry_raw` (ADR-006): drop_after = 90 días.
--   - Umbral del job de archivado a Parquet/MinIO (ADR-009):
--     BEEMETRY_ARCHIVE_RETENTION_DAYS, default 180 días — solo archiva filas
--     MÁS VIEJAS que ese umbral.
--
-- Los dos valores se configuraron en sesiones distintas sin conciliarlos: toda
-- fila de `telemetry_raw` entre 90 y 180 días de antigüedad se borraba de forma
-- nativa ANTES de que el job de archivado tuviera oportunidad de moverla a
-- Parquet — pérdida de dato real y silenciosa. No se había materializado
-- todavía porque la telemetría real en producción tiene semanas, no meses, de
-- antigüedad al momento de esta auditoría.
--
-- Corrección: subir drop_after a 190 días — por encima del umbral de archivado
-- (180 días), dejando un margen de 10 días para que el job de archivado
-- (disparado manualmente vía POST /api/platform/archive/run, sin cron todavía
-- per ADR-009) tenga oportunidad real de correr antes de que la retención
-- nativa borre esas filas.
--
-- Idempotente: remove_retention_policy con if_exists; vuelve a agregar con el
-- valor correcto. Verificado en vivo contra beemetry-db antes de escribir este
-- script (ver docs/decisions/006-...md) — este archivo documenta y reproduce
-- ese mismo cambio para que un despliegue nuevo desde cero lo aplique igual.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM timescaledb_information.jobs
        WHERE hypertable_name = 'telemetry_raw'
          AND proc_name = 'policy_retention'
          AND config->>'drop_after' = '190 days'
    ) THEN
        RAISE NOTICE 'telemetry_raw ya tiene drop_after=190 days — nada que hacer.';
        RETURN;
    END IF;

    PERFORM remove_retention_policy('telemetry_raw', if_exists => true);
    PERFORM add_retention_policy('telemetry_raw', INTERVAL '190 days');

    RAISE NOTICE 'telemetry_raw: retención nativa realineada a 190 días (por encima de los 180 días de BEEMETRY_ARCHIVE_RETENTION_DAYS).';
END $$;
