-- =============================================================================
-- 105_formula_template_triaxial_pga.sql
-- ADR-194 Parte A: plantilla de magnitud triaxial para acelerógrafos
-- (PGA = sqrt(x²+y²+z²), aceleración pico resultante de los 3 ejes). Aditiva
-- sobre 95_sensor_formula_template_catalog.sql (misma estructura de tablas,
-- no las toca) -- se deja como migración separada en vez de editar el
-- archivo 95 existente porque ese script ya fue verificado/aplicado
-- (SPEC-027 T1) y es una familia de instrumento nueva (acelerógrafo), no
-- una corrección a las 27 plantillas de piezómetro ya existentes.
--
-- Alcance deliberadamente acotado (ver ADR-194): esta es la "Parte A", una
-- función PURA de 3 valores crudos actuales -- cabe en el motor tinyexpr sin
-- cambios. La integración ACC→VEL→DIS ("Parte B" del ADR) queda
-- explícitamente FUERA de esta migración -- requiere procesamiento con
-- estado/corrección de línea base que el motor de fórmulas no soporta hoy,
-- y no se construye de forma especulativa sin confirmar que hay
-- acelerógrafos reales en uso (ver ADR-194, Alternativas descartadas).
--
-- ADVERTENCIA DE VERIFICACIÓN: a diferencia de las 27 plantillas de ADR-189
-- (verificadas fila por fila contra el JS legado real por SPEC-027 T13/T14),
-- esta plantilla NO tiene un sensor acelerógrafo real disponible para
-- validar (confirmado por ADR-192: 0 sensores de este tipo en sensors_db
-- hoy) ni un rule chain legado transcrito para comparar (a diferencia de
-- PiezometerRC-V2). La unidad de salida (G = gravedad estándar, convención
-- habitual de PGA en sismología) es una convención razonable, NO CONFIRMADA
-- con el developer ni con datos reales -- queda pendiente de validación
-- cuando exista un sensor acelerógrafo real que registrar (mismo criterio
-- que SPEC-027 aplica al resto del catálogo).
-- =============================================================================
BEGIN;

-- output_unit del catálogo original solo contemplaba presión (KPA/MPA/PSI,
-- dominio de piezómetros). 'G' es una familia física distinta (aceleración).
ALTER TABLE sensor_formula_template_def
    DROP CONSTRAINT IF EXISTS sensor_formula_template_def_output_unit_check;

ALTER TABLE sensor_formula_template_def
    ADD CONSTRAINT sensor_formula_template_def_output_unit_check
    CHECK (output_unit IN ('KPA', 'MPA', 'PSI', 'G'));

INSERT INTO sensor_formula_template_def
    (template_code, display_name, instrument_family, description, requires_geometry, output_unit)
VALUES
    ('triaxial_pga', 'Magnitud triaxial (PGA)', 'Acelerógrafo',
     'PGA = sqrt(accel_x²+accel_y²+accel_z²) -- aceleración pico resultante de los 3 ejes de un acelerógrafo triaxial (Kinemetrics/Guralp u otro). NO incluye integración a velocidad/desplazamiento ni corrección de línea base -- ver ADR-194 Parte B, fuera de alcance de esta plantilla.',
     FALSE, 'G')
ON CONFLICT (template_code) DO NOTHING;

INSERT INTO sensor_formula_template_input (template_code, channel_code, sort_order) VALUES
    ('triaxial_pga', 'accel_x', 0),
    ('triaxial_pga', 'accel_y', 1),
    ('triaxial_pga', 'accel_z', 2)
ON CONFLICT (template_code, channel_code) DO NOTHING;

-- Sin parámetros: es una combinación pura de los 3 canales crudos, sin
-- constantes de calibración (a diferencia de las plantillas de piezómetro).

INSERT INTO sensor_formula_template_output (template_code, output_channel_code, expression, sort_order) VALUES
    ('triaxial_pga', 'PGA', 'sqrt(pow(accel_x,2)+pow(accel_y,2)+pow(accel_z,2))', 0)
ON CONFLICT (template_code, output_channel_code) DO NOTHING;

COMMIT;
