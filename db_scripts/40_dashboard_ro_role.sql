-- ==========================================================================
-- 40_dashboard_ro_role.sql — Rol de solo lectura para el SSE de KPIs en vivo
--   (hardening 2026-07-10, RUNBOOK.md §8).
--
-- Contexto: BEEMETRY_REPLICA_DATABASE_URL (docker-compose.yml) apunta a la
-- réplica con user=dashboard_ro, pero el rol nunca existió — la conexión
-- fallaba siempre y handleLiveKpiSse (backend/src/main.cpp) caía de vuelta
-- al primario con las credenciales completas de "sensors". Este script crea
-- el rol con el mínimo privilegio real que ese endpoint necesita: SELECT
-- sobre mining_runtime_kpis y nada más.
--
-- El rol se crea en el PRIMARIO y se propaga a la réplica por streaming
-- replication (los roles son datos del catálogo, viajan con el WAL).
--
-- Aplicar con scripts/provision-dashboard-ro.sh (pasa el password desde
-- .env vía psql -v, para no commitear secretos en este archivo):
--   psql -v ro_password="'<valor>'" -f 40_dashboard_ro_role.sql
--
-- Idempotente: re-ejecutar actualiza el password y re-aplica los grants.
-- ==========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_ro') THEN
    CREATE ROLE dashboard_ro LOGIN;
  END IF;
END
$$;

ALTER ROLE dashboard_ro WITH LOGIN PASSWORD :ro_password;

-- Mínimo privilegio: conexión + lectura de la tabla de KPIs pre-calculados.
-- Sin USAGE amplio ni SELECT sobre el resto del esquema (telemetry_raw,
-- reports, auth_*, etc. quedan fuera del alcance de este rol a propósito).
GRANT CONNECT ON DATABASE sensors_db TO dashboard_ro;
GRANT USAGE ON SCHEMA public TO dashboard_ro;
GRANT SELECT ON public.mining_runtime_kpis TO dashboard_ro;

-- Defensa extra: que nunca pueda escribir aunque alguien le agregue grants
-- por accidente vía default privileges de otro rol.
ALTER ROLE dashboard_ro SET default_transaction_read_only = on;
