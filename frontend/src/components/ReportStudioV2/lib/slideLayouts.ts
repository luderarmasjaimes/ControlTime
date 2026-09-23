/**
 * Galería de diseños de diapositiva (modo presentación / PPT) — mismo
 * espíritu que lib/coverTemplates.ts (variedad visual real: cada entrada es
 * un diseño distinto, no una etiqueta distinta sobre el mismo fondo), pero
 * para diapositivas de CONTENIDO en cualquier punto de la presentación, no
 * solo la carátula. Elegir un diseño de la galería REEMPLAZA los elementos
 * de contenido de la diapositiva ACTUAL con los placeholders de este
 * diseño — mismo criterio que la galería de "Diseño" de PowerPoint.
 */
import type { ElementBorder, ReportElement } from '../store/useEditorStore';
import { defaultBorderByType } from '../store/useEditorStore';
import type { ReportLayoutMetrics } from './reportLayoutMetrics';
import { REPORT_IMAGE_PLACEHOLDER_SVG } from './reportImageSrc';

export type SlideLayoutKind =
  | 'title-center'
  | 'title-bar-top'
  | 'section-divider'
  | 'title-content'
  | 'two-column'
  | 'agenda'
  | 'quote'
  | 'stat'
  | 'image-caption'
  | 'closing';

export interface SlideLayoutTemplate {
  id: string;
  label: string;
  desc: string;
  kind: SlideLayoutKind;
  bgColor: string;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  /** false = diseño "a sangre" (el fondo cubre toda la diapositiva, como
   * una carátula real): se reemplaza también el encabezado/pie fijo, que
   * se vería fuera de lugar encima de un fondo oscuro o de color — mismo
   * criterio que ya usa la carátula real del informe (buildCoverPage en
   * lib/documentTemplates.ts, que tampoco lleva encabezado/pie). true
   * (default) = diapositiva de contenido normal, conserva el encabezado/
   * pie existente de la diapositiva. */
  keepChrome?: boolean;
}

export const SLIDE_LAYOUT_TEMPLATES: SlideLayoutTemplate[] = [
  {
    id: 'title-executive',
    label: 'Título Ejecutivo',
    desc: 'Portada de sección — azul noche + dorado',
    kind: 'title-center',
    bgColor: '#0f172a',
    accentColor: '#fbbf24',
    textColor: '#ffffff',
    mutedColor: '#cbd5e1',
    keepChrome: false,
  },
  {
    id: 'title-corporate',
    label: 'Título Corporativo',
    desc: 'Barra lateral azul, fondo claro',
    kind: 'title-bar-top',
    bgColor: '#ffffff',
    accentColor: '#2563eb',
    textColor: '#0f172a',
    mutedColor: '#64748b',
    keepChrome: true,
  },
  {
    id: 'section-dark',
    label: 'Sección — Oscura',
    desc: 'Divisor de capítulo, carbón + cian',
    kind: 'section-divider',
    bgColor: '#111827',
    accentColor: '#22d3ee',
    textColor: '#ffffff',
    mutedColor: '#9ca3af',
    keepChrome: false,
  },
  {
    id: 'section-vivid',
    label: 'Sección — Vivo',
    desc: 'Divisor de capítulo, naranja intenso',
    kind: 'section-divider',
    bgColor: '#c2410c',
    accentColor: '#fed7aa',
    textColor: '#ffffff',
    mutedColor: '#ffedd5',
    keepChrome: false,
  },
  {
    id: 'content-formal',
    label: 'Contenido Formal',
    desc: 'Serif institucional, granate',
    kind: 'title-content',
    bgColor: '#fffaf5',
    accentColor: '#7c2d12',
    textColor: '#1c1917',
    mutedColor: '#78716c',
    keepChrome: true,
  },
  {
    id: 'content-minimal',
    label: 'Contenido Minimalista',
    desc: 'Blanco puro, un solo acento gris',
    kind: 'title-content',
    bgColor: '#ffffff',
    accentColor: '#94a3b8',
    textColor: '#0f172a',
    mutedColor: '#64748b',
    keepChrome: true,
  },
  {
    id: 'two-column-corporate',
    label: 'Dos Columnas',
    desc: 'Comparación lado a lado',
    kind: 'two-column',
    bgColor: '#f8fafc',
    accentColor: '#2563eb',
    textColor: '#0f172a',
    mutedColor: '#64748b',
    keepChrome: true,
  },
  {
    id: 'agenda-executive',
    label: 'Agenda Ejecutiva',
    desc: 'Lista numerada, pizarra + ámbar',
    kind: 'agenda',
    bgColor: '#1e293b',
    accentColor: '#f59e0b',
    textColor: '#ffffff',
    mutedColor: '#cbd5e1',
    keepChrome: false,
  },
  {
    id: 'quote-highlight',
    label: 'Cita Destacada',
    desc: 'Frase grande, índigo profundo',
    kind: 'quote',
    bgColor: '#3730a3',
    accentColor: '#c7d2fe',
    textColor: '#ffffff',
    mutedColor: '#e0e7ff',
    keepChrome: false,
  },
  {
    id: 'stat-highlight',
    label: 'Dato Destacado',
    desc: 'Número grande tipo KPI, verde',
    kind: 'stat',
    bgColor: '#065f46',
    accentColor: '#6ee7b7',
    textColor: '#ffffff',
    mutedColor: '#a7f3d0',
    keepChrome: false,
  },
  {
    id: 'image-caption-light',
    label: 'Imagen + Texto',
    desc: 'Imagen con descripción, barra celeste',
    kind: 'image-caption',
    bgColor: '#ffffff',
    accentColor: '#0891b2',
    textColor: '#0f172a',
    mutedColor: '#64748b',
    keepChrome: true,
  },
  {
    id: 'closing-executive',
    label: 'Cierre / Gracias',
    desc: 'Última diapositiva, azul noche + dorado',
    kind: 'closing',
    bgColor: '#0f172a',
    accentColor: '#fbbf24',
    textColor: '#ffffff',
    mutedColor: '#cbd5e1',
    keepChrome: false,
  },
];

export function findSlideLayout(id: string): SlideLayoutTemplate | undefined {
  return SLIDE_LAYOUT_TEMPLATES.find((t) => t.id === id);
}

let uidCounter = 0;
function nextId(pageNumber: number, tag: string): string {
  uidCounter += 1;
  return `slide-${tag}-${pageNumber}-${Date.now()}-${uidCounter}`;
}

const NO_BORDER: ElementBorder = { enabled: false, width: 1, style: 'solid', color: '#a9b8d3' };

const baseText = {
  fontFamily: 'Arial',
  backgroundColor: 'transparent',
  listType: 'none',
  bold: false,
  italic: false,
  underline: false,
  spans: [],
};

function textEl(
  pageNumber: number,
  zIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  opts: {
    fontSize: number;
    color: string;
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    italic?: boolean;
    fontFamily?: string;
    lineHeight?: number;
  },
): ReportElement {
  return {
    id: nextId(pageNumber, 't'),
    type: 'text',
    x, y, width, height,
    zIndex,
    locked: false,
    props: {
      ...baseText,
      text,
      fontSize: opts.fontSize,
      fontColor: opts.color,
      textAlign: opts.align || 'left',
      bold: opts.bold ?? false,
      italic: opts.italic ?? false,
      fontFamily: opts.fontFamily || 'Arial',
      lineHeight: opts.lineHeight ?? 1.3,
    },
    border: NO_BORDER,
  };
}

function rectEl(pageNumber: number, zIndex: number, x: number, y: number, width: number, height: number, fill: string): ReportElement {
  return {
    id: nextId(pageNumber, 'r'),
    type: 'shape',
    x, y, width, height,
    zIndex,
    locked: true,
    // 'infront' (el default de una forma normal insertada por el ribbon,
    // pensado para un ícono chico que flota SOBRE un párrafo) hace que
    // PageCanvas.tsx la redibuje en un pase final que la pone encima de
    // TODO, incluido el texto -- para un fondo a sangre o una barra de
    // acento (pensados para ir DETRÁS del contenido) eso tapaba el texto
    // por completo (bug real encontrado en vivo). 'behind' es lo correcto
    // acá: la forma se dibuja y el texto queda siempre por encima.
    wrapMode: 'behind',
    props: { shapeType: 'rectangle', fill, stroke: 'transparent', strokeWidth: 0, opacity: 1 },
    border: NO_BORDER,
  };
}

function circleEl(pageNumber: number, zIndex: number, x: number, y: number, diameter: number, fill: string, opacity: number): ReportElement {
  return {
    id: nextId(pageNumber, 'c'),
    type: 'shape',
    x, y, width: diameter, height: diameter,
    zIndex,
    locked: true,
    wrapMode: 'behind',
    props: { shapeType: 'circle', fill, stroke: 'transparent', strokeWidth: 0, opacity },
    border: NO_BORDER,
  };
}

/** Textos personalizables de cada `kind` -- sin overrides, cada campo cae a
 * su placeholder genérico de siempre (uso desde la galería: aplicar UN
 * diseño a la diapositiva actual); con overrides (uso desde
 * `buildSlideLayoutDeckSpecs`, generación de las 5 diapositivas de un
 * tema), cada diapositiva del set trae su propio texto entre corchetes
 * para reemplazar, en vez de repetir el mismo placeholder genérico 5 veces. */
export interface SlideTextOverrides {
  title?: string;
  subtitle?: string;
  body?: string;
  caption?: string;
  stat?: string;
  statLabel?: string;
  quote?: string;
  attribution?: string;
  closingMain?: string;
  closingContact?: string;
  agenda?: string;
}

/**
 * Genera los elementos de CONTENIDO (sin encabezado/pie -- eso lo decide el
 * llamador vía `layout.keepChrome`, ver useEditorStore.ts::applySlideLayout)
 * para `layout` en una diapositiva de tamaño `m`.
 */
export function buildSlideLayoutElements(
  layout: SlideLayoutTemplate,
  m: ReportLayoutMetrics,
  pageNumber: number,
  overrides: SlideTextOverrides = {},
): ReportElement[] {
  const els: ReportElement[] = [];
  const contentW = m.CONTENT_RIGHT - m.CONTENT_LEFT;
  const contentH = m.CONTENT_BOTTOM - m.CONTENT_TOP;

  // Fondo a sangre en TODOS los diseños -- un fondo blanco liso equivale a
  // "sin fondo" visualmente, así que no hace falta un caso especial para
  // omitirlo en los diseños claros.
  els.push(rectEl(pageNumber, 0, 0, 0, m.PAGE_WIDTH, m.PAGE_HEIGHT, layout.bgColor));

  const isFormal = layout.id === 'content-formal';
  const bodyFont = isFormal ? "Georgia, 'Times New Roman', serif" : 'Arial';

  switch (layout.kind) {
    case 'title-center': {
      const titleY = m.PAGE_HEIGHT / 2 - 70;
      els.push(rectEl(pageNumber, 1, m.PAGE_WIDTH / 2 - 60, titleY - 24, 120, 6, layout.accentColor));
      els.push(textEl(pageNumber, 2, m.CONTENT_LEFT, titleY, contentW, 80, overrides.title ?? 'Título de la diapositiva', {
        fontSize: 40, color: layout.textColor, align: 'center', bold: true,
      }));
      els.push(textEl(pageNumber, 3, m.CONTENT_LEFT, titleY + 90, contentW, 40, overrides.subtitle ?? 'Subtítulo o descripción breve', {
        fontSize: 18, color: layout.mutedColor, align: 'center',
      }));
      break;
    }
    case 'title-bar-top': {
      els.push(rectEl(pageNumber, 1, 0, 0, 10, m.PAGE_HEIGHT, layout.accentColor));
      els.push(textEl(pageNumber, 2, m.CONTENT_LEFT, m.PAGE_HEIGHT / 2 - 60, contentW, 70, overrides.title ?? 'Título de la diapositiva', {
        fontSize: 34, color: layout.textColor, bold: true,
      }));
      els.push(textEl(pageNumber, 3, m.CONTENT_LEFT, m.PAGE_HEIGHT / 2 + 20, contentW, 40, overrides.subtitle ?? 'Subtítulo o descripción breve', {
        fontSize: 16, color: layout.mutedColor,
      }));
      break;
    }
    case 'section-divider': {
      els.push(rectEl(pageNumber, 1, m.CONTENT_LEFT, m.PAGE_HEIGHT / 2 - 50, 70, 6, layout.accentColor));
      els.push(textEl(pageNumber, 2, m.CONTENT_LEFT, m.PAGE_HEIGHT / 2 - 20, contentW, 90, overrides.title ?? 'Nombre de la sección', {
        fontSize: 42, color: layout.textColor, bold: true,
      }));
      break;
    }
    case 'title-content': {
      els.push(rectEl(pageNumber, 1, m.CONTENT_LEFT, m.CONTENT_TOP, 50, 5, layout.accentColor));
      els.push(textEl(pageNumber, 2, m.CONTENT_LEFT, m.CONTENT_TOP + 14, contentW, 44, overrides.title ?? 'Título de la diapositiva', {
        fontSize: 28, color: layout.textColor, bold: true, fontFamily: bodyFont,
      }));
      els.push(textEl(
        pageNumber, 3, m.CONTENT_LEFT, m.CONTENT_TOP + 70, contentW, contentH - 70,
        overrides.body ?? '• Primer punto clave\n• Segundo punto clave\n• Tercer punto clave',
        { fontSize: 18, color: layout.textColor, lineHeight: 1.6, fontFamily: bodyFont },
      ));
      break;
    }
    case 'two-column': {
      els.push(textEl(pageNumber, 1, m.CONTENT_LEFT, m.CONTENT_TOP, contentW, 44, overrides.title ?? 'Título de la diapositiva', {
        fontSize: 28, color: layout.textColor, bold: true,
      }));
      const colTop = m.CONTENT_TOP + 70;
      const colH = m.CONTENT_BOTTOM - colTop;
      const colW = (contentW - 40) / 2;
      els.push(rectEl(pageNumber, 2, m.CONTENT_LEFT + colW + 18, colTop, 4, colH, layout.accentColor));
      els.push(textEl(pageNumber, 3, m.CONTENT_LEFT, colTop, colW, colH, 'Columna izquierda\n\n• Punto 1\n• Punto 2', {
        fontSize: 16, color: layout.textColor, lineHeight: 1.5,
      }));
      els.push(textEl(pageNumber, 4, m.CONTENT_LEFT + colW + 40, colTop, colW, colH, 'Columna derecha\n\n• Punto 1\n• Punto 2', {
        fontSize: 16, color: layout.textColor, lineHeight: 1.5,
      }));
      break;
    }
    case 'agenda': {
      els.push(textEl(pageNumber, 1, m.CONTENT_LEFT, m.CONTENT_TOP, contentW, 50, overrides.title ?? 'Agenda', {
        fontSize: 32, color: layout.textColor, bold: true,
      }));
      els.push(textEl(
        pageNumber, 2, m.CONTENT_LEFT, m.CONTENT_TOP + 70, contentW, contentH - 70,
        overrides.agenda ?? '1. Primer punto de la agenda\n2. Segundo punto de la agenda\n3. Tercer punto de la agenda\n4. Cuarto punto de la agenda',
        { fontSize: 20, color: layout.textColor, lineHeight: 1.9 },
      ));
      break;
    }
    case 'quote': {
      els.push(textEl(pageNumber, 1, m.CONTENT_LEFT + 30, m.PAGE_HEIGHT / 2 - 100, 60, 70, '"', {
        fontSize: 90, color: layout.accentColor, bold: true,
      }));
      els.push(textEl(
        pageNumber, 2, m.CONTENT_LEFT + 90, m.PAGE_HEIGHT / 2 - 90, contentW - 180, 130,
        overrides.quote ?? 'Escribe aquí la cita o frase destacada de la diapositiva.',
        { fontSize: 26, color: layout.textColor, align: 'center', italic: true, lineHeight: 1.4 },
      ));
      els.push(textEl(pageNumber, 3, m.CONTENT_LEFT + 90, m.PAGE_HEIGHT / 2 + 60, contentW - 180, 30, overrides.attribution ?? '— Autor o fuente', {
        fontSize: 15, color: layout.mutedColor, align: 'center',
      }));
      break;
    }
    case 'stat': {
      els.push(textEl(pageNumber, 1, m.CONTENT_LEFT, m.PAGE_HEIGHT / 2 - 110, contentW, 130, overrides.stat ?? '85%', {
        fontSize: 96, color: layout.textColor, align: 'center', bold: true,
      }));
      els.push(rectEl(pageNumber, 2, m.PAGE_WIDTH / 2 - 40, m.PAGE_HEIGHT / 2 + 20, 80, 4, layout.accentColor));
      els.push(textEl(pageNumber, 3, m.CONTENT_LEFT, m.PAGE_HEIGHT / 2 + 36, contentW, 40, overrides.statLabel ?? 'Descripción del indicador', {
        fontSize: 18, color: layout.mutedColor, align: 'center',
      }));
      break;
    }
    case 'image-caption': {
      els.push(textEl(pageNumber, 1, m.CONTENT_LEFT, m.CONTENT_TOP, contentW, 40, overrides.title ?? 'Título de la diapositiva', {
        fontSize: 26, color: layout.textColor, bold: true,
      }));
      const imgW = Math.min(560, contentW);
      const imgH = Math.round(imgW * 9 / 16);
      const imgX = m.CONTENT_LEFT + (contentW - imgW) / 2;
      const imgY = m.CONTENT_TOP + 60;
      // Formas decorativas DETRÁS de la imagen (pedido explícito: "espacio
      // para colocar imágenes con formas detrás... círculos, cuadrados") --
      // un círculo grande asomando por la esquina superior izquierda y un
      // cuadrado chico por la inferior derecha, en el color de acento del
      // tema, bien atrás en el z-order para no competir con la imagen ni el
      // texto.
      els.push(circleEl(pageNumber, 1, imgX - 46, imgY - 46, 110, layout.accentColor, 0.35));
      els.push(rectEl(pageNumber, 1, imgX + imgW - 30, imgY + imgH - 30, 60, 60, layout.accentColor));
      els.push(rectEl(pageNumber, 2, imgX - 4, imgY - 4, imgW + 8, 4, layout.accentColor));
      els.push({
        id: nextId(pageNumber, 'img'),
        type: 'image',
        x: imgX, y: imgY, width: imgW, height: imgH,
        zIndex: 3,
        locked: false,
        src: REPORT_IMAGE_PLACEHOLDER_SVG,
        objectFit: 'cover',
        wrapMode: 'square',
        props: { alt: 'Imagen de la diapositiva', caption: '', includeInToc: false },
        border: defaultBorderByType('image'),
      });
      els.push(textEl(pageNumber, 4, m.CONTENT_LEFT, imgY + imgH + 16, contentW, 30, overrides.caption ?? 'Descripción o pie de imagen', {
        fontSize: 14, color: layout.mutedColor, align: 'center', italic: true,
      }));
      break;
    }
    case 'closing': {
      els.push(textEl(pageNumber, 1, m.CONTENT_LEFT, m.PAGE_HEIGHT / 2 - 60, contentW, 70, overrides.closingMain ?? 'Gracias', {
        fontSize: 44, color: layout.textColor, align: 'center', bold: true,
      }));
      els.push(rectEl(pageNumber, 2, m.PAGE_WIDTH / 2 - 40, m.PAGE_HEIGHT / 2 + 20, 80, 4, layout.accentColor));
      els.push(textEl(pageNumber, 3, m.CONTENT_LEFT, m.PAGE_HEIGHT / 2 + 40, contentW, 30, overrides.closingContact ?? 'contacto@empresa.com', {
        fontSize: 16, color: layout.mutedColor, align: 'center',
      }));
      break;
    }
  }

  return els;
}

/**
 * 5 diapositivas de un "mini deck" con la MISMA temática de color que
 * `layout` (pedido explícito: "que generen varias hojas... con la misma
 * temática del diseño elegido... texto para reemplazar como [AQUÍ VA TU
 * TÍTULO]... para que no se sienta vacía"): título, contenido, imagen,
 * dato destacado y cierre -- un esqueleto de presentación estándar,
 * independiente del `kind` puntual que tenga `layout` (se ignora a
 * propósito acá; solo se reutilizan sus colores), con placeholders entre
 * corchetes en vez de los genéricos de `buildSlideLayoutElements` sin
 * overrides.
 */
export function buildSlideLayoutDeckSpecs(layout: SlideLayoutTemplate): { layout: SlideLayoutTemplate; overrides: SlideTextOverrides }[] {
  const withKind = (kind: SlideLayoutKind, keepChrome: boolean): SlideLayoutTemplate => ({ ...layout, kind, keepChrome });
  return [
    {
      layout: withKind('title-center', false),
      overrides: { title: '[AQUÍ VA TU TÍTULO]', subtitle: '[Subtítulo del proyecto]' },
    },
    {
      layout: withKind('title-content', true),
      overrides: { title: '[Introducción]', body: '• [Punto clave 1]\n• [Punto clave 2]\n• [Punto clave 3]' },
    },
    {
      layout: withKind('image-caption', true),
      overrides: { title: '[Sección con imagen]', caption: '[Descripción de la imagen]' },
    },
    {
      layout: withKind('stat', false),
      overrides: { stat: '[00%]', statLabel: '[Descripción del dato clave]' },
    },
    {
      layout: withKind('closing', false),
      overrides: { closingMain: '[Gracias]', closingContact: '[Nombres]   ·   [Año]' },
    },
  ];
}
