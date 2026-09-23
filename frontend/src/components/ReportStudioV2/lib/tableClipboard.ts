/** Parseo del portapapeles de Excel/Sheets/Word compartido entre el pegado
 * DENTRO de una celda de tabla ya existente (TableBlock.tsx, SCRUM-30) y el
 * pegado que CREA una tabla nueva desde cero cuando no hay ninguna en foco
 * (PageCanvas.tsx) -- antes solo existía la primera variante, con este
 * parser definido localmente en TableBlock.tsx.
 */

export interface ParsedClipboardGrid {
  rows: string[][];
  merges: { row: number; column: number; rowSpan: number; colSpan: number }[];
  backgrounds: (string | undefined)[][];
  aligns: (string | undefined)[][];
  /** Tamaño de fuente REPRESENTATIVO de la tabla de origen (px), detectado
   * en la primera celda que traiga alguna señal de tamaño -- ver
   * `detectCellFontSizePx` más abajo. `undefined` si ninguna celda trae
   * ninguna señal (tabla creada a mano en este editor, Excel/Sheets sin
   * tamaño explícito, etc.) -- el caller decide el default en ese caso. El
   * modelo de tabla de este editor solo admite UN `fontSize` por tabla
   * completa (no por celda), así que esto es deliberadamente una única
   * medida global, no una grilla -- pedido explícito 2026-09-10: "el
   * tamaño de la letra puede ser variable, esto tiene que ajustarse lo mas
   * identico posible al documento original". */
  fontSize?: number;
  /** Color de TEXTO representativo del encabezado (fila 0 / celdas `<th>`)
   * y del cuerpo (el resto), detectado en la primera celda de cada grupo
   * que traiga alguna señal -- ver `detectCellTextColor` más abajo. Mismo
   * criterio de "una sola medida global, no una grilla" que ya usa
   * `fontSize` (el modelo de tabla de este editor solo admite UN color de
   * encabezado y UN color de cuerpo por tabla completa, no por celda) --
   * pedido explícito 2026-09-11: "no esta trayendo bien el color del
   * header que lo deja en negro el texto, solo trae el color [de fondo]". */
  headerTextColor?: string;
  bodyTextColor?: string;
  /** Color de texto POR CELDA -- a diferencia de `headerTextColor`/
   * `bodyTextColor` (una sola medida "representativa" para toda la fila de
   * encabezado / todo el cuerpo), esta grilla trae el color real detectado
   * en CADA celda individual, o `undefined` si esa celda no traía ninguna
   * señal de color. Bug real reportado en vivo 2026-09-11: una tabla TDR
   * con la columna "Estado" coloreada distinto según el valor (verde
   * CUMPLE, ámbar/naranja CUMPLE PARCIALMENTE, azul POR ACLARAR) se
   * importaba con TODO el cuerpo de la tabla en un solo color -- el de la
   * PRIMERA celda con color que `bodyTextColor` encontraba al recorrer la
   * tabla (naranja, por ser el estado más frecuente), aplicado como color
   * "por defecto" de toda la tabla y pisando el negro normal de columnas
   * como "Requerimiento"/"Justificación" que nunca tuvieron color propio.
   * Con esta grilla cada celda usa SU PROPIO color detectado (o ninguno,
   * heredando el default normal de la tabla) en vez de adivinar uno solo
   * para todas.
   */
  cellTextColors?: (string | undefined)[][];
}

/** Blanco/transparente -- Excel/Sheets suelen dejar esto explícito en CADA
 * celda de su HTML de portapapeles (su propio fondo por defecto), no solo
 * en las que el usuario resaltó a propósito. Traerlo tal cual pisaría el
 * fondo/bandedRows/formato condicional de la tabla destino con un blanco
 * "invisible" pero que igual gana prioridad por ser fondo DE CELDA -- se
 * descarta para que solo se apliquen colores que el usuario realmente
 * eligió (p.ej. una fila resaltada en amarillo). */
function isWhiteOrTransparentColor(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (!c || c === 'transparent' || c === 'inherit' || c === 'initial' || c === 'white' || c === '#fff' || c === '#ffffff') return true;
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) return false;
  const [, r, g, b, a] = m;
  if (a !== undefined && parseFloat(a) === 0) return true;
  return Number(r) >= 250 && Number(g) >= 250 && Number(b) >= 250;
}

/** Tamaño de fuente (px) de una celda -- revisa el `style="font-size:...pt|px"`
 * inline real que Word/Google Docs/Excel ponen directo en su HTML de
 * portapapeles, Y el marcador sintético `beemetry-size-N` que produce nuestro
 * propio import de .docx (ver lib/docxPageBreaks.ts::enrichDocxTextStyles +
 * lib/richPaste.ts -- mammoth no emite `font-size` real en su HTML, solo
 * esta clase). Revisa la celda y TODOS sus descendientes (el texto puede
 * venir envuelto en spans/runs anidados) y devuelve la PRIMERA señal que
 * encuentre -- no intenta promediar/elegir la "más común", una tabla suele
 * ser razonablemente uniforme y esto es solo para acercar el tamaño
 * general al del documento de origen, no para reproducir formato por
 * celda (el modelo de tabla de este editor no lo soporta). */
const FONT_SIZE_PT_RE = /font-size\s*:\s*([\d.]+)\s*pt/i;
const FONT_SIZE_PX_RE = /font-size\s*:\s*([\d.]+)\s*px/i;
const BEEMETRY_SIZE_CLASS_RE = /^beemetry-size-([\d.]+)$/;
function detectCellFontSizePx(cellEl: Element): number | undefined {
  const candidates = [cellEl, ...Array.from(cellEl.querySelectorAll('*'))];
  for (const el of candidates) {
    const style = el.getAttribute('style') || '';
    const ptMatch = FONT_SIZE_PT_RE.exec(style);
    if (ptMatch) {
      const pt = parseFloat(ptMatch[1]);
      if (Number.isFinite(pt) && pt > 0) return pt * (96 / 72);
    }
    const pxMatch = FONT_SIZE_PX_RE.exec(style);
    if (pxMatch) {
      const px = parseFloat(pxMatch[1]);
      if (Number.isFinite(px) && px > 0) return px;
    }
    const sizeClass = Array.from(el.classList).find((cls) => BEEMETRY_SIZE_CLASS_RE.test(cls));
    if (sizeClass) {
      const pt = parseFloat(BEEMETRY_SIZE_CLASS_RE.exec(sizeClass)![1]);
      if (Number.isFinite(pt) && pt > 0) return pt * (96 / 72);
    }
  }
  return undefined;
}

/** Color de TEXTO de una celda -- mismo criterio de recorrido que
 * `detectCellFontSizePx` (celda + todos sus descendientes, primera señal
 * encontrada gana), revisando el `style="color:..."` inline real que
 * Word/Google Docs/Excel ponen directo en su HTML de portapapeles, Y el
 * marcador sintético `beemetry-color-RRGGBB` que produce nuestro propio
 * import de .docx (mammoth no emite color real en su HTML, solo esta
 * clase -- ver lib/docxPageBreaks.ts::enrichDocxTextStyles). A diferencia
 * de `isWhiteOrTransparentColor` (usado para FONDO de celda, donde blanco
 * casi siempre es "sin elegir"), acá el blanco NUNCA se descarta -- es un
 * valor legítimo y frecuente para texto de encabezado sobre fondo oscuro
 * (el caso reportado: "el header... lo deja en negro el texto"). */
const BEEMETRY_COLOR_CLASS_RE = /^beemetry-color-([0-9a-fA-F]{6})$/;
function detectCellTextColor(cellEl: Element): string | undefined {
  const candidates = [cellEl, ...Array.from(cellEl.querySelectorAll('*'))];
  for (const el of candidates) {
    const inlineColor = (el as HTMLElement).style?.color;
    if (inlineColor && inlineColor.trim()) return inlineColor.trim();
    const colorClass = Array.from(el.classList).find((cls) => BEEMETRY_COLOR_CLASS_RE.test(cls));
    if (colorClass) return `#${BEEMETRY_COLOR_CLASS_RE.exec(colorClass)![1].toUpperCase()}`;
  }
  return undefined;
}

/** Extrae una grilla (valores + fusiones + fondo/alineación por celda, en la
 * medida de lo posible) del HTML que Excel/Sheets ponen en el portapapeles
 * junto al texto plano (SCRUM-30 extendido) -- a diferencia del TSV de
 * texto plano (ver parsePlainTextClipboardGrid), el HTML SÍ conserva celdas
 * fusionadas (rowspan/colspan) y color de fondo/alineación por celda; es la
 * única fuente que permite reproducir eso al pegar. Devuelve `null` si el
 * HTML no trae ninguna `<table>` reconocible (se cae al TSV plano en ese
 * caso).
 *
 * Algoritmo de "grilla de ocupación" (estándar para parsear HTML con
 * rowspan/colspan): Excel/Sheets emiten cada `<tr>` con SOLO las celdas
 * que ARRANCAN ahí -- una celda fusionada verticalmente no vuelve a
 * aparecer en las filas que cubre -- así que hay que llevar la cuenta de
 * qué columnas ya están "ocupadas" por el rowspan de una fila anterior
 * para saber en qué columna real cae cada `<td>` de la fila actual.
 */
export function parseHtmlClipboardTable(html: string): ParsedClipboardGrid | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  const table = doc.querySelector('table');
  if (!table) return null;
  const trs = Array.from(table.querySelectorAll('tr'));
  if (trs.length === 0) return null;

  const rows: string[][] = [];
  const merges: ParsedClipboardGrid['merges'] = [];
  const backgrounds: (string | undefined)[][] = [];
  const aligns: (string | undefined)[][] = [];
  const textColors: (string | undefined)[][] = [];
  const occupied: Set<number>[] = [];
  const ensureRow = (r: number) => {
    while (rows.length <= r) {
      rows.push([]);
      backgrounds.push([]);
      aligns.push([]);
      textColors.push([]);
      occupied.push(new Set());
    }
  };

  let maxCol = 0;
  let detectedFontSize: number | undefined;
  let detectedHeaderTextColor: string | undefined;
  let detectedBodyTextColor: string | undefined;
  trs.forEach((tr, r) => {
    ensureRow(r);
    let col = 0;
    Array.from(tr.children).forEach((cellEl) => {
      if (!(cellEl instanceof HTMLTableCellElement)) return;
      while (occupied[r].has(col)) col += 1;
      const rowSpan = Math.max(1, cellEl.rowSpan || 1);
      const colSpan = Math.max(1, cellEl.colSpan || 1);
      rows[r][col] = (cellEl.textContent || '').trim();
      const bg = cellEl.style.backgroundColor;
      if (bg && !isWhiteOrTransparentColor(bg)) backgrounds[r][col] = bg;
      const align = cellEl.style.textAlign;
      if (align === 'left' || align === 'center' || align === 'right') aligns[r][col] = align;
      if (detectedFontSize === undefined) detectedFontSize = detectCellFontSizePx(cellEl);
      // `<th>` es la señal más confiable de "celda de encabezado" (mammoth
      // ya envuelve así la primera fila de una tabla con encabezado real,
      // ver el HTML que produce `App.tsx::handleImportDocx`) -- si la
      // tabla no trae NINGÚN `<th>` (pegado plano de Excel/Sheets, sin
      // noción formal de encabezado), la fila 0 se trata igual como
      // encabezado -- coincide con que este editor SIEMPRE asume
      // `hasHeader: true` por defecto para una tabla recién insertada.
      const isHeaderCell = cellEl.tagName === 'TH' || r === 0;
      const ownColor = detectCellTextColor(cellEl);
      if (ownColor) textColors[r][col] = ownColor;
      if (isHeaderCell) {
        if (detectedHeaderTextColor === undefined) detectedHeaderTextColor = ownColor;
      } else if (detectedBodyTextColor === undefined) {
        detectedBodyTextColor = ownColor;
      }
      if (rowSpan > 1 || colSpan > 1) {
        merges.push({ row: r, column: col, rowSpan, colSpan });
        for (let rr = r; rr < r + rowSpan; rr += 1) {
          ensureRow(rr);
          for (let cc = col; cc < col + colSpan; cc += 1) {
            if (rr !== r || cc !== col) occupied[rr].add(cc);
          }
        }
      }
      maxCol = Math.max(maxCol, col + colSpan - 1);
      col += colSpan;
    });
  });

  if (rows.length === 0) return null;
  const colCount = maxCol + 1;
  const rowCount = rows.length;
  const grid: string[][] = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => rows[r]?.[c] ?? ''));
  const bgGrid: (string | undefined)[][] = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => backgrounds[r]?.[c]));
  const alignGrid: (string | undefined)[][] = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => aligns[r]?.[c]));
  const textColorGrid: (string | undefined)[][] = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => textColors[r]?.[c]));

  return {
    rows: grid, merges, backgrounds: bgGrid, aligns: alignGrid, fontSize: detectedFontSize,
    headerTextColor: detectedHeaderTextColor, bodyTextColor: detectedBodyTextColor,
    cellTextColors: textColorGrid,
  };
}

/** Fallback cuando el portapapeles no trae HTML aprovechable (origen no es
 * una hoja de cálculo, o su HTML no trae ninguna `<table>`): TSV de texto
 * plano (tabulador entre columnas, salto de línea entre filas). No conserva
 * fusiones ni color/alineación por celda -- solo el HTML las trae (ver
 * parseHtmlClipboardTable). Devuelve `null` si no hay ninguna fila con al
 * menos una celda no vacía. */
export function parsePlainTextClipboardGrid(text: string): string[][] | null {
  if (!text) return null;
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  // Filas COMPLETAMENTE vacías (todas sus celdas en blanco) casi siempre son
  // un artefacto de una celda fusionada verticalmente en el origen --
  // Excel/Sheets solo guardan el valor en la primera fila que cubre la
  // fusión, y el texto plano no tiene forma de expresar eso, así que la(s)
  // fila(s) que cubre salen vacías. Con HTML disponible esto se resuelve
  // bien (arriba, como una fusión real); en este fallback, lo mejor es
  // omitirlas en vez de pegarlas como filas en blanco de más.
  const nonBlankLines = lines.filter((line) => line.split('\t').some((cell) => cell.trim() !== ''));
  if (nonBlankLines.length === 0) return null;
  return nonBlankLines.map((line) => line.split('\t').map((v) => v.trim()));
}

/** Las celdas de la tabla son contentEditable y su HTML se guarda crudo
 * (ver sanitizeRichHtml al sembrarlas) -- escapar `<`/`>`/`&` antes de
 * guardar texto recién pegado evita que un valor como "Costo < 100 & IGV"
 * se interprete como una etiqueta a medio abrir y se corrompa. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Mismo piso que `MIN_COL_WIDTH` en TableBlock.tsx (duplicado a propósito
 * -- son constantes primitivas, no vale la pena una dependencia cruzada
 * solo por esto). */
const MIN_COL_WIDTH = 48;

/** Ancho "natural" de cada columna según el texto más largo que contiene,
 * SIN apretar nada aunque exceda cualquier límite -- medición pura,
 * compartida por `computeAutoFitColumnWidths` (reparte proporcional si
 * hace falta) y `computeAdaptiveTableFit` (que primero prueba reducir el
 * padding antes de llegar a apretar columnas, ver más abajo). Puro: el
 * `<canvas>` que usa para medir es enteramente propio y desechable. Si el
 * entorno no tiene `document` disponible (SSR/test sin jsdom) devuelve
 * `null`. */
function measureNaturalColumnWidths(
  rows: string[][],
  colCount: number,
  opts: { fontSize: number; cellPadding: number },
): number[] | null {
  if (typeof document === 'undefined' || colCount <= 0) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = `${opts.fontSize}px 'Inter', sans-serif`;
  return Array.from({ length: colCount }, (_, ci) => {
    let maxW = MIN_COL_WIDTH;
    rows.forEach((row) => {
      const text = String(row[ci] ?? '').replace(/<[^>]+>/g, '');
      const longestLine = text.split(/\r?\n/).reduce(
        (longest, line) => Math.max(longest, ctx.measureText(line).width),
        0,
      );
      maxW = Math.max(maxW, longestLine + opts.cellPadding * 2 + 4);
    });
    return Math.ceil(maxW);
  });
}

/**
 * Ancho "natural" de cada columna repartido proporcionalmente si la suma
 * excede `maxTableWidth` -- extraído de `TableBlock.tsx::autoFitColumns`
 * (el botón manual "Autoajustar") para poder reutilizarlo ANTES de que la
 * tabla llegue a montarse en el lienzo (pedido explícito 2026-09-10: una
 * tabla ancha importada de un .docx no debe depender de que el usuario se
 * acuerde de apretar el botón -- ver PageCanvas.tsx::processPasteBlocks).
 * `cellPadding` fijo -- para el caso de import/pegado, que además prueba
 * reducir el padding antes de llegar hasta acá, usar
 * `computeAdaptiveTableFit`. Devuelve `null` en el mismo caso que
 * `measureNaturalColumnWidths` -- el caller cae al reparto parejo de
 * siempre (`normalizeColWidths` en TableBlock.tsx).
 */
export function computeAutoFitColumnWidths(
  rows: string[][],
  colCount: number,
  opts: { fontSize: number; cellPadding: number; maxTableWidth: number },
): number[] | null {
  const measured = measureNaturalColumnWidths(rows, colCount, opts);
  if (!measured) return null;
  const widthLimit = Math.max(MIN_COL_WIDTH * colCount, opts.maxTableWidth);
  const measuredTotal = measured.reduce((sum, width) => sum + width, 0);
  return measuredTotal > widthLimit
    ? measured.map((width) => Math.max(MIN_COL_WIDTH, Math.floor(width * widthLimit / measuredTotal)))
    : measured;
}

/**
 * Autoajuste ADAPTATIVO para tablas recién insertadas (import de .docx o
 * pegado) -- pedido explícito 2026-09-10: "siempre las tablas conservan su
 * configuracion de 10 en padding, eso no es una regla... si vez que la
 * tabla no calza como en el word hay que reducirle su padding hasta un
 * maximo de 3 - 10". Antes de apretar columnas (que deforma el ancho
 * relativo de cada una), prueba reducir el padding de celda de 10px hasta
 * 3px -- usa el PRIMER (mayor) padding con el que el ancho NATURAL ya
 * quepa en `maxTableWidth` sin apretar nada. Si ni con 3px alcanza, cae al
 * reparto proporcional de `computeAutoFitColumnWidths` con padding=3 (el
 * último recurso, igual de agresivo que antes, pero con el padding mínimo
 * ya aplicado en vez del de 10 fijo).
 */
export function computeAdaptiveTableFit(
  rows: string[][],
  colCount: number,
  opts: { fontSize: number; maxTableWidth: number },
): { colWidths: number[]; cellPadding: number } | null {
  const MAX_PADDING = 10;
  const MIN_PADDING = 3;
  for (let padding = MAX_PADDING; padding >= MIN_PADDING; padding -= 1) {
    const natural = measureNaturalColumnWidths(rows, colCount, { fontSize: opts.fontSize, cellPadding: padding });
    if (!natural) return null;
    const naturalTotal = natural.reduce((sum, width) => sum + width, 0);
    if (naturalTotal <= opts.maxTableWidth) {
      return { colWidths: natural, cellPadding: padding };
    }
    if (padding === MIN_PADDING) {
      // Ni con el padding mínimo alcanza -- último recurso, igual de
      // agresivo que antes (aprieta columnas proporcionalmente), pero ya
      // con el padding más chico posible en vez del de 10 fijo.
      const widthLimit = Math.max(MIN_COL_WIDTH * colCount, opts.maxTableWidth);
      const squished = natural.map((width) => Math.max(MIN_COL_WIDTH, Math.floor(width * widthLimit / naturalTotal)));
      return { colWidths: squished, cellPadding: padding };
    }
  }
  return null;
}
