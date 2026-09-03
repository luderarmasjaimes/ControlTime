# TASKS 003 — Tier frío histórico >1 año en S3/MinIO

| Campo | Valor |
|---|---|
| **Plan** | `specs/003-tier-frio-historico/plan.md` |
| **Sprint·Release** | Etapa 2 (S9-S10 · R5) |
| **Responsables** | BE3 (DBA/SQL), SYS (MinIO/infra), OPS (cron/scripts), QA |
| **Última revisión** | 2026-06-24 (auditado contra `docker-compose.yml` + MinIO — T1-T8 confirmados ☑) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Levantar MinIO en `docker-compose.yml` (buckets `telemetry-cold`, `db-backups`) | CA-1 | SYS | Haiku | ☑ |
| **T2** | Activar versionado en bucket `telemetry-cold` (`mc mb --with-versioning`) | CA-6 | SYS | Haiku | ☐ |
| **T3** | Credenciales MinIO en `.env` (`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`) | seguridad | SYS | Haiku | ☑ |
| **T4** | Script `scripts/archive_cold_tier.sh`: export DuckDB réplica → Parquet ZSTD → MinIO | CA-1,CA-2 | BE3 | **Opus** (lógica compleja) | ☑ |
| **T5** | Verificación de conteo en el script (S3 filas == BD filas) antes de drop_chunks | CA-6,Art.2 | BE3 | **Opus** | ☑ |
| **T6** | `drop_chunks('telemetry_raw', older_than => '1 year')` en script (solo si T5 OK) | CA-2 | BE3 | Sonnet | ☑ |
| **T7** | Configurar extensión DuckDB `httpfs` + credenciales S3 vía env vars | CA-1 | BE3 | Sonnet | ☑ |
| **T8** | Particionado por mes (`mes=YYYY-MM`) en el layout de objetos Parquet | CA-3 | BE3 | Sonnet | ☑ |
| **T9** | Cron semanal del job de archivado (domingo 02:00 UTC) | CA-1 | OPS | Haiku | ☐ |
| **T10** | Variables de entorno configurables: `OLDER_THAN`, `S3_BUCKET`, `DOCKER_NET` | despliegue | OPS | Haiku | ☐ |
| **T11** | **Test CA-1**: ejecutar script, verificar objetos en `s3://telemetry-cold/telemetry/mes=*/` | CA-1 | QA | — | ☑ |
| **T12** | **Test CA-2**: verificar `drop_chunks` liberó espacio (`pg_database_size` antes/después) | CA-2 | QA | — | ☐ |
| **T13** | **Test CA-3**: query DuckDB sobre Parquet frío → resultado correcto, < 5 s | CA-3 | QA | — | ☑ |
| **T14** | **Test CA-4**: medir ratio compresión (`mc stat` vs `pg_total_relation_size`) | CA-4 | BE3 | — | ☑ |
| **T15** | **Test CA-5**: query filtra `tenant_id='A'` → solo filas de A en Parquet | CA-5 | QA | — | ☑ |
| **T16** | **Test edge**: cortar red durante export → job falla antes de `drop_chunks` | edge | QA | — | ☐ |
| **T17** | **Test edge**: Parquet corrompido → verificación detecta discrepancia → no drop | edge | QA | — | ☐ |
| **T18** | Log de auditoría por ejecución (fecha, filas archivadas, tamaño, resultado) | Art.5 | BE3 | Sonnet | ☐ |
| **T19** | Endpoint de consulta al tier frío (si se requiere desde frontend) | opcional | BE1 | Sonnet | ☑ |

> **Actualización 2026-08-30**: T19 verificado — `GET /api/platform/archive/query`
> (`backend/src/platform/platform_routes.cpp::handleQueryArchive`, registrada
> en `registerRoutes`) implementa exactamente esto: lectura on-demand del
> tier frío (un sensor + rango de fechas, máx. 366 días) vía DuckDB `httpfs`
> contra MinIO, con guardia anti-IDOR (`resolveAllowedSensorTenant`) y
> validación estricta de UUID/rango en Postgres parametrizado antes de tocar
> el shell. Build verificado limpio (`Dockerfile.verify`, CTest 1/1); no
> probado en vivo contra un bucket con datos reales archivados en esta
> pasada. Documentado también como actualización de ADR-131 (el código ya
> citaba "ADR-131" en su comentario sin que el ADR lo reflejara).

> **Nota:** T1, T3-T8, T11, T13-T15, T19 completadas (tier frío funcional,
> compresión ~30× medida; T19 verificado 2026-08-30). T2, T9, T10, T12, T16-T18 pendientes de completar.

## Secuencia (dependencias)

```
T1 ─► T3 ─► T7                      (MinIO up + credenciales + DuckDB httpfs)
T4 ─► T5 ─► T6                      (export → verificar → drop_chunks)
T8 (layout, parte de T4)
(T1-T8) ─► T11 ─► T12 ─► T13 ─► T14 ─► T15   (tests en orden)
T2, T9, T10, T18 en paralelo (independientes de la secuencia de tests)
T16, T17 en paralelo (tests edge, requieren el script completo)
T19 opcional (no bloquea nada)
```

## Definition of Done (feature 003)

- [x] T1, T3-T8 completadas y enlazadas a commits.
- [x] **CA demostrados (parcial):**
  - [x] CA-1 objetos presentes en MinIO `telemetry-cold/`
  - [x] CA-3 query DuckDB sobre Parquet < 5 s
  - [x] CA-4 ratio ~30× compresión medido (104K filas → 718 KiB)
  - [x] CA-5 aislamiento multitenant en Parquet
- [ ] CA-2 (drop_chunks + liberación de espacio) — **pendiente T12**
- [ ] CA-6 (versionado bucket) — **pendiente T2**
- [ ] Tests edge (T16, T17) — **pendientes**
- [ ] Cron + auditoría (T9, T18) — **pendientes**
- [x] T19 endpoint de consulta al tier frío desde frontend — verificado 2026-08-30 (`GET /api/platform/archive/query`), ver actualización arriba
- [ ] ADR-003-1..5 registrados.
- [ ] Sin violar Constitución (Art. 2, 4, 9).

## Métricas de éxito (KPIs SOW)

| KPI | Meta | Medido |
|---|---|---|
| Ratio compresión frío | > 10× vs raw | **~30×** (ZSTD nivel 3) |
| Query sobre Parquet frío (1 año) | < 5 s | **< 3 s** (DuckDB columnar) |
| Costo almacenamiento frío (1 año, 1k/s) | < 500 GB | **~220 GB** Parquet |
| 0 pérdida al archivar | verificación antes del drop | **verificado** (conteo OK) |

## Evidencias de implementación (retroactivas)

- Código: `scripts/archive_cold_tier.sh` (export DuckDB + verificación + drop)
- `docker-compose.yml`: servicio MinIO con credenciales env vars
- Test: 104.168 filas → 718 KiB Parquet ZSTD (sesión 2026-06)
- SQL: `db_scripts/64_telemetry_ingest_optimization.sql` (compresión de chunks; renumerado desde `29` el 2026-08-20)
