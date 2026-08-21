#!/usr/bin/env bash
# ==========================================================================
# import-stack.sh — Restaura lo generado por export-stack.sh en una máquina
#   nueva: carga las imágenes Docker, restaura los volúmenes con nombre y
#   hace pg_restore de las bases. Complementa (no reemplaza) los pasos
#   manuales de MIGRACION_NUEVA_LAPTOP_2026-08-12.md §3-4 (.env, certs/,
#   dermalog-sdk/, biometric-models/, data/) -- esos hay que copiarlos
#   aparte, este script no los toca.
#
# Uso:
#   IMPORT_DIR=/mnt/usb/beemetry/20260813T140000Z ./scripts/import-stack.sh
#   INCLUDE_IMAGES=0 IMPORT_DIR=... ./scripts/import-stack.sh   # saltar imágenes
#
# Orden recomendado en la máquina nueva:
#   1. Copiar .env, certs/, dermalog-sdk/, biometric-models/, data/ (manual).
#   2. ./scripts/import-stack.sh IMPORT_DIR=<carpeta del export>
#   3. ./scripts/provision-dashboard-ro.sh
#   4. docker compose up -d
#
# Requiere: Docker en PATH, y que docker-compose.yml del repo destino
#   coincida (mismo nombre de proyecto) con el que generó el export --
#   si no, los volúmenes se restauran con el nombre <project>_<vol> actual.
# ==========================================================================
set -euo pipefail

# Git Bash (MSYS) reescribe rutas tipo /d/foo en argumentos de comandos
# nativos de Windows -- rompe silenciosamente el "host:container" de
# `docker run -v`. No-op en Linux/macOS real.
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

: "${IMPORT_DIR:?Definir IMPORT_DIR=<carpeta generada por export-stack.sh>}"
if [[ ! -f "$IMPORT_DIR/manifest.txt" ]]; then
  echo "[import] ERROR: no encuentro manifest.txt en $IMPORT_DIR -- ¿es una carpeta de export-stack.sh?" >&2
  exit 1
fi

INCLUDE_IMAGES="${INCLUDE_IMAGES:-1}"
INCLUDE_VOLUMES="${INCLUDE_VOLUMES:-1}"
INCLUDE_DB="${INCLUDE_DB:-1}"
DB_CONTAINER="${DB_CONTAINER:-beemetry-db}"
FORMULA_DB_CONTAINER="${FORMULA_DB_CONTAINER:-beemetry-formula-db}"

echo "[import] origen: $IMPORT_DIR"
echo "[import] manifiesto:"
sed 's/^/[import]   /' "$IMPORT_DIR/manifest.txt"

# --- 1. Imágenes ------------------------------------------------------------
if [[ "$INCLUDE_IMAGES" == "1" && -d "$IMPORT_DIR/images" ]]; then
  shopt -s nullglob
  for tarball in "$IMPORT_DIR"/images/*.tar.gz; do
    echo "[import] cargando $(basename "$tarball") ..."
    gunzip -c "$tarball" | docker load
  done
  shopt -u nullglob
else
  echo "[import] saltando imágenes (INCLUDE_IMAGES=0 o carpeta ausente)."
fi

# --- 2. Volúmenes (crear si no existen + extraer tar.gz adentro) ----------
if [[ "$INCLUDE_VOLUMES" == "1" && -d "$IMPORT_DIR/volumes" ]]; then
  PROJECT_NAME="$(basename "$REPO_ROOT")"
  shopt -s nullglob
  for tarball in "$IMPORT_DIR"/volumes/*.tar.gz; do
    vol="$(basename "$tarball" .tar.gz)"
    full_vol="${PROJECT_NAME}_${vol}"
    echo "[import] restaurando volumen ${full_vol} desde $(basename "$tarball") ..."
    docker volume create "$full_vol" >/dev/null
    docker run --rm \
      -v "${full_vol}:/to" \
      -v "$IMPORT_DIR/volumes:/from:ro" \
      alpine sh -c "rm -rf /to/* /to/..?* /to/.[!.]* 2>/dev/null; tar xzf /from/$(basename "$tarball") -C /to"
  done
  shopt -u nullglob
else
  echo "[import] saltando volúmenes (INCLUDE_VOLUMES=0 o carpeta ausente)."
fi

# --- 3. Bases de datos (levantar db/formula_db vacías + pg_restore) -------
if [[ "$INCLUDE_DB" == "1" && -d "$IMPORT_DIR/db" ]]; then
  echo "[import] levantando db/formula_db (volumen vacío -> initdb corre, no molesta)..."
  docker compose up -d db formula_db

  echo "[import] esperando healthcheck..."
  for svc in db formula_db; do
    for _ in $(seq 1 60); do
      cid="$(docker compose ps -q "$svc")"
      status="$(docker inspect --format='{{.State.Health.Status}}' "$cid" 2>/dev/null || echo unknown)"
      [[ "$status" == "healthy" ]] && break
      sleep 3
    done
  done

  if [[ -f "$IMPORT_DIR/db/sensors_db.dump" ]]; then
    # sensors_db corre sobre TimescaleDB: pg_restore --clean genera "ALTER
    # TABLE ONLY ... DROP/ADD CONSTRAINT" sobre las hypertables, y
    # TimescaleDB rechaza el ONLY ahí -- se pierden foreign keys en
    # silencio sin envolver con timescaledb_pre_restore()/post_restore()
    # (mecanismo oficial de backup/restore de TimescaleDB).
    echo "[import] pg_restore sensors_db (con timescaledb_pre_restore)..."
    docker exec "$DB_CONTAINER" psql -U sensors -d sensors_db -c "SELECT timescaledb_pre_restore();"
    docker exec -i "$DB_CONTAINER" pg_restore -U sensors -d sensors_db --clean --if-exists \
      < "$IMPORT_DIR/db/sensors_db.dump"
    docker exec "$DB_CONTAINER" psql -U sensors -d sensors_db -c "SELECT timescaledb_post_restore();"
  fi
  if [[ -f "$IMPORT_DIR/db/formula_db.dump" ]]; then
    echo "[import] pg_restore formula ..."
    docker exec -i "$FORMULA_DB_CONTAINER" pg_restore -U formula -d formula --clean --if-exists \
      < "$IMPORT_DIR/db/formula_db.dump"
  fi
else
  echo "[import] saltando bases de datos (INCLUDE_DB=0 o carpeta ausente)."
fi

echo "[import] Listo."
echo "[import] Siguiente: ./scripts/provision-dashboard-ro.sh && docker compose up -d"
echo "[import] Verificar con: docker compose exec db psql -U sensors -d sensors_db -c 'SELECT * FROM auth_password_algo_status;'"
