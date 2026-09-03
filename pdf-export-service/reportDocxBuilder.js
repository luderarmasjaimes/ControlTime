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
  ImageRun, OverlapType, PageNumber, PageOrientation, Packer, Paragraph,
  SectionType, ShadingType, Table, TableAnchorType, TableCell, TableOfContents, TableRow,
  TabStopType, TextRun, WidthType, BorderStyle,
} = require('docx');

// ── unidades (docxUnits.ts) ────────────────────────────────────────────────
const PX_TO_TWIP = 15;
const PX_TO_HALF_PT = 1.5;
const pxToTwip = (px) => Math.round((Number(px) || 0) * PX_TO_TWIP);
const pxFontToHalfPt = (px) => Math.max(2, Math.round((Number(px) || 14) * PX_TO_HALF_PT));

function cssColorToHex(value, fallback = '000000') {
  const v = String(value == null ? '' : value).trim();
  if (!v) return fallback;
  let m = /^#?([0-9a-fA-F]{6})$/.exec(v);
  if (m) return m[1].toUpperCase();
  m = /^#?([0-9a-fA-F]{3})$/.exec(v);
  if (m) {
    const [r, g, b] = m[1].split('');
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Number(n))));
    return [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return fallback;
}
function firstFontFamily(value, fallback = 'Arial') {
  const v = String(value == null ? '' : value).trim();
  if (!v) return fallback;
  return v.split(',')[0].replace(/['"]/g, '').trim() || fallback;
}

// ── lib/headingStyles.ts (subconjunto usado aquí) ──────────────────────────
const HEADING_LEVEL_BY_STYLE = {
  title: HeadingLevel.TITLE, h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
};
function headingLevelFor(style) {
  if (!style || style === 'normal' || style === 'quote') return 0;
  if (style === 'title' || style === 'h1') return 1;
  if (style === 'h2') return 2;
  if (style === 'h3') return 3;
  if (style === 'h4') return 4;
  if (style === 'h5') return 5;
  if (style === 'h6') return 6;
  return 0;
}

// ── lib/coverTemplates.ts (subconjunto: solo lo que necesita el DOCX) ─────
const COVER_TEMPLATES = {
  corporate: { textColor: '#ffffff', accentColor: '#fbbf24', classificationColor: '#fbbf24', classificationLabel: 'CONFIDENCIAL', titleFallback: 'Informe Técnico' },
  technical: { textColor: '#e6f1ff', accentColor: '#38bdf8', classificationColor: '#38bdf8', classificationLabel: 'USO TÉCNICO — CONTROL INTERNO', titleFallback: 'Informe Técnico de Ingeniería' },
  executive: { textColor: '#f4f5f6', accentColor: '#7fa8ad', classificationColor: '#2b2f36', classificationLabel: 'USO INTERNO — AUDITORÍA', titleFallback: 'Informe de Auditoría Interna' },
  field: { textColor: '#fff8ec', accentColor: '#f2c230', classificationColor: '#3a2a12', classificationLabel: 'USO EN CAMPO — OPERACIONES', titleFallback: 'Informe de Operación en Campo' },
  normative: { textColor: '#f1f8f2', accentColor: '#d4c78a', classificationColor: '#d4c78a', classificationLabel: 'USO OFICIAL — CUMPLIMIENTO NORMATIVO', titleFallback: 'Informe de Cumplimiento Normativo' },
};
const findCoverTemplate = (id) => COVER_TEMPLATES[id] || COVER_TEMPLATES.corporate;

// ── lib/sessionChrome.ts ───────────────────────────────────────────────────
function resolveMiningUnitName(session) {
  const s = session || {};
  const raw = [s.miningUnit, s.unitName, s.mineUnit, s.site].find((v) => typeof v === 'string' && v.trim().length > 0);
  return (raw || 'Unidad Principal').trim();
}

// ── lib/textSpans.ts (subconjunto puro, sin DOM) ───────────────────────────
const STYLE_KEYS = ['bold', 'italic', 'underline', 'color', 'fontSize', 'fontFamily', 'highlightColor', 'headingStyle'];
function sanitizeSpans(rawSpans, textLength) {
  if (!Array.isArray(rawSpans)) return [];
  return rawSpans.map((s) => {
    if (!s || typeof s !== 'object') return null;
    const start = Math.max(0, Math.min(textLength, Number(s.start) || 0));
    const end = Math.max(0, Math.min(textLength, Number(s.end) || 0));
    if (end <= start) return null;
    return { ...s, start, end };
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}
function getEffectiveStyleAt(spans, base, offset) {
  const style = { ...base };
  for (const span of spans) {
    if (offset >= span.start && offset < span.end) {
      for (const key of STYLE_KEYS) if (span[key] !== undefined) style[key] = span[key];
    }
  }
  return style;
}
function stylesEqual(a, b) { return STYLE_KEYS.every((k) => a[k] === b[k]); }
function buildStyledSegments(text, spans, base, resolveRef) {
  if (!text) return [];
  const breakpoints = new Set([0, text.length]);
  for (const span of spans) {
    breakpoints.add(Math.max(0, Math.min(text.length, span.start)));
    breakpoints.add(Math.max(0, Math.min(text.length, span.end)));
  }
  const sorted = Array.from(breakpoints).sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i]; const end = sorted[i + 1];
    if (end <= start) continue;
    const style = getEffectiveStyleAt(spans, base, start);
    const refSpan = spans.find((s) => s.ref && start >= s.start && start < s.end);
    const refTargetId = refSpan && refSpan.ref ? refSpan.ref.targetId : undefined;
    let chunk = text.slice(start, end);
    if (refTargetId && resolveRef) chunk = resolveRef(refTargetId) || '⚠';
    const prev = segments[segments.length - 1];
    if (prev && stylesEqual(prev.style, style) && prev.refTargetId === refTargetId) prev.text += chunk;
    else segments.push({ text: chunk, style, refTargetId });
  }
  return segments;
}

// ── components/document/TableOfContents.tsx (subconjunto puro) ────────────
function extractHeadings(doc) {
  const headings = [];
  if (!doc || !doc.pages) return headings;
  doc.pages.forEach((page, pageIdx) => {
    (page.elements || []).forEach((el) => {
      if (el.type !== 'text') return;
      const text = String((el.props && el.props.text) || '');
      if (!text.trim()) return;
      const spans = Array.isArray(el.props && el.props.spans) ? el.props.spans : [];
      const headingSpans = spans.filter((s) => s && headingLevelFor(s.headingStyle) > 0).sort((a, b) => (a.start || 0) - (b.start || 0));
      if (headingSpans.length > 0) {
        headingSpans.forEach((span, spanIdx) => {
          const spanText = text.slice(span.start, span.end).trim();
          if (!spanText) return;
          headings.push({ id: `${el.id}__span-${spanIdx}-${span.start}`, elementId: el.id, text: spanText, level: headingLevelFor(span.headingStyle), pageNumber: pageIdx + 1, style: span.headingStyle });
        });
        return;
      }
      const level = headingLevelFor(el.props && el.props.headingStyle);
      if (level === 0) return;
      headings.push({ id: el.id, elementId: el.id, text: text.trim(), level, pageNumber: pageIdx + 1, style: el.props.headingStyle });
    });
  });
  return headings;
}
function numberHeadings(headings) {
  const counters = [0, 0, 0, 0, 0, 0];
  return headings.map((h) => {
    const idx = h.level - 1;
    counters[idx] += 1;
    for (let i = idx + 1; i < counters.length; i += 1) counters[i] = 0;
    const number = counters.slice(0, h.level).join('.');
    return { ...h, number };
  });
}
const generateTocData = (doc) => numberHeadings(extractHeadings(doc));
function resolveHeadingRefLabel(doc, targetId) {
  const items = generateTocData(doc);
  const found = items.find((it) => it.id === targetId || it.elementId === targetId);
  return found ? found.number : undefined;
}
const TOC_ROW_HEIGHT_PX = 26, TOC_HEADER_HEIGHT_PX = 48, TOC_PADDING_PX = 44;
function tocCapacityForBoxHeight(boxHeight) {
  const usable = boxHeight - TOC_HEADER_HEIGHT_PX - TOC_PADDING_PX;
  return Math.max(1, Math.floor(usable / TOC_ROW_HEIGHT_PX));
}
function tocSliceForElementId(doc, elementId) {
  const entries = generateTocData(doc);
  const allTocEls = [];
  doc.pages.forEach((page) => (page.elements || []).forEach((el) => {
    if (el.type !== 'toc') return;
    const ci = typeof (el.props && el.props.tocContinuationIndex) === 'number' ? el.props.tocContinuationIndex : 0;
    allTocEls.push({ id: el.id, height: el.height, continuationIndex: ci });
  }));
  allTocEls.sort((a, b) => a.continuationIndex - b.continuationIndex);
  let offset = 0;
  for (const item of allTocEls) {
    const capacity = tocCapacityForBoxHeight(item.height);
    const slice = entries.slice(offset, offset + capacity);
    if (item.id === elementId) return slice;
    offset += capacity;
  }
  return [];
}

// ── reportLayoutMetrics.ts (subconjunto: solo 'document') ──────────────────
function resolvePagePaperSetup(page, meta) {
  return {
    paperSize: (page && page.paperSize) || (meta && meta.paperSize) || 'A4',
    orientation: (page && page.orientation) || (meta && meta.orientation) || 'portrait',
  };
}

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

const HIGHLIGHT_NAMES = new Set(['black', 'blue', 'cyan', 'darkBlue', 'darkCyan', 'darkGray', 'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'green', 'lightGray', 'magenta', 'red', 'white', 'yellow']);
function highlightFromColor(value) {
  if (!value || value === 'transparent') return undefined;
  return HIGHLIGHT_NAMES.has(value) ? value : 'yellow';
}
function segmentsToRuns(segments) {
  const out = [];
  let pendingBreaks = 0;
  segments.forEach((seg) => {
    seg.text.split('\n').forEach((line, i) => {
      if (i > 0) pendingBreaks += 1;
      if (line.length === 0) return;
      out.push(new TextRun({
        text: line, break: pendingBreaks || undefined,
        bold: seg.style.bold || undefined, italics: seg.style.italic || undefined,
        underline: seg.style.underline ? {} : undefined,
        color: cssColorToHex(seg.style.color, '0F172A'), font: firstFontFamily(seg.style.fontFamily),
        size: pxFontToHalfPt(seg.style.fontSize), highlight: highlightFromColor(seg.style.highlightColor),
      }));
      pendingBreaks = 0;
    });
  });
  if (pendingBreaks > 0) out.push(new TextRun({ text: '', break: pendingBreaks }));
  return out.length > 0 ? out : [new TextRun({ text: '' })];
}
function buildTextElement(el, resolveRef) {
  const props = el.props || {};
  const text = String(props.text || '');
  const base = { bold: !!props.bold, italic: !!props.italic, underline: !!props.underline, color: props.fontColor || '#0f172a', fontSize: props.fontSize || 14, fontFamily: props.fontFamily || 'Arial', highlightColor: props.highlightColor || 'transparent', headingStyle: props.headingStyle };
  const spans = sanitizeSpans(props.spans, text.length);
  const segments = buildStyledSegments(text, spans, base, resolveRef);
  const wholeBlockLevel = props.headingStyle ? HEADING_LEVEL_BY_STYLE[props.headingStyle] : undefined;
  return new Paragraph({ frame: elementFrame(el), heading: wholeBlockLevel, alignment: alignmentFromCss(props.textAlign), children: segmentsToRuns(segments) });
}

// Solo estos esquemas se dejan navegar de verdad -- mismo criterio que la
// versión cliente (htmlCellToRuns.ts): sanitizeHtml.ts ya filtra
// javascript:/vbscript:/etc. al guardar, pero un hipervínculo NATIVO real
// (a diferencia de texto azul subrayado) sí navega con Ctrl+clic.
const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;

// Mini-parser HTML->runs para celdas de tabla (mismo whitelist que
// sanitizeHtml.ts) -- Puppeteer ya renderizó el HTML en el DOM real de la
// página, así que aquí se usa un regex-walker simple sobre el string crudo
// en vez de un DOMParser (no disponible en Node sin dependencia extra).
// `<a href>` se reproduce como ExternalHyperlink NATIVO real (mismo criterio
// que htmlCellToRuns.ts del pipeline cliente).
function htmlCellToRuns(html, base) {
  const clean = String(html || '').trim();
  const baseColor = base.color ? cssColorToHex(base.color) : undefined;
  const baseSize = pxFontToHalfPt(base.fontSizePx);
  if (!clean) return [new TextRun({ text: '', size: baseSize, color: baseColor, bold: base.bold || undefined })];
  // Se preservan negrita/cursiva/subrayado/saltos de línea/enlaces, se
  // descarta el resto de estructura (listas quedan como texto plano) --
  // mismo criterio de "suficiente, no exhaustivo" que la versión cliente.
  const runs = [];
  let bold = !!base.bold, italics = false, underline = false;
  let linkHref = null;
  let linkRuns = null;
  const push = (run) => (linkRuns ? linkRuns.push(run) : runs.push(run));
  const tokens = clean.split(/(<[^>]+>)/g);
  tokens.forEach((tok) => {
    if (!tok) return;
    const tagMatch = /^<\/?([a-zA-Z0-9]+)/.exec(tok);
    if (tagMatch) {
      const tag = tagMatch[1].toUpperCase();
      const closing = tok.startsWith('</');
      if (tag === 'B' || tag === 'STRONG') bold = !closing;
      else if (tag === 'I' || tag === 'EM') italics = !closing;
      else if (tag === 'U') underline = !closing;
      else if (tag === 'BR') push(new TextRun({ text: '', break: 1 }));
      else if (tag === 'A' && !closing) {
        const hrefMatch = /href\s*=\s*"([^"]*)"/i.exec(tok) || /href\s*=\s*'([^']*)'/i.exec(tok);
        const href = hrefMatch ? hrefMatch[1].trim() : '';
        if (SAFE_LINK_SCHEME.test(href)) { linkHref = href; linkRuns = []; }
      } else if (tag === 'A' && closing) {
        if (linkHref && linkRuns && linkRuns.length > 0) runs.push(new ExternalHyperlink({ link: linkHref, children: linkRuns }));
        else if (linkRuns) runs.push(...linkRuns);
        linkHref = null; linkRuns = null;
      }
      return;
    }
    const text = tok.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    if (!text) return;
    push(new TextRun({ text, bold: bold || undefined, italics: italics || undefined, underline: underline ? {} : undefined, color: baseColor, size: baseSize }));
  });
  // Enlace nunca cerrado (HTML mal formado) -- se recupera el texto igual.
  if (linkRuns && linkRuns.length > 0) runs.push(...linkRuns);
  return runs.length > 0 ? runs : [new TextRun({ text: '', size: baseSize })];
}

function buildTableElement(el) {
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

  const tableRows = rows.map((row, ri) => {
    const isHeaderRow = ri === 0 && hasHeader;
    const isBanded = !isHeaderRow && props.bandedRows && ri % 2 === (hasHeader ? 1 : 0);
    const shading = isHeaderRow
      ? { type: ShadingType.CLEAR, color: 'auto', fill: cssColorToHex(props.headerBg, 'F8FAFC') }
      : isBanded ? { type: ShadingType.CLEAR, color: 'auto', fill: cssColorToHex(props.bandColor, 'F1F5F9') } : undefined;
    const cells = Array.from({ length: colCount }, (_, ci) => {
      const raw = Array.isArray(row) ? row[ci] : '';
      const runs = htmlCellToRuns(String(raw == null ? '' : raw), { fontSizePx: fontSize, color: isHeaderRow ? (props.headerTextColor || '#1e293b') : undefined, bold: isHeaderRow ? props.headerBold !== false : false });
      return new TableCell({ width: { size: colWidths[ci], type: WidthType.DXA }, shading, borders: cellBorders, margins: { top: cellPaddingTwip, bottom: cellPaddingTwip, left: cellPaddingTwip, right: cellPaddingTwip }, children: [new Paragraph({ alignment: align, children: runs })] });
    });
    return new TableRow({ tableHeader: isHeaderRow, children: cells });
  });
  return new Table({ rows: tableRows, width: { size: totalWidthTwip, type: WidthType.DXA }, float: { horizontalAnchor: TableAnchorType.PAGE, absoluteHorizontalPosition: pxToTwip(el.x), verticalAnchor: TableAnchorType.PAGE, absoluteVerticalPosition: pxToTwip(el.y), overlap: OverlapType.NEVER } });
}

function buildImageParagraph(el, png) {
  return new Paragraph({ frame: elementFrame(el), children: [new ImageRun({ type: 'png', data: png, transformation: { width: Math.max(1, Math.round(el.width)), height: Math.max(1, Math.round(el.height)) } })] });
}
function buildKpiOrSensorCard(el) {
  const props = el.props || {};
  const snap = props.snapshot;
  const value = snap && snap.value != null ? String(snap.value) : (props.value || '—');
  const unit = snap && snap.unit ? ` ${snap.unit}` : '';
  return new Paragraph({ frame: elementFrame(el), alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: value + unit, bold: true, size: pxFontToHalfPt(26), color: '0891B2' }),
    new TextRun({ text: '', break: 2 }),
    new TextRun({ text: String(props.title || (el.type === 'kpi' ? 'KPI' : 'Sensor')), size: pxFontToHalfPt(11), color: '475569' }),
  ] });
}
function seismicTitleParagraph(el, titleHeightPx) {
  const props = el.props || {};
  return new Paragraph({ frame: elementFrame(el, { heightPx: titleHeightPx }), children: [
    new TextRun({ text: String(props.title || 'Reporte Sismográfico'), bold: true, size: pxFontToHalfPt(14) }),
    new TextRun({ text: `  (${props.startDate || ''} — ${props.endDate || ''})`, size: pxFontToHalfPt(11), color: '64748B' }),
  ] });
}
function seismicTable(el, yOffsetPx) {
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
  return new Table({ rows, width: { size: totalWidthTwip, type: WidthType.DXA }, float: { horizontalAnchor: TableAnchorType.PAGE, absoluteHorizontalPosition: pxToTwip(el.x), verticalAnchor: TableAnchorType.PAGE, absoluteVerticalPosition: pxToTwip(el.y + yOffsetPx), overlap: OverlapType.NEVER } });
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
function buildVideoPlaceholder(el) {
  const props = el.props || {};
  const durationLabel = props.durationSeconds ? ` (${props.durationSeconds}s)` : '';
  const sourceLabel = props.source === 'screen' ? 'grabación de pantalla' : 'grabación de cámara web';
  return new Paragraph({ frame: elementFrame(el), alignment: AlignmentType.CENTER, children: [new TextRun({ text: `[Video adjunto${durationLabel} — ${sourceLabel} — no reproducible en este formato de exportación]`, italics: true, color: '64748B', size: pxFontToHalfPt(10) })] });
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
function buildVideoElement(el) {
  const props = el.props || {};
  const posterBuffer = decodeDataUrlToBuffer(props.posterSrc);
  if (!posterBuffer) return [buildVideoPlaceholder(el)];
  const durationLabel = props.durationSeconds ? ` (${props.durationSeconds}s)` : '';
  const sourceLabel = props.source === 'screen' ? 'grabación de pantalla' : 'grabación de cámara web';
  return buildRasterWidget(el, posterBuffer, `Video adjunto${durationLabel} — ${sourceLabel} — reproducible en la plataforma`);
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
function buildCoverElement(el, session, rasterAssets) {
  const props = el.props || {};
  const template = findCoverTemplate(props.coverTemplate);
  const bg = rasterAssets.get(el.id);
  const out = [];
  if (bg) {
    // La captura incluye TODO el contenido renderizado de la carátula
    // (fondo Y título/clasificación/fecha, ya dibujados por el lienzo) --
    // superponer además el texto nativo lo duplicaría sin ganar nada; el
    // texto nativo queda como respaldo SOLO para cuando la captura falló
    // (ver el `return out;` de abajo antes de armar `children`).
    out.push(buildImageParagraph(el, bg));
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
  out.push(new Paragraph({ frame: elementFrame(el), alignment: AlignmentType.CENTER, children }));
  return out;
}
const RASTER_CAPTION_HEIGHT_PX = 18;
function buildRasterWidget(el, png, label) {
  const title = String((el.props && el.props.title) || label);
  if (!png) {
    return [new Paragraph({ frame: elementFrame(el), alignment: AlignmentType.CENTER, children: [new TextRun({ text: `[${title} — no se pudo capturar para esta exportación]`, italics: true, color: '94A3B8', size: pxFontToHalfPt(10) })] })];
  }
  const captionHeight = Math.min(RASTER_CAPTION_HEIGHT_PX, Math.max(0, el.height - 20));
  const imageHeight = Math.max(1, el.height - captionHeight);
  const imagePara = buildImageParagraph({ ...el, height: imageHeight }, png);
  if (captionHeight <= 0) return [imagePara];
  const captionPara = new Paragraph({ frame: elementFrame(el, { yPx: el.y + imageHeight, heightPx: captionHeight }), alignment: AlignmentType.CENTER, children: [new TextRun({ text: title, italics: true, color: '64748B', size: pxFontToHalfPt(9) })] });
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

function buildPageSection(doc, page, session, opts, resolveRef) {
  const size = pageOrientationAndSizeTwip(page, doc.meta);
  const children = [];
  const sorted = [...(page.elements || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const isTocPage = pageHasToc(page);
  let headerPart, footerPart;
  sorted.forEach((el) => {
    switch (el.type) {
      case 'text': children.push(buildTextElement(el, resolveRef)); break;
      case 'table': children.push(buildTableElement(el)); break;
      case 'image': { const png = opts.imageAssets.get(el.id); if (png) children.push(buildImageParagraph(el, png)); break; }
      case 'kpi': case 'sensor': children.push(buildKpiOrSensorCard(el)); break;
      case 'seismic-report': { const titleHeight = 28; children.push(seismicTitleParagraph(el, titleHeight)); children.push(seismicTable(el, titleHeight + 6)); break; }
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
      case 'cover': children.push(...buildCoverElement(el, session, opts.rasterAssets)); break;
      case 'video': children.push(...buildVideoElement(el)); break;
      case 'chart': children.push(...buildRasterWidget(el, opts.rasterAssets.get(el.id), 'Gráfico')); break;
      case 'sensor_multi_chart': children.push(...buildRasterWidget(el, opts.rasterAssets.get(el.id), 'Gráfico de sensores')); break;
      default: break;
    }
  });
  const margin = isTocPage
    ? { top: pxToTwip(72), bottom: pxToTwip(62), left: pxToTwip(36), right: pxToTwip(36), header: pxToTwip(20), footer: pxToTwip(20) }
    : { top: pxToTwip(58), bottom: pxToTwip(48), left: 0, right: 0, header: pxToTwip(15), footer: pxToTwip(15) };
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
  const resolveRef = (targetId) => resolveHeadingRefLabel(doc, targetId);
  const sections = doc.pages.map((page) => buildPageSection(doc, page, opts.session, opts, resolveRef));
  // features.updateFields: sin esto, el campo TOC y los campos PAGE/
  // NUMPAGES del pie se abren "vacíos" hasta que el usuario actualiza a
  // mano (clic derecho -> Actualizar campo, o F9).
  const document = new Document({ creator: 'Beemetry Mining Platform', title: (doc.meta && doc.meta.title) || 'Informe Técnico', customProperties: sourceDocumentCustomProperties(doc), features: { updateFields: true }, sections });
  return Packer.toBuffer(document);
}

module.exports = { buildReportDocx };
