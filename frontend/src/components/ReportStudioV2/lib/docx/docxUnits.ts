/**
 * Conversión de unidades entre el modelo del lienzo (px CSS @96dpi, mismas
 * unidades que `ReportElement.x/y/width/height` y `reportLayoutMetrics.ts`)
 * y las unidades que exige OOXML/Word:
 *  - twips (1/1440 pulgada) para posiciones/tamaños de frame, tabla y página.
 *  - EMU (1/914400 pulgada) para el offset de imágenes flotantes (DrawingML).
 *  - medios-punto para tamaño de fuente (`TextRun.size`).
 *
 * 96px = 1 pulgada, así que:
 *   1px = 1440/96 twips = 15 twips (exacto)
 *   1px = 914400/96 EMU = 9525 EMU (exacto)
 *   1px = 72/96 pt = 0.75pt -> 1.5 medios-punto
 */
export const PX_TO_TWIP = 15;
export const PX_TO_EMU = 9525;
export const PX_TO_HALF_PT = 1.5;

export const pxToTwip = (px: number): number => Math.round((Number(px) || 0) * PX_TO_TWIP);
export const pxToEmu = (px: number): number => Math.round((Number(px) || 0) * PX_TO_EMU);
/** Tamaño de fuente en medios-punto (`TextRun.size`), con piso de 2 (1pt) para no producir texto de tamaño 0 con entradas corruptas/vacías. */
export const pxFontToHalfPt = (px: number | undefined | null): number =>
  Math.max(2, Math.round((Number(px) || 14) * PX_TO_HALF_PT));

/** Normaliza un color CSS (`#rgb`, `#rrggbb`, `rgb(...)`, nombre) a hex de 6
 * dígitos SIN `#` (formato que exige `docx` en `color`/`shading.fill`).
 * Entradas no reconocibles caen al color por defecto dado. */
export function cssColorToHex(value: unknown, fallback = '000000'): string {
  const v = String(value ?? '').trim();
  if (!v) return fallback;
  const hex6 = /^#?([0-9a-fA-F]{6})$/.exec(v);
  if (hex6) return hex6[1].toUpperCase();
  const hex3 = /^#?([0-9a-fA-F]{3})$/.exec(v);
  if (hex3) {
    const [r, g, b] = hex3[1].split('');
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.max(0, Math.min(255, Number(n))));
    return [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  if (v.toLowerCase() === 'transparent') return fallback;
  return fallback;
}

/** Primer nombre de una lista `font-family` CSS ("Arial, sans-serif" -> "Arial"), sin comillas. */
export function firstFontFamily(value: unknown, fallback = 'Arial'): string {
  const v = String(value ?? '').trim();
  if (!v) return fallback;
  return v.split(',')[0].replace(/['"]/g, '').trim() || fallback;
}
