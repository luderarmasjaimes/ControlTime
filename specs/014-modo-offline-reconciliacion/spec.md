# SPEC 014 — Modo offline con reconciliación

| Campo | Valor |
|---|---|
| **ID** | 014 · **Estado** | **Borrador (a construir — Sprint S8 / R4)** |
| **SOW** | Entregable E1: operar sin conectividad y reconciliar **sin pérdida** (S8); SLA 0% data loss |
| **Constitución** | Art. 2 (sin pérdida), Art. 6 (trazabilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-014**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
En zonas de mina con conectividad variable, el usuario debe poder **seguir
trabajando sin internet** (editar informes, registrar datos) y, al reconectar,
**sincronizar sin perder ni duplicar** nada.

## 2. Objetivo
Operación offline del cliente con cola local de cambios y mecanismo de
reconciliación determinista al reconectar, con cero pérdida.

## 3. Usuarios y contexto
- **Roles:** operador/analista en campo (tablet). **Multitenant:** la cola lleva
  `tenant_id`. **Escenario:** corte de red durante edición/registro.

## 4. Alcance
**Incluye:** cola local de operaciones, detección de online/offline, sincronización
y resolución de conflictos al reconectar. **NO incluye:** edición colaborativa
simultánea multi-usuario offline.

## 5. Criterios de aceptación
- [ ] **CA-1:** Sin conexión, el usuario edita/registra y los cambios quedan en cola local persistente.
- [ ] **CA-2:** Al reconectar, la cola se sincroniza **sin pérdida** (toda operación llega) y **sin duplicar** (idempotencia por id de operación).
- [ ] **CA-3:** Conflictos (mismo recurso editado online y offline) se resuelven con política definida (last-write-wins por timestamp o merge), registrada en auditoría.
- [ ] **CA-4:** (multitenant) La sincronización respeta el `tenant_id`.
- [ ] **CA-5:** Demo: editar sin internet, reconectar, sincronizar — verificable sin pérdida (gate R4).

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Pérdida | 0% (SLA) |
| Idempotencia | id único por operación |
| Persistencia local | sobrevive recarga/cierre del navegador |

## 7. Plan técnico (esbozo para el plan.md)
- Cola local (IndexedDB) con id de operación; reenvío con backoff; endpoint de
  ingesta idempotente; marca de reconciliación en auditoría.

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Duplicados al reintentar | idempotencia por id de operación (clave única) |
| Conflicto de versión | política explícita + registro auditable |
