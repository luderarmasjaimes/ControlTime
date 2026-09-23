import type { ReportElement } from '../../../../store/useEditorStore';
import { getSharedMeasureCtx, measureWordCached } from '../../../../lib/textMeasure';
import {
  type TextStyleSpan,
  type BaseTextStyle,
  type EffectiveTextStyle,
  sanitizeSpans,
  getEffectiveStyleAt,
} from '../../../../lib/textSpans';

/**
 * Modelo/utilidades PURAS del bloque de texto -- sin React, sin store, sin
 * DOM más allá de un `<canvas>` de medición offscreen (ver
 * lib/textMeasure.ts). Compartido entre PageCanvas.tsx (que todavía maneja
 * el estado "singleton" de edición -- cuál bloque está abierto, dictado,
 * corrector ortográfico en vivo, cursor visual propio -- ver los
 * `useEffect` de esa sección, dejados ahí a propósito porque no son "la
 * funcionalidad de UN bloque" sino coordinación de página) y
 * `TextBlock.tsx` (el render de cada bloque de texto individual). Antes
 * TODO esto vivía duplicado en el mismo archivo gigante que el render; una
 * sola fuente de verdad evita que ambos lados diverjan.
 */

export interface TextProps {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  backgroundColor: string;
  textAlign: string;
  lineHeight: number;
  indentLeft: number;
  indentRight: number;
  specialIndent: 'none' | 'firstLine' | 'hanging';
  specialIndentBy: number;
  spacingBefore: number;
  spacingAfter: number;
  listType: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Estilo de encabezado del BLOQUE completo ('title'|'h1'..'h6'|'normal'|
   * 'quote'), aplicado por el ribbon (onApplyHeadingStyle). '' = sin
   * encabezado. Se agrega acá para poder leerlo como base del estilo por
   * selección (ver textBaseStyle) y para el selector de encabezado de la
   * barra flotante. */
  headingStyle: string;
  /** Color de RESALTADO (marcador) del BLOQUE completo cuando se aplica
   * desde el ribbon fijo SIN selección de texto activa — distinto de
   * `backgroundColor` (el fondo de todo el cuadro/caja) y del
   * `highlightColor` por SPAN (barra flotante, solo la porción
   * seleccionada). Sirve de estilo "base" cuando no hay spans que lo
   * cubran, igual que `fontColor` con `color`. */
  highlightColor: string;
  /** Formato por selección (negrita/color/tamaño/fuente solo en una parte
   * del texto) — ver lib/textSpans.ts. Vacío = comportamiento histórico
   * (todo el bloque usa las props de arriba de forma uniforme). */
  spans: TextStyleSpan[];
}

export const DEFAULT_TEXT_PROPS: TextProps = {
  text: '',
  fontFamily: 'Arial',
  fontSize: 16,
  fontColor: '#0f172a',
  backgroundColor: 'transparent',
  textAlign: 'left',
  lineHeight: 1.35,
  indentLeft: 0,
  indentRight: 0,
  specialIndent: 'none',
  specialIndentBy: 0,
  spacingBefore: 0,
  spacingAfter: 0,
  listType: 'none',
  bold: false,
  italic: false,
  underline: false,
  headingStyle: '',
  highlightColor: 'transparent',
  spans: [],
};

export function getTextProps(element: ReportElement): TextProps {
  const props = element.props || {};
  const text = props.text == null ? '' : String(props.text);
  return {
    text,
    fontFamily: String(props.fontFamily ?? DEFAULT_TEXT_PROPS.fontFamily),
    fontSize: Number(props.fontSize ?? DEFAULT_TEXT_PROPS.fontSize),
    fontColor: String(props.fontColor ?? DEFAULT_TEXT_PROPS.fontColor),
    backgroundColor: String(props.backgroundColor ?? DEFAULT_TEXT_PROPS.backgroundColor),
    textAlign: String(props.textAlign ?? DEFAULT_TEXT_PROPS.textAlign),
    lineHeight: Number(props.lineHeight ?? DEFAULT_TEXT_PROPS.lineHeight),
    indentLeft: Math.max(0, Number(props.indentLeft ?? DEFAULT_TEXT_PROPS.indentLeft) || 0),
    indentRight: Math.max(0, Number(props.indentRight ?? DEFAULT_TEXT_PROPS.indentRight) || 0),
    specialIndent: props.specialIndent === 'firstLine' || props.specialIndent === 'hanging' ? props.specialIndent : 'none',
    specialIndentBy: Math.max(0, Number(props.specialIndentBy ?? DEFAULT_TEXT_PROPS.specialIndentBy) || 0),
    spacingBefore: Math.max(0, Number(props.spacingBefore ?? DEFAULT_TEXT_PROPS.spacingBefore) || 0),
    spacingAfter: Math.max(0, Number(props.spacingAfter ?? DEFAULT_TEXT_PROPS.spacingAfter) || 0),
    listType: String(props.listType ?? DEFAULT_TEXT_PROPS.listType),
    bold: Boolean(props.bold ?? DEFAULT_TEXT_PROPS.bold),
    italic: Boolean(props.italic ?? DEFAULT_TEXT_PROPS.italic),
    // Bug real encontrado: el botón "Subrayar" (RibbonToolbar) y
    // `props.underline` ya existían y se guardaban, pero ni el <Text> de
    // Konva ni el <textarea> de edición los leían — el toggle no tenía
    // ningún efecto visual. Corregido acá y en el render.
    underline: Boolean(props.underline ?? DEFAULT_TEXT_PROPS.underline),
    headingStyle: String(props.headingStyle ?? DEFAULT_TEXT_PROPS.headingStyle),
    highlightColor: String(props.highlightColor ?? DEFAULT_TEXT_PROPS.highlightColor),
    spans: sanitizeSpans(props.spans, text.length),
  };
}

export function normalizeDictationText(rawText: string): string {
  const normalized = ` ${rawText.toLowerCase()} `
    .replace(/\s+punto y coma\s+/g, '; ')
    .replace(/\s+dos puntos\s+/g, ': ')
    .replace(/\s+nueva linea\s+/g, '\n')
    .replace(/\s+nueva línea\s+/g, '\n')
    .replace(/\s+salto de linea\s+/g, '\n')
    .replace(/\s+salto de línea\s+/g, '\n')
    .replace(/\s+abrir parentesis\s+/g, ' (')
    .replace(/\s+abrir paréntesis\s+/g, ' (')
    .replace(/\s+cerrar parentesis\s+/g, ') ')
    .replace(/\s+cerrar paréntesis\s+/g, ') ')
    .replace(/\s+coma\s+/g, ', ')
    .replace(/\s+punto\s+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

export function isLikelyLowQualityTranscript(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return true;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return true;
  }

  const weakTokens = new Set(['eh', 'mmm', 'uh', 'ah', 'ruido', 'hmm']);
  const tokens = normalized.split(' ').filter(Boolean);

  if (tokens.length === 1 && tokens[0].length <= 2) {
    return true;
  }

  if (tokens.length <= 2 && tokens.every((token) => weakTokens.has(token))) {
    return true;
  }

  return false;
}

export function pickBestTranscriptAlternative(result: any): { transcript: string; confidence: number } {
  let bestTranscript = '';
  let bestConfidence = -1;

  const alternativesCount = Number(result?.length ?? 0);
  for (let altIndex = 0; altIndex < alternativesCount; altIndex += 1) {
    const candidate = result[altIndex];
    const transcript = String(candidate?.transcript || '').trim();
    const confidenceValue = Number(candidate?.confidence ?? 0);

    if (!transcript) {
      continue;
    }

    if (confidenceValue > bestConfidence) {
      bestConfidence = confidenceValue;
      bestTranscript = transcript;
      continue;
    }

    if (confidenceValue === bestConfidence && transcript.length > bestTranscript.length) {
      bestTranscript = transcript;
    }
  }

  if (!bestTranscript && result?.[0]?.transcript) {
    return {
      transcript: String(result[0].transcript),
      confidence: Number(result[0].confidence ?? 0),
    };
  }

  return {
    transcript: bestTranscript,
    confidence: Math.max(0, bestConfidence),
  };
}

export function getSpellcheckLang(): string {
  if (typeof navigator === 'undefined') {
    return 'es-PE';
  }

  const preferred = [navigator.language, ...(navigator.languages || [])]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  if (preferred.some((value) => value.startsWith('es'))) {
    return 'es-PE';
  }

  return 'es-PE';
}

/** Web Speech API sin tipos oficiales del DOM lib; se usa `any` para SpeechRecognition. */
export function getSpeechCtor(): any {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const speechWindow = window as any;
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
}

export interface AdvancedSuggestion {
  offset: number;
  length: number;
  message: string;
  replacements: string[];
  context: string;
}

/* ── Ajuste de texto alrededor de objetos (ADR-049, estilo Word) ──────────
   Port del mecanismo de rangos por línea de ONLYOffice (sdkjs):
   - WrapManager.checkRanges (WrapManager.js:807-1013): cada objeto flotante
     aporta un intervalo X prohibido; los intervalos se ordenan y fusionan.
   - private_RecalculateLineFillRanges (Paragraph_Recalculate.js:1116-1200):
     los huecos ENTRE prohibidos son los sub-rangos permitidos de la línea —
     una línea puede quedar partida en varios tramos (texto a la izquierda Y
     a la derecha de la imagen).
   Solo se implementan los dos modos útiles para informes: 'square'
   (rect del objeto excluido, texto a ambos lados) y 'topbottom' (la línea
   completa se salta el tramo vertical del objeto). 'Tight/Through'
   (polígono) quedan fuera a propósito — maquinaria pesada de CWrapPolygon
   sin beneficio para layouts de informe. */
export interface WrapExclusion {
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
  mode: 'square' | 'topbottom';
}

export interface WrappedSegment {
  text: string;
  x: number;
  y: number;
  /** Estilo efectivo del tramo (formato por selección, lib/textSpans.ts) —
   * cada segmento emitido tiene estilo UNIFORME; un cambio de estilo a
   * mitad de línea produce segmentos separados con x contiguos. */
  style: EffectiveTextStyle;
}

/** Fragmento de palabra con estilo uniforme — una palabra que cruza un
 * límite de span se parte en varios frags que SIEMPRE se colocan juntos
 * (la unidad de salto de línea sigue siendo la palabra completa). */
interface WordFrag {
  text: string;
  style: EffectiveTextStyle;
  fontSpec: string;
  width: number;
}

const fontSpecOf = (s: EffectiveTextStyle) =>
  `${s.italic ? 'italic ' : ''}${s.bold ? '700 ' : ''}${s.fontSize}px ${s.fontFamily}`;

export function computeWrappedTextLines(
  text: unknown,
  base: BaseTextStyle,
  lineHeight: number,
  contentWidth: number,
  exclusions: WrapExclusion[],
  spans: TextStyleSpan[],
): { segments: WrappedSegment[]; totalHeight: number } {
  const sourceText = String(text ?? '');
  const context = getSharedMeasureCtx();
  // Altura de línea uniforme para todo el bloque, usando el tamaño de
  // fuente MÁS GRANDE presente (base o algún span) — mismo criterio simple
  // que un procesador de texto con "interlineado exacto": líneas parejas,
  // sin recalcular alto línea a línea.
  const maxFontSize = Math.max(base.fontSize, ...spans.map((s) => s.fontSize ?? base.fontSize));
  const lineH = maxFontSize * lineHeight;
  if (!context || !sourceText.trim()) {
    return { segments: [], totalHeight: lineH };
  }
  const baseSpec = fontSpecOf(base);
  context.font = baseSpec;
  const spaceWidth = measureWordCached(context, baseSpec, '   ') / 3 || measureWordCached(context, baseSpec, 'i');

  /** Parte la palabra [wStart,wEnd) del texto fuente en frags por límite de
   * span, cada uno medido con SU estilo (negrita/tamaño/fuente propios). */
  const fragmentWord = (wStart: number, wEnd: number): WordFrag[] => {
    const cuts = new Set<number>([wStart, wEnd]);
    for (const span of spans) {
      if (span.start > wStart && span.start < wEnd) cuts.add(span.start);
      if (span.end > wStart && span.end < wEnd) cuts.add(span.end);
    }
    const sorted = Array.from(cuts).sort((a, b) => a - b);
    const frags: WordFrag[] = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const style = getEffectiveStyleAt(spans, base, from);
      const spec = fontSpecOf(style);
      context.font = spec;
      const fragText = sourceText.slice(from, to);
      frags.push({ text: fragText, style, fontSpec: spec, width: measureWordCached(context, spec, fragText) });
    }
    return frags;
  };

  const segments: WrappedSegment[] = [];
  let cursorY = 0;

  /** Sub-rangos X permitidos para la banda vertical [top, bot) — los huecos
   * entre exclusiones 'square' fusionadas; null = línea salteada por un
   * objeto 'topbottom' (devuelve el Y donde retomar). */
  const rangesForLine = (top: number, bot: number): { ranges: Array<[number, number]> } | { skipToY: number } => {
    const active = exclusions.filter((e) => e.yBot > top && e.yTop < bot);
    const tb = active.filter((e) => e.mode === 'topbottom');
    if (tb.length > 0) {
      return { skipToY: Math.max(...tb.map((e) => e.yBot)) };
    }
    const cuts = active
      .map((e) => [Math.max(0, e.x0), Math.min(contentWidth, e.x1)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((p, q) => p[0] - q[0]);
    const merged: Array<[number, number]> = [];
    for (const [a, b] of cuts) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    const ranges: Array<[number, number]> = [];
    let cursor = 0;
    for (const [a, b] of merged) {
      if (a - cursor >= base.fontSize) ranges.push([cursor, a]); // hueco útil (≥ ~1 carácter)
      cursor = Math.max(cursor, b);
    }
    if (contentWidth - cursor >= base.fontSize) ranges.push([cursor, contentWidth]);
    return { ranges };
  };

  const maxExclusionBottom = exclusions.length ? Math.max(...exclusions.map((e) => e.yBot)) : 0;

  // Offsets GLOBALES de cada palabra dentro de sourceText — necesarios para
  // resolver el estilo por span de cada fragmento (los spans usan offsets
  // absolutos del string completo, incluyendo los '\n').
  let paragraphOffset = 0;
  for (const paragraph of sourceText.split('\n')) {
    const words: WordFrag[][] = [];
    const wordRegex = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(paragraph)) !== null) {
      words.push(fragmentWord(paragraphOffset + match.index, paragraphOffset + match.index + match[0].length));
    }
    paragraphOffset += paragraph.length + 1; // +1 por el '\n' consumido por split
    if (words.length === 0) {
      cursorY += lineH;
      continue;
    }
    let wordIndex = 0;
    while (wordIndex < words.length) {
      const band = rangesForLine(cursorY, cursorY + lineH);
      if ('skipToY' in band) {
        cursorY = Math.max(band.skipToY, cursorY + lineH);
        continue;
      }
      let placedAnyInLine = false;
      for (const [rx0, rx1] of band.ranges) {
        if (wordIndex >= words.length) break;
        const segWidth = rx1 - rx0;
        // Acumulador de "runs": frags consecutivos con el MISMO estilo se
        // concatenan en un solo segmento (menos nodos Konva); un cambio de
        // estilo cierra el run y abre otro en el x acumulado.
        let penX = rx0;
        let runText = '';
        let runStyle: EffectiveTextStyle | null = null;
        let runStartX = rx0;
        const flushRun = () => {
          if (runText && runStyle) {
            segments.push({ text: runText, x: runStartX, y: cursorY, style: runStyle });
            placedAnyInLine = true;
          }
          runText = '';
          runStyle = null;
        };
        const placeFrag = (frag: WordFrag) => {
          if (runStyle && runStyle === frag.style) {
            runText += frag.text;
          } else if (runStyle && fontSpecOf(runStyle) === frag.fontSpec && runStyle.color === frag.style.color && runStyle.underline === frag.style.underline) {
            // Mismo estilo por valor (objetos distintos) — seguir el run.
            runText += frag.text;
          } else {
            flushRun();
            runStartX = penX;
            runStyle = frag.style;
            runText = frag.text;
          }
          penX += frag.width;
        };
        let lineWidth = 0;
        while (wordIndex < words.length) {
          const word = words[wordIndex];
          const wordWidth = word.reduce((acc, f) => acc + f.width, 0);
          const candidate = lineWidth > 0 ? lineWidth + spaceWidth + wordWidth : wordWidth;
          if (candidate <= segWidth) {
            if (lineWidth > 0) {
              // Espacio entre palabras: se agrega al run activo (mismo
              // estilo que la palabra anterior) y avanza el lápiz.
              runText += ' ';
              penX += spaceWidth;
            }
            for (const frag of word) placeFrag(frag);
            lineWidth = candidate;
            wordIndex += 1;
            continue;
          }
          // Palabra más ancha que CUALQUIER espacio disponible (aún sin
          // exclusiones activas): trocearla por caracteres para no ciclar.
          if (lineWidth === 0 && wordWidth > contentWidth && segWidth >= contentWidth - 1) {
            let remaining = segWidth;
            const rest: WordFrag[] = [];
            for (let fi = 0; fi < word.length; fi += 1) {
              const frag = word[fi];
              if (rest.length > 0) { rest.push(frag); continue; }
              if (frag.width <= remaining) {
                placeFrag(frag);
                remaining -= frag.width;
                continue;
              }
              context.font = frag.fontSpec;
              let chunk = '';
              let chunkWidth = 0;
              for (const char of frag.text) {
                const cw = measureWordCached(context, frag.fontSpec, char);
                if (chunkWidth + cw > remaining && chunk) break;
                chunk += char;
                chunkWidth += cw;
              }
              if (chunk) placeFrag({ ...frag, text: chunk, width: chunkWidth });
              const restText = frag.text.slice(chunk.length);
              if (restText) {
                context.font = frag.fontSpec;
                rest.push({ ...frag, text: restText, width: measureWordCached(context, frag.fontSpec, restText) });
              }
              remaining = 0;
            }
            if (rest.length > 0) words[wordIndex] = rest;
            else wordIndex += 1;
          }
          break;
        }
        flushRun();
      }
      if (wordIndex < words.length) {
        cursorY += lineH;
        // Línea totalmente bloqueada y ya por debajo de todos los objetos:
        // no puede pasar (rangesForLine devolvería el ancho completo), pero
        // por robustez, si no se colocó nada y no hay exclusiones restantes
        // hacia abajo, evitar un bucle infinito troceando en el siguiente
        // ciclo (la guardia de palabra-más-ancha se encarga).
        if (!placedAnyInLine && cursorY > maxExclusionBottom + lineH * 200) {
          break;
        }
      } else {
        cursorY += lineH;
      }
    }
  }

  return { segments, totalHeight: Math.max(lineH, cursorY) };
}

export function getAutoSizedTextBox(
  text: unknown,
  fontSize: number,
  fontFamily: string,
  bold: boolean,
  italic: boolean,
  lineHeight: number,
  minWidth: number,
  minHeight: number,
  maxWidth: number,
  maxHeight: number,
  // Mientras se está editando, deja siempre una línea en blanco visible
  // debajo de la última línea escrita (como el espacio que Word deja para
  // seguir tecleando) — pedido explícito: "la parte inferior debe mostrar
  // siempre una línea en blanco según la línea que se está escribiendo".
  // Solo aplica en vivo: el bloque YA CERRADO (no editando) se ajusta
  // exacto al contenido, sin la línea de cortesía de más.
  reserveTrailingLine = false,
  // `spans`/`base` (opcionales, retrocompatibles): cuando el bloque tiene
  // porciones con su PROPIO fontSize/fontFamily/bold/italic (p.ej. un
  // encabezado pegado dentro de un párrafo normal, ver lib/richPaste.ts),
  // medir TODO con el tamaño uniforme de arriba SUBESTIMA el alto real --
  // bug real reportado: el cuadro de edición (overflow:hidden) recortaba
  // contenido que la vista cerrada (sin ese límite) sí mostraba completo,
  // justo porque esta función nunca se enteraba de que una porción del
  // texto necesitaba más alto de línea. Sin `spans` (o sin `base`), el
  // cálculo es IDÉNTICO al de antes.
  spans: TextStyleSpan[] = [],
  base: BaseTextStyle | null = null,
): { width: number; height: number } {
  const safeMaxWidth = Math.max(minWidth, maxWidth);
  const safeMaxHeight = Math.max(minHeight, maxHeight);
  const horizontalPadding = 16;
  const verticalPadding = 16;
  const availableContentWidth = Math.max(20, safeMaxWidth - horizontalPadding);
  const rawText = String(text ?? '');
  const sourceText = rawText.trim();

  if (!sourceText) {
    return { width: minWidth, height: minHeight };
  }

  const context = getSharedMeasureCtx();
  if (!context) {
    return { width: minWidth, height: minHeight };
  }

  const hasSpans = spans.length > 0 && !!base;
  // Los spans están indexados sobre el string ORIGINAL (sin trim); `.trim()`
  // arriba puede correr todos los offsets si había espacio/salto de línea
  // al inicio -- se compensa sumando ese recorte antes de consultar spans.
  const leadingTrim = rawText.length - rawText.replace(/^\s+/, '').length;
  const fontSpecFor = (f: { fontSize: number; fontFamily: string; bold: boolean; italic: boolean }) =>
    `${f.italic ? 'italic ' : ''}${f.bold ? '700 ' : ''}${f.fontSize}px ${f.fontFamily}`;
  const fontSpec = fontSpecFor({ fontSize, fontFamily, bold, italic });
  context.font = fontSpec;

  const measureAt = (chunk: string, offsetInSource: number): { width: number; fontSize: number } => {
    if (!hasSpans) return { width: measureWordCached(context, fontSpec, chunk), fontSize };
    const style = getEffectiveStyleAt(spans, base!, offsetInSource + leadingTrim);
    const spec = fontSpecFor(style);
    context.font = spec;
    const width = measureWordCached(context, spec, chunk);
    context.font = fontSpec;
    return { width, fontSize: style.fontSize };
  };

  const visualLines: { text: string; lineFontSize: number }[] = [];
  const paragraphs = sourceText.split('\n');

  // Como en sdkjs, el ancho de una línea se ACUMULA sumando anchos ya
  // conocidos (allí por glifo, aquí por palabra + un ancho de espacio
  // cacheado) — nunca se re-mide la línea completa concatenada, que es una
  // cadena casi única en la que ningún caché acierta. La suma ignora el
  // kerning entre palabras, una desviación de sub-píxel irrelevante para
  // estimar el quiebre de línea.
  const spaceWidth = measureWordCached(context, fontSpec, '   ') / 3 || measureWordCached(context, fontSpec, 'i');
  let maxLineWidth = 0;
  const pushLine = (lineText: string, lineWidth: number, lineFontSize: number) => {
    visualLines.push({ text: lineText, lineFontSize });
    if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
  };

  const pushWordByChunks = (word: string, wordOffsetInSource: number) => {
    let chunk = '';
    let chunkWidth = 0;
    let chunkFontSize = fontSize;
    let idx = 0;
    for (const char of word) {
      const { width: charWidth, fontSize: charFontSize } = measureAt(char, wordOffsetInSource + idx);
      idx += char.length;
      if (chunkWidth + charWidth <= availableContentWidth) {
        chunk += char;
        chunkWidth += charWidth;
        chunkFontSize = Math.max(chunkFontSize, charFontSize);
        continue;
      }

      if (chunk) {
        pushLine(chunk, chunkWidth, chunkFontSize);
      }
      chunk = char;
      chunkWidth = charWidth;
      chunkFontSize = charFontSize;
    }
    if (chunk) {
      pushLine(chunk, chunkWidth, chunkFontSize);
    }
  };

  let paragraphOffsetInSource = 0;
  for (const paragraph of paragraphs) {
    const normalizedParagraph = paragraph.trim();
    if (!normalizedParagraph) {
      visualLines.push({ text: '', lineFontSize: fontSize });
      paragraphOffsetInSource += paragraph.length + 1;
      continue;
    }

    let currentLine = '';
    let currentWidth = 0;
    let currentLineFontSize = fontSize;

    const wordMatches = Array.from(paragraph.matchAll(/\S+/g));
    for (const m of wordMatches) {
      const word = m[0];
      const wordOffsetInSource = paragraphOffsetInSource + (m.index ?? 0);
      const { width: wordWidth, fontSize: wordFontSize } = measureAt(word, wordOffsetInSource);
      const candidateWidth = currentLine ? currentWidth + spaceWidth + wordWidth : wordWidth;
      if (candidateWidth <= availableContentWidth) {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
        currentWidth = candidateWidth;
        currentLineFontSize = Math.max(currentLineFontSize, wordFontSize);
        continue;
      }

      if (currentLine) {
        pushLine(currentLine, currentWidth, currentLineFontSize);
        currentLine = '';
        currentWidth = 0;
        currentLineFontSize = fontSize;
      }

      if (wordWidth <= availableContentWidth) {
        currentLine = word;
        currentWidth = wordWidth;
        currentLineFontSize = wordFontSize;
      } else {
        pushWordByChunks(word, wordOffsetInSource);
      }
    }

    if (currentLine) {
      pushLine(currentLine, currentWidth, currentLineFontSize);
    }
    paragraphOffsetInSource += paragraph.length + 1;
  }

  const measuredLineWidth = maxLineWidth;

  const contentHeightSum = visualLines.reduce((sum, line) => sum + line.lineFontSize * lineHeight, 0)
    || fontSize * lineHeight;
  const trailingLineHeight = reserveTrailingLine ? fontSize * lineHeight : 0;
  const calculatedWidth = Math.ceil(measuredLineWidth + horizontalPadding);
  const calculatedHeight = Math.ceil(contentHeightSum + trailingLineHeight + verticalPadding);

  return {
    width: Math.min(safeMaxWidth, Math.max(minWidth, calculatedWidth)),
    height: Math.min(safeMaxHeight, Math.max(minHeight, calculatedHeight)),
  };
}
