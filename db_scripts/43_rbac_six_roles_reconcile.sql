-- ============================================================================
-- 43 — Reconciliar taxonomía de roles: 4→6, alineado a roleConstants.ts
-- ============================================================================
-- db_scripts/42 introdujo RBAC granular con 4 roles genéricos
-- (admin/manager/operator/viewer), pero el frontend YA tenía una taxonomía
-- minera más específica en frontend/src/auth/roleConstants.ts (fuente de
-- verdad para AuthGateway/UserManagement/Permissions): admin, manager,
-- supervisor, geologist, safety, operator. Esta migración amplía las
-- restricciones para aceptar los 6 roles reales y siembra permisos default
-- razonables para los 3 que faltaban.
--
-- 'viewer' se mantiene como rol válido (uso interno para accesos de solo
-- lectura, p.ej. auditores externos) aunque no aparezca en el selector de
-- roleConstants.ts hoy — no rompe nada mantenerlo.

ALTER TABLE auth_user_tenant DROP CONSTRAINT IF EXISTS auth_user_tenant_role_check;
ALTER TABLE auth_user_tenant ADD CONSTRAINT auth_user_tenant_role_check
    CHECK (role IS NULL OR role IN
        ('admin', 'manager', 'supervisor', 'geologist', 'safety', 'operator', 'viewer'));

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check
    CHECK (role IN
        ('admin', 'manager', 'supervisor', 'geologist', 'safety', 'operator', 'viewer'));

-- supervisor: como manager pero sin gestionar canales de notificación
-- (queda para management/TI) — operación completa del día a día.
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'supervisor', c FROM unnest(ARRAY[
    'mapas.view','informes.view','informes.edit','informes.sign',
    'alarmas.view','dispositivos.view',
    'telemetria.view','formula.view','formula.edit'
]) AS c ON CONFLICT DO NOTHING;

-- geologist (Ing. Geomecánico): foco en mapas/informes/fórmula técnica,
-- sin gestión de dispositivos ni alarmas (fuera de su función).
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'geologist', c FROM unnest(ARRAY[
    'mapas.view','informes.view','informes.edit',
    'alarmas.view','telemetria.view','formula.view','formula.edit'
]) AS c ON CONFLICT DO NOTHING;

-- safety (Prevencionista): foco total en alarmas/telemetría de riesgo +
-- informes (incidentes), sin editar fórmulas ni gestionar dispositivos.
INSERT INTO role_permissions (tenant_id, role, permission_code)
SELECT NULL, 'safety', c FROM unnest(ARRAY[
    'mapas.view','informes.view','informes.edit',
    'alarmas.view','alarmas.manage','dispositivos.view',
    'telemetria.view'
]) AS c ON CONFLICT DO NOTHING;

COMMENT ON CONSTRAINT auth_user_tenant_role_check ON auth_user_tenant IS
    'Ampliado en 43_rbac_six_roles_reconcile.sql a los 6 roles reales de roleConstants.ts (antes solo 4 genéricos de 42).';
