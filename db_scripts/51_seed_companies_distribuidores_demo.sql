-- ============================================================================
-- 51 — Seed de prueba: TimeTelemetry, Beemetry y distribuidoras reales del
-- rubro minero/industrial peruano, con usuarios de prueba multiperfil
-- ============================================================================
-- Cierra la parte de datos del Hallazgo G2 (ver db_scripts/50, ADR-085/086/088).
--
-- *** SOLO PARA ENTORNOS DE DEMO/QA — NO CORRER EN PRODUCCIÓN ***
-- Toda fila de este script queda marcada `demo_data = true` (auth_companies)
-- y sus usuarios llevan el prefijo `demo_` — purgable con:
--   DELETE FROM auth_users WHERE username LIKE 'demo\_%';
--   DELETE FROM auth_companies WHERE demo_data = true;
--
-- *** ADVERTENCIA SOBRE LOS RUC ***
-- No existe una API REST oficial y gratuita de SUNAT (solo el portal HTML
-- e-consultaruc.sunat.gob.pe) — no fue posible verificar el RUC real de
-- ninguna de estas empresas contra el padrón. Los RUC de abajo son
-- SINTÉTICOS: cumplen el dígito verificador de SUNAT (mismo algoritmo mod-11
-- de auth_routes.cpp/tax_id.cpp, ver verificación en la tabla) para que el
-- validador de la plataforma los acepte, pero NO corresponden al RUC real
-- de la empresa nombrada. Las razones sociales sí son reales y públicas
-- (registro de distribuidores del rubro minero en Perú). Antes de usar este
-- seed en cualquier demo frente a cliente: reemplazar cada RUC por el
-- verdadero (verificado en e-consultaruc.sunat.gob.pe) o cambiar la razón
-- social por una ficticia.
--
-- *** USUARIOS DE PRUEBA — CONTRASEÑA COMPARTIDA ***
-- Contraseña de todos los usuarios de este seed: Demo1234!
-- Hash Argon2id (formato estándar, auth::verifyPassword lo acepta vía
-- argon2id_verify sin necesitar que los parámetros coincidan con los de
-- BEEMETRY_ARGON2_* — cada hash trae sus propios parámetros codificados):
--   $argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk
-- Generado con: printf 'Demo1234!' | argon2 beemetrydemo2026 -id -t 3 -m 16 -p 1 -l 32 -e
--
-- 4 perfiles por empresa (24 usuarios en total) — validan la matriz RBAC de
-- empresas.* sembrada en db_scripts/50:
--   _admin     role=admin       → empresas.view + empresas.manage (CRUD completo)
--   _gerente   role=manager     → solo empresas.view (RUC enmascarado, sin botones)
--   _super     role=supervisor  → sin empresas.* (el ítem de menú no aparece)
--   _consulta  role=viewer      → sin empresas.* (valida que 'viewer' sea asignable,
--                                  TC-RBAC-05 de ADR-061)

BEGIN;

-- ── Tenants + auth_companies + mineria_empresas ─────────────────────────────

INSERT INTO tenants (tenant_name) VALUES
    ('TimeTelemetry'),
    ('Beemetry'),
    ('Ferreyros S.A.A.'),
    ('Komatsu-Mitsui Maquinarias Perú S.A.'),
    ('Volvo Perú S.A.'),
    ('Motored S.A.')
ON CONFLICT (tenant_name) DO NOTHING;

-- RUC sintéticos (checksum SUNAT válido, ver advertencia arriba):
--   TimeTelemetry                          20500000016
--   Beemetry                               20500000024
--   Ferreyros S.A.A.                       20500000032
--   Komatsu-Mitsui Maquinarias Perú S.A.   20500000041
--   Volvo Perú S.A.                        20500000059
--   Motored S.A.                           20500000067
INSERT INTO auth_companies (name, ruc, country_code, active, demo_data, tenant_id)
SELECT v.name, v.ruc, 'PE', true, true, t.tenant_id
FROM (VALUES
    ('TimeTelemetry',                         '20500000016'),
    ('Beemetry',                              '20500000024'),
    ('Ferreyros S.A.A.',                      '20500000032'),
    ('Komatsu-Mitsui Maquinarias Perú S.A.',  '20500000041'),
    ('Volvo Perú S.A.',                       '20500000059'),
    ('Motored S.A.',                          '20500000067')
) AS v(name, ruc)
JOIN tenants t ON t.tenant_name = v.name
ON CONFLICT (name) DO UPDATE SET
    ruc = EXCLUDED.ruc,
    demo_data = true,
    tenant_id = EXCLUDED.tenant_id
WHERE auth_companies.ruc = '';

-- mineria_empresas: el tenant_id del JWT se resuelve por nombre contra esta
-- tabla (resolveTelemetryTenantIdPg, auth_storage_pg.cpp) — sin esta fila los
-- usuarios de prueba caerían al tenant de fallback en vez del suyo propio.
INSERT INTO mineria_empresas (codigo, nombre, tenant_id)
SELECT t.tenant_name, t.tenant_name, t.tenant_id
FROM tenants t
WHERE t.tenant_name IN (
    'TimeTelemetry', 'Beemetry', 'Ferreyros S.A.A.',
    'Komatsu-Mitsui Maquinarias Perú S.A.', 'Volvo Perú S.A.', 'Motored S.A.'
)
AND NOT EXISTS (SELECT 1 FROM mineria_empresas me WHERE me.nombre = t.tenant_name);

-- ── Usuarios de prueba (4 perfiles x 6 empresas = 24) ───────────────────────
-- Patrón: CTE de INSERT (ON CONFLICT DO NOTHING, idempotente) encadenado al
-- alta de membresía en auth_user_tenant. `id` no se especifica: la tabla real
-- ya trae `id UUID DEFAULT uuid_generate_v4()` (verificado con \d auth_users
-- contra el contenedor real — el CREATE TABLE IF NOT EXISTS de
-- ensureAuthSchemaPg dice "TEXT" pero nunca corre en una BD ya inicializada
-- por db_scripts/01_init.sql, que es la fuente real de este esquema).

-- TimeTelemetry (DNI 90000001-90000004)
WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('TimeTelemetry', 'Demo', 'Admin', '90000001', 'demo_timetelemetry_admin', 'admin',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_timetelemetry_admin@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'admin' FROM nu, tenants t WHERE t.tenant_name = 'TimeTelemetry'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('TimeTelemetry', 'Demo', 'Gerente', '90000002', 'demo_timetelemetry_gerente', 'manager',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_timetelemetry_gerente@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'manager' FROM nu, tenants t WHERE t.tenant_name = 'TimeTelemetry'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('TimeTelemetry', 'Demo', 'Supervisor', '90000003', 'demo_timetelemetry_super', 'supervisor',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_timetelemetry_super@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'supervisor' FROM nu, tenants t WHERE t.tenant_name = 'TimeTelemetry'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('TimeTelemetry', 'Demo', 'Consulta', '90000004', 'demo_timetelemetry_consulta', 'viewer',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_timetelemetry_consulta@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'viewer' FROM nu, tenants t WHERE t.tenant_name = 'TimeTelemetry'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Beemetry (DNI 90000005-90000008)
WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Beemetry', 'Demo', 'Admin', '90000005', 'demo_beemetry_admin', 'admin',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_beemetry_admin@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'admin' FROM nu, tenants t WHERE t.tenant_name = 'Beemetry'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Beemetry', 'Demo', 'Gerente', '90000006', 'demo_beemetry_gerente', 'manager',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_beemetry_gerente@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'manager' FROM nu, tenants t WHERE t.tenant_name = 'Beemetry'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Beemetry', 'Demo', 'Supervisor', '90000007', 'demo_beemetry_super', 'supervisor',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_beemetry_super@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'supervisor' FROM nu, tenants t WHERE t.tenant_name = 'Beemetry'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Beemetry', 'Demo', 'Consulta', '90000008', 'demo_beemetry_consulta', 'viewer',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_beemetry_consulta@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'viewer' FROM nu, tenants t WHERE t.tenant_name = 'Beemetry'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Ferreyros S.A.A. (DNI 90000009-90000012)
WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Ferreyros S.A.A.', 'Demo', 'Admin', '90000009', 'demo_ferreyros_admin', 'admin',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_ferreyros_admin@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'admin' FROM nu, tenants t WHERE t.tenant_name = 'Ferreyros S.A.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Ferreyros S.A.A.', 'Demo', 'Gerente', '90000010', 'demo_ferreyros_gerente', 'manager',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_ferreyros_gerente@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'manager' FROM nu, tenants t WHERE t.tenant_name = 'Ferreyros S.A.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Ferreyros S.A.A.', 'Demo', 'Supervisor', '90000011', 'demo_ferreyros_super', 'supervisor',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_ferreyros_super@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'supervisor' FROM nu, tenants t WHERE t.tenant_name = 'Ferreyros S.A.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Ferreyros S.A.A.', 'Demo', 'Consulta', '90000012', 'demo_ferreyros_consulta', 'viewer',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_ferreyros_consulta@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'viewer' FROM nu, tenants t WHERE t.tenant_name = 'Ferreyros S.A.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Komatsu-Mitsui Maquinarias Perú S.A. (DNI 90000013-90000016)
WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Komatsu-Mitsui Maquinarias Perú S.A.', 'Demo', 'Admin', '90000013', 'demo_komatsu_admin', 'admin',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_komatsu_admin@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'admin' FROM nu, tenants t WHERE t.tenant_name = 'Komatsu-Mitsui Maquinarias Perú S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Komatsu-Mitsui Maquinarias Perú S.A.', 'Demo', 'Gerente', '90000014', 'demo_komatsu_gerente', 'manager',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_komatsu_gerente@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'manager' FROM nu, tenants t WHERE t.tenant_name = 'Komatsu-Mitsui Maquinarias Perú S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Komatsu-Mitsui Maquinarias Perú S.A.', 'Demo', 'Supervisor', '90000015', 'demo_komatsu_super', 'supervisor',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_komatsu_super@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'supervisor' FROM nu, tenants t WHERE t.tenant_name = 'Komatsu-Mitsui Maquinarias Perú S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Komatsu-Mitsui Maquinarias Perú S.A.', 'Demo', 'Consulta', '90000016', 'demo_komatsu_consulta', 'viewer',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_komatsu_consulta@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'viewer' FROM nu, tenants t WHERE t.tenant_name = 'Komatsu-Mitsui Maquinarias Perú S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Volvo Perú S.A. (DNI 90000017-90000020)
WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Volvo Perú S.A.', 'Demo', 'Admin', '90000017', 'demo_volvo_admin', 'admin',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_volvo_admin@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'admin' FROM nu, tenants t WHERE t.tenant_name = 'Volvo Perú S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Volvo Perú S.A.', 'Demo', 'Gerente', '90000018', 'demo_volvo_gerente', 'manager',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_volvo_gerente@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'manager' FROM nu, tenants t WHERE t.tenant_name = 'Volvo Perú S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Volvo Perú S.A.', 'Demo', 'Supervisor', '90000019', 'demo_volvo_super', 'supervisor',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_volvo_super@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'supervisor' FROM nu, tenants t WHERE t.tenant_name = 'Volvo Perú S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Volvo Perú S.A.', 'Demo', 'Consulta', '90000020', 'demo_volvo_consulta', 'viewer',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_volvo_consulta@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'viewer' FROM nu, tenants t WHERE t.tenant_name = 'Volvo Perú S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Motored S.A. (DNI 90000021-90000024)
WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Motored S.A.', 'Demo', 'Admin', '90000021', 'demo_motored_admin', 'admin',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_motored_admin@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'admin' FROM nu, tenants t WHERE t.tenant_name = 'Motored S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Motored S.A.', 'Demo', 'Gerente', '90000022', 'demo_motored_gerente', 'manager',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_motored_gerente@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'manager' FROM nu, tenants t WHERE t.tenant_name = 'Motored S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Motored S.A.', 'Demo', 'Supervisor', '90000023', 'demo_motored_super', 'supervisor',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_motored_super@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'supervisor' FROM nu, tenants t WHERE t.tenant_name = 'Motored S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

WITH nu AS (
  INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, email, face_template)
  VALUES ('Motored S.A.', 'Demo', 'Consulta', '90000024', 'demo_motored_consulta', 'viewer',
          '$argon2id$v=19$m=65536,t=3,p=1$YmVlbWV0cnlkZW1vMjAyNg$DDEzjEONO9unkzVZB8GuV02UmkijQmDwxrIKHMVP8Fk',
          'demo_motored_consulta@example.invalid', '[]'::jsonb)
  ON CONFLICT (company_name, username) DO NOTHING RETURNING id
)
INSERT INTO auth_user_tenant (user_id, tenant_id, is_default, role)
SELECT nu.id, t.tenant_id, true, 'viewer' FROM nu, tenants t WHERE t.tenant_name = 'Motored S.A.'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

COMMIT;

-- ── Verificación post-seed (solo lectura) ───────────────────────────────────
-- SELECT company_name, username, role FROM auth_users WHERE username LIKE 'demo\_%' ORDER BY company_name, role;
-- SELECT name, ruc, demo_data FROM auth_companies WHERE demo_data = true ORDER BY name;
