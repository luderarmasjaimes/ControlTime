import { create } from 'zustand';
import { getReportLayoutMetrics } from '../lib/reportLayoutMetrics';
import { REPORT_IMAGE_PLACEHOLDER_SVG } from '../lib/reportImageSrc';
import { generateTocData } from '../components/document/TableOfContents';
import { HEADING_STYLES } from '../lib/headingStyles';
import { buildDocumentTemplate } from '../lib/documentTemplates';
import { findSlideLayout, buildSlideLayoutElements, buildSlideLayoutDeckSpecs } from '../lib/slideLayouts';
import { buildChartDataFromTable } from '../lib/chartFromTable';
import type { TextStyleSpan, BaseTextStyle } from '../lib/textSpans';
import type { ReplicaImportPage } from '../lib/pdfOcrImport';
import type { PasteBlock } from '../lib/richPaste';

import { log } from '../../../lib/logger';
export const INSERT_GAP = 12;

/** Resuelve las métricas de lienzo desde `doc.meta` — único punto que lee
 * layoutMode/paperSize/orientation, para que el tamaño de página (A4/A3,
 * vertical/horizontal) se aplique de forma consistente en cada acción que
 * crea o reposiciona elementos. */
const metricsFromMeta = (meta: Partial<DocumentMeta> | undefined) =>
  getReportLayoutMetrics(
    meta?.layoutMode === 'presentation' ? 'presentation' : 'document',
    meta?.paperSize || 'A4',
    meta?.orientation || 'portrait',
    meta?.marginLeft,
    meta?.marginRight,
    meta?.marginTop,
    meta?.marginBottom,
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
    meta?.marginLeft,
    meta?.marginRight,
    meta?.marginTop,
    meta?.marginBottom,
  );
};

/** Y/alto del bloque VISUAL de encabezado (distinto del alto RESERVADO para
 * encabezado en las métricas de layout -- HEADER_HEIGHT en
 * reportLayoutMetrics.ts, que además deja aire antes de CONTENT_TOP). El
 * mismo cálculo se repetía idéntico en 4 sitios (applyPageSetup,
 * applyDocumentMargins, applyPagePaperSetup, y el header por defecto de una
 * página nueva) y quedaban fácilmente desincronizados si solo se
 * actualizaba alguno al tocar el tamaño de lienzo -- pasó exactamente eso
 * al corregir el lienzo de presentación a su tamaño real (ver
 * reportLayoutMetrics.ts: 960x540 → 1280x720, ADR-083 corregido
 * 2026-09-04): los valores 8/32 de "presentation" son el 8/32 original
 * escalado por el mismo factor 4/3 que el resto del lienzo (1280/960),
 * redondeado. */
const headerElementGeometry = (layoutMode: 'document' | 'presentation') =>
  (layoutMode === 'presentation' ? { y: 11, height: 43 } : { y: 10, height: 40 });

/**
 * Aplica un cambio de tamaño de hoja (A4/A3), orientación (vertical/
 * horizontal), o modo (documento/presentación) — recalcula la geometría de
 * los bloques "de plataforma" fijos (encabezado, pie de página, carátula a
 * toda hoja) para que sigan ocupando el ancho/alto correcto de la nueva
 * hoja, y REESCALA proporcionalmente el resto de bloques (texto, imágenes,
 * tablas, etc.) según cuánto cambió el ancho/alto real del lienzo — cada
 * elemento conserva su posición y tamaño RELATIVOS a la página (mismo % de
 * ancho/alto/x/y que antes), no sus coordenadas absolutas en píxeles.
 *
 * Antes esto imitaba a Word al cambiar tamaño de papel (encabezado/pie/
 * carátula se ajustaban, el resto se dejaba intacto para que el usuario
 * reacomodara a mano) — funcionaba razonablemente para A4↔A3 dentro de modo
 * documento (páginas de forma parecida), pero el cambio documento↔
 * presentación pasa de una hoja A4/A3 (alta, angosta) a un lienzo 16:9 fijo
 * de proporción totalmente distinta (1280×720): un informe técnico
 * completo (texto + tablas anchas) quedaba con TODOS sus bloques en
 * coordenadas de una hoja de otra forma, sin ningún aviso — el caso real
 * que lo expuso fue exportar a PPTX un informe escrito en modo documento
 * (el propio botón "PPTX" ofrece cambiar a modo presentación con un clic,
 * ver handleExportPptx en App.tsx). El reescalado proporcional evita eso
 * en el caso general (documento↔presentación, A4↔A3, portrait↔landscape),
 * a costa de que el tamaño de fuente NO se reescala (mismo criterio que ya
 * usa el reflujo de texto al redimensionar un bloque a mano) — puede seguir
 * quedando texto que no encaja del todo en su caja nueva, pero ya no
 * aparece en una posición sin ninguna relación con el resto de la página.
 */
const applyPageSetup = (
  state: EditorState,
  patch: Partial<Pick<DocumentMeta, 'paperSize' | 'orientation' | 'layoutMode'>>,
) => {
  const meta: DocumentMeta = {
    ...state.doc.meta,
    ...patch,
    version: state.doc.meta.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const layoutMode = meta.layoutMode === 'presentation' ? 'presentation' : 'document';
  const m = metricsFromMeta(meta);
  const headerGeom = headerElementGeometry(layoutMode);
  // Un cambio de Tamaño/Orientación a nivel DOCUMENTO (control del ribbon,
  // sin elegir página) es "todo el documento" — limpia cualquier
  // personalización por página para que todas vuelvan a heredar el valor
  // global, igual que Word al reaplicar la configuración de página entera.
  const pages = state.doc.pages.map((page) => {
    // Métricas de ESTA página tal como estaban ANTES del cambio (respeta su
    // propio paperSize/orientation si los tenía, igual que
    // applyDocumentMargins más abajo) — la base del factor de escala.
    const previous = metricsForPage(page, state.doc.meta);
    const scaleX = previous.PAGE_WIDTH > 0 ? m.PAGE_WIDTH / previous.PAGE_WIDTH : 1;
    const scaleY = previous.PAGE_HEIGHT > 0 ? m.PAGE_HEIGHT / previous.PAGE_HEIGHT : 1;
    return {
      ...page,
      paperSize: undefined,
      orientation: undefined,
      elements: page.elements.map((el) => {
        if (el.type === 'header') {
          return {
            ...el,
            x: m.CONTENT_LEFT,
            y: headerGeom.y,
            width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
            height: headerGeom.height,
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
        if (scaleX === 1 && scaleY === 1) return el;
        return {
          ...el,
          x: el.x * scaleX,
          y: el.y * scaleY,
          width: el.width * scaleX,
          height: el.height * scaleY,
        };
      }),
    };
  });
  return { doc: { ...state.doc, pages, meta } };
};

/** Aplica márgenes globales respetando los objetos ya maquetados. Los bloques
 * que ocupaban toda la columna se vuelven a ajustar al nuevo ancho útil;
 * los demás conservan su tamaño/posición en lo posible y solo se recortan o
 * desplazan si quedaron fuera de los límites. */
const applyDocumentMargins = (state: EditorState, meta: DocumentMeta): ReportPage[] => {
  const layoutMode = meta.layoutMode === 'presentation' ? 'presentation' : 'document';
  const headerGeom = headerElementGeometry(layoutMode);
  return state.doc.pages.map((page) => {
    const previous = metricsForPage(page, state.doc.meta);
    const next = metricsForPage(page, meta);
    const contentWidth = Math.max(1, next.CONTENT_RIGHT - next.CONTENT_LEFT);
    return {
      ...page,
      elements: page.elements.map((element) => {
        if (element.type === 'header') {
          return {
            ...element,
            x: next.CONTENT_LEFT,
            y: headerGeom.y,
            width: contentWidth,
            height: headerGeom.height,
          };
        }
        if (element.type === 'footer') {
          return {
            ...element,
            x: next.CONTENT_LEFT,
            y: next.PAGE_HEIGHT - next.FOOTER_HEIGHT + 6,
            width: contentWidth,
            height: 30,
          };
        }
        if (element.type === 'cover') return element;

        const wasFullColumn =
          Math.abs(element.x - previous.CONTENT_LEFT) <= 2 &&
          Math.abs(element.x + element.width - previous.CONTENT_RIGHT) <= 4;
        const width = wasFullColumn
          ? contentWidth
          : Math.min(element.width, contentWidth);
        const x = wasFullColumn
          ? next.CONTENT_LEFT
          : Math.min(Math.max(element.x, next.CONTENT_LEFT), next.CONTENT_RIGHT - width);
        return { ...element, x, width };
      }),
    };
  });
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
  const headerGeom = headerElementGeometry(layoutMode);
  const pages = state.doc.pages.map((page) => {
    const affected = scope === 'only' ? page.page_number === pageNumber : page.page_number >= pageNumber;
    if (!affected) return page;
    const nextPage: ReportPage = { ...page, ...patch };
    const m = metricsForPage(nextPage, state.doc.meta);
    return {
      ...nextPage,
      elements: nextPage.elements.map((el) => {
        if (el.type === 'header') {
          return {
            ...el,
            x: m.CONTENT_LEFT,
            y: headerGeom.y,
            width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
            height: headerGeom.height,
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
        return el;
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
  rotation?: number;
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
  /** Id compartido entre los fragmentos de UN MISMO bloque de texto que la
   * paginación automática partió entre páginas por desborde (pegado de
   * Word/Docs, ver `insertTextWithPagination` en PageCanvas.tsx) -- pedido
   * explícito 2026-09-09: "que siga perteneciendo al mismo bloque original...
   * si lo muevo, se mueve todo en conjunto". `updateElement` usa este id
   * para desplazar a los demás fragmentos por el mismo delta cuando se
   * mueve uno de ellos, sin importar en qué página estén. No se asigna a
   * texto creado/partido por otras vías (edición manual, wrap de imagen). */
  linkedGroupId?: string;
}

/** Un grupo de elementos que originalmente vivían en UNA misma página del
 * documento, con su posición RELATIVA a la primera página copiada
 * (`pageOffset` 0-based) -- forma del portapapeles múltiple interno
 * (`clipboardElements`) y del marcador que lib/elementsClipboard.ts escribe
 * al portapapeles del sistema, para que Ctrl+A (documento completo, pedido
 * explícito 2026-09-09) pueda copiar/pegar varias páginas de un tirón. */
export interface ClipboardPageGroup {
  pageOffset: number;
  elements: ReportElement[];
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
  marginLeft?: number;
  marginRight?: number;
  /** Página réplica de un PDF importado (ADR-209): cada elemento está en su
   * posición ABSOLUTA de origen. No lleva encabezado/pie de plataforma (el
   * PDF trae los suyos, como texto/fondo) y el auto-flujo del editor
   * (empujar hacia abajo, pasar a la hoja siguiente) no la toca -- mover un
   * bloque ahí rompería la réplica y crearía justo las superposiciones que
   * este modo evita. */
  fixedLayout?: boolean;
  /** Transición de diapositiva (SCRUM-36) -- solo tiene efecto real cuando
   * `doc.meta.layoutMode === 'presentation'` (ver RibbonToolbar.tsx, oculto
   * en modo documento) y el informe se exporta a PPTX. `pptxgenjs` (la
   * libreria que arma el .pptx real en pdf-export-service/server.js) NO
   * soporta transiciones -- no existen en su API ni en su XML de salida,
   * confirmado revisando node_modules/pptxgenjs dentro del contenedor. El
   * .pptx real lleva la transicion via post-procesado: server.js reinyecta
   * un elemento `<p:transition>` en el XML de cada diapositiva despues de
   * que pptxgenjs escribe el archivo (ver TRANSITION_XML en ese archivo). */
  transition?: 'none' | 'fade' | 'push' | 'wipe' | 'cover' | 'uncover' | 'circle';
  /** Id del elemento de texto que ocupa TODA el área de contenido de esta
   * página (modo "texto plano", pedido explícito 2026-09-08, solo layoutMode
   * 'document' -- ver setPagePlainTextMode). Ese elemento en particular
   * pierde su borde de selección/recuadro punteado de edición y se
   * comporta como si estuviera SIEMPRE en edición (PageCanvas.tsx lo
   * consulta por id en cada pase de render que dibuja esos dos elementos) --
   * cualquier OTRO bloque de texto insertado encima conserva su
   * comportamiento normal, esto identifica a UNO solo, no al tipo 'text'
   * en general. Desactivar el modo NO borra el elemento -- solo deja de
   * tratarlo como especial, vuelve a comportarse como un bloque de texto
   * cualquiera. */
  plainTextElementId?: string;
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

/** Propiedades de párrafo aplicables a todos los globos de texto del
 * documento. `fontFamily`/`fontSize`/`fontColor` ("Fuente global") también
 * alcanzan el texto dentro de las celdas de tabla (ver `applyGlobalTextFormat`
 * más abajo); el resto (alineación, interlineado, sangrías, espaciado) es de
 * párrafo y no incluye tablas, imágenes, gráficos ni bloques de sensores. */
export interface GlobalTextFormat {
  /** Tipografía global del documento. */
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  indentLeft?: number;
  indentRight?: number;
  /** Sangría especial tipo Word: primera línea o francesa (APA). */
  specialIndent?: 'none' | 'firstLine' | 'hanging';
  specialIndentBy?: number;
  spacingBefore?: number;
  spacingAfter?: number;
}

/** Comentario anclado opcionalmente a un bloque del lienzo. Se almacena en
 * `doc.meta` para viajar con el informe, sus versiones y el autosave. */
export interface ReportComment {
  id: string;
  pageNumber: number;
  elementId?: string;
  author: string;
  /** Id estable del usuario que lo creó (session.userId). Ausente en
   * comentarios antiguos creados antes de este campo — en ese caso se
   * recurre al nombre (`author`) para decidir quién puede eliminarlo. */
  authorId?: string;
  text: string;
  createdAt: string;
  /** Posición de referencia para ordenar visualmente la conversación. */
  anchorY: number;
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
  linkedGroupId?: string;
  /** Página destino explícita para importadores posicionados (PDF/OCR). Si se omite, se usa selectedPage. */
  pageNumber?: number;
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

export const defaultPropsByType = (type: string): ElementProps => {
  if (type === 'shape') {
    return {
      shapeType: 'rectangle',
      fill: '#dbeafe',
      stroke: '#2563eb',
      strokeWidth: 2,
      opacity: 1,
    };
  }
  if (type === 'text') {
    return {
      text: '',
      fontFamily: 'Arial',
      fontSize: 16,
      fontColor: '#0f172a',
      // El lienzo no pinta un fondo para el texto por defecto; conservarlo
      // transparente también en el visor/PDF evita rectángulos blancos.
      backgroundColor: 'transparent',
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
      // Columnas tipo periódico (CSS `column-count` en pantalla/PDF; en
      // DOCX/PPTX se aproxima partiendo el texto en N cuadros de texto lado
      // a lado, ver lib/docx/buildReportDocx.ts -- ni `docx` ni `pptxgenjs`
      // exponen columnas reales a nivel de un solo párrafo/cuadro, eso es
      // una propiedad de SECCIÓN completa en OOXML). 1 = comportamiento
      // histórico (sin columnas).
      columnCount: 1,
    };
  }
  if (type === 'wordart') {
    return {
      text: 'TÍTULO',
      fontFamily: 'Arial',
      fontSize: 48,
      textAlign: 'center',
      // Relleno sólido (se usa cuando no hay degradado, ver gradientFrom/To).
      fillColor: '#1d4ed8',
      // Degradado opcional -- ambos vacíos = relleno sólido con `fillColor`.
      gradientFrom: '',
      gradientTo: '',
      strokeColor: '#0f172a',
      strokeWidth: 0,
      shadow: false,
    };
  }

  if (type === 'chart') {
    return {
      title: 'Dashboard dinámico',
      live: true,
      chartType: 'bar',
      theme: 'premium',
      caption: '',
      includeInToc: false,
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
      cellVAlign: 'top',
      // Filas alternadas ("banded rows", estilo Tabla de Word) — desactivado
      // por defecto para no romper el aspecto de tablas ya existentes.
      bandedRows: false,
      bandColor: '#f1f5f9',
      caption: '',
      includeInToc: false,
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
      caption: '',
      includeInToc: false,
    };
  }

  if (type === 'video') {
    return {
      // 'webcam' | 'screen' -- de dónde se grabó (informativo, no cambia el
      // render: ambos son <video> con controles nativos del navegador).
      source: 'webcam',
      mimeType: 'video/webm',
      durationSeconds: 0,
      caption: '',
      includeInToc: false,
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

/** Borde por defecto al INSERTAR un bloque nuevo — pedido explícito
 * 2026-09-08: antes venía activado (marco gris sutil) en todo tipo salvo
 * texto/header/footer/cover; ahora ningún bloque nuevo trae el borde
 * activado por defecto, el usuario lo prende a mano desde "Mostrar borde"
 * (BorderInspector, RightInspector.tsx) si lo quiere. `width`/`style`/
 * `color` quedan igual como valores de partida para cuando SÍ lo active.
 * También usado como fallback para bloques ya existentes en documentos
 * guardados ANTES de que este campo existiera. */
export const defaultBorderByType = (_type: string): ElementBorder => (
  { enabled: false, width: 1, style: 'solid', color: '#a9b8d3' }
);

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
  shapeType?: string,
): ReportElement => {
  const contentW = Math.max(80, m.CONTENT_RIGHT - m.CONTENT_LEFT);

  if (type === 'shape') {
    return {
      id: `shape-${pageNumber}-${Date.now()}-${nextIndex}`,
      type: 'shape',
      x: m.CONTENT_LEFT,
      y: m.CONTENT_TOP,
      width: shapeType === 'square' ? 140 : 180,
      height: shapeType === 'square' ? 140 : 120,
      zIndex: nextIndex,
      locked: false,
      wrapMode: 'infront',
      props: defaultPropsByType('shape'),
      border: defaultBorderByType('shape'),
    };
  }

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
): ReportElement[] => {
  const headerGeom = headerElementGeometry(layoutMode === 'presentation' ? 'presentation' : 'document');
  return [
    {
      id: `header-${pageNumber}`,
      type: 'header',
      x: m.CONTENT_LEFT,
      y: headerGeom.y,
      width: m.PAGE_WIDTH - m.CONTENT_LEFT * 2,
      height: headerGeom.height,
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
};

const TEXT_FLOW_GAP = 12;

/** Quita font-family/font-size/color inline (de `<span style="...">` y de
 * `<font face/size/color>` heredados de `execCommand`) de TODO el HTML de
 * una celda de tabla -- usado por `applyGlobalTextFormat` para que la
 * fuente/tamaño/color GLOBAL del documento realmente gane sobre cualquier
 * formato puntual aplicado antes en una celda, igual que ya hace esa misma
 * acción con los spans de los globos de texto ("gana al estilo base", ver
 * comentario ahí). Negrita/cursiva/subrayado/resaltado no se tocan. */
function stripCellFontOverrides(html: string): string {
  if (!html) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    el.style.removeProperty('font-family');
    el.style.removeProperty('font-size');
    el.style.removeProperty('color');
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  });
  container.querySelectorAll('font[face], font[size], font[color]').forEach((el) => {
    el.removeAttribute('face');
    el.removeAttribute('size');
    el.removeAttribute('color');
  });
  return container.innerHTML;
}

/** Aplica un cambio de fuente/tamaño/color de texto a una tabla COMPLETA:
 * actualiza el valor por defecto de la tabla Y quita cualquier override
 * puntual (por celda, o por selección de texto dentro de una celda vía la
 * barra de formato) que hubiera -- para que el cambio realmente alcance a
 * TODO el texto, sin dejar ganando un tamaño/fuente/color aplicado antes.
 * Mismo criterio que usa el bloque de más abajo con los spans de los globos
 * de texto ("gana al estilo base"). Reusada tanto por `applyGlobalTextFormat`
 * (todas las tablas del documento) como por el campo "Tamaño Texto" del
 * inspector de una tabla puntual (RightInspector.tsx) -- bug real
 * reportado: ese campo solo cambiaba las celdas que nunca habían tenido un
 * tamaño puntual aplicado por selección, porque antes solo tocaba el
 * default de la tabla y dejaba ganar cualquier override inline existente. */
export function applyTableFontPatch(
  props: ElementProps,
  patch: { fontFamily?: string; fontSize?: number; textColor?: string },
): ElementProps {
  const rows: string[][] = Array.isArray(props.rows) ? props.rows : [];
  const nextRows = rows.map((row) => row.map((cell) => stripCellFontOverrides(cell)));
  return { ...props, rows: nextRows, ...patch };
}

/** Dos bloques de texto comparten "columna" si sus rangos horizontales se
 * solapan (con 24px de tolerancia) — criterio usado tanto por
 * `reflowTextColumnAfterChange` (qué empujar hacia abajo cuando un bloque
 * crece) como por `splitOverflowingText` (qué empujar cuando se inserta un
 * bloque de continuación al tope de la página siguiente). */
function isSameTextColumn(a: Pick<ReportElement, 'id' | 'type' | 'x' | 'width'>, b: ReportElement): boolean {
  return b.type === 'text' && b.id !== a.id &&
    b.x < a.x + a.width - 24 && a.x < b.x + b.width - 24;
}

/** Tolerancia (px) para considerar que dos bloques "comparten fila" en
 * `computeAutoFlowPosition` -- mismo criterio que `isSameTextColumn` pero en
 * vertical: exige más que un simple roce de bordes, así dos filas separadas
 * por el espacio normal entre inserciones (`INSERT_GAP`, sin solape real)
 * nunca se confunden entre sí. */
const ROW_OVERLAP_TOLERANCE = 8;

function isSameRow(a: Pick<ReportElement, 'y' | 'height'>, b: Pick<ReportElement, 'y' | 'height'>): boolean {
  return b.y < a.y + a.height - ROW_OVERLAP_TOLERANCE && a.y < b.y + b.height - ROW_OVERLAP_TOLERANCE;
}

/**
 * Dónde colocar un objeto NUEVO insertado SIN posición explícita (botón del
 * ribbon o de la biblioteca izquierda -- un arrastre con drop point sí trae
 * `x`/`y` y no pasa por acá, ver `addElement`). Pedido explícito
 * 2026-09-10: "si inserto una imagen... y vuelvo a colocar otra sin mover
 * el cursor, esta NO debe sobreponerse, debe ir a la derecha si alcanza el
 * espacio... aprovechando al máximo la página". Antes, el objeto recién
 * insertado quedaba SIEMPRE seleccionado (ver el final de `addElement`), y
 * el siguiente insertado se anclaba EXACTAMENTE a esa misma posición
 * (x=CONTENT_LEFT, y=anchor.y) -- solapamiento total garantizado en
 * cualquier inserción consecutiva sin mover el mouse.
 *
 * Simula un flujo por filas (como el ajuste de texto de Word, o flex-wrap):
 *  1. Página sin contenido todavía -> esquina superior izquierda del área
 *     de contenido (respeta los márgenes ACTUALES, que el usuario puede
 *     haber cambiado -- `m` ya viene calculado a partir de ellos).
 *  2. Si no, se toma como referencia el elemento SELECCIONADO (si hay uno
 *     real -- conserva el comportamiento previo de "insertar junto al
 *     cursor", como Word) o, sin selección, el contenido más bajo de la
 *     página.
 *  3. Se reconstruye la FILA completa de esa referencia (todo bloque cuyo
 *     rango vertical se solape con el suyo, ver `isSameRow`) y se intenta
 *     colocar el objeto nuevo a la derecha del borde derecho ya ocupado de
 *     esa fila.
 *  4. Si no entra (se saldría del margen derecho -- p.ej. un bloque de
 *     texto, que ocupa todo el ancho de columna, nunca entra al lado de
 *     nada), se abre una fila nueva debajo de ESA fila, alineada al margen
 *     izquierdo.
 *
 * No decide si el resultado entra VERTICALMENTE en la página -- eso lo
 * sigue resolviendo el llamador comparando contra CONTENT_BOTTOM, igual que
 * antes (una tabla que no entra ni en fila nueva pasa a la página
 * siguiente).
 */
export function computeAutoFlowPosition(
  contentElements: ReportElement[],
  selectedElementId: string | undefined,
  elementSize: { width: number; height: number },
  m: ReturnType<typeof metricsFromMeta>,
): { x: number; y: number } {
  if (contentElements.length === 0) {
    return { x: m.CONTENT_LEFT, y: m.CONTENT_TOP };
  }

  const anchor =
    contentElements.find((el) => el.id === selectedElementId) ||
    contentElements.reduce((lowest, el) => (el.y + el.height > lowest.y + lowest.height ? el : lowest));

  const row = contentElements.filter((el) => isSameRow(anchor, el));
  const rowTop = Math.max(m.CONTENT_TOP, Math.min(...row.map((el) => el.y)));
  const rowRight = Math.max(...row.map((el) => el.x + el.width));
  const rowBottom = Math.max(...row.map((el) => el.y + el.height));

  const rightX = rowRight + INSERT_GAP;
  if (rightX + elementSize.width <= m.CONTENT_RIGHT) {
    return { x: rightX, y: rowTop };
  }

  return { x: m.CONTENT_LEFT, y: rowBottom + INSERT_GAP };
}

/** Devuelve `pages[index]`, creando páginas nuevas al final del array (con
 * su encabezado/pie de plataforma) tantas veces como haga falta hasta que
 * exista — mismo tamaño/orientación que `template`. MUTA `pages` in-place
 * (empuja con `.push`), igual que el resto de helpers de esta función:
 * pensado para usarse sobre un array de trabajo ya clonado, nunca sobre
 * `state.doc.pages` directamente. Compartido por `reflowTextColumnAfterChange`
 * y `splitOverflowingText` (ambos necesitan "la página siguiente, creándola
 * si no existe todavía"). */
function ensurePageAt(pages: ReportPage[], index: number, template: ReportPage, meta: DocumentMeta): ReportPage {
  while (!pages[index]) {
    const pageNumber = Math.max(0, ...pages.map((page) => page.page_number)) + 1;
    const metrics = metricsForPage(template, meta);
    const layoutMode = meta.layoutMode === 'presentation' ? 'presentation' : 'document';
    pages.push({
      page_number: pageNumber,
      paperSize: template.paperSize,
      orientation: template.orientation,
      elements: createHeaderFooterPair(pageNumber, metrics, layoutMode),
    });
  }
  return pages[index];
}

/** El elemento vive en una página réplica de PDF (ver ReportPage.fixedLayout)
 * -- ningún auto-flujo debe moverlo ni mover a sus vecinos. */
function isOnFixedLayoutPage(pages: ReportPage[], elementId: string): boolean {
  return pages.some((page) => page.fixedLayout && page.elements.some((element) => element.id === elementId));
}

/** Reacomoda únicamente globos de texto que pertenecen a la misma columna
 * visual que el texto modificado. Nunca mueve imágenes, tablas, formas ni
 * gráficos. Los bloques que ya no entran se trasladan ENTEROS a la siguiente
 * página, preservando su eje X. */
function reflowTextColumnAfterChange(
  sourcePages: ReportPage[],
  meta: DocumentMeta,
  changedElementId: string,
): ReportPage[] {
  if (isOnFixedLayoutPage(sourcePages, changedElementId)) return sourcePages;
  const pages = sourcePages.map((page) => ({ ...page, elements: [...page.elements] }));
  let anchorPageIndex = pages.findIndex((page) => page.elements.some((element) => element.id === changedElementId));
  if (anchorPageIndex < 0) return sourcePages;
  const anchor = pages[anchorPageIndex].elements.find((element) => element.id === changedElementId);
  if (!anchor || anchor.type !== 'text') return sourcePages;

  const sameColumn = (element: ReportElement) => isSameTextColumn(anchor, element);

  // Capturar el orden ANTES de mover elementos: página + posición vertical.
  // Así el flujo solo empuja hacia adelante y nunca reordena el documento.
  const chain = pages.flatMap((page, pageIndex) => page.elements
    // Se toma cualquier texto situado debajo del ORIGEN vertical del ancla,
    // pero SOLO dentro de su misma página: una página anterior siempre
    // antecede al ancla en el flujo del documento, sin importar el valor
    // numérico de su `y` (las coordenadas se reinician por página).
    // No se compara contra su altura ya modificada: si el globo crece de 50
    // a 200px, uno que estaba en y=100 sigue siendo precisamente el que debe
    // ser empujado, aunque ahora quede dentro de ese nuevo alto.
    .filter((element) => sameColumn(element) && (
      pageIndex > anchorPageIndex ||
      (pageIndex === anchorPageIndex && element.y > anchor.y)
    ))
    .sort((left, right) => left.y - right.y)
    .map((element) => ({ id: element.id, originalPageIndex: pageIndex, originalY: element.y })));

  const ensurePage = (index: number, template: ReportPage): ReportPage => ensurePageAt(pages, index, template, meta);

  const findElement = (id: string) => {
    const pageIndex = pages.findIndex((page) => page.elements.some((element) => element.id === id));
    if (pageIndex < 0) return null;
    const elementIndex = pages[pageIndex].elements.findIndex((element) => element.id === id);
    return { pageIndex, elementIndex, element: pages[pageIndex].elements[elementIndex] };
  };

  const moveText = (id: string, destinationPageIndex: number, y: number) => {
    const found = findElement(id);
    if (!found) return null;
    const destination = ensurePage(destinationPageIndex, pages[Math.min(found.pageIndex, pages.length - 1)]);
    const next = { ...found.element, y };
    if (found.pageIndex === destinationPageIndex) {
      pages[found.pageIndex] = {
        ...pages[found.pageIndex],
        elements: pages[found.pageIndex].elements.map((element) => element.id === id ? next : element),
      };
    } else {
      pages[found.pageIndex] = {
        ...pages[found.pageIndex],
        elements: pages[found.pageIndex].elements.filter((element) => element.id !== id),
      };
      pages[destinationPageIndex] = { ...destination, elements: [...destination.elements, next] };
    }
    return next;
  };

  let activePageIndex = anchorPageIndex;
  let activePage = pages[activePageIndex];
  let metrics = metricsForPage(activePage, meta);
  let cursorY = anchor.y + anchor.height + TEXT_FLOW_GAP;

  // Pedido explícito (2026-08-27): el ANCLA (el bloque que el usuario está
  // editando) NUNCA se mueve entera a otra página por su cuenta — eso ahora
  // es responsabilidad exclusiva de la auto-paginación en vivo
  // (handleLiveTyping/splitTextForHeight en PageCanvas.tsx, ver
  // splitOverflowingText más abajo), que la PARTE en dos en el momento
  // exacto en que deja de entrar. Si por lo que sea el ancla llega hasta
  // acá sin haber sido partida (p.ej. quedó justo al límite de sobra al
  // cerrar el editor), este reflow no debe "corregirla" reubicándola solo:
  // eso era el comportamiento viejo (moverla entera a la hoja siguiente
  // apenas no entraba) — pedido explícito del usuario: "únicamente que se
  // parta, no quiero que haga nada más por su cuenta". Se deja tal cual y
  // solo se sigue empujando la CADENA (lo que esté debajo de ella).

  for (const item of chain) {
    // No trasladar textos de una página posterior hacia arriba: al llegar a
    // una hoja que ya existía, se conserva su orden vertical original salvo
    // que el flujo anterior necesite empujarlo.
    if (activePageIndex < item.originalPageIndex) {
      activePageIndex = item.originalPageIndex;
      activePage = ensurePage(activePageIndex, pages[Math.max(0, activePageIndex - 1)]);
      metrics = metricsForPage(activePage, meta);
      cursorY = metrics.CONTENT_TOP;
    }

    const found = findElement(item.id);
    if (!found) continue;
    const desiredY = activePageIndex === item.originalPageIndex
      ? Math.max(item.originalY, cursorY)
      : cursorY;

    if (desiredY + found.element.height > metrics.CONTENT_BOTTOM) {
      activePageIndex += 1;
      activePage = ensurePage(activePageIndex, activePage);
      metrics = metricsForPage(activePage, meta);
      const moved = moveText(item.id, activePageIndex, metrics.CONTENT_TOP);
      if (!moved) continue;
      cursorY = moved.y + moved.height + TEXT_FLOW_GAP;
    } else {
      const moved = moveText(item.id, activePageIndex, desiredY);
      if (!moved) continue;
      cursorY = moved.y + moved.height + TEXT_FLOW_GAP;
    }
  }

  return pages;
}

// ── Desplazamiento automático GENERAL (pedido explícito 2026-08-28) ────────
// `reflowTextColumnAfterChange` de arriba SOLO mueve texto-sobre-texto (uso
// exclusivo de la partición automática al escribir, splitOverflowingText más
// abajo — NO SE TOCA, sigue exactamente igual). Lo que sigue es un mecanismo
// aparte y más general: cuando CUALQUIER bloque (texto, imagen, gráfico,
// kpi, video, tabla, forma…) crece hacia abajo o se inserta uno nuevo, todo
// lo que esté debajo en su misma columna se desplaza para no quedar tapado
// — sin importar el tipo. El eje X nunca se toca, en ningún bloque, en
// ningún caso.

const CONTENT_FLOW_GAP = 12;

/** Encabezado/pie (ADR-046, fijos fuera del área de contenido) y carátula
 * (ocupa toda la hoja) nunca participan del flujo automático: ni empujan
 * ni son empujados. */
function isFlowChrome(element: ReportElement): boolean {
  return element.type === 'header' || element.type === 'footer' || element.type === 'cover';
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** "Misma columna" para cualquier tipo de bloque (generaliza `isSameTextColumn`
 * de arriba, mismo criterio y misma tolerancia de 24px, pero sin exigir que
 * el candidato sea texto). */
function sameFlowColumn(anchor: { x: number; width: number }, candidate: { x: number; width: number }): boolean {
  return candidate.x < anchor.x + anchor.width - 24 && anchor.x < candidate.x + candidate.width - 24;
}

/** Agrupa los elementos "de flujo" (ya sin chrome) de UNA página en racimos
 * — componentes conexos por solape de sus cajas. Cubre el patrón real del
 * negocio: una forma (cuadrado/triángulo) con un globo de texto puesto a
 * mano ENCIMA a propósito — ese conjunto debe moverse siempre junto cuando
 * algo lo empuja, nunca solo una de las dos piezas (pedido explícito). Une
 * por transitividad (union-find): si A se solapa con B y B con C, los tres
 * quedan en el mismo racimo aunque A y C no se toquen directamente. */
function buildOverlapClusters(elements: ReportElement[]): ReportElement[][] {
  const parent = new Map<string, string>();
  elements.forEach((el) => parent.set(el.id, el.id));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      if (rectsOverlap(elements[i], elements[j])) union(elements[i].id, elements[j].id);
    }
  }
  const groups = new Map<string, ReportElement[]>();
  elements.forEach((el) => {
    const root = find(el.id);
    const list = groups.get(root);
    if (list) list.push(el); else groups.set(root, [el]);
  });
  return Array.from(groups.values());
}

/** Forma mínima de una celda fusionada de tabla (ver `TableBlock.tsx`,
 * donde vive la interfaz completa) -- solo lo que `splitOverflowingTable`
 * necesita para no partir un grupo fusionado por la mitad al paginar. */
interface TableMergedCellRef {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
}

interface FlowClusterItem {
  ids: string[];
  originalPageIndex: number;
  originalMinY: number;
  height: number;
  /** Desplazamiento vertical de cada miembro respecto al minY del racimo —
   * se conserva SIEMPRE al mover el racimo (nunca se rompe la posición
   * relativa entre, p.ej., la forma y el texto encima de ella). */
  memberOffsets: Map<string, number>;
}

/**
 * Empuja hacia abajo TODO lo que esté debajo de `changedElementId` en su
 * misma columna visual — CUALQUIER tipo de bloque, no solo texto. El
 * elemento que cambió puede ser de cualquier tipo también (creció por
 * resize manual, por contenido, o se acaba de insertar).
 *
 * Los racimos que se solapan A PROPÓSITO (ver `buildOverlapClusters`) se
 * mueven siempre juntos. El racimo al que pertenece el propio
 * `changedElementId` queda automáticamente excluido (nunca se empuja a sí
 * mismo). Un racimo con algún miembro `locked` se trata como inamovible —
 * no tendría sentido mover solo una parte de una composición bloqueada.
 */
function pushDownContentAfterChange(
  sourcePages: ReportPage[],
  meta: DocumentMeta,
  changedElementId: string,
  /** Tamaño/posición del ancla ANTES del cambio que disparó este empuje
   * (p.ej. antes de agrandar una imagen, o antes de reubicarla al tope de
   * la página siguiente). Bug real reportado: al crecer o reubicarse, el
   * ancla podía terminar solapando algo que antes NO tocaba — y como los
   * racimos (pensados para formas con texto encima A PROPÓSITO) se
   * calculan sobre las cajas ACTUALES, ese solape recién creado por el
   * propio cambio se interpretaba como "racimo intencional", fundiendo al
   * ancla con lo que debía empujar y excluyendo a AMBOS del empuje (todo
   * racimo que contiene al ancla queda fuera, ver abajo). Pasar el tamaño
   * VIEJO aquí hace que el armado de racimos "vea" al ancla como era antes
   * — cualquier cosa que ahora se solape solo por el cambio recién hecho
   * nunca se funde con ella, y sigue siendo empujable con normalidad. */
  previousAnchorBounds?: { x: number; y: number; width: number; height: number },
): ReportPage[] {
  if (isOnFixedLayoutPage(sourcePages, changedElementId)) return sourcePages;
  const pages = sourcePages.map((page) => ({ ...page, elements: [...page.elements] }));
  const anchorPageIndex = pages.findIndex((page) => page.elements.some((element) => element.id === changedElementId));
  if (anchorPageIndex < 0) return sourcePages;
  const anchor = pages[anchorPageIndex].elements.find((element) => element.id === changedElementId);
  if (!anchor) return sourcePages;

  /** Racimos de UNA página que caen debajo de `belowY` y comparten columna
   * con el ancla — sobre el tamaño VIEJO del ancla (ver `previousAnchorBounds`
   * arriba) para que un solape recién creado por el propio cambio nunca se
   * confunda con uno intencional preexistente. `belowY` en `-Infinity` trae
   * TODO lo de esa página (se usa para páginas recién alcanzadas por un
   * desborde real, donde cualquier cosa ahí — incluso justo en el tope —
   * puede necesitar correrse). */
  const clustersBelowOnPage = (pageIndex: number, belowY: number): FlowClusterItem[] => {
    const page = pages[pageIndex];
    if (!page) return [];
    const clusterCandidates = page.elements
      .filter((element) => !isFlowChrome(element))
      .map((element) => (
        element.id === changedElementId && previousAnchorBounds
          ? { ...element, ...previousAnchorBounds }
          : element
      ));
    const clusters = buildOverlapClusters(clusterCandidates);
    const items: FlowClusterItem[] = [];
    clusters.forEach((members) => {
      if (members.some((member) => member.id === changedElementId)) return;
      if (members.some((member) => member.locked)) return;

      const minY = Math.min(...members.map((member) => member.y));
      const maxBottom = Math.max(...members.map((member) => member.y + member.height));
      const minX = Math.min(...members.map((member) => member.x));
      const maxRight = Math.max(...members.map((member) => member.x + member.width));

      if (minY <= belowY) return;
      if (!sameFlowColumn(anchor, { x: minX, width: maxRight - minX })) return;

      const memberOffsets = new Map<string, number>();
      members.forEach((member) => memberOffsets.set(member.id, member.y - minY));

      items.push({
        ids: members.map((member) => member.id),
        originalPageIndex: pageIndex,
        originalMinY: minY,
        height: maxBottom - minY,
        memberOffsets,
      });
    });
    items.sort((left, right) => left.originalMinY - right.originalMinY);
    return items;
  };

  // La cola SOLO arranca con los racimos de la propia página del ancla.
  // Las páginas siguientes NUNCA se agregan de antemano — bug real
  // reportado 2026-09-04 ("en la 7 hago el movimiento y los bloques de la
  // página 8 se mueven de su posición"): antes se traían de una TODOS los
  // racimos de TODAS las páginas siguientes que compartieran columna, así
  // que una página ya acomodada (sin ningún desborde real llegando a ella)
  // igual entraba al barrido y su propio espaciado ajustado (menor al
  // margen CONTENT_FLOW_GAP de este empuje) bastaba para reordenarla sola.
  // Ahora una página siguiente solo se suma a la cola, y recién en ese
  // momento, cuando el desborde REALMENTE la alcanza (ver más abajo).
  const chain: FlowClusterItem[] = clustersBelowOnPage(anchorPageIndex, anchor.y);
  let highestPulledPageIndex = anchorPageIndex;

  const ensurePage = (index: number, template: ReportPage): ReportPage => ensurePageAt(pages, index, template, meta);

  const findMember = (id: string) => {
    const pageIndex = pages.findIndex((page) => page.elements.some((element) => element.id === id));
    if (pageIndex < 0) return null;
    return { pageIndex, element: pages[pageIndex].elements.find((element) => element.id === id)! };
  };

  /** Mueve TODOS los miembros de un racimo a la vez, preservando su
   * desplazamiento relativo y su X original — solo Y (y la página, si
   * cruza a la siguiente hoja) cambia. */
  const moveCluster = (item: FlowClusterItem, destinationPageIndex: number, minY: number) => {
    item.ids.forEach((id) => {
      const found = findMember(id);
      if (!found) return;
      const offset = item.memberOffsets.get(id) ?? 0;
      const next = { ...found.element, y: minY + offset };
      if (found.pageIndex === destinationPageIndex) {
        pages[found.pageIndex] = {
          ...pages[found.pageIndex],
          elements: pages[found.pageIndex].elements.map((element) => (element.id === id ? next : element)),
        };
      } else {
        pages[found.pageIndex] = {
          ...pages[found.pageIndex],
          elements: pages[found.pageIndex].elements.filter((element) => element.id !== id),
        };
        const destination = ensurePage(destinationPageIndex, pages[Math.min(found.pageIndex, pages.length - 1)]);
        pages[destinationPageIndex] = { ...destination, elements: [...destination.elements, next] };
      }
    });
  };

  let activePageIndex = anchorPageIndex;
  let activePage = pages[activePageIndex];
  let metrics = metricsForPage(activePage, meta);
  let cursorY = anchor.y + anchor.height + CONTENT_FLOW_GAP;

  for (let i = 0; i < chain.length; i += 1) {
    const item = chain[i];

    if (activePageIndex < item.originalPageIndex) {
      activePageIndex = item.originalPageIndex;
      activePage = ensurePage(activePageIndex, pages[Math.max(0, activePageIndex - 1)]);
      metrics = metricsForPage(activePage, meta);
      cursorY = metrics.CONTENT_TOP;
    }

    const desiredMinY = activePageIndex === item.originalPageIndex
      ? Math.max(item.originalMinY, cursorY)
      : cursorY;

    if (desiredMinY + item.height > metrics.CONTENT_BOTTOM) {
      activePageIndex += 1;
      activePage = ensurePage(activePageIndex, activePage);
      metrics = metricsForPage(activePage, meta);
      moveCluster(item, activePageIndex, metrics.CONTENT_TOP);
      cursorY = metrics.CONTENT_TOP + item.height + CONTENT_FLOW_GAP;
    } else {
      moveCluster(item, activePageIndex, desiredMinY);
      cursorY = desiredMinY + item.height + CONTENT_FLOW_GAP;
    }

    // Recién ahora que el barrido REALMENTE alcanzó (por desborde) una
    // página que todavía no había aportado sus propios racimos, se suman a
    // la cola — nunca antes. `-Infinity` porque el contenido entrante
    // acaba de aterrizar en el tope de esta página nueva: cualquier cosa
    // que ya viviera ahí, aunque esté justo en el tope, es candidata a
    // correrse si el recién llegado la toca.
    if (activePageIndex > highestPulledPageIndex) {
      highestPulledPageIndex = activePageIndex;
      const nativeItems = clustersBelowOnPage(activePageIndex, -Infinity)
        .filter((existing) => !existing.ids.some((id) => item.ids.includes(id)));
      chain.splice(i + 1, 0, ...nativeItems);
    }
  }

  return pages;
}

/**
 * Resuelve SOLO solapes DIRECTOS (rectángulos que realmente se tocan) entre
 * los elementos recién aterrizados en `toPageNum` (p.ej. al arrastrar uno o
 * varios bloques a otra página) y lo que ya hubiera ahí — a diferencia de
 * `pushDownContentAfterChange`, NUNCA trata "está más abajo en una columna
 * compartida" como motivo de empuje, ni encadena el corrimiento a través de
 * toda una secuencia ya ordenada, ni desborda a una página siguiente.
 *
 * Pedido explícito 2026-09-04 (bug real reportado): usar el empuje en
 * cascada normal para esto (lo que se hacía antes) resolvía bien el caso
 * "una imagen aterriza justo ENCIMA de una tabla" pero rompía el caso mucho
 * más común "aterriza cerca de un grupo de bloques de sensores ya
 * acomodados en orden" — cualquier bloque ancho que compartiera columna con
 * VARIOS de ellos los arrastraba a todos hacia abajo en cadena, y alguno
 * terminaba en otra página, aunque no hubiera solape real con la mayoría.
 * Acá solo se corre lo que el bloque recién llegado literalmente toca, y
 * solo lo justo para dejar de tocarlo — nunca reordena una composición que
 * ya tenía su propio espaciado correcto.
 */
function resolveDirectOverlapsOnLanding(
  sourcePages: ReportPage[],
  toPageNum: number,
  landedIds: string[],
): ReportPage[] {
  if (sourcePages.some((page) => page.page_number === toPageNum && page.fixedLayout)) return sourcePages;
  const pageIndex = sourcePages.findIndex((page) => page.page_number === toPageNum);
  if (pageIndex < 0) return sourcePages;
  const pages = sourcePages.map((page) => ({ ...page, elements: [...page.elements] }));
  const landedSet = new Set(landedIds);

  // Varias pasadas: correr un elemento hacia abajo puede hacer que ahora
  // toque al SIGUIENTE de la misma columna — pero cada pasada solo actúa
  // sobre solapes reales que existan EN ESE MOMENTO, así que esto converge
  // apenas nadie se toca más (nunca sigue corriendo "por las dudas"). Tope
  // de pasadas como salvaguarda contra un ciclo inesperado, no porque se
  // espere llegar a él en un caso normal.
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    const elements = pages[pageIndex].elements;
    for (const landedId of landedIds) {
      const landed = elements.find((element) => element.id === landedId);
      if (!landed) continue;
      for (const other of elements) {
        if (landedSet.has(other.id) || isFlowChrome(other) || other.locked) continue;
        if (!rectsOverlap(landed, other)) continue;
        const nextY = landed.y + landed.height + CONTENT_FLOW_GAP;
        if (other.y < nextY) {
          pages[pageIndex] = {
            ...pages[pageIndex],
            elements: pages[pageIndex].elements.map((element) =>
              element.id === other.id ? { ...element, y: nextY } : element),
          };
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return pages;
}

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
  selectedElementIds: string[]; 
  hoveredCommentId: string | undefined;
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
  /** Inicia un informe completamente nuevo, conservando únicamente la
   * estructura base de una primera página vacía. `author` -- pásese
   * siempre el nombre del usuario logueado (App.tsx::loggedAuthor); sin
   * argumento queda el placeholder histórico 'AGM Solutions' (el store no
   * tiene acceso a la sesión). Real desde 2026-09-08: antes SIEMPRE quedaba
   * en el placeholder sin importar quién creara el documento -- el header
   * del editor mostraba el nombre real (viene de `loggedAuthor`, no de
   * `doc.meta.author`), pero cualquier lectura de `doc.meta.author` (p.ej.
   * filtrar "Documentos sin conexión" por usuario, ReportsAdminModal.tsx)
   * veía el placeholder para TODO documento nuevo, de TODO usuario. */
  createNewDocument: (author?: string) => void;
  /** Carga un doc JSON externo en el editor (desde "Abrir para editar") */
  loadDocument: (contentJson: string | Partial<ReportDocument>, reportId?: string | null, reportTitle?: string) => void;
  setLayoutMode: (layoutMode: string) => void;
  setPaperSize: (paperSize: 'A4' | 'A3') => void;
  setOrientation: (orientation: 'portrait' | 'landscape') => void;
  setHorizontalMargins: (left: number, right: number) => void;
  setPageMargins: (margins: { top: number; right: number; bottom: number; left: number }) => void;
  applyGlobalTextFormat: (format: GlobalTextFormat) => void;
  addComment: (args: { pageNumber: number; elementId?: string; author: string; authorId?: string }) => void;
  updateComment: (commentId: string, text: string) => void;
  deleteComment: (commentId: string) => void;
  setHoveredCommentId: (commentId: string | undefined) => void;
  /** Cambia tamaño/orientación de una página concreta — 'only' afecta solo
   * esa página, 'following' esa página y todas las posteriores. */
  setPagePaperSetup: (
    pageNumber: number,
    patch: Partial<Pick<ReportPage, 'paperSize' | 'orientation'>>,
    scope: 'only' | 'following',
  ) => void;
  /** Transición de ESTA diapositiva (SCRUM-36, ver ReportPage.transition) --
   * a diferencia del tamaño/orientación no tiene un "scope" de aplicar a
   * las siguientes: cada diapositiva de una presentación normalmente tiene
   * su propia transición, no se hereda de la anterior. */
  setPageTransition: (pageNumber: number, transition: ReportPage['transition']) => void;
  /** Activa/desactiva el modo "texto plano" de una página (pedido explícito
   * 2026-09-08, solo layoutMode 'document' -- ver ReportPage.plainTextElementId
   * y el botón dentro de PagePaperSetupControl, MultipageView.tsx). Activar
   * crea (o reutiliza, si ya hay uno) un bloque de texto que ocupa toda el
   * área de contenido (respeta márgenes) y lo marca como el especial de esta
   * página; desactivar solo quita la marca -- el bloque de texto queda tal
   * cual, ahora como uno normal. */
  setPagePlainTextMode: (pageNumber: number, enabled: boolean) => void;
  /** Aplica un diseño de la galería de diapositivas (lib/slideLayouts.ts)
   * como un mini-deck de 5 diapositivas con la MISMA temática de color,
   * empezando en la diapositiva actualmente seleccionada: la actual se
   * reemplaza in-place y se insertan 4 diapositivas nuevas justo después
   * (título, contenido, imagen, dato destacado, cierre — ver
   * buildSlideLayoutDeckSpecs), cada una con su propio texto placeholder
   * entre corchetes en vez de repetir el mismo genérico. Los diseños "a
   * sangre" (sin encabezado/pie, ver slideLayouts.ts) también reemplazan
   * ese chrome -- se vería fuera de lugar encima de un fondo oscuro o de
   * color, mismo criterio que la carátula real del informe. */
  applySlideLayout: (layoutId: string) => void;
  addPage: () => void;
  /** Inserta una hoja nueva y vacía (con su propio encabezado/pie) justo
   * antes o después de `referencePageNumber` -- a diferencia de `addPage`,
   * que siempre agrega al final del documento. Renumera el resto de hojas
   * y corre los comentarios anclados a páginas posteriores. */
  insertPageAt: (referencePageNumber: number, position: 'before' | 'after') => void;
  /** Elimina una hoja y su contenido. Se mantiene siempre al menos una hoja. */
  removePage: (pageNumber: number) => void;
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
  /** Fuerza el re-render de la(s) página(s) que contienen un bloque toc —
   * botón "Actualizar índice" en el lienzo (PageCanvas.tsx). El número de
   * página de cada entrada ya se recalcula al vuelo desde `doc.pages` en
   * cada render (generateTocData en TableOfContents.tsx), pero PageCanvas
   * está envuelto en React.memo por su prop `page`: si el encabezado que
   * cambió de posición vive en OTRA página distinta a la del bloque toc,
   * la página del toc nunca recibe una prop `page` nueva y por lo tanto
   * jamás vuelve a ejecutar ese cálculo, quedando con el número de página
   * viejo aunque el dato ya esté correcto en el store. Esta acción no
   * cambia ningún contenido — solo reemplaza el objeto `page` (misma
   * referencia de `elements`) para que React note el cambio y re-renderice. */
  refreshTocDisplay: () => void;
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
  /** Crea un gráfico `chart` (mismo elemento/motor que `addStaticChart`,
   * Plotly vía LiveChartBlock) pero con datos REALES tomados de una tabla
   * existente en vez de datos de muestra -- pedido explícito 2026-09-11
   * ("crear gráficos a partir de nuestras tablas"). Ver
   * lib/chartFromTable.ts para cómo se arman categories/series desde
   * `rows`. Se inserta justo debajo del contenido más bajo de la MISMA
   * página que la tabla (sea o no la página seleccionada). */
  addChartFromTable: (tableElementId: string, config: { chartKind: string; categoryColumn: number; seriesColumns: number[] }) => void;
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
  /** Aplica la posición/alto que el ajuste de texto alrededor de un objeto
   * (wrapMode) calculó para un bloque (ver PageCanvas.tsx). A diferencia de
   * `updateElement`, PUEDE mover el bloque entero a la página siguiente si
   * ya no entra en lo que resta de esta — el sistema de ajuste de texto no
   * sabe nada de límites de página, solo calcula geometría local, así que
   * sin esto el texto terminaba superpuesto al pie de página en vez de
   * continuar en la hoja siguiente. Nunca se usa para el texto que el
   * usuario escribe en vivo (esa sigue siendo responsabilidad exclusiva de
   * `splitOverflowingText`, que PARTE en vez de mover entero). */
  relocateWrapAdjustedText: (pageNumber: number, elementId: string, y: number, height: number) => void;
  removeElement: (pageNumber: number, elementId: string) => void;
  removeElements: (pageNumber: number, elementIds: string[]) => void;
  /** Portapapeles interno (copiar/pegar de objetos del lienzo) — snapshot
   * del elemento copiado, independiente del portapapeles del SO. */
  clipboardElement: ReportElement | null;
  /** Copia el elemento indicado al portapapeles interno. */
  copyElement: (pageNumber: number, elementId: string) => void;
  /** Pega el elemento del portapapeles en la página dada (clon con nuevo id
   * y ligero desplazamiento para que no tape al original), y lo selecciona.
   * Devuelve el id del nuevo elemento, o null si no hay nada que pegar. */
  pasteElement: (pageNumber: number) => string | null;
  /** Portapapeles interno para VARIOS elementos a la vez, de UNA o VARIAS
   * páginas (Ctrl+A + Ctrl+C/V, pedido explícito 2026-09-09 -- Ctrl+A
   * selecciona el documento COMPLETO) — separado de `clipboardElement` (un
   * solo elemento) para no tocar ese camino ya en uso (menú contextual,
   * botón de la cinta). Agrupado por página de origen: cada entrada trae
   * `pageOffset` (0-based, relativo a la primera página que tenía algo
   * copiado) y los elementos que vivían ahí — así `pasteSelection` puede
   * reconstruir la misma cantidad de páginas al pegar. Snapshot profundo,
   * mismo motivo que `clipboardElement`. */
  clipboardElements: ClipboardPageGroup[] | null;
  /** Bloques (texto/tabla/imagen) pendientes de insertar en el lienzo,
   * generados por la importación de un .docx (ribbon Datos > Importación,
   * ver App.tsx::handleImportDocx) fuera de cualquier evento de pegado real
   * -- mismo formato (`PasteBlock`) que produce `parseRichClipboardBlocks`
   * para el pegado de Word/Docs, así que PageCanvas.tsx puede insertarlos
   * con el MISMO código ya probado (`processPasteBlocks`), sin duplicar esa
   * lógica. Efímero: la página seleccionada lo consume y lo limpia a `null`
   * apenas lo recibe (ver el efecto correspondiente en PageCanvas.tsx). */
  pendingImportBlocks: PasteBlock[] | null;
  setPendingImportBlocks: (blocks: PasteBlock[] | null) => void;
  /** Importación de PDF en modo réplica (ADR-209): agrega las páginas ya
   * resueltas (fondo + textos en posición absoluta, ver
   * lib/pdfOcrImport.ts::buildReplicaPages) de una sola vez. Si el documento
   * no tiene contenido todavía, las páginas importadas lo reemplazan; si no,
   * se agregan al final. Devuelve el número de la primera página importada. */
  importReplicaPages: (pages: ReplicaImportPage[]) => number;
  /** Copia los elementos indicados (de cualquier página del documento) al
   * portapapeles múltiple interno, agrupados por su página de origen. */
  copySelection: (elementIds: string[]) => void;
  /** Pega un grupo (o varios grupos de página) en el documento: el grupo con
   * `pageOffset` 0 se agrega a la página `pageNumber` (junto a lo que ya
   * haya ahí, con un desplazamiento leve para no tapar el original); cada
   * grupo con offset mayor se convierte en una página NUEVA agregada al
   * final del documento — nunca reutiliza ni sobrescribe una página
   * existente ajena, aunque su número coincida por aritmética. `groups`, si
   * se pasa, reemplaza el contenido del portapapeles ANTES de pegar (pegado
   * que llega del portapapeles real del sistema, ver
   * PageCanvas.tsx::onSystemPaste + lib/elementsClipboard.ts); sin ese
   * argumento usa lo que ya haya en `clipboardElements`. Devuelve los ids
   * nuevos (vacío si no había nada que pegar) para que el caller los
   * seleccione. */
  pasteSelection: (pageNumber: number, groups?: ClipboardPageGroup[]) => string[];
  /** Selecciona TODOS los elementos de contenido del documento COMPLETO —
   * todas las páginas, no solo la actual (excluye encabezado/pie/carátula,
   * igual que el Ctrl+C de un solo objeto) — atajo Ctrl+A, pedido explícito
   * 2026-09-09. No cambia `selectedPage`: el usuario se queda viendo la
   * página en la que estaba mientras la selección abarca todo el resto. */
  selectAllDocument: () => void;
  reviewDocumentQuality: () => DocumentReview;
  getOptimizationSuggestions: () => OptimizationSuggestion[];
  applyOptimizationSuggestion: (args: { pageNumber: number; elementId: string; optimizedText: string }) => void;
  applyOptimizationBatch: (suggestions: OptimizationSuggestion[]) => { applied: number };
  optimizeDocumentWithAI: () => { optimizedBlocks: number; totalTextBlocks: number };
  setSnapEnabled: (enabled: boolean) => void;
  setGridEnabled: (enabled: boolean) => void;
  toggleSelection: (elementId: string, isMulti: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Se incrementa cada vez que el historial de Undo/Redo cambia (push, pop
   * o reset) -- bug real reportado 2026-09-10: `canUndo`/`canRedo` son
   * FUNCIONES que leen arrays fuera del store (`historyPast`/`historyFuture`,
   * ver más abajo), y un componente que solo se suscribe a `s.canUndo`/
   * `s.canRedo` (esas referencias de función NUNCA cambian, se asignan una
   * sola vez) no se vuelve a renderizar solo porque el CONTENIDO de esos
   * arrays cambió -- el botón "Deshacer"/"Rehacer" del ribbon podía quedar
   * mostrando habilitado (o deshabilitado) un paso desfasado de lo que de
   * verdad se podía deshacer/rehacer, hasta que ALGO MÁS forzara un
   * re-render. Este contador es la suscripción reactiva que faltaba —
   * RibbonToolbar.tsx se suscribe a él únicamente para eso, `canUndo()`/
   * `canRedo()` se siguen llamando igual en cualquier otro lugar. */
  historyVersion: number;
  /** Gate cliente-side de defensa en profundidad (ADR-018/079): true cuando
   * el informe cargado está `signed`/`archived`. El backend ya rechaza el
   * guardado (`409 report_immutable`) sin excepción de rol, pero hasta este
   * cambio el editor dejaba editar/deshacer localmente sin aviso -- ver
   * App.tsx, que sincroniza esto contra `workflowStatus`. No sustituye la
   * regla del servidor, la replica en el cliente para no dejarla como única
   * barrera. */
  documentLocked: boolean;
  setDocumentLocked: (locked: boolean) => void;
  /** Mueve uno o varios elementos (selección múltiple, ctrl+click) de una
   * página a otra al soltarlos encima de ella — `anchorId` es el elemento
   * que el usuario soltó literalmente ahí; el resto conserva su distancia
   * original en X/Y respecto al ancla (pedido explícito 2026-09-04: antes
   * solo cruzaba de página el elemento que recibía el evento de soltar,
   * dejando atrás al resto de la selección múltiple). Busca cada id en
   * CUALQUIER página (no asume que todos vengan de la misma). */
  moveElementsBetweenPages: (
    elementIds: string[],
    anchorId: string,
    toPageNum: number,
    newAnchorX: number,
    newAnchorY: number,
  ) => void;
  /** Aviso efímero (NO vive dentro de `doc`, no genera paso de Undo por sí
   * solo) de "acabo de crear/mover un bloque de continuación de texto en
   * esta página — ábrele el editor". Lo consume el `useEffect` de
   * PageCanvas.tsx keyed en este campo: como cada página es un componente
   * `PageCanvas` propio (ver MultipageView.tsx, todas montadas a la vez,
   * sin virtualización), es el único puente para que la página SIGUIENTE
   * tome el foco de edición cuando `splitOverflowingText` la crea. Ver
   * `splitOverflowingText` más abajo. */
  pendingTextContinuation: { pageNumber: number; elementId: string } | null;
  clearPendingTextContinuation: () => void;
  /** "Copiar formato" (pedido explícito 2026-08-27, como el pincel de
   * formato de Word): estilo EFECTIVO completo (negrita/cursiva/subrayado/
   * color/resaltado/fuente/tamaño/encabezado) copiado de una selección de
   * texto. Efímero (NO vive dentro de `doc`, no genera paso de Undo por sí
   * solo) — mientras no sea `null`, el "modo pintar" está armado: la
   * PRÓXIMA vez que el usuario termine de seleccionar texto en CUALQUIER
   * bloque (no solo el de origen — igual que en Word, funciona entre
   * bloques distintos), ese formato se aplica ahí y el modo se desarma
   * solo. Ver PageCanvas.tsx (maybeApplyFormatPainter). */
  copiedTextFormat: BaseTextStyle | null;
  setCopiedTextFormat: (format: BaseTextStyle | null) => void;
  /**
   * Auto-paginación de texto (pedido explícito 2026-08-27): mientras se
   * escribe, si un bloque de texto crecería más allá del margen inferior de
   * la hoja, en vez de mover el bloque ENTERO a la página siguiente (lo que
   * ya hace `reflowTextColumnAfterChange` al confirmar un cambio que no
   * entra), se PARTE en dos — la parte que cabe se queda donde está, el
   * resto continúa en un bloque nuevo al inicio de la hoja siguiente
   * (creándola si hace falta). El cálculo de DÓNDE cortar el texto (medida
   * de canvas, ajuste de línea) vive en PageCanvas.tsx/lib/textPagination.ts
   * — esta acción solo aplica el resultado ya calculado sobre `doc.pages`.
   * Reutiliza `reflowTextColumnAfterChange` para empujar hacia abajo
   * cualquier otro bloque que ya hubiera en la misma columna, tanto en la
   * página de origen (el bloque ahora mide menos) como en la de destino
   * (el bloque de continuación puede chocar con algo que ya estuviera ahí).
   */
  splitOverflowingText: (args: {
    pageNumber: number;
    elementId: string;
    fittingText: string;
    fittingSpans: TextStyleSpan[];
    fittingWidth: number;
    fittingHeight: number;
    overflowText: string;
    overflowSpans: TextStyleSpan[];
    overflowWidth: number;
    overflowHeight: number;
  }) => void;
  /**
   * Igual que `splitOverflowingText`, pero para pegar contenido que puede
   * desbordar VARIAS páginas de una sola vez (pegar un documento entero de
   * Word/Google Docs) en vez de un solo caracter tecleado. `splitOverflowingText`
   * corta una única vez porque al teclear el próximo desborde recién se
   * detecta si el usuario sigue escribiendo en el bloque de continuación;
   * un pegado no tiene ese "siguiente keystroke" para completar la
   * paginación, así que esta acción recibe TODOS los trozos ya calculados
   * (ver PageCanvas.tsx) y crea tantas páginas de continuación como haga
   * falta en una sola actualización atómica. `chunks[0]` reemplaza el
   * bloque de origen in-place; cada trozo siguiente es un bloque de
   * continuación nuevo al tope de la página siguiente (empujando hacia
   * abajo cualquier contenido que ya hubiera ahí, igual que
   * `splitOverflowingText`).
   */
  pasteTextAcrossPages: (args: {
    pageNumber: number;
    elementId: string;
    chunks: { text: string; spans: TextStyleSpan[]; width: number; height: number }[];
  }) => void;
  /**
   * Auto-paginación de TABLAS — mismo principio que `splitOverflowingText`
   * pero partiendo filas en vez de líneas de texto: cuando las filas ya no
   * caben en lo que resta de la página, `elementId` se queda solo con las
   * que sí entran y el resto continúa en una tabla NUEVA al inicio de la
   * página siguiente (creándola si hace falta), con el MISMO estilo (borde,
   * colores, tipografía, franjas, anchos de columna...) y repitiendo la fila
   * de encabezado si `hasHeader` está activo — igual que una tabla larga en
   * Word. Cuántas filas caben (medida real del DOM) lo calcula
   * TableBlock.tsx; esta acción solo aplica el resultado ya calculado.
   */
  splitOverflowingTable: (args: {
    pageNumber: number;
    elementId: string;
    fittingRowCount: number;
    fittingHeightPx: number;
    overflowHeightPx: number;
  }) => void;
}

type EditorHistorySnapshot = {
  doc: ReportDocument;
  selectedPage: number;
  selectedElementId: string | undefined;
  selectedElementIds: string[];
};

const historyPast: EditorHistorySnapshot[] = [];
const historyFuture: EditorHistorySnapshot[] = [];

const HISTORY_LIMIT = 100;

// Evita que Undo/Redo genere por sí mismo una nueva entrada
// en el historial.
let applyingHistory = false;

/** Ventana de agrupación (ms): cambios seguidos del documento que ocurren
 * más rápido que esto entre sí se tratan como UNA sola acción de Undo, en
 * vez de una entrada por cada `set()` del store. Bug real reportado
 * 2026-09-10 ("no se si es al agregar una tabla y editar"): editar una
 * celda de tabla confirma al store en CADA pulsación (`TableBlock.tsx`,
 * `persistCell`/`onInput`, sin el debounce local que sí tiene el editor de
 * texto de bloques -- ver `liveEditCommitTimerRef` en PageCanvas.tsx), así
 * que sin agrupar aquí, escribir una sola palabra en una celda generaba
 * una letra = un paso de Undo: además de sentirse "roto" (Ctrl+Z solo
 * borraba un carácter a la vez), con HISTORY_LIMIT=100 unas pocas frases
 * ya empujaban fuera del historial cualquier acción real anterior (mover
 * un bloque, insertar una imagen...). Agrupar por tiempo aquí (en vez de
 * replicar a mano el mismo debounce en cada sitio que toca el store, como
 * ya hace el texto) arregla esto de raíz para CUALQUIER edición rápida y
 * repetida -- tablas, pero también escribir en cualquier futuro campo que
 * confirme por tecla -- sin tocar cada punto de llamada. */
const HISTORY_COALESCE_WINDOW_MS = 600;

/** Momento (Date.now()) del último cambio de `doc` agrupado en el historial
 * -- 0 fuerza que el PRÓXIMO cambio siempre abra una entrada nueva (recién
 * arrancada la app, o justo después de resetEditorHistory()/undo()/redo(),
 * ver más abajo). */
let lastHistoryChangeAt = 0;

const cloneHistorySnapshot = (
  snapshot: EditorHistorySnapshot,
): EditorHistorySnapshot => ({
  doc: JSON.parse(JSON.stringify(snapshot.doc)),
  selectedPage: snapshot.selectedPage,
  selectedElementId: snapshot.selectedElementId,
  selectedElementIds: [...snapshot.selectedElementIds],
});

/** Vacía el historial de Undo/Redo -- se usa al REEMPLAZAR el documento
 * entero (nuevo informe, abrir uno existente, restaurar un borrador
 * offline, aplicar una plantilla) en vez de editarlo. Bug real reportado
 * 2026-09-10: sin esto, `historyPast` seguía acumulando snapshots del
 * informe ANTERIOR -- Ctrl+Z después de abrir un informe distinto podía
 * saltar de vuelta al contenido del informe que se tenía abierto antes,
 * en vez de no hacer nada (no hay nada que deshacer en un documento recién
 * cargado). `lastHistoryChangeAt` también se resetea para que la primera
 * edición del documento nuevo nunca se agrupe (ver `pushHistoryEntry` más
 * abajo) con la última edición del documento anterior. */
const resetEditorHistory = () => {
  historyPast.length = 0;
  historyFuture.length = 0;
  lastHistoryChangeAt = 0;
  // Reactiva el botón Deshacer/Rehacer del ribbon -- ver el comentario de
  // `historyVersion` en la interfaz de arriba.
  useEditorStore.setState((state) => ({ historyVersion: state.historyVersion + 1 }));
};

/**
 * Redistribuye las filas de una tabla partida entre páginas (mismo
 * `linkedGroupId`, ver `splitOverflowingTable`) cuando el usuario mueve a
 * mano el fragmento que arrastró -- pedido explícito 2026-09-10: "si yo
 * hago ese espacio como usuario de manera manual... las filas que se
 * fueron abajo vayan cupiendo en el espacio libre nuevo que queda en la
 * otra hoja". En vez de intentar predecir a ciegas cuántas filas entran
 * (exigiría replicar la medición real de texto que solo el DOM sabe hacer,
 * ver el comentario de `computeAdaptiveTableFit` en tableClipboard.ts),
 * fusiona TODAS las filas de TODOS los fragmentos del grupo en el
 * fragmento que el usuario acaba de mover (a su nueva posición) y elimina
 * a los demás -- la tabla resultante, quepa entera o siga sobrando
 * contenido, dispara sola el mecanismo de desborde YA existente
 * (`onOverflowRows` en TableBlock.tsx -> `splitOverflowingTable`) en el
 * siguiente render real, que mide con precisión real de DOM y vuelve a
 * partir (reutilizando el mismo `linkedGroupId`, ver ahí) si todavía no
 * entra completa -- en cascada, tantas veces como haga falta, sin
 * duplicar ninguna lógica nueva de medición.
 *
 * Título/leyenda y el resto de props de estilo (ancho de columnas, fuente,
 * formato condicional...) se toman del PRIMER fragmento (por página), no
 * del que se movió -- una continuación siempre los trae vacíos/limpiados a
 * propósito (`title`/`caption`, ver `splitOverflowingTable`), así que
 * tomarlos del fragmento movido los perdería si el usuario mueve
 * justamente una continuación en vez del origen.
 *
 * Alcance deliberado: solo reacciona al arrastre/reposición DIRECTO del
 * propio elemento (ver el único call site en `updateElement`, un cambio
 * vertical explícito) -- un empuje en cascada por
 * `pushDownContentAfterChange` (otro bloque crece y empuja esta tabla
 * hacia abajo) no pasa por acá, queda fuera de alcance a propósito.
 */
function reflowLinkedTableFragments(
  sourcePages: ReportPage[],
  meta: DocumentMeta,
  triggerElementId: string,
): ReportPage[] {
  let triggerPageNumber: number | undefined;
  let triggerElement: ReportElement | undefined;
  sourcePages.forEach((page) => {
    const found = page.elements.find((element) => element.id === triggerElementId);
    if (found) {
      triggerPageNumber = page.page_number;
      triggerElement = found;
    }
  });
  if (!triggerElement || triggerElement.type !== 'table' || !triggerElement.linkedGroupId || triggerPageNumber === undefined) {
    return sourcePages;
  }
  const linkedGroupId = triggerElement.linkedGroupId;

  const fragments: { pageNumber: number; element: ReportElement }[] = [];
  sourcePages.forEach((page) => {
    page.elements.forEach((element) => {
      if (element.linkedGroupId === linkedGroupId) fragments.push({ pageNumber: page.page_number, element });
    });
  });
  if (fragments.length < 2) return sourcePages; // nada que fusionar
  fragments.sort((a, b) => a.pageNumber - b.pageNumber || a.element.y - b.element.y);

  const firstFragment = fragments[0];
  const baseProps = firstFragment.element.props || {};
  const hasHeader = baseProps.hasHeader !== false;

  let mergedRows: any[] = [];
  let mergedCellBackgrounds: any[] = [];
  let mergedRowBackgrounds: any[] = [];
  let mergedRowHeights: any[] = [];
  let mergedCellAligns: any[] = [];
  const mergedMergedCells: TableMergedCellRef[] = [];
  let rowOffset = 0;

  fragments.forEach((fragment, index) => {
    const props = fragment.element.props || {};
    // La cabecera se repite en TODA continuación (ver `splitOverflowingTable`,
    // paso 2) -- se descarta acá para no duplicarla al reconstruir la tabla
    // completa; el primer fragmento conserva su propia fila 0 tal cual.
    const dropHeader = index > 0 && hasHeader ? 1 : 0;
    const rows: any[] = Array.isArray(props.rows) ? props.rows : [];
    const cellBackgrounds: any[] = Array.isArray(props.cellBackgrounds) ? props.cellBackgrounds : [];
    const rowBackgrounds: any[] = Array.isArray(props.rowBackgrounds) ? props.rowBackgrounds : [];
    const rowHeights: any[] = Array.isArray(props.rowHeights) ? props.rowHeights : [];
    const cellAligns: any[] = Array.isArray(props.cellAligns) ? props.cellAligns : [];
    const mergedCells: TableMergedCellRef[] = Array.isArray(props.mergedCells) ? props.mergedCells : [];

    mergedRows = mergedRows.concat(rows.slice(dropHeader));
    mergedCellBackgrounds = mergedCellBackgrounds.concat(cellBackgrounds.slice(dropHeader));
    mergedRowBackgrounds = mergedRowBackgrounds.concat(rowBackgrounds.slice(dropHeader));
    mergedRowHeights = mergedRowHeights.concat(rowHeights.slice(dropHeader));
    mergedCellAligns = mergedCellAligns.concat(cellAligns.slice(dropHeader));

    mergedCells.forEach((cell) => {
      if (cell.row < dropHeader) return; // fusión de la cabecera duplicada -- ya la trae el primer fragmento
      mergedMergedCells.push({ ...cell, row: cell.row - dropHeader + rowOffset });
    });

    rowOffset += rows.length - dropHeader;
  });

  const mergedElement: ReportElement = {
    ...triggerElement,
    props: {
      ...baseProps,
      rows: mergedRows,
      cellBackgrounds: mergedCellBackgrounds,
      rowBackgrounds: mergedRowBackgrounds,
      rowHeights: mergedRowHeights,
      cellAligns: mergedCellAligns,
      mergedCells: mergedMergedCells,
    },
  };

  return sourcePages.map((page) => {
    const withoutSiblings = page.elements.filter(
      (element) => element.linkedGroupId !== linkedGroupId || element.id === triggerElementId,
    );
    if (page.page_number !== triggerPageNumber) {
      return withoutSiblings.length === page.elements.length ? page : { ...page, elements: withoutSiblings };
    }
    return {
      ...page,
      elements: withoutSiblings.map((element) => (element.id === triggerElementId ? mergedElement : element)),
    };
  });
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  doc: {
    // Bug real reportado (2026-09-08): este id era un literal ESTÁTICO,
    // igual en CADA carga de página (a diferencia de createNewDocument(),
    // unas líneas más abajo, que sí genera uno único por documento). Un
    // borrador guardado offline bajo este id nunca coincidía con nada
    // guardado en el servidor, así que quedaba "huérfano" -- pero al
    // recargar la página (p.ej. tras cerrar la pestaña), el documento en
    // blanco que arranca de nuevo usaba EXACTAMENTE el mismo id, y
    // ReportsAdminModal.tsx excluye de "Documentos sin conexión" cualquier
    // borrador cuyo id coincida con el documento actualmente abierto (para
    // no ofrecer "recuperar" lo que ya se está viendo) -- el borrador real
    // quedaba invisible en el lienzo (reseteado a blanco) Y en la lista de
    // recuperación (excluido por coincidencia de id), aunque los datos
    // seguían intactos en SQLite. Con un id único también acá, cada carga
    // de página arranca con su propio id y nunca vuelve a chocar así con
    // un borrador previo sin sincronizar.
    document_id: `rep_${Date.now()}`,
    pages: [initialPage],
    meta: {
      author: 'AGM Solutions',
      version: 1,
      updatedAt: new Date().toISOString(),
      layoutMode: 'document',
      marginLeft: 36,
      marginRight: 36,
      marginTop: 36,
      marginBottom: 36,
    },
  },
  selectedPage: 1,
  selectedElementIds: [],
  hoveredCommentId: undefined,
  selectedElementId: undefined,
  pendingTextContinuation: null,
  clearPendingTextContinuation: () => set({ pendingTextContinuation: null }),
  copiedTextFormat: null,
  setCopiedTextFormat: (format) => set({ copiedTextFormat: format }),
  undo: () => {},
  redo: () => {},
  canUndo: () => false,
  canRedo: () => false,
  historyVersion: 0,
  documentLocked: false,
  setDocumentLocked: (locked) => set({ documentLocked: locked }),
  gridEnabled: true,
  snapEnabled: true,
  // Identificadores del informe actualmente cargado en el editor
  currentReportId: null,
  currentReportTitle: 'Informe sin título',
  currentReportVersionNumber: null,
  setCurrentReportId: (id) => set({ currentReportId: id }),
  setCurrentReportTitle: (title) => set({ currentReportTitle: title }),
  setCurrentReportVersionNumber: (version) => set({ currentReportVersionNumber: version }),
  createNewDocument: (author) => {
    // Se crea una página NUEVA en cada ejecución: reutilizar `initialPage`
    // compartiría las referencias de sus elementos entre documentos.
    set({
      doc: {
        document_id: `rep_${Date.now()}`,
        pages: [createInitialPage()],
        meta: {
          author: author || 'AGM Solutions',
          version: 1,
          updatedAt: new Date().toISOString(),
          layoutMode: 'document',
          marginLeft: 36,
          marginRight: 36,
          marginTop: 36,
          marginBottom: 36,
        },
      },
      selectedPage: 1,
      selectedElementId: undefined,
      selectedElementIds: [],
      hoveredCommentId: undefined,
      clipboardElement: null,
      clipboardElements: null,
      pendingImportBlocks: null,
      currentReportId: null,
      currentReportTitle: 'Informe sin título',
      currentReportVersionNumber: null,
    });
    // El documento se REEMPLAZA entero, no se edita -- el historial de
    // Undo/Redo del informe anterior ya no aplica (ver resetEditorHistory).
    resetEditorHistory();
  },
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
        // Una página de carátula a toda hoja no lleva encabezado/pie (ver
        // addElement('cover') más abajo) — no hay que backfillearlos aquí.
        const hasCover = page.elements.some((el) => el.type === 'cover');
        if (hasCover || page.fixedLayout) return page;
        const hasHeader = page.elements.some((el) => el.type === 'header');
        const hasFooter = page.elements.some((el) => el.type === 'footer');
        if (hasHeader && hasFooter) return page;
        const [header, footer] = createHeaderFooterPair(page.page_number, m, layoutMode);
        const missing = [...(hasHeader ? [] : [header]), ...(hasFooter ? [] : [footer])];
        return { ...page, elements: [...missing, ...page.elements] };
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
      // Mismo motivo que en createNewDocument: es OTRO documento, no una
      // edición del que se tenía abierto -- sin esto, Ctrl+Z después de
      // abrir/restaurar un informe distinto podía saltar de vuelta al
      // contenido del informe anterior (bug real reportado 2026-09-10).
      resetEditorHistory();
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
  // Bug real reportado 2026-09-04: cambiar a PPT (16:9, PAGE_HEIGHT=540 en
  // ese momento -- hoy 720, ver reportLayoutMetrics.ts) dejaba el pie de
  // página en su Y vieja de documento A4 (~1102, cerca del
  // fondo de una hoja de 1123px) -- invisible dentro del Stage de Konva
  // (que sí se redimensiona bien al alto de presentación), pero como el pie se pinta con un
  // <Html> real (portal DOM, no recortado por el Stage), esa Y vieja seguía
  // extendiendo el DOM real muy por debajo de la diapositiva visible,
  // inflando el alto real de .page-scroll y generando un scroll enorme de
  // espacio gris vacío. Antes esta acción solo tocaba `meta.layoutMode`, sin
  // recalcular encabezado/pie/carátula -- ahora reutiliza `applyPageSetup`
  // (el mismo camino que ya usan los cambios de tamaño/orientación) para
  // que encabezado/pie/carátula siempre encajen en las métricas vigentes.
  setLayoutMode: (layoutMode) =>
    set((state) => applyPageSetup(state, { layoutMode: layoutMode === 'presentation' ? 'presentation' : 'document' })),
  setPaperSize: (paperSize) => set((state) => applyPageSetup(state, { paperSize })),
  setOrientation: (orientation) => set((state) => applyPageSetup(state, { orientation })),
  setHorizontalMargins: (left, right) => set((state) => {
    const metrics = metricsFromMeta(state.doc.meta);
    const minMargin = 6;
    const maxTotal = metrics.PAGE_WIDTH - minMargin * 2;
    const safeLeft = Math.max(minMargin, Math.min(Number(left) || minMargin, maxTotal - minMargin));
    const safeRight = Math.max(minMargin, Math.min(Number(right) || minMargin, maxTotal - safeLeft));
    const meta: DocumentMeta = {
      ...state.doc.meta,
      marginLeft: safeLeft,
      marginRight: safeRight,
      version: state.doc.meta.version + 1,
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: {
        ...state.doc,
        pages: applyDocumentMargins(state, meta),
        meta,
      },
    };
  }),
  setPageMargins: (margins) => set((state) => {
    const metrics = metricsFromMeta(state.doc.meta);
    const minMargin = 6;
    const maxHorizontalTotal = metrics.PAGE_WIDTH - minMargin * 2;
    const maxVerticalTotal = metrics.PAGE_HEIGHT - minMargin * 2;
    const safeLeft = Math.max(minMargin, Math.min(Number(margins.left) || minMargin, maxHorizontalTotal - minMargin));
    const safeRight = Math.max(minMargin, Math.min(Number(margins.right) || minMargin, maxHorizontalTotal - safeLeft));
    const safeTop = Math.max(minMargin, Math.min(Number(margins.top) || minMargin, maxVerticalTotal - minMargin));
    const safeBottom = Math.max(minMargin, Math.min(Number(margins.bottom) || minMargin, maxVerticalTotal - safeTop));
    const meta: DocumentMeta = {
      ...state.doc.meta,
      marginLeft: safeLeft,
      marginRight: safeRight,
      marginTop: safeTop,
      marginBottom: safeBottom,
      version: state.doc.meta.version + 1,
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: {
        ...state.doc,
        pages: applyDocumentMargins(state, meta),
        meta,
      },
    };
  }),
  applyGlobalTextFormat: (format) => set((state) => {
    const normalized: GlobalTextFormat = {};
    if (format.fontFamily) normalized.fontFamily = String(format.fontFamily);
    if (format.fontSize != null) normalized.fontSize = Math.max(7, Math.min(Number(format.fontSize) || 14, 200));
    if (format.fontColor) normalized.fontColor = String(format.fontColor);
    if (format.textAlign) normalized.textAlign = format.textAlign;
    if (format.lineHeight != null) normalized.lineHeight = Math.max(0.8, Math.min(Number(format.lineHeight) || 1.35, 4));
    if (format.indentLeft != null) normalized.indentLeft = Math.max(0, Number(format.indentLeft) || 0);
    if (format.indentRight != null) normalized.indentRight = Math.max(0, Number(format.indentRight) || 0);
    if (format.specialIndent) normalized.specialIndent = format.specialIndent;
    if (format.specialIndentBy != null) normalized.specialIndentBy = Math.max(0, Number(format.specialIndentBy) || 0);
    if (format.spacingBefore != null) normalized.spacingBefore = Math.max(0, Number(format.spacingBefore) || 0);
    if (format.spacingAfter != null) normalized.spacingAfter = Math.max(0, Number(format.spacingAfter) || 0);

    // Fuente/tamaño/color son las únicas tres propiedades de "Fuente global"
    // que también deben alcanzar el texto DENTRO de las tablas (pedido
    // explícito) -- alineación/interlineado/sangría/espaciado son de
    // párrafo y no aplican a celdas. `headerBg`/`headerTextColor`/bordes/
    // franjas de la tabla NO se tocan: son estilo de tabla, intencional,
    // no tipografía general del documento.
    const tableFontChange: Record<string, unknown> = {
      ...(normalized.fontFamily ? { fontFamily: normalized.fontFamily } : {}),
      ...(normalized.fontSize != null ? { fontSize: normalized.fontSize } : {}),
      ...(normalized.fontColor ? { textColor: normalized.fontColor } : {}),
    };

    const pages = state.doc.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) => {
        if (element.type === 'table') {
          if (Object.keys(tableFontChange).length === 0) return element;
          return { ...element, props: applyTableFontPatch(element.props || {}, tableFontChange) };
        }

        if (element.type !== 'text') return element;

        // Los spans representan formato aplicado solo a una selección de
        // palabras. Si se les deja su fuente/color/tamaño previo, ganan al
        // estilo base y el documento no quedaría realmente uniforme -- pero
        // OJO: la forma correcta de "ganarle" es QUITAR la clave del span
        // (para que vuelva a heredar de la base, que es la que se acaba de
        // actualizar), NUNCA fijar el valor nuevo explícito en el span.
        // Bug real reportado: fijarlo explícito lograba el efecto visual
        // inmediato pero dejaba ese rango "clavado" para siempre -- CUALQUIER
        // cambio posterior de tamaño/fuente/color a nivel de bloque entero
        // (p.ej. el selector de tamaño del ribbon, que solo toca la base)
        // dejaba de tener efecto en cualquier texto que tuviera un span
        // encima (negrita, cursiva, un estilo de encabezado...), que es casi
        // cualquier título. Negrita/cursiva/subrayado/resaltado/estilo de
        // encabezado no se tocan.
        const keysToInherit = [
          ...(normalized.fontFamily ? ['fontFamily'] : []),
          ...(normalized.fontSize != null ? ['fontSize'] : []),
          ...(normalized.fontColor ? ['color'] : []),
        ] as const;
        const spans = Array.isArray(element.props?.spans) && keysToInherit.length > 0
          ? element.props.spans.map((span: Record<string, unknown>) => {
              const next = { ...span };
              keysToInherit.forEach((key) => { delete next[key]; });
              return next;
            })
          : element.props?.spans;

        return {
          ...element,
          props: { ...(element.props || {}), ...normalized, ...(spans ? { spans } : {}) },
        };
      }),
    }));
    return {
      doc: {
        ...state.doc,
        pages,
        meta: { ...state.doc.meta, globalTextFormat: { ...(state.doc.meta.globalTextFormat || {}), ...normalized }, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
    };
  }),
  addComment: ({ pageNumber, elementId, author, authorId }) => set((state) => {
    const page = state.doc.pages.find((item) => item.page_number === pageNumber);
    const target = elementId ? page?.elements.find((element) => element.id === elementId) : undefined;
    const comment: ReportComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageNumber,
      elementId,
      author: author || 'Usuario',
      authorId,
      text: '',
      createdAt: new Date().toISOString(),
      // Sin selección: al inicio del documento. Con selección: queda
      // ordenado alrededor de la altura del objeto, como los globos de Word.
      anchorY: target?.y ?? 0,
    };
    const comments = [...((state.doc.meta.comments as ReportComment[] | undefined) || []), comment];
    return {
      doc: {
        ...state.doc,
        meta: { ...state.doc.meta, comments, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
    };
  }),
  updateComment: (commentId, text) => set((state) => {
    const comments = (((state.doc.meta.comments as ReportComment[] | undefined) || [])).map((comment) => (
      comment.id === commentId ? { ...comment, text } : comment
    ));
    return {
      doc: {
        ...state.doc,
        meta: { ...state.doc.meta, comments, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
    };
  }),
  deleteComment: (commentId) => set((state) => {
    const comments = (((state.doc.meta.comments as ReportComment[] | undefined) || [])).filter((comment) => comment.id !== commentId);
    return {
      doc: {
        ...state.doc,
        meta: { ...state.doc.meta, comments, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
    };
  }),
  setHoveredCommentId: (commentId) => set({ hoveredCommentId: commentId }),
  setPagePaperSetup: (pageNumber, patch, scope) =>
    set((state) => applyPagePaperSetup(state, pageNumber, patch, scope)),
  setPageTransition: (pageNumber, transition) =>
    set((state) => ({
      doc: {
        ...state.doc,
        pages: state.doc.pages.map((page) => (page.page_number === pageNumber ? { ...page, transition } : page)),
        meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
    })),
  setPagePlainTextMode: (pageNumber, enabled) =>
    set((state) => {
      const pageIndex = state.doc.pages.findIndex((p) => p.page_number === pageNumber);
      if (pageIndex < 0) return state;
      const page = state.doc.pages[pageIndex];

      if (!enabled) {
        // No borra el elemento -- solo deja de tratarlo como especial (ver
        // comentario en ReportPage.plainTextElementId).
        if (!page.plainTextElementId) return state;
        const pages = [...state.doc.pages];
        pages[pageIndex] = { ...page, plainTextElementId: undefined };
        return {
          doc: {
            ...state.doc,
            pages,
            meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
          },
        };
      }

      // Ya activo con un elemento que sigue existiendo -- no crear otro.
      if (page.plainTextElementId && page.elements.some((el) => el.id === page.plainTextElementId)) {
        return state;
      }

      const m = metricsForPage(page, state.doc.meta);
      // Detrás de TODO lo demás (mínimo existente menos 1) -- pedido
      // explícito: un bloque de texto insertado ENCIMA después debe quedar
      // visualmente por delante, con su comportamiento normal intacto.
      const minZ = Math.min(0, ...page.elements.map((el) => el.zIndex ?? 0));
      const newElement: ReportElement = {
        id: `text-${pageNumber}-${Date.now()}-pagetext`,
        type: 'text',
        x: m.CONTENT_LEFT,
        y: m.CONTENT_TOP,
        width: m.CONTENT_RIGHT - m.CONTENT_LEFT,
        height: m.CONTENT_BOTTOM - m.CONTENT_TOP,
        zIndex: minZ - 1,
        locked: false,
        props: defaultPropsByType('text'),
        border: defaultBorderByType('text'),
      };
      const pages = [...state.doc.pages];
      pages[pageIndex] = {
        ...page,
        elements: [...page.elements, newElement],
        plainTextElementId: newElement.id,
      };
      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: pageNumber,
        selectedElementId: newElement.id,
        selectedElementIds: [newElement.id],
      };
    }),
  applySlideLayout: (layoutId) => set((state) => {
    const layout = findSlideLayout(layoutId);
    const pageIndex = state.doc.pages.findIndex((p) => p.page_number === state.selectedPage);
    if (!layout || pageIndex < 0) return state;

    const meta = state.doc.meta;
    const layoutModeStr = meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
    const specs = buildSlideLayoutDeckSpecs(layout);
    const deckSize = specs.length;
    const startPageNumber = state.selectedPage;

    // Igual que insertPageAt, generalizado a insertar (deckSize - 1) hojas
    // vacías de una sola vez en vez de una por una -- todo en un solo
    // set() atómico (llamar la acción insertPageAt varias veces desde
    // ACÁ ADENTRO competiría con este mismo reducer en vez de sumarse).
    let pages = state.doc.pages.map((p) => ({ ...p, elements: [...p.elements] }));
    const blankPages = Array.from({ length: deckSize - 1 }, () => ({ page_number: -1, elements: [] as ReportElement[] }));
    pages.splice(pageIndex + 1, 0, ...blankPages);
    pages = pages.map((p, i) => ({ ...p, page_number: i + 1 }));

    const insertedCount = deckSize - 1;
    const comments = ((meta.comments as ReportComment[] | undefined) || []).map((c) => (
      c.pageNumber > startPageNumber ? { ...c, pageNumber: c.pageNumber + insertedCount } : c
    ));

    for (let i = 0; i < deckSize; i += 1) {
      const idx = pageIndex + i;
      const pn = pages[idx].page_number;
      const spec = specs[i];
      const m = metricsForPage(pages[idx], meta);
      // Header/pie: se crean recién para las hojas nuevas (i>0) y se
      // conservan de la hoja original para i=0 -- en ambos casos el
      // llamador decide si el diseño de ESTA diapositiva los conserva
      // (`spec.layout.keepChrome`) o no (diseños "a sangre").
      const existingChrome = i === 0 ? pages[idx].elements.filter((el) => el.type === 'header' || el.type === 'footer') : [];
      const freshChrome = i === 0 ? existingChrome : createHeaderFooterPair(pn, m, layoutModeStr);
      const keepChrome = spec.layout.keepChrome !== false;
      const chrome = keepChrome ? freshChrome : [];
      const content = buildSlideLayoutElements(spec.layout, m, pn, spec.overrides);
      pages[idx] = { ...pages[idx], elements: [...chrome, ...content] };
    }

    return {
      doc: {
        ...state.doc,
        pages,
        meta: { ...meta, comments, version: meta.version + 1, updatedAt: new Date().toISOString() },
      },
      selectedElementIds: [],
    };
  }),
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
  insertPageAt: (referencePageNumber, position) =>
    set((state) => {
      const refIndex = state.doc.pages.findIndex((page) => page.page_number === referencePageNumber);
      if (refIndex < 0) return state;
      const insertIndex = position === 'before' ? refIndex : refIndex + 1;
      const layoutMode = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const m = metricsFromMeta(state.doc.meta);

      const pages = [...state.doc.pages];
      pages.splice(insertIndex, 0, { page_number: -1, elements: [] });
      const normalized = pages.map((page, index) => ({ ...page, page_number: index + 1 }));
      const newPageNumber = insertIndex + 1;
      normalized[insertIndex] = {
        ...normalized[insertIndex],
        elements: createHeaderFooterPair(newPageNumber, m, layoutMode),
      };

      // Comentarios anclados a páginas que quedaron después del punto de
      // inserción corren +1 junto con esas páginas (mismo criterio que
      // `removePage`, en sentido inverso).
      const comments = ((state.doc.meta.comments as ReportComment[] | undefined) || []).map((comment) => (
        comment.pageNumber >= newPageNumber ? { ...comment, pageNumber: comment.pageNumber + 1 } : comment
      ));

      return {
        doc: {
          ...state.doc,
          pages: normalized,
          meta: { ...state.doc.meta, comments, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: newPageNumber,
      };
    }),
  removePage: (pageNumber) =>
    set((state) => {
      const removedIndex = state.doc.pages.findIndex((page) => page.page_number === pageNumber);
      // Un documento necesita conservar una superficie de trabajo; por eso
      // la última hoja no puede eliminarse desde ninguna vía del store.
      if (removedIndex < 0 || state.doc.pages.length <= 1) return state;

      const pages = state.doc.pages
        .filter((page) => page.page_number !== pageNumber)
        .map((page, index) => ({ ...page, page_number: index + 1 }));
      const comments = ((state.doc.meta.comments as ReportComment[] | undefined) || [])
        .filter((comment) => comment.pageNumber !== pageNumber)
        .map((comment) => ({
          ...comment,
          pageNumber: comment.pageNumber > pageNumber ? comment.pageNumber - 1 : comment.pageNumber,
        }));
      const selectedPage = state.selectedPage === pageNumber
        ? pages[Math.min(removedIndex, pages.length - 1)].page_number
        : state.selectedPage > pageNumber
          ? state.selectedPage - 1
          : state.selectedPage;

      return {
        doc: {
          ...state.doc,
          pages,
          meta: {
            ...state.doc.meta,
            comments,
            version: state.doc.meta.version + 1,
            updatedAt: new Date().toISOString(),
          },
        },
        selectedPage,
        selectedElementId: undefined,
        selectedElementIds: [],
        hoveredCommentId: undefined,
      };
    }),
  // Pedido explícito 2026-09-08: la copia debe quedar JUSTO DESPUÉS de la
  // original (no al final del documento, como antes) y con las MISMAS
  // posiciones -- antes desplazaba cada elemento +20/+20px, un resabio sin
  // sentido acá (a diferencia de pegar un objeto en la MISMA hoja, la copia
  // vive en su propia hoja nueva, nada se solapa con el original). Mismo
  // patrón de inserción/renumerado que insertPageAt.
  duplicatePage: (pageNumber) =>
    set((state) => {
      const srcIndex = state.doc.pages.findIndex((p) => p.page_number === pageNumber);
      if (srcIndex < 0) {
        return state;
      }
      const srcPage = state.doc.pages[srcIndex];
      const insertIndex = srcIndex + 1;
      const stamp = Date.now();

      const pages = [...state.doc.pages];
      pages.splice(insertIndex, 0, {
        page_number: -1,
        paperSize: srcPage.paperSize,
        orientation: srcPage.orientation,
        transition: srcPage.transition,
        elements: srcPage.elements.map((element, index) => ({
          ...JSON.parse(JSON.stringify(element)),
          id: `${element.id}-copy-${stamp}-${index}`,
        })),
      });
      const normalized = pages.map((page, index) => ({ ...page, page_number: index + 1 }));
      const newPageNumber = insertIndex + 1;

      const comments = ((state.doc.meta.comments as ReportComment[] | undefined) || []).map((comment) => (
        comment.pageNumber >= newPageNumber ? { ...comment, pageNumber: comment.pageNumber + 1 } : comment
      ));

      return {
        doc: {
          ...state.doc,
          pages: normalized,
          meta: { ...state.doc.meta, comments, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: newPageNumber,
        selectedElementId: undefined,
        selectedElementIds: [],
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

      // Mapa página vieja -> página nueva (construido ANTES de renumerar, los
      // `page_number` de `pages` todavía son los originales acá) -- sin esto
      // los comentarios anclados a página y `selectedPage` quedaban apuntando
      // al número viejo, que tras el reordenamiento pasa a ser OTRA página
      // (p.ej. el borde azul de "diapositiva activa" saltaba a la miniatura
      // equivocada después de arrastrar una distinta). Mismo criterio que
      // insertPageAt/removePage, que sí remapean comentarios.
      const oldToNew = new Map<number, number>();
      pages.forEach((page, index) => oldToNew.set(page.page_number, index + 1));
      const normalized = pages.map((page, index) => ({ ...page, page_number: index + 1 }));
      const comments = ((state.doc.meta.comments as ReportComment[] | undefined) || []).map((comment) => {
        const nextPageNumber = oldToNew.get(comment.pageNumber);
        return nextPageNumber != null ? { ...comment, pageNumber: nextPageNumber } : comment;
      });
      const selectedPage = oldToNew.get(state.selectedPage) ?? state.selectedPage;

      return {
        doc: {
          ...state.doc,
          pages: normalized,
          meta: { ...state.doc.meta, comments, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage,
      };
    }),
  selectPage: (pageNumber) =>
    set((state) =>
      state.selectedPage === pageNumber
        ? { selectedPage: pageNumber }
        : {
            selectedPage: pageNumber,
            selectedElementId: undefined,
            selectedElementIds: [],
          },
  ),
  addElement: (type, patch = {}) =>
    set((state) => {
      if (state.documentLocked) {
        log.warn('[EDITOR_LOCK] Insertar bloqueo -- el informe cargado está firmado/archivado.');
        return state;
      }
      const m = metricsFromMeta(state.doc.meta);
      const pages = [...state.doc.pages];
      const explicitPageNumber = typeof patch.pageNumber === 'number' && Number.isFinite(patch.pageNumber)
        ? Math.max(1, Math.floor(patch.pageNumber))
        : null;
      if (explicitPageNumber !== null) {
        const layoutModeForNewPage = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
        while (!pages.some((page) => page.page_number === explicitPageNumber) && pages.length < explicitPageNumber) {
          const nextPageNumber = pages.length + 1;
          pages.push({ page_number: nextPageNumber, elements: createHeaderFooterPair(nextPageNumber, m, layoutModeForNewPage) });
        }
      }
      const selectedIndex = pages.findIndex((page) => page.page_number === (explicitPageNumber ?? state.selectedPage));
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;

      const hasExplicitPosition =
        typeof patch.x === 'number' && Number.isFinite(patch.x) &&
        typeof patch.y === 'number' && Number.isFinite(patch.y);

      // `pageMetrics` es un parámetro (no cierra sobre `m` del ámbito
      // externo) para poder reutilizar esta misma función al revisar OTRAS
      // páginas del documento (ver el escaneo de páginas existentes más
      // abajo) -- cada página puede tener su propio tamaño/orientación
      // (`resolvePagePaperSetup`), así que medir su espacio disponible con
      // las métricas de una página distinta daría un resultado incorrecto.
      const placeElementInPage = (
        page: ReportPage,
        element: ReportElement,
        pageMetrics: ReturnType<typeof metricsFromMeta>,
      ) => {
        // Posición explícita (p.ej. desde un drop o una API que ya decidió
        // dónde va): respetarla tal cual, solo sujetada a los límites de la
        // hoja. El solape con bloques existentes es VÁLIDO — el ajuste de
        // texto (wrapMode) decide cómo convive el texto con el objeto.
        if (hasExplicitPosition) {
          const clampedX = Math.min(Math.max(element.x, 0), Math.max(0, pageMetrics.PAGE_WIDTH - element.width));
          const clampedY = Math.min(Math.max(element.y, 0), Math.max(0, pageMetrics.PAGE_HEIGHT - element.height));
          return { fits: true, element: { ...element, x: clampedX, y: clampedY } };
        }

        // Encabezado/pie/carátula son elementos fijos de plataforma
        // (ADR-046) anclados fuera del área de contenido — no deben contar
        // para el flujo de auto-colocación, o cada página nueva empezaría a
        // apilar contenido a la altura del pie de página en vez de justo
        // debajo del encabezado.
        const contentElements = page.elements.filter(
          (el) => el.type !== 'header' && el.type !== 'footer' && el.type !== 'cover',
        );
        const { x, y } = computeAutoFlowPosition(
          contentElements,
          state.selectedElementId,
          { width: element.width, height: element.height },
          pageMetrics,
        );
        const positionedElement = { ...element, x, y };
        const fits = y + positionedElement.height <= pageMetrics.CONTENT_BOTTOM;
        return { fits, element: positionedElement };
      };

      // Arma el resultado de `addElement` una vez que `placedElementId` ya
      // quedó insertado en `pages[pageIndex]` -- compartido por los 3
      // caminos posibles (hoja activa, hoja existente más adelante, hoja
      // nueva) para no triplicar este mismo bloque.
      const finalizePlacement = (pageIndex: number, placedElementId: string) => {
        const pushedPages = hasExplicitPosition
          ? pages
          : pushDownContentAfterChange(pages, state.doc.meta, placedElementId);
        return {
          doc: {
            ...state.doc,
            pages: pushedPages,
            meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
          },
          selectedPage: pages[pageIndex].page_number,
          selectedElementId: placedElementId,
          selectedElementIds: [placedElementId],
        };
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
        if (patch.linkedGroupId != null) {
          next.linkedGroupId = patch.linkedGroupId;
        }
        return next;
      };

      const withDocumentTextDefaults = (element: ReportElement): ReportElement => (
        element.type === 'text'
          ? { ...element, props: { ...(element.props || {}), ...(state.doc.meta.globalTextFormat || {}) } }
          : element
      );

      const activePage = pages[currentIndex];

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
          selectedElementIds: [coverElement.id],
        };
      }

      const baseElement = createElement(
        type,
        activePage.page_number,
        activePage.elements.length,
        m,
        patch.props?.shapeType,
      );
      const attempt = placeElementInPage(activePage, withDocumentTextDefaults(mergePatch(baseElement)), m);

      if (attempt.fits) {
        pages[currentIndex] = {
          ...activePage,
          elements: [...activePage.elements, attempt.element],
        };
        // Desplazamiento automático (pedido explícito 2026-08-28): un
        // bloque recién insertado empuja hacia abajo lo que tenga debajo en
        // su misma columna — cualquier tipo. Se omite SOLO cuando llegó con
        // posición explícita (patch.x/y, p.ej. un drop con wrapMode desde
        // la librería): ahí el solape con el texto es intencional (el
        // propio wrapMode decide cómo convive con el texto alrededor), no
        // un choque a resolver empujando (ver finalizePlacement).
        return finalizePlacement(currentIndex, attempt.element.id);
      }

      // La hoja activa ya no tiene lugar -- antes de abrir una hoja
      // TOTALMENTE nueva, revisa las hojas EXISTENTES que vienen después de
      // esta, en el orden en que aparecen en el documento. Bug real
      // reportado 2026-09-10: "si vuelvo a insertar otro objeto en la
      // primera hoja y no alcanza, no me lo coloca en la segunda hoja que
      // acaba de crear ya que prácticamente está vacía, sino me crea una
      // 3ra hoja y así consecutivamente" -- antes esta función ignoraba por
      // completo las hojas ya existentes y SIEMPRE abría una al final del
      // documento, acumulando hojas casi vacías en vez de aprovechar la que
      // ya se había creado para el desborde anterior. Cada hoja puede tener
      // su propio tamaño/orientación (`resolvePagePaperSetup`), así que se
      // recalculan métricas PROPIAS por cada candidata (`metricsForPage`),
      // nunca las de la hoja activa.
      for (let candidateIndex = currentIndex + 1; candidateIndex < pages.length; candidateIndex++) {
        const candidatePage = pages[candidateIndex];
        const candidateMetrics = metricsForPage(candidatePage, state.doc.meta);
        const candidateBase = createElement(
          type,
          candidatePage.page_number,
          candidatePage.elements.length,
          candidateMetrics,
          patch.props?.shapeType,
        );
        const candidateAttempt = placeElementInPage(
          candidatePage,
          withDocumentTextDefaults(mergePatch(candidateBase)),
          candidateMetrics,
        );
        if (candidateAttempt.fits) {
          pages[candidateIndex] = {
            ...candidatePage,
            elements: [...candidatePage.elements, candidateAttempt.element],
          };
          return finalizePlacement(candidateIndex, candidateAttempt.element.id);
        }
      }

      // Ninguna hoja existente tenía lugar -- recién acá se crea una nueva.
      const nextPageNumber = pages.length + 1;
      const layoutModeForNewPage = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
      const nextPage: ReportPage = {
        page_number: nextPageNumber,
        elements: createHeaderFooterPair(nextPageNumber, m, layoutModeForNewPage),
      };
      const nextElement = withDocumentTextDefaults(mergePatch(createElement(type, nextPageNumber, nextPage.elements.length, m)));
      const nextPlacement = placeElementInPage(nextPage, nextElement, m);
      nextPage.elements.push(nextPlacement.element);
      pages.push(nextPage);

      return finalizePlacement(pages.length - 1, nextPlacement.element.id);
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
          return {
            selectedPage: page.page_number,
            selectedElementId: existing.id,
            selectedElementIds: [existing.id],
          };
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
      const tocElement: ReportElement = {
        id: `toc-2-${Date.now()}`,
        type: 'toc',
        x: m.CONTENT_LEFT,
        y: m.CONTENT_TOP,
        width: m.CONTENT_RIGHT - m.CONTENT_LEFT,
        height: tocContinuationHeight(m),
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
        selectedElementIds: [tocElement.id],
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
  refreshTocDisplay: () =>
    set((state) => {
      let touched = false;
      const pages = state.doc.pages.map((page) => {
        if (!page.elements.some((el) => el.type === 'toc')) return page;
        touched = true;
        return { ...page };
      });
      if (!touched) return state;
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
      const m = metricsFromMeta(state.doc.meta);
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
      // Desplazamiento automático — esta acción documentaba explícitamente
      // que ignoraba el contenido existente; ahora empuja hacia abajo lo
      // que haya debajo en su misma columna, igual que cualquier otra
      // inserción.
      const pushedPages = pushDownContentAfterChange(pages, state.doc.meta, element.id);
      return {
        doc: {
          ...state.doc,
          pages: pushedPages,
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
      const m = metricsFromMeta(state.doc.meta);
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
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

      // Desplazamiento automático — esta plantilla se coloca en una posición
      // FIJA (CONTENT_LEFT/CONTENT_TOP) sin mirar el contenido existente, así
      // que puede solaparse con lo que ya haya al tope de la página; empujar
      // lo de abajo evita que quede tapado.
      const pushedPages = pushDownContentAfterChange(pages, state.doc.meta, element.id);

      return {
        doc: {
          ...state.doc,
          pages: pushedPages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: activePage.page_number,
        selectedElementId: element.id,
        selectedElementIds: [element.id],
      };
    }),
  addTechnicalBlock: (kind) =>
    set((state) => {
      const m = metricsFromMeta(state.doc.meta);
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
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
        selectedElementIds: newElements[0] ? [newElements[0].id] : [],
      };
    }),
  addSectionTemplate: (kind) =>
    set((state) => {
      const tpl = SECTION_TEMPLATES[kind];
      if (!tpl) return {} as Partial<EditorState>;
      const m = metricsFromMeta(state.doc.meta);
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
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
        selectedElementIds: [tableEl.id],
      };
    }),
  addStaticChart: (kind) =>
    set((state) => {
      const m = metricsFromMeta(state.doc.meta);
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;
      const activePage = pages[currentIndex];
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
        selectedElementIds: [chartEl.id],
      };
    }),
  addChartFromTable: (tableElementId, config) =>
    set((state) => {
      const pages = [...state.doc.pages];
      let pageIndex = -1;
      let tableElement: ReportElement | undefined;
      for (let i = 0; i < pages.length; i += 1) {
        const found = pages[i].elements.find((el) => el.id === tableElementId && el.type === 'table');
        if (found) {
          pageIndex = i;
          tableElement = found;
          break;
        }
      }
      if (!tableElement || pageIndex === -1) return {};

      const rows: string[][] = Array.isArray(tableElement.props?.rows) ? tableElement.props.rows : [];
      const chartData = buildChartDataFromTable(rows, !!tableElement.props?.hasHeader, config);
      if (!chartData) return {};

      const page = pages[pageIndex];
      const m = metricsFromMeta(state.doc.meta);
      const contentLeft = m.CONTENT_LEFT;
      const contentWidth = m.CONTENT_RIGHT - m.CONTENT_LEFT;
      const contentEls = page.elements.filter((el) => el.type !== 'header' && el.type !== 'footer');
      const maxBottom = contentEls.length
        ? Math.max(...contentEls.map((el) => el.y + el.height))
        : m.CONTENT_TOP - INSERT_GAP;
      const startY = Math.max(m.CONTENT_TOP, maxBottom + INSERT_GAP);
      const stamp = Date.now();

      const chartKindByOptionId: Record<string, string> = { 'chart-line': 'line', 'chart-hbar': 'hbar', 'chart-combo': 'combo' };
      const chartEl: ReportElement = {
        id: `chart-from-table-${stamp}`,
        type: 'chart',
        x: contentLeft,
        y: startY,
        width: contentWidth,
        height: 260,
        zIndex: page.elements.length,
        locked: false,
        props: {
          ...defaultPropsByType('chart'),
          live: false,
          chartKind: chartKindByOptionId[config.chartKind] || 'line',
          title: String(tableElement.props?.title || 'Gráfico desde tabla'),
          ...chartData,
        },
        border: defaultBorderByType('chart'),
      };

      pages[pageIndex] = { ...page, elements: [...page.elements, chartEl] };

      return {
        doc: {
          ...state.doc,
          pages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: page.page_number,
        selectedElementId: chartEl.id,
        selectedElementIds: [chartEl.id],
      };
    }),
  selectElement: (id) =>
    set((state) => {
      if (!id) return { selectedElementId: undefined, selectedElementIds: [] };
      // Un fragmento de un bloque partido entre páginas (tabla o texto, ver
      // `linkedGroupId`) es en realidad UN solo objeto lógico -- seleccionar
      // cualquiera de sus fragmentos selecciona a todos los demás, mismo
      // criterio que `updateElement` ya usa para moverlos juntos (pedido
      // explícito 2026-09-10 para tablas partidas, aplica igual a texto
      // partido por auto-paginación). `selectedElementId` se queda apuntando
      // al fragmento realmente clickeado -- el panel de propiedades edita ESE.
      let linkedGroupId: string | undefined;
      for (const page of state.doc.pages) {
        const found = page.elements.find((el) => el.id === id);
        if (found) {
          linkedGroupId = found.linkedGroupId;
          break;
        }
      }
      if (!linkedGroupId) {
        return { selectedElementId: id, selectedElementIds: [id] };
      }
      const linkedIds: string[] = [];
      state.doc.pages.forEach((page) => {
        page.elements.forEach((el) => {
          if (el.linkedGroupId === linkedGroupId) linkedIds.push(el.id);
        });
      });
      return { selectedElementId: id, selectedElementIds: linkedIds.length > 0 ? linkedIds : [id] };
    }),
  updateElement: (pageNumber, elementId, patch) =>
    set((state) => {
      if (state.documentLocked) {
        log.warn('[EDITOR_LOCK] Edición bloqueada -- el informe cargado está firmado/archivado.');
        return state;
      }
      const previous = state.doc.pages
        .find((page) => page.page_number === pageNumber)
        ?.elements.find((element) => element.id === elementId);
      const patchedPages = state.doc.pages.map((page) => {
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
            // "Detrás del texto"/"Delante del texto" (ADR-049, WrapInspector
            // en RightInspector.tsx) -- pedido explícito 2026-09-04: antes
            // solo guardaba el valor de wrapMode, sin mover el zIndex, así
            // que elegir esta opción no cambiaba nada visible (el orden de
            // dibujo en el lienzo lo decide únicamente zIndex, no wrapMode —
            // ver el `.sort((a, b) => a.zIndex - b.zIndex)` que ordena TODOS
            // los bloques, texto incluido, en un solo lienzo Konva). Se
            // salta si el propio `patch` ya trae un `zIndex` explícito (p.ej.
            // un "traer al frente"/"enviar atrás" manual que el usuario ya
            // eligió aparte).
            if ((patch.wrapMode === 'behind' || patch.wrapMode === 'infront') && patch.zIndex === undefined) {
              const textZIndexes = page.elements
                .filter((el) => el.id !== elementId && el.type === 'text')
                .map((el) => el.zIndex || 0);
              if (textZIndexes.length > 0) {
                merged.zIndex = patch.wrapMode === 'behind'
                  ? Math.min(...textZIndexes) - 1
                  : Math.max(...textZIndexes) + 1;
              }
            }
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
      const changed = patchedPages
        .find((page) => page.page_number === pageNumber)
        ?.elements.find((element) => element.id === elementId);
      // Desplazamiento automático GENERAL (pedido explícito 2026-08-28,
      // ampliado 2026-09-04): CUALQUIER bloque cuyo BORDE INFERIOR avance
      // hacia abajo empuja lo que tenga debajo en su misma columna — sin
      // importar el tipo (texto, imagen, gráfico, kpi, video, tabla,
      // forma…) ni la causa (contenido que crece al escribir, redimensionado
      // manual con el Transformer, auto-ajuste de una tabla al agregar
      // filas, o un simple arrastre que lo reposiciona más abajo). Hasta
      // 2026-08-28 un arrastre sin cambio de tamaño quedaba EXCLUIDO a
      // propósito (exigía `patch.height` explícito) para que reposicionar
      // nunca empujara nada — pedido explícito posterior (2026-09-04): "si
      // lo desplazo hacia abajo, el contenido de abajo también debe
      // desplazarse", así que ahora basta con que el patch traiga `y` O
      // `height`. Se sigue comparando el borde inferior, no el alto/Y a
      // secas, para que agrandar tirando del borde SUPERIOR (el inferior no
      // se mueve) o arrastrar hacia ARRIBA no empujen nada. Un bloque
      // bloqueado nunca actúa como ancla.
      const bottomEdgeGrew = Boolean(
        previous && changed && (patch.height !== undefined || patch.y !== undefined) &&
        (changed.y + changed.height) > (previous.y + previous.height) + 0.5,
      );
      const pages = bottomEdgeGrew && !changed?.locked
        ? pushDownContentAfterChange(
            patchedPages,
            state.doc.meta,
            elementId,
            previous ? { x: previous.x, y: previous.y, width: previous.width, height: previous.height } : undefined,
          )
        : patchedPages;
      // Fragmentos "enlazados" (misma pegada de Word/Docs partida entre
      // páginas por desborde, ver `linkedGroupId` en la interfaz de arriba)
      // -- pedido explícito 2026-09-09: mover uno desplaza a los demás
      // miembros del mismo grupo (en cualquier página) por el MISMO delta,
      // cada uno recortado a los límites de SU propia hoja. Deliberadamente
      // NO encadena `pushDownContentAfterChange` para cada hermano -- ese
      // empuje es para crecimiento/redimensión de un bloque, no para este
      // desplazamiento en bloque de un grupo ya existente.
      const linkedGroupId = changed?.linkedGroupId;
      const linkedDeltaX = previous && changed ? changed.x - previous.x : 0;
      const linkedDeltaY = previous && changed ? changed.y - previous.y : 0;
      // Tablas partidas entre páginas (pedido explícito 2026-09-10): a
      // diferencia del texto (que se mueve en bloque conservando su
      // partición, ver el `.map` de abajo), mover a mano el fragmento de
      // una tabla no debe arrastrar a los demás por el mismo delta -- debe
      // redistribuir su contenido según el espacio libre que quedó. Solo
      // aplica a cambios VERTICALES (el alto disponible de una página
      // depende de Y, no de X, ver `reflowLinkedTableFragments`) -- un
      // arrastre puramente horizontal sigue el "mover en bloque" de abajo,
      // para no perder la alineación de columnas entre fragmentos.
      const isLinkedTableVerticalMove = changed?.type === 'table' && !!linkedGroupId && linkedDeltaY !== 0;
      const linkedPages = isLinkedTableVerticalMove
        ? reflowLinkedTableFragments(pages, state.doc.meta, elementId)
        : linkedGroupId && (linkedDeltaX !== 0 || linkedDeltaY !== 0)
        ? pages.map((page) => {
            if (!page.elements.some((el) => el.id !== elementId && el.linkedGroupId === linkedGroupId)) {
              return page;
            }
            const pageMetrics = metricsForPage(page, state.doc.meta);
            return {
              ...page,
              elements: page.elements.map((el) => {
                if (el.id === elementId || el.linkedGroupId !== linkedGroupId) return el;
                const nextX = Math.min(
                  Math.max(el.x + linkedDeltaX, pageMetrics.CONTENT_LEFT),
                  pageMetrics.CONTENT_RIGHT - el.width,
                );
                const nextY = Math.min(
                  Math.max(el.y + linkedDeltaY, pageMetrics.CONTENT_TOP),
                  pageMetrics.CONTENT_BOTTOM - el.height,
                );
                return { ...el, x: nextX, y: nextY };
              }),
            };
          })
        : pages;
      const comments = Array.isArray(state.doc.meta.comments)
        ? state.doc.meta.comments.map((comment: ReportComment) => {
            if (!comment.elementId) return comment;
            const movedPage = linkedPages.find((page) => page.elements.some((element) => element.id === comment.elementId));
            return movedPage && movedPage.page_number !== comment.pageNumber
              ? { ...comment, pageNumber: movedPage.page_number }
              : comment;
          })
        : state.doc.meta.comments;
      return {
        doc: {
          ...state.doc,
          pages: linkedPages,
          meta: { ...state.doc.meta, comments, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  relocateWrapAdjustedText: (pageNumber, elementId, y, height) =>
    set((state) => {
      const pages = state.doc.pages.map((page) => ({ ...page, elements: [...page.elements] }));
      const sourcePageIndex = pages.findIndex((page) => page.page_number === pageNumber);
      if (sourcePageIndex < 0) return state;
      const element = pages[sourcePageIndex].elements.find((el) => el.id === elementId);
      if (!element) return state;

      const metrics = metricsForPage(pages[sourcePageIndex], state.doc.meta);
      let landingPageIndex = sourcePageIndex;

      if (y + height <= metrics.CONTENT_BOTTOM) {
        pages[sourcePageIndex] = {
          ...pages[sourcePageIndex],
          elements: pages[sourcePageIndex].elements.map((el) => (el.id === elementId ? { ...el, y, height } : el)),
        };
      } else {
        // No entra en lo que resta de esta hoja: se mueve ENTERO a la
        // siguiente, al tope del área de contenido — el ajuste de texto no
        // tiene mecanismo de partición (a diferencia del texto en vivo,
        // ver splitOverflowingText), así que aquí siempre es "todo o nada".
        landingPageIndex = sourcePageIndex + 1;
        const nextPage = ensurePageAt(pages, landingPageIndex, pages[sourcePageIndex], state.doc.meta);
        const nextMetrics = metricsForPage(nextPage, state.doc.meta);
        const relocated = { ...element, y: nextMetrics.CONTENT_TOP, height };

        // Igual que splitOverflowingText al insertar una continuación al
        // tope de la hoja siguiente: primero se hace HUECO empujando hacia
        // abajo lo que ya hubiera ahí en la misma columna, y RECIÉN
        // ENTONCES se coloca el bloque — nunca al revés. Insertarlo
        // primero y empujar después (el orden que tenía antes) dejaba, por
        // un instante, el bloque nuevo SOLAPADO con lo que ya había — y el
        // empuje automático interpretaba ese solape como un racimo A
        // PROPÓSITO (p.ej. una forma con texto encima), fundiendo ambos y
        // excluyéndolos de su propio empuje — bug real reportado ("todo se
        // mezcla y se sobrepone" al cruzar de página).
        const pushDownBy = height + CONTENT_FLOW_GAP;
        const existingClusters = buildOverlapClusters(
          nextPage.elements.filter((el) => !isFlowChrome(el) && el.id !== elementId),
        );
        const shiftedIds = new Set<string>();
        existingClusters.forEach((members) => {
          if (members.some((member) => member.locked)) return;
          const minX = Math.min(...members.map((member) => member.x));
          const maxRight = Math.max(...members.map((member) => member.x + member.width));
          if (!sameFlowColumn(relocated, { x: minX, width: maxRight - minX })) return;
          members.forEach((member) => shiftedIds.add(member.id));
        });
        const shiftedElements = nextPage.elements.map((el) =>
          (shiftedIds.has(el.id) ? { ...el, y: el.y + pushDownBy } : el));

        pages[sourcePageIndex] = {
          ...pages[sourcePageIndex],
          elements: pages[sourcePageIndex].elements.filter((el) => el.id !== elementId),
        };
        pages[landingPageIndex] = { ...nextPage, elements: [relocated, ...shiftedElements] };
      }

      // Empuje en cascada por si, tras ese primer corrimiento, algo
      // siguiera sin entrar en su hoja — puede seguir empujando a la
      // página siguiente, y a la siguiente, tantas veces como haga falta
      // (mismo mecanismo recursivo que cualquier otro crecimiento). Se
      // pasa el tamaño ANTERIOR del bloque (antes de esta reubicación) por
      // la misma razón que en `updateElement`: si el bloque quedó
      // solapando algo que antes no tocaba (p.ej. una tabla que ya estaba
      // ahí, cuando el texto reubicado cupo en la misma página), ese
      // solape recién creado no debe confundirse con un racimo a
      // propósito — bug real reportado ("el texto se sobrepone a la
      // tabla").
      const nextPages = pushDownContentAfterChange(
        pages,
        state.doc.meta,
        elementId,
        { x: element.x, y: element.y, width: element.width, height: element.height },
      );

      return {
        doc: {
          ...state.doc,
          pages: nextPages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }),
  removeElement: (pageNumber, elementId) =>
    set((state) => {
      if (state.documentLocked) {
        log.warn('[EDITOR_LOCK] Eliminar bloqueado -- el informe cargado está firmado/archivado.');
        return state;
      }
      const pages = state.doc.pages.map((page) => {
        if (page.page_number !== pageNumber) {
          return page;
        }
        return {
          ...page,
          elements: page.elements.filter((element) => element.id !== elementId),
        };
      });
      const nextSelectedIds = state.selectedElementIds.filter((id) => id !== elementId,);
      return {
        doc: {
          ...state.doc,
          pages,
          meta: {
            ...state.doc.meta,
            version: state.doc.meta.version + 1,
            updatedAt: new Date().toISOString(),
          },
        },
        selectedElementIds: nextSelectedIds,
        selectedElementId:
          nextSelectedIds.length === 1 ? nextSelectedIds[0] : undefined,
      };
    }),
  removeElements: (pageNumber, elementIds) =>
    set((state) => {
      if (state.documentLocked) {
        log.warn('[EDITOR_LOCK] Eliminar bloqueado -- el informe cargado está firmado/archivado.');
        return state;
      }
      const ids = new Set(elementIds);

      const pages = state.doc.pages.map((page) => {
        if (page.page_number !== pageNumber) {
          return page;
        }

        return {
          ...page,
          elements: page.elements.filter((element) => !ids.has(element.id)),
        };
      });

      const nextSelectedIds = state.selectedElementIds.filter(
        (id) => !ids.has(id),
      );

      return {
        doc: {
          ...state.doc,
          pages,
          meta: {
            ...state.doc.meta,
            version: state.doc.meta.version + 1,
            updatedAt: new Date().toISOString(),
          },
        },
        selectedElementIds: nextSelectedIds,
        selectedElementId:
          nextSelectedIds.length === 1 ? nextSelectedIds[0] : undefined,
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
    set((s) => {
      const pages = s.doc.pages.map((p) =>
        p.page_number === pageNumber ? { ...p, elements: [...p.elements, clone] } : p,
      );
      // Desplazamiento automático — esta acción documentaba explícitamente
      // que no empujaba nada al pegar; ahora sí, como cualquier inserción.
      const pushedPages = pushDownContentAfterChange(pages, s.doc.meta, newId);
      return {
        doc: {
          ...s.doc,
          pages: pushedPages,
          meta: { ...s.doc.meta, version: s.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
        selectedPage: pageNumber,
        selectedElementId: newId,
      };
    });
    return newId;
  },
  clipboardElements: null,
  pendingImportBlocks: null,
  setPendingImportBlocks: (blocks) => set({ pendingImportBlocks: blocks }),
  importReplicaPages: (importPages) => {
    let firstPageNumber = 1;
    set((state) => {
      if (state.documentLocked || importPages.length === 0) return state;
      const hasContent = state.doc.pages.some((page) =>
        page.elements.some((el) => el.type !== 'header' && el.type !== 'footer'),
      );
      const basePages = hasContent ? [...state.doc.pages] : [];
      const stamp = Date.now();
      firstPageNumber = basePages.length + 1;
      const newPages: ReportPage[] = importPages.map((imported, index) => {
        const pageNumber = firstPageNumber + index;
        const elements: ReportElement[] = [];
        if (imported.background) {
          const bg = imported.background;
          elements.push({
            id: `image-${pageNumber}-${stamp}-bg`,
            type: 'image',
            x: bg.x,
            y: bg.y,
            width: bg.width,
            height: bg.height,
            zIndex: 0,
            // Bloqueado y detrás del texto: es la hoja misma, no una figura
            // que el usuario vaya a arrastrar por error. 'behind' (no
            // 'square', el default de una imagen): con 'square' todo texto
            // encima se desplazaba a los costados -- una de las causas de
            // superposición del importador anterior.
            locked: true,
            src: bg.src,
            objectFit: 'fill',
            wrapMode: 'behind',
            props: { ...defaultPropsByType('image'), alt: `Fondo de la página ${imported.sourcePageNumber} del PDF de origen` },
            border: defaultBorderByType('image'),
          });
        }
        imported.texts.forEach((text, textIndex) => {
          elements.push({
            id: `text-${pageNumber}-${stamp}-${textIndex}`,
            type: 'text',
            x: text.x,
            y: text.y,
            width: text.width,
            height: text.height,
            zIndex: textIndex + 1,
            locked: false,
            props: {
              ...defaultPropsByType('text'),
              text: text.text,
              spans: text.spans,
              fontSize: text.fontSize,
              fontFamily: text.fontFamily,
              fontColor: text.fontColor,
              lineHeight: text.lineHeight,
              textAlign: text.textAlign,
              ...(text.headingStyle ? { headingStyle: text.headingStyle } : {}),
              exactLayout: true,
            },
            border: defaultBorderByType('text'),
          });
        });
        return {
          page_number: pageNumber,
          paperSize: imported.paperSize,
          orientation: imported.orientation,
          fixedLayout: true,
          elements,
        };
      });
      const first = importPages[0];
      return {
        doc: {
          ...state.doc,
          pages: [...basePages, ...newPages],
          meta: {
            ...state.doc.meta,
            ...(hasContent ? {} : { paperSize: first.paperSize, orientation: first.orientation }),
            version: state.doc.meta.version + 1,
            updatedAt: new Date().toISOString(),
          },
        },
        selectedPage: firstPageNumber,
        selectedElementId: undefined,
        selectedElementIds: [],
      };
    });
    return firstPageNumber;
  },
  copySelection: (elementIds) =>
    set((state) => {
      const ids = new Set(elementIds);
      // Busca cada id en TODAS las páginas (Ctrl+A ya no está acotado a una
      // sola) y recuerda de cuál venía cada elemento -- nunca copia bloques
      // de plataforma (encabezado/pie/carátula), aunque su id venga incluido.
      const found: Array<{ pageNumber: number; element: ReportElement }> = [];
      state.doc.pages.forEach((page) => {
        page.elements.forEach((element) => {
          if (ids.has(element.id) && element.type !== 'header' && element.type !== 'footer' && element.type !== 'cover') {
            found.push({ pageNumber: page.page_number, element });
          }
        });
      });
      if (!found.length) return {};
      const minPage = Math.min(...found.map((f) => f.pageNumber));
      const byOffset = new Map<number, ReportElement[]>();
      found.forEach(({ pageNumber, element }) => {
        const offset = pageNumber - minPage;
        const list = byOffset.get(offset) || [];
        // Snapshot profundo, mismo motivo que copyElement.
        list.push(JSON.parse(JSON.stringify(element)));
        byOffset.set(offset, list);
      });
      const groups: ClipboardPageGroup[] = Array.from(byOffset.entries())
        .sort(([a], [b]) => a - b)
        .map(([pageOffset, elements]) => ({ pageOffset, elements }));
      return { clipboardElements: groups };
    }),
  pasteSelection: (pageNumber, groups) => {
    const state = get();
    if (state.documentLocked) {
      log.warn('[EDITOR_LOCK] Pegado bloqueado -- el informe cargado está firmado/archivado.');
      return [];
    }
    const src = groups && groups.length ? groups : state.clipboardElements;
    if (!src || !src.length) return [];
    const sortedGroups = [...src].sort((a, b) => a.pageOffset - b.pageOffset);
    const OFFSET = 24;
    const layoutMode = state.doc.meta?.layoutMode === 'presentation' ? 'presentation' : 'document';
    const metaForPages = metricsFromMeta(state.doc.meta);

    // El grupo con offset 0 se pega en la página ACTUAL (pageNumber), junto
    // a lo que ya haya ahí -- igual que un pegado de un solo grupo. Cada
    // offset mayor representa una página ADICIONAL que tenía lo copiado:
    // siempre se agrega una página NUEVA al final del documento para cada
    // una (nunca reutiliza/sobrescribe una página existente ajena aunque su
    // número coincida por aritmética) -- así "duplicar un informe completo"
    // (Ctrl+A + Ctrl+C en el original, Ctrl+V en uno nuevo) reconstruye la
    // MISMA cantidad de páginas, pedido explícito 2026-09-09.
    let pages = state.doc.pages;
    const pageNumberForOffset = new Map<number, number>([[0, pageNumber]]);
    sortedGroups.forEach((group) => {
      if (pageNumberForOffset.has(group.pageOffset)) return;
      const newPageNumber = pages.length + 1;
      pages = [...pages, { page_number: newPageNumber, elements: createHeaderFooterPair(newPageNumber, metaForPages, layoutMode) }];
      pageNumberForOffset.set(group.pageOffset, newPageNumber);
    });

    const allNewIds: string[] = [];
    let zCursor = Math.max(0, ...state.doc.pages.flatMap((p) => p.elements.map((e) => e.zIndex || 0)));
    sortedGroups.forEach((group, groupIndex) => {
      const destPageNumber = pageNumberForOffset.get(group.pageOffset)!;
      const destPage = pages.find((p) => p.page_number === destPageNumber)!;
      const m = metricsForPage(destPage, state.doc.meta);
      // Ancla en la esquina superior-izquierda del grupo -- el resto
      // conserva su posición RELATIVA a esa esquina (mismo criterio que
      // moveElementsBetweenPages), para que no pierda su disposición interna.
      const minX = Math.min(...group.elements.map((e) => e.x));
      const minY = Math.min(...group.elements.map((e) => e.y));
      const clones: ReportElement[] = group.elements.map((orig, i) => {
        zCursor += 1;
        const clone: ReportElement = JSON.parse(JSON.stringify(orig));
        clone.id = `${orig.type}-${destPageNumber}-${Date.now()}-${groupIndex}-${i}-${Math.floor(Math.random() * 1000)}`;
        clone.x = Math.min(minX + OFFSET + (orig.x - minX), Math.max(0, m.PAGE_WIDTH - orig.width - 4));
        clone.y = Math.min(minY + OFFSET + (orig.y - minY), Math.max(0, m.PAGE_HEIGHT - orig.height - 4));
        clone.zIndex = zCursor;
        clone.locked = false;
        return clone;
      });
      pages = pages.map((p) => (p.page_number === destPageNumber ? { ...p, elements: [...p.elements, ...clones] } : p));
      allNewIds.push(...clones.map((c) => c.id));
    });

    set(() => ({
      doc: {
        ...state.doc,
        pages,
        meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
      clipboardElements: groups && groups.length
        ? groups.map((g) => ({ pageOffset: g.pageOffset, elements: JSON.parse(JSON.stringify(g.elements)) }))
        : state.clipboardElements,
      selectedPage: pageNumber,
      selectedElementIds: allNewIds,
      selectedElementId: allNewIds.length === 1 ? allNewIds[0] : undefined,
    }));
    return allNewIds;
  },
  selectAllDocument: () =>
    set((state) => {
      const ids = state.doc.pages.flatMap((page) => (
        page.elements
          .filter((el) => el.type !== 'header' && el.type !== 'footer' && el.type !== 'cover')
          .map((el) => el.id)
      ));
      return {
        selectedElementIds: ids,
        selectedElementId: ids.length === 1 ? ids[0] : undefined,
      };
    }),
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
  toggleSelection: (elementId, isMulti) => set((state) => {
    if (!isMulti) {
      return {
        selectedElementIds: [elementId],
        selectedElementId: elementId,
      };
    }
    const alreadySelected = state.selectedElementIds.includes(elementId);
    const nextIds = alreadySelected
      ? state.selectedElementIds.filter((id) => id !== elementId)
      : [...state.selectedElementIds, elementId];

    return {
      selectedElementIds: nextIds,
      selectedElementId: nextIds.length === 1 ? nextIds[0] : undefined,
    };
  }),

  moveElementsBetweenPages: (elementIds, anchorId, toPageNum, newAnchorX, newAnchorY) => set((state) => {
    const doc = state.doc;
    let anchorOriginal: ReportElement | undefined;
    doc.pages.forEach((page) => {
      const found = page.elements.find((el) => el.id === anchorId);
      if (found) anchorOriginal = found;
    });
    if (!anchorOriginal) return state;

    const deltaX = newAnchorX - anchorOriginal.x;
    const deltaY = newAnchorY - anchorOriginal.y;

    // 1. Quitar cada elemento de la página en la que esté actualmente (no
    // se asume que toda la selección venga de la misma página de origen).
    const moving: ReportElement[] = [];
    let pages = doc.pages.map((page) => {
      const leaving = page.elements.filter((el) => elementIds.includes(el.id));
      if (leaving.length === 0) return page;
      leaving.forEach((el) => moving.push(el));
      return { ...page, elements: page.elements.filter((el) => !elementIds.includes(el.id)) };
    });
    if (moving.length === 0) return state;

    // 2. Insertarlos todos en la página destino, conservando la distancia
    // ORIGINAL de cada uno respecto al ancla (el mismo delta X/Y para
    // todos) — el clamp a los bordes de la página destino se aplica por
    // elemento, así que en un caso extremo (selección más ancha/alta que la
    // hoja destino) alguno puede perder distancia relativa, pero el caso
    // normal preserva la composición completa.
    pages = pages.map((page) => {
      if (page.page_number !== toPageNum) return page;
      const metrics = metricsForPage(page, doc.meta);
      const relocated = moving.map((element) => {
        const isAnchor = element.id === anchorId;
        const rawX = isAnchor ? newAnchorX : element.x + deltaX;
        const rawY = isAnchor ? newAnchorY : element.y + deltaY;
        const minX = metrics.CONTENT_LEFT;
        const minY = metrics.CONTENT_TOP;
        const maxX = Math.max(minX, metrics.CONTENT_RIGHT - element.width);
        const maxY = Math.max(minY, metrics.CONTENT_BOTTOM - element.height);
        return { ...element, x: Math.min(Math.max(rawX, minX), maxX), y: Math.min(Math.max(rawY, minY), maxY) };
      });
      return { ...page, elements: [...page.elements, ...relocated] };
    });

    // 3. Si algún elemento recién llegado quedó ENCIMA (solape real, no
    // solo "más abajo en la misma columna") de contenido ya existente en
    // la página destino, correrlo lo justo para dejar de tocarlo — pedido
    // explícito 2026-09-04: "la tabla no se desplazó hacia abajo, se quedó
    // debajo de la imagen" al arrastrar una imagen a otra página. Usa
    // `resolveDirectOverlapsOnLanding` (NO el empuje en cascada de
    // `pushDownContentAfterChange`) a propósito: un intento anterior con el
    // empuje en cascada resolvía bien ESE caso pero rompía uno mucho más
    // común reportado después — al aterrizar cerca de varios bloques de
    // sensores ya acomodados en orden, cualquiera que compartiera columna
    // con ellos los arrastraba a TODOS hacia abajo en cadena (alguno hasta
    // otra página), aunque no hubiera solape real con la mayoría.
    pages = resolveDirectOverlapsOnLanding(pages, toPageNum, elementIds);

    return {
      doc: {
        ...doc,
        pages,
        meta: { ...doc.meta, version: doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
    };
  }),
  splitOverflowingText: ({
    pageNumber,
    elementId,
    fittingText,
    fittingSpans,
    fittingWidth,
    fittingHeight,
    overflowText,
    overflowSpans,
    overflowWidth,
    overflowHeight,
  }) => set((state) => {
    const meta = state.doc.meta;
    const pages = state.doc.pages.map((page) => ({ ...page, elements: [...page.elements] }));

    const sourcePageIndex = pages.findIndex((page) => page.page_number === pageNumber);
    if (sourcePageIndex < 0) return state;
    const anchor = pages[sourcePageIndex].elements.find((element) => element.id === elementId);
    if (!anchor || anchor.type !== 'text') return state;

    // 1. El bloque de origen se queda solo con lo que sí cabe en lo que
    // resta de esta hoja. También se actualiza el ANCHO (no solo el alto):
    // el cuadro puede haberse ensanchado más allá del `width` guardado
    // durante la sesión de tecleo (una palabra/término técnico sin cortes
    // más ancho que el cuadro) — si no se confirma ese ancho real aquí, el
    // bloque queda con un ancho angosto obsoleto que ya no coincide con el
    // que se usó para calcular dónde partir el texto.
    pages[sourcePageIndex] = {
      ...pages[sourcePageIndex],
      elements: pages[sourcePageIndex].elements.map((element) => element.id === elementId
        ? { ...element, width: fittingWidth, height: fittingHeight, props: { ...element.props, text: fittingText, spans: fittingSpans } }
        : element),
    };

    // 2. El resto continúa en un bloque nuevo AL INICIO de la hoja
    // siguiente (creándola si hace falta) — mismo x/ancho/estilo que el
    // original, para que se vea como el mismo párrafo continuando. La
    // continuación SIEMPRE gana la posición de tope: cualquier contenido
    // de la MISMA columna que ya estuviera ahí (pedido explícito: un
    // informe ya armado al que se le agrega texto en una página anterior,
    // con contenido propio ya en la página siguiente) se empuja hacia
    // abajo — nunca al revés. Se empuja ANTES de insertar la continuación
    // (en vez de confiar en el desempate por orden de reflowTextColumnAfterChange
    // más abajo): si ambos terminaban con el mismo y=CONTENT_TOP, ese
    // desempate por orden de inserción podía dejar el contenido VIEJO
    // arriba y la continuación abajo, justo al revés de lo pedido.
    const nextPageIndex = sourcePageIndex + 1;
    const nextPage = ensurePageAt(pages, nextPageIndex, pages[sourcePageIndex], meta);
    const metrics = metricsForPage(nextPage, meta);
    const continuationId = `text-continuation-${elementId}-${Date.now()}`;
    const pushDownBy = overflowHeight + TEXT_FLOW_GAP;
    const continuationRef = { id: continuationId, type: 'text', x: anchor.x, width: overflowWidth };
    const shiftedElements = nextPage.elements.map((element) =>
      isSameTextColumn(continuationRef, element) ? { ...element, y: element.y + pushDownBy } : element);
    const continuationElement: ReportElement = {
      ...anchor,
      id: continuationId,
      y: metrics.CONTENT_TOP,
      width: overflowWidth,
      height: overflowHeight,
      props: { ...anchor.props, text: overflowText, spans: overflowSpans },
    };
    pages[nextPageIndex] = { ...nextPage, elements: [continuationElement, ...shiftedElements] };

    // 3. Reutilizar reflowTextColumnAfterChange para las consecuencias en
    // cascada: empujar lo que hubiera debajo en la página de ORIGEN (por
    // robustez, aunque el bloque ahora mide menos) y, en la de destino,
    // mover a la página siguiente lo que el empuje de arriba haya dejado
    // sin entrar — mismo criterio que cuando cualquier otro bloque crece.
    let nextPages = reflowTextColumnAfterChange(pages, meta, elementId);
    nextPages = reflowTextColumnAfterChange(nextPages, meta, continuationId);

    const finalContinuationPage = nextPages.find((page) =>
      page.elements.some((element) => element.id === continuationId));

    return {
      doc: {
        ...state.doc,
        pages: nextPages,
        meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
      pendingTextContinuation: {
        pageNumber: finalContinuationPage ? finalContinuationPage.page_number : nextPage.page_number,
        elementId: continuationId,
      },
    };
  }),
  pasteTextAcrossPages: ({ pageNumber, elementId, chunks }) => set((state) => {
    if (chunks.length === 0) return state;
    const meta = state.doc.meta;
    let pages = state.doc.pages.map((page) => ({ ...page, elements: [...page.elements] }));

    const sourcePageIndex = pages.findIndex((page) => page.page_number === pageNumber);
    if (sourcePageIndex < 0) return state;
    const anchor = pages[sourcePageIndex].elements.find((element) => element.id === elementId);
    if (!anchor || anchor.type !== 'text') return state;

    // El primer trozo reemplaza el bloque de origen in-place -- igual que
    // el paso 1 de splitOverflowingText.
    const first = chunks[0];
    pages[sourcePageIndex] = {
      ...pages[sourcePageIndex],
      elements: pages[sourcePageIndex].elements.map((element) => element.id === elementId
        ? { ...element, width: first.width, height: first.height, props: { ...element.props, text: first.text, spans: first.spans } }
        : element),
    };
    pages = reflowTextColumnAfterChange(pages, meta, elementId);

    // Cada trozo siguiente es una página de continuación nueva, encadenada
    // a partir de la ANTERIOR ya colocada (no de `pageNumber` fijo) -- si
    // el trozo previo terminó reflowed a una página distinta de la que
    // `ensurePageAt` hubiera creado a ciegas, esta es la posición real.
    let prevPageNumber = pageNumber;
    let lastContinuationId = elementId;
    let lastContinuationPageNumber = pageNumber;

    for (let i = 1; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const prevPageIndex = pages.findIndex((page) => page.page_number === prevPageNumber);
      const nextPageIndex = prevPageIndex + 1;
      const nextPage = ensurePageAt(pages, nextPageIndex, pages[prevPageIndex], meta);
      const metrics = metricsForPage(nextPage, meta);
      const continuationId = `text-continuation-${elementId}-${Date.now()}-${i}`;
      const pushDownBy = chunk.height + TEXT_FLOW_GAP;
      const continuationRef = { id: continuationId, type: 'text' as const, x: anchor.x, width: chunk.width };
      const shiftedElements = nextPage.elements.map((element) =>
        isSameTextColumn(continuationRef, element) ? { ...element, y: element.y + pushDownBy } : element);
      const continuationElement: ReportElement = {
        ...anchor,
        id: continuationId,
        y: metrics.CONTENT_TOP,
        width: chunk.width,
        height: chunk.height,
        props: { ...anchor.props, text: chunk.text, spans: chunk.spans },
      };
      pages[nextPageIndex] = { ...nextPage, elements: [continuationElement, ...shiftedElements] };
      pages = reflowTextColumnAfterChange(pages, meta, continuationId);

      lastContinuationId = continuationId;
      const settledPage = pages.find((page) => page.elements.some((element) => element.id === continuationId));
      lastContinuationPageNumber = settledPage ? settledPage.page_number : nextPage.page_number;
      prevPageNumber = lastContinuationPageNumber;
    }

    return {
      doc: {
        ...state.doc,
        pages,
        meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
      pendingTextContinuation: chunks.length > 1
        ? { pageNumber: lastContinuationPageNumber, elementId: lastContinuationId }
        : state.pendingTextContinuation,
    };
  }),
  splitOverflowingTable: ({ pageNumber, elementId, fittingRowCount, fittingHeightPx, overflowHeightPx }) => set((state) => {
    const meta = state.doc.meta;
    const pages = state.doc.pages.map((page) => ({ ...page, elements: [...page.elements] }));

    const sourcePageIndex = pages.findIndex((page) => page.page_number === pageNumber);
    if (sourcePageIndex < 0) return state;
    const anchor = pages[sourcePageIndex].elements.find((element) => element.id === elementId);
    if (!anchor || anchor.type !== 'table') return state;

    const anchorProps = anchor.props || {};
    const rows: string[][] = Array.isArray(anchorProps.rows) ? anchorProps.rows : [];
    if (fittingRowCount < 1 || fittingRowCount >= rows.length) return state;
    const hasHeader = anchorProps.hasHeader !== false;
    const headerOffset = hasHeader ? 1 : 0;

    // El corte nunca parte un grupo de celdas fusionadas por la mitad: si
    // cae DENTRO de una fusión, se retrocede hasta el inicio de esa fusión
    // (el grupo entero se va a la continuación en vez de partirse).
    const mergedCells: TableMergedCellRef[] = Array.isArray(anchorProps.mergedCells) ? anchorProps.mergedCells : [];
    let splitAt = fittingRowCount;
    mergedCells.forEach((merge) => {
      if (merge.row < splitAt && merge.row + merge.rowSpan > splitAt) splitAt = merge.row;
    });
    splitAt = Math.max(1, splitAt);
    if (splitAt >= rows.length) return state;

    // Bug real reportado en vivo 2026-09-10 ("el borde negro se divide en
    // 2, como si hubieran 2 tablas... 2 encabezados"): si lo único que cabe
    // en la página actual es la fila de encabezado (`splitAt <= headerOffset`,
    // TableBlock.tsx fuerza que se reporte al menos 1 fila aunque esa fila
    // ni siquiera termine de entrar), el corte de abajo dejaba una tabla
    // "origen" degenerada -- solo encabezado, cero filas de datos reales --
    // seguida inmediatamente de la continuación con encabezado repetido +
    // todo el contenido real. Visualmente indistinguible de dos tablas
    // apiladas. Igual que Word (que nunca deja un encabezado huérfano sin
    // al menos una fila de datos debajo): en vez de partir, la tabla
    // COMPLETA se traslada intacta al inicio de la página siguiente -- ni
    // rows ni ningún otro prop se tocan, solo cambia de página. Conserva el
    // MISMO id (no es un fragmento nuevo, es la misma tabla reubicada) y su
    // `linkedGroupId` si ya venía de un split anterior (tabla de 3+
    // páginas); si no tenía ninguno, no se le asigna uno acá -- no hay dos
    // fragmentos que enlazar, solo una tabla que cambió de lugar.
    if (splitAt <= headerOffset) {
      const nextPageIndex = sourcePageIndex + 1;
      const nextPage = ensurePageAt(pages, nextPageIndex, pages[sourcePageIndex], meta);
      const metrics = metricsForPage(nextPage, meta);
      pages[sourcePageIndex] = {
        ...pages[sourcePageIndex],
        elements: pages[sourcePageIndex].elements.filter((element) => element.id !== elementId),
      };
      const relocatedElement: ReportElement = { ...anchor, y: metrics.CONTENT_TOP };
      pages[nextPageIndex] = { ...nextPage, elements: [relocatedElement, ...nextPage.elements] };
      // Posición VIEJA (antes de reubicarla) -- evita que el armado de
      // racimos de pushDownContentAfterChange confunda un solape recién
      // creado por la reubicación en sí con un racimo intencional
      // preexistente (ver el comentario largo de ese parámetro).
      const relocatedPages = pushDownContentAfterChange(pages, meta, elementId, {
        x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height,
      });
      return {
        doc: {
          ...state.doc,
          pages: relocatedPages,
          meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
        },
      };
    }

    // Enlaza los fragmentos como UN solo objeto lógico (pedido explícito
    // 2026-09-10, mismo mecanismo que ya usa el texto partido por
    // auto-paginación, ver `linkedGroupId` en la interfaz de ReportElement):
    // si el origen ya es a su vez la continuación de una tabla anterior
    // (tabla de 3+ páginas), se reutiliza el mismo id para que toda la
    // cadena quede bajo un único grupo -- si no, se genera uno nuevo acá,
    // en el primer split de esta tabla.
    const linkedGroupId = anchor.linkedGroupId || `table-link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const sliceRows = <T,>(arr: T[] | undefined, cut: number): [T[], T[]] =>
      Array.isArray(arr) ? [arr.slice(0, cut), arr.slice(cut)] : [[], []];

    const [keptRows, overflowRows] = sliceRows<string[]>(rows, splitAt);
    const [keptCellBg, overflowCellBg] = sliceRows<string[]>(anchorProps.cellBackgrounds, splitAt);
    const [keptRowBg, overflowRowBg] = sliceRows<string>(anchorProps.rowBackgrounds, splitAt);
    const [keptRowHeights, overflowRowHeights] = sliceRows<number>(anchorProps.rowHeights, splitAt);
    const [keptCellAligns, overflowCellAligns] = sliceRows<string[]>(anchorProps.cellAligns, splitAt);
    // Mismo criterio que `cellAligns` -- color de texto POR CELDA (import
    // de .docx con columnas tipo "Estado" en varios colores, ver
    // `cellTextColors` en tableClipboard.ts/TableBlock.tsx) también debe
    // viajar con su fila al partirse, si no la continuación perdería los
    // colores de las filas que le tocaron.
    const [keptCellTextColors, overflowCellTextColors] = sliceRows<string[]>(anchorProps.cellTextColors, splitAt);

    // Repite la fila de encabezado (contenido, color, alto, fusiones con
    // row===0) al inicio de la continuación -- pedido explícito ("tiene que
    // ser el mismo contenido en el encabezado de la nueva página").
    const continuationRows = hasHeader ? [rows[0], ...overflowRows] : overflowRows;
    const continuationCellBg = hasHeader ? [anchorProps.cellBackgrounds?.[0] || [], ...overflowCellBg] : overflowCellBg;
    const continuationRowBg = hasHeader ? [anchorProps.rowBackgrounds?.[0] || '', ...overflowRowBg] : overflowRowBg;
    const continuationRowHeights = hasHeader ? [anchorProps.rowHeights?.[0] || 0, ...overflowRowHeights] : overflowRowHeights;
    const continuationCellAligns = hasHeader ? [anchorProps.cellAligns?.[0] || [], ...overflowCellAligns] : overflowCellAligns;
    const continuationCellTextColors = hasHeader ? [anchorProps.cellTextColors?.[0] || [], ...overflowCellTextColors] : overflowCellTextColors;

    const headerMerges = hasHeader ? mergedCells.filter((m) => m.row === 0) : [];
    const keptMerges = mergedCells.filter((m) => m.row + m.rowSpan <= splitAt);
    const continuationMerges = [
      ...headerMerges,
      ...mergedCells.filter((m) => m.row >= splitAt).map((m) => ({ ...m, row: m.row - splitAt + headerOffset })),
    ];

    // 1. El bloque de origen se queda solo con las filas que sí caben.
    pages[sourcePageIndex] = {
      ...pages[sourcePageIndex],
      elements: pages[sourcePageIndex].elements.map((element) => (element.id === elementId ? {
        ...element,
        height: Math.max(60, fittingHeightPx + 16),
        linkedGroupId,
        props: {
          ...anchorProps,
          rows: keptRows,
          cellBackgrounds: keptCellBg,
          rowBackgrounds: keptRowBg,
          rowHeights: keptRowHeights,
          cellAligns: keptCellAligns,
          cellTextColors: keptCellTextColors,
          mergedCells: keptMerges,
        },
      } : element)),
    };

    // 2. El resto continúa en una tabla NUEVA al inicio de la página
    // siguiente (creándola si hace falta) -- mismo x/ancho/estilo que la
    // original (todos los demás props de estilo viajan sin tocar via
    // `...anchorProps`), para que se vea como la misma tabla continuando.
    const nextPageIndex = sourcePageIndex + 1;
    const nextPage = ensurePageAt(pages, nextPageIndex, pages[sourcePageIndex], meta);
    const metrics = metricsForPage(nextPage, meta);

    // Bug real reportado en vivo 2026-09-11 ("la tabla genera 2 leyendas" /
    // "antes de seleccionarlo muestra un contenido y al seleccionarlo
    // muestra otro"): `onOverflowRows` (TableBlock.tsx) puede reportar
    // desborde MÁS DE UNA VEZ para el mismo `anchor` -- el callback que
    // recibe (`handleOverflowRows` en PageCanvas.tsx) se recrea en cada
    // render y el propio `ResizeObserver` dispara una medición inicial
    // async apenas se conecta, así que una segunda medición (p.ej. tras
    // asentarse las fuentes) puede volver a considerar que el MISMO anchor
    // desborda, aunque ya se haya partido una vez. Si eso pasa, este mismo
    // bloque de código se ejecuta dos veces y -- antes de este fix --
    // insertaba una SEGUNDA tabla de continuación nueva en la misma
    // posición (mismo `linkedGroupId`, mismo `y`) que la primera, dejando
    // dos fragmentos superpuestos: cuál se ve dependía de cuál pintaba
    // encima (orden en el array), y al seleccionar uno su z-index saltaba
    // por delante del otro -- de ahí que el contenido pareciera "cambiar"
    // al seleccionar. La solución no es evitar la remedición (es legítima:
    // una tabla ya partida puede seguir sin caber si el desborde real era
    // mayor a una página) sino hacer la operación idempotente: si YA existe
    // una continuación de este mismo `anchor` al inicio de la página
    // siguiente, se ACTUALIZA in situ (mismo id) en vez de crear una
    // hermana nueva.
    const existingContinuation = nextPage.elements.find(
      (element) => element.type === 'table' && element.linkedGroupId === linkedGroupId && element.id !== elementId,
    );
    const continuationId = existingContinuation ? existingContinuation.id : `table-continuation-${elementId}-${Date.now()}`;
    const continuationElement: ReportElement = {
      ...anchor,
      id: continuationId,
      y: metrics.CONTENT_TOP,
      height: Math.max(60, overflowHeightPx + 16),
      linkedGroupId,
      props: {
        ...anchorProps,
        rows: continuationRows,
        cellBackgrounds: continuationCellBg,
        rowBackgrounds: continuationRowBg,
        rowHeights: continuationRowHeights,
        cellAligns: continuationCellAligns,
        cellTextColors: continuationCellTextColors,
        mergedCells: continuationMerges,
        // El título/leyenda NO se repite -- solo la fila de encabezado,
        // igual que Word (que repite el encabezado de columnas, no el pie).
        title: '',
        caption: '',
      },
    };
    pages[nextPageIndex] = {
      ...nextPage,
      elements: existingContinuation
        ? nextPage.elements.map((element) => (element.id === continuationId ? continuationElement : element))
        : [continuationElement, ...nextPage.elements],
    };

    // 3. Empujar hacia abajo (en cascada a otra página si hiciera falta)
    // cualquier otro contenido que ya estuviera en esa posición de la
    // página destino -- mismo mecanismo universal que cualquier otro bloque
    // que crece o se inserta (pushDownContentAfterChange).
    const nextPages = pushDownContentAfterChange(pages, meta, continuationId);

    return {
      doc: {
        ...state.doc,
        pages: nextPages,
        meta: { ...state.doc.meta, version: state.doc.meta.version + 1, updatedAt: new Date().toISOString() },
      },
    };
  }),
}));

// ───────────────────────────────────────────────
// HISTORIAL UNDO / REDO
// ───────────────────────────────────────────────

const getHistorySnapshot = (): EditorHistorySnapshot => {
  const state = useEditorStore.getState();

  return {
    doc: JSON.parse(JSON.stringify(state.doc)),
    selectedPage: state.selectedPage,
    selectedElementId: state.selectedElementId,
    selectedElementIds: [...state.selectedElementIds],
  };
};

const undoAction = () => {
  if (useEditorStore.getState().documentLocked) {
    log.warn('[EDITOR_LOCK] Deshacer bloqueado -- el informe cargado está firmado/archivado.');
    return;
  }
  if (historyPast.length === 0) {
    return;
  }

  const current = getHistorySnapshot();
  const previous = historyPast.pop();

  if (!previous) {
    return;
  }

  historyFuture.push(cloneHistorySnapshot(current));

  applyingHistory = true;

  useEditorStore.setState((state) => ({
    doc: previous.doc,
    selectedPage: previous.selectedPage,
    selectedElementId: previous.selectedElementId,
    selectedElementIds: [...previous.selectedElementIds],
    historyVersion: state.historyVersion + 1,
  }));

  applyingHistory = false;
  // Fuerza que la PRÓXIMA edición (aunque llegue de inmediato) abra una
  // entrada nueva en vez de agruparse con lo que se acaba de deshacer --
  // si no, escribir justo después de un Undo podía "perderse" sin dejar
  // forma de deshacerlo a su vez (ver HISTORY_COALESCE_WINDOW_MS arriba).
  lastHistoryChangeAt = 0;
};

const redoAction = () => {
  if (useEditorStore.getState().documentLocked) {
    log.warn('[EDITOR_LOCK] Rehacer bloqueado -- el informe cargado está firmado/archivado.');
    return;
  }
  if (historyFuture.length === 0) {
    return;
  }

  const current = getHistorySnapshot();
  const next = historyFuture.pop();

  if (!next) {
    return;
  }

  historyPast.push(cloneHistorySnapshot(current));

  applyingHistory = true;

  useEditorStore.setState((state) => ({
    doc: next.doc,
    selectedPage: next.selectedPage,
    selectedElementId: next.selectedElementId,
    selectedElementIds: [...next.selectedElementIds],
    historyVersion: state.historyVersion + 1,
  }));

  applyingHistory = false;
  // Mismo motivo que en undoAction: la próxima edición no debe agruparse
  // con lo que se acaba de rehacer.
  lastHistoryChangeAt = 0;
};

const canUndoAction = () => historyPast.length > 0;

const canRedoAction = () => historyFuture.length > 0;

useEditorStore.subscribe((nextState, previousState) => {
  // Undo/Redo ya está manipulando directamente el historial.
  if (applyingHistory) {
    return;
  }

  // Si solo cambió la selección, NO creamos un paso de Undo.
  if (nextState.doc === previousState.doc) {
    return;
  }

  const now = Date.now();
  // Dentro de la ventana de agrupación: este cambio se considera parte de
  // la MISMA acción que el anterior (p.ej. las letras de una misma palabra
  // tecleada en una celda de tabla) -- no se empuja una entrada nueva, la
  // ya empujada al INICIO de esta racha sigue siendo el punto de Undo
  // correcto para todo el grupo.
  const withinBurst = now - lastHistoryChangeAt < HISTORY_COALESCE_WINDOW_MS;
  if (!withinBurst) {
    historyPast.push({
      doc: JSON.parse(JSON.stringify(previousState.doc)),
      selectedPage: previousState.selectedPage,
      selectedElementId: previousState.selectedElementId,
      selectedElementIds: [...previousState.selectedElementIds],
    });

    // Evitar crecimiento ilimitado.
    if (historyPast.length > HISTORY_LIMIT) {
      historyPast.shift();
    }
  }
  lastHistoryChangeAt = now;

  // Una modificación nueva después de Undo invalida Redo.
  historyFuture.length = 0;

  // Reactiva el botón Deshacer/Rehacer del ribbon -- ver el comentario de
  // `historyVersion` en la interfaz de arriba. Vuelve a disparar este mismo
  // `subscribe` una vez más, pero con `nextState.doc === previousState.doc`
  // (solo cambió `historyVersion`), así que el early-return de arriba corta
  // esa segunda pasada antes de llegar aquí -- no hay recursión real.
  useEditorStore.setState((state) => ({ historyVersion: state.historyVersion + 1 }));
});

useEditorStore.setState({
  undo: undoAction,
  redo: redoAction,
  canUndo: canUndoAction,
  canRedo: canRedoAction,
});

// Ayuda de desarrollo/testing: expone el store en window SOLO en dev server
// (import.meta.env.DEV) — permite montar escenarios de prueba E2E (documentos
// con spans/wrapModes específicos) sin depender de flujos de UI frágiles.
// En builds de producción esta rama se elimina por tree-shaking.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__EDITOR_STORE__ = useEditorStore;
}
