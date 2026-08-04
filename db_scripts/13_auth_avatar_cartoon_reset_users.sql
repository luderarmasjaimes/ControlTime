-- Avatar cartoon (base64 PNG o JPEG) generado en registro biométrico + limpieza de usuarios para empezar desde cero.
-- Ejecuta al final del init de Docker (volúmenes nuevos). En BD existente: el backend añade la columna vía ensureAuthSchemaPg.

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_cartoon_base64 TEXT;

-- Rostros / plantillas ligadas a usuarios (si la tabla existe en este entorno)
DO $$
BEGIN
  IF to_regclass('public.auth_face_templates') IS NOT NULL THEN
    TRUNCATE TABLE auth_face_templates RESTART IDENTITY CASCADE;
  END IF;
END$$;

TRUNCATE TABLE auth_audit_logs RESTART IDENTITY;

DELETE FROM auth_users;
