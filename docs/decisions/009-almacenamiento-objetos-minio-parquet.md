# ADR-009 — Almacenamiento de objetos soberano: MinIO + archivado Parquet

**Riesgo real detectado (auditoría 2026-07-13, ver detalle completo en ADR-006)**: el
umbral de archivado de este ADR (`BEEMETRY_ARCHIVE_RETENTION_DAYS`, default 180 días)
es **mayor** que el `drop_after` nativo de TimescaleDB en `telemetry_raw` (90 días,
ADR-006) — cualquier fila entre 90 y 180 días se borra nativamente antes de que este
job la archive. Verificado en vivo contra `timescaledb_information.jobs` +
comprobación de que los buckets `beemetry-archive`/`telemetry-cold` en MinIO existen
pero están vacíos (0 objetos) — consistente con que la telemetría real de hoy aún no
llega a 90 días, no con que el job esté roto. Corrección pendiente: alinear ambos
umbrales antes de que datos reales alcancen 90 días de antigüedad.

**Status**: implemented (cerrado 2026-07-08, tras una revisión previa el 2026-07-07 que lo había diferido). El usuario pidió explícitamente continuar con esta pieza; se implementó con un diseño acotado que evita las dos razones por las que se había diferido:

**Decisión de diseño — motor Parquet**: en vez de añadir Apache Arrow como dependencia C++ (grande, sin paquete `apt` en Ubuntu 24.04 — tampoco existe `python3-pyarrow` vía apt, confirmado), se usa el **binario CLI de DuckDB** (mismo patrón ya establecido en este Dockerfile para onnxruntime: se descarga un binario estático via `wget` en el build). DuckDB tiene extensiones `postgres` (lee Postgres directo, sin ETL intermedio) y `httpfs` (escribe a S3/MinIO directo) — permite hacer `Postgres → Parquet → MinIO` en una sola sentencia `COPY (...) TO 's3://...' (FORMAT PARQUET)`, sin mover el dato dos veces.

**Decisión de diseño — orquestación**: `backend/scripts/archive_telemetry_to_parquet.sh` (bash + `psql` + `duckdb`, mismo estilo que `entrypoint.sh`/`surveillance_camera_snapshot.py` ya existentes), procesado **día calendario por día calendario**, no en un solo lote — por cada día con datos más viejos que el umbral: (1) exporta a Parquet vía DuckDB, (2) **relee el Parquet recién subido y compara el conteo de filas contra Postgres**, (3) solo si el conteo coincide EXACTO, hace el `DELETE` en Postgres dentro de una transacción. Si no coincide, ese día se salta con un error logueado y NO se borra nada — no hay forma de que el job borre datos que no estén ya verificados como archivados íntegramente.

**Umbral de retención**: sin política de negocio documentada (ver contexto original de este ADR — "retención 2-7 años" nunca se precisó). Se usa un default conservador de **180 días** (`BEEMETRY_ARCHIVE_RETENTION_DAYS`, muy por encima de la ventana de compresión de 30 días de ADR-006), documentado como ajustable, no como una decisión de negocio tomada unilateralmente.

**Disparo**: sin scheduler/cron en el stack actual — se expone `POST /api/platform/archive/run` (`platform_routes.cpp`, requiere sesión admin) que invoca el script server-side con timeout de 30 min, más la opción de invocarlo manualmente vía `docker exec beemetry-api /app/scripts/archive_telemetry_to_parquet.sh`. Automatizar la programación periódica (cron real) queda fuera de esta pasada — es una decisión operativa (¿cada cuánto? ¿en qué ventana de bajo tráfico?) que amerita su propia definición, no un valor inventado.

**Verificado con datos reales, no sintéticos donde importaba**:
1. Query real contra `telemetry_raw` en producción vía DuckDB `postgres_scanner`: 10,800,221 filas confirmadas, sin usar ningún dato ficticio para esta parte.
2. Prueba de round-trip real: exportado un slice real de esa tabla (10,800,200 filas de una hora de carga inicial) a Parquet en `beemetry-minio`, releído desde MinIO vía `read_parquet('s3://...)`, conteo de filas y rango de timestamps coincidieron EXACTO con Postgres — confirma que DuckDB+httpfs+MinIO preserva integridad de datos sin pérdida.
3. **Prueba del ciclo completo archivar+verificar+borrar** (deliberadamente NO ejecutada contra producción real para no arriesgar datos reales — ver metodología ya usada en la migración de hypertable de ADR-006): contenedor Postgres desechable con 5000 filas sintéticas fechadas 200 días atrás, corrido el script real sin modificar contra esa base — resultado: Parquet subido a MinIO (91KB, 5000 filas, mismo rango de timestamps y mismos valores min/max que el origen), y solo DESPUÉS de esa verificación, `DELETE 5000` confirmado con `COMMIT`; conteo final en la tabla de prueba: 0. Contenedor y objeto de prueba eliminados tras la verificación.
4. Corrido el script real (sin modificar) contra `telemetry_raw` de producción con el umbral real de 180 días: `Sin días candidatos (nada más viejo que 180 días). Nada que hacer.` — comportamiento correcto, ya que toda la telemetría real hoy tiene menos de 2 semanas; el job no borra nada porque no hay nada que archivar todavía, tal como debe ser.
5. `POST /api/platform/archive/run` sin sesión → `401 unauthorized` confirmado contra el backend real. No se pudo probar el camino admin autenticado end-to-end vía HTTP en esta sesión (requiere un usuario admin con biometría enrolada, no reproducible por `curl`) — la lógica de negocio que ese endpoint invoca (el script) ya está probada exhaustivamente por separado (puntos 1-4).

**Fuera de alcance de este cierre** (decisiones de negocio, no técnicas): política de retención real (2-7 años vs. el default de 180 días usado), programación periódica automática (cron), y si `mining_sensor_history` (solo 342 filas legacy de abril, no la tabla de ingesta real) también debe archivarse — el script está escrito para `telemetry_raw` (la tabla de producción real per ADR-007/008), extenderlo a `mining_sensor_history` es un cambio de una línea si se decide.
- No hay una fecha de retención objetivo confirmada por el negocio (2-7 años, per el texto de este ADR) que fije los parámetros exactos del job — implementarlo sin ese parámetro sería adivinar una política de retención de datos reales, una decisión de negocio, no técnica.

Si el negocio confirma la fecha/política de retención y decide adoptar Etapa 2 ahora, esto amerita su propia sesión dedicada con ventana de prueba, igual que la migración de hypertable de `mining_sensor_history`.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: datos

## Contexto

El sistema genera y consume objetos binarios: imágenes embebidas en informes, informes exportados (PDF/DOCX), capturas de mapa, y el histórico frío de telemetría que sale del plano HOT de TimescaleDB (ADR-006). La soberanía (ADR-001) prohíbe usar object storage en la nube. Se necesita una "nube de archivos" dentro de los servidores propios.

## Decisión

Usamos **MinIO** (S3-compatible, on-prem) como almacenamiento de objetos soberano para: informes exportados, assets binarios grandes y el **archivado Parquet** del histórico de telemetría (plano HISTÓRICO, retención 2-7 años) cuando sale del plano HOT de Timescale. MinIO es objetivo de Etapa 2 para el flujo completo de archivado; en v0.1 los binarios pequeños de informe pueden ir embebidos/en DB hasta su adopción.

### Reglas duras
- Acceso a MinIO solo desde el gateway / workers internos, nunca expuesto público.
- El histórico frío se archiva como Parquet (columnar, comprimido) para analítica futura.
- Las imágenes de informe se referencian por `@ref:` + manifest de binarios en el `.miningreport` (ver ADR-010), no como data-URL gigantes en la DB de negocio.

## Consecuencias

### Positivas
- Object storage S3-compatible sin salir de territorio (soberanía).
- Parquet habilita analítica posterior (DuckDB/Arrow) sin recargar TimescaleDB.

### Negativas / Trade-offs
- Otro servicio a operar/respaldar — contenido por Docker y por el plan de DR (BE3).
- Coherencia DB↔objeto debe gestionarse en aplicación (no hay transacción cross).

### Neutras
- S3-compatible permite migrar a otro backend compatible si hiciera falta, sin reescribir clientes.

## Alternativas descartadas

### Guardar binarios en PostgreSQL (bytea / large objects)
Simple, pero infla la DB de negocio, complica backups y no sirve para histórico Parquet. Se reserva solo para binarios chicos en v0.1.

### Object storage en la nube (S3/GCS)
Viola soberanía (ADR-001). Descartado.

### Filesystem plano en el VPS
Funciona, pero sin API S3, sin versionado ni políticas; MinIO da eso con poco costo.

## Referencias
- `Referencias/docs/02_Arquitectura/Arquitectura_Objetivo_Capas_AURIXA_v36.md` § 2
- `Referencias/frontend/src/components/ReportStudioV2/lib/miningReportFormat.js` (binaries `@ref:`)
- ADR-001 (soberanía), ADR-006 (retención), ADR-010 (modelo de documento)
