'use strict';
/**
 * Helpers puros y agnósticos de formato, compartidos por los 4 builders de
 * export (`reportDocxBuilder.js`, `reportPptxBuilder.js`, `reportXlsxBuilder.js`,
 * `pdfPostProcess.js`). Extraído de `reportDocxBuilder.js` (único dueño
 * original de esta lógica hasta ahora) al agregar PPTX/XLSX/PDF nativos --
 * sin este módulo, cada builder nuevo hubiera vuelto a copiar-pegar la
 * misma resolución de spans/estilos y la misma extracción de encabezados
 * para el índice, con el riesgo real de que diverjan con el tiempo.
 *
 * Nada acá importa `docx`/`pptxgenjs`/`exceljs`/`pdf-lib` -- cada consumidor
 * adapta esta salida neutra a su propia librería.
 */

// ── unidades ────────────────────────────────────────────────────────────────
const PX_TO_TWIP = 15;
const PX_TO_HALF_PT = 1.5;
const pxToTwip = (px) => Math.round((Number(px) || 0) * PX_TO_TWIP);
const pxFontToHalfPt = (px) => Math.max(2, Math.round((Number(px) || 14) * PX_TO_HALF_PT));
// px (96dpi) -> pt (72dpi): 1px = 0.75pt -- usado por PPTX (pptxgenjs trabaja
// en pulgadas/puntos) y por el post-proceso de PDF (pdf-lib trabaja en pt).
const pxToPt = (px) => (Number(px) || 0) * 0.75;
const pxToInch = (px) => (Number(px) || 0) / 96;

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

// ── lib/headingStyles.ts (subconjunto usado en export) ─────────────────────
// Nivel numérico 0-6 únicamente -- cada formato mapea este número a su
// propia representación (DOCX: `HeadingLevel.HEADING_N` del paquete `docx`;
// PPTX/XLSX/PDF: solo lo usan para indentar/ordenar el índice).
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

// ── lib/coverTemplates.ts (subconjunto: solo lo que necesita el export) ────
const COVER_TEMPLATES = {
  corporate: { textColor: '#ffffff', accentColor: '#fbbf24', classificationColor: '#fbbf24', classificationLabel: 'CONFIDENCIAL', titleFallback: 'Informe Técnico' },
  technical: { textColor: '#e6f1ff', accentColor: '#38bdf8', classificationColor: '#38bdf8', classificationLabel: 'USO TÉCNICO — CONTROL INTERNO', titleFallback: 'Informe Técnico de Ingeniería' },
  executive: { textColor: '#f4f5f6', accentColor: '#7fa8ad', classificationColor: '#2b2f36', classificationLabel: 'USO INTERNO — AUDITORÍA', titleFallback: 'Informe de Auditoría Interna' },
  field: { textColor: '#fff8ec', accentColor: '#f2c230', classificationColor: '#3a2a12', classificationLabel: 'USO EN CAMPO — OPERACIONES', titleFallback: 'Informe de Operación en Campo' },
  normative: { textColor: '#f1f8f2', accentColor: '#d4c78a', classificationColor: '#d4c78a', classificationLabel: 'USO OFICIAL — CUMPLIMIENTO NORMATIVO', titleFallback: 'Informe de Cumplimiento Normativo' },
};
const findCoverTemplate = (id) => COVER_TEMPLATES[id] || COVER_TEMPLATES.corporate;

// ── reportLayoutMetrics.ts (subconjunto: tamaño de papel) ───────────────────
// Mismos valores que `PAPER_SIZES_MM` en reportLayoutMetrics.ts (única
// fuente de verdad del lado cliente); se duplican acá porque este servicio
// no importa TypeScript del frontend.
const PAPER_SIZES_MM = { A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 } };
const MM_TO_IN = 1 / 25.4;

/** Resuelve el papel EFECTIVO de una página: el suyo propio si lo tiene, si
 * no el del documento -- mismo criterio que `resolvePagePaperSetup` en
 * useEditorStore.ts (única fuente de verdad de esta herencia). */
function resolvePagePaperSetup(page, meta) {
  return {
    paperSize: (page && page.paperSize) || (meta && meta.paperSize) || 'A4',
    orientation: (page && page.orientation) || (meta && meta.orientation) || 'portrait',
  };
}

/** Tamaño de hoja (A4/A3 × retrato/paisaje) en pulgadas -- unidad que usa
 * `pptx.defineLayout`/`slide.addImage` (PPTX). DOCX resuelve su propio
 * tamaño en twips por separado (`pageOrientationAndSizeTwip`,
 * reportDocxBuilder.js), porque la librería `docx` intercambia ancho/alto
 * ella misma cuando la orientación es horizontal -- ver su comentario. */
function paperSizeInches(paperSize, orientation) {
  const sizeMm = PAPER_SIZES_MM[paperSize] || PAPER_SIZES_MM.A4;
  const isLandscape = orientation === 'landscape';
  const widthMm = isLandscape ? sizeMm.h : sizeMm.w;
  const heightMm = isLandscape ? sizeMm.w : sizeMm.h;
  return { widthIn: widthMm * MM_TO_IN, heightIn: heightMm * MM_TO_IN };
}

// ── lib/sessionChrome.ts ─────────────────────────────────────────────────────
function resolveMiningUnitName(session) {
  const s = session || {};
  const raw = [s.miningUnit, s.unitName, s.mineUnit, s.site].find((v) => typeof v === 'string' && v.trim().length > 0);
  return (raw || 'Unidad Principal').trim();
}

// ── lib/textSpans.ts (subconjunto puro, sin DOM) ────────────────────────────
const STYLE_KEYS = ['bold', 'italic', 'underline', 'strikethrough', 'color', 'fontSize', 'fontFamily', 'highlightColor', 'headingStyle'];
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
    const hrefSpan = spans.find((s) => s.href && start >= s.start && start < s.end);
    const href = hrefSpan ? hrefSpan.href : undefined;
    let chunk = text.slice(start, end);
    if (refTargetId && resolveRef) chunk = resolveRef(refTargetId) || '⚠';
    const prev = segments[segments.length - 1];
    if (prev && stylesEqual(prev.style, style) && prev.refTargetId === refTargetId && prev.href === href) prev.text += chunk;
    else segments.push({ text: chunk, style, refTargetId, href });
  }
  return segments;
}

// ── components/document/TableOfContents.tsx (subconjunto puro) ─────────────
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
// ── components/document/AnnexList.tsx (subconjunto puro) ────────────────────
// Faltaba por completo en este archivo -- `resolveRef` de reportDocxBuilder.js
// solo intentaba `resolveHeadingRefLabel`, así que una referencia cruzada
// (`span.ref`) a un anexo (imagen/tabla/gráfico con Leyenda) resolvía siempre
// a `undefined` y caía al marcador `⚠` (ver textSpans.ts::buildStyledSegments)
// en el export server-side -- el pipeline cliente (buildReportDocx.ts) SÍ
// encadena `resolveHeadingRefLabel(doc, targetId) ?? resolveAnnexRefLabel(doc,
// targetId)`, encontrado auditando "referencias cruzadas" 2026-09-23. Puerto
// fiel de AnnexList.tsx, misma fuente de verdad que el editor.
const ANNEX_TYPE_LABEL = { image: 'Imagen', table: 'Tabla', chart: 'Gráfico' };
function generateAnnexData(doc) {
  const items = [];
  if (!doc || !doc.pages) return items;
  const counters = {};
  doc.pages.forEach((page, pageIdx) => {
    if (!page.elements) return;
    const candidates = page.elements
      .filter((el) => ANNEX_TYPE_LABEL[el.type] && String((el.props && el.props.caption) || '').trim().length > 0)
      .slice()
      .sort((a, b) => (a.y || 0) - (b.y || 0));
    candidates.forEach((el) => {
      const typeLabel = ANNEX_TYPE_LABEL[el.type];
      counters[el.type] = (counters[el.type] || 0) + 1;
      items.push({
        id: el.id, elementId: el.id, type: el.type,
        label: `${typeLabel} ${counters[el.type]}`,
        caption: String(el.props.caption).trim(),
        pageNumber: pageIdx + 1,
      });
    });
  });
  return items;
}
function resolveAnnexRefLabel(doc, targetId) {
  const found = generateAnnexData(doc).find((item) => item.id === targetId);
  return found ? found.label : undefined;
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
/** Rectángulo (en px, coordenadas del lienzo) de cada fila VISIBLE de un
 * bloque `toc` -- misma matemática de paginado que `tocSliceForElementId`,
 * pero devolviendo geometría en vez de solo los datos. Usado por
 * `pdfPostProcess.js` para colocar anotaciones de enlace real sobre cada
 * fila del índice en el PDF exportado (ver TOC_HEADER_HEIGHT_PX/TOC_PADDING_PX
 * arriba -- mismo padding/cabecera que ya dibuja TocBlock.tsx en pantalla). */
function tocRowRectsForElement(doc, el) {
  const entries = tocSliceForElementId(doc, el.id);
  return entries.map((entry, i) => ({
    entry,
    x: el.x,
    y: el.y + TOC_HEADER_HEIGHT_PX + i * TOC_ROW_HEIGHT_PX,
    width: el.width,
    height: TOC_ROW_HEIGHT_PX,
  }));
}

// Solo estos esquemas se dejan navegar de verdad -- sanitizeHtml.ts ya filtra
// javascript:/vbscript:/etc. al guardar, pero un hipervínculo NATIVO real (a
// diferencia de texto azul subrayado) sí navega con Ctrl+clic/clic.
const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;

/** Mini-parser HTML->runs neutro (sin dependencia de ninguna librería de
 * documentos) para celdas de tabla (mismo whitelist que sanitizeHtml.ts):
 * negrita/cursiva/subrayado/saltos de línea/enlaces se preservan, el resto
 * de estructura se descarta (listas quedan como texto plano) -- "suficiente,
 * no exhaustivo", mismo criterio que la versión cliente (htmlCellToRuns.ts).
 *
 * `bold`/`italics`/`underline` salen `true` (tag explícito activo en ese
 * tramo) o `undefined` (sin tag -- el consumidor decide, normalmente
 * heredando el estilo `base` de la celda/párrafo contenedor) -- NUNCA
 * `false`, para que un adaptador pueda hacer `run.bold ?? base.bold` sin
 * que un span sin tags apague por accidente un `base.bold` real. Cada
 * consumidor (DOCX/PPTX/XLSX) adapta esta lista de runs neutros a su propio
 * tipo de "run" con estilo. */
function parseHtmlToRuns(html) {
  const clean = String(html || '').trim();
  if (!clean) return [{ text: '' }];
  const runs = [];
  let bold, italics, underline;
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
      if (tag === 'B' || tag === 'STRONG') bold = closing ? undefined : true;
      else if (tag === 'I' || tag === 'EM') italics = closing ? undefined : true;
      else if (tag === 'U') underline = closing ? undefined : true;
      else if (tag === 'BR') push({ text: '', break: true });
      else if (tag === 'A' && !closing) {
        const hrefMatch = /href\s*=\s*"([^"]*)"/i.exec(tok) || /href\s*=\s*'([^']*)'/i.exec(tok);
        const href = hrefMatch ? hrefMatch[1].trim() : '';
        if (SAFE_LINK_SCHEME.test(href)) { linkHref = href; linkRuns = []; }
      } else if (tag === 'A' && closing) {
        // Cada run interno del enlace conserva SU PROPIO estilo (p.ej. un
        // <b> anidado dentro del <a>) en vez de colapsarse en un único run
        // plano -- el consumidor (p.ej. htmlCellToRuns en el builder DOCX)
        // agrupa los runs consecutivos con el mismo `href` en un solo
        // hipervínculo nativo con varios hijos.
        if (linkHref && linkRuns) runs.push(...linkRuns.map((r) => ({ ...r, href: linkHref })));
        linkHref = null; linkRuns = null;
      }
      return;
    }
    const text = tok.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    if (!text) return;
    push({ text, bold, italics, underline });
  });
  // Enlace nunca cerrado (HTML mal formado) -- se recupera el texto igual.
  if (linkRuns && linkRuns.length > 0) runs.push(...linkRuns);
  return runs.length > 0 ? runs : [{ text: '' }];
}

/** true si el texto (ya sin tags HTML) representa un número puro -- usado por
 * el builder de XLSX para decidir si una celda de tabla se escribe como
 * número real (permite sumar/graficar en Excel) o como texto. Acepta miles
 * con coma/punto y decimales con punto o coma (formato LatAm), signo y
 * notación con espacio de unidad se descarta (esas SÍ quedan como texto). */
function plainTextIfNumeric(html) {
  const text = String(html || '').replace(/<[^>]+>/g, '').trim();
  if (!text) return null;
  const normalized = text.replace(/\s/g, '');
  if (!/^-?[\d.,]+%?$/.test(normalized)) return null;
  const isPercent = normalized.endsWith('%');
  const bare = isPercent ? normalized.slice(0, -1) : normalized;
  // Formato "1,234.56" (miles=coma, decimal=punto) o "1.234,56" (al revés) --
  // se decide por cuál separador aparece último (ese es el decimal).
  const lastComma = bare.lastIndexOf(',');
  const lastDot = bare.lastIndexOf('.');
  let cleaned = bare;
  if (lastComma > -1 && lastComma > lastDot) {
    cleaned = bare.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = bare.replace(/,/g, '');
  }
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return { value: isPercent ? num / 100 : num, isPercent };
}

module.exports = {
  pxToTwip, pxFontToHalfPt, pxToPt, pxToInch,
  cssColorToHex, firstFontFamily,
  headingLevelFor,
  PAPER_SIZES_MM, resolvePagePaperSetup, paperSizeInches,
  COVER_TEMPLATES, findCoverTemplate,
  resolveMiningUnitName,
  STYLE_KEYS, sanitizeSpans, getEffectiveStyleAt, stylesEqual, buildStyledSegments,
  extractHeadings, numberHeadings, generateTocData, resolveHeadingRefLabel,
  generateAnnexData, resolveAnnexRefLabel,
  TOC_ROW_HEIGHT_PX, TOC_HEADER_HEIGHT_PX, TOC_PADDING_PX, tocCapacityForBoxHeight, tocSliceForElementId, tocRowRectsForElement,
  SAFE_LINK_SCHEME, parseHtmlToRuns, plainTextIfNumeric,
};
