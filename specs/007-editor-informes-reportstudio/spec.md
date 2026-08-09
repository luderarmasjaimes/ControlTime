# SPEC 007 — Editor documental ReportStudio + exportación

| Campo | Valor |
|---|---|
| **ID** | 007 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | KPI **O2** (auto-guardado < 0.5 s), **O3** (export PDF/Word < 5 s) · S5, S7 (R3-R4) |
| **Constitución** | Art. 1 (multitenant), Art. 6 (trazabilidad/versionado) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-007**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
La operación minera produce informes técnicos en herramientas dispersas, sin
trazabilidad ni control de versiones. Se necesita un editor tipo Word, embebido,
con plantillas, datos de sensores y exportación, todo dentro de la plataforma.

## 2. Objetivo
Editor documental (ReportStudio) con experiencia familiar tipo Word: estilos,
tablas, plantillas, widgets de KPI/sensores, **auto-guardado < 0.5 s** y
**exportación a PDF/Word < 5 s**, con versionado y trazabilidad.

## 3. Usuarios y contexto
- **Roles:** analista, supervisor, gerente. **Multitenant:** informes por empresa.
- **Frontend:** `frontend/src/components/ReportStudioV2/`.

## 4. Alcance
**Incluye:** CRUD de proyectos/informes, edición rica, plantillas, widgets de
datos (KPI minero, sensores), auto-guardado, exportación, versionado.
**NO incluye:** colaboración en tiempo real multi-cursor, firma digital.

## 5. Criterios de aceptación
- [ ] **CA-1:** Auto-guardado de una operación de edición en **< 0.5 s** (O2).
- [ ] **CA-2:** Exportación de un informe a PDF/Word en **< 5 s** (O3).
- [ ] **CA-3:** (multitenant) Un usuario solo ve/edita informes de su empresa.
- [ ] **CA-4:** El informe puede incrustar **widgets de KPI/sensores** que reflejan dato real (vía 002).
- [ ] **CA-5:** Cada guardado crea versión trazable (quién, cuándo, qué cambió).
- [ ] **CA-6:** CRUD funciona: crear, listar, abrir, actualizar, borrar informe.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Auto-guardado | < 0.5 s (O2) |
| Exportación | < 5 s (O3) |
| Retraso de edición | < 20 ms (O1) |

## 7. Contratos (endpoints reales)
- `GET /api/projects`, `GET /api/reports`, `GET /api/reports/{id}`
- `POST /api/reports`, `PUT /api/reports/{id}`, `DELETE /api/reports/{id}`

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Export pesado bloquea el hilo | export asíncrono / worker; medir contra O3 |
| Pérdida de cambios sin conexión | integrar con modo offline (spec 014) |
