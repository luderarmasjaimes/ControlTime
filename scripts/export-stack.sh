#!/usr/bin/env bash
# ==========================================================================
# export-stack.sh — Exporta TODO lo que vive dentro de Docker para este
#   proyecto (imágenes construidas/descargadas + volúmenes con nombre +
#   dump lógico de las bases Postgres) a una carpeta autocontenida, lista
#   para copiar a otra máquina y restaurar con import-stack.sh.
#
# Qué SÍ cubre este script (todo lo que Docker gestiona):
#   - Imágenes: las 5 que build-ea este repo (web, frontend, ai_engine,
#     formula_engine, pdf_export) + las 11 que se descargan de Docker Hub/
#     ghcr (timescaledb, postgres, redpanda, minio, mosquitto, mailpit,
#     pgbouncer, mbtileserver, languagetool, ollama).
#   - Volúmenes con nombre: minio_data, insightface_models, ollama_data,
#     diffusion_avatar_cache (SD1.5+ControlNet, ADR-141, ~5GB),
#     avatar_animation_cache + avatar_animation_model_cache (SadTalker +
#     GFPGAN/facexlib, ADR-150) -- estos tres últimos se agregaron
#     2026-09-11, el script no los cubría hasta ahora pese a existir en
#     docker-compose.yml desde antes (brecha real, no intencional).
#     (redpanda_data se omite por defecto -- es buffer de telemetría con
#     retención de 2h, ADR-020, no es un dato que valga la pena preservar).
#   - Bases de datos: pg_dump lógico de sensors_db y formula (más portable
#     y confiable entre versiones/arquitecturas que copiar el volumen
#     crudo de Postgres -- ver MIGRACION_NUEVA_LAPTOP_2026-08-12.md §5).
#   - db_data / db_replica_data / formula_db_data (volúmenes de Postgres)
#     se omiten como volumen crudo a propósito: van cubiertos por el
#     pg_dump de arriba, y db_replica_data se reconstruye solo desde el
#     primario vía streaming replication en el primer arranque.
#
# Qué NO cubre (no es "contenedores", son archivos del host que los
#   contenedores montan -- ver MIGRACION_NUEVA_LAPTOP_2026-08-12.md §3):
#   .env, certs/, dermalog-sdk/, biometric-models/, data/, IMAGENES/*.onnx.
#   Cópialos a mano a las mismas rutas relativas del repo en destino.
#
# Uso:
#   ./scripts/export-stack.sh                       # todo, a ./stack_export/<timestamp>/
#   EXPORT_DIR=/mnt/usb/beemetry ./scripts/export-stack.sh
#   INCLUDE_IMAGES=0 ./scripts/export-stack.sh       # saltar imágenes (son ~25GB+)
#   INCLUDE_VOLUMES=0 ./scripts/export-stack.sh      # saltar minio/insightface/ollama
#   INCLUDE_DB=0 ./scripts/export-stack.sh           # saltar pg_dump
#   INCLUDE_REDPANDA=1 ./scripts/export-stack.sh     # incluir buffer Kafka (normalmente no hace falta)
#
# Requiere: docker compose corriendo (al menos db/formula_db para el
#   pg_dump); Docker en PATH. Espacio: la imagen ai_engine sola pesa
#   ~19GB sin comprimir -- verificá espacio libre antes de correr esto.
# ==========================================================================
set -euo pipefail

# Git Bash (MSYS) reescribe rutas tipo /d/foo en argumentos de comandos
# nativos de Windows -- rompe silenciosamente el "host:container" de
# `docker run -v`. No-op en Linux/macOS real.
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EXPORT_DIR="${EXPORT_DIR:-$REPO_ROOT/stack_export/$TIMESTAMP}"
INCLUDE_IMAGES="${INCLUDE_IMAGES:-1}"
INCLUDE_VOLUMES="${INCLUDE_VOLUMES:-1}"
INCLUDE_DB="${INCLUDE_DB:-1}"
INCLUDE_REDPANDA="${INCLUDE_REDPANDA:-0}"
DB_CONTAINER="${DB_CONTAINER:-beemetry-db}"
FORMULA_DB_CONTAINER="${FORMULA_DB_CONTAINER:-beemetry-formula-db}"

VOLUMES_TO_EXPORT=(minio_data insightface_models ollama_data diffusion_avatar_cache avatar_animation_cache avatar_animation_model_cache)
if [[ "$INCLUDE_REDPANDA" == "1" ]]; then
  VOLUMES_TO_EXPORT+=(redpanda_data)
fi

mkdir -p "$EXPORT_DIR"/{images,volumes,db}
echo "[export] destino: $EXPORT_DIR"

# --- 1. Bases de datos (pg_dump lógico) -----------------------------------
if [[ "$INCLUDE_DB" == "1" ]]; then
  echo "[export] pg_dump sensors_db (${DB_CONTAINER})..."
  docker exec "$DB_CONTAINER" pg_dump -U sensors -d sensors_db --format=custom \
    > "$EXPORT_DIR/db/sensors_db.dump"

  if docker ps --format '{{.Names}}' | grep -qx "$FORMULA_DB_CONTAINER"; then
    echo "[export] pg_dump formula (${FORMULA_DB_CONTAINER})..."
    docker exec "$FORMULA_DB_CONTAINER" pg_dump -U formula -d formula --format=custom \
      > "$EXPORT_DIR/db/formula_db.dump"
  else
    echo "[export] AVISO: ${FORMULA_DB_CONTAINER} no está corriendo, se salta." >&2
  fi
else
  echo "[export] INCLUDE_DB=0, saltando pg_dump."
fi

# --- 2. Volúmenes con nombre (tar.gz vía contenedor helper) ---------------
if [[ "$INCLUDE_VOLUMES" == "1" ]]; then
  for vol in "${VOLUMES_TO_EXPORT[@]}"; do
    full_vol="$(basename "$REPO_ROOT")_${vol}"
    if ! docker volume inspect "$full_vol" >/dev/null 2>&1; then
      # docker compose nombra los volúmenes <project>_<name>; el nombre del
      # proyecto por defecto es el del directorio, pero puede haber sido
      # fijado distinto (COMPOSE_PROJECT_NAME) -- probamos alternativa.
      full_vol="informecliente_${vol}"
    fi
    if ! docker volume inspect "$full_vol" >/dev/null 2>&1; then
      echo "[export] AVISO: volumen '$vol' no encontrado (probé '$(basename "$REPO_ROOT")_${vol}' e 'informecliente_${vol}'), se salta." >&2
      continue
    fi
    echo "[export] volumen $full_vol -> volumes/${vol}.tar.gz ..."
    # tar+gzip DENTRO del contenedor (su propia capa de escritura) y se trae
    # el archivo terminado con `docker cp` -- nunca escribiendo directo a la
    # carpeta del host vía bind mount: en Docker Desktop (WSL2/virtiofs) el
    # puente de archivos con volúmenes grandes puede cortar la escritura a
    # mitad de camino. Mismo criterio que export-stack.ps1.
    helper_name="beemetry-export-${vol}-$$"
    docker run --name "$helper_name" -v "${full_vol}:/from:ro" alpine sh -c "tar czf /tmp/${vol}.tar.gz -C /from ."
    docker cp "${helper_name}:/tmp/${vol}.tar.gz" "$EXPORT_DIR/volumes/${vol}.tar.gz"
    docker rm -f "$helper_name" >/dev/null
  done
else
  echo "[export] INCLUDE_VOLUMES=0, saltando volúmenes."
fi

# --- 3. Imágenes Docker (build + pulled) ----------------------------------
if [[ "$INCLUDE_IMAGES" == "1" ]]; then
  mapfile -t IMAGES < <(docker compose config --images | sort -u)
  for img in "${IMAGES[@]}"; do
    safe_name="$(echo "$img" | tr '/:' '__')"
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      echo "[export] AVISO: imagen '$img' no existe localmente (¿falta build/pull?), se salta." >&2
      continue
    fi
    echo "[export] imagen $img -> images/${safe_name}.tar.gz ..."
    docker save "$img" | gzip -1 > "$EXPORT_DIR/images/${safe_name}.tar.gz"
  done
else
  echo "[export] INCLUDE_IMAGES=0, saltando imágenes."
fi

# --- 4. Manifiesto ----------------------------------------------------------
{
  echo "project=$(basename "$REPO_ROOT")"
  echo "exported_at=$(date -u -Iseconds)"
  echo "git_commit=$(git rev-parse HEAD 2>/dev/null || echo 'sin-git')"
  echo "git_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'sin-git')"
  echo "include_images=$INCLUDE_IMAGES"
  echo "include_volumes=$INCLUDE_VOLUMES"
  echo "include_db=$INCLUDE_DB"
  echo "include_redpanda=$INCLUDE_REDPANDA"
  echo "volumes_exported=${VOLUMES_TO_EXPORT[*]:-}"
} > "$EXPORT_DIR/manifest.txt"

# --- 5. Checksums (ADR-111) --------------------------------------------------
# sha256sum de cada artefacto exportado, formato estándar `sha256sum -c` --
# import-stack.sh lo verifica ANTES de restaurar nada.
(
  cd "$EXPORT_DIR"
  find images volumes db -type f 2>/dev/null | sort | xargs -r sha256sum > checksums.sha256
)
if [[ -s "$EXPORT_DIR/checksums.sha256" ]]; then
  echo "[export] checksums.sha256 escrito ($(wc -l < "$EXPORT_DIR/checksums.sha256") archivos)."
fi

TOTAL_SIZE="$(du -sh "$EXPORT_DIR" 2>/dev/null | cut -f1)"
echo "[export] Listo. Tamaño total: ${TOTAL_SIZE:-desconocido} en $EXPORT_DIR"
echo "[export] RECORDATORIO: .env, certs/, dermalog-sdk/, biometric-models/ y data/"
echo "[export]   NO se exportaron (no son 'contenedores') -- copiarlos a mano."
echo "[export]   Ver MIGRACION_NUEVA_LAPTOP_2026-08-12.md §3 para el detalle completo."
