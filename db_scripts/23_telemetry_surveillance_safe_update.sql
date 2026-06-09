-- Parche idempotente: telemetría mina + CCTV (sin TRUNCATE).
-- Aplicar en bases ya inicializadas: docker compose exec / scripts/apply-telemetry-db-patch.*
-- Ámbito demo: ACTIVOS MINEROS · UNIDAD PRINCIPAL

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
WHERE mining_company IS NULL OR site_unit IS NULL OR TRIM(mining_company) = '' OR TRIM(site_unit) = '';

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
    rtmp_url VARCHAR(512),
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

-- Ampliar URL de stream si la columna sigue en 255 (HLS largos)
ALTER TABLE surveillance_cameras
ALTER COLUMN rtmp_url TYPE VARCHAR(512);

UPDATE surveillance_cameras
SET
    mining_company = COALESCE(NULLIF(TRIM(mining_company), ''), 'ACTIVOS MINEROS'),
    site_unit = COALESCE(NULLIF(TRIM(site_unit), ''), 'UNIDAD PRINCIPAL')
WHERE mining_company IS NULL OR site_unit IS NULL OR TRIM(mining_company) = '' OR TRIM(site_unit) = '';

ALTER TABLE surveillance_cameras
ALTER COLUMN mining_company SET DEFAULT 'ACTIVOS MINEROS';

ALTER TABLE surveillance_cameras
ALTER COLUMN site_unit SET DEFAULT 'UNIDAD PRINCIPAL';

ALTER TABLE surveillance_cameras
ALTER COLUMN mining_company SET NOT NULL;

ALTER TABLE surveillance_cameras
ALTER COLUMN site_unit SET NOT NULL;

-- Categorías demo
INSERT INTO mining_sensor_categories (name, description)
SELECT 'Geotecnia', 'Inclinación, presión de poros (telemetría tipo ThingsBoard)'
WHERE NOT EXISTS (SELECT 1 FROM mining_sensor_categories WHERE name = 'Geotecnia');

INSERT INTO mining_sensor_categories (name, description)
SELECT 'Ambiental', 'Polvo, ruido, vibración'
WHERE NOT EXISTS (SELECT 1 FROM mining_sensor_categories WHERE name = 'Ambiental');

INSERT INTO mining_sensor_categories (name, description)
SELECT 'Proceso', 'Temperatura, caudal, nivel'
WHERE NOT EXISTS (SELECT 1 FROM mining_sensor_categories WHERE name = 'Proceso');

-- Tipos (por nombre de categoría)
INSERT INTO mining_sensor_types (category_id, name, unit)
SELECT c.id, 'Inclinación', '°'
FROM mining_sensor_categories c
WHERE c.name = 'Geotecnia'
  AND NOT EXISTS (
      SELECT 1
      FROM mining_sensor_types t
      JOIN mining_sensor_categories c2 ON t.category_id = c2.id
      WHERE c2.name = 'Geotecnia' AND t.name = 'Inclinación'
  );

INSERT INTO mining_sensor_types (category_id, name, unit)
SELECT c.id, 'Presión poros', 'kPa'
FROM mining_sensor_categories c
WHERE c.name = 'Geotecnia'
  AND NOT EXISTS (
      SELECT 1
      FROM mining_sensor_types t
      JOIN mining_sensor_categories c2 ON t.category_id = c2.id
      WHERE c2.name = 'Geotecnia' AND t.name = 'Presión poros'
  );

INSERT INTO mining_sensor_types (category_id, name, unit)
SELECT c.id, 'PM10', 'µg/m³'
FROM mining_sensor_categories c
WHERE c.name = 'Ambiental'
  AND NOT EXISTS (
      SELECT 1
      FROM mining_sensor_types t
      JOIN mining_sensor_categories c2 ON t.category_id = c2.id
      WHERE c2.name = 'Ambiental' AND t.name = 'PM10'
  );

INSERT INTO mining_sensor_types (category_id, name, unit)
SELECT c.id, 'Ruido', 'dB'
FROM mining_sensor_categories c
WHERE c.name = 'Ambiental'
  AND NOT EXISTS (
      SELECT 1
      FROM mining_sensor_types t
      JOIN mining_sensor_categories c2 ON t.category_id = c2.id
      WHERE c2.name = 'Ambiental' AND t.name = 'Ruido'
  );

INSERT INTO mining_sensor_types (category_id, name, unit)
SELECT c.id, 'Temperatura', '°C'
FROM mining_sensor_categories c
WHERE c.name = 'Proceso'
  AND NOT EXISTS (
      SELECT 1
      FROM mining_sensor_types t
      JOIN mining_sensor_categories c2 ON t.category_id = c2.id
      WHERE c2.name = 'Proceso' AND t.name = 'Temperatura'
  );

INSERT INTO mining_sensor_types (category_id, name, unit)
SELECT c.id, 'Caudal', 'L/s'
FROM mining_sensor_categories c
WHERE c.name = 'Proceso'
  AND NOT EXISTS (
      SELECT 1
      FROM mining_sensor_types t
      JOIN mining_sensor_categories c2 ON t.category_id = c2.id
      WHERE c2.name = 'Proceso' AND t.name = 'Caudal'
  );

-- Sensores demo (solo si no existen por nombre + ámbito)
INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, mining_company, site_unit)
SELECT t.id, 'INC-TAJO-01 Este', -17.2450, -70.6100, 'online', 12.4, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Geotecnia' AND t.name = 'Inclinación'
  AND NOT EXISTS (
      SELECT 1 FROM mining_sensors s
      WHERE s.name = 'INC-TAJO-01 Este' AND s.mining_company = 'ACTIVOS MINEROS' AND s.site_unit = 'UNIDAD PRINCIPAL'
  );

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, mining_company, site_unit)
SELECT t.id, 'PZ-TAJO-03', -17.2462, -70.6112, 'online', 185.0, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Geotecnia' AND t.name = 'Presión poros'
  AND NOT EXISTS (
      SELECT 1 FROM mining_sensors s
      WHERE s.name = 'PZ-TAJO-03' AND s.mining_company = 'ACTIVOS MINEROS' AND s.site_unit = 'UNIDAD PRINCIPAL'
  );

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, mining_company, site_unit)
SELECT t.id, 'POLVO-STACK-A', -17.2445, -70.6095, 'online', 48.0, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Ambiental' AND t.name = 'PM10'
  AND NOT EXISTS (
      SELECT 1 FROM mining_sensors s
      WHERE s.name = 'POLVO-STACK-A' AND s.mining_company = 'ACTIVOS MINEROS' AND s.site_unit = 'UNIDAD PRINCIPAL'
  );

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, mining_company, site_unit)
SELECT t.id, 'RUIDO-PERIMETRO-N', -17.2438, -70.6120, 'online', 62.0, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Ambiental' AND t.name = 'Ruido'
  AND NOT EXISTS (
      SELECT 1 FROM mining_sensors s
      WHERE s.name = 'RUIDO-PERIMETRO-N' AND s.mining_company = 'ACTIVOS MINEROS' AND s.site_unit = 'UNIDAD PRINCIPAL'
  );

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, mining_company, site_unit)
SELECT t.id, 'TEMP-MOLINO-1', -17.2470, -70.6088, 'online', 54.2, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Proceso' AND t.name = 'Temperatura'
  AND NOT EXISTS (
      SELECT 1 FROM mining_sensors s
      WHERE s.name = 'TEMP-MOLINO-1' AND s.mining_company = 'ACTIVOS MINEROS' AND s.site_unit = 'UNIDAD PRINCIPAL'
  );

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, mining_company, site_unit)
SELECT t.id, 'CAUDAL-RETORNO', -17.2465, -70.6090, 'warning', 32.8, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Proceso' AND t.name = 'Caudal'
  AND NOT EXISTS (
      SELECT 1 FROM mining_sensors s
      WHERE s.name = 'CAUDAL-RETORNO' AND s.mining_company = 'ACTIVOS MINEROS' AND s.site_unit = 'UNIDAD PRINCIPAL'
  );

-- Historial solo para sensores que aún no tienen ninguna muestra
INSERT INTO mining_sensor_history (sensor_id, value, timestamp)
SELECT
    s.id,
    s.current_value * (1 + (random() - 0.5) * 0.12),
    NOW() - (g.h || ' hours')::interval
FROM mining_sensors s
CROSS JOIN generate_series(0, 168, 3) AS g (h)
WHERE
    s.mining_company = 'ACTIVOS MINEROS'
    AND s.site_unit = 'UNIDAD PRINCIPAL'
    AND NOT EXISTS (SELECT 1 FROM mining_sensor_history h WHERE h.sensor_id = s.id);

-- Actualizar URLs de CCTV si las filas ya existían vacías
UPDATE surveillance_cameras
SET
    rtmp_url = 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    status = 'online',
    location = COALESCE(NULLIF(TRIM(location), ''), 'Rampa 12'),
    lat = COALESCE(lat, -17.2455),
    lng = COALESCE(lng, -70.6105)
WHERE name = 'Talud NE Sector 4'
  AND mining_company = 'ACTIVOS MINEROS'
  AND site_unit = 'UNIDAD PRINCIPAL'
  AND (rtmp_url IS NULL OR TRIM(rtmp_url) = '');

UPDATE surveillance_cameras
SET
    rtmp_url = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    status = 'online',
    location = COALESCE(NULLIF(TRIM(location), ''), 'Caseta norte'),
    lat = COALESCE(lat, -17.2440),
    lng = COALESCE(lng, -70.6110)
WHERE name = 'Acceso Planta'
  AND mining_company = 'ACTIVOS MINEROS'
  AND site_unit = 'UNIDAD PRINCIPAL'
  AND (rtmp_url IS NULL OR TRIM(rtmp_url) = '');

UPDATE surveillance_cameras
SET
    rtmp_url = 'rtmp://demo.invalido/mina/cam03',
    status = 'offline',
    location = COALESCE(NULLIF(TRIM(location), ''), 'Módulo B'),
    lat = COALESCE(lat, -17.2472),
    lng = COALESCE(lng, -70.6085)
WHERE name = 'Depósito Reactivos'
  AND mining_company = 'ACTIVOS MINEROS'
  AND site_unit = 'UNIDAD PRINCIPAL'
  AND (rtmp_url IS NULL OR TRIM(rtmp_url) = '');

-- Insertar cámaras demo si no existen
INSERT INTO surveillance_cameras (name, location, rtmp_url, status, lat, lng, mining_company, site_unit)
SELECT 'Talud NE Sector 4', 'Rampa 12', 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', 'online', -17.2455, -70.6105, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
WHERE NOT EXISTS (
    SELECT 1 FROM surveillance_cameras sc
    WHERE sc.name = 'Talud NE Sector 4' AND sc.mining_company = 'ACTIVOS MINEROS' AND sc.site_unit = 'UNIDAD PRINCIPAL'
);

INSERT INTO surveillance_cameras (name, location, rtmp_url, status, lat, lng, mining_company, site_unit)
SELECT 'Acceso Planta', 'Caseta norte', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'online', -17.2440, -70.6110, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
WHERE NOT EXISTS (
    SELECT 1 FROM surveillance_cameras sc
    WHERE sc.name = 'Acceso Planta' AND sc.mining_company = 'ACTIVOS MINEROS' AND sc.site_unit = 'UNIDAD PRINCIPAL'
);

INSERT INTO surveillance_cameras (name, location, rtmp_url, status, lat, lng, mining_company, site_unit)
SELECT 'Depósito Reactivos', 'Módulo B', 'rtmp://demo.invalido/mina/cam03', 'offline', -17.2472, -70.6085, 'ACTIVOS MINEROS', 'UNIDAD PRINCIPAL'
WHERE NOT EXISTS (
    SELECT 1 FROM surveillance_cameras sc
    WHERE sc.name = 'Depósito Reactivos' AND sc.mining_company = 'ACTIVOS MINEROS' AND sc.site_unit = 'UNIDAD PRINCIPAL'
);
