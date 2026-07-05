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
    -- Temperatura (TEMP_*)
    ('TEMP_AMBIENTE',  'Temperatura Ambiente',        'temperatura', 'numeric', 'C',    'Temperatura del aire en el ambiente de la galería.',        '18.5',  10),
    ('TEMP_FRENTE',    'Temperatura Frente de Avance','temperatura', 'numeric', 'C',    'Temperatura en el frente activo de excavación.',           '22.3',  20),
    ('TEMP_GALERIA',   'Temperatura Galería',         'temperatura', 'numeric', 'C',    'Temperatura en galería principal de transporte.',          '16.8',  30),
    ('TEMP_VENTIL',    'Temperatura Ventilación',     'temperatura', 'numeric', 'C',    'Temperatura del flujo de ventilación en la mina.',         '14.2',  40),
    ('TEMP_EQUIPO',    'Temperatura Equipo',          'temperatura', 'numeric', 'C',    'Temperatura superficial del equipo monitoreado.',          '65.0',  50),
    -- Vibración (VIB_*)
    ('VIB_RMS_X',      'Vibración RMS Eje X',         'vibracion',   'numeric', 'mm/s', 'Vibración RMS en eje horizontal X del sensor.',            '1.2',   110),
    ('VIB_RMS_Y',      'Vibración RMS Eje Y',         'vibracion',   'numeric', 'mm/s', 'Vibración RMS en eje horizontal Y del sensor.',            '0.9',   120),
    ('VIB_RMS_Z',      'Vibración RMS Eje Z',         'vibracion',   'numeric', 'mm/s', 'Vibración RMS en eje vertical Z del sensor.',              '2.1',   130),
    ('VIB_PEAK',       'Vibración Pico',              'vibracion',   'numeric', 'mm/s', 'Valor pico de vibración en cualquier eje.',                '4.7',   140),
    ('VIB_FREQ',       'Frecuencia Dominante',        'vibracion',   'numeric', 'Hz',   'Frecuencia dominante del espectro de vibración.',          '45.0',  150),
    -- Gas (GAS_*)
    ('GAS_CO',         'Monóxido de Carbono (CO)',    'gas',         'numeric', 'ppm',  'Concentración de CO; umbral NIOSH: 35 ppm.',               '12.0',  210),
    ('GAS_CH4',        'Metano (CH4)',                'gas',         'numeric', '%LEL', 'Metano como % del límite inferior de explosividad.',       '5.0',   220),
    ('GAS_O2',         'Oxígeno (O₂)',                'gas',         'numeric', '%vol', 'Concentración de O₂; normal: 20.9%.',                      '20.8',  230),
    ('GAS_H2S',        'Ácido Sulfhídrico (H₂S)',     'gas',         'numeric', 'ppm',  'H₂S; umbral NIOSH-STEL: 5 ppm.',                          '0.8',   240),
    ('GAS_NO2',        'Dióxido de Nitrógeno (NO₂)',  'gas',         'numeric', 'ppm',  'NO₂ post-voladura; umbral NIOSH-TWA: 1 ppm.',              '0.3',   250),
    -- Geomecánica
    ('rqd',            'RQD',                         'geomecanica', 'numeric', '%',    'Rock Quality Designation del tramo evaluado.',             '82.4',  310),
    ('ucs_mpa',        'Resistencia UCS',             'geomecanica', 'numeric', 'MPa',  'Resistencia a compresión uniaxial de muestra.',            '125',   320),
    ('dip_deg',        'Buzamiento',                  'estructural', 'numeric', 'deg',  'Ángulo de buzamiento de discontinuidad.',                  '45.2',  330),
    ('azimuth_deg',    'Azimut',                      'estructural', 'numeric', 'deg',  'Azimut de la estructura principal.',                       '132.7', 340),
    -- Ambiente / instrumentación
    ('humidity_pct',   'Humedad Relativa',            'ambiente',    'numeric', '%',    'Humedad ambiente del frente monitoreado.',                 '68.0',  410),
    ('disp_mm',        'Desplazamiento',              'deformacion', 'numeric', 'mm',   'Desplazamiento acumulado del punto control.',              '3.1',   420),
    ('vib_rms',        'Vibración RMS (legado)',       'vibracion',   'numeric', 'mm/s', 'Nivel RMS de vibración (código legado; use VIB_RMS_*).',   '1.8',   490),
    ('temp_c',         'Temperatura (legado)',         'temperatura', 'numeric', 'C',    'Temperatura ambiente (código legado; use TEMP_*).',        '17.5',  491)
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
