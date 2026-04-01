-- Diccionario de datos y operadores matemáticos para paneles de fórmulas.
-- Idempotente para entornos existentes.

BEGIN;

CREATE TABLE IF NOT EXISTS formula_data_dictionary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    data_type TEXT NOT NULL DEFAULT 'numeric',
    unit TEXT,
    description TEXT NOT NULL,
    example_value TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formula_math_operators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'arithmetico',
    precedence INTEGER NOT NULL DEFAULT 0,
    arity SMALLINT NOT NULL DEFAULT 2,
    example_expression TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO formula_data_dictionary (code, display_name, category, data_type, unit, description, example_value, sort_order)
VALUES
    ('rqd', 'RQD', 'geomecanica', 'numeric', '%', 'Rock Quality Designation del tramo evaluado.', '82.4', 10),
    ('ucs_mpa', 'Resistencia UCS', 'geomecanica', 'numeric', 'MPa', 'Resistencia a compresión uniaxial de muestra.', '125', 20),
    ('dip_deg', 'Buzamiento', 'estructural', 'numeric', 'deg', 'Ángulo de buzamiento de discontinuidad.', '45.2', 30),
    ('azimuth_deg', 'Azimut', 'estructural', 'numeric', 'deg', 'Azimut de la estructura principal.', '132.7', 40),
    ('humidity_pct', 'Humedad Relativa', 'ambiente', 'numeric', '%', 'Humedad ambiente del frente monitoreado.', '68.0', 50),
    ('temp_c', 'Temperatura', 'ambiente', 'numeric', 'C', 'Temperatura ambiente medida por sensor.', '17.5', 60),
    ('disp_mm', 'Desplazamiento', 'deformacion', 'numeric', 'mm', 'Desplazamiento acumulado del punto control.', '3.1', 70),
    ('vib_rms', 'Vibración RMS', 'instrumentacion', 'numeric', 'mm/s', 'Nivel RMS de vibración registrado.', '1.8', 80)
ON CONFLICT (code) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    category = EXCLUDED.category,
    data_type = EXCLUDED.data_type,
    unit = EXCLUDED.unit,
    description = EXCLUDED.description,
    example_value = EXCLUDED.example_value,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO formula_math_operators (symbol, name, description, category, precedence, arity, example_expression, sort_order)
VALUES
    ('+', 'Suma', 'Suma dos valores numéricos.', 'aritmetico', 10, 2, 'rqd + disp_mm', 10),
    ('-', 'Resta', 'Resta el segundo operando al primero.', 'aritmetico', 10, 2, 'ucs_mpa - 15', 20),
    ('*', 'Multiplicación', 'Multiplica dos valores.', 'aritmetico', 20, 2, 'temp_c * 1.8', 30),
    ('/', 'División', 'Divide el primer valor entre el segundo.', 'aritmetico', 20, 2, 'disp_mm / 7', 40),
    ('^', 'Potencia', 'Eleva base a exponente.', 'aritmetico', 30, 2, 'vib_rms ^ 2', 50),
    ('%', 'Módulo', 'Resto de división entera.', 'aritmetico', 20, 2, 'azimuth_deg % 90', 60),
    ('(', 'Paréntesis apertura', 'Agrupa y prioriza subexpresiones.', 'agrupacion', 100, 0, '(rqd + ucs_mpa) / 2', 70),
    (')', 'Paréntesis cierre', 'Cierre de agrupación.', 'agrupacion', 100, 0, '(rqd + ucs_mpa) / 2', 80)
ON CONFLICT (symbol) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    precedence = EXCLUDED.precedence,
    arity = EXCLUDED.arity,
    example_expression = EXCLUDED.example_expression,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE,
    updated_at = NOW();

COMMIT;
