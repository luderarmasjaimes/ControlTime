-- Demo telemetría (patrón ThingsBoard: series temporales + dispositivos) y CCTV
-- Ámbito de prueba: Minera ACTIVOS MINEROS · Unidad UNIDAD PRINCIPAL

CREATE TABLE IF NOT EXISTS mining_sensor_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS mining_sensor_types (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES mining_sensor_categories (id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    unit VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS mining_sensors (
    id SERIAL PRIMARY KEY,
    type_id INTEGER NOT NULL REFERENCES mining_sensor_types (id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    lat NUMERIC,
    lng NUMERIC,
    status VARCHAR(20),
    current_value NUMERIC,
    mining_company VARCHAR(200) NOT NULL DEFAULT 'ACTIVOS MINEROS',
    site_unit VARCHAR(200) NOT NULL DEFAULT 'UNIDAD PRINCIPAL'
);

ALTER TABLE mining_sensors
ADD COLUMN IF NOT EXISTS mining_company VARCHAR(200);

ALTER TABLE mining_sensors
ADD COLUMN IF NOT EXISTS site_unit VARCHAR(200);

UPDATE mining_sensors
SET
    mining_company = COALESCE(NULLIF(TRIM(mining_company), ''), 'ACTIVOS MINEROS'),
    site_unit = COALESCE(NULLIF(TRIM(site_unit), ''), 'UNIDAD PRINCIPAL')
WHERE mining_company IS NULL OR site_unit IS NULL;

ALTER TABLE mining_sensors
ALTER COLUMN mining_company SET DEFAULT 'ACTIVOS MINEROS';

ALTER TABLE mining_sensors
ALTER COLUMN site_unit SET DEFAULT 'UNIDAD PRINCIPAL';

ALTER TABLE mining_sensors
ALTER COLUMN mining_company SET NOT NULL;

ALTER TABLE mining_sensors
ALTER COLUMN site_unit SET NOT NULL;

CREATE TABLE IF NOT EXISTS mining_sensor_history (
    id SERIAL PRIMARY KEY,
    sensor_id INTEGER NOT NULL REFERENCES mining_sensors (id) ON DELETE CASCADE,
    value NUMERIC,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mining_sensor_history_sensor_ts ON mining_sensor_history (sensor_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS surveillance_cameras (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    location VARCHAR(100),
    rtmp_url VARCHAR(255),
    status VARCHAR(20),
    lat NUMERIC,
    lng NUMERIC,
    mining_company VARCHAR(200) NOT NULL DEFAULT 'ACTIVOS MINEROS',
    site_unit VARCHAR(200) NOT NULL DEFAULT 'UNIDAD PRINCIPAL'
);

ALTER TABLE surveillance_cameras
ADD COLUMN IF NOT EXISTS mining_company VARCHAR(200);

ALTER TABLE surveillance_cameras
ADD COLUMN IF NOT EXISTS site_unit VARCHAR(200);

UPDATE surveillance_cameras
SET
    mining_company = COALESCE(NULLIF(TRIM(mining_company), ''), 'ACTIVOS MINEROS'),
    site_unit = COALESCE(NULLIF(TRIM(site_unit), ''), 'UNIDAD PRINCIPAL')
WHERE mining_company IS NULL OR site_unit IS NULL;

ALTER TABLE surveillance_cameras
ALTER COLUMN mining_company SET DEFAULT 'ACTIVOS MINEROS';

ALTER TABLE surveillance_cameras
ALTER COLUMN site_unit SET DEFAULT 'UNIDAD PRINCIPAL';

ALTER TABLE surveillance_cameras
ALTER COLUMN mining_company SET NOT NULL;

ALTER TABLE surveillance_cameras
ALTER COLUMN site_unit SET NOT NULL;

TRUNCATE TABLE mining_sensor_history, mining_sensors, mining_sensor_types, mining_sensor_categories, surveillance_cameras RESTART IDENTITY CASCADE;

INSERT INTO mining_sensor_categories (name, description)
VALUES
    ('Geotecnia', 'Inclinación, presión de poros (telemetría tipo ThingsBoard)'),
    ('Ambiental', 'Polvo, ruido, vibración'),
    ('Proceso', 'Temperatura, caudal, nivel');

INSERT INTO mining_sensor_types (category_id, name, unit)
VALUES
    (1, 'Inclinación', '°'),
    (1, 'Presión poros', 'kPa'),
    (2, 'PM10', 'µg/m³'),
    (2, 'Ruido', 'dB'),
    (3, 'Temperatura', '°C'),
    (3, 'Caudal', 'L/s');

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, mining_company, site_unit)
VALUES
    (1, 'INC-TAJO-01 Este', -17.2450, -70.6100, 'online', 12.4, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'),
    (2, 'PZ-TAJO-03', -17.2462, -70.6112, 'online', 185.0, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'),
    (3, 'POLVO-STACK-A', -17.2445, -70.6095, 'online', 48.0, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'),
    (4, 'RUIDO-PERIMETRO-N', -17.2438, -70.6120, 'online', 62.0, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'),
    (5, 'TEMP-MOLINO-1', -17.2470, -70.6088, 'online', 54.2, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'),
    (6, 'CAUDAL-RETORNO', -17.2465, -70.6090, 'warning', 32.8, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL');

INSERT INTO mining_sensor_history (sensor_id, value, timestamp)
SELECT
    s.id,
    s.current_value * (1 + (random() - 0.5) * 0.12),
    NOW() - (g.h || ' hours')::interval
FROM mining_sensors s
CROSS JOIN generate_series(0, 168, 3) AS g (h)
WHERE
    s.mining_company = 'ACTIVOS MINEROS'
    AND s.site_unit = 'UNIDAD PRINCIPAL';

INSERT INTO surveillance_cameras (name, location, rtmp_url, status, lat, lng, mining_company, site_unit)
VALUES
    ('Talud NE Sector 4', 'Rampa 12', '', 'online', -17.2455, -70.6105, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'),
    ('Acceso Planta', 'Caseta norte', '', 'online', -17.2440, -70.6110, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'),
    ('Depósito Reactivos', 'Módulo B', '', 'online', -17.2472, -70.6085, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL');
