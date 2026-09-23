'use strict';
/**
 * Reconstrucción nativa completa del export PPTX (reemplaza el viejo
 * pipeline de "captura de página completa como imagen de fondo + overlay de
 * texto solo para bloques `text`"): cada diapositiva se arma directamente
 * desde el mismo JSON `ReportDocument` que ya usa `reportDocxBuilder.js`
 * (texto/tabla/kpi/sensor/toc/header/footer NATIVOS, editables en
 * PowerPoint), con la MISMA lista de 4 tipos sin representación nativa
 * (`RASTER_ELEMENT_TYPES` de rasterCapturePipeline.js: `chart`,
 * `sensor_multi_chart`, `cover`, `image`) insertados como PNG capturado.
 *
 * A diferencia de DOCX, PPTX no tiene un modo "flow" (una diapositiva no
 * reflowa texto como un documento) -- todo bloque se posiciona SIEMPRE de
 * forma absoluta, como ya lo hacía el pipeline viejo.
 */
const {
  pxToPt, pxToInch, cssColorToHex, firstFontFamily, headingLevelFor,
  findCoverTemplate, resolveMiningUnitName,
  sanitizeSpans, buildStyledSegments,
  tocSliceForElementId, resolveHeadingRefLabel, resolveAnnexRefLabel,
  parseHtmlToRuns, resolvePagePaperSetup, paperSizeInches,
} = require('./reportSharedHelpers');
const { RASTER_ELEMENT_TYPES } = require('./rasterCapturePipeline');
// Motor de fórmulas (ADR-172) + formato condicional + coloreado semántico --
// YA portado a Node para DOCX (ver tableEngine.js/ADR-204), pero nunca se
// conectó acá: `buildTableSlideObject` (más abajo) solo pintaba texto crudo
// de celda + cabecera/bandas, sin fórmulas calculadas, sin condicional, sin
// semántico, sin overrides manuales de celda/fila/columna -- el MISMO bug
// que "Reporte de observaciones" 2026-09-21 (items 5/6) había reportado
// para DOCX, nunca cerrado para PPTX. Encontrado auditando exportación a
// "todos los formatos posibles" 2026-09-23.
const {
  computeTableFormulas, getEffectiveCellValues, computeConditionalStyles, semanticStatusStyle,
} = require('./tableEngine');

// Tamaño fijo del lienzo en layoutMode 'presentation' (reportLayoutMetrics.ts:
// PAGE_WIDTH=960, PAGE_HEIGHT=540, 96dpi) — 960/96=10in, 540/96=5.625in,
// exactamente el layout 16:9 estándar de pptxgenjs (LAYOUT_16x9). En este
// modo cada página YA está en el sistema de coordenadas del deck (nunca
// necesita letterbox), a diferencia de 'document' (ver `pageScaleInfo`).
const SLIDE_WIDTH_IN = 10;
const SLIDE_HEIGHT_IN = 5.625;

// ── color/resaltado pptx-específico (pptxgenjs espera hex SIN '#') ─────────
const HIGHLIGHT_NAME_TO_HEX = {
  black: '000000', blue: '0000FF', cyan: '00FFFF', darkBlue: '00008B', darkCyan: '008B8B',
  darkGray: 'A9A9A9', darkGreen: '006400', darkMagenta: '8B008B', darkRed: '8B0000',
  darkYellow: '808000', green: '00FF00', lightGray: 'D3D3D3', magenta: 'FF00FF', red: 'FF0000',
  white: 'FFFFFF', yellow: 'FFFF00',
};
function highlightHexFromName(value) {
  if (typeof value !== 'string' || !value || value === 'transparent') return undefined;
  return HIGHLIGHT_NAME_TO_HEX[value.trim()] || HIGHLIGHT_NAME_TO_HEX.yellow;
}
const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);
const alignmentFromCss = (v) => (ALIGN_VALUES.has(v) ? v : 'left');

/** Tamaño del deck completo: fijo 16:9 en 'presentation', papel real del
 * documento (A4/A3, retrato/paisaje) en 'document' -- un .pptx solo admite
 * UN tamaño de diapositiva para TODO el archivo (limitación real del
 * formato). */
function resolveDeckSize(doc, layoutMode) {
  if (layoutMode === 'presentation') return { widthIn: SLIDE_WIDTH_IN, heightIn: SLIDE_HEIGHT_IN };
  const setup = resolvePagePaperSetup(null, doc.meta);
  return paperSizeInches(setup.paperSize, setup.orientation);
}

/** Info de escala/centrado para UNA página cuyo papel propio
 * (`setPagePaperSetup`) no coincide con el del deck -- se encaja centrada
 * dentro del deck preservando su propia proporción (letterbox) en vez de
 * estirarse, mismo criterio que ya usaba el pipeline viejo para la imagen de
 * fondo completa, ahora aplicado a CADA elemento nativo de la página. En
 * 'presentation' esto es SIEMPRE {scale:1, sin offset} -- ninguna página
 * individual tiene un papel propio distinto del 16:9 fijo. */
function pageScaleInfo(docPage, docMeta, deckWidthIn, deckHeightIn, layoutMode) {
  if (layoutMode === 'presentation') return { scale: 1, offsetXIn: 0, offsetYIn: 0 };
  const setup = resolvePagePaperSetup(docPage, docMeta);
  const pageSize = paperSizeInches(setup.paperSize, setup.orientation);
  if (Math.abs(pageSize.widthIn - deckWidthIn) < 0.01 && Math.abs(pageSize.heightIn - deckHeightIn) < 0.01) {
    return { scale: 1, offsetXIn: 0, offsetYIn: 0 };
  }
  const scale = Math.min(deckWidthIn / pageSize.widthIn, deckHeightIn / pageSize.heightIn);
  const scaledWidthIn = pageSize.widthIn * scale;
  const scaledHeightIn = pageSize.heightIn * scale;
  return { scale, offsetXIn: (deckWidthIn - scaledWidthIn) / 2, offsetYIn: (deckHeightIn - scaledHeightIn) / 2 };
}

/** Convierte el rectángulo de un elemento (px, sistema de coordenadas de SU
 * PROPIA página) a pulgadas en el sistema de coordenadas del deck. */
function toSlideRect(el, scaleInfo, overrides) {
  const o = overrides || {};
  return {
    x: scaleInfo.offsetXIn + pxToInch(o.xPx != null ? o.xPx : el.x) * scaleInfo.scale,
    y: scaleInfo.offsetYIn + pxToInch(o.yPx != null ? o.yPx : el.y) * scaleInfo.scale,
    w: Math.max(0.01, pxToInch(o.widthPx != null ? o.widthPx : el.width) * scaleInfo.scale),
    h: Math.max(0.01, pxToInch(o.heightPx != null ? o.heightPx : el.height) * scaleInfo.scale),
  };
}
function scaledPt(fontSizePx, scaleInfo) {
  return Math.max(1, Math.round(pxToPt(fontSizePx || 14) * scaleInfo.scale));
}

// ── texto con estilo por rango (buildStyledSegments) -> runs de pptxgenjs ──
function segmentsToPptxRuns(segments, scaleInfo) {
  const out = [];
  segments.forEach((seg) => {
    const lines = seg.text.split('\n');
    lines.forEach((line, i) => {
      if (line.length === 0 && lines.length === 1) return;
      out.push({
        text: line,
        options: {
          breakLine: i < lines.length - 1 || undefined,
          bold: seg.style.bold || undefined,
          italic: seg.style.italic || undefined,
          underline: seg.style.underline ? { style: 'sng' } : undefined,
          color: cssColorToHex(seg.style.color, '0F172A'),
          fontFace: firstFontFamily(seg.style.fontFamily),
          fontSize: scaledPt(seg.style.fontSize, scaleInfo),
          highlight: highlightHexFromName(seg.style.highlightColor),
        },
      });
    });
  });
  return out.length > 0 ? out : [{ text: '' }];
}
// Columnas tipo periódico (`props.columnCount`) -- mismo criterio y misma
// limitación que buildReportDocx.ts/reportDocxBuilder.js: pptxgenjs no
// expone columnas nativas a nivel de UN cuadro de texto (los tipos de
// `addTable` sí tienen `colW`, pero eso es otra cosa), se aproxima
// partiendo el texto en N cuadros lado a lado.
function rebaseSpansPptx(spans, contentStart, contentLength) {
  return spans
    .map((s) => ({ ...s, start: s.start - contentStart, end: s.end - contentStart }))
    .filter((s) => s.end > 0 && s.start < contentLength)
    .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(contentLength, s.end) }));
}
function splitTextIntoColumnChunksPptx(text, columnCount) {
  const targetLen = Math.max(1, Math.ceil(text.length / columnCount));
  const parts = text.split(/(\s+)/);
  const chunks = [];
  let current = '';
  let currentStart = 0;
  let offset = 0;
  parts.forEach((part) => {
    if (current.length >= targetLen && chunks.length < columnCount - 1 && /^\s+$/.test(part)) {
      chunks.push({ text: current, start: currentStart, end: offset });
      current = '';
      currentStart = offset + part.length;
    } else {
      current += part;
    }
    offset += part.length;
  });
  chunks.push({ text: current, start: currentStart, end: text.length });
  while (chunks.length < columnCount) chunks.push({ text: '', start: text.length, end: text.length });
  return chunks;
}
const COLUMN_GAP_PX_PPTX = 16;
// Fondo de TODO el bloque (`props.backgroundColor`, distinto del resaltado
// por span) -- faltaba acá también (mismo gap que ambos builders DOCX).
function blockFillPptx(props) {
  const bg = props.backgroundColor;
  if (!bg || bg === 'transparent') return undefined;
  return { color: cssColorToHex(bg, 'FFFFFF') };
}
function buildTextSlideObject(slide, el, scaleInfo, resolveRef) {
  const props = el.props || {};
  const text = String(props.text || '');
  const base = { bold: !!props.bold, italic: !!props.italic, underline: !!props.underline, color: props.fontColor || '#0f172a', fontSize: props.fontSize || 14, fontFamily: props.fontFamily || 'Arial', highlightColor: props.highlightColor || 'transparent' };
  const spans = sanitizeSpans(props.spans, text.length);
  const columnCount = Math.max(1, Math.min(4, Number(props.columnCount) || 1));
  const fill = blockFillPptx(props);
  if (columnCount > 1) {
    const chunks = splitTextIntoColumnChunksPptx(text, columnCount);
    const colWidthPx = Math.max(20, (el.width - COLUMN_GAP_PX_PPTX * (columnCount - 1)) / columnCount);
    chunks.forEach((chunk, i) => {
      const rebased = rebaseSpansPptx(spans, chunk.start, chunk.text.length);
      const chunkSegments = buildStyledSegments(chunk.text, rebased, base, resolveRef);
      const chunkRuns = segmentsToPptxRuns(chunkSegments, scaleInfo);
      const chunkRect = toSlideRect(el, scaleInfo, { xPx: el.x + i * (colWidthPx + COLUMN_GAP_PX_PPTX), widthPx: colWidthPx });
      slide.addText(chunkRuns, { ...chunkRect, align: alignmentFromCss(props.textAlign), valign: 'top', margin: 0, wrap: true, autoFit: false, fill });
    });
    return;
  }
  const segments = buildStyledSegments(text, spans, base, resolveRef);
  const runs = segmentsToPptxRuns(segments, scaleInfo);
  const rect = toSlideRect(el, scaleInfo);
  slide.addText(runs, { ...rect, align: alignmentFromCss(props.textAlign), valign: 'top', margin: 0, wrap: true, autoFit: false, fill });
}

// ── celdas de tabla: parseHtmlToRuns (neutro) -> runs de pptxgenjs ─────────
function htmlCellToPptxRuns(html, base) {
  const baseColor = base.color ? cssColorToHex(base.color) : undefined;
  const neutralRuns = parseHtmlToRuns(html);
  return neutralRuns.map((run) => ({
    text: run.text,
    options: {
      breakLine: run.break || undefined,
      bold: (run.bold ?? base.bold) || undefined,
      italic: run.italics || undefined,
      underline: run.underline ? { style: 'sng' } : undefined,
      color: baseColor,
      fontSize: base.fontSize,
      hyperlink: run.href ? { url: run.href } : undefined,
    },
  }));
}
function buildTableSlideObject(slide, el, scaleInfo) {
  const props = el.props || {};
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const rect = toSlideRect(el, scaleInfo);
  if (rows.length === 0) {
    slide.addTable([[{ text: '' }]], { x: rect.x, y: rect.y, w: rect.w });
    return;
  }
  const hasHeader = props.hasHeader !== false;
  const fontSizePt = scaledPt(props.fontSize || 14, scaleInfo);
  const colCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  const providedWidths = Array.isArray(props.colWidths) ? props.colWidths : [];
  const colW = Array.from({ length: colCount }, (_, i) => (
    providedWidths[i] ? pxToInch(providedWidths[i]) * scaleInfo.scale : rect.w / colCount
  ));
  const borderColor = cssColorToHex(props.borderColor, 'E2E8F0');
  const borderType = props.borderStyle === 'dashed' ? 'dash' : props.borderStyle === 'none' ? 'none' : 'solid';
  const border = { type: borderType, color: borderColor, pt: Math.max(0.5, (Number(props.borderWidth) || 1) * scaleInfo.scale) };
  const align = props.cellAlign === 'center' ? 'center' : props.cellAlign === 'right' ? 'right' : 'left';
  const cellMargin = pxToInch((Number(props.cellPadding) || 10) * scaleInfo.scale);

  // Mismo motor que reportDocxBuilder.js::buildTableElement (ver comentario
  // junto al require de tableEngine.js más arriba) -- resultado calculado
  // de fórmulas + misma cadena de precedencia de color: condicional >
  // override manual (celda/fila/columna) > semáforo semántico > cabecera/
  // banda > transparente.
  const formulaResults = computeTableFormulas(rows);
  const effectiveValues = getEffectiveCellValues(rows, formulaResults);
  const conditionalStyles = computeConditionalStyles(effectiveValues, props.conditionalFormats, hasHeader, props.colorScales);
  const cellBackgrounds = props.cellBackgrounds;
  const rowBackgrounds = props.rowBackgrounds;
  const columnBackgrounds = props.columnBackgrounds;
  const cellTextColors = props.cellTextColors;

  const tableRows = rows.map((row, ri) => {
    const isHeaderRow = ri === 0 && hasHeader;
    const isBanded = !isHeaderRow && props.bandedRows && ri % 2 === (hasHeader ? 1 : 0);
    return Array.from({ length: colCount }, (_, ci) => {
      const raw = Array.isArray(row) ? row[ci] : '';
      const rawStr = String(raw == null ? '' : raw);
      const formulaResult = formulaResults[ri] && formulaResults[ri][ci];
      const sem = !isHeaderRow ? semanticStatusStyle(rawStr, false) : null;
      const conditionalStyle = conditionalStyles[ri] && conditionalStyles[ri][ci];
      const bgColor = (conditionalStyle && conditionalStyle.backgroundColor)
        || (cellBackgrounds && cellBackgrounds[ri] && cellBackgrounds[ri][ci])
        || (rowBackgrounds && rowBackgrounds[ri])
        || (columnBackgrounds && columnBackgrounds[ci])
        || (isHeaderRow ? props.headerBg : sem ? sem.bg : isBanded ? props.bandColor : null);
      const textColorOverride = (conditionalStyle && conditionalStyle.textColor)
        || (cellTextColors && cellTextColors[ri] && cellTextColors[ri][ci])
        || (isHeaderRow ? (props.headerTextColor || '#1e293b') : sem ? sem.color : undefined);
      const fill = bgColor ? { color: cssColorToHex(bgColor, 'FFFFFF') } : undefined;
      const bold = isHeaderRow ? props.headerBold !== false : false;
      // Celda-fórmula: valor CALCULADO (o código de error), nunca la
      // fórmula cruda -- mismo criterio que reportDocxBuilder.js.
      const runs = formulaResult
        ? [{ text: formulaResult.display, options: { bold: bold || undefined, color: textColorOverride ? cssColorToHex(textColorOverride) : undefined, fontSize: fontSizePt } }]
        : htmlCellToPptxRuns(rawStr, { color: textColorOverride, bold, fontSize: fontSizePt });
      return { text: runs, options: { align, valign: 'top', fill, border, margin: cellMargin, fontSize: fontSizePt } };
    });
  });
  slide.addTable(tableRows, { x: rect.x, y: rect.y, w: rect.w, colW, autoPage: false });
}

function buildKpiOrSensorCardSlideObject(slide, el, scaleInfo) {
  const props = el.props || {};
  const snap = props.snapshot;
  const value = snap && snap.value != null ? String(snap.value) : (props.value || '—');
  const unit = snap && snap.unit ? ` ${snap.unit}` : '';
  const rect = toSlideRect(el, scaleInfo);
  slide.addShape('roundRect', { ...rect, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 }, rectRadius: 0.06 });
  slide.addText([
    { text: value + unit, options: { bold: true, fontSize: scaledPt(26, scaleInfo), color: '0891B2', breakLine: true } },
    { text: String(props.title || (el.type === 'kpi' ? 'KPI' : 'Sensor')), options: { fontSize: scaledPt(11, scaleInfo), color: '475569' } },
  ], { ...rect, align: 'center', valign: 'middle', margin: 0 });
}

function buildSeismicSlideObjects(slide, el, scaleInfo) {
  const props = el.props || {};
  const snap = props.snapshot || {};
  const igpEvents = Array.isArray(snap.igpEvents) ? snap.igpEvents : [];
  const source = props.source || 'both';
  const rect = toSlideRect(el, scaleInfo);
  const titleH = Math.min(rect.h, pxToInch(28) * scaleInfo.scale);
  slide.addText([
    { text: String(props.title || 'Reporte Sismográfico'), options: { bold: true, fontSize: scaledPt(14, scaleInfo), breakLine: false } },
    { text: `  (${props.startDate || ''} — ${props.endDate || ''})`, options: { fontSize: scaledPt(11, scaleInfo), color: '64748B' } },
  ], { x: rect.x, y: rect.y, w: rect.w, h: titleH, valign: 'top', margin: 0 });

  const dataRows = (source === 'igp' || source === 'both')
    ? (igpEvents.length > 0 ? igpEvents.slice(-10).reverse().map((ev) => [String(ev.fecha_local || '—').slice(0, 10), String(ev.magnitud == null ? '—' : ev.magnitud), String(ev.profundidad == null ? '—' : ev.profundidad), String(ev.referencia || '—')]) : [['Sin sismos oficiales en el rango.', '', '', '']])
    : [];
  const companyLine = (source === 'company' || source === 'both') ? `Microsismicidad — sensores propios: ${snap.companyCount != null ? snap.companyCount : 'Sin snapshot'} eventos detectados en el rango.` : null;
  const colW = [rect.w * 0.28, rect.w * 0.16, rect.w * 0.2, rect.w * 0.36];
  const rows = [];
  if (source === 'igp' || source === 'both') {
    rows.push(['Fecha', 'Mag.', 'Prof.(km)', 'Referencia'].map((h) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: '17365D' }, fontSize: scaledPt(11, scaleInfo) } })));
  }
  dataRows.forEach((row) => rows.push(row.map((cell) => ({ text: cell, options: { fontSize: scaledPt(10, scaleInfo) } }))));
  if (companyLine) rows.push([{ text: companyLine, options: { italic: true, fontSize: scaledPt(10, scaleInfo), color: '334155', colspan: 4 } }]);
  if (rows.length === 0) rows.push([{ text: 'Sin datos sismográficos configurados.' }]);
  slide.addTable(rows, { x: rect.x, y: rect.y + titleH + 0.05, w: rect.w, colW, autoPage: false, border: { type: 'solid', color: 'E2E8F0', pt: 0.5 } });
}

function decodeDataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try { return Buffer.from(match[1], 'base64'); } catch { return null; }
}

function addPngImage(slide, rect, png, altText) {
  slide.addImage({ data: `image/png;base64,${png.toString('base64')}`, x: rect.x, y: rect.y, w: rect.w, h: rect.h, altText });
}

// `captionText`: si viene (no vacío), se agrega un cuadro de texto VISIBLE
// debajo de la imagen -- antes NINGÚN raster (chart/sensor_multi_chart/
// image) tenía caption visible en PPTX, solo `altText` (metadata de
// accesibilidad invisible en la diapositiva); DOCX sí lo hacía para chart/
// sensor_multi_chart vía `buildRasterWidget` -- encontrado auditando
// "anexos"/"referencias" 2026-09-23, mismo criterio de alto reservado.
const RASTER_CAPTION_HEIGHT_PX_PPTX = 18;
function buildRasterSlideObject(slide, el, scaleInfo, png, label, captionText) {
  const rect = toSlideRect(el, scaleInfo);
  if (!png) {
    slide.addText(`[${(el.props && el.props.title) || label} — no se pudo capturar para esta exportación]`, { ...rect, align: 'center', valign: 'middle', italic: true, color: '94A3B8', fontSize: scaledPt(10, scaleInfo) });
    return;
  }
  const trimmedCaption = String(captionText || '').trim();
  if (!trimmedCaption) {
    addPngImage(slide, rect, png, String((el.props && el.props.title) || label));
    return;
  }
  const captionHeightIn = pxToInch(RASTER_CAPTION_HEIGHT_PX_PPTX) * scaleInfo.scale;
  const imageRect = { ...rect, h: Math.max(0.05, rect.h - captionHeightIn) };
  addPngImage(slide, imageRect, png, trimmedCaption);
  slide.addText(trimmedCaption, {
    x: rect.x, y: rect.y + imageRect.h, w: rect.w, h: captionHeightIn,
    align: 'center', valign: 'middle', italic: true, color: '4F81BD', fontSize: scaledPt(9, scaleInfo),
  });
}

function buildVideoSlideObject(slide, el, scaleInfo) {
  const props = el.props || {};
  const posterBuffer = decodeDataUrlToBuffer(props.posterSrc);
  const rect = toSlideRect(el, scaleInfo);
  const durationLabel = props.durationSeconds ? ` (${props.durationSeconds}s)` : '';
  const sourceLabel = props.source === 'screen' ? 'grabación de pantalla' : 'grabación de cámara web';
  if (posterBuffer) { addPngImage(slide, rect, posterBuffer, `Video — ${sourceLabel}`); return; }
  slide.addText(`[Video adjunto${durationLabel} — ${sourceLabel} — no reproducible en este formato de exportación]`, { ...rect, align: 'center', valign: 'middle', italic: true, color: '64748B', fontSize: scaledPt(10, scaleInfo) });
}

function buildCoverSlideObject(slide, el, session, scaleInfo, rasterAssets) {
  const props = el.props || {};
  const template = findCoverTemplate(props.coverTemplate);
  const rect = toSlideRect(el, scaleInfo);
  const bg = rasterAssets.get(el.id);
  if (bg) { addPngImage(slide, rect, bg, 'Carátula'); return; }
  const chromeAuthor = session.fullName || session.username;
  const textColor = cssColorToHex(template.textColor, 'FFFFFF');
  const lines = [
    { text: String(props.classification || template.classificationLabel), options: { bold: true, fontSize: scaledPt(11, scaleInfo), color: cssColorToHex(template.classificationColor, 'FBBF24'), breakLine: true } },
    { text: String(props.title || template.titleFallback), options: { bold: true, fontSize: scaledPt(30, scaleInfo), color: textColor, breakLine: true } },
  ];
  if (session.company) lines.push({ text: session.company, options: { bold: true, fontSize: scaledPt(16, scaleInfo), color: textColor, breakLine: true } });
  if (props.docCode) lines.push({ text: `Código: ${props.docCode}`, options: { fontSize: scaledPt(10, scaleInfo), color: textColor, breakLine: true } });
  if (chromeAuthor) lines.push({ text: `Autor: ${chromeAuthor}`, options: { fontSize: scaledPt(10, scaleInfo), color: textColor, breakLine: true } });
  if (props.date) lines.push({ text: `Fecha: ${props.date}`, options: { fontSize: scaledPt(10, scaleInfo), color: textColor } });
  slide.addShape('rect', { ...rect, fill: { color: '0F172A' }, line: { type: 'none' } });
  slide.addText(lines, { ...rect, align: 'center', valign: 'middle', margin: 0.2 });
}

// Índice NATIVO de PowerPoint: a diferencia del campo TOC de Word, pptxgenjs
// no tiene un "campo vivo" equivalente -- se renderiza como una lista con el
// mismo tramo de entradas que ya usa la versión Word/pantalla
// (`tocSliceForElementId`), pero cada línea lleva un hipervínculo interno
// REAL (`hyperlink.slide`) al número de diapositiva correspondiente (una
// diapositiva por página del informe, así que `pageNumber` == número de
// diapositiva) -- es el equivalente PowerPoint de un índice clickeable real.
function buildTocSlideObject(slide, doc, el, scaleInfo) {
  const props = el.props || {};
  const entries = tocSliceForElementId(doc, el.id);
  const rect = toSlideRect(el, scaleInfo);
  const titleText = String(props.title || 'Tabla de Contenidos') + (typeof props.tocContinuationIndex === 'number' ? ' (continuación)' : '');
  const titleH = Math.min(rect.h, pxToInch(30) * scaleInfo.scale);
  slide.addText(titleText, { x: rect.x, y: rect.y, w: rect.w, h: titleH, bold: true, fontSize: scaledPt(18, scaleInfo), color: '0F172A' });
  if (entries.length === 0) {
    slide.addText('Aplique estilos Título/Heading a bloques de texto para generar el índice.', { x: rect.x, y: rect.y + titleH, w: rect.w, h: rect.h - titleH, italic: true, fontSize: scaledPt(11, scaleInfo), color: '94A3B8' });
    return;
  }
  const runs = [];
  entries.forEach((entry, i) => {
    runs.push({ text: `${entry.number}  `, options: { bold: true, fontSize: scaledPt(12, scaleInfo), color: '0F172A' } });
    runs.push({ text: `${entry.text}`, options: { fontSize: scaledPt(12, scaleInfo), color: '1E293B', hyperlink: { slide: entry.pageNumber }, breakLine: i < entries.length - 1 } });
  });
  slide.addText(runs, { x: rect.x, y: rect.y + titleH, w: rect.w, h: rect.h - titleH, valign: 'top', margin: 0 });
}

function buildHeaderFooterSlideObject(slide, el, session, scaleInfo, kind) {
  const rect = toSlideRect(el, scaleInfo);
  if (kind === 'header') {
    const chromeParts = [session.company, resolveMiningUnitName(session), session.fullName || session.username].filter((v) => v && String(v).trim());
    const chromeLabel = (chromeParts.length > 0 ? chromeParts.join('  •  ') : 'EMPRESA MINERA').toUpperCase();
    slide.addText(chromeLabel, { ...rect, bold: true, fontSize: scaledPt(9, scaleInfo), color: '595959', fontFace: 'Arial Black', valign: 'middle' });
    return;
  }
  // "PÁGINA N / TOTAL" ya lo dibuja el master (`slideNumber`, ver
  // buildReportPptx) en la esquina -- el footer nativo solo aporta la marca.
  slide.addText('BEEMETRY', { ...rect, bold: true, fontSize: scaledPt(9, scaleInfo), color: '595959', fontFace: 'Arial Black', valign: 'middle' });
}

function buildSlideForPage(pptx, doc, docPage, session, opts, resolveRef, scaleInfo) {
  const slide = pptx.addSlide({ masterName: opts.masterName });
  const sorted = [...(docPage.elements || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  sorted.forEach((el) => {
    if (RASTER_ELEMENT_TYPES.has(el.type)) {
      const png = el.type === 'image' ? opts.imageAssets.get(el.id) : opts.rasterAssets.get(el.id);
      if (el.type === 'cover') buildCoverSlideObject(slide, el, session, scaleInfo, opts.rasterAssets);
      else {
        const isChartLike = el.type === 'chart' || el.type === 'sensor_multi_chart';
        const label = el.type === 'chart' ? 'Gráfico' : el.type === 'sensor_multi_chart' ? 'Gráfico de sensores' : 'Imagen';
        // chart/sensor_multi_chart: caption SIEMPRE (mismo criterio que
        // buildRasterWidget en reportDocxBuilder.js). image: solo si tiene
        // Leyenda propia (props.caption). shape/wordart: nunca.
        const captionText = isChartLike ? ((el.props && el.props.title) || label) : el.type === 'image' ? (el.props && el.props.caption) : undefined;
        buildRasterSlideObject(slide, el, scaleInfo, png, label, captionText);
      }
      return;
    }
    switch (el.type) {
      case 'text': buildTextSlideObject(slide, el, scaleInfo, resolveRef); break;
      case 'table': buildTableSlideObject(slide, el, scaleInfo); break;
      case 'kpi': case 'sensor': buildKpiOrSensorCardSlideObject(slide, el, scaleInfo); break;
      case 'seismic-report': buildSeismicSlideObjects(slide, el, scaleInfo); break;
      case 'toc': buildTocSlideObject(slide, doc, el, scaleInfo); break;
      case 'header': buildHeaderFooterSlideObject(slide, el, session, scaleInfo, 'header'); break;
      case 'footer': buildHeaderFooterSlideObject(slide, el, session, scaleInfo, 'footer'); break;
      case 'video': buildVideoSlideObject(slide, el, scaleInfo); break;
      default: break;
    }
  });
  return slide;
}

/**
 * `pptx`: instancia PptxGenJS ya creada por el caller (server.js), para que
 * pueda escribir el archivo/medir tiempos igual que antes. `doc`:
 * ReportDocument JSON. `opts.session`: chrome de plataforma. `opts.
 * imageAssets`/`opts.rasterAssets`: `Map<elementId, Buffer>` PNG ya
 * capturados (mismo checkpoint compartido con DOCX, ver
 * rasterCapturePipeline.js).
 */
function buildReportPptx(pptx, doc, opts) {
  // Mismo fix que reportDocxBuilder.js (2026-09-23): faltaba el fallback a
  // anexo, una referencia cruzada a imagen/tabla/gráfico con Leyenda
  // resolvía siempre a `undefined` acá también.
  const resolveRef = (targetId) => resolveHeadingRefLabel(doc, targetId) ?? resolveAnnexRefLabel(doc, targetId);
  const docMeta = doc.meta || {};
  const layoutMode = docMeta.layoutMode === 'presentation' ? 'presentation' : 'document';
  const deckSize = resolveDeckSize(doc, layoutMode);
  const LAYOUT_NAME = layoutMode === 'presentation' ? 'BEEMETRY_16x9' : 'BEEMETRY_DOC';
  pptx.defineLayout({ name: LAYOUT_NAME, width: deckSize.widthIn, height: deckSize.heightIn });
  pptx.layout = LAYOUT_NAME;
  pptx.title = (docMeta.title) || 'Informe técnico';
  pptx.author = opts.session.fullName || docMeta.author || 'Beemetry';
  pptx.company = opts.session.company || 'Beemetry';
  pptx.subject = 'Informe técnico minero — exportado desde Beemetry';
  pptx.revision = '1';

  const SLIDE_MASTER_NAME = 'BEEMETRY_MASTER';
  pptx.defineSlideMaster({
    title: SLIDE_MASTER_NAME,
    slideNumber: { x: deckSize.widthIn - 0.55, y: deckSize.heightIn - 0.32, w: 0.45, h: 0.24, fontSize: 9, color: '94A3B8', align: 'right' },
  });

  doc.pages.forEach((docPage) => {
    const scaleInfo = pageScaleInfo(docPage, docMeta, deckSize.widthIn, deckSize.heightIn, layoutMode);
    buildSlideForPage(pptx, doc, docPage, opts.session, { ...opts, masterName: SLIDE_MASTER_NAME }, resolveRef, scaleInfo);
  });
}

module.exports = { buildReportPptx, resolveDeckSize, SLIDE_WIDTH_IN, SLIDE_HEIGHT_IN };
