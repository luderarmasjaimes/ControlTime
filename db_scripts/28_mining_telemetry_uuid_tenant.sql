-- Telemetría minera (sensores, zonas, CCTV): modelo único tenant_id → tenants(tenant_id).
-- Reemplaza mining_company + site_unit. Aplicar tras 22/23 (y opcionalmente 27).
-- UUID fijo de demo (coincide con fallback del backend / frontend).

DO $$
DECLARE
    v_tid UUID := 'a0000001-0000-4000-8000-000000000001'::uuid;
BEGIN
    INSERT INTO tenants (tenant_id, tenant_name, legal_name, timezone)
    SELECT v_tid, 'Telemetría Minera Plataforma', 'Tenant unificado telemetría / informes', 'America/Lima'
    WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.tenant_id = v_tid);

    UPDATE tenants
    SET
        tenant_name = 'Telemetría Minera Plataforma',
        legal_name = COALESCE(NULLIF(TRIM(legal_name), ''), 'Tenant unificado telemetría / informes')
    WHERE tenant_id = v_tid;

    IF to_regclass('public.mineria_empresas') IS NOT NULL THEN
        UPDATE mineria_empresas
        SET tenant_id = v_tid
        WHERE tenant_id IS NULL;
    END IF;
END
$$;

ALTER TABLE mining_sensors DROP CONSTRAINT IF EXISTS mining_sensors_zone_id_fkey;

DROP TABLE IF EXISTS mining_sensor_zones CASCADE;

CREATE TABLE mining_sensor_zones (
    id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL,
    name_es VARCHAR(80) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_mining_sensor_zones_tenant ON mining_sensor_zones (tenant_id);

INSERT INTO mining_sensor_zones (tenant_id, code, name_es, sort_order)
VALUES
    ('a0000001-0000-4000-8000-000000000001'::uuid, 'NORTE', 'Zona Norte', 10),
    ('a0000001-0000-4000-8000-000000000001'::uuid, 'SUR', 'Zona Sur', 20),
    ('a0000001-0000-4000-8000-000000000001'::uuid, 'ESTE', 'Zona Este', 30),
    ('a0000001-0000-4000-8000-000000000001'::uuid, 'OESTE', 'Zona Oeste', 40),
    ('a0000001-0000-4000-8000-000000000001'::uuid, 'CENTRAL', 'Zona Central', 50),
    ('a0000001-0000-4000-8000-000000000001'::uuid, 'SUBTERRANEO', 'Subterráneo', 60)
ON CONFLICT (tenant_id, code) DO NOTHING;

TRUNCATE TABLE mining_sensor_history;

TRUNCATE TABLE mining_sensors RESTART IDENTITY CASCADE;

ALTER TABLE mining_sensors
DROP COLUMN IF EXISTS mining_company;

ALTER TABLE mining_sensors
DROP COLUMN IF EXISTS site_unit;

ALTER TABLE mining_sensors
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (tenant_id);

UPDATE mining_sensors
SET
    tenant_id = 'a0000001-0000-4000-8000-000000000001'::uuid
WHERE
    tenant_id IS NULL;

ALTER TABLE mining_sensors
ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE mining_sensors
        ADD CONSTRAINT mining_sensors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id);

EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END
$$;

ALTER TABLE mining_sensors
ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES mining_sensor_zones (id);

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, tenant_id)
SELECT t.id, 'INC-TAJO-01 Este', -17.2450, -70.6100, 'online', 12.4, 'a0000001-0000-4000-8000-000000000001'::uuid
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Geotecnia' AND t.name = 'Inclinación';

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, tenant_id)
SELECT t.id, 'PZ-TAJO-03', -17.2462, -70.6112, 'online', 185.0, 'a0000001-0000-4000-8000-000000000001'::uuid
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Geotecnia' AND t.name = 'Presión poros';

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, tenant_id)
SELECT t.id, 'POLVO-STACK-A', -17.2445, -70.6095, 'online', 48.0, 'a0000001-0000-4000-8000-000000000001'::uuid
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Ambiental' AND t.name = 'PM10';

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, tenant_id)
SELECT t.id, 'RUIDO-PERIMETRO-N', -17.2438, -70.6120, 'online', 62.0, 'a0000001-0000-4000-8000-000000000001'::uuid
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Ambiental' AND t.name = 'Ruido';

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, tenant_id)
SELECT t.id, 'TEMP-MOLINO-1', -17.2470, -70.6088, 'online', 54.2, 'a0000001-0000-4000-8000-000000000001'::uuid
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Proceso' AND t.name = 'Temperatura';

INSERT INTO mining_sensors (type_id, name, lat, lng, status, current_value, tenant_id)
SELECT t.id, 'CAUDAL-RETORNO', -17.2465, -70.6090, 'warning', 32.8, 'a0000001-0000-4000-8000-000000000001'::uuid
FROM mining_sensor_types t
JOIN mining_sensor_categories c ON t.category_id = c.id
WHERE c.name = 'Proceso' AND t.name = 'Caudal';

UPDATE mining_sensors s
SET
    zone_id = z.id
FROM
    mining_sensor_zones z
WHERE
    z.tenant_id = s.tenant_id
    AND z.code = CASE MOD(s.id, 6)
        WHEN 0 THEN 'NORTE'
        WHEN 1 THEN 'SUR'
        WHEN 2 THEN 'ESTE'
        WHEN 3 THEN 'OESTE'
        WHEN 4 THEN 'CENTRAL'
        ELSE 'SUBTERRANEO'
    END;

INSERT INTO mining_sensor_history (sensor_id, value, timestamp)
SELECT
    s.id,
    s.current_value * (1 + (random() - 0.5) * 0.12),
    NOW() - (g.h || ' hours')::interval
FROM
    mining_sensors s
    CROSS JOIN generate_series(0, 168, 3) AS g (h)
WHERE
    s.tenant_id = 'a0000001-0000-4000-8000-000000000001'::uuid;

DELETE FROM surveillance_cameras;

ALTER TABLE surveillance_cameras
DROP COLUMN IF EXISTS mining_company;

ALTER TABLE surveillance_cameras
DROP COLUMN IF EXISTS site_unit;

ALTER TABLE surveillance_cameras
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (tenant_id);

UPDATE surveillance_cameras
SET
    tenant_id = 'a0000001-0000-4000-8000-000000000001'::uuid
WHERE
    tenant_id IS NULL;

ALTER TABLE surveillance_cameras
ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE surveillance_cameras
        ADD CONSTRAINT surveillance_cameras_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id);

EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END
$$;

INSERT INTO surveillance_cameras (name, location, rtmp_url, status, lat, lng, tenant_id)
VALUES
    (
        'Talud NE Sector 4',
        'Rampa 12',
        'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        'online',
        -17.2455,
        -70.6105,
        'a0000001-0000-4000-8000-000000000001'::uuid
    ),
    (
        'Acceso Planta',
        'Caseta norte',
        'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        'online',
        -17.2440,
        -70.6110,
        'a0000001-0000-4000-8000-000000000001'::uuid
    ),
    (
        'Depósito Reactivos',
        'Módulo B',
        'rtmp://demo.invalido/mina/cam03',
        'offline',
        -17.2472,
        -70.6085,
        'a0000001-0000-4000-8000-000000000001'::uuid
    );

CREATE INDEX IF NOT EXISTS idx_mining_sensors_tenant ON mining_sensors (tenant_id);

CREATE INDEX IF NOT EXISTS idx_surveillance_cameras_tenant ON surveillance_cameras (tenant_id);
