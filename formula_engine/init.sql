-- Initialize database schema for FORMULA backend
-- This script runs automatically when PostgreSQL container starts

CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    x DOUBLE PRECISION,
    y DOUBLE PRECISION,
    w DOUBLE PRECISION,
    h DOUBLE PRECISION,
    label TEXT,
    color TEXT,
    meta JSONB,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connections (
    id SERIAL PRIMARY KEY,
    from_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    to_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    meta JSONB,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rules (
    id SERIAL PRIMARY KEY,
    block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    expr TEXT,
    meta JSONB,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    channel TEXT,
    payload JSONB,
    created_at TIMESTAMP DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_blocks_label ON blocks(label);
CREATE INDEX IF NOT EXISTS idx_connections_from ON connections(from_id);
CREATE INDEX IF NOT EXISTS idx_connections_to ON connections(to_id);
CREATE INDEX IF NOT EXISTS idx_rules_block ON rules(block_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- Variables/Dictionary table for data dictionary
CREATE TABLE IF NOT EXISTS variables (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    type TEXT DEFAULT 'numeric',
    description TEXT,
    unit TEXT,
    meta JSONB,
    created_at TIMESTAMP DEFAULT now()
);

-- Operators table for mathematical/logical operators
CREATE TABLE IF NOT EXISTS operators (
    id SERIAL PRIMARY KEY,
    symbol TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    icon_emoji TEXT,
    description TEXT,
    precedence INT DEFAULT 0,
    meta JSONB,
    created_at TIMESTAMP DEFAULT now()
);

-- Truncate and reload variables (ensure fresh data)
TRUNCATE TABLE variables RESTART IDENTITY CASCADE;
INSERT INTO variables (name, type, description, unit) VALUES
('temperatura', 'numeric', 'Temperatura del sensor', '°C'),
('humedad', 'numeric', 'Humedad relativa', '%'),
('presion', 'numeric', 'Presión atmosférica', 'hPa'),
('velocidad', 'numeric', 'Velocidad del flujo', 'm/s'),
('voltaje', 'numeric', 'Voltaje medido', 'V'),
('corriente', 'numeric', 'Corriente medida', 'A'),
('potencia', 'numeric', 'Potencia consumida', 'W'),
('frecuencia', 'numeric', 'Frecuencia de la señal', 'Hz'),
('luz', 'numeric', 'Intensidad de luz', 'lux'),
('aceleracion', 'numeric', 'Aceleración', 'm/s²'),
('distancia', 'numeric', 'Distancia medida', 'm'),
('humedad_suelo', 'numeric', 'Humedad del suelo', '%'),
('ph', 'numeric', 'Valor pH', 'u'),
('conductividad', 'numeric', 'Conductividad eléctrica', 'µS/cm'),
('co2', 'numeric', 'Dióxido de carbono', 'ppm'),
('o2', 'numeric', 'Oxígeno', '%'),
('velocidad_viento', 'numeric', 'Velocidad del viento', 'km/h'),
('radiacion', 'numeric', 'Radiación solar', 'W/m²'),
('estado_sensor', 'boolean', 'Estado del sensor', 'on/off'),
('alerta_activa', 'boolean', 'Alerta activada', 'true/false');

-- Truncate and reload operators (ensure fresh data)
TRUNCATE TABLE operators RESTART IDENTITY CASCADE;
INSERT INTO operators (symbol, name, category, icon_emoji, description, precedence) VALUES
-- Arithmetic
('+', 'Suma', 'arithmetic', '➕', 'Suma dos valores', 1),
('-', 'Resta', 'arithmetic', '➖', 'Resta dos valores', 1),
('*', 'Multiplicación', 'arithmetic', '✖️', 'Multiplica dos valores', 2),
('/', 'División', 'arithmetic', '➗', 'Divide dos valores', 2),
('%', 'Módulo', 'arithmetic', '🔲', 'Resto de la división', 2),
('^', 'Potencia', 'arithmetic', '📌', 'Eleva a potencia', 3),
-- Comparison
('=', 'Igual', 'comparison', '🟰', 'Verifica igualdad', 0),
('==', 'Estrictamente igual', 'comparison', '➡️', 'Comparación estricta', 0),
('!=', 'No igual', 'comparison', '❌', 'Verifica desigualdad', 0),
('>', 'Mayor que', 'comparison', '▶️', 'Mayor que', 0),
('<', 'Menor que', 'comparison', '◀️', 'Menor que', 0),
('>=', 'Mayor o igual', 'comparison', '▶️=', 'Mayor o igual que', 0),
('<=', 'Menor o igual', 'comparison', '◀️=', 'Menor o igual que', 0),
-- Logical
('AND', 'Y lógico', 'logical', '✔️', 'Operación lógica AND', 0),
('&&', 'Y (C-style)', 'logical', '✔️✔️', 'Operación AND alternativa', 0),
('OR', 'O lógico', 'logical', '❌', 'Operación lógica OR', 0),
('||', 'O (C-style)', 'logical', '❌❌', 'Operación OR alternativa', 0),
('NOT', 'No lógico', 'logical', '🚫', 'Operación lógica NOT', 3),
('!', 'Negación', 'logical', '‼️', 'Negación de valor', 3),
-- Functions
('sqrt', 'Raíz cuadrada', 'functions', '√', 'Calcula raíz cuadrada', 4),
('abs', 'Valor absoluto', 'functions', '📊', 'Valor absoluto', 4),
('round', 'Redondeo', 'functions', '🔄', 'Redondea al entero más cercano', 4),
('floor', 'Piso', 'functions', '🔻', 'Redondea hacia abajo', 4),
('ceil', 'Techo', 'functions', '🔺', 'Redondea hacia arriba', 4),
('pow', 'Potencia (func)', 'functions', '📈', 'Calcula a^b', 4),
('log', 'Logaritmo', 'functions', '📉', 'Logaritmo natural', 4),
('exp', 'Exponencial', 'functions', 'ⓔ', 'Calcula e^x', 4),
('sin', 'Seno', 'functions', '〰️', 'Función trigonométrica sin', 4),
('cos', 'Coseno', 'functions', '〰️', 'Función trigonométrica cos', 4),
('tan', 'Tangente', 'functions', '↗️', 'Función trigonométrica tan', 4),
('max', 'Máximo', 'functions', '📈', 'Valor máximo entre dos números', 4),
('min', 'Mínimo', 'functions', '📉', 'Valor mínimo entre dos números', 4),
('avg', 'Promedio', 'functions', '📊', 'Calcula el promedio', 4),
-- Ternary/Conditional
('?', 'Operador ternar', 'conditional', '❓', 'Condición ? valor_si : valor_no', 0),
(':', 'Separador ternar', 'conditional', ':', 'Separador en operador ternario', 0);


