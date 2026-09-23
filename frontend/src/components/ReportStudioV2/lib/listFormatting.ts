export type ListStyleType = 'none' | 'bullet' | 'number';

/** Un caracter TAB al inicio de una linea = un nivel de sangria (SCRUM-31:
 * listas multinivel con sangria real, 1. -> a. -> i.). Vive ANTES del
 * marcador visible ("• " o "1. ") en el texto plano guardado -- el bloque
 * sigue siendo un string plano de una sola linea por item (no se rediseño
 * el modelo de datos a un arreglo de parrafos), asi que la profundidad de
 * cada linea viaja codificada en su propio texto en vez de en un campo
 * aparte. Tab/Shift+Tab (ver PageCanvas.tsx::indentActiveListLine) suman o
 * restan un TAB a la linea donde esta el cursor; togglear el tipo de lista
 * o escribir texto nuevo no toca estos TAB iniciales.
 */
const DEPTH_CHAR = '\t';
const MAX_DEPTH = 4;

function lineDepth(line: string): number {
  let depth = 0;
  while (depth < line.length && line[depth] === DEPTH_CHAR) depth += 1;
  return depth;
}

/** Cuántos "caracteres de ancho" vale un TAB de sangría al RENDERIZARSE --
 * mismo valor que se usa como `tab-size` CSS del textarea de edición
 * (PageCanvas.tsx) y como cantidad de espacios literales que reemplazan
 * cada TAB para el <Text> de Konva (ver depthTabsToDisplaySpaces). Un solo
 * número compartido para que la sangría se vea IGUAL editando que fuera de
 * edición -- antes cada vista dejaba que su propio motor de texto decidiera
 * el ancho de un "\t" (el navegador usa tab-size:8 por defecto en un
 * textarea; Canvas/Konva no tiene noción de tab-stops y dibuja el glifo de
 * ese carácter tal cual, mucho más angosto) y las dos vistas terminaban
 * con sangrías de ancho visualmente distinto para la misma profundidad.
 */
export const LIST_INDENT_TAB_SIZE = 4;

/** Convierte los TAB de sangría al INICIO de cada línea (antes del
 * contenido/marcador) en espacios literales -- Konva dibuja texto sobre un
 * <canvas> (vía CanvasRenderingContext2D.fillText), que no implementa
 * tab-stops como el layout de texto HTML/CSS: un "\t" ahí se pinta con el
 * glifo que el font tenga para ese carácter, casi siempre mucho más
 * angosto que el `tab-size` de un textarea. Espacios literales sí miden y
 * dibujan de forma predecible en canvas, y por especificación CSS
 * `tab-size: N` equivale exactamente al ancho de N espacios -- por eso
 * usar el mismo N (LIST_INDENT_TAB_SIZE) en ambos lados hace que la
 * sangría se vea idéntica editando (textarea) y fuera de edición (Konva). */
export function depthTabsToDisplaySpaces(text: string, spacesPerLevel: number = LIST_INDENT_TAB_SIZE): string {
  return text
    .split('\n')
    .map((line) => {
      const depth = lineDepth(line);
      if (depth === 0) return line;
      return ' '.repeat(depth * spacesPerLevel) + line.slice(depth);
    })
    .join('\n');
}

/** a, b, ..., z, aa, ab, ... (como el numerado alfabetico de Word/Excel). */
function toAlpha(n: number): string {
  let s = '';
  let rem = n;
  while (rem > 0) {
    const digit = (rem - 1) % 26;
    s = String.fromCharCode(97 + digit) + s;
    rem = Math.floor((rem - 1) / 26);
  }
  return s;
}

const ROMAN_TABLE: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];
function toRoman(n: number): string {
  let rem = n;
  let out = '';
  for (const [value, symbol] of ROMAN_TABLE) {
    while (rem >= value) { out += symbol; rem -= value; }
  }
  return out;
}

/** Estilo de numeracion por nivel, cíclico cada 3 niveles -- mismo criterio
 * que Word: 1/2/3 -> a/b/c -> i/ii/iii -> 1/2/3 otra vez en el nivel 4. */
function numberMarkerForDepth(depth: number, n: number): string {
  const cycle = depth % 3;
  if (cycle === 0) return `${n}.`;
  if (cycle === 1) return `${toAlpha(n)}.`;
  return `${toRoman(n)}.`;
}

/** Viñeta por nivel -- alterna solido/hueco/cuadrado como Word en vez de
 * repetir el mismo "•" en todos los niveles, para que la jerarquia se note
 * de un vistazo ademas de por la sangria. */
function bulletMarkerForDepth(depth: number): string {
  const cycle = depth % 3;
  if (cycle === 0) return '•';
  if (cycle === 1) return '◦';
  return '▪';
}

/** Marcador visible de lista (viñeta o número/letra/romano) al inicio del
 * CONTENIDO de una línea (después de sus TAB de sangría) — única definición
 * compartida por stripListMarkers/applyListToText/visibleMarkerLength, para
 * no tener el mismo patrón triplicado y arriesgar que diverjan. */
const LIST_MARKER_RE = /^(•\s*|◦\s*|▪\s*|[a-z]+\.\s*|[ivxlcdm]+\.\s*|\d+\.\s*)/i;

/** Quita cualquier marcador de lista (viñeta o número/letra/romano) ya
 * presente al principio de cada línea, PRESERVANDO los TAB de sangria --
 * necesario antes de aplicar un tipo de lista distinto al actual (p.ej.
 * pasar de viñetas a numerada no debía dejar el "• " viejo debajo del
 * "1. " nuevo, pero la sangria de cada linea se mantiene). */
export function stripListMarkers(rawText: string): string {
  return rawText
    .split('\n')
    .map((line) => {
      const depth = lineDepth(line);
      const rest = line.slice(depth);
      const stripped = rest.replace(LIST_MARKER_RE, '');
      return DEPTH_CHAR.repeat(depth) + stripped;
    })
    .join('\n');
}

/** Aplica (o quita, con `listType: 'none'`) marcadores de lista línea por
 * línea sobre el texto plano del bloque, respetando el nivel de sangria
 * (TAB) que ya traiga cada linea -- el marcador es texto literal (no un
 * `::before` CSS) porque el bloque puede renderizarse como <Text> de
 * Konva, que no soporta pseudo-elementos por línea.
 *
 * La numeracion de cada nivel es un contador INDEPENDIENTE que se reinicia
 * solo cuando aparece una linea de nivel MENOR (mismo criterio que Word:
 * volver a un nivel superior y bajar de nuevo empieza el sub-item en 1/a/i
 * otra vez, pero seguir en el MISMO nivel continua la cuenta aunque haya
 * sub-items intercalados de un nivel mas profundo).
 *
 * `onlyExistingListLines` (bug real reportado: escribir "- " en UNA línea
 * y seguir escribiendo/presionar Enter viñeteaba TODO el bloque, incluidos
 * párrafos que nunca tuvieron marcador) -- cuando es `true`, una línea SIN
 * marcador visible y CON contenido real se deja completamente intacta (ni
 * sangría ni marcador), en vez de asumir que TODO el bloque es la lista.
 * Se usa desde la continuación de lista con Enter y desde Tab/Shift+Tab
 * (PageCanvas.tsx) -- las acciones explícitas de "convertir todo el bloque
 * en lista" (botón del ribbon, inspector derecho) siguen usando el modo
 * por defecto (`false`), que sí fuerza el marcador en cada línea del
 * bloque: ahí el usuario SÍ pidió eso a propósito.
 */
export function applyListToText(
  rawText: string,
  listType: ListStyleType,
  options?: { onlyExistingListLines?: boolean },
): string {
  const onlyExisting = options?.onlyExistingListLines ?? false;
  if (listType === 'none') return onlyExisting ? rawText : stripListMarkers(rawText);

  const lines = (onlyExisting ? rawText : stripListMarkers(rawText)).split('\n');
  const counters: number[] = [];
  return lines.map((line) => {
    const depth = Math.min(lineDepth(line), MAX_DEPTH);
    const content = line.slice(lineDepth(line));
    if (onlyExisting && !LIST_MARKER_RE.test(content) && content.trim()) {
      // Párrafo ajeno a la lista (nunca tuvo marcador) -- se deja tal cual,
      // sin importar que otras líneas del mismo bloque sí sean parte de
      // una lista activa.
      return line;
    }
    const strippedContent = onlyExisting ? content.replace(LIST_MARKER_RE, '') : content;
    if (!strippedContent.trim()) return DEPTH_CHAR.repeat(depth) + strippedContent; // linea vacia -- sin marcador
    counters.length = depth + 1; // descarta contadores de niveles mas profundos (ya no aplican hasta volver a bajar)
    counters[depth] = (counters[depth] || 0) + 1;
    const marker = listType === 'bullet' ? bulletMarkerForDepth(depth) : numberMarkerForDepth(depth, counters[depth]);
    return `${DEPTH_CHAR.repeat(depth)}${marker} ${strippedContent}`;
  }).join('\n');
}

/** Longitud del marcador visible ("• " / "1. " / "iii. ") al INICIO del
 * contenido de una linea (despues de sus TAB de sangria) -- usado para
 * reposicionar el cursor tras indentar/desindentar sin tener que
 * recorrer todo el texto de nuevo. */
function visibleMarkerLength(line: string): number {
  const depth = lineDepth(line);
  const rest = line.slice(depth);
  const match = rest.match(LIST_MARKER_RE);
  return match ? match[0].length : 0;
}

/**
 * Tab / Shift+Tab (SCRUM-31) sobre la linea donde esta el cursor: suma o
 * resta un nivel de sangria (`delta`: +1/-1) y renumera TODO el bloque
 * para ese `listType` -- indentar un item a mitad de una lista numerada
 * cambia la numeracion de los hermanos que siguen, asi que no alcanza con
 * tocar solo la linea editada. Devuelve `null` si no hay nada que hacer
 * (sin lista activa, o ya en el limite de sangria/raiz) para que el
 * llamador pueda dejar pasar el Tab normal del navegador en ese caso.
 */
export function indentListLine(
  text: string,
  cursorPos: number,
  listType: ListStyleType,
  delta: 1 | -1,
): { text: string; cursorPos: number } | null {
  if (listType === 'none') return null;
  const lines = text.split('\n');
  let offset = 0;
  let lineIndex = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const lineEnd = offset + lines[i].length;
    if (cursorPos <= lineEnd || i === lines.length - 1) { lineIndex = i; break; }
    offset = lineEnd + 1; // +1 por el '\n'
  }
  const line = lines[lineIndex];
  const oldDepth = lineDepth(line);
  const newDepth = Math.max(0, Math.min(MAX_DEPTH, oldDepth + delta));
  if (newDepth === oldDepth) return null; // ya esta en el limite -- no interceptar el Tab

  const oldMarkerLen = visibleMarkerLength(line);
  const contentOffsetInLine = Math.max(0, cursorPos - offset - oldDepth - oldMarkerLen);

  const rawLine = DEPTH_CHAR.repeat(newDepth) + line.slice(oldDepth); // conserva el marcador viejo; se renumera abajo
  const nextLines = [...lines];
  nextLines[lineIndex] = rawLine;
  // onlyExistingListLines: renumerar por indentar/desindentar UN item no
  // debe contagiar viñetas/números a otros párrafos del mismo bloque que
  // nunca fueron parte de la lista.
  const nextText = applyListToText(nextLines.join('\n'), listType, { onlyExistingListLines: true });

  const nextLine = nextText.split('\n')[lineIndex];
  const newMarkerLen = visibleMarkerLength(nextLine);
  const newLineStart = nextText.split('\n').slice(0, lineIndex).reduce((sum, l) => sum + l.length + 1, 0);
  const nextCursorPos = newLineStart + newDepth + newMarkerLen + contentOffsetInLine;

  return { text: nextText, cursorPos: nextCursorPos };
}
