-- ============================================================================
-- 50 — CRUD completo de empresas (auth_companies) + RBAC granular empresas.*
-- ============================================================================
-- Cierra el Hallazgo G2 (docs/decisions/061-catalogo-casos-prueba-qa.md,
-- lineas 19-40 / docs_/01_Planificacion/Auditoria_Registro_RUC_Tenant_2026-07-21.md):
-- ADR-078 ya resolvio el alta (POST /api/auth/companies con dedup), pero no
-- existia mantenimiento (editar/dar de baja), RUC, ni RBAC granular para
-- separar "ver el catalogo" de "mantenerlo". Ver docs/decisions/085,086.
--
-- auth_companies era solo {name PK, active, created_at} -- el catalogo
-- publico que llena el <select> de login/registro (auth_routes.cpp:715-749).
-- Esta migracion la convierte en la tabla real detras de un CRUD administrado,
-- sin tocar su rol como catalogo publico.
--
-- Hallazgos que condicionan esta migracion (verificados en codigo, no supuestos):
--  H1: los CHECK de rol en auth_user_tenant/role_permissions YA estan en los
--      7 roles reales (db_scripts/43) -- no se tocan aqui, solo se verifican
--      al final.
--  H2: role_permissions tiene semantica de OVERRIDE COMPLETO por tenant
--      (db_scripts/42). Un permission_code nuevo no llega solo a admin: hay
--      que insertarlo en el default global Y en todo tenant que ya tenga su
--      propia matriz para ese rol, o esos tenants nunca lo veran.
--  H4: el dedup de POST /api/auth/companies (auth_routes.cpp:806) hace
--      SELECT + INSERT sin indice unico de respaldo -- condicion de carrera
--      real entre dos altas concurrentes del mismo nombre normalizado.
--
-- Toda columna agregada aqui tiene su espejo obligatorio en
-- ensureAuthSchemaPg() (backend/src/auth/auth_storage_pg.cpp) para que un
-- despliegue limpio (que solo monta 01-29 via docker-entrypoint-initdb.d) no
-- arranque con un auth_companies desactualizado.

BEGIN;

-- ── Bloque A — columnas nuevas de auth_companies ────────────────────────────
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS ruc varchar(20) NOT NULL DEFAULT '';
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS country_code char(2) NOT NULL DEFAULT 'PE';
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS domicilio_fiscal text;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(tenant_id);
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS deactivated_by text;
ALTER TABLE auth_companies ADD COLUMN IF NOT EXISTS demo_data boolean NOT NULL DEFAULT false;

-- ── Bloque B — integridad que hoy falta (cierra H4) ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_companies_company_id ON auth_companies (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_companies_name_norm ON auth_companies (lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_companies_ruc ON auth_companies (ruc) WHERE ruc <> '';

-- NOT VALID: puede haber RUC basura ya cargado por fuera del validador (mismo
-- criterio que el CHECK de password_hash en db_scripts/49) -- no bloquea filas
-- existentes, solo INSERT/UPDATE nuevos.
ALTER TABLE auth_companies DROP CONSTRAINT IF EXISTS auth_companies_ruc_shape;
ALTER TABLE auth_companies ADD CONSTRAINT auth_companies_ruc_shape
    CHECK (ruc = '' OR ruc ~ '^[0-9]{8,14}$') NOT VALID;

-- ── Bloque C — backfill ──────────────────────────────────────────────────────

-- C.1 tenant_id: materializa el vinculo que hoy se resuelve por nombre en cada
-- request (resolveTelemetryTenantIdPg / findOrCreateTenantForCompanyPg).
UPDATE auth_companies c
SET tenant_id = t.tenant_id
FROM tenants t
WHERE lower(btrim(t.tenant_name)) = lower(btrim(c.name))
  AND c.tenant_id IS NULL;

-- C.2 ruc: el RUC vive hoy de facto en auth_users.ruc (por usuario, no por
-- empresa). Se adopta solo si es unico y no vacio para esa empresa -- si hay
-- ambiguedad (dos RUC distintos entre los usuarios de la misma empresa) se
-- deja '' para resolucion manual, nunca se elige uno al azar.
WITH ruc_por_empresa AS (
    SELECT company_name, ruc, COUNT(*) AS n
    FROM auth_users
    WHERE ruc IS NOT NULL AND btrim(ruc) <> ''
    GROUP BY company_name, ruc
),
ruc_unico AS (
    SELECT company_name, MIN(ruc) AS ruc
    FROM ruc_por_empresa
    GROUP BY company_name
    HAVING COUNT(*) = 1
)
UPDATE auth_companies c
SET ruc = u.ruc
FROM ruc_unico u
WHERE lower(btrim(u.company_name)) = lower(btrim(c.name))
  AND c.ruc = '';

-- C.3 alta de empresas que ya operan (tienen usuarios o tenant) pero nunca
-- entraron al catalogo auth_companies (p.ej. las 5 legacy de db_scripts/48).
INSERT INTO auth_companies (name, active, tenant_id)
SELECT DISTINCT u.company_name, true, t.tenant_id
FROM auth_users u
LEFT JOIN tenants t ON lower(btrim(t.tenant_name)) = lower(btrim(u.company_name))
WHERE btrim(u.company_name) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM auth_companies c
      WHERE lower(btrim(c.name)) = lower(btrim(u.company_name))
  )
ON CONFLICT (name) DO NOTHING;

-- ── Bloque D — RBAC granular: empresas.view / empresas.manage (cierra H2) ──
INSERT INTO platform_permissions (code, module, description) VALUES
    ('empresas.view',   'empresas', 'Ver el catalogo administrativo de empresas (mantenimiento)'),
    ('empresas.manage', 'empresas', 'Crear, editar y dar de baja empresas del catalogo')
ON CONFLICT (code) DO NOTHING;

-- D.1 Default global: admin ve y mantiene; manager solo ve.
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'admin', c FROM unnest(ARRAY['empresas.view','empresas.manage']) AS c
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'manager', 'empresas.view'
ON CONFLICT DO NOTHING;

-- D.2 Propagacion a tenants que YA tienen override propio para admin/manager
-- (H2: sin esto, cualquier tenant con matriz propia nunca veria el permiso
-- nuevo, porque sus filas reemplazan el default global por completo).
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT DISTINCT rp.tenant_id, 'admin', c
FROM role_permissions rp
CROSS JOIN unnest(ARRAY['empresas.view','empresas.manage']) AS c
WHERE rp.tenant_id IS NOT NULL AND rp.role = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT DISTINCT rp.tenant_id, 'manager', 'empresas.view'
FROM role_permissions rp
WHERE rp.tenant_id IS NOT NULL AND rp.role = 'manager'
ON CONFLICT DO NOTHING;

COMMIT;

-- ── Bloque E — verificaciones post-migracion (solo lectura, no falla el script) ──

-- E.1 confirma H1: los CHECK de rol deben seguir en los 7 roles reales.
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname IN ('role_permissions_role_check','auth_user_tenant_role_check');

-- E.2 empresas con RUC ambiguo entre sus usuarios -- requieren resolucion manual.
-- SELECT company_name, COUNT(DISTINCT ruc) AS rucs_distintos
-- FROM auth_users WHERE ruc IS NOT NULL AND btrim(ruc) <> ''
-- GROUP BY company_name HAVING COUNT(DISTINCT ruc) > 1;

-- E.3 confirma D: deben existir exactamente 2 codigos nuevos y su matriz default.
-- SELECT code FROM platform_permissions WHERE module = 'empresas';
-- SELECT role, permission_code FROM role_permissions
--   WHERE permission_code LIKE 'empresas.%' AND tenant_id IS NULL;
