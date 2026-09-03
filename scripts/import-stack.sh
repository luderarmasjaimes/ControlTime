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
#      -- con INCLUDE_DB=1 (default), esto YA hace `docker compose up -d`
#      completo, levanta db_replica y provisiona el rol dashboard_ro
#      (2026-09-02: antes eran los pasos 3-4 manuales de acá, fáciles de
#      saltarse -- sin ellos, los endpoints que leen de la réplica fallan
#      con 500 "db_unavailable" sin dejar rastro en logs).
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

# --- 0. Verificación de integridad (ADR-111) --------------------------------
# Falla ANTES de tocar Docker/BD si algún archivo cambió desde el export --
# un dump corrupto detectado a mitad de pg_restore ya dejó el volumen en
# estado intermedio; acá se corta antes de empezar.
if [[ -f "$IMPORT_DIR/checksums.sha256" ]]; then
  echo "[import] verificando checksums.sha256..."
  if ! (cd "$IMPORT_DIR" && sha256sum -c checksums.sha256 --quiet); then
    echo "[import] ERROR: VERIFICACION DE INTEGRIDAD FALLO -- archivo(s) modificado(s) o corrupto(s) desde el export. Import abortado antes de tocar Docker/BD." >&2
    exit 1
  fi
  echo "[import] checksums OK."
else
  echo "[import] AVISO: no hay checksums.sha256 en $IMPORT_DIR (export generado antes de este cambio, o export sin artefactos) -- se importa SIN verificar integridad." >&2
fi

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
    # El .tar.gz se copia PRIMERO adentro del contenedor con `docker cp`
    # (transferencia atómica) y recién ahí se extrae -- nunca leyendo
    # directo desde la carpeta del host vía bind mount. Mismo criterio que
    # import-stack.ps1.
    helper_name="beemetry-import-${vol}-$$"
    docker create --name "$helper_name" -v "${full_vol}:/to" \
      alpine sh -c "rm -rf /to/* /to/..?* /to/.[!.]* 2>/dev/null; tar xzf /tmp/$(basename "$tarball") -C /to" >/dev/null
    docker cp "$tarball" "${helper_name}:/tmp/$(basename "$tarball")"
    docker start -a "$helper_name"
    docker rm -f "$helper_name" >/dev/null
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

  # --- 4. Levantar el resto del stack (incl. db_replica) y provisionar
  #     dashboard_ro -- confirmado en vivo 2026-09-02: sin esto, el rol
  #     dashboard_ro no existe en el destino (los roles son objetos de
  #     CLUSTER, no de base de datos -- pg_dump/pg_restore de sensors_db
  #     NUNCA los incluye), BEEMETRY_REPLICA_DATABASE_URL falla el login
  #     contra db_replica, y los endpoints que leen de la réplica (wizard de
  #     telemetría, KPIs) devuelven 500 "db_unavailable" SIN dejar ningún
  #     rastro en logs (es un return controlado en el handler, no una
  #     excepción). Antes era el paso manual "3" de la cabecera de este
  #     archivo (fácil de saltarse); ahora es parte del import. Fail-soft
  #     (avisa y sigue) porque ya se restauró lo importante -- no vale la
  #     pena abortar todo el import por esto.
  echo "[import] levantando el resto del stack (incl. db_replica)..."
  docker compose up -d || echo "[import] AVISO: 'docker compose up -d' devolvió errores -- revisá la salida arriba." >&2

  echo "[import] esperando a que db_replica esté healthy..."
  replica_cid="$(docker compose ps -q db_replica 2>/dev/null || true)"
  if [[ -n "$replica_cid" ]]; then
    for _ in $(seq 1 40); do
      status="$(docker inspect --format='{{.State.Health.Status}}' "$replica_cid" 2>/dev/null || echo unknown)"
      [[ "$status" == "healthy" ]] && break
      sleep 3
    done
    [[ "$status" != "healthy" ]] && echo "[import] AVISO: db_replica no llegó a 'healthy' tras 2 min -- dashboard_ro puede tardar en poder leer de ahí." >&2

    echo "[import] provisionando rol dashboard_ro (lectura de réplica)..."
    if bash "$REPO_ROOT/scripts/provision-dashboard-ro.sh"; then
      echo "[import] dashboard_ro OK. Reiniciando 'web' para que tome la réplica..."
      docker compose up -d --force-recreate web
    else
      echo "[import] AVISO: provisión de dashboard_ro falló -- correr scripts/provision-dashboard-ro.sh a mano y revisar la salida." >&2
    fi
  else
    echo "[import] AVISO: no encuentro el contenedor db_replica -- saltando provisión de dashboard_ro, correr scripts/provision-dashboard-ro.sh a mano cuando esté arriba." >&2
  fi
else
  echo "[import] saltando bases de datos (INCLUDE_DB=0 o carpeta ausente)."
fi

echo "[import] Listo."
echo "[import] Verificar con: docker compose exec db psql -U sensors -d sensors_db -c 'SELECT * FROM auth_password_algo_status;'"
