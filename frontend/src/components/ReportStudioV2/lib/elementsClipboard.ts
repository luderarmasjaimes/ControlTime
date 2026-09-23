import type { ReportElement, ClipboardPageGroup } from '../store/useEditorStore';
import { defaultPropsByType, defaultBorderByType } from '../store/useEditorStore';
import { getSession } from '../../../auth/authStorage';
import { escapeHtml } from './tableClipboard';
import { buildStyledSegments, sanitizeSpans, styleToCss, type BaseTextStyle } from './textSpans';

export type { ClipboardPageGroup };

/**
 * Serializa varios elementos del lienzo (texto/tabla/imagen/…) a HTML real
 * para el portapapeles del SISTEMA -- pedido explícito 2026-09-09: que
 * Ctrl+A + Ctrl+C + Ctrl+V funcione tanto dentro del editor como pegando en
 * Word/Google Docs, con imágenes y tablas incluidas (no solo texto plano).
 *
 * El HTML producido lleva DOS capas:
 *  1) Un comentario HTML inicial con los elementos originales completos en
 *     JSON (`MARKER_PREFIX` + base64) -- invisible al pegar en Word/Docs,
 *     pero permite reconstruir el/los elemento(s) EXACTOS (spans de texto,
 *     fórmulas de tabla, binding de sensor/KPI, etc.) al pegar de vuelta
 *     DENTRO de este editor, sin pasar por los parsers genéricos de tabla/
 *     imagen (ver extractInternalElementsFromHtml + PageCanvas.tsx::onSystemPaste).
 *  2) Markup visual real (<p>/<span> con estilo, <table>, <img>) para que el
 *     pegado en una app externa se vea razonablemente fiel -- esa capa es la
 *     única que Word/Docs/cualquier otra app ve.
 *
 * Los bloques con datos EN VIVO (sensor/KPI/gráfico/mapa) no tienen un valor
 * estático real que copiar sin inventar un número -- ver la conversación que
 * motivó esto: el sistema nunca compone datos de sensor por su cuenta, así
 * que la capa visual para esos bloques es una nota, nunca un valor de
 * relleno. La capa (1) sí preserva el bloque completo (binding incluido)
 * para el pegado interno -- MISMO AUTOR y CON el informe destino editable
 * (ver `ownerUserId` abajo y ADR-051, actualización 2026-09-11): pegar un
 * informe propio ya en edición debe reconstruir el widget vivo tal cual
 * estaba. Si el pegado cruza de usuario (otro autor copió el contenido) el
 * llamador (`PageCanvas.tsx::onSystemPaste`) degrada esos bloques con
 * `stripLiveBindingForCrossUserPaste` antes de reconstruirlos -- mismo
 * criterio de "nunca inventar un valor" que ya aplica a Word/Docs, ahora
 * también entre informes de autores distintos dentro de Beemetry.
 */

const MARKER_PREFIX = 'beemetry-elements-v2:';

const LIVE_DATA_TYPES = new Set(['sensor', 'kpi', 'sensor_multi_chart', 'chart']);
const CHROME_TYPES = new Set(['header', 'footer', 'cover']);

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function cssString(style: Record<string, string | number | undefined>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
    .join(';');
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function textElementToHtml(el: ReportElement): string {
  const props = el.props || {};
  const text = String(props.text ?? '');
  const base: BaseTextStyle = {
    bold: !!props.bold,
    italic: !!props.italic,
    underline: !!props.underline,
    strikethrough: false,
    color: props.fontColor || '#1a1a1a',
    fontSize: Number(props.fontSize) || 14,
    fontFamily: props.fontFamily || 'Inter',
    highlightColor: props.highlightColor || 'transparent',
    headingStyle: props.headingStyle || '',
    textAlign: props.textAlign || 'left',
  };
  const spans = sanitizeSpans(props.spans, text.length);
  const segments = buildStyledSegments(text, spans, base);
  const paraStyle = cssString({
    margin: '0 0 8px',
    textAlign: props.textAlign || 'left',
    lineHeight: Number(props.lineHeight) || 1.35,
  });

  const paragraphs: string[] = [];
  let currentRuns: string[] = [];
  const flushParagraph = () => {
    paragraphs.push(`<p style="${paraStyle}">${currentRuns.join('') || '<br>'}</p>`);
    currentRuns = [];
  };
  for (const seg of segments) {
    const runStyle = cssString({ ...styleToCss(seg.style) });
    const lines = seg.text.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) flushParagraph();
      if (line) currentRuns.push(`<span style="${runStyle}">${escapeHtml(line)}</span>`);
    });
  }
  flushParagraph();
  return paragraphs.join('');
}

function tableElementToHtml(el: ReportElement): string {
  const props = el.props || {};
  const rows: string[][] = Array.isArray(props.rows) ? props.rows : [];
  const merged: Array<{ row: number; column: number; rowSpan: number; colSpan: number }> =
    Array.isArray(props.mergedCells) ? props.mergedCells : [];
  const cellBackgrounds: (string | undefined)[][] = Array.isArray(props.cellBackgrounds) ? props.cellBackgrounds : [];
  const cellAligns: (string | undefined)[][] = Array.isArray(props.cellAligns) ? props.cellAligns : [];

  const covered = new Set<string>();
  const anchorSpanAt = new Map<string, { rowSpan: number; colSpan: number }>();
  for (const m of merged) {
    anchorSpanAt.set(`${m.row}:${m.column}`, { rowSpan: m.rowSpan, colSpan: m.colSpan });
    for (let r = m.row; r < m.row + m.rowSpan; r += 1) {
      for (let c = m.column; c < m.column + m.colSpan; c += 1) {
        if (r === m.row && c === m.column) continue;
        covered.add(`${r}:${c}`);
      }
    }
  }

  const cellPadding = Number(props.cellPadding) || 6;
  const trs = rows.map((row, r) => {
    const isHeaderRow = !!props.hasHeader && r === 0;
    const tds = row.map((value, c) => {
      const key = `${r}:${c}`;
      if (covered.has(key)) return '';
      const span = anchorSpanAt.get(key);
      const tag = isHeaderRow ? 'th' : 'td';
      const bg = cellBackgrounds[r]?.[c];
      const align = cellAligns[r]?.[c] || props.cellAlign || 'left';
      const style = cssString({
        border: '1px solid #ccc',
        padding: `${cellPadding}px`,
        textAlign: align,
        fontWeight: isHeaderRow ? (props.headerBold === false ? 400 : 700) : 400,
        ...(bg ? { backgroundColor: bg } : {}),
        ...(isHeaderRow && props.headerBg ? { backgroundColor: props.headerBg } : {}),
        ...(isHeaderRow && props.headerTextColor ? { color: props.headerTextColor } : {}),
      });
      const rowSpanAttr = span && span.rowSpan > 1 ? ` rowspan="${span.rowSpan}"` : '';
      const colSpanAttr = span && span.colSpan > 1 ? ` colspan="${span.colSpan}"` : '';
      return `<${tag}${rowSpanAttr}${colSpanAttr} style="${style}">${escapeHtml(value ?? '')}</${tag}>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');

  const tableStyle = cssString({
    borderCollapse: 'collapse',
    width: '100%',
    fontFamily: props.fontFamily || 'Inter',
    fontSize: `${Number(props.fontSize) || 12}px`,
    color: props.textColor || undefined,
  });
  return `<table style="${tableStyle}"><tbody>${trs}</tbody></table>`;
}

function imageElementToHtml(el: ReportElement): string {
  if (!el.src) return '';
  return `<img src="${escapeAttr(el.src)}" style="max-width:100%;display:block;" />`;
}

/** Nota visible SOLO en la capa externa (Word/Docs/etc.) -- el bloque real
 * (con su binding de sensor/KPI/etc.) sí se preserva en el marcador interno,
 * ver cabecera del archivo. */
function liveDataPlaceholderHtml(el: ReportElement): string {
  const label = el.props?.title || el.type;
  return `<p style="margin:0 0 8px;color:#64748b;font-style:italic;">[${escapeHtml(String(label))} -- datos en vivo, no disponibles fuera de Beemetry]</p>`;
}

function elementToVisualHtml(el: ReportElement): string {
  if (CHROME_TYPES.has(el.type)) return '';
  if (el.type === 'text') return textElementToHtml(el);
  if (el.type === 'table') return tableElementToHtml(el);
  if (el.type === 'image') return imageElementToHtml(el);
  if (LIVE_DATA_TYPES.has(el.type)) return liveDataPlaceholderHtml(el);
  return '';
}

function elementToPlainText(el: ReportElement): string {
  if (el.type === 'text') return String(el.props?.text ?? '');
  if (el.type === 'table') {
    const rows: string[][] = Array.isArray(el.props?.rows) ? el.props.rows : [];
    return rows.map((row) => row.join('\t')).join('\n');
  }
  if (el.type === 'image') return '[Imagen]';
  if (LIVE_DATA_TYPES.has(el.type)) return `[${el.props?.title || el.type} -- datos en vivo]`;
  return '';
}

export interface InternalClipboardPayload {
  /** `userId` de quien copió (ver authStorage.ts::getSession) -- null si no
   * había sesión activa al copiar (no debería ocurrir, este módulo solo se
   * usa autenticado). Permite a `onSystemPaste` distinguir "pego mi propio
   * contenido" de "pego contenido de otro autor" (ADR-051, actualización
   * 2026-09-11). */
  ownerUserId: string | null;
  groups: ClipboardPageGroup[];
}

export function serializeElementsForClipboard(groups: ClipboardPageGroup[]): { html: string; text: string } {
  // La capa visual (Word/Docs/lo que sea) no distingue páginas -- se lee en
  // orden de página y, dentro de cada una, de arriba hacia abajo/izquierda.
  const orderedGroups = groups.slice().sort((a, b) => a.pageOffset - b.pageOffset);
  const orderedElements = orderedGroups.flatMap((g) => g.elements.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x)));
  const visual = orderedElements.map(elementToVisualHtml).filter(Boolean).join('') || '<p></p>';
  const payload: InternalClipboardPayload = { ownerUserId: getSession()?.userId ?? null, groups };
  const marker = `<!--${MARKER_PREFIX}${utf8ToBase64(JSON.stringify(payload))}-->`;
  const text = orderedElements.map(elementToPlainText).filter(Boolean).join('\n\n');
  return { html: marker + visual, text };
}

/** Recupera los grupos de página ORIGINALES (completos) de un HTML producido
 * por `serializeElementsForClipboard` en ESTA misma app -- null si el HTML
 * viene de otra fuente (Word, Google Docs, otra pestaña) o está corrupto. */
export function extractInternalElementsFromHtml(html: string): InternalClipboardPayload | null {
  const match = html.match(new RegExp(`<!--${MARKER_PREFIX}([A-Za-z0-9+/=]+)-->`));
  if (!match) return null;
  try {
    const parsed = JSON.parse(base64ToUtf8(match[1]));
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.groups)) {
      return {
        ownerUserId: typeof parsed.ownerUserId === 'string' ? parsed.ownerUserId : null,
        groups: parsed.groups,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Degrada los bloques de datos EN VIVO (sensor/KPI/gráfico) a una nota de
 * texto estática, sin binding -- mismo criterio y mismo texto que la capa
 * visual externa (`liveDataPlaceholderHtml`, para Word/Docs). Se aplica al
 * reconstruir el marcador interno cuando quien pega NO es quien copió
 * (`ownerUserId` no coincide con la sesión actual) -- ver
 * `PageCanvas.tsx::onSystemPaste` y ADR-051 (actualización 2026-09-11):
 * un sensor/KPI de un informe ajeno no debe llegar "vivo" (jalando
 * telemetría real) al informe de otro autor sin que nadie lo pida
 * explícitamente -- mismo trato que ya recibía al copiar hacia Word/Excel/
 * PowerPoint.
 */
export function stripLiveBindingForCrossUserPaste(groups: ClipboardPageGroup[]): ClipboardPageGroup[] {
  return groups.map((group) => ({
    ...group,
    elements: group.elements.map((el): ReportElement => {
      if (!LIVE_DATA_TYPES.has(el.type)) return el;
      const label = String(el.props?.title || el.type);
      return {
        id: el.id,
        type: 'text',
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        zIndex: el.zIndex,
        locked: el.locked,
        props: { ...defaultPropsByType('text'), text: `[${label} — datos en vivo, no disponibles fuera del informe de origen]` },
        border: defaultBorderByType('text'),
      };
    }),
  }));
}
