-- ============================================================================
-- 101 — auth_users.is_active pasa a columna GENERATED derivada de account_status (ADR-191)
-- ============================================================================
-- Hallazgo real (sesión 2026-09-16, usuario 09637521/ALPAYANA): login y
-- refresh validaban DOS columnas independientes de auth_users --
-- loginPasswordPg() solo lee account_status (active/blocked/suspended/
-- deleted, con mensaje propio por estado), findValidRefreshTokenUserPg()
-- solo lee is_active (boolean). Nada en backend/src escribe is_active=false
-- -- quien sí lo hacía era scripts/delete-company-users-docker.ps1, una
-- herramienta de ops que actualiza esa columna directo por SQL, totalmente
-- al margen del único endpoint de administración real
-- (POST /api/auth/users/maintenance, que solo escribe account_status). El
-- resultado: una cuenta con account_status='active' pero is_active=false
-- pasaba el login (200 OK, tokens emitidos) y moría en el primer refresh
-- con "invalid_or_expired_refresh_token" -- un cierre de sesión silencioso,
-- sin código de error, segundos después de un login aparentemente exitoso.
--
-- Fix estructural (no solo el dato): en vez de mantener dos columnas
-- sincronizadas "a mano" en cada write path presente y futuro, is_active
-- deja de ser una columna con estado propio y pasa a ser GENERATED ALWAYS
-- AS (...) STORED a partir de account_status. A partir de aquí:
--   * account_status es la ÚNICA fuente de verdad escribible.
--   * is_active se recalcula solo, siempre en sync, para TODA fila
--     existente en el momento de este ALTER (autocura la fila encontrada
--     hoy y cualquier otra con el mismo drift).
--   * Postgres RECHAZA cualquier UPDATE directo a is_active de aquí en
--     adelante ("column is_active can only be updated to DEFAULT") --
--     convierte la clase entera de bug (un script o un psql manual que
--     toca is_active sin tocar account_status) en un error inmediato y
--     ruidoso en el momento de la escritura, no en un drift silencioso que
--     solo se nota cuando un usuario reporta que "no puede entrar".
--
-- La expresión replica EXACTAMENTE la condición de aceptación que ya usa
-- loginPasswordPg (auth_storage_pg.cpp): rechaza solo si account_status es
-- una cadena no vacía distinta de 'active' -- así que NULL/'' (filas
-- legadas previas a la migración que añadió la columna) siguen
-- comportándose como "activa", igual que hoy en el login.
--
-- findValidRefreshTokenUserPg() NO necesita cambios: sigue leyendo
-- "u.is_active = true" tal cual, y ahora esa lectura es correcta por
-- construcción. trg_fn_audit_auth_users_sensitive tampoco necesita
-- cambios: los triggers ven columnas GENERATED STORED ya calculadas en
-- NEW, así que "is_active_changed" en el audit log sigue funcionando,
-- y ahora refleja fielmente cualquier cambio real de account_status.

-- Idempotente a propósito (mismo criterio que 33/34, ver RUNBOOK.md #5):
-- seguro de re-ejecutar en un entorno donde ya se aplicó. `attgenerated`
-- ('s' = STORED generated) es como Postgres marca la columna una vez
-- convertida; si ya está en ese estado, el DO block no hace nada.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'auth_users'::regclass
          AND attname = 'is_active'
          AND attgenerated = 's'
    ) THEN
        ALTER TABLE auth_users DROP COLUMN is_active;

        ALTER TABLE auth_users ADD COLUMN is_active BOOLEAN
            GENERATED ALWAYS AS (
                COALESCE(account_status, 'active') = 'active'
                OR COALESCE(account_status, 'active') = ''
            ) STORED;
    END IF;
END $$;
