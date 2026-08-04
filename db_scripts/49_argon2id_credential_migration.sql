-- ---------------------------------------------------------------------------
-- 49_argon2id_credential_migration.sql
-- Auditoría de seguridad 2026-08-02 — migración de credenciales a Argon2id.
-- ---------------------------------------------------------------------------
-- La migración de datos NO se hace aquí: envolver un hash legado requiere
-- calcular Argon2id, que vive en el backend C++ (libargon2). La ejecuta
-- `auth::migrateLegacyPasswordHashesPg()` al arrancar `beemetry_backend`, de
-- forma idempotente.
--
-- Este script aporta lo que SQL sí puede dar: una vista de convergencia para
-- auditar el estado sin abrir la tabla de credenciales, y la restricción que
-- impide que vuelva a entrar un hash legado por una vía nueva.
--
-- Los tres estados posibles de `auth_users.password_hash`:
--
--   'legacy'   std::hash de 64 bits con salt fijo. Equivale a contraseña en
--              claro frente a un volcado de la BD. Debe ser 0 tras el primer
--              arranque del backend con este cambio.
--   'wrapped'  Argon2id(hash_legado), prefijo 'legacy1:'. Ya no es atacable
--              offline. Converge a 'argon2id' en el próximo login del usuario.
--   'argon2id' Argon2id(contraseña) auténtico. Estado final.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE VIEW auth_password_algo_status AS
SELECT
    CASE
        WHEN password_hash LIKE '$argon2id$%' THEN 'argon2id'
        WHEN password_hash LIKE 'legacy1:%'   THEN 'wrapped'
        ELSE 'legacy'
    END                                             AS algo,
    COUNT(*)                                        AS usuarios,
    ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct
FROM auth_users
GROUP BY 1
ORDER BY 1;

COMMENT ON VIEW auth_password_algo_status IS
    'Convergencia de la migración a Argon2id (auditoría 2026-08-02). '
    'algo=legacy debe ser 0; wrapped baja solo a medida que los usuarios '
    'inician sesión.';

-- Impide que una ruta de escritura nueva reintroduzca un hash legado crudo.
-- NOT VALID: no revalida las filas existentes al aplicarse (la migración del
-- backend puede no haber corrido todavía en este entorno). Validar después con:
--   ALTER TABLE auth_users VALIDATE CONSTRAINT auth_users_password_hash_algo;
ALTER TABLE auth_users
    DROP CONSTRAINT IF EXISTS auth_users_password_hash_algo;
ALTER TABLE auth_users
    ADD CONSTRAINT auth_users_password_hash_algo
    CHECK (password_hash LIKE '$argon2id$%' OR password_hash LIKE 'legacy1:%')
    NOT VALID;

COMMIT;

-- Consulta de verificación (ejecutar tras reiniciar el backend):
--   SELECT * FROM auth_password_algo_status;
-- Resultado esperado inmediato: 0 filas con algo='legacy'.
