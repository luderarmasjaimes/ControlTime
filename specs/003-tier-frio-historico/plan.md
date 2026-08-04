# PLAN 003 — Tier frío histórico >1 año en S3/MinIO (revisión profunda)

| Campo | Valor |
|---|---|
| **Spec** | `specs/003-tier-frio-historico/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Revisado por** | BE3 (DBA/archivado), SYS (MinIO/infra) |
| **Sprint·Release** | Etapa 2 (S9-S10 · R5) |
| **Constitución** | Art. 4 (capas por temperatura), Art. 9 (recursos acotados) |
| **Última revisión** | 2026-06-24 (plan revisado — arquitectura DuckDB/MinIO confirmada con docker-compose) |

---

## 1. Enfoque técnico

**Archivado por capas con DuckDB como motor de export.** TimescaleDB community no
soporta tiered storage nativo a S3 (es feature de Timescale Cloud). La solución
self-hosted correcta es: **DuckDB** (motor OLAP embebible) lee la réplica
(no carga el primario), convierte a **Parquet columnar con ZSTD**, sube a MinIO
(S3-compatible), verifica, y luego el primario elimina los chunks archivados.

> Resultado medido: 104.168 filas → **718 KiB Parquet ZSTD** vs ~21 MB en
> PostgreSQL = **~30× compresión**. Consultable directamente desde S3 sin
> restaurar ni tocar la BD.

## 2. Arquitectura del tier frío

```
                     ┌── TIER CALIENTE (< 1 día, sin comprimir) ──────────────────┐
                     │  TimescaleDB hypertable telemetry_raw                       │
  INGESTA ──────────►│  chunks: interval=6h, ~205 B/fila, hot queries             │
 (001: Kafka→COPY)   │                                                             │
                     ├── TIER TEMPLADO (1 día – 1 año, comprimido) ──────────────┤
                     │  mismo hypertable, chunks comprimidos (columnar TimescaleDB)│
                     │  ~41 B/fila comprimido (~5× raw)                           │
                     └────────────────────┬────────────────────────────────────────┘
                                          │ archivado job (> 1 año)
                                          ▼
 db_replica ──── DuckDB ──── Parquet ZSTD ──►  MinIO  s3://telemetry-cold/
 (lectura,         (en        (particionado         telemetry/mes=YYYY-MM/*.parquet
  no carga         Docker     por mes +             → ~7 B/fila (~30× raw)
  primario)        red)       tenant_id)            → consultable con DuckDB/Athena
                                          │
                              drop_chunks(primario, older_than='1 year')
```

## 3. Componentes

### 3.1 MinIO
- Bucket `telemetry-cold`: versionado activado, lifecycle configurable.
- Bucket `db-backups`: WAL + base backups (compartido con spec 015).
- Endpoint interno: `http://minio:9000`.
- Credenciales: `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (env, no hardcode).

### 3.2 DuckDB (motor de export)
- Corre como contenedor efímero (`duckdb/duckdb:latest`) en la red Docker.
- Extensions: `postgres` (lee réplica directamente), `httpfs` (escribe a MinIO/S3).
- Configuración S3: `s3_endpoint=minio:9000`, `s3_use_ssl=false`, `s3_url_style=path`.

### 3.3 Job de archivado (`scripts/archive_cold_tier.sh`)
```
1. [DuckDB] Conectar a réplica (read-only)
2. [DuckDB] COPY (SELECT * WHERE captured_at < now() - INTERVAL '1 year')
            TO 's3://telemetry-cold/telemetry'
            PARTITION_BY(mes=strftime(captured_at,'%Y-%m'))
            FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE
3. [Verificación] Contar filas en S3 vs filas en réplica para el rango
4. [Primario] SELECT drop_chunks('telemetry_raw', older_than => INTERVAL '1 year')
              — SOLO si la verificación pasó
5. Registrar en log de auditoría (fecha, filas archivadas, tamaño)
```
El paso 4 se ejecuta solo si el conteo S3 == conteo BD — **verificación antes de borrar** (Art. 2).

## 4. Layout de objetos en MinIO

```
telemetry-cold/
  telemetry/
    mes=2025-01/
      part-0001.parquet   ← tenant_id, sensor_id, captured_at, value_numeric, quality_code, …
      part-0002.parquet
    mes=2025-02/
      …
```
- Particionado por mes (columna virtual `mes`) → filtros de rango eficientes en DuckDB.
- `tenant_id` es columna en el Parquet → queries multitenant funcionan en frío.
- Compresión ZSTD nivel 3 (default DuckDB): balance óptimo velocidad/ratio.

## 5. Consulta del tier frío

```sql
-- Sin restaurar a BD: DuckDB consulta directo desde S3
INSTALL httpfs; LOAD httpfs;
SET s3_endpoint='minio:9000'; SET s3_use_ssl=false; SET s3_url_style='path';

SELECT tenant_id,
       strftime(captured_at,'%Y-%m') AS mes,
       count(*) AS lecturas,
       round(avg(value_numeric),2)   AS promedio
FROM 's3://telemetry-cold/telemetry/**/*.parquet'
WHERE tenant_id = 'a0000001-…'
  AND captured_at BETWEEN '2025-01-01' AND '2025-06-30'
GROUP BY 1, 2 ORDER BY 2;
-- tiempo típico: < 3 s sobre años de datos (columnar + predicate pushdown)
```

## 6. Seguridad y multitenant (Art. 1, 6)

- El job de archivado usa `REPLICA_DATABASE_URL` (rol `dashboard_ro`) — sin escritura.
- `drop_chunks` se ejecuta con rol de primario (solo el job autorizado).
- El bucket `telemetry-cold` no es público; acceso solo con credenciales MinIO.
- El Parquet incluye `tenant_id` en todas las filas → no hay mezcla de datos.

## 7. Decisiones de arquitectura (ADR)

| ADR | Decisión | Estado |
|---|---|---|
| ADR-003-1 | **DuckDB** como motor de export (vs pg_parquet o COPY csv) | Aceptado |
| ADR-003-2 | Export desde **réplica**, no desde primario | Aceptado (Art. 3) |
| ADR-003-3 | **Verificación de conteo** antes de `drop_chunks` (seguridad de archivado) | Aceptado |
| ADR-003-4 | Particionado por mes (no por día ni año) — balance entre nº archivos y tamaño | Aceptado |
| ADR-003-5 | Parquet ZSTD nivel 3 — ~30× compresión vs PostgreSQL heap | Aceptado |

## 8. Plan de pruebas (cada CA con evidencia)

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | Ejecutar job sobre datos > 1 año | objetos en `s3://telemetry-cold/telemetry/mes=*/` |
| CA-2 | Comprobar `drop_chunks` liberó espacio | `SELECT pg_database_size(…)` antes/después |
| CA-3 | Query DuckDB sobre el Parquet frío | resultado correcto + tiempo < 5 s |
| CA-4 | Medir ratio compresión | `mc stat` tamaño S3 vs `pg_total_relation_size` |
| CA-5 | Query filtra por `tenant_id='A'` | solo filas de A |
| CA-6 | Verificar que el job usó la réplica | logs DuckDB host=db_replica |
| Edge | Cortar red durante export | el job falla antes del `drop_chunks`; no se pierden datos |
| Edge | Parquet corrompido | verificación de conteo detecta la discrepancia; no hace drop |

## 9. Programación del job

```cron
# Cron semanal (domingo 02:00 UTC) — disco de frío crece ~24 GB/semana a 1k/s
0 2 * * 0  /opt/aurixa/scripts/archive_cold_tier.sh >> /var/log/aurixa/archive.log 2>&1
```
Variables de entorno configurables: `OLDER_THAN` (default `1 year`),
`S3_BUCKET` (default `telemetry-cold`), `DOCKER_NET`.

## 10. Costo / recursos (Art. 9)

- MinIO: 1 CPU / 1 GB ram. Almacenamiento depende del volumen (configurable en el host).
- Retención en frío: indefinida por defecto; lifecycle de MinIO puede eliminar datos
  más allá de N años si política lo permite.
- DuckDB (efímero): corre y termina; no consume recursos permanentes.
- **~7 B/fila en frío** → 1 año a 1.000/s ≈ 220 GB Parquet (vs ~6,5 TB en raw PG).
