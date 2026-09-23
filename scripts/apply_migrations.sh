#!/usr/bin/env bash
# ==========================================================================
# apply_migrations.sh — Runner de migraciones versionadas para db_scripts/.
#   ADR-131: cierra el gap de que 30+ scripts nunca estuvieron cableados en
#   docker-entrypoint-initdb.d (docker-compose.yml) -- un despliegue desde
#   volumen vacio no reproducia el esquema actual completo.
#   ADR-211: rechaza prefijos duplicados; --baseline-through N; seeds de
#   demostracion fuera de este directorio (db_scripts/seeds_dev/).
#
# Recorre db_scripts/*.sql en orden numerico (prefijo del nombre de archivo).
# Para cada uno, calcula sha256 y consulta schema_migrations:
#   - No registrado            -> aplica (o solo registra, en --record-only
#     o si version <= --baseline-through N)
#   - Registrado, mismo hash   -> omite
#   - Registrado, hash distinto -> ERROR (un script ya aplicado no debe
#     editarse retroactivamente; crear un script nuevo numerado en su lugar)
#
# Modos:
#   ./scripts/apply_migrations.sh
#   ./scripts/apply_migrations.sh --record-only
#   ./scripts/apply_migrations.sh --baseline-through 99
#     registra SIN ejecutar hasta la version N (inclusive); aplica de verdad
#     las posteriores. Usar en BD ya saneadas (objetos 82-99 verificados).
#
# Conexion via variables de entorno estandar de libpq: PGHOST, PGPORT,
# PGUSER, PGPASSWORD, PGDATABASE.
# ==========================================================================
set -euo pipefail

SCRIPTS_DIR="${SCRIPTS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../db_scripts" && pwd)}"
RECORD_ONLY=0
BASELINE_THROUGH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --record-only)
      RECORD_ONLY=1
      shift
      ;;
    --baseline-through)
      BASELINE_THROUGH="${2:-}"
      if [[ -z "$BASELINE_THROUGH" || ! "$BASELINE_THROUGH" =~ ^[0-9]+$ ]]; then
        echo "[migrate] ERROR: --baseline-through requiere un entero (ej. 99)." >&2
        exit 1
      fi
      shift 2
      ;;
    --baseline-through=*)
      BASELINE_THROUGH="${1#*=}"
      if [[ ! "$BASELINE_THROUGH" =~ ^[0-9]+$ ]]; then
        echo "[migrate] ERROR: --baseline-through requiere un entero." >&2
        exit 1
      fi
      shift
      ;;
    -h|--help)
      sed -n '2,28p' "$0"
      exit 0
      ;;
    *)
      echo "[migrate] ERROR: argumento desconocido: $1" >&2
      exit 1
      ;;
  esac
done

: "${PGDATABASE:?Definir PGDATABASE (ej. sensors_db)}"
: "${PGUSER:?Definir PGUSER (ej. sensors)}"

echo "[migrate] Asegurando tabla schema_migrations en ${PGDATABASE}..."
psql -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    filename   TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by TEXT NOT NULL DEFAULT current_user
);
SQL

shopt -s nullglob
mapfile -t sql_files < <(ls -1 "$SCRIPTS_DIR"/*.sql 2>/dev/null | sort -V)

# ADR-211: abortar ANTES de tocar la BD si hay prefijos duplicados.
dup_report="$(
  python3 - "$SCRIPTS_DIR" <<'PY'
import os, re, sys
from collections import defaultdict
d = sys.argv[1]
by_ver = defaultdict(list)
for name in os.listdir(d):
    if not name.endswith(".sql"):
        continue
    m = re.match(r"^(\d+)", name)
    if not m:
        continue
    by_ver[int(m.group(1))].append(name)
dups = {k: v for k, v in by_ver.items() if len(v) > 1}
if dups:
    for k in sorted(dups):
        print(f"{k}: {', '.join(sorted(dups[k]))}")
    sys.exit(1)
PY
)" || {
  echo "[migrate] ERROR: prefijo numerico duplicado en ${SCRIPTS_DIR} (ADR-211)." >&2
  echo "$dup_report" >&2
  echo "[migrate]        Mover seeds a db_scripts/seeds_dev/ — no renumerar scripts ya aplicados." >&2
  exit 1
}

applied_count=0
skipped_count=0
baselined_count=0
pending_real=0

for f in "${sql_files[@]}"; do
  base="$(basename "$f")"
  version="$(echo "$base" | grep -oE '^[0-9]+' || true)"
  if [[ -z "$version" ]]; then
    echo "[migrate] omitiendo ${base} (sin prefijo numerico, ej. verify_refactor.sql)"
    continue
  fi
  version=$((10#$version))
  checksum="$(sha256sum "$f" | awk '{print $1}')"

  applied_checksum="$(psql -t -A -v ON_ERROR_STOP=1 \
      -c "SELECT checksum FROM schema_migrations WHERE version = ${version}")"

  if [[ "$applied_checksum" == "$checksum" ]]; then
    skipped_count=$((skipped_count + 1))
    continue
  elif [[ -n "$applied_checksum" ]]; then
    echo "[migrate] ERROR: ${base} (version ${version}) ya fue registrado con OTRO checksum." >&2
    echo "[migrate]        registrado=${applied_checksum}  archivo_actual=${checksum}" >&2
    echo "[migrate]        Un script ya aplicado no debe editarse retroactivamente -- crear un script nuevo numerado." >&2
    exit 1
  fi

  should_record_only="$RECORD_ONLY"
  if [[ -n "$BASELINE_THROUGH" && "$version" -le "$BASELINE_THROUGH" ]]; then
    should_record_only=1
  fi

  if [[ "$should_record_only" == "1" ]]; then
    echo "[migrate] [record-only] Registrando ${base} (version ${version}) sin ejecutar..."
    baselined_count=$((baselined_count + 1))
  else
    echo "[migrate] Aplicando ${base} (version ${version})..."
    psql -v ON_ERROR_STOP=1 -f "$f"
    pending_real=$((pending_real + 1))
  fi

  # filename interpolado: los nombres de script son controlados (solo [0-9A-Za-z_.-])
  psql -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO schema_migrations (version, filename, checksum) VALUES (${version}, '${base}', '${checksum}')"
  applied_count=$((applied_count + 1))
done

ledger_max="$(psql -t -A -v ON_ERROR_STOP=1 -c "SELECT COALESCE(max(version),0)::text FROM schema_migrations")"
ledger_count="$(psql -t -A -v ON_ERROR_STOP=1 -c "SELECT count(*)::text FROM schema_migrations")"

if [[ "$RECORD_ONLY" == "1" ]]; then
  action_word="registrado(s)"
else
  action_word="aplicado(s)/registrado(s)"
fi
echo "[migrate] Listo: ${applied_count} script(s) ${action_word}, ${skipped_count} ya al dia, ${baselined_count} en baseline."
echo "[migrate] Pendientes reales ejecutados en esta pasada: ${pending_real}."
echo "[migrate] Ledger: max(version)=${ledger_max} count=${ledger_count}."
