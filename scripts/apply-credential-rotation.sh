#!/usr/bin/env bash
# ==========================================================================
# apply-credential-rotation.sh — Aplica los passwords del .env a bases de
#   datos YA INICIALIZADAS (hardening 2026-07-10, RUNBOOK.md §8).
#
# Por qué existe: POSTGRES_PASSWORD solo se usa en el initdb del PRIMER
# arranque del volumen. Cambiar el .env y hacer `docker compose up -d` sobre
# un volumen db_data existente NO cambia el password real dentro de Postgres
# — el backend/pgbouncer empezarían a fallar auth contra la BD, que sigue
# esperando el password viejo. Este script sincroniza la BD viva con el .env.
#
# MinIO no necesita esto: sus credenciales root son 100% de entorno y un
# `docker compose up -d --force-recreate minio` las toma directamente.
#
# Uso (con los contenedores db corriendo):
#   ./scripts/apply-credential-rotation.sh
#   docker compose rm -sf db_replica && docker volume rm <proyecto>_db_replica_data
#   docker compose up -d
#
# Nota db_replica: OBLIGATORIO re-sincronizarla (los dos comandos de arriba).
# Su primary_conninfo — escrito por pg_basebackup -R dentro del volumen en el
# primer arranque — contiene el password VIEJO de "sensors"; tras el ALTER
# USER la réplica no puede re-autenticar contra el primario y el streaming
# queda roto. Borrar el volumen fuerza un basebackup limpio con el password
# nuevo (la réplica es 100% derivada del primario, no se pierde ningún dato).
# ==========================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-beemetry-db}"
FORMULA_DB_CONTAINER="${FORMULA_DB_CONTAINER:-beemetry-formula-db}"

# Cargar variables faltantes desde .env (sin pisar las ya presentes en entorno)
envval() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then printf '%s' "${!name}"; return; fi
  grep -E "^${name}=" "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2- || true
}

DB_PASS="$(envval BEEMETRY_DB_PASSWORD)"
FORMULA_PASS="$(envval BEEMETRY_FORMULA_DB_PASSWORD)"
[[ -n "$DB_PASS" ]] || { echo "Falta BEEMETRY_DB_PASSWORD (en .env o entorno)" >&2; exit 1; }
[[ -n "$FORMULA_PASS" ]] || { echo "Falta BEEMETRY_FORMULA_DB_PASSWORD (en .env o entorno)" >&2; exit 1; }

# psql -v + :'var' → el literal queda correctamente citado, sin inyección ni
# problemas con caracteres especiales en el password. OJO: la interpolación
# de variables NO funciona con -c (psql lo documenta) — el SQL debe entrar
# por stdin.
echo "[rotate] ALTER USER sensors en ${DB_CONTAINER}..."
echo "ALTER USER sensors WITH PASSWORD :'pw';" | \
  docker exec -i "$DB_CONTAINER" psql -U sensors -d sensors_db \
    -v pw="$DB_PASS" -v ON_ERROR_STOP=1

if docker ps --format '{{.Names}}' | grep -qx "$FORMULA_DB_CONTAINER"; then
  echo "[rotate] ALTER USER formula en ${FORMULA_DB_CONTAINER}..."
  echo "ALTER USER formula WITH PASSWORD :'pw';" | \
    docker exec -i "$FORMULA_DB_CONTAINER" psql -U formula -d formula \
      -v pw="$FORMULA_PASS" -v ON_ERROR_STOP=1
else
  echo "[rotate] AVISO: ${FORMULA_DB_CONTAINER} no está corriendo — rotar formula después." >&2
fi

echo "[rotate] Passwords aplicados en las BD vivas. Recrear los consumidores:"
echo "  docker compose up -d --force-recreate pgbouncer web db_replica formula_engine minio minio_init"
