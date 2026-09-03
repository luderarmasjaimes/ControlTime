import { ExternalHyperlink, TextRun } from 'docx';
import { cssColorToHex, firstFontFamily, pxFontToHalfPt } from './docxUnits';

const lineBreak = (): TextRun => new TextRun({ text: '', break: 1 });

/**
 * Convierte el HTML saneado de una celda de tabla (`TableBlock.tsx`,
 * whitelist de `sanitizeHtml.ts`: B/STRONG/I/EM/U/S/STRIKE/SUB/SUP/SPAN/DIV/
 * P/BR/FONT/A/UL/OL/LI/SMALL/MARK/CODE) a una lista plana de `ParagraphChild`
 * para insertarla dentro de un único párrafo de Word. `<a href>` se
 * reproduce como hipervínculo NATIVO real (`ExternalHyperlink`, Ctrl+clic
 * navega de verdad), no solo como texto azul subrayado.
 *
 * Deliberadamente NO reproduce viñetas numeradas nativas de Word para
 * `<ul>`/`<ol>` — dentro de una celda de tabla ya absolutamente posicionada
 * el beneficio es marginal frente a la complejidad de reestructurar
 * `TableCell.children` en varios párrafos; se conserva el texto y su
 * estilo visual ("• "/"1. " por línea) en vez de omitirlo.
 */

interface RunStyle {
  bold: boolean;
  italics: boolean;
  underline: boolean;
  strike: boolean;
  superScript: boolean;
  subScript: boolean;
  color?: string;
  font?: string;
  sizeHalfPt: number;
  highlight?: string;
}

export interface HtmlCellBaseStyle {
  fontSizePx?: number;
  color?: string;
  bold?: boolean;
}

const BASE_STYLE = (base: HtmlCellBaseStyle): RunStyle => ({
  bold: !!base.bold,
  italics: false,
  underline: false,
  strike: false,
  superScript: false,
  subScript: false,
  color: base.color ? cssColorToHex(base.color) : undefined,
  sizeHalfPt: pxFontToHalfPt(base.fontSizePx),
});

function parseInlineStyle(styleAttr: string | null, style: RunStyle): RunStyle {
  if (!styleAttr) return style;
  const next = { ...style };
  styleAttr.split(';').forEach((decl) => {
    const [rawProp, rawVal] = decl.split(':');
    if (!rawProp || !rawVal) return;
    const prop = rawProp.trim().toLowerCase();
    const val = rawVal.trim();
    if (prop === 'color') next.color = cssColorToHex(val, next.color || '000000');
    else if (prop === 'font-weight' && (val === 'bold' || Number(val) >= 600)) next.bold = true;
    else if (prop === 'font-style' && val === 'italic') next.italics = true;
    else if (prop === 'text-decoration' && /underline/.test(val)) next.underline = true;
    else if (prop === 'text-decoration' && /line-through/.test(val)) next.strike = true;
    else if (prop === 'font-family') next.font = firstFontFamily(val, next.font);
    else if (prop === 'font-size') {
      const px = parseFloat(val);
      if (!Number.isNaN(px)) next.sizeHalfPt = pxFontToHalfPt(val.includes('pt') ? px * (96 / 72) : px);
    } else if (prop === 'background-color' && val.toLowerCase() !== 'transparent') {
      next.highlight = 'yellow';
    }
  });
  return next;
}

const HIGHLIGHT_COLORS = new Set([
  'black', 'blue', 'cyan', 'darkBlue', 'darkCyan', 'darkGray', 'darkGreen', 'darkMagenta',
  'darkRed', 'darkYellow', 'green', 'lightGray', 'magenta', 'none', 'red', 'white', 'yellow',
]);

function styleForTag(tag: string, attrs: Record<string, string>, style: RunStyle): RunStyle {
  const next = { ...style };
  switch (tag) {
    case 'B': case 'STRONG': next.bold = true; break;
    case 'I': case 'EM': next.italics = true; break;
    case 'U': next.underline = true; break;
    case 'S': case 'STRIKE': next.strike = true; break;
    case 'SUP': next.superScript = true; break;
    case 'SUB': next.subScript = true; break;
    case 'SMALL': next.sizeHalfPt = Math.max(2, Math.round(next.sizeHalfPt * 0.8)); break;
    case 'MARK': next.highlight = 'yellow'; break;
    case 'CODE': next.font = 'Courier New'; break;
    case 'A':
      next.underline = true;
      next.color = next.color || '1D4ED8';
      break;
    case 'FONT':
      if (attrs.color) next.color = cssColorToHex(attrs.color, next.color || '000000');
      if (attrs.face) next.font = firstFontFamily(attrs.face, next.font);
      break;
    default: break;
  }
  return parseInlineStyle(attrs.style || null, next);
}

function attrsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) out[attr.name.toLowerCase()] = attr.value;
  return out;
}

function makeRun(text: string, style: RunStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold || undefined,
    italics: style.italics || undefined,
    underline: style.underline ? {} : undefined,
    strike: style.strike || undefined,
    superScript: style.superScript || undefined,
    subScript: style.subScript || undefined,
    color: style.color,
    font: style.font,
    size: style.sizeHalfPt,
    highlight: style.highlight && HIGHLIGHT_COLORS.has(style.highlight) ? (style.highlight as any) : undefined,
  });
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI']);
/** Solo estos esquemas se dejan navegar de verdad -- `sanitizeHtml.ts` ya
 * filtra `javascript:`/`vbscript:`/etc. al guardar, pero un hipervínculo
 * NATIVO de Word (a diferencia del texto azul subrayado de antes) sí puede
 * navegarse con Ctrl+clic, así que esta es una segunda barrera deliberada
 * en el punto exacto donde el link se vuelve "clicable de verdad". */
const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;

type CellChild = TextRun | ExternalHyperlink;

function walk(node: Node, style: RunStyle, listPrefix: string | null, out: CellChild[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    if (text) out.push(makeRun((listPrefix ? listPrefix : '') + text, style));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (tag === 'BR') {
    out.push(lineBreak());
    return;
  }
  if (tag === 'UL' || tag === 'OL') {
    let index = 1;
    Array.from(el.children).forEach((child) => {
      if (child.tagName.toUpperCase() !== 'LI') return;
      if (out.length > 0) out.push(lineBreak());
      const prefix = tag === 'OL' ? `${index}. ` : '• ';
      index += 1;
      const childStyle = styleForTag(child.tagName.toUpperCase(), attrsOf(child), style);
      Array.from(child.childNodes).forEach((grandchild, i) =>
        walk(grandchild, childStyle, i === 0 ? prefix : null, out));
    });
    return;
  }
  if (tag === 'A') {
    const href = attrsOf(el).href || '';
    const nextStyle = styleForTag(tag, attrsOf(el), style);
    if (SAFE_LINK_SCHEME.test(href.trim())) {
      const linkRuns: TextRun[] = [];
      Array.from(el.childNodes).forEach((child) => walk(child, nextStyle, null, linkRuns as CellChild[]));
      if (linkRuns.length > 0) out.push(new ExternalHyperlink({ link: href.trim(), children: linkRuns }));
      return;
    }
    // Sin esquema seguro (o sin href) -- se conserva como texto con el
    // mismo estilo visual, pero SIN convertirlo en un enlace navegable.
    Array.from(el.childNodes).forEach((child) => walk(child, nextStyle, null, out));
    return;
  }

  const nextStyle = styleForTag(tag, attrsOf(el), style);
  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock && out.length > 0) out.push(lineBreak());
  Array.from(el.childNodes).forEach((child) => walk(child, nextStyle, null, out));
}

/**
 * `sanitizedHtml`: HTML ya saneado (mismo valor que se guarda/renderiza en
 * `TableBlock.tsx`). `base`: estilo por defecto de la celda (tamaño de la
 * tabla, y color/negrita si es una celda de cabecera — `headerTextColor`/
 * `headerBold`) cuando el HTML no especifica uno propio (las etiquetas
 * dentro del HTML, ej. `<b>`, siguen ganando sobre este default).
 */
export function htmlCellToRuns(sanitizedHtml: string, base: HtmlCellBaseStyle): CellChild[] {
  const html = String(sanitizedHtml || '').trim();
  const baseStyle = BASE_STYLE(base);
  if (!html) return [new TextRun({ text: '', size: baseStyle.sizeHalfPt, color: baseStyle.color, bold: baseStyle.bold || undefined })];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return [new TextRun({ text: html, size: baseStyle.sizeHalfPt, color: baseStyle.color, bold: baseStyle.bold || undefined })];
  const out: CellChild[] = [];
  Array.from(root.childNodes).forEach((child) => walk(child, baseStyle, null, out));
  return out.length > 0 ? out : [new TextRun({ text: '', size: baseStyle.sizeHalfPt })];
}
