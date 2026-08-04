-- 29_mining_locations_official_gps.sql
-- Datos geográficos oficiales para el Capturador de Mapa Detallado Pro.
-- Sincronizado con la lógica de auto-centrado del frontend.

CREATE TABLE IF NOT EXISTS mining_site_locations (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL UNIQUE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    default_zoom INTEGER DEFAULT 14,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO mining_site_locations (company_name, latitude, longitude, default_zoom, description)
VALUES 
    ('Minera Antamina', -9.549, -77.054, 14, 'Mina Antamina - Ancash, Peru'),
    ('Compania Minera Antamina', -9.549, -77.054, 14, 'Mina Antamina - Ancash, Peru'),
    ('Sociedad Minera Cerro Verde', -16.536, -71.583, 14, 'Cerro Verde - Arequipa, Peru'),
    ('Minera Cerro Verde', -16.536, -71.583, 14, 'Cerro Verde - Arequipa, Peru'),
    ('Las Bambas', -14.156, -72.333, 14, 'Mina Las Bambas - Apurimac, Peru'),
    ('Southern Peru Copper Corporation', -17.246, -70.612, 14, 'Toquepala/Cuajone - Tacna/Moquegua, Peru'),
    ('Yanacocha', -6.983, -78.508, 14, 'Mina Yanacocha - Cajamarca, Peru'),
    ('Minera Yanacocha', -6.983, -78.508, 14, 'Mina Yanacocha - Cajamarca, Peru'),
    ('Anglo American Quellaveco', -17.112, -70.625, 14, 'Quellaveco - Moquegua, Peru'),
    ('Quellaveco', -17.112, -70.625, 14, 'Quellaveco - Moquegua, Peru'),
    ('Antapaccay', -14.896, -71.365, 14, 'Minera Antapaccay - Cusco, Peru'),
    ('Minera Antapaccay', -14.896, -71.365, 14, 'Minera Antapaccay - Cusco, Peru'),
    ('Chinalco Peru', -11.595, -76.195, 14, 'Toromocho - Junin, Peru'),
    ('Chinalco', -11.595, -76.195, 14, 'Toromocho - Junin, Peru'),
    ('Buenaventura', -12.115, -76.995, 14, 'Compania de Minas Buenaventura'),
    ('Volcan', -10.68, -76.25, 14, 'Compania Minera Volcan - Pasco, Peru'),
    ('Compania Minera Volcan', -10.68, -76.25, 14, 'Compania Minera Volcan - Pasco, Peru'),
    ('Raura', -10.45, -76.75, 14, 'Compania Minera Raura - Lima/Pasco, Peru'),
    ('Compania Minera Raura', -10.45, -76.75, 14, 'Compania Minera Raura - Lima/Pasco, Peru')
ON CONFLICT (company_name) DO UPDATE 
SET latitude = EXCLUDED.latitude, 
    longitude = EXCLUDED.longitude, 
    default_zoom = EXCLUDED.default_zoom,
    updated_at = NOW();
