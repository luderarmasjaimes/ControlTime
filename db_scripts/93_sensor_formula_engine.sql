-- =============================================================================
-- 93_sensor_formula_engine.sql
-- Prerrequisito: 17_telemetry_multivariate_sensor_specs.sql (sensor_input_
-- parameter_def, sensor_output_channel_def, telemetry_multivariate -- ese
-- esquema existía sin usar, ver ADR-187).
--
-- Activa el motor de cálculo por fórmula (ADR-187, Entregable B): valores de
-- parámetro por dispositivo + definición de fórmula (expresión tinyexpr +
-- límites warning/error por canal de salida) + estado calculado en el sink
-- de resultados.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Valor real configurado por dispositivo para cada parámetro de entrada que
-- ya define sensor_input_parameter_def (que solo traía default_value, sin
-- columna de override por instancia). Sin fila acá, el evaluador usa
-- default_value; con fila, la fila gana.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_input_parameter_value (
    sensor_id UUID NOT NULL,
    param_key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    PRIMARY KEY (sensor_id, param_key),
    FOREIGN KEY (sensor_id, param_key)
        REFERENCES sensor_input_parameter_def (sensor_id, param_key)
        ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Fórmula por sensor: una expresión aritmética (evaluada con tinyexpr sobre
-- variables nombradas -- telemetría + parámetros del propio sensor),
-- resultado en UN canal de salida (sensor_output_channel_def), con límites
-- de warning/error propios de ESTA fórmula (no del canal, que sigue siendo
-- solo forma/unidad reusable -- ver ADR-187 Alternativas descartadas).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_formula_def (
    formula_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
    sensor_id UUID NOT NULL REFERENCES sensors (sensor_id) ON DELETE CASCADE,
    formula_name TEXT NOT NULL,
    expression TEXT NOT NULL,
    output_channel_code TEXT NOT NULL,
    warning_low DOUBLE PRECISION,
    warning_high DOUBLE PRECISION,
    error_low DOUBLE PRECISION,
    error_high DOUBLE PRECISION,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES auth_users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sensor_id, formula_name),
    FOREIGN KEY (sensor_id, output_channel_code)
        REFERENCES sensor_output_channel_def (sensor_id, channel_code)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sensor_formula_def_sensor
    ON sensor_formula_def (sensor_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_sensor_formula_def_tenant
    ON sensor_formula_def (tenant_id);

-- ---------------------------------------------------------------------------
-- Estado calculado (ok/warning/error) por resultado -- lo escribe el
-- evaluador de fórmulas al comparar el valor computado contra warning_*/
-- error_* de la fórmula que lo produjo. Columna nueva sobre la hypertable
-- existente (nunca escrita hasta ahora -- confirmado por grep exhaustivo,
-- ver ADR-187 Contexto).
-- ---------------------------------------------------------------------------
ALTER TABLE telemetry_multivariate
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok'
        CHECK (status IN ('ok', 'warning', 'error'));

COMMIT;
