-- ============================================================================
-- 98 — Addendum ADR-190: corrección de domicilio_fiscal + cruce Ares/Inmaculada
-- ============================================================================
-- La investigación de ADR-190 encontró que el nombre/domicilio_fiscal
-- registrado para varias empresas no correspondía a su unidad minera
-- realmente activa. Este script corrige el texto de domicilio_fiscal donde
-- la investigación identificó con evidencia sólida (prensa especializada,
-- Wikipedia, sitio corporativo) cuál es la unidad real -- y, para
-- Ares/Compania Minera Ares, también la coordenada: la investigación
-- (Grupo C) determinó que su unidad activa es Inmaculada, la misma que ya
-- se había corregido para "Hochschild Mining Peru" (Grupo B, mismo grupo
-- corporativo Hochschild) en db_scripts/97 -- se reutiliza esa coordenada en
-- vez de dejarla sin corregir por descoordinación entre las dos
-- investigaciones paralelas.
--
-- CASO SIN RESOLVER (documentado, no corregido aquí): "Compania Minera San
-- Ignacio de Morococha" (SIMSA) -- su unidad real es "San Vicente" (Vítoc,
-- Chanchamayo, Junín), pero no se encontró una coordenada verificable para
-- ese punto. Se corrige el texto de domicilio_fiscal a la ubicación
-- correcta, pero latitude/longitude siguen apuntando a la zona de Morococha
-- (incorrecta) hasta que se investigue puntualmente. Ver ADR-190 (addendum).

BEGIN;

-- Minera Boroo Misquichilca -- coordenada ya corregida en db_scripts/97 (Lagunas Norte)
UPDATE auth_companies SET domicilio_fiscal = 'Unidad Lagunas Norte, Santiago de Chuco, La Libertad'
WHERE company_id = '6db5cfe6-6d30-47fa-b671-99afd4f8b806';

-- Minera Corona -- coordenada ya corregida en db_scripts/97 (Yauricocha)
UPDATE auth_companies SET domicilio_fiscal = 'Unidad Yauricocha, Yauyos, Lima'
WHERE company_id = 'aa8a76ac-6788-4b99-9746-22312a10a38c';

-- Ares / Compania Minera Ares -- unidad real Inmaculada (grupo Hochschild);
-- se reutiliza la coordenada ya verificada para "Hochschild Mining Peru"
UPDATE auth_companies
SET domicilio_fiscal = 'Unidad Inmaculada, Páucar del Sara Sara, Ayacucho',
    latitude = -14.9553, longitude = -73.2428, location_zoom = 14
WHERE company_id IN ('8eddaa74-c3b2-4d24-b3b4-66b0c45974c0', '8dd8b942-aadc-4499-8218-9e66d3f74cdb');

-- SIMSA -- solo se corrige el texto; sin coordenada verificable de San
-- Vicente todavía, latitude/longitude quedan sin tocar (pendiente, ver ADR-190)
UPDATE auth_companies SET domicilio_fiscal = 'Unidad San Vicente, Chanchamayo, Junín'
WHERE company_id = 'bee8cceb-f8dd-469b-8be9-ed3b86b752f9';

COMMIT;

-- ── Verificación post-migración (solo lectura) ──
-- SELECT name, domicilio_fiscal, latitude, longitude FROM auth_companies
-- WHERE company_id IN ('6db5cfe6-6d30-47fa-b671-99afd4f8b806','aa8a76ac-6788-4b99-9746-22312a10a38c',
--   '8eddaa74-c3b2-4d24-b3b4-66b0c45974c0','8dd8b942-aadc-4499-8218-9e66d3f74cdb','bee8cceb-f8dd-469b-8be9-ed3b86b752f9');
