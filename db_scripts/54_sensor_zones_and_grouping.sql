-- ============================================================================
-- 54_sensor_zones_and_grouping.sql
-- Wizard de inserción de gráficos ECharts multi-sensor (ReportStudioV2):
-- el usuario agrupa sensores por zona/área geográfica (nor-este, nor-oeste,
-- sur-este, sur-oeste, ...) antes de graficarlos. Esa agrupación NO existía
-- sobre `sensors` (tabla REAL de ingesta, ver 04_telemetry_schema_v2.sql y
-- 39_map_geolocation_tenant_scoping.sql, que ya le agregó lat/lng nullable
-- sin inventar coordenadas) — solo la tabla legada `mining_sensor_zones`
-- (28_mining_telemetry_uuid_tenant.sql) tenía zonas, y desconectada de la
-- ingesta real.
--
-- Este script:
--   1) Crea `sensor_zones` (catálogo por tenant, mismo patrón que
--      mining_sensor_zones: code/name_es/sort_order) + `sensors.zone_id`.
--   2) Puebla, por cada tenant con sensores, 4 zonas por cuadrante
--      (Nor-Este/Nor-Oeste/Sur-Este/Sur-Oeste) calculadas a partir del
--      centroide real (AVG lat/lng) de los sensores georreferenciados de
--      ESE tenant — no son coordenadas inventadas, son relativas a los
--      sensores que ya existen. Los tenants sin ningún sensor con lat/lng,
--      y los sensores individuales sin coordenadas, caen en la zona de
--      fallback 'SIN-ZONA' (así el wizard siempre tiene un grupo donde
--      mostrarlos, en vez de excluirlos silenciosamente).
--   3) Agrupación por dispositivo físico ("un sensor puede reportar más de
--      una unidad"): NO se agrega columna nueva — se usa
--      COALESCE(serial_number, external_id, sensor_code) como device_key
--      en la capa de consulta (ver sensor_telemetry_wizard.cpp), ya que
--      un dispositivo multi-magnitud se modela como filas hermanas en
--      `sensors` que comparten serial_number/external_id. Aquí solo se
--      agregan los índices que hacen esa agrupación barata.
--
-- Prerrequisitos: 04 (tabla sensors/tenants), 18 (external_id/serial_number
-- en sensors), 39 (lat/lng en sensors).
-- Idempotente: seguro de re-ejecutar (no reasigna zone_id ya poblado).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Catálogo de zonas + FK en sensors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_zones (
    zone_id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name_es TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    centroid_lat DOUBLE PRECISION,
    centroid_lng DOUBLE PRECISION,
    UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sensor_zones_tenant ON sensor_zones (tenant_id);

ALTER TABLE sensors ADD COLUMN IF NOT EXISTS zone_id INTEGER
    REFERENCES sensor_zones (zone_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2) Índices para el wizard: filtro por zona, por tipo de sensor, y
--    agrupación por dispositivo físico (device_key = serial/external_id).
--    idx_sensors_tenant_external ya existe desde 18_tb_sensor_model_...
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sensors_zone ON sensors (zone_id);
CREATE INDEX IF NOT EXISTS idx_sensors_tenant_type ON sensors (tenant_id, sensor_type);
CREATE INDEX IF NOT EXISTS idx_sensors_serial_number
    ON sensors (tenant_id, serial_number)
    WHERE serial_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Seed + asignación por cuadrante, por tenant.
--    "Nor"/"Sur" y "Este"/"Oeste" son relativos al centroide del propio
--    tenant (lat/lng >= centroide → más al norte/este que el promedio de
--    sus propios sensores), no a coordenadas absolutas — funciona igual
--    en cualquier hemisferio.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t RECORD;
  c_lat DOUBLE PRECISION;
  c_lng DOUBLE PRECISION;
  z_ne INT;
  z_no INT;
  z_se INT;
  z_so INT;
  z_sz INT;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM sensors LOOP
    SELECT AVG(lat), AVG(lng) INTO c_lat, c_lng
      FROM sensors
      WHERE tenant_id = t.tenant_id AND lat IS NOT NULL AND lng IS NOT NULL;

    INSERT INTO sensor_zones (tenant_id, code, name_es, sort_order, centroid_lat, centroid_lng)
    VALUES
      (t.tenant_id, 'NOR-ESTE', 'Nor-Este', 10, c_lat, c_lng),
      (t.tenant_id, 'NOR-OESTE', 'Nor-Oeste', 20, c_lat, c_lng),
      (t.tenant_id, 'SUR-ESTE', 'Sur-Este', 30, c_lat, c_lng),
      (t.tenant_id, 'SUR-OESTE', 'Sur-Oeste', 40, c_lat, c_lng),
      (t.tenant_id, 'SIN-ZONA', 'Sin zona asignada', 90, NULL, NULL)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    SELECT zone_id INTO z_ne FROM sensor_zones WHERE tenant_id = t.tenant_id AND code = 'NOR-ESTE';
    SELECT zone_id INTO z_no FROM sensor_zones WHERE tenant_id = t.tenant_id AND code = 'NOR-OESTE';
    SELECT zone_id INTO z_se FROM sensor_zones WHERE tenant_id = t.tenant_id AND code = 'SUR-ESTE';
    SELECT zone_id INTO z_so FROM sensor_zones WHERE tenant_id = t.tenant_id AND code = 'SUR-OESTE';
    SELECT zone_id INTO z_sz FROM sensor_zones WHERE tenant_id = t.tenant_id AND code = 'SIN-ZONA';

    IF c_lat IS NULL THEN
      -- Ningún sensor georreferenciado en este tenant: todos a SIN-ZONA.
      UPDATE sensors SET zone_id = z_sz
        WHERE tenant_id = t.tenant_id AND zone_id IS NULL;
    ELSE
      UPDATE sensors SET zone_id = CASE
          WHEN lat IS NULL OR lng IS NULL THEN z_sz
          WHEN lat >= c_lat AND lng >= c_lng THEN z_ne
          WHEN lat >= c_lat AND lng <  c_lng THEN z_no
          WHEN lat <  c_lat AND lng >= c_lng THEN z_se
          ELSE z_so
        END
        WHERE tenant_id = t.tenant_id AND zone_id IS NULL;
    END IF;
  END LOOP;
END $$;

COMMIT;
