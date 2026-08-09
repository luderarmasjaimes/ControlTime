export type ListStyleType = 'none' | 'bullet' | 'number';

/** Quita cualquier marcador de lista (viñeta o número) ya presente al
 * principio de cada línea — necesario antes de aplicar un tipo de lista
 * distinto al actual (p.ej. pasar de viñetas a numerada no debía dejar el
 * "• " viejo debajo del "1. " nuevo). */
export function stripListMarkers(rawText: string): string {
  return rawText
    .split('\n')
    .map((line) => line.replace(/^(•\s*|\d+\.\s*)/, ''))
    .join('\n');
}

/** Aplica (o quita, con `listType: 'none'`) marcadores de lista línea por
 * línea sobre el texto plano del bloque — el marcador es texto literal
 * (no un `::before` CSS) porque el bloque puede renderizarse como <Text>
 * de Konva, que no soporta pseudo-elementos por línea. */
export function applyListToText(rawText: string, listType: ListStyleType): string {
  const stripped = stripListMarkers(rawText);
  if (listType === 'none') return stripped;

  const lines = stripped.split('\n');
  if (listType === 'bullet') {
    return lines.map((line) => (line.trim() ? `• ${line}` : line)).join('\n');
  }
  return lines.map((line, index) => (line.trim() ? `${index + 1}. ${line}` : line)).join('\n');
}
