# SPEC 024 — Integración Total de GEOCATMIN (INGEMMET) y Acceso Directo por Unidad Minera

| Campo | Valor |
|---|---|
| **ID** | 024 · **Estado** | **Aprobado / Implementado** |
| **SOW** | Geocientífico INGEMMET, catastro minero nacional, geología, peligros, pre-evaluación y geoprocesos |
| **Constitución** | Art. 1 (multitenant), Art. 5 (observabilidad espacial), Art. 9 (calidad y accesibilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-024**; fuente ADR: `docs/decisions/`.

- **ADR-123** — [`123-geocatmin-integracion-plataforma-minera.md`](../../docs/decisions/123-geocatmin-integracion-plataforma-minera.md)
- **ADR-121** — [`121-coordenadas-geograficas-empresa-mapa.md`](../../docs/decisions/121-coordenadas-geograficas-empresa-mapa.md)
- **ADR-009** — [`009-gis-mapas-cumplimiento.md`](../../docs/decisions/009-gis-mapas-cumplimiento.md)
- **ADR-026** — [`026-cartografia-offline-mbtiles-maplibre.md`](../../docs/decisions/026-cartografia-offline-mbtiles-maplibre.md)

## 1. Problema
Los ingenieros de mina, geólogos y administradores de contratos mineros requieren consultar permanentemente el estado de las concesiones, zonas de libre denunciabilidad, geología estructural, muestras geoquímicas y alertas de peligros geológicos proporcionados por el INGEMMET. La plataforma web pública oficial (`https://geocatmin.ingemmet.gob.pe/geocatmin/`) requiere pasar por pantallas de bienvenida/términos y no sitúa al usuario automáticamente en su unidad minera activa.

## 2. Objetivo
Integrar la totalidad del ecosistema GEOCATMIN dentro de la plataforma minera Beemetry con:
1. **Ingreso directo y automático** sin pantallas intermedias ni clics de confirmación.
2. **Centrado instantáneo** en la zona minera correspondiente al tenant logueado.
3. **Catálogo completo de 134 servicios geoespaciales** de INGEMMET habilitados y organizados por subsistemas temáticos.
4. **Herramientas de búsqueda, análisis espacial, pre-evaluación de superposiciones, medición y exportación de planos**.

## 3. Criterios de Aceptación
- [ ] **CA-1:** Al abrir el módulo, la vista entra directamente sin mostrar modales de bienvenida, términos ni botones de "Ingresar".
- [ ] **CA-2:** El mapa se centra y hace zoom automáticamente en la ubicación geográfica de la mina activa según `/api/map/company-location` o fallback de `miningLocations.ts`.
- [ ] **CA-3:** Árbol de capas con 7 categorías oficiales (Catastro Minero, Geología & Fallas, Geoquímica & Geofísica, Peligros & Alertas, Restricciones Ambientales, Topografía Satelital, Geoprocesos).
- [ ] **CA-4:** Buscador de concesiones por Nombre, Código Único, Titular, Cuadrícula IGN o Coordenadas (UTM 17S/18S/19S y WGS84).
- [ ] **CA-5:** Herramienta de Pre-Evaluación para verificar colisiones espaciales con concesiones colindantes y áreas naturales protegidas.
- [ ] **CA-6:** Herramientas de Medición (distancias, áreas) y Generación de Buffer / Radio de influencia.
- [ ] **CA-7:** Identificación de atributos (Identify) al hacer clic en el mapa sobre cualquier entidad catastral o geológica.
- [ ] **CA-8:** Enlaces de descarga directa de shapefiles oficiales de catastro (Zonas 17S, 18S, 19S) y exportación de imágenes cartográficas.

## 4. Endpoints y Servicios Clave
- `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CATASTRO_MINERO_WGS84/MapServer`
- `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_GEOLOGIA_100K_INTEGRADA/MapServer`
- `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_GEOLOGIA_FALLAS/MapServer`
- `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_AREA_RESERVADA/MapServer`
- `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_PERU_ALERTA/MapServer`
- `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_PASIVO_AMBIENTAL/MapServer`
- `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_METALOGENETICO/MapServer`
- `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_ATLAS_GEOQUIMICO/MapServer`
