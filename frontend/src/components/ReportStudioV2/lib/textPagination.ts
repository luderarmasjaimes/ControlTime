import { getSharedMeasureCtx, measureWordCached } from './textMeasure';
import { getEffectiveStyleAt, type BaseTextStyle, type TextStyleSpan } from './textSpans';

/**
 * Auto-paginación de bloques de texto (PageCanvas.tsx, handleLiveTyping):
 * cuando un bloque en edición crece más allá del margen inferior de la
 * hoja, en vez de mover el bloque ENTERO a la página siguiente (como hacía
 * antes, ver reflowTextColumnAfterChange en store/useEditorStore.ts), se
 * parte en dos — lo que sí entra se queda en su lugar, el resto continúa
 * en un bloque nuevo al inicio de la hoja siguiente. Pedido explícito del
 * negocio: "que se vea como cambiamos de un bloque a otro sin necesidad de
 * terminar de escribir".
 *
 * Debe usar el MISMO algoritmo de ajuste de línea (mismo ancho por
 * palabra, mismo criterio de salto, MISMO troceo por carácter para una
 * racha sin espacios más ancha que el bloque) que getAutoSizedTextBox en
 * PageCanvas.tsx, o el punto de corte que esta función calcula no
 * coincidiría con dónde el bloque realmente se ve partido en pantalla — o,
 * peor, subestimaría el alto real (una racha de 300 caracteres sin espacios
 * se mediría como UNA sola línea en vez de las decenas que realmente ocupa
 * en pantalla, y el desborde nunca se detectaría). La diferencia con esa
 * función es que aquí SÍ se necesitan los offsets originales de cada
 * palabra/trozo dentro del string fuente (getAutoSizedTextBox normaliza/
 * colapsa espacios porque solo le importa el ancho/alto final, no dónde
 * cortar el string real).
 */

export interface TextHeightSplit {
  /** Texto que cabe en el espacio disponible (subcadena exacta del
   * original, sin recortar). */
  fittingText: string;
  /** Resto del texto, a continuar en un bloque nuevo (subcadena exacta del
   * original, sin espacio/salto de línea sobrante al inicio). */
  overflowText: string;
  /** Offset (en el string original) donde termina `fittingText`. */
  fittingEnd: number;
  /** Offset (en el string original) donde empieza `overflowText`. */
  overflowStart: number;
}

const HORIZONTAL_PADDING = 60;
const VERTICAL_PADDING = 8;

/**
 * Calcula dónde cortar `text` para que la primera parte quepa dentro de
 * `maxHeight` (alto TOTAL del bloque, mismo significado que el `maxHeight`
 * de getAutoSizedTextBox — incluye el padding vertical interno). Devuelve
 * `null` si el texto completo ya cabe (no hace falta partir).
 *
 * `spans`/`base` (opcionales, retrocompatibles): cuando el bloque tiene
 * porciones con su PROPIO fontSize/fontFamily/bold/italic (p.ej. un
 * encabezado pegado dentro de un párrafo normal, ver lib/richPaste.ts),
 * medir TODO con el tamaño uniforme de arriba SUBESTIMA el alto real de esa
 * línea (una porción en fuente más grande necesita más alto por línea del
 * que el tamaño base asume) — el bug real reportado era exactamente este:
 * el cuadro (con overflow:hidden mientras se edita) recortaba contenido
 * real que la vista cerrada sí mostraba completo. Sin `spans` (o sin
 * `base`), el cálculo es IDÉNTICO al de antes.
 */
export function splitTextForHeight(
  text: unknown,
  fontSize: number,
  fontFamily: string,
  bold: boolean,
  italic: boolean,
  lineHeight: number,
  maxWidth: number,
  maxHeight: number,
  spans: TextStyleSpan[] = [],
  base: BaseTextStyle | null = null,
): TextHeightSplit | null {
  const sourceText = String(text ?? '');
  const context = getSharedMeasureCtx();
  const availableForLines = maxHeight - VERTICAL_PADDING;
  const availableContentWidth = Math.max( maxWidth - HORIZONTAL_PADDING);

  if (!context || !sourceText.trim()) return null;

  const hasSpans = spans.length > 0 && !!base;
  const fontSpecFor = (f: { fontSize: number; fontFamily: string; bold: boolean; italic: boolean }) =>
    `${f.italic ? 'italic ' : ''}${f.bold ? '700 ' : ''}${f.fontSize}px ${f.fontFamily}`;
  const fontSpec = fontSpecFor({ fontSize, fontFamily, bold, italic });
  context.font = fontSpec;
  const spaceWidth = measureWordCached(context, fontSpec, '   ') / 3 || measureWordCached(context, fontSpec, 'i');

  // Ancho de una palabra/carácter en su offset ABSOLUTO real dentro de
  // `sourceText` -- si cae bajo un span con su propio tamaño/familia/
  // negrita, se mide con ESE estilo (y se deja el contexto otra vez en el
  // spec base al terminar, para no afectar `spaceWidth` ni mediciones
  // vecinas que sí son del estilo uniforme).
  const measureAt = (chunk: string, offset: number): { width: number; fontSize: number } => {
    if (!hasSpans) return { width: measureWordCached(context, fontSpec, chunk), fontSize };
    const style = getEffectiveStyleAt(spans, base!, offset);
    const spec = fontSpecFor(style);
    context.font = spec;
    const width = measureWordCached(context, spec, chunk);
    context.font = fontSpec;
    return { width, fontSize: style.fontSize };
  };

  let cursorY = 0;
  let fittingEnd = 0;
  let overflowStart: number | null = null;

  /** Confirma la línea [startAbs, endAbs) ya armada: si entra en el alto
   * disponible, avanza `fittingEnd`/`cursorY`; si no, marca dónde empieza
   * el desborde. Devuelve false si hay que detener todo el cálculo.
   * `lineFontSize` es el MAYOR fontSize efectivo entre las palabras que
   * forman esta línea (con spans, una porción en fuente más grande "manda"
   * en el alto de línea, igual que en HTML real cuando conviven tamaños
   * distintos en la misma línea) -- sin spans, siempre es `fontSize`. */
  const commitLine = (startAbs: number, endAbs: number, lineFontSize: number): boolean => {
    const lineH = lineFontSize * lineHeight;
    if (cursorY + lineH <= availableForLines) {
      fittingEnd = endAbs;
      cursorY += lineH;
      return true;
    }
    overflowStart = startAbs;
    return false;
  };

  // Línea en construcción PALABRA A PALABRA: ancho acumulado, si tiene
  // contenido, y el offset (absoluto en sourceText) donde empieza/termina
  // lo ya colocado. Se cierra con commitLine al llegar una palabra que ya
  // no entra, o al terminar el párrafo.
  let lineWidth = 0;
  let lineHasContent = false;
  let lineStartAbs = 0;
  let lineEndAbs = 0;
  let lineFontSize = fontSize;
  const flushLine = (): boolean => {
    if (!lineHasContent) return true;
    const ok = commitLine(lineStartAbs, lineEndAbs, lineFontSize);
    lineWidth = 0;
    lineHasContent = false;
    lineFontSize = fontSize;
    return ok;
  };

  let paragraphOffset = 0;
  const paragraphs = sourceText.split('\n');

  outer: for (let pIndex = 0; pIndex < paragraphs.length; pIndex += 1) {
    const paragraph = paragraphs[pIndex];

    if (!paragraph.trim()) {
      // Línea en blanco explícita (párrafo vacío) — cuenta como una línea
      // propia a efectos de alto, igual que en getAutoSizedTextBox.
      if (!commitLine(paragraphOffset, paragraphOffset + paragraph.length, fontSize)) break outer;
      paragraphOffset += paragraph.length + 1;
      continue;
    }

    const wordRegex = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(paragraph)) !== null) {
      const wordText = match[0];
      const wordAbsStart = paragraphOffset + match.index;
      const wordAbsEnd = wordAbsStart + wordText.length;
      const { width: wordWidth, fontSize: wordFontSize } = measureAt(wordText, wordAbsStart);
      const candidateWidth = lineHasContent ? lineWidth + spaceWidth + wordWidth : wordWidth;

      if (candidateWidth <= availableContentWidth) {
        if (!lineHasContent) lineStartAbs = wordAbsStart;
        lineWidth = candidateWidth;
        lineHasContent = true;
        lineEndAbs = wordAbsEnd;
        lineFontSize = Math.max(lineFontSize, wordFontSize);
        continue;
      }

      // No entra en la línea actual: cerrarla y reintentar esta palabra en
      // una línea nueva.
      if (lineHasContent) {
        if (!flushLine()) break outer;
      }

      if (wordWidth <= availableContentWidth) {
        lineStartAbs = wordAbsStart;
        lineWidth = wordWidth;
        lineHasContent = true;
        lineEndAbs = wordAbsEnd;
        lineFontSize = wordFontSize;
        continue;
      }

      // Racha sin espacios más ancha que el bloque completo (id largo,
      // URL, o —como al forzar el desborde escribiendo la misma letra sin
      // cortes— cualquier corrida de caracteres): trocear por carácter,
      // cada trozo (incluido el último) ocupa y CIERRA su propia línea de
      // inmediato — mismo criterio que pushWordByChunks en
      // getAutoSizedTextBox (PageCanvas.tsx). Sin esto, esta racha se
      // contaba como UNA sola línea de alto sin importar cuántos
      // caracteres tuviera, y el desborde real nunca se detectaba.
      let chunkText = '';
      let chunkWidth = 0;
      let chunkStartAbs = wordAbsStart;
      let chunkFontSize = fontSize;
      let cursor = wordAbsStart;
      for (const ch of wordText) {
        const { width: chWidth, fontSize: chFontSize } = measureAt(ch, cursor);
        if (chunkWidth + chWidth <= availableContentWidth) {
          if (!chunkText) chunkStartAbs = cursor;
          chunkText += ch;
          chunkWidth += chWidth;
          chunkFontSize = Math.max(chunkFontSize, chFontSize);
          cursor += ch.length;
          continue;
        }
        if (chunkText && !commitLine(chunkStartAbs, chunkStartAbs + chunkText.length, chunkFontSize)) break outer;
        chunkText = ch;
        chunkWidth = chWidth;
        chunkFontSize = chFontSize;
        chunkStartAbs = cursor;
        cursor += ch.length;
      }
      if (chunkText && !commitLine(chunkStartAbs, chunkStartAbs + chunkText.length, chunkFontSize)) break outer;
      lineHasContent = false;
      lineWidth = 0;
      lineFontSize = fontSize;
    }

    if (!flushLine()) break outer;
    paragraphOffset += paragraph.length + 1;
  }

  if (overflowStart === null) return null;

  const fittingText = sourceText.slice(0, fittingEnd);
  const overflowText = sourceText.slice(overflowStart);
  if (!fittingText.trim() || !overflowText.trim()) return null;

  return { fittingText, overflowText, fittingEnd, overflowStart };
}
