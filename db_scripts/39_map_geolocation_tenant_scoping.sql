-- ============================================================================
-- 39_map_geolocation_tenant_scoping.sql
-- Cierra dos brechas encontradas en auditoría de mapa/telemetría en vivo
-- (ver memoria de sesión, "Code State Analysis 2026-07-03"):
--
--   1) `sensors` (tabla REAL de ingesta, 10k filas vía telemetry_ingest.cpp)
--      no tenía columnas de geolocalización. `mining_sensors` (6 filas) sí
--      las tenía pero es una tabla de caché de dashboard desconectada de la
--      ingesta real. Se agregan lat/lng nullable a `sensors` (no se inventan
--      coordenadas para las 10k filas — eso no nos corresponde decidir).
--
--   2) `map_markers` (backing de /api/map/markers) no tenía tenant_id: CERO
--      filtro de tenant en el handler (IDOR real, confirmado por grep — ver
--      map_routes.cpp antes de este cambio). Se agrega tenant_id NOT NULL
--      (backfill al tenant demo, ver kMiningTelemetryDemoTenantId en
--      auth_storage_pg.cpp, ya que las 3 filas demo de 24_map_markers_official_geo.sql
--      no tienen dueño real conocido) + índice compuesto.
--
-- PostGIS NO está disponible en esta imagen (verificado:
-- SELECT * FROM pg_available_extensions WHERE name='postgis' → 0 filas).
-- cube/earthdistance/btree_gist SÍ están disponibles pero NO instalados;
-- no dan un índice GiST bbox-friendly para (lat,lng) sin más trabajo que el
-- que se justifica aquí. Fallback honesto: índice btree compuesto
-- (tenant_id, lat, lng), que sí sirve un WHERE lat BETWEEN ? AND ? AND lng
-- BETWEEN ? AND ? con range scan (confirmado con EXPLAIN, ver verificación
-- en el reporte de esta tarea).
--
-- Prerrequisitos: 04 (tabla sensors), 24 (tabla map_markers).
-- Idempotente: seguro de re-ejecutar.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Geolocalización opcional sobre `sensors` (tabla real de ingesta).
-- ---------------------------------------------------------------------------
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

ALTER TABLE sensors DROP CONSTRAINT IF EXISTS sensors_lat_range_chk;
ALTER TABLE sensors ADD CONSTRAINT sensors_lat_range_chk
  CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));

ALTER TABLE sensors DROP CONSTRAINT IF EXISTS sensors_lng_range_chk;
ALTER TABLE sensors ADD CONSTRAINT sensors_lng_range_chk
  CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180));

-- Índice bbox-friendly (fallback honesto sin PostGIS, ver nota arriba).
-- Parcial: solo filas con coordenadas reales, y solo activas (coincide con
-- el patrón ya usado en idx_sensors_tenant_active).
CREATE INDEX IF NOT EXISTS idx_sensors_tenant_geo
  ON sensors (tenant_id, lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND is_active = true;

-- ---------------------------------------------------------------------------
-- 2) tenant_id sobre `map_markers` (cierre del IDOR de /api/map/markers).
-- ---------------------------------------------------------------------------
ALTER TABLE map_markers ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Backfill: las 3 filas demo existentes no tienen dueño real conocido; se
-- asignan al tenant demo ya usado como fallback en todo el resto del
-- backend (kMiningTelemetryDemoTenantId / auth_storage_pg.cpp) para no
-- inventar un tenant nuevo sin justificación.
UPDATE map_markers
SET tenant_id = 'a0000001-0000-4000-8000-000000000001'::uuid
WHERE tenant_id IS NULL;

ALTER TABLE map_markers ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE map_markers DROP CONSTRAINT IF EXISTS map_markers_tenant_id_fkey;
ALTER TABLE map_markers ADD CONSTRAINT map_markers_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_map_markers_tenant_geo
  ON map_markers (tenant_id, lat, lng);

COMMIT;
