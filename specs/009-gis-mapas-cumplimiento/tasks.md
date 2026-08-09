# TASKS 009 — GIS: mapas y cumplimiento territorial

| Campo | Valor |
|---|---|
| **Plan** | `specs/009-gis-mapas-cumplimiento/plan.md` |
| **Sprint·Release** | S5-S6 · R3 |
| **Responsables** | BE1 (routes/C++), BE3 (DBA/GIS), FE1 (mapa frontend), QA |
| **Última revisión** | 2026-08-03 (optimización de zoom, escala de marcadores y proxy WMS seguro) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Schema SQL: `map_markers` (lat, lng, tenant_id, type, status) | CA-1,CA-4 | BE3 | Haiku | ☑ |
| **T2** | Schema SQL: `official_zones` (GeoJSON en JSONB) | CA-2 | BE3 | Haiku | ☑ |
| **T3** | `map_geo_intersect.cpp`: ray-casting point-in-polygon | CA-3 | BE1 | **Opus** (geometría) | ☑ |
| **T4** | `handleMapMarkers`: SELECT con tenant_id de sesión | CA-1,CA-4 | BE1 | Sonnet | ☑ |
| **T5** | `handleOfficialZones`: GeoJSON desde env/fichero o BD | CA-2,CA-5 | BE1 | Sonnet | ☑ |
| **T6** | `handleCheckPoint`: GET `?lat=&lng=` → intersección | CA-3 | BE1 | Sonnet | ☑ |
| **T7** | `POST /api/map/markers` — crear/actualizar marcador | CA-1 | BE1 | Sonnet | ☑ |
| **T8** | `map_routes.cpp` — registro de rutas en router | CA-1..5 | BE1 | Haiku | ☑ |
| **T9** | Carga de GeoJSON inicial desde `OFFICIAL_ZONES_GEOJSON` env | CA-2,CA-5 | SYS | Haiku | ☑ |
| **T10** | Frontend: render Leaflet/MapboxGL con markers + zones | CA-1,CA-2 | FE1 | Sonnet/ChatGPT | ☐ |
| **T11** | Frontend: highlight zona al hacer check-point | CA-3 | FE1 | Sonnet | ☐ |
| **T12** | **Test CA-1**: GET markers → lista con lat/lng | CA-1 | QA | — | ☑ |
| **T13** | **Test CA-2**: GET official-zones → GeoJSON válido | CA-2 | QA | — | ☑ |
| **T14** | **Test CA-3**: check-point dentro de zona → `inside:true` | CA-3 | QA | — | ☑ |
| **T15** | **Test CA-4**: empresa A no ve markers de empresa B | CA-4 | QA | — | ☑ |
| **T16** | **Test CA-5**: sin fichero GeoJSON → 200 con GeoJSON vacío | CA-5 | QA | — | ☑ |
| **T17** | Migración a PostGIS (MultiPolygon, reproyección) — ADR-009-2 | futuro | BE3 | **Opus** | ☐ |
| **T18** | Service Worker stale-while-revalidate + aborto real; capa base sin doble creación | CA-7 | FE1 | Sonnet/ChatGPT | ☑ |
| **T19** | Bbox con margen, debounce/abort, diffs WS y capas Leaflet diferenciales | CA-6 | FE1 | **Opus** | ☑ |
| **T20** | Proxy WMS autenticado con controles SSRF, límites, métricas y tests | CA-8 | BE1/QA | **Opus** | ☑ |

## Secuencia

```
T1 ─► T2                       (schemas)
T3 ─► T6                       (geo engine → check-point)
T4 ─► T5 ─► T7 ─► T8 ─► T9   (routes + carga de datos)
(T1-T9) ─► T12-T16 (tests)
T10, T11 (frontend, post-backend)
T17 (futuro/Etapa 2)
```

## Definition of Done

- [x] T1-T9, T12-T16 completadas.
- [x] CA-1..5 demostrados.
- [ ] Frontend Leaflet (T10, T11) — pendientes.
- [ ] PostGIS migration (T17) — Etapa 2.
- [x] ADR-009-1..3 registrados.
