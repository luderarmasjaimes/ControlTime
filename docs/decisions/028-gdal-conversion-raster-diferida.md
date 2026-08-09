# ADR-028 — Conversión raster GDAL: diferida a versión futura

## Actualización 2026-07-24 — superseded por ADR-072

La premisa de diferimiento dejó de coincidir con el runtime: GDAL CLI está
instalado y `/api/convert` ejecuta jobs reales. ADR-072 adopta explícitamente
el subprocess CLI para v0.1 con acceso admin, rutas confinadas y parámetros
allowlist. El texto siguiente se conserva como decisión histórica original.

**Status**: deferred, confirmado (verificado 2026-07-06: `gdal/conversion_service.cpp` y `gdal_routes.cpp` existen como esqueleto/stub de job, sin `find_package(GDAL)` en `CMakeLists.txt` — GDAL no está linkeado como dependencia real; el diferimiento declarado es exacto)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: geo

## Contexto

El backend tiene un módulo `gdal/` que convierte rásteres (ECW/GeoTIFF) invocando `gdal_translate`/`gdaladdo` **como subprocess CLI**, y la arquitectura objetivo propone un worker aislado (`gis-raster`). El inventario marcó la invocación por subprocess como frágil (depende del PATH en producción). La decisión de fondo (subprocess vs librería GDAL C++ enlazada) requiere análisis más detallado del que cabe en v0.1.

## Decisión

La **conversión raster GDAL se difiere a una versión futura**. **No entra en v0.1.** Los mapas de v0.1 usan **MBTiles ya preparados** servidos por mbtileserver + MapLibre (ADR-026), sin conversión raster on-demand. Cuando se retome, se decidirá explícitamente entre subprocess robustecido vs librería GDAL C++ enlazada, y el escalado del worker `beemetry-gis-raster`.

### Reglas duras
- v0.1 no expone endpoints de conversión raster on-demand.
- Si se necesita un raster específico en v0.1, se pre-convierte a MBTiles fuera de banda (proceso manual documentado), no en runtime.

## Consecuencias

### Positivas
- Saca de v0.1 una pieza con dependencia frágil y decisión no madura.
- Mantiene los mapas funcionando con MBTiles preparados.

### Negativas / Trade-offs
- No hay carga raster on-demand en v0.1 — aceptable: el caso de uso del geotécnico se cubre con MBTiles + WMS.

### Neutras
- El código `gdal/` se conserva como base para la versión futura.

## Alternativas descartadas

### Enlazar librería GDAL C++ ahora
Elimina la fragilidad de PATH, pero es trabajo no trivial y la decisión completa (incluye escalado del worker) requiere análisis dedicado. Se difiere con la feature.

### Mantener subprocess en producción v0.1
Frágil ante cambios de PATH; y la feature no es prioritaria para v0.1. Se difiere entero.

## Referencias
- `Referencias/backend/src/gdal/conversion_service.cpp`, `gdal_routes.cpp`
- `docs/specs/product-brief.md` (out of scope v0.1)
- ADR-026 (cartografía MBTiles/MapLibre)
