-- =============================================================================
-- 17_telemetry_multivariate_sensor_specs.sql
-- Prerrequisito: 16_platform_multitenant_latam_i18n_rbac_audit.sql (columnas en tenants)
-- Sensores con N parámetros de entrada y M canales de salida por lectura
-- (modelo de datos para motor C++/fórmulas sin bloquear telemetry_raw).
-- Puente mineria_sensores ↔ sensors (IoT v2).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Definición de parámetros que el algoritmo de un sensor necesita (1..N)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_input_parameter_def (
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    param_key TEXT NOT NULL,
    data_type TEXT NOT NULL DEFAULT 'numeric'
        CHECK (data_type IN ('numeric', 'text', 'boolean', 'json', 'timestamp')),
    default_value JSONB,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    description_key TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (sensor_id, param_key)
);

CREATE INDEX IF NOT EXISTS idx_sensor_input_param_sensor ON sensor_input_parameter_def (sensor_id);

-- ---------------------------------------------------------------------------
-- Canales de salida (1..M variables mineras por evento de cómputo o telemetría)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_output_channel_def (
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    channel_code TEXT NOT NULL,
    display_key TEXT,
    unit TEXT,
    aggregation_hint TEXT DEFAULT 'last'
        CHECK (aggregation_hint IN ('last', 'min', 'max', 'avg', 'sum')),
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (sensor_id, channel_code)
);

-- ---------------------------------------------------------------------------
-- Valores multivariante por instante (alta frecuencia; particionar vía Timescale)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry_multivariate (
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    captured_at TIMESTAMPTZ NOT NULL,
    channel_code TEXT NOT NULL,
    value_numeric DOUBLE PRECISION,
    value_text TEXT,
    quality_code SMALLINT NOT NULL DEFAULT 0,
    source_batch_id UUID,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (tenant_id, sensor_id, captured_at, channel_code)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_multi_sensor_time
    ON telemetry_multivariate (sensor_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_multi_tenant_time
    ON telemetry_multivariate (tenant_id, captured_at DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable(
            'telemetry_multivariate',
            'captured_at',
            if_not_exists => TRUE
        );
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Enlace explícito entre modelo analítico minería y sensor IoT v2
-- ---------------------------------------------------------------------------
ALTER TABLE mineria_sensores ADD COLUMN IF NOT EXISTS iot_sensor_id UUID
    REFERENCES sensors(sensor_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mineria_sensores_iot ON mineria_sensores (iot_sensor_id);

COMMENT ON COLUMN mineria_sensores.iot_sensor_id IS
    'UUID en sensors (telemetría v2). Rellena migración / ETL para convergencia de modelos.';

-- ---------------------------------------------------------------------------
-- Vista de apoyo: catálogo sensor con país del tenant (lecturas en API)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sensor_tenant_geo AS
SELECT
    s.sensor_id,
    s.tenant_id,
    s.sensor_code,
    s.sensor_name,
    t.tenant_name,
    t.default_locale,
    t.primary_country_iso2,
    si.site_id,
    si.site_code,
    si.site_name
FROM sensors s
JOIN tenants t ON t.tenant_id = s.tenant_id
LEFT JOIN sites si ON si.site_id = s.site_id;

COMMIT;
