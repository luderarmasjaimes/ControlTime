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
  /** Tachado (strikethrough) -- agregado 2026-09-22 al auditar fidelidad de
   * ida y vuelta con Word: hasta entonces el texto tachado de un .docx
   * importado se conservaba (el carácter en sí nunca se pierde) pero el
   * estilo se descartaba sin más (ver el comentario viejo, ya retirado, en
   * lib/richPaste.ts::styleForTag). Mismo tratamiento que `underline` en
   * todo lo demás: hereda vía STYLE_KEYS, se activa/desactiva como
   * toggle. */
  strikethrough?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  /** Color de resaltado (highlight) de fondo detrás del texto de este
   * rango — 'transparent' o ausente = sin resaltar. Distinto de
   * `props.backgroundColor` del bloque (el fondo de TODO el cuadro de
   * texto): esto es el resaltado tipo marcador de Word, por selección. */
  highlightColor?: string;
  /** Marca este rango como un encabezado del documento (mismos ids que
   * HEADING_STYLES en lib/headingStyles.ts: 'title'|'h1'..'h6') para que
   * la Tabla de Contenidos lo detecte igual que un bloque entero con
   * `props.headingStyle` — ver TableOfContents.tsx. undefined = texto
   * normal, no aparece en el TOC. */
  headingStyle?: string;
  /** Alineación del PÁRRAFO que cubre este span -- pedido explícito
   * 2026-09-11: los botones de alineación de la barra contextual (al
   * seleccionar texto en edición) aplicaban a TODO el bloque, no solo al
   * párrafo donde estaba la selección. A diferencia de `headingStyle`
   * (igual de "no es un estilo visual de carácter", mismo precedente), esto
   * SOLO tiene sentido aplicado a un rango que cubra el/los párrafo(s)
   * completos tocados por la selección -- nunca un tramo parcial de una
   * línea -- así que quien construye este span (`applyAlignToSelection` en
   * TextBlock.tsx) SIEMPRE expande el rango a los límites de párrafo antes
   * de llamar a `applyStyleToRange`. Se guarda como span (no como una
   * estructura paralela nueva) para heredar gratis todo el mecanismo ya
   * existente y probado de reindexado ante cada edición de texto
   * (`remapSpansForTextChange`, ya enganchado en cada punto donde se
   * teclea/pega/dicta/corrige) -- inventar un array paralelo habría exigido
   * repetir ese enganche en cada uno de esos puntos, con alto riesgo de
   * desincronizarse en alguno. */
  textAlign?: string;
  /** Referencia cruzada resuelta en render (ADR-019 — numeración/TOC/refs
   * diferidas). `targetId` es el `TocItem.id` de un encabezado (ver
   * `generateTocData()`/`resolveHeadingRefLabel()` en TableOfContents.tsx).
   * El texto ALMACENADO en este rango (`text.slice(start,end)`) es solo un
   * placeholder estable (nunca editado a mano, ver
   * `insertReferenceAtRange` en PageCanvas.tsx) — lo que se MUESTRA se
   * sustituye en cada render por el número de sección vigente del target,
   * así que mover/insertar una sección re-numera y re-resuelve la
   * referencia automáticamente, sin texto fijo que se desincronice. No es
   * una propiedad de estilo (no entra en `STYLE_KEYS`/`BaseTextStyle`): no
   * tiene "base" ni se hereda fuera de su propio rango. */
  ref?: { targetId: string };
  /** Hipervínculo externo (http(s):/mailto:) -- agregado 2026-09-22 junto
   * con `strikethrough` al auditar fidelidad de ida y vuelta con Word: un
   * `<a href>` importado de un .docx conservaba el texto pero perdía el
   * enlace en sí (esta app no tenía ningún campo para guardarlo). Mismo
   * criterio que `ref` (no es una propiedad de estilo, no entra en
   * `STYLE_KEYS`/hereda) -- a diferencia de `ref`, el texto ALMACENADO acá
   * SÍ es el texto real visible del enlace (no un placeholder a resolver),
   * así que edita como cualquier otro texto normal. El caller valida el
   * esquema (solo http(s)/mailto) antes de guardar -- ver
   * `SAFE_LINK_SCHEME` en lib/richPaste.ts. */
  href?: string;
}

export interface BaseTextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string;
  fontSize: number;
  fontFamily: string;
  highlightColor: string;
  headingStyle: string;
  /** Alineación BASE del bloque (`props.textAlign` de siempre) -- ver el
   * comentario de `TextStyleSpan.textAlign` más arriba. */
  textAlign: string;
}

export type EffectiveTextStyle = BaseTextStyle;

const STYLE_KEYS: (keyof BaseTextStyle)[] = [
  'bold', 'italic', 'underline', 'strikethrough', 'color', 'fontSize', 'fontFamily', 'highlightColor', 'headingStyle', 'textAlign',
];

/** Mismo criterio que `SAFE_LINK_SCHEME` en lib/richPaste.ts -- copiado acá
 * (en vez de importado) porque este archivo es la capa de datos pura y no
 * depende de richPaste.ts; sirve de segunda barrera por si algún dato legado
 * o corrupto trae un `href` con esquema peligroso (`javascript:`, etc). */
const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;

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
      if (typeof raw.strikethrough === 'boolean') span.strikethrough = raw.strikethrough;
      if (typeof raw.color === 'string') span.color = raw.color;
      if (typeof raw.fontSize === 'number') span.fontSize = raw.fontSize;
      if (typeof raw.fontFamily === 'string') span.fontFamily = raw.fontFamily;
      if (typeof raw.highlightColor === 'string') span.highlightColor = raw.highlightColor;
      if (typeof raw.headingStyle === 'string') span.headingStyle = raw.headingStyle;
      if (typeof raw.textAlign === 'string') span.textAlign = raw.textAlign;
      if (raw.ref && typeof raw.ref === 'object' && typeof (raw.ref as any).targetId === 'string') {
        span.ref = { targetId: (raw.ref as any).targetId };
      }
      if (typeof raw.href === 'string' && SAFE_LINK_SCHEME.test(raw.href)) {
        span.href = raw.href;
      }
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
  /** Presente si este segmento proviene de un span con `.ref` (ver
   * TextStyleSpan.ref) — se preserva a través de segments↔spans para que
   * aplicar formato (negrita, color…) sobre una referencia no la rompa. */
  refTargetId?: string;
  /** Presente si este segmento proviene de un span con `.href` (ver
   * TextStyleSpan.href) — mismo criterio que `refTargetId`, preservado a
   * través de segments↔spans para que aplicar formato sobre un
   * hipervínculo no lo rompa. */
  href?: string;
}

/** Parte `text` en segmentos contiguos con estilo (y referencia, si aplica)
 * uniforme cada uno — usado tanto para el overlay "fantasma" durante la
 * edición como para el render estático (no-Konva) de bloques con formato
 * mixto.
 *
 * `resolveRef`, si se pasa, sustituye el texto MOSTRADO de cualquier
 * segmento cubierto por un span `.ref` por el valor resuelto (ADR-019) —
 * el texto ALMACENADO (`text`) nunca se toca, solo lo que este helper
 * devuelve para pintar. Sin `resolveRef` (p.ej. durante `applyStyleToRange`,
 * que solo necesita la estructura, no el valor resuelto) el placeholder
 * literal se conserva tal cual. Un target borrado/inválido resuelve a
 * `undefined` y se muestra un marcador visible en vez de desaparecer en
 * silencio. */
export function buildStyledSegments(
  text: string,
  spans: TextStyleSpan[],
  base: BaseTextStyle,
  resolveRef?: (targetId: string) => string | undefined,
): StyledSegment[] {
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
    const refSpan = spans.find((s) => s.ref && start >= s.start && start < s.end);
    const refTargetId = refSpan?.ref?.targetId;
    const hrefSpan = spans.find((s) => s.href && start >= s.start && start < s.end);
    const href = hrefSpan?.href;
    let chunk = text.slice(start, end);
    if (refTargetId && resolveRef) {
      chunk = resolveRef(refTargetId) ?? '⚠';
    }
    const prev = segments[segments.length - 1];
    if (prev && stylesEqual(prev.style, style) && prev.refTargetId === refTargetId && prev.href === href) {
      prev.text += chunk;
    } else {
      segments.push({ text: chunk, style, ...(refTargetId ? { refTargetId } : {}), ...(href ? { href } : {}) });
    }
  }
  return segments;
}

export interface ParagraphSegmentGroup {
  /** Offsets ABSOLUTOS [start,end) de este párrafo dentro del texto
   * completo -- el separador '\n' en sí no pertenece a ningún párrafo. */
  start: number;
  end: number;
  align: string;
  segments: StyledSegment[];
}

/** Divide `text` en párrafos (separados por '\n') y resuelve, para cada
 * uno, su alineación efectiva (ver `TextStyleSpan.textAlign`) y sus
 * segmentos de estilo POR CARÁCTER (negrita/color/tamaño/…) ya recortados a
 * ese párrafo -- usado tanto por el render estático como por el overlay
 * "fantasma" de edición (TextBlock.tsx) y el visor de solo lectura/export
 * (ReadOnlyViewer.tsx) para que cada párrafo pueda pintarse en su propio
 * contenedor de bloque con SU PROPIO `text-align`, sin perder el formato de
 * carácter mixto ya existente dentro de cada uno. Muestrea la alineación en
 * el offset de INICIO de cada párrafo porque un span de `textAlign` SIEMPRE
 * cubre el párrafo completo por construcción (ver `applyAlignToSelection`
 * en TextBlock.tsx) -- nunca cambia a mitad de línea. */
export function buildParagraphGroups(
  text: string,
  spans: TextStyleSpan[],
  base: BaseTextStyle,
  resolveRef?: (targetId: string) => string | undefined,
): ParagraphSegmentGroup[] {
  const groups: ParagraphSegmentGroup[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text[i] === '\n') {
      const align = getEffectiveStyleAt(spans, base, start).textAlign;
      const segments = buildStyledSegments(text.slice(start, i), reindexSpans(spans, start, i), base, resolveRef);
      groups.push({ start, end: i, align, segments });
      start = i + 1;
    }
  }
  return groups;
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
    const hasStyleDiff = !stylesEqual(seg.style, { ...base });
    if (hasStyleDiff || seg.refTargetId || seg.href) {
      const span: TextStyleSpan = { start, end };
      for (const key of STYLE_KEYS) {
        if (seg.style[key] !== base[key]) (span as any)[key] = seg.style[key];
      }
      if (seg.refTargetId) span.ref = { targetId: seg.refTargetId };
      if (seg.href) span.href = seg.href;
      const prev = spans[spans.length - 1];
      const prevRefId = prev?.ref?.targetId;
      if (
        prev &&
        prev.end === start &&
        prevRefId === seg.refTargetId &&
        prev.href === seg.href &&
        STYLE_KEYS.every((k) => (prev as any)[k] === (span as any)[k])
      ) {
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
 * rango (aunque estuviera parcialmente activa). Este toggle solo aplica
 * cuando `options.toggle` no es `false` — los presets de encabezado (ver
 * `applyHeadingStyleToSelection` en PageCanvas.tsx) necesitan asignar
 * bold/italic/underline como valores LITERALES (p.ej. forzar italic:false),
 * no alternarlos; con el toggle siempre activo, un preset que pide
 * italic:false terminaba invertido a true porque cualquier valor definido
 * (incluido `false`) disparaba la lógica de alternancia.
 */
export function applyStyleToRange(
  text: string,
  spans: TextStyleSpan[],
  base: BaseTextStyle,
  rangeStart: number,
  rangeEnd: number,
  patch: Partial<BaseTextStyle>,
  options?: { toggle?: boolean },
): TextStyleSpan[] {
  const start = Math.max(0, Math.min(text.length, Math.min(rangeStart, rangeEnd)));
  const end = Math.max(0, Math.min(text.length, Math.max(rangeStart, rangeEnd)));
  if (end <= start) return spans;

  const resolvedPatch: Partial<BaseTextStyle> = { ...patch };
  if (options?.toggle !== false) {
    for (const key of ['bold', 'italic', 'underline'] as const) {
      if (patch[key] === undefined) continue;
      // Toggle: si CADA carácter del rango ya tiene la propiedad activa,
      // el clic la desactiva; en cualquier otro caso, la activa para todo
      // el rango — igual que el botón Negrita/Cursiva/Subrayado de Word.
      const segmentsInRange = buildStyledSegments(text.slice(start, end), reindexSpans(spans, start, end), base);
      const allActive = segmentsInRange.length > 0 && segmentsInRange.every((seg) => seg.style[key] === true);
      (resolvedPatch as any)[key] = !allActive;
    }
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

/** Expande [start,end) a los límites del/de los párrafo(s) COMPLETOS que
 * toca -- un párrafo es el tramo entre dos '\n' consecutivos (o los bordes
 * del texto). La alineación (a diferencia de negrita/color) nunca tiene
 * sentido sobre "media línea"; esto es lo que deja que un botón de
 * alineación aplicado con una selección parcial (o incluso con el cursor
 * colapsado, start === end) termine cubriendo la línea completa donde
 * está el cursor -- igual que Word. Si la selección cruza varios párrafos,
 * el rango expandido cubre todos ellos completos. */
export function expandRangeToParagraphs(text: string, start: number, end: number): [number, number] {
  const lo = Math.max(0, Math.min(start, end));
  const hi = Math.min(text.length, Math.max(start, end));
  const paraStart = text.lastIndexOf('\n', Math.max(0, lo - 1)) + 1;
  const nextBreak = text.indexOf('\n', hi);
  const paraEnd = nextBreak === -1 ? text.length : nextBreak;
  return [paraStart, paraEnd];
}

/** Recorta/traslada spans para que queden relativos a un sub-rango
 * [from,to) — usado internamente para reutilizar `buildStyledSegments`
 * sobre un tramo del texto sin que los offsets absolutos lo confundan.
 * También exportada para lib/textPagination.ts / PageCanvas.tsx: al partir
 * un bloque de texto en dos (auto-paginación), los spans de negrita/color/
 * etc. deben recortarse y reindexarse igual que aquí. */
export function reindexSpans(spans: TextStyleSpan[], from: number, to: number): TextStyleSpan[] {
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
  // 'underline line-through' cuando las dos están activas a la vez -- CSS
  // real soporta combinar varias líneas de decoración en un solo valor
  // separado por espacio (`text-decoration-line`), no hace falta elegir.
  textDecoration: string;
  color: string;
  fontSize: string;
  fontFamily: string;
  backgroundColor?: string;
}

export function styleToCss(style: EffectiveTextStyle): CssStyleLike {
  const highlight = style.highlightColor;
  const decorations = [style.underline && 'underline', style.strikethrough && 'line-through'].filter(Boolean);
  return {
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: decorations.length > 0 ? decorations.join(' ') : 'none',
    color: style.color,
    fontSize: `${style.fontSize}px`,
    fontFamily: style.fontFamily,
    // 'transparent' o vacío = sin resaltado; no se emite backgroundColor
    // para no pintar un rectángulo transparente inútil sobre cada span.
    ...(highlight && highlight !== 'transparent' ? { backgroundColor: highlight } : {}),
  };
}
