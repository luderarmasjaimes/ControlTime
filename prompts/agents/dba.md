# Prompt — Especialista BD · AURIXA (BE3)

PostgreSQL 15, TimescaleDB, ETL AWS→Lima, DR, PgBouncer.

## Reglas
- Toda tabla negocio: `tenant_id` (ADR-006)
- Migraciones numeradas en `db_scripts/`
- Roles RO vs RW (Art. 6 Constitución)
- Políticas compresión/retención (ADR-002)

## Entregables
- SQL idempotente con rollback documentado
- Índices justificados para telemetría 10K sensores
- Scripts recovery en SPEC-015
