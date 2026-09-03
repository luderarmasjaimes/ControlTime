import {
  AlignmentType, Document, Footer, FrameAnchorType, FrameWrap, Header, HeadingLevel,
  ImageRun, OverlapType, PageNumber, PageOrientation, Packer, Paragraph, SectionType,
  ShadingType, Table, TableAnchorType, TableCell, TableOfContents, TableRow, TabStopType,
  TextRun, WidthType, BorderStyle,
  type IFrameOptions, type ISectionOptions, type FileChild,
} from 'docx';
import type { ReportDocument, ReportElement, ReportPage, DocumentMeta } from '../../store/useEditorStore';
import { resolvePagePaperSetup } from '../../store/useEditorStore';
import { resolveHeadingRefLabel } from '../../components/document/TableOfContents';
import { getReportLayoutMetrics } from '../reportLayoutMetrics';
import { HEADING_STYLES, findHeadingStyle } from '../headingStyles';
import { sanitizeSpans, buildStyledSegments, type BaseTextStyle, type StyledSegment } from '../textSpans';
import { findCoverTemplate } from '../coverTemplates';
import { resolveMiningUnitName } from '../sessionChrome';
import { htmlCellToRuns } from './htmlCellToRuns';
import { cssColorToHex, firstFontFamily, pxFontToHalfPt, pxToTwip } from './docxUnits';

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
function segmentsToRuns(segments: StyledSegment[]): TextRun[] {
  const out: TextRun[] = [];
  let pendingBreaks = 0;
  segments.forEach((seg) => {
    const lines = seg.text.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) pendingBreaks += 1;
      if (line.length === 0) return;
      out.push(new TextRun({
        text: line,
        break: pendingBreaks || undefined,
        bold: seg.style.bold || undefined,
        italics: seg.style.italic || undefined,
        underline: seg.style.underline ? {} : undefined,
        color: cssColorToHex(seg.style.color, '0F172A'),
        font: firstFontFamily(seg.style.fontFamily),
        size: pxFontToHalfPt(seg.style.fontSize),
        highlight: highlightFromColor(seg.style.highlightColor) as any,
      }));
      pendingBreaks = 0;
    });
  });
  if (pendingBreaks > 0) out.push(new TextRun({ text: '', break: pendingBreaks }));
  return out.length > 0 ? out : [new TextRun({ text: '' })];
}

function buildTextElement(el: ReportElement, resolveRef: (targetId: string) => string | undefined): Paragraph {
  const props = el.props || {};
  const text = String(props.text || '');
  const base: BaseTextStyle = {
    bold: !!props.bold,
    italic: !!props.italic,
    underline: !!props.underline,
    color: props.fontColor || '#0f172a',
    fontSize: props.fontSize || 14,
    fontFamily: props.fontFamily || 'Arial',
    highlightColor: props.highlightColor || 'transparent',
    headingStyle: props.headingStyle,
  };
  const spans = sanitizeSpans(props.spans, text.length);
  const segments = buildStyledSegments(text, spans, base, resolveRef);
  // Encabezado de TODO el bloque (botón del ribbon) -> nivel real de Word
  // (aparece en el Panel de navegación y en el escaneo de un TOC nativo).
  // Encabezados aplicados solo a una PORCIÓN vía spans conservan su tamaño/
  // color/negrita visual (ya vienen en `segments[].style`) pero no fuerzan
  // el nivel de párrafo completo -- ver nota sobre TOC estático más abajo.
  const wholeBlockLevel = props.headingStyle ? HEADING_LEVEL_BY_STYLE[props.headingStyle] : undefined;
  return new Paragraph({
    frame: elementFrame(el),
    heading: wholeBlockLevel,
    alignment: alignmentFromCss(props.textAlign),
    children: segmentsToRuns(segments),
  });
}

function buildTableElement(el: ReportElement): Table {
  const props = el.props || {};
  const rows: unknown[][] = Array.isArray(props.rows) ? props.rows : [];
  if (rows.length === 0) return new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] })] });
  const hasHeader = props.hasHeader !== false;
  const fontSize = Number(props.fontSize) || 14;
  const cellPaddingTwip = pxToTwip(Number(props.cellPadding) || 10);
  const colCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  const totalWidthTwip = pxToTwip(el.width);
  const providedWidths: number[] = Array.isArray(props.colWidths) ? props.colWidths : [];
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    providedWidths[i] ? pxToTwip(providedWidths[i]) : Math.round(totalWidthTwip / colCount));
  const borderColor = cssColorToHex(props.borderColor, 'E2E8F0');
  const borderWidthPx = Number(props.borderWidth) || 1;
  const borderStyleWord = props.borderStyle === 'dashed' ? BorderStyle.DASHED
    : props.borderStyle === 'dotted' ? BorderStyle.DOTTED
    : props.borderStyle === 'none' ? BorderStyle.NONE
    : BorderStyle.SINGLE;
  const cellBorder = { style: borderStyleWord, size: Math.max(2, borderWidthPx * 4), color: borderColor };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const align = props.cellAlign === 'center' ? AlignmentType.CENTER : props.cellAlign === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;

  const tableRows = rows.map((row, ri) => {
    const isHeaderRow = ri === 0 && hasHeader;
    const isBanded = !isHeaderRow && props.bandedRows && ri % 2 === (hasHeader ? 1 : 0);
    const shading = isHeaderRow
      ? { type: ShadingType.CLEAR, color: 'auto', fill: cssColorToHex(props.headerBg, 'F8FAFC') }
      : isBanded
        ? { type: ShadingType.CLEAR, color: 'auto', fill: cssColorToHex(props.bandColor, 'F1F5F9') }
        : undefined;
    const cells = Array.from({ length: colCount }, (_, ci) => {
      const raw = Array.isArray(row) ? row[ci] : '';
      const runs = htmlCellToRuns(String(raw ?? ''), {
        fontSizePx: fontSize,
        color: isHeaderRow ? (props.headerTextColor || '#1e293b') : undefined,
        bold: isHeaderRow ? props.headerBold !== false : false,
      });
      return new TableCell({
        width: { size: colWidths[ci], type: WidthType.DXA },
        shading,
        borders: cellBorders,
        margins: { top: cellPaddingTwip, bottom: cellPaddingTwip, left: cellPaddingTwip, right: cellPaddingTwip },
        children: [new Paragraph({ alignment: align, children: runs })],
      });
    });
    return new TableRow({ tableHeader: isHeaderRow, children: cells });
  });

  return new Table({
    rows: tableRows,
    width: { size: totalWidthTwip, type: WidthType.DXA },
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

/**
 * Índice NATIVO de Word: un campo `TOC` real (`{ TOC \o "1-6" \h \z \u }`),
 * NO una lista estática de párrafos como la versión anterior de este
 * builder. Diferencia práctica: esta versión SÍ es lo que un usuario espera
 * de "el índice no funciona" -- entradas con hipervínculo real (Ctrl+clic
 * salta al encabezado), y se recalcula sola con clic derecho → "Actualizar
 * campo" (o automáticamente al abrir, ver `features.updateFields` en
 * `buildReportDocx()`) si el usuario reordena o edita títulos en Word.
 * Escanea los párrafos con estilo `HeadingN` reales que ya emite
 * `buildTextElement()` para encabezados de bloque completo -- funciona
 * porque viven en flujo normal de Word en esta página (ver `pageHasToc`),
 * no dentro de un frame absoluto (un campo TOC no puede anclarse a un
 * frame: `TableOfContents` no es un `Paragraph`, no tiene la propiedad
 * `frame`). Los encabezados aplicados solo a una PORCIÓN de texto (spans)
 * no generan un párrafo `HeadingN` propio y por lo tanto no aparecen en
 * este campo -- limitación conocida, documentada en el reporte de
 * verificación (afecta un caso de uso secundario/avanzado, no el flujo
 * principal del ribbon "Título/H1/H2/H3"). */
function buildTocSectionChildren(el: ReportElement): FileChild[] {
  const props = el.props || {};
  const titleText = String(props.title || 'Tabla de Contenidos') + (typeof props.tocContinuationIndex === 'number' ? ' (continuación)' : '');
  const titlePara = new Paragraph({
    children: [new TextRun({ text: titleText, bold: true, size: pxFontToHalfPt(18) })],
    spacing: { after: 200 },
  });
  const toc = new TableOfContents('Índice', {
    hyperlink: true,
    headingStyleRange: '1-6',
  });
  return [titlePara, toc];
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
        children.push(buildTextElement(el, resolveRef));
        break;
      case 'table':
        children.push(buildTableElement(el));
        break;
      case 'image': {
        const png = opts.imageAssets.get(el.id);
        if (png) children.push(buildImageParagraph(el, png));
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
      case 'toc':
        // El campo TOC nativo (no un Paragraph con `frame`) se agrega
        // directo a `children` en flujo normal -- ver `isTocPage` abajo,
        // que además cambia los márgenes de TODA la sección para que ese
        // flujo se vea correcto (el editor garantiza que un bloque `toc`
        // nunca comparte página con otro contenido).
        children.push(...buildTocSectionChildren(el));
        break;
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
  const resolveRef = (targetId: string): string | undefined => resolveHeadingRefLabel(doc, targetId);

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
