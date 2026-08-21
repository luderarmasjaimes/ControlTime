# ADR-123 — Integración Nativa Total de GEOCATMIN (INGEMMET) con Ingreso Directo a la Zona Minera de Sesión

**Status**: implemented (2026-08-20)

**Fecha**: 2026-08-20

**Ámbito**: gis, mapas, ingemmet, geocatmin, auth, cumplimiento

## Contexto

El portal oficial de GEOCATMIN del Instituto Geológico, Minero y Metalúrgico (INGEMMET) de Perú (`https://geocatmin.ingemmet.gob.pe/geocatmin/`) provee información geoespacial crítica para la industria minera: catastro minero (derechos vigentes, en trámite, extinguidos, canteras, UEAs), geología regional (1:100k y 1:50k), fallas tectónicas activas, fajas metalogenéticas, geoquímica, alertas geodinámicas (`PERU_ALERTA`), peligros geológicos y restricciones ambientales (ANP, PAM, arqueología).

Sin embargo, el uso convencional de la plataforma web externa presenta fricciones importantes para la operación de mina:
1. **Barrera de Bienvenida**: Obliga al usuario a pasar por una pantalla inicial con términos y condiciones donde se debe pulsar obligatoriamente el botón *"Ingresar →"* (`btnIngresar`).
2. **Desconexión con la Unidad Minera**: Abre siempre en una vista general de todo el Perú, obligando al operador a buscar y hacer zoom manualmente a su yacimiento o proyecto.
3. **Falta de Integración con el Sistema de Operaciones**: No permitía consultar atributos, medir distancias/áreas, evaluar superposiciones de polígonos con terceros ni descargar capas oficiales en formato shapefile/CAD de forma directa e integrada.

## Decisión

1. **Ingreso 100% Directo y Centrado Automático**:
   - Eliminar por completo pantallas de bienvenida, modales de términos o pasos de confirmación (`Enter` o `Ingresar`).
   - Al abrir la herramienta, la suite se inicializa **de forma inmediata** consultando las coordenadas del tenant activo resueltas por `/api/map/company-location` (ADR-121) o del catálogo `MINING_LOCATIONS` (ej. Antamina, Cerro Verde, Las Bambas, Toquepala, Quellaveco, etc.).

2. **Catálogo Maestro de 134 Servicios Geoespaciales de INGEMMET**:
   - Implementar un catálogo tipado exhaustivo (`frontend/src/config/geocatminCatalog.ts`) categorizado en 7 subsistemas operativos:
     - **Catastro Minero & Titularidad**: Concesiones vigentes, tituladas, en trámite, extinguidas, UEAs, cartera de proyectos mineros, libre denunciabilidad, REINFO, pequeña minería.
     - **Geología, Estructuras & Metalogenia**: Mapas 1:100k y 1:50k, fallas geológicas activas/cuaternarias, fajas metalogenéticas, ocurrencias minerales y prospectividad con IA.
     - **Geoquímica & Geofísica**: Sedimentos de quebrada (muestras multielemento Cu, Au, Ag, Li), magnetometría, radiometría e hidrogeología.
     - **Peligros Geológicos & Alertas**: Sistema `PERU_ALERTA` en tiempo real, susceptibilidad a movimientos en masa (deslizamientos), inundaciones y monitoreo vulcanológico (OVI).
     - **Ambiental & Restricciones**: Pasivos ambientales mineros (PAM), Áreas Naturales Protegidas (SERNANP), certificados ambientales, zonas arqueológicas y urbanas.
     - **Topografía & Cartografía Satelital**: Cuadrículas y cartas IGN 1:100k, DEM Aster, sombras Hillshade e imágenes satelitales.
     - **Geoprocesamiento & Descargas**: Extracción de datos (Shapefile Zonas 17S, 18S, 19S), formulación de planos UEA por RUC o derecho minero, y radios de influencia/buffer.

3. **Suite GEOCATMIN Workbench (`GeocatminWorkbench.tsx`)**:
   - Visor GIS interactivo de alto rendimiento montado sobre Leaflet y ArcGIS REST Services.
   - **Buscador Directo de Derechos Mineros**: Búsqueda por Nombre, Código Único, Titular, Cuadrícula IGN o Coordenadas (UTM 17S/18S/19S / WGS84).
   - **Pre-Evaluación y Análisis de Superposiciones**: Detección de colisiones espaciales del área de la mina con concesiones colindantes y áreas reservadas.
   - **Herramientas de Campo y Gabinete**:
     - Medición precisa de distancias y polígonos.
     - Generación de Buffer / Radio de influencia (100m, 500m, 1km, 5km) alrededor de instalaciones.
     - Identificación de atributos (Identify) al clic en el mapa.
     - Conversor de coordenadas integrado en pantalla (UTM ↔ WGS84 ↔ PSAD56).
     - Descarga directa en un clic de Shapefiles oficiales de catastro minero (Zonas 17S, 18S, 19S) y manuales técnicos.
     - Exportación cartográfica de alta resolución para adjuntar en ReportStudioV2.

4. **Modo Dual Conmutable**:
   - Modo Principal: **Suite Nativa GEOCATMIN Workbench** (rápida, sin fricción, integrada al flujo de la mina).
   - Modo Secundario: **Portal Oficial Live INGEMMET** (con bypass automatizado de bienvenida y centrado directo en la mina).

## Consecuencias

- **Eficiencia Operativa**: Reducción a 0 segundos del tiempo de acceso a la información catastral y geológica del yacimiento al iniciar sesión.
- **Trazabilidad Territorial**: Consulta inmediata de derechos mineros vigentes y detección temprana de superposiciones o restricciones legales.
- **Soberanía y Resiliencia**: Capacidad de operar con servicios REST públicos de INGEMMET y fallback al catálogo local de ubicaciones mineras.

## Referencias

- `frontend/src/config/geocatminCatalog.ts`
- `frontend/src/lib/geocatminService.ts`
- `frontend/src/components/Special/GeocatminWorkbench.tsx`
- `frontend/src/components/Special/MiningGeoportalView.tsx`
- ADR-121 — Coordenadas geográficas de la empresa en `auth_companies`
- ADR-009 / SPEC-009 — GIS y mapas de cumplimiento
