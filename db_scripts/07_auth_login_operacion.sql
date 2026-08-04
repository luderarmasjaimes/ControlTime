-- Migración idempotente: login con contraseña alineado al backend (hashPassword en main.cpp).
-- Salt por defecto: mining_local_salt_change_me
--   Demo1234! -> b03bc61f5c8ab388
--   admin123  -> 79312d62b1fbdf39
-- Ejecutar en BD existente: scripts/apply-db-auth-login.ps1
-- En BD nueva: se monta como docker-entrypoint-initdb.d después del seed 06.

BEGIN;

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS face_template JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS ruc VARCHAR(20) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mobile VARCHAR(30) DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email VARCHAR(120) DEFAULT '';

UPDATE auth_users SET face_template = '[]'::jsonb WHERE face_template IS NULL;

-- Usuarios demo estándar (contraseña Demo1234!)
UPDATE auth_users
SET password_hash = 'b03bc61f5c8ab388',
    face_template = COALESCE(face_template, '[]'::jsonb)
WHERE company_name = 'Minera Raura'
  AND username IN (
    'carlos_admin',
    'maria_supervisor',
    'juan_supervisor',
    'op_raura',
    'op_vargas',
    'op_patricia',
    'op_david'
  );

-- Cualquier hash bcrypt residual en Minera Raura (excepto bastian_admin, corregido abajo)
UPDATE auth_users
SET password_hash = 'b03bc61f5c8ab388',
    face_template = COALESCE(face_template, '[]'::jsonb)
WHERE company_name = 'Minera Raura'
  AND password_hash LIKE '$2%'
  AND username IS DISTINCT FROM 'bastian_admin';

INSERT INTO auth_users (company_name, first_name, last_name, dni, username, role, password_hash, is_active, face_template)
VALUES (
    'Minera Raura',
    'Bastian',
    'Admin',
    '12345678908',
    'bastian_admin',
    'admin',
    '79312d62b1fbdf39',
    true,
    '[]'::jsonb
  )
ON CONFLICT (company_name, username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  dni = EXCLUDED.dni,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  face_template = EXCLUDED.face_template,
  role = EXCLUDED.role,
  is_active = true;

COMMIT;
