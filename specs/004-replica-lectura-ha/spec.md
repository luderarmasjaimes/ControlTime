# SPEC 004 — Réplica de lectura y alta disponibilidad

| Campo | Valor |
|---|---|
| **ID** | 004 · **Estado** | **Aprobado (retroactivo)** |
| **SOW** | KPI **O5** (disponibilidad > 99.9%), Etapa 2 DR (S10) |
| **Constitución** | Art. 3 (aislamiento R/W), Art. 9 (recursos) |
| **Última revisión** | 2026-06-24 (auditado contra `docker-compose.yml` + réplica streaming) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-004**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
La analítica (dashboards, informes) y la ingesta compiten por la CPU del mismo
PostgreSQL; bajo carga, las consultas pesadas ahogan la escritura (se reprodujo:
ingesta perdiendo mensajes con la BD al 620%). Además, sin réplica no hay
camino de continuidad ante caída del primario (riesgo para el SLA 99.9%).

## 2. Objetivo
Disponer de una **réplica streaming** de la BD que: (a) absorba toda la lectura
analítica aislando al primario, y (b) sea base de continuidad/DR.

## 3. Usuarios y contexto
- **Roles:** sistema (dashboards/informes leen de la réplica). **Escala:** la
  réplica soporta ≥ 70 conexiones de lectura concurrentes.

## 4. Alcance
**Incluye:** réplica física por streaming replication, rol solo-lectura para
analítica, enrutamiento de dashboards/informes/SSE a la réplica.
**NO incluye:** failover automático (runbook DR manual en esta versión), sharding.

## 5. Criterios de aceptación
- [ ] **CA-1:** La réplica refleja escrituras del primario con **lag < 1 s** en operación normal.
- [ ] **CA-2:** Con 50+ dashboards en la réplica, el **primario permanece < 40% CPU** y la ingesta no pierde datos.
- [ ] **CA-3:** La réplica **rechaza escrituras** (read-only) — aislamiento garantizado.
- [ ] **CA-4:** Consistencia: `count(*)` primario = réplica tras drenar (verificado: 10,8M = 10,8M).
- [ ] **CA-5:** Existe runbook de promoción de réplica a primario (DR) con objetivo de recuperación < 15 min (SOW S10).
- [ ] **CA-6:** Parámetros de la réplica ≥ primario (max_connections, locks, workers) — arranca sin "insufficient parameter settings".

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Lag replicación | < 1 s |
| Disponibilidad | soporta SLA 99.9% (O5) |
| RTO (DR) | < 15 min (SOW) |

## 7. Contratos / infra
- Servicio `db_replica` (streaming, slot `replica_slot`).
- Rol `dashboard_ro` (solo lectura, `statement_timeout=15s`).
- `REPLICA_DATABASE_URL` para el backend (lecturas).

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Réplica saturada por analítica pesada | agregados materializados (002), `statement_timeout` |
| Disco duplicado (copia completa) | tiering a frío (003) acota el tamaño caliente |
| WAL reciclado antes de sincronizar | slot de replicación persistente |

> **Nota estructural:** El spec.md canónico es éste (`004-replica-lectura-ha/spec.md`).
> El archivo `004-replica-alta-disponibilidad/spec.md` es el original generado antes de
> consolidar el nombre del directorio. Este archivo es la versión actualizada y auditada.
