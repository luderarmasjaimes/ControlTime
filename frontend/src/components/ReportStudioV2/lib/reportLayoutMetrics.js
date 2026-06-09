/** Mm a px CSS estándar (96 dpi) — coherente con PageCanvas / impresión */
const MM_TO_PX = 3.7795275591;

/**
 * Métricas de lienzo según modo (Word-like vs PowerPoint-like).
 * @param {'document'|'presentation'} layoutMode
 */
export function getReportLayoutMetrics(layoutMode) {
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

  const PAGE_WIDTH = 210 * MM_TO_PX;
  const PAGE_HEIGHT = 297 * MM_TO_PX;
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
