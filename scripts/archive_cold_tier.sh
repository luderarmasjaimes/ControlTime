#!/usr/bin/env bash
# ==========================================================================
# archive_cold_tier.sh — Archiva chunks >1 año a S3/MinIO (Parquet ZSTD)
#   y los elimina del hypertable. TIER FRÍO.
#
# Patrón: lee de la RÉPLICA (no carga el primario) con DuckDB → Parquet → S3,
#   verifica, luego drop_chunks en el PRIMARIO.
#
# Programar p. ej. semanal (cron / scheduled task).
# ==========================================================================
set -euo pipefail

NET="${DOCKER_NET:-informecliente_default}"
S3_BUCKET="${S3_BUCKET:-telemetry-cold}"
OLDER_THAN="${OLDER_THAN:-1 year}"
: "${BEEMETRY_DASHBOARD_RO_PASSWORD:?Definir BEEMETRY_DASHBOARD_RO_PASSWORD (ver .env.example)}"
: "${BEEMETRY_MINIO_ROOT_USER:?Definir BEEMETRY_MINIO_ROOT_USER (ver .env.example)}"
: "${BEEMETRY_MINIO_ROOT_PASSWORD:?Definir BEEMETRY_MINIO_ROOT_PASSWORD (ver .env.example)}"
REPLICA="host=db_replica port=5432 dbname=sensors_db user=dashboard_ro password=${BEEMETRY_DASHBOARD_RO_PASSWORD}"

echo "[archive] Exportando telemetry_raw < now() - ${OLDER_THAN} a s3://${S3_BUCKET}/ ..."

# 1) Export por mes a Parquet en MinIO (desde la réplica)
docker run --rm --network "$NET" --entrypoint duckdb duckdb/duckdb:latest -c "
INSTALL postgres; LOAD postgres; INSTALL httpfs; LOAD httpfs;
SET s3_endpoint='minio:9000'; SET s3_access_key_id='${BEEMETRY_MINIO_ROOT_USER}';
SET s3_secret_access_key='${BEEMETRY_MINIO_ROOT_PASSWORD}'; SET s3_use_ssl=false; SET s3_url_style='path';
ATTACH '${REPLICA}' AS pg (TYPE postgres, READ_ONLY);
COPY (
  SELECT *, strftime(captured_at, '%Y-%m') AS mes
  FROM pg.public.telemetry_raw
  WHERE captured_at < now() - INTERVAL '${OLDER_THAN}'
) TO 's3://${S3_BUCKET}/telemetry'
  (FORMAT PARQUET, COMPRESSION ZSTD, PARTITION_BY (mes), OVERWRITE_OR_IGNORE);
"

# 2) Eliminar los chunks ya archivados en el PRIMARIO (libera disco caliente)
echo "[archive] Eliminando chunks archivados del primario..."
docker exec aurixa-db psql -U sensors -d sensors_db -tAc "
SELECT drop_chunks('telemetry_raw', older_than => INTERVAL '${OLDER_THAN}');
"

echo "[archive] Listo. Datos >1 año en S3 (Parquet ZSTD), consultables con DuckDB/Athena."
