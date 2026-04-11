-- ============================================================
-- FORMULA - Tabla de Sensores por Mina
-- Sensor → Mina (FK) + Variable medida (FK a mineria_variables)
-- ============================================================

CREATE TABLE IF NOT EXISTS mineria_sensores (
    id              SERIAL       PRIMARY KEY,
    empresa_id      INTEGER      NOT NULL REFERENCES mineria_empresas(id),
    mina_id         INTEGER      NOT NULL REFERENCES mineria_minas(id),
    variable_id     INTEGER      NOT NULL REFERENCES mineria_variables(id),
    codigo          VARCHAR(50)  NOT NULL,
    nombre          VARCHAR(200) NOT NULL,
    modelo          VARCHAR(100),
    fabricante      VARCHAR(100),
    ubicacion       VARCHAR(200),
    profundidad_m   DECIMAL(8,2),
    fecha_instalacion DATE,
    activo          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(mina_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_sensores_mina     ON mineria_sensores(mina_id);
CREATE INDEX IF NOT EXISTS idx_sensores_empresa  ON mineria_sensores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sensores_variable ON mineria_sensores(variable_id);

-- ── Seed: insertar sensores reales por mina ──────────────────────────────
-- Cada mina tiene 3-4 sensores de temperatura en distintas ubicaciones
INSERT INTO mineria_sensores
    (empresa_id, mina_id, variable_id, codigo, nombre, modelo, fabricante, ubicacion, profundidad_m, fecha_instalacion)
SELECT
    m.empresa_id,
    m.id          AS mina_id,
    v.id          AS variable_id,
    s.codigo,
    s.nombre,
    s.modelo,
    s.fabricante,
    s.ubicacion,
    s.prof,
    s.fecha::DATE
FROM (VALUES
    -- Activos Mineros (ACT-001)
    ('ACTIVOS_MINEROS','ACT-001','TEMP-001','SEN-ACT-001','Sensor Temp. Galeria Principal',    'TX-900', 'Aurixa',      'Galeria principal nivel 1',       -120.0, '2024-01-12'),
    ('ACTIVOS_MINEROS','ACT-001','TEMP-001','SEN-ACT-002','Sensor Temp. Ventilacion',           'TX-920', 'Aurixa',      'Tunel ventilacion',                -65.0,  '2024-01-12'),
    -- Mina Antamina Norte (ANT-001)
    ('ANTAMINA','ANT-001','TEMP-001','SEN-ANT-001','Sensor Temp. Galería Principal 1',  'PT100-4W','ABB S.A.',    'Galería Principal – Nivel 1',   -120.0, '2023-03-15'),
    ('ANTAMINA','ANT-001','TEMP-001','SEN-ANT-002','Sensor Temp. Galería Principal 2',  'PT100-4W','ABB S.A.',    'Galería Principal – Nivel 2',   -240.0, '2023-03-15'),
    ('ANTAMINA','ANT-001','TEMP-001','SEN-ANT-003','Sensor Temp. Ventilación Acceso',   'TH-500',  'Siemens',     'Chimenea Ventilación Norte',       0.0, '2022-11-01'),
    ('ANTAMINA','ANT-001','TEMP-001','SEN-ANT-004','Sensor Temp. Chancadora Primaria',  'TH-500',  'Siemens',     'Planta Chancadora – Frente Este', -15.0, '2024-01-20'),
    -- Coroccohuain (ANT-002)
    ('ANTAMINA','ANT-002','TEMP-001','SEN-ANT-005','Sensor Temp. Nivel A',              'TR-200',  'Endress+Hauser','Nivel A – Cruce Central',      -80.0, '2023-06-10'),
    ('ANTAMINA','ANT-002','TEMP-001','SEN-ANT-006','Sensor Temp. Nivel B',              'TR-200',  'Endress+Hauser','Nivel B – Frente Sur',        -160.0, '2023-06-10'),
    ('ANTAMINA','ANT-002','TEMP-001','SEN-ANT-007','Sensor Temp. Exterior Campamento',  'WS-3000', 'Davis',       'Campamento – Exterior Abierto',    0.0, '2022-08-05'),
    -- Chungar (VOL-001)
    ('VOLCAN','VOL-001','TEMP-001','SEN-VOL-001','Sensor Temp. Frente de Avance',       'PT1000',  'Honeywell',   'Frente de Avance Tajo Abierto',   -5.0, '2022-12-01'),
    ('VOLCAN','VOL-001','TEMP-001','SEN-VOL-002','Sensor Temp. Taller Mecánico',        'PT1000',  'Honeywell',   'Taller Mecánico – Interior',       0.0, '2023-02-14'),
    ('VOLCAN','VOL-001','TEMP-001','SEN-VOL-003','Sensor Temp. Túnel Principal',        'TH-500',  'Siemens',     'Túnel acceso – km 2.3',          -50.0, '2023-07-19'),
    -- Carahuacra (VOL-002)
    ('VOLCAN','VOL-002','TEMP-001','SEN-VOL-004','Sensor Temp. Zona Explosivos',        'SIL-100', 'Rosemount',   'Polvorín – Zona Seguridad',      -30.0, '2023-09-01'),
    ('VOLCAN','VOL-002','TEMP-001','SEN-VOL-005','Sensor Temp. Pique Central',          'SIL-100', 'Rosemount',   'Pique Central – Canasta 3',     -310.0, '2023-09-01'),
    ('VOLCAN','VOL-002','TEMP-001','SEN-VOL-006','Sensor Temp. Rampa Sur',              'PT1000',  'Honeywell',   'Rampa Sur – Derivación km 1.8',  -90.0, '2024-03-10'),
    -- San Rafael (MIN-001)
    ('MINSUR','MIN-001','TEMP-001','SEN-MIN-001','Sensor Temp. Fusión – Zona 1',        'TC-K-EX', 'Jumo',        'Planta Fundición – Horno 1',       0.0, '2022-05-20'),
    ('MINSUR','MIN-001','TEMP-001','SEN-MIN-002','Sensor Temp. Fusión – Zona 2',        'TC-K-EX', 'Jumo',        'Planta Fundición – Horno 2',       0.0, '2022-05-20'),
    ('MINSUR','MIN-001','TEMP-001','SEN-MIN-003','Sensor Temp. Pique Estaño',           'TR-200',  'Endress+Hauser','Pique Estaño – Nivel 4',       -420.0, '2023-01-08'),
    ('MINSUR','MIN-001','TEMP-001','SEN-MIN-004','Sensor Temp. Acceso Principal',       'WS-3000', 'Davis',       'Portal – Exterior Acceso',         0.0, '2022-05-20'),
    -- Beta TW Inambari (MIN-002)
    ('MINSUR','MIN-002','TEMP-001','SEN-MIN-005','Sensor Temp. Campamento Selva',       'WS-3000', 'Davis',       'Campamento Base – Exterior',       0.0, '2024-06-01'),
    ('MINSUR','MIN-002','TEMP-001','SEN-MIN-006','Sensor Temp. Área Exploración',       'TH-500',  'Siemens',     'Zona Exploración – Sondaje 7',   -35.0, '2024-06-15')
) AS s(emp_cod, mina_cod, var_cod, codigo, nombre, modelo, fabricante, ubicacion, prof, fecha)
JOIN mineria_empresas  e ON e.codigo = s.emp_cod
JOIN mineria_minas     m ON m.empresa_id = e.id AND m.codigo  = s.mina_cod
JOIN mineria_variables v ON v.empresa_id = e.id AND v.codigo  = s.var_cod
ON CONFLICT (mina_id, codigo) DO NOTHING;
