-- =============================================================================
-- 96_sensor_input_channel_def.sql
-- Prerrequisito: 95_sensor_formula_template_catalog.sql (ADR-189).
--
-- BUG REAL encontrado 2026-09-15 probando "Aplicar plantilla" en vivo contra
-- PZ-VW-02: esta tabla se diseñó y se usó extensivamente en el backend
-- (sensor_formula_evaluator.cpp::loadNamedInputChannels,
-- sensor_formula_routes.cpp::validateExpression,
-- sensor_formula_template_routes.cpp::handleApplyFormulaTemplate,
-- device_alarm_routes.cpp::handleHttpTelemetryMulti) pero su CREATE TABLE
-- nunca se incluyó en 95_sensor_formula_template_catalog.sql -- quedó solo
-- en el diseño (plan de ADR-189) y en el código, nunca en el esquema real.
--
-- Por qué no se notó antes: el INSERT de canales dentro de
-- handleApplyFormulaTemplate() no revisaba el resultado de PQexecParams --
-- al fallar con "relation does not exist" simplemente seguía de largo (los
-- pasos siguientes, parámetros y fórmulas, no dependen de esta tabla), así
-- que "Aplicar plantilla" parecía funcionar del todo (creaba las 3 fórmulas
-- reales) mientras nunca declaraba los canales de entrada -- el síntoma
-- visible recién apareció al intentar POST /api/mining/telemetry/multi
-- ("sensor_not_multichannel", el sensor nunca quedó registrado como
-- multicanal). Ver también el fix de manejo de error correspondiente en
-- sensor_formula_template_routes.cpp.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sensor_input_channel_def (
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    channel_code TEXT NOT NULL,
    data_type TEXT NOT NULL DEFAULT 'numeric' CHECK (data_type = 'numeric'),
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (sensor_id, channel_code)
);

CREATE INDEX IF NOT EXISTS idx_sensor_input_channel_def_sensor
    ON sensor_input_channel_def (sensor_id);

COMMIT;
