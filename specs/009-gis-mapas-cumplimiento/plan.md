# PLAN 009 — GIS: mapas y cumplimiento territorial

| Campo | Valor |
|---|---|
| **Spec** | `specs/009-gis-mapas-cumplimiento/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S5-S6 · R3 |
| **Constitución** | Art. 1 (multitenant), Art. 4 (datos por temperatura), Art. 6 (seguridad) |
| **Última revisión** | 2026-06-24 (auditado contra `map_routes.cpp`, `map_geo_intersect.hpp`) |

---

## 1. Enfoque técnico

**Capa GIS server-side** sin librerías de mapas pesadas en el backend. PostgreSQL
almacena puntos (lat/lng) y GeoJSON de zonas. La intersección punto-zona se calcula
con la función C++ `map_geo_intersect` (sin PostGIS requerido en v1). El frontend
recibe datos listos para pintar sobre Leaflet/MapboxGL.

## 2. Arquitectura

```
 PostgreSQL
   ├── map_markers    (id, type, lat, lng, name, status, updated_at, tenant_id)
   └── map_zones / official_zones (GeoJSON en BD o en fichero)

 Backend C++
   ├── GET /api/map/markers       ──► SELECT map_markers (scoped por tenant)
   ├── GET /api/map/official-zones ─► GeoJSON desde env/fichero o BD
   ├── GET /api/map/check-point   ──► map_geo_intersect.cpp (punto en zona)
   └── POST /api/map/markers      ──► INSERT/UPDATE marker
```

## 3. Modelo de datos

```sql
CREATE TABLE map_markers (
  id         SERIAL PRIMARY KEY,
  type       TEXT NOT NULL,         -- 'sensor', 'mina', 'infraestructura', etc.
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  name       TEXT NOT NULL,
  status     TEXT DEFAULT 'active',
  tenant_id  UUID,                  -- NULL = marcador global (no multitenant)
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Zonas oficiales (GeoJSON) — opcional: en BD o en fichero según env
CREATE TABLE official_zones (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  geojson    JSONB NOT NULL,
  zone_type  TEXT,   -- 'concesion', 'reserva', 'comunidad', etc.
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 4. Endpoints

| Método | Ruta | Lógica |
|---|---|---|
| GET | `/api/map/markers` | lista marcadores (scoped por tenant si sesión) |
| POST | `/api/map/markers` | crear/actualizar marcador |
| GET | `/api/map/official-zones` | GeoJSON de zonas oficiales (desde `OFFICIAL_ZONES_GEOJSON` env o BD) |
| GET | `/api/map/check-point` | `?lat=&lng=` → `{inside:bool, zones:[]}` |

## 5. Intersección geoespacial (`map_geo_intersect.cpp`)

Sin PostGIS, el backend implementa **point-in-polygon** (algoritmo ray-casting):
```cpp
bool pointInPolygon(double lat, double lng, const GeoJsonFeature &polygon);
```
Para zonas de concesión (polígonos simples), ray-casting es suficiente y tiene
complejidad O(vértices) — sin overhead de extensiones PG.

**Cuando usar PostGIS:** si las zonas se vuelven complejas (MultiPolygon, holes,
reproyección de coordenadas) → ADR-009-2 plantea migrar la intersección a PostGIS.

## 5b. Confirmación de código (`map_routes.cpp`)

Endpoints confirmados en `map_routes.cpp::registerRoutes`:
- `handleMapMarkers` → consulta tabla `map_markers` (confirmado)
- `handleOfficialZones` → lee archivo GeoJSON vía `OFFICIAL_ZONES_GEOJSON` env var o
  bien de `MAPAS_DATA_ROOT` (directorio raíz de mapas) — no usa `official_zones` en BD aún

**Env vars confirmadas:**
- `OFFICIAL_ZONES_GEOJSON` — ruta al archivo GeoJSON de zonas
- `MAPAS_DATA_ROOT` — directorio alternativo para archivos de mapa

## 6. Fuentes de datos GIS

- **Offline-first:** las zonas oficiales se cargan de un fichero GeoJSON
  (`OFFICIAL_ZONES_GEOJSON` env o `/data/official_zones.geojson`) al arrancar.
  → No hay round-trip a BD para cada check-point.
- **BD como fuente dinámica:** si la tabla `official_zones` tiene registros, el
  backend la usa en lugar del fichero (permite actualizar zonas sin reiniciar).
- **Fuente externa:** la conversión de formatos (.ECW, .SHP) a GeoJSON la hace
  spec 012 (GDAL). El resultado se carga en BD o en fichero.

## 7. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-009-1 | Ray-casting en C++ (no PostGIS) para v1 — suficiente para polígonos simples | Aceptado |
| ADR-009-2 | Migrar a PostGIS si zonas complejas (MultiPolygon) — forward-looking | Propuesto |
| ADR-009-3 | Zonas oficiales en fichero (offline-first) con BD como override | Aceptado |

## 8. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | `GET /api/map/markers` → lista con lat/lng/status | curl response |
| CA-2 | `GET /api/map/official-zones` → GeoJSON válido | `jq .type` |
| CA-3 | `GET /api/map/check-point?lat=&lng=` → `{inside:true, zones:[]}` | puntos dentro y fuera |
| CA-4 | Marcadores de empresa A no visibles desde empresa B | aislamiento |
| CA-5 | Sin fichero GeoJSON → endpoint devuelve GeoJSON vacío (no 500) | test sin env |
