-- ============================================================================
-- 79_schema_migrations_bootstrap.sql
-- ADR-131: tabla de control para scripts/apply_migrations.sh -- cierra el gap
-- de que mas de 30 scripts de db_scripts/ (29-63, 65, 66, 68, 70, 71) nunca
-- estuvieron cableados en docker-entrypoint-initdb.d (docker-compose.yml) y
-- se aplicaron manualmente contra la instancia viva; un despliegue nuevo
-- desde volumen vacio no reproducia el esquema actual completo.
--
-- A partir de aqui, scripts/apply_migrations.sh aplica (o registra, en modo
-- --record-only para el baseline de una BD ya existente) cada db_scripts/*.sql
-- por numero, calculando su checksum -- si un archivo YA registrado cambia de
-- contenido, el runner falla en vez de reaplicarlo silenciosamente (varios
-- scripts legacy son TRUNCATE+reseed, no re-ejecutables de forma segura).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    filename   TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by TEXT NOT NULL DEFAULT current_user
);
