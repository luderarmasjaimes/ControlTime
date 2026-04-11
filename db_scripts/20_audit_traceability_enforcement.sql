-- =============================================================================
-- 20_audit_traceability_enforcement.sql
-- Refuerzo de trazabilidad: contexto de sesión para auditoría, índices de
-- consulta y triggers en tablas de negocio (bajo/medio volumen) hacia
-- platform_audit_log. La telemetría masiva sigue auditándose vía aplicación
-- o jobs, no por trigger por fila.
--
-- Prerrequisitos: 03_auth_biometric, 09_formula_mining_reports, 16 (platform_audit_log),
--                 19 (columnas opcionales en reports — ejecutar 19 antes)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Contexto de auditoría (la API C++ debe llamar al inicio de cada request)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_context_set(
    p_tenant_id UUID,
    p_user_id UUID,
    p_username TEXT,
    p_session_id TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM set_config('app.audit_tenant_id', COALESCE(p_tenant_id::TEXT, ''), TRUE);
    PERFORM set_config('app.audit_user_id', COALESCE(p_user_id::TEXT, ''), TRUE);
    PERFORM set_config('app.audit_username', COALESCE(p_username, ''), TRUE);
    PERFORM set_config('app.audit_session_id', COALESCE(p_session_id, ''), TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION fn_audit_context_clear()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM set_config('app.audit_tenant_id', '', TRUE);
    PERFORM set_config('app.audit_user_id', '', TRUE);
    PERFORM set_config('app.audit_username', '', TRUE);
    PERFORM set_config('app.audit_session_id', '', TRUE);
END;
$$;

COMMENT ON FUNCTION fn_audit_context_set IS
    'Llamar desde backend al abrir transacción/request; is_local=true → válido hasta fin de transacción.';
COMMENT ON FUNCTION fn_audit_context_clear IS
    'Limpia GUC de sesión de auditoría en la transacción actual.';

-- ---------------------------------------------------------------------------
-- Índices para investigación "quién tocó qué entidad"
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_platform_audit_entity_time
    ON platform_audit_log (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_session
    ON platform_audit_log (session_id, created_at DESC)
    WHERE session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Informes: INSERT / UPDATE / DELETE físico (trazabilidad de documento)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_audit_reports_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_user UUID;
    v_tenant UUID;
    v_uname TEXT;
    v_sess TEXT;
    v_content_changed BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_content_changed := OLD.content_json IS DISTINCT FROM NEW.content_json;
        IF NOT v_content_changed
           AND OLD.title IS NOT DISTINCT FROM NEW.title
           AND OLD.status IS NOT DISTINCT FROM NEW.status
           AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
           AND OLD.project_id IS NOT DISTINCT FROM NEW.project_id
           AND OLD.company_name IS NOT DISTINCT FROM NEW.company_name
           AND OLD.tenant_id IS NOT DISTINCT FROM NEW.tenant_id
        THEN
            RETURN NEW;
        END IF;
    END IF;

    BEGIN
        IF current_setting('app.audit_user_id', TRUE) IS NOT NULL
           AND btrim(current_setting('app.audit_user_id', TRUE)) <> '' THEN
            v_user := current_setting('app.audit_user_id', TRUE)::UUID;
        END IF;
    EXCEPTION WHEN invalid_text_representation THEN
        v_user := NULL;
    END;

    v_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
    BEGIN
        IF current_setting('app.audit_tenant_id', TRUE) IS NOT NULL
           AND btrim(current_setting('app.audit_tenant_id', TRUE)) <> '' THEN
            v_tenant := current_setting('app.audit_tenant_id', TRUE)::UUID;
        END IF;
    EXCEPTION WHEN invalid_text_representation THEN
        NULL;
    END;

    v_uname := NULLIF(btrim(COALESCE(current_setting('app.audit_username', TRUE), '')), '');
    v_sess := NULLIF(btrim(COALESCE(current_setting('app.audit_session_id', TRUE), '')), '');

    IF TG_OP = 'UPDATE' THEN
        v_content_changed := OLD.content_json IS DISTINCT FROM NEW.content_json;
    ELSIF TG_OP = 'INSERT' THEN
        v_content_changed := TRUE;
    ELSE
        v_content_changed := FALSE;
    END IF;

    INSERT INTO platform_audit_log (
        tenant_id, user_id, username, session_id,
        action_type, entity_type, entity_id, detail, success
    ) VALUES (
        v_tenant,
        v_user,
        v_uname,
        v_sess,
        TG_OP || '.reports',
        'reports',
        COALESCE(NEW.id, OLD.id)::TEXT,
        jsonb_build_object(
            'op', TG_OP,
            'content_changed', v_content_changed,
            'title', CASE WHEN TG_OP = 'DELETE' THEN OLD.title ELSE NEW.title END,
            'status', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.status END,
            'deleted_at_before', OLD.deleted_at,
            'deleted_at_after', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.deleted_at END
        ),
        TRUE
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_reports_row ON reports;
CREATE TRIGGER trg_audit_reports_row
    AFTER INSERT OR UPDATE OR DELETE ON reports
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_audit_reports_row();

-- ---------------------------------------------------------------------------
-- Usuarios: cambios sensibles (rol, activo, credencial, plantilla facial)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_audit_auth_users_sensitive()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_user UUID;
    v_uname TEXT;
    v_sess TEXT;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF OLD.password_hash IS NOT DISTINCT FROM NEW.password_hash
       AND OLD.role IS NOT DISTINCT FROM NEW.role
       AND OLD.is_active IS NOT DISTINCT FROM NEW.is_active
       AND OLD.face_template IS NOT DISTINCT FROM NEW.face_template
       AND OLD.company_name IS NOT DISTINCT FROM NEW.company_name
       AND OLD.username IS NOT DISTINCT FROM NEW.username
    THEN
        RETURN NEW;
    END IF;

    BEGIN
        IF current_setting('app.audit_user_id', TRUE) IS NOT NULL
           AND btrim(current_setting('app.audit_user_id', TRUE)) <> '' THEN
            v_user := current_setting('app.audit_user_id', TRUE)::UUID;
        END IF;
    EXCEPTION WHEN invalid_text_representation THEN
        v_user := NULL;
    END;

    v_uname := NULLIF(btrim(COALESCE(current_setting('app.audit_username', TRUE), '')), '');
    v_sess := NULLIF(btrim(COALESCE(current_setting('app.audit_session_id', TRUE), '')), '');

    INSERT INTO platform_audit_log (
        tenant_id, user_id, username, session_id,
        action_type, entity_type, entity_id, detail, success
    ) VALUES (
        NULL,
        COALESCE(v_user, NEW.id),
        COALESCE(v_uname, NEW.username),
        v_sess,
        'UPDATE.auth_users_sensitive',
        'auth_users',
        NEW.id::TEXT,
        jsonb_build_object(
            'password_changed', OLD.password_hash IS DISTINCT FROM NEW.password_hash,
            'role_changed', OLD.role IS DISTINCT FROM NEW.role,
            'is_active_changed', OLD.is_active IS DISTINCT FROM NEW.is_active,
            'face_template_changed', OLD.face_template IS DISTINCT FROM NEW.face_template,
            'username_changed', OLD.username IS DISTINCT FROM NEW.username,
            'company_changed', OLD.company_name IS DISTINCT FROM NEW.company_name
        ),
        TRUE
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_auth_users_sensitive ON auth_users;
CREATE TRIGGER trg_audit_auth_users_sensitive
    AFTER UPDATE ON auth_users
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_audit_auth_users_sensitive();

-- ---------------------------------------------------------------------------
-- Sesiones de análisis FORMULA (uso del motor / trazabilidad de consulta)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_audit_formula_sessions_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_sess TEXT;
BEGIN
    v_sess := NULLIF(btrim(COALESCE(current_setting('app.audit_session_id', TRUE), '')), '');

    INSERT INTO platform_audit_log (
        tenant_id, user_id, username, session_id,
        action_type, entity_type, entity_id, detail, success
    ) VALUES (
        NULL,
        NULL,
        NEW.usuario_nombre,
        v_sess,
        'INSERT.formula_sessions',
        'formula_sessions',
        NEW.id::TEXT,
        jsonb_build_object(
            'accion', NEW.accion,
            'empresa_id', NEW.empresa_id,
            'mina_id', NEW.mina_id,
            'variable_id', NEW.variable_id
        ),
        TRUE
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_formula_sessions_insert ON formula_sessions;
CREATE TRIGGER trg_audit_formula_sessions_insert
    AFTER INSERT ON formula_sessions
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_audit_formula_sessions_insert();

COMMIT;
