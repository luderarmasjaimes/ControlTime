# ADR-131 — Consolidación del modelo de telemetría (dim_* / telemetry_fact*) y capacidad a 5-10 años

> **Actualización 2026-08-30 (auditoría de trazabilidad ADR-129/136, ver
> `README.md`)**: `backend/src/platform/platform_routes.cpp` implementa
> `GET /api/platform/archive/query` (`handleQueryArchive`, registrada como
> `r.get("/api/platform/archive/query", ...)`), citando explícitamente
> "ADR-131" en su propio comentario de código, pero esta decisión nunca se
> documentó en el cuerpo del ADR — brecha encontrada por lectura directa del
> código, no asumida. La ruta resuelve lectura on-demand del tier frío
> (Parquet/MinIO, ADR-009) que la fase de archivado (`handleRunArchiveJob`,
> ya existente) solo escribía: sin esto, "dashboards con históricos de 5
> años" no podía servir drill-down crudo más allá de la ventana HOT de 190
> días. Un sensor + rango de fechas por request (no bulk export, máx. 366
> días), vía `duckdb -csv` + extensión `httpfs` contra MinIO por S3, con
> guardia anti-IDOR (`resolveAllowedSensorTenant`), validación estricta de
> UUID/rango en Postgres parametrizado antes de tocar el shell, y
> `shellQuote()` sobre cada valor interpolado en el SQL de DuckDB (mismo
> patrón que `face_analysis.cpp`/`conversion_service.cpp`). Se degrada a
> `501 not_implemented` en desarrollo Windows (DuckDB CLI no disponible ahí).
> No verificado en vivo contra un bucket con datos reales archivados en esta
> pasada — solo lectura de código y build limpio.

**Status**: implemented (fases 0-5, 9-10 aplicadas contra beemetry-db local; fases 6-8/13 — dual-write, cutover de lecturas y retiro de tablas legacy — pendientes de deploy backend C++, fuera de alcance de esta sesión)
**Fecha**: 2026-08-23
**Autores**: EC (con Luder Armas)
**Ámbito**: datos / core-iot

> Responde a un pedido de revisión integral de la base de datos para sostener
> 25.000 registros de sensores/segundo continuos 24/7, dashboards con
> históricos de hasta 5 años, y una arquitectura preparada para 10 años de
> crecimiento, minimizando el footprint de disco para backup/restore rápidos.
> Extiende ADR-006 (hypertables/retención/archivado), ADR-007/008/108
> (ingesta de alta tasa), ADR-009 (archivado Parquet/MinIO), ADR-034
> (gestión de dispositivos/alarmas). Referencia también la auditoría
> `auditoria-base-datos-20260813-160844/`.

## Contexto

La base de telemetría tenía **tres modelos de sensores/telemetría paralelos y
no unificados**, cada uno con su propio catálogo de identidad y su propia
política de retención/compresión:

1. `sensors`/`telemetry_raw` (`04_telemetry_schema_v2.sql`) — UUID,
   multitenant real, la única vía de ingesta de alta tasa (25k/s, ADR-108).
   470.400 filas reales verificadas en este entorno.
2. `mineria_*` (`09_formula_mining_reports.sql`) — motor "Formula", claves
   SERIAL/INTEGER, **sin política de retención** (decisión de negocio
   deliberada: conservar todo). 2.161 filas de `mineria_lecturas`.
3. `mining_*` (`22_mining_demo_telemetry_surveillance.sql`,
   `28_mining_telemetry_uuid_tenant.sql`) — dashboard/demo, SERIAL, 342 filas
   legacy sin ingesta activa (`mining_sensors.tenant_id` sí es UUID real desde
   el script 28, más reciente que lo que documentaba la auditoría previa —
   `mining_company`/`site_unit` como texto libre ya no existen en este
   esquema).

Un mismo sensor físico podía no tener ninguna identidad compartida entre los
tres modelos, y cada uno se dimensionaba/comprimía/retenía por separado sin
una decisión unificada.

### Hallazgos adicionales de la auditoría previa (2026-08-13) que este ADR cierra

- **Chunk "corrupto"** (`compress_hyper_3_80_chunk has no dimension slices`,
  `auditoria-base-datos-20260813-160844/auditoria-completa.log:78`):
  verificado en vivo (ver `73_repair_corrupt_chunk_verification.sql`) como
  **falso positivo de tooling**. `Auditar-Base-Datos-Completa.ps1:90-102`
  genera `SELECT 1 FROM %I.%I LIMIT 1` contra TODAS las tablas de TODOS los
  esquemas no-sistema, incluyendo `_timescaledb_internal` (tablas companion
  de compresión, que por diseño nunca tienen `dimension_slice` propio). El
  error coincidió con una ventana de compresión automática en curso —
  transitorio y autolimitado, no corrupción persistente. Verificación
  formal: 1.091 chunks comprobados por lectura real, 0 fallos. No se ejecutó
  ninguna recompresión/recreación.
- **Continuous aggregates construidos pero nunca consultados** por el
  backend (`mining_sensor_history_hourly/_daily`, `telemetry_raw_hourly/
  _daily` de `35_adr006_continuous_aggregates_sensor_history.sql`) —
  infraestructura pagada, sin conectar. Quedan **superseded** por los nuevos
  `telemetry_fact*_hourly/_daily` (ver Decisión 4).
- **30+ scripts de `db_scripts/` sin cablear en `docker-entrypoint-initdb.d`**
  — un despliegue desde volumen vacío no reproducía el esquema completo.

## Decisión

### 1. Dimensiones compartidas + 3 hypertables de hechos (NO una fusión total)

TimescaleDB aplica retención/compresión **por chunk** (rango temporal), no
por fila. Fusionar los 3 modelos en una sola tabla física habría obligado a
aplicar una única política de retención a las tres fuentes por igual —
revirtiendo la decisión de negocio deliberada de que `mineria_lecturas` NO
tenga retención.

Se creó en su lugar (`74_telemetry_fact_dimensions.sql`) un catálogo
dimensional único — `dim_tenant`, `dim_site`, `dim_channel`, `dim_sensor`
(con `source_system IN ('iot_v2','formula','demo')` y CHECK XOR sobre las 3
claves legacy posibles) — consumido por **tres hypertables de hechos
independientes**, cada una con la política que ya tenía su predecesora:

| Hypertable nueva | Reemplaza | Compresión | Retención |
|---|---|---|---|
| `telemetry_fact` | `telemetry_raw` | `segmentby=sensor_id_sk`, `compress_after=3h` | `190 días` |
| `telemetry_fact_formula` | `mineria_lecturas` | `compress_after=30 días` | ninguna (preservada) |
| `telemetry_fact_demo` | `mining_sensor_history` | `compress_after=7 días` | ninguna (preservada) |

Un sensor ya no tiene 3 identidades incompatibles — `dim_sensor` es el
catálogo único — pero cada fuente conserva su ciclo de vida de datos propio.

**Reconciliación tenant/site**: no existía FK entre `mineria_empresas` y
`tenants`; se creó `migration_tenant_reconciliation` con preseed automático
solo para coincidencias EXACTAS de nombre (10/10 casos en este entorno, sin
ambigüedad, revisadas manualmente antes de aceptarlas — ver commit de esta
sesión). Para un dataset con nombres ambiguos, este paso debe hacerse con
revisión humana real antes de aceptar cualquier match.

### 2. `value_numeric REAL` (4 bytes) en vez de `DOUBLE PRECISION` (8 bytes)

Ahorra ~33% del payload numérico. Suficiente precisión (~7 dígitos
significativos) para temperatura/vibración/presión/nivel/caudal — el
universo real de sensores mineros de este dominio. Si un canal futuro
necesita mayor precisión (p. ej. GPS de alta resolución), se excluye
explícitamente por `channel_id` o se sirve desde `telemetry_multivariate`
(fuera de alcance de este ADR), no se fuerza `REAL` a todo el modelo.

### 3. Fila caliente: ~130 bytes → ~60 bytes

| Escenario | Bytes/fila (datos + overhead) |
|---|---|
| `telemetry_raw` (4×UUID de 16B repetidas + BIGINT + 2×TIMESTAMPTZ + DOUBLE + SMALLINT) | ~130 |
| `telemetry_fact` (SMALLINT+INTEGER+SMALLINT+TIMESTAMPTZ+REAL+SMALLINT+INTEGER+BIGINT vía Kafka) | ~60 |

`value_text`/`raw_payload`/`tags` (casi siempre NULL en el camino caliente)
se separaron a `telemetry_fact_detail` para no degradar la compresión
columnar del resto de columnas.

### 4. Continuous aggregates conectados — `telemetry_fact*_hourly/_daily`

`76_telemetry_fact_continuous_aggregates.sql` crea 6 continuous aggregates
(hourly/daily × 3 hypertables), con los mismos `start_offset`/`schedule_
interval` que sus predecesores. **Estos SÍ deben ser consumidos por el
backend** (`sensor_service.cpp:135-141`, `kpi_service.cpp`,
`sensor_telemetry_wizard.cpp`) — trabajo de la Fase 8 (fuera de alcance de
esta sesión, requiere deploy C++). Sirven de reemplazo funcional de
`mining_sensor_history_hourly/_daily`/`telemetry_raw_hourly/_daily`
(ADR-006), que quedan superseded.

### 5. Dimensionamiento de capacidad — 25.000 filas/s, 5-10 años

Filas: 2,16 mil millones/día · 788,4 mil millones/año · **3,94 billones
(trillion)** en 5 años · **7,88 billones** en 10 años.

| Tier | Definición | 190 días | 1 año | 5 años | 10 años |
|---|---|---|---|---|---|
| HOT (sin comprimir, `compress_after=3h`) | ventana móvil | — | — | — | **~16 GB residentes en todo momento** |
| WARM (comprimido Timescale, ~12x) | `telemetry_fact`, retención 190d | **~2,05 TB** | 3,94 TB | (no se retiene) | (no se retiene) |
| Continuous aggregate horario | 25.000 sensores | — | ~16,2 GB | **~81 GB** | ~162 GB |
| Continuous aggregate diario | 25.000 sensores | — | ~0,68 GB | **~3,4 GB** | ~6,8 GB |
| COLD (Parquet/MinIO, zstd) | fuera de ventana WARM | — | ~3,15 TB/año | **~15,8 TB** | **~31,5 TB** |

**Decisión explícita**: mantener 5 años de telemetría cruda en TimescaleDB es
inviable operativamente (43.800 chunks de 1h solo para 5 años). Los
"dashboards de 5 años" se sirven con los continuous aggregates
(**~243x y ~5.800x más chicos** que el raw equivalente a 1h/1d), no con raw.
`compress_after` de `telemetry_fact` baja de 1 día a **3 horas** — a 25k/s, 1
día sin comprimir ocuparía ~130GB, muy por encima de `effective_cache_size=
6GB` (`docker-compose.yml`, servicio `db`).

**Gap NO resuelto por este ADR, dejado explícito**: el drill-down a
resolución cruda más allá de 190 días requiere leer desde Parquet/MinIO
(ADR-009), que hoy **no tiene ningún endpoint de lectura implementado**
(solo escritura vía `archive_telemetry_to_parquet.sh`). Si "5 años de raw
consultable" es un requisito de negocio real (no solo agregados), cerrar ese
endpoint es prerrequisito duro — trabajo futuro, no incluido aquí.

**25k/s sostenido 24/7 NO está validado**: ADR-108 certificó 25k/s sostenidos
solo **60 segundos**, con topología de 250 agregadores × 100 sensores, y
prohíbe explícitamente comunicar cifras mayores como validadas. Este ADR usa
25k/s como supuesto de dimensionamiento (así lo pidió el negocio) pero **no
reclama haberlo validado en producción 24/7 durante años** — una prueba de
carga sostenida de horas (no segundos) queda como entregable pendiente antes
de comprometer esta capacidad operativamente.

### 6. Backfill histórico + wiring de migraciones versionadas

`78_telemetry_fact_backfill.sql` migró el histórico completo sin downtime
(idempotente, watermark por tabla origen, `ON CONFLICT DO NOTHING`):
470.400 + 2.161 + 342 = **472.903 filas**, paridad 100% verificada contra las
tablas origen. Las tablas legacy (`telemetry_raw`, `mineria_lecturas`,
`mining_sensor_history`) **siguen siendo la única fuente de escritura real**
hasta que el backend tenga dual-write desplegado (Fase 6) — este script debe
re-ejecutarse periódicamente hasta ese momento para no perder los datos que
sigan llegando por la vía vieja.

`79_schema_migrations_bootstrap.sql` + `scripts/apply_migrations.sh` +
servicio `db-migrate` (`docker-compose.yml`, perfil `migrate`) cierran el gap
de scripts huérfanos: control de versión por checksum, con modo
`--record-only` para establecer el baseline de una BD que ya tenía estos
scripts aplicados por otra vía sin re-ejecutar contenido destructivo
(varios scripts legacy son `TRUNCATE`+reseed). Baseline de 77 scripts
registrado en esta sesión contra `beemetry-db`.

**Deliberadamente NO se redujo `docker-entrypoint-initdb.d` a solo
`01_init.sql`** (como proponía el diseño original) — es un cambio más
invasivo sobre un `docker-compose.yml` funcionando, mejor probado aparte
contra un volumen nuevo antes de aplicarlo. Los scripts 73-76/78/79 sí se
agregaron al mount existente (aditivo, bajo riesgo).

### 7. Vistas de compatibilidad — preparadas, NO aplicadas todavía

`77_telemetry_compat_views.sql` queda escrito y comentado (`SELECT 1;` como
no-op) a propósito: solo tiene sentido ejecutarlo en la Fase D (después de
dual-write + backfill al día + paridad verificada), porque el `RENAME` de las
tablas legacy interrumpiría al backend actual, que todavía hace `INSERT`
directo sobre `telemetry_raw`/`mineria_lecturas`.

### 8. `archive_telemetry_to_parquet.sh` — NO repuntado a `telemetry_fact`

Se evaluó repuntar el script de archivado Parquet a `telemetry_fact`, pero
mientras el backend no tenga el dual-write desplegado, `telemetry_fact` no
recibe escritura en vivo — repuntar ahora habría detenido silenciosamente el
archivado de datos reales nuevos. Queda para la Fase 9/10, junto con el
cutover del backend, no antes.

### 9. Backup offsite — placeholder documentado

`scripts/backup_db.sh` ya tenía el mecanismo (`BACKUP_REMOTE=1`/
`RCLONE_REMOTE`); se documentó en `.env.example` sin proveedor real todavía
(pendiente de que el negocio elija S3/Azure/otro datacenter). La reducción de
bytes/fila de este ADR beneficia directamente el tiempo de `pg_dump`. La
réplica de lectura (`db_replica`) **no sustituye** a este backup — propaga
`DELETE`s/corrupción lógica del primario en tiempo casi real.

## Consecuencias

- Un sensor tiene una identidad única (`dim_sensor`) sin importar su origen;
  reportes cross-fuente son un `UNION ALL` simple sobre las 3 hypertables.
- La fila caliente de la vía de 25k/s pesa ~54% menos, con mejor
  compresibilidad columnar (claves INT en vez de UUID de alta entropía).
- Las políticas de retención/compresión de negocio de `mineria_lecturas`/
  `mining_sensor_history` quedan intactas.
- El backend (`sensor_service.cpp`, `kpi_service.cpp`,
  `sensor_telemetry_wizard.cpp`, `telemetry_ingest.cpp`, `formula_service.cpp`)
  **no ha sido modificado todavía** — sigue escribiendo/leyendo las tablas
  legacy. `telemetry_fact*` recibe datos solo vía backfill manual
  (`78_telemetry_fact_backfill.sql`) hasta que se despliegue el dual-write.
  **Riesgo operativo mientras tanto**: cualquier dato nuevo ingresado después
  de la última corrida del backfill no existe en `telemetry_fact` hasta la
  siguiente corrida manual — no hay paridad en tiempo real todavía.
- `platform_alarm_rules`/`platform_alarms` (CHECK XOR `sensor_id`/
  `mining_sensor_id`, `38_adr034_device_management_alarm_engine.sql`) y
  `alarm_notifier.cpp` (modificado por el usuario en esta misma sesión) NO
  se tocaron — blast radius deliberadamente excluido, candidato a un ADR de
  seguimiento cuando se ataque la Fase C (cutover de lecturas).

## Trabajo pendiente (explícito, no asumido como hecho)

1. Deploy backend: dual-write en `telemetry_ingest.cpp` (Fase 6).
2. Cutover de lecturas de `sensor_service.cpp`/`kpi_service.cpp`/
   `sensor_telemetry_wizard.cpp` a `telemetry_fact*`/aggregates (Fase 8).
3. Aplicar `77_telemetry_compat_views.sql` (Fase D, después de 1-2 + paridad
   verificada en ventana reciente).
4. Repuntar `archive_telemetry_to_parquet.sh` a `telemetry_fact` (junto con 2).
5. Retiro de `telemetry_raw`/`mineria_lecturas`/`mining_sensor_history` tras
   30 días de gracia sin incidentes (Fase 13).
6. Prueba de carga sostenida (horas) a 25k/s — capacidad todavía no validada
   más allá de los 60s de ADR-108.
7. Endpoint de lectura sobre el archivo Parquet/MinIO (gap de ADR-009, no
   creado por este ADR).
8. Reducir `docker-entrypoint-initdb.d` a `01_init.sql` + `db-migrate` para
   todo lo demás, probado aparte contra un volumen nuevo.
9. Elegir proveedor de backup offsite real y completar `RCLONE_REMOTE`.

## Alternativas descartadas

- **Una sola hypertable física fusionando los 3 modelos**: descartada por
  forzar una única política de retención (ver Decisión 1).
  `DOUBLE PRECISION` en vez de `REAL`: descartada por el costo de espacio a
  billones de filas sin necesidad real de esa precisión en este dominio.
- **Particionado nativo de Postgres en vez de hypertables**: ya descartado
  por ADR-006 ("reimplementa a mano lo que Timescale da con políticas
  declarativas"); no reabierto aquí.
- **Repuntar el archivado Parquet a `telemetry_fact` ya**: descartado por
  detener el archivado de datos reales mientras el backend no escriba ahí.

## Referencias

- ADR-006 (hypertables/retención/compresión/continuous aggregates)
- ADR-008 / ADR-108 (capacidad de ingesta 25k/s, certificación de 60s)
- ADR-009 (archivado Parquet/MinIO)
- ADR-034 (gestión de dispositivos, motor de alarmas)
- `auditoria-base-datos-20260813-160844/` (hallazgo original del chunk, cerrado por este ADR)
- `db_scripts/73_repair_corrupt_chunk_verification.sql`
- `db_scripts/74_telemetry_fact_dimensions.sql`
- `db_scripts/75_telemetry_fact_compression_retention.sql`
- `db_scripts/76_telemetry_fact_continuous_aggregates.sql`
- `db_scripts/77_telemetry_compat_views.sql` (no aplicado todavía)
- `db_scripts/78_telemetry_fact_backfill.sql`
- `db_scripts/79_schema_migrations_bootstrap.sql`
- `scripts/apply_migrations.sh`
