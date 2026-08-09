# ADR-083 — Exportación de informe a PPTX (modo presentación): sidecar híbrido imagen + overlay de texto editable

**Status**: implemented (verificado 2026-08-03: build Docker del backend 100% con tests passed; build Docker del sidecar con `pptxgenjs` instalado; `.pptx` generado inspeccionado como ZIP real — `ppt/presentation.xml` + un `slideN.xml` por página, con runs de texto reales y formato `b="1"` cuando corresponde)
**Fecha**: 2026-08-03
**Autores**: EC
**Ámbito**: reports
**Relación**: extiende ADR-016 (mismo sidecar, mismo principio "cero renderizado duplicado") y ADR-080 (mismo patrón de post-procesado en el sidecar Node); reutiliza el gate RBAC de ADR-079/080 (`informes.view`) y el allowlist SSRF de ADR-058/043; activa por primera vez `report_export_job` (schema desde `db_scripts/19`, sin código real hasta hoy); corrige un defecto real preexistente que también afectaba al PDF (ver Contexto); refina el alcance de O3 de ADR-023 para exports asíncronos (ver la actualización agregada a ese ADR); distinto de ADR-062/064/065 pese a compartir la palabra "video" — ver ADR-084 § Relación para el deslinde explícito de nombres.

## Contexto

El botón "PPTX" del ribbon (`RibbonToolbar.tsx`) ya existía, cableado a
`exportEngine.ts::exportPPTX()`, que apuntaba a `POST /api/export/pptx` — una
ruta que **nunca existió** en el backend (código muerto, del mismo lote que
el fallback cliente de DOCX). `report_export_job`
(`db_scripts/19_report_technical_mining_enterprise.sql`, `export_format
CHECK IN ('docx','pdf','pptx','mp4','html','odt')`) anticipaba exactamente
este caso desde el diseño original del schema, sin que ningún código C++ la
usara jamás.

El editor ya tenía un `layoutMode: 'presentation'` (lienzo fijo 960×540,
16:9 — `reportLayoutMetrics.ts`) pensado para esto, pero era puramente un
toggle de tamaño de lienzo en el editor: nada downstream (PDF, solo-lectura,
export) lo interpretaba como "esto son diapositivas".

**Hallazgo real durante la implementación, no anticipado por ningún ADR
previo**: `ReadOnlyViewer.tsx` — el componente que tanto el PDF (ADR-016)
como la vista previa en la app reutilizan — **nunca leía `layoutMode`**:
`.ro-page-canvas` tenía un tamaño fijo por CSS (793.7×1122.5px, A4-portrait),
sin importar si el documento estaba en modo presentación. Un informe en
`layoutMode: 'presentation'` con elementos posicionados en coordenadas
960×540 se renderizaba dentro de una caja con otra forma — es decir, **el
PDF de un informe en modo presentación ya se veía mal desde antes de esta
sesión**, sin que nadie lo hubiera detectado porque nadie había usado ese
modo con contenido real hasta ahora. Se corrigió (`getReportLayoutMetrics` +
`resolvePagePaperSetup` aplicados por página, mismo cálculo que ya usa
`PageCanvas.tsx`/`MultipageView.tsx` en el editor) como prerrequisito de este
ADR, no como su objetivo — pero el fix beneficia también al PDF existente.

## Decisión

### Reutilizar `pdf-export-service`, no crear un servicio nuevo
Mismo argumento que ADR-016/080: el sidecar ya tiene la instancia de
Chromium que navega `print-report.html` → `ReadOnlyViewer`, la MISMA página
que ve el usuario. Un segundo contenedor Chromium solo para PPTX duplicaría
la imagen base y el allowlist SSRF (`PDF_RENDER_ALLOWED_HOST`) sin ganar
nada. Se agrega `pptxgenjs` (dependencia pura JS, sin binarios nativos) al
`package.json` existente.

### `POST /render-pptx`: captura por página + composición
Navega la MISMA URL interna que el PDF (`print-report.html?id=...&token=...`,
token de la sesión que pidió el export — nunca credenciales propias del
sidecar), agregando `?pptxOverlay=1`. Para cada `.ro-page-canvas` (ya
correctamente dimensionado tras el fix) hace `elementHandle.screenshot()` y
lo agrega como imagen de fondo a pantalla completa de un slide de
`pptxgenjs`, con layout fijo 16:9 = 960×540px = 10×5.625 pulgadas a 96dpi
(exactamente las constantes de `reportLayoutMetrics.ts` — una sola fuente de
verdad geométrica compartida).

### Overlay híbrido: solo `text` es editable nativo, deliberadamente acotado
Los bloques `text` (y solo esos — `lib/pptxOverlayMapping.ts` es la tabla de
cobertura, única fuente de verdad compartida entre frontend y sidecar) se
capturan con la tinta invisible (`hideOverlayText`, mismo layout/salto de
línea, `color: transparent` por span) y se marcan con
`data-pptx-overlay`/`data-pptx-meta` (JSON con los runs de texto + estilo
por rango, tomados de `lib/textSpans.ts` — la misma fuente que ya usa el
editor). El sidecar mide la posición real vía `getBoundingClientRect()`
relativo a `.ro-page-canvas` (sin duplicar el cálculo de layout: el elemento
ya ocupa exactamente `el.x/el.y/el.width/el.height`) y superpone un cuadro de
texto NATIVO de PowerPoint con `addText([...runs], {...})` — verificado
extrayendo el `.pptx` generado y confirmando `<a:t>` con contenido real y
`b="1"` donde corresponde negrita. El texto queda **editable y buscable**
(Ctrl+F) en PowerPoint real, no solo pintado.

**Deliberadamente fuera de alcance esta iteración** (documentado en
`pptxOverlayMapping.ts`, no una omisión silenciosa):
- **`header`/`footer`**: ADR-046 ya los define como "elementos de
  plataforma fijos" (`locked: true`, no editables, calculados en vivo desde
  la sesión) — volverlos texto editable en el artefacto exportado
  contradiría ese mismo criterio de diseño. Quedan horneados en la imagen.
- **Título de portada (`cover`)**: ADR-048 lo describe como un `<h1>`
  centrado dinámicamente dentro de un bloque de página completa — a
  diferencia de `text`, no tiene `x/y/width/height` propios en el modelo;
  overlaylo exigiría medir el DOM en vivo (más superficie de riesgo,
  diferido).
- **Etiqueta de `kpi`/`sensor`**: solo la etiqueta calificaría — el valor
  numérico es una tarjeta compuesta con gradiente (snapshot de ADR-012), no
  un run de texto plano. Diferido.
- `table`, `chart`, `seismic-report`, `toc`, `image`, `video`: nunca se
  consideraron candidatos (demasiado estructurados para reproducirse como
  texto plano de PowerPoint) — igual que hoy en el fallback DOCX
  (`exportEngine.ts`), un bloque `video` produce un marcador de texto en vez
  de omitirse en silencio.

### `layoutMode` como precondición dura
`POST /api/reports/{id}/export/pptx` valida server-side que
`content_json.meta.layoutMode === 'presentation'` (leído del propio
`content_json`, sin confiar en el cliente) — `400
layout_mode_not_presentation` si no. El frontend ofrece cambiar de modo
(`setLayoutMode`) en vez de fallar en silencio o generar un PPTX con páginas
A4/A3 mal proporcionadas para una diapositiva.

### Job asíncrono real, activando `report_export_job` por primera vez
`POST .../export/pptx` inserta una fila `queued` y dispara un
`std::thread(...).detach()` (mismo patrón de hilo que ADR-072 usa para GDAL)
que llama al sidecar y actualiza el estado — pero **persistido en Postgres**,
no en memoria como el mapa de jobs de ADR-072 (sobrevive un reinicio del
backend). `GET .../export/jobs/{jobId}` hace polling; `GET
.../export/jobs/{jobId}/download` sirve el archivo terminado.

### RBAC: mismo umbral que PDF (`informes.view`)
Generar/descargar un PPTX es, igual que el PDF (ADR-080) y el `.mreport`
portátil (ADR-044), un artefacto de solo-lectura del informe — se reutiliza
`informes.view` (ADR-079), sin crear un código de permiso nuevo.

### Almacenamiento: disco local confinado, no MinIO
`BEEMETRY_EXPORT_DATA_ROOT` (bind-mount compartido backend↔sidecar, mismo
patrón que `BEEMETRY_MAPAS_DATA_ROOT` de ADR-072 y la galería de imágenes de
ADR-047) — **no MinIO**, pese a que ADR-016 mencionaba MinIO (ADR-009) como
destino del export server-side. Ver la actualización agregada a ADR-016: en
la práctica, el PDF nunca persistió a MinIO (stream directo, sin artefacto
guardado) — este ADR es el primero en de verdad persistir un artefacto de
export, y elige el patrón de disco local ya establecido en `reports`/`geo`
en vez de introducir la primera integración real de MinIO sin que el negocio
lo haya pedido para este caso puntual.

## Consecuencias

### Positivas
- Capacidad real y verificada de punta a punta, no un botón que aparenta
  funcionar: build Docker limpio del backend (tests passed) y del sidecar
  (dependencias instaladas), más inspección directa del `.pptx` generado
  (ZIP válido, `presentation.xml`, un `slideN.xml` por página, runs de texto
  reales con formato).
- El texto queda genuinamente editable/buscable en PowerPoint — la parte del
  pedido original ("algunas funcionalidades importantes de un pptx") que un
  export solo-imagen no habría cumplido.
- Activa `report_export_job`, una tabla del schema original sin ningún
  consumidor hasta hoy.
- Corrige un defecto real preexistente (`ReadOnlyViewer` sin
  `layoutMode`) que afectaba silenciosamente al PDF de cualquier informe en
  modo presentación, no solo al PPTX nuevo.

### Negativas / Trade-offs
- **Tensión con el presupuesto O3 de ADR-023** (`<5s`, aplicado
  explícitamente a PPTX vía `measurePerfAsync` desde la implementación de esa
  actualización): un job async con timeout configurado hasta 60s
  (`BEEMETRY_PPTX_EXPORT_TIMEOUT_MS`) no cabe en esa ventana. La
  instrumentación actual (`measurePerfAsync('export', () =>
  createPptxExportJob(...))`) solo mide la creación del job (rápida, <1s por
  diseño — el `POST` responde `202` de inmediato), no el ciclo completo
  hasta la descarga — así que el dashboard de O3 mostraría cumplimiento
  aunque el usuario espere decenas de segundos. Ver la actualización
  agregada a ADR-023: se propone (no se implementa en este ADR) medir el
  ciclo completo bajo un código de presupuesto distinto, mismo criterio que
  ADR-068 ya usó para separar O6 de las tareas generativas.
- Cobertura de overlay parcial (solo `text`) — documentado arriba, no una
  omisión silenciosa; cover/kpi/header-footer quedan como trabajo futuro
  explícito.
- Fidelidad tipográfica no verificada dentro de PowerPoint real (sin ese
  software disponible en este entorno) — solo se verificó la validez
  estructural del OOXML generado. Fuentes como `Arial Black`/`Arial Narrow`
  (chrome de plataforma, ADR-046) podrían no estar disponibles en todos los
  sistemas donde se abra el `.pptx`.
- Sin ruta offline: igual que el PDF (ADR-016), requiere el informe ya
  guardado con id real — no hay degradación offline para PPTX, consistente
  con el precedente ya aceptado, no una regresión nueva.

### Neutras
- El sidecar gana una dependencia pura JS (`pptxgenjs`) sin tocar la imagen
  base de Puppeteer ni requerir paquetes de sistema nuevos.

## Alternativas descartadas

### PPTX generado 100% en el cliente (similar al fallback DOCX de `exportEngine.ts`)
Mismo argumento que ADR-016 contra el PDF cliente como canónico: no
determinista, depende del navegador de quien exporta, inadecuado para un
documento que se comparte con stakeholders de la operación minera.

### PPTX 100% nativo (reconstruir cada bloque como shape OOXML, sin capturar pantalla)
Máxima editabilidad y menor peso de archivo, pero reimplementaría estilos,
gradientes y tipografía por fuera del único renderer real
(`ReadOnlyViewer`) — exactamente el tipo de divergencia ADR-vs-runtime que
este mismo log ya encontró varias veces (ADR-053, ADR-068, ADR-071).
Rechazado por el mismo principio de ADR-016 ("cero lógica de renderizado
duplicada").

### Solo imagen, sin overlay de texto
Más simple, pero no cumple el pedido explícito de "funcionalidades
importantes" de un PPTX real (texto editable/buscable) — se usó como hito
intermedio de la propia implementación (Stage 1), nunca como estado final.

## Referencias
- `pdf-export-service/server.js` (`/render-pptx`), `package.json` (`pptxgenjs`)
- `backend/src/reports/report_routes.cpp` (`POST/GET .../export/pptx*`)
- `backend/src/reports/report_export_jobs.hpp/cpp` (`runPptxExportJob`)
- `backend/src/reports/report_service.hpp/cpp` (`ExportJob`,
  `createExportJobPg`/`getExportJobPg`/`updateExportJobStatusPg`)
- `backend/src/config/app_config.hpp/cpp` (`gExportDataRoot`,
  `gPptxExportTimeoutMs`)
- `db_scripts/19_report_technical_mining_enterprise.sql` (`report_export_job`,
  reutilizada sin migración nueva)
- `frontend/src/components/ReportStudioV2/components/viewers/ReadOnlyViewer.tsx`
  (fix de `layoutMode`, marcado `data-pptx-overlay`)
- `frontend/src/components/ReportStudioV2/lib/pptxOverlayMapping.ts` (nuevo)
- `frontend/src/components/ReportStudioV2/lib/api.ts`
  (`createPptxExportJob`/`pollExportJob`/`fetchExportJobBlob`)
- `frontend/src/print-report/main.tsx` (`pptxOverlay` query param)
- `docker-compose.yml` (`BEEMETRY_EXPORT_DATA_ROOT`, volumen compartido)
- ADR-016 (export server-side, principio de sidecar único), ADR-023
  (presupuestos de rendimiento, actualizado por este ADR), ADR-046
  (header/footer fijos), ADR-048 (carátula), ADR-058/043 (SSRF/hardening),
  ADR-072 (patrón de job async + confinamiento de disco), ADR-079/080 (RBAC
  y post-procesado del sidecar), ADR-084 (conversión a video, siguiente en
  esta misma familia)
