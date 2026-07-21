-- Fix real: usuarios autoregistrados (POST /api/auth/register) nunca
-- obtenian una fila real en auth_user_tenant. resolveTelemetryTenantIdPg
-- (auth_storage_pg.cpp) caia entonces al tenant de FALLBACK
-- (kMiningTelemetryDemoTenantId) para cualquier company_name sin match en
-- mineria_empresas.tenant_id -- y ese fallback resulto ser el tenant_id REAL
-- de "Compania Minera Antamina" (a0000001-...), no un tenant demo dedicado.
--
-- Verificado antes de este script: los 5 company_name legacy en auth_users
-- (Alpayana, Minera Raura, Compania Minera Raura, Activos Mineros, LUDER)
-- nunca tuvieron su propio tenant. Algunos usuarios de prueba de sesiones
-- anteriores (larmas, JUANP, e2e_attacker, e2e_test_admin) quedaron con
-- membresias auth_user_tenant apuntando por error a tenants reales ajenos
-- (Antamina, Minera Las Bambas) -- exactamente el escenario que ADR-039 ya
-- habia decidido NO inventar ("no hay tenant real en juego" para estos 5
-- company_name). Este script corrige eso dandole a cada uno SU PROPIO
-- tenant dedicado, en vez de pedir prestado uno ajeno.
--
-- El fix de codigo (auth_storage_pg.cpp: findOrCreateTenantForCompanyPg,
-- llamado desde handleRegister en main.cpp) hace esto mismo automaticamente
-- para cualquier registro NUEVO desde ahora; este script es el backfill
-- unico para los usuarios ya existentes.

BEGIN;

-- 1) Un tenant dedicado por cada company_name legacy sin tenant propio.
INSERT INTO tenants (tenant_name)
VALUES
  ('Alpayana'),
  ('Minera Raura'),
  ('Compania Minera Raura'),
  ('Activos Mineros'),
  ('LUDER')
ON CONFLICT (tenant_name) DO NOTHING;

-- 2) Corrige membresias previas que apuntaban a un tenant ajeno (Antamina,
--    Las Bambas) por el bug del fallback -- solo afecta a estos 5
--    company_name, nunca toca tenants/usuarios de otras empresas reales.
DELETE FROM auth_user_tenant ut
USING auth_users u, tenants t_correct
WHERE ut.user_id = u.id
  AND u.company_name IN ('Alpayana', 'Minera Raura', 'Compania Minera Raura', 'Activos Mineros', 'LUDER')
  AND t_correct.tenant_name = u.company_name
  AND ut.tenant_id <> t_correct.tenant_id;

-- 3) Backfill: cada usuario de estas 5 empresas queda vinculado a SU tenant.
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT u.id, t.tenant_id, true, u.role
FROM auth_users u
JOIN tenants t ON t.tenant_name = u.company_name
WHERE u.company_name IN ('Alpayana', 'Minera Raura', 'Compania Minera Raura', 'Activos Mineros', 'LUDER')
ON CONFLICT (user_id, tenant_id) DO UPDATE SET is_default = true, role = EXCLUDED.role;

-- 4) mineria_empresas.tenant_id alineado con el mismo tenant (Alpayana ya
--    tenia fila con tenant_id NULL; el resto no tenia fila -- se crea).
UPDATE mineria_empresas me
SET tenant_id = t.tenant_id
FROM tenants t
WHERE t.tenant_name = me.nombre
  AND me.nombre IN ('Alpayana', 'Minera Raura', 'Compania Minera Raura', 'Activos Mineros', 'LUDER');

INSERT INTO mineria_empresas (codigo, nombre, tenant_id)
SELECT t.tenant_name, t.tenant_name, t.tenant_id
FROM tenants t
WHERE t.tenant_name IN ('Minera Raura', 'Compania Minera Raura', 'Activos Mineros', 'LUDER')
  AND NOT EXISTS (SELECT 1 FROM mineria_empresas me WHERE me.nombre = t.tenant_name);

-- 5) Los 3 informes creados hoy durante la verificacion e2e de este fix
--    quedaron mal etiquetados bajo el tenant de Antamina (por el mismo bug
--    de fallback, antes de este backfill) -- son artefactos de prueba, no
--    hay dato de cliente real en juego (mismo criterio que
--    45_adr039_migracion_completa_tenant_id.sql).
DELETE FROM reports
WHERE title IN ('test seed 2', 'Informe Seed E2E', 'Informe E2E Report V2')
   OR title LIKE 'Informe Seed E2E %'
   OR title LIKE 'Informe E2E Report V2 %';

COMMIT;
