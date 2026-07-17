/**
 * Formato por selección tipo Word ("runs"/"spans") para bloques de texto.
 *
 * El modelo histórico de esta app guardaba un solo string (`props.text`) más
 * un único juego de props de estilo (`bold`/`italic`/`fontSize`/...) para
 * TODO el bloque — no había forma de poner en negrita solo una palabra.
 *
 * Este módulo agrega una capa de "spans" — rangos [start,end) sobre el
 * MISMO string plano, cada uno con su propio parche de estilo — sin tocar
 * la máquina de escritura existente (textarea + IME + autosize + debounce):
 * el texto sigue siendo un string plano en todo momento; los spans son
 * puramente una superposición visual sobre ese string, guardada en
 * `props.spans`. Rangos sin span cubriéndolos heredan el estilo "base" del
 * bloque (las props de siempre), así que datos guardados antes de esta
 * función siguen renderizando idéntico (sin spans = comportamiento previo).
 */

export interface TextStyleSpan {
  /** Offset de carácter inclusive dentro de `text`. */
  start: number;
  /** Offset de carácter exclusivo dentro de `text`. */
  end: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
}

export interface BaseTextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  fontSize: number;
  fontFamily: string;
}

export type EffectiveTextStyle = BaseTextStyle;

const STYLE_KEYS: (keyof BaseTextStyle)[] = ['bold', 'italic', 'underline', 'color', 'fontSize', 'fontFamily'];

/** Descarta spans inválidos/fuera de rango y los ordena por inicio —
 * primera línea de defensa para datos legados o corruptos. */
export function sanitizeSpans(rawSpans: unknown, textLength: number): TextStyleSpan[] {
  if (!Array.isArray(rawSpans)) return [];
  return rawSpans
    .map((s): TextStyleSpan | null => {
      if (!s || typeof s !== 'object') return null;
      const start = Math.max(0, Math.min(textLength, Number((s as any).start) || 0));
      const end = Math.max(0, Math.min(textLength, Number((s as any).end) || 0));
      if (end <= start) return null;
      const span: TextStyleSpan = { start, end };
      const raw = s as Record<string, unknown>;
      if (typeof raw.bold === 'boolean') span.bold = raw.bold;
      if (typeof raw.italic === 'boolean') span.italic = raw.italic;
      if (typeof raw.underline === 'boolean') span.underline = raw.underline;
      if (typeof raw.color === 'string') span.color = raw.color;
      if (typeof raw.fontSize === 'number') span.fontSize = raw.fontSize;
      if (typeof raw.fontFamily === 'string') span.fontFamily = raw.fontFamily;
      return span;
    })
    .filter((s): s is TextStyleSpan => s !== null)
    .sort((a, b) => a.start - b.start);
}

/** Estilo efectivo en un offset de carácter dado: el del span que lo cubre
 * (si hay varios superpuestos, el último de la lista gana), si no el base. */
export function getEffectiveStyleAt(spans: TextStyleSpan[], base: BaseTextStyle, offset: number): EffectiveTextStyle {
  let style: EffectiveTextStyle = { ...base };
  for (const span of spans) {
    if (offset >= span.start && offset < span.end) {
      style = { ...style, ...pickStyleProps(span) };
    }
  }
  return style;
}

function pickStyleProps(span: TextStyleSpan): Partial<BaseTextStyle> {
  const out: Partial<BaseTextStyle> = {};
  for (const key of STYLE_KEYS) {
    if (span[key] !== undefined) (out as any)[key] = span[key];
  }
  return out;
}

function stylesEqual(a: EffectiveTextStyle, b: EffectiveTextStyle): boolean {
  return STYLE_KEYS.every((key) => a[key] === b[key]);
}

export interface StyledSegment {
  text: string;
  style: EffectiveTextStyle;
}

/** Parte `text` en segmentos contiguos con estilo uniforme cada uno —
 * usado tanto para el overlay "fantasma" durante la edición como para el
 * render estático (no-Konva) de bloques con formato mixto. */
export function buildStyledSegments(text: string, spans: TextStyleSpan[], base: BaseTextStyle): StyledSegment[] {
  if (!text) return [];
  const breakpoints = new Set<number>([0, text.length]);
  for (const span of spans) {
    breakpoints.add(Math.max(0, Math.min(text.length, span.start)));
    breakpoints.add(Math.max(0, Math.min(text.length, span.end)));
  }
  const sorted = Array.from(breakpoints).sort((a, b) => a - b);
  const segments: StyledSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const style = getEffectiveStyleAt(spans, base, start);
    const chunk = text.slice(start, end);
    const prev = segments[segments.length - 1];
    if (prev && stylesEqual(prev.style, style)) {
      prev.text += chunk;
    } else {
      segments.push({ text: chunk, style });
    }
  }
  return segments;
}

/** Reconstruye una lista de spans "limpia" (sin solapes, sin tramos
 * redundantes iguales al estilo base) a partir de segmentos ya resueltos —
 * usado tras aplicar un parche de formato a un rango. */
function segmentsToSpans(segments: StyledSegment[], base: BaseTextStyle): TextStyleSpan[] {
  const spans: TextStyleSpan[] = [];
  let offset = 0;
  for (const seg of segments) {
    const start = offset;
    const end = offset + seg.text.length;
    offset = end;
    if (!stylesEqual(seg.style, { ...base })) {
      const span: TextStyleSpan = { start, end };
      for (const key of STYLE_KEYS) {
        if (seg.style[key] !== base[key]) (span as any)[key] = seg.style[key];
      }
      const prev = spans[spans.length - 1];
      if (prev && prev.end === start && STYLE_KEYS.every((k) => (prev as any)[k] === (span as any)[k])) {
        prev.end = end;
      } else {
        spans.push(span);
      }
    }
  }
  return spans;
}

/**
 * Aplica un parche de estilo a [rangeStart,rangeEnd) de `text`, devolviendo
 * la lista de spans resultante. Para propiedades booleanas (bold/italic/
 * underline) se replica el comportamiento de Word: si TODO el rango ya
 * tiene la propiedad activa, se desactiva; si no, se activa para todo el
 * rango (aunque estuviera parcialmente activa).
 */
export function applyStyleToRange(
  text: string,
  spans: TextStyleSpan[],
  base: BaseTextStyle,
  rangeStart: number,
  rangeEnd: number,
  patch: Partial<BaseTextStyle>,
): TextStyleSpan[] {
  const start = Math.max(0, Math.min(text.length, Math.min(rangeStart, rangeEnd)));
  const end = Math.max(0, Math.min(text.length, Math.max(rangeStart, rangeEnd)));
  if (end <= start) return spans;

  const resolvedPatch: Partial<BaseTextStyle> = { ...patch };
  for (const key of ['bold', 'italic', 'underline'] as const) {
    if (patch[key] === undefined) continue;
    // Toggle: si CADA carácter del rango ya tiene la propiedad activa,
    // el clic la desactiva; en cualquier otro caso, la activa para todo
    // el rango — igual que el botón Negrita/Cursiva/Subrayado de Word.
    const segmentsInRange = buildStyledSegments(text.slice(start, end), reindexSpans(spans, start, end), base);
    const allActive = segmentsInRange.length > 0 && segmentsInRange.every((seg) => seg.style[key] === true);
    (resolvedPatch as any)[key] = !allActive;
  }

  const before = buildStyledSegments(text.slice(0, start), spans, base);
  const beforeSpans = segmentsToSpans(before, base).map((s) => s);
  const middleSegments = buildStyledSegments(text.slice(start, end), reindexSpans(spans, start, end), base).map((seg) => ({
    text: seg.text,
    style: { ...seg.style, ...resolvedPatch },
  }));
  const middleSpans = segmentsToSpans(middleSegments, base).map((s) => ({ ...s, start: s.start + start, end: s.end + start }));
  const afterSegments = buildStyledSegments(text.slice(end), reindexSpans(spans, end, text.length), base);
  const afterSpans = segmentsToSpans(afterSegments, base).map((s) => ({ ...s, start: s.start + end, end: s.end + end }));

  return mergeAdjacentSpans([...beforeSpans, ...middleSpans, ...afterSpans]);
}

/** Recorta/traslada spans para que queden relativos a un sub-rango
 * [from,to) — usado internamente para reutilizar `buildStyledSegments`
 * sobre un tramo del texto sin que los offsets absolutos lo confundan. */
function reindexSpans(spans: TextStyleSpan[], from: number, to: number): TextStyleSpan[] {
  return spans
    .map((s) => ({ ...s, start: Math.max(from, s.start) - from, end: Math.min(to, s.end) - from }))
    .filter((s) => s.end > s.start);
}

function mergeAdjacentSpans(spans: TextStyleSpan[]): TextStyleSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: TextStyleSpan[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.end === span.start && STYLE_KEYS.every((k) => (prev as any)[k] === (span as any)[k])) {
      prev.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Recoloca los spans cuando el texto cambia (tecleo, dictado, corrección
 * IA) — usa diff de prefijo/sufijo común (misma técnica que un diff
 * mínimo): el tramo que NO cambió conserva sus spans intactos; el tramo
 * reemplazado hereda el estilo que tenía al inicio del cambio. No es un
 * motor de OT real, pero cubre correctamente el caso dominante (edición
 * de una zona acotada del texto) sin arriesgar la lógica de tecleo
 * existente.
 */
export function remapSpansForTextChange(oldText: string, newText: string, spans: TextStyleSpan[]): TextStyleSpan[] {
  if (oldText === newText) return spans;
  if (spans.length === 0) return spans;

  const maxCommon = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxCommon && oldText[prefix] === newText[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMidStart = prefix;
  const oldMidEnd = oldText.length - suffix;
  const newMidStart = prefix;
  const newMidEnd = newText.length - suffix;
  const delta = (newMidEnd - newMidStart) - (oldMidEnd - oldMidStart);

  const remapped = spans
    .map((span) => {
      let newStart: number;
      let newEnd: number;
      if (span.start <= oldMidStart) newStart = span.start;
      else if (span.start >= oldMidEnd) newStart = span.start + delta;
      else newStart = newMidStart;

      if (span.end <= oldMidStart) newEnd = span.end;
      else if (span.end >= oldMidEnd) newEnd = span.end + delta;
      else newEnd = newMidEnd;

      return { ...span, start: newStart, end: newEnd };
    })
    .filter((span) => span.end > span.start);

  return sanitizeSpans(remapped, newText.length);
}

/** Convierte un EffectiveTextStyle en un objeto de estilo CSS-in-JS listo
 * para usar en un `<span style={...}>` (overlay de edición o render
 * estático de bloques con formato mixto). */
export interface CssStyleLike {
  fontWeight: number;
  fontStyle: 'italic' | 'normal';
  textDecoration: 'underline' | 'none';
  color: string;
  fontSize: string;
  fontFamily: string;
}

export function styleToCss(style: EffectiveTextStyle): CssStyleLike {
  return {
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    color: style.color,
    fontSize: `${style.fontSize}px`,
    fontFamily: style.fontFamily,
  };
}
