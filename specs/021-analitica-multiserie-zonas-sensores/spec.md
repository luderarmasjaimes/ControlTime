# SPEC-021 — Analítica multiserie y catálogo de sensores por zona

| Campo | Valor |
|---|---|
| **Estado** | Implementación técnica; aceptación integrada pendiente |
| **ADR** | ADR-109 |
| **Sprint / release** | S6-S8 · R3-R4 |
| **Última revisión** | 2026-08-18 |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-021**; fuente ADR: `docs/decisions/`.

- **ADR-057** — [`057-dashboard-widgets-estilo-thingsboard.md`](../../docs/decisions/057-dashboard-widgets-estilo-thingsboard.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-109** — [`109-catalogo-zonas-sensores-graficos-multiserie.md`](../../docs/decisions/109-catalogo-zonas-sensores-graficos-multiserie.md)

## Objetivo

Permitir que un usuario autorizado seleccione sensores reales por tipo, zona
y dispositivo, consulte series históricas con agregación segura e inserte una
o varias visualizaciones comparables en ReportStudio.

## Alcance

- Catálogo multitenant de zonas y asociación de sensores.
- Agrupación por dispositivo físico y magnitud.
- Consulta `raw/hourly/daily`, máximo 90 días y degradación automática de raw.
- Gráficos línea, barra, área, scatter, step, radar, pie, donut, heatmap y boxplot.
- Integración con informes y exportación; seeds sintéticos identificados.

No incluye gemelo digital, interpolación geoespacial 3D ni certificación de
modelos predictivos.

## Criterios de aceptación

- [x] **CA-1:** Existe catálogo de zonas aislado por `tenant_id` y `SIN-ZONA`.
- [x] **CA-2:** La API agrupa sensores por tipo/zona/dispositivo físico.
- [x] **CA-3:** La API limita rangos y degrada raw >7 días; máximo 90 días.
- [ ] **CA-4:** Prueba automatizada demuestra 403/404 al consultar sensores de otro tenant.
- [x] **CA-5:** El frontend permite seleccionar múltiples sensores y tipos de gráfico.
- [ ] **CA-6:** Los diez tipos se validan visualmente con series vacías, parciales y completas.
- [ ] **CA-7:** PDF/PPTX conserva título, leyenda, unidades y colores por sensor.
- [ ] **CA-8:** Build backend y prueba contractual API quedan en CI.
- [x] **CA-9:** Los datos demo están marcados como sintéticos y separados de evidencia productiva.

## Riesgos

- Mezclar magnitudes/unidades incompatibles puede inducir conclusiones falsas;
  la UI debe advertir o separar ejes.
- Heatmap/radar requieren transformación agregada; no deben fingir precisión
  espacial o estadística no presente en los datos.
- La asignación automática por cuadrantes es un seed/fallback, no cartografía
  operacional aprobada por la minera.
