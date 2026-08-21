-- ============================================================================
-- 68 — Coordenadas geográficas de la mina en auth_companies
-- ============================================================================
-- ADR-121. "Mapas" (frontend/src/components/Special/MapViewer.tsx) centra
-- SIEMPRE en Toquepala (INITIAL_VIEW hardcodeado) sin importar la
-- empresa/tenant logueado -- una empresa como Alpayana ve la mina de otra
-- compañía al abrir "Mapas". Esta migración agrega latitud/longitud/zoom
-- directamente a auth_companies -- NO a mining_site_locations (db_scripts/29,
-- keyed por company_name en texto libre, sin FK) ni a `sites`
-- (db_scripts/04, tiene tenant_id FK pero cero rutas backend la usan) --
-- mismo criterio que ruc/domicilio_fiscal en db_scripts/50.
--
-- Retrofit sobre empresas ya existentes: nullable, sin default. "Sin
-- coordenadas todavía" es un estado válido y explícito (ver
-- GET /api/map/company-location -> has_location=false).
--
-- Espejo obligatorio en ensureAuthSchemaPg() (backend/src/auth/auth_storage_pg.cpp),
-- mismo criterio ya documentado ahí para domicilio_fiscal/ruc.

BEGIN;

ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS location_zoom integer;

-- NOT VALID, mismo criterio que auth_companies_ruc_shape (db_scripts/50): no
-- bloquea filas ya cargadas, sí valida INSERT/UPDATE nuevos.
ALTER TABLE auth_companies DROP CONSTRAINT IF EXISTS auth_companies_latitude_range;
ALTER TABLE auth_companies ADD CONSTRAINT auth_companies_latitude_range
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90) NOT VALID;

ALTER TABLE auth_companies DROP CONSTRAINT IF EXISTS auth_companies_longitude_range;
ALTER TABLE auth_companies ADD CONSTRAINT auth_companies_longitude_range
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180) NOT VALID;

ALTER TABLE auth_companies DROP CONSTRAINT IF EXISTS auth_companies_location_zoom_range;
ALTER TABLE auth_companies ADD CONSTRAINT auth_companies_location_zoom_range
    CHECK (location_zoom IS NULL OR location_zoom BETWEEN 0 AND 22) NOT VALID;

COMMIT;

-- ── Verificación post-migración (solo lectura, no falla el script) ──
-- SELECT company_id, name, latitude, longitude, location_zoom FROM auth_companies;
