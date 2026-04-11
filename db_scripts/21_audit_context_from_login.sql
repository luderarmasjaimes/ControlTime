-- =============================================================================
-- 21_audit_context_from_login.sql
-- Resuelve user_id (UUID) y tenant por username + company_name para GUC de
-- auditoría; evita depender del formato del id generado en el cliente.
-- Prerrequisito: 20_audit_traceability_enforcement.sql
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_audit_context_from_login(
    p_username TEXT,
    p_company_name TEXT,
    p_session_id TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_uid UUID;
    v_tenant UUID;
BEGIN
    SELECT u.id INTO v_uid
    FROM auth_users u
    WHERE u.username = p_username
      AND u.company_name = p_company_name
    LIMIT 1;

    IF FOUND AND v_uid IS NOT NULL THEN
        SELECT aut.tenant_id INTO v_tenant
        FROM auth_user_tenant aut
        WHERE aut.user_id = v_uid
        ORDER BY aut.is_default DESC NULLS LAST
        LIMIT 1;
    END IF;

    PERFORM fn_audit_context_set(v_tenant, v_uid, p_username, p_session_id);
END;
$$;

COMMENT ON FUNCTION fn_audit_context_from_login IS
    'Usar desde backend C++ antes de UPDATE/INSERT auditados: resuelve UUID real en BD.';

COMMIT;
