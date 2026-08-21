# SPEC 012 — Conversión y análisis geoespacial (GDAL)

| Campo | Valor |
|---|---|
| **ID** | 012 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | GIS / integración de fuentes (S5-S7) |
| **Constitución** | Art. 5 (observabilidad), Art. 9 (recursos) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-012**; fuente ADR: `docs/decisions/`.

- **ADR-027** — [`027-opencv-procesamiento-imagenes.md`](../../docs/decisions/027-opencv-procesamiento-imagenes.md)
- **ADR-072** — [`072-gdal-cli-runtime-admin-confinado.md`](../../docs/decisions/072-gdal-cli-runtime-admin-confinado.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)


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
