# TASKS 024 — GEOCATMIN: Integración Total INGEMMET y Acceso Directo por Unidad Minera

| Campo | Valor |
|---|---|
| **Plan** | Sin `plan.md` formal todavía (ver T19) — implementación ya construida el 2026-08-20 (ADR-121/123), documentada retroactivamente en este `tasks.md` el 2026-09-12 tras la auditoría de conformidad que encontró `spec.md` sin descomponer. |
| **Sprint·Release** | S5-S6 · R3 (fecha real de implementación, ADR-121/123: 2026-08-20) |
| **Responsables** | FE1 (`GeocatminWorkbench.tsx`/frontend), QA |
| **Última revisión** | 2026-09-12 — alta formal de tasks.md, cada tarea verificada contra el código real (no contra la prosa del ADR/spec) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Catálogo tipado de capas INGEMMET (`geocatminCatalog.ts`), 7 categorías temáticas (`GEOCATMIN_CATEGORIES`) | CA-3 | FE1 | Sonnet | ☑ |
| **T2** | `geocatminService.ts`: cliente REST directo (sin proxy backend) a ArcGIS de INGEMMET — query, identify, overlap, conversión geodésica | CA-4,CA-5,CA-7 | FE1 | **Opus** (geodesia/geometría) | ☑ |
| **T3** | `GeocatminWorkbench.tsx`: suite operativa sin pantalla de bienvenida ni botón "Ingresar" | CA-1 | FE1 | Sonnet | ☑ |
| **T4** | Centrado automático vía `fetchCompanyLocation()` (`/api/map/company-location`, ADR-121) con fallback a `MINING_LOCATIONS` | CA-2 | FE1 | Sonnet | ☑ |
| **T5** | Buscador de concesiones por Nombre / Código Único / Titular contra ArcGIS en vivo | CA-4 (parcial) | FE1 | Sonnet | ☑ |
| **T6** | Buscador por Cuadrícula IGN y por Coordenadas directas (UTM/WGS84) | CA-4 (parcial) | FE1 | — | ☐ |
| **T7** | Pre-evaluación de superposición con concesiones colindantes y ANP (`evaluateSpatialOverlap`) | CA-5 | FE1 | **Opus** (geometría espacial) | ☑ |
| **T8** | Herramientas de medición (distancia/polígono) y buffer/radio de influencia (100m–5km) | CA-6 | FE1 | Sonnet | ☑ |
| **T9** | Identificación de atributos (Identify) al clic sobre catastro/geología/ANP (`identifyPoint`) | CA-7 | FE1 | Sonnet | ☑ |
| **T10** | Conversor de coordenadas UTM ↔ WGS84 ↔ PSAD56 integrado en pantalla | CA-4,CA-6 | FE1 | **Opus** (geodesia) | ☑ |
| **T11** | Centro de descargas oficiales: shapefiles reales por zona UTM (17S/18S/19S) | CA-8 | FE1 | Sonnet | ☑ |
| **T12** | Exportación cartográfica de alta resolución (canvas → PNG, integrable a ReportStudioV2 vía `onCaptureComplete`) | CA-8 | FE1 | Sonnet | ☑ |
| **T13** | Modo dual conmutable: Suite Nativa ↔ Portal Oficial Live (`MiningGeoportalView.tsx`) | ADR-123 pt.4 | FE1 | Haiku | ☑ |
| **T14** | **Test**: conversión UTM↔WGS84 ida y vuelta (Antamina 18S, Toquepala 19S) — `geocatminService.test.ts` | CA-4,CA-6 | QA | — | ☑ |
| **T15** | **Test**: búsqueda de concesiones (Nombre/Código Único/Titular) — sin cobertura automatizada hoy | CA-4 | QA | — | ☐ |
| **T16** | **Test**: pre-evaluación de superposición con geometría conocida — sin cobertura automatizada hoy | CA-5 | QA | — | ☐ |
| **T17** | **Test**: identify al clic devuelve atributos esperados — sin cobertura automatizada hoy | CA-7 | QA | — | ☐ |
| **T18** | Auditar y corregir el conteo declarado de "134 servicios REST" (spec.md, ADR-123, cabecera de la UI) — el catálogo real tiene **38 capas** con `restUrl` (28%); `badgeCount` por categoría (suma 107) tampoco coincide con las 38 reales | catálogo | FE1 | — | ☐ |
| **T19** | Alta formal de `plan.md` para SPEC-024 (hoy solo existe `spec.md` + este `tasks.md` retroactivo) | proceso | — | — | ☐ |

## Secuencia

```
T1 ─► T2                          (catálogo → cliente REST)
T3 ─► T4                          (workbench sin fricción → centrado por tenant)
T2 ─► T5, T6                      (búsqueda)
T2 ─► T7                          (pre-evaluación, reusa query de concesiones)
T8, T9, T10                       (herramientas espaciales, independientes entre sí)
T11, T12                          (descargas/exportación, independientes)
T13                               (modo dual, post T3)
(T5,T7,T9) ─► T14-T17             (tests, T14 ya cerrado)
T18, T19                          (deuda documental/catálogo, no bloquea producto)
```

## Definition of Done

- [x] CA-1: ingreso directo sin pantalla de bienvenida ni confirmación — verificado en código, `GeocatminWorkbench.tsx` no tiene ningún gate previo al render de la suite.
- [x] CA-2: centrado automático en la mina activa del tenant (`/api/map/company-location`, fallback `MINING_LOCATIONS`) — verificado en código.
- [x] CA-3: árbol de capas con 7 categorías oficiales — verificado en código (`GEOCATMIN_CATEGORIES`, 7 entradas).
- [ ] CA-4: buscador de concesiones — **parcial**. Nombre / Código Único / Titular funcionan contra ArcGIS en vivo; falta búsqueda por Cuadrícula IGN y por coordenadas directas (T6).
- [x] CA-5: pre-evaluación de superposición con concesiones colindantes y áreas protegidas — verificado en código (`evaluateSpatialOverlap`, UI de alerta de colisiones).
- [x] CA-6: medición de distancias/áreas y generación de buffer/radio de influencia — verificado en código.
- [x] CA-7: identificación de atributos (Identify) al clic — verificado en código (`identifyPoint`, resultados en panel de inspección).
- [x] CA-8: descarga de shapefiles oficiales por zona UTM y exportación cartográfica de alta resolución — verificado en código (enlaces `<a href>` reales a INGEMMET + captura de canvas real, no simulada).
- [ ] Cobertura de test automatizado — solo la conversión UTM/WGS84 tiene test (T14); búsqueda, superposición e identify (T15-T17) solo están verificadas por lectura de código, no por test.
- [ ] Catálogo declarado como "134 servicios REST" (spec.md, ADR-123, cabecera de la UI) — el catálogo real tiene 38 capas con `restUrl` propio (28% de lo declarado); corregir el número declarado o completar el catálogo (T18).
- [ ] `plan.md` formal de SPEC-024 (T19) — no existe todavía.
- [x] ADR-121/123 registrados y referenciados en `specs/REGISTRY.md`.

**Nota de alcance**: esta implementación llama en vivo, desde el navegador, directamente a los servicios ArcGIS públicos de `geocatmin.ingemmet.gob.pe` — no hay proxy backend propio para GEOCATMIN (a diferencia de mapas/WMS, ADR-121, que sí tiene proxy). Es una dependencia externa real (ver "Soberanía y Resiliencia" en ADR-123): si INGEMMET cambia o retira un servicio REST, la funcionalidad correspondiente se degrada sin aviso de este lado.
