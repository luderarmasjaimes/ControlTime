#!/usr/bin/env bash
# ============================================================================
# archive_telemetry_to_parquet.sh — cierra ADR-009 (archivado Parquet en MinIO)
#
# Mueve telemetría fría de telemetry_raw (plano HOT de TimescaleDB, ADR-006)
# a Parquet en MinIO (object storage soberano, ADR-001/009) cuando supera el
# umbral de retención. Por día calendario (UTC), NO en un solo lote gigante:
#   1) exporta ese día a Parquet vía DuckDB (postgres_scanner + httpfs→S3),
#   2) relee el Parquet recién subido y compara el conteo de filas contra el
#      conteo real en Postgres para ese mismo día — solo si coinciden exacto
#      se procede a...
#   3) DELETE de esas filas en Postgres, en una sola transacción por día.
# Si el conteo no coincide, ese día se salta (log de error) sin borrar nada
# — nunca se borra sin verificar primero que el archivo subido es completo.
#
# Umbral de retención: no hay una política de negocio documentada (ver nota
# en ADR-009) — se usa un default conservador de 180 días, muy por encima de
# la ventana de compresión de 30 días ya establecida en ADR-006, para no
# arriesgar borrar nada que aún pueda necesitarse en el plano HOT. Ajustable
# vía BEEMETRY_ARCHIVE_RETENTION_DAYS.
#
# Requiere: psql (postgresql-client), el binario `duckdb` (descargado en el
# Dockerfile, extensiones `postgres`/`httpfs`).
# Uso manual:  docker exec beemetry-api /app/scripts/archive_telemetry_to_parquet.sh
# Uso vía API: POST /api/platform/archive/run (ver platform_routes.cpp)
# ============================================================================
set -euo pipefail

RETENTION_DAYS="${BEEMETRY_ARCHIVE_RETENTION_DAYS:-180}"
PG_URL="${BEEMETRY_TELEMETRY_DATABASE_URL:-}"
MINIO_ENDPOINT="${BEEMETRY_MINIO_ENDPOINT:-minio:9000}"
MINIO_ACCESS_KEY="${BEEMETRY_MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${BEEMETRY_MINIO_SECRET_KEY:-minioadmin123}"
MINIO_BUCKET="${BEEMETRY_MINIO_ARCHIVE_BUCKET:-beemetry-archive}"
DUCKDB_BIN="${DUCKDB_BIN:-/usr/local/bin/duckdb}"

if [[ -z "$PG_URL" ]]; then
  echo "[archive] ERROR: BEEMETRY_TELEMETRY_DATABASE_URL no está definido." >&2
  exit 1
fi

# BEEMETRY_TELEMETRY_DATABASE_URL viene en formato libpq "key=value ..."
# (mismo formato que usa telemetry_ingest.cpp) — psql/duckdb aceptan esa
# cadena de conexión directamente (formato "conninfo").
CUTOFF_DATE=$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%d)
echo "[archive] Umbral de retención: ${RETENTION_DAYS} días (corte: ${CUTOFF_DATE})"

# Días candidatos: días calendario COMPLETOS (max(captured_at) del día < cutoff)
# con datos en telemetry_raw, más antiguos que el corte.
CANDIDATE_DAYS=$(psql "$PG_URL" -t -A -c "
  SELECT DISTINCT date_trunc('day', captured_at)::date
  FROM telemetry_raw
  WHERE captured_at < TIMESTAMPTZ '${CUTOFF_DATE}'
  ORDER BY 1;
")

if [[ -z "$CANDIDATE_DAYS" ]]; then
  echo "[archive] Sin días candidatos (nada más viejo que ${RETENTION_DAYS} días). Nada que hacer."
  exit 0
fi

TOTAL_ARCHIVED=0
TOTAL_SKIPPED=0

for DAY in $CANDIDATE_DAYS; do
  NEXT_DAY=$(date -u -d "${DAY} +1 day" +%Y-%m-%d)
  YEAR=$(date -u -d "${DAY}" +%Y)
  MONTH=$(date -u -d "${DAY}" +%m)
  OBJECT_PATH="telemetry_raw/${YEAR}/${MONTH}/${DAY}.parquet"

  SRC_COUNT=$(psql "$PG_URL" -t -A -c "
    SELECT COUNT(*) FROM telemetry_raw
    WHERE captured_at >= TIMESTAMPTZ '${DAY}' AND captured_at < TIMESTAMPTZ '${NEXT_DAY}';
  ")

  if [[ "$SRC_COUNT" -eq 0 ]]; then
    continue
  fi

  echo "[archive] ${DAY}: ${SRC_COUNT} filas → s3://${MINIO_BUCKET}/${OBJECT_PATH}"

  "$DUCKDB_BIN" -c "
    INSTALL postgres; LOAD postgres;
    INSTALL httpfs; LOAD httpfs;
    SET s3_endpoint='${MINIO_ENDPOINT}';
    SET s3_access_key_id='${MINIO_ACCESS_KEY}';
    SET s3_secret_access_key='${MINIO_SECRET_KEY}';
    SET s3_use_ssl=false;
    SET s3_url_style='path';
    ATTACH '${PG_URL} options=-c\ statement_timeout=600000' AS pg (TYPE postgres, READ_ONLY);
    COPY (
      SELECT * FROM pg.telemetry_raw
      WHERE captured_at >= TIMESTAMPTZ '${DAY}' AND captured_at < TIMESTAMPTZ '${NEXT_DAY}'
    ) TO 's3://${MINIO_BUCKET}/${OBJECT_PATH}' (FORMAT PARQUET);
  "

  # Verificación: releer el Parquet recién subido y comparar conteo exacto
  # contra Postgres ANTES de borrar nada.
  PARQUET_COUNT=$("$DUCKDB_BIN" -csv -noheader -c "
    INSTALL httpfs; LOAD httpfs;
    SET s3_endpoint='${MINIO_ENDPOINT}';
    SET s3_access_key_id='${MINIO_ACCESS_KEY}';
    SET s3_secret_access_key='${MINIO_SECRET_KEY}';
    SET s3_use_ssl=false;
    SET s3_url_style='path';
    SELECT COUNT(*) FROM read_parquet('s3://${MINIO_BUCKET}/${OBJECT_PATH}');
  ")

  if [[ "$PARQUET_COUNT" != "$SRC_COUNT" ]]; then
    echo "[archive] ERROR ${DAY}: conteo no coincide (origen=${SRC_COUNT} parquet=${PARQUET_COUNT}) — NO se borra nada de Postgres para este día." >&2
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + 1))
    continue
  fi

  psql "$PG_URL" -v ON_ERROR_STOP=1 -c "
    BEGIN;
    DELETE FROM telemetry_raw
    WHERE captured_at >= TIMESTAMPTZ '${DAY}' AND captured_at < TIMESTAMPTZ '${NEXT_DAY}';
    COMMIT;
  "

  echo "[archive] ${DAY}: OK — ${SRC_COUNT} filas archivadas y verificadas, borradas del plano HOT."
  TOTAL_ARCHIVED=$((TOTAL_ARCHIVED + 1))
done

echo "[archive] Completado. Días archivados: ${TOTAL_ARCHIVED}. Días saltados por error de verificación: ${TOTAL_SKIPPED}."
