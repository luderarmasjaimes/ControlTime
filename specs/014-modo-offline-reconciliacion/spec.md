# SPEC 014 — Modo offline con reconciliación

| Campo | Valor |
|---|---|
| **ID** | 014 · **Estado** | **Borrador (a construir — Sprint S8 / R4)** |
| **SOW** | Entregable E1: operar sin conectividad y reconciliar **sin pérdida** (S8); SLA 0% data loss |
| **Constitución** | Art. 2 (sin pérdida), Art. 6 (trazabilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-014**; fuente ADR: `docs/decisions/`.

- **ADR-022** — [`022-offline-cola-versionada-indexeddb.md`](../../docs/decisions/022-offline-cola-versionada-indexeddb.md)
- **ADR-026** — [`026-cartografia-offline-mbtiles-maplibre.md`](../../docs/decisions/026-cartografia-offline-mbtiles-maplibre.md)
- **ADR-045** — [`045-edicion-offline-sqlite-cliente.md`](../../docs/decisions/045-edicion-offline-sqlite-cliente.md)
- **ADR-056** — [`056-csp-service-worker-tiles-mapa.md`](../../docs/decisions/056-csp-service-worker-tiles-mapa.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)


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
