-- ============================================================================
-- 31_audit_log_append_only_hash_chain.sql
-- Cierra ADR-030: platform_audit_log pasa a ser append-only con integridad
-- forense (hash encadenado tipo blockchain simplificado).
--
-- Contexto del gap detectado (GAP_ANALYSIS_2026-07-04.md):
--   - has_table_privilege('sensors','platform_audit_log','UPDATE') = true
--   - has_table_privilege('sensors','platform_audit_log','DELETE') = true
--   - El rol de conexión del backend (`sensors`) es TAMBIÉN el OWNER de la
--     tabla. En PostgreSQL el owner de una tabla ignora los GRANT/REVOKE de
--     esa misma tabla, así que un simple REVOKE no protege nada aquí. La
--     única protección real y robusta es un trigger BEFORE UPDATE/DELETE
--     que rechace la operación incondicionalmente.
--
-- Puntos de inserción existentes (no requieren cambios, el trigger de hash
-- aplica automáticamente a cualquier INSERT sin importar el origen):
--   - fn_platform_audit_insert()                    (script 16)
--   - trg_fn_audit_reports_row()                    (script 20, trigger en reports)
--   - trg_fn_audit_auth_users_sensitive()            (script 20, trigger en auth_users)
--   - trg_fn_audit_formula_sessions_insert()         (script 20, trigger en formula_sessions)
--
-- Prerrequisitos: 16 (tabla platform_audit_log), pgcrypto (ya usado en el
-- esquema, ver 04_telemetry_schema_v2.sql).
-- Idempotente: seguro de re-ejecutar.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Columnas de la cadena de hash
-- ---------------------------------------------------------------------------
ALTER TABLE platform_audit_log
    ADD COLUMN IF NOT EXISTS prev_hash TEXT,
    ADD COLUMN IF NOT EXISTS row_hash  TEXT;

COMMENT ON COLUMN platform_audit_log.prev_hash IS
    'SHA-256 (hex) de la fila anterior en la cadena; genésis = 64 ceros.';
COMMENT ON COLUMN platform_audit_log.row_hash IS
    'SHA-256 (hex) de esta fila: prev_hash + campos clave. Ver fn_audit_log_verify_chain().';

-- ---------------------------------------------------------------------------
-- 2) Trigger BEFORE INSERT: calcula prev_hash/row_hash automáticamente.
--    Se dispara sin importar qué código haga el INSERT (los 4 puntos
--    listados arriba, o cualquier inserción futura), así que ninguno de
--    ellos necesita conocer ni poblar estas columnas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_audit_log_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_prev_hash TEXT;
BEGIN
    -- id es BIGSERIAL (monotónico) => "la última fila" = MAX(id) ya commiteado
    -- visible para esta transacción. Bajo concurrencia alta, dos INSERTs
    -- concurrentes podrían leer el mismo prev_hash; se acepta (el orden real
    -- de la cadena queda fijado por el id, no por el timestamp), y sirve para
    -- el propósito forense: cualquier alteración posterior de datos rompe la
    -- verificación por fn_audit_log_verify_chain().
    SELECT row_hash INTO v_prev_hash
    FROM platform_audit_log
    ORDER BY id DESC
    LIMIT 1;

    NEW.prev_hash := COALESCE(v_prev_hash, repeat('0', 64));
    NEW.row_hash := encode(
        digest(
            NEW.prev_hash || '|' ||
            COALESCE(NEW.created_at::text, '') || '|' ||
            COALESCE(NEW.tenant_id::text, '') || '|' ||
            COALESCE(NEW.user_id::text, '') || '|' ||
            COALESCE(NEW.username, '') || '|' ||
            COALESCE(NEW.action_type, '') || '|' ||
            COALESCE(NEW.entity_type, '') || '|' ||
            COALESCE(NEW.entity_id, '') || '|' ||
            COALESCE(NEW.detail::text, '') || '|' ||
            COALESCE(NEW.success::text, ''),
            'sha256'
        ),
        'hex'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_hash_chain ON platform_audit_log;
CREATE TRIGGER trg_audit_log_hash_chain
    BEFORE INSERT ON platform_audit_log
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_audit_log_hash_chain();

-- ---------------------------------------------------------------------------
-- 3) Append-only real: bloquear UPDATE/DELETE con un trigger (no con REVOKE,
--    inútil aquí por ownership — ver cabecera). Se aplica a CUALQUIER rol,
--    incluido el owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_audit_log_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'platform_audit_log es append-only: % no está permitido (id=%)',
        TG_OP, COALESCE(OLD.id, NEW.id)
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_block_mutation ON platform_audit_log;
CREATE TRIGGER trg_audit_log_block_mutation
    BEFORE UPDATE OR DELETE ON platform_audit_log
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_audit_log_block_mutation();

-- Defensa adicional (higiene): revoca explícitamente para cualquier rol no
---owner que se cree en el futuro (auditor read-only, etc). No tiene efecto
-- sobre `sensors` (owner) pero es correcto dejarlo declarado.
REVOKE UPDATE, DELETE ON platform_audit_log FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4) Verificación de integridad de la cadena: recalcula cada hash desde los
--    datos actuales de la fila y compara contra el row_hash almacenado. Si
--    alguien alterara una fila (p.ej. un superusuario deshabilitando el
--    trigger temporalmente) la fila alterada y TODAS las posteriores dejan
--    de verificar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_log_verify_chain(p_limit INT DEFAULT NULL)
RETURNS TABLE(id BIGINT, ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_expected_hash TEXT;
    v_prev_hash TEXT := repeat('0', 64);
BEGIN
    FOR r IN
        SELECT * FROM platform_audit_log
        ORDER BY id ASC
        LIMIT COALESCE(p_limit, 2147483647)
    LOOP
        v_expected_hash := encode(
            digest(
                v_prev_hash || '|' ||
                COALESCE(r.created_at::text, '') || '|' ||
                COALESCE(r.tenant_id::text, '') || '|' ||
                COALESCE(r.user_id::text, '') || '|' ||
                COALESCE(r.username, '') || '|' ||
                COALESCE(r.action_type, '') || '|' ||
                COALESCE(r.entity_type, '') || '|' ||
                COALESCE(r.entity_id, '') || '|' ||
                COALESCE(r.detail::text, '') || '|' ||
                COALESCE(r.success::text, ''),
                'sha256'
            ),
            'hex'
        );

        IF r.prev_hash IS DISTINCT FROM v_prev_hash THEN
            id := r.id; ok := FALSE;
            reason := 'prev_hash no coincide con el hash de la fila anterior';
            RETURN NEXT;
        ELSIF r.row_hash IS DISTINCT FROM v_expected_hash THEN
            id := r.id; ok := FALSE;
            reason := 'row_hash no coincide con los datos actuales (posible manipulación)';
            RETURN NEXT;
        ELSE
            id := r.id; ok := TRUE; reason := NULL;
            RETURN NEXT;
        END IF;

        v_prev_hash := r.row_hash;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION fn_audit_log_verify_chain(INT) IS
    'Verifica la cadena de hash de platform_audit_log. Uso: '
    'SELECT * FROM fn_audit_log_verify_chain() WHERE NOT ok;  -- vacío = íntegra';

COMMIT;
