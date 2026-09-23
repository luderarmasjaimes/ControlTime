// pdfOcrImport.ts — Importación de PDF con OCR avanzado (ADR-199).
//
// Convierte la respuesta de POST /api/reports/import/pdf-ocr (texto digital
// vs. OCR real vía PaddleOCR PP-StructureV2 en el sidecar ocr_engine, ver ese
// mismo ADR) al MISMO tipo `PasteBlock` que ya produce `parseRichClipboardBlocks`
// para el pegado de Word/Docs y la importación de .docx (App.tsx::handleImportDocx)
// -- así este flujo reutiliza la vía de inserción YA probada
// (`setPendingImportBlocks` -> PageCanvas.tsx -> `processPasteBlocks`), sin
// duplicar esa lógica ni tocar código de inserción.
//
// Fidelidad ampliada (ADR-199 §7): los spans de estilo (negrita/cursiva/
// color/tamaño/fuente/encabezado/alineación) que trae cada párrafo digital
// se mapean 1:1 a `TextStyleSpan` -- el MISMO mecanismo que ya usa la
// importación de .docx, así que un encabezado detectado en el PDF aparece
// solo en la Tabla de Contenidos del editor sin tocar código del editor.
import type { PasteBlock, AbsoluteGeometry } from './richPaste';
import type { TextStyleSpan } from './textSpans';
import { getReportLayoutMetrics } from './reportLayoutMetrics';

export interface PdfOcrSpanDto {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  /** Puntos (pt) -- el PDF es la unidad natural del backend, se convierte a
   * píxeles CSS acá (mismo factor 96/72 que ya usa richPaste.ts para 'pt'). */
  fontSize?: number;
  fontFamily?: string;
  headingStyle?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
}

export interface PdfOcrBlockDto {
  type: 'paragraph' | 'table' | 'figure';
  text?: string;
  spans?: PdfOcrSpanDto[];
  rows?: string[][];
  image_base64?: string;
  mime?: string;
  /** [x0, y0, x1, y1] en puntos (pt), relativo a la página de ORIGEN del
   * PDF (0,0 = esquina superior izquierda física de esa hoja) -- ver
   * pdf_ocr_pipeline.py. Ausente solo en el salvavidas de texto crudo sin
   * estructura (get_text("dict") no encontró nada). */
  bbox?: [number, number, number, number];
  /** Modo réplica (ADR-209): línea base real de la PRIMERA línea, paso real
   * entre líneas y tamaño dominante, en puntos. */
  layout?: { baseline_pt: number; pitch_pt: number; font_size_pt: number; line_count: number };
}

export interface PdfOcrPageGeometryDto {
  width_pt: number;
  height_pt: number;
  paper_size: 'A4' | 'A3';
  orientation: 'portrait' | 'landscape';
  /** Solo contrato v1 -- el modo réplica no usa márgenes (posición absoluta). */
  margin_left_pt?: number;
  margin_top_pt?: number;
  margin_right_pt?: number;
  margin_bottom_pt?: number;
}

export interface PdfOcrPageDto {
  page_number: number;
  source: 'digital' | 'ocr';
  confidence: number | null;
  blocks: PdfOcrBlockDto[];
  page_geometry?: PdfOcrPageGeometryDto;
  /** 'replica' (ADR-209) = trae `background` + `layout` por párrafo. */
  layout?: string;
  background?: { image_base64: string; mime: string };
  error?: string;
}

export interface PdfOcrResponseDto {
  page_count: number;
  pages: PdfOcrPageDto[];
}

export interface PdfOcrImportSummary {
  pageCount: number;
  digitalPages: number;
  ocrPages: number;
  /** Confianza promedio SOLO de las páginas que pasaron por OCR real (las
   * digitales no tienen confianza -- es texto embebido, no una predicción). */
  averageOcrConfidence: number | null;
  pagesWithErrors: number[];
  headingsDetected: number;
  listsDetected: number;
}

/** Geometría real de la página de origen (la de la PRIMERA página del PDF --
 * el documento importado se configura una sola vez, no por página, ver
 * App.tsx::handleImportPdfOcr). `null` si el backend no la envió (versión
 * vieja de ai_engine/ocr_engine sin reconstruir). */
export interface PdfImportPageSetup {
  paperSize: 'A4' | 'A3';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
}

const PT_TO_PX = 96 / 72;

// Mismo mapa que PAPER_SIZES_PT en ocr_engine/pdf_ocr_pipeline.py -- el
// editor solo soporta estos 2 tamaños de hoja (useEditorStore.ts), así que
// una página de origen de tamaño NO estándar (el caso común: casi ningún
// PDF real mide exactamente A4/A3) se mapea al más cercano y cada bbox se
// ESCALA proporcionalmente a esa hoja -- mismo criterio que ya usa el
// backend para los márgenes (_page_geometry), aplicado acá a CADA bloque
// para que la posición relativa (columna, imagen junto a su texto, fondo a
// toda la hoja) sobreviva aunque el tamaño absoluto no pueda ser exacto.
const PAPER_SIZES_PT: Record<'A4' | 'A3', { w: number; h: number }> = {
  A4: { w: 595, h: 842 },
  A3: { w: 842, h: 1191 },
};

interface PageScale {
  sx: number;
  sy: number;
  /** Tamaño de la hoja del EDITOR ya en pt (con orientación aplicada) --
   * para el caso "fondo de página completa" (ver isFullPageBbox), que se
   * ancla a 0,0 y a este tamaño completo en vez del bbox literal escalado
   * (evita un borde de 1-2px sin cubrir por redondeo). */
  editorWidthPt: number;
  editorHeightPt: number;
}

function computePageScale(geo: PdfOcrPageGeometryDto | undefined): PageScale {
  if (!geo || !geo.width_pt || !geo.height_pt) return { sx: 1, sy: 1, editorWidthPt: 595, editorHeightPt: 842 };
  const std = PAPER_SIZES_PT[geo.paper_size] || PAPER_SIZES_PT.A4;
  const editorWidthPt = geo.orientation === 'landscape' ? std.h : std.w;
  const editorHeightPt = geo.orientation === 'landscape' ? std.w : std.h;
  return { sx: editorWidthPt / geo.width_pt, sy: editorHeightPt / geo.height_pt, editorWidthPt, editorHeightPt };
}

/** ~85% del ancho Y del alto de la página de origen -- el mismo umbral que
 * ya separaba "carátula escaneada de página completa" de "una foto más en
 * el texto" cuando esto se investigó en vivo (ver hallazgo real: la página
 * 1 de un PDF de prueba real era EXACTAMENTE esto, bbox [0,0,311.8,453.4]
 * sobre una hoja de 311.8x453.5pt). */
function isFullPageBbox(bbox: [number, number, number, number], geo: PdfOcrPageGeometryDto | undefined): boolean {
  if (!geo || !geo.width_pt || !geo.height_pt) return false;
  const w = bbox[2] - bbox[0];
  const h = bbox[3] - bbox[1];
  return w >= geo.width_pt * 0.85 && h >= geo.height_pt * 0.85;
}

function bboxToGeometry(
  bbox: [number, number, number, number] | undefined,
  scale: PageScale,
  geo: PdfOcrPageGeometryDto | undefined,
): AbsoluteGeometry | undefined {
  if (!bbox) return undefined;
  if (isFullPageBbox(bbox, geo)) {
    return {
      x: 0, y: 0,
      width: Math.round(scale.editorWidthPt * PT_TO_PX),
      height: Math.round(scale.editorHeightPt * PT_TO_PX),
      isBackground: true,
    };
  }
  const [x0, y0, x1, y1] = bbox;
  return {
    x: Math.round(x0 * scale.sx * PT_TO_PX),
    y: Math.round(y0 * scale.sy * PT_TO_PX),
    width: Math.max(1, Math.round((x1 - x0) * scale.sx * PT_TO_PX)),
    height: Math.max(1, Math.round((y1 - y0) * scale.sy * PT_TO_PX)),
  };
}

/** Construye el resumen post-importación (qué páginas fueron texto digital
 * vs. OCR real, confianza promedio, cuántos encabezados/listas se
 * detectaron) -- gap que ADR-173 dejó pendiente para .docx ("sin resumen
 * post-importación"), resuelto acá desde el inicio porque el backend ya
 * devuelve esta información por página. */
function buildSummary(response: PdfOcrResponseDto, headingsDetected: number, listsDetected: number): PdfOcrImportSummary {
  let digitalPages = 0;
  let ocrPages = 0;
  const ocrConfidences: number[] = [];
  const pagesWithErrors: number[] = [];

  response.pages.forEach((page) => {
    if (page.source === 'ocr') {
      ocrPages += 1;
      if (typeof page.confidence === 'number') ocrConfidences.push(page.confidence);
    } else {
      digitalPages += 1;
    }
    if (page.error) pagesWithErrors.push(page.page_number);
  });

  const averageOcrConfidence = ocrConfidences.length
    ? ocrConfidences.reduce((a, b) => a + b, 0) / ocrConfidences.length
    : null;

  return {
    pageCount: response.page_count,
    digitalPages,
    ocrPages,
    averageOcrConfidence,
    pagesWithErrors,
    headingsDetected,
    listsDetected,
  };
}

function convertSpan(dto: PdfOcrSpanDto): TextStyleSpan {
  const span: TextStyleSpan = { start: dto.start, end: dto.end };
  if (typeof dto.bold === 'boolean') span.bold = dto.bold;
  if (typeof dto.italic === 'boolean') span.italic = dto.italic;
  if (typeof dto.underline === 'boolean') span.underline = dto.underline;
  if (dto.color) span.color = dto.color;
  // 2 decimales, no px entero: el modo réplica vuelve a escalar este valor
  // por página y el redondeo a entero se notaba como corrimiento de líneas.
  if (typeof dto.fontSize === 'number' && dto.fontSize > 0) span.fontSize = Math.round(dto.fontSize * PT_TO_PX * 100) / 100;
  if (dto.fontFamily) span.fontFamily = dto.fontFamily;
  if (dto.headingStyle) span.headingStyle = dto.headingStyle;
  if (dto.textAlign) span.textAlign = dto.textAlign;
  return span;
}

function extractPageSetup(response: PdfOcrResponseDto): PdfImportPageSetup | null {
  const geo = response.pages.find((p) => p.page_geometry)?.page_geometry;
  if (!geo) return null;
  return {
    paperSize: geo.paper_size,
    orientation: geo.orientation,
    margins: {
      top: Math.round((geo.margin_top_pt ?? 36) * PT_TO_PX),
      right: Math.round((geo.margin_right_pt ?? 36) * PT_TO_PX),
      bottom: Math.round((geo.margin_bottom_pt ?? 36) * PT_TO_PX),
      left: Math.round((geo.margin_left_pt ?? 36) * PT_TO_PX),
    },
  };
}

export function convertPdfOcrResponseToBlocks(
  response: PdfOcrResponseDto,
): { blocks: PasteBlock[]; summary: PdfOcrImportSummary; pageSetup: PdfImportPageSetup | null } {
  const blocks: PasteBlock[] = [];
  let headingsDetected = 0;
  let listsDetected = 0;

  response.pages.forEach((page, pageIndex) => {
    // Un `page-break` por página de ORIGEN (nunca antes de la primera --
    // esa usa la hoja que ya existe en el lienzo al momento de importar,
    // ver PageCanvas.tsx::processPositionedBlocks) -- fidelidad de
    // paginación real 1:1 con el PDF, en vez de dejar que el auto-flujo
    // decida cuántas hojas hacen falta (el mismo texto+imágenes de origen
    // podía terminar en un número de páginas del editor muy distinto al
    // original, ver hallazgo real 68->193 páginas antes de esto).
    if (pageIndex > 0) blocks.push({ kind: 'page-break' });

    const scale = computePageScale(page.page_geometry);
    const geo = page.page_geometry;

    page.blocks.forEach((block) => {
      if (block.type === 'paragraph') {
        const text = block.text || '';
        if (!text.trim()) return;
        const spans = (block.spans || []).map(convertSpan);
        if (spans.some((s) => s.headingStyle)) headingsDetected += 1;
        if (/^\t*(•\s|◦\s|▪\s|[a-z]+\.\s|[ivxlcdm]+\.\s|\d+\.\s)/i.test(text)) listsDetected += 1;
        blocks.push({ kind: 'text', text, spans, geometry: bboxToGeometry(block.bbox, scale, geo) });
        return;
      }
      if (block.type === 'table') {
        const rows = block.rows && block.rows.length ? block.rows : null;
        if (!rows) return;
        // merges/backgrounds/aligns vacíos: el layout de tabla que da PP-Structure
        // (HTML aplanado) o find_tables() de PyMuPDF no trae esa información con
        // fidelidad suficiente para reconstruirla -- mismo criterio de
        // simplificación aceptada que "tablas anidadas se aplanan" en ADR-173.
        blocks.push({
          kind: 'table',
          rows,
          merges: [],
          backgrounds: rows.map((row) => row.map(() => undefined)),
          aligns: rows.map((row) => row.map(() => undefined)),
          geometry: bboxToGeometry(block.bbox, scale, geo),
        });
        return;
      }
      if (block.type === 'figure') {
        if (!block.image_base64) return;
        const mime = block.mime || 'image/png';
        blocks.push({
          kind: 'image',
          src: `data:${mime};base64,${block.image_base64}`,
          geometry: bboxToGeometry(block.bbox, scale, geo),
        });
      }
    });
  });

  return {
    blocks,
    summary: buildSummary(response, headingsDetected, listsDetected),
    pageSetup: extractPageSetup(response),
  };
}

/** Mensaje legible del resumen post-importación, para mostrar vía setAiStatus. */
export function formatPdfOcrSummary(fileName: string, summary: PdfOcrImportSummary): string {
  const parts: string[] = [`"${fileName}" importado -- ${summary.pageCount} página(s)`];
  if (summary.digitalPages) parts.push(`${summary.digitalPages} con texto digital`);
  if (summary.ocrPages) {
    const confPct =
      summary.averageOcrConfidence !== null ? ` (confianza promedio ${Math.round(summary.averageOcrConfidence * 100)}%)` : '';
    parts.push(`${summary.ocrPages} procesada(s) por OCR${confPct}`);
  }
  if (summary.headingsDetected) parts.push(`${summary.headingsDetected} encabezado(s) detectado(s)`);
  if (summary.listsDetected) parts.push(`${summary.listsDetected} línea(s) de lista`);
  if (summary.pagesWithErrors.length) {
    parts.push(`⚠ ${summary.pagesWithErrors.length} página(s) con error (${summary.pagesWithErrors.join(', ')})`);
  }
  return parts.join(', ') + '.';
}

// ── Modo réplica (ADR-209) ──────────────────────────────────────────────
//
// El backend entrega, por página, un fondo (la página renderizada SIN el
// texto editable: imágenes, dibujos vectoriales, bordes/sombreados de tabla,
// gráficos) y párrafos con la línea base real de su primera línea, el paso
// real entre líneas y los saltos de línea originales. Acá se resuelve cada
// caja en píxeles del lienzo del editor de forma que el texto caiga
// exactamente donde estaba en el PDF:
//   - un único factor de escala UNIFORME por página (posición Y tamaño de
//     fuente) -- nunca se deforma, a diferencia del escalado x/y
//     independiente del importador anterior, que dejaba la fuente sin escalar;
//   - la caja se ubica por la LÍNEA BASE con las métricas reales de la fuente
//     que el navegador va a usar (ascenso/descenso medidos con canvas), no por
//     el bbox del PDF (que depende de las métricas de la fuente de ORIGEN);
//   - si una línea, con la fuente de pantalla, mide más que en el PDF, se
//     reduce la fuente de ese párrafo lo justo para que entre -- el texto no
//     puede invadir la columna/celda vecina.

export interface ReplicaTextElement {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  spans: TextStyleSpan[];
  fontSize: number;
  fontFamily: string;
  fontColor: string;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
  headingStyle?: string;
}

export interface ReplicaImportPage {
  sourcePageNumber: number;
  paperSize: 'A4' | 'A3';
  orientation: 'portrait' | 'landscape';
  background?: { src: string; x: number; y: number; width: number; height: number };
  texts: ReplicaTextElement[];
}

export function isReplicaResponse(response: PdfOcrResponseDto): boolean {
  return response.pages.length > 0 && response.pages.every((page) => page.layout === 'replica');
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
}

function fontSpec(size: number, family: string, bold: boolean, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${size}px ${family}`;
}

/** Ascenso/descenso reales (px) de la fuente con la que el navegador va a
 * dibujar -- define dónde cae la línea base dentro de una caja de línea CSS. */
function fontMetrics(size: number, family: string, bold: boolean, italic: boolean): { ascent: number; descent: number } {
  const ctx = getMeasureCtx();
  if (ctx) {
    ctx.font = fontSpec(size, family, bold, italic);
    const m = ctx.measureText('Hg');
    if (Number.isFinite(m.fontBoundingBoxAscent) && Number.isFinite(m.fontBoundingBoxDescent)) {
      return { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
    }
  }
  return { ascent: size * 0.905, descent: size * 0.212 };
}

interface StyleRun { start: number; end: number; fontSize: number; fontFamily: string; bold: boolean; italic: boolean }

/** Ancho natural (px) de cada línea con los estilos por tramo reales. */
function measureLines(text: string, runs: StyleRun[], base: StyleRun): number[] {
  const ctx = getMeasureCtx();
  const widths: number[] = [];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    const lineEnd = lineStart + line.length;
    let width = 0;
    let cursor = lineStart;
    while (cursor < lineEnd) {
      const run = runs.find((r) => cursor >= r.start && cursor < r.end) || base;
      const chunkEnd = Math.min(lineEnd, run === base ? (runs.find((r) => r.start > cursor)?.start ?? lineEnd) : run.end);
      const chunk = text.slice(cursor, Math.max(chunkEnd, cursor + 1));
      if (ctx) {
        ctx.font = fontSpec(run.fontSize, run.fontFamily, run.bold, run.italic);
        width += ctx.measureText(chunk).width;
      } else {
        width += chunk.length * run.fontSize * 0.5;
      }
      cursor += chunk.length;
    }
    widths.push(width);
    lineStart = lineEnd + 1;
  }
  return widths;
}

export function buildReplicaPages(response: PdfOcrResponseDto): {
  pages: ReplicaImportPage[];
  summary: PdfOcrImportSummary;
} {
  let headingsDetected = 0;
  const pages: ReplicaImportPage[] = response.pages.map((page) => {
    const geo = page.page_geometry;
    const widthPt = geo?.width_pt || 595;
    const heightPt = geo?.height_pt || 842;
    const paperSize = geo?.paper_size || 'A4';
    const orientation = geo?.orientation || (widthPt > heightPt ? 'landscape' : 'portrait');
    const metrics = getReportLayoutMetrics('document', paperSize, orientation);
    // px del lienzo por pt del PDF: uniforme, lo que quepa en la hoja.
    const k = Math.min(metrics.PAGE_WIDTH / widthPt, metrics.PAGE_HEIGHT / heightPt);
    const ox = (metrics.PAGE_WIDTH - widthPt * k) / 2;
    const oy = (metrics.PAGE_HEIGHT - heightPt * k) / 2;

    const texts: ReplicaTextElement[] = [];
    page.blocks.forEach((block) => {
      if (block.type !== 'paragraph' || !block.text || !block.text.trim() || !block.bbox || !block.layout) return;
      const text = block.text;
      const layout = block.layout;
      const rawSpans = (block.spans || []).map(convertSpan);
      const styleSpans = rawSpans.filter((sp) => sp.fontSize || sp.fontFamily);
      const firstStyle = styleSpans[0];
      const baseFamily = firstStyle?.fontFamily || 'Arial, sans-serif';
      // convertSpan ya pasó pt -> px a 96dpi; falta el factor de página.
      const pageScale = k / PT_TO_PX;
      let baseSize = layout.font_size_pt * k;
      const baseRun: StyleRun = { start: 0, end: text.length, fontSize: baseSize, fontFamily: baseFamily, bold: false, italic: false };
      const runs: StyleRun[] = styleSpans.map((sp) => ({
        start: sp.start,
        end: sp.end,
        fontSize: (sp.fontSize ? sp.fontSize * pageScale : baseSize),
        fontFamily: sp.fontFamily || baseFamily,
        bold: !!sp.bold,
        italic: !!sp.italic,
      }));

      const [x0, , x1] = block.bbox;
      const boxWidth = Math.max(1, (x1 - x0) * k);
      const maxLine = Math.max(...measureLines(text, runs, baseRun));
      // Encaje horizontal: la fuente de pantalla puede medir más que la del
      // PDF -- se achica lo justo (nunca se agranda) para no invadir lo que
      // haya a la derecha. 0.99: margen para diferencias canvas vs. DOM.
      const fit = maxLine > boxWidth * 0.99 ? (boxWidth * 0.99) / maxLine : 1;
      baseSize *= fit;

      const spans: TextStyleSpan[] = rawSpans.map((sp) => {
        const out: TextStyleSpan = { ...sp };
        if (sp.fontSize) out.fontSize = Math.round(sp.fontSize * pageScale * fit * 100) / 100;
        return out;
      });
      if (!spans.some((sp) => sp.fontSize)) spans.push({ start: 0, end: text.length, fontSize: Math.round(baseSize * 100) / 100 });
      if (spans.some((sp) => sp.headingStyle)) headingsDetected += 1;

      const pitchPx = layout.pitch_pt * k;
      const lineHeight = pitchPx / baseSize;
      // La línea base de la PRIMERA línea la define su tramo dominante (un
      // título de 9pt con un superíndice de 5pt: manda el de 9pt), no el
      // tamaño dominante del párrafo entero.
      const firstLineEnd = text.indexOf('\n') < 0 ? text.length : text.indexOf('\n');
      let lead: StyleRun = { ...baseRun };
      let leadChars = -1;
      runs.forEach((run) => {
        const chars = Math.min(run.end, firstLineEnd) - Math.max(run.start, 0);
        if (run.start < firstLineEnd && chars > leadChars) { lead = run; leadChars = chars; }
      });
      const { ascent, descent } = fontMetrics(lead.fontSize * fit, lead.fontFamily, lead.bold, lead.italic);
      // CSS: la línea base cae a mitad del interlineado sobrante + ascenso.
      const baselineOffset = (pitchPx - (ascent + descent)) / 2 + ascent;
      const top = oy + layout.baseline_pt * k - baselineOffset;
      const align = rawSpans.find((sp) => sp.textAlign === 'center' || sp.textAlign === 'right')?.textAlign;

      texts.push({
        x: Math.round((ox + x0 * k) * 100) / 100,
        y: Math.round(top * 100) / 100,
        width: Math.round(boxWidth * 100) / 100,
        height: Math.max(1, Math.round(pitchPx * layout.line_count * 100) / 100),
        text,
        spans,
        fontSize: Math.round(baseSize * 100) / 100,
        fontFamily: baseFamily,
        fontColor: firstStyle?.color || '#000000',
        lineHeight: Math.round(lineHeight * 10000) / 10000,
        textAlign: align === 'center' || align === 'right' ? align : 'left',
      });
    });

    const background = page.background && /^image\/(png|jpeg)$/.test(page.background.mime)
      ? {
          src: `data:${page.background.mime};base64,${page.background.image_base64}`,
          x: Math.round(ox * 100) / 100,
          y: Math.round(oy * 100) / 100,
          width: Math.round(widthPt * k * 100) / 100,
          height: Math.round(heightPt * k * 100) / 100,
        }
      : undefined;

    return { sourcePageNumber: page.page_number, paperSize, orientation, background, texts };
  });
  return { pages, summary: buildSummary(response, headingsDetected, 0) };
}
