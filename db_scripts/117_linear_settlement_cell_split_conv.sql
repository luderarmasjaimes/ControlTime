-- ============================================================================
-- 117 — Desdoble de linear_settlement_cell (ADR-213 / G-8 / SPEC-027 hallazgo 1)
-- ============================================================================
-- No se edita db_scripts/95 (regla ADR-131/211: script ya aplicado).
--
-- Hallazgo: la plantilla unica copiaba MCA=MPA sin factor_conv_up_to_mca.
-- En el legado, eso SOLO es correcto para la familia "Linear B" (rama
-- settlement-cell sin conversion). Las familias Linear / Linear A /
-- Polynomial Slope / RST PSI / Geokon PSI aplican factor (~0.101972 KPA o
-- ~101.972 MPA) ANTES de ALT = altitud - abs(MCA). Usar la plantilla unica
-- en esas familias produce error de 10x-100x en MCA/ALT (alarmas de cota).
--
-- Decision tecnica (recomendacion G-8, Parte B ACC→VEL→DIS sigue en Etapa 2):
--   1. linear_settlement_cell     = variante SIN factor (Linear B).
--   2. linear_settlement_cell_conv = variante CON factor (resto de familias).
-- Ningun sensor existente se reasigna automaticamente.

BEGIN;

UPDATE sensor_formula_template_def
SET description = 'Variante SIN factor (equivalente Linear B / settlement-cell legado). NO usar en familias Linear/Linear A/PSI. Para esas, usar linear_settlement_cell_conv.'
WHERE template_code = 'linear_settlement_cell';

INSERT INTO sensor_formula_template_def (
    template_code, display_name, instrument_family, description, requires_geometry, output_unit
) VALUES (
    'linear_settlement_cell_conv',
    'Lineal genérico (celda de asentamiento, con conversión a MCA)',
    'Genérico',
    'MCA = MPA * factor_conv_up_to_mca; ALT = altitud - abs(MCA). Usar en familias legado Linear/Linear A/Polynomial Slope/RST PSI/Geokon PSI. Default KPA 0.101972; MPA 101.972.',
    FALSE,
    'KPA'
)
ON CONFLICT (template_code) DO NOTHING;

INSERT INTO sensor_formula_template_input (template_code, channel_code, sort_order) VALUES
('linear_settlement_cell_conv', 'Freq', 0),
('linear_settlement_cell_conv', 'Temp', 1)
ON CONFLICT DO NOTHING;

INSERT INTO sensor_formula_template_param (
    template_code, param_key, is_required, default_value, description, sort_order
) VALUES
('linear_settlement_cell_conv', 'cf', TRUE, NULL, 'Factor de calibración de frecuencia', 0),
('linear_settlement_cell_conv', 'tk', TRUE, NULL, 'Factor de calibración de temperatura', 1),
('linear_settlement_cell_conv', 'FreqIni', TRUE, NULL, 'Lectura de frecuencia inicial (cero)', 2),
('linear_settlement_cell_conv', 'TempIni', TRUE, NULL, 'Lectura de temperatura inicial (cero)', 3),
('linear_settlement_cell_conv', 'altitud', TRUE, NULL, 'Cota de instalación', 4),
('linear_settlement_cell_conv', 'factor_conv_up_to_mca', TRUE, '0.101972', 'Factor a metros de columna de agua (0.101972 KPA; 101.972 MPA)', 5)
ON CONFLICT DO NOTHING;

INSERT INTO sensor_formula_template_output (
    template_code, output_channel_code, expression, sort_order
) VALUES
('linear_settlement_cell_conv', 'MPA', '(FreqIni-Freq)*cf-(TempIni-Temp)*tk', 0),
('linear_settlement_cell_conv', 'MCA', '((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca', 1),
('linear_settlement_cell_conv', 'ALT', 'altitud-abs(((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca)', 2),
('linear_settlement_cell_conv', 'ASENT', '(FreqIni-Freq)*cf-(TempIni-Temp)*tk', 3)
ON CONFLICT DO NOTHING;
