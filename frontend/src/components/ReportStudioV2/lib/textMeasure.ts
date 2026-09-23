/* ── Medidor de texto singleton + caché de anchos de palabra ──────────────
   Patrón tomado del motor de ONLYOffice (sdkjs): un ÚNICO medidor
   compartido (`g_oTextMeasurer`, Run.js) en vez de crear un <canvas> por
   llamada, y anchos cacheados por (fuente, texto) en vez de re-medir lo
   mismo en cada tecla (grapheme.js/file.js cachean por glifo; aquí basta
   granularidad de palabra). Extraído de PageCanvas.tsx para que
   lib/textPagination.ts (partición de bloques al llegar al margen inferior)
   pueda reutilizar el mismo medidor/caché en vez de crear uno propio. */

let sharedMeasureCtx: CanvasRenderingContext2D | null = null;

export function getSharedMeasureCtx(): CanvasRenderingContext2D | null {
  if (sharedMeasureCtx) return sharedMeasureCtx;
  if (typeof document === 'undefined') return null;
  sharedMeasureCtx = document.createElement('canvas').getContext('2d');
  return sharedMeasureCtx;
}

const WORD_WIDTH_CACHE_MAX = 20000;
const wordWidthCache = new Map<string, number>();

export function measureWordCached(context: CanvasRenderingContext2D, fontSpec: string, word: string): number {
  const key = `${fontSpec} ${word}`;
  const hit = wordWidthCache.get(key);
  if (hit !== undefined) return hit;
  const width = context.measureText(word).width;
  if (wordWidthCache.size >= WORD_WIDTH_CACHE_MAX) wordWidthCache.clear();
  wordWidthCache.set(key, width);
  return width;
}
