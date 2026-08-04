# SPEC 015 — DR, respaldo geográfico y continuidad

| Campo | Valor |
|---|---|
| **ID** | 015 · **Estado** | **Borrador (a construir — Sprint S10 / R5)** |
| **SOW** | KPI **O5** (uptime > 99.9%); DR con simulacro < 15 min (S10) |
| **Constitución** | Art. 2 (sin pérdida), Art. 9 (recursos) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-015**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
Ante fallo del primario (hardware, datacenter), la plataforma debe recuperarse
rápido y **sin perder datos**, sosteniendo el SLA 99.9% (≈ 8,7 h/año de
indisponibilidad máxima).

## 2. Objetivo
Plan de recuperación ante desastres: respaldos consistentes, réplica promovible a
primario, y runbook con **RTO < 15 min** y **RPO ≈ 0**.

## 3. Usuarios y contexto
- **Roles:** SysOps, BE3 (runbook), Gerencia TI (decisión de failover).
- **Frecuencia:** simulacro anual; backups diarios; réplica continua (de 004).
- **Scope:** cubre BD + almacenamiento de objetos (MinIO) + servicios del stack.

## 4. Alcance
**Incluye:** backups periódicos (BD + objetos), réplica (de 004) como standby
promovible, runbook de DR, respaldo geográfico. **NO incluye:** failover
totalmente automático (esta versión es promoción asistida).

## 5. Criterios de aceptación
- [ ] **CA-1:** Existen backups periódicos verificables de BD y MinIO, con restauración probada.
- [ ] **CA-2:** Simulacro de DR (caída del primario → promoción de réplica) se completa en **< 15 min** (RTO).
- [ ] **CA-3:** Pérdida de datos en el simulacro **≈ 0** (RPO) gracias a streaming + log durable (Kafka).
- [ ] **CA-4:** Runbook documentado y ejecutable por SYS/BE3 sin el autor original.
- [ ] **CA-5:** Respaldo en ubicación geográfica distinta del primario.
- [ ] **CA-6:** Monitoreo alerta de lag de réplica / fallo de backup.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| RTO | < 15 min (SOW) |
| RPO | ≈ 0 |
| Uptime objetivo | > 99.9% (O5) |

## 7. Plan técnico (esbozo)
- `pg_basebackup`/WAL archiving; promoción de `db_replica`; backups MinIO con
  versionado; Kafka como buffer durante el corte; runbook paso a paso.

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Simulacro DR falla (S10) | segundo intento con buffer S11; runbooks ensayados |
| Backup corrupto | restauración periódica de verificación |
