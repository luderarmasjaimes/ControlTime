-- Ejecución en caliente (Docker): vacía SOLO usuarios de acceso biométrico y logs de auditoría auth.
-- NO borra: reports, proyectos, telemetría, fórmulas, empresas (auth_companies), mapas, etc.
-- Las filas de reports mantienen contenido; created_by / last_modified_by pasan a NULL (ON DELETE SET NULL).
-- report_shares / notifications que referenciaban usuarios se eliminan en cascada por fila.

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_cartoon_base64 TEXT;

DO $$
BEGIN
  IF to_regclass('public.auth_audit_logs') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE auth_audit_logs RESTART IDENTITY';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.auth_users') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth_users';
  END IF;
END $$;

-- Comprobación (debe ser 0)
SELECT COUNT(*)::bigint AS auth_users_count FROM auth_users;
