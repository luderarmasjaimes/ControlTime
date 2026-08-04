# ADR-005 — Dos bases de datos: `sensors_db` (TimescaleDB) + `formula_db` (PostgreSQL)

**Status**: implemented (verificado 2026-07-06: servicios `db` (TimescaleDB, `sensors_db`) y `formula_db` (Postgres 15) separados en `docker-compose.yml`, con `DATABASE_URL`/conexión de `formula_engine` independientes)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: datos

## Contexto

El sistema tiene dos perfiles de datos muy distintos: telemetría masiva append-only de sensores (series temporales, alta cardinalidad, 10k/seg objetivo) y datos operativos/relacionales (usuarios, informes, fórmulas, workflow, auditoría) con acceso transaccional. El modelo de datos v36 ya separa físicamente ambos: `sensors_db` sobre TimescaleDB y `formula_db`/operacional sobre PostgreSQL 15.

## Decisión

Mantenemos **dos bases de datos separadas**: `sensors_db` (TimescaleDB) para telemetría y series temporales; `formula_db` + esquema operacional (PostgreSQL 15) para negocio (usuarios, informes, revisiones, workflow, auditoría, fórmulas). El gateway C++ accede a ambas vía libpq con pools de conexión independientes (`storage/pg_pool.hpp`).

### Reglas duras
- La telemetría nunca se mezcla en tablas del esquema operacional ni viceversa.
- Joins entre ambos mundos se resuelven en la capa de aplicación (gateway), no con dblink/foreign data wrappers.
- Cada DB tiene su pool y su tamaño configurable.

## Consecuencias

### Positivas
- Aísla la carga de escritura masiva de telemetría del acceso transaccional de negocio.
- Permite políticas de retención/compresión agresivas en `sensors_db` sin afectar lo operacional (ver ADR-006).

### Negativas / Trade-offs
- No hay integridad referencial cross-DB; las relaciones sensor↔informe se mantienen por convención de aplicación (ver ADR-012).
- Dos backups/DR a coordinar — cubierto por BE3 en hardening.

### Neutras
- Ambas son PostgreSQL (TimescaleDB es extensión), así que comparten driver, tooling y operación.

## Alternativas descartadas

### Una sola base de datos
Más simple operativamente y con integridad referencial total, pero acopla la carga de telemetría a lo transaccional y complica retención/compresión selectiva. Se descarta por la escala objetivo.

### DB de series temporales no-SQL (InfluxDB)
Especializada, pero rompe la homogeneidad PostgreSQL, duplica tooling y complica los joins de negocio. TimescaleDB da series temporales sin salir de PostgreSQL.

## Referencias
- `Referencias/docs/02_Arquitectura/Modelo_Datos_AURIXA_v36.md`
- `Referencias/backend/src/storage/pg_pool.hpp`, `src/auth/auth_storage_pg.cpp`
- ADR-006 (hypertables/retención), ADR-012 (binding dato→widget)
