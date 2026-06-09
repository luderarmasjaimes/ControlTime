#!/usr/bin/env bash
# Aplica el parche idempotente 23 en PostgreSQL del contenedor Docker.
# Uso: desde la raíz del repo: bash scripts/apply-telemetry-db-patch.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$ROOT/db_scripts/23_telemetry_surveillance_safe_update.sql"
test -f "$PATCH" || { echo "Falta $PATCH"; exit 1; }
cd "$ROOT"
echo "Copiando parche SQL al contenedor db..."
docker compose cp "$PATCH" "db:/tmp/23_telemetry_surveillance_safe_update.sql"
echo "Ejecutando parche (ON_ERROR_STOP)..."
docker compose exec -T db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 -f /tmp/23_telemetry_surveillance_safe_update.sql
echo "Parche aplicado correctamente."
