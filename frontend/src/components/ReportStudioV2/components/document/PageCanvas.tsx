import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import { Html } from 'react-konva-utils';
import {
  Wand2,
  Mic,
  MicOff,
  CheckCheck,
  Save,
  Bold,
  Italic,
  Underline,
  Highlighter,
} from 'lucide-react';
import { useEditorStore, defaultBorderByType, resolvePagePaperSetup, type ReportElement, type ReportPage } from '../../store/useEditorStore';
import { getReportLayoutMetrics } from '../../lib/reportLayoutMetrics';
import { getSession } from '../../../../auth/authStorage';
import { resolveMiningUnitName } from '../../lib/sessionChrome';
import { WRAP_MODE_OPTIONS, normalizeWrapMode } from '../layout/RightInspector';

/** Tipografía "impactante" de plataforma para encabezado/pie de página fijos
 * (ADR-046 revisado) — Arial Black (o su fallback sans-serif bold) a 9px,
 * la misma en ambos bloques para que luzcan como una sola franja corporativa
 * consistente, no como texto de contenido editable. */
const PLATFORM_CHROME_FONT = "'Arial Black', 'Arial Bold', Arial, sans-serif";
const PLATFORM_CHROME_FONT_SIZE = 9;
/** Gris de encabezado/pie estilo Word (Word usa un gris ~#595959 para texto
 * de encabezado/pie por defecto, no negro puro) — pedido explícito del
 * usuario tras ver el primer color (#0f172a, casi negro) demasiado oscuro. */
const PLATFORM_CHROME_COLOR = '#595959';
import {
  textCorrectQuick,
  textCorrectAdvanced,
  textRewriteOnPremise,
} from '../../lib/api';
import { textForSpellOrRewrite } from '../../lib/textSpellUtils';
import { measurePerfAsync } from '../../lib/performanceMonitor';
import { resolveReportImageSrc } from '../../lib/reportImageSrc';
import LiveChartBlock from '../dashboard/LiveChartBlock';
import TableBlock from './TableBlock';
import SensorWidget from './SensorWidget';
import MiningKpiWidget from './MiningKpiWidget';
import FloatingContextualToolbar from './FloatingContextualToolbar';
import { generateTocData } from './TableOfContents';
import { getTenantLogoDataUrl } from '../../lib/tenantLogo';
import ColorPalette from '../shared/ColorPalette';
import {
  type TextStyleSpan,
  type BaseTextStyle,
  type EffectiveTextStyle,
  sanitizeSpans,
  buildStyledSegments,
  applyStyleToRange,
  remapSpansForTextChange,
  styleToCss,
  getEffectiveStyleAt,
} from '../../lib/textSpans';
import { registerActiveTextFormatHandler, registerActiveCaseHandler } from '../../lib/activeTextFormatBridge';
import { SELECTION_HEADING_OPTIONS, findHeadingStyle } from '../../lib/headingStyles';

const GRID = 12;

/** Logo corporativo del encabezado — carga async (fetch + cache, ver
 * lib/tenantLogo.ts) con placeholder discreto mientras no hay logo
 * configurado o falla la red y no hay copia cacheada (nunca bloquea el
 * render del resto del encabezado). */
function HeaderLogoImg({ tenantId }: { tenantId?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!tenantId) {
      setSrc(null);
      return undefined;
    }
    getTenantLogoDataUrl(tenantId).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (!src) {
    return (
      <div style={{
        width: 90, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: '#cbd5e1', fontStyle: 'italic', textAlign: 'right',
      }}>
        {tenantId ? '' : 'Sin logo'}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Logotipo de la empresa"
      style={{ height: '100%', width: 'auto', maxWidth: 140, objectFit: 'contain', display: 'block' }}
    />
  );
}

interface TextProps {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  backgroundColor: string;
  textAlign: string;
  lineHeight: number;
  listType: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Estilo de encabezado del BLOQUE completo ('title'|'h1'..'h6'|'normal'|
   * 'quote'), aplicado por el ribbon (onApplyHeadingStyle). '' = sin
   * encabezado. Ya lo escribía App.tsx directo en props.headingStyle sin
   * pasar por este tipo; se agrega acá para poder leerlo como base del
   * estilo por selección (ver textBaseStyle) y para el nuevo selector de
   * encabezado de la barra flotante. */
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

const DEFAULT_TEXT_PROPS: TextProps = {
  text: '',
  fontFamily: 'Arial',
  fontSize: 16,
  fontColor: '#0f172a',
  backgroundColor: 'transparent',
  textAlign: 'left',
  lineHeight: 1.35,
  listType: 'none',
  bold: false,
  italic: false,
  underline: false,
  headingStyle: '',
  highlightColor: 'transparent',
  spans: [],
};

function getTextProps(element: ReportElement): TextProps {
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
    listType: String(props.listType ?? DEFAULT_TEXT_PROPS.listType),
    bold: Boolean(props.bold ?? DEFAULT_TEXT_PROPS.bold),
    italic: Boolean(props.italic ?? DEFAULT_TEXT_PROPS.italic),
    // Bug real encontrado: el botón "Subrayar" (RibbonToolbar) y
    // `props.underline` ya existían y se guardaban, pero ni el <Text> de
    // Konva ni el <textarea> de edición los leían — el toggle no tenía
    // ningún efecto visual. Corregido acá y en el render de abajo.
    underline: Boolean(props.underline ?? DEFAULT_TEXT_PROPS.underline),
    headingStyle: String(props.headingStyle ?? DEFAULT_TEXT_PROPS.headingStyle),
    highlightColor: String(props.highlightColor ?? DEFAULT_TEXT_PROPS.highlightColor),
    spans: sanitizeSpans(props.spans, text.length),
  };
}

function applyListToText(rawText: string, listType: string): string {
  if (listType === 'none') {
    return rawText;
  }

  const lines = rawText.split('\n');
  if (listType === 'bullet') {
    return lines.map((line) => (line.trim() ? `• ${line.replace(/^•\s*/, '')}` : line)).join('\n');
  }

  return lines
    .map((line, index) => {
      if (!line.trim()) {
        return line;
      }
      return `${index + 1}. ${line.replace(/^\d+\.\s*/, '')}`;
    })
    .join('\n');
}

function normalizeDictationText(rawText: string): string {
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

function isLikelyLowQualityTranscript(rawText: string): boolean {
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

function pickBestTranscriptAlternative(result: any): { transcript: string; confidence: number } {
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

/* ── Medidor de texto singleton + caché de anchos de palabra ──────────────
   Patrón tomado del motor de ONLYOffice (sdkjs): un ÚNICO medidor
   compartido (`g_oTextMeasurer`, Run.js) en vez de crear un <canvas> por
   llamada, y anchos cacheados por (fuente, texto) en vez de re-medir lo
   mismo en cada tecla (grapheme.js/file.js cachean por glifo; aquí basta
   granularidad de palabra). Antes, CADA pulsación creaba un canvas nuevo y
   re-medía TODO el bloque palabra por palabra — el costo dominante del
   editor. */
let sharedMeasureCtx: CanvasRenderingContext2D | null = null;
function getSharedMeasureCtx(): CanvasRenderingContext2D | null {
  if (sharedMeasureCtx) return sharedMeasureCtx;
  if (typeof document === 'undefined') return null;
  sharedMeasureCtx = document.createElement('canvas').getContext('2d');
  return sharedMeasureCtx;
}

const WORD_WIDTH_CACHE_MAX = 20000;
const wordWidthCache = new Map<string, number>();
function measureWordCached(context: CanvasRenderingContext2D, fontSpec: string, word: string): number {
  const key = `${fontSpec} ${word}`;
  const hit = wordWidthCache.get(key);
  if (hit !== undefined) return hit;
  const width = context.measureText(word).width;
  if (wordWidthCache.size >= WORD_WIDTH_CACHE_MAX) wordWidthCache.clear();
  wordWidthCache.set(key, width);
  return width;
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
interface WrapExclusion {
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
  mode: 'square' | 'topbottom';
}

interface WrappedSegment {
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

function computeWrappedTextLines(
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

function getAutoSizedTextBox(
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
): { width: number; height: number } {
  const safeMaxWidth = Math.max(minWidth, maxWidth);
  const safeMaxHeight = Math.max(minHeight, maxHeight);
  const horizontalPadding = 16;
  const verticalPadding = 16;
  const availableContentWidth = Math.max(20, safeMaxWidth - horizontalPadding);
  const sourceText = String(text ?? '').trim();

  if (!sourceText) {
    return { width: minWidth, height: minHeight };
  }

  const context = getSharedMeasureCtx();
  if (!context) {
    return { width: minWidth, height: minHeight };
  }

  const fontSpec = `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${fontSize}px ${fontFamily}`;
  context.font = fontSpec;

  const visualLines: string[] = [];
  const paragraphs = sourceText.split('\n');

  // Como en sdkjs, el ancho de una línea se ACUMULA sumando anchos ya
  // conocidos (allí por glifo, aquí por palabra + un ancho de espacio
  // cacheado) — nunca se re-mide la línea completa concatenada, que es una
  // cadena casi única en la que ningún caché acierta. La suma ignora el
  // kerning entre palabras, una desviación de sub-píxel irrelevante para
  // estimar el quiebre de línea.
  const spaceWidth = measureWordCached(context, fontSpec, '   ') / 3 || measureWordCached(context, fontSpec, 'i');
  let maxLineWidth = 0;
  const pushLine = (lineText: string, lineWidth: number) => {
    visualLines.push(lineText);
    if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
  };

  const pushWordByChunks = (word: string) => {
    let chunk = '';
    let chunkWidth = 0;
    for (const char of word) {
      const charWidth = measureWordCached(context, fontSpec, char);
      if (chunkWidth + charWidth <= availableContentWidth) {
        chunk += char;
        chunkWidth += charWidth;
        continue;
      }

      if (chunk) {
        pushLine(chunk, chunkWidth);
      }
      chunk = char;
      chunkWidth = charWidth;
    }
    if (chunk) {
      pushLine(chunk, chunkWidth);
    }
  };

  for (const paragraph of paragraphs) {
    const normalizedParagraph = paragraph.trim();
    if (!normalizedParagraph) {
      visualLines.push('');
      continue;
    }

    const words = normalizedParagraph.split(/\s+/).filter(Boolean);
    let currentLine = '';
    let currentWidth = 0;

    for (const word of words) {
      const wordWidth = measureWordCached(context, fontSpec, word);
      const candidateWidth = currentLine ? currentWidth + spaceWidth + wordWidth : wordWidth;
      if (candidateWidth <= availableContentWidth) {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
        currentWidth = candidateWidth;
        continue;
      }

      if (currentLine) {
        pushLine(currentLine, currentWidth);
        currentLine = '';
        currentWidth = 0;
      }

      if (wordWidth <= availableContentWidth) {
        currentLine = word;
        currentWidth = wordWidth;
      } else {
        pushWordByChunks(word);
      }
    }

    if (currentLine) {
      pushLine(currentLine, currentWidth);
    }
  }

  const measuredLineWidth = maxLineWidth;

  const lineCountForHeight = Math.max(1, visualLines.length) + (reserveTrailingLine ? 1 : 0);
  const calculatedWidth = Math.ceil(measuredLineWidth + horizontalPadding);
  const calculatedHeight = Math.ceil(lineCountForHeight * fontSize * lineHeight + verticalPadding);

  return {
    width: Math.min(safeMaxWidth, Math.max(minWidth, calculatedWidth)),
    height: Math.min(safeMaxHeight, Math.max(minHeight, calculatedHeight)),
  };
}

function getSpellcheckLang(): string {
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
function getSpeechCtor(): any {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const speechWindow = window as any;
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
}

function snap(value: number, enabled: boolean): number {
  if (!enabled) {
    return value;
  }
  return Math.round(value / GRID) * GRID;
}

interface AdvancedSuggestion {
  offset: number;
  length: number;
  message: string;
  replacements: string[];
  context: string;
}

export interface PageCanvasProps {
  page: ReportPage;
  viewportScale?: number;
  totalPages?: number;
  onRequestImageReplace?: (pageNumber: number, elementId: string, initialTab?: string) => void;
  onRequestCoverImage?: (pageNumber: number, elementId: string) => void;
  tenantId?: string;
}

// React.memo: cada página es un objeto propio en el store (useEditorStore
// solo reemplaza la referencia de la página editada — ver
// updateElement/removeElement, etc.), así que memoizar por props evita
// re-renderizar TODAS las páginas del documento en cada tecla escrita en
// UNA sola página.
const PageCanvas = React.memo(function PageCanvas({ page, viewportScale = 1, totalPages, onRequestImageReplace, onRequestCoverImage, tenantId }: PageCanvasProps) {
  const transformerRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const stageRef = useRef<any>(null);
  const dragInProgressRef = useRef(false);
  const wasSelectedRef = useRef(false);
  const scale = Math.min(4, Math.max(0.1, Number(viewportScale) || 1));
  const recognitionRef = useRef<any>(null);
  const dictationTargetRef = useRef<string | null>(null);
  // Guardia de composición IME (patrón sdkjs, text_input.js: todo se gatea
  // en IsComposition): mientras el navegador compone un carácter con tecla
  // muerta (´ + a → á, común en español), NO medir/redimensionar — la
  // medición a mitad de composición causa saltos visuales y estados
  // intermedios erróneos. Solo hay un editor de texto abierto a la vez, un
  // ref único basta.
  const isComposingRef = useRef(false);
  // Referencia al <textarea> del bloque de texto actualmente en edición —
  // usada por `applyFormatToSelection` para leer selectionStart/End (rango
  // que el usuario marcó con el mouse/teclado) y aplicar negrita/color/
  // tamaño/fuente SOLO a ese rango, en vez de a todo el bloque. Solo un
  // editor de texto abierto a la vez, un ref único basta (mismo patrón que
  // isComposingRef).
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Rango de selección "congelado" al abrir el picker de color (ver
  // captureSelection/applyFormatToSelection) — evita que abrir el popover
  // de la paleta y elegir un swatch colapse la selección del textarea.
  const selectionRangeRef = useRef<{ start: number; end: number } | null>(null);
  // Última función `applyFormatToSelection` del bloque en edición — se
  // reasigna en cada render dentro del .map() de abajo (asignación simple,
  // no un hook, así que no viola las reglas de hooks pese a estar dentro de
  // un array-map). El useEffect de más abajo (keyed en openTextEditorId) es
  // el único punto que registra/desregistra esto en el puente global.
  const activeFormatBridgeRef = useRef<((patch: Partial<BaseTextStyle>) => boolean) | null>(null);
  // Mismo patrón que activeFormatBridgeRef, para el puente del botón "Aa"
  // (tryApplyCaseToActiveTextSelection) — ver activeTextFormatBridge.ts.
  const activeCaseBridgeRef = useRef<(() => boolean) | null>(null);
  // Cambiar la selección con el mouse/teclado dentro del textarea NO
  // dispara por sí solo un re-render de React (no toca ningún estado) — sin
  // este contador, el "cuadro de fuente de la selección" de la barra de
  // formato (ver más abajo) quedaría desactualizado hasta la próxima tecla.
  // Se incrementa en onSelect/onMouseUp/onKeyUp del textarea.
  const [selectionTick, setSelectionTick] = useState(0);
  const layoutMode = useEditorStore((s) =>
    s.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
  );
  // Tamaño/orientación EFECTIVOS de esta página: su propio override si lo
  // tiene (ADR pendiente: secciones por página, estilo Word), si no el del
  // documento — ver `resolvePagePaperSetup`.
  const docPaperSize = useEditorStore((s) => s.doc.meta?.paperSize);
  const docOrientation = useEditorStore((s) => s.doc.meta?.orientation);
  const { paperSize, orientation } = resolvePagePaperSetup(
    { paperSize: page.paperSize, orientation: page.orientation },
    { paperSize: docPaperSize, orientation: docOrientation },
  );
  // El bloque de índice (TOC) lee encabezados de TODAS las páginas via
  // getState() (ver más abajo) — sin esta suscripción, React.memo bloqueaba
  // el re-render de esta página cuando el encabezado editado vivía en OTRA
  // página, dejando el índice desactualizado hasta que algo más forzara un
  // re-render por otro motivo ("a veces parecía no haber aplicado el cambio").
  const docVersion = useEditorStore((s) => s.doc.meta?.version);
  const {
    PAGE_WIDTH,
    PAGE_HEIGHT,
    HEADER_HEIGHT,
    FOOTER_HEIGHT,
    CONTENT_TOP,
    CONTENT_BOTTOM,
    CONTENT_LEFT,
    CONTENT_RIGHT,
  } = useMemo(() => getReportLayoutMetrics(layoutMode, paperSize, orientation), [layoutMode, paperSize, orientation]);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectPage = useEditorStore((s) => s.selectPage);
  const updateElement = useEditorStore((s) => s.updateElement);
  const removeElement = useEditorStore((s) => s.removeElement);
  const copyElement = useEditorStore((s) => s.copyElement);
  const pasteElement = useEditorStore((s) => s.pasteElement);
  const clipboardElement = useEditorStore((s) => s.clipboardElement);
  const selectedPage = useEditorStore((s) => s.selectedPage);
  const gridEnabled = useEditorStore((s) => s.gridEnabled);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const [openTextEditorId, setOpenTextEditorId] = useState<string | null>(null);
  // Fase 2 (patrón sdkjs: el textarea invisible nunca toca el modelo por
  // tecla — aquí, el visible tampoco toca el store Zustand por tecla). El
  // texto tecleado vive en este estado LOCAL de PageCanvas mientras se
  // edita; el store solo se actualiza en una confirmación diferida (o al
  // cerrar), así el resto de la app (panel derecho, ribbon, otras páginas
  // con su propio PageCanvas, el índice si vive en otra página) no se
  // re-renderiza en cada pulsación — solo lo hace esta página.
  const [liveEdit, setLiveEdit] = useState<{ id: string; text: string; width: number; height: number; spans: TextStyleSpan[] } | null>(null);
  const liveEditCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tabla: edición en lienzo solo tras doble clic; si no, el DOM bloquea selección como con KPI. */
  const [canvasTableEditId, setCanvasTableEditId] = useState<string | null>(null);
  /** Menú contextual (click derecho) sobre un bloque: bloquear/desbloquear y
   * eliminar — pedido explícito del negocio ("borrarse por medio del menú
   * contextual"). Posicionado en coordenadas de viewport (fixed), no de
   * lienzo, porque vive fuera del Stage de Konva (es un overlay HTML). */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; elementId: string } | null>(null);
  /** Submenú "Ajustar texto" del menú contextual — alternativa adicional al
   * picker del panel derecho, pedida explícitamente ("clic derecho sobre el
   * objeto seleccionado" para cambiar el modo más rápido). */
  const [contextWrapSubmenuOpen, setContextWrapSubmenuOpen] = useState(false);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => { setContextMenu(null); setContextWrapSubmenuOpen(false); };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  /** Menú contextual para bloques con contenido HTML superpuesto al lienzo
   * (chart/kpi/table/image/cover/toc/sensor) — el div visible de esos
   * bloques está POR ENCIMA del Rect de Konva que ya tiene su propio
   * onContextMenu, así que un click derecho ahí nunca llegaría a Konva sin
   * este handler nativo en el propio div. */
  const handleHtmlBlockContextMenu = (elementId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    selectElement(elementId);
    setContextMenu({ x: event.clientX, y: event.clientY, elementId });
  };
  const [isDictating, setIsDictating] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [correctionInfo, setCorrectionInfo] = useState<string | null>(null);
  const [isImproving, setIsImproving] = useState(false);

  /** Redacción on-premise: backend (LanguageTool + rápido + Ollama opcional). */
  const runAIImprovement = async (currentText: string, updateFn: (patch: { text: string }) => void) => {
    const sourceText = textForSpellOrRewrite(currentText);
    if (!sourceText) {
      setCorrectionInfo('Escribe primero el texto técnico (el cuadro no puede estar vacío ni ser solo el texto de ayuda).');
      setTimeout(() => setCorrectionInfo(null), 5000);
      return;
    }

    setIsImproving(true);
    setCorrectionInfo('Servidor: ortografía, gramática y redacción asistida…');

    try {
      // O6 de ADR-023: IA local por párrafo < 1s.
      const data = await measurePerfAsync('ia_correction', () => textRewriteOnPremise(sourceText, {
        language: 'es-PE',
        level: 'picky',
        use_llm: true,
      }));
      if (data?.error) {
        if (data.error === 'empty_text') {
          setCorrectionInfo('No hay texto válido para reescribir.');
        } else {
          setCorrectionInfo(typeof data.error === 'string' ? data.error : 'Error en el servidor.');
        }
        return;
      }
      const improvedText = String(data?.text ?? sourceText);
      updateFn({ text: improvedText });
      const llm = data?.llm_applied ? ' IA local (Ollama) aplicada.' : ' Solo corrección automática (LanguageTool + reglas); la IA no devolvió un resultado válido.';
      setCorrectionInfo(improvedText !== sourceText ? `Listo.${llm}` : `Sin cambios automáticos.${llm}`);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'error';
      setCorrectionInfo(`No se pudo mejorar el texto: ${msg}`);
    } finally {
      setIsImproving(false);
      setTimeout(() => setCorrectionInfo(null), 5000);
    }
  };
  const [advancedSuggestions, setAdvancedSuggestions] = useState<AdvancedSuggestion[]>([]);
  const [isAnalyzingSpelling, setIsAnalyzingSpelling] = useState(false);
  const spellcheckLang = getSpellcheckLang();
  const speechSupported = Boolean(getSpeechCtor());

  useEffect(() => {
    if (!transformerRef.current || !layerRef.current) {
      return;
    }

    const node = layerRef.current.findOne(`#${selectedElementId}`);
    const selectedEl = page.elements.find((el) => el.id === selectedElementId);
    // Sin manijas de redimensionar mientras se edita texto en el lienzo, o
    // si el bloque está bloqueado (encabezado/pie de página de plataforma,
    // ADR-046: fijos — no se pueden mover ni redimensionar).
    if (node && openTextEditorId !== selectedElementId && !selectedEl?.locked) {
      transformerRef.current.nodes([node]);
    } else {
      transformerRef.current.nodes([]);
    }
    layerRef.current.batchDraw();
  }, [selectedElementId, page.elements, openTextEditorId]);

  const stopDictation = () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    }
    dictationTargetRef.current = null;
    setIsDictating(false);
  };

  useEffect(() => {
    if (!openTextEditorId) {
      stopDictation();
      setSpeechError(null);
      setCorrectionInfo(null);
      setAdvancedSuggestions([]);
      setIsAnalyzingSpelling(false);
      if (liveEditCommitTimerRef.current) {
        clearTimeout(liveEditCommitTimerRef.current);
        liveEditCommitTimerRef.current = null;
      }
      setLiveEdit(null);
      activeTextareaRef.current = null;
      return;
    }
    // Se abrió un editor — sembrar el estado local con el texto/tamaño
    // actuales del store, para que el textarea controlado parta del valor
    // correcto (incluye reaperturas del mismo bloque tras cerrarlo antes).
    const el = page.elements.find((e) => e.id === openTextEditorId);
    if (el) {
      const seedText = String(el.props?.text ?? '');
      setLiveEdit({
        id: el.id,
        text: seedText,
        width: el.width,
        height: el.height,
        spans: sanitizeSpans(el.props?.spans, seedText.length),
      });
    }
    // No depende de `page.elements` a propósito: solo se resiembra al ABRIR
    // un editor, nunca por cambios externos mientras se escribe (eso
    // pisaría lo que el usuario está tecleando).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTextEditorId]);

  // Puente ribbon↔selección (ver lib/activeTextFormatBridge.ts): mientras
  // ESTA página tiene un editor de texto abierto, registra un wrapper que
  // siempre llama a la función `applyFormatToSelection` MÁS RECIENTE (la
  // reasignada en cada render dentro del .map() de elementos, vía
  // activeFormatBridgeRef) — así los botones Negrita/Cursiva/Subrayado/
  // Color/Tamaño del ribbon superior aplican a la palabra seleccionada en
  // vez de a todo el bloque, sin que el ribbon (otro componente) necesite
  // saber nada de textareas ni de spans.
  useEffect(() => {
    if (!openTextEditorId) return undefined;
    registerActiveTextFormatHandler((patch) => {
      const fn = activeFormatBridgeRef.current;
      return fn ? fn(patch) : false;
    });
    registerActiveCaseHandler(() => {
      const fn = activeCaseBridgeRef.current;
      return fn ? fn() : false;
    });
    return () => {
      registerActiveTextFormatHandler(null);
      registerActiveCaseHandler(null);
    };
  }, [openTextEditorId]);

  useEffect(() => {
    return () => {
      stopDictation();
    };
  }, []);

  useEffect(() => {
    if (!selectedElementId) {
      setCanvasTableEditId(null);
      return;
    }
    if (canvasTableEditId && selectedElementId !== canvasTableEditId) {
      setCanvasTableEditId(null);
    }
  }, [selectedElementId, canvasTableEditId]);

  useEffect(() => {
    if (!canvasTableEditId) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCanvasTableEditId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvasTableEditId]);

  useEffect(() => {
    const clearDrag = () => {
      dragInProgressRef.current = false;
      try {
        const stage = stageRef.current;
        if (stage && typeof stage.stopDrag === 'function') {
          stage.stopDrag();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, []);

  // Copiar/pegar de objetos del lienzo (Ctrl/Cmd+C / +V) — pedido explícito
  // ("seleccionar un objeto, copiar y pegarlo en el mismo lienzo"). Solo la
  // página "actual" (selectedPage) atiende el evento, para no pegar N veces
  // (una por cada PageCanvas montado). Se ignora si el foco está en un campo
  // de texto/celda (ahí Ctrl+C/V es copia de TEXTO, no del objeto).
  useEffect(() => {
    if (page.page_number !== selectedPage) return undefined;
    const onCopyPaste = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const k = event.key.toLowerCase();
      if (k !== 'c' && k !== 'v') return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      }
      if (k === 'c') {
        if (!selectedElementId) return;
        const el = page.elements.find((e) => e.id === selectedElementId);
        // No copiar bloques de plataforma (encabezado/pie/carátula).
        if (!el || el.type === 'header' || el.type === 'footer' || el.type === 'cover') return;
        event.preventDefault();
        copyElement(page.page_number, selectedElementId);
      } else if (k === 'v') {
        event.preventDefault();
        pasteElement(page.page_number);
      }
    };
    window.addEventListener('keydown', onCopyPaste);
    return () => window.removeEventListener('keydown', onCopyPaste);
  }, [page.page_number, selectedPage, selectedElementId, page.elements, copyElement, pasteElement]);

  useEffect(() => {
    const selectedElement = page.elements.find((element) => element.id === selectedElementId);
    if (!selectedElement || selectedElement.locked) {
      return;
    }
    if (selectedElement.type === 'text' && openTextEditorId === selectedElement.id) {
      return;
    }
    if (selectedElement.type === 'table' && canvasTableEditId === selectedElement.id) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
          return;
        }
      }

      const key = event.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') {
        return;
      }

      event.preventDefault();

      const step = event.shiftKey ? GRID : 1;
      const deltaX = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const deltaY = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;

      const w = Math.max(20, selectedElement.width ?? 120);
      const h = Math.max(20, selectedElement.height ?? 56);

      const boundedX = Math.min(Math.max((selectedElement.x ?? CONTENT_LEFT) + deltaX, CONTENT_LEFT), CONTENT_RIGHT - w);
      const boundedY = Math.min(Math.max((selectedElement.y ?? CONTENT_TOP) + deltaY, CONTENT_TOP), CONTENT_BOTTOM - h);

      updateElement(page.page_number, selectedElement.id, {
        x: snap(boundedX, snapEnabled),
        y: snap(boundedY, snapEnabled),
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    openTextEditorId,
    canvasTableEditId,
    page.elements,
    page.page_number,
    selectedElementId,
    snapEnabled,
    updateElement,
    layoutMode,
    CONTENT_LEFT,
    CONTENT_RIGHT,
    CONTENT_TOP,
    CONTENT_BOTTOM,
  ]);

  const pageLabel =
    layoutMode === 'presentation'
      ? totalPages != null && totalPages > 1
        ? `Diapositiva ${page.page_number} de ${totalPages}`
        : `Diapositiva ${page.page_number}`
      : totalPages != null && totalPages > 1
        ? `Página ${page.page_number} de ${totalPages}`
        : `Página ${page.page_number}`;

  return (
    <div
      className="page-wrapper"
      style={{
        width: PAGE_WIDTH * scale,
        minWidth: PAGE_WIDTH * scale,
      }}
    >
      <div className="page-meta">{pageLabel}</div>
      <Stage
        ref={stageRef}
        width={PAGE_WIDTH * scale}
        height={PAGE_HEIGHT * scale}
        onMouseDown={(event: any) => {
          selectPage(page.page_number);
          if (event.target === event.target.getStage()) {
            wasSelectedRef.current = useEditorStore.getState().selectedElementId != null || openTextEditorId != null || canvasTableEditId != null;
            setCanvasTableEditId(null);
            selectElement(undefined);
            setOpenTextEditorId(null);
          }
        }}
        onMouseUp={() => {
          dragInProgressRef.current = false;
        }}
        onMouseLeave={() => {
          dragInProgressRef.current = false;
        }}
        onClick={(event: any) => {
          if (event.target === event.target.getStage() && !dragInProgressRef.current) {
            if (!wasSelectedRef.current) {
              const pos = event.target.getStage().getPointerPosition();
              if (pos) {
                const x = snap(pos.x / scale, snapEnabled);
                const y = snap(pos.y / scale, snapEnabled);

                // Si ya habia un editor abierto, lo cerramos
                if (openTextEditorId) {
                  setOpenTextEditorId(null);
                }

                useEditorStore.getState().addElement('text', {
                  width: 350,
                  height: 40,
                  props: { text: '' }
                });
                const newId = useEditorStore.getState().selectedElementId;
                if (newId) {
                  useEditorStore.getState().updateElement(page.page_number, newId, { x, y });
                }
                setOpenTextEditorId(newId ?? null);
              }
            }
          }
        }}
        onDblClick={(event: any) => {
          if (event.target === event.target.getStage()) {
            const pos = event.target.getStage().getPointerPosition();
            if (pos) {
              const y = snap(pos.y / scale, snapEnabled);

              if (openTextEditorId) {
                setOpenTextEditorId(null);
              }

              // Un bloque de texto creado con doble clic en la hoja debe
              // ocupar TODO el ancho disponible de la columna de contenido
              // (como un párrafo nuevo de Word), igual que ya hace el botón
              // "Insertar texto" del ribbon (ver createElement en
              // useEditorStore.ts) — antes quedaba fijo en 350px de ancho
              // sin relación con el ancho real de la hoja, un recuadro
              // angosto en medio de una página A4/A3. Se ancla al margen
              // izquierdo del contenido; la Y sí respeta dónde se hizo doble
              // clic.
              useEditorStore.getState().addElement('text', {
                x: CONTENT_LEFT,
                width: CONTENT_RIGHT - CONTENT_LEFT,
                height: 40,
                props: { text: '' }
              });
              const newId = useEditorStore.getState().selectedElementId;
              if (newId) {
                useEditorStore.getState().updateElement(page.page_number, newId, { x: CONTENT_LEFT, y });
              }
              setOpenTextEditorId(newId ?? null);
            }
          }
        }}
      >
        <Layer ref={layerRef} scaleX={scale} scaleY={scale}>
          <Rect x={0} y={0} width={PAGE_WIDTH} height={PAGE_HEIGHT} fill="#fff" stroke="#dbe3f1" strokeWidth={1} perfectDrawEnabled={false} listening={false} />

          {/* Header & Footer reference areas (optional light background, no text blocking) */}
          <Rect x={0} y={0} width={PAGE_WIDTH} height={HEADER_HEIGHT} fill="#f8fbff" stroke="#dbe3f1" strokeWidth={1} perfectDrawEnabled={false} listening={false} />
          <Rect
            x={0}
            y={PAGE_HEIGHT - FOOTER_HEIGHT}
            width={PAGE_WIDTH}
            height={FOOTER_HEIGHT}
            fill="#f8fbff"
            stroke="#dbe3f1"
            strokeWidth={1}
            perfectDrawEnabled={false}
            listening={false}
          />

          <Rect
            x={CONTENT_LEFT}
            y={CONTENT_TOP}
            width={CONTENT_RIGHT - CONTENT_LEFT}
            height={CONTENT_BOTTOM - CONTENT_TOP}
            stroke="#e2e8f0"
            dash={[4, 4]}
            listening={false}
          />

          {gridEnabled &&
            Array.from({ length: Math.floor(PAGE_WIDTH / GRID) }).map((_, index) => (
              <Rect key={`gv-${index}`} x={index * GRID} y={0} width={1} height={PAGE_HEIGHT} fill="#f2f5fb" listening={false} perfectDrawEnabled={false} />
            ))}
          {gridEnabled &&
            Array.from({ length: Math.floor(PAGE_HEIGHT / GRID) }).map((_, index) => (
              <Rect key={`gh-${index}`} x={0} y={index * GRID} width={PAGE_WIDTH} height={1} fill="#f2f5fb" listening={false} perfectDrawEnabled={false} />
            ))}

          {[...page.elements]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((element) => {
              const isTextElement = element.type === 'text';
              const isEditingText = isTextElement && openTextEditorId === element.id;
              const openTextEditorOnDoubleClick = () => {
                if (!isTextElement) {
                  return;
                }
                if (element.locked) {
                  return;
                }
                if (dragInProgressRef.current) {
                  return;
                }
                selectElement(element.id);
                setSpeechError(null);
                setOpenTextEditorId(element.id);
              };

              const openTableEditorOnDoubleClick = () => {
                if (element.type !== 'table') {
                  return;
                }
                if (element.locked) {
                  return;
                }
                if (dragInProgressRef.current) {
                  return;
                }
                selectElement(element.id);
                setCanvasTableEditId(element.id);
              };

              const openImageReplaceOnDoubleClick = () => {
                if (element.type !== 'image') {
                  return;
                }
                if (element.locked) {
                  return;
                }
                if (dragInProgressRef.current) {
                  return;
                }
                if (typeof onRequestImageReplace !== 'function') {
                  return;
                }
                selectElement(element.id);
                onRequestImageReplace(page.page_number, element.id);
              };

              const onRectDoubleClick = () => {
                openTextEditorOnDoubleClick();
                openTableEditorOnDoubleClick();
                openImageReplaceOnDoubleClick();
              };

              // Borde configurable por el usuario (panel de propiedades) —
              // independiente del resaltado de selección, que siempre gana
              // visualmente mientras el bloque está seleccionado. Fallback a
              // defaultBorderByType para documentos guardados ANTES de que
              // este campo existiera (element.border === undefined).
              const isSelectedEl = selectedElementId === element.id;
              const effectiveBorder = element.border || defaultBorderByType(element.type);
              let strokeColor: string;
              let strokeW: number;
              let strokeDash: number[] | undefined;
              if (isEditingText) {
                // Mientras se escribe, el <textarea> ya trae su propio borde
                // fino — el recuadro de selección (grueso, con resplandor)
                // detrás de él se veía como "dos cuadros" superpuestos, nada
                // parecido a la experiencia limpia de Word al escribir.
                strokeColor = 'transparent';
                strokeW = 0;
                strokeDash = undefined;
              } else if (isSelectedEl) {
                strokeColor = 'var(--accent)';
                strokeW = 2;
                strokeDash = undefined;
              } else if (effectiveBorder.enabled) {
                strokeColor = effectiveBorder.color;
                strokeW = effectiveBorder.width;
                strokeDash =
                  effectiveBorder.style === 'dashed'
                    ? [effectiveBorder.width * 4, effectiveBorder.width * 2]
                    : effectiveBorder.style === 'dotted'
                      ? [effectiveBorder.width, effectiveBorder.width * 2]
                      : undefined;
              } else if (isTextElement) {
                // Guía de edición sutil para cuadros de texto sin borde propio
                // configurado — no es el borde del usuario, solo una ayuda
                // visual para ubicar el cuadro vacío en el lienzo.
                strokeColor = 'rgba(99, 102, 241, 0.2)';
                strokeW = 1;
                strokeDash = [4, 4];
              } else {
                strokeColor = 'transparent';
                strokeW = 0;
                strokeDash = undefined;
              }

              return (
              <Rect
                key={element.id}
                id={element.id}
                x={element.x}
                y={element.y}
                width={element.width}
                height={element.height}
                fill={
                  isTextElement
                    ? 'rgba(255,255,255,0.001)'
                    : element.type === 'kpi'
                      ? '#e8eefb'
                      : '#f8fbff'
                }
                stroke={strokeColor}
                strokeWidth={strokeW}
                shadowColor={isSelectedEl && !isEditingText ? 'var(--accent)' : 'transparent'}
                shadowBlur={isSelectedEl && !isEditingText ? 8 : 0}
                shadowOpacity={0.3}
                cornerRadius={8}
                dash={strokeDash}
                draggable={!element.locked && !isEditingText}
                onClick={() => {
                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }
                  selectElement(element.id);
                }}
                onTap={() => {
                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }
                  selectElement(element.id);
                }}
                onDblClick={onRectDoubleClick}
                onDblTap={onRectDoubleClick}
                onContextMenu={(event: any) => {
                  event.evt.preventDefault();
                  selectElement(element.id);
                  setContextMenu({ x: event.evt.clientX, y: event.evt.clientY, elementId: element.id });
                }}
                onDragStart={() => {
                  dragInProgressRef.current = true;
                  selectElement(element.id);
                  if (openTextEditorId) {
                    stopDictation();
                    setOpenTextEditorId(null);
                  }
                }}
                onDragMove={(event: any) => {
                  const boundedX = Math.min(Math.max(event.target.x(), CONTENT_LEFT), CONTENT_RIGHT - element.width);
                  const boundedY = Math.min(Math.max(event.target.y(), CONTENT_TOP), CONTENT_BOTTOM - element.height);
                  const x = snap(boundedX, snapEnabled);
                  const y = snap(boundedY, snapEnabled);
                  event.target.position({ x, y });
                }}
                onDragEnd={(event: any) => {
                  setTimeout(() => {
                    dragInProgressRef.current = false;
                  }, 0);
                  updateElement(page.page_number, element.id, {
                    x: event.target.x(),
                    y: event.target.y(),
                  });
                }}
                onTransformEnd={(event: any) => {
                  const node = event.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  const nextWidth = Math.max(isTextElement ? 120 : 60, node.width() * scaleX);
                  const nextHeight = Math.max(isTextElement ? 56 : 40, node.height() * scaleY);
                  node.scaleX(1);
                  node.scaleY(1);
                  node.width(nextWidth);
                  node.height(nextHeight);
                  updateElement(page.page_number, element.id, {
                    x: node.x(),
                    y: node.y(),
                    width: nextWidth,
                    height: nextHeight,
                  });
                }}
                onTransform={(event: any) => {
                  const node = event.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  const nextWidth = Math.max(isTextElement ? 120 : 60, node.width() * scaleX);
                  const nextHeight = Math.max(isTextElement ? 56 : 40, node.height() * scaleY);
                  node.scaleX(1);
                  node.scaleY(1);
                  node.width(nextWidth);
                  node.height(nextHeight);
                  updateElement(page.page_number, element.id, {
                    width: nextWidth,
                    height: nextHeight,
                  });
                }}
              />
              );
            })}

          {page.elements
            .filter(
              (element) => element.type === 'text' && selectedElementId === element.id && openTextEditorId === element.id,
            )
            .map((element) => (
              <Rect
                key={`${element.id}-text-selected`}
                x={element.x}
                y={element.y}
                width={element.width}
                height={element.height}
                stroke="#2d6cdf"
                strokeWidth={1}
                dash={[4, 4]}
                fill="rgba(0,0,0,0)"
                cornerRadius={4}
                listening={false}
              />
            ))}

          {page.elements.map((element) => (
            <Text
              key={`${element.id}-label`}
              x={element.x + 10}
              y={element.y + 10}
              text={`${element.type.toUpperCase()} • ${element.id}`}
              fontSize={12}
              fill="#1f3f7a"
              listening={false}
              visible={element.type !== 'text' && element.type !== 'header' && element.type !== 'footer'}
            />
          ))}

          {page.elements
            .filter((element) => element.type === 'chart')
            .map((element) => (
              <Html key={`${element.id}-chart`} groupProps={{ x: element.x + 4, y: element.y + 28, listening: false }}>
                <div
                  className="report-canvas-html-shield"
                  onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                  style={{
                    width: Math.max(120, element.width - 8),
                    height: Math.max(80, element.height - 34),
                  }}
                >
                  <LiveChartBlock width={Math.max(120, element.width - 8)} height={Math.max(80, element.height - 34)} />
                </div>
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'kpi')
            .map((element) => (
              <Html key={`${element.id}-kpi`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }}>
                <div
                  className="report-canvas-html-shield"
                  onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                  style={{ width: element.width - 8, height: element.height - 8 }}
                >
                  <MiningKpiWidget
                    kpiCode={element.props?.kpiCode}
                    title={element.props?.title}
                    trendViz={element.props?.trendViz}
                    connected={element.props?.connected !== false}
                    width={Math.max(90, element.width - 8)}
                    height={Math.max(60, element.height - 8)}
                  />
                </div>
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'table')
            .map((element) => (
              <Html key={`${element.id}-table`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }}>
                <div
                  className={
                    canvasTableEditId === element.id ? 'report-canvas-table-edit-host' : 'report-canvas-html-shield'
                  }
                  onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                  style={{ width: element.width - 8, height: element.height - 8 }}
                >
                  <TableBlock
                    {...element.props}
                    onUpdateCells={(newRows) => {
                      updateElement(page.page_number, element.id, {
                        props: { ...element.props, rows: newRows },
                      });
                    }}
                  />
                </div>
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'header')
            .map((element) => {
              const p = element.props || {};
              // ADR-046 (revisado): empresa/unidad/usuario NUNCA se leen de
              // props (ya no existen ahí) — se calculan en vivo desde la
              // sesión activa en cada render, así el bloque no puede quedar
              // desactualizado ni ser editado a mano.
              const session = getSession();
              const chromeParts = [session?.company, resolveMiningUnitName(session), session?.fullName || session?.username]
                .filter((v): v is string => Boolean(v && v.trim()));
              const chromeLabel = chromeParts.length > 0 ? chromeParts.join('  •  ').toUpperCase() : 'EMPRESA MINERA';
              return (
                <Html key={`${element.id}-header`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
                  <div
                    className="report-canvas-html-shield"
                    style={{
                      width: element.width - 8, height: element.height - 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      borderBottom: '2px solid #0f172a', boxSizing: 'border-box', padding: '0 4px', gap: 12,
                    }}>
                    {/* Alineado al margen izquierdo — empresa + unidad + usuario conectado, fijo (no editable) */}
                    <span style={{
                      fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
                      letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap', overflow: 'hidden',
                      textOverflow: 'ellipsis', minWidth: 0,
                    }}>
                      {chromeLabel}
                    </span>
                    {/* Lado derecho — logotipo corporativo (SVG, tenant_logo) */}
                    {p.showLogo !== false && (
                      <div style={{ height: '100%', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        <HeaderLogoImg tenantId={p.tenantId || tenantId || session?.tenantId} />
                      </div>
                    )}
                  </div>
                </Html>
              );
            })}

          {page.elements
            .filter((element) => element.type === 'footer')
            .map((element) => {
              const p = element.props || {};
              return (
                <Html key={`${element.id}-footer`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
                  <div
                    className="report-canvas-html-shield"
                    style={{
                      width: element.width - 8, height: element.height - 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      borderTop: '1px solid #cbd5e1', boxSizing: 'border-box', padding: '0 4px', gap: 12,
                    }}>
                    {/* Extremo izquierdo — literal fijo, no editable */}
                    <span style={{
                      fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
                      letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap',
                    }}>
                      BEEMETRY
                    </span>
                    {/* Extremo derecho — Página X / Total, siempre calculado en
                       render (nunca literal editable, ver defaultPropsByType). */}
                    {p.showPageNumber !== false && (
                      <span style={{
                        fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
                        letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        PÁGINA {page.page_number} / {totalPages || page.page_number}
                      </span>
                    )}
                  </div>
                </Html>
              );
            })}

          {page.elements
            .filter((element) => element.type === 'cover')
            .map((element) => {
              const p = element.props || {};
              const session = getSession();
              // Empresa/unidad/autor jamás se leen de props — se calculan en
              // vivo desde la sesión activa (mismo criterio que el
              // encabezado, ver arriba), así no pueden quedar desactualizados
              // ni ser editados/borrados a mano desde el panel de propiedades.
              const chromeCompany = session?.company;
              const chromeUnit = resolveMiningUnitName(session);
              const chromeAuthor = session?.fullName || session?.username;
              return (
                <Html key={`${element.id}-cover`} groupProps={{ x: element.x, y: element.y, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
                  <div
                    className="report-canvas-html-shield"
                    onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                    style={{
                      width: element.width, height: element.height, overflow: 'hidden',
                      position: 'relative', display: 'flex', flexDirection: 'column',
                      boxSizing: 'border-box', color: p.textColor || '#ffffff',
                      // ADR-048 (revisado): la carátula ya NO admite una foto
                      // como fondo propio (generaba un mosaico repetido y, al
                      // ser un bloque bloqueado, esa foto no se podía mover ni
                      // redimensionar). La foto de la unidad minera ahora es
                      // un bloque `image` independiente y libre (ver más abajo,
                      // filtro type==='image', insertado centrado sobre esta
                      // misma página vía "Insertar Imagen Empresa"). El color
                      // de fondo es configurable (props.bgColor); si no se
                      // definió ninguno se usa el degradé de plataforma.
                      background: p.bgColor || 'linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #334155 100%)',
                    }}>
                    {/* Franja de clasificación — todo el ancho de la hoja */}
                    <div style={{ background: 'rgba(15,23,42,0.9)', color: '#fbbf24', fontSize: 12, fontWeight: 800, letterSpacing: 2, textAlign: 'center', padding: '10px 0', textTransform: 'uppercase' }}>
                      {p.classification || 'CONFIDENCIAL'}
                    </div>
                    {/* Logotipo de la empresa — esquina superior derecha */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '20px 40px 0' }}>
                      <div style={{ background: '#ffffff', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', minHeight: 40 }}>
                        <HeaderLogoImg tenantId={p.tenantId || tenantId || session?.tenantId} />
                      </div>
                    </div>
                    {/* Título + empresa + unidad — anclado al pie de este
                       bloque (no centrado verticalmente): deja libre toda la
                       franja superior para la foto de la unidad minera, que
                       se inserta ahí arriba del texto (pedido explícito: "la
                       imagen mas arriba y el texto debajo de la imagen"). */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '24px 56px', textAlign: 'center' }}>
                      <h1 style={{ fontSize: 44, fontWeight: 900, margin: '0 0 16px', lineHeight: 1.15, textShadow: '0 2px 16px rgba(0,0,0,0.45)' }}>
                        {p.title || 'Informe Técnico'}
                      </h1>
                      {(chromeCompany || chromeUnit) && (
                        <div style={{ width: 64, height: 3, borderRadius: 2, background: '#fbbf24', margin: '0 0 16px', opacity: 0.9 }} />
                      )}
                      {chromeCompany && <div style={{ fontSize: 22, fontWeight: 700, textShadow: '0 1px 8px rgba(0,0,0,0.4)' }}>{chromeCompany}</div>}
                      {chromeUnit && <div style={{ fontSize: 16, opacity: 0.9, marginTop: 4, letterSpacing: 0.5 }}>{chromeUnit}</div>}
                    </div>
                    {/* Metadatos + marca Beemetry — franja inferior */}
                    <div style={{
                      borderTop: '1px solid rgba(255,255,255,0.25)', padding: '18px 40px',
                      display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between',
                      background: 'rgba(15,23,42,0.35)',
                    }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12 }}>
                        {p.docCode && <span><b>Código:</b> {p.docCode}</span>}
                        {chromeAuthor && <span><b>Autor:</b> {chromeAuthor}</span>}
                        {p.date && <span><b>Fecha:</b> {p.date}</span>}
                      </div>
                      {/* "Logotipo" de plataforma (wordmark) — pedido explícito
                         del negocio ("tampoco vemos el logotipo... de BEEMETRY"),
                         mismo tratamiento tipográfico que header/footer. */}
                      <span style={{
                        fontFamily: PLATFORM_CHROME_FONT, fontSize: 13, fontWeight: 900,
                        letterSpacing: 1.2, opacity: 0.95,
                      }}>
                        BEEMETRY
                      </span>
                    </div>
                  </div>
                </Html>
              );
            })}

          {/* Imágenes libres — DELIBERADAMENTE declaradas después de 'cover'
             para que, visualmente, cualquier imagen insertada sobre la
             carátula (p.ej. "Insertar Imagen Empresa", ver ADR-048 revisado)
             quede POR ENCIMA de su fondo (el orden de pintado de los
             overlays Html sigue el orden de declaración en el JSX, no
             zIndex). */}
          {page.elements
            .filter((element) => element.type === 'image')
            .map((element) => {
              // 'Detrás/delante del texto': ambos flotan libremente (sin
              // afectar el flujo, ver wrapExclusions arriba), difieren solo
              // en apilamiento visual. El div wrapper que genera react-konva-
              // utils fija z-index:10 por defecto (misma capa que el texto);
              // se sobreescribe explícitamente para las imágenes.
              const imageZIndex = element.wrapMode === 'behind' ? 5 : 15;
              return (
              <Html key={`${element.id}-image`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }} divProps={{ style: { pointerEvents: 'none', zIndex: imageZIndex } }}>
                <div
                  className="report-canvas-html-shield"
                  onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                  style={{
                    width: element.width - 8,
                    height: element.height - 8,
                    overflow: 'hidden',
                    borderRadius: '4px',
                  }}
                >
                  <img
                    src={resolveReportImageSrc(element)}
                    alt={element.props?.alt || element.id}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: (element.objectFit as any) || 'cover',
                      display: 'block',
                    }}
                  />
                </div>
              </Html>
              );
            })}

          {/* Videos insertados (webcam o pantalla/ventana grabada, ADR pendiente
             de formalizar) -- a diferencia de las imágenes, el <video> necesita
             pointerEvents activo para que sus controles nativos (play/pausa/
             volumen) respondan al click; esto hace que arrastrar el bloque
             deba hacerse por el borde/marco, no tocando el reproductor mismo
             -- mismo trade-off que cualquier bloque con controles interactivos
             embebidos en un overlay Html sobre Konva. */}
          {page.elements
            .filter((element) => element.type === 'video')
            .map((element) => (
              <Html key={`${element.id}-video`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }} divProps={{ style: { pointerEvents: 'auto', zIndex: element.wrapMode === 'behind' ? 5 : 15 } }}>
                <div
                  className="report-canvas-html-shield"
                  onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                  style={{
                    width: element.width - 8,
                    height: element.height - 8,
                    overflow: 'hidden',
                    borderRadius: '4px',
                    background: '#000',
                  }}
                >
                  {element.src ? (
                    <video
                      src={element.src}
                      controls
                      style={{ width: '100%', height: '100%', display: 'block' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
                      Sin video
                    </div>
                  )}
                </div>
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'toc')
            .map((element) => {
              const p = element.props || {};
              // ADR-011/019 (revisado): antes esta vista embebida tenía su
              // propia heurística (primera línea de CADA bloque de texto,
              // sin distinguir encabezados) — divergía de generateTocData()
              // en TableOfContents.tsx, que sí filtra por headingStyle real.
              // Unificado a una sola fuente de verdad para la numeración.
              const tocEntries = generateTocData(useEditorStore.getState().doc);
              return (
                <Html key={`${element.id}-toc`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
                  <div
                    className="report-canvas-html-shield"
                    onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                    style={{
                      width: element.width - 8, height: element.height - 8, overflow: 'auto',
                      border: '1px solid #e2e8f0', borderRadius: 6, background: '#ffffff', boxSizing: 'border-box', padding: 18,
                    }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 12px', borderBottom: '2px solid #0f172a', paddingBottom: 6 }}>
                      {p.title || 'Tabla de Contenidos'}
                    </h2>
                    {tocEntries.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                        Aplique estilos Título, Heading 1-6 a bloques de texto para generar el índice automáticamente.
                      </div>
                    ) : (
                      <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                        {tocEntries.map((item, i) => {
                          // Estilo corporativo premium por nivel — misma escala
                          // tipográfica que HEADING_STYLES (RibbonToolbar.tsx),
                          // reducida a tamaño de línea de índice: cada nivel se
                          // distingue claramente del siguiente (tamaño, peso,
                          // color, cursiva en los más profundos), igual que la
                          // Tabla de Contenidos automática de Word.
                          const levelStyle: Record<number, { fontSize: number; fontWeight: number; color: string; fontStyle?: string }> = {
                            1: { fontSize: 14,   fontWeight: 700, color: '#0f172a' },
                            2: { fontSize: 13,   fontWeight: 700, color: '#1e40af' },
                            3: { fontSize: 12.5, fontWeight: 600, color: '#334155' },
                            4: { fontSize: 12,   fontWeight: 500, color: '#475569' },
                            5: { fontSize: 11.5, fontWeight: 500, color: '#64748b', fontStyle: 'italic' },
                            6: { fontSize: 11,   fontWeight: 400, color: '#94a3b8', fontStyle: 'italic' },
                          };
                          const st = levelStyle[item.level] || levelStyle[6];
                          return (
                            <li key={`${item.id}-${i}`} style={{
                              display: 'flex', alignItems: 'baseline', gap: 6,
                              padding: '3px 0', paddingLeft: (item.level - 1) * 16,
                            }}>
                              <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>{item.number}</span>
                              <span style={{ fontSize: st.fontSize, fontWeight: st.fontWeight, color: st.color, fontStyle: st.fontStyle }}>{item.text}</span>
                              <span style={{ flex: 1, borderBottom: '1px dotted #cbd5e1', margin: '0 2px', transform: 'translateY(-3px)' }} />
                              <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>{item.pageNumber}</span>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </Html>
              );
            })}

          {page.elements
            .filter((element) => element.type === 'sensor')
            .map((element) => (
              <Html key={`${element.id}-sensor`} groupProps={{ x: element.x, y: element.y, listening: false }}>
                <div
                  className="report-canvas-html-shield"
                  onContextMenu={(e) => handleHtmlBlockContextMenu(element.id, e)}
                  style={{ width: element.width, height: element.height }}
                >
                  <SensorWidget
                    sensorId={element.props?.sensorId}
                    type={element.props?.sensorType}
                    title={element.props?.title || 'Telemetría Real-time'}
                    connected={element.props?.connected !== false}
                    width={element.width}
                    height={element.height}
                  />
                </div>
              </Html>
            ))}

          {page.elements
            .filter((element) => element.type === 'text')
            .map((element) => {
              const textProps = getTextProps(element);
              const mergedProps = { ...(element.props || {}) };
              const isEditorOpen = openTextEditorId === element.id;
              const isElementSelected = selectedElementId === element.id;
              const isCurrentDictationTarget = isDictating && dictationTargetRef.current === element.id;
              // Mientras se edita, el texto/tamaño "reales" son los del
              // estado local (lo último tecleado) — el store puede estar
              // hasta 600ms desactualizado por el debounce de Fase 2.
              const isLiveEditingThis = isEditorOpen && liveEdit?.id === element.id;
              const liveText = isLiveEditingThis ? liveEdit.text : textProps.text;
              const liveWidth = isLiveEditingThis ? liveEdit.width : element.width;
              const liveHeight = isLiveEditingThis ? liveEdit.height : element.height;
              const liveSpans = isLiveEditingThis ? liveEdit.spans : textProps.spans;
              const textBaseStyle: BaseTextStyle = {
                bold: textProps.bold,
                italic: textProps.italic,
                underline: textProps.underline,
                color: textProps.fontColor,
                fontSize: textProps.fontSize,
                fontFamily: textProps.fontFamily,
                // Resaltado BASE del bloque (ribbon fijo, sin selección
                // activa) — los spans por selección (barra flotante) lo
                // sobreescriben solo en su rango, igual que con `color`.
                // Distinto de props.backgroundColor (el fondo de TODO el
                // cuadro/caja de texto, no del texto en sí).
                highlightColor: textProps.highlightColor,
                headingStyle: textProps.headingStyle,
              };

              const getAutoSizeForPatch = (patch: Partial<TextProps>) => {
                const nextProps = { ...textProps, ...patch };
                const maxWidth = CONTENT_RIGHT - element.x;
                // El ancho NUNCA se encoge por debajo del que ya tiene el
                // bloque (mínimo = element.width, no un piso fijo de 120px)
                // — un bloque creado a todo el ancho de la columna (ribbon o
                // doble clic, ver createElement/onDblClick) debe SEGUIR
                // ocupando todo el ancho aunque el texto tecleado sea corto;
                // solo la ALTURA debe auto-ajustarse línea a línea, como un
                // párrafo normal de Word, no como una etiqueta que se ciñe
                // al contenido. Sigue pudiendo crecer más allá si una
                // palabra sin cortes es más ancha que el bloque (maxWidth).
                const minWidthForPatch = Math.min(maxWidth, Math.max(120, element.width));
                // Mientras se escribe (y también al cerrar, ver
                // closeAndProcess — isEditorOpen sigue true en ese momento),
                // el límite de alto es el borde FÍSICO de la hoja, no el
                // margen de contenido antes del pie de página: con el límite
                // angosto anterior, un cuadro ubicado en la mitad inferior
                // de la página dejaba de crecer apenas se acercaba al pie, y
                // como el textarea tenía overflow:hidden, las líneas
                // siguientes que el usuario seguía escribiendo quedaban
                // ocultas (el texto SÍ se guardaba, pero no se veía) — "no
                // avanza a la siguiente línea". El límite ajustado al área
                // de contenido solo se usa para el <Text> estático (no
                // editando) que nunca debería llegar a necesitarlo, porque
                // ya se guardó con el tamaño físico de hoja.
                const maxHeight = isEditorOpen
                  ? PAGE_HEIGHT - element.y - 8
                  : CONTENT_BOTTOM - element.y;

                return getAutoSizedTextBox(
                  nextProps.text,
                  nextProps.fontSize,
                  nextProps.fontFamily,
                  nextProps.bold,
                  nextProps.italic,
                  nextProps.lineHeight,
                  minWidthForPatch,
                  56,
                  maxWidth,
                  maxHeight,
                  isEditorOpen,
                );
              };

              // Usado por dictado/corrección/mejora con IA — acciones
              // infrecuentes (no por tecla), así que confirman al store DE
              // INMEDIATO como antes. También sincronizan `liveEdit` para
              // que el textarea controlado (que ya no lee del store mientras
              // se escribe, ver handleLiveTyping) muestre el resultado sin
              // parpadeo de vuelta al valor viejo.
              const updateTextProps = (patch: Partial<TextProps>) => {
                const nextText = patch.text !== undefined ? String(patch.text) : textProps.text;
                // Dictado/corrección IA pueden reemplazar el texto entero —
                // recolocar los spans de formato al nuevo string (diff de
                // prefijo/sufijo común, ver lib/textSpans.ts) para que negrita/
                // color/etc. aplicados antes no se pierdan ni queden mal
                // ubicados tras el cambio.
                const nextSpans = patch.text !== undefined
                  ? remapSpansForTextChange(liveText, nextText, liveSpans)
                  : liveSpans;
                if (liveEditCommitTimerRef.current) {
                  clearTimeout(liveEditCommitTimerRef.current);
                  liveEditCommitTimerRef.current = null;
                }
                if (isComposingRef.current) {
                  updateElement(page.page_number, element.id, {
                    props: { ...mergedProps, ...patch, spans: nextSpans },
                  });
                  setLiveEdit({ id: element.id, text: nextText, width: liveEdit?.width ?? element.width, height: liveEdit?.height ?? element.height, spans: nextSpans });
                  return;
                }
                const autoSize = getAutoSizeForPatch(patch);
                // Anti-parpadeo (guardia estilo LastReplaceText de sdkjs): si
                // la medición no cambió el tamaño del cuadro, no tocar
                // width/height — evita re-layouts de Konva sin efecto visual.
                const sizeUnchanged =
                  autoSize.width === element.width && autoSize.height === element.height;
                updateElement(page.page_number, element.id, {
                  props: {
                    ...mergedProps,
                    ...patch,
                    spans: nextSpans,
                  },
                  ...(sizeUnchanged ? {} : { width: autoSize.width, height: autoSize.height }),
                });
                setLiveEdit({ id: element.id, text: nextText, width: autoSize.width, height: autoSize.height, spans: nextSpans });
              };

              // Fase 2 — el manejador real de cada tecla. NO escribe al store
              // Zustand de inmediato (eso re-renderiza toda la app suscrita
              // al documento en cada pulsación): actualiza solo el estado
              // LOCAL de esta página (medición ya barata gracias al caché de
              // Fase 1) y confirma al store recién tras una pausa de
              // escritura de 600ms — el equivalente a los "flags de sucio"
              // de sdkjs, pero implementado como debounce simple.
              const handleLiveTyping = (newText: string) => {
                // Recoloca los spans de formato al string recién tecleado
                // ANTES de tocar el store — así negrita/color aplicados a
                // una porción del texto no "saltan" de lugar cuando el
                // usuario sigue escribiendo antes/después/en medio de ella.
                const nextSpans = remapSpansForTextChange(liveText, newText, liveSpans);
                if (isComposingRef.current) {
                  setLiveEdit({ id: element.id, text: newText, width: liveEdit?.width ?? element.width, height: liveEdit?.height ?? element.height, spans: nextSpans });
                  return;
                }
                const autoSize = getAutoSizeForPatch({ text: newText });
                setLiveEdit({ id: element.id, text: newText, width: autoSize.width, height: autoSize.height, spans: nextSpans });

                if (liveEditCommitTimerRef.current) clearTimeout(liveEditCommitTimerRef.current);
                liveEditCommitTimerRef.current = setTimeout(() => {
                  liveEditCommitTimerRef.current = null;
                  // Se relee el elemento DESDE el store en el momento de
                  // confirmar (no desde el cierre/closure de este render)
                  // para nunca pisar props cambiadas por otra vía mientras
                  // el usuario escribía.
                  const state = useEditorStore.getState();
                  const livePage = state.doc.pages.find((p) => p.page_number === page.page_number);
                  const liveElement = livePage?.elements.find((e) => e.id === element.id);
                  if (!liveElement) return;
                  const finalAutoSize = getAutoSizeForPatch({ text: newText });
                  const sizeUnchanged =
                    finalAutoSize.width === liveElement.width && finalAutoSize.height === liveElement.height;
                  updateElement(page.page_number, element.id, {
                    props: { ...(liveElement.props || {}), text: newText, spans: nextSpans },
                    ...(sizeUnchanged ? {} : { width: finalAutoSize.width, height: finalAutoSize.height }),
                  });
                }, 600);
              };

              const closeAndProcess = () => {
                // Por si el editor se cierra a mitad de una composición IME
                // (blur sin compositionend) — que no quede la guardia pegada.
                isComposingRef.current = false;
                if (liveEditCommitTimerRef.current) {
                  clearTimeout(liveEditCommitTimerRef.current);
                  liveEditCommitTimerRef.current = null;
                }
                // El texto vigente es el del estado local (lo último
                // tecleado), no `mergedProps.text` — ese pudo quedar
                // desactualizado si aún no se disparaba la confirmación
                // diferida de handleLiveTyping.
                const finalText = liveEdit?.id === element.id ? liveEdit.text : textProps.text;
                const finalSpans = liveEdit?.id === element.id ? liveEdit.spans : textProps.spans;
                const autoSize = getAutoSizeForPatch({ text: finalText });
                updateElement(page.page_number, element.id, {
                  width: autoSize.width,
                  height: autoSize.height,
                  props: {
                    ...mergedProps,
                    text: finalText,
                    spans: finalSpans,
                  },
                });
                activeTextareaRef.current = null;
                stopDictation();
                setOpenTextEditorId(null);
                selectElement(undefined);
              };

              // Formato por selección (negrita/cursiva/subrayado/color/
              // tamaño/fuente aplicados SOLO al rango que el usuario marcó
              // con el mouse/teclado dentro del textarea) — pedido explícito:
              // "necesito que lo que seleccione con el cursor del mouse se
              // pueda cambiar sin afectar al resto del texto". Requiere una
              // selección real (start !== end), igual que Word: con el
              // cursor colapsado no hay nada que "solo esa porción" cambiar.
              // Captura el rango seleccionado en el textarea. Necesario para
              // el picker de color: abrir su popover y elegir un swatch son
              // varios clics que, pese al preventDefault, podían colapsar la
              // selección — se "congela" el rango al abrir el picker y se usa
              // ese al aplicar. Para negrita/cursiva basta el rango vivo.
              const captureSelection = () => {
                const ta = activeTextareaRef.current;
                if (!ta) return;
                selectionRangeRef.current = { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
              };

              // Devuelve `true` si había una selección real y se aplicó el
              // formato; `false` si no (cursor colapsado) — usado tanto por
              // la barra flotante propia como por el puente con el ribbon
              // (activeTextFormatBridge.ts): si no hay selección, el ribbon
              // cae a su comportamiento histórico de "todo el bloque".
              const applyFormatToSelection = (patch: Partial<BaseTextStyle>): boolean => {
                const ta = activeTextareaRef.current;
                if (!ta) return false;
                // Preferir el rango congelado (picker de color); si no hay,
                // el rango vivo del textarea (botones directos).
                const captured = selectionRangeRef.current;
                const start = captured ? captured.start : (ta.selectionStart ?? 0);
                const end = captured ? captured.end : (ta.selectionEnd ?? 0);
                selectionRangeRef.current = null;
                if (start === end) return false;
                const nextSpans = applyStyleToRange(liveText, liveSpans, textBaseStyle, start, end, patch);
                setLiveEdit({ id: element.id, text: liveText, width: liveWidth, height: liveHeight, spans: nextSpans });
                updateElement(page.page_number, element.id, {
                  props: { ...mergedProps, text: liveText, spans: nextSpans },
                });
                // El clic en el botón de formato le quita el foco al
                // textarea — se lo devolvemos y restauramos la selección
                // para que el usuario pueda seguir aplicando formatos
                // encadenados (p.ej. negrita y luego color) sin tener que
                // volver a seleccionar el texto cada vez.
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.setSelectionRange(start, end);
                });
                return true;
              };

              // Registrar esta función como el handler activo del puente
              // ribbon↔selección MIENTRAS este bloque está en edición — el
              // ribbon (App.tsx) intenta primero este camino; si no hay
              // selección real, cae a aplicar sobre todo el bloque (código
              // ya existente en App.tsx, sin cambios).
              if (isEditorOpen) {
                activeFormatBridgeRef.current = applyFormatToSelection;
              }

              // Fuente de la selección actual, para el cuadro indicador junto
              // al selector de fuente: recorre cada carácter del rango
              // marcado y compara su estilo efectivo (span que lo cubre, o el
              // base del bloque — ver getEffectiveStyleAt). Si todos los
              // caracteres comparten la misma fuente, se muestra su nombre;
              // si hay dos o más fuentes distintas en la selección, se
              // devuelve '' (el cuadro queda en blanco, pero el selector de
              // al lado sigue permitiendo aplicar una fuente nueva a toda la
              // selección, igual que en Word). selectionTick fuerza que esto
              // se recalcule cuando la selección cambia solo con el mouse
              // (evento que no toca ningún estado de React por sí solo).
              const getSelectionFontFamily = (): string => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return '';
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return '';
                let common: string | null = null;
                for (let offset = start; offset < end; offset += 1) {
                  const effective = getEffectiveStyleAt(liveSpans, textBaseStyle, offset);
                  if (common === null) {
                    common = effective.fontFamily;
                  } else if (common !== effective.fontFamily) {
                    return '';
                  }
                }
                return common ?? '';
              };
              const selectionFontFamily = isEditorOpen ? getSelectionFontFamily() : '';
              const handleSelectionMaybeChanged = () => setSelectionTick((tick) => tick + 1);

              // Tamaño de fuente ACTUAL de la selección (no el del bloque):
              // los botones A-/A+ deben partir de lo que YA tiene lo
              // seleccionado (si ya se achicó una vez, el siguiente clic
              // sigue achicando esa porción) en vez de siempre recalcular
              // desde textProps.fontSize (el tamaño base del bloque) — con
              // eso, clics repetidos sobre una selección que ya tenía un
              // tamaño propio no hacían nada (siempre volvían a
              // "base - 2"). Ante una selección con tamaños mezclados se usa
              // el del primer carácter, igual que el resto de los toggles.
              const getSelectionFontSize = (): number => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return textProps.fontSize;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return textProps.fontSize;
                return getEffectiveStyleAt(liveSpans, textBaseStyle, start).fontSize;
              };

              // Color de TEXTO actual de la selección — el swatch de la
              // paleta de color mostraba siempre textProps.fontColor (el
              // del BLOQUE), nunca el de lo realmente seleccionado. Con
              // cursor colapsado (nada marcado) se sigue mostrando el color
              // del bloque, como "color ambiente" de referencia.
              const getSelectionColor = (): string => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return textProps.fontColor;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return textProps.fontColor;
                return getEffectiveStyleAt(liveSpans, textBaseStyle, start).color;
              };

              // Color de RESALTADO (fondo detrás del texto, tipo marcador)
              // de la selección actual — 'transparent' si no hay ninguno
              // aplicado o si no hay selección real.
              const getSelectionHighlightColor = (): string => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return 'transparent';
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return 'transparent';
                return getEffectiveStyleAt(liveSpans, textBaseStyle, start).highlightColor || 'transparent';
              };

              // Estilo de encabezado ('title'|'h1'..'h6') de la selección,
              // solo si TODO el rango marcado comparte el mismo — igual
              // criterio que getSelectionFontFamily. '' = sin selección,
              // selección sin encabezado, o encabezados mezclados (el
              // <select> simplemente queda en "Normal").
              const getSelectionHeadingStyle = (): string => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return '';
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start >= end) return '';
                let common: string | null = null;
                for (let offset = start; offset < end; offset += 1) {
                  const effective = getEffectiveStyleAt(liveSpans, textBaseStyle, offset).headingStyle || '';
                  if (common === null) {
                    common = effective;
                  } else if (common !== effective) {
                    return '';
                  }
                }
                return common ?? '';
              };

              // Aplica un estilo de encabezado a la selección: además de
              // marcarla para la Tabla de Contenidos (headingStyle, ver
              // TableOfContents.tsx), replica las propiedades de CARÁCTER
              // del estilo (fuente/tamaño/negrita/cursiva/subrayado/color) —
              // NO alineación ni interlineado, esas son de párrafo y no
              // tienen sentido para una porción de texto suelta dentro de
              // un bloque. '' (Normal) limpia el encabezado y vuelve al
              // estilo de cuerpo normal, igual que "Normal" en el ribbon.
              const applyHeadingStyleToSelection = (headingId: string) => {
                const preset = findHeadingStyle(headingId || 'normal') ?? findHeadingStyle('normal')!;
                applyFormatToSelection({
                  headingStyle: headingId || '',
                  fontFamily: preset.fontFamily,
                  fontSize: preset.fontSize,
                  bold: preset.fontWeight >= 600,
                  italic: preset.italic,
                  underline: preset.underline,
                  color: preset.color,
                });
              };

              // "Cambiar MAYÚSCULAS/minúsculas" al estilo Word (Mayús+F3):
              // cicla entre MAYÚSCULAS → minúsculas → Cada Palabra En
              // Mayúscula → MAYÚSCULAS... el siguiente estado se decide por
              // el contenido ACTUAL de la selección (no hay que recordar en
              // qué paso del ciclo iba). A diferencia del resto de los
              // controles de esta barra, esto muta el TEXTO en sí, no un
              // atributo de estilo — se re-mapean los spans igual que en
              // dictado/corrección (remapSpansForTextChange) para que el
              // formato ya aplicado no se pierda ni se desplace.
              const applyCaseToSelection = (): boolean => {
                const ta = activeTextareaRef.current;
                if (!ta) return false;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start === end) return false;
                const original = liveText.slice(start, end);
                const isUpper = original === original.toUpperCase() && original !== original.toLowerCase();
                const isLower = original === original.toLowerCase() && original !== original.toUpperCase();
                let transformed: string;
                if (isUpper) {
                  transformed = original.toLowerCase();
                } else if (isLower) {
                  transformed = original.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
                } else {
                  transformed = original.toUpperCase();
                }
                const nextText = liveText.slice(0, start) + transformed + liveText.slice(end);
                const nextSpans = remapSpansForTextChange(liveText, nextText, liveSpans);
                setLiveEdit({ id: element.id, text: nextText, width: liveWidth, height: liveHeight, spans: nextSpans });
                updateElement(page.page_number, element.id, {
                  props: { ...mergedProps, text: nextText, spans: nextSpans },
                });
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.setSelectionRange(start, start + transformed.length);
                });
                return true;
              };

              // Puente ribbon↔selección para el botón "Aa" (ver
              // lib/activeTextFormatBridge.ts, tryApplyCaseToActiveTextSelection)
              // — mismo criterio que activeFormatBridgeRef para negrita/color/
              // tamaño: mientras el editor de ESTE bloque está abierto, el
              // ribbon fijo intenta primero aplicar el ciclo de mayúsculas a
              // la selección; si no hay selección real, cae a "todo el
              // bloque" (App.tsx).
              if (isEditorOpen) {
                activeCaseBridgeRef.current = applyCaseToSelection;
              }

              const selectionFontColor = isEditorOpen ? getSelectionColor() : textProps.fontColor;
              const selectionHighlightColor = isEditorOpen ? getSelectionHighlightColor() : 'transparent';
              const selectionHeadingStyle = isEditorOpen ? getSelectionHeadingStyle() : '';

              // Rango [start,end) de la selección REAL viva del textarea, o
              // null si no hay nada marcado. Bug real reportado: al agrandar
              // el tamaño de un rango seleccionado con A+/A-, el área de
              // selección "se perdía" — no encogía ni crecía junto con el
              // texto. Causa real: el <textarea> invisible (que es quien
              // dueño de la selección NATIVA del navegador, el rectángulo
              // azul/celeste que el usuario ve) SIEMPRE usa un único
              // fontSize uniforme (el del bloque, textProps.fontSize) para
              // TODO su contenido — un textarea no puede tener tamaños de
              // fuente mixtos por carácter. El overlay "fantasma" de abajo
              // SÍ pinta cada span a su propio tamaño real (por eso
              // highlightColor por ejemplo SÍ escala bien, ver
              // getSelectionHighlightColor). Cuando la selección tiene un
              // tamaño de fuente distinto al del bloque, el textarea sigue
              // ajustando líneas (wrap) según el tamaño PEQUEÑO/uniforme
              // mientras el overlay ajusta líneas según el tamaño real
              // (grande) de ese span — los dos layouts divergen y el
              // rectángulo de selección nativo del navegador queda
              // desalineado/diminuto respecto al texto grande que se ve.
              // Fix: no depender de la selección nativa del navegador para
              // la señal visual — pintar un indicador de selección PROPIO
              // dentro del mismo overlay que ya calcula el tamaño real por
              // span (ver el render del "ghost overlay" más abajo), así
              // hereda automáticamente el tamaño correcto. La selección
              // nativa se oculta vía CSS (.text-editor-area-seamless::selection
              // { background: transparent }, ver styles.css).
              const getLiveSelectionRange = (): [number, number] | null => {
                void selectionTick;
                const ta = activeTextareaRef.current;
                if (!ta) return null;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                if (start === end) return null;
                return [Math.min(start, end), Math.max(start, end)];
              };

              const startDictation = async (): Promise<boolean> => {
                const speechCtor = getSpeechCtor();
                if (!speechCtor) {
                  setSpeechError('Tu navegador no soporta dictado por voz.');
                  return false;
                }

                const runningOnLocalhost =
                  typeof window !== 'undefined' &&
                  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
                const secureContext = typeof window !== 'undefined' ? window.isSecureContext : false;

                if (!secureContext && !runningOnLocalhost) {
                  setSpeechError('El dictado por voz requiere HTTPS o localhost.');
                  return false;
                }

                if (typeof navigator !== 'undefined' && (navigator as any).permissions?.query) {
                  try {
                    const permission = await (navigator as any).permissions.query({ name: 'microphone' });
                    if (permission.state === 'denied') {
                      setSpeechError('Micrófono bloqueado. Habilita permisos de audio para usar escritura por voz.');
                      return false;
                    }
                  } catch {}
                }

                stopDictation();
                setSpeechError(null);

                const recognition = new speechCtor();
                const baseText = liveText;
                const separator = baseText.trim().length > 0 ? '\n' : '';
                let accumulatedFinal = '';
                const minAcceptedConfidence = 0.46;

                recognition.lang = 'es-PE';
                recognition.continuous = true;
                recognition.interimResults = false;
                recognition.maxAlternatives = 3;

                recognition.onresult = (e: any) => {
                  let discardedLowConfidence = false;
                  for (let index = e.resultIndex; index < e.results.length; index += 1) {
                    const result = e.results[index];
                    if (!result?.isFinal) {
                      continue;
                    }

                    const bestAlternative = pickBestTranscriptAlternative(result);
                    if (!bestAlternative.transcript) {
                      continue;
                    }

                    const normalizedTranscript = normalizeDictationText(bestAlternative.transcript);

                    if (isLikelyLowQualityTranscript(normalizedTranscript)) {
                      continue;
                    }

                    if (bestAlternative.confidence > 0 && bestAlternative.confidence < minAcceptedConfidence) {
                      discardedLowConfidence = true;
                      continue;
                    }

                    accumulatedFinal += `${normalizedTranscript} `;
                  }

                  const spokenText = accumulatedFinal.trim();
                  const nextText = spokenText ? `${baseText}${separator}${spokenText}` : baseText;
                  updateTextProps({ text: nextText });

                  if (discardedLowConfidence) {
                    setSpeechError('Se filtró audio con baja confianza para reducir errores de transcripción.');
                  } else {
                    setSpeechError(null);
                  }
                };

                recognition.onerror = (event: any) => {
                  const reason = String(event?.error || 'unknown');
                  if (reason === 'not-allowed' || reason === 'service-not-allowed') {
                    setSpeechError('Permiso denegado para micrófono. Debes habilitarlo en el navegador.');
                  } else if (reason === 'no-speech') {
                    setSpeechError('No se detectó voz. Intenta nuevamente hablando más cerca del micrófono.');
                  } else if (reason === 'audio-capture') {
                    setSpeechError('No se detecta micrófono disponible en el equipo.');
                  } else {
                    setSpeechError('No se pudo capturar audio. Revisa permisos de micrófono.');
                  }
                  setIsDictating(false);
                };

                recognition.onend = () => {
                  recognitionRef.current = null;
                  dictationTargetRef.current = null;
                  setIsDictating(false);
                };

                recognitionRef.current = recognition;
                dictationTargetRef.current = element.id;
                setIsDictating(true);
                try {
                  recognition.start();
                  return true;
                } catch {
                  setIsDictating(false);
                  setSpeechError('No se pudo iniciar dictado. Intenta otra vez.');
                  return false;
                }
              };

              const toggleDictation = async (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();

                if (isCurrentDictationTarget) {
                  stopDictation();
                  setSpeechError(null);
                  return;
                }

                if (isDictating && dictationTargetRef.current !== element.id) {
                  stopDictation();
                }

                await startDictation();
              };

              const runQuickCorrection = async () => {
                const payload = textForSpellOrRewrite(liveText);
                if (!payload) {
                  setCorrectionInfo('Escribe o pega el texto a corregir (no uses solo el texto de ayuda vacío).');
                  setTimeout(() => setCorrectionInfo(null), 4000);
                  return;
                }
                setCorrectionInfo('Servidor: corrección rápida…');
                try {
                  const data = await measurePerfAsync('ia_correction', () => textCorrectQuick(payload));
                  if (data?.error) {
                    if (data.error === 'empty_text') {
                      setCorrectionInfo('No hay texto válido para corregir.');
                    } else {
                      setCorrectionInfo(typeof data.error === 'string' ? data.error : 'Error en servidor.');
                    }
                    setTimeout(() => setCorrectionInfo(null), 4000);
                    return;
                  }
                  const correctedText = String(data?.text ?? payload);
                  updateTextProps({ text: correctedText });
                  if (correctedText !== payload) {
                    setCorrectionInfo('Se aplicaron correcciones rápidas (backend).');
                  } else {
                    setCorrectionInfo('No se detectaron correcciones rápidas pendientes.');
                  }
                } catch (e: any) {
                  const msg = e?.response?.data?.error || e?.message || '';
                  setCorrectionInfo(msg ? `Error: ${msg}` : 'No se pudo contactar al servidor.');
                } finally {
                  setTimeout(() => setCorrectionInfo(null), 4000);
                }
              };

              const runAdvancedCorrection = async () => {
                const sourceText = textForSpellOrRewrite(liveText);
                if (!sourceText) {
                  setAdvancedSuggestions([]);
                  setCorrectionInfo('No hay texto para analizar (escribe contenido real, no solo la ayuda).');
                  return;
                }

                setIsAnalyzingSpelling(true);
                setCorrectionInfo('Servidor: análisis ortográfico y gramatical…');

                try {
                  const data = await measurePerfAsync('ia_correction', () => textCorrectAdvanced(sourceText, {
                    language: 'es-PE',
                    level: 'picky',
                  }));
                  if (data?.error) {
                    setAdvancedSuggestions([]);
                    setCorrectionInfo(
                      data.error === 'languagetool_unavailable'
                        ? 'LanguageTool no disponible en el servidor.'
                        : data.error === 'empty_text'
                          ? 'No hay texto válido para analizar.'
                          : String(data.error),
                    );
                    return;
                  }
                  const raw = Array.isArray(data?.suggestions) ? data.suggestions : [];
                  const suggestions: AdvancedSuggestion[] = raw
                    .map((row: any) => ({
                      offset: Number(row?.offset ?? 0),
                      length: Number(row?.length ?? 0),
                      message: String(row?.message ?? 'Posible corrección'),
                      replacements: Array.isArray(row?.replacements)
                        ? row.replacements.map((r: unknown) => String(r ?? '').trim()).filter(Boolean).slice(0, 5)
                        : [],
                      context: String(row?.context ?? ''),
                    }))
                    .filter((item: AdvancedSuggestion) => item.length > 0);

                  setAdvancedSuggestions(suggestions);
                  if (suggestions.length > 0) {
                    setCorrectionInfo(`Se detectaron ${suggestions.length} sugerencias (backend).`);
                  } else {
                    setCorrectionInfo('No se detectaron errores ortográficos/gramaticales relevantes.');
                  }
                } catch (e: any) {
                  setAdvancedSuggestions([]);
                  const msg = e?.response?.data?.error || e?.message || '';
                  setCorrectionInfo(msg ? `Corrector avanzado: ${msg}` : 'No se pudo ejecutar el corrector avanzado.');
                } finally {
                  setIsAnalyzingSpelling(false);
                }
              };

              const applyAdvancedSuggestion = (suggestion: AdvancedSuggestion, replacement: string) => {
                const currentText = String(liveText || '');
                if (!replacement.trim()) {
                  return;
                }

                const before = currentText.slice(0, suggestion.offset);
                const after = currentText.slice(suggestion.offset + suggestion.length);
                const nextText = `${before}${replacement}${after}`;
                updateTextProps({ text: nextText });

                setAdvancedSuggestions((prev) => prev.filter((item) => item !== suggestion));
                setCorrectionInfo('Se aplicó una sugerencia ortográfica.');
              };

              const handleTextShortcuts = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                const withModifier = event.ctrlKey || event.metaKey;
                if (!withModifier) {
                  return;
                }

                const key = event.key.toLowerCase();

                if (key === 'b') {
                  event.preventDefault();
                  updateTextProps({ bold: !textProps.bold });
                  return;
                }

                if (key === 'i') {
                  event.preventDefault();
                  updateTextProps({ italic: !textProps.italic });
                  return;
                }

                if (key === 'u') {
                  event.preventDefault();
                  updateTextProps({ underline: !textProps.underline });
                  return;
                }

                if (event.shiftKey && key === '7') {
                  event.preventDefault();
                  updateTextProps({ listType: 'bullet', text: applyListToText(textProps.text, 'bullet') });
                  return;
                }

                if (event.shiftKey && key === '8') {
                  event.preventDefault();
                  updateTextProps({ listType: 'number', text: applyListToText(textProps.text, 'number') });
                  return;
                }

                if (event.shiftKey && key === '0') {
                  event.preventDefault();
                  updateTextProps({ listType: 'none' });
                }
              };

              // ADR-049 (revisado) — ajuste de texto alrededor de objetos,
              // réplica de las 7 opciones de "Opciones de diseño" de Word:
              //   square/tight/through → excluyen el rectángulo del objeto
              //     (izquierda/derecha), con margen decreciente (12/4/0px —
              //     sin polígono de silueta, 'through' se resuelve igual que
              //     'tight' para un rectángulo, pero se expone aparte por
              //     fidelidad con el menú de Word),
              //   topbottom → excluye la franja vertical completa,
              //   behind/infront/inline/none → no excluyen nada (el objeto
              //     flota libremente; behind/infront solo cambian el z-order
              //     via el div wrapper, ver filtro type==='image' más abajo).
              // Si no hay solapes, se usa el <Text> único de Konva de
              // siempre (más barato) en vez de partir el párrafo en líneas.
              const TEXT_PAD = 8;
              const WRAP_GAP_BY_MODE: Record<string, number> = { square: 12, tight: 4, through: 0, topbottom: 12 };
              const wrapExclusions: WrapExclusion[] = page.elements
                .filter((o) =>
                  o.id !== element.id &&
                  (o.wrapMode === 'square' || o.wrapMode === 'tight' || o.wrapMode === 'through' || o.wrapMode === 'topbottom') &&
                  o.x < element.x + element.width && o.x + o.width > element.x &&
                  o.y < element.y + element.height && o.y + o.height > element.y)
                .map((o) => {
                  const gap = WRAP_GAP_BY_MODE[o.wrapMode as string] ?? 12;
                  const exclusionMode = o.wrapMode === 'topbottom' ? 'topbottom' : 'square';
                  return {
                    x0: o.x - gap - (element.x + TEXT_PAD),
                    x1: o.x + o.width + gap - (element.x + TEXT_PAD),
                    yTop: o.y - gap - (element.y + TEXT_PAD),
                    yBot: o.y + o.height + gap - (element.y + TEXT_PAD),
                    mode: exclusionMode as 'square' | 'topbottom',
                  };
                });
              const wrappedLayout = !isEditorOpen && wrapExclusions.length > 0
                ? computeWrappedTextLines(
                    textProps.text,
                    textBaseStyle,
                    textProps.lineHeight,
                    Math.max(120, element.width - TEXT_PAD * 2),
                    wrapExclusions,
                    textProps.spans,
                  )
                : null;

              return [
                wrappedLayout
                  ? wrappedLayout.segments.map((seg, segIndex) => (
                      <Text
                        key={`${element.id}-render-seg-${segIndex}`}
                        x={element.x + TEXT_PAD + seg.x}
                        y={element.y + TEXT_PAD + seg.y}
                        text={seg.text}
                        fontFamily={seg.style.fontFamily}
                        fontSize={seg.style.fontSize}
                        fill={seg.style.color}
                        lineHeight={textProps.lineHeight}
                        fontStyle={`${seg.style.bold ? 'bold ' : ''}${seg.style.italic ? 'italic' : ''}`.trim() || 'normal'}
                        textDecoration={seg.style.underline ? 'underline' : ''}
                        wrap="none"
                        listening={false}
                        hitStrokeWidth={0}
                      />
                    ))
                  : (!isEditorOpen && textProps.spans.length > 0) ? (
                      // Formato por selección (spans): al menos un tramo del
                      // texto tiene un estilo distinto al del bloque — ya no
                      // se puede pintar con un solo <Text> de Konva
                      // (estilo uniforme). Se renderiza como HTML real
                      // (mismo mecanismo que tablas/imágenes/KPIs de este
                      // editor) para que negrita/color/tamaño/fuente por
                      // tramo se vean exactamente igual que en el overlay de
                      // edición — WYSIWYG entre "editando" y "estático".
                      <Html
                        key={`${element.id}-render-rich`}
                        groupProps={{ x: element.x + 8, y: element.y + 8, listening: false }}
                        divProps={{ style: { pointerEvents: 'none' } }}
                      >
                        <div
                          style={{
                            width: Math.max(120, element.width - 16),
                            minHeight: Math.max(40, element.height - 16),
                            fontFamily: textProps.fontFamily,
                            fontSize: `${textProps.fontSize}px`,
                            color: textProps.fontColor,
                            textAlign: textProps.textAlign as any,
                            lineHeight: textProps.lineHeight,
                            fontWeight: textProps.bold ? 700 : 400,
                            fontStyle: textProps.italic ? 'italic' : 'normal',
                            textDecoration: textProps.underline ? 'underline' : 'none',
                            whiteSpace: 'pre-wrap',
                            wordWrap: 'break-word',
                          }}
                        >
                          {buildStyledSegments(textProps.text, textProps.spans, textBaseStyle).map((seg, segIndex) => (
                            <span key={segIndex} style={styleToCss(seg.style) as any}>{seg.text}</span>
                          ))}
                        </div>
                      </Html>
                    ) : (
                    <Text
                      key={`${element.id}-render`}
                      x={element.x + 8}
                      y={element.y + 8}
                      width={Math.max(120, element.width - 16)}
                      height={Math.max(40, element.height - 16)}
                      text={textProps.text}
                      fontFamily={textProps.fontFamily}
                      fontSize={textProps.fontSize}
                      fill={textProps.fontColor}
                      align={textProps.textAlign}
                      lineHeight={textProps.lineHeight}
                      fontStyle={`${textProps.bold ? 'bold ' : ''}${textProps.italic ? 'italic' : ''}`.trim() || 'normal'}
                      textDecoration={textProps.underline ? 'underline' : ''}
                      listening={false}
                      hitStrokeWidth={0}
                      visible={!isEditorOpen}
                    />
                    ),
                !isEditorOpen && isElementSelected ? (
                    <Html key={`${element.id}-floating-toolbar`} groupProps={{ x: element.x, y: element.y - 48 }}>
                      <FloatingContextualToolbar
                        element={element}
                        onUpdate={(patch) => updateElement(page.page_number, element.id, patch)}
                        onRemove={() => removeElement(page.page_number, element.id)}
                        onOpenInspector={() => {
                          // Signal to App.jsx to ensure right panel is visible
                          window.dispatchEvent(new CustomEvent('mining-studio-open-inspector'));
                        }}
                        onAction={(action) => {
                          if (action === 'edit' && element.type === 'text') {
                            setOpenTextEditorId(element.id);
                          }
                          if (action === 'replace' && element.type === 'image') {
                            onRequestImageReplace?.(page.page_number, element.id, 'file');
                          }
                          // Dictado y corrección — accesibles con un solo
                          // clic desde la selección (sin doble clic previo).
                          // Se abre el editor a la vez para que el usuario
                          // vea el resultado (indicador de dictado, lista de
                          // sugerencias) en el mismo lienzo.
                          if (action === 'dictate' && element.type === 'text') {
                            setOpenTextEditorId(element.id);
                            if (isCurrentDictationTarget) {
                              stopDictation();
                              setSpeechError(null);
                            } else {
                              if (isDictating && dictationTargetRef.current !== element.id) {
                                stopDictation();
                              }
                              void startDictation();
                            }
                          }
                          if (action === 'spellcheck-quick' && element.type === 'text') {
                            setOpenTextEditorId(element.id);
                            void runQuickCorrection();
                          }
                          if (action === 'spellcheck-advanced' && element.type === 'text') {
                            setOpenTextEditorId(element.id);
                            void runAdvancedCorrection();
                          }
                        }}
                      />
                    </Html>
                  ) : null,
                isEditorOpen ? (
                    <Html key={`${element.id}-text`} groupProps={{ x: element.x + 8, y: element.y + 8 }}>
                      <div
                        className="text-editor-seamless-container"
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {/* Formato por selección — negrita/cursiva/subrayado/
                           color/tamaño/fuente SOLO al texto que el usuario
                           tenga seleccionado en el textarea de abajo (ver
                           applyFormatToSelection). Requiere una selección
                           real; con el cursor colapsado no hace nada, igual
                           que en Word. */}
                        <div
                          className="text-editor-format-row"
                          onMouseDown={(event) => {
                            // preventDefault evita que el mousedown le quite el
                            // foco/selección al textarea al hacer clic en los
                            // BOTONES de esta barra (Negrita/Cursiva/A-/A+/etc,
                            // ver applyFormatToSelection). Pero en Chrome/Edge
                            // ese mismo preventDefault en el mousedown de un
                            // <select> NATIVO bloquea que el navegador abra su
                            // lista de opciones — bug real reportado: "Estilo"
                            // y "Fuente" quedaban fijos, ningún clic los abría.
                            // Los <select> (Estilo, Fuente) manejan su propio
                            // mousedown (ver más abajo, captureSelection) para
                            // seguir capturando la selección antes de perder
                            // foco, sin bloquear su apertura nativa.
                            if ((event.target as HTMLElement).tagName === 'SELECT') return;
                            event.preventDefault();
                          }}
                        >
                          {/* Estilo de documento (Título/Heading 1-6) sobre la
                             SELECCIÓN — no todo el bloque. Marca el rango con
                             headingStyle (ver lib/textSpans.ts) para que la
                             Tabla de Contenidos lo detecte igual que un
                             bloque entero (TableOfContents.tsx ya escanea
                             ambos). "Normal" (valor "") es la opción por
                             defecto: sin encabezado, no aparece en el TOC. */}
                          <select
                            className="text-editor-format-select text-editor-format-heading-select"
                            title="Estilo de documento de la selección (para la Tabla de Contenidos)"
                            value={selectionHeadingStyle}
                            onMouseDown={captureSelection}
                            onChange={(event) => {
                              applyHeadingStyleToSelection(event.target.value);
                              handleSelectionMaybeChanged();
                            }}
                          >
                            <option value="">Normal</option>
                            {SELECTION_HEADING_OPTIONS.map((h) => (
                              <option key={h.id} value={h.id}>{h.label}</option>
                            ))}
                          </select>
                          <div className="text-editor-format-divider" />
                          <button type="button" title="Negrita en la selección" onClick={() => applyFormatToSelection({ bold: true })}>
                            <Bold size={12} />
                          </button>
                          <button type="button" title="Cursiva en la selección" onClick={() => applyFormatToSelection({ italic: true })}>
                            <Italic size={12} />
                          </button>
                          <button type="button" title="Subrayado en la selección" onClick={() => applyFormatToSelection({ underline: true })}>
                            <Underline size={12} />
                          </button>
                          <button
                            type="button"
                            title="Cambiar MAYÚSCULAS/minúsculas/Cada Palabra (como Word)"
                            onClick={applyCaseToSelection}
                          >
                            Aa
                          </button>
                          <ColorPalette
                            value={selectionFontColor}
                            title="Color del texto de la selección"
                            onOpen={captureSelection}
                            onChange={(color) => { applyFormatToSelection({ color }); handleSelectionMaybeChanged(); }}
                          />
                          <Highlighter size={13} className="text-editor-format-highlight-icon" />
                          <ColorPalette
                            value={selectionHighlightColor}
                            title="Color de resaltado de fondo de la selección"
                            allowClear
                            onOpen={captureSelection}
                            onChange={(color) => { applyFormatToSelection({ highlightColor: color }); handleSelectionMaybeChanged(); }}
                            onClear={() => { applyFormatToSelection({ highlightColor: 'transparent' }); handleSelectionMaybeChanged(); }}
                          />
                          {/* Cuadro indicador: muestra la fuente de lo que hay
                             seleccionado con el mouse. En blanco si la
                             selección mezcla dos o más fuentes distintas (no
                             hay UNA fuente que mostrar) — igual que Word deja
                             ese campo vacío ante una selección mixta. Es solo
                             lectura; el cambio de fuente se hace con el
                             selector de al lado. */}
                          <span
                            className="text-editor-format-current-font"
                            title={
                              selectionFontFamily
                                ? `Fuente de la selección: ${selectionFontFamily}`
                                : 'La selección mezcla varias fuentes'
                            }
                          >
                            {selectionFontFamily || '—'}
                          </span>
                          <select
                            className="text-editor-format-select"
                            title="Cambiar la fuente de la selección"
                            defaultValue=""
                            // Bug real: al mover el foco de verdad al <select>
                            // (mousedown→focus, no solo un evento sintético),
                            // el navegador COLAPSA ta.selectionStart/End a la
                            // posición del cursor — para cuando onChange se
                            // dispara (el usuario ya eligió una opción, el
                            // foco lleva rato en el select), la selección
                            // "viva" del textarea ya no existe. captureSelection
                            // guarda el rango ANTES de ese blur (mousedown
                            // ocurre primero), y applyFormatToSelection lo usa
                            // en vez de la selección ya colapsada — mismo
                            // arreglo que ya tenía el selector de Estilo.
                            onMouseDown={captureSelection}
                            onChange={(event) => {
                              if (!event.target.value) return;
                              applyFormatToSelection({ fontFamily: event.target.value });
                              event.target.value = '';
                              handleSelectionMaybeChanged();
                            }}
                          >
                            <option value="" disabled>Fuente…</option>
                            {['Arial', 'Inter', 'Times New Roman', 'Georgia', 'Calibri', 'Verdana'].map((f) => (
                              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            title="Reducir tamaño de la selección (mínimo 7)"
                            onClick={() => applyFormatToSelection({ fontSize: Math.max(7, getSelectionFontSize() - 2) })}
                          >
                            A-
                          </button>
                          <button
                            type="button"
                            title="Aumentar tamaño de la selección (máximo 200)"
                            onClick={() => applyFormatToSelection({ fontSize: Math.min(200, getSelectionFontSize() + 2) })}
                          >
                            A+
                          </button>
                        </div>

                        {/* Floating mini-toolbar for AI and Speech - non-intrusive */}
                        <div className="text-editor-mini-actions">
                          <button
                            type="button"
                            className={isCurrentDictationTarget ? 'active' : ''}
                            title="Dictado por voz"
                            disabled={!speechSupported}
                            onClick={toggleDictation}
                          >
                            {isCurrentDictationTarget ? <MicOff size={12} /> : <Mic size={12} />}
                          </button>
                          <button
                            type="button"
                            title="Corregir ortografía"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void runQuickCorrection();
                            }}
                          >
                            <CheckCheck size={12} />
                          </button>
                          <button
                            type="button"
                            title="Mejorar con IA"
                            className={isImproving ? 'loading' : ''}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              runAIImprovement(String(liveText || ''), (patch) => updateTextProps(patch));
                            }}
                          >
                            <Wand2 size={12} />
                          </button>
                          <button
                            type="button"
                            className="btn-close-seamless"
                            onClick={closeAndProcess}
                          >
                            <Save size={12} />
                          </button>
                        </div>

                        <div className="text-editor-rich-wrap" style={{ position: 'relative', width: `${Math.max(120, liveWidth - 16)}px`, height: `${Math.max(40, liveHeight - 16)}px` }}>
                          {/* Overlay "fantasma": pinta el texto con el formato
                             real (por span) DEBAJO del textarea. El textarea
                             de encima queda con texto invisible (solo se ve
                             su caret) para que el usuario siga escribiendo/
                             seleccionando con el comportamiento nativo del
                             navegador (IME, doble-clic para elegir palabra,
                             flechas, etc.) mientras VE el resultado con
                             formato mixto en tiempo real — la técnica clásica
                             de "textarea con resaltado" (usada por editores
                             de código embebidos), sin reescribir toda la
                             máquina de tecleo/IME ya afinada en Fase 1/2. */}
                          <div
                            aria-hidden
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%',
                              fontFamily: textProps.fontFamily,
                              fontSize: `${textProps.fontSize}px`,
                              color: textProps.fontColor,
                              textAlign: textProps.textAlign as any,
                              lineHeight: textProps.lineHeight,
                              fontWeight: textProps.bold ? 700 : 400,
                              fontStyle: textProps.italic ? 'italic' : 'normal',
                              textDecoration: textProps.underline ? 'underline' : 'none',
                              whiteSpace: 'pre-wrap',
                              wordWrap: 'break-word',
                              pointerEvents: 'none',
                            }}
                          >
                            {(() => {
                              const selRange = getLiveSelectionRange();
                              let offset = 0;
                              return buildStyledSegments(liveText, liveSpans, textBaseStyle).map((seg, segIndex) => {
                                const segStart = offset;
                                const segEnd = offset + seg.text.length;
                                offset = segEnd;
                                const css = styleToCss(seg.style) as any;
                                // Sin cruce con la selección viva: un solo
                                // <span>, camino histórico sin cambios.
                                if (!selRange || selRange[1] <= segStart || selRange[0] >= segEnd) {
                                  return <span key={segIndex} style={css}>{seg.text}</span>;
                                }
                                // La porción seleccionada se parte en hasta 3
                                // trozos (antes/dentro/después) para pintar un
                                // indicador de selección PROPIO — ver el
                                // comentario de getLiveSelectionRange arriba:
                                // a diferencia de la selección nativa del
                                // navegador (atada al tamaño uniforme del
                                // <textarea>), este indicador nace del mismo
                                // cálculo de segmentos que ya usa el tamaño de
                                // fuente real por span, así que crece/encoge
                                // correctamente junto con A+/A-.
                                const [selStart, selEnd] = selRange;
                                const parts: { text: string; selected: boolean }[] = [];
                                const midStart = Math.max(segStart, selStart) - segStart;
                                const midEnd = Math.min(segEnd, selEnd) - segStart;
                                if (midStart > 0) parts.push({ text: seg.text.slice(0, midStart), selected: false });
                                parts.push({ text: seg.text.slice(midStart, midEnd), selected: true });
                                if (midEnd < seg.text.length) parts.push({ text: seg.text.slice(midEnd), selected: false });
                                return parts.map((part, partIndex) => {
                                  if (!part.text) return null;
                                  const partStyle = part.selected
                                    ? css.backgroundColor
                                      ? { ...css, outline: '2px solid rgba(37,99,235,0.65)', outlineOffset: -1 }
                                      : { ...css, backgroundColor: 'rgba(37,99,235,0.35)' }
                                    : css;
                                  return <span key={`${segIndex}-${partIndex}`} style={partStyle}>{part.text}</span>;
                                });
                              });
                            })()}
                            {liveText === '' && <span style={{ opacity: 0 }}>&nbsp;</span>}
                          </div>

                          <textarea
                            ref={activeTextareaRef}
                            className="text-editor-area-seamless"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              fontFamily: textProps.fontFamily,
                              fontSize: `${textProps.fontSize}px`,
                              // Texto invisible — el overlay de arriba es lo
                              // que realmente se ve; el textarea solo aporta
                              // el caret (visible via caretColor) y la
                              // selección nativa del navegador.
                              color: 'transparent',
                              caretColor: textProps.fontColor,
                              textAlign: textProps.textAlign as any,
                              lineHeight: textProps.lineHeight,
                              fontWeight: textProps.bold ? 700 : 400,
                              fontStyle: textProps.italic ? 'italic' : 'normal',
                              textDecoration: textProps.underline ? 'underline' : 'none',
                              whiteSpace: 'pre-wrap',
                              wordWrap: 'break-word',
                              width: '100%',
                              height: '100%',
                              background: 'transparent',
                              outline: 'none',
                              border: 'none',
                              resize: 'none',
                              padding: 0,
                              margin: 0,
                              display: 'block',
                              // Antes 'hidden': si el cálculo de auto-tamaño se
                              // quedaba corto por cualquier motivo, el texto
                              // ya escrito quedaba oculto sin avisar — nunca
                              // debe perderse de vista lo que el usuario
                              // escribió, aunque el cuadro visual del lienzo
                              // aún no se haya puesto al día.
                              overflow: 'visible'
                            }}
                            autoFocus
                            value={liveText}
                            placeholder="Empieza a escribir..."
                            onBlur={(event) => {
                              // Bug real: hacer clic en un <select> NATIVO
                              // (Estilo/Fuente) mueve el foco del navegador
                              // del textarea hacia el select — eso SIEMPRE
                              // dispara onBlur del textarea, sin importar el
                              // preventDefault del mousedown. Cerrar el editor
                              // en cualquier blur significaba que abrir esos
                              // selects cerraba TODO el bloque de edición
                              // (textarea + barra flotante) antes de poder
                              // elegir una opción. Ahora solo se cierra si el
                              // foco sale COMPLETAMENTE del editor (afuera de
                              // .text-editor-seamless-container, que incluye
                              // la barra de formato y sus selects/popovers de
                              // color) — igual que Word no cierra el cursor
                              // de edición al usar su propia barra flotante.
                              const next = event.relatedTarget as Node | null;
                              const container = event.currentTarget.closest('.text-editor-seamless-container');
                              if (next && container?.contains(next)) {
                                return;
                              }
                              closeAndProcess();
                            }}
                            onChange={(event) => handleLiveTyping(event.target.value)}
                            onCompositionStart={() => {
                              isComposingRef.current = true;
                            }}
                            onCompositionEnd={(event) => {
                              // Fin de composición IME (á, ñ compuesta, CJK):
                              // recién aquí se mide y redimensiona con el
                              // carácter definitivo (ver guardia en
                              // updateTextProps).
                              isComposingRef.current = false;
                              updateTextProps({ text: event.currentTarget.value });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                closeAndProcess();
                              }
                              handleTextShortcuts(event);
                            }}
                            // Marcar/mover la selección con el mouse (arrastre,
                            // doble clic para elegir palabra) o con flechas +
                            // Shift no dispara onChange — sin estos tres, el
                            // cuadro indicador de fuente de la barra de
                            // formato quedaba desactualizado hasta la próxima
                            // tecla que sí modificara el texto.
                            onSelect={handleSelectionMaybeChanged}
                            onMouseUp={handleSelectionMaybeChanged}
                            onKeyUp={handleSelectionMaybeChanged}
                            spellCheck={true}
                            lang={spellcheckLang}
                            // Higiene sdkjs (text_input.js:211-215): impedir que
                            // el navegador/SO mute el texto por su cuenta bajo
                            // el modelo — el corrector propio de la plataforma
                            // (LanguageTool) es el único autorizado a corregir.
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                          />
                        </div>

                        {advancedSuggestions.length > 0 && (
                          <div className="text-advanced-list">
                            {advancedSuggestions.slice(0, 6).map((suggestion, index) => (
                              <div key={`${suggestion.offset}-${suggestion.length}-${index}`} className="text-advanced-item">
                                <div className="text-advanced-message">{suggestion.message}</div>
                                {suggestion.context && <div className="text-advanced-context">{suggestion.context}</div>}
                                <div className="text-advanced-actions">
                                  {suggestion.replacements.length > 0 ? (
                                    suggestion.replacements.map((replacement, replacementIndex) => (
                                      <button
                                        key={`${replacement}-${replacementIndex}`}
                                        type="button"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          applyAdvancedSuggestion(suggestion, replacement);
                                        }}
                                      >
                                        {replacement}
                                      </button>
                                    ))
                                  ) : (
                                    <span className="text-editor-hint">Sin sugerencias automáticas.</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {speechError && <div className="text-editor-error">{speechError}</div>}
                        {correctionInfo && <div className="text-editor-info">{correctionInfo}</div>}
                      </div>
                    </Html>
                  ) : null,
              ];
            })}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            resizeEnabled
            keepRatio={false}
            centeredScaling={false}
            anchorSize={14}
            anchorCornerRadius={4}
            anchorStroke="#1d4ed8"
            anchorFill="#ffffff"
            anchorStrokeWidth={2}
            borderStroke="#2563eb"
            borderStrokeWidth={1.2}
            enabledAnchors={[
              'top-left',
              'top-center',
              'top-right',
              'middle-left',
              'middle-right',
              'bottom-left',
              'bottom-center',
              'bottom-right',
            ]}
          />
        </Layer>
      </Stage>

      {contextMenu && (() => {
        const menuElement = page.elements.find((el) => el.id === contextMenu.elementId);
        if (!menuElement) return null;
        return (
          <div
            className="canvas-context-menu"
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 2000,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
              padding: 4,
              minWidth: 180,
              display: 'flex',
              flexDirection: 'column',
              fontSize: 13,
            }}
          >
            {menuElement.type === 'cover' && (
              <button
                type="button"
                onClick={() => {
                  onRequestCoverImage?.(page.page_number, menuElement.id);
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 6, color: '#0f172a', fontWeight: 600,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Insertar imagen empresa
              </button>
            )}
            {menuElement.type === 'toc' && (
              <button
                type="button"
                onClick={() => {
                  // El índice ya recalcula sus entradas leyendo el documento
                  // completo en cada render de ESTA página — pero si el
                  // heading que cambió vive en OTRA página, esa página ajena
                  // se re-renderiza a sí misma sin tocar la página del índice
                  // (React.memo por identidad de `page`), así que el índice
                  // puede quedar desactualizado hasta que algo más toque su
                  // propia página. "Actualizar" fuerza exactamente eso: toca
                  // el propio bloque toc (referencia nueva de página) para
                  // garantizar el recálculo con el documento más reciente,
                  // igual que F9 en Word actualiza un campo de TDC.
                  updateElement(page.page_number, menuElement.id, {
                    props: { ...menuElement.props, _refreshedAt: Date.now() },
                  });
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 6, color: '#0f172a', fontWeight: 600,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Actualizar índice
              </button>
            )}
            {['image', 'chart', 'table', 'kpi', 'sensor', 'map'].includes(menuElement.type) && (
              <div
                onMouseEnter={() => setContextWrapSubmenuOpen(true)}
                onMouseLeave={() => setContextWrapSubmenuOpen(false)}
                style={{ position: 'relative' }}
              >
                <button
                  type="button"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '8px 10px', width: '100%',
                    border: 'none', background: contextWrapSubmenuOpen ? '#f1f5f9' : 'transparent',
                    cursor: 'pointer', textAlign: 'left', borderRadius: 6, color: '#0f172a',
                  }}
                >
                  Ajustar texto
                  <span style={{ opacity: 0.5 }}>▸</span>
                </button>
                {contextWrapSubmenuOpen && (
                  <div
                    style={{
                      position: 'absolute', left: '100%', top: 0, marginLeft: 2,
                      background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)', padding: 4, minWidth: 190,
                      display: 'flex', flexDirection: 'column',
                    }}
                  >
                    {WRAP_MODE_OPTIONS.map((o) => {
                      const active = normalizeWrapMode(menuElement.wrapMode) === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          title={o.hint}
                          onClick={() => {
                            updateElement(page.page_number, menuElement.id, { wrapMode: o.value });
                            setContextMenu(null);
                            setContextWrapSubmenuOpen(false);
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                            border: 'none', background: active ? '#eff6ff' : 'transparent',
                            cursor: 'pointer', textAlign: 'left', borderRadius: 6,
                            color: active ? '#1d4ed8' : '#0f172a', fontWeight: active ? 700 : 400,
                          }}
                          onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#f1f5f9'; }}
                          onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {active ? '✓' : ''} {o.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {menuElement.type !== 'header' && menuElement.type !== 'footer' && menuElement.type !== 'cover' && (
              <button
                type="button"
                onClick={() => {
                  copyElement(page.page_number, menuElement.id);
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 6, color: '#0f172a',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Copiar bloque <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>Ctrl+C</span>
              </button>
            )}
            {clipboardElement && (
              <button
                type="button"
                onClick={() => {
                  pasteElement(page.page_number);
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 6, color: '#0f172a',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Pegar bloque <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>Ctrl+V</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                updateElement(page.page_number, menuElement.id, { locked: !menuElement.locked });
                setContextMenu(null);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                borderRadius: 6, color: '#0f172a',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {menuElement.locked ? 'Desbloquear bloque' : 'Bloquear bloque'}
            </button>
            <button
              type="button"
              onClick={() => {
                removeElement(page.page_number, menuElement.id);
                setContextMenu(null);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                borderRadius: 6, color: '#b91c1c', fontWeight: 600,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Eliminar bloque
            </button>
          </div>
        );
      })()}
    </div>
  );
});

export default PageCanvas;
