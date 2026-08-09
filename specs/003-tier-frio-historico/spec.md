# SPEC 003 — Tier frío histórico (> 1 año) en S3/MinIO

| Campo | Valor |
|---|---|
| **ID** | 003 · **Estado** | **Aprobado (retroactivo)** |
| **SOW** | KPI O5 (estabilidad/almacenamiento masivo), Art. arquitectura (MinIO) · Etapa 2 |
| **Constitución** | Art. 4 (capas por temperatura), Art. 9 (recursos acotados) |
| **Última revisión** | 2026-06-24 (auditado contra `docker-compose.yml` + MinIO — spec precisa) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-003**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
A 1.000 filas/s, la telemetría crece ~3,5 GB/día comprimido (≈ 1,3 TB/año). El
primario no debe cargar con datos de años que casi nunca se consultan, pero esos
datos deben conservarse (auditoría, cumplimiento, análisis histórico).

## 2. Objetivo
Mover automáticamente la telemetría **> 1 año** a almacenamiento de objetos
(MinIO/S3) en formato columnar comprimido, **manteniéndola consultable** y
liberando el almacenamiento caliente.

## 3. Usuarios y contexto
- **Roles:** analista, auditoría, cumplimiento. **Multitenant:** el archivado
  preserva `tenant_id`. **Frecuencia de consulta:** baja (mensual/auditorías).

## 4. Alcance
**Incluye:** export de chunks > 1 año a Parquet (ZSTD) en bucket S3, eliminación
de esos chunks del hypertable, consulta del frío vía DuckDB/Athena.
**NO incluye:** tier caliente/templado (parte de 001), reportes (007).

## 5. Criterios de aceptación
- [ ] **CA-1:** Chunks > 1 año se exportan a `s3://telemetry-cold/` particionados por mes.
- [ ] **CA-2:** Tras exportar y verificar, los chunks se eliminan del primario (libera disco).
- [ ] **CA-3:** El dato frío es **consultable** (avg/min/max por rango) sin restaurar.
- [ ] **CA-4:** Ratio de compresión ≥ 10× vs almacenamiento en PostgreSQL.
- [ ] **CA-5:** (multitenant) El export preserva e indexa por `tenant_id`.
- [ ] **CA-6:** El job no toca el primario para LEER (usa la réplica).

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Compresión | ≥ 10× (medido: ~30× en Parquet ZSTD) |
| Impacto en primario | nulo en lectura (usa réplica) |
| Retención frío | configurable (default sin borrado) |

## 7. Contratos
- Job `scripts/archive_cold_tier.sh` (programable): réplica → DuckDB → Parquet → MinIO → `drop_chunks`.
- Bucket `telemetry-cold`, layout `telemetry/mes=YYYY-MM/*.parquet`.

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Export incompleto antes del drop | verificar conteo en S3 antes de `drop_chunks` |
| MinIO se llena | política de lifecycle / monitoreo de bucket |
