-- ============================================================================
-- 37_adr030_hash_chain_auth_audit_tables.sql
-- Cierra el hueco real restante de ADR-030: `auth_audit_logs` (login) y
-- `auth_user_maintenance_audit` (cambios de permisos/estado de usuario) son
-- exactamente las 2 categorías que el propio ADR-030 nombra explícitamente
-- ("login, cambios de permisos, ...") pero que quedaron en tablas propias
-- SIN la protección append-only + hash encadenado que sí tiene
-- `platform_audit_log` desde el script 31. Mismo patrón, replicado por
-- tabla (no se consolida en platform_audit_log para no tocar los endpoints
-- de lectura ya verificados con IDOR-fix: GET /api/auth/audit,
-- /api/auth/audit/export.csv, /api/auth/users/maintenance/audit).
--
-- Fuera de alcance deliberado (no es un hueco real, ver ADR-030 texto): la
-- ingesta de telemetría de alto volumen (telemetry_raw/mining_sensor_history)
-- NO es una "acción sensible" en el sentido del ADR (login/permisos/
-- workflow/firma/refresh/export/acceso a dato sensible) — es dato de
-- máquina, no una acción de usuario; auditar cada INSERT de telemetría a
-- ~10k lecturas/seg generaría más filas de auditoría que datos reales,
-- contradiciendo el propósito forense de la tabla.
--
-- Prerrequisitos: 03 (auth_audit_logs), 16 (auth_user_maintenance_audit
-- vive en auth_storage_pg.cpp::ensureAuthSchemaPg, ya aplicado en runtime),
-- pgcrypto (ya usado, ver 31).
-- Idempotente: seguro de re-ejecutar. El backfill de cada tabla corre ANTES
-- de crear el trigger que bloquea UPDATE/DELETE (si no, el propio backfill
-- quedaría bloqueado por el trigger que acaba de crear).
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) auth_audit_logs (login: éxito/fallo, rate-limit, etc.)
-- ---------------------------------------------------------------------------
ALTER TABLE auth_audit_logs
    ADD COLUMN IF NOT EXISTS prev_hash TEXT,
    ADD COLUMN IF NOT EXISTS row_hash  TEXT;

CREATE OR REPLACE FUNCTION trg_fn_auth_audit_logs_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_prev_hash TEXT;
BEGIN
    SELECT row_hash INTO v_prev_hash
    FROM auth_audit_logs
    ORDER BY id DESC
    LIMIT 1;

    NEW.prev_hash := COALESCE(v_prev_hash, repeat('0', 64));
    NEW.row_hash := encode(
        digest(
            NEW.prev_hash || '|' ||
            COALESCE(NEW.event_time::text, '') || '|' ||
            COALESCE(NEW.event_action, '') || '|' ||
            COALESCE(NEW.company_name, '') || '|' ||
            COALESCE(NEW.username, '') || '|' ||
            COALESCE(NEW.success::text, '') || '|' ||
            COALESCE(NEW.detail, ''),
            'sha256'
        ),
        'hex'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_audit_logs_hash_chain ON auth_audit_logs;
CREATE TRIGGER trg_auth_audit_logs_hash_chain
    BEFORE INSERT ON auth_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_auth_audit_logs_hash_chain();

-- Backfill de filas históricas (antes del trigger de bloqueo de abajo, o el
-- propio backfill quedaría rechazado). Solo toca filas con row_hash IS NULL
-- — no-op en re-ejecuciones.
DO $$
DECLARE
    r RECORD;
    v_prev_hash TEXT;
    v_row_hash TEXT;
BEGIN
    SELECT row_hash INTO v_prev_hash
    FROM auth_audit_logs
    WHERE row_hash IS NOT NULL
    ORDER BY id DESC
    LIMIT 1;
    v_prev_hash := COALESCE(v_prev_hash, repeat('0', 64));

    FOR r IN
        SELECT * FROM auth_audit_logs
        WHERE row_hash IS NULL
        ORDER BY id ASC
    LOOP
        v_row_hash := encode(
            digest(
                v_prev_hash || '|' ||
                COALESCE(r.event_time::text, '') || '|' ||
                COALESCE(r.event_action, '') || '|' ||
                COALESCE(r.company_name, '') || '|' ||
                COALESCE(r.username, '') || '|' ||
                COALESCE(r.success::text, '') || '|' ||
                COALESCE(r.detail, ''),
                'sha256'
            ),
            'hex'
        );
        UPDATE auth_audit_logs
        SET prev_hash = v_prev_hash, row_hash = v_row_hash
        WHERE id = r.id;
        v_prev_hash := v_row_hash;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_auth_audit_logs_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'auth_audit_logs es append-only: % no está permitido (id=%)',
        TG_OP, COALESCE(OLD.id, NEW.id)
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_audit_logs_block_mutation ON auth_audit_logs;
CREATE TRIGGER trg_auth_audit_logs_block_mutation
    BEFORE UPDATE OR DELETE ON auth_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_auth_audit_logs_block_mutation();

REVOKE UPDATE, DELETE ON auth_audit_logs FROM PUBLIC;

CREATE OR REPLACE FUNCTION fn_auth_audit_logs_verify_chain(p_limit INT DEFAULT NULL)
RETURNS TABLE(id BIGINT, ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_expected_hash TEXT;
    v_prev_hash TEXT := repeat('0', 64);
BEGIN
    FOR r IN
        SELECT * FROM auth_audit_logs
        ORDER BY id ASC
        LIMIT COALESCE(p_limit, 2147483647)
    LOOP
        v_expected_hash := encode(
            digest(
                v_prev_hash || '|' ||
                COALESCE(r.event_time::text, '') || '|' ||
                COALESCE(r.event_action, '') || '|' ||
                COALESCE(r.company_name, '') || '|' ||
                COALESCE(r.username, '') || '|' ||
                COALESCE(r.success::text, '') || '|' ||
                COALESCE(r.detail, ''),
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

-- ---------------------------------------------------------------------------
-- 2) auth_user_maintenance_audit (bloqueo/reset/cambio de rol de usuario)
-- ---------------------------------------------------------------------------
ALTER TABLE auth_user_maintenance_audit
    ADD COLUMN IF NOT EXISTS prev_hash TEXT,
    ADD COLUMN IF NOT EXISTS row_hash  TEXT;

CREATE OR REPLACE FUNCTION trg_fn_auth_user_maint_audit_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_prev_hash TEXT;
BEGIN
    SELECT row_hash INTO v_prev_hash
    FROM auth_user_maintenance_audit
    ORDER BY id DESC
    LIMIT 1;

    NEW.prev_hash := COALESCE(v_prev_hash, repeat('0', 64));
    NEW.row_hash := encode(
        digest(
            NEW.prev_hash || '|' ||
            COALESCE(NEW.event_time::text, '') || '|' ||
            COALESCE(NEW.company_name, '') || '|' ||
            COALESCE(NEW.success::text, '') || '|' ||
            COALESCE(NEW.action, '') || '|' ||
            COALESCE(NEW.operator_username, '') || '|' ||
            COALESCE(NEW.target_username, '') || '|' ||
            COALESCE(NEW.security_method, '') || '|' ||
            COALESCE(NEW.detail, '') || '|' ||
            COALESCE(NEW.additional::text, ''),
            'sha256'
        ),
        'hex'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_maint_audit_hash_chain ON auth_user_maintenance_audit;
CREATE TRIGGER trg_auth_user_maint_audit_hash_chain
    BEFORE INSERT ON auth_user_maintenance_audit
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_auth_user_maint_audit_hash_chain();

-- Backfill (antes del trigger de bloqueo, mismo motivo que en 1)).
DO $$
DECLARE
    r RECORD;
    v_prev_hash TEXT;
    v_row_hash TEXT;
BEGIN
    SELECT row_hash INTO v_prev_hash
    FROM auth_user_maintenance_audit
    WHERE row_hash IS NOT NULL
    ORDER BY id DESC
    LIMIT 1;
    v_prev_hash := COALESCE(v_prev_hash, repeat('0', 64));

    FOR r IN
        SELECT * FROM auth_user_maintenance_audit
        WHERE row_hash IS NULL
        ORDER BY id ASC
    LOOP
        v_row_hash := encode(
            digest(
                v_prev_hash || '|' ||
                COALESCE(r.event_time::text, '') || '|' ||
                COALESCE(r.company_name, '') || '|' ||
                COALESCE(r.success::text, '') || '|' ||
                COALESCE(r.action, '') || '|' ||
                COALESCE(r.operator_username, '') || '|' ||
                COALESCE(r.target_username, '') || '|' ||
                COALESCE(r.security_method, '') || '|' ||
                COALESCE(r.detail, '') || '|' ||
                COALESCE(r.additional::text, ''),
                'sha256'
            ),
            'hex'
        );
        UPDATE auth_user_maintenance_audit
        SET prev_hash = v_prev_hash, row_hash = v_row_hash
        WHERE id = r.id;
        v_prev_hash := v_row_hash;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_auth_user_maint_audit_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'auth_user_maintenance_audit es append-only: % no está permitido (id=%)',
        TG_OP, COALESCE(OLD.id, NEW.id)
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_maint_audit_block_mutation ON auth_user_maintenance_audit;
CREATE TRIGGER trg_auth_user_maint_audit_block_mutation
    BEFORE UPDATE OR DELETE ON auth_user_maintenance_audit
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_auth_user_maint_audit_block_mutation();

REVOKE UPDATE, DELETE ON auth_user_maintenance_audit FROM PUBLIC;

CREATE OR REPLACE FUNCTION fn_auth_user_maint_audit_verify_chain(p_limit INT DEFAULT NULL)
RETURNS TABLE(id BIGINT, ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_expected_hash TEXT;
    v_prev_hash TEXT := repeat('0', 64);
BEGIN
    FOR r IN
        SELECT * FROM auth_user_maintenance_audit
        ORDER BY id ASC
        LIMIT COALESCE(p_limit, 2147483647)
    LOOP
        v_expected_hash := encode(
            digest(
                v_prev_hash || '|' ||
                COALESCE(r.event_time::text, '') || '|' ||
                COALESCE(r.company_name, '') || '|' ||
                COALESCE(r.success::text, '') || '|' ||
                COALESCE(r.action, '') || '|' ||
                COALESCE(r.operator_username, '') || '|' ||
                COALESCE(r.target_username, '') || '|' ||
                COALESCE(r.security_method, '') || '|' ||
                COALESCE(r.detail, '') || '|' ||
                COALESCE(r.additional::text, ''),
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

COMMIT;
