# ADR-026 — Cartografía offline: MBTiles + mbtileserver + Leaflet (superseded: MapLibre GL)

**Status**: implemented (revisado y completado 2026-07-07 — ver "Revisión" abajo)
**Fecha**: 2026-06-24
**Revisado**: 2026-07-07
**Autores**: EC
**Ámbito**: geo

## Revisión (2026-07-07)

La verificación de código encontró un mismatch: este ADR decidía MapLibre GL como motor 2D principal, pero **todo el frontend real usa Leaflet** (`MapViewer.tsx`, `DetailedMap.tsx`, `MiningGeoportalView.tsx` — `import L from 'leaflet'`, `L.map()`/`L.tileLayer()`/`L.marker()`/`L.geoJSON()`). Cero imports de MapLibre GL existen en el repo; nunca se instaló como dependencia.

Decisión de cierre: **se acepta Leaflet como motor real y se da de baja la elección de MapLibre GL**, en vez de forzar una migración de librería de mapas. Motivo — migrar a MapLibre GL a esta altura implicaría reescribir `MapViewer.tsx`, `DetailedMap.tsx` y `MiningGeoportalView.tsx` (los tres con lógica de capas WMS, marcadores, GeoJSON de cumplimiento territorial ya construida y en producción sobre la API de Leaflet) sin ninguna ganancia funcional inmediata — el argumento original a favor de MapLibre GL (mejor rendimiento con vector tiles a gran escala) no está bloqueando ningún caso de uso actual del producto. El costo/riesgo de una reescritura de UI de mapas supera el beneficio teórico. Si en el futuro el volumen de datos vectoriales exige el rendimiento superior de MapLibre GL, eso amerita su propio ADR con justificación concreta de performance, no una corrección retroactiva de este documento.

Lo que **sí** se mantiene sin cambios de la decisión original: MBTiles servido offline vía `mbtileserver` (`tileserver` en `docker-compose.yml`, confirmado consultado por el frontend), prohibición de tiles online de proveedores (Google/Mapbox/OSM público), y el bloque `map` del informe (ADR-020) referenciando este stack.

## Reconciliación 2026-07-24 con ADR-056

La frase "prohibición de tiles online" se interpreta como **prohibición de
dependencia operativa**, no como prohibición de enriquecimiento conectado.
ADR-056 implementó base satelital/WMS externos con Service Worker y caché:
pueden mejorar la vista cuando hay red, pero la operación offline debe
mantener MBTiles/último caché disponible. No se autoriza presentar una capa
externa no cacheada como requisito para trabajar en campo.

## Contexto

El producto necesita mapas operativos que funcionen sin internet (soberanía + offline, ADR-001/022) y rendir capas WMS corporativas y sensores. El código real usa **Leaflet** como motor 2D (confirmado en `MapViewer.tsx`, `DetailedMap.tsx`, `MiningGeoportalView.tsx`) y un **mbtileserver** sirviendo MBTiles. Hay catálogos WMS corporativos (`wmsCorporateCatalog.json`) y un hub de geoportal.

## Decisión

La cartografía se sirve **offline desde MBTiles vía mbtileserver**, y se renderiza con **Leaflet** en el frontend (motor real, ver Revisión arriba). Las capas corporativas WMS y de sensores se superponen sobre la base MBTiles vía la API de capas de Leaflet (`L.tileLayer`, `L.geoJSON`, `L.marker`).

### Reglas duras
- Prohibido depender de tiles de proveedores online (Google/Mapbox/OSM público) para operación (viola soberanía).
- El bloque `map` del informe (ADR-020) referencia capas de este stack (MBTiles/WMS), no tiles online.
- Leaflet es el motor de mapas 2D de la plataforma; no introducir una segunda librería de mapas sin un ADR que lo justifique con un caso de uso concreto que Leaflet no pueda cubrir.

## Consecuencias

### Positivas
- Cartografía detallada sin internet → cumple soberanía y offline.
- Leaflet ya está integrado y probado en las tres vistas de mapa del producto (satelital, geotécnico HD, geoportal institucional) — cero riesgo de regresión por reescritura de librería.
- Ecosistema maduro de plugins Leaflet (WMS, GeoJSON, marcadores clusterizados) ya en uso.

### Negativas / Trade-offs
- Preparar/actualizar MBTiles es un proceso propio (no hay tiles "infinitos" de un proveedor) — aceptable y necesario para soberanía.
- Leaflet renderiza en Canvas/SVG, no WebGL — con volúmenes muy grandes de datos vectoriales podría rendir peor que MapLibre GL. No es un problema medido hoy; si aparece, amerita su propio ADR (ver Revisión).

### Neutras
- La conversión raster (ECW/GeoTIFF → tiles) está diferida (ADR-028); en v0.1 se usan MBTiles ya preparados.

## Alternativas descartadas

### Tiles online (Mapbox/Google)
Cómodo, pero viola soberanía y requiere internet. Rechazado.

### Migrar a MapLibre GL (decisión original de este ADR, revertida 2026-07-07)
Era la decisión original. Revertida porque el código ya construyó tres vistas de mapa completas sobre Leaflet sin que MapLibre GL llegara a adoptarse — forzar la migración ahora es una reescritura de alto riesgo sin beneficio funcional demostrado. Ver "Revisión" arriba.

## Referencias
- `frontend/src/components/Special/MapViewer.tsx`, `DetailedMap.tsx`, `MiningGeoportalView.tsx`
- `frontend/src/config/wmsCorporateCatalog.json`, `miningGeoportalHub.json`
- ADR-001 (soberanía), ADR-020 (mapa tipado), ADR-028 (GDAL diferido)
