/**
 * Convierte el contenido del portapapeles (Word, Google Docs, o cualquier
 * fuente que ponga HTML real junto al texto plano) a `{text, spans}` -- el
 * mismo modelo de texto+spans de `lib/textSpans.ts` que usan los bloques de
 * texto de esta app. Pensado para pegar DOCUMENTOS enteros (varios párrafos,
 * títulos, listas), no solo una palabra suelta con negrita.
 *
 * Reutiliza deliberadamente las convenciones PROPIAS de la app en vez de
 * tratar de clonar el HTML de origen al pixel:
 *  - Listas (`<ul>/<ol>`) se convierten al esquema de sangría por TAB +
 *    marcador (`lib/listFormatting.ts`, SCRUM-31) para que una lista pegada
 *    se comporte igual que una creada a mano (Tab/Shift+Tab, Enter para
 *    continuar, etc.) -- no se preserva el estilo de viñeta exacto del
 *    origen (p.ej. Word podría traer un guión "-" en vez de un punto), en la
 *    medida en que igual queda claro qué es una lista y en qué nivel.
 *  - Encabezados (`<h1>`-`<h6>`) usan el tamaño/color/peso de
 *    `HEADING_STYLES` (los mismos "Estilos rápidos" del ribbon) en vez del
 *    tamaño de fuente que traiga el HTML de origen -- mantiene el documento
 *    pegado visualmente consistente con el resto del informe, y hace que la
 *    Tabla de Contenidos los detecte igual que un encabezado creado a mano.
 *  - Negrita/cursiva/subrayado/color/tamaño/familia de fuente/resaltado SÍ
 *    se preservan del origen tal cual, corrida por corrida de texto.
 */

import { sanitizeRichHtml } from './sanitizeHtml';
import type { TextStyleSpan } from './textSpans';
import { applyListToText } from './listFormatting';
import { findHeadingStyle } from './headingStyles';
import { parseHtmlClipboardTable, type ParsedClipboardGrid } from './tableClipboard';

export interface RichPasteResult {
  text: string;
  spans: TextStyleSpan[];
}

interface WalkStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  highlightColor?: string;
  headingStyle?: string;
  /** Hipervínculo activo en este tramo del recorrido -- `styleForTag` lo fija
   * al entrar a un `<a href>` válido; como `walkNode`/`walkNodeForBlocks`
   * recorren el DOM real (no un stream de tokens abre/cierra), el valor se
   * propaga naturalmente SOLO a los descendientes de ESE `<a>` y desaparece
   * solo al volver a subir en la recursión -- mismo mecanismo que ya usan
   * bold/italic/color, sin necesidad de "limpiarlo" a mano en ningún lado. */
  href?: string;
}

const BASE_WALK_STYLE: WalkStyle = { bold: false, italic: false, underline: false, strikethrough: false };

function parseInlineStyle(styleAttr: string | null | undefined, style: WalkStyle): WalkStyle {
  if (!styleAttr) return style;
  const next = { ...style };
  styleAttr.split(';').forEach((decl) => {
    const sep = decl.indexOf(':');
    if (sep < 0) return;
    const prop = decl.slice(0, sep).trim().toLowerCase();
    const val = decl.slice(sep + 1).trim();
    if (!prop || !val) return;
    if (prop === 'color') next.color = val;
    else if (prop === 'background-color' && val.toLowerCase() !== 'transparent') next.highlightColor = val;
    else if (prop === 'font-weight') next.bold = val === 'bold' || Number(val) >= 600;
    else if (prop === 'font-style') next.italic = val === 'italic';
    // `text-decoration` es shorthand -- puede traer 'underline', 'line-through'
    // o ambos juntos separados por espacio (CSS real, y lo que emite
    // `styleToCss`/textSpans.ts al copiar un bloque con las dos activas vía
    // el portapapeles interno de esta misma app, ver elementsClipboard.ts).
    else if (prop === 'text-decoration') { next.underline = /underline/.test(val); next.strikethrough = /line-through/.test(val); }
    else if (prop === 'font-family') {
      const first = val.split(',')[0]?.replace(/^["']|["']$/g, '').trim();
      if (first) next.fontFamily = first;
    } else if (prop === 'font-size') {
      const num = parseFloat(val);
      if (!Number.isNaN(num)) next.fontSize = Math.round(val.includes('pt') ? num * (96 / 72) : num);
    }
  });
  return next;
}

/** Convierte una longitud CSS (px/pt/in/cm/mm, con o sin unidad) a píxeles
 * CSS -- mismo criterio de conversión que ya usa `parseInlineStyle` para
 * `font-size` (pt * 96/72), extendido a las demás unidades que Word/Google
 * Docs suelen usar para sangría (`margin-left`/`text-indent` en pulgadas o
 * centímetros son comunes en HTML exportado desde Word). */
function parseCssLength(raw: string): number | null {
  const match = /^(-?[\d.]+)\s*(px|pt|in|cm|mm)?$/i.exec(raw.trim());
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (Number.isNaN(num)) return null;
  switch ((match[2] || 'px').toLowerCase()) {
    case 'pt': return num * (96 / 72);
    case 'in': return num * 96;
    case 'cm': return num * (96 / 2.54);
    case 'mm': return num * (96 / 25.4);
    default: return num;
  }
}

export type ParagraphAlign = 'left' | 'center' | 'right' | 'justify';

/** Formato de PÁRRAFO (alineación/sangría) leído de un bloque -- a
 * diferencia de negrita/color/etc. (`WalkStyle`, corrida por corrida de
 * texto), esto aplica al párrafo COMPLETO, así que se lee una sola vez por
 * bloque de este editor (el primero real que aparezca "gana" -- ver
 * `WalkCtx.paragraphFormat` abajo) en vez de viajar anidado como los estilos
 * de caracter. Pedido explícito 2026-09-09: "que traiga también la
 * disposición del texto... si está centrado, tiene sangría, justificación". */
export interface ParagraphFormat {
  textAlign?: ParagraphAlign;
  indentLeft?: number;
  specialIndent?: 'firstLine' | 'hanging';
  specialIndentBy?: number;
}

function readParagraphFormat(el: Element): ParagraphFormat {
  const format: ParagraphFormat = {};
  const styleAttr = el.getAttribute('style');
  if (styleAttr) {
    styleAttr.split(';').forEach((decl) => {
      const sep = decl.indexOf(':');
      if (sep < 0) return;
      const prop = decl.slice(0, sep).trim().toLowerCase();
      const val = decl.slice(sep + 1).trim();
      if (!prop || !val) return;
      if (prop === 'text-align') {
        const normalized = val.toLowerCase();
        if (normalized === 'left' || normalized === 'center' || normalized === 'right' || normalized === 'justify') {
          format.textAlign = normalized;
        }
      } else if (prop === 'margin-left' || prop === 'padding-left') {
        const px = parseCssLength(val);
        if (px !== null && px > 1) format.indentLeft = Math.round(px);
      } else if (prop === 'text-indent') {
        const px = parseCssLength(val);
        // Un valor chico (< 2px) es ruido de redondeo, no una sangría real.
        if (px !== null && Math.abs(px) >= 2) {
          if (px > 0) { format.specialIndent = 'firstLine'; format.specialIndentBy = Math.round(px); }
          else { format.specialIndent = 'hanging'; format.specialIndentBy = Math.round(-px); }
        }
      }
    });
  }
  // `align="center"` es un atributo HTML legado (no `style`), pero Word
  // todavía lo genera a veces -- solo se usa si `style` no trajo nada.
  if (!format.textAlign) {
    const alignAttr = el.getAttribute('align')?.toLowerCase();
    if (alignAttr === 'left' || alignAttr === 'center' || alignAttr === 'right' || alignAttr === 'justify') {
      format.textAlign = alignAttr;
    }
  }
  // Marcador de alineación de un párrafo importado de un .docx (ver
  // lib/docxPageBreaks.ts::markParagraphAlignment) -- a diferencia del
  // pegado real de Word/Google Docs (que SÍ pone `style="text-align:..."`
  // directo en el `<p>`), mammoth solo puede meter la alineación como un
  // `<span class="docx-align-...">` ANIDADO envolviendo el contenido del
  // párrafo, nunca como atributo del propio elemento -- así que sin este
  // fallback, CUALQUIER párrafo de un .docx importado llegaba acá con
  // `format.textAlign` vacío, sin importar su alineación real. Bug real
  // reportado 2026-09-11, con documento real: eso apagaba por completo el
  // corte-de-bloque-por-cambio-de-alineación de más abajo (nunca hay dos
  // alineaciones DISTINTAS que comparar si esta siempre devuelve vacío),
  // así que un título/leyenda centrado seguido de párrafos normales
  // quedaban fusionados en un solo bloque de texto que heredaba el
  // centrado del primero -- "como esta centrado centra todo el contenido
  // de abajo". `querySelector` encuentra el marcador sin importar cuántos
  // niveles de negrita/cursiva/color lo envuelvan por encima.
  if (!format.textAlign) {
    const alignMarker = el.querySelector('[class*="docx-align-"]');
    const alignClass = alignMarker && Array.from(alignMarker.classList).find((cls) => /^docx-align-(left|center|right|justify)$/.test(cls));
    if (alignClass) {
      format.textAlign = alignClass.replace('docx-align-', '') as ParagraphAlign;
    }
  }
  return format;
}

/** Tamaño MOSTRADO de una imagen en el documento de origen -- atributos
 * `width`/`height` (número plano en px, como los escribe Word) o
 * `style="width:...;height:...;"` (más común en HTML de Google Docs),
 * en ese orden de prioridad. `undefined` si no viene ninguno (el caller
 * decide el respaldo -- medir el archivo real). */
export function readImageSize(el: Element): { width?: number; height?: number } {
  const result: { width?: number; height?: number } = {};
  const widthAttr = el.getAttribute('width');
  const heightAttr = el.getAttribute('height');
  if (widthAttr) {
    const px = parseCssLength(widthAttr);
    if (px && px > 0) result.width = Math.round(px);
  }
  if (heightAttr) {
    const px = parseCssLength(heightAttr);
    if (px && px > 0) result.height = Math.round(px);
  }
  const styleAttr = el.getAttribute('style');
  if (styleAttr) {
    if (result.width === undefined) {
      const m = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(styleAttr);
      if (m) {
        const px = parseCssLength(m[1]);
        if (px && px > 0) result.width = Math.round(px);
      }
    }
    if (result.height === undefined) {
      const m = /(?:^|;)\s*height\s*:\s*([^;]+)/i.exec(styleAttr);
      if (m) {
        const px = parseCssLength(m[1]);
        if (px && px > 0) result.height = Math.round(px);
      }
    }
  }
  return result;
}

function styleForTag(tag: string, style: WalkStyle, el: Element): WalkStyle {
  switch (tag) {
    case 'B': case 'STRONG': return { ...style, bold: true };
    case 'I': case 'EM': return { ...style, italic: true };
    case 'U': return { ...style, underline: true };
    // El color real (`beemetry-highlight-RRGGBB`, ver
    // lib/docxPageBreaks.ts::DOCX_HIGHLIGHT_STYLE_MAP) se resuelve en
    // `styleForDocxSpanMarkers` -- acá solo queda el default para un
    // `<mark>` genuino sin esa clase (pegado real de otra fuente que sí usa
    // `<mark>` en su HTML, sin decir de qué color).
    case 'MARK': return styleForDocxSpanMarkers({ ...style, highlightColor: style.highlightColor || '#fff3a0' }, el);
    // Hasta 2026-09-22 no había ningún campo en TextStyleSpan para esto --
    // el texto se conservaba pero el tachado se descartaba sin más (ver
    // TextStyleSpan.strikethrough).
    case 'S': case 'STRIKE': return { ...style, strikethrough: true };
    case 'A': {
      const href = el.getAttribute('href')?.trim();
      // Mismo whitelist que htmlCellToRuns.ts/reportSharedHelpers.js para
      // el mismo propósito (evitar esquemas `javascript:`/`vbscript:`/etc.
      // en un hipervínculo que sí navega de verdad con Ctrl+clic/clic) --
      // un `href` inválido simplemente no se guarda, el texto del enlace
      // se sigue caminando como texto normal, sin enlace.
      return href && SAFE_LINK_SCHEME.test(href) ? { ...style, href } : style;
    }
    case 'SPAN': return styleForDocxSpanMarkers(style, el);
    default: return style;
  }
}

/** Marcadores sintéticos que mammoth.js produce (vía `transformDocument` +
 * `styleMap`, ver lib/docxPageBreaks.ts::enrichDocxTextStyles) para color de
 * texto directo, resaltado y tamaño de fuente -- propiedades que mammoth
 * lee del .docx (o ni siquiera lee, el caso del color de texto) pero nunca
 * emite en su HTML por su cuenta. No son clases reales de ningún HTML
 * genuino (portapapeles del navegador o de otra fuente) -- reconocerlas
 * acá de forma incondicional (no solo durante import de .docx) es
 * inofensivo, nunca hacen match fuera de un documento pasado por esa
 * función. Se llama tanto para `<span>` (color/tamaño) como para `<mark>`
 * (resaltado, ver `styleForTag` arriba) -- el resaltado real de Word sale
 * como `<mark class="beemetry-highlight-RRGGBB">`, no como `<span>`. */
function styleForDocxSpanMarkers(style: WalkStyle, el: Element): WalkStyle {
  let next = style;
  Array.from(el.classList).forEach((cls) => {
    const colorMatch = /^beemetry-color-([0-9a-f]{6})$/i.exec(cls);
    if (colorMatch) {
      next = { ...next, color: `#${colorMatch[1]}` };
      return;
    }
    const highlightMatch = /^beemetry-highlight-([0-9a-f]{6})$/i.exec(cls);
    if (highlightMatch) {
      next = { ...next, highlightColor: `#${highlightMatch[1]}` };
      return;
    }
    const sizeMatch = /^beemetry-size-([\d.]+)$/.exec(cls);
    if (sizeMatch) {
      const pt = parseFloat(sizeMatch[1]);
      // Mismo criterio pt->px (96/72) que `parseInlineStyle` usa para
      // `font-size` en CSS con unidad `pt` -- `TextStyleSpan.fontSize` se
      // documenta en px en todo el resto de este archivo.
      if (Number.isFinite(pt) && pt > 0) next = { ...next, fontSize: pt * (96 / 72) };
    }
  });
  return next;
}

// Mismo whitelist que ya usa htmlCellToRuns.ts (celdas de tabla) y
// reportSharedHelpers.js (pipeline servidor) para el mismo propósito --
// sanitizeRichHtml ya filtra javascript:/vbscript:/etc. al pegar HTML
// externo, pero un `<a>` que llega acá vía mammoth (import de .docx, sin
// pasar por sanitizeRichHtml -- ver el comentario grande junto a
// parseRichClipboardBlocks) no pasa por ese filtro, así que se revalida acá.
const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;

const HEADING_TAG_TO_ID: Record<string, string> = {
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6',
};
const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

/** Un elemento de bloque "vacío" (sin texto real -- solo whitespace/&nbsp;,
 * el relleno típico de un párrafo espaciador de Word) y sin ninguna tabla ni
 * imagen anidada (esas SÍ importan aunque el elemento no tenga texto). Sirve
 * para decidir si vale la pena caminar sus hijos: uno vacío no aporta nada
 * más que la línea en blanco que ya cuenta `pushLineBreak`. */
function isEmptyLeaf(el: Element): boolean {
  if (/\S/.test(el.textContent || '')) return false;
  return !el.querySelector('table, img');
}

interface WalkCtx {
  parts: string[];
  spans: TextStyleSpan[];
  length: number;
  blankNewlines: number;
  // Formato de párrafo del bloque -- lo fija el PRIMER párrafo con
  // contenido real que aparezca (ver `isBlock` más abajo); los siguientes
  // párrafos del MISMO bloque de este editor no lo pisan. Un bloque puede
  // agrupar varios párrafos de Word (p.ej. una página completa sin salto),
  // así que esto es una simplificación deliberada -- el modelo de esta app
  // solo admite un textAlign/sangría por BLOQUE, no por párrafo.
  paragraphFormat: ParagraphFormat;
}

function newCtx(): WalkCtx {
  return { parts: [], spans: [], length: 0, blankNewlines: 0, paragraphFormat: {} };
}

function pushNewline(ctx: WalkCtx): void {
  ctx.parts.push('\n');
  ctx.length += 1;
}

/** Separador de línea "consciente" de líneas en blanco -- a diferencia de
 * `pushNewline`, tope a como máximo UNA línea en blanco consecutiva
 * (2 saltos de línea seguidos). Word/Google Docs exportan a menudo varios
 * párrafos vacíos seguidos (`<p>&nbsp;</p>`) o varios `<br>` seguidos como
 * "espaciador" visual antes de un título -- sin este tope, cada uno se
 * traducía 1:1 en una línea en blanco real, inflando la altura calculada
 * del bloque muy por encima de su texto visible (bug real reportado:
 * "algunos bloques generan un espaciado exagerado de mas de 5 lineas").
 * `pushText` resetea el contador apenas aparece contenido real. */
function pushLineBreak(ctx: WalkCtx): void {
  if (ctx.length === 0) return;
  if (ctx.blankNewlines >= 2) return;
  pushNewline(ctx);
  ctx.blankNewlines += 1;
}

function pushText(ctx: WalkCtx, text: string, style: WalkStyle): void {
  if (!text) return;
  const start = ctx.length;
  ctx.parts.push(text);
  ctx.length += text.length;
  ctx.spans.push({
    start,
    end: ctx.length,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    strikethrough: style.strikethrough,
    ...(style.color ? { color: style.color } : {}),
    ...(style.fontSize ? { fontSize: style.fontSize } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(style.highlightColor ? { highlightColor: style.highlightColor } : {}),
    ...(style.headingStyle ? { headingStyle: style.headingStyle } : {}),
    ...(style.href ? { href: style.href } : {}),
  });
  if (/\S/.test(text)) ctx.blankNewlines = 0;
}

/** Aplica `applyListToText` (marcador + numeración/viñeta por nivel, igual
 * que una lista creada a mano) sobre el bloque RAW de una lista (ya con los
 * TAB de profundidad puestos por `walkNode`, sin marcador todavía) y
 * re-ubica los spans recolectados durante el walk al offset que el
 * marcador agregado les corre -- el marcador ("1. ", "• ", "a. "...) se
 * inserta SIEMPRE al inicio de cada línea, después de los TAB de sangría,
 * así que el corrimiento es constante por línea (largo del marcador de esa
 * línea) y no depende de dónde empiece cada span dentro de ella. */
function spliceListResult(local: WalkCtx, listType: 'bullet' | 'number', outer: WalkCtx): void {
  const rawText = local.parts.join('');
  const marked = applyListToText(rawText, listType);
  const rawLines = rawText.split('\n');
  const markedLines = marked.split('\n');
  // El corrimiento que le toca a un span DENTRO de la línea i es la suma de
  // dos partes: el corrimiento acumulado de las líneas ANTERIORES (por sus
  // propios marcadores) más el marcador de la PROPIA línea i -- el marcador
  // se inserta siempre al inicio de la línea, antes que cualquier
  // contenido, así que todo span de esa línea (incluido uno que empiece en
  // relStart=0) queda siempre DESPUÉS de él. Usar solo el corrimiento de
  // líneas anteriores (sin sumar el propio) fue un bug real detectado por
  // el test de negrita dentro de una lista: el span quedaba apuntando a
  // "• negri" en vez de "negrita".
  const lineShifts: { rawStart: number; rawEnd: number; delta: number }[] = [];
  let rawPos = 0;
  let markedPos = 0;
  for (let i = 0; i < rawLines.length; i += 1) {
    const entryDelta = markedPos - rawPos;
    const markerLen = (markedLines[i]?.length ?? rawLines[i].length) - rawLines[i].length;
    lineShifts.push({ rawStart: rawPos, rawEnd: rawPos + rawLines[i].length, delta: entryDelta + markerLen });
    rawPos += rawLines[i].length + 1;
    markedPos += (markedLines[i]?.length ?? 0) + 1;
  }
  if (outer.length > 0) pushNewline(outer);
  const base = outer.length;
  outer.parts.push(marked);
  outer.length += marked.length;
  local.spans.forEach((span) => {
    const shift = lineShifts.find((s) => span.start >= s.rawStart && span.start <= s.rawEnd) ?? lineShifts[lineShifts.length - 1];
    outer.spans.push({ ...span, start: span.start + shift.delta + base, end: span.end + shift.delta + base });
  });
}

interface ListState {
  depth: number;
}

function walkNode(node: Node, style: WalkStyle, ctx: WalkCtx, list: ListState | null): void {
  if (node.nodeType === Node.TEXT_NODE) {
    pushText(ctx, node.textContent || '', style);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (tag === 'BR') {
    pushLineBreak(ctx);
    return;
  }

  if (tag === 'UL' || tag === 'OL') {
    const listType: 'bullet' | 'number' = tag === 'OL' ? 'number' : 'bullet';
    const items = Array.from(el.children).filter((child) => child.tagName.toUpperCase() === 'LI');
    if (!list) {
      // Lista de nivel superior: se arma en un contexto AISLADO para poder
      // pasarle el bloque completo a applyListToText de una sola vez (esa
      // función decide letra/romano/viñeta según la profundidad de CADA
      // línea dentro del texto que recibe) y luego se empalma en `ctx`.
      const local = newCtx();
      items.forEach((li, i) => {
        if (i > 0) pushNewline(local);
        Array.from(li.childNodes).forEach((child) => walkNode(child, style, local, { depth: 0 }));
      });
      spliceListResult(local, listType, ctx);
    } else {
      // Lista anidada dentro de otra: sigue escribiendo en el MISMO
      // contexto de la lista contenedora, un nivel de sangría más profundo
      // -- applyListToText resuelve el marcador de este nivel cuando se
      // procese el bloque completo de la lista de más afuera.
      items.forEach((li) => {
        pushNewline(ctx);
        ctx.parts.push('\t'.repeat(list.depth + 1));
        ctx.length += list.depth + 1;
        Array.from(li.childNodes).forEach((child) => walkNode(child, style, ctx, { depth: list.depth + 1 }));
      });
    }
    return;
  }

  const styledInline = styleForTag(tag, parseInlineStyle(el.getAttribute('style'), style), el);
  const headingId = HEADING_TAG_TO_ID[tag];
  let nextStyle = styledInline;
  if (headingId) {
    const def = findHeadingStyle(headingId);
    if (def) {
      nextStyle = {
        ...nextStyle,
        headingStyle: headingId,
        bold: def.fontWeight >= 600,
        italic: def.italic,
        underline: def.underline,
        color: def.color,
        fontSize: def.fontSize,
        fontFamily: def.fontFamily,
      };
    }
  }

  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) {
    if (isEmptyLeaf(el)) {
      pushLineBreak(ctx);
      return; // parrafo vacio (solo whitespace/&nbsp;) -- nada real que caminar
    }
    pushLineBreak(ctx);
    ctx.blankNewlines = 0; // contenido real por venir: cierra la racha de líneas en blanco
  }
  Array.from(el.childNodes).forEach((child) => walkNode(child, nextStyle, ctx, list));
}

/**
 * `html`: HTML crudo tal cual viene de `clipboardData.getData('text/html')`
 * (se sanea acá adentro, no hace falta sanearlo antes). `plainText`: mismo
 * portapapeles, `text/plain` -- se usa como resultado si `html` viene vacío
 * o no trae ninguna estructura aprovechable (ej. un editor de texto plano).
 * Devuelve `null` solo si no hay contenido pegable en absoluto.
 */
export function parseRichClipboardPaste(html: string, plainText: string): RichPasteResult | null {
  const cleanHtml = html ? sanitizeRichHtml(html) : '';
  if (cleanHtml && typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(`<body>${cleanHtml}</body>`, 'text/html');
      const ctx = newCtx();
      Array.from(doc.body.childNodes).forEach((child) => walkNode(child, BASE_WALK_STYLE, ctx, null));
      const text = ctx.parts.join('');
      if (text.trim()) return { text, spans: ctx.spans };
    } catch {
      // Cae al texto plano de abajo.
    }
  }
  const plain = (plainText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!plain) return null;
  return { text: plain, spans: [] };
}

/**
 * Un tramo del documento pegado ya clasificado por tipo de bloque de este
 * editor -- pedido explícito 2026-09-09 ("pegué un documento de Google Docs
 * con encabezados, párrafos, una tabla y una imagen, y solo se pegó la
 * tabla"). `parseRichClipboardPaste` (de arriba) solo sabe producir UN texto
 * continuo -- una tabla o imagen en medio del HTML simplemente se pierde o
 * ensucia el texto. Esta función SÍ reconoce `<table>`/`<img>` como puntos
 * de corte: todo lo que hay ANTES se cierra como un bloque `text`, la
 * tabla/imagen se emite como su propio bloque, y el texto sigue
 * acumulándose después en un bloque `text` nuevo -- el resultado es la
 * secuencia completa en el mismo orden en que aparecía en el documento
 * original, lista para crear un elemento del lienzo por bloque.
 */
/** Posición/tamaño absolutos (px del lienzo) de un bloque -- SOLO la
 * importación de PDF+OCR los trae (ver pdfOcrImport.ts::convertPdfOcrResponseToBlocks),
 * porque es la única fuente que conoce la posición REAL de cada bloque en su
 * página de origen (mammoth.js/.docx y el portapapeles nunca la exponen).
 * Cuando un bloque trae `geometry`, `PageCanvas.tsx::processPositionedBlocks`
 * lo coloca ahí tal cual en vez de auto-acomodarlo en el flujo vertical de
 * una sola columna -- así se preserva layout multi-columna, la posición
 * relativa imagen/texto, y (con `isBackground`) fondos de página a toda la
 * hoja (carátulas escaneadas, marcas de agua). */
export interface AbsoluteGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Imagen que cubre ~toda la hoja de origen -- se coloca a pantalla
   * completa DETRÁS del resto del contenido de esa página en vez de como
   * una figura más en el flujo (ver processPositionedBlocks). */
  isBackground?: boolean;
}

export type PasteBlock =
  | ({ kind: 'text'; text: string; spans: TextStyleSpan[]; geometry?: AbsoluteGeometry } & ParagraphFormat)
  | ({ kind: 'table'; geometry?: AbsoluteGeometry } & ParsedClipboardGrid)
  | { kind: 'image'; src: string; width?: number; height?: number; geometry?: AbsoluteGeometry }
  | { kind: 'shape'; shapeType: 'line' }
  /** Corte de página real de la fuente (ver pdfOcrImport.ts) -- distinto del
   * salto de página MANUAL de .docx (`docx-page-break`, más abajo en este
   * archivo), que solo corta el bloque de texto acumulado sin forzar una
   * hoja nueva del lienzo. Este SÍ fuerza una hoja nueva (uno a uno con cada
   * página del PDF de origen) -- ver processPositionedBlocks. */
  | { kind: 'page-break' };

function walkNodeForBlocks(node: Node, style: WalkStyle, box: { value: WalkCtx }, list: ListState | null, blocks: PasteBlock[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    pushText(box.value, node.textContent || '', style);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  const flushText = () => {
    const text = box.value.parts.join('');
    if (text.trim()) blocks.push({ kind: 'text', text, spans: box.value.spans, ...box.value.paragraphFormat });
    box.value = newCtx();
  };

  // Marcador de alineación de un párrafo importado de un .docx (ver
  // App.tsx::handleImportDocx + lib/docxPageBreaks.ts::markParagraphAlignment)
  // -- mammoth.js lee `w:jc` del .docx pero nunca lo traduce a HTML por su
  // cuenta, así que se le pide (vía `transformDocument`) que envuelva el
  // contenido de cada párrafo alineado en un run con este estilo marcador,
  // convertido acá a este <span> por el `styleMap` que ya le pasamos. No es
  // contenido real -- se descarta el envoltorio y se sigue caminando sus
  // hijos con normalidad. La detección PRINCIPAL de esta alineación ahora
  // pasa por `readParagraphFormat` (ve el marcador ANIDADO antes de entrar
  // al párrafo, así el corte-de-bloque-por-cambio-de-alineación de más
  // abajo también reacciona a esto -- antes no, ver el comentario largo
  // ahí) -- esto queda solo como respaldo para el único caso que
  // `readParagraphFormat` no cubre (un marcador dentro de un `<li>`, que
  // sigue una rama de armado de texto aparte, sin pasar por ahí).
  if (tag === 'SPAN') {
    const alignClass = Array.from(el.classList).find((cls) => /^docx-align-(left|center|right|justify)$/.test(cls));
    if (alignClass && !box.value.paragraphFormat.textAlign) {
      box.value.paragraphFormat.textAlign = alignClass.replace('docx-align-', '') as ParagraphAlign;
    }
    // Línea horizontal de un .docx importado (borde de párrafo `w:pBdr`,
    // ver lib/docxPageBreaks.ts::markHorizontalRuleParagraphs) -- llega acá
    // como un marcador sintético al final del párrafo que tenía el borde.
    // No es texto real (el caracter que trae es un simple guión largo
    // invisible, solo para que mammoth genere ALGO que envolver): se corta
    // el bloque de texto acumulado y se empuja un bloque de forma tipo
    // línea en su lugar, sin caminar el contenido de este span.
    if (el.classList.contains('beemetry-hr')) {
      flushText();
      blocks.push({ kind: 'shape', shapeType: 'line' });
      return;
    }
  }

  // Salto de página MANUAL de Word (Ctrl+Enter / Insertar > Salto de
  // página) -- pedido explícito 2026-09-09: "si hay texto en 1 página, todo
  // ese texto de esa página es un solo bloque, si hay texto en la 2da
  // página, ese es otro bloque". mammoth.js (la librería que convierte el
  // .docx a HTML, ver App.tsx::handleImportDocx) DESCARTA los saltos de
  // página por completo por defecto -- no queda ni rastro en el HTML, un
  // documento con 2 páginas separadas por un salto se ve IDÉNTICO a uno
  // sin salto alguno. Se resuelve pidiéndole a mammoth, vía `styleMap`, que
  // en vez de descartarlo emita este marcador (`<hr class="docx-page-break">`)
  // -- acá se reconoce y fuerza el corte de bloque, sin insertar nada por
  // el marcador en sí (no es contenido real, solo una señal de corte).
  // Nota de alcance: esto solo cubre saltos MANUALES -- el salto NATURAL
  // que Word calcula solo con el flujo del texto (sin Ctrl+Enter de por
  // medio) no queda guardado de forma confiable en el .docx en absoluto
  // (ver `w:lastRenderedPageBreak`, que Word ni garantiza mantener
  // actualizado), así que ese caso no se puede detectar acá.
  if (tag === 'HR' && el.classList.contains('docx-page-break')) {
    flushText();
    return;
  }

  if (tag === 'TABLE') {
    flushText();
    const parsed = parseHtmlClipboardTable(el.outerHTML);
    if (parsed) blocks.push({ kind: 'table', ...parsed });
    return; // no camina el contenido de la tabla como texto plano
  }
  if (tag === 'IMG') {
    const src = el.getAttribute('src') || '';
    if (src) {
      flushText();
      // Tamaño con el que la imagen aparecía en el documento de origen --
      // pedido explícito 2026-09-09 ("el mismo tamaño en el que se
      // encuentra la imagen"). Word/Google Docs suelen escribir el tamaño
      // MOSTRADO (no necesariamente la resolución real del archivo) como
      // atributos `width`/`height` o como `style="width:...px"` en el
      // `<img>` del portapapeles. Si no viene ninguno (típico del HTML que
      // genera mammoth.js al importar un .docx -- no expone esa medida),
      // el caller (PageCanvas.tsx) cae a medir el archivo real.
      const size = readImageSize(el);
      blocks.push({ kind: 'image', src, ...size });
    }
    return;
  }
  if (tag === 'BR') {
    pushLineBreak(box.value);
    return;
  }
  if (tag === 'UL' || tag === 'OL') {
    const listType: 'bullet' | 'number' = tag === 'OL' ? 'number' : 'bullet';
    const items = Array.from(el.children).filter((child) => child.tagName.toUpperCase() === 'LI');
    if (!list) {
      const local = newCtx();
      const localBox = { value: local };
      items.forEach((li, i) => {
        if (i > 0) pushNewline(localBox.value);
        Array.from(li.childNodes).forEach((child) => walkNodeForBlocks(child, style, localBox, { depth: 0 }, blocks));
      });
      spliceListResult(localBox.value, listType, box.value);
    } else {
      items.forEach((li) => {
        pushNewline(box.value);
        box.value.parts.push('\t'.repeat(list.depth + 1));
        box.value.length += list.depth + 1;
        Array.from(li.childNodes).forEach((child) => walkNodeForBlocks(child, style, box, { depth: list.depth + 1 }, blocks));
      });
    }
    return;
  }

  const styledInline = styleForTag(tag, parseInlineStyle(el.getAttribute('style'), style), el);
  const headingId = HEADING_TAG_TO_ID[tag];
  let nextStyle = styledInline;
  if (headingId) {
    const def = findHeadingStyle(headingId);
    if (def) {
      nextStyle = {
        ...nextStyle,
        headingStyle: headingId,
        bold: def.fontWeight >= 600,
        italic: def.italic,
        underline: def.underline,
        color: def.color,
        fontSize: def.fontSize,
        fontFamily: def.fontFamily,
      };
    }
  }

  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) {
    if (isEmptyLeaf(el)) {
      pushLineBreak(box.value);
      return; // parrafo vacio (solo whitespace/&nbsp;) -- nada real que caminar
    }
    const format = readParagraphFormat(el);
    // Si este párrafo trae una ALINEACIÓN distinta a la ya establecida
    // para el bloque en curso, cortar acá -- pedido explícito 2026-09-09
    // ("que traiga la disposición del texto... si está centrado"). El
    // modelo de esta app solo admite un textAlign por BLOQUE (no por
    // párrafo), así que un título centrado seguido de un párrafo normal
    // (caso MUY común: título + cuerpo, sin salto de página entre medio)
    // antes se fusionaban en un solo bloque y el párrafo normal terminaba
    // heredando el centrado del título -- bug real encontrado probando
    // esto. Solo compara alineación (no sangría): un cambio de sangría
    // dentro del mismo bloque es un desajuste menor, no vale la pena
    // multiplicar bloques por eso.
    if (
      format.textAlign &&
      box.value.paragraphFormat.textAlign &&
      format.textAlign !== box.value.paragraphFormat.textAlign
    ) {
      flushText();
    }
    // Un encabezado (H1-H6) SIEMPRE arranca bloque nuevo -- bug real
    // encontrado 2026-09-11 probando el corte-por-alineación de arriba con
    // un documento real: un encabezado de Word casi nunca trae `w:jc`
    // explícito (hereda la alineación de su ESTILO, no del párrafo), así
    // que `format.textAlign` le da vacío y el corte de arriba nunca se
    // dispara para él -- quedaba fusionado hacia ATRÁS con lo que sea que
    // viniera justo antes (p.ej. una leyenda de figura/tabla centrada, ver
    // `pairCaptionsWithMedia` en PageCanvas.tsx: terminaba "adoptando" el
    // encabezado siguiente como si fuera parte de la leyenda). Un
    // encabezado es de por sí un límite de contenido semántico -- no hace
    // falta que difiera en alineación de lo anterior para merecer su
    // propio bloque.
    if (headingId && (box.value.parts.length > 0 || box.value.length > 0)) {
      flushText();
    }
    pushLineBreak(box.value);
    box.value.blankNewlines = 0; // contenido real por venir: cierra la racha de líneas en blanco
    // Alineación/sangría del PRIMER párrafo con contenido real de este
    // bloque -- ver la nota larga en WalkCtx.paragraphFormat arriba.
    if (Object.keys(box.value.paragraphFormat).length === 0) {
      box.value.paragraphFormat = format;
    }
  }
  Array.from(el.childNodes).forEach((child) => walkNodeForBlocks(child, nextStyle, box, list, blocks));
}

/** `html`: crudo de `clipboardData.getData('text/html')` -- a propósito
 * NUNCA pasa por `sanitizeRichHtml` (esa allowlist no incluye
 * `<table>`/`<img>`, los desenvuelve dejando solo su contenido de texto --
 * justo lo que rompía "pegué un documento con tabla e imagen y solo se pegó
 * la tabla"). Es seguro leer el HTML crudo directo porque cada extracción es
 * angosta y nunca reinyecta HTML/atributos crudos a ningún sink: el texto
 * sale por `.textContent` (nunca `innerHTML`), la tabla por
 * `parseHtmlClipboardTable` (mismo parser ya usado hoy sobre HTML crudo sin
 * sanear en PageCanvas.tsx, también por `.textContent`), y el `src` de una
 * imagen lo valida el caller contra el mismo allowlist estricto
 * (`data:image/` o `http(s)://`, nada más) que ya usa el resto del pegado de
 * imágenes -- ningún esquema `javascript:`/`vbscript:` pasa ese filtro.
 * Devuelve la secuencia de bloques (texto/tabla/imagen) en orden de
 * documento; array vacío si no hay nada aprovechable (el caller decide si
 * cae al texto plano con `parseRichClipboardPaste`). */
export function parseRichClipboardBlocks(html: string): PasteBlock[] {
  if (!html || typeof DOMParser === 'undefined') return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  } catch {
    return [];
  }
  const blocks: PasteBlock[] = [];
  const box = { value: newCtx() };
  Array.from(doc.body.childNodes).forEach((child) => walkNodeForBlocks(child, BASE_WALK_STYLE, box, null, blocks));
  const text = box.value.parts.join('');
  if (text.trim()) blocks.push({ kind: 'text', text, spans: box.value.spans, ...box.value.paragraphFormat });
  return blocks;
}

/** Detecta un párrafo de LEYENDA de figura/tabla -- pedido explícito
 * 2026-09-11, con un documento real: "figura 5 lo esta colocando como
 * texto centrado y como esta centrado centra todo el contenido de abajo...
 * esos bloques colocalos dentro de la propiedad de las imagenes o tablas
 * en el campo de leyenda". Convención española típica de informes
 * técnicos: "Figura N."/"Tabla N."/"Cuadro N." (con o sin punto/dos
 * puntos), opcionalmente abreviado "Fig.". Ancla al INICIO del texto (no
 * busca la palabra en cualquier parte) para no confundir un párrafo normal
 * que solo MENCIONA "la Figura 5" a mitad de oración con la leyenda real,
 * y exige que sea CORTO (una leyenda real es una sola oración) para no
 * tragarse por error un párrafo largo que empiece citando una figura. */
const CAPTION_TEXT_RE = /^\s*(Figura|Fig\.|Tabla|Cuadro|Imagen)\s*\d+[.:]/i;
const MAX_CAPTION_LENGTH = 220;

/**
 * Empareja cada bloque `image`/`table` con un bloque `text` corto y
 * ADYACENTE que se lea como su leyenda -- "Figura N." casi siempre va
 * DEBAJO de una imagen, "Tabla N." a veces arriba de la tabla, así que se
 * prueba el siguiente bloque primero y el anterior como respaldo. Ese
 * bloque de texto se saca de la secuencia de inserción (nunca se crea como
 * elemento de texto aparte, ver PageCanvas.tsx::processPasteBlocks) y
 * viaja junto a su imagen/tabla, lista para ir al prop `caption` de ese
 * elemento -- en vez de quedar como un párrafo centrado suelto que además
 * arrastraba su alineación hacia el contenido siguiente (ver el
 * comentario largo en `readParagraphFormat` más arriba). Un bloque de
 * texto ya usado como leyenda de un vecino no puede volver a usarse para
 * otro. Vive en este archivo (no en PageCanvas.tsx, donde se usa) para
 * poder probarse sin arrastrar el árbol de imports de Konva/react-konva.
 */
export function pairCaptionsWithMedia(blocks: PasteBlock[]): { block: PasteBlock; caption?: string }[] {
  const isCaptionText = (b: PasteBlock | undefined): b is Extract<PasteBlock, { kind: 'text' }> => {
    if (!b || b.kind !== 'text') return false;
    const trimmed = b.text.trim();
    return trimmed.length <= MAX_CAPTION_LENGTH && CAPTION_TEXT_RE.test(trimmed);
  };
  const captionByMediaIndex = new Map<number, string>();
  const consumedTextIndex = new Set<number>();
  blocks.forEach((block, i) => {
    if (block.kind !== 'image' && block.kind !== 'table') return;
    const next = blocks[i + 1];
    if (isCaptionText(next) && !consumedTextIndex.has(i + 1)) {
      captionByMediaIndex.set(i, next.text.trim());
      consumedTextIndex.add(i + 1);
      return;
    }
    const prev = blocks[i - 1];
    if (isCaptionText(prev) && !consumedTextIndex.has(i - 1)) {
      captionByMediaIndex.set(i, prev.text.trim());
      consumedTextIndex.add(i - 1);
    }
  });
  return blocks
    .map((block, index) => ({ block, index }))
    .filter(({ index }) => !consumedTextIndex.has(index))
    .map(({ block, index }) => ({ block, caption: captionByMediaIndex.get(index) }));
}
