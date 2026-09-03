#!/usr/bin/env bash
# ==========================================================================
# apply_migrations.sh — Runner de migraciones versionadas para db_scripts/.
#   ADR-131: cierra el gap de que 30+ scripts nunca estuvieron cableados en
#   docker-entrypoint-initdb.d (docker-compose.yml) -- un despliegue desde
#   volumen vacio no reproducia el esquema actual completo.
#
# Recorre db_scripts/*.sql en orden numerico (prefijo del nombre de archivo).
# Para cada uno, calcula sha256 y consulta schema_migrations:
#   - No registrado            -> aplica (o solo registra, en --record-only)
#   - Registrado, mismo hash   -> omite
#   - Registrado, hash distinto -> ERROR (un script ya aplicado no debe
#     editarse retroactivamente; crear un script nuevo numerado en su lugar)
#
# Modos:
#   ./scripts/apply_migrations.sh                # aplica pendientes de verdad
#   ./scripts/apply_migrations.sh --record-only   # SOLO registra checksums,
#     sin ejecutar el contenido -- usar UNA vez para establecer el baseline
#     de una base de datos que ya tiene estos scripts aplicados por otra via
#     (initdb.d o manualmente). Varios scripts legacy son TRUNCATE+reseed:
#     volver a ejecutarlos de verdad en una BD con datos reales borraria
#     datos -- por eso el baseline existe como modo separado y explicito.
#
# Conexion via variables de entorno estandar de libpq: PGHOST, PGPORT,
# PGUSER, PGPASSWORD, PGDATABASE. Pensado para correr tanto desde el host
# (con PGHOST=localhost si el puerto esta expuesto, o via el servicio
# db-migrate de docker-compose.yml con PGHOST=db dentro de la red interna).
# ==========================================================================
set -euo pipefail

SCRIPTS_DIR="${SCRIPTS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../db_scripts" && pwd)}"
RECORD_ONLY=0
if [[ "${1:-}" == "--record-only" ]]; then
  RECORD_ONLY=1
fi

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
applied_count=0
skipped_count=0

for f in "$SCRIPTS_DIR"/*.sql; do
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

  if [[ "$RECORD_ONLY" == "1" ]]; then
    echo "[migrate] [record-only] Registrando ${base} (version ${version}) sin ejecutar..."
  else
    echo "[migrate] Aplicando ${base} (version ${version})..."
    psql -v ON_ERROR_STOP=1 -f "$f"
  fi

  psql -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO schema_migrations (version, filename, checksum) VALUES (${version}, '${base}', '${checksum}')"
  applied_count=$((applied_count + 1))
done

if [[ "$RECORD_ONLY" == "1" ]]; then
  action_word="registrado(s)"
else
  action_word="aplicado(s)"
fi
echo "[migrate] Listo: ${applied_count} script(s) ${action_word}, ${skipped_count} ya al dia."
