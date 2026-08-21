-- ---------------------------------------------------------------------------
-- 44_report_export_narration.sql
-- Narración por diapositiva para el export PPTX -> video (ADR pendiente:
-- "Exportación a presentación PPTX + conversión a video narrado").
--
-- `report_export_job` ya existía (18_/19_...sql) con `export_format` listo
-- para 'pptx'/'mp4' pero sin ningún código que la usara. Esta migración NO
-- toca esa tabla (su forma ya alcanza para el job en sí); solo agrega el
-- detalle por-slide que un job de tipo 'mp4' necesita para mezclar audio de
-- narración con las imágenes de cada diapositiva.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS report_export_job_asset (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES report_export_job (job_id) ON DELETE CASCADE,
    page_number INT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('recorded_audio', 'tts_from_notes')),
    storage_uri TEXT,
    speaker_notes TEXT,
    duration_seconds NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_report_export_job_asset_job
    ON report_export_job_asset (job_id);
