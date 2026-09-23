import {
  AlignmentType, Bookmark, Document, ExternalHyperlink, Footer, FrameAnchorType, FrameWrap, Header, HeadingLevel,
  ImageRun, InternalHyperlink, LeaderType, LineRuleType, OverlapType, PageNumber, PageOrientation, Packer, Paragraph, SectionType,
  ShadingType, Table, TableAnchorType, TableCell, TableRow, TabStopType,
  TextRun, WidthType, BorderStyle, VerticalAlign,
  type IFrameOptions, type ISectionOptions, type FileChild,
} from 'docx';
import type { ReportDocument, ReportElement, ReportPage, DocumentMeta } from '../../store/useEditorStore';
import { resolvePagePaperSetup, tocSliceForElementId } from '../../store/useEditorStore';
import { resolveHeadingRefLabel } from '../../components/document/TableOfContents';
import { resolveAnnexRefLabel } from '../../components/document/AnnexList';
import { getReportLayoutMetrics } from '../reportLayoutMetrics';
import { HEADING_STYLES, findHeadingStyle } from '../headingStyles';
import { sanitizeSpans, buildStyledSegments, type BaseTextStyle, type StyledSegment } from '../textSpans';
import { findCoverTemplate } from '../coverTemplates';
import { resolveMiningUnitName } from '../sessionChrome';
import { htmlCellToRuns } from './htmlCellToRuns';
import { cssColorToHex, firstFontFamily, pxFontToHalfPt, pxToTwip } from './docxUnits';
import { computeTableFormulas, getEffectiveCellValues } from '../tableFormulas';
import { computeConditionalStyles } from '../tableConditionalFormat';
import { formatNumberForDisplay } from '../tableNumberFormat';
import { semanticStatusStyle } from '../semanticStatus';

/** Sesión mínima que necesita este builder (misma forma que `getSession()` de `authStorage.ts`) — inyectada por el caller para que este módulo no dependa directamente del storage del navegador y sea testeable con datos sintéticos. */
export interface DocxSessionChrome {
  company?: string;
  fullName?: string;
  username?: string;
  tenantId?: string;
  miningUnit?: string;
  unitName?: string;
  mineUnit?: string;
  site?: string;
}

/** PNG ya decodificado listo para `ImageRun` (bytes + tipo). Todas las
 * imágenes (fotos `image`, capturas raster de gráficos/carátula) se
 * normalizan a PNG antes de llegar aquí — ver `captureRasterAssets.ts` y
 * `resolveImageAssetBytes` en `exportEngine.ts`. */
export type DocxImageAsset = Uint8Array;

export interface BuildReportDocxOptions {
  session: DocxSessionChrome;
  /** Bytes PNG de bloques `image` (clave: `ReportElement.id`). */
  imageAssets: Map<string, DocxImageAsset>;
  /** Bytes PNG de capturas en vivo (clave: `ReportElement.id`) para tipos
   * sin representación estática reconstruible: `chart`, `sensor_multi_chart`,
   * y el fondo decorativo de `cover`. */
  rasterAssets: Map<string, DocxImageAsset>;
}

const HEADING_LEVEL_BY_STYLE: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  title: HeadingLevel.TITLE,
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

/** Nombre de bookmark de Word válido para `el.id` -- un bookmark solo puede
 * empezar con una letra y contener letras/dígitos/guion bajo (nada de
 * guiones ni otros símbolos, que sí trae `el.id` tal cual), con un tope de
 * 40 caracteres. Se usa como ancla para que las entradas del índice
 * (`buildTocSectionChildren`) puedan saltar aquí con un hipervínculo
 * interno real -- ver ese comentario para el porqué de no usar un campo
 * `{ TOC }` nativo de Word. */
function bookmarkNameFor(elementId: string): string {
  return `h_${elementId.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 40);
}

const ALIGN_BY_CSS: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};
const alignmentFromCss = (v: unknown) => ALIGN_BY_CSS[String(v || 'left')] || AlignmentType.LEFT;

/** `wrapMode` del lienzo (ADR-049, ver `ReportElement.wrapMode` en
 * `useEditorStore.ts`) → `FrameWrap` de un frame legado de Word (`w:framePr`).
 * Simplificación deliberada: en este documento TODO el contenido está
 * posicionado de forma absoluta (no hay texto que "fluya" alrededor de
 * ningún bloque), así que la distinción fina square/tight/through/behind/
 * infront de la herramienta de diseño no tiene efecto visual observable en
 * Word con un frame legado — se mapea al concepto más cercano que sí existe
 * en `FrameWrap` (AROUND/TIGHT/NOT_BESIDE/NONE) por fidelidad de intención,
 * documentado como límite conocido (ver reporte de verificación). */
function frameWrapFor(wrapMode: ReportElement['wrapMode']): (typeof FrameWrap)[keyof typeof FrameWrap] {
  switch (wrapMode) {
    case 'tight':
    case 'through':
      return FrameWrap.TIGHT;
    case 'topbottom':
      return FrameWrap.NOT_BESIDE;
    case 'square':
      return FrameWrap.AROUND;
    default:
      return FrameWrap.NONE;
  }
}

/** `xPx/yPx/widthPx/heightPx` permiten construir un frame para un
 * sub-rectángulo del elemento (ej. la tabla sismográfica bajo su título) sin
 * perder el tipo discriminado `IXYFrameOptions` (spreadear `elementFrame()`
 * y sobrescribir un campo suelto ensancha `type` a `string` y rompe la unión
 * `IFrameOptions = IXYFrameOptions | IAlignmentFrameOptions`). */
function elementFrame(el: ReportElement, overrides?: { xPx?: number; yPx?: number; widthPx?: number; heightPx?: number }): IFrameOptions {
  return {
    type: 'absolute',
    position: {
      x: pxToTwip(overrides?.xPx ?? el.x),
      y: pxToTwip(overrides?.yPx ?? el.y),
    },
    width: pxToTwip(Math.max(1, overrides?.widthPx ?? el.width)),
    height: pxToTwip(Math.max(1, overrides?.heightPx ?? el.height)),
    anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
    wrap: frameWrapFor(el.wrapMode),
  };
}

const HIGHLIGHT_NAMES = new Set([
  'black', 'blue', 'cyan', 'darkBlue', 'darkCyan', 'darkGray', 'darkGreen', 'darkMagenta',
  'darkRed', 'darkYellow', 'green', 'lightGray', 'magenta', 'red', 'white', 'yellow',
]);
function highlightFromColor(value: string | undefined): string | undefined {
  if (!value || value === 'transparent') return undefined;
  const v = value.trim();
  return HIGHLIGHT_NAMES.has(v) ? v : 'yellow';
}

/** Convierte segmentos con estilo (`lib/textSpans.ts::buildStyledSegments`)
 * en runs de Word, partiendo saltos de línea manuales (`\n`, el bloque de
 * texto usa `white-space:pre-wrap`) en `Break()` reales — todo dentro de UN
 * solo párrafo (ver nota sobre frames multi-párrafo en el reporte). */
/** Reemplaza los TAB de sangria de listas multinivel (SCRUM-31, ver
 * lib/listFormatting.ts) por espacios -- un TAB literal dentro del
 * `text` de un TextRun de la libreria `docx` no produce de forma
 * confiable un salto de tabulacion real en Word (a diferencia de `\n`,
 * que sí se maneja aparte como `break`, esto no tiene un equivalente
 * "sangria" dedicado sin definir tabStops por parrafo). Espacios simples
 * dan una sangria visualmente equivalente sin depender de como cada
 * version de la libreria interprete un TAB crudo. */
function tabsToIndentSpaces(line: string): string {
  let depth = 0;
  while (depth < line.length && line[depth] === '\t') depth += 1;
  return depth === 0 ? line : '    '.repeat(depth) + line.slice(depth);
}

// Mismo whitelist de esquema que ya usa htmlCellToRuns.ts (tabla) -- acá se
// vuelve a validar por defensa en profundidad (el `href` de un span YA se
// valida al importarlo, ver lib/richPaste.ts::SAFE_LINK_SCHEME), nunca
// confiar en que todo dato que llegue a este builder pasó por esa ruta.
const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;

function segmentsToRuns(segments: StyledSegment[]): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  let pendingBreaks = 0;
  // Runs consecutivos con el mismo `href` (p.ej. negrita parcial dentro de
  // un mismo enlace) se agrupan en UN solo ExternalHyperlink con varios
  // hijos -- mismo criterio que reportDocxBuilder.js::htmlCellToRuns (Pipeline
  // B) para no producir varios hipervínculos adyacentes por el mismo enlace.
  let linkGroup: { href: string; children: TextRun[] } | null = null;
  const flushLinkGroup = () => {
    if (linkGroup) out.push(new ExternalHyperlink({ link: linkGroup.href, children: linkGroup.children }));
    linkGroup = null;
  };
  segments.forEach((seg) => {
    const href = seg.href && SAFE_LINK_SCHEME.test(seg.href) ? seg.href : undefined;
    if (href !== linkGroup?.href) flushLinkGroup();
    const lines = seg.text.split('\n');
    lines.forEach((rawLine, i) => {
      if (i > 0) pendingBreaks += 1;
      const line = tabsToIndentSpaces(rawLine);
      if (line.length === 0) return;
      const run = new TextRun({
        text: line,
        break: pendingBreaks || undefined,
        bold: seg.style.bold || undefined,
        italics: seg.style.italic || undefined,
        underline: seg.style.underline ? {} : undefined,
        strike: seg.style.strikethrough || undefined,
        color: cssColorToHex(seg.style.color, '0F172A'),
        font: firstFontFamily(seg.style.fontFamily),
        size: pxFontToHalfPt(seg.style.fontSize),
        highlight: highlightFromColor(seg.style.highlightColor) as any,
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

// Interlineado (`props.lineHeight`, mismo multiplicador CSS que ya usa
// TextBlock.tsx en pantalla) -- faltaba por completo en este builder (y en
// reportDocxBuilder.js, pipeline servidor, mismo fix ahí): ningún `Paragraph`
// fijaba nunca `spacing.line`, así que el interlineado configurado en el
// lienzo se perdía siempre en el .docx exportado. Word mide "auto" en
// 240-avos de línea (240 = sencillo).
const DEFAULT_LINE_HEIGHT = 1.35;
function lineSpacingProps(props: Record<string, any>) {
  const lineHeight = Number(props.lineHeight) > 0 ? Number(props.lineHeight) : DEFAULT_LINE_HEIGHT;
  return { line: Math.round(lineHeight * 240), lineRule: LineRuleType.AUTO };
}
// `props.backgroundColor` (fondo de TODO el bloque -- distinto de
// `span.highlightColor`) faltaba por completo en este builder (mismo gap
// que reportDocxBuilder.js, pipeline servidor). `ReadOnlyViewer.tsx` ya lo
// pinta en pantalla/PDF; ningún `Paragraph` de acá llevaba `shading`.
function blockShadingProps(props: Record<string, any>) {
  const bg = props.backgroundColor;
  if (!bg || bg === 'transparent') return undefined;
  return { type: ShadingType.CLEAR, color: 'auto', fill: cssColorToHex(bg, 'FFFFFF') };
}

/** Recorta+reubica `spans` (offsets absolutos del texto ORIGINAL) a
 * coordenadas LOCALES de un recorte -- mismo criterio que su equivalente en
 * reportDocxBuilder.js (pipeline servidor, usado ahí para listas nativas;
 * acá para columnas de texto). */
function rebaseSpans(spans: import('../textSpans').TextStyleSpan[], contentStart: number, contentLength: number) {
  return spans
    .map((s) => ({ ...s, start: s.start - contentStart, end: s.end - contentStart }))
    .filter((s) => s.end > 0 && s.start < contentLength)
    .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(contentLength, s.end) }));
}

// Columnas tipo periódico (`props.columnCount`) -- mismo criterio y misma
// limitación que reportDocxBuilder.js (pipeline servidor): `docx` no expone
// columnas reales a nivel de un solo párrafo, se aproxima partiendo el
// texto (nunca a mitad de palabra) en N cuadros lado a lado.
function splitTextIntoColumnChunks(text: string, columnCount: number) {
  const targetLen = Math.max(1, Math.ceil(text.length / columnCount));
  const parts = text.split(/(\s+)/);
  const chunks: { text: string; start: number; end: number }[] = [];
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
function buildColumnParagraphs(
  el: ReportElement, props: Record<string, any>, text: string,
  spans: import('../textSpans').TextStyleSpan[], base: BaseTextStyle,
  resolveRef: (targetId: string) => string | undefined, columnCount: number,
): Paragraph[] {
  const chunks = splitTextIntoColumnChunks(text, columnCount);
  const colWidthPx = Math.max(20, (el.width - COLUMN_GAP_PX * (columnCount - 1)) / columnCount);
  return chunks.map((chunk, i) => {
    const rebased = rebaseSpans(spans, chunk.start, chunk.text.length);
    const segments = buildStyledSegments(chunk.text, rebased, base, resolveRef);
    const runs = segmentsToRuns(segments);
    const frame = elementFrame(el, { xPx: el.x + i * (colWidthPx + COLUMN_GAP_PX), widthPx: colWidthPx });
    // Bookmark SOLO en la primera columna -- un `id` duplicado en varios
    // bookmarks rompería Word (nombres únicos obligatorios); una referencia
    // cruzada a este bloque sigue apuntando al mismo `el.id` de siempre.
    const children = i === 0 ? [new Bookmark({ id: bookmarkNameFor(el.id), children: runs })] : runs;
    return new Paragraph({
      frame, alignment: alignmentFromCss(props.textAlign),
      spacing: lineSpacingProps(props), shading: blockShadingProps(props),
      children,
    });
  });
}

function buildTextElement(el: ReportElement, resolveRef: (targetId: string) => string | undefined): Paragraph[] {
  const props = el.props || {};
  const text = String(props.text || '');
  const base: BaseTextStyle = {
    bold: !!props.bold,
    italic: !!props.italic,
    underline: !!props.underline,
    strikethrough: false,
    color: props.fontColor || '#0f172a',
    fontSize: props.fontSize || 14,
    fontFamily: props.fontFamily || 'Arial',
    highlightColor: props.highlightColor || 'transparent',
    headingStyle: props.headingStyle,
    textAlign: props.textAlign || 'left',
  };
  const spans = sanitizeSpans(props.spans, text.length);
  const columnCount = Math.max(1, Math.min(4, Number(props.columnCount) || 1));
  if (columnCount > 1) return buildColumnParagraphs(el, props, text, spans, base, resolveRef, columnCount);
  const segments = buildStyledSegments(text, spans, base, resolveRef);
  // Encabezado de TODO el bloque (botón del ribbon) -> nivel real de Word
  // (aparece en el Panel de navegación y en el escaneo de un TOC nativo).
  // Encabezados aplicados solo a una PORCIÓN vía spans conservan su tamaño/
  // color/negrita visual (ya vienen en `segments[].style`) pero no fuerzan
  // el nivel de párrafo completo -- ver nota sobre TOC estático más abajo.
  const wholeBlockLevel = props.headingStyle ? HEADING_LEVEL_BY_STYLE[props.headingStyle] : undefined;
  const runs = segmentsToRuns(segments);
  // Bookmark SIEMPRE (no solo cuando hay heading de bloque completo): una
  // entrada del índice puede venir de un heading aplicado solo a una
  // PORCIÓN de texto (span) -- su `elementId` sigue siendo el de ESTE
  // párrafo (ver TocHeading en TableOfContents.tsx), así que el ancla tiene
  // que existir igual para que el hipervínculo del índice no rompa.
  return [new Paragraph({
    frame: elementFrame(el),
    heading: wholeBlockLevel,
    alignment: alignmentFromCss(props.textAlign),
    spacing: lineSpacingProps(props),
    shading: blockShadingProps(props),
    children: [new Bookmark({ id: bookmarkNameFor(el.id), children: runs })],
  })];
}

/** Igual que `metricsForPage` (useEditorStore.ts, no exportado) -- métricas
 * de lienzo resolviendo primero el tamaño/orientación PROPIOS de la página
 * antes de caer al valor del documento. Se reimplementa acá porque el
 * original es un `const` privado del módulo del store. */
function layoutMetricsForPage(page: ReportPage, meta: DocumentMeta): ReturnType<typeof getReportLayoutMetrics> {
  const effective = resolvePagePaperSetup(page, meta);
  return getReportLayoutMetrics(
    meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
    effective.paperSize,
    effective.orientation,
    meta?.marginLeft,
    meta?.marginRight,
    meta?.marginTop,
    meta?.marginBottom,
  );
}

function buildTableElement(el: ReportElement, page: ReportPage, meta: DocumentMeta): Table {
  const props = el.props || {};
  const rows: string[][] = Array.isArray(props.rows) ? props.rows : [];
  if (rows.length === 0) return new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] })] });
  const hasHeader = props.hasHeader !== false;
  const fontSize = Number(props.fontSize) || 14;
  const cellPaddingTwip = pxToTwip(Number(props.cellPadding) || 10);
  const colCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));

  // Mismo motor de fórmulas/formato condicional que el lienzo
  // (TableBlock.tsx) -- Word debe ver el RESULTADO calculado, nunca la
  // fórmula cruda ("=D2*E2"), y los mismos colores (escalas, reglas de
  // umbral, estados semánticos "Alto"/"Bajo"…) que el usuario ve en el
  // editor. Bug real reportado 2026-09-04: el export no traía ninguno de
  // los dos.
  const formulaResults = computeTableFormulas(rows);
  const effectiveValues = getEffectiveCellValues(rows, formulaResults);
  const conditionalStyles = computeConditionalStyles(
    effectiveValues,
    Array.isArray(props.conditionalFormats) ? props.conditionalFormats : undefined,
    hasHeader,
    Array.isArray(props.colorScales) ? props.colorScales : undefined,
  );
  const cellNumberFormats: (string | null)[][] = Array.isArray(props.cellNumberFormats) ? props.cellNumberFormats : [];
  const cellBackgrounds: (string | null)[][] = Array.isArray(props.cellBackgrounds) ? props.cellBackgrounds : [];
  const rowBackgrounds: (string | null)[] = Array.isArray(props.rowBackgrounds) ? props.rowBackgrounds : [];
  const columnBackgrounds: (string | null)[] = Array.isArray(props.columnBackgrounds) ? props.columnBackgrounds : [];

  // Ancho de columnas: Word respeta el ancho DECLARADO de cada TableCell por
  // encima del ancho de la Table completa -- si la suma de columnas no cabe
  // en lo que queda de página a la derecha de `el.x`, el sobrante queda
  // recortado contra el borde de la hoja en vez de reflowar (bug real
  // reportado: "se ve cortado en el ancho de la tabla"). Se escala TODA la
  // tabla proporcionalmente para que quepa siempre, mismo criterio que el
  // resto de bloques de este documento (nunca deben salirse de su página).
  const providedWidths: number[] = Array.isArray(props.colWidths) ? props.colWidths : [];
  const rawColWidthsPx = Array.from({ length: colCount }, (_, i) => providedWidths[i] || el.width / colCount);
  const metrics = layoutMetricsForPage(page, meta);
  const availableWidthPx = Math.max(40, metrics.CONTENT_RIGHT - el.x);
  const rawSumPx = rawColWidthsPx.reduce((sum, w) => sum + w, 0);
  const scale = rawSumPx > availableWidthPx ? availableWidthPx / rawSumPx : 1;
  const colWidths = rawColWidthsPx.map((w) => pxToTwip(w * scale));
  const tableWidthTwip = colWidths.reduce((sum, w) => sum + w, 0);

  const borderColor = cssColorToHex(props.borderColor, 'E2E8F0');
  const borderWidthPx = Number(props.borderWidth) || 1;
  const borderStyleWord = props.borderStyle === 'dashed' ? BorderStyle.DASHED
    : props.borderStyle === 'dotted' ? BorderStyle.DOTTED
    : props.borderStyle === 'none' ? BorderStyle.NONE
    : BorderStyle.SINGLE;
  const cellBorder = { style: borderStyleWord, size: Math.max(2, borderWidthPx * 4), color: borderColor };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const align = props.cellAlign === 'center' ? AlignmentType.CENTER : props.cellAlign === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;
  const vAlign = props.cellVAlign === 'middle' ? VerticalAlign.CENTER : props.cellVAlign === 'bottom' ? VerticalAlign.BOTTOM : VerticalAlign.TOP;

  const tableRows = rows.map((row, ri) => {
    const isHeaderRow = ri === 0 && hasHeader;
    const isBanded = !isHeaderRow && props.bandedRows && ri % 2 === (hasHeader ? 1 : 0);
    const cells = Array.from({ length: colCount }, (_, ci) => {
      const raw = Array.isArray(row) ? row[ci] : '';
      const conditionalStyle = conditionalStyles[ri]?.[ci] ?? null;
      // Mismo orden de precedencia que el <td> del lienzo (TableBlock.tsx):
      // formato condicional > pintado manual de celda/fila/columna > estado
      // semántico automático > cabecera/bandas > transparente.
      const sem = !isHeaderRow ? semanticStatusStyle(effectiveValues[ri]?.[ci]?.text ?? String(raw ?? ''), false) : null;
      const bgSource = conditionalStyle?.backgroundColor
        || cellBackgrounds[ri]?.[ci]
        || rowBackgrounds[ri]
        || columnBackgrounds[ci]
        || (isHeaderRow ? (props.headerBg || '#F8FAFC') : sem ? sem.bg : isBanded ? (props.bandColor || '#F1F5F9') : undefined);
      const shading = bgSource
        ? { type: ShadingType.CLEAR, color: 'auto', fill: cssColorToHex(bgSource, 'FFFFFF') }
        : undefined;
      const textColorSource = conditionalStyle?.textColor
        || (isHeaderRow ? (props.headerTextColor || '#1e293b') : sem ? sem.color : props.textColor);

      const formulaResult = formulaResults[ri]?.[ci];
      const runs = formulaResult
        ? [new TextRun({
            text: formulaResult.isError
              ? formulaResult.display
              : formatNumberForDisplay(formulaResult.numericValue as number, cellNumberFormats[ri]?.[ci] ?? null),
            size: pxFontToHalfPt(fontSize),
            bold: isHeaderRow ? props.headerBold !== false : false,
            color: cssColorToHex(textColorSource, isHeaderRow ? '1E293B' : '0F172A'),
          })]
        : htmlCellToRuns(String(raw ?? ''), {
            fontSizePx: fontSize,
            color: textColorSource,
            bold: isHeaderRow ? props.headerBold !== false : false,
          });
      return new TableCell({
        width: { size: colWidths[ci], type: WidthType.DXA },
        shading,
        borders: cellBorders,
        margins: { top: cellPaddingTwip, bottom: cellPaddingTwip, left: cellPaddingTwip, right: cellPaddingTwip },
        verticalAlign: vAlign,
        children: [new Paragraph({ alignment: align, children: runs })],
      });
    });
    return new TableRow({ tableHeader: isHeaderRow, children: cells });
  });

  return new Table({
    rows: tableRows,
    width: { size: tableWidthTwip, type: WidthType.DXA },
    float: {
      horizontalAnchor: TableAnchorType.PAGE,
      absoluteHorizontalPosition: pxToTwip(el.x),
      verticalAnchor: TableAnchorType.PAGE,
      absoluteVerticalPosition: pxToTwip(el.y),
      overlap: OverlapType.NEVER,
    },
  });
}

function buildImageParagraph(el: ReportElement, png: DocxImageAsset): Paragraph {
  return new Paragraph({
    frame: elementFrame(el),
    children: [new ImageRun({
      type: 'png',
      data: png,
      transformation: { width: Math.max(1, Math.round(el.width)), height: Math.max(1, Math.round(el.height)) },
    })],
  });
}
const IMAGE_CAPTION_HEIGHT_PX = 18;
// `props.caption` (bloque `image`) -- ReadOnlyViewer.tsx SIEMPRE la pinta
// debajo de la imagen (fuente del anexo/referencia cruzada, AnnexList.tsx),
// pero este builder nunca la incluía (mismo gap que reportDocxBuilder.js,
// pipeline servidor). Mismo color/cursiva que el visor de pantalla.
function buildImageWithCaption(el: ReportElement, png: DocxImageAsset, caption: unknown): Paragraph[] {
  const trimmed = String(caption || '').trim();
  if (!trimmed) return [buildImageParagraph(el, png)];
  const captionHeight = Math.min(IMAGE_CAPTION_HEIGHT_PX, Math.max(0, el.height - 20));
  const imageHeight = Math.max(1, el.height - captionHeight);
  const imagePara = buildImageParagraph({ ...el, height: imageHeight }, png);
  if (captionHeight <= 0) return [imagePara];
  const captionPara = new Paragraph({
    frame: elementFrame(el, { yPx: el.y + imageHeight, heightPx: captionHeight }),
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: trimmed, italics: true, color: '4F81BD', size: pxFontToHalfPt(9) })],
  });
  return [imagePara, captionPara];
}

/** Tarjeta nativa (texto real, editable, SIN captura de pantalla) para
 * `kpi`/`sensor`: mismo dato congelado (`props.snapshot`, ADR-012) que ya
 * lee el fallback HTML histórico de `exportEngine.ts`. */
function buildKpiOrSensorCard(el: ReportElement): Paragraph {
  const props = el.props || {};
  const snap = props.snapshot;
  const value = snap?.value != null ? String(snap.value) : (props.value || '—');
  const unit = snap?.unit ? ` ${snap.unit}` : '';
  return new Paragraph({
    frame: elementFrame(el),
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: value + unit, bold: true, size: pxFontToHalfPt(26), color: '0891B2' }),
      new TextRun({ text: '', break: 1 }), new TextRun({ text: '', break: 1 }),
      new TextRun({ text: String(props.title || (el.type === 'kpi' ? 'KPI' : 'Sensor')), size: pxFontToHalfPt(11), color: '475569' }),
    ],
  });
}

function seismicTitleParagraph(el: ReportElement, titleHeightPx: number): Paragraph {
  const props = el.props || {};
  const start = props.startDate || '';
  const end = props.endDate || '';
  return new Paragraph({
    frame: elementFrame(el, { heightPx: titleHeightPx }),
    children: [
      new TextRun({ text: String(props.title || 'Reporte Sismográfico'), bold: true, size: pxFontToHalfPt(14) }),
      new TextRun({ text: `  (${start} — ${end})`, size: pxFontToHalfPt(11), color: '64748B' }),
    ],
  });
}

function seismicTable(el: ReportElement, yOffsetPx: number, heightPx: number): Table {
  const props = el.props || {};
  const snap = props.snapshot || {};
  const igpEvents: any[] = Array.isArray(snap.igpEvents) ? snap.igpEvents : [];
  const source = props.source || 'both';
  const headerCells = ['Fecha', 'Mag.', 'Prof.(km)', 'Referencia'];
  const dataRows = source === 'igp' || source === 'both'
    ? (igpEvents.length > 0
      ? igpEvents.slice(-10).reverse().map((ev) => [
        String(ev.fecha_local || '—').slice(0, 10), String(ev.magnitud ?? '—'), String(ev.profundidad ?? '—'), String(ev.referencia || '—'),
      ])
      : [['Sin sismos oficiales en el rango.', '', '', '']])
    : [];
  const companyLine = (source === 'company' || source === 'both')
    ? `Microsismicidad — sensores propios: ${snap.companyCount != null ? snap.companyCount : 'Sin snapshot'} eventos detectados en el rango.`
    : null;

  const totalWidthTwip = pxToTwip(el.width);
  const colWidths = [totalWidthTwip * 0.28, totalWidthTwip * 0.16, totalWidthTwip * 0.2, totalWidthTwip * 0.36].map(Math.round);
  const rows: TableRow[] = [];
  // La tabla oficial IGP (cabecera + filas) solo tiene sentido con
  // source 'igp'/'both' -- igual que el fallback histórico de
  // exportEngine.ts, un informe 'company'-only no debe mostrar una tabla con
  // cabecera y CERO filas de datos.
  if (source === 'igp' || source === 'both') {
    rows.push(new TableRow({
      tableHeader: true,
      children: headerCells.map((h, i) => new TableCell({
        width: { size: colWidths[i], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: '17365D' },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: pxFontToHalfPt(11) })] })],
      })),
    }));
  }
  dataRows.forEach((row) => {
    rows.push(new TableRow({
      children: row.map((cell, i) => new TableCell({
        width: { size: colWidths[i], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: cell, size: pxFontToHalfPt(10) })] })],
      })),
    }));
  });
  if (companyLine) {
    rows.push(new TableRow({
      children: [new TableCell({
        columnSpan: 4,
        width: { size: totalWidthTwip, type: WidthType.DXA },
        margins: { top: 80, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: companyLine, italics: true, size: pxFontToHalfPt(10), color: '334155' })] })],
      })],
    }));
  }
  if (rows.length === 0) {
    rows.push(new TableRow({ children: [new TableCell({ children: [new Paragraph('Sin datos sismográficos configurados.')] })] }));
  }

  return new Table({
    rows,
    width: { size: totalWidthTwip, type: WidthType.DXA },
    float: {
      horizontalAnchor: TableAnchorType.PAGE,
      absoluteHorizontalPosition: pxToTwip(el.x),
      verticalAnchor: TableAnchorType.PAGE,
      absoluteVerticalPosition: pxToTwip(el.y + yOffsetPx),
      overlap: OverlapType.NEVER,
    },
  });
}

/** Encabezado/pie de página NATIVOS de Word (`w:headerReference`/
 * `w:footerReference` en las propiedades de sección, partes separadas
 * `word/header{N}.xml`/`word/footer{N}.xml`) -- NO un párrafo flotante más.
 * Corrección sobre la versión anterior de este builder (que sí usaba un
 * `Paragraph` con `frame`, indistinguible de cualquier otro bloque de texto
 * del cuerpo): un párrafo flotante JAMÁS aparece en la franja de
 * encabezado/pie real de Word, no es editable con doble clic como
 * encabezado/pie, y no repagina solo -- exactamente lo que un usuario
 * esperaría de "el pie de página no funciona" al abrir el .docx. El número
 * de página usa el campo NATIVO `PAGE`/`NUMPAGES` (`PageNumber.CURRENT`/
 * `.TOTAL_PAGES`), no un literal calculado en build-time -- se recalcula
 * solo si el usuario reordena páginas a mano en Word. */
function buildHeaderPart(chromeLabel: string): Header {
  return new Header({
    children: [new Paragraph({
      children: [new TextRun({ text: chromeLabel, bold: true, size: pxFontToHalfPt(9), color: '595959', font: 'Arial Black' })],
    })],
  });
}

function buildFooterPart(widthTwip: number, showPageNumber: boolean): Footer {
  return new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: widthTwip }],
      children: [
        new TextRun({ text: 'BEEMETRY', bold: true, size: pxFontToHalfPt(9), color: '595959', font: 'Arial Black' }),
        ...(showPageNumber
          ? [
            new TextRun({ text: '\t' }),
            new TextRun({ children: ['PÁGINA ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], bold: true, size: pxFontToHalfPt(9), color: '595959', font: 'Arial Black' }),
          ]
          : []),
      ],
    })],
  });
}

/** Placeholder nativo para `video` -- Word no puede reproducir video
 * embebido; se usa solo como respaldo cuando el bloque no tiene póster (ver
 * `buildVideoElement` más abajo), p.ej. videos guardados antes de que
 * `VideoInsertModal.tsx` empezara a capturar una miniatura del primer
 * frame. */
function buildVideoPlaceholder(el: ReportElement): Paragraph {
  const props = el.props || {};
  const durationLabel = props.durationSeconds ? ` (${props.durationSeconds}s)` : '';
  const sourceLabel = props.source === 'screen' ? 'grabación de pantalla' : 'grabación de cámara web';
  return new Paragraph({
    frame: elementFrame(el),
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `[Video adjunto${durationLabel} — ${sourceLabel} — no reproducible en este formato de exportación]`,
      italics: true, color: '64748B', size: pxFontToHalfPt(10),
    })],
  });
}

/** El póster (miniatura del primer frame) se captura en vivo en el navegador
 * al grabar (canvas del `<video>` de revisión, ver `VideoInsertModal.tsx`) y
 * viaja como data URL dentro de `el.props.posterSrc`, igual que `src` de un
 * bloque `image` -- no requiere capturarlo de nuevo acá, solo decodificarlo. */
function decodeDataUrlToUint8Array(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const bin = atob(match[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function buildVideoElement(el: ReportElement): FileChild[] {
  const props = el.props || {};
  const posterBytes = decodeDataUrlToUint8Array(props.posterSrc);
  if (!posterBytes) return [buildVideoPlaceholder(el)];
  const durationLabel = props.durationSeconds ? ` (${props.durationSeconds}s)` : '';
  const sourceLabel = props.source === 'screen' ? 'grabación de pantalla' : 'grabación de cámara web';
  return buildRasterWidget(el, posterBytes, `Video adjunto${durationLabel} — ${sourceLabel} — reproducible en la plataforma`);
}

/** `true` si esta página está dedicada a un bloque `toc` -- el editor ya
 * garantiza esto por diseño (el TOC nunca comparte página con otro
 * contenido, ver `syncTocPages()`/`tocContinuationIndex` en
 * `useEditorStore.ts`): permite tratar TODA la página con flujo normal de
 * Word en vez de frames absolutos, requisito para usar un campo `TOC`
 * nativo (ver `buildTocSectionChildren`). */
function pageHasToc(page: ReportPage): boolean {
  return (page.elements || []).some((el) => el.type === 'toc');
}

const TOC_LEVEL_STYLE: Record<number, { size: number; bold: boolean; color: string }> = {
  1: { size: pxFontToHalfPt(14), bold: true, color: '0f172a' },
  2: { size: pxFontToHalfPt(13), bold: true, color: '1e40af' },
  3: { size: pxFontToHalfPt(12.5), bold: false, color: '334155' },
  4: { size: pxFontToHalfPt(12), bold: false, color: '475569' },
  5: { size: pxFontToHalfPt(11.5), bold: false, color: '64748b' },
  6: { size: pxFontToHalfPt(11), bold: false, color: '94a3b8' },
};

/**
 * Índice del DOCX -- párrafos ya renderizados con hipervínculo interno REAL
 * a cada encabezado (`InternalHyperlink` + `Bookmark`, ver
 * `bookmarkNameFor`/`buildTextElement`), NO un campo `{ TOC }` nativo de
 * Word como la versión anterior de este builder.
 *
 * Por qué el cambio: un campo TOC nativo solo se puebla cuando Word
 * RECALCULA el campo (clic derecho → Actualizar campo, F9, o al abrir SI
 * Word decide honrar `features.updateFields` -- no siempre lo hace,
 * depende de la config de "Actualizar vínculos automáticos al abrir" del
 * usuario). Sin ese recálculo, Word muestra literalmente su propio
 * placeholder "No table of contents entries found." -- confirmado en vivo
 * abriendo un .docx recién exportado. Mismo problema de fondo que tuvo el
 * índice del PDF (ver pdf-export-service/server.js): en vez de depender de
 * que el lector recalcule algo, se hornea el contenido y el enlace
 * directamente en el archivo, con los MISMOS datos (`tocSliceForElementId`)
 * que ya muestra `ReadOnlyViewer.tsx` en pantalla y en el PDF -- funciona
 * apenas se abre el archivo, en cualquier versión/configuración de Word,
 * LibreOffice, Google Docs, etc. Trade-off aceptado: si el usuario reordena
 * o renombra títulos DENTRO de Word (fuera de la plataforma), este índice
 * ya no se autoactualiza solo -- caso de uso secundario frente al flujo
 * principal (editar en la plataforma, exportar de nuevo).
 */
function buildTocSectionChildren(doc: ReportDocument, el: ReportElement, contentWidthTwip: number): FileChild[] {
  const props = el.props || {};
  const titleText = String(props.title || 'Tabla de Contenidos') + (typeof props.tocContinuationIndex === 'number' ? ' (continuación)' : '');
  const titlePara = new Paragraph({
    children: [new TextRun({ text: titleText, bold: true, size: pxFontToHalfPt(18) })],
    spacing: { after: 200 },
  });
  const entries = tocSliceForElementId(doc, el.id);
  if (entries.length === 0) {
    return [titlePara, new Paragraph({ children: [new TextRun({ text: 'Sin entradas de índice.', italics: true, size: pxFontToHalfPt(12), color: '94a3b8' })] })];
  }
  const entryParas = entries.map((item) => {
    const style = TOC_LEVEL_STYLE[item.level] || TOC_LEVEL_STYLE[6];
    return new Paragraph({
      indent: { left: pxToTwip((item.level - 1) * 16) },
      tabStops: [{ type: TabStopType.RIGHT, position: contentWidthTwip, leader: LeaderType.DOT }],
      spacing: { after: 60 },
      children: [
        new TextRun({ text: `${item.number}  `, bold: true, size: pxFontToHalfPt(12) }),
        new InternalHyperlink({
          anchor: bookmarkNameFor(item.elementId),
          children: [new TextRun({ text: item.text, bold: style.bold, size: style.size, color: style.color, style: 'Hyperlink' })],
        }),
        new TextRun({ text: `\t${item.pageNumber}`, bold: true, size: pxFontToHalfPt(12) }),
      ],
    });
  });
  return [titlePara, ...entryParas];
}

function buildCoverElement(
  el: ReportElement,
  session: DocxSessionChrome,
  rasterAssets: Map<string, DocxImageAsset>,
): FileChild[] {
  const props = el.props || {};
  const template = findCoverTemplate(props.coverTemplate);
  const bg = rasterAssets.get(el.id);
  const out: FileChild[] = [];
  if (bg) {
    // La captura de la carátula incluye TODO su contenido renderizado
    // (fondo Y título/clasificación/fecha, ya dibujados por el propio
    // lienzo) -- máxima fidelidad posible, calco exacto de lo que se ve en
    // el editor. Superponer ADEMÁS el texto nativo aquí abajo lo
    // duplicaría (doble título, uno horneado en la imagen y otro flotando
    // encima, potencialmente desalineado) sin ganar nada, así que el texto
    // nativo queda reservado como respaldo SOLO para cuando la captura
    // falló (ver rama else) -- mejor una carátula parcialmente editable
    // que ninguna.
    out.push(buildImageParagraph(el, bg));
    return out;
  }
  const chromeAuthor = session.fullName || session.username;
  out.push(new Paragraph({
    frame: elementFrame(el),
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: String(props.classification || template.classificationLabel), bold: true, size: pxFontToHalfPt(11), color: cssColorToHex(template.classificationColor, 'FBBF24') }),
      new TextRun({ text: '', break: 1 }), new TextRun({ text: '', break: 1 }), new TextRun({ text: '', break: 1 }), new TextRun({ text: '', break: 1 }), new TextRun({ text: '', break: 1 }), new TextRun({ text: '', break: 1 }),
      new TextRun({ text: String(props.title || template.titleFallback), bold: true, size: pxFontToHalfPt(30), color: cssColorToHex(template.textColor, 'FFFFFF') }),
      new TextRun({ text: '', break: 1 }), new TextRun({ text: '', break: 1 }),
      ...(session.company ? [new TextRun({ text: session.company, bold: true, size: pxFontToHalfPt(16), color: cssColorToHex(template.textColor, 'FFFFFF') }), new TextRun({ text: '', break: 1 })] : []),
      ...(props.docCode ? [new TextRun({ text: `Código: ${props.docCode}`, size: pxFontToHalfPt(10), color: cssColorToHex(template.textColor, 'FFFFFF') }), new TextRun({ text: '', break: 1 })] : []),
      ...(chromeAuthor ? [new TextRun({ text: `Autor: ${chromeAuthor}`, size: pxFontToHalfPt(10), color: cssColorToHex(template.textColor, 'FFFFFF') }), new TextRun({ text: '', break: 1 })] : []),
      ...(props.date ? [new TextRun({ text: `Fecha: ${props.date}`, size: pxFontToHalfPt(10), color: cssColorToHex(template.textColor, 'FFFFFF') })] : []),
    ],
  }));
  return out;
}

/** El título del gráfico ya queda dibujado DENTRO de la imagen capturada
 * (Plotly/ECharts lo pintan en el propio lienzo), pero solo como píxeles —
 * se agrega además como texto nativo real (buscable/copiable/editable en
 * Word) en una franja bajo la imagen, reservada del alto total del bloque. */
const RASTER_CAPTION_HEIGHT_PX = 18;

function buildRasterWidget(el: ReportElement, png: DocxImageAsset | undefined, label: string): FileChild[] {
  const title = String(el.props?.title || label);
  if (!png) {
    return [new Paragraph({
      frame: elementFrame(el),
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `[${title} — no se pudo capturar para esta exportación]`, italics: true, color: '94A3B8', size: pxFontToHalfPt(10) })],
    })];
  }
  const captionHeight = Math.min(RASTER_CAPTION_HEIGHT_PX, Math.max(0, el.height - 20));
  const imageHeight = Math.max(1, el.height - captionHeight);
  const imagePara = buildImageParagraph({ ...el, height: imageHeight }, png);
  if (captionHeight <= 0) return [imagePara];
  const captionPara = new Paragraph({
    frame: elementFrame(el, { yPx: el.y + imageHeight, heightPx: captionHeight }),
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: title, italics: true, color: '64748B', size: pxFontToHalfPt(9) })],
  });
  return [imagePara, captionPara];
}

function pageOrientationAndSizeTwip(page: ReportPage, meta: DocumentMeta) {
  const { paperSize, orientation } = resolvePagePaperSetup(
    { paperSize: page.paperSize, orientation: page.orientation },
    { paperSize: meta?.paperSize, orientation: meta?.orientation },
  );
  const sizeMm = paperSize === 'A3' ? { w: 297, h: 420 } : { w: 210, h: 297 };
  const isLandscape = orientation === 'landscape';
  // NO pre-intercambiar acá -- `createPageSize` de la librería `docx` YA
  // intercambia w:w/w:h internamente cuando `orientation === LANDSCAPE` (ver
  // node_modules/docx). Pre-intercambiar ACÁ ADEMÁS causaba un doble
  // intercambio: una página A3 horizontal terminaba con w:w=297mm/w:h=420mm
  // (retrato) pero marcada w:orient="landscape" -- confirmado inspeccionando
  // el .docx real generado (mismo bug en el builder servidor,
  // reportDocxBuilder.js). Se le pasan siempre las medidas BASE (retrato) de
  // la hoja; la orientación sola le dice a la librería cuál usar como ancho.
  return {
    width: pxToTwip(sizeMm.w * 3.7795275591),
    height: pxToTwip(sizeMm.h * 3.7795275591),
    orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
  };
}

function buildPageSection(
  doc: ReportDocument,
  page: ReportPage,
  session: DocxSessionChrome,
  opts: BuildReportDocxOptions,
  resolveRef: (targetId: string) => string | undefined,
): ISectionOptions {
  const size = pageOrientationAndSizeTwip(page, doc.meta);
  const sorted = [...(page.elements || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const isTocPage = pageHasToc(page);

  const children: FileChild[] = [];
  let headerPart: Header | undefined;
  let footerPart: Footer | undefined;

  sorted.forEach((el) => {
    switch (el.type) {
      case 'text':
        children.push(...buildTextElement(el, resolveRef));
        break;
      case 'table':
        children.push(buildTableElement(el, page, doc.meta));
        break;
      case 'image': {
        const png = opts.imageAssets.get(el.id);
        if (png) children.push(...buildImageWithCaption(el, png, el.props?.caption));
        break;
      }
      // ShapeBlock.tsx (rectángulo/círculo/diamante/estrella/línea, usado
      // para diagramas de bloque) -- faltaba por completo (caía a
      // `default`, se perdía en silencio del export). Capturado como
      // raster (RASTER_ONLY_TYPES en captureRasterAssets.ts) igual que un
      // gráfico -- sin caption, a diferencia de `buildRasterWidget`.
      case 'shape': {
        const png = opts.rasterAssets.get(el.id);
        if (png) children.push(buildImageParagraph(el, png));
        else children.push(new Paragraph({
          frame: elementFrame(el),
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '[Figura — no se pudo capturar para esta exportación]', italics: true, color: '94A3B8', size: pxFontToHalfPt(10) })],
        }));
        break;
      }
      // WordArt -- mismo criterio que 'shape': raster, `docx` no expone
      // relleno degradado/contorno de texto por `TextRun`.
      case 'wordart': {
        const png = opts.rasterAssets.get(el.id);
        if (png) children.push(buildImageParagraph(el, png));
        else children.push(new Paragraph({
          frame: elementFrame(el),
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '[WordArt — no se pudo capturar para esta exportación]', italics: true, color: '94A3B8', size: pxFontToHalfPt(10) })],
        }));
        break;
      }
      case 'kpi':
      case 'sensor':
        children.push(buildKpiOrSensorCard(el));
        break;
      case 'seismic-report': {
        const titleHeight = 28;
        children.push(seismicTitleParagraph(el, titleHeight));
        children.push(seismicTable(el, titleHeight + 6, el.height - titleHeight - 6));
        break;
      }
      // header/footer: NO se agregan a `children` -- se convierten en el
      // encabezado/pie NATIVO de esta sección (ver `headers`/`footers` en
      // el `return` de abajo), no en más contenido flotante del cuerpo.
      case 'header': {
        const chromeParts = [session.company, resolveMiningUnitName(session), session.fullName || session.username]
          .filter((v): v is string => Boolean(v && v.trim()));
        const chromeLabel = (chromeParts.length > 0 ? chromeParts.join('  •  ') : 'EMPRESA MINERA').toUpperCase();
        headerPart = buildHeaderPart(chromeLabel);
        break;
      }
      case 'footer':
        footerPart = buildFooterPart(pxToTwip(el.width), el.props?.showPageNumber !== false);
        break;
      case 'toc': {
        // Los párrafos del índice (no un Paragraph con `frame`) se agregan
        // directo a `children` en flujo normal -- ver `isTocPage` abajo,
        // que además cambia los márgenes de TODA la sección para que ese
        // flujo se vea correcto (el editor garantiza que un bloque `toc`
        // nunca comparte página con otro contenido). El ancho de contenido
        // real (página menos los márgenes izq/der de esta sección, ver
        // `margin` más abajo) define dónde cae el número de página del
        // lado derecho de cada entrada.
        const tocContentWidthTwip = size.width - pxToTwip(36) - pxToTwip(36);
        children.push(...buildTocSectionChildren(doc, el, tocContentWidthTwip));
        break;
      }
      case 'cover':
        children.push(...buildCoverElement(el, session, opts.rasterAssets));
        break;
      case 'video':
        children.push(...buildVideoElement(el));
        break;
      case 'chart':
        children.push(...buildRasterWidget(el, opts.rasterAssets.get(el.id), 'Gráfico'));
        break;
      case 'sensor_multi_chart':
        children.push(...buildRasterWidget(el, opts.rasterAssets.get(el.id), 'Gráfico de sensores'));
        break;
      default:
        break;
    }
  });

  // Márgenes: el resto de bloques usa frames anclados a 'page' (ignoran el
  // margen del cuerpo para su propia posición), así que el margen en 0 no
  // los afecta -- salvo en una página de índice, donde el campo TOC SÍ es
  // contenido de flujo normal y necesita márgenes reales para verse
  // correctamente dentro del área de contenido (no pegado al borde).
  const contentTopPx = 72;
  const contentBottomPx = 62;
  const margin = isTocPage
    ? { top: pxToTwip(contentTopPx), bottom: pxToTwip(contentBottomPx), left: pxToTwip(36), right: pxToTwip(36), header: pxToTwip(20), footer: pxToTwip(20) }
    : { top: pxToTwip(58), bottom: pxToTwip(48), left: 0, right: 0, header: pxToTwip(15), footer: pxToTwip(15) };

  return {
    properties: {
      page: { size, margin },
      type: SectionType.NEXT_PAGE,
    },
    headers: headerPart ? { default: headerPart } : undefined,
    footers: footerPart ? { default: footerPart } : undefined,
    children: children.length > 0 ? children : [new Paragraph('')],
  };
}

/** Punto de entrada único del pipeline cliente: `ReportDocument` (el mismo
 * JSON del lienzo) + activos raster ya resueltos -> `.docx` real (OOXML).
 * Sin red, sin backend -- pura función de datos a `Blob`. */
/** Tamaño máximo por propiedad personalizada (`docProps/custom.xml`) — sin
 * límite estricto en la especificación OOXML, pero se trocea de todos modos
 * para no depender de que cada implementación (Word, LibreOffice, futuros
 * parsers) acepte un string arbitrariamente largo en un solo valor. */
const SOURCE_JSON_CHUNK_SIZE = 30000;

/** Embebe el `ReportDocument` JSON original completo como propiedades
 * personalizadas del paquete (`Beemetry_SourceDocument_N` + `_Count`) — sin
 * comprimir (evita sumar una dependencia solo para esto). Deja el terreno
 * listo para una futura reimportación exacta del .docx al lienzo: si el
 * usuario no tocó nada fuera de Word, se reconstruye el documento original
 * byte a byte desde aquí en vez de tener que parsear el OOXML editado. */
function sourceDocumentCustomProperties(doc: ReportDocument): { name: string; value: string }[] {
  try {
    const json = JSON.stringify(doc);
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += SOURCE_JSON_CHUNK_SIZE) chunks.push(json.slice(i, i + SOURCE_JSON_CHUNK_SIZE));
    return [
      { name: 'Beemetry_SourceDocument_Count', value: String(chunks.length) },
      ...chunks.map((chunk, i) => ({ name: `Beemetry_SourceDocument_${i + 1}`, value: chunk })),
    ];
  } catch {
    return [];
  }
}

export async function buildReportDocx(doc: ReportDocument, opts: BuildReportDocxOptions): Promise<Blob> {
  const resolveRef = (targetId: string): string | undefined =>
    resolveHeadingRefLabel(doc, targetId) ?? resolveAnnexRefLabel(doc, targetId);

  const sections = doc.pages.map((page) => buildPageSection(doc, page, opts.session, opts, resolveRef));

  const document = new Document({
    creator: 'Beemetry Mining Platform',
    title: doc.meta?.title || 'Informe Técnico',
    customProperties: sourceDocumentCustomProperties(doc),
    // Sin esto, el campo TOC (y los campos PAGE/NUMPAGES del pie de página)
    // se abren "vacíos" hasta que el usuario hace clic derecho -> Actualizar
    // campo (o F9) -- Word solo los recalcula al abrir si el documento pide
    // explícitamente "actualizar campos al abrir".
    features: { updateFields: true },
    sections,
  });

  return Packer.toBlob(document);
}
