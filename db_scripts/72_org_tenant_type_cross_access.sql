-- ============================================================================
-- 72 — company_type (minera/organización) + acceso cruzado org_tenant_access
-- ============================================================================
-- Formaliza el caso de uso que ADR-029 anticipó y descartó explícitamente por
-- falta de necesidad de negocio en su momento ("si el negocio de
-- distribuidores de software revendiendo a mineras se formaliza, requiere un
-- ADR propio"): hoy Beemetry y TimeTelemetry (db_scripts/51) son tenants
-- indistinguibles de cualquier minera cliente. Ver docs/decisions/1XX (esta
-- migración).
--
-- Diseño (cierra explícitamente la tensión abierta en ADR-086, líneas 68-77:
-- "hasPermission evalúa el permiso contra session->tenantId... pero el
-- recurso es de plataforma, no de un tenant específico"):
--  - `tenants.company_type` es la fuente de verdad única para saber si un
--    tenant es 'organization' (Beemetry/TimeTelemetry) o 'mining_client'
--    (default). auth_companies NO duplica esta columna -- la expone via
--    subquery correlacionada en auth_storage_pg.cpp (evita un dual-write
--    nuevo, lección de ADR-039).
--  - NO se crea un 8vo rol. `org_tenant_access` es una tabla de CONCESIÓN
--    explícita, separada de `auth_user_tenant` (que sigue siendo "membresía
--    real", ADR-038/039) -- un usuario de un tenant 'organization' puede
--    operar en un tenant minero con uno de los 7 roles YA existentes, sin
--    tocar los 3 puntos donde viven hoy (auth_routes.cpp:kValidPlatformRoles,
--    notification_routes.cpp:kValidRoles, roleConstants.ts).
--  - El permiso nuevo `org.cross_tenant.manage` se cierra con un guardia
--    DOBLE en el backend (hasPermission + isOrganizationTenant(session
--    tenant)) -- así, aunque una minera se autoinserte el permission_code en
--    su propia matriz (posible hoy por el diseño de override completo por
--    tenant, ADR-086/db_scripts/42), el chequeo de tipo de tenant bloquea su
--    uso igual.
--
-- Toda columna/tabla agregada aquí tiene su espejo obligatorio en
-- ensureAuthSchemaPg() (backend/src/auth/auth_storage_pg.cpp), mismo criterio
-- que db_scripts/50.

BEGIN;

-- ── Bloque A — tipo de empresa/tenant ───────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS company_type TEXT NOT NULL DEFAULT 'mining_client';
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_company_type_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_company_type_check
    CHECK (company_type IN ('mining_client', 'organization'));

COMMENT ON COLUMN tenants.company_type IS
    'mining_client (default, empresa minera cliente) | organization (Beemetry/TimeTelemetry -- habilita acceso cruzado via org_tenant_access).';

UPDATE tenants SET company_type = 'organization'
WHERE tenant_name IN ('Beemetry', 'TimeTelemetry') AND company_type <> 'organization';

-- ── Bloque B — región América (metadata; SIN infraestructura -- ver ADR-035,
-- que sigue en fase F0, y el ADR de esta migración) ─────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_region_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_region_check
    CHECK (region IS NULL OR region IN ('north_america', 'central_america', 'south_america'));

COMMENT ON COLUMN tenants.region IS
    'Metadata derivada de country_code/primary_country_iso2 para reportes y filtros -- NO implica infraestructura desplegada por región (ver ADR-035, fase F0).';

-- B.1 backfill best-effort desde el país ya registrado del tenant.
UPDATE tenants
SET region = CASE COALESCE(primary_country_iso2, country_code)
    WHEN 'US' THEN 'north_america' WHEN 'CA' THEN 'north_america' WHEN 'MX' THEN 'north_america'
    WHEN 'GT' THEN 'central_america' WHEN 'BZ' THEN 'central_america' WHEN 'SV' THEN 'central_america'
    WHEN 'HN' THEN 'central_america' WHEN 'NI' THEN 'central_america' WHEN 'CR' THEN 'central_america'
    WHEN 'PA' THEN 'central_america'
    WHEN 'CO' THEN 'south_america' WHEN 'VE' THEN 'south_america' WHEN 'EC' THEN 'south_america'
    WHEN 'PE' THEN 'south_america' WHEN 'BO' THEN 'south_america' WHEN 'BR' THEN 'south_america'
    WHEN 'PY' THEN 'south_america' WHEN 'CL' THEN 'south_america' WHEN 'AR' THEN 'south_america'
    WHEN 'UY' THEN 'south_america' WHEN 'GY' THEN 'south_america' WHEN 'SR' THEN 'south_america'
    ELSE region
END
WHERE region IS NULL;

-- ── Bloque C — acceso cruzado explícito (personal de organización) ─────────
CREATE TABLE IF NOT EXISTS org_tenant_access (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    granted_by UUID NOT NULL REFERENCES auth_users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES auth_users(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, tenant_id)
);

ALTER TABLE org_tenant_access DROP CONSTRAINT IF EXISTS org_tenant_access_role_check;
ALTER TABLE org_tenant_access ADD CONSTRAINT org_tenant_access_role_check
    CHECK (role IN ('admin', 'manager', 'supervisor', 'geologist', 'safety', 'operator', 'viewer'));

CREATE INDEX IF NOT EXISTS idx_org_tenant_access_user_active
    ON org_tenant_access (user_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_org_tenant_access_tenant_active
    ON org_tenant_access (tenant_id) WHERE active = TRUE;

COMMENT ON TABLE org_tenant_access IS
    'Concesión EXPLÍCITA de acceso cruzado: un usuario cuyo tenant "de casa" es company_type=organization puede operar en un tenant minero con uno de los 7 roles ya existentes, sin ser membresía real (auth_user_tenant). Auditado aparte -- ver GET /api/auth/org-access/audit.';

-- ── Bloque D — RBAC: permiso de plataforma org.cross_tenant.manage ─────────
INSERT INTO platform_permissions (code, module, description) VALUES
    ('org.cross_tenant.manage', 'organizacion', 'Otorgar/revocar acceso cruzado de personal de organización (Beemetry/TimeTelemetry) a empresas mineras clientes')
ON CONFLICT (code) DO NOTHING;

-- D.1 Default global: solo admin (mismo criterio que empresas.manage, db_scripts/50).
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'admin', 'org.cross_tenant.manage'
ON CONFLICT DO NOTHING;

-- D.2 Propagación a tenants que YA tienen override propio para admin (mismo
-- motivo que ADR-086/db_scripts/50 bloque D.2: sin esto, un tenant con matriz
-- propia nunca vería el permiso nuevo). El guardia real contra escalación NO
-- es este permission_code por sí solo -- es el chequeo adicional
-- isOrganizationTenant(session->tenantId) en el backend (ver
-- backend/src/auth/permissions.cpp/org_access_routes.cpp): un tenant minero
-- que se autoinserte este código igual no puede usarlo si su company_type no
-- es 'organization'.
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT DISTINCT rp.tenant_id, 'admin', 'org.cross_tenant.manage'
FROM role_permissions rp
WHERE rp.tenant_id IS NOT NULL AND rp.role = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;

-- ── Bloque E — verificaciones post-migración (solo lectura) ────────────────
-- E.1 SELECT tenant_name, company_type, region FROM tenants ORDER BY tenant_name;
-- E.2 SELECT code FROM platform_permissions WHERE module = 'organizacion';
-- E.3 SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conname IN ('tenants_company_type_check','tenants_region_check','org_tenant_access_role_check');
