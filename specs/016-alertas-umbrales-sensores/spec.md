# SPEC 016 — Alertas y umbrales por sensor

| Campo | Valor |
|---|---|
| **ID** | 016 · **Estado** | **Borrador (a construir)** |
| **SOW** | Respuesta ordenada ante alarmas/incidentes (valor de negocio §1.2); O1 |
| **Constitución** | Art. 1 (multitenant), Art. 2 (tiempo real), Art. 5 (observabilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-016**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
Los valores de sensores fuera de rango (vibración, gas, temperatura) representan
riesgos de seguridad de mina. El operador debe ser **alertado en tiempo real**
cuando un sensor cruza un umbral, sin revisar manualmente miles de lecturas.

## 2. Objetivo
Motor de reglas de umbral por sensor/tipo/empresa que genera alertas en tiempo
real sobre el flujo de ingesta y las notifica al dashboard.

## 3. Usuarios y contexto
- **Roles:** operador, supervisor de seguridad. **Multitenant:** reglas por empresa.
- **Tiempo real:** evaluar contra el stream de ingesta (no por polling).

## 4. Alcance
**Incluye:** definición de umbrales (min/max/tasa de cambio) por sensor/tipo,
evaluación en tiempo real, generación y entrega de alerta (push), historial de
alertas. **NO incluye:** acciones automáticas de control (solo notifica).

## 5. Criterios de aceptación
- [ ] **CA-1:** Una lectura que cruza un umbral genera una alerta en **< 2 s** desde su ingesta.
- [ ] **CA-2:** Las reglas son configurables por sensor/tipo/empresa (CRUD).
- [ ] **CA-3:** La alerta se entrega al dashboard por push (SSE, spec 005) sin recargar.
- [ ] **CA-4:** (multitenant) Reglas y alertas aisladas por empresa.
- [ ] **CA-5:** Toda alerta queda en historial auditable (quién, cuándo, valor, regla).
- [ ] **CA-6:** Evitar tormenta de alertas: debounce/agrupación configurable.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Latencia alerta | < 2 s |
| Evaluación | sobre el flujo (consumidor Kafka o trigger) |

## 7. Plan técnico (esbozo)
- Reglas en BD; evaluación en el consumidor de ingesta (reusa pipeline 001) o
  trigger SQL; alertas a tabla + push SSE; agрupación por ventana.

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Tormenta de alertas | debounce + agrupación por ventana |
| Evaluación añade latencia a la ingesta | evaluar en consumidor aparte, no en el COPY |
