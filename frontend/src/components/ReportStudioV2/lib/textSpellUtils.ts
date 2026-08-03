/** Texto demo legado: no debe enviarse a corrección / IA como contenido real. */
export const LEGACY_TEXT_PLACEHOLDER = 'Escribe aquí tu texto técnico...';

export function isEffectivelyEmptyTextBlock(text: unknown): boolean {
  const t = String(text ?? '').trim();
  if (!t) return true;
  if (t === LEGACY_TEXT_PLACEHOLDER) return true;
  return false;
}

/** Texto que se envía al backend (sin placeholder vacío). */
export function textForSpellOrRewrite(text: unknown): string {
  if (isEffectivelyEmptyTextBlock(text)) return '';
  return String(text ?? '');
}
