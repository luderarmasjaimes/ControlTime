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
): ReportLayoutMetrics {
  if (layoutMode === 'presentation') {
    const PAGE_WIDTH = 960;
    const PAGE_HEIGHT = 540;
    const HEADER_HEIGHT = 44;
    const FOOTER_HEIGHT = 36;
    const CONTENT_LEFT = 28;
    const CONTENT_RIGHT = PAGE_WIDTH - CONTENT_LEFT;
    const CONTENT_TOP = HEADER_HEIGHT + 12;
    const CONTENT_BOTTOM = PAGE_HEIGHT - FOOTER_HEIGHT - 12;
    return {
      PAGE_WIDTH,
      PAGE_HEIGHT,
      HEADER_HEIGHT,
      FOOTER_HEIGHT,
      CONTENT_LEFT,
      CONTENT_RIGHT,
      CONTENT_TOP,
      CONTENT_BOTTOM,
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
  const CONTENT_LEFT = 36;
  const CONTENT_RIGHT = PAGE_WIDTH - 36;
  const CONTENT_TOP = HEADER_HEIGHT + 14;
  const CONTENT_BOTTOM = PAGE_HEIGHT - FOOTER_HEIGHT - 14;

  return {
    PAGE_WIDTH,
    PAGE_HEIGHT,
    HEADER_HEIGHT,
    FOOTER_HEIGHT,
    CONTENT_LEFT,
    CONTENT_RIGHT,
    CONTENT_TOP,
    CONTENT_BOTTOM,
  };
}
