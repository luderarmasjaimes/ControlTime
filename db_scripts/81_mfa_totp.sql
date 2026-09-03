-- 81_mfa_totp.sql — MFA/TOTP para cuentas (prioritariamente roles admin)
--
-- Contexto: cierre de la ronda de endurecimiento post red-team 2026-08-26/27
-- (ADR-133/134). El fix de ADR-134 evita que un anónimo se autoasigne admin
-- vía registro público, pero una cuenta admin YA legítima sigue protegida
-- solo por contraseña (+ biometría opcional). TOTP (RFC 6238) agrega un
-- segundo factor real: aunque la contraseña se filtre/robe, sin el código de
-- 30s del authenticator la cuenta no se puede tomar.
--
-- Idempotente (mismo patrón que el resto de db_scripts/*.sql de este repo).

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;

-- totp_secret guarda el secreto Base32 en texto plano (no hasheado, a
-- diferencia de password_hash): es intrínseco a TOTP -- el servidor DEBE
-- poder recomputar el código HMAC-SHA1 en cada verificación, no solo
-- comparar un hash. Es el mismo modelo de todo proveedor de TOTP real
-- (Google/Microsoft/Authy backend). La protección viene de que esta
-- columna nunca se expone por ningún endpoint tras el enrolamiento inicial
-- (ver mfa_routes.cpp) y de los controles de acceso ya existentes sobre la
-- tabla completa.
COMMENT ON COLUMN auth_users.totp_secret IS
  'Secreto Base32 TOTP (RFC 6238), en claro -- necesario para recomputar el código en cada verificación. Nunca se expone tras el enrolamiento inicial (ver mfa_routes.cpp).';
COMMENT ON COLUMN auth_users.totp_enabled IS
  'true solo tras el primer código válido post-enrolamiento (evita bloquear la cuenta con un secreto mal escaneado).';
