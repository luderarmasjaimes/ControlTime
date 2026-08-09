# ADR-020 — Mapa como bloque tipado con referencia geoespacial

> **Actualización 2026-07-24:** donde el texto histórico menciona MapLibre,
> léase Leaflet + MBTiles conforme a la revisión vigente de ADR-026. Esto no
> cambia la decisión de snapshot v0.1 ni el bloque tipado futuro.

**Status**: implemented, alcance v0.1 (verificado 2026-07-06: `MapCaptureModal.tsx` captura el mapa como imagen (`imageDataUrl`) e inserta un elemento `image`, no un bloque `map` tipado — coincide exactamente con lo declarado). Bloque `map` tipado con referencia geoespacial real sigue diferido, tal como el ADR ya anticipaba.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

El informe minero incluye mapas operativos (ubicación de sensores, zonas, taludes). Hoy el mapa se inserta capturándolo a imagen (`MapCaptureModal` → bloque `image`), lo que **pierde la referencia geoespacial**: el bloque queda como un PNG sin coordenadas, capa ni fuente; no se puede re-renderizar, actualizar ni auditar qué zona muestra.

## Decisión

**En v0.1, el mapa se inserta como un snapshot de imagen** vía el popup (`MapCaptureModal`), tal como funciona hoy: el resultado es una imagen embebida en el informe/PDF. El **tipo de bloque `map` tipado con referencia geoespacial se difiere a una versión futura**; esta ADR documenta esa dirección de evolución para no perderla.

**Dirección futura** — un **tipo de bloque `map` persistido y tipado** que guardará la referencia geoespacial en vez de solo un PNG:

```jsonc
"map": { "props": {
  "center": [lon, lat], "zoom": 0, "bbox": [minLon,minLat,maxLon,maxLat],
  "baseLayer": "mbtiles:<id>", "overlays": ["wms:<id>", "sensors:<query>"],
  "snapshot": { "imageRef": "@ref:binary_N", "capturedAt": "ISO-8601" }
} }
```

Es decir: el bloque mantendría la **definición del mapa** (centro, zoom, bbox, capas base MBTiles y overlays WMS/sensores) **más** un snapshot de imagen para render/export offline (coherente con el patrón de ADR-012: referencia + snapshot).

### Reglas duras
- **v0.1**: el mapa se inserta como imagen (snapshot del popup); no se promete geo-referencia persistida.
- **Versión futura** (bloque tipado): el bloque `map` no se degrada a `image` plano; conserva su definición geoespacial; el snapshot se regenera al refrescar (acción explícita, nueva versión).
- Las capas referencian fuentes soberanas (MBTiles/Leaflet, ADR-026); fuentes
  online pueden enriquecer y cachearse, pero no son dependencia operativa.

## Consecuencias

### Positivas
- v0.1 entrega ya el mapa en el informe (snapshot a imagen) con mínimo esfuerzo, reusando el popup actual.
- En la versión futura, el mapa será trazable (qué zona/capa muestra) y reproducible (snapshot), permitiendo re-render sin re-capturar a mano.

### Negativas / Trade-offs
- Más complejidad que un PNG — justificada por la trazabilidad geoespacial que exige un informe minero.

### Neutras
- Reusa el patrón referencia+snapshot de ADR-012, ya decidido.

## Alternativas descartadas

### Mapa como imagen (estado actual)
Simple, pero pierde toda la semántica geoespacial; no es trazable ni reproducible. Rechazado.

### Mapa siempre en vivo (sin snapshot)
Rompe el export offline y la reproducibilidad de un informe firmado (mismo argumento que ADR-012).

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/components/modals/MapCaptureModal.jsx`
- `Referencias/frontend/src/components/Special/MapViewer.jsx`
- ADR-010 (modelo de bloques), ADR-012 (referencia+snapshot), ADR-026 (Leaflet/MBTiles)
