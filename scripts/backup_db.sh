#!/usr/bin/env bash
# ==========================================================================
# backup_db.sh — Backup lógico (pg_dump) de sensors_db + formula, con
#   rotación local. Protege contra ransomware/falla de hardware del VPS
#   único: sin esto, comprometer o perder el host = pérdida total de datos.
#
# Uso:
#   ./scripts/backup_db.sh                # backup + rotación local
#   BACKUP_REMOTE=1 ./scripts/backup_db.sh  # además sincroniza con rclone
#
# Programar por cron en la VPS, ej. diario a las 03:00:
#   0 3 * * * cd /ruta/al/repo && ./scripts/backup_db.sh >> /var/log/aurixa-backup.log 2>&1
#
# El destino remoto (rclone) NO se configura aquí — requiere que el usuario
# defina su propio remote (`rclone config`) apuntando a almacenamiento fuera
# de este VPS (otro proveedor/región). Sin backup offsite, un ransomware que
# cifre el disco del VPS también cifra los backups locales.
# ==========================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_CONTAINER="${DB_CONTAINER:-beemetry-db}"
FORMULA_DB_CONTAINER="${FORMULA_DB_CONTAINER:-beemetry-formula-db}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"

echo "[backup] $(date -u -Iseconds) — iniciando backup lógico"

echo "[backup] pg_dump sensors_db (${DB_CONTAINER})..."
docker exec "$DB_CONTAINER" pg_dump -U sensors -d sensors_db --format=custom \
  > "$BACKUP_DIR/sensors_db_${TIMESTAMP}.dump"

if docker ps --format '{{.Names}}' | grep -qx "$FORMULA_DB_CONTAINER"; then
  echo "[backup] pg_dump formula (${FORMULA_DB_CONTAINER})..."
  docker exec "$FORMULA_DB_CONTAINER" pg_dump -U formula -d formula --format=custom \
    > "$BACKUP_DIR/formula_db_${TIMESTAMP}.dump"
fi

echo "[backup] Rotando backups locales > ${RETENTION_DAYS} días..."
find "$BACKUP_DIR" -name '*.dump' -mtime "+${RETENTION_DAYS}" -print -delete

if [[ "${BACKUP_REMOTE:-0}" == "1" ]]; then
  : "${RCLONE_REMOTE:?Definir RCLONE_REMOTE (ej. mi-remote:aurixa-backups) para BACKUP_REMOTE=1}"
  echo "[backup] Sincronizando ${BACKUP_DIR} -> ${RCLONE_REMOTE} ..."
  rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" --exclude '*.tmp'
fi

echo "[backup] Listo: $(ls -1 "$BACKUP_DIR"/*"${TIMESTAMP}"* 2>/dev/null | wc -l) archivo(s) generado(s)."
