import { create } from 'zustand';
import { getReportLayoutMetrics } from '../lib/reportLayoutMetrics';
import { REPORT_IMAGE_PLACEHOLDER_SVG } from '../lib/reportImageSrc';

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

/**
 * Aplica un cambio de tamaño de hoja (A4/A3) u orientación (vertical/
 * horizontal) — recalcula la geometría de los bloques "de plataforma" fijos
 * (encabezado, pie de página, carátula a toda hoja) para que sigan
 * ocupando el ancho/alto correcto de la nueva hoja. El resto de bloques
 * (texto, imágenes, tablas, etc.) NO se reposicionan automáticamente —
 * mismo comportamiento que Word al cambiar el tamaño de papel: el usuario
 * ajusta manualmente si algo queda fuera de los márgenes nuevos.
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
  const pages = state.doc.pages.map((page) => ({
    ...page,
    paperSize: undefined,
    orientation: undefined,
    elements: page.elements.map((el) => {
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
      return el;
    }),
  }));
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
    return {
      ...nextPage,
      elements: nextPage.elements.map((el) => {
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
      title: 'Informe Técnico',
      date: new Date().toISOString().slice(0, 10),
      classification: 'CONFIDENCIAL',
      docCode: '',
      bgColor: '',
      textColor: '#ffffff',
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
            : type === 'toc' || type === 'text'
              // Un bloque de texto nuevo ocupa todo el ancho de la columna de
              // contenido (como un párrafo de Word) — antes quedaba fijo en
              // 320px, un recuadro angosto sin relación con el ancho real de
              // la hoja seleccionada (A4/A3, vertical/horizontal).
              ? contentW
              : Math.min(320, contentW),
    height:
      type === 'kpi' ? 110
      : type === 'table' ? 200
      : type === 'sensor' ? 140
      : type === 'toc' ? 340
      : 180,
    zIndex: nextIndex,
    locked: false,
    // Objetos gráficos (tabla, gráfico, KPI, sensor, mapa) ajustan el texto
    // alrededor por defecto, como en Word (ADR-049); texto/toc no aplican.
    ...(type === 'table' || type === 'chart' || type === 'kpi' || type === 'sensor' || type === 'map'
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
  /** Inserta una imagen libre (movible/redimensionable) centrada en la
   * página dada — usado por "Insertar Imagen Empresa" (ADR-048 revisado):
   * a diferencia de `addElement('image', ...)`, NO participa del flujo
   * automático de contenido (que siempre la reposicionaría al tope del
   * área de contenido); se centra en la hoja completa, apropiado para la
   * página de carátula. */
  addCenteredImage: (pageNumber: number, src: string) => void;
  addTextTemplate: (template: string) => void;
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
        // Una página de carátula a toda hoja no lleva encabezado/pie (ver
        // addElement('cover') más abajo) — no hay que backfillearlos aquí.
        const hasCover = page.elements.some((el) => el.type === 'cover');
        if (hasCover) return page;
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
    } catch {
      log.error('useEditorStore.loadDocument: JSON inválido');
    }
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
      const m = metricsFromMeta(state.doc.meta);
      const pages = [...state.doc.pages];
      const selectedIndex = pages.findIndex((page) => page.page_number === state.selectedPage);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : pages.length - 1;

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

        // Con un bloque de contenido seleccionado, el objeto nuevo se ancla
        // A ESA POSICIÓN (como Word inserta en el cursor) en vez de irse al
        // fondo de la página o a una hoja nueva — este era el motivo por el
        // que "no dejaba insertar sobre bloques de texto ya existentes":
        // el flujo automático solo sabía apilar debajo de TODO lo demás.
        const anchor = page.elements.find(
          (el) =>
            el.id === state.selectedElementId &&
            el.type !== 'header' && el.type !== 'footer' && el.type !== 'cover',
        );
        if (anchor) {
          const anchoredY = Math.min(
            Math.max(m.CONTENT_TOP, anchor.y),
            Math.max(m.CONTENT_TOP, m.CONTENT_BOTTOM - element.height),
          );
          return { fits: true, element: { ...element, y: anchoredY, x: m.CONTENT_LEFT } };
        }

        // Encabezado/pie de página son elementos fijos de plataforma (ADR-046)
        // anclados fuera del área de contenido — no deben contar para el
        // "punto más bajo ocupado" o cada página nueva empezaría a apilar
        // contenido a la altura del pie de página en vez de justo debajo del
        // encabezado.
        const contentElements = page.elements.filter((el) => el.type !== 'header' && el.type !== 'footer');
        const maxBottom = contentElements.length
          ? Math.max(...contentElements.map((existing) => existing.y + existing.height))
          : m.CONTENT_TOP - INSERT_GAP;
        const nextY = Math.max(m.CONTENT_TOP, maxBottom + INSERT_GAP);
        const positionedElement = { ...element, y: nextY, x: m.CONTENT_LEFT };
        const fits = nextY + positionedElement.height <= m.CONTENT_BOTTOM;
        return { fits, element: positionedElement };
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

      const activePage = pages[currentIndex];

      // La carátula ocupa TODA la hoja (x=0,y=0, PAGE_WIDTH x PAGE_HEIGHT,
      // ver createElement) — no pasa por el flujo de contenido normal
      // (placeElementInPage la reposicionaría a CONTENT_LEFT/CONTENT_TOP) y
      // reemplaza el encabezado/pie automático de esa página (ADR-046): una
      // portada a toda página no convive con la franja de encabezado/pie,
      // igual que "primera página diferente" en Word.
      if (type === 'cover') {
        const coverElement = createElement('cover', activePage.page_number, activePage.elements.length, m);
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
