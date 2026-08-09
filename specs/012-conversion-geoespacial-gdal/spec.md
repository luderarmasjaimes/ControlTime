# SPEC 012 — Conversión y análisis geoespacial (GDAL)

| Campo | Valor |
|---|---|
| **ID** | 012 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | GIS / integración de fuentes (S5-S7) |
| **Constitución** | Art. 5 (observabilidad), Art. 9 (recursos) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-012**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
Las fuentes geoespaciales llegan en formatos diversos (raster/vector) que deben
convertirse y analizarse para alimentar el mapa (009) y los análisis de núcleo
minero, de forma asíncrona y trazable.

## 2. Objetivo
Servicio de conversión geoespacial (GDAL) con jobs asíncronos y endpoints de
capacidades, conversión y análisis de núcleo.

## 3. Usuarios y contexto
- **Roles:** analista GIS, sistema (conversión automatizada). **Multitenant:** jobs
  y análisis tienen scope por empresa cuando aplica.
- **Asíncrono:** conversiones largas se encolan como jobs; el cliente hace polling
  de `/api/jobs/{id}` o recibe callback.

## 4. Alcance
**Incluye:** conversión de formatos, jobs asíncronos, análisis de imágenes/núcleo.
**NO incluye:** edición cartográfica interactiva (009).

## 5. Criterios de aceptación
- [ ] **CA-1:** `GET /api/capabilities` lista formatos/operaciones soportadas.
- [ ] **CA-2:** `POST /api/convert` crea un job y devuelve su id; `GET /api/jobs/{id}` informa estado.
- [ ] **CA-3:** `POST /api/analyze-core` ejecuta el análisis y devuelve resultado.
- [ ] **CA-4:** Conversión usa todos los hilos disponibles de forma acotada (no satura el backend).
- [ ] **CA-5:** Health del servicio en `/health`.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Procesamiento | asíncrono (jobs) |
| Recursos | acotado (no compite con ingesta) |

## 7. Contratos (endpoints reales)
- `GET /health`, `GET /api/capabilities`, `GET /api/demo-data`, `GET /api/demo-image/`
- `POST /api/convert`, `GET /api/jobs/{id}`, `POST /api/analyze-core`

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Conversión larga bloquea recursos | jobs en cola + límites; timeouts |
