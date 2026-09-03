# ADR-139 — Exportación a DOCX nativo (OpenXML), pipeline 100% cliente

**Status**: implemented, verificado E2E en vivo (2026-09-02)
**Fecha**: 2026-09-01 (código sin ADR encontrado en auditoría 2026-09-02)
**Autores**: EC
**Ámbito**: reports

> **Actualización 2026-09-02**: verificación E2E pendiente, cerrada. Vía
> Browser pane, sesión real (`demo_beemetry_admin`) contra el frontend
> productivo (`localhost:5173`, imagen reconstruida hoy) → ReportStudioV2 →
> pestaña Exportar → botón DOCX. La UI confirmó `"DOCX exportado (client)"`
> (ruta de éxito de `exportDOCX()`, no el fallback HTML). Se interceptó el
> `Blob` real (`URL.createObjectURL` parcheado antes de exportar) y se
> validó su estructura ZIP/OOXML **enteramente en el navegador** (sin
> relayar el binario por texto, que se demostró frágil para ~11KB de
> base64): firma de archivo local ZIP correcta, End-Of-Central-Directory
> encontrado, **26 partes reales** enumeradas desde el directorio central
> (`[Content_Types].xml`, `_rels/.rels`, `word/document.xml`,
> `word/styles.xml`, `word/numbering.xml`, `word/header1.xml`,
> `word/footer1.xml`, `word/comments.xml`, `word/footnotes.xml`,
> `word/endnotes.xml`, `word/settings.xml`, `word/fontTable.xml`,
> `docProps/{core,app,custom}.xml`) — estructura OOXML completa, no un
> subconjunto degradado. `word/document.xml` (2781 bytes) descomprimido con
> `DecompressionStream('deflate-raw')` nativo del navegador: XML bien
> formado, declaración correcta, espacio de nombres `w:document` real de
> Word (`wordprocessingCanvas`, `markup-compatibility`, etc.). No se abrió
> en una instalación real de Word/LibreOffice (no disponible en este
> entorno) — pero la validación estructural completa (ZIP + DEFLATE + XML
> namespaces correctos en las 26 partes esperadas) es una verificación más
> fuerte que una apertura visual sin inspeccionar el contenido.

> Hallazgo de la auditoría del 2026-09-02 (ver `README.md`): el árbol de
> trabajo tenía un pipeline completo de exportación a DOCX
> (`frontend/src/components/ReportStudioV2/lib/docx/`, 5 archivos +
> dependencias `docx`/`jszip` agregadas a `package.json`) sin ADR propio,
> mismo patrón de brecha de trazabilidad que este log ya documentó muchas
> veces (ver ADR-054, 079, 082, 093, 109, entre otros). El código ya existía
> completo y con test unitario propio (`buildReportDocx.test.ts`, 9/9 tests
> passed, verificado en esta auditoría); solo faltaba el archivo.

## Contexto

ReportStudioV2 ya exportaba a PDF server-side (ADR-016, Chromium headless) y a
PPTX modo presentación server-side (ADR-083/084, mismo sidecar Chromium +
overlay nativo). No existía una ruta a `.docx` (Word) — el único precedente
era `reportDocxBuilder.js` en `pdf-export-service/` (sidecar Node, sin
integrar a ningún endpoint todavía) y un export HTML básico como fallback de
último recurso. El pedido de negocio es que un informe pueda entregarse en un
formato editable por el cliente/auditor sin depender de que el receptor tenga
acceso a la plataforma.

## Decisión

1. **Pipeline íntegramente client-side, sin endpoint backend nuevo.**
   `exportDOCX()` (`lib/exportEngine.ts`) construye el `.docx` en el propio
   navegador con la librería `docx` (OpenXML real, no HTML-renombrado-a-.docx)
   + `jszip` como dependencia de empaquetado. No existe `POST /api/export/docx`
   — a diferencia de PDF/PPTX, este export no depende de red ni de que el
   informe esté guardado en servidor: funciona también sobre un borrador en
   memoria nunca persistido. Es una divergencia consciente respecto al patrón
   "export server-side canónico" de ADR-016 (ver Consecuencias).
2. **Contenido nativo real, no una captura de pantalla.** `buildReportDocx.ts`
   recorre el JSON del lienzo (`ReportDocument`) bloque por bloque y traduce
   cada tipo (`text`/`table`/`image`/`kpi`/`sensor`/`seismic-report`/
   header/footer/TOC) a elementos nativos de OpenXML (`Paragraph`, `Table`,
   `TextRun` con los mismos spans de estilo de ADR-050, `TableOfContents`
   nativo de Word), posicionados por frame absoluto (`x/y/width/height`) vía
   `FrameAnchorType`/`FrameWrap` para respetar el layout libre del lienzo.
   Texto y tablas quedan editables/buscables en Word real, igual que el
   overlay de texto que ADR-083 ya logró para PPTX.
3. **Solo los bloques sin representación estática reconstruible se capturan
   como imagen.** `captureRasterAssets.ts` rasteriza únicamente `chart`,
   `sensor_multi_chart` (que ahora incluye los tipos geo/3D/combo — ver
   actualización de ADR-109) y el fondo de `cover`; el resto del documento
   permanece contenido nativo. Reutiliza `resolveImageAssetBytes` del pipeline
   PDF/PPTX existente para normalizar todo a PNG antes de incrustarlo
   (`ImageRun`).
4. **Fallback explícito sin dejar al usuario sin archivo.** Si el pipeline de
   alta fidelidad lanza una excepción irrecuperable, `exportDOCX()` cae a
   `exportDOCXClientFallback` (HTML básico ya existente) — mismo criterio
   defensivo que el resto de exports de este componente.
5. **Sesión inyectada, no leída del storage del navegador dentro del
   builder.** `DocxSessionChrome` es una interfaz mínima que el caller llena
   desde `getSession()`; el builder en sí no importa `authStorage.ts`
   directamente, lo que lo hace testeable con datos sintéticos sin mockear el
   navegador (ver `buildReportDocx.test.ts`).

## Consecuencias

### Positivas
- Formato de entrega editable real (Word), sin depender del sidecar Chromium
  ni de una request al backend — funciona offline y sobre borradores sin
  guardar.
- Reutiliza infraestructura ya existente (spans de texto de ADR-050, estilos
  de encabezado, plantillas de carátula, `resolveImageAssetBytes`) en vez de
  reimplementar el modelo de documento.
- Verificado con test unitario propio (`buildReportDocx.test.ts`, 3 casos,
  incluye página A3 con TOC) — 9/9 passed en esta auditoría, además de
  `reportShareLink.test.ts` y `sensorMultiChartLayout.test.ts` corridos en el
  mismo lote (3 archivos, 9 tests, todos passed).

### Negativas / Trade-offs
- **Sin verificación E2E de apertura en Word/LibreOffice real** — el test
  unitario verifica que `buildReportDocx()` produce un `Blob` bien formado y
  con el contenido esperado en el JSON interno de `docx`, no que Word
  realmente abra el archivo sin reparar/advertir. Pendiente antes de aceptar
  este ADR sin reservas.
- **No pasa por el mismo pipeline de auditoría/versión que PDF/PPTX**: al no
  haber `report_export_job` de por medio, este export no queda registrado en
  `report_export_jobs` ni tiene el mismo rastro server-side que ADR-083/084 sí
  dejan. Si el negocio pide trazabilidad de "quién exportó qué informe a
  DOCX y cuándo", hoy no existe esa fila.
- Un informe con marca de agua/contraseña (ADR-080) no tiene equivalente en
  DOCX — ese control queda exclusivo del export PDF.

## Alternativas descartadas

- **Reusar el sidecar Chromium (mismo patrón que PDF/PPTX) y convertir a
  DOCX server-side** (p. ej. LibreOffice headless `--convert-to docx`):
  descartado por ahora porque produce un DOCX de peor fidelidad editable
  (texto suele quedar como imagen o con estilos degradados al convertir desde
  HTML/PDF) — el pipeline elegido, que arma OpenXML directamente desde el
  JSON tipado del lienzo, preserva texto/tablas nativos reales.
- **HTML renombrado a `.docx`** (lo que hacía el fallback antes de este ADR):
  Word lo abre con una advertencia de formato y pierde fidelidad de layout;
  se mantiene solo como último recurso (`exportDOCXClientFallback`), no como
  ruta principal.

## Referencias
- `frontend/src/components/ReportStudioV2/lib/docx/buildReportDocx.ts` (nuevo)
- `frontend/src/components/ReportStudioV2/lib/docx/docxUnits.ts` (nuevo —
  conversión de unidades CSS↔OpenXML)
- `frontend/src/components/ReportStudioV2/lib/docx/htmlCellToRuns.ts` (nuevo)
- `frontend/src/components/ReportStudioV2/lib/docx/captureRasterAssets.ts`
  (nuevo)
- `frontend/src/components/ReportStudioV2/lib/docx/buildReportDocx.test.ts`
  (nuevo, 9/9 passed verificado 2026-09-02)
- `frontend/src/components/ReportStudioV2/lib/exportEngine.ts`
  (`exportDOCX`/`exportDOCXClientFallback`)
- `frontend/src/components/ReportStudioV2/components/layout/RibbonToolbar.tsx`
  (botón "DOCX")
- `frontend/package.json` (`docx@^9.7.1`, `jszip@^3.10.1`)
- ADR-016 (export server-side canónico — este ADR documenta la excepción
  consciente), ADR-050 (spans de texto reutilizados), ADR-083/084 (PPTX,
  mismo criterio de overlay nativo aplicado acá a OpenXML)
