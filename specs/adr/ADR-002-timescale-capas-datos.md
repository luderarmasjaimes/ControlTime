# ADR-002 — TimescaleDB y capas caliente / templado / frío

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI + DBA |
| **Features** | `001`, `003`, `004`, `015`, `016` |

## Contexto
Telemetría minera genera millones de puntos/día. Consultas analíticas no pueden escanear datos calientes sin afectar ingesta (Art. 3 Constitución).

## Decisión
**TimescaleDB (PostgreSQL 15)** como primario con:
- **Caliente:** chunks recientes sin comprimir + continuous aggregates
- **Templado:** compresión columnar (días–1 año)
- **Frío:** MinIO/S3 Parquet (>1 año) — SPEC-003

Réplica de lectura (`db_replica`) + PgBouncer para dashboards.

## Consecuencias
- Migraciones en `db_scripts/`; políticas en `docs/02_Arquitectura/sql/30_timescale_policies.sql`
- SPEC-004 y SPEC-015 dependen de esta decisión
