#!/usr/bin/env bash
# ==========================================================================
# provision-dashboard-ro.sh — Crea/actualiza el rol dashboard_ro en el
#   PRIMARIO aplicando db_scripts/40_dashboard_ro_role.sql con el password
#   de BEEMETRY_DASHBOARD_RO_PASSWORD (desde el entorno o el .env del repo).
#
# El rol se propaga solo a la réplica (streaming replication). Tras esto,
# el SSE de KPIs (handleLiveKpiSse) deja de caer al primario con las
# credenciales completas de "sensors" y usa la réplica con solo-lectura,
# como el diseño original preveía (RUNBOOK.md §8).
#
# Uso (en el host donde corre docker compose):
#   ./scripts/provision-dashboard-ro.sh
# ==========================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-beemetry-db}"

# Cargar .env del repo si la variable no viene ya del entorno
if [[ -z "${BEEMETRY_DASHBOARD_RO_PASSWORD:-}" && -f "$REPO_ROOT/.env" ]]; then
  BEEMETRY_DASHBOARD_RO_PASSWORD="$(grep -E '^BEEMETRY_DASHBOARD_RO_PASSWORD=' "$REPO_ROOT/.env" | cut -d= -f2-)"
fi
: "${BEEMETRY_DASHBOARD_RO_PASSWORD:?Definir BEEMETRY_DASHBOARD_RO_PASSWORD (en .env o el entorno)}"

echo "[dashboard_ro] Aplicando 40_dashboard_ro_role.sql en ${DB_CONTAINER}..."
docker exec -i "$DB_CONTAINER" psql -U sensors -d sensors_db \
  -v ro_password="'${BEEMETRY_DASHBOARD_RO_PASSWORD}'" \
  -v ON_ERROR_STOP=1 \
  < "$REPO_ROOT/db_scripts/40_dashboard_ro_role.sql"

echo "[dashboard_ro] Verificando login de solo lectura contra la réplica..."
if docker exec -e PGPASSWORD="$BEEMETRY_DASHBOARD_RO_PASSWORD" "$DB_CONTAINER" \
     psql -h db_replica -U dashboard_ro -d sensors_db -tAc \
     "SELECT COUNT(*) FROM mining_runtime_kpis" >/dev/null 2>&1; then
  echo "[dashboard_ro] OK: dashboard_ro puede leer mining_runtime_kpis en la réplica."
else
  echo "[dashboard_ro] AVISO: el rol quedó creado en el primario pero la réplica aún" >&2
  echo "  no respondió (puede tardar unos segundos en replicar, o db_replica está caída)." >&2
  echo "  Reintentar: docker exec -e PGPASSWORD=... ${DB_CONTAINER} psql -h db_replica -U dashboard_ro -d sensors_db -c 'SELECT 1'" >&2
fi

echo "[dashboard_ro] Reiniciar el backend para que el SSE tome la réplica:"
echo "  docker compose up -d --force-recreate web"
