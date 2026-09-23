-- =============================================================================
-- 95_sensor_formula_template_catalog.sql
-- Prerrequisito: 93_sensor_formula_engine.sql (sensor_formula_def, tinyexpr),
-- 94_sensor_type_parameter_catalog.sql (catálogo de tipos, ADR-188).
--
-- ADR-189: catálogo de plantillas de fórmula de calibración geotécnica, para
-- reproducir las 23 familias del rule chain legado ThingsBoard "PiezometerRC-V2"
-- (ver docs/INVESTIGACION_MOTOR_CALCULO_LEGADO_THINGSBOARD_PIEZOMETROS_2026-09-14.md)
-- como plantillas parametrizadas sobre el motor real (tinyexpr), no como código.
--
-- Las 2 familias confirmadas muertas en el propio comentario del JS legado
-- (polinomial_a1, polinomial_comp -- "NINGUN SENSOR POSEE ... COMO EQUATION")
-- NO se portan. Algunas familias con rama estructural por unidad (no solo un
-- factor distinto, sino una división/escala distinta dentro de la propia
-- fórmula) se seedean como 2 plantillas (_kpa/_mpa) en vez de una con lógica
-- condicional -- tinyexpr no tiene if/ternario (confirmado contra
-- third_party/tinyexpr/tinyexpr.c), así que todo condicional real del legado
-- se resuelve en tiempo de CATÁLOGO (qué plantilla elegís), no en tiempo de
-- EVALUACIÓN. El único condicional numérico que sí hace falta dentro de una
-- expresión (limitar a positivo antes de sumar a la altitud, patrón
-- "if (MCA>0) mca=MCA else 0" del legado) se resuelve algebraicamente con
-- abs(), la única función de tinyexpr que lo permite: max(x,0) = (x+abs(x))/2.
--
-- Excepciones hardcodeadas por nombre de dispositivo del legado (BM.* Boroo
-- Misquichilca, GF.PZ VW-1703, YR.PZ-05R*) NO se portan -- quedan como
-- fast-follow explícito para cuando se migre ese dispositivo real puntual (ver
-- investigación §6bis y decisión developer §8, punto 1: excepciones se
-- convierten en atributos de override por sensor cuando haga falta, nunca en
-- código; no se construye la maquinaria de override de forma especulativa sin
-- un sensor real que la necesite hoy).
--
-- Simplificación documentada: linear_d (corrección por densidad del agua)
-- reemplaza la tabla de 6 tramos por rango de temperatura del legado por un
-- único parámetro `densidad_agua` configurable (default 998.2 kg/m3, densidad
-- media razonable) -- una tabla piecewise real no es expresable en tinyexpr
-- sin condicionales, y el efecto es <1% sobre el resultado final.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sensor_formula_template_def (
    template_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    instrument_family TEXT NOT NULL,
    description TEXT,
    requires_geometry BOOLEAN NOT NULL DEFAULT FALSE,
    output_unit TEXT NOT NULL CHECK (output_unit IN ('KPA', 'MPA', 'PSI')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_formula_template_input (
    template_code TEXT NOT NULL REFERENCES sensor_formula_template_def (template_code) ON DELETE CASCADE,
    channel_code TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (template_code, channel_code)
);

CREATE TABLE IF NOT EXISTS sensor_formula_template_param (
    template_code TEXT NOT NULL REFERENCES sensor_formula_template_def (template_code) ON DELETE CASCADE,
    param_key TEXT NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    default_value JSONB,
    description TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (template_code, param_key)
);

CREATE TABLE IF NOT EXISTS sensor_formula_template_output (
    template_code TEXT NOT NULL REFERENCES sensor_formula_template_def (template_code) ON DELETE CASCADE,
    output_channel_code TEXT NOT NULL,
    expression TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (template_code, output_channel_code)
);

CREATE INDEX IF NOT EXISTS idx_sftpl_input_template ON sensor_formula_template_input (template_code);
CREATE INDEX IF NOT EXISTS idx_sftpl_param_template ON sensor_formula_template_param (template_code);
CREATE INDEX IF NOT EXISTS idx_sftpl_output_template ON sensor_formula_template_output (template_code);

-- Asignación segura bajo concurrencia de channel_id nuevos en dim_channel
-- cuando POST /api/mining/telemetry/multi ve un channel_code todavía no
-- registrado (handleHttpTelemetryMulti, device_alarm_routes.cpp). Arranca en
-- 100 -- por encima de cualquier valor ya sembrado por
-- 74_telemetry_fact_dimensions.sql (channel_id=0 fijo + reserva por
-- row_number() sobre sensor_output_channel_def, ambos con pocas decenas de
-- filas como mucho).
CREATE SEQUENCE IF NOT EXISTS dim_channel_channel_id_seq START WITH 100;

-- ---------------------------------------------------------------------------
-- Catálogo (27 plantillas: 23 familias vivas del legado, 6 desdobladas en
-- variante _kpa/_mpa por rama estructural real, 2 familias muertas excluidas)
-- ---------------------------------------------------------------------------
INSERT INTO sensor_formula_template_def (template_code, display_name, instrument_family, description, requires_geometry, output_unit) VALUES
('linear', 'Lineal genérico (piezómetro)', 'Genérico', 'P = G(R0-Ri) - K(Ti-T0), salida MCA/PSI/KPA/MPA según factor_conv_up_to_mca', FALSE, 'KPA'),
('linear_settlement_cell', 'Lineal genérico (celda de asentamiento)', 'Genérico', 'Variante sin factor de conversión de unidad, ALT decrece con MCA (asentamiento)', FALSE, 'KPA'),
('linear_gf', 'Lineal GF (geotecnia)', 'GF', 'Como Lineal genérico, agrega nivel freático NF = cota_superficie - ALT', FALSE, 'KPA'),
('linear_a', 'Lineal A: G(R0-Ri)+K(Ti-T0)', 'Genérico', 'Variante A del lineal clásico de cuerda vibrante', FALSE, 'KPA'),
('linear_b', 'Lineal B: G(Ri-R0)+K(Ti-T0)', 'Genérico', 'Variante B, admite offset de dígitos crudos (offset_bunits)', FALSE, 'KPA'),
('linear_c', 'Lineal C', 'Genérico', 'Variante C con offset propio', FALSE, 'KPA'),
('linear_c1', 'Lineal C1', 'Genérico', 'Igual a Lineal C con signo de frecuencia invertido', FALSE, 'KPA'),
('linear_d', 'Lineal D (corrección por densidad de agua)', 'Genérico', 'MCA = presión/densidad, densidad simplificada a un parámetro configurable', FALSE, 'KPA'),
('linear_e', 'Lineal E (corrección barométrica)', 'Genérico', 'Como Lineal C, agrega compensación por presión barométrica de referencia', FALSE, 'KPA'),
('linear_geokon', 'Geokon lineal estándar', 'Geokon', 'MPA=(Freq-FreqIni)*cf+(Temp-TempIni)*tk', FALSE, 'KPA'),
('linear_geokon_negated', 'Geokon lineal (signo de frecuencia invertido)', 'Geokon', 'Igual a Geokon lineal estándar con criteria=negatedCf del legado', FALSE, 'KPA'),
('linear_geokon_psi', 'Geokon lineal con salida PSI', 'Geokon', 'Calcula en unidad base y convierte a PSI vía psi_conv_factor', FALSE, 'PSI'),
('linear_psi_geokon', 'Geokon PSI a KPA/MPA', 'Geokon', 'Calcula en PSI y convierte al final a KPA o MPA vía unit_conv_factor', FALSE, 'KPA'),
('linear_rst_psi', 'RST lineal con salida PSI', 'RST', 'Igual forma que Geokon PSI, instrumento RST', FALSE, 'PSI'),
('linear_soil_instruments', 'Soil Instruments lineal (sin temperatura)', 'Soil Instruments', 'MPA = cf*(FreqIni-Freq), sin término de temperatura', FALSE, 'KPA'),
('polynomial_a', 'Polinomial A', 'Genérico', 'MPA = a*Freq²+b*Freq+c+tk*(Temp-TempIni)', FALSE, 'KPA'),
('polynomial_a2_kpa', 'Polinomial A2 (KPA, sondaje inclinado)', 'Genérico', 'Geometría de instalación inclinada, salida en KPA', TRUE, 'KPA'),
('polynomial_a2_mpa', 'Polinomial A2 (MPA, sondaje inclinado)', 'Genérico', 'Igual a Polinomial A2 KPA con término de temperatura escalado /1000', TRUE, 'MPA'),
('polynomial_casagrande', 'Polinomial Casagrande', 'Casagrande', 'Piezómetro Casagrande, geometría de sondaje inclinado, sin temperatura', TRUE, 'KPA'),
('polynomial_casagrande_rst', 'Polinomial Casagrande RST', 'Casagrande', 'Como Casagrande, agrega compensación de temperatura', TRUE, 'KPA'),
('polynomial_b_kpa', 'Polinomial B (KPA)', 'Genérico', 'MPA=a*Freq²+b*Freq+c0, salida en KPA', FALSE, 'KPA'),
('polynomial_b_mpa', 'Polinomial B (MPA)', 'Genérico', 'Igual a Polinomial B KPA con MPA escalado /1000', FALSE, 'MPA'),
('polynomial_geokon_kpa', 'Geokon polinomial con compensación barométrica (KPA)', 'Geokon', 'Compensa presión barométrica real (Press/PressIni)', FALSE, 'KPA'),
('polynomial_geokon_mpa', 'Geokon polinomial con compensación barométrica (MPA)', 'Geokon', 'Igual a la variante KPA con coeficientes de compensación en MPA', FALSE, 'MPA'),
('polynomial_rst_kpa', 'RST polinomial con compensación barométrica (KPA)', 'RST', 'Misma fórmula que Geokon polinomial KPA, instrumento RST', FALSE, 'KPA'),
('polynomial_rst_mpa', 'RST polinomial con compensación barométrica (MPA)', 'RST', 'Misma fórmula que Geokon polinomial MPA, instrumento RST', FALSE, 'MPA'),
('polynomial_slope', 'Polinomial Slope / Hz', 'Slope Indicator', 'FreqHz=sqrt(Freq*1000), polinomio sobre FreqHz', FALSE, 'KPA');

-- ---------------------------------------------------------------------------
-- Canales de entrada crudos requeridos por plantilla
-- ---------------------------------------------------------------------------
INSERT INTO sensor_formula_template_input (template_code, channel_code, sort_order) VALUES
('linear', 'Freq', 0), ('linear', 'Temp', 1),
('linear_settlement_cell', 'Freq', 0), ('linear_settlement_cell', 'Temp', 1),
('linear_gf', 'Freq', 0), ('linear_gf', 'Temp', 1),
('linear_a', 'Freq', 0), ('linear_a', 'Temp', 1),
('linear_b', 'Freq', 0), ('linear_b', 'Temp', 1),
('linear_c', 'Freq', 0), ('linear_c', 'Temp', 1),
('linear_c1', 'Freq', 0), ('linear_c1', 'Temp', 1),
('linear_d', 'Freq', 0), ('linear_d', 'Temp', 1),
('linear_e', 'Freq', 0), ('linear_e', 'Temp', 1),
('linear_geokon', 'Freq', 0), ('linear_geokon', 'Temp', 1),
('linear_geokon_negated', 'Freq', 0), ('linear_geokon_negated', 'Temp', 1),
('linear_geokon_psi', 'Freq', 0), ('linear_geokon_psi', 'Temp', 1),
('linear_psi_geokon', 'Freq', 0), ('linear_psi_geokon', 'Temp', 1),
('linear_rst_psi', 'Freq', 0), ('linear_rst_psi', 'Temp', 1),
('linear_soil_instruments', 'Freq', 0),
('polynomial_a', 'Freq', 0), ('polynomial_a', 'Temp', 1),
('polynomial_a2_kpa', 'Freq', 0), ('polynomial_a2_kpa', 'Temp', 1),
('polynomial_a2_mpa', 'Freq', 0), ('polynomial_a2_mpa', 'Temp', 1),
('polynomial_casagrande', 'Freq', 0),
('polynomial_casagrande_rst', 'Freq', 0), ('polynomial_casagrande_rst', 'Temp', 1),
('polynomial_b_kpa', 'Freq', 0),
('polynomial_b_mpa', 'Freq', 0),
('polynomial_geokon_kpa', 'Freq', 0), ('polynomial_geokon_kpa', 'Temp', 1), ('polynomial_geokon_kpa', 'Press', 2),
('polynomial_geokon_mpa', 'Freq', 0), ('polynomial_geokon_mpa', 'Temp', 1), ('polynomial_geokon_mpa', 'Press', 2),
('polynomial_rst_kpa', 'Freq', 0), ('polynomial_rst_kpa', 'Temp', 1), ('polynomial_rst_kpa', 'Press', 2),
('polynomial_rst_mpa', 'Freq', 0), ('polynomial_rst_mpa', 'Temp', 1), ('polynomial_rst_mpa', 'Press', 2),
('polynomial_slope', 'Freq', 0);

-- ---------------------------------------------------------------------------
-- Parámetros de calibración requeridos por plantilla (incluye geometría)
-- ---------------------------------------------------------------------------
INSERT INTO sensor_formula_template_param (template_code, param_key, is_required, default_value, description, sort_order) VALUES
-- linear
('linear','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear','factor_conv_up_to_mca',TRUE,'0.101972','Factor de conversión a metros de columna de agua',5),
-- linear_settlement_cell
('linear_settlement_cell','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_settlement_cell','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_settlement_cell','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_settlement_cell','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_settlement_cell','altitud',TRUE,NULL,'Cota de instalación',4),
-- linear_gf
('linear_gf','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_gf','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_gf','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_gf','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_gf','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_gf','cota_superficie',TRUE,NULL,'Cota de superficie, para calcular NF',5),
('linear_gf','factor_conv_up_to_mca',TRUE,'0.101972','Factor de conversión a metros de columna de agua',6),
-- linear_a
('linear_a','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_a','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_a','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_a','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_a','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_a','offset',TRUE,'0','Offset aditivo final',5),
('linear_a','net_factor',TRUE,'0.101972','Factor neto de conversión de unidad (KPA=0.101972; usar 1 si la lectura ya está en la unidad final)',6),
-- linear_b
('linear_b','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_b','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_b','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_b','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_b','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_b','offset',TRUE,'0','Offset aditivo final',5),
('linear_b','offset_bunits',TRUE,'0','Offset aditivo sobre la frecuencia cruda (dígitos)',6),
('linear_b','net_factor',TRUE,'0.101972','Factor neto de conversión de unidad',7),
-- linear_c
('linear_c','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_c','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_c','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_c','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_c','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_c','offset',TRUE,'0','Offset aditivo',5),
('linear_c','factor_conv_up_to_mca',TRUE,'0.101972','Factor de conversión a metros de columna de agua',6),
-- linear_c1 (mismos parámetros que linear_c)
('linear_c1','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_c1','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_c1','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_c1','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_c1','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_c1','offset',TRUE,'0','Offset aditivo',5),
('linear_c1','factor_conv_up_to_mca',TRUE,'0.101972','Factor de conversión a metros de columna de agua',6),
-- linear_d
('linear_d','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_d','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_d','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_d','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_d','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_d','p_factor',TRUE,'101971.6','Constante de presión (kg/m/s²); usar 101.9716 si la unidad base es KPA',5),
('linear_d','densidad_agua',TRUE,'998.2','Densidad del agua simplificada a un valor fijo (kg/m3); el legado usaba una tabla por rango de temperatura',6),
-- linear_e
('linear_e','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_e','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_e','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_e','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_e','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_e','offset',TRUE,'0','Offset aditivo',5),
('linear_e','factor_conv_up_to_mca',TRUE,'0.101972','Factor de conversión a metros de columna de agua',6),
('linear_e','pres_bar_ini',TRUE,NULL,'Presión barométrica de referencia inicial',7),
('linear_e','pres_bar',TRUE,NULL,'Presión barométrica de referencia actual (constante de calibración, no telemetría)',8),
-- linear_geokon
('linear_geokon','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_geokon','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_geokon','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_geokon','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_geokon','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_geokon','offset',TRUE,'0','Offset aditivo',5),
('linear_geokon','factor_conv_up_to_mca',TRUE,'0.1019744','Factor de conversión a metros de columna de agua',6),
-- linear_geokon_negated (mismos parámetros)
('linear_geokon_negated','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_geokon_negated','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_geokon_negated','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_geokon_negated','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_geokon_negated','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_geokon_negated','offset',TRUE,'0','Offset aditivo',5),
('linear_geokon_negated','factor_conv_up_to_mca',TRUE,'0.1019744','Factor de conversión a metros de columna de agua',6),
-- linear_geokon_psi
('linear_geokon_psi','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_geokon_psi','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_geokon_psi','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_geokon_psi','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_geokon_psi','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_geokon_psi','psi_conv_factor',TRUE,'0.145038','Factor de conversión de la unidad base a PSI',5),
('linear_geokon_psi','factor_conv_up_to_mca',TRUE,'0.703546662568367','Factor de conversión de PSI a metros de columna de agua',6),
-- linear_psi_geokon
('linear_psi_geokon','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_psi_geokon','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_psi_geokon','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_psi_geokon','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_psi_geokon','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_psi_geokon','unit_conv_factor',TRUE,'6.894757','Factor de conversión de PSI a la unidad final (KPA=6.894757, MPA=0.006894757)',5),
('linear_psi_geokon','factor_conv_up_to_mca',TRUE,'0.101974','Factor de conversión a metros de columna de agua',6),
-- linear_rst_psi
('linear_rst_psi','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_rst_psi','tk',TRUE,NULL,'Factor de calibración de temperatura',1),
('linear_rst_psi','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',2),
('linear_rst_psi','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',3),
('linear_rst_psi','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('linear_rst_psi','psi_conv_factor',TRUE,'0.145038','Factor de conversión de la unidad base a PSI',5),
('linear_rst_psi','factor_conv_up_to_mca',TRUE,'0.703546662568367','Factor de conversión de PSI a metros de columna de agua',6),
-- linear_soil_instruments
('linear_soil_instruments','cf',TRUE,NULL,'Factor de calibración de frecuencia',0),
('linear_soil_instruments','FreqIni',TRUE,NULL,'Lectura de frecuencia inicial (cero)',1),
('linear_soil_instruments','altitud',TRUE,NULL,'Altitud/cota de instalación',2),
('linear_soil_instruments','factor_conv_up_to_mca',TRUE,'0.101974','Factor de conversión a metros de columna de agua',3),
-- polynomial_a
('polynomial_a','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_a','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_a','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_a','tk',TRUE,NULL,'Factor de calibración de temperatura',3),
('polynomial_a','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',4),
('polynomial_a','altitud',TRUE,NULL,'Altitud/cota de instalación',5),
('polynomial_a','offset',TRUE,'0','Offset aditivo',6),
('polynomial_a','factor_conv_up_to_mca',TRUE,'0.1019744','Factor de conversión a metros de columna de agua',7),
-- polynomial_a2_kpa / _mpa (geometría)
('polynomial_a2_kpa','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_a2_kpa','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_a2_kpa','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_a2_kpa','param_D',TRUE,'0','Coeficiente de ajuste D',3),
('polynomial_a2_kpa','tk',TRUE,NULL,'Factor de calibración de temperatura',4),
('polynomial_a2_kpa','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',5),
('polynomial_a2_kpa','offset',TRUE,'0','Offset aditivo sobre MCA',6),
('polynomial_a2_kpa','incli',TRUE,NULL,'Inclinación del sondaje (grados)',7),
('polynomial_a2_kpa','stickup',TRUE,'0','Altura de protección sobre superficie',8),
('polynomial_a2_kpa','cota_superficie',TRUE,NULL,'Cota de superficie',9),
('polynomial_a2_kpa','prof_install',TRUE,NULL,'Profundidad de instalación en el sondaje',10),
('polynomial_a2_kpa','mca_factor',TRUE,'0.101972','Factor de conversión a metros de columna de agua',11),
('polynomial_a2_mpa','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_a2_mpa','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_a2_mpa','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_a2_mpa','param_D',TRUE,'0','Coeficiente de ajuste D',3),
('polynomial_a2_mpa','tk',TRUE,NULL,'Factor de calibración de temperatura',4),
('polynomial_a2_mpa','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',5),
('polynomial_a2_mpa','offset',TRUE,'0','Offset aditivo sobre MCA',6),
('polynomial_a2_mpa','incli',TRUE,NULL,'Inclinación del sondaje (grados)',7),
('polynomial_a2_mpa','stickup',TRUE,'0','Altura de protección sobre superficie',8),
('polynomial_a2_mpa','cota_superficie',TRUE,NULL,'Cota de superficie',9),
('polynomial_a2_mpa','prof_install',TRUE,NULL,'Profundidad de instalación en el sondaje',10),
('polynomial_a2_mpa','mca_factor',TRUE,'101.972','Factor de conversión a metros de columna de agua',11),
-- polynomial_casagrande
('polynomial_casagrande','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_casagrande','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_casagrande','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_casagrande','offset_pp',TRUE,'0','Offset de presión de poros',3),
('polynomial_casagrande','incli',TRUE,NULL,'Inclinación del sondaje (grados)',4),
('polynomial_casagrande','stickup',TRUE,'0','Altura de protección sobre superficie',5),
('polynomial_casagrande','cota_superficie',TRUE,NULL,'Cota de superficie',6),
('polynomial_casagrande','prof_install',TRUE,NULL,'Profundidad de instalación en el sondaje',7),
('polynomial_casagrande','mca_factor',TRUE,'0.101974','Factor de conversión a metros de columna de agua (usar 101.974 para salida MPA)',8),
-- polynomial_casagrande_rst
('polynomial_casagrande_rst','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_casagrande_rst','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_casagrande_rst','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_casagrande_rst','tk',TRUE,NULL,'Factor de calibración de temperatura',3),
('polynomial_casagrande_rst','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',4),
('polynomial_casagrande_rst','offset_pp',TRUE,'0','Offset de presión de poros',5),
('polynomial_casagrande_rst','incli',TRUE,NULL,'Inclinación del sondaje (grados)',6),
('polynomial_casagrande_rst','stickup',TRUE,'0','Altura de protección sobre superficie',7),
('polynomial_casagrande_rst','cota_superficie',TRUE,NULL,'Cota de superficie',8),
('polynomial_casagrande_rst','prof_install',TRUE,NULL,'Profundidad de instalación en el sondaje',9),
('polynomial_casagrande_rst','mca_factor',TRUE,'0.101974','Factor de conversión a metros de columna de agua (usar 101.974 para salida MPA)',10),
-- polynomial_b_kpa / _mpa
('polynomial_b_kpa','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_b_kpa','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_b_kpa','param_c0',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_b_kpa','altitud',TRUE,NULL,'Altitud/cota de instalación',3),
('polynomial_b_kpa','mca_factor',TRUE,'0.101974','Factor de conversión a metros de columna de agua',4),
('polynomial_b_mpa','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_b_mpa','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_b_mpa','param_c0',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_b_mpa','altitud',TRUE,NULL,'Altitud/cota de instalación',3),
('polynomial_b_mpa','mca_factor',TRUE,'101.974','Factor de conversión a metros de columna de agua',4),
-- polynomial_geokon_kpa / _mpa
('polynomial_geokon_kpa','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_geokon_kpa','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_geokon_kpa','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_geokon_kpa','tk',TRUE,NULL,'Factor de calibración de temperatura',3),
('polynomial_geokon_kpa','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',4),
('polynomial_geokon_kpa','offset',TRUE,'0','Offset aditivo',5),
('polynomial_geokon_kpa','altitud',TRUE,NULL,'Altitud/cota de instalación',6),
('polynomial_geokon_kpa','PressIni',TRUE,NULL,'Presión barométrica de referencia inicial (hPa)',7),
('polynomial_geokon_kpa','press_comp_factor',TRUE,'0.1','Factor de compensación barométrica (hPa a KPA)',8),
('polynomial_geokon_kpa','mca_factor',TRUE,'0.1019744','Factor de conversión a metros de columna de agua',9),
('polynomial_geokon_mpa','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_geokon_mpa','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_geokon_mpa','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_geokon_mpa','tk',TRUE,NULL,'Factor de calibración de temperatura',3),
('polynomial_geokon_mpa','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',4),
('polynomial_geokon_mpa','offset',TRUE,'0','Offset aditivo',5),
('polynomial_geokon_mpa','altitud',TRUE,NULL,'Altitud/cota de instalación',6),
('polynomial_geokon_mpa','PressIni',TRUE,NULL,'Presión barométrica de referencia inicial (hPa)',7),
('polynomial_geokon_mpa','press_comp_factor',TRUE,'0.0001','Factor de compensación barométrica (hPa a MPA)',8),
('polynomial_geokon_mpa','mca_factor',TRUE,'101.9744','Factor de conversión a metros de columna de agua',9),
-- polynomial_rst_kpa / _mpa (misma forma que geokon, marca distinta)
('polynomial_rst_kpa','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_rst_kpa','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_rst_kpa','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_rst_kpa','tk',TRUE,NULL,'Factor de calibración de temperatura',3),
('polynomial_rst_kpa','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',4),
('polynomial_rst_kpa','offset',TRUE,'0','Offset aditivo',5),
('polynomial_rst_kpa','altitud',TRUE,NULL,'Altitud/cota de instalación',6),
('polynomial_rst_kpa','PressIni',TRUE,NULL,'Presión barométrica de referencia inicial (hPa)',7),
('polynomial_rst_kpa','press_comp_factor',TRUE,'0.1','Factor de compensación barométrica (hPa a KPA)',8),
('polynomial_rst_kpa','mca_factor',TRUE,'0.1019744','Factor de conversión a metros de columna de agua',9),
('polynomial_rst_mpa','param_a',TRUE,NULL,'Coeficiente cuadrático',0),
('polynomial_rst_mpa','param_b',TRUE,NULL,'Coeficiente lineal',1),
('polynomial_rst_mpa','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_rst_mpa','tk',TRUE,NULL,'Factor de calibración de temperatura',3),
('polynomial_rst_mpa','TempIni',TRUE,NULL,'Lectura de temperatura inicial (cero)',4),
('polynomial_rst_mpa','offset',TRUE,'0','Offset aditivo',5),
('polynomial_rst_mpa','altitud',TRUE,NULL,'Altitud/cota de instalación',6),
('polynomial_rst_mpa','PressIni',TRUE,NULL,'Presión barométrica de referencia inicial (hPa)',7),
('polynomial_rst_mpa','press_comp_factor',TRUE,'0.0001','Factor de compensación barométrica (hPa a MPA)',8),
('polynomial_rst_mpa','mca_factor',TRUE,'101.9744','Factor de conversión a metros de columna de agua',9),
-- polynomial_slope
('polynomial_slope','param_a',TRUE,NULL,'Coeficiente cuadrático (sobre FreqHz)',0),
('polynomial_slope','param_b',TRUE,NULL,'Coeficiente lineal (sobre FreqHz)',1),
('polynomial_slope','param_c',TRUE,NULL,'Coeficiente independiente',2),
('polynomial_slope','offset',TRUE,'0','Offset aditivo',3),
('polynomial_slope','altitud',TRUE,NULL,'Altitud/cota de instalación',4),
('polynomial_slope','mca_factor',TRUE,'0.1019744','Factor de conversión a metros de columna de agua (usar 101.9744 para salida MPA)',5);

-- ---------------------------------------------------------------------------
-- Canales de salida (expresiones tinyexpr autocontenidas -- ver nota de
-- cabecera: sensor_formula_def no permite encadenar el resultado de una fila
-- como entrada de otra, así que cada salida reconstruye toda la cadena desde
-- las variables crudas).
-- ---------------------------------------------------------------------------
INSERT INTO sensor_formula_template_output (template_code, output_channel_code, expression, sort_order) VALUES
('linear','MPA','(FreqIni-Freq)*cf-(TempIni-Temp)*tk',0),
('linear','MCA','((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca',1),
('linear','ALT','altitud+((((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca)+abs(((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca))/2',2),

('linear_settlement_cell','MPA','(FreqIni-Freq)*cf-(TempIni-Temp)*tk',0),
('linear_settlement_cell','MCA','(FreqIni-Freq)*cf-(TempIni-Temp)*tk',1),
('linear_settlement_cell','ALT','altitud-abs((FreqIni-Freq)*cf-(TempIni-Temp)*tk)',2),
('linear_settlement_cell','ASENT','(FreqIni-Freq)*cf-(TempIni-Temp)*tk',3),

('linear_gf','MPA','(FreqIni-Freq)*cf-(TempIni-Temp)*tk',0),
('linear_gf','MCA','((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca',1),
('linear_gf','ALT','altitud+((((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca)+abs(((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca))/2',2),
('linear_gf','NF','cota_superficie-(altitud+((((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca)+abs(((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*factor_conv_up_to_mca))/2)',3),

('linear_a','MPA','(FreqIni-Freq)*cf+(Temp-TempIni)*tk',0),
('linear_a','MCA','((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*net_factor+offset',1),
('linear_a','ALT','altitud+(((((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*net_factor+offset))+abs((((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*net_factor+offset)))/2',2),

('linear_b','MPA','((Freq+offset_bunits)-FreqIni)*cf+(Temp-TempIni)*tk',0),
('linear_b','MCA','(((Freq+offset_bunits)-FreqIni)*cf+(Temp-TempIni)*tk)*net_factor+offset',1),
('linear_b','ALT','altitud+(((((Freq+offset_bunits)-FreqIni)*cf+(Temp-TempIni)*tk)*net_factor+offset)+abs(((((Freq+offset_bunits)-FreqIni)*cf+(Temp-TempIni)*tk)*net_factor+offset)))/2',2),

('linear_c','MPA','(FreqIni-Freq)*cf+(Temp-TempIni)*tk+offset',0),
('linear_c','MCA','((FreqIni-Freq)*cf+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca',1),
('linear_c','ALT','altitud+((((FreqIni-Freq)*cf+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca)+abs(((FreqIni-Freq)*cf+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca))/2',2),

('linear_c1','MPA','(Freq-FreqIni)*cf+(Temp-TempIni)*tk+offset',0),
('linear_c1','MCA','((Freq-FreqIni)*cf+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca',1),
('linear_c1','ALT','altitud+((((Freq-FreqIni)*cf+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca)+abs(((Freq-FreqIni)*cf+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca))/2',2),

('linear_d','MPA','(FreqIni-Freq)*cf+(Temp-TempIni)*tk',0),
('linear_d','MCA','(((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*p_factor)/densidad_agua',1),
('linear_d','ALT','altitud+(((((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*p_factor)/densidad_agua)+abs(((((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*p_factor)/densidad_agua)))/2',2),

('linear_e','MPA','(FreqIni-Freq)*cf+(pres_bar_ini-pres_bar)*0.0001+(Temp-TempIni)*tk+offset',0),
('linear_e','MCA','((FreqIni-Freq)*cf+(pres_bar_ini-pres_bar)*0.0001+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca',1),
('linear_e','ALT','altitud+((((FreqIni-Freq)*cf+(pres_bar_ini-pres_bar)*0.0001+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca)+abs(((FreqIni-Freq)*cf+(pres_bar_ini-pres_bar)*0.0001+(Temp-TempIni)*tk+offset)*factor_conv_up_to_mca))/2',2),

('linear_geokon','MPA','(Freq-FreqIni)*cf+(Temp-TempIni)*tk',0),
('linear_geokon','MCA','((Freq-FreqIni)*cf+(Temp-TempIni)*tk)*factor_conv_up_to_mca+offset',1),
('linear_geokon','ALT','altitud+((((Freq-FreqIni)*cf+(Temp-TempIni)*tk)*factor_conv_up_to_mca+offset)+abs(((Freq-FreqIni)*cf+(Temp-TempIni)*tk)*factor_conv_up_to_mca+offset))/2',2),

('linear_geokon_negated','MPA','(FreqIni-Freq)*cf+(Temp-TempIni)*tk',0),
('linear_geokon_negated','MCA','((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*factor_conv_up_to_mca+offset',1),
('linear_geokon_negated','ALT','altitud+((((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*factor_conv_up_to_mca+offset)+abs(((FreqIni-Freq)*cf+(Temp-TempIni)*tk)*factor_conv_up_to_mca+offset))/2',2),

('linear_geokon_psi','MPA','((Freq-FreqIni)*cf+(Temp-TempIni)*tk)*psi_conv_factor',0),
('linear_geokon_psi','MCA','(((Freq-FreqIni)*cf+(Temp-TempIni)*tk)*psi_conv_factor)*factor_conv_up_to_mca',1),
('linear_geokon_psi','ALT','altitud+(((((Freq-FreqIni)*cf+(Temp-TempIni)*tk)*psi_conv_factor)*factor_conv_up_to_mca)+abs((((Freq-FreqIni)*cf+(Temp-TempIni)*tk)*psi_conv_factor)*factor_conv_up_to_mca))/2',2),

('linear_psi_geokon','MPA','((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*unit_conv_factor',0),
('linear_psi_geokon','MCA','(((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*unit_conv_factor)*factor_conv_up_to_mca',1),
('linear_psi_geokon','ALT','altitud+(((((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*unit_conv_factor)*factor_conv_up_to_mca)+abs((((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*unit_conv_factor)*factor_conv_up_to_mca))/2',2),

('linear_rst_psi','MPA','((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*psi_conv_factor',0),
('linear_rst_psi','MCA','(((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*psi_conv_factor)*factor_conv_up_to_mca',1),
('linear_rst_psi','ALT','altitud+(((((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*psi_conv_factor)*factor_conv_up_to_mca)+abs((((FreqIni-Freq)*cf-(TempIni-Temp)*tk)*psi_conv_factor)*factor_conv_up_to_mca))/2',2),

('linear_soil_instruments','MPA','cf*(FreqIni-Freq)',0),
('linear_soil_instruments','MCA','cf*(FreqIni-Freq)*factor_conv_up_to_mca',1),
('linear_soil_instruments','ALT','altitud+((cf*(FreqIni-Freq)*factor_conv_up_to_mca)+abs(cf*(FreqIni-Freq)*factor_conv_up_to_mca))/2',2),

('polynomial_a','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)',0),
('polynomial_a','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni))*factor_conv_up_to_mca+offset',1),
('polynomial_a','ALT','altitud+(((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni))*factor_conv_up_to_mca+offset)+abs((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni))*factor_conv_up_to_mca+offset))/2',2),

('polynomial_a2_kpa','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+param_D-tk*(TempIni-Temp)',0),
('polynomial_a2_kpa','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+param_D-tk*(TempIni-Temp))*mca_factor+offset',1),
('polynomial_a2_kpa','NF','prof_install-((param_a*pow(Freq,2)+param_b*Freq+param_c+param_D-tk*(TempIni-Temp))*mca_factor+offset)',2),
('polynomial_a2_kpa','ALT','cota_superficie-(((prof_install-((param_a*pow(Freq,2)+param_b*Freq+param_c+param_D-tk*(TempIni-Temp))*mca_factor+offset))-stickup)*sin(incli*pi()/180))',3),

('polynomial_a2_mpa','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+param_D-(tk*(TempIni-Temp))/1000',0),
('polynomial_a2_mpa','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+param_D-(tk*(TempIni-Temp))/1000)*mca_factor+offset',1),
('polynomial_a2_mpa','NF','prof_install-((param_a*pow(Freq,2)+param_b*Freq+param_c+param_D-(tk*(TempIni-Temp))/1000)*mca_factor+offset)',2),
('polynomial_a2_mpa','ALT','cota_superficie-(((prof_install-((param_a*pow(Freq,2)+param_b*Freq+param_c+param_D-(tk*(TempIni-Temp))/1000)*mca_factor+offset))-stickup)*sin(incli*pi()/180))',3),

('polynomial_casagrande','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+offset_pp',0),
('polynomial_casagrande','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+offset_pp)*mca_factor',1),
('polynomial_casagrande','NF','prof_install-(((param_a*pow(Freq,2)+param_b*Freq+param_c+offset_pp)*mca_factor)/sin(incli*pi()/180))',2),
('polynomial_casagrande','ALT','cota_superficie-(((prof_install-(((param_a*pow(Freq,2)+param_b*Freq+param_c+offset_pp)*mca_factor)/sin(incli*pi()/180)))-stickup)*sin(incli*pi()/180))',3),

('polynomial_casagrande_rst','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset_pp',0),
('polynomial_casagrande_rst','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset_pp)*mca_factor',1),
('polynomial_casagrande_rst','NF','prof_install-(((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset_pp)*mca_factor)/sin(incli*pi()/180))',2),
('polynomial_casagrande_rst','ALT','cota_superficie-(((prof_install-(((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset_pp)*mca_factor)/sin(incli*pi()/180)))-stickup)*sin(incli*pi()/180))',3),

('polynomial_b_kpa','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c0',0),
('polynomial_b_kpa','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c0)*mca_factor',1),
('polynomial_b_kpa','ALT','altitud+(((param_a*pow(Freq,2)+param_b*Freq+param_c0)*mca_factor)+abs((param_a*pow(Freq,2)+param_b*Freq+param_c0)*mca_factor))/2',2),

('polynomial_b_mpa','MPA','(param_a*pow(Freq,2)+param_b*Freq+param_c0)/1000',0),
('polynomial_b_mpa','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c0)*mca_factor',1),
('polynomial_b_mpa','ALT','altitud+(((param_a*pow(Freq,2)+param_b*Freq+param_c0)*mca_factor)+abs((param_a*pow(Freq,2)+param_b*Freq+param_c0)*mca_factor))/2',2),

('polynomial_geokon_kpa','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni)',0),
('polynomial_geokon_kpa','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor',1),
('polynomial_geokon_kpa','ALT','altitud+(((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor)+abs((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor))/2',2),

('polynomial_geokon_mpa','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni)',0),
('polynomial_geokon_mpa','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor',1),
('polynomial_geokon_mpa','ALT','altitud+(((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor)+abs((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor))/2',2),

('polynomial_rst_kpa','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni)',0),
('polynomial_rst_kpa','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor',1),
('polynomial_rst_kpa','ALT','altitud+(((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor)+abs((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor))/2',2),

('polynomial_rst_mpa','MPA','param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni)',0),
('polynomial_rst_mpa','MCA','(param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor',1),
('polynomial_rst_mpa','ALT','altitud+(((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor)+abs((param_a*pow(Freq,2)+param_b*Freq+param_c+tk*(Temp-TempIni)+offset-press_comp_factor*(Press-PressIni))*mca_factor))/2',2),

('polynomial_slope','MPA','param_a*pow(sqrt(Freq*1000),2)+param_b*sqrt(Freq*1000)+param_c',0),
('polynomial_slope','MCA','(param_a*pow(sqrt(Freq*1000),2)+param_b*sqrt(Freq*1000)+param_c)*mca_factor+offset',1),
('polynomial_slope','ALT','altitud+(((param_a*pow(sqrt(Freq*1000),2)+param_b*sqrt(Freq*1000)+param_c)*mca_factor+offset)+abs((param_a*pow(sqrt(Freq*1000),2)+param_b*sqrt(Freq*1000)+param_c)*mca_factor+offset))/2',2);

-- ---------------------------------------------------------------------------
-- Extensión de alarmas (ADR-189 §5): permitir que una regla de
-- platform_alarm_rules evalúe un canal de SALIDA de fórmula
-- (telemetry_multivariate) en vez de solo telemetry_fact.channel_id=0.
-- Refinamiento opcional dentro del caso sensor_id IS NOT NULL -- no cambia el
-- CHECK existente de "exactamente un target" (sensor_id XOR mining_sensor_id).
-- ---------------------------------------------------------------------------
ALTER TABLE platform_alarm_rules
    ADD COLUMN IF NOT EXISTS formula_output_channel_code TEXT;

COMMENT ON COLUMN platform_alarm_rules.formula_output_channel_code IS
    'Si no es NULL, evaluateRulesOnce() lee telemetry_multivariate(sensor_id, channel_code) '
    'en vez de telemetry_fact.channel_id=0 -- permite alarmar sobre un valor calculado '
    '(p.ej. ALT/MCA de una fórmula aplicada) en vez de la telemetría cruda.';

COMMIT;
