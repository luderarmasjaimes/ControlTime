import { create } from 'zustand';
import { getReportLayoutMetrics, type ReportLayoutMetrics } from '../lib/reportLayoutMetrics';
import { REPORT_IMAGE_PLACEHOLDER_SVG } from '../lib/reportImageSrc';
import { generateTocData } from '../components/document/TableOfContents';
import { HEADING_STYLES } from '../lib/headingStyles';
import { buildDocumentTemplate } from '../lib/documentTemplates';
import { sensorDashboardMinHeight } from '../lib/sensorMultiChartLayout';

import { log } from '../../../lib/logger';
const INSERT_GAP = 12;

/** Resuelve las métricas de lienzo desde `doc.meta` — único punto que lee
 * layoutMode/paperSize/orientation, para que el tamaño de página (A4/A3,
 * vertical/horizontal) se aplique de forma consistente en cada acción que
 * crea o reposiciona elementos. */
const metricsFromMeta = (meta: Partial<DocumentMeta> | undefined) =>
  getReportLayoutMetrics(
    meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
    meta?.paperSize || 'A4',
    meta?.orientation || 'portrait',
  );

/** Igual que `metricsFromMeta`, pero resolviendo primero el tamaño/
 * orientación PROPIOS de la página (si los tiene) antes de caer al valor
 * del documento — ver `resolvePagePaperSetup` más abajo. */
const metricsForPage = (
  page: Pick<ReportPage, 'paperSize' | 'orientation'>,
  meta: Partial<DocumentMeta> | undefined,
) => {
  const effective = resolvePagePaperSetup(page, meta);
  return getReportLayoutMetrics(
    meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
    effective.paperSize,
    effective.orientation,
  );
};

/** Ajusta `x/y/width/height` de un bloque de CONTENIDO (no encabezado/pie/
 * carátula, que ya recalculan su propia geometría) para que quepa dentro
 * del área de contenido de las métricas dadas -- se usa al cambiar tamaño
 * de hoja/orientación (A4↔A3, vertical↔horizontal). No reposiciona nada
 * que ya encaje (dos llamadas con las mismas métricas son un no-op); solo
 * corrige lo que la hoja nueva dejaría fuera de los márgenes o de la
 * página -- reportado en vivo como "fallas en los márgenes tanto para A3
 * como para A4" (un bloque cerca del borde derecho/inferior de una A4
 * vertical queda fuera del margen, o directamente fuera de la hoja, al
 * pasar a A3 horizontal o viceversa, porque antes esta función NO tocaba
 * nada fuera de header/footer/cover). */
function clampContentElementToMetrics(el: ReportElement, m: ReportLayoutMetrics): ReportElement {
  const maxWidth = Math.max(1, m.CONTENT_RIGHT - m.CONTENT_LEFT);
  const maxHeight = Math.max(1, m.CONTENT_BOTTOM - m.CONTENT_TOP);
  const width = Math.min(el.width, maxWidth);
  const height = Math.min(el.height, maxHeight);
  const x = Math.min(Math.max(el.x, m.CONTENT_LEFT), Math.max(m.CONTENT_LEFT, m.CONTENT_RIGHT - width));
  const y = Math.min(Math.max(el.y, m.CONTENT_TOP), Math.max(m.CONTENT_TOP, m.CONTENT_BOTTOM - height));
  if (x === el.x && y === el.y && width === el.width && height === el.height) return el;
  return { ...el, x, y, width, height };
}

/** Tipos de bloque "de plataforma" (encabezado/pie/carátula) que quedan
 * fuera del algoritmo de empaquetado -- no son contenido insertable por el
 * usuario, viven fuera del área de contenido (o la ocupan entera, en el caso
 * de carátula). */
const NON_PACKABLE_TYPES = new Set(['header', 'footer', 'cover']);

/** Vuelve a acomodar (empaquetar) los bloques de CONTENIDO de una página que
 * quedaron superpuestos ENTRE SÍ tras un `clampContentElementToMetrics` (p.ej.
 * al reducir A3→A4 dos bloques que antes no se tocaban pueden terminar
 * pisándose una vez que ambos se achican hacia los márgenes nuevos) -- el
 * clamp por sí solo corrige que un bloque se salga de la hoja/margen, nunca
 * que dos bloques queden superpuestos entre sí. Si no hay ninguna
 * superposición no toca nada (no reordena un layout que ya está bien).
 * Reutiliza `findFreeSlot` (mismo motor de empaquetado en 1/2 columnas que ya
 * usa la inserción de objetos nuevos) para que el resultado sea consistente
 * con cómo el usuario insertaría un bloque a mano. */
function repackOverlappingElements(elements: ReportElement[], m: ReportLayoutMetrics): ReportElement[] {
  const packable = elements.filter((el) => !NON_PACKABLE_TYPES.has(el.type));
  const hasOverlap = packable.some((a, i) =>
    packable
      .slice(i + 1)
      .some((b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y),
  );
  if (!hasOverlap) return elements;

  const ordered = [...packable].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: ReportElement[] = [];
  for (const el of ordered) {
    const slot = findFreeSlot(placed, m, el.width, el.height, m.CONTENT_TOP);
    placed.push(slot ? { ...el, x: slot.x, y: slot.y } : el);
  }
  const byId = new Map(placed.map((el) => [el.id, el]));
  return elements.map((el) => byId.get(el.id) || el);
}

/**
 * Encuentra la primera posición libre (sin solaparse con NINGÚN bloque de
 * contenido ya existente) para un objeto de `width`×`height` dentro del
 * área de contenido de `page`, en 1 o 2 columnas según lo que quepa —
 * motor de "empaquetado por estantes" (shelf packing): prueba cada Y
 * candidata (el tope del área de contenido, o el borde inferior + espaciado
 * de cada bloque ya existente) de arriba hacia abajo, y en cada una prueba
 * cada X candidata (el margen izquierdo, o el borde derecho + espaciado de
 * cualquier bloque que se solape verticalmente con esa fila) de izquierda a
 * derecha. Devuelve la PRIMERA combinación que entra en los márgenes y no
 * pisa ningún rectángulo existente -- o `null` si NINGUNA posición en toda
 * la página alcanza (el llamador decide si reduce el tamaño del objeto o
 * pasa a la siguiente hoja).
 *
 * Pedido explícito en vivo: "los diagramas de sensores deben insertarse en
 * 1 o 2 columnas... en todos los casos evitar salirse de los márgenes...
 * que no se dibuje un objeto encima de otro". Reemplaza el apilado anterior
 * (una sola columna, siempre al fondo de TODO lo demás) que ignoraba por
 * completo el espacio horizontal libre y podía, en algunos casos de anclaje
 * a un bloque seleccionado, terminar solapando un tercer bloque ya ubicado
 * en una fila distinta.
 */
function findFreeSlot(
  elements: ReportElement[],
  m: ReportLayoutMetrics,
  width: number,
  height: number,
  minY: number = m.CONTENT_TOP,
): { x: number; y: number } | null {
  const GAP = 12;
  const rects = elements
    .filter((el) => !NON_PACKABLE_TYPES.has(el.type))
    .map((el) => ({ x: el.x, y: el.y, w: el.width, h: el.height }));

  const contentRight = m.CONTENT_RIGHT;
  const contentBottom = m.CONTENT_BOTTOM;
  // Épsilon generoso: evita que redondeos de punto flotante (herencia de
  // conversiones mm→px en A3/A4) rechacen por error una posición que en la
  // práctica sí encaja al pixel.
  const EPS = 0.5;

  if (width > contentRight - m.CONTENT_LEFT + EPS || height > contentBottom - minY + EPS) return null;

  const overlaps = (x: number, y: number): boolean =>
    rects.some(
      (r) => x < r.x + r.w + GAP && x + width + GAP > r.x && y < r.y + r.h + GAP && y + height + GAP > r.y,
    );

  const candidateYs = Array.from(
    new Set([minY, ...rects.map((r) => r.y + r.h + GAP)].filter((y) => y >= minY && y + height <= contentBottom + EPS)),
  ).sort((a, b) => a - b);

  for (const y of candidateYs) {
    // Bloques que se solapan verticalmente con la franja [y, y+height) de
    // esta fila candidata -- sus bordes derechos son las X candidatas.
    const rowRects = rects.filter((r) => y < r.y + r.h + GAP && y + height + GAP > r.y);
    const candidateXs = Array.from(
      new Set([m.CONTENT_LEFT, ...rowRects.map((r) => r.x + r.w + GAP)].filter((x) => x + width <= contentRight + EPS)),
    ).sort((a, b) => a - b);
    for (const x of candidateXs) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Aplica un cambio de tamaño de hoja (A4/A3) u orientación (vertical/
 * horizontal) — recalcula la geometría de los bloques "de plataforma" fijos
 * (encabezado, pie de página, carátula a toda hoja) para que sigan
 * ocupando el ancho/alto correcto de la nueva hoja, y ACOTA el resto de
 * bloques (texto, imágenes, tablas, etc.) para que quepan dentro de los
 * márgenes nuevos si la hoja anterior era más grande -- no los reposiciona
 * si ya encajan (misma posición relativa que tenía el usuario), pero ya no
 * puede quedar contenido fuera de la página o de los márgenes tras el
 * cambio.
 */
const applyPageSetup = (
  state: EditorState,
  patch: Partial<Pick<DocumentMeta, 'paperSize' | 'orientation'>>,
) => {
  const meta: DocumentMeta = {
    ...state.doc.meta,
    ...patch,
    version: state.doc.meta.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const layoutMode = meta.layoutMode === 'presentation' ? 'presentation' : 'document';
  const m = metricsFromMeta(meta);
  // Un cambio de Tamaño/Orientación a nivel DOCUMENTO (control del ribbon,
  // sin elegir página) es "todo el documento" — limpia cualquier
  // personalización por página para que todas vuelvan a heredar el valor
  // global, igual que Word al reaplicar la configuración de página entera.
  const pages = state.doc.pages.map((page) => {
    const clamped = page.elements.map((el) => {
      if (el.type === 'header') {
        return {
          ...el,
          x: m.CONTENT_LEFT,
          y: layoutMode === 'presentation' ? 8 : 10,
          width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
          height: layoutMode === 'presentation' ? 32 : 40,
        };
      }
      if (el.type === 'footer') {
        return {
          ...el,
          x: m.CONTENT_LEFT,
          y: m.PAGE_HEIGHT - m.FOOTER_HEIGHT + 6,
          width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
          height: 30,
        };
      }
      if (el.type === 'cover') {
        return { ...el, x: 0, y: 0, width: m.PAGE_WIDTH, height: m.PAGE_HEIGHT };
      }
      return clampContentElementToMetrics(el, m);
    });
    return {
      ...page,
      paperSize: undefined,
      orientation: undefined,
      elements: repackOverlappingElements(clamped, m),
    };
  });
  return { doc: { ...state.doc, pages, meta } };
};

/**
 * Igual que `applyPageSetup`, pero acotado a UNA página (y opcionalmente a
 * las siguientes) en vez de al documento entero — pedido explícito del
 * negocio: "en cada pagina de forma independiente debemos de poder
 * seleccionar solo esta pagina o la sección posterior a la pagina
 * incluyendo la pagina actual con un tamaño de hoja(A4, A3) ... horizontal
 * y vertical". Cada página afectada recalcula su propia geometría de
 * encabezado/pie/carátula con SUS métricas (no las del documento), para
 * que una página A3 horizontal dentro de un informe A4 vertical se vea
 * correcta.
 */
const applyPagePaperSetup = (
  state: EditorState,
  pageNumber: number,
  patch: Partial<Pick<ReportPage, 'paperSize' | 'orientation'>>,
  scope: 'only' | 'following',
) => {
  const layoutMode = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
  const pages = state.doc.pages.map((page) => {
    const affected = scope === 'only' ? page.page_number === pageNumber : page.page_number >= pageNumber;
    if (!affected) return page;
    const nextPage: ReportPage = { ...page, ...patch };
    const m = metricsForPage(nextPage, state.doc.meta);
    const clamped = nextPage.elements.map((el) => {
      if (el.type === 'header') {
        return {
          ...el,
          x: m.CONTENT_LEFT,
          y: layoutMode === 'presentation' ? 8 : 10,
          width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
          height: layoutMode === 'presentation' ? 32 : 40,
        };
      }
      if (el.type === 'footer') {
        return {
          ...el,
          x: m.CONTENT_LEFT,
          y: m.PAGE_HEIGHT - m.FOOTER_HEIGHT + 6,
          width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
          height: 30,
        };
      }
      if (el.type === 'cover') {
        return { ...el, x: 0, y: 0, width: m.PAGE_WIDTH, height: m.PAGE_HEIGHT };
      }
      return clampContentElementToMetrics(el, m);
    });
    return {
      ...nextPage,
      elements: repackOverlappingElements(clamped, m),
    };
  });
  return {
    doc: {
      ...state.doc,
      pages,
      meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
    },
  };
};

/** Bolsa de props específica del tipo de bloque (texto/kpi/tabla/…); intencionalmente abierta. */
export interface ElementProps {
  [key: string]: any;
}

/** Borde configurable del bloque (marco visible en el lienzo/export) —
 * independiente del resaltado de selección, que siempre se dibuja aparte. */
export interface ElementBorder {
  enabled: boolean;
  width: number;
  style: 'solid' | 'dashed' | 'dotted';
  color: string;
}

export interface ReportElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  locked: boolean;
  src?: string;
  objectFit?: string;
  /** Ajuste de texto alrededor de este objeto — réplica de las 7 opciones
   *  de "Opciones de diseño" de Word (ADR-049 revisado):
   *  'square'    — el texto fluye a ambos lados del rectángulo del objeto,
   *  'tight'     — igual que cuadrado pero con margen mínimo (más ceñido),
   *  'through'   — igual que ceñido; sin polígono de silueta no hay
   *                diferencia real con 'tight' para un rectángulo, pero se
   *                expone como opción independiente por fidelidad con Word,
   *  'topbottom' — el texto salta el tramo vertical completo del objeto,
   *  'behind'    — el objeto flota DETRÁS del texto (no le quita espacio,
   *                el texto se dibuja encima),
   *  'infront'   — el objeto flota DELANTE del texto (no le quita espacio,
   *                el objeto se dibuja encima) — default histórico/'none',
   *  'inline'    — el objeto se trata como parte del flujo normal (mismo
   *                comportamiento visual que 'infront' en este editor, ya
   *                que no hay un modelo de texto con objetos incrustados
   *                carácter-por-carácter; ver nota en PageCanvas.tsx).
   *  'none' (legado) se interpreta como 'infront' al leerse. */
  wrapMode?: 'inline' | 'square' | 'tight' | 'through' | 'topbottom' | 'behind' | 'infront' | 'none';
  props: ElementProps;
  border?: ElementBorder;
}

export interface ReportPage {
  page_number: number;
  elements: ReportElement[];
  /** Tamaño de hoja y orientación específicos de ESTA página — si no están
   * definidos, la página hereda el valor de `doc.meta` (comportamiento
   * histórico, documento entero con un solo tamaño). Permiten, por ejemplo,
   * una página de plano en A3 horizontal dentro de un informe A4 vertical,
   * igual que las "Secciones" de Word con salto de página + tamaño propio. */
  paperSize?: 'A4' | 'A3';
  orientation?: 'portrait' | 'landscape';
}

/** Resuelve el tamaño/orientación EFECTIVOS de una página: su propio valor
 * si lo tiene, si no el del documento. Único punto de esta lógica de
 * herencia para que layout/render/export siempre coincidan. */
export const resolvePagePaperSetup = (
  page: Pick<ReportPage, 'paperSize' | 'orientation'>,
  meta: Partial<DocumentMeta> | undefined,
): { paperSize: 'A4' | 'A3'; orientation: 'portrait' | 'landscape' } => ({
  paperSize: page.paperSize || meta?.paperSize || 'A4',
  orientation: page.orientation || meta?.orientation || 'portrait',
});

export interface DocumentMeta {
  author: string;
  version: number;
  updatedAt: string;
  layoutMode: 'document' | 'presentation';
  /** Tamaño de hoja (solo aplica con layoutMode 'document') — default 'A4'. */
  paperSize?: 'A4' | 'A3';
  /** Orientación de página (solo aplica con layoutMode 'document') — default 'portrait'. */
  orientation?: 'portrait' | 'landscape';
  [key: string]: any;
}

export interface ReportDocument {
  document_id: string;
  pages: ReportPage[];
  meta: DocumentMeta;
}

export interface DocumentReview {
  pages: number;
  textBlocks: number;
  issues: string[];
  optimizedCandidates: number;
  score: number;
  summary: string;
}

export interface OptimizationSuggestion {
  id: string;
  pageNumber: number;
  elementId: string;
  originalText: string;
  optimizedText: string;
  delta: number;
  severity: 'alta' | 'media' | 'leve';
}

interface AddElementPatch {
  src?: string;
  width?: number;
  height?: number;
  objectFit?: string;
  props?: Partial<ElementProps>;
  zIndex?: number;
  x?: number;
  y?: number;
}

const optimizeSyntaxOrder = (rawText: unknown): string => {
  const original = String(rawText ?? '');
  if (!original.trim()) {
    return original;
  }

  let text = original
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?![\s\n]|$)/g, '$1 ');

  const lines = text.split('\n');
  let orderedIndex = 1;
  const normalizedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return '';
    }

    if (/^[-*•]\s*/.test(trimmed)) {
      return `• ${trimmed.replace(/^[-*•]\s*/, '')}`;
    }

    if (/^\d+[.)]\s*/.test(trimmed)) {
      const withoutPrefix = trimmed.replace(/^\d+[.)]\s*/, '');
      const rebuilt = `${orderedIndex}. ${withoutPrefix}`;
      orderedIndex += 1;
      return rebuilt;
    }

    return trimmed;
  });

  text = normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  text = text.replace(/(^|[.!?]\s+|\n)([a-záéíóúñ])/g, (match, prefix, letter) => {
    return `${prefix}${letter.toUpperCase()}`;
  });

  if (text && !/[.!?]$/.test(text)) {
    text = `${text}.`;
  }

  return text;
};

const detectSuggestionSeverity = (
  originalText: unknown,
  optimizedText: unknown,
): OptimizationSuggestion['severity'] => {
  const original = String(originalText || '');
  const optimized = String(optimizedText || '');
  const absDelta = Math.abs(optimized.length - original.length);
  const hadFinalPunctuationIssue = /[^.!?\s]$/.test(original.trim());
  const hadDoubleSpaces = /\s{2,}/.test(original);
  const hadListFix = /^\s*\d+[.)]\s*/m.test(original) || /^\s*[-*]\s*/m.test(original);

  let score = 0;
  if (hadFinalPunctuationIssue) score += 1;
  if (hadDoubleSpaces) score += 1;
  if (hadListFix) score += 1;
  if (absDelta > 24) score += 1;
  if (original.length > 420) score += 1;

  if (score >= 4) return 'alta';
  if (score >= 2) return 'media';
  return 'leve';
};

const buildDocumentReview = (doc: ReportDocument): DocumentReview => {
  const issues: string[] = [];
  let textBlocks = 0;
  let optimizedCandidates = 0;

  doc.pages.forEach((page) => {
    page.elements.forEach((element) => {
      if (element.type !== 'text') {
        return;
      }

      textBlocks += 1;
      const text = String(element?.props?.text ?? '');
      const normalized = text.trim();

      if (!normalized) {
        issues.push(`Pagina ${page.page_number}: bloque de texto vacio.`);
        return;
      }

      if (/\s{2,}/.test(text)) {
        issues.push(`Pagina ${page.page_number}: hay espacios dobles en un bloque de texto.`);
      }

      if (!/[.!?]\s*$/.test(normalized)) {
        issues.push(`Pagina ${page.page_number}: un parrafo no cierra con puntuacion final.`);
      }

      const lines = normalized.split('\n').filter(Boolean);
      if (lines.some((line) => line.length > 140)) {
        issues.push(`Pagina ${page.page_number}: hay lineas muy largas (recomendado dividir).`);
      }

      const optimized = optimizeSyntaxOrder(text);
      if (optimized !== text) {
        optimizedCandidates += 1;
      }
    });
  });

  const pages = doc.pages.length;
  const score = Math.max(0, 100 - issues.length * 6);
  const summary = `Revision completada: ${pages} pagina(s), ${textBlocks} bloque(s) de texto, ${issues.length} observacion(es), ${optimizedCandidates} bloque(s) optimizable(s).`;

  return {
    pages,
    textBlocks,
    issues,
    optimizedCandidates,
    score,
    summary,
  };
};

const defaultPropsByType = (type: string): ElementProps => {
  if (type === 'text') {
    return {
      text: '',
      fontFamily: 'Arial',
      fontSize: 16,
      fontColor: '#0f172a',
      backgroundColor: '#ffffff',
      textAlign: 'left',
      lineHeight: 1.35,
      listType: 'none',
      bold: false,
      italic: false,
      underline: false,
      // Formato por selección (negrita/color/tamaño/fuente en una porción
      // del texto, no todo el bloque) — ver lib/textSpans.ts. Vacío =
      // comportamiento histórico (todo el bloque usa las props de arriba).
      spans: [],
    };
  }

  if (type === 'chart') {
    return {
      title: 'Dashboard dinámico',
      live: true,
      chartType: 'bar',
      theme: 'premium'
    };
  }

  if (type === 'table') {
    return {
      title: '',
      rows: [
        ['Cabecera 1', 'Cabecera 2', 'Cabecera 3'],
        ['Dato 1.1', 'Dato 1.2', 'Dato 1.3'],
        ['Dato 2.1', 'Dato 2.2', 'Dato 2.3']
      ],
      hasHeader: true,
      borderColor: '#e2e8f0',
      borderWidth: 1,
      borderStyle: 'solid',
      headerBg: '#f8fafc',
      headerTextColor: '#1e293b',
      headerBold: true,
      cellPadding: 10,
      fontSize: 14,
      cellAlign: 'left',
      // Filas alternadas ("banded rows", estilo Tabla de Word) — desactivado
      // por defecto para no romper el aspecto de tablas ya existentes.
      bandedRows: false,
      bandColor: '#f1f5f9',
    };
  }

  if (type === 'sensor') {
    return {
      title: 'Sensor tiempo real',
      sensorId: 1,
      sensorTypeId: null,
      sensorType: 'temperature',
      // Conectado por defecto: sondea la BD en vivo. El botón "Desconectar de
      // la base de datos" del inspector lo pone en false — el widget deja de
      // sondear y muestra el último valor congelado.
      connected: true,
    };
  }

  if (type === 'sensor_multi_chart') {
    return {
      title: 'Gráfico de sensores',
      // Paso 1 del wizard (gate obligatorio): sin sensorType, el resto del
      // panel queda deshabilitado — ver SensorMultiChartInspector.tsx.
      sensorType: null,
      // Cada entrada es un sensor+unidad concreto ya elegido en el árbol
      // zona→dispositivo→unidad: {sensorId, deviceKey, unit, zoneId}.
      selections: [],
      chartType: 'line',
      from: null,
      to: null,
    };
  }

  if (type === 'image') {
    return {
      alt: 'Figura o fotografía técnica',
    };
  }

  if (type === 'video') {
    return {
      // 'webcam' | 'screen' -- de dónde se grabó (informativo, no cambia el
      // render: ambos son <video> con controles nativos del navegador).
      source: 'webcam',
      mimeType: 'video/webm',
      durationSeconds: 0,
    };
  }

  if (type === 'cover') {
    // Empresa, unidad minera y autor NUNCA se guardan en props — se calculan
    // en vivo desde la sesión activa en cada render (ver PageCanvas.tsx),
    // igual que el encabezado/pie (ADR-046), para que no puedan quedar
    // desactualizados ni ser editados/borrados a mano.
    return {
      // Vacíos a propósito (no 'Informe Técnico'/'CONFIDENCIAL' fijos): así
      // el render (PageCanvas.tsx) cae al fallback de la plantilla elegida
      // (lib/coverTemplates.ts) cuando el usuario no escribió nada propio.
      // 'corporate' (default si no se especifica) tiene los mismos valores
      // que antes tenía este objeto, así que informes ya guardados sin
      // `coverTemplate` siguen viéndose idénticos.
      title: '',
      date: new Date().toISOString().slice(0, 10),
      classification: '',
      docCode: '',
      bgColor: '',
      textColor: '',
      coverTemplate: 'corporate',
    };
  }

  if (type === 'toc') {
    return {
      title: 'Tabla de Contenidos',
      autoGenerate: true,
    };
  }

  if (type === 'header') {
    return {
      // ADR-046 (revisado): empresa + unidad + usuario conectado ya NO se
      // guardan como texto editable en props — se calculan SIEMPRE en vivo
      // desde la sesión activa en el momento de renderizar (PageCanvas.tsx
      // lee getSession() directamente), para que el bloque nunca pueda
      // quedar desactualizado ni sea editable a mano. `tenantId` se
      // conserva solo como referencia del logo insertado (fallback si algún
      // día se necesita, pero PageCanvas también recalcula desde la sesión).
      showLogo: true,
      tenantId: '',
    };
  }

  if (type === 'footer') {
    return {
      // ADR-046 (revisado): "BEEMETRY" (izquierda) y "Página X / Total"
      // (derecha) son literales fijos renderizados en PageCanvas.tsx, no
      // texto editable — el pie de página es de solo lectura, igual que el
      // encabezado.
      showPageNumber: true,
    };
  }

  if (type === 'seismic-report') {
    // Últimos 30 días por defecto, igual que el panel del dashboard
    // principal (MiningDashboard.tsx) del que proviene este bloque.
    const today = new Date();
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 29);
    return {
      title: 'Reporte Sismográfico',
      // 'igp' | 'company' | 'both' -- controla 1 o 2 columnas en el render.
      source: 'both',
      startDate: start.toISOString().slice(0, 10),
      endDate: today.toISOString().slice(0, 10),
      connected: true,
    };
  }

  return {
    title: type === 'kpi' ? 'Tonelaje movido' : `${type.toUpperCase()} BLOCK`,
    value: '—',
    kpiCode: type === 'kpi' ? 'tonelaje_movido' : undefined,
    source: type === 'kpi' ? 'runtime_db' : undefined,
    /** spark_bars | line | donut | none — informe compacto; donut requiere meta en BD */
    trendViz: type === 'kpi' ? 'spark_bars' : undefined,
    // Ver nota equivalente en 'sensor' arriba.
    connected: type === 'kpi' ? true : undefined,
  };
};

/** Borde por defecto al INSERTAR un bloque nuevo — preserva la apariencia
 * histórica del lienzo (marco gris sutil visible en todo tipo salvo texto,
 * que se mantiene sin marco propio; su guía punteada de edición es aparte,
 * ver PageCanvas.tsx). También usado como fallback para bloques ya
 * existentes en documentos guardados ANTES de que este campo existiera. */
export const defaultBorderByType = (type: string): ElementBorder =>
  type === 'text' || type === 'header' || type === 'footer' || type === 'cover'
    ? { enabled: false, width: 1, style: 'solid', color: '#a9b8d3' }
    : { enabled: true, width: 1, style: 'solid', color: '#a9b8d3' };

// ── Bloques Técnicos (presentación avanzada) ───────────────────────────────
// Paleta y textos tomados EXACTAMENTE del modelo corporativo minero
// (docs/Modelo_Informe_Tecnico_Monitoreo_Sensores_Mineros_LATAM.docx):
// cajas de resaltado semánticas con los mismos tintes de celda del documento
// (#EEF3F7 nota, #E2F0D9 conforme, #FFF2CC observación, #F4CCCC no conforme,
// #17365D dictamen ejecutivo en navy con texto claro). Cada variante define
// el fondo de la caja, el color del borde/acento y el color del título.
export interface TechCalloutVariant {
  bg: string;
  border: string;
  /** Color del título (primera línea, en negrita). */
  titleColor: string;
  /** Color del cuerpo (resto del texto). */
  bodyColor: string;
  title: string;
  body: string;
}

export const TECH_CALLOUT_VARIANTS: Record<string, TechCalloutVariant> = {
  info: {
    bg: '#EEF3F7', border: '#4F81BD', titleColor: '#17365D', bodyColor: '#1F3350',
    title: 'NOTA',
    body: 'Texto informativo de la nota. Reemplace con el contenido correspondiente.',
  },
  success: {
    bg: '#E2F0D9', border: '#70AD47', titleColor: '#375623', bodyColor: '#2E4318',
    title: 'CONFORME',
    body: 'Criterio cumplido o resultado conforme. Describa la evidencia que lo sustenta.',
  },
  warning: {
    bg: '#FFF2CC', border: '#C69214', titleColor: '#7F6000', bodyColor: '#5C4A00',
    title: 'OBSERVACIÓN',
    body: 'Condición que requiere atención o seguimiento. Detalle la acción recomendada.',
  },
  danger: {
    bg: '#F4CCCC', border: '#C0504D', titleColor: '#843C0C', bodyColor: '#6B2B2B',
    title: 'CRÍTICO / NO CONFORME',
    body: 'No conformidad o riesgo crítico. Especifique la acción inmediata y el responsable.',
  },
  dictamen: {
    bg: '#17365D', border: '#0F2742', titleColor: '#FFFFFF', bodyColor: '#DCE6F1',
    title: 'DICTAMEN EJECUTIVO',
    body: 'Conclusión ejecutiva del informe. Resuma el estado del sistema y la decisión requerida.',
  },
};

// ── Plantillas de sección (tablas especializadas del modelo minero) ─────────
// Cada plantilla = un encabezado H2 + una tabla pre-llenada con datos
// demostrativos tomados del documento. `hasHeader:false` para las que son
// fichas tipo formulario (columna-etiqueta) en vez de tabla de datos.
export interface SectionTemplateDef {
  label: string;
  heading: string;
  rows: string[][];
  hasHeader?: boolean; // default true
}

export const SECTION_TEMPLATES: Record<string, SectionTemplateDef> = {
  'estado-sistema': {
    label: 'Estado por sistema',
    heading: 'Estado consolidado por sistema',
    rows: [
      ['Sistema', 'Instalados', 'Operativos', 'Degradados', 'Inoperativos', 'Disponibilidad', 'Condición'],
      ['Radar de taludes', '2', '2', '0', '0', '99.1 %', 'VERDE'],
      ['Prismas/RTS', '120', '115', '3', '2', '96.3 %', 'VERDE'],
      ['Inclinómetros', '14', '11', '2', '1', '88.4 %', 'AMARILLO'],
      ['Piezómetros', '26', '23', '2', '1', '91.0 %', 'AMARILLO'],
    ],
  },
  'matriz-riesgo': {
    label: 'Matriz peligro–mecanismo–sensor',
    heading: 'Matriz peligro–mecanismo–sensor',
    rows: [
      ['Sector', 'Peligro', 'Mecanismo', 'Sensor primario', 'Sensor de respaldo', 'Acción asociada'],
      ['Talud Oeste', 'Falla profunda', 'Deslizamiento compuesto', 'Radar', 'Inclinómetro + prismas', 'TARP geotécnico'],
      ['Botadero', 'Deformación basal', 'Corte profundo', 'ShapeArray', 'GNSS + piezómetros', 'Control de descarga'],
      ['Relaves', 'Presión de poros', 'Inestabilidad hidráulica', 'Piezómetros', 'Inclinómetros', 'Plan de contingencia'],
    ],
  },
  'inventario': {
    label: 'Inventario maestro de sensores',
    heading: 'Inventario maestro de sensores',
    rows: [
      ['Código', 'Tecnología', 'Sector', 'Variable', 'Frecuencia', 'Comunicación', 'Últ. calib.', 'Estado', 'Criticidad', 'Observación'],
      ['RAD-01', 'Radar', 'Tajo Oeste', 'mm / velocidad', '2 min', 'Radio 5 GHz', 'N/A', 'Operativo', 'A', 'Cobertura 98 %'],
      ['INC-07', 'Inclinómetro', 'Oeste', 'Despl. profundidad', 'Semanal', 'Manual', '10/01/26', 'Inoperativo', 'A', 'Obstrucción 42.5 m'],
      ['PZ-14', 'Piezómetro', 'Oeste', 'Presión de poros', '10 min', 'Radio 900 MHz', 'Vencida', 'Degradado', 'A', 'Intermitencia'],
    ],
  },
  'kpi-dict': {
    label: 'Diccionario de KPI',
    heading: 'Diccionario de KPI',
    rows: [
      ['KPI', 'Definición / fórmula', 'Meta', 'Frecuencia', 'Propietario'],
      ['Disponibilidad', 'Horas disponibles / horas del periodo', '≥ 95 %', 'Mensual', 'Instrumentación'],
      ['Completitud', 'Registros válidos / registros esperados', '≥ 96 %', 'Diaria', 'TI/OT'],
      ['MTTR', 'Horas de reparación / fallas', '≤ 4 h críticos', 'Mensual', 'Mantenimiento'],
    ],
  },
  'tarp': {
    label: 'Matriz de alarmas / TARP',
    heading: 'Alarmas, TARP y respuesta operacional',
    rows: [
      ['Nivel', 'Criterio general', 'Validación', 'Respuesta', 'Responsable', 'Tiempo máx.'],
      ['VERDE', 'Comportamiento dentro de línea base', 'Automática + revisión rutinaria', 'Operación normal', 'Control geotécnico', 'Turno'],
      ['AMARILLO', 'Cambio significativo o pérdida parcial', 'Segundo sensor + inspección', 'Aumentar frecuencia y vigilar', 'Geotecnia de turno', '30 min'],
      ['NARANJA', 'Aceleración o coincidencia multisensor', 'Confirmación inmediata', 'Restringir área y activar comando', 'Jefe Geotecnia / Mina', '10 min'],
      ['ROJO', 'Falla inminente o pérdida crítica de control', 'No demorar evacuación', 'Evacuar, aislar y activar emergencia', 'Gerencia / Emergencias', 'Inmediato'],
    ],
  },
  'hallazgos': {
    label: 'Registro de hallazgos',
    heading: 'Hallazgos y no conformidades',
    rows: [
      ['ID', 'Hallazgo', 'Criterio', 'Riesgo', 'Clasif.', 'Acción requerida', 'Responsable', 'Plazo'],
      ['H-01', 'INC-07 obstruido antes de la profundidad crítica', 'Procedimiento GEO-PRO-004', 'Pérdida de detección profunda', 'Crítica', 'Instalar reemplazo y control temporal', 'Geotecnia', '7 días'],
      ['H-02', 'PZ-14 con calibración vencida e intermitencia', 'Plan metrológico', 'Interpretación hidrogeológica incierta', 'Alta', 'Calibrar/reemplazar cable y validar', 'Instrumentación', '48 h'],
    ],
  },
  'plan-accion': {
    label: 'Plan de acción y seguimiento',
    heading: 'Plan de acción y seguimiento',
    rows: [
      ['N°', 'Acción', 'Prioridad', 'Responsable', 'Inicio', 'Vencimiento', 'Avance', 'Evidencia', 'Estado'],
      ['1', 'Reemplazar INC-07', 'Crítica', 'Geotecnia', '[ ]', '[ ]', '0 %', 'Lectura cero + acta', 'Abierta'],
      ['2', 'Rehabilitar PZ-14', 'Alta', 'Instrumentación', '[ ]', '[ ]', '25 %', 'Serie validada 72 h', 'En curso'],
    ],
  },
  'ficha-sensor': {
    label: 'Ficha individual de sensor',
    heading: 'Ficha individual de sensor',
    hasHeader: false,
    rows: [
      ['Código', '[ ]', 'Tecnología', '[ ]'],
      ['Marca / modelo', '[ ]', 'N.° de serie', '[ ]'],
      ['Ubicación', '[ ]', 'Coordenadas / cota', '[ ]'],
      ['Variable medida', '[ ]', 'Rango / precisión', '[ ]'],
      ['Última calibración', '[ ]', 'Próxima calibración', '[ ]'],
      ['Criticidad', 'A / B / C', 'Redundancia', '[ ]'],
    ],
  },
  'checklist': {
    label: 'Lista de verificación en campo',
    heading: 'Lista de verificación en campo',
    rows: [
      ['N°', 'Verificación', 'Resultado', 'Observación'],
      ['1', 'Identificación y código legibles.', '☐ C   ☐ NC   ☐ N/A', ''],
      ['2', 'Ubicación coincide con plano y coordenadas.', '☐ C   ☐ NC   ☐ N/A', ''],
      ['3', 'Protección física y gabinete en buen estado.', '☐ C   ☐ NC   ☐ N/A', ''],
      ['4', 'Batería, panel solar o UPS verificados.', '☐ C   ☐ NC   ☐ N/A', ''],
    ],
  },
  'firmas': {
    label: 'Registro de firmas',
    heading: 'Registro de firmas',
    rows: [
      ['Función', 'Nombre', 'CIP / Registro', 'Firma', 'Fecha'],
      ['Elaborado por', '', '', '', ''],
      ['Revisado por', '', '', '', ''],
      ['Validado por', '', '', '', ''],
      ['Aprobado por', '', '', '', ''],
    ],
  },
};

const createElement = (
  type: string,
  pageNumber: number,
  nextIndex: number,
  m: ReturnType<typeof getReportLayoutMetrics>,
): ReportElement => {
  const contentW = Math.max(80, m.CONTENT_RIGHT - m.CONTENT_LEFT);

  if (type === 'image') {
    return {
      id: `image-${pageNumber}-${Date.now()}-${nextIndex}`,
      type: 'image',
      x: m.CONTENT_LEFT,
      y: m.CONTENT_TOP,
      width: Math.min(360, contentW),
      height: 220,
      zIndex: nextIndex,
      locked: false,
      src: REPORT_IMAGE_PLACEHOLDER_SVG,
      objectFit: 'cover',
      // Estilo Word: una imagen recién insertada ajusta el texto a su
      // alrededor por defecto (ADR-049). Los documentos guardados antes de
      // este campo quedan en 'none' (comportamiento histórico) al leerse.
      wrapMode: 'square',
      props: defaultPropsByType('image'),
      border: defaultBorderByType('image'),
    };
  }

  if (type === 'video') {
    return {
      id: `video-${pageNumber}-${Date.now()}-${nextIndex}`,
      type: 'video',
      x: m.CONTENT_LEFT,
      y: m.CONTENT_TOP,
      width: Math.min(360, contentW),
      height: Math.round(Math.min(360, contentW) * 9 / 16),
      zIndex: nextIndex,
      locked: false,
      src: '',
      wrapMode: 'square',
      props: defaultPropsByType('video'),
      border: defaultBorderByType('video'),
    };
  }

  if (type === 'cover') {
    // La carátula ocupa TODA la hoja, borde a borde (no solo el área de
    // contenido entre márgenes) — pedido explícito del negocio tras ver que
    // antes quedaba como un recuadro pequeño centrado. Al ocupar toda la
    // página, la página de carátula NO lleva el encabezado/pie de página
    // automático (ver addElement más abajo, que los retira de esa página) —
    // mismo criterio que Word con "primera página diferente".
    return {
      id: `cover-${pageNumber}-${Date.now()}-${nextIndex}`,
      type: 'cover',
      x: 0,
      y: 0,
      width: m.PAGE_WIDTH,
      height: m.PAGE_HEIGHT,
      zIndex: nextIndex,
      // Bloqueada en tamaño/posición — igual que header/footer, para que no
      // se pueda arrastrar/redimensionar de vuelta a un recuadro pequeño
      // (el geometry panel también queda oculto para este tipo, ver
      // RightInspector.tsx).
      locked: true,
      props: defaultPropsByType('cover'),
      border: defaultBorderByType('cover'),
    };
  }

  return {
    id: `${type}-${pageNumber}-${Date.now()}-${nextIndex}`,
    type,
    x: m.CONTENT_LEFT,
    y: m.CONTENT_TOP,
    width:
      type === 'kpi'
        ? Math.min(180, contentW)
        : type === 'table'
          ? Math.min(420, contentW)
          : type === 'sensor'
            ? Math.min(240, contentW)
            : type === 'sensor_multi_chart'
              ? Math.min(480, contentW)
              : type === 'toc' || type === 'text' || type === 'seismic-report'
              // Un bloque de texto nuevo ocupa todo el ancho de la columna de
              // contenido (como un párrafo de Word) — antes quedaba fijo en
              // 320px, un recuadro angosto sin relación con el ancho real de
              // la hoja seleccionada (A4/A3, vertical/horizontal). El reporte
              // sísmico necesita ancho completo para mostrar 2 columnas
              // (oficial IGP + sensores propios) lado a lado sin apretarse.
              ? contentW
              : Math.min(320, contentW),
    height:
      type === 'kpi' ? 110
      : type === 'table' ? 200
      : type === 'sensor' ? 140
      : type === 'sensor_multi_chart' ? 260
      : type === 'toc' ? 340
      : type === 'seismic-report' ? 320
      : 180,
    zIndex: nextIndex,
    locked: false,
    // Objetos gráficos (tabla, gráfico, KPI, sensor, mapa) ajustan el texto
    // alrededor por defecto, como en Word (ADR-049); texto/toc no aplican.
    ...(type === 'table' || type === 'chart' || type === 'kpi' || type === 'sensor' || type === 'map' || type === 'sensor_multi_chart'
      ? { wrapMode: 'square' as const }
      : {}),
    props: defaultPropsByType(type),
    border: defaultBorderByType(type),
  };
};

const createTextTemplateElement = (
  pageNumber: number,
  nextIndex: number,
  template: string,
  m: ReturnType<typeof getReportLayoutMetrics>,
): ReportElement => ({
  id: `text-template-${template}-${pageNumber}-${Date.now()}-${nextIndex}`,
  type: 'text',
  x: m.CONTENT_LEFT,
  y: m.CONTENT_TOP,
  width: m.CONTENT_RIGHT - m.CONTENT_LEFT,
  height: 72,
  zIndex: nextIndex,
  locked: false,
  props: {
    ...defaultPropsByType('text'),
    text: '',
    fontSize: 14,
    lineHeight: 1.25,
  },
});

/**
 * ADR-046 (revisado de nuevo): encabezado y pie de página dejaron de ser
 * "insertables" por el usuario — se agregan automáticamente a TODA página
 * (nueva o cargada desde un informe guardado antes de que este bloque
 * existiera) sin que nadie tenga que presionar un botón. Por eso ya no hay
 * botón "Insertar encabezado/pie de página" en la UI: ver `addPage`,
 * `loadDocument` y el doc inicial más abajo, todos llaman a esta función.
 */
const createHeaderFooterPair = (
  pageNumber: number,
  m: ReturnType<typeof getReportLayoutMetrics>,
  layoutMode: string,
): ReportElement[] => [
  {
    id: `header-${pageNumber}`,
    type: 'header',
    x: m.CONTENT_LEFT,
    y: layoutMode === 'presentation' ? 8 : 10,
    width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
    height: layoutMode === 'presentation' ? 32 : 40,
    zIndex: 0,
    locked: true,
    props: defaultPropsByType('header'),
    border: defaultBorderByType('header'),
  },
  {
    id: `footer-${pageNumber}`,
    type: 'footer',
    x: m.CONTENT_LEFT,
    y: m.PAGE_HEIGHT - m.FOOTER_HEIGHT + 6,
    width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
    height: 30,
    zIndex: 1,
    locked: true,
    props: defaultPropsByType('footer'),
    border: defaultBorderByType('footer'),
  },
];

// ── Paginación automática de la Tabla de Contenidos ─────────────────────────
// Pedido explícito del negocio: el TOC solo se puede insertar en la página 2
// (nunca la 1, reservada a carátula) y, si la lista de encabezados crece más
// de lo que entra en una página, debe "derramarse" solo a páginas
// siguientes en vez de recortarse o quedar con scroll interno.
//
// El bloque original (props.tocContinuationIndex === undefined, o 0) vive en
// la página 2. Cada bloque de continuación (tocContinuationIndex === 1, 2…)
// vive en una página propia, insertada/retirada automáticamente por
// `syncTocPages()` según cuántas entradas hay realmente — nunca se
// almacenan las entradas en sí en props (se recalculan siempre desde los
// encabezados reales vía generateTocData, ver TableOfContents.tsx), así que
// esto se autorepara solo aunque el usuario edite/borre encabezados después.

// Estimación en px de alto por fila de índice + cabecera del bloque — debe
// coincidir con el render real (PageCanvas.tsx / ReadOnlyViewer.tsx, bloque
// 'toc'): título "Tabla de Contenidos" (~48px) + ~26px por fila.
const TOC_ROW_HEIGHT_PX = 26;
const TOC_HEADER_HEIGHT_PX = 48;
const TOC_PADDING_PX = 44; // padding interno del shield (18px arriba/abajo aprox + borde)

export function tocCapacityForBoxHeight(boxHeight: number): number {
  const usable = boxHeight - TOC_HEADER_HEIGHT_PX - TOC_PADDING_PX;
  return Math.max(1, Math.floor(usable / TOC_ROW_HEIGHT_PX));
}

/** Alto de un bloque TOC de continuación: toda el área de contenido de una
 * página propia (mismo criterio que un bloque de texto que ocupa toda la
 * columna, ver createElement 'toc'/'text'). */
function tocContinuationHeight(m: ReturnType<typeof getReportLayoutMetrics>): number {
  return Math.max(200, m.CONTENT_BOTTOM - m.CONTENT_TOP);
}

function createTocContinuationElement(
  pageNumber: number,
  continuationIndex: number,
  m: ReturnType<typeof getReportLayoutMetrics>,
): ReportElement {
  return {
    id: `toc-continuation-${continuationIndex}-${pageNumber}-${Date.now()}`,
    type: 'toc',
    x: m.CONTENT_LEFT,
    y: m.CONTENT_TOP,
    width: m.CONTENT_RIGHT - m.CONTENT_LEFT,
    height: tocContinuationHeight(m),
    zIndex: 0,
    locked: false,
    props: { ...defaultPropsByType('toc'), tocContinuationIndex: continuationIndex },
    border: defaultBorderByType('toc'),
  };
}

/**
 * Slice de entradas del índice que le corresponde mostrar a UN bloque `toc`
 * concreto (original o de continuación) — fuente única para PageCanvas.tsx
 * (edición) y ReadOnlyViewer.tsx (lectura), así ambos quedan siempre
 * consistentes con lo que `syncTocPages()` decidió. El offset de cada
 * bloque se recalcula recorriendo TODOS los bloques toc del documento en
 * orden (original primero, luego continuaciones por índice) usando el alto
 * REAL de cada uno — si el usuario redimensiona el bloque original a mano,
 * el resto se re-acomoda solo en el siguiente render, sin esperar a
 * `syncTocPages()`.
 */
export function tocSliceForElementId(doc: ReportDocument, elementId: string): ReturnType<typeof generateTocData> {
  const entries = generateTocData(doc);
  const allTocEls: { id: string; height: number; continuationIndex: number }[] = [];
  doc.pages.forEach((page) => {
    page.elements.forEach((el) => {
      if (el.type !== 'toc') return;
      const ci = typeof el.props?.tocContinuationIndex === 'number' ? el.props.tocContinuationIndex : 0;
      allTocEls.push({ id: el.id, height: el.height, continuationIndex: ci });
    });
  });
  allTocEls.sort((a, b) => a.continuationIndex - b.continuationIndex);

  let offset = 0;
  for (const item of allTocEls) {
    const capacity = tocCapacityForBoxHeight(item.height);
    const slice = entries.slice(offset, offset + capacity);
    if (item.id === elementId) return slice;
    offset += capacity;
  }
  return [];
}

const createInitialPage = (): ReportPage => {
  const m = getReportLayoutMetrics('document');
  return { page_number: 1, elements: createHeaderFooterPair(1, m, 'document') };
};

const initialPage: ReportPage = createInitialPage();

export interface EditorState {
  doc: ReportDocument;
  selectedPage: number;
  selectedElementId: string | undefined;
  gridEnabled: boolean;
  snapEnabled: boolean;
  currentReportId: string | null;
  currentReportTitle: string;
  /**
   * ADR-021 (revisado): número de versión server-autoritativo (ADR-015),
   * distinto de `doc.meta.version` — ese es un contador local que se
   * incrementa en CADA acción de edición (útil como señal de "hay cambios
   * sin guardar"), no la versión real confirmada por el servidor. Este
   * campo se hidrata desde la respuesta del backend en cada load/save, y es
   * lo que debe mostrarse como "Versión: vN" en la UI.
   */
  currentReportVersionNumber: number | null;
  setCurrentReportId: (id: string | null) => void;
  setCurrentReportTitle: (title: string) => void;
  setCurrentReportVersionNumber: (version: number | null) => void;
  /** Carga un doc JSON externo en el editor (desde "Abrir para editar") */
  loadDocument: (contentJson: string | Partial<ReportDocument>, reportId?: string | null, reportTitle?: string) => void;
  setLayoutMode: (layoutMode: string) => void;
  setPaperSize: (paperSize: 'A4' | 'A3') => void;
  setOrientation: (orientation: 'portrait' | 'landscape') => void;
  /** Cambia tamaño/orientación de una página concreta — 'only' afecta solo
   * esa página, 'following' esa página y todas las posteriores. */
  setPagePaperSetup: (
    pageNumber: number,
    patch: Partial<Pick<ReportPage, 'paperSize' | 'orientation'>>,
    scope: 'only' | 'following',
  ) => void;
  addPage: () => void;
  duplicatePage: (pageNumber: number) => void;
  reorderPages: (from: number, to: number) => void;
  selectPage: (pageNumber: number) => void;
  addElement: (type: string, patch?: AddElementPatch) => void;
  /** Inserta la Tabla de Contenidos SIEMPRE en la página 2 (nunca la 1,
   * carátula) — crea la página 2 si aún no existe. Si ya hay un TOC en el
   * documento, no duplica: solo selecciona el existente. */
  addTocElement: () => void;
  /** Reconcilia cuántas páginas de CONTINUACIÓN del TOC existen contra
   * cuántas hacen falta según el número real de encabezados — inserta o
   * retira páginas de continuación (nunca la página 2, la del bloque
   * original). No-op si no hay ningún TOC en el documento. Debe llamarse
   * cada vez que el doc cambia (ver App.tsx). */
  syncTocPages: () => void;
  /** Inserta una imagen libre (movible/redimensionable) centrada en la
   * página dada — usado por "Insertar Imagen Empresa" (ADR-048 revisado):
   * a diferencia de `addElement('image', ...)`, NO participa del flujo
   * automático de contenido (que siempre la reposicionaría al tope del
   * área de contenido); se centra en la hoja completa, apropiado para la
   * página de carátula. */
  addCenteredImage: (pageNumber: number, src: string) => void;
  addTextTemplate: (template: string) => void;
  /** Bloques de presentación avanzada (Sección "Bloques Técnicos" del ribbon
   * de reportabilidad) tomados del modelo corporativo minero: cajas de
   * resaltado semánticas (`callout-info|success|warning|danger|dictamen`),
   * pie de figura (`caption`) y tira de tarjetas KPI (`kpi-strip`). Todos se
   * construyen SOBRE el bloque `text` existente (fondo + borde + spans), sin
   * un tipo de elemento nuevo, para reutilizar el render, la edición, el
   * export y el visor de solo lectura ya probados. Ver TECH_BLOCK_VARIANTS. */
  addTechnicalBlock: (kind: string) => void;
  /** Plantillas de sección completas del modelo minero: inserta un
   * encabezado (H2) + una tabla especializada pre-llenada (matriz
   * peligro-mecanismo-sensor, inventario, diccionario KPI, TARP, hallazgos,
   * plan de acción, ficha de sensor, checklist de campo, registro de firmas,
   * estado por sistema). Ver SECTION_TEMPLATES. Reutiliza los elementos
   * `text` y `table` existentes. */
  addSectionTemplate: (kind: string) => void;
  /** Gráficos estáticos con datos ingresados (no el dashboard en vivo):
   * `chart-line` (línea con meta), `chart-hbar` (barras horizontales con
   * etiquetas), `chart-combo` (línea + barras, doble eje) — las 3 figuras
   * del modelo. Guarda los datos en props del elemento `chart`. */
  addStaticChart: (kind: string) => void;
  /** Plantillas de DOCUMENTO completo (pedido explícito 2026-07-30, distinto
   * de addTextTemplate/addSectionTemplate que insertan un bloque en la
   * página actual): reemplaza TODO el documento por una estructura
   * multi-página ya redactada (carátula + índice + contenido), personalizada
   * con la sesión activa (empresa/unidad minera/usuario). Ver
   * lib/documentTemplates.ts. Reutiliza `loadDocument` para no duplicar el
   * backfill de encabezado/pie por página. */
  applyDocumentTemplate: (templateId: string, answers?: Record<string, string>) => void;
  selectElement: (id: string | undefined) => void;
  updateElement: (pageNumber: number, elementId: string, patch: Partial<ReportElement>) => void;
  removeElement: (pageNumber: number, elementId: string) => void;
  /** Portapapeles interno (copiar/pegar de objetos del lienzo) — snapshot
   * del elemento copiado, independiente del portapapeles del SO. */
  clipboardElement: ReportElement | null;
  /** Copia el elemento indicado al portapapeles interno. */
  copyElement: (pageNumber: number, elementId: string) => void;
  /** Pega el elemento del portapapeles en la página dada (clon con nuevo id
   * y ligero desplazamiento para que no tape al original), y lo selecciona.
   * Devuelve el id del nuevo elemento, o null si no hay nada que pegar. */
  pasteElement: (pageNumber: number) => string | null;
  reviewDocumentQuality: () => DocumentReview;
  getOptimizationSuggestions: () => OptimizationSuggestion[];
  applyOptimizationSuggestion: (args: { pageNumber: number; elementId: string; optimizedText: string }) => void;
  applyOptimizationBatch: (suggestions: OptimizationSuggestion[]) => { applied: number };
  optimizeDocumentWithAI: () => { optimizedBlocks: number; totalTextBlocks: number };
  setSnapEnabled: (enabled: boolean) => void;
  setGridEnabled: (enabled: boolean) => void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  doc: {
    document_id: 'rep_2026_01',
    pages: [initialPage],
    meta: {
      author: 'AGM Solutions',
      version: 1,
      updatedAt: new Date().toISOString(),
      layoutMode: 'document',
    },
  },
  selectedPage: 1,
  selectedElementId: undefined,
  gridEnabled: true,
  snapEnabled: true,
  // Identificadores del informe actualmente cargado en el editor
  currentReportId: null,
  currentReportTitle: 'Informe sin título',
  currentReportVersionNumber: null,
  setCurrentReportId: (id) => set({ currentReportId: id }),
  setCurrentReportTitle: (title) => set({ currentReportTitle: title }),
  setCurrentReportVersionNumber: (version) => set({ currentReportVersionNumber: version }),
  loadDocument: (contentJson, reportId, reportTitle) => {
    try {
      const parsed: any = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
      const layoutMode =
        parsed?.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const m = metricsFromMeta(parsed?.meta);
      // Retrocompatibilidad: informes guardados ANTES de que encabezado/pie
      // de página fueran automáticos no tienen esos bloques — se agregan al
      // cargar, para que "no dependa de que el usuario presione un botón"
      // también aplique a informes viejos, no solo a páginas nuevas.
      const pagesWithChrome = (parsed?.pages || []).map((page: ReportPage) => {
        const elementsWithNaturalSensorHeight = page.elements.map((el) => {
          if (el.type !== 'sensor_multi_chart') return el;
          const minHeight = sensorDashboardMinHeight(el.props || {}, Number(el.width) || 0);
          return Number(el.height) >= minHeight ? el : { ...el, height: minHeight };
        });
        const normalizedPage = { ...page, elements: elementsWithNaturalSensorHeight };
        // Una página de carátula a toda hoja no lleva encabezado/pie (ver
        // addElement('cover') más abajo) — no hay que backfillearlos aquí.
        const hasCover = elementsWithNaturalSensorHeight.some((el) => el.type === 'cover');
        if (hasCover) return normalizedPage;
        const hasHeader = elementsWithNaturalSensorHeight.some((el) => el.type === 'header');
        const hasFooter = elementsWithNaturalSensorHeight.some((el) => el.type === 'footer');
        if (hasHeader && hasFooter) return normalizedPage;
        const [header, footer] = createHeaderFooterPair(page.page_number, m, layoutMode);
        const missing = [...(hasHeader ? [] : [header]), ...(hasFooter ? [] : [footer])];
        return { ...normalizedPage, elements: [...missing, ...elementsWithNaturalSensorHeight] };
      });
      set({
        doc: {
          ...parsed,
          pages: pagesWithChrome,
          meta: { ...(parsed.meta || {}), layoutMode },
        },
        selectedPage: 1,
        selectedElementId: undefined,
        currentReportId: reportId || null,
        currentReportTitle: reportTitle || 'Informe sin título',
        // El caller (App.tsx) hidrata el valor real justo después con la
        // respuesta del backend; null mientras tanto evita mostrar la
        // versión del informe anterior sobre el recién cargado.
        currentReportVersionNumber: null,
      });
    } catch {
      log.error('useEditorStore.loadDocument: JSON inválido');
    }
  },
  applyDocumentTemplate: (templateId, answers) => {
    const built = buildDocumentTemplate(templateId, answers);
    if (!built) {
      log.error(`useEditorStore.applyDocumentTemplate: plantilla desconocida "${templateId}"`);
      return;
    }
    const state = get();
    state.loadDocument(built, state.currentReportId, state.currentReportTitle || 'Informe sin título');
  },
  setLayoutMode: (layoutMode) =>
    set((state) => ({
      doc: {
        ...state.doc,
        meta: {
          ...state.doc.meta,
          layoutMode: layoutMode === 'presentation' ? 'presentation' : 'document',
          version: state.doc.meta.version + 1,
          updatedAt: new Date().toISOString(),
        },
      },
    })),
  setPaperSize: (paperSize) => set((state) => applyPageSetup(state, { paperSize })),
  setOrientation: (orientation) => set((state) => applyPageSetup(state, { orientation })),
  setPagePaperSetup: (pageNumber, patch, scope) =>
    set((state) => applyPagePaperSetup(state, pageNumber, patch, scope)),
  addPage: () =>
    set((state) => {
      const nextPage = state.doc.pages.length + 1;
      const layoutMode = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const m = metricsFromMeta(state.doc.meta);
      return {
        doc: {
          ...state.doc,
          pages: [...state.doc.pages, { page_number: nextPage, elements: createHeaderFooterPair(nextPage, m, layoutMode) }],
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: nextPage,
      };
    }),
  duplicatePage: (pageNumber) =>
    set((state) => {
      const page = state.doc.pages.find((p) => p.page_number === pageNumber);
      if (!page) {
        return state;
      }

      const m = metricsForPage(page, state.doc.meta);
      const copy: ReportPage = {
        page_number: state.doc.pages.length + 1,
        paperSize: page.paperSize,
        orientation: page.orientation,
        elements: page.elements.map((element, index) => ({
          ...element,
          id: `${element.id}-copy-${Date.now()}-${index}`,
          x: Math.min(element.x + 20, m.PAGE_WIDTH - element.width - 10),
          y: Math.min(element.y + 20, m.PAGE_HEIGHT - element.height - 10),
        })),
      };

      return {
        doc: {
          ...state.doc,
          pages: [...state.doc.pages, copy],
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  reorderPages: (from, to) =>
    set((state) => {
      const fromIndex = state.doc.pages.findIndex((p) => p.page_number === from);
      const toIndex = state.doc.pages.findIndex((p) => p.page_number === to);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return state;
      }

      const pages = [...state.doc.pages];
      const [moved] = pages.splice(fromIndex, 1);
      pages.splice(toIndex, 0, moved);
      const normalized = pages.map((page, index) => ({ ...page, page_number: index + 1 }));

      return {
        doc: {
          ...state.doc,
          pages: normalized,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  selectPage: (pageNumber) =>
    set((state) =>
      state.selectedPage === pageNumber
        ? { selectedPage: pageNumber }
        : { selectedPage: pageNumber, selectedElementId: undefined },
    ),
  addElement: (type, patch = {}) =>
    set((state) => {
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
      // Métricas de la página REALMENTE activa, no las del documento: una
      // página puede tener su propio paperSize/orientation (A3 horizontal
      // dentro de un documento A4 vertical, ver `setPagePaperSetup`) — usar
      // `metricsFromMeta(state.doc.meta)` acá calculaba márgenes/límites de
      // A4 para inserciones en una página A3, contradiciendo el pedido
      // explícito de "las mismas consideraciones de márgenes" en A3.
      const m = metricsForPage(activePage, state.doc.meta);

      const hasExplicitPosition =
        typeof patch.x === 'number' && Number.isFinite(patch.x) &&
        typeof patch.y === 'number' && Number.isFinite(patch.y);

      const placeElementInPage = (page: ReportPage, element: ReportElement) => {
        // Posición explícita (p.ej. desde un drop o una API que ya decidió
        // dónde va): respetarla tal cual, solo sujetada a los límites de la
        // hoja. El solape con bloques existentes es VÁLIDO — el ajuste de
        // texto (wrapMode) decide cómo convive el texto con el objeto.
        if (hasExplicitPosition) {
          const clampedX = Math.min(Math.max(element.x, 0), Math.max(0, m.PAGE_WIDTH - element.width));
          const clampedY = Math.min(Math.max(element.y, 0), Math.max(0, m.PAGE_HEIGHT - element.height));
          return { fits: true, element: { ...element, x: clampedX, y: clampedY } };
        }

        // Con un bloque de contenido seleccionado, el objeto nuevo prefiere
        // ubicarse CERCA de esa posición (como Word inserta en el cursor) en
        // vez de irse siempre al fondo de la página — pero SIEMPRE pasando
        // por el empaquetador de abajo, nunca ancla a ciegas: anclar
        // directamente al mismo `y` del seleccionado SIN pasar por
        // `findFreeSlot` (comportamiento viejo) garantizaba solape total con
        // objetos de tamaño real. `anchor` solo le da un límite inferior (no
        // busca más arriba que el TOPE del bloque seleccionado) -- usar el
        // FONDO del anchor como límite (`anchor.y + anchor.height + GAP`,
        // versión anterior) forzaba SIEMPRE una fila nueva en inserciones
        // secuenciales (el flujo típico: cada `addElement` selecciona el
        // bloque recién insertado, así que el siguiente insert siempre tenía
        // ANCLA = el anterior), dejando el empaquetador de 2 columnas de
        // `findFreeSlot` sin efecto práctico -- reproducido en vivo con el
        // generador de prueba exhaustiva: 1120 diagramas, TODOS en una sola
        // columna. Usar el TOPE del anchor deja que `findFreeSlot` evalúe esa
        // misma fila primero (cabe al lado si hay espacio) antes de bajar a
        // una fila nueva -- pedido explícito: "los diagramas de sensores
        // deben insertarse en 1 o 2 columnas... que no se dibuje un objeto
        // encima de otro".
        const anchor = page.elements.find(
          (el) =>
            el.id === state.selectedElementId &&
            el.type !== 'header' && el.type !== 'footer' && el.type !== 'cover',
        );
        const minY = anchor ? Math.max(m.CONTENT_TOP, anchor.y) : m.CONTENT_TOP;

        let slot = findFreeSlot(page.elements, m, element.width, element.height, minY);
        let placedElement = element;
        if (!slot) {
          // No hay ninguna posición libre a su tamaño pedido en TODA la
          // página (ni siquiera en una fila nueva al fondo) -- "en caso el
          // objeto no pueda ingresar en esas dimensiones se ajustan
          // automáticamente las dimensiones del objeto": se reduce a una
          // sola columna (ancho completo del área de contenido) y a la
          // altura que realmente quede libre debajo de lo último ya
          // colocado, y se reintenta UNA vez antes de rendirse (el llamador
          // pasa entonces a la siguiente hoja).
          const contentWidth = m.CONTENT_RIGHT - m.CONTENT_LEFT;
          const contentEls = page.elements.filter((el) => !NON_PACKABLE_TYPES.has(el.type));
          const maxBottom = contentEls.length
            ? Math.max(minY, ...contentEls.map((el) => el.y + el.height + INSERT_GAP))
            : minY;
          const remainingHeight = m.CONTENT_BOTTOM - maxBottom;
          const MIN_VIABLE_HEIGHT = 80;
          if (remainingHeight >= MIN_VIABLE_HEIGHT) {
            const maxW = Math.min(element.width, contentWidth);
            const maxH = Math.min(element.height, remainingHeight);
            // Imagen/video/mapa/gráfico son un único activo visual (a
            // diferencia de sensor_multi_chart, que reflowa varios paneles
            // internos) -- achicarlos con un factor de escala UNIFORME evita
            // deformarlos; clampear ancho y alto de forma independiente (como
            // antes) los "aplastaba" al no entrar en el espacio libre.
            const ASPECT_SENSITIVE_TYPES = new Set(['image', 'video', 'map', 'chart']);
            let shrunkWidth: number;
            let shrunkHeight: number;
            if (ASPECT_SENSITIVE_TYPES.has(element.type) && element.width > 0 && element.height > 0) {
              const scale = Math.min(maxW / element.width, maxH / element.height, 1);
              shrunkWidth = Math.max(1, Math.round(element.width * scale));
              shrunkHeight = Math.max(1, Math.round(element.height * scale));
            } else {
              shrunkWidth = maxW;
              shrunkHeight = maxH;
            }
            if (element.type === 'sensor_multi_chart') {
              // Prefiere la altura mínima natural del dashboard (con sus
              // paneles reflowados al ancho nuevo) si cabe en lo que queda;
              // si no, usa todo lo que quede -- sigue siendo utilizable,
              // solo más apretado, nunca se sale del margen inferior.
              const naturalMin = sensorDashboardMinHeight(element.props || {}, shrunkWidth);
              shrunkHeight = Math.min(remainingHeight, Math.max(naturalMin, shrunkHeight));
            }
            const retry = findFreeSlot(page.elements, m, shrunkWidth, shrunkHeight, minY);
            if (retry) {
              slot = retry;
              placedElement = { ...element, width: shrunkWidth, height: shrunkHeight };
            }
          }
        }

        if (slot) {
          return { fits: true, element: { ...placedElement, x: slot.x, y: slot.y } };
        }
        // Nada cabe en esta página ni siquiera reduciendo el tamaño -- el
        // llamador (addElement) lo coloca en la siguiente hoja disponible
        // (crea una si hace falta, ver más abajo).
        return { fits: false, element };
      };

      const mergePatch = (base: ReportElement): ReportElement => {
        const next = { ...base };
        if (patch.src != null) {
          next.src = patch.src;
        }
        if (typeof patch.width === 'number' && Number.isFinite(patch.width)) {
          next.width = patch.width;
        }
        if (typeof patch.height === 'number' && Number.isFinite(patch.height)) {
          next.height = patch.height;
        }
        if (patch.objectFit != null) {
          next.objectFit = patch.objectFit;
        }
        if (patch.props != null && typeof patch.props === 'object') {
          next.props = { ...(base.props || {}), ...patch.props };
        }
        if (typeof patch.zIndex === 'number' && Number.isFinite(patch.zIndex)) {
          next.zIndex = patch.zIndex;
        }
        if (typeof patch.x === 'number' && Number.isFinite(patch.x)) {
          next.x = patch.x;
        }
        if (typeof patch.y === 'number' && Number.isFinite(patch.y)) {
          next.y = patch.y;
        }
        return next;
      };

      // La carátula ocupa TODA la hoja (x=0,y=0, PAGE_WIDTH x PAGE_HEIGHT,
      // ver createElement) — no pasa por el flujo de contenido normal
      // (placeElementInPage la reposicionaría a CONTENT_LEFT/CONTENT_TOP) y
      // reemplaza el encabezado/pie automático de esa página (ADR-046): una
      // portada a toda página no convive con la franja de encabezado/pie,
      // igual que "primera página diferente" en Word.
      if (type === 'cover') {
        const baseCoverElement = createElement('cover', activePage.page_number, activePage.elements.length, m);
        // Las 5 opciones del ribbon (Corporativo/Técnico/Ejecutivo/Campo/
        // Normativo, ver lib/coverTemplates.ts) pasan su id en
        // `patch.props.coverTemplate` — se mergea acá porque esta rama de
        // 'cover' es un caso especial que antes ignoraba `patch` por
        // completo (a diferencia del resto de tipos, más abajo).
        const coverElement = patch.props && typeof patch.props === 'object'
          ? { ...baseCoverElement, props: { ...(baseCoverElement.props || {}), ...patch.props } }
          : baseCoverElement;
        const withoutChrome = activePage.elements.filter((el) => el.type !== 'header' && el.type !== 'footer');
        pages[currentIndex] = { ...activePage, elements: [...withoutChrome, coverElement] };
        return {
          doc: {
            ...state.doc,
            pages,
            meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
          },
          selectedPage: activePage.page_number,
          selectedElementId: coverElement.id,
        };
      }

      const baseElement = createElement(type, activePage.page_number, activePage.elements.length, m);
      const attempt = placeElementInPage(activePage, mergePatch(baseElement));

      if (attempt.fits) {
        pages[currentIndex] = {
          ...activePage,
          elements: [...activePage.elements, attempt.element],
        };

        return {
          doc: {
            ...state.doc,
            pages,
            meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
          },
          selectedPage: activePage.page_number,
          selectedElementId: attempt.element.id,
        };
      }

      const nextPageNumber = pages.length + 1;
      const layoutModeForNewPage = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const nextPage: ReportPage = {
        page_number: nextPageNumber,
        // Hereda el paperSize/orientation de la página que desbordó (no el
        // default del documento): si una sección A3 horizontal se queda sin
        // espacio a mitad de camino, la hoja de continuación sigue siendo
        // A3 horizontal -- de lo contrario `m` (ya resuelto arriba para
        // `activePage`) dejaría de coincidir con el tamaño real de esta
        // hoja nueva y el empaquetador volvería a calcular mal los límites.
        paperSize: activePage.paperSize,
        orientation: activePage.orientation,
        elements: createHeaderFooterPair(nextPageNumber, m, layoutModeForNewPage),
      };
      const nextElement = mergePatch(createElement(type, nextPageNumber, nextPage.elements.length, m));
      const nextPlacement = placeElementInPage(nextPage, nextElement);
      nextPage.elements.push(nextPlacement.element);
      pages.push(nextPage);

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: nextPageNumber,
        selectedElementId: nextPlacement.element.id,
      };
    }),
  addTocElement: () =>
    set((state) => {
      // Ya existe un TOC (bloque original, no de continuación) en cualquier
      // página -- no duplicar, solo enfocarlo.
      for (const page of state.doc.pages) {
        const existing = page.elements.find(
          (el) => el.type === 'toc' && el.props?.tocContinuationIndex == null,
        );
        if (existing) {
          return { selectedPage: page.page_number, selectedElementId: existing.id };
        }
      }

      const m = metricsFromMeta(state.doc.meta);
      const layoutMode = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const pages = [...state.doc.pages];

      // Página 2 reservada para el TOC -- crearla (y la 1, si tampoco
      // existiera) si el documento todavía no llega hasta ahí.
      while (pages.length < 2) {
        const pageNumber = pages.length + 1;
        pages.push({ page_number: pageNumber, elements: createHeaderFooterPair(pageNumber, m, layoutMode) });
      }

      const pageTwoIndex = pages.findIndex((p) => p.page_number === 2);
      const pageTwo = pages[pageTwoIndex];
      const pageTwoM = metricsForPage(pageTwo, state.doc.meta);
      const tocElement: ReportElement = {
        id: `toc-2-${Date.now()}`,
        type: 'toc',
        x: pageTwoM.CONTENT_LEFT,
        y: pageTwoM.CONTENT_TOP,
        width: pageTwoM.CONTENT_RIGHT - pageTwoM.CONTENT_LEFT,
        height: tocContinuationHeight(pageTwoM),
        zIndex: pageTwo.elements.length,
        locked: false,
        props: defaultPropsByType('toc'),
        border: defaultBorderByType('toc'),
      };
      pages[pageTwoIndex] = { ...pageTwo, elements: [...pageTwo.elements, tocElement] };

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: 2,
        selectedElementId: tocElement.id,
      };
    }),
  syncTocPages: () =>
    set((state) => {
      // Ubicar el bloque TOC original (nunca de continuación) y su página.
      let primaryPageIdx = -1;
      let primaryElement: ReportElement | null = null;
      state.doc.pages.forEach((page, idx) => {
        if (primaryElement) return;
        const found = page.elements.find(
          (el) => el.type === 'toc' && el.props?.tocContinuationIndex == null,
        );
        if (found) {
          primaryPageIdx = idx;
          primaryElement = found;
        }
      });
      if (!primaryElement || primaryPageIdx < 0) {
        return state; // sin TOC en el documento -- nada que reconciliar.
      }

      const m = metricsFromMeta(state.doc.meta);
      const layoutMode = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const entries = generateTocData(state.doc);
      const primaryCapacity = tocCapacityForBoxHeight((primaryElement as ReportElement).height);
      const continuationCapacity = tocCapacityForBoxHeight(tocContinuationHeight(m));

      const overflowCount = Math.max(0, entries.length - primaryCapacity);
      const neededContinuationPages = overflowCount > 0
        ? Math.ceil(overflowCount / Math.max(1, continuationCapacity))
        : 0;

      // Páginas de continuación EXISTENTES hoy, en orden, inmediatamente
      // después de la página del TOC original (cualquier bloque toc con
      // tocContinuationIndex numérico en cualquier página del documento).
      const existingContinuationPageIdx: number[] = [];
      state.doc.pages.forEach((page, idx) => {
        if (idx === primaryPageIdx) return;
        if (page.elements.some((el) => el.type === 'toc' && typeof el.props?.tocContinuationIndex === 'number')) {
          existingContinuationPageIdx.push(idx);
        }
      });

      if (existingContinuationPageIdx.length === neededContinuationPages) {
        return state; // ya está exactamente como debe estar -- no-op real.
      }

      let pages = [...state.doc.pages];

      if (existingContinuationPageIdx.length > neededContinuationPages) {
        // Sobran páginas de continuación -- retirar las últimas, pero SOLO
        // si no tienen nada más que header/footer/el bloque toc (no se
        // destruye contenido que el usuario haya agregado ahí después).
        const toRemove = existingContinuationPageIdx.slice(neededContinuationPages);
        const removablePageNumbers = new Set<number>();
        toRemove.forEach((idx) => {
          const page = pages[idx];
          const onlyChrome = page.elements.every(
            (el) => el.type === 'header' || el.type === 'footer' || el.type === 'toc',
          );
          if (onlyChrome) removablePageNumbers.add(page.page_number);
        });
        if (removablePageNumbers.size > 0) {
          pages = pages
            .filter((p) => !removablePageNumbers.has(p.page_number))
            .map((p, i) => ({ ...p, page_number: i + 1 }));
        }
      } else {
        // Faltan páginas de continuación -- insertarlas justo después de la
        // última página de TOC conocida (original o la última continuación).
        const lastKnownIdx = existingContinuationPageIdx.length > 0
          ? Math.max(primaryPageIdx, ...existingContinuationPageIdx)
          : primaryPageIdx;
        const toInsert = neededContinuationPages - existingContinuationPageIdx.length;
        const insertions: ReportPage[] = [];
        for (let i = 0; i < toInsert; i += 1) {
          const continuationIndex = existingContinuationPageIdx.length + i + 1;
          const tempPageNumber = lastKnownIdx + 2 + i; // solo para generar ids únicos, se renumera abajo
          const newPage: ReportPage = {
            page_number: tempPageNumber,
            elements: createHeaderFooterPair(tempPageNumber, m, layoutMode),
          };
          newPage.elements.push(createTocContinuationElement(tempPageNumber, continuationIndex, m));
          insertions.push(newPage);
        }
        pages = [
          ...pages.slice(0, lastKnownIdx + 1),
          ...insertions,
          ...pages.slice(lastKnownIdx + 1),
        ].map((p, i) => ({ ...p, page_number: i + 1 }));
      }

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  addCenteredImage: (pageNumber, src) =>
    set((state) => {
      const page = state.doc.pages.find((p) => p.page_number === pageNumber);
      if (!page) return state;
      const m = metricsForPage(page, state.doc.meta);
      const hasCover = page.elements.some((el) => el.type === 'cover');
      // Tamaño inicial generoso pero con margen visible alrededor — el
      // usuario la redimensiona/mueve libremente después (ver ADR-048
      // revisado: "una imagen única centrada... que después pueda moverse y
      // redimensionarse").
      const width = Math.min(560, m.PAGE_WIDTH * 0.65);
      const height = width * 0.68;
      // En una página de carátula, el título/empresa/unidad se ancla al pie
      // del bloque central (ver PageCanvas.tsx, justifyContent: 'flex-end')
      // dejando libre la franja superior — la foto se inserta ahí, arriba
      // del texto, en vez de superponerse en el centro (pedido explícito:
      // "la imagen mas arriba y el texto debajo de la imagen").
      const x = (m.PAGE_WIDTH - width) / 2;
      const y = hasCover ? 110 : (m.PAGE_HEIGHT - height) / 2;
      const element: ReportElement = {
        id: `image-${pageNumber}-${Date.now()}`,
        type: 'image',
        x,
        y,
        width,
        height,
        zIndex: page.elements.length,
        locked: false,
        src,
        objectFit: 'cover',
        wrapMode: 'square',
        props: defaultPropsByType('image'),
        border: defaultBorderByType('image'),
      };
      const pages = state.doc.pages.map((p) =>
        p.page_number === pageNumber ? { ...p, elements: [...p.elements, element] } : p,
      );
      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: pageNumber,
        selectedElementId: element.id,
      };
    }),
  // ADR-046 (revisado de nuevo): 'header'/'footer' ya no son plantillas
  // invocables por el usuario — se agregan automáticamente a toda página
  // (ver createHeaderFooterPair, addPage, loadDocument arriba). Este action
  // ahora solo sirve a 'findings' (la única plantilla de texto libre que
  // sigue existiendo en la UI).
  addTextTemplate: (template) =>
    set((state) => {
      const layoutMode = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
      const m = metricsForPage(activePage, state.doc.meta);
      const nextIndex = activePage.elements.length;

      const element = createTextTemplateElement(activePage.page_number, nextIndex, template, m);

      if (template === 'findings') {
        element.x = m.CONTENT_LEFT;
        element.y = m.CONTENT_TOP + 24;
        element.width = m.PAGE_WIDTH - m.CONTENT_LEFT * 2;
        element.height = 110;
        element.props.text = 'Hallazgos Técnicos:\n1.\n2.\n3.';
        element.props.fontSize = 14;
      } else if (template === 'annexes' || template === 'references') {
        // Mismo estilo que aplicar "Heading 1" a mano (RibbonToolbar.tsx,
        // onApplyHeadingStyle) -- headingStyle es lo que generateTocData()
        // (TableOfContents.tsx) usa para detectar secciones, así ANEXOS y
        // BIBLIOGRAFÍA/REFERENCIAS aparecen solos en el índice, igual que
        // cualquier otro título del informe.
        const h1 = HEADING_STYLES.find((hs) => hs.id === 'h1')!;
        element.props.text = template === 'annexes' ? 'ANEXOS' : 'BIBLIOGRAFÍA / REFERENCIAS';
        element.props.headingStyle = 'h1';
        element.props.fontFamily = h1.fontFamily;
        element.props.fontSize = h1.fontSize;
        element.props.bold = h1.fontWeight >= 600;
        element.props.italic = h1.italic;
        element.props.underline = h1.underline;
        element.props.fontColor = h1.color;
        element.props.textAlign = h1.textAlign;
        element.props.lineHeight = h1.lineHeight;
      }

      pages[currentIndex] = {
        ...activePage,
        elements: [...activePage.elements, element],
      };

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: activePage.page_number,
        selectedElementId: element.id,
      };
    }),
  addTechnicalBlock: (kind) =>
    set((state) => {
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
      const m = metricsForPage(activePage, state.doc.meta);
      const baseIndex = activePage.elements.length;
      const contentLeft = m.CONTENT_LEFT;
      const contentWidth = m.CONTENT_RIGHT - m.CONTENT_LEFT;
      const stamp = Date.now();
      const newElements: ReportElement[] = [];

      // Posiciona el bloque nuevo DEBAJO del contenido existente (mismo flujo
      // que addElement, ADR-046: encabezado/pie no cuentan), en vez de apilar
      // todo en un punto fijo — así insertar varios bloques seguidos no los
      // superpone. La tira KPI usa este mismo `startY` para sus 4 tarjetas
      // (van en fila, misma altura).
      const contentEls = activePage.elements.filter((el) => el.type !== 'header' && el.type !== 'footer');
      const maxBottom = contentEls.length
        ? Math.max(...contentEls.map((el) => el.y + el.height))
        : m.CONTENT_TOP - INSERT_GAP;
      const startY = Math.max(m.CONTENT_TOP, maxBottom + INSERT_GAP);

      // — Tira de tarjetas KPI: 4 tarjetas estáticas en fila (valor + meta),
      //   igual que el "Dashboard ejecutivo" del modelo. Cada tarjeta es un
      //   bloque de texto con fondo tenue, borde de acento y el valor grande
      //   en negrita (span) sobre la etiqueta y la meta. Estáticas a
      //   propósito: son de presentación, no consultan la BD (el bloque KPI
      //   en vivo sigue disponible aparte en "Contenido").
      if (kind === 'kpi-strip') {
        const CARDS = [
          { value: '96.8 %', label: 'Disponibilidad', meta: 'Meta ≥ 95 %' },
          { value: '92 / 98', label: 'Sensores operativos', meta: '6 con restricción' },
          { value: '0', label: 'Alarmas rojas', meta: 'al cierre del periodo' },
          { value: '97.4 %', label: 'Datos completos', meta: 'Meta ≥ 96 %' },
        ];
        const gap = 12;
        const cardW = Math.floor((contentWidth - gap * (CARDS.length - 1)) / CARDS.length);
        const cardH = 96;
        CARDS.forEach((card, i) => {
          const text = `${card.value}\n${card.label}\n${card.meta}`;
          const valueEnd = card.value.length;
          const labelEnd = valueEnd + 1 + card.label.length;
          newElements.push({
            id: `tech-kpi-${stamp}-${i}`,
            type: 'text',
            x: contentLeft + i * (cardW + gap),
            y: startY,
            width: cardW,
            height: cardH,
            zIndex: baseIndex + i,
            locked: false,
            props: {
              ...defaultPropsByType('text'),
              text,
              backgroundColor: '#EEF3F7',
              fontFamily: 'Arial',
              fontColor: '#334155',
              fontSize: 12,
              textAlign: 'center',
              lineHeight: 1.3,
              spans: [
                // Valor grande, negrita, navy corporativo.
                { start: 0, end: valueEnd, bold: true, color: '#17365D', fontSize: 24 },
                // Etiqueta en semibold, gris azulado.
                { start: valueEnd + 1, end: labelEnd, bold: true, color: '#475569', fontSize: 12 },
              ],
            },
            border: { enabled: true, width: 1, style: 'solid', color: '#4F81BD' },
          });
        });
      } else if (kind === 'caption') {
        // Pie de figura: estilo "Caption" del documento (itálica, azul
        // #4F81BD, pequeño, centrado, sin fondo ni borde).
        newElements.push({
          id: `tech-caption-${stamp}`,
          type: 'text',
          x: contentLeft,
          y: startY,
          width: contentWidth,
          height: 30,
          zIndex: baseIndex,
          locked: false,
          props: {
            ...defaultPropsByType('text'),
            text: 'Figura N. Descripción de la figura. Datos demostrativos.',
            backgroundColor: 'transparent',
            fontFamily: 'Arial',
            fontColor: '#4F81BD',
            fontSize: 12,
            italic: true,
            textAlign: 'center',
            lineHeight: 1.2,
          },
          border: { enabled: false, width: 1, style: 'solid', color: '#4F81BD' },
        });
      } else {
        // Cajas de resaltado semánticas (callout-info|success|warning|danger|dictamen).
        const variantKey = kind.startsWith('callout-') ? kind.slice('callout-'.length) : 'info';
        const v = TECH_CALLOUT_VARIANTS[variantKey] || TECH_CALLOUT_VARIANTS.info;
        const text = `${v.title}\n${v.body}`;
        const titleEnd = v.title.length;
        newElements.push({
          id: `tech-callout-${variantKey}-${stamp}`,
          type: 'text',
          x: contentLeft,
          y: startY,
          width: contentWidth,
          height: 78,
          zIndex: baseIndex,
          locked: false,
          props: {
            ...defaultPropsByType('text'),
            text,
            backgroundColor: v.bg,
            fontFamily: 'Arial',
            fontColor: v.bodyColor,
            fontSize: 13,
            textAlign: 'left',
            lineHeight: 1.35,
            spans: [
              // Título en negrita, ligeramente mayor, con el color de acento.
              { start: 0, end: titleEnd, bold: true, color: v.titleColor, fontSize: 14 },
            ],
          },
          border: { enabled: true, width: 2, style: 'solid', color: v.border },
        });
      }

      pages[currentIndex] = {
        ...activePage,
        elements: [...activePage.elements, ...newElements],
      };

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: activePage.page_number,
        selectedElementId: newElements[0]?.id,
      };
    }),
  addSectionTemplate: (kind) =>
    set((state) => {
      const tpl = SECTION_TEMPLATES[kind];
      if (!tpl) return {} as Partial<EditorState>;
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
      const m = metricsForPage(activePage, state.doc.meta);
      const baseIndex = activePage.elements.length;
      const contentLeft = m.CONTENT_LEFT;
      const contentWidth = m.CONTENT_RIGHT - m.CONTENT_LEFT;
      const stamp = Date.now();

      // Posición: debajo del contenido existente (encabezado/pie no cuentan).
      const contentEls = activePage.elements.filter((el) => el.type !== 'header' && el.type !== 'footer');
      const maxBottom = contentEls.length
        ? Math.max(...contentEls.map((el) => el.y + el.height))
        : m.CONTENT_TOP - INSERT_GAP;
      const startY = Math.max(m.CONTENT_TOP, maxBottom + INSERT_GAP);

      // Encabezado H2 (mismo mecanismo que ANEXOS/REFERENCIAS — headingStyle
      // hace que aparezca en el índice automático).
      const h2 = HEADING_STYLES.find((hs) => hs.id === 'h2') || HEADING_STYLES[0];
      const headingEl: ReportElement = {
        id: `sec-h-${kind}-${stamp}`,
        type: 'text',
        x: contentLeft,
        y: startY,
        width: contentWidth,
        height: 40,
        zIndex: baseIndex,
        locked: false,
        props: {
          ...defaultPropsByType('text'),
          text: tpl.heading,
          headingStyle: 'h2',
          fontFamily: h2.fontFamily,
          fontSize: h2.fontSize,
          bold: h2.fontWeight >= 600,
          italic: h2.italic,
          underline: h2.underline,
          fontColor: h2.color,
          textAlign: h2.textAlign,
          lineHeight: h2.lineHeight,
        },
      };

      const hasHeader = tpl.hasHeader !== false;
      const rowH = 34;
      const tableHeight = tpl.rows.length * rowH + 8;
      const tableEl: ReportElement = {
        id: `sec-t-${kind}-${stamp}`,
        type: 'table',
        x: contentLeft,
        y: startY + headingEl.height + 8,
        width: contentWidth,
        height: tableHeight,
        zIndex: baseIndex + 1,
        locked: false,
        props: {
          ...defaultPropsByType('table'),
          rows: tpl.rows.map((r) => [...r]),
          hasHeader,
          // Cabecera navy del documento corporativo.
          headerBg: '#17365D',
          headerTextColor: '#FFFFFF',
          headerBold: true,
          fontSize: 12,
          cellPadding: 6,
          bandedRows: true,
          bandColor: '#F5F8FA',
        },
        border: defaultBorderByType('table'),
      };

      pages[currentIndex] = {
        ...activePage,
        elements: [...activePage.elements, headingEl, tableEl],
      };

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: activePage.page_number,
        selectedElementId: tableEl.id,
      };
    }),
  addStaticChart: (kind) =>
    set((state) => {
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
      const m = metricsForPage(activePage, state.doc.meta);
      const baseIndex = activePage.elements.length;
      const contentLeft = m.CONTENT_LEFT;
      const contentWidth = m.CONTENT_RIGHT - m.CONTENT_LEFT;
      const stamp = Date.now();

      const contentEls = activePage.elements.filter((el) => el.type !== 'header' && el.type !== 'footer');
      const maxBottom = contentEls.length
        ? Math.max(...contentEls.map((el) => el.y + el.height))
        : m.CONTENT_TOP - INSERT_GAP;
      const startY = Math.max(m.CONTENT_TOP, maxBottom + INSERT_GAP);

      // Datos demostrativos idénticos a las 3 figuras del modelo.
      let chartProps: ElementProps;
      if (kind === 'chart-hbar') {
        chartProps = {
          live: false,
          chartKind: 'hbar',
          title: 'Operatividad por tecnología',
          categories: ['Radar', 'Prismas', 'Inclinómetros', 'ShapeArray', 'Piezómetros', 'Meteo', 'GNSS'],
          series: [99, 96, 88, 97, 91, 94, 98],
          xLabel: 'Operatividad (%)',
        };
      } else if (kind === 'chart-combo') {
        chartProps = {
          live: false,
          chartKind: 'combo',
          title: 'Correlación: deformación y precipitación',
          categories: Array.from({ length: 15 }, (_, i) => String(i + 1)),
          series: [0.05, 0.11, 0.16, 0.22, 0.27, 0.29, 0.35, 0.42, 0.5, 0.55, 0.58, 0.7, 0.8, 0.95, 1.13],
          series2: [1, 2, 3, 4, 2, 0, 5, 7, 3, 0, 1, 4, 11, 18, 30],
          seriesLabel: 'Desplazamiento (mm)',
          series2Label: 'Lluvia (mm)',
        };
      } else {
        chartProps = {
          live: false,
          chartKind: 'line',
          title: 'Disponibilidad mensual del sistema',
          categories: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'],
          series: [94.8, 96.1, 95.5, 97.0, 96.7, 98.2],
          threshold: 95,
          thresholdLabel: 'Meta ≥ 95 %',
          seriesLabel: 'Disponibilidad (%)',
        };
      }

      const chartEl: ReportElement = {
        id: `chart-static-${kind}-${stamp}`,
        type: 'chart',
        x: contentLeft,
        y: startY,
        width: contentWidth,
        height: 260,
        zIndex: baseIndex,
        locked: false,
        props: { ...defaultPropsByType('chart'), ...chartProps },
        border: defaultBorderByType('chart'),
      };

      pages[currentIndex] = {
        ...activePage,
        elements: [...activePage.elements, chartEl],
      };

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: activePage.page_number,
        selectedElementId: chartEl.id,
      };
    }),
  selectElement: (id) => set({ selectedElementId: id }),
  updateElement: (pageNumber, elementId, patch) =>
    set((state) => {
      const pages = state.doc.pages.map((page) => {
        if (page.page_number !== pageNumber) {
          return page;
        }
        return {
          ...page,
          elements: page.elements.map((element) => {
            if (element.id !== elementId) {
              return element;
            }
            const merged: ReportElement = { ...element, ...patch };
            if (
              merged.type === 'image' &&
              patch.src != null &&
              merged.props &&
              typeof merged.props === 'object' &&
              Object.prototype.hasOwnProperty.call(merged.props, 'src')
            ) {
              const { src: _legacySrc, ...restProps } = merged.props;
              merged.props = restProps;
            }
            return merged;
          }),
        };
      });
      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  removeElement: (pageNumber, elementId) =>
    set((state) => {
      const pages = state.doc.pages.map((page) => {
        if (page.page_number !== pageNumber) {
          return page;
        }
        return {
          ...page,
          elements: page.elements.filter((element) => element.id !== elementId),
        };
      });
      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedElementId: state.selectedElementId === elementId ? undefined : state.selectedElementId,
      };
    }),
  clipboardElement: null,
  copyElement: (pageNumber, elementId) =>
    set((state) => {
      const page = state.doc.pages.find((p) => p.page_number === pageNumber);
      const element = page?.elements.find((e) => e.id === elementId);
      // Snapshot profundo para que ediciones posteriores del original no
      // "contaminen" lo copiado (y viceversa al pegar).
      return { clipboardElement: element ? JSON.parse(JSON.stringify(element)) : state.clipboardElement };
    }),
  pasteElement: (pageNumber) => {
    const state = get();
    const src = state.clipboardElement;
    if (!src) return null;
    const m = metricsForPage(
      state.doc.pages.find((p) => p.page_number === pageNumber) || { paperSize: undefined, orientation: undefined },
      state.doc.meta,
    );
    // Desplazamiento leve para que la copia no tape exactamente al original;
    // acotado al interior de la hoja.
    const OFFSET = 24;
    const newId = `${src.type}-${pageNumber}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const maxZ = Math.max(0, ...state.doc.pages.flatMap((p) => p.elements.map((e) => e.zIndex || 0)));
    const clone: ReportElement = {
      ...JSON.parse(JSON.stringify(src)),
      id: newId,
      x: Math.min(src.x + OFFSET, Math.max(0, m.PAGE_WIDTH - src.width - 4)),
      y: Math.min(src.y + OFFSET, Math.max(0, m.PAGE_HEIGHT - src.height - 4)),
      zIndex: maxZ + 1,
      locked: false,
    };
    set((s) => ({
      doc: {
        ...s.doc,
        pages: s.doc.pages.map((p) =>
          p.page_number === pageNumber ? { ...p, elements: [...p.elements, clone] } : p,
        ),
        meta: { ...s.doc.meta, version: s.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
      selectedPage: pageNumber,
      selectedElementId: newId,
    }));
    return newId;
  },
  reviewDocumentQuality: () => {
    const state = get();
    return buildDocumentReview(state.doc);
  },
  getOptimizationSuggestions: () => {
    const state = get();
    const suggestions: OptimizationSuggestion[] = [];

    state.doc.pages.forEach((page) => {
      page.elements.forEach((element) => {
        if (element.type !== 'text') {
          return;
        }

        const originalText = String(element?.props?.text ?? '');
        const optimizedText = optimizeSyntaxOrder(originalText);

        if (optimizedText === originalText) {
          return;
        }

        suggestions.push({
          id: `ai-${page.page_number}-${element.id}`,
          pageNumber: page.page_number,
          elementId: element.id,
          originalText,
          optimizedText,
          delta: Math.abs(optimizedText.length - originalText.length),
          severity: detectSuggestionSeverity(originalText, optimizedText),
        });
      });
    });

    return suggestions;
  },
  applyOptimizationSuggestion: ({ pageNumber, elementId, optimizedText }) =>
    set((state) => {
      const pages = state.doc.pages.map((page) => {
        if (page.page_number !== pageNumber) {
          return page;
        }

        return {
          ...page,
          elements: page.elements.map((element) => {
            if (element.id !== elementId || element.type !== 'text') {
              return element;
            }

            return {
              ...element,
              props: {
                ...element.props,
                text: optimizedText,
              },
            };
          }),
        };
      });

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  applyOptimizationBatch: (suggestions) => {
    let applied = 0;

    set((state) => {
      const suggestionMap = new Map(
        (suggestions || []).map((item) => [`${item.pageNumber}::${item.elementId}`, item.optimizedText]),
      );

      const pages = state.doc.pages.map((page) => {
        const updatedElements = page.elements.map((element) => {
          const key = `${page.page_number}::${element.id}`;
          const optimizedText = suggestionMap.get(key);

          if (!optimizedText || element.type !== 'text') {
            return element;
          }

          applied += 1;
          return {
            ...element,
            props: {
              ...element.props,
              text: optimizedText,
            },
          };
        });

        return {
          ...page,
          elements: updatedElements,
        };
      });

      if (applied === 0) {
        return state;
      }

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    });

    return { applied };
  },
  optimizeDocumentWithAI: () => {
    let optimizedBlocks = 0;
    let totalTextBlocks = 0;

    set((state) => {
      const pages = state.doc.pages.map((page) => {
        const updatedElements = page.elements.map((element) => {
          if (element.type !== 'text') {
            return element;
          }

          totalTextBlocks += 1;
          const currentText = String(element?.props?.text ?? '');
          const improvedText = optimizeSyntaxOrder(currentText);
          if (improvedText === currentText) {
            return element;
          }

          optimizedBlocks += 1;
          return {
            ...element,
            props: {
              ...element.props,
              text: improvedText,
            },
          };
        });

        return {
          ...page,
          elements: updatedElements,
        };
      });

      if (optimizedBlocks === 0) {
        return state;
      }

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    });

    return {
      optimizedBlocks,
      totalTextBlocks,
    };
  },
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  setGridEnabled: (enabled) => set({ gridEnabled: enabled }),
}));

// Ayuda de desarrollo/testing: expone el store en window SOLO en dev server
// (import.meta.env.DEV) — permite montar escenarios de prueba E2E (documentos
// con spans/wrapModes específicos) sin depender de flujos de UI frágiles.
// En builds de producción esta rama se elimina por tree-shaking.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__EDITOR_STORE__ = useEditorStore;
}
