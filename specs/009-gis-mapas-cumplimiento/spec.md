# SPEC 009 — GIS: mapas operativos y cumplimiento territorial

| Campo | Valor |
|---|---|
| **ID** | 009 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | GIS con sensores/capas/zonas (S5-S6, R3); cartografía offline (OpenStreetMap+MBTiles) |
| **Constitución** | Art. 1 (multitenant), Art. 5 (observabilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-009**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
La operación necesita ubicar sensores, equipos y zonas sobre un mapa, y validar
**cumplimiento territorial** (intersección con polígonos oficiales/concesiones),
funcionando aun **sin internet** (zonas de baja conectividad — soberanía SOW).

## 2. Objetivo
Mapa operativo con marcadores (sensores/equipos), zonas oficiales y detección de
intersecciones de cumplimiento, servido con cartografía local (MBTiles).

## 3. Usuarios y contexto
- **Roles:** operador, supervisor, cumplimiento. **Multitenant:** marcadores/zonas
  por empresa. **Offline:** tiles servidos local (`tileserver`/MBTiles).

## 4. Alcance
**Incluye:** marcadores geo, zonas oficiales (GeoJSON), intersecciones de
cumplimiento, render con tiles locales. **NO incluye:** ruteo, edición de
concesiones (solo lectura de las oficiales).

## 5. Criterios de aceptación
- [ ] **CA-1:** `/api/map/markers` devuelve sensores/equipos del tenant con lat/lng/estado.
- [ ] **CA-2:** `/api/map/official-zones` sirve los polígonos oficiales (GeoJSON).
- [ ] **CA-3:** `/api/map/compliance-intersections` detecta si un marcador cae dentro/fuera de zona permitida.
- [ ] **CA-4:** El mapa renderiza con **tiles locales** (sin internet) vía tileserver.
- [ ] **CA-5:** (multitenant) Marcadores y zonas filtrados por empresa.
- [ ] **CA-6:** El cliente consulta marcadores por `bbox`, cancela consultas obsoletas y aplica `map_markers_diff` sin reconstrucción global.
- [ ] **CA-7:** Tiles propios cacheados se muestran inmediatamente y se revalidan en segundo plano; solicitudes obsoletas se abortan realmente.
- [ ] **CA-8:** WMS remoto cruza un proxy autenticado same-origin con HTTPS, allowlist exacta, bloqueo de IP privada, límite de tiempo/tamaño y métricas.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Funcionamiento offline | sí (tiles MBTiles locales) |
| Latencia de capa | < 20 ms (O1) en reconciliación de marcadores; sin espera de red para tile propio cacheado |
| Escalabilidad | estado y render limitados al viewport; actualización diferencial |
| Seguridad WMS | sin URL arbitraria, redirects ni destinos privados; respuesta solo `image/*` |

## 7. Contratos (endpoints reales)
- `GET /api/map/markers?bbox_lat=min,max&bbox_lng=min,max&limit=N`
- `GET /api/map/official-zones`, `GET /api/map/compliance-intersections`
- `GET /api/map/wms-proxy?source=https%3A...&service=WMS&request=GetMap...` (sesión requerida)
- WebSocket `/ws`, canal `map_markers_diff` (`added`, `updated`, `removed`).
- Tiles: `tileserver` (`/services/...`), datos en `MAPAS_DATA_ROOT`.

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| GeoJSON oficial desactualizado | versionado del dataset + fecha de vigencia |
| Cálculo de intersección costoso | índice espacial; pre-cálculo en ingesta |
| SSRF por URL WMS manual | HTTPS + allowlist exacta + validación DNS/IP previa a conexión |
| Saturación por zoom/pan | debounce, aborto, bbox con margen y reconciliación diferencial |
