/** Mm a px CSS estándar (96 dpi) — coherente con PageCanvas / impresión */
const MM_TO_PX = 3.7795275591;

export interface ReportLayoutMetrics {
  PAGE_WIDTH: number;
  PAGE_HEIGHT: number;
  HEADER_HEIGHT: number;
  FOOTER_HEIGHT: number;
  CONTENT_LEFT: number;
  CONTENT_RIGHT: number;
  CONTENT_TOP: number;
  CONTENT_BOTTOM: number;
  MARGIN_LEFT: number;
  MARGIN_RIGHT: number;
  MARGIN_TOP: number;
  MARGIN_BOTTOM: number;
}

export type LayoutMode = 'document' | 'presentation';
export type PaperSize = 'A4' | 'A3';
export type PageOrientation = 'portrait' | 'landscape';

/** Tamaño de hoja en mm (ancho × alto en orientación vertical/portrait de
 * base) — la orientación horizontal/landscape se resuelve intercambiando
 * ancho y alto más abajo, nunca redefiniendo el tamaño de página en sí. */
const PAPER_SIZES_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

/**
 * Métricas de lienzo según modo (Word-like vs PowerPoint-like), tamaño de
 * hoja (A4/A3) y orientación (portrait/landscape) — el modo 'document' es el
 * único que respeta tamaño/orientación (un "documento" real); 'presentation'
 * mantiene su formato de diapositiva 16:9 fijo, independiente de estos dos
 * parámetros.
 */
export function getReportLayoutMetrics(
  layoutMode: LayoutMode | string | undefined,
  paperSize: PaperSize | string | undefined = 'A4',
  orientation: PageOrientation | string | undefined = 'portrait',
  marginLeft = 36,
  marginRight = 36,
  marginTop = 36,
  marginBottom = 36,
): ReportLayoutMetrics {
  if (layoutMode === 'presentation') {
    // 1280x720 (no 960x540): una diapositiva PowerPoint 16:9 real mide
    // 13.333x7.5 pulgadas -- en PUNTOS (72/pulgada, la unidad que usa
    // PowerPoint internamente) eso da exactamente "960x540", pero este
    // lienzo trabaja en PÍXELES CSS a 96 dpi (ver MM_TO_PX arriba, mismo
    // criterio que el modo 'document'). Usar 960x540 como si fueran
    // píxeles daba un lienzo con la proporción 16:9 correcta pero 25% MÁS
    // CHICO en tamaño real (960px÷96 = 10in de ancho, no las 13.333in de
    // un PPT real) -- bug real reportado 2026-09-04 ("siento que es más
    // chiquito"). 13.333in × 96px/in = 1280px; 7.5in × 96 = 720px. El
    // resto de constantes de este bloque (antes calibradas a ojo sobre el
    // lienzo chico) se escalan por el mismo factor 4/3 (1280/960) para
    // conservar las mismas proporciones de antes, solo que al tamaño
    // real -- ver también `headerElementGeometry` en useEditorStore.ts,
    // escalado igual para el alto del bloque de encabezado.
    const PAGE_WIDTH = 1280;
    const PAGE_HEIGHT = 720;
    const HEADER_HEIGHT = 59;
    const FOOTER_HEIGHT = 48;
    const CONTENT_LEFT = 37;
    const CONTENT_RIGHT = PAGE_WIDTH - CONTENT_LEFT;
    const CONTENT_TOP = HEADER_HEIGHT + 16;
    const CONTENT_BOTTOM = PAGE_HEIGHT - FOOTER_HEIGHT - 16;
    return {
      PAGE_WIDTH,
      PAGE_HEIGHT,
      HEADER_HEIGHT,
      FOOTER_HEIGHT,
      CONTENT_LEFT,
      CONTENT_RIGHT,
      CONTENT_TOP,
      CONTENT_BOTTOM,
      MARGIN_LEFT: CONTENT_LEFT,
      MARGIN_RIGHT: PAGE_WIDTH - CONTENT_RIGHT,
      MARGIN_TOP: CONTENT_TOP,
      MARGIN_BOTTOM: PAGE_HEIGHT - CONTENT_BOTTOM,
    };
  }

  const sizeMm = PAPER_SIZES_MM[paperSize as PaperSize] || PAPER_SIZES_MM.A4;
  const isLandscape = orientation === 'landscape';
  const widthMm = isLandscape ? sizeMm.h : sizeMm.w;
  const heightMm = isLandscape ? sizeMm.w : sizeMm.h;

  const PAGE_WIDTH = widthMm * MM_TO_PX;
  const PAGE_HEIGHT = heightMm * MM_TO_PX;
  const HEADER_HEIGHT = 58;
  const FOOTER_HEIGHT = 48;
  const maxMargin = Math.max(6, PAGE_WIDTH / 2 - 6);
  const MARGIN_LEFT = Math.max(6, Math.min(Number(marginLeft) || 36, maxMargin));
  const MARGIN_RIGHT = Math.max(6, Math.min(Number(marginRight) || 36, maxMargin));
  const maxVerticalMargin = Math.max(6, PAGE_HEIGHT / 2 - 6);
  const MARGIN_TOP = Math.max(6, Math.min(Number(marginTop) || 36, maxVerticalMargin));
  const MARGIN_BOTTOM = Math.max(6, Math.min(Number(marginBottom) || 36, maxVerticalMargin));
  const CONTENT_LEFT = MARGIN_LEFT;
  const CONTENT_RIGHT = PAGE_WIDTH - MARGIN_RIGHT;
  // Los márgenes verticales también deben respetar el espacio reservado por
  // encabezado/pie para que un ajuste global nunca invada el chrome fijo.
  const CONTENT_TOP = Math.max(MARGIN_TOP, HEADER_HEIGHT + 14);
  const CONTENT_BOTTOM = Math.min(PAGE_HEIGHT - MARGIN_BOTTOM, PAGE_HEIGHT - FOOTER_HEIGHT - 14);

  return {
    PAGE_WIDTH,
    PAGE_HEIGHT,
    HEADER_HEIGHT,
    FOOTER_HEIGHT,
    CONTENT_LEFT,
    CONTENT_RIGHT,
    CONTENT_TOP,
    CONTENT_BOTTOM,
    MARGIN_LEFT,
    MARGIN_RIGHT,
    MARGIN_TOP,
    MARGIN_BOTTOM,
  };
}
