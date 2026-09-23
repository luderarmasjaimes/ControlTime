'use strict';
/**
 * Pipeline B (servidor) del export DOCX — puerto a Node/CommonJS de la MISMA
 * especificación de mapeo que `frontend/src/components/ReportStudioV2/lib/
 * docx/buildReportDocx.ts` (Pipeline A, cliente). Sin código compartido a
 * propósito (contextos de build separados, ver docker-compose.yml
 * `pdf-export-service` vs. `frontend`) -- ver la nota de alcance del plan.
 *
 * Entrada: `doc` = el mismo JSON `ReportDocument` que ya lee el cliente
 * (recuperado vía `window.__REPORT_DOCUMENT__` en la página
 * print-report.html, ver /render-docx más abajo), + `session` (chrome de
 * plataforma) + `rasterAssets`/`imageAssets` (PNG bytes ya capturados por
 * Puppeteer, clave `ReportElement.id`).
 */
const {
  AlignmentType, Document, ExternalHyperlink, Footer, FrameAnchorType, FrameWrap, Header, HeadingLevel,
  ImageRun, LevelFormat, LineRuleType, OverlapType, PageNumber, PageOrientation, Packer, Paragraph,
  SectionType, ShadingType, Table, TableAnchorType, TableCell, TableOfContents, TableRow,
  TabStopType, TextRun, WidthType, BorderStyle,
} = require('docx');
const {
  pxToTwip, pxFontToHalfPt, cssColorToHex, firstFontFamily, headingLevelFor,
  findCoverTemplate, resolveMiningUnitName,
  sanitizeSpans, buildStyledSegments,
  resolveHeadingRefLabel, resolveAnnexRefLabel,
  parseHtmlToRuns,
  resolvePagePaperSetup,
} = require('./reportSharedHelpers');
// Motor de fórmulas (ADR-172) + formato condicional + coloreado semántico --
// ver tableEngine.js para el porqué (puerto fiel de tableFormulas.ts/
// tableConditionalFormat.ts/semanticStatus.ts, faltaba por completo en este
// pipeline server-side: confirmado en el "Reporte de observaciones"
// 2026-09-21 de Jhon Alvarez, items 5 y 6).
const {
  computeTableFormulas, getEffectiveCellValues, computeConditionalStyles, semanticStatusStyle,
} = require('./tableEngine');

// ── lib/headingStyles.ts (mapeo docx-específico -- el nivel 0-6 puro vive en
// reportSharedHelpers.js::headingLevelFor, esto solo lo traduce al enum real
// de la librería `docx`) ────────────────────────────────────────────────────
const HEADING_LEVEL_BY_STYLE = {
  title: HeadingLevel.TITLE, h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
};

// resolvePagePaperSetup: ver reportSharedHelpers.js (compartido con PPTX).

// ── mapeo de elementos (calco de buildReportDocx.ts) ───────────────────────
const ALIGN_BY_CSS = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const alignmentFromCss = (v) => ALIGN_BY_CSS[String(v || 'left')] || AlignmentType.LEFT;

function frameWrapFor(wrapMode) {
  switch (wrapMode) {
    case 'tight': case 'through': return FrameWrap.TIGHT;
    case 'topbottom': return FrameWrap.NOT_BESIDE;
    case 'square': return FrameWrap.AROUND;
    default: return FrameWrap.NONE;
  }
}
function elementFrame(el, overrides) {
  const o = overrides || {};
  return {
    type: 'absolute',
    position: { x: pxToTwip(o.xPx != null ? o.xPx : el.x), y: pxToTwip(o.yPx != null ? o.yPx : el.y) },
    width: pxToTwip(Math.max(1, o.widthPx != null ? o.widthPx : el.width)),
    height: pxToTwip(Math.max(1, o.heightPx != null ? o.heightPx : el.height)),
    anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
    wrap: frameWrapFor(el.wrapMode),
  };
}
// Modo "flow" (alternativa a la fidelidad de layout absoluto de ADR-139):
// en vez de anclar cada bloque a su x/y exacto del lienzo (`w:framePr`, ver
// `elementFrame` arriba), lo deja fluir en el orden normal de un documento
// Word -- texto que se reflowa, sin cuadros de texto independientes. Pedido
// explícito 2026-09-18 tras confirmar en vivo que el pipeline de alta
// fidelidad (cliente Y servidor, mismo criterio) produce SIEMPRE bloques
// enmarcados, nunca texto plano continuo. `flow` es un parámetro explícito
// (nunca una bandera de módulo) porque varios exports DOCX pueden estar en
// vuelo a la vez en este mismo proceso Node -- una bandera global se
// filtraría entre requests concurrentes.
function frameOrFlowProps(el, overrides, flow) {
  if (flow) return { spacing: { after: 160 } };
  return { frame: elementFrame(el, overrides) };
}
function tableFloatOrFlowProps(el, yOffsetPx, flow) {
  if (flow) return {};
  return { float: { horizontalAnchor: TableAnchorType.PAGE, absoluteHorizontalPosition: pxToTwip(el.x), verticalAnchor: TableAnchorType.PAGE, absoluteVerticalPosition: pxToTwip(el.y + (yOffsetPx || 0)), overlap: OverlapType.NEVER } };
}

// Interlineado (`props.lineHeight`, multiplicador tipo CSS -- 1 = sencillo,
// 1.5 = 1½ líneas, etc., mismo campo que ya usa TextBlock.tsx para el CSS
// `line-height` en pantalla): faltaba POR COMPLETO en este builder (y en
// buildReportDocx.ts, pipeline cliente) -- ningún `Paragraph` fijaba nunca
// `spacing.line`, así que Word siempre mostraba el interlineado default del
// estilo base sin importar lo que el usuario configuró en el lienzo.
// Encontrado auditando el pedido explícito de "control de interlineado"
// (2026-09-22). Word mide "auto" en 240-avos de línea (240 = sencillo, igual
// convención que `w:spacing w:lineRule="auto"` en el OOXML crudo).
const DEFAULT_LINE_HEIGHT = 1.35;
function lineSpacingProps(props) {
  const lineHeight = Number(props.lineHeight) > 0 ? Number(props.lineHeight) : DEFAULT_LINE_HEIGHT;
  return { spacing: { line: Math.round(lineHeight * 240), lineRule: LineRuleType.AUTO } };
}
// `props.backgroundColor` (fondo de TODO el bloque de texto -- distinto de
// `span.highlightColor`, que solo pinta el rango resaltado) faltaba por
// completo: `ReadOnlyViewer.tsx` ya lo pinta en pantalla/PDF (ver ADR-204
// §H, PDF hereda el DOM real), pero ningún `Paragraph` de este builder
// llevaba nunca `shading` -- encontrado auditando "texto con color de
// fondo" 2026-09-23. Mismo `ShadingType.CLEAR`/`fill` que ya usa
// `buildTableElement` para celdas.
function blockShadingProps(props) {
  const bg = props.backgroundColor;
  if (!bg || bg === 'transparent') return {};
  return { shading: { type: ShadingType.CLEAR, color: 'auto', fill: cssColorToHex(bg, 'FFFFFF') } };
}

const HIGHLIGHT_NAMES = new Set(['black', 'blue', 'cyan', 'darkBlue', 'darkCyan', 'darkGray', 'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'green', 'lightGray', 'magenta', 'red', 'white', 'yellow']);
function highlightFromColor(value) {
  if (!value || value === 'transparent') return undefined;
  return HIGHLIGHT_NAMES.has(value) ? value : 'yellow';
}
// Mismo whitelist que ya usa htmlCellToRuns (más abajo, celdas de tabla) --
// se revalida acá por defensa en profundidad, un `href` de span ya se validó
// al importarlo (lib/richPaste.ts::SAFE_LINK_SCHEME).
const SAFE_LINK_SCHEME_TEXT = /^(https?:|mailto:)/i;
function segmentsToRuns(segments) {
  const out = [];
  let pendingBreaks = 0;
  // Runs consecutivos con el mismo `href` se agrupan en UN solo
  // ExternalHyperlink con varios hijos -- mismo criterio que htmlCellToRuns
  // más abajo (celdas de tabla) y buildReportDocx.ts (Pipeline A, cliente).
  let linkGroup = null; // { href, children: TextRun[] }
  const flushLinkGroup = () => {
    if (linkGroup) out.push(new ExternalHyperlink({ link: linkGroup.href, children: linkGroup.children }));
    linkGroup = null;
  };
  segments.forEach((seg) => {
    const href = seg.href && SAFE_LINK_SCHEME_TEXT.test(seg.href) ? seg.href : undefined;
    if (href !== (linkGroup && linkGroup.href)) flushLinkGroup();
    seg.text.split('\n').forEach((line, i) => {
      if (i > 0) pendingBreaks += 1;
      if (line.length === 0) return;
      const run = new TextRun({
        text: line, break: pendingBreaks || undefined,
        bold: seg.style.bold || undefined, italics: seg.style.italic || undefined,
        underline: seg.style.underline ? {} : undefined,
        strike: seg.style.strikethrough || undefined,
        color: cssColorToHex(seg.style.color, '0F172A'), font: firstFontFamily(seg.style.fontFamily),
        size: pxFontToHalfPt(seg.style.fontSize), highlight: highlightFromColor(seg.style.highlightColor),
      });
      if (href) {
        if (!linkGroup) linkGroup = { href, children: [] };
        linkGroup.children.push(run);
      } else {
        out.push(run);
      }
      pendingBreaks = 0;
    });
  });
  flushLinkGroup();
  if (pendingBreaks > 0) out.push(new TextRun({ text: '', break: pendingBreaks }));
  return out.length > 0 ? out : [new TextRun({ text: '' })];
}
// ── Numeración NATIVA de Word para listas (observación #2, reporte
// 2026-09-21 -- aclarada 2026-09-22 por el usuario: "esto no es texto
// plano... es 1.<TAB>texto, y al presionar Enter Word crea 2. solo").
// Antes de este fix, `listType` no significaba nada para este builder --
// tanto el pipeline cliente como el servidor solo veían `props.text` como
// UN string con marcadores LITERALES ("1. ", "• ") ya incrustados por
// `applyListToText` (lib/listFormatting.ts) y saltos de línea `\n`
// normales, así que Word los mostraba como texto suelto, nunca como una
// lista real (sin campo NUMPAGES-como de numeración, sin renumeración
// automática al presionar Enter). Este bloque reconstruye la lista NATIVA:
// separa cada línea en su propio `Paragraph` con `numbering: {reference,
// level, instance}` (OOXML w:numPr) y le quita a esa línea su marcador/tabs
// literales (Word los vuelve a dibujar solo, vía numbering.xml). Solo en
// FLOW (una lista real necesita varios párrafos independientes; en layout
// absoluto todo el bloque sigue siendo UN frame/w:framePr, que no está
// reportado como roto -- ver alcance del reporte original).
const NUMBER_LIST_REFERENCE = 'beemetry-flow-number-list';
const BULLET_LIST_REFERENCE = 'beemetry-flow-bullet-list';
const LIST_DEPTH_CHAR = '\t';
const LIST_MAX_DEPTH = 4;
// Mismo patrón que LIST_MARKER_RE de lib/listFormatting.ts -- reconoce el
// marcador que `applyListToText` ya insertó, para poder quitarlo (Word lo
// re-dibuja vía numbering.xml, dejarlo also produciría "1.\t1. Texto").
const LIST_MARKER_RE = /^(•\s*|◦\s*|▪\s*|[a-z]+\.\s*|[ivxlcdm]+\.\s*|\d+\.\s*)/i;
function listLineDepth(line) {
  let d = 0;
  while (d < line.length && line[d] === LIST_DEPTH_CHAR) d += 1;
  return Math.min(d, LIST_MAX_DEPTH);
}
// Mismo ciclo de 3 niveles que numberMarkerForDepth/bulletMarkerForDepth en
// lib/listFormatting.ts (1/2/3 -> a/b/c -> i/ii/iii, y de vuelta a 1/2/3 en
// el nivel 4) -- así una lista con sub-niveles se ve igual en el editor y
// en el .docx exportado. `text: "%N."` referencia SOLO el contador de ESE
// nivel (no concatena niveles padre, igual que el editor: un sub-item no
// muestra "1.a." sino solo "a.").
function numberListLevels() {
  return Array.from({ length: LIST_MAX_DEPTH + 1 }, (_, level) => {
    const cycle = level % 3;
    const format = cycle === 0 ? LevelFormat.DECIMAL : cycle === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.LOWER_ROMAN;
    return {
      level, format, text: `%${level + 1}.`, alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: (level + 1) * 720, hanging: 360 } } },
    };
  });
}
function bulletListLevels() {
  const markers = ['•', '◦', '▪'];
  return Array.from({ length: LIST_MAX_DEPTH + 1 }, (_, level) => ({
    level, format: LevelFormat.BULLET, text: markers[level % 3], alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: (level + 1) * 720, hanging: 360 } } },
  }));
}

/** Arma UN párrafo real de Word por línea de un bloque-lista (en vez del
 * único `Paragraph` con `\n` internos que usa un bloque de texto normal).
 * `listCtx.nextInstance` da a CADA bloque-lista del documento su propio
 * contador independiente (`numbering.instance`) -- comparten el mismo
 * `reference`/niveles, pero cada lista arranca en 1 por separado (ver
 * `Numbering.createConcreteNumberingInstance`, docx crea la instancia
 * concreta sola la primera vez que ve ese par reference+instance). */
function buildFlowListParagraphs(el, resolveRef, listCtx) {
  const props = el.props || {};
  const text = String(props.text || '');
  const listType = props.listType === 'bullet' ? 'bullet' : 'number';
  const reference = listType === 'bullet' ? BULLET_LIST_REFERENCE : NUMBER_LIST_REFERENCE;
  const instance = listCtx.nextInstance;
  listCtx.nextInstance += 1;
  const base = { bold: !!props.bold, italic: !!props.italic, underline: !!props.underline, color: props.fontColor || '#0f172a', fontSize: props.fontSize || 14, fontFamily: props.fontFamily || 'Arial', highlightColor: props.highlightColor || 'transparent' };
  const allSpans = sanitizeSpans(props.spans, text.length);
  const alignment = alignmentFromCss(props.textAlign);
  const lineSpacing = lineSpacingProps(props).spacing;
  const paragraphs = [];
  let offset = 0;
  text.split('\n').forEach((line) => {
    const lineStart = offset;
    offset += line.length + 1; // +1: el '\n' que `split` ya consumió
    const depth = listLineDepth(line);
    const afterTabs = line.slice(depth);
    const markerMatch = LIST_MARKER_RE.exec(afterTabs);
    const markerLen = markerMatch ? markerMatch[0].length : 0;
    const contentStart = lineStart + depth + markerLen;
    const contentEnd = lineStart + line.length;
    const contentText = text.slice(contentStart, contentEnd);
    if (!markerMatch) {
      // Línea sin marcador (vacía, o texto suelto que el usuario dejó fuera
      // de la lista con onlyExistingListLines) -- párrafo normal, sin numPr.
      if (!contentText.trim()) { paragraphs.push(new Paragraph({ spacing: { after: 80, ...lineSpacing } })); return; }
      const segments = buildStyledSegments(contentText, rebaseSpans(allSpans, contentStart, contentText.length), base, resolveRef);
      paragraphs.push(new Paragraph({ alignment, spacing: { after: 80, ...lineSpacing }, children: segmentsToRuns(segments) }));
      return;
    }
    const segments = buildStyledSegments(contentText, rebaseSpans(allSpans, contentStart, contentText.length), base, resolveRef);
    paragraphs.push(new Paragraph({
      numbering: { reference, level: depth, instance },
      alignment, spacing: { after: 40, ...lineSpacing },
      children: segmentsToRuns(segments),
    }));
  });
  return paragraphs.length > 0 ? paragraphs : [new Paragraph('')];
}
/** Recorta+reubica `spans` (offsets absolutos del texto ORIGINAL, con tabs y
 * marcador incluidos) a coordenadas LOCALES del contenido de una línea sin
 * su marcador -- un span que cruza el límite del recorte se recorta a él. */
function rebaseSpans(spans, contentStart, contentLength) {
  return spans
    .map((s) => ({ ...s, start: s.start - contentStart, end: s.end - contentStart }))
    .filter((s) => s.end > 0 && s.start < contentLength)
    .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(contentLength, s.end) }));
}

// Columnas tipo periódico (`props.columnCount`, 2026-09-23): ni `docx` ni
// `pptxgenjs` exponen columnas reales a nivel de un solo párrafo/cuadro de
// texto (es una propiedad de SECCIÓN completa en OOXML, `w:cols`, que
// obligaría a partir la página entera en varias secciones -- fuera de
// alcance, arriesgaría el resto del contenido de la página). Se aproxima
// partiendo el TEXTO (nunca a mitad de palabra) en N trozos balanceados por
// longitud y armando N cuadros de texto (frames) lado a lado, cada uno con
// sus propios spans reubicados -- mismo resultado visual que columnas
// reales para el caso de uso real (texto corrido sin tablas/listas
// intercaladas), aunque no reflowa en vivo si se edita en Word después.
function splitTextIntoColumnChunks(text, columnCount) {
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
const COLUMN_GAP_PX = 16;
function buildColumnParagraphs(el, props, text, spans, base, resolveRef, columnCount) {
  const chunks = splitTextIntoColumnChunks(text, columnCount);
  const colWidthPx = Math.max(20, (el.width - COLUMN_GAP_PX * (columnCount - 1)) / columnCount);
  return chunks.map((chunk, i) => {
    const rebased = rebaseSpans(spans, chunk.start, chunk.text.length);
    const segments = buildStyledSegments(chunk.text, rebased, base, resolveRef);
    // Las sub-columnas SIEMPRE usan un frame anclado a su posición real en
    // el lienzo -- incluso en modo `flow` (única excepción a "todo fluye
    // normal" de ese modo, ver comentario de `frameOrFlowProps`): Word no
    // tiene un equivalente de "columnas dentro de un párrafo que fluye".
    const frame = elementFrame(el, { xPx: el.x + i * (colWidthPx + COLUMN_GAP_PX), widthPx: colWidthPx });
    return new Paragraph({
      frame, ...blockShadingProps(props),
      spacing: lineSpacingProps(props).spacing,
      alignment: alignmentFromCss(props.textAlign),
      children: segmentsToRuns(segments),
    });
  });
}

function buildTextElement(el, resolveRef, flow, listCtx) {
  const props = el.props || {};
  if (flow && (props.listType === 'bullet' || props.listType === 'number') && listCtx) {
    return buildFlowListParagraphs(el, resolveRef, listCtx);
  }
  const text = String(props.text || '');
  const base = { bold: !!props.bold, italic: !!props.italic, underline: !!props.underline, color: props.fontColor || '#0f172a', fontSize: props.fontSize || 14, fontFamily: props.fontFamily || 'Arial', highlightColor: props.highlightColor || 'transparent', headingStyle: props.headingStyle };
  const spans = sanitizeSpans(props.spans, text.length);
  const columnCount = Math.max(1, Math.min(4, Number(props.columnCount) || 1));
  if (columnCount > 1) return buildColumnParagraphs(el, props, text, spans, base, resolveRef, columnCount);
  const segments = buildStyledSegments(text, spans, base, resolveRef);
  const wholeBlockLevel = props.headingStyle ? HEADING_LEVEL_BY_STYLE[props.headingStyle] : undefined;
  const baseProps = frameOrFlowProps(el, undefined, flow);
  const spacing = { ...(baseProps.spacing || {}), ...lineSpacingProps(props).spacing };
  return [new Paragraph({ ...baseProps, ...blockShadingProps(props), spacing, heading: wholeBlockLevel, alignment: alignmentFromCss(props.textAlign), children: segmentsToRuns(segments) })];
}

// Adaptador docx-específico sobre el parser HTML->runs neutro de
// reportSharedHelpers.js: cada run neutro trae `bold`/`italics`/`underline`
// en `true`/`undefined` (nunca `false`), así que `run.X ?? base.X` hereda el
// estilo base de la celda cuando el HTML no trae un tag explícito para ese
// atributo -- `<a href>` se reproduce como ExternalHyperlink NATIVO real
// (mismo criterio que htmlCellToRuns.ts del pipeline cliente).
function htmlCellToRuns(html, base) {
  const baseColor = base.color ? cssColorToHex(base.color) : undefined;
  const baseSize = pxFontToHalfPt(base.fontSizePx);
  const neutralRuns = parseHtmlToRuns(html);
  const toTextRun = (run) => new TextRun({
    text: run.text,
    break: run.break ? 1 : undefined,
    bold: (run.bold ?? base.bold) || undefined,
    italics: run.italics || undefined,
    underline: run.underline ? {} : undefined,
    color: baseColor,
    size: baseSize,
  });
  // Runs consecutivos con el mismo `href` (p.ej. un <b> anidado dentro de un
  // <a>) se agrupan en UN solo ExternalHyperlink con varios hijos, en vez de
  // varios hipervínculos adyacentes -- mismo resultado que el parser
  // producía antes de moverse a reportSharedHelpers.js.
  const runs = [];
  let linkGroup = null; // { href, children: TextRun[] }
  const flushLinkGroup = () => {
    if (linkGroup) runs.push(new ExternalHyperlink({ link: linkGroup.href, children: linkGroup.children }));
    linkGroup = null;
  };
  neutralRuns.forEach((run) => {
    if (run.href) {
      if (linkGroup && linkGroup.href === run.href) linkGroup.children.push(toTextRun(run));
      else { flushLinkGroup(); linkGroup = { href: run.href, children: [toTextRun(run)] }; }
    } else {
      flushLinkGroup();
      runs.push(toTextRun(run));
    }
  });
  flushLinkGroup();
  return runs.length > 0 ? runs : [new TextRun({ text: '', size: baseSize })];
}

function buildTableElement(el, flow) {
  const props = el.props || {};
  const rows = Array.isArray(props.rows) ? props.rows : [];
  if (rows.length === 0) return new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] })] });
  const hasHeader = props.hasHeader !== false;
  const fontSize = Number(props.fontSize) || 14;
  const cellPaddingTwip = pxToTwip(Number(props.cellPadding) || 10);
  const colCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  const totalWidthTwip = pxToTwip(el.width);
  const providedWidths = Array.isArray(props.colWidths) ? props.colWidths : [];
  const colWidths = Array.from({ length: colCount }, (_, i) => (providedWidths[i] ? pxToTwip(providedWidths[i]) : Math.round(totalWidthTwip / colCount)));
  const borderColor = cssColorToHex(props.borderColor, 'E2E8F0');
  const borderWidthPx = Number(props.borderWidth) || 1;
  const borderStyleWord = props.borderStyle === 'dashed' ? BorderStyle.DASHED : props.borderStyle === 'dotted' ? BorderStyle.DOTTED : props.borderStyle === 'none' ? BorderStyle.NONE : BorderStyle.SINGLE;
  const cellBorder = { style: borderStyleWord, size: Math.max(2, borderWidthPx * 4), color: borderColor };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const align = props.cellAlign === 'center' ? AlignmentType.CENTER : props.cellAlign === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;

  // Mismo cálculo que TableBlock.tsx (ver comentario de arriba junto al
  // require de tableEngine.js): fórmulas -> valor calculado, formato
  // condicional/escalas de color -> estilo por celda. `rows` viaja tal cual
  // (HTML crudo) -- `computeTableFormulas` ya sabe leer el texto plano.
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
    const cells = Array.from({ length: colCount }, (_, ci) => {
      const raw = Array.isArray(row) ? row[ci] : '';
      const rawStr = String(raw == null ? '' : raw);
      const formulaResult = formulaResults[ri] && formulaResults[ri][ci];
      // Mismo orden de precedencia que el `style` inline de <td> en
      // TableBlock.tsx: formato condicional > override manual (celda/fila/
      // columna) > semáforo semántico (solo si no es cabecera) > banda/
      // cabecera > transparente.
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
      const shading = bgColor ? { type: ShadingType.CLEAR, color: 'auto', fill: cssColorToHex(bgColor, 'FFFFFF') } : undefined;
      const bold = isHeaderRow ? props.headerBold !== false : false;
      // Celda-fórmula: se muestra el VALOR CALCULADO (o el código de error
      // #REF!/#DIV0!/etc.), nunca el texto crudo "=D2*E2" -- mismo criterio
      // que el overlay de TableBlock.tsx (la fórmula cruda solo se ve
      // editando la celda, nunca en el documento exportado/de solo lectura).
      const runs = formulaResult
        ? [new TextRun({
          text: formulaResult.display, bold: bold || undefined,
          color: textColorOverride ? cssColorToHex(textColorOverride) : undefined,
          size: pxFontToHalfPt(fontSize),
        })]
        : htmlCellToRuns(rawStr, { fontSizePx: fontSize, color: textColorOverride, bold });
      return new TableCell({ width: { size: colWidths[ci], type: WidthType.DXA }, shading, borders: cellBorders, margins: { top: cellPaddingTwip, bottom: cellPaddingTwip, left: cellPaddingTwip, right: cellPaddingTwip }, children: [new Paragraph({ alignment: align, children: runs })] });
    });
    return new TableRow({ tableHeader: isHeaderRow, children: cells });
  });
  return new Table({ rows: tableRows, width: { size: totalWidthTwip, type: WidthType.DXA }, ...tableFloatOrFlowProps(el, 0, flow) });
}

// Observaciones #1/#4 (reporte 2026-09-21: "portada descuadrada", "imágenes
// en hojas A3 no salen correctamente"): en layout absoluto cada imagen mide
// EXACTAMENTE lo que medía en el lienzo (el frame la ancla 1:1, sin
// importar cuán grande sea -- puede ocupar la hoja entera, como el fondo de
// una carátula). En flow, esa misma imagen pasa a insertarse como contenido
// normal dentro de la caja de márgenes de la página -- si se le sigue
// dando su ancho/alto ORIGINAL del lienzo (a menudo el tamaño COMPLETO de
// la página, p.ej. el fondo de una carátula, o una foto grande insertada en
// una hoja A3), el objeto queda más grande que el área imprimible: Word no
// la reescala sola, así que se ve cortada/desplazada hacia la esquina
// inferior derecha (lo reportado en #1) -- más notorio aún en A3 (#4),
// donde el lienzo original es más grande todavía. Se reescala PROPORCIONAL
// (nunca se deforma) para que quepa dentro del área imprimible real de la
// página (ancho/alto de hoja menos márgenes, ver `flowContentBoxPx` en
// `buildPageSection`) -- no-op cuando ya entra (no agranda imágenes chicas).
function fitToFlowBox(widthPx, heightPx, box) {
  if (!box || (!box.widthPx && !box.heightPx)) return { width: Math.max(1, Math.round(widthPx)), height: Math.max(1, Math.round(heightPx)) };
  let scale = 1;
  if (box.widthPx && widthPx * scale > box.widthPx) scale = box.widthPx / widthPx;
  if (box.heightPx && heightPx * scale > box.heightPx) scale = Math.min(scale, box.heightPx / heightPx);
  return { width: Math.max(1, Math.round(widthPx * scale)), height: Math.max(1, Math.round(heightPx * scale)) };
}
function buildImageParagraph(el, png, flow, flowBox) {
  const size = flow ? fitToFlowBox(el.width, el.height, flowBox) : { width: Math.max(1, Math.round(el.width)), height: Math.max(1, Math.round(el.height)) };
  return new Paragraph({ ...frameOrFlowProps(el, undefined, flow), alignment: flow ? AlignmentType.CENTER : undefined, children: [new ImageRun({ type: 'png', data: png, transformation: size })] });
}
const IMAGE_CAPTION_HEIGHT_PX = 18;
// `props.caption` (bloque `image`, "Leyenda") -- ReadOnlyViewer.tsx SIEMPRE
// la pinta debajo de la imagen (y es la fuente del anexo/referencia
// cruzada, ver AnnexList.tsx), pero `case 'image':` de `buildPageSection`
// nunca la incluía -- encontrado auditando "anexos"/"referencias"
// 2026-09-23. Mismo criterio de reserva de alto que `buildRasterWidget`
// (RASTER_CAPTION_HEIGHT_PX), mismo color/cursiva que el visor de pantalla.
function buildImageWithCaption(el, png, flow, flowBox, caption) {
  const trimmed = String(caption || '').trim();
  if (!trimmed) return [buildImageParagraph(el, png, flow, flowBox)];
  const captionHeight = Math.min(IMAGE_CAPTION_HEIGHT_PX, Math.max(0, el.height - 20));
  const imageHeight = Math.max(1, el.height - captionHeight);
  const imagePara = buildImageParagraph({ ...el, height: imageHeight }, png, flow, flowBox);
  if (captionHeight <= 0) return [imagePara];
  const captionPara = new Paragraph({ ...frameOrFlowProps(el, { yPx: el.y + imageHeight, heightPx: captionHeight }, flow), alignment: AlignmentType.CENTER, children: [new TextRun({ text: trimmed, italics: true, color: '4F81BD', size: pxFontToHalfPt(9) })] });
  return [imagePara, captionPara];
}
function buildKpiOrSensorCard(el, flow) {
  const props = el.props || {};
  const snap = props.snapshot;
  const value = snap && snap.value != null ? String(snap.value) : (props.value || '—');
  const unit = snap && snap.unit ? ` ${snap.unit}` : '';
  return new Paragraph({ ...frameOrFlowProps(el, undefined, flow), alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: value + unit, bold: true, size: pxFontToHalfPt(26), color: '0891B2' }),
    new TextRun({ text: '', break: 2 }),
    new TextRun({ text: String(props.title || (el.type === 'kpi' ? 'KPI' : 'Sensor')), size: pxFontToHalfPt(11), color: '475569' }),
  ] });
}
function seismicTitleParagraph(el, titleHeightPx, flow) {
  const props = el.props || {};
  return new Paragraph({ ...frameOrFlowProps(el, { heightPx: titleHeightPx }, flow), children: [
    new TextRun({ text: String(props.title || 'Reporte Sismográfico'), bold: true, size: pxFontToHalfPt(14) }),
    new TextRun({ text: `  (${props.startDate || ''} — ${props.endDate || ''})`, size: pxFontToHalfPt(11), color: '64748B' }),
  ] });
}
function seismicTable(el, yOffsetPx, flow) {
  const props = el.props || {};
  const snap = props.snapshot || {};
  const igpEvents = Array.isArray(snap.igpEvents) ? snap.igpEvents : [];
  const source = props.source || 'both';
  const dataRows = (source === 'igp' || source === 'both')
    ? (igpEvents.length > 0 ? igpEvents.slice(-10).reverse().map((ev) => [String(ev.fecha_local || '—').slice(0, 10), String(ev.magnitud == null ? '—' : ev.magnitud), String(ev.profundidad == null ? '—' : ev.profundidad), String(ev.referencia || '—')]) : [['Sin sismos oficiales en el rango.', '', '', '']])
    : [];
  const companyLine = (source === 'company' || source === 'both') ? `Microsismicidad — sensores propios: ${snap.companyCount != null ? snap.companyCount : 'Sin snapshot'} eventos detectados en el rango.` : null;
  const totalWidthTwip = pxToTwip(el.width);
  const colWidths = [totalWidthTwip * 0.28, totalWidthTwip * 0.16, totalWidthTwip * 0.2, totalWidthTwip * 0.36].map(Math.round);
  const rows = [];
  if (source === 'igp' || source === 'both') {
    rows.push(new TableRow({ tableHeader: true, children: ['Fecha', 'Mag.', 'Prof.(km)', 'Referencia'].map((h, i) => new TableCell({ width: { size: colWidths[i], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: '17365D' }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: pxFontToHalfPt(11) })] })] })) }));
  }
  dataRows.forEach((row) => rows.push(new TableRow({ children: row.map((cell, i) => new TableCell({ width: { size: colWidths[i], type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: cell, size: pxFontToHalfPt(10) })] })] })) })));
  if (companyLine) rows.push(new TableRow({ children: [new TableCell({ columnSpan: 4, width: { size: totalWidthTwip, type: WidthType.DXA }, margins: { top: 80, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: companyLine, italics: true, size: pxFontToHalfPt(10), color: '334155' })] })] })] }));
  if (rows.length === 0) rows.push(new TableRow({ children: [new TableCell({ children: [new Paragraph('Sin datos sismográficos configurados.')] })] }));
  return new Table({ rows, width: { size: totalWidthTwip, type: WidthType.DXA }, ...tableFloatOrFlowProps(el, yOffsetPx, flow) });
}
// Encabezado/pie NATIVOS de Word (headerReference/footerReference + partes
// separadas word/header{N}.xml / word/footer{N}.xml) -- NO un párrafo
// flotante como en la versión anterior. Un párrafo flotante nunca aparece
// en la franja real de encabezado/pie de Word, no es editable con doble
// clic como tal, y no se repagina solo. Número de página con el campo
// NATIVO PAGE/NUMPAGES (PageNumber.CURRENT/.TOTAL_PAGES), no un literal
// calculado en build-time.
function buildHeaderPart(chromeLabel) {
  return new Header({ children: [new Paragraph({ children: [new TextRun({ text: chromeLabel, bold: true, size: pxFontToHalfPt(9), color: '595959', font: 'Arial Black' })] })] });
}
function buildFooterPart(widthTwip, showPageNumber) {
  const children = [new TextRun({ text: 'BEEMETRY', bold: true, size: pxFontToHalfPt(9), color: '595959', font: 'Arial Black' })];
  if (showPageNumber) {
    children.push(
      new TextRun({ text: '\t' }),
      new TextRun({ children: ['PÁGINA ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], bold: true, size: pxFontToHalfPt(9), color: '595959', font: 'Arial Black' }),
    );
  }
  return new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: widthTwip }], children })] });
}
function buildVideoPlaceholder(el, flow) {
  const props = el.props || {};
  const durationLabel = props.durationSeconds ? ` (${props.durationSeconds}s)` : '';
  const sourceLabel = props.source === 'screen' ? 'grabación de pantalla' : 'grabación de cámara web';
  return new Paragraph({ ...frameOrFlowProps(el, undefined, flow), alignment: AlignmentType.CENTER, children: [new TextRun({ text: `[Video adjunto${durationLabel} — ${sourceLabel} — no reproducible en este formato de exportación]`, italics: true, color: '64748B', size: pxFontToHalfPt(10) })] });
}
// El póster (miniatura del primer frame, capturada en el navegador al
// grabar -- ver VideoInsertModal.tsx `posterSrc`) viaja como data URL dentro
// del propio JSON del informe, igual que `src` de un bloque `image` -- no
// necesita el pipeline de captura por Puppeteer (`rasterAssets`), se decodifica
// acá mismo.
function decodeDataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}
function buildVideoElement(el, flow, flowBox) {
  const props = el.props || {};
  const posterBuffer = decodeDataUrlToBuffer(props.posterSrc);
  if (!posterBuffer) return [buildVideoPlaceholder(el, flow)];
  const durationLabel = props.durationSeconds ? ` (${props.durationSeconds}s)` : '';
  const sourceLabel = props.source === 'screen' ? 'grabación de pantalla' : 'grabación de cámara web';
  return buildRasterWidget(el, posterBuffer, `Video adjunto${durationLabel} — ${sourceLabel} — reproducible en la plataforma`, flow, flowBox);
}
// `true` si esta página está dedicada a un bloque `toc` -- el editor
// garantiza esto por diseño (nunca comparte página con otro contenido, ver
// syncTocPages() en useEditorStore.ts): permite usar flujo normal de Word
// en toda la página, requisito para un campo TOC nativo (no es un
// Paragraph, no tiene `frame`).
function pageHasToc(page) {
  return (page.elements || []).some((el) => el.type === 'toc');
}

// Índice NATIVO de Word: un campo TOC real, no una lista estática de
// párrafos. Escanea los párrafos con estilo HeadingN reales que ya emite
// buildTextElement() para encabezados de bloque completo -- funciona
// porque en esta página viven en flujo normal (ver pageHasToc), no dentro
// de un frame absoluto.
function buildTocSectionChildren(el) {
  const props = el.props || {};
  const titleText = String(props.title || 'Tabla de Contenidos') + (typeof props.tocContinuationIndex === 'number' ? ' (continuación)' : '');
  const titlePara = new Paragraph({ children: [new TextRun({ text: titleText, bold: true, size: pxFontToHalfPt(18) })], spacing: { after: 200 } });
  const toc = new TableOfContents('Índice', { hyperlink: true, headingStyleRange: '1-6' });
  return [titlePara, toc];
}
function buildCoverElement(el, session, rasterAssets, flow, flowBox) {
  const props = el.props || {};
  const template = findCoverTemplate(props.coverTemplate);
  const bg = rasterAssets.get(el.id);
  const out = [];
  if (bg) {
    // La captura incluye TODO el contenido renderizado de la carátula
    // (fondo Y título/clasificación/fecha, ya dibujados por el lienzo) --
    // superponer además el texto nativo lo duplicaría sin ganar nada; el
    // texto nativo queda como respaldo SOLO para cuando la captura falló
    // (ver el `return out;` de abajo antes de armar `children`). En flow,
    // el fondo mide originalmente la HOJA ENTERA -- `buildImageParagraph`
    // lo reescala a `flowBox` (observación #1, ver comentario largo junto a
    // `fitToFlowBox`), si no quedaba descuadrado hacia la esquina inferior
    // derecha.
    out.push(buildImageParagraph(el, bg, flow, flowBox));
    return out;
  }
  const chromeAuthor = session.fullName || session.username;
  const textColor = cssColorToHex(template.textColor, 'FFFFFF');
  const children = [
    new TextRun({ text: String(props.classification || template.classificationLabel), bold: true, size: pxFontToHalfPt(11), color: cssColorToHex(template.classificationColor, 'FBBF24') }),
    new TextRun({ text: '', break: 6 }),
    new TextRun({ text: String(props.title || template.titleFallback), bold: true, size: pxFontToHalfPt(30), color: textColor }),
    new TextRun({ text: '', break: 2 }),
  ];
  if (session.company) children.push(new TextRun({ text: session.company, bold: true, size: pxFontToHalfPt(16), color: textColor }), new TextRun({ text: '', break: 1 }));
  if (props.docCode) children.push(new TextRun({ text: `Código: ${props.docCode}`, size: pxFontToHalfPt(10), color: textColor }), new TextRun({ text: '', break: 1 }));
  if (chromeAuthor) children.push(new TextRun({ text: `Autor: ${chromeAuthor}`, size: pxFontToHalfPt(10), color: textColor }), new TextRun({ text: '', break: 1 }));
  if (props.date) children.push(new TextRun({ text: `Fecha: ${props.date}`, size: pxFontToHalfPt(10), color: textColor }));
  out.push(new Paragraph({ ...frameOrFlowProps(el, undefined, flow), alignment: AlignmentType.CENTER, children }));
  return out;
}
const RASTER_CAPTION_HEIGHT_PX = 18;
function buildRasterWidget(el, png, label, flow, flowBox) {
  const title = String((el.props && el.props.title) || label);
  if (!png) {
    return [new Paragraph({ ...frameOrFlowProps(el, undefined, flow), alignment: AlignmentType.CENTER, children: [new TextRun({ text: `[${title} — no se pudo capturar para esta exportación]`, italics: true, color: '94A3B8', size: pxFontToHalfPt(10) })] })];
  }
  const captionHeight = Math.min(RASTER_CAPTION_HEIGHT_PX, Math.max(0, el.height - 20));
  const imageHeight = Math.max(1, el.height - captionHeight);
  const imagePara = buildImageParagraph({ ...el, height: imageHeight }, png, flow, flowBox);
  if (captionHeight <= 0) return [imagePara];
  const captionPara = new Paragraph({ ...frameOrFlowProps(el, { yPx: el.y + imageHeight, heightPx: captionHeight }, flow), alignment: AlignmentType.CENTER, children: [new TextRun({ text: title, italics: true, color: '64748B', size: pxFontToHalfPt(9) })] });
  return [imagePara, captionPara];
}

function pageOrientationAndSizeTwip(page, meta) {
  const { paperSize, orientation } = resolvePagePaperSetup({ paperSize: page.paperSize, orientation: page.orientation }, { paperSize: meta && meta.paperSize, orientation: meta && meta.orientation });
  const sizeMm = paperSize === 'A3' ? { w: 297, h: 420 } : { w: 210, h: 297 };
  const isLandscape = orientation === 'landscape';
  // NO pre-intercambiar acá -- `createPageSize` de la librería `docx` YA
  // intercambia w:w/w:h internamente cuando `orientation === LANDSCAPE`
  // (ver node_modules/docx: `w:w = orientation===LANDSCAPE ? heightTwips :
  // widthTwips`). Pre-intercambiar ACÁ ADEMÁS causaba un doble intercambio:
  // una página A3 horizontal terminaba con w:w=297mm/w:h=420mm (retrato) pero
  // marcada w:orient="landscape" -- ancho menor que alto en una hoja que dice
  // ser horizontal, confirmado inspeccionando el .docx real generado. Se le
  // pasan siempre las medidas BASE (retrato) de la hoja; la orientación sola
  // le dice a la librería cuál usar como ancho.
  return { width: pxToTwip(sizeMm.w * 3.7795275591), height: pxToTwip(sizeMm.h * 3.7795275591), orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT };
}

const PX_PER_TWIP = 1 / 15;
function buildPageSection(doc, page, session, opts, resolveRef) {
  const flow = opts.layout === 'flow';
  const size = pageOrientationAndSizeTwip(page, doc.meta);
  const children = [];
  // En layout absoluto (default, ADR-139) el orden de pintado real lo da el
  // z-index -- da igual, cada bloque es un frame independiente. En modo
  // "flow" el orden del array SÍ determina el orden de lectura del
  // documento resultante (los bloques ya no llevan su propia coordenada),
  // así que se ordena por posición real en el lienzo (arriba-abajo,
  // izquierda-derecha) en vez de z-index.
  const sorted = flow
    ? [...(page.elements || [])].sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0))
    : [...(page.elements || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const isTocPage = pageHasToc(page);
  // En modo flow no hay coordenadas propias por bloque que sirvan de
  // indentación -- necesita márgenes de página reales (mismos que ya usa la
  // página de TOC, que también vive en flujo normal) en vez de los 0
  // izq/der del layout absoluto (ahí el margen "real" lo pone cada frame).
  const margin = (isTocPage || flow)
    ? { top: pxToTwip(72), bottom: pxToTwip(62), left: pxToTwip(36), right: pxToTwip(36), header: pxToTwip(20), footer: pxToTwip(20) }
    : { top: pxToTwip(58), bottom: pxToTwip(48), left: 0, right: 0, header: pxToTwip(15), footer: pxToTwip(15) };
  // Área imprimible real (px) para esta página en flow -- ver comentario
  // largo junto a `fitToFlowBox` (observaciones #1/#4). `pageOrientationAndSizeTwip`
  // devuelve SIEMPRE las medidas base (retrato); acá sí hace falta el ancho
  // VISUAL real (según orientación) porque el cálculo de área imprimible es
  // propio, no delegado a la librería `docx`.
  const pageWidthTwip = size.orientation === PageOrientation.LANDSCAPE ? size.height : size.width;
  const pageHeightTwip = size.orientation === PageOrientation.LANDSCAPE ? size.width : size.height;
  const flowBox = flow ? {
    widthPx: Math.max(1, (pageWidthTwip - margin.left - margin.right) * PX_PER_TWIP),
    heightPx: Math.max(1, (pageHeightTwip - margin.top - margin.bottom) * PX_PER_TWIP),
  } : null;
  let headerPart, footerPart;
  sorted.forEach((el) => {
    switch (el.type) {
      case 'text': children.push(...buildTextElement(el, resolveRef, flow, opts.listCtx)); break;
      case 'table':
        children.push(buildTableElement(el, flow));
        // Observación #3 (reporte 2026-09-21): en flujo normal, una `Table`
        // de `docx` no acepta `spacing`/margin propio como un `Paragraph` --
        // sin este párrafo separador, quedaba pegada al bloque siguiente
        // (tabla->imagen, tabla->tabla) porque nada dejaba aire entre los
        // dos. Mismo alto que el `spacing.after` que ya usan los párrafos
        // flotantes en flow (`frameOrFlowProps`).
        if (flow) children.push(new Paragraph({ spacing: { after: 160 } }));
        break;
      case 'image': { const png = opts.imageAssets.get(el.id); if (png) children.push(...buildImageWithCaption(el, png, flow, flowBox, (el.props || {}).caption)); break; }
      // ShapeBlock.tsx (rectángulo/círculo/diamante/estrella/línea, usado
      // para diagramas de bloque) -- faltaba por completo (caía a `default`,
      // se perdía en silencio). Se captura como raster (ver
      // rasterCapturePipeline.js::RASTER_ELEMENT_TYPES) igual que un
      // gráfico -- sin caption (a diferencia de `buildRasterWidget`, una
      // forma dentro de un diagrama no necesita leyenda propia).
      case 'shape': {
        const png = opts.rasterAssets.get(el.id);
        if (png) children.push(buildImageParagraph(el, png, flow, flowBox));
        else children.push(new Paragraph({ ...frameOrFlowProps(el, undefined, flow), alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[Figura — no se pudo capturar para esta exportación]', italics: true, color: '94A3B8', size: pxFontToHalfPt(10) })] }));
        break;
      }
      // WordArt (texto decorativo, relleno degradado/contorno/sombra) --
      // mismo criterio que 'shape': se captura como raster porque `docx` no
      // expone esos efectos a nivel de TextRun.
      case 'wordart': {
        const png = opts.rasterAssets.get(el.id);
        if (png) children.push(buildImageParagraph(el, png, flow, flowBox));
        else children.push(new Paragraph({ ...frameOrFlowProps(el, undefined, flow), alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[WordArt — no se pudo capturar para esta exportación]', italics: true, color: '94A3B8', size: pxFontToHalfPt(10) })] }));
        break;
      }
      case 'kpi': case 'sensor': children.push(buildKpiOrSensorCard(el, flow)); break;
      case 'seismic-report': { const titleHeight = 28; children.push(seismicTitleParagraph(el, titleHeight, flow)); children.push(seismicTable(el, titleHeight + 6, flow)); break; }
      // header/footer: NO van a `children` -- se vuelven el encabezado/pie
      // NATIVO de esta sección (ver `headers`/`footers` en el `return`).
      case 'header': {
        const chromeParts = [session.company, resolveMiningUnitName(session), session.fullName || session.username].filter((v) => v && String(v).trim());
        const chromeLabel = (chromeParts.length > 0 ? chromeParts.join('  •  ') : 'EMPRESA MINERA').toUpperCase();
        headerPart = buildHeaderPart(chromeLabel);
        break;
      }
      case 'footer': footerPart = buildFooterPart(pxToTwip(el.width), (el.props || {}).showPageNumber !== false); break;
      case 'toc': children.push(...buildTocSectionChildren(el)); break;
      case 'cover': children.push(...buildCoverElement(el, session, opts.rasterAssets, flow, flowBox)); break;
      case 'video': children.push(...buildVideoElement(el, flow, flowBox)); break;
      case 'chart': children.push(...buildRasterWidget(el, opts.rasterAssets.get(el.id), 'Gráfico', flow, flowBox)); break;
      case 'sensor_multi_chart': children.push(...buildRasterWidget(el, opts.rasterAssets.get(el.id), 'Gráfico de sensores', flow, flowBox)); break;
      default: break;
    }
  });
  return {
    properties: { page: { size, margin }, type: SectionType.NEXT_PAGE },
    headers: headerPart ? { default: headerPart } : undefined,
    footers: footerPart ? { default: footerPart } : undefined,
    children: children.length > 0 ? children : [new Paragraph('')],
  };
}

/**
 * `doc`: ReportDocument JSON. `opts.session`: chrome de plataforma
 * ({company, fullName, username, tenantId, miningUnit, ...}). `opts.
 * imageAssets`/`opts.rasterAssets`: `Map<elementId, Buffer|Uint8Array>` PNG.
 */
// Mismo mecanismo que buildReportDocx.ts (Pipeline A) -- JSON original
// embebido sin comprimir en propiedades personalizadas, trozado, para dejar
// el terreno listo para una futura reimportación exacta del .docx.
const SOURCE_JSON_CHUNK_SIZE = 30000;
function sourceDocumentCustomProperties(doc) {
  try {
    const json = JSON.stringify(doc);
    const chunks = [];
    for (let i = 0; i < json.length; i += SOURCE_JSON_CHUNK_SIZE) chunks.push(json.slice(i, i + SOURCE_JSON_CHUNK_SIZE));
    return [
      { name: 'Beemetry_SourceDocument_Count', value: String(chunks.length) },
      ...chunks.map((chunk, i) => ({ name: `Beemetry_SourceDocument_${i + 1}`, value: chunk })),
    ];
  } catch {
    return [];
  }
}

async function buildReportDocx(doc, opts) {
  // Encadena heading -> anexo, mismo orden que buildReportDocx.ts (cliente)
  // -- antes solo intentaba heading, una referencia a imagen/tabla/gráfico
  // con Leyenda resolvía siempre a `undefined` (ver comentario en
  // reportSharedHelpers.js junto a `resolveAnnexRefLabel`).
  const resolveRef = (targetId) => resolveHeadingRefLabel(doc, targetId) ?? resolveAnnexRefLabel(doc, targetId);
  // `listCtx.nextInstance`: contador compartido por TODO el documento -- cada
  // bloque-lista (buildFlowListParagraphs) consume un número y lo incrementa,
  // así cada lista del documento arranca su propia numeración en 1/a/i
  // independiente de las demás (ver comentario largo junto a
  // NUMBER_LIST_REFERENCE más arriba).
  const listCtx = { nextInstance: 0 };
  const opts2 = { ...opts, listCtx };
  const sections = doc.pages.map((page) => buildPageSection(doc, page, opts2.session, opts2, resolveRef));
  // features.updateFields: sin esto, el campo TOC y los campos PAGE/
  // NUMPAGES del pie se abren "vacíos" hasta que el usuario actualiza a
  // mano (clic derecho -> Actualizar campo, o F9).
  const document = new Document({
    creator: 'Beemetry Mining Platform', title: (doc.meta && doc.meta.title) || 'Informe Técnico',
    customProperties: sourceDocumentCustomProperties(doc), features: { updateFields: true },
    numbering: { config: [
      { reference: NUMBER_LIST_REFERENCE, levels: numberListLevels() },
      { reference: BULLET_LIST_REFERENCE, levels: bulletListLevels() },
    ] },
    sections,
  });
  return Packer.toBuffer(document);
}

module.exports = { buildReportDocx };
