-- ─────────────────────────────────────────────────────────────────────────
-- 62 — Departamento RRHH + modelo de "departamento" por usuario (ADR-115)
-- ─────────────────────────────────────────────────────────────────────────
-- Hasta ahora los departamentos de soporte (soporte/comercial/reclamo/agenda)
-- vivían solo como categoría de ticket, sin ningún concepto de "a qué
-- departamento pertenece este usuario" -- cualquiera con soporte.manage veía
-- y gestionaba TODO. Esta migración agrega:
--   1) 'rrhh' como quinta categoría válida (mismo patrón que las 4 existentes).
--   2) auth_user_tenant.department: departamento del agente EN ESE TENANT,
--      usado para segmentar el panel admin de búsqueda (ver
--      support_storage_pg.cpp::searchTicketsPg y ADR-115). NULL = sin
--      restricción de departamento -- sigue dependiendo de soporte.view/manage.
--   3) soporte.view: permiso de solo lectura, separado de soporte.manage (que
--      sigue gateando mutaciones: cambiar estado de ticket, editar números).

-- 1) RRHH como categoría de ticket válida.
ALTER TABLE support_ticket DROP CONSTRAINT IF EXISTS support_ticket_category_check;
ALTER TABLE support_ticket ADD CONSTRAINT support_ticket_category_check
    CHECK (category IN ('soporte', 'comercial', 'reclamo', 'agenda', 'rrhh'));

-- Prefijo de código propio para RRHH (RRH-YYYYMMDD-NNNN), mismo generador.
CREATE OR REPLACE FUNCTION generate_support_ticket_code(p_category text)
RETURNS text AS $$
DECLARE
    v_prefix text;
BEGIN
    v_prefix := CASE p_category
        WHEN 'soporte'   THEN 'SOP'
        WHEN 'comercial' THEN 'COM'
        WHEN 'reclamo'   THEN 'RCL'
        WHEN 'agenda'    THEN 'AGE'
        WHEN 'rrhh'      THEN 'RRH'
        ELSE 'TCK'
    END;
    RETURN v_prefix || '-' || to_char(now(), 'YYYYMMDD') || '-' ||
           lpad(nextval('support_ticket_code_seq')::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- 2) Departamento del agente, por tenant (mismo patrón que auth_user_tenant.role,
--    agregado en db_scripts/42 sobre una tabla ya existente).
ALTER TABLE auth_user_tenant ADD COLUMN IF NOT EXISTS department text
    CHECK (department IS NULL OR department IN ('soporte', 'comercial', 'reclamo', 'agenda', 'rrhh'));

COMMENT ON COLUMN auth_user_tenant.department IS
    'Departamento de soporte al que está adscrito el usuario EN ESTE TENANT, usado para segmentar el panel admin de búsqueda de tickets/conversaciones (GET /api/support/admin/tickets). NULL = sin restricción de departamento (depende solo de soporte.view/soporte.manage). Ver ADR-115.';

-- 3) Permiso de solo lectura para el panel admin (separado de soporte.manage,
--    que sigue siendo el único que autoriza mutaciones).
INSERT INTO platform_permissions (code, module, description) VALUES
    ('soporte.view', 'soporte', 'Ver/buscar tickets y conversaciones de soporte (solo lectura, todas las categorías)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, r.role, 'soporte.view' FROM unnest(ARRAY['admin', 'manager', 'supervisor']) AS r(role)
ON CONFLICT DO NOTHING;
