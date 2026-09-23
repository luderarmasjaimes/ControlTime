import React, { memo, useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { ClipboardPaste, Paintbrush, Plus, Minus, WandSparkles, X, Highlighter, AlignLeft, AlignCenter, AlignRight, Percent } from 'lucide-react';
import ColorPalette from '../../shared/ColorPalette';
import { sanitizeRichHtml } from '../../../lib/sanitizeHtml';
import { semanticStatusStyle } from '../../../lib/semanticStatus';
import { computeTableFormulas, getEffectiveCellValues, parseCellNumber, shiftFormulaRefs, stripCellHtml } from '../../../lib/tableFormulas';
import { bumpDecimals, formatNumberForDisplay, parseNumberFormat, togglePercentFormat } from '../../../lib/tableNumberFormat';
import { computeConditionalStyles, shiftScopedItems, type ColorScaleFormat, type ConditionalFormatRule } from '../../../lib/tableConditionalFormat';
import { setActiveTableCellSelection } from '../../../lib/tableCellSelectionBridge';
import { parseHtmlClipboardTable, parsePlainTextClipboardGrid, escapeHtml, computeAutoFitColumnWidths, type ParsedClipboardGrid } from '../../../lib/tableClipboard';

const MIN_COL_WIDTH = 48;
const MIN_ROW_HEIGHT = 32;
const RESIZE_HANDLE_WIDTH = 8;
const RESIZE_HANDLE_HEIGHT = 8;

const FONT_FAMILY_OPTIONS: { label: string; value: string }[] = [
  { label: 'Inter (por defecto)', value: "'Inter', sans-serif" },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { label: 'Courier New', value: "'Courier New', monospace" },
];

/** Primer nombre de una pila de fuentes, sin comillas y en minúscula --
 * `getComputedStyle().fontFamily` no siempre devuelve el string EXACTO que
 * se aplicó (p.ej. puede quitar las comillas), así que comparar la pila
 * completa como texto literal falla; comparar solo el primer nombre
 * normalizado es lo que sí es estable entre navegadores. */
function primaryFontFamily(stack: string): string {
  return (stack.split(',')[0] || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
}

interface TableBlockProps {
  title?: string;
  /** Leyenda opcional debajo de la tabla ("Tabla N. ...") -- OJO: el prop
   * viaja hasta acá (`{...element.props}` en PageCanvas.tsx) pero NO se usa
   * en este componente. Se renderiza en PageCanvas.tsx mismo (fuera de
   * `<TableBlock>`, junto al `<Html>` que lo envuelve) -- bug real
   * encontrado 2026-09-11 ("veo que la tabla genera 2 leyendas xd"):
   * agregar acá un segundo render de la misma leyenda duplicaba el texto
   * visible. Se deja documentado para no repetir el error. */
  caption?: string;
  rows?: string[][];
  colWidths?: number[];
  /** Alto explícito por fila (px) -- 0/ausente = automático según contenido. */
  rowHeights?: number[];
  cellBackgrounds?: string[][];
  rowBackgrounds?: string[];
  columnBackgrounds?: string[];
  /** Alineación de texto por celda individual -- '' = hereda `cellAlign` (el de toda la tabla). */
  cellAligns?: string[][];
  /** Color de texto por celda individual -- '' = hereda el default normal
   * (encabezado -> `headerTextColor`, cuerpo -> semáforo semántico si
   * aplica, si no `textColor`). Viene principalmente de import de .docx/
   * pegado de Word-Excel con colores mezclados por celda (p.ej. una columna
   * "Estado" con verde/ámbar/azul según el valor) -- ver `cellTextColors`
   * en tableClipboard.ts. A diferencia de `headerTextColor`/`textColor`
   * (una sola medida para toda la fila de encabezado / todo el cuerpo),
   * esto SÍ varía celda por celda. */
  cellTextColors?: string[][];
  /** Formato numérico por celda ("percent:2", "decimal:0", null = general)
   * -- ver lib/tableNumberFormat.ts. Solo cambia cómo se MUESTRA un valor
   * numérico (propio o resultado de fórmula), nunca el contenido guardado. */
  cellNumberFormats?: (string | null)[][];
  /** Reglas de formato condicional (ver lib/tableConditionalFormat.ts) --
   * aplican a TODA la tabla (sin encabezado), pintando fondo/texto según el
   * valor efectivo de cada celda (propio o resultado de fórmula). */
  conditionalFormats?: ConditionalFormatRule[];
  /** Escalas de color (degradado continuo mínimo[/medio]/máximo, ver
   * lib/tableConditionalFormat.ts) -- entidad separada de conditionalFormats,
   * aplicada primero como capa base. */
  colorScales?: ColorScaleFormat[];
  /** Anclas y extensiones de las celdas fusionadas de la tabla. */
  mergedCells?: MergedCell[];
  hasHeader?: boolean;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  headerBg?: string;
  headerTextColor?: string;
  headerBold?: boolean;
  cellPadding?: number;
  fontSize?: number;
  /** Tipografía de toda la tabla -- por defecto 'Inter' (la misma que usa
   * el resto del informe). Impulsada por "Fuente global" del documento
   * (Propiedades del documento), igual que en los globos de texto. */
  fontFamily?: string;
  /** Color de texto de las celdas de CUERPO (no cabecera, que tiene su
   * propio `headerTextColor` intencional desde los Estilos Rápidos). Mismo
   * origen que `fontFamily`: "Fuente global" del documento. */
  textColor?: string;
  cellAlign?: 'left' | 'center' | 'right';
  /** Alineación vertical del contenido de las celdas -- se nota sobre todo
   * cuando una fila es muy alta (contenido largo, resize manual) o cuando
   * la celda es una fusión vertical (rowSpan > 1): sin esto el texto queda
   * siempre pegado arriba aunque sobre mucho espacio abajo. Por defecto
   * 'top' (comportamiento de siempre, sin cambios para tablas existentes). */
  cellVAlign?: 'top' | 'middle' | 'bottom';
  bandedRows?: boolean;
  bandColor?: string;
  onUpdateCells?: (newRows: string[][]) => void;
  onUpdateCellBackgrounds?: (backgrounds: string[][]) => void;
  onUpdateRowBackgrounds?: (backgrounds: string[]) => void;
  onUpdateColumnBackgrounds?: (backgrounds: string[]) => void;
  onUpdateMergedCells?: (mergedCells: MergedCell[]) => void;
  /** Persistencia atómica de la fusión: evita que tres actualizaciones de
   * props separadas se pisen durante el mismo evento. */
  onMergeCells?: (next: { rows: string[][]; cellBackgrounds: string[][]; mergedCells: MergedCell[] }) => void;
  /** Persistencia atómica del pincel de formato -- mismo motivo que
   * `onMergeCells`: pegar formato toca rows/cellBackgrounds/cellAligns a la
   * vez, y tres `onUpdateX` separados en el mismo evento se pisaban entre
   * sí (bug real: quedaba el fondo pegado pero el texto sin ningún estilo). */
  onPasteCellFormat?: (next: { rows: string[][]; cellBackgrounds: string[][]; cellAligns: string[][] }) => void;
  /** Persistencia atómica de "Dividir celda" sobre una celda NORMAL (sin
   * fusión previa) -- a diferencia de fusionar/dividir una fusión existente
   * (que solo tocan `mergedCells` +, cuando mucho, `rows`/`cellBackgrounds`),
   * esto inserta una fila o columna real en TODA la tabla (ver
   * `splitNormalCellInto`), así que puede tocar prácticamente cualquier
   * prop indexada por fila/columna a la vez -- de ahí que casi todo el
   * patch sea opcional, y se aplique en una sola pasada atómica igual que
   * `onMergeCells`. */
  onSplitCell?: (next: {
    rows: string[][];
    mergedCells: MergedCell[];
    colWidths?: number[];
    rowHeights?: number[];
    cellBackgrounds?: string[][];
    rowBackgrounds?: string[];
    columnBackgrounds?: string[];
    cellAligns?: string[][];
    cellNumberFormats?: (string | null)[][];
    conditionalFormats?: ConditionalFormatRule[];
    colorScales?: ColorScaleFormat[];
  }) => void;
  /** Persistencia atómica del "pegado inteligente" desde Excel/Sheets
   * (SCRUM-30 extendido) -- a diferencia de `onUpdateCells`, puede tocar a
   * la vez fondo/alineación por celda (si el origen los traía), fusiones
   * (si el origen tenía celdas fusionadas) y el ancho de columnas (si hizo
   * falta agregar columnas nuevas al final para que entre todo lo pegado).
   * Mismo motivo que onMergeCells/onPasteCellFormat/onSplitCell: varias
   * actualizaciones de props separadas en el mismo evento se pisarían
   * entre sí. */
  onSmartPasteGrid?: (next: {
    rows: string[][];
    cellBackgrounds: string[][];
    cellAligns: string[][];
    mergedCells: MergedCell[];
    colWidths?: number[];
    columnBackgrounds?: string[];
  }) => void;
  onUpdateColWidths?: (widths: number[]) => void;
  onUpdateRowHeights?: (heights: number[]) => void;
  onUpdateCellAligns?: (aligns: string[][]) => void;
  onUpdateCellNumberFormats?: (formats: (string | null)[][]) => void;
  onAddRow?: () => void;
  onRemoveRow?: (rowIndex: number) => void;
  onAddColumn?: () => void;
  onRemoveColumn?: (colIndex: number) => void;
  /** Abre el modal "Crear gráfico desde esta tabla" -- ofrecido en el menú
   * contextual de celda (clic derecho), pedido explícito 2026-09-11. */
  onCreateChartFromTable?: () => void;
  /** Ancho disponible real (px) del contenedor -- usado para repartir columnas
   * quc no traen `colWidths` todavía (tablas creadas antes de este fix). */
  containerWidth?: number;
  /** Límite duro hasta el borde de la página para el autoajuste. */
  maxTableWidth?: number;
  /** true si el bloque está seleccionado en el lienzo -- la barra de
   * herramientas de fila/columna y los tiradores de resize SOLO se muestran
   * seleccionado (evita ruido visual sobre una tabla no activa). */
  selected?: boolean;
  /** id del elemento en el documento (PageCanvas.tsx) -- solo se usa para
   * reportar la selección de celdas activa al panel derecho (ver
   * lib/tableCellSelectionBridge.ts), así el editor de formato condicional
   * sabe a qué celdas acotar una regla/escala nueva. */
  elementId?: string;
  /** true si el bloque está en modo "doble clic para editar celdas" (ver
   * canvasTableEditId, PageCanvas.tsx). Cuando es true se muestra un botón
   * explícito para salir — vía de escape garantizada además de Escape/clic
   * afuera, por si ese modo queda "pegado" (bug reportado por QA). */
  editing?: boolean;
  onExitEdit?: () => void;
  /** Reporta el tamaño NATURAL (contenido real) de la tabla — el llamador
   * (PageCanvas.tsx) lo usa para crecer el bloque automáticamente (nunca lo
   * encoge solo; encoger es manual, vía resize de columnas). */
  onNaturalSize?: (width: number, height: number) => void;
  /** Alto (px) disponible en ESTA página desde la posición Y de la tabla
   * hasta el borde inferior del área de contenido (antes del pie de
   * página) -- el llamador lo calcula (`CONTENT_BOTTOM - element.y`). Si no
   * llega, no hay detección de desborde (p.ej. la vista de solo lectura). */
  maxTableHeight?: number;
  /** Se dispara cuando las filas ya no caben en `maxTableHeight` -- reporta
   * cuántas filas (desde la primera) sí entran y el alto medido hasta ahí y
   * hasta el final de la tabla, para que el llamador reparta la tabla en
   * "la que se queda" + "la continuación en la siguiente página" sin tener
   * que volver a medir nada por su cuenta. */
  onOverflowRows?: (fittingRowCount: number, fittingHeightPx: number, totalHeightPx: number) => void;
  /** Mousedown nativo sobre la franja del título — pedido explícito
   * 2026-09-04 ("no sé de dónde agarrarlo para desplazar la tabla"). El
   * intento anterior (pointerEvents:'none' en el título para que el clic
   * "atraviese" hacia el Rect de Konva de abajo) seguía sin funcionar de
   * forma confiable en el uso real. Este callback deja que PageCanvas.tsx
   * (que sí tiene acceso al Stage/Layer de Konva) arranque el arrastre del
   * bloque DIRECTAMENTE vía `node.startDrag()` — el mecanismo nativo y
   * robusto de Konva para iniciar un drag desde un evento externo al canvas
   * (con `stage.setPointersPositions(evt)` primero para que Konva conozca
   * la posición real del puntero) — en vez de depender de que el evento
   * nativo del navegador "pase a través" de esta capa HTML hasta el canvas,
   * algo frágil a mitad de gesto si el puntero cruza sobre una celda
   * (pointerEvents:'auto') antes de soltar.
   */
  onTitleMouseDown?: (event: React.MouseEvent) => void;
}

interface CellPosition {
  row: number;
  column: number;
}

interface MergedCell extends CellPosition {
  rowSpan: number;
  colSpan: number;
}

// Referencia ESTABLE para cuando `mergedCells` no llega como prop — un
// `= []` directo en la desestructuración de props crea un array NUEVO en
// cada render, y como ese valor alimenta un useEffect con `[mergedCells]`
// como dependencia (ver más abajo), cada render lo veía "cambiado" →
// disparaba setLiveMergedCells → volvía a renderizar → volvía a crear un
// array nuevo → bucle infinito ("Maximum update depth exceeded"). Con esta
// constante módulo-level, cuando no llega prop siempre es la MISMA
// referencia entre renders, así que el useEffect deja de dispararse solo.
const EMPTY_MERGED_CELLS: MergedCell[] = [];

/**
 * Reescrito de cero (el clonado literal de HTML "injertaba" el texto del
 * destino dentro de la estructura de etiquetas de la celda origen — frágil
 * en cuanto el destino ya traía su propio HTML enriquecido, o la fuente
 * tenía varios nodos de texto: el resultado real reportado era fondo
 * pegado pero texto ilegible/sin el resto de propiedades). Ahora se captura
 * el estilo EFECTIVO (ya resuelto por el navegador, cascada incluida) como
 * propiedades planas — todo lo que pidió el negocio explícitamente: color
 * y tamaño de fuente, tipografía, negrita, cursiva, subrayado, resaltado,
 * alineación y color de celda — y se reconstruye el destino con un span
 * nuevo que fija cada propiedad explícita. Sacrifica adrede preservar
 * formato MIXTO dentro de una misma celda origen (varias partes con estilos
 * distintos) a cambio de una copia fiable y predecible de TODAS las
 * propiedades pedidas — que es lo que se pidió esta vez.
 */
interface CellFormatSnapshot {
  backgroundColor: string;
  color: string;
  fontFamily: string;
  fontSize: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Resaltado tipo marcador de texto (fondo INLINE de la selección, ver
   * applyHighlightColor) — 'transparent' si no hay ninguno. */
  highlightColor: string;
  align: string;
}

/** Encuentra el elemento cuyo estilo computado representa el texto REAL de
 * la celda (no el contenedor contentEditable en sí, que puede no tener
 * ningún estilo propio y solo heredar el default de la tabla) -- el primer
 * nodo de texto no vacío y su elemento padre inmediato. */
function findCellStyleElement(root: HTMLElement): HTMLElement {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.textContent && node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const node = walker.nextNode();
  const parent = node?.parentElement;
  return parent instanceof HTMLElement ? parent : root;
}

/**
 * Celda editable con contenido gestionado IMPERATIVAMENTE (via ref), no como
 * prop controlada de React. Motivo: un contentEditable cuyo innerHTML se
 * re-aplica desde props en cada render pierde la posición del cursor y
 * colapsa la selección al escribir/formatear (bug clásico de contentEditable
 * en React). Aquí el DOM es la fuente de verdad mientras se edita; el valor
 * externo solo se siembra al montar y se lee hacia afuera en input/blur.
 */
const TableCell = memo(function TableCell({
  value,
  onChange,
  onFocusCell,
  onPasteGrid,
  style,
}: {
  value: string;
  onChange: (html: string) => void;
  onFocusCell: (el: HTMLElement) => void;
  /** Ctrl+V con una seleccion de varias celdas de Excel/Hoja de calculo
   * (SCRUM-30) -- el navegador SIEMPRE entrega esa seleccion como texto
   * plano separado por tabulador (columnas) y salto de linea (filas) en
   * `clipboardData`, sin importar que se vea como una tabla real en
   * Excel. Si el texto pegado no tiene tabulador ni salto de linea, es un
   * valor de una sola celda -- se deja pasar el paste normal del
   * navegador (no se llama a este callback, ver el onPaste de abajo). */
  onPasteGrid?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  style: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Sembrar el contenido inicial una sola vez (y re-sembrar solo si el valor
  // externo cambió Y la celda NO tiene el foco — p.ej. al cargar otro informe).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    // XSS almacenado (auditoría 2026-07-19): la celda es contentEditable y
    // su HTML se guarda crudo; sanear SIEMPRE antes de sembrarlo por
    // innerHTML defiende contra contenido ya envenenado por otro editor del
    // informe. Ver lib/sanitizeHtml.ts.
    const safe = sanitizeRichHtml(value ?? '');
    if (el.innerHTML !== safe) el.innerHTML = safe;
  }, [value]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="table-cell-editable"
      onFocus={(e) => onFocusCell(e.currentTarget)}
      onMouseUp={(e) => onFocusCell(e.currentTarget)}
      onKeyUp={(e) => onFocusCell(e.currentTarget)}
      onInput={(e) => onChange(sanitizeRichHtml(e.currentTarget.innerHTML))}
      onBlur={(e) => onChange(sanitizeRichHtml(e.currentTarget.innerHTML))}
      onPaste={(e) => {
        const text = e.clipboardData?.getData('text/plain') ?? '';
        if (!onPasteGrid || !text || (!text.includes('\t') && !text.includes('\n'))) return;
        onPasteGrid(e);
      }}
      style={style}
    />
  );
});

/** Reparte `containerWidth` en `colCount` columnas iguales (piso MIN_COL_WIDTH),
 * usado cuando `colWidths` no existe todavía o su longitud no calza con las
 * columnas reales (tabla vieja, o recién agregada/quitada una columna). */
/** Encuentra el elemento cuyo estilo computado representa el formato "en
 * este punto" del cursor/selección dentro de `editable` — lo usan tanto la
 * barra de formato (negrita/cursiva/subrayado/color presionados) como
 * "copiar formato". El `startContainer` de un Range recién colocado por un
 * clic (o justo después de un execCommand) puede quedar anclado al
 * ELEMENTO padre con un índice de hijo en vez de al nodo de texto real —
 * tomar ese elemento padre tal cual da el estilo BASE de la celda (negro,
 * sin nada), no el del texto adyacente realmente formateado. Bajar al hijo
 * real en ese offset antes de leer el estilo evita ese bug real reportado
 * ("copiar formato siempre queda en negro").
 */
function resolveFormattedElement(editable: HTMLElement): HTMLElement {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range || !editable.contains(range.startContainer)) return editable;
  let node: Node = range.startContainer;
  if (node.nodeType === Node.ELEMENT_NODE) {
    const children = (node as Element).childNodes;
    const offset = range.startOffset;
    node = children[offset] || children[offset - 1] || node;
  }
  if (node.nodeType === Node.ELEMENT_NODE) return node as HTMLElement;
  return node.parentElement || editable;
}

function normalizeColWidths(colWidths: number[] | undefined, colCount: number, containerWidth: number): number[] {
  if (Array.isArray(colWidths) && colWidths.length === colCount && colWidths.every((w) => Number.isFinite(w) && w > 0)) {
    return colWidths;
  }
  const even = Math.max(MIN_COL_WIDTH, Math.floor((containerWidth || colCount * 120) / Math.max(1, colCount)));
  return Array.from({ length: colCount }, () => even);
}

/** A diferencia de las columnas, las filas no reparten un total fijo -- cada
 * una es independiente. 0 significa "automático" (altura por contenido, el
 * comportamiento de siempre); solo las filas que el usuario arrastró
 * explícitamente llevan un número > 0 aquí. */
function normalizeRowHeights(rowHeights: number[] | undefined, rowCount: number): number[] {
  const arr = Array.isArray(rowHeights) ? rowHeights : [];
  return Array.from({ length: rowCount }, (_, i) => (Number.isFinite(arr[i]) && arr[i] > 0 ? arr[i] : 0));
}

function TableBlock({
  title = '',
  rows = [],
  colWidths,
  rowHeights,
  cellBackgrounds,
  rowBackgrounds,
  columnBackgrounds,
  cellAligns,
  cellTextColors,
  cellNumberFormats,
  conditionalFormats,
  colorScales,
  mergedCells = EMPTY_MERGED_CELLS,
  hasHeader = true,
  borderColor = '#e2e8f0',
  borderWidth = 1,
  borderStyle = 'solid',
  headerBg = '#f8fafc',
  headerTextColor = '#1e293b',
  headerBold = true,
  cellPadding = 10,
  fontSize = 14,
  fontFamily = "'Inter', sans-serif",
  textColor = '#334155',
  cellAlign = 'left',
  cellVAlign = 'top',
  bandedRows = false,
  bandColor = '#f1f5f9',
  onUpdateCells,
  onUpdateCellBackgrounds,
  onUpdateRowBackgrounds,
  onUpdateColumnBackgrounds,
  onUpdateMergedCells,
  onMergeCells,
  onPasteCellFormat,
  onSplitCell,
  onSmartPasteGrid,
  onUpdateColWidths,
  onUpdateRowHeights,
  onUpdateCellAligns,
  onUpdateCellNumberFormats,
  onAddRow,
  onRemoveRow,
  onAddColumn,
  onRemoveColumn,
  onCreateChartFromTable,
  containerWidth = 480,
  maxTableWidth = Number.POSITIVE_INFINITY,
  selected = false,
  editing = false,
  elementId,
  onExitEdit,
  onNaturalSize,
  maxTableHeight,
  onOverflowRows,
  onTitleMouseDown,
}: TableBlockProps) {
  // Barra flotante de formato por selección dentro de la celda enfocada —
  // usa document.execCommand sobre el contentEditable (enfoque estándar y
  // fiable para texto enriquecido en celdas, equivalente al de ONLYOffice).
  const [toolbar, setToolbar] = useState(false);
  const [toolbarTextColor, setToolbarTextColor] = useState('#dc2626');
  const [toolbarHighlightColor, setToolbarHighlightColor] = useState('transparent');
  const [toolbarActiveFormats, setToolbarActiveFormats] = useState({ bold: false, italic: false, underline: false });
  const [toolbarAlign, setToolbarAlign] = useState<'left' | 'center' | 'right'>('left');
  const [toolbarNumberFormat, setToolbarNumberFormat] = useState<string | null>(null);
  const [toolbarFontSize, setToolbarFontSize] = useState<number>(fontSize);
  const [toolbarFontFamily, setToolbarFontFamily] = useState<string>(FONT_FAMILY_OPTIONS[0].value);
  const [colorTarget, setColorTarget] = useState<'cell' | 'row' | 'column'>('cell');
  const [activeCell, setActiveCell] = useState<{ row: number; column: number } | null>(null);
  const activeCellRef = useRef<{ row: number; column: number } | null>(null);
  const [selectedCells, setSelectedCells] = useState<CellPosition[]>([]);
  const selectedCellsRef = useRef<CellPosition[]>([]);
  const tableSelectionDragRef = useRef(false);
  // Distingue dos niveles de interacción, como Excel: la tabla SELECCIONADA
  // (un clic) permite seleccionar una o varias celdas para aplicarles
  // formato en bloque, sin cursor de texto -- `textEditingCell` es null. Un
  // DOBLE clic sobre una celda puntual entra al nivel "editando texto" de
  // ESA celda (cursor real, sin selección múltiple); null = no se está
  // editando ninguna celda en este momento.
  const [textEditingCell, setTextEditingCell] = useState<CellPosition | null>(null);
  // Menú contextual de la celda (click derecho) -- guarda además la celda
  // sobre la que se abrió (row/column) para poder ofrecer "Dividir celda"
  // cuando esa celda es el ancla de una fusión, aparte de "Fusionar celdas"
  // cuando hay una selección múltiple válida (ver canMergeSelection).
  const [cellMenu, setCellMenu] = useState<{ top: number; left: number; row: number; column: number } | null>(null);
  const formatSnapshotRef = useRef<CellFormatSnapshot | null>(null);
  const [formatPainterActive, setFormatPainterActive] = useState(false);
  const painterDragRef = useRef(false);
  const [liveCellBackgrounds, setLiveCellBackgrounds] = useState<string[][]>(cellBackgrounds || []);
  const [liveMergedCells, setLiveMergedCells] = useState<MergedCell[]>(mergedCells);
  const [liveCellAligns, setLiveCellAligns] = useState<string[][]>(cellAligns || []);
  const [liveCellNumberFormats, setLiveCellNumberFormats] = useState<(string | null)[][]>(cellNumberFormats || []);
  const [liveRowHeights, setLiveRowHeights] = useState<number[]>(() => normalizeRowHeights(rowHeights, rows.length));
  const containerRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const [rowOffsets, setRowOffsets] = useState<number[]>([]);
  const focusedCellRef = useRef<HTMLElement | null>(null);
  const focusedPosRef = useRef<{ ri: number; ci: number } | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  // Copia mutable de las filas para persistir cambios de celda sin recalcular
  // desde props (que pueden ir un tick por detrás durante la edición).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const colCount = rows[0]?.length || 0;

  // Reporta la selección de celdas activa al panel derecho (ver
  // lib/tableCellSelectionBridge.ts) -- así ConditionalFormatEditor.tsx
  // sabe a qué celdas acotar una regla/escala nueva, sin necesitar
  // prop-drilling desde PageCanvas.tsx (este componente vive en un portal
  // <Html> de Konva aparte, no en el mismo árbol que el panel derecho).
  useEffect(() => {
    if (!elementId || !selected || selectedCells.length === 0) {
      setActiveTableCellSelection(null);
      return;
    }
    setActiveTableCellSelection({ elementId, cells: selectedCells, hasHeader, rowCount: rows.length, colCount });
  }, [elementId, selected, selectedCells, hasHeader, rows.length, colCount]);
  // Limpia al desmontar (p.ej. se borra el bloque) -- sin esto, una
  // selección quedaba "fantasma" activa para un elementId que ya no existe.
  useEffect(() => () => setActiveTableCellSelection(null), []);

  const widths = normalizeColWidths(colWidths, colCount, containerWidth);

  // Persistir el reparto parejo la PRIMERA vez que hace falta (tabla nueva,
  // o tras agregar/quitar una columna) — sin esto, `widths` se recalculaba
  // en CADA render a partir de `containerWidth`, que a su vez el bloque
  // auto-crecía a partir del ancho medido de la tabla (natural width). Esa
  // realimentación (ancho del contenedor → columnas parejas → ancho medido →
  // crece el contenedor → ...) hacía que la tabla creciera sin parar hasta
  // topar con el borde de la página. Con `colWidths` fijo en props desde el
  // primer render que hizo falta, el ancho de columnas deja de depender del
  // tamaño del contenedor y el ciclo se rompe.
  const didPersistDefaultWidthsRef = useRef(false);
  useEffect(() => {
    const needsPersist = !Array.isArray(colWidths) || colWidths.length !== colCount;
    if (needsPersist && !didPersistDefaultWidthsRef.current) {
      didPersistDefaultWidthsRef.current = true;
      onUpdateColWidths?.(widths);
    } else if (!needsPersist) {
      didPersistDefaultWidthsRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colCount, Array.isArray(colWidths) ? colWidths.length : 0]);

  const persistCell = useCallback((ri: number, ci: number, html: string) => {
    const cur = rowsRef.current;
    if (cur[ri]?.[ci] === html) return;
    const newRows = cur.map((r, rIdx) => (rIdx === ri ? r.map((c, cIdx) => (cIdx === ci ? html : c)) : r));
    onUpdateCells?.(newRows);
  }, [onUpdateCells]);

  // Pegar una seleccion de varias celdas de Excel/Hoja de calculo (SCRUM-30,
  // extendido tras feedback real de uso). Dos fuentes en el portapapeles:
  //  1. HTML (`text/html`) -- Excel/Sheets SIEMPRE lo ponen junto al texto
  //     plano cuando se copia un rango real de celdas. Es la UNICA fuente
  //     que conserva celdas fusionadas (rowspan/colspan) y color de
  //     fondo/alineación por celda -- ver parseHtmlClipboardTable arriba.
  //  2. Texto plano TSV (`text/plain`, tabulador entre columnas, salto de
  //     línea entre filas) -- fallback cuando no hay HTML aprovechable
  //     (origen no es una hoja de cálculo, o el HTML no trae ninguna
  //     `<table>`).
  // A diferencia de la primera versión (columnas de más se recortaban),
  // ahora la tabla CRECE para que quepa todo -- filas Y columnas nuevas se
  // agregan siempre AL FINAL (nunca insertadas en medio), así que no hace
  // falta correr fórmulas ni el alcance de formato condicional por índice
  // (eso sí sería necesario para una inserción a mitad de tabla, ver
  // splitNormalCellInto más abajo).
  const handlePasteGrid = useCallback((ri: number, ci: number, e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData?.getData('text/html') ?? '';
    const parsed = html ? parseHtmlClipboardTable(html) : null;

    let pastedRows: string[][];
    let pastedMerges: ParsedClipboardGrid['merges'] = [];
    let pastedBackgrounds: (string | undefined)[][] = [];
    let pastedAligns: (string | undefined)[][] = [];

    if (parsed) {
      pastedRows = parsed.rows;
      pastedMerges = parsed.merges;
      pastedBackgrounds = parsed.backgrounds;
      pastedAligns = parsed.aligns;
    } else {
      const grid = parsePlainTextClipboardGrid(e.clipboardData?.getData('text/plain') ?? '');
      if (!grid) return;
      pastedRows = grid;
    }

    if (pastedRows.length === 0 || (pastedRows.length === 1 && pastedRows[0].length <= 1)) return; // una sola celda -- paste normal del navegador
    e.preventDefault();

    const current = rowsRef.current;
    const pastedColCount = Math.max(...pastedRows.map((r) => r.length));
    const targetRowCount = Math.max(current.length, ri + pastedRows.length);
    const targetColCount = Math.max(colCount, ci + pastedColCount);
    const addedCols = targetColCount - colCount;

    const growRow = <T,>(row: T[] | undefined, length: number, fill: T): T[] => {
      const next = (row || []).slice();
      while (next.length < length) next.push(fill);
      return next;
    };

    const nextRows: string[][] = [];
    for (let r = 0; r < targetRowCount; r += 1) {
      nextRows.push(growRow(r < current.length ? current[r] : [], targetColCount, ''));
    }
    const bgSrc = liveCellBackgrounds.length ? liveCellBackgrounds : current.map(() => []);
    const nextCellBackgrounds: string[][] = [];
    for (let r = 0; r < targetRowCount; r += 1) {
      nextCellBackgrounds.push(growRow(bgSrc[r], targetColCount, ''));
    }
    const alSrc = liveCellAligns.length ? liveCellAligns : current.map(() => []);
    const nextCellAligns: string[][] = [];
    for (let r = 0; r < targetRowCount; r += 1) {
      nextCellAligns.push(growRow(alSrc[r], targetColCount, ''));
    }

    let focusedCellValue = '';
    pastedRows.forEach((line, rOffset) => {
      line.forEach((value, cOffset) => {
        const targetRow = ri + rOffset;
        const targetCol = ci + cOffset;
        const safeValue = escapeHtml(String(value ?? '').trim());
        nextRows[targetRow][targetCol] = safeValue;
        if (rOffset === 0 && cOffset === 0) focusedCellValue = safeValue;
        const bg = pastedBackgrounds[rOffset]?.[cOffset];
        if (bg) nextCellBackgrounds[targetRow][targetCol] = bg;
        const align = pastedAligns[rOffset]?.[cOffset];
        if (align) nextCellAligns[targetRow][targetCol] = align;
      });
    });

    // Fusiones detectadas en el HTML de origen, trasladadas a su posición
    // real dentro de la tabla destino (offset por ri/ci) -- se descarta
    // cualquiera que pisaría una fusión YA existente en la tabla destino,
    // para no corromper su estructura.
    const existingCovered = new Set<string>();
    liveMergedCells.forEach((m) => {
      for (let r = m.row; r < m.row + m.rowSpan; r += 1) {
        for (let c = m.column; c < m.column + m.colSpan; c += 1) existingCovered.add(`${r}-${c}`);
      }
    });
    const newMerges: MergedCell[] = [];
    pastedMerges.forEach((m) => {
      const row = ri + m.row;
      const column = ci + m.column;
      let overlaps = false;
      for (let r = row; r < row + m.rowSpan && !overlaps; r += 1) {
        for (let c = column; c < column + m.colSpan; c += 1) {
          if (existingCovered.has(`${r}-${c}`)) { overlaps = true; break; }
        }
      }
      if (!overlaps) newMerges.push({ row, column, rowSpan: m.rowSpan, colSpan: m.colSpan });
    });
    const nextMergedCells = newMerges.length ? [...liveMergedCells, ...newMerges] : liveMergedCells;

    // Si hicieron falta columnas nuevas, se extienden también colWidths y
    // columnBackgrounds -- siempre agregadas AL FINAL, nunca insertadas en
    // medio (ver comentario de la función), así que no hace falta correr
    // fórmulas ni el alcance de formato condicional por índice de columna.
    let nextColWidths: number[] | undefined;
    let nextColumnBackgrounds: string[] | undefined;
    if (addedCols > 0) {
      const evenWidth = Math.max(MIN_COL_WIDTH, widths[widths.length - 1] || 120);
      nextColWidths = [...widths, ...Array(addedCols).fill(evenWidth)];
      if (Array.isArray(columnBackgrounds)) {
        nextColumnBackgrounds = [...columnBackgrounds, ...Array(addedCols).fill('')];
      }
    }

    setLiveCellBackgrounds(nextCellBackgrounds);
    setLiveCellAligns(nextCellAligns);
    if (newMerges.length) setLiveMergedCells(nextMergedCells);

    // La celda enfocada (donde se disparó el paste) NO se re-siembra desde
    // `value` mientras tenga el foco (ver el useEffect de TableCell más
    // arriba, a propósito para no interrumpir a alguien escribiendo) --
    // sin esto, el pegado no se veía en pantalla hasta hacer clic fuera de
    // la tabla (bug real reportado). Se actualiza acá mismo, de una, para
    // que se vea de inmediato igual que las demás celdas.
    if (e.currentTarget) e.currentTarget.innerHTML = focusedCellValue;

    onSmartPasteGrid?.({
      rows: nextRows,
      cellBackgrounds: nextCellBackgrounds,
      cellAligns: nextCellAligns,
      mergedCells: nextMergedCells,
      colWidths: nextColWidths,
      columnBackgrounds: nextColumnBackgrounds,
    });
  }, [colCount, widths, columnBackgrounds, liveCellBackgrounds, liveCellAligns, liveMergedCells, onSmartPasteGrid]);

  const syncToolbarTextColor = useCallback((cellEl: HTMLElement) => {
    const textNode = resolveFormattedElement(cellEl);
    const computed = window.getComputedStyle(textNode);
    setToolbarTextColor(computed.color || '#dc2626');
    // Resaltador (como marcador de texto): fondo INLINE de la selección,
    // no el fondo de la celda (ese es otro control, más abajo, por
    // celda/fila/columna). "transparent"/rgba(0,0,0,0) = sin resaltar.
    const bg = computed.backgroundColor;
    setToolbarHighlightColor(bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' ? bg : 'transparent');
    // Botones presionados/activos según el formato real en el cursor —
    // bug real reportado: solo el color se reflejaba, negrita/cursiva/
    // subrayado nunca se veían "presionados" al mover el cursor sobre
    // texto ya formateado.
    setToolbarActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
    });
    const px = Math.round(parseFloat(computed.fontSize));
    setToolbarFontSize(Number.isFinite(px) && px > 0 ? px : fontSize);
    const rawFamily = computed.fontFamily || FONT_FAMILY_OPTIONS[0].value;
    const matchedFamily = FONT_FAMILY_OPTIONS.find((opt) => primaryFontFamily(opt.value) === primaryFontFamily(rawFamily));
    setToolbarFontFamily(matchedFamily ? matchedFamily.value : rawFamily);
  }, [fontSize]);

  const positionToolbar = useCallback((ri: number, ci: number, cellEl: HTMLElement) => {
    focusedCellRef.current = cellEl;
    focusedPosRef.current = { ri, ci };
    syncToolbarTextColor(cellEl);
    setToolbarAlign(((liveCellAligns[ri]?.[ci] as 'left' | 'center' | 'right') || cellAlign));
    setToolbarNumberFormat(liveCellNumberFormats[ri]?.[ci] ?? null);
    // La barra de formato ocupa el MISMO lugar (arriba de la tabla) que la
    // barra de fila/columna/autoajustar -- nunca se muestran las dos a la
    // vez (esta reemplaza a esa mientras se edita una celda, ver
    // `showControls` más abajo), así que ya no hace falta calcular una
    // posición dinámica por celda: antes vivía DEBAJO de la tabla y ahí se
    // salía de la pantalla cuando el disparador de color quedaba muy abajo.
    setToolbar(true);
  }, [syncToolbarTextColor, liveCellAligns, cellAlign, liveCellNumberFormats]);

  // ── Aplicar formato a VARIAS celdas a la vez ─────────────────────────────
  // Mejora explícita: ya existía la posibilidad de seleccionar varias
  // celdas (clic + arrastrar en modo edición, ver `selectedCells`), pero
  // los botones de la barra (negrita/cursiva/subrayado/color/fuente/tamaño)
  // solo afectaban a la celda con foco, ignorando esa selección. Estos
  // helpers alimentan a `exec`/`applyHighlightColor`/`wrapSelectionWithStyle`
  // más abajo para que, cuando hay MÁS de una celda seleccionada, la acción
  // se aplique a TODAS ellas (todo el contenido de cada una, como un
  // Ctrl+A por celda); con una sola celda (o ninguna selección de grupo) el
  // comportamiento de siempre -- respetar la selección de texto puntual
  // dentro de esa celda -- queda intacto.
  const getFormatTargets = useCallback((): CellPosition[] => {
    if (selectedCells.length > 1) return selectedCells;
    const pos = focusedPosRef.current;
    return pos ? [{ row: pos.ri, column: pos.ci }] : [];
  }, [selectedCells]);

  const getCellEditableEl = useCallback((row: number, column: number): HTMLElement | null =>
    containerRef.current?.querySelector<HTMLElement>(`[data-cell-key="${row}-${column}"] .table-cell-editable`) || null,
  []);

  /** true solo cuando el ÚNICO objetivo es la celda que está realmente en
   * modo "editando texto" (doble clic, cursor real) -- en ese caso SÍ tiene
   * sentido operar sobre la selección de texto en vivo (negrita solo de la
   * palabra seleccionada, etc.). En cualquier otro caso (una celda
   * simplemente SELECCIONADA sin cursor, o varias celdas) no hay cursor de
   * verdad del que partir, así que exec/wrapSelectionWithStyle usan el
   * mismo camino robusto (contentEditable desacoplado) que ya usaban para
   * grupos de celdas -- aplicando al contenido COMPLETO de cada una. */
  const isLiveTextEditTarget = useCallback((targets: CellPosition[]): boolean => (
    targets.length === 1 && !!textEditingCell
    && textEditingCell.row === targets[0].row && textEditingCell.column === targets[0].column
  ), [textEditingCell]);

  /** Ejecuta `run` (que llama a `document.execCommand`) sobre el contenido
   * de cada celda del grupo, en un contentEditable TEMPORAL desacoplado del
   * lienzo (adjunto un instante fuera de pantalla -- execCommand exige que
   * el nodo esté adjunto al documento, pero no que sea visible ni el de la
   * celda real). Bug real reportado DOS VECES: ciclar foco entre las
   * celdas VIVAS del lienzo, una por una en el mismo bucle síncrono, no era
   * confiable -- el navegador no siempre "asienta" el foco/la selección a
   * tiempo entre una celda y la siguiente, así que algunas quedaban sin
   * aplicar aunque el código las recorriera igual. Un editable descartable
   * por celda aísla cada una por completo: no compite por el foco con
   * ninguna otra ni con el resto del lienzo. Acumula todos los cambios en
   * una copia local y confirma una sola vez (evita además el pisado que ya
   * se había corregido antes: llamar a `persistCell` por celda leía
   * `rowsRef.current`, que no se actualiza hasta el siguiente render). */
  const runCommandOnCellGroup = (targets: CellPosition[], run: () => void) => {
    const nextRows = rowsRef.current.map((r) => [...r]);
    let changed = false;
    targets.forEach(({ row, column }) => {
      const current = nextRows[row]?.[column];
      if (current === undefined) return;
      const scratch = document.createElement('div');
      scratch.contentEditable = 'true';
      scratch.style.position = 'fixed';
      scratch.style.top = '-9999px';
      scratch.style.left = '-9999px';
      scratch.innerHTML = sanitizeRichHtml(current);
      document.body.appendChild(scratch);
      scratch.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(scratch);
      sel?.removeAllRanges();
      sel?.addRange(range);
      run();
      nextRows[row][column] = sanitizeRichHtml(scratch.innerHTML);
      document.body.removeChild(scratch);
      changed = true;
    });
    if (changed) onUpdateCells?.(nextRows);
  };

  /** Misma construcción de <span> que ya hacía `wrapSelectionWithStyle`
   * (tamaño/fuente fijados explícitos + lo que pise `apply`), factorizada
   * para poder envolver el Range de CUALQUIER celda, no solo la enfocada. */
  const wrapRangeWithStyle = (range: Range, styleSourceEl: HTMLElement, apply: (span: HTMLSpanElement) => void): HTMLSpanElement => {
    const before = window.getComputedStyle(resolveFormattedElement(styleSourceEl));
    const span = document.createElement('span');
    span.style.setProperty('font-family', before.fontFamily, 'important');
    span.style.setProperty('font-size', before.fontSize, 'important');
    apply(span);
    try {
      range.surroundContents(span);
    } catch {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    }
    return span;
  };

  const exec = (command: string, value?: string) => {
    const targets = getFormatTargets();
    if (!isLiveTextEditTarget(targets)) {
      runCommandOnCellGroup(targets, () => { document.execCommand(command, false, value); });
      const cell = focusedCellRef.current;
      if (cell) requestAnimationFrame(() => syncToolbarTextColor(cell));
      return;
    }
    const cell = focusedCellRef.current;
    const pos = focusedPosRef.current;
    if (!cell || !pos) return;
    cell.focus();
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRangeRef.current);
      savedRangeRef.current = null;
    }
    document.execCommand(command, false, value);
    persistCell(pos.ri, pos.ci, sanitizeRichHtml(cell.innerHTML));
    requestAnimationFrame(() => syncToolbarTextColor(cell));
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };

  /** Envuelve el texto REALMENTE seleccionado (Range con contenido, no un
   * cursor) en un <span> con el estilo inline que arme `apply` -- usado
   * tanto para el tamaño de fuente como para la familia tipográfica. No usa
   * `execCommand('fontSize', ...)`: esa es la escala legada de HTML (1-7,
   * sin relación directa con px) y su comportamiento es inconsistente
   * cuando el texto YA trae un tamaño/fuente inline de una pasada anterior
   * de esta misma función -- exactamente el caso real reportado ("con el
   * texto seleccionado no hace nada"): al no encontrarse el `<font
   * size="7">` esperado, no había nada que reemplazar. `surroundContents`
   * cubre el caso simple; si el rango cruza límites de etiquetas (negrita
   * parcial, etc.) cae al patrón extract+insert, que funciona para
   * cualquier selección dentro de la celda. Si no hay texto realmente
   * seleccionado (solo un cursor), aplica a la celda completa -- más útil
   * que no hacer nada. */
  const wrapSelectionWithStyle = useCallback((apply: (span: HTMLSpanElement) => void) => {
    const targets = getFormatTargets();
    if (!isLiveTextEditTarget(targets)) {
      // Igual que `runCommandOnCellGroup`: el "antes" (tamaño/fuente a
      // preservar) se lee de la celda VIVA (getComputedStyle exige que el
      // nodo esté realmente renderizado en su contexto para heredar bien),
      // pero la MUTACIÓN ocurre sobre una copia desacoplada -- así ninguna
      // celda depende de que otra haya terminado de procesarse primero.
      const nextRows = rowsRef.current.map((r) => [...r]);
      let changed = false;
      targets.forEach(({ row, column }) => {
        const liveEl = getCellEditableEl(row, column);
        const current = nextRows[row]?.[column];
        if (!liveEl || current === undefined) return;
        const scratch = document.createElement('div');
        scratch.innerHTML = sanitizeRichHtml(current);
        const range = document.createRange();
        range.selectNodeContents(scratch);
        wrapRangeWithStyle(range, liveEl, apply);
        nextRows[row][column] = sanitizeRichHtml(scratch.innerHTML);
        changed = true;
      });
      if (changed) onUpdateCells?.(nextRows);
      const cell = focusedCellRef.current;
      if (cell) requestAnimationFrame(() => syncToolbarTextColor(cell));
      return;
    }

    const cell = focusedCellRef.current;
    const pos = focusedPosRef.current;
    if (!cell || !pos) return;
    cell.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
      savedRangeRef.current = null;
    }
    if (sel.rangeCount === 0 || sel.isCollapsed) {
      const full = document.createRange();
      full.selectNodeContents(cell);
      sel.removeAllRanges();
      sel.addRange(full);
    }
    const range = sel.getRangeAt(0);
    // Se fija EXPLÍCITAMENTE el tamaño y la fuente actuales en el span
    // nuevo (leídos ANTES de mover el texto, mientras sigue en su posición
    // original) y recién después se deja que `apply` pise SOLO la que
    // corresponda. Bug real reportado: sin esto, un span que solo fijaba
    // `fontSize` dejaba `fontFamily` sin especificar -- lo normal sería que
    // heredara la fuente real del texto, pero terminaba heredando de algún
    // ancestro con OTRA fuente (Rajdhani) apenas se movía el nodo, así que
    // cambiar el tamaño "cambiaba" también la fuente visualmente.
    const span = wrapRangeWithStyle(range, cell, apply);
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    persistCell(pos.ri, pos.ci, sanitizeRichHtml(cell.innerHTML));
    requestAnimationFrame(() => syncToolbarTextColor(cell));
  }, [persistCell, syncToolbarTextColor, getFormatTargets, getCellEditableEl, onUpdateCells, isLiveTextEditTarget]);

  const applyFontSize = useCallback((px: number) => {
    const clamped = Math.max(6, Math.min(200, Math.round(px)));
    wrapSelectionWithStyle((span) => { span.style.setProperty('font-size', `${clamped}px`, 'important'); });
    setToolbarFontSize(clamped);
  }, [wrapSelectionWithStyle]);

  const applyFontFamily = useCallback((fontFamily: string) => {
    wrapSelectionWithStyle((span) => { span.style.setProperty('font-family', fontFamily, 'important'); });
    setToolbarFontFamily(fontFamily);
  }, [wrapSelectionWithStyle]);

  /** Resaltador de texto (como un marcador/subrayador de libro), color de
   * fondo INLINE de la selección — distinto del fondo de la celda entera
   * (ese es el otro control, por celda/fila/columna, más abajo). `hiliteColor`
   * es el comando estándar para esto; `backColor` es el alias que entienden
   * los navegadores que no soportan el primero. */
  const applyHighlightColor = (color: string) => {
    const targets = getFormatTargets();
    if (!isLiveTextEditTarget(targets)) {
      const supportsHilite = document.queryCommandSupported?.('hiliteColor');
      runCommandOnCellGroup(targets, () => {
        document.execCommand(supportsHilite ? 'hiliteColor' : 'backColor', false, color);
      });
      setToolbarHighlightColor(color);
      const cell = focusedCellRef.current;
      if (cell) requestAnimationFrame(() => syncToolbarTextColor(cell));
      return;
    }

    const cell = focusedCellRef.current;
    const pos = focusedPosRef.current;
    if (!cell || !pos) return;
    cell.focus();
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRangeRef.current);
      savedRangeRef.current = null;
    }
    const supportsHilite = document.queryCommandSupported?.('hiliteColor');
    document.execCommand(supportsHilite ? 'hiliteColor' : 'backColor', false, color);
    persistCell(pos.ri, pos.ci, sanitizeRichHtml(cell.innerHTML));
    setToolbarHighlightColor(color);
    requestAnimationFrame(() => syncToolbarTextColor(cell));
  };

  /** Alineación de texto -- de TODAS las celdas del grupo seleccionado si
   * hay más de una (ver `getFormatTargets`), o solo de la celda enfocada.
   * Distinto de `cellAlign`, que es el valor por defecto de toda la tabla
   * cuando una celda no tiene una alineación propia. */
  const applyCellAlign = useCallback((align: 'left' | 'center' | 'right') => {
    const targets = getFormatTargets();
    if (targets.length === 0) return;
    const next = rows.map((row, ri) => row.map((_, ci) => (
      targets.some((t) => t.row === ri && t.column === ci) ? align : liveCellAligns[ri]?.[ci] || ''
    )));
    setLiveCellAligns(next);
    setToolbarAlign(align);
    onUpdateCellAligns?.(next);
  }, [rows, liveCellAligns, onUpdateCellAligns, getFormatTargets]);

  // Botones "%" / decimales de la barra -- aplican sobre la(s) celda(s)
  // seleccionada(s) (misma selección múltiple que negrita/color/fuente).
  // `transform` recibe el formato ACTUAL de cada celda destino y devuelve
  // el nuevo -- así "%" alterna y +/- decimales suma/resta sobre lo que ya
  // tuviera esa celda en particular, no un valor fijo para toda la
  // selección (dos celdas con distintos decimales pueden convivir).
  const applyCellNumberFormatTransform = useCallback((transform: (current: string | null) => string | null) => {
    const targets = getFormatTargets();
    if (targets.length === 0) return;
    const next = rows.map((row, ri) => row.map((_, ci) => (
      targets.some((t) => t.row === ri && t.column === ci)
        ? transform(liveCellNumberFormats[ri]?.[ci] ?? null)
        : liveCellNumberFormats[ri]?.[ci] ?? null
    )));
    setLiveCellNumberFormats(next);
    onUpdateCellNumberFormats?.(next);
  }, [rows, liveCellNumberFormats, onUpdateCellNumberFormats, getFormatTargets]);

  const toggleCellPercent = useCallback(() => {
    applyCellNumberFormatTransform(togglePercentFormat);
  }, [applyCellNumberFormatTransform]);

  const bumpCellDecimals = useCallback((delta: number) => {
    applyCellNumberFormatTransform((current) => bumpDecimals(current, delta));
  }, [applyCellNumberFormatTransform]);

  // Salir del modo edición (Escape / botón / clic en otro elemento) no
  // siempre dispara un blur real del contentEditable a tiempo -- cerrar la
  // barra de formato explícitamente ante el cambio de `editing` evita que
  // quede "pegada" a la vez que la barra de fila/col vuelve a aparecer.
  useEffect(() => {
    if (!editing) {
      setToolbar(false);
      // Si se deselecciona la tabla entera mientras se editaba el texto de
      // una celda puntual, no debe quedar "recordado" para la próxima vez
      // que se vuelva a seleccionar esta misma tabla.
      setTextEditingCell(null);
      // Escape no siempre dispara un blur nativo del contentEditable -- sin
      // esto la celda podía seguir mostrando el cursor parpadeando aunque
      // ya se haya "salido" de la edición a nivel React/lienzo.
      if (document.activeElement instanceof HTMLElement && containerRef.current?.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }
  }, [editing]);

  // Cerrar la barra al perder el foco fuera de la tabla.
  useEffect(() => {
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (!containerRef.current?.contains(document.activeElement)) {
          setToolbar(false);
        }
      }, 150);
    };
    const cont = containerRef.current;
    cont?.addEventListener('focusout', onFocusOut);
    return () => cont?.removeEventListener('focusout', onFocusOut);
  }, []);

  // Una selección de celdas es un estado transitorio, no una marca
  // permanente del documento. Al pulsar fuera de esta tabla se descarta para
  // que no queden bordes azules visualmente "pegados" en el lienzo.
  useEffect(() => {
    const clearSelectionOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      // Bug real reportado (2026-09-01): el formato condicional ahora deja
      // acotar una regla/escala a la selección de celdas activa (ver
      // lib/tableCellSelectionBridge.ts) -- elegir el alcance, escribir el
      // valor o abrir un selector de color en el PANEL DERECHO caía en esta
      // rama "clic afuera de la tabla" y borraba la selección antes de que
      // "Guardar regla"/"Aplicar escala" pudiera leerla, así que el alcance
      // elegido nunca llegaba a guardarse (la regla terminaba aplicando a
      // toda la tabla en silencio). El selector de color además se porta a
      // document.body (fuera del panel), así que se excluye aparte.
      if (
        target instanceof Element &&
        (target.closest('.panel--right') || target.closest('.color-palette-popover'))
      ) return;
      tableSelectionDragRef.current = false;
      selectedCellsRef.current = [];
      setSelectedCells([]);
      setCellMenu(null);
    };
    document.addEventListener('mousedown', clearSelectionOutside);
    return () => document.removeEventListener('mousedown', clearSelectionOutside);
  }, []);

  // El menú de "Fusionar celdas"/"Dividir celda" (click derecho) es aparte
  // de la selección de arriba: esa solo se cierra con un clic FUERA de la
  // tabla, pero este menú debe cerrarse con cualquier clic que no sea sobre
  // él mismo -- incluido un clic en OTRA celda de la misma tabla (bug real
  // reportado: quedaba pegado en pantalla hasta hacer clic fuera de toda la
  // tabla) -- y también con Escape, como cualquier otro menú contextual.
  useEffect(() => {
    if (!cellMenu) return undefined;
    const closeOnAnyClickElsewhere = (event: MouseEvent) => {
      const target = event.target as Node;
      if (target instanceof Element && target.closest('.table-cell-context-menu')) return;
      setCellMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCellMenu(null);
    };
    document.addEventListener('mousedown', closeOnAnyClickElsewhere);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnAnyClickElsewhere);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [cellMenu]);

  // ── Auto-crecimiento del bloque al contenido real ───────────────────────
  // Reporta el tamaño NATURAL de la tabla (ancho = suma de columnas, alto =
  // altura real renderizada, que crece solo con texto multilínea porque las
  // celdas son simples <div> de flujo normal) — PageCanvas.tsx usa esto para
  // agrandar element.width/height. Nunca los encoge automáticamente (eso
  // rompería un resize manual que el usuario acaba de hacer); solo crece.
  const lastReportedRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = tableWrapRef.current;
    if (!el || !onNaturalSize) return undefined;
    const report = () => {
      const naturalH = el.scrollHeight;
      // El ancho NUNCA se mide del DOM (el.scrollWidth) -- eso realimentaba
      // el ancho del bloque de vuelta hacia sí mismo (ver comentario sobre
      // `didPersistDefaultWidthsRef` más arriba: containerWidth → colWidths
      // → ancho medido → crece containerWidth → ...). El ancho real de la
      // tabla es, por definición, la suma de `colWidths` (persistidos) —
      // una cantidad que el usuario controla explícitamente (resize/autofit/
      // agregar columna), nunca algo a "redescubrir" midiendo el DOM.
      // El ancho visual lo gobierna el encuadre del elemento, no la suma de
      // anchos persistidos de columnas. Así una tabla existente acompaña un
      // resize del bloque sin volver a ensancharlo en el siguiente render.
      const naturalW = containerWidth;
      const last = lastReportedRef.current;
      // Épsilon de 2px para no entrar en un loop de reportes por
      // redondeos de subpíxel entre renders.
      if (Math.abs(naturalH - last.h) > 2 || Math.abs(naturalW - last.w) > 2) {
        lastReportedRef.current = { w: naturalW, h: naturalH };
        onNaturalSize(naturalW, naturalH);
      }
    };
    report();
    const ro = new ResizeObserver(() => report());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, containerWidth, cellPadding, fontSize, title]);

  // ── Desborde de página: filas que ya no caben en lo que resta de la hoja ──
  // Mismo principio que la partición de texto (splitOverflowingText en el
  // store): mide dónde termina cada fila (rowRefs, el mismo mecanismo que
  // ya usan los tiradores de resize) contra `maxTableHeight` (calculado por
  // el llamador como CONTENT_BOTTOM - element.y) y, si la tabla completa ya
  // no entra, reporta hasta qué fila SÍ cabe -- el store parte la tabla en
  // "la que se queda" + una continuación en la siguiente página que repite
  // el encabezado, igual que una tabla larga en Word.
  const lastReportedOverflowRef = useRef<{ rowCount: number; total: number } | null>(null);
  useLayoutEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap || !onOverflowRows || !Number.isFinite(maxTableHeight) || rows.length === 0) return undefined;
    const cap = maxTableHeight as number;
    const measure = () => {
      const wrapRect = wrap.getBoundingClientRect();
      const totalHeight = wrapRect.height;
      if (totalHeight <= cap + 0.5) {
        lastReportedOverflowRef.current = null;
        return;
      }
      let fittingRowCount = 0;
      let fittingHeightPx = 0;
      for (let ri = 0; ri < rows.length; ri += 1) {
        const rowEl = rowRefs.current.get(ri);
        if (!rowEl) break;
        const bottom = rowEl.getBoundingClientRect().bottom - wrapRect.top;
        if (bottom > cap) break;
        fittingRowCount = ri + 1;
        fittingHeightPx = bottom;
      }
      if (fittingRowCount === 0) {
        // Ni la primera fila entra -- se fuerza que se quede al menos 1
        // (nunca una tabla "origen" vacía); si el desborde persiste se
        // resuelve en cascada cuando la continuación se mida a su vez.
        const first = rowRefs.current.get(0);
        fittingRowCount = 1;
        fittingHeightPx = first ? first.getBoundingClientRect().bottom - wrapRect.top : totalHeight;
      }
      fittingRowCount = Math.min(fittingRowCount, rows.length - 1);
      if (fittingRowCount < 1) return; // tabla de una sola fila: nada que partir con sentido
      const last = lastReportedOverflowRef.current;
      if (last && last.rowCount === fittingRowCount && Math.abs(last.total - totalHeight) < 2) return;
      lastReportedOverflowRef.current = { rowCount: fittingRowCount, total: totalHeight };
      onOverflowRows(fittingRowCount, fittingHeightPx, totalHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
    // El ResizeObserver ya remide ante cualquier cambio real de layout
    // (ancho de columna incluido); `effectiveWidths` no se puede referenciar
    // aquí sin TDZ (se declara más abajo) y no hace falta como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, maxTableHeight, onOverflowRows, fontSize, cellPadding]);

  // ── Resize manual de columnas (arrastrar el borde entre dos columnas) ───
  // Igual que Word/Excel: arrastrar un borde INTERIOR redistribuye ancho
  // entre las 2 columnas vecinas (el ancho total de la tabla no cambia).
  // Arrastrar el borde DESPUÉS de la última columna sí cambia el ancho total
  // (única forma de agrandar/achicar la tabla a mano, además de agregar
  // filas/columnas).
  const dragStateRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);
  const [dragWidths, setDragWidths] = useState<number[] | null>(null);

  const beginColumnResize = useCallback((index: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = { index, startX: event.clientX, startWidths: [...widths] };
    setDragWidths([...widths]);

    const onMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      const next = [...drag.startWidths];
      const isLast = drag.index === next.length - 1;
      if (isLast) {
        next[drag.index] = Math.max(MIN_COL_WIDTH, drag.startWidths[drag.index] + delta);
      } else {
        const left = Math.max(MIN_COL_WIDTH, drag.startWidths[drag.index] + delta);
        const rightDelta = drag.startWidths[drag.index] - left;
        const right = Math.max(MIN_COL_WIDTH, drag.startWidths[drag.index + 1] + rightDelta);
        // Si el vecino derecho tocó su mínimo, no seguir robándole ancho.
        next[drag.index] = drag.startWidths[drag.index] + drag.startWidths[drag.index + 1] - right;
        next[drag.index + 1] = right;
      }
      setDragWidths(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragWidths((cur) => {
        if (cur) onUpdateColWidths?.(cur);
        return null;
      });
      dragStateRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [widths, onUpdateColWidths]);

  const rawEffectiveWidths = dragWidths || widths;
  const rawEffectiveTotal = rawEffectiveWidths.reduce((a, b) => a + b, 0) || 1;
  const effectiveWidths = rawEffectiveWidths.map((width) => width * containerWidth / rawEffectiveTotal);

  // Fórmulas tipo Excel (=SUMA(A1:A3), =A1+B1*2...) — se recalculan solo
  // cuando cambia el contenido de la tabla. Una celda con fórmula se sigue
  // editando como texto plano normal (la celda GUARDA literalmente
  // "=SUMA(A1:A3)"); lo único que cambia es que en reposo se le superpone
  // el resultado calculado (ver el overlay junto a <TableCell> más abajo),
  // el mismo truco de "texto invisible + capa encima" que ya usa
  // ReadOnlyViewer.tsx para el overlay de PPTX.
  const formulaResults = useMemo(() => computeTableFormulas(rows), [rows]);

  // Formato condicional (Fase 3): pinta fondo/texto según el valor efectivo
  // de cada celda (propio o resultado de fórmula) contra las reglas del
  // usuario -- ver Formato condicional en RightInspector.tsx.
  const effectiveCellValues = useMemo(() => getEffectiveCellValues(rows, formulaResults), [rows, formulaResults]);
  const conditionalStyles = useMemo(
    () => computeConditionalStyles(effectiveCellValues, conditionalFormats, hasHeader, colorScales),
    [effectiveCellValues, conditionalFormats, hasHeader, colorScales],
  );
  const totalWidth = Math.max(1, containerWidth);

  // ── Resize manual de filas (arrastrar el borde inferior de una fila) ────
  // A diferencia de las columnas, cada fila es independiente: arrastrar su
  // borde no le "roba" alto a la fila vecina, solo fija un alto explícito
  // para ESA fila (0/ausente = automático, según el contenido, de siempre).
  const rowDragStateRef = useRef<{ index: number; startY: number; startHeight: number } | null>(null);
  const [dragRowHeight, setDragRowHeight] = useState<{ index: number; height: number } | null>(null);

  const beginRowResize = useCallback((index: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rowEl = rowRefs.current.get(index);
    const startHeight = rowEl ? rowEl.getBoundingClientRect().height : MIN_ROW_HEIGHT;
    rowDragStateRef.current = { index, startY: event.clientY, startHeight };
    setDragRowHeight({ index, height: startHeight });

    const onMove = (e: MouseEvent) => {
      const drag = rowDragStateRef.current;
      if (!drag) return;
      const delta = e.clientY - drag.startY;
      setDragRowHeight({ index: drag.index, height: Math.max(MIN_ROW_HEIGHT, drag.startHeight + delta) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragRowHeight((cur) => {
        if (cur) {
          setLiveRowHeights((prevHeights) => {
            const next = [...prevHeights];
            next[cur.index] = cur.height;
            onUpdateRowHeights?.(next);
            return next;
          });
        }
        return null;
      });
      rowDragStateRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onUpdateRowHeights]);

  const effectiveRowHeight = (ri: number): number | undefined => {
    if (dragRowHeight && dragRowHeight.index === ri) return dragRowHeight.height;
    return liveRowHeights[ri] > 0 ? liveRowHeights[ri] : undefined;
  };

  // Los bordes de fila se miden del DOM real (no se pueden precalcular como
  // los de columna): el alto de una fila en modo automático depende de su
  // contenido. Se remide con ResizeObserver ante cualquier cambio visual.
  useLayoutEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap || !selected) return undefined;
    const measure = () => {
      const wrapTop = wrap.getBoundingClientRect().top;
      const next = rows.map((_, ri) => {
        const el = rowRefs.current.get(ri);
        return el ? el.getBoundingClientRect().bottom - wrapTop : 0;
      });
      setRowOffsets((prev) => (
        prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 0.5) ? prev : next
      ));
    };
    measure();
    const ro = new ResizeObserver(measure);
    rowRefs.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, effectiveWidths, fontSize, cellPadding, dragRowHeight, liveRowHeights, selected]);

  useEffect(() => {
    setLiveCellBackgrounds(cellBackgrounds || []);
  }, [cellBackgrounds]);

  useEffect(() => {
    setLiveMergedCells(mergedCells);
  }, [mergedCells]);

  useEffect(() => {
    setLiveCellAligns(cellAligns || []);
  }, [cellAligns]);

  useEffect(() => {
    setLiveRowHeights(normalizeRowHeights(rowHeights, rows.length));
  }, [rowHeights, rows.length]);

  const applyBackgroundColor = useCallback((color: string) => {
    const selectedCell = activeCellRef.current;
    if (!selectedCell) return;
    const next = rows.map((row, rowIndex) => row.map((_, columnIndex) => {
      const applies = colorTarget === 'cell'
        ? rowIndex === selectedCell.row && columnIndex === selectedCell.column
        : colorTarget === 'row'
          ? rowIndex === selectedCell.row
          : columnIndex === selectedCell.column;
      return applies ? color : liveCellBackgrounds[rowIndex]?.[columnIndex] || '';
    }));
    // Estado local para que el cambio sea visible mientras la paleta sigue
    // abierta, sin depender del siguiente render del padre.
    setLiveCellBackgrounds(next);
    onUpdateCellBackgrounds?.(next);
    // Las capas anteriores dejan de competir: el color se materializa por
    // celda, permitiendo luego volver a pintar una sola celda.
    onUpdateRowBackgrounds?.([]);
    onUpdateColumnBackgrounds?.([]);
  }, [colorTarget, rows, liveCellBackgrounds, colCount, onUpdateCellBackgrounds, onUpdateRowBackgrounds, onUpdateColumnBackgrounds]);

  const cellKey = (cell: CellPosition) => `${cell.row}-${cell.column}`;

  const mergedAnchorByKey = new Map(liveMergedCells.map((merge) => [cellKey(merge), merge]));
  const mergedCoveredKeys = new Set<string>();
  liveMergedCells.forEach((merge) => {
    for (let row = merge.row; row < merge.row + merge.rowSpan; row += 1) {
      for (let column = merge.column; column < merge.column + merge.colSpan; column += 1) {
        if (row !== merge.row || column !== merge.column) mergedCoveredKeys.add(cellKey({ row, column }));
      }
    }
  });

  /** true si el borde de columna `boundaryIndex` (entre las columnas
   * boundaryIndex y boundaryIndex+1) queda DENTRO de una fusión horizontal
   * activa en la fila `ri` -- ahí no hay ninguna costura real que agarrar
   * ni que resaltar, es interior a un bloque fusionado (el contorno DE
   * AFUERA del bloque sigue siendo un borde real y no lo marca esta
   * función -- solo excluye el borde estrictamente entre `m.column` y
   * `m.column + m.colSpan - 1`). */
  const isColBoundaryMerged = (boundaryIndex: number, ri: number): boolean => liveMergedCells.some((m) => (
    m.colSpan > 1
    && m.column <= boundaryIndex && boundaryIndex < m.column + m.colSpan - 1
    && m.row <= ri && ri < m.row + m.rowSpan
  ));

  /** Simétrico a `isColBoundaryMerged`, para bordes de FILA dentro de una
   * fusión vertical activa en la columna `ci`. */
  const isRowBoundaryMerged = (boundaryIndex: number, ci: number): boolean => liveMergedCells.some((m) => (
    m.rowSpan > 1
    && m.row <= boundaryIndex && boundaryIndex < m.row + m.rowSpan - 1
    && m.column <= ci && ci < m.column + m.colSpan
  ));

  // La fusión se limita a una fila o columna continua: es el alcance pedido
  // y evita deformar la grilla con selecciones rectangulares complejas.
  const mergeSelection = useCallback((): CellPosition[] | null => {
    const cells = selectedCellsRef.current;
    if (cells.length < 2) return null;
    const unique = [...new Map(cells.map((cell) => [cellKey(cell), cell])).values()];
    const rowsInSelection = [...new Set(unique.map((cell) => cell.row))];
    const columnsInSelection = [...new Set(unique.map((cell) => cell.column))];
    const horizontal = rowsInSelection.length === 1;
    const vertical = columnsInSelection.length === 1;
    if (!horizontal && !vertical) return null;
    const indexes = (horizontal ? unique.map((cell) => cell.column) : unique.map((cell) => cell.row)).sort((a, b) => a - b);
    if (indexes.some((index, i) => i > 0 && index !== indexes[i - 1] + 1)) return null;
    if (unique.some((cell) => mergedAnchorByKey.has(cellKey(cell)) || mergedCoveredKeys.has(cellKey(cell)))) return null;
    return unique;
  }, [mergedAnchorByKey, mergedCoveredKeys]);

  const canMergeSelection = Boolean(mergeSelection());

  const mergeSelectedCells = useCallback(() => {
    const cells = mergeSelection();
    if (!cells) return;
    const startRow = Math.min(...cells.map((cell) => cell.row));
    const startColumn = Math.min(...cells.map((cell) => cell.column));
    const rowSpan = Math.max(...cells.map((cell) => cell.row)) - startRow + 1;
    const colSpan = Math.max(...cells.map((cell) => cell.column)) - startColumn + 1;
    const selectedKeys = new Set(cells.map(cellKey));
    const toPlainLine = (html: string) => {
      const node = document.createElement('div');
      node.innerHTML = sanitizeRichHtml(html || '');
      return (node.innerText || node.textContent || '').trim();
    };
    const escapeHtml = (text: string) => text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const combinedContent = cells
      .sort((a, b) => a.row - b.row || a.column - b.column)
      .map((cell) => toPlainLine(rows[cell.row]?.[cell.column] || ''))
      .filter(Boolean)
      .map(escapeHtml)
      .join('<br />');
    const nextRows = rows.map((row, rowIndex) => row.map((value, columnIndex) => {
      const key = cellKey({ row: rowIndex, column: columnIndex });
      if (!selectedKeys.has(key)) return value;
      return rowIndex === startRow && columnIndex === startColumn ? combinedContent : '';
    }));
    // Transparente sobrescribe el color previo de celda/fila/columna: el
    // contenido fusionado vuelve al aspecto por defecto de la tabla.
    const nextBackgrounds = rows.map((row, rowIndex) => row.map((_, columnIndex) => (
      selectedKeys.has(cellKey({ row: rowIndex, column: columnIndex })) ? 'transparent' : liveCellBackgrounds[rowIndex]?.[columnIndex] || ''
    )));
    const nextMergedCells = [...liveMergedCells, { row: startRow, column: startColumn, rowSpan, colSpan }];
    // Estado local primero: la fusión se ve al instante, aun antes de que el
    // store padre propague las nuevas props de la tabla.
    setLiveMergedCells(nextMergedCells);
    if (onMergeCells) {
      onMergeCells({ rows: nextRows, cellBackgrounds: nextBackgrounds, mergedCells: nextMergedCells });
    } else {
      onUpdateCells?.(nextRows);
      onUpdateCellBackgrounds?.(nextBackgrounds);
      onUpdateMergedCells?.(nextMergedCells);
    }
    setLiveCellBackgrounds(nextBackgrounds);
    selectedCellsRef.current = [{ row: startRow, column: startColumn }];
    setSelectedCells([{ row: startRow, column: startColumn }]);
    setCellMenu(null);
  }, [mergeSelection, rows, liveCellBackgrounds, liveMergedCells, onMergeCells, onUpdateCells, onUpdateCellBackgrounds, onUpdateMergedCells]);

  /** Inverso de la fusión, como en Excel: una celda fusionada de N
   * sub-celdas originales (a lo largo de una sola fila o columna, único
   * alcance que soporta la fusión -- ver `mergeSelection`) se puede dividir
   * de vuelta en cualquier cantidad de 2 a N partes, no solo "deshacer todo
   * a la vez". Con menos de N partes, algunas quedan más anchas/altas que
   * una celda original (p.ej. 4 -> 2 dejan dos celdas de doble tamaño cada
   * una) -- eso también son fusiones nuevas, más chicas, así que el
   * resultado se expresa reemplazando la entrada de `mergedCells` original
   * por 0 o más entradas nuevas (una por cada parte que siga ocupando más
   * de 1 sub-celda; una parte de tamaño 1 es simplemente una celda normal,
   * sin entrada). El contenido (ya combinado por la fusión) se queda tal
   * cual en la primera parte -- mismo criterio que Excel: dividir no intenta
   * repartir el texto entre las celdas resultantes. */
  const splitMergedCellInto = useCallback((anchorRow: number, anchorColumn: number, targetCount: number) => {
    const merge = mergedAnchorByKey.get(cellKey({ row: anchorRow, column: anchorColumn }));
    if (!merge) return;
    const horizontal = merge.colSpan > 1;
    const total = horizontal ? merge.colSpan : merge.rowSpan;
    if (targetCount < 2 || targetCount > total) return;

    // Reparte `total` sub-celdas en `targetCount` partes lo más parejo
    // posible (p.ej. 5 en 2 -> [3, 2]), igual que un `colWidths` parejo.
    const base = Math.floor(total / targetCount);
    const remainder = total % targetCount;
    const groupSizes = Array.from({ length: targetCount }, (_, i) => base + (i < remainder ? 1 : 0));

    const nextMergedCells = liveMergedCells.filter(
      (m) => !(m.row === anchorRow && m.column === anchorColumn),
    );
    let offset = 0;
    groupSizes.forEach((size) => {
      if (size > 1) {
        nextMergedCells.push({
          row: horizontal ? anchorRow : anchorRow + offset,
          column: horizontal ? anchorColumn + offset : anchorColumn,
          rowSpan: horizontal ? 1 : size,
          colSpan: horizontal ? size : 1,
        });
      }
      offset += size;
    });

    setLiveMergedCells(nextMergedCells);
    onUpdateMergedCells?.(nextMergedCells);
    selectedCellsRef.current = [{ row: anchorRow, column: anchorColumn }];
    setSelectedCells([{ row: anchorRow, column: anchorColumn }]);
    setCellMenu(null);
  }, [mergedAnchorByKey, liveMergedCells, onUpdateMergedCells]);

  /** Divide una celda NORMAL (sin fusión previa) en dos, insertando una
   * fila o columna real en TODA la tabla -- una tabla HTML no puede darle a
   * una sola celda más filas/columnas que sus vecinas sin colSpan/rowSpan,
   * así que la única forma de que SOLO esta celda se vea dividida es
   * insertar la fila/columna en todos lados y fusionar de vuelta (rowSpan/
   * colSpan 2) cada fila/columna ajena, para que sigan viéndose igual que
   * antes -- mismo truco que usa Word internamente. También corre las
   * referencias de fórmulas (`shiftFormulaRefs`) y el alcance de reglas de
   * formato condicional (`shiftScopedItems`) que apunten a celdas después
   * del punto de inserción, para que sigan señalando al mismo contenido
   * aunque su índice haya cambiado -- sin esto, dividir una celda en medio
   * de la tabla corrompería en silencio cualquier fórmula o regla más allá
   * del punto de inserción. */
  const splitNormalCellInto = useCallback((row: number, column: number, direction: 'row' | 'column') => {
    if (mergedAnchorByKey.has(cellKey({ row, column })) || mergedCoveredKeys.has(cellKey({ row, column }))) return;

    const axis: 'row' | 'col' = direction === 'row' ? 'row' : 'col';
    const insertAt = direction === 'row' ? row + 1 : column + 1;

    let nextRows: string[][];
    let nextCellBackgrounds: string[][] | undefined;
    let nextCellAligns: string[][] | undefined;
    let nextCellNumberFormats: (string | null)[][] | undefined;
    let nextColWidths: number[] | undefined;
    let nextRowHeights: number[] | undefined;
    let nextRowBackgrounds: string[] | undefined;
    let nextColumnBackgrounds: string[] | undefined;

    if (direction === 'column') {
      nextRows = rows
        .map((r) => {
          const copy = r.slice();
          copy.splice(column + 1, 0, '');
          return copy;
        })
        .map((r) => r.map((cell) => shiftFormulaRefs(cell, 'col', insertAt)));
      const bgSrc = liveCellBackgrounds.length ? liveCellBackgrounds : rows.map(() => []);
      nextCellBackgrounds = bgSrc.map((r) => { const c = (r || []).slice(); c.splice(column + 1, 0, ''); return c; });
      const alSrc = liveCellAligns.length ? liveCellAligns : rows.map(() => []);
      nextCellAligns = alSrc.map((r) => { const c = (r || []).slice(); c.splice(column + 1, 0, ''); return c; });
      const nfSrc = liveCellNumberFormats.length ? liveCellNumberFormats : rows.map(() => []);
      nextCellNumberFormats = nfSrc.map((r) => { const c = (r || []).slice(); c.splice(column + 1, 0, null); return c; });
      const w = widths.slice();
      const half = Math.max(MIN_COL_WIDTH, w[column] / 2);
      w[column] = half;
      w.splice(column + 1, 0, half);
      nextColWidths = w;
      if (Array.isArray(columnBackgrounds)) {
        const cb = columnBackgrounds.slice();
        cb.splice(column + 1, 0, cb[column] || '');
        nextColumnBackgrounds = cb;
      }
    } else {
      const withBlankRow = rows.slice();
      withBlankRow.splice(row + 1, 0, Array.from({ length: colCount }, () => ''));
      nextRows = withBlankRow.map((r) => r.map((cell) => shiftFormulaRefs(cell, 'row', insertAt)));
      const bgSrc = liveCellBackgrounds.length ? liveCellBackgrounds : rows.map(() => []);
      const bg = bgSrc.slice();
      bg.splice(row + 1, 0, Array.from({ length: colCount }, () => ''));
      nextCellBackgrounds = bg;
      const alSrc = liveCellAligns.length ? liveCellAligns : rows.map(() => []);
      const al = alSrc.slice();
      al.splice(row + 1, 0, Array.from({ length: colCount }, () => ''));
      nextCellAligns = al;
      const nfSrc = liveCellNumberFormats.length ? liveCellNumberFormats : rows.map(() => []);
      const nf = nfSrc.slice();
      nf.splice(row + 1, 0, Array.from({ length: colCount }, () => null));
      nextCellNumberFormats = nf;
      const rh = normalizeRowHeights(liveRowHeights, rows.length).slice();
      const halfH = rh[row] > 0 ? Math.max(MIN_ROW_HEIGHT, rh[row] / 2) : 0;
      rh[row] = halfH;
      rh.splice(row + 1, 0, halfH);
      nextRowHeights = rh;
      if (Array.isArray(rowBackgrounds)) {
        const rb = rowBackgrounds.slice();
        rb.splice(row + 1, 0, rb[row] || '');
        nextRowBackgrounds = rb;
      }
    }

    // Fusiones existentes: las que CRUZAN el punto de inserción crecen +1
    // para absorber la fila/columna nueva (siguen viéndose como un solo
    // bloque); las que están enteramente DESPUÉS se corren +1; las de
    // antes quedan igual.
    const shiftedMerges: MergedCell[] = liveMergedCells.map((m) => {
      if (direction === 'column') {
        if (m.column > column) return { ...m, column: m.column + 1 };
        if (m.column + m.colSpan - 1 >= column) return { ...m, colSpan: m.colSpan + 1 };
        return m;
      }
      if (m.row > row) return { ...m, row: m.row + 1 };
      if (m.row + m.rowSpan - 1 >= row) return { ...m, rowSpan: m.rowSpan + 1 };
      return m;
    });

    // El resto de filas/columnas (ajenas a la dividida) que no hayan
    // quedado ya cubiertas por el crecimiento de arriba reciben una fusión
    // nueva de 2 que absorbe el hueco recién insertado.
    const coveredAfterShift = new Set<string>();
    shiftedMerges.forEach((m) => {
      for (let r = m.row; r < m.row + m.rowSpan; r += 1) {
        for (let c = m.column; c < m.column + m.colSpan; c += 1) coveredAfterShift.add(cellKey({ row: r, column: c }));
      }
    });
    const compensating: MergedCell[] = [];
    if (direction === 'column') {
      for (let r = 0; r < nextRows.length; r += 1) {
        if (r === row || coveredAfterShift.has(cellKey({ row: r, column }))) continue;
        compensating.push({ row: r, column, rowSpan: 1, colSpan: 2 });
      }
    } else {
      for (let c = 0; c < colCount; c += 1) {
        if (c === column || coveredAfterShift.has(cellKey({ row, column: c }))) continue;
        compensating.push({ row, column: c, rowSpan: 2, colSpan: 1 });
      }
    }

    const nextMergedCells = [...shiftedMerges, ...compensating];
    const nextConditionalFormats = conditionalFormats ? shiftScopedItems(conditionalFormats, axis, insertAt) : undefined;
    const nextColorScales = colorScales ? shiftScopedItems(colorScales, axis, insertAt) : undefined;

    setLiveMergedCells(nextMergedCells);
    setLiveCellBackgrounds(nextCellBackgrounds || []);
    setLiveCellAligns(nextCellAligns || []);
    setLiveCellNumberFormats(nextCellNumberFormats || []);
    if (nextRowHeights) setLiveRowHeights(nextRowHeights);

    onSplitCell?.({
      rows: nextRows,
      mergedCells: nextMergedCells,
      colWidths: nextColWidths,
      rowHeights: nextRowHeights,
      cellBackgrounds: nextCellBackgrounds,
      rowBackgrounds: nextRowBackgrounds,
      columnBackgrounds: nextColumnBackgrounds,
      cellAligns: nextCellAligns,
      cellNumberFormats: nextCellNumberFormats,
      conditionalFormats: nextConditionalFormats,
      colorScales: nextColorScales,
    });

    selectedCellsRef.current = [{ row, column }];
    setSelectedCells([{ row, column }]);
    setCellMenu(null);
  }, [
    rows, colCount, widths, liveCellBackgrounds, liveCellAligns, liveCellNumberFormats, liveRowHeights,
    liveMergedCells, mergedAnchorByKey, mergedCoveredKeys, columnBackgrounds, rowBackgrounds,
    conditionalFormats, colorScales, onSplitCell,
  ]);

  const toggleCellSelection = useCallback((cell: CellPosition, additive: boolean) => {
    activeCellRef.current = cell;
    setActiveCell(cell);
    setSelectedCells((current) => {
      if (!additive) return [cell];
      const key = cellKey(cell);
      return current.some((item) => cellKey(item) === key)
        ? current.filter((item) => cellKey(item) !== key)
        : [...current, cell];
    });
  }, []);

  const getCellFormat = useCallback((cell: CellPosition): CellFormatSnapshot | null => {
    const editable = getCellEditableEl(cell.row, cell.column);
    if (!editable) return null;
    // getComputedStyle sobre la celda contentEditable EN SÍ solo daría el
    // estilo por defecto de la tabla (la cascada no "ve hacia abajo" el
    // <font>/<span> real del texto) -- hay que leerlo del elemento que
    // realmente envuelve el texto.
    const styleEl = findCellStyleElement(editable);
    const computed = window.getComputedStyle(styleEl);
    const bg = computed.backgroundColor;
    return {
      backgroundColor: liveCellBackgrounds[cell.row]?.[cell.column] || rowBackgrounds?.[cell.row] || columnBackgrounds?.[cell.column] || 'transparent',
      color: computed.color,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      bold: computed.fontWeight === 'bold' || Number(computed.fontWeight) >= 600,
      italic: computed.fontStyle === 'italic',
      underline: computed.textDecorationLine?.includes('underline') ?? false,
      highlightColor: bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' ? bg : 'transparent',
      align: liveCellAligns[cell.row]?.[cell.column] || cellAlign,
    };
  }, [liveCellBackgrounds, rowBackgrounds, columnBackgrounds, liveCellAligns, cellAlign, getCellEditableEl]);

  const copyCellFormat = useCallback(() => {
    const source = activeCellRef.current;
    if (!source) return;
    const snapshot = getCellFormat(source);
    if (!snapshot) return;
    formatSnapshotRef.current = snapshot;
    setFormatPainterActive(true);
    selectedCellsRef.current = [];
    setSelectedCells([]);
  }, [getCellFormat]);

  const pasteCellFormat = useCallback((targets: CellPosition[]) => {
    const snapshot = formatSnapshotRef.current;
    if (!snapshot || targets.length === 0) return;
    const targetKeys = new Set(targets.map(cellKey));
    const nextRows = rows.map((row, rowIndex) => row.map((value, columnIndex) => {
      if (!targetKeys.has(cellKey({ row: rowIndex, column: columnIndex }))) return value;
      // Reconstruye la celda destino con un span NUEVO que fija cada
      // propiedad de forma explícita, en vez de injertar el texto destino
      // dentro de la estructura de etiquetas de la celda origen -- ese
      // injerto era frágil apenas el destino ya traía su propio HTML
      // enriquecido o la fuente tenía varios nodos de texto (bug real
      // reportado: quedaba el fondo pegado pero el texto sin el resto de
      // propiedades, a veces ilegible). Esto sacrifica preservar formato
      // MIXTO dentro de la celda origen a cambio de copiar SIEMPRE TODAS
      // las propiedades pedidas, de forma predecible.
      const targetContainer = document.createElement('div');
      targetContainer.innerHTML = sanitizeRichHtml(value || '');
      const targetText = targetContainer.textContent || '';
      if (!targetText) return value; // celda vacía -- nada que reformatear
      const span = document.createElement('span');
      span.style.setProperty('font-family', snapshot.fontFamily, 'important');
      span.style.setProperty('font-size', snapshot.fontSize, 'important');
      span.style.setProperty('color', snapshot.color, 'important');
      if (snapshot.highlightColor !== 'transparent') {
        span.style.setProperty('background-color', snapshot.highlightColor, 'important');
      }
      if (snapshot.bold) span.style.setProperty('font-weight', 'bold', 'important');
      if (snapshot.italic) span.style.setProperty('font-style', 'italic', 'important');
      if (snapshot.underline) span.style.setProperty('text-decoration', 'underline', 'important');
      span.textContent = targetText;
      return sanitizeRichHtml(span.outerHTML);
    }));
    const nextBackgrounds = rows.map((row, rowIndex) => row.map((_, columnIndex) => (
      targetKeys.has(cellKey({ row: rowIndex, column: columnIndex }))
        ? snapshot.backgroundColor
        : liveCellBackgrounds[rowIndex]?.[columnIndex] || ''
    )));
    const nextAligns = rows.map((row, rowIndex) => row.map((_, columnIndex) => (
      targetKeys.has(cellKey({ row: rowIndex, column: columnIndex }))
        ? snapshot.align
        : liveCellAligns[rowIndex]?.[columnIndex] || ''
    )));
    // Bug real encontrado probando esto en vivo: llamar a 5 callbacks
    // onUpdate* SEPARADOS (uno por rows, otro por cellBackgrounds, etc.)
    // dentro del mismo evento síncrono hacía que cada uno en PageCanvas.tsx
    // pisara al anterior -- cada `onUpdateX` arma su propio `{...element.props,
    // x: nuevo}` con el `element.props` de ESTE render (React no
    // re-renderiza entre medio de estas 5 llamadas), así que la 2da llamada
    // (cellBackgrounds) volvía a escribir el `rows` VIEJO encima del que la
    // 1ra llamada (rows) recién había puesto: quedaba el fondo pegado pero
    // el texto sin ningún estilo. Mismo problema (y misma solución) que ya
    // se resolvió una vez para la fusión de celdas -- ver `onMergeCells`.
    if (onPasteCellFormat) {
      onPasteCellFormat({ rows: nextRows, cellBackgrounds: nextBackgrounds, cellAligns: nextAligns });
    } else {
      onUpdateCells?.(nextRows);
      onUpdateCellBackgrounds?.(nextBackgrounds);
      onUpdateRowBackgrounds?.([]);
      onUpdateColumnBackgrounds?.([]);
      onUpdateCellAligns?.(nextAligns);
    }
    setLiveCellBackgrounds(nextBackgrounds);
    setLiveCellAligns(nextAligns);
  }, [rows, liveCellBackgrounds, liveCellAligns, onPasteCellFormat, onUpdateCells, onUpdateCellBackgrounds, onUpdateRowBackgrounds, onUpdateColumnBackgrounds, onUpdateCellAligns]);

  const pasteToSelectedCells = useCallback(() => {
    const targets = selectedCellsRef.current.length > 0
      ? selectedCellsRef.current
      : activeCell ? [activeCell] : [];
    pasteCellFormat(targets);
    selectedCellsRef.current = [];
    setSelectedCells([]);
    painterDragRef.current = false;
    setFormatPainterActive(false);
  }, [pasteCellFormat, selectedCells, activeCell]);

  useEffect(() => {
    if (!formatPainterActive) return undefined;
    const finishPainterDrag = () => {
      if (painterDragRef.current) pasteToSelectedCells();
    };
    window.addEventListener('mouseup', finishPainterDrag);
    return () => window.removeEventListener('mouseup', finishPainterDrag);
  }, [formatPainterActive, pasteToSelectedCells]);

  // ── Autoajuste: mide el ancho natural del texto de cada columna y
  // redistribuye colWidths a esa medida + padding -- algoritmo compartido
  // en lib/tableClipboard.ts (también lo usa el autoajuste automático al
  // importar un .docx, ver PageCanvas.tsx::processPasteBlocks). ──
  const autoFitColumns = useCallback(() => {
    const fitted = computeAutoFitColumnWidths(rows, colCount, { fontSize, cellPadding, maxTableWidth });
    if (fitted) onUpdateColWidths?.(fitted);
  }, [rows, colCount, fontSize, cellPadding, maxTableWidth, onUpdateColWidths]);

  const border = borderStyle === 'none' ? 'none' : `${borderWidth}px ${borderStyle} ${borderColor}`;
  // La barra de fila/columna/autoajustar es para la ESTRUCTURA de la tabla
  // (agregar/quitar fila o columna, repartir anchos) -- no tiene sentido
  // mientras se está escribiendo dentro de una celda, y de hecho ahí ocupa
  // el mismo lugar en pantalla que la barra de formato de texto (N/K/S/
  // alineación/color), que la reemplaza en ese momento.
  // Antes dependía de `editing` (toda la tabla desbloqueada, doble clic) --
  // ahora que un solo clic ya desbloquea la selección de celdas, la barra
  // de fila/columna/autoajustar debe seguir viéndose mientras solo hay
  // celdas SELECCIONADAS (sin cursor de texto real) y ocultarse recién
  // cuando se entra a editar el texto de una celda puntual.
  const showControls = selected && !textEditingCell;

  // Offsets acumulados (para posicionar tiradores de resize y botones de
  // eliminar columna exactamente en cada borde).
  const offsets: number[] = [];
  {
    let acc = 0;
    for (const w of effectiveWidths) {
      acc += w;
      offsets.push(acc);
    }
  }

  // Bug real reportado (2026-09-01): el tirador de resize de FILA vive en un
  // solo <div> que cubre TODO el ancho de la tabla (necesario para que se
  // pueda agarrar en cualquier columna) -- pero eso lo hace pisar, en cada
  // cruce con un borde de columna, al tirador de esa columna (ambos son
  // overlays absolutos independientes; al estar la fila DESPUÉS en el DOM,
  // gana ella). Con pocas filas casi no se notaba; con una tabla de varias
  // filas (como la del reporte real) los bordes de fila quedan tan seguido
  // que gran parte de cada tirador de columna termina tapado, y el cursor de
  // "estirar columna" deja de aparecer justo donde el usuario más lo prueba.
  // Fix: partir cada tirador de fila en un segmento POR COLUMNA, dejando un
  // hueco del ancho del tirador de columna centrado en cada borde de
  // columna -- así nunca compiten por el mismo píxel (igual que Excel/Word,
  // donde la esquina exacta entre celdas no le "roba" el cursor a ninguno
  // de los dos ejes).
  const rowHandleSegments: { left: number; width: number }[] = offsets.map((edge, i) => {
    const start = i === 0 ? 0 : offsets[i - 1] + RESIZE_HANDLE_WIDTH / 2;
    const end = edge - RESIZE_HANDLE_WIDTH / 2;
    return { left: start, width: Math.max(0, end - start) };
  });

  return (
    <div
      ref={containerRef}
      className="table-block-container"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'visible',
        background: '#fff',
        borderRadius: '4px',
        border: borderStyle === 'none' ? '1px solid #e2e8f0' : border,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {toolbar && (
        <div
          className="table-cell-format-toolbar"
          onMouseDown={(e) => e.preventDefault()}
        >
          <select
            className="table-cell-fontfamily-select"
            title="Fuente del texto seleccionado"
            aria-label="Fuente"
            value={toolbarFontFamily}
            onMouseDown={(e) => { e.stopPropagation(); saveSelection(); }}
            onChange={(e) => applyFontFamily(e.target.value)}
          >
            {!FONT_FAMILY_OPTIONS.some((opt) => opt.value === toolbarFontFamily) && (
              <option value={toolbarFontFamily}>{primaryFontFamily(toolbarFontFamily) || 'Personalizada'}</option>
            )}
            {FONT_FAMILY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            type="button"
            title="Negrita"
            className={toolbarActiveFormats.bold ? 'is-active' : ''}
            // Sin esto, el propio clic en el botón le robaba el foco/la
            // selección de texto a la celda ANTES de que exec('bold')
            // corriera -- document.execCommand('bold') con la selección ya
            // colapsada/perdida no tiene texto sobre el cual aplicar nada,
            // así que el negrita nunca llegaba a aplicarse (bug real
            // encontrado probando el pincel de formato: el negrita jamás se
            // guardaba, así que tampoco había nada que copiar). Mismo
            // patrón que ya usan los botones A-/A+ de tamaño.
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
            onClick={() => exec('bold')}
          >
            <b>N</b>
          </button>
          <button
            type="button"
            title="Cursiva"
            className={toolbarActiveFormats.italic ? 'is-active' : ''}
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
            onClick={() => exec('italic')}
          >
            <i>K</i>
          </button>
          <button
            type="button"
            title="Subrayado"
            className={toolbarActiveFormats.underline ? 'is-active' : ''}
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
            onClick={() => exec('underline')}
          >
            <u>S</u>
          </button>
          <Highlighter size={13} className="table-cell-highlight-icon" />
          <ColorPalette
            value={toolbarHighlightColor}
            title="Resaltar la selección (como un marcador de texto)"
            allowClear
            onOpen={saveSelection}
            onChange={applyHighlightColor}
            onClear={() => applyHighlightColor('transparent')}
          />
          <button
            type="button"
            title="Reducir tamaño (-2)"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
            onClick={() => applyFontSize(toolbarFontSize - 2)}
          >
            A-
          </button>
          <input
            type="number"
            className="table-cell-fontsize-input"
            title="Tamaño de fuente (px) de la selección"
            aria-label="Tamaño de fuente"
            value={toolbarFontSize}
            min={6}
            max={200}
            step={1}
            // stopPropagation: el contenedor de la barra hace preventDefault
            // en su propio mousedown (para que los botones N/K/S no le
            // roben el foco al texto que se está editando) -- eso mismo,
            // sin cortar la propagación aquí, se comía el mousedown nativo
            // de las flechitas del input y las dejaba sin efecto visible.
            onMouseDown={(e) => { e.stopPropagation(); saveSelection(); }}
            onChange={(e) => {
              // Se aplica al instante (no solo al perder foco) -- así las
              // flechitas nativas del input suben/bajan de 1 en 1 y el
              // efecto se ve de inmediato en el texto, no solo el número.
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) applyFontSize(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <button
            type="button"
            title="Aumentar tamaño (+2)"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
            onClick={() => applyFontSize(toolbarFontSize + 2)}
          >
            A+
          </button>
          <div className="table-cell-align-group" role="group" aria-label="Alineación de la celda">
            <button
              type="button"
              title="Alinear a la izquierda"
              className={toolbarAlign === 'left' ? 'is-active' : ''}
              onClick={() => applyCellAlign('left')}
            >
              <AlignLeft size={14} />
            </button>
            <button
              type="button"
              title="Centrar"
              className={toolbarAlign === 'center' ? 'is-active' : ''}
              onClick={() => applyCellAlign('center')}
            >
              <AlignCenter size={14} />
            </button>
            <button
              type="button"
              title="Alinear a la derecha"
              className={toolbarAlign === 'right' ? 'is-active' : ''}
              onClick={() => applyCellAlign('right')}
            >
              <AlignRight size={14} />
            </button>
          </div>
          <div className="table-cell-numberformat-group" role="group" aria-label="Formato numérico de la celda">
            <button
              type="button"
              title="Formato de porcentaje (multiplica por 100 y agrega %)"
              className={parseNumberFormat(toolbarNumberFormat).kind === 'percent' ? 'is-active' : ''}
              onClick={toggleCellPercent}
            >
              <Percent size={13} />
            </button>
            <button type="button" title="Disminuir decimales" onClick={() => bumpCellDecimals(-1)}>
              <Minus size={13} />
            </button>
            <button type="button" title="Aumentar decimales" onClick={() => bumpCellDecimals(1)}>
              <Plus size={13} />
            </button>
          </div>
          <ColorPalette
            value={toolbarTextColor}
            title="Color del texto"
            onOpen={saveSelection}
            onChange={(c) => exec('foreColor', c)}
            renderTrigger={({ onClick, onMouseDown }) => (
              <button
                type="button"
                title="Color del texto"
                className="table-cell-color-btn"
                onMouseDown={(e) => { onMouseDown(e); saveSelection(); }}
                onClick={onClick}
              >
                <span className="table-cell-color-letter">A</span>
                <span className="table-cell-color-bar" style={{ background: toolbarTextColor }} />
              </button>
            )}
          />
          <button
            type="button"
            className={`table-format-painter-btn${formatPainterActive ? ' table-format-painter-btn--active' : ''}`}
            title="Copiar formato de esta celda"
            aria-label="Copiar formato"
            onClick={copyCellFormat}
          >
            <Paintbrush size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="table-format-painter-btn"
            title="Pegar el formato copiado en la celda seleccionada"
            aria-label="Pegar formato"
            disabled={!formatSnapshotRef.current || !activeCell}
            onClick={pasteToSelectedCells}
          >
            <ClipboardPaste size={14} aria-hidden="true" />
          </button>
          {editing && (
            <button type="button" className="table-format-painter-btn" onClick={() => onExitEdit?.()} title="Salir del modo edición de celdas (equivalente a Escape)">
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* z-index 50 en las tres variantes de este menú: por encima de los
         tiradores de resize de fila/columna (.table-row-resize-handle /
         .table-col-resize-handle, z-index:40 en styles.css) -- con 5 (el
         valor previo) un tirador que cayera justo sobre el popup se quedaba
         con el clic y el botón nunca llegaba a ejecutarse aunque el menú se
         viera perfectamente encima (bug real encontrado probando la fusión
         en vivo). */}
      {cellMenu && canMergeSelection && (
        <div
          className="table-cell-context-menu"
          style={{ position: 'absolute', top: cellMenu.top, left: cellMenu.left, pointerEvents: 'auto', zIndex: 50 }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={mergeSelectedCells}>Fusionar celdas</button>
          {onCreateChartFromTable && (
            <>
              <hr className="table-cell-context-menu-divider" />
              <button type="button" onClick={() => { setCellMenu(null); onCreateChartFromTable(); }}>Crear gráfico desde esta tabla</button>
            </>
          )}
        </div>
      )}

      {cellMenu && !canMergeSelection && (() => {
        const anchorMerge = mergedAnchorByKey.get(cellKey({ row: cellMenu.row, column: cellMenu.column }));
        if (anchorMerge) {
          // Total de sub-celdas originales que esta fusión ocupa -- el
          // rango de partes ofrecido va de 2 (mínimo con sentido) hasta ese
          // total (el estado original, sin fusión).
          const total = anchorMerge.colSpan > 1 ? anchorMerge.colSpan : anchorMerge.rowSpan;
          const options = Array.from({ length: total - 1 }, (_, i) => i + 2);
          return (
            <div
              className="table-cell-context-menu table-cell-split-menu"
              style={{ position: 'absolute', top: cellMenu.top, left: cellMenu.left, pointerEvents: 'auto', zIndex: 50 }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className="table-cell-split-menu-title">Dividir celda en...</div>
              <div className="table-cell-split-menu-options">
                {options.map((count) => (
                  <button
                    key={count}
                    type="button"
                    title={count === total ? `Dividir en ${count} (estado original)` : `Dividir en ${count} partes`}
                    onClick={() => splitMergedCellInto(cellMenu.row, cellMenu.column, count)}
                  >
                    {count}
                  </button>
                ))}
              </div>
              {onCreateChartFromTable && (
                <>
                  <hr className="table-cell-context-menu-divider" />
                  <button type="button" onClick={() => { setCellMenu(null); onCreateChartFromTable(); }}>Crear gráfico desde esta tabla</button>
                </>
              )}
            </div>
          );
        }
        // Celda normal, sin fusión previa -- también se puede "dividir",
        // eligiendo el eje (pedido explícito: no toda división parte de una
        // fusión existente). Ver `splitNormalCellInto`: inserta una fila o
        // columna real en toda la tabla y fusiona de vuelta el resto para
        // que solo esta celda quede partida.
        return (
          <div
            className="table-cell-context-menu table-cell-split-menu"
            style={{ position: 'absolute', top: cellMenu.top, left: cellMenu.left, pointerEvents: 'auto', zIndex: 50 }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="table-cell-split-menu-title">Dividir celda</div>
            <div className="table-cell-split-menu-options table-cell-split-menu-options--axis">
              <button type="button" onClick={() => splitNormalCellInto(cellMenu.row, cellMenu.column, 'column')}>En columnas</button>
              <button type="button" onClick={() => splitNormalCellInto(cellMenu.row, cellMenu.column, 'row')}>En filas</button>
            </div>
            {onCreateChartFromTable && (
              <>
                <hr className="table-cell-context-menu-divider" />
                <button type="button" onClick={() => { setCellMenu(null); onCreateChartFromTable(); }}>Crear gráfico desde esta tabla</button>
              </>
            )}
          </div>
        );
      })()}

      {/* Barra de herramientas de fila/columna — SOLO visible con el bloque
         seleccionado (no depende del modo "doble clic para editar celdas",
         que es exclusivamente para escribir texto). Todos los controles
         llevan pointerEvents:'auto' propio, así funcionan aunque el shield
         general del bloque (PageCanvas.tsx, .report-canvas-html-shield)
         tenga pointer-events:none. */}
      {showControls && (
        <div
          className="table-toolbar-strip"
          style={{ pointerEvents: 'auto' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="table-toolbar-btn" onClick={() => onAddRow?.()} title="Insertar fila al final">
            <Plus size={13} /> Fila
          </button>
          <button
            type="button"
            className="table-toolbar-btn"
            onClick={() => rows.length > 1 && onRemoveRow?.(rows.length - 1)}
            title="Eliminar la última fila"
            disabled={rows.length <= 1}
          >
            <Minus size={13} /> Fila
          </button>
          <button type="button" className="table-toolbar-btn" onClick={() => onAddColumn?.()} title="Insertar columna al final">
            <Plus size={13} /> Col
          </button>
          <button
            type="button"
            className="table-toolbar-btn"
            onClick={() => colCount > 1 && onRemoveColumn?.(colCount - 1)}
            title="Eliminar la última columna"
            disabled={colCount <= 1}
          >
            <Minus size={13} /> Col
          </button>
          <button type="button" className="table-toolbar-btn table-toolbar-btn--accent" onClick={autoFitColumns} title="Autoajustar el ancho de columnas al texto más largo de cada una">
            <WandSparkles size={13} /> Autoajustar
          </button>
          <select
            className="table-toolbar-color-target"
            value={colorTarget}
            onChange={(event) => setColorTarget(event.target.value as 'cell' | 'row' | 'column')}
            title="Elegir si el color se aplica a la celda, fila o columna activa"
            aria-label="Destino del color de fondo"
          >
            <option value="cell">Celda</option>
            <option value="row">Fila</option>
            <option value="column">Columna</option>
          </select>
          <ColorPalette
            label="Color"
            title={activeCell ? `Pintar ${colorTarget === 'cell' ? 'celda' : colorTarget === 'row' ? 'fila' : 'columna'}` : 'Primero selecciona una celda'}
            value={
              activeCell
                ? colorTarget === 'cell'
                  ? liveCellBackgrounds[activeCell.row]?.[activeCell.column] || 'transparent'
                  : colorTarget === 'row'
                    ? liveCellBackgrounds[activeCell.row]?.[activeCell.column] || rowBackgrounds?.[activeCell.row] || 'transparent'
                    : liveCellBackgrounds[activeCell.row]?.[activeCell.column] || columnBackgrounds?.[activeCell.column] || 'transparent'
                : 'transparent'
            }
            onChange={applyBackgroundColor}
            allowClear
            onClear={() => applyBackgroundColor('transparent')}
          />
        </div>
      )}

      {title && (
        <div
          // Manija de arrastre EXPLÍCITA del bloque completo — pedido
          // explícito 2026-09-04: "no se de donde agarrarlo para desplazar
          // la tabla". Un primer intento dejaba el título en
          // pointerEvents:'none' para que el clic "atravesara" este div
          // hasta el Rect de Konva de abajo (que ya sabe arrastrar/
          // seleccionar cualquier bloque) — en el uso real seguía sin
          // funcionar de forma confiable: a mitad de gesto el puntero podía
          // pasar sobre una celda (pointerEvents:'auto' una vez
          // seleccionada la tabla) y el navegador enrutaba los eventos
          // siguientes ahí en vez de al canvas, dejando el arrastre a medio
          // iniciar. Con onMouseDown propio (ver onTitleMouseDown) el
          // título arranca el drag de Konva DIRECTAMENTE vía
          // `node.startDrag()` desde PageCanvas.tsx — inmune a lo que haya
          // debajo del puntero el resto del gesto, porque a partir de ahí
          // es Konva (no el navegador) quien seguimiento el mousemove/
          // mouseup a nivel de documento.
          onMouseDown={onTitleMouseDown}
          style={{
            padding: `${Math.max(6, cellPadding - 2)}px ${cellPadding}px`,
            fontSize: `${fontSize + 1}px`,
            fontWeight: 700,
            color: '#0f172a',
            borderBottom: border,
            background: '#fbfdff',
            flexShrink: 0,
            pointerEvents: 'auto',
            cursor: onTitleMouseDown ? 'move' : undefined,
          }}
        >
          {title}
        </div>
      )}

      {/* Recorte VISUAL puro, en un envoltorio APARTE de tableWrapRef --
         pedido explícito 2026-09-04: "se nota que la fila sobresale del
         contenedor... que nunca pueda sobresalir, [el bloque] siempre debe
         adaptarse a su contenido... y viceversa". El auto-crecimiento
         (onNaturalSize/onOverflowRows más abajo) YA hace crecer el bloque
         (o parte la tabla en una continuación) al alto real de la tabla --
         pero eso pasa un ciclo de render DESPUÉS de que cambian filas/
         celdas/formato condicional (notorio sobre todo al cargar un
         informe ya guardado o una tabla recién generada, antes de que ese
         primer ciclo corra), así que por un instante el contenido podía
         dibujarse más abajo del borde inferior del bloque -- la fila
         "sobresaliendo" reportada. Se agrega ESTE envoltorio nuevo (en vez
         de ponerle overflow:hidden a tableWrapRef directamente) a
         propósito: tableWrapRef sigue exactamente igual que antes
         (position:relative, overflow:visible, sin flex) porque
         onNaturalSize/onOverflowRows miden su scrollHeight/
         getBoundingClientRect() y lo observan con ResizeObserver -- si
         tableWrapRef mismo quedara acotado por flex+overflow:hidden, esas
         medidas dejarían de reflejar el alto REAL del contenido (siempre
         reportarían el alto ya recortado), rompiendo tanto el
         auto-crecimiento como el partido automático de tablas largas entre
         páginas. Este envoltorio de afuera no mide nada -- solo recorta. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ position: 'relative', overflow: 'visible' }} ref={tableWrapRef}>
        <table
          style={{
            width: totalWidth,
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            fontSize: `${fontSize}px`,
            fontFamily,
          }}
        >
          <colgroup>
            {effectiveWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <tbody>
            {rows.map((row, ri) => {
              const isHeader = hasHeader && ri === 0;
              const isBanded = !isHeader && bandedRows && (hasHeader ? ri % 2 === 0 : ri % 2 === 1);
              return (
                <tr
                  key={ri}
                  ref={(el) => { if (el) rowRefs.current.set(ri, el); else rowRefs.current.delete(ri); }}
                  style={{ height: effectiveRowHeight(ri) }}
                >
                  {row.map((cell, ci) => {
                    const key = cellKey({ row: ri, column: ci });
                    if (mergedCoveredKeys.has(key)) return null;
                    const merge = mergedAnchorByKey.get(key);
                    const formulaResult = formulaResults[ri]?.[ci] ?? null;
                    // La fórmula cruda solo se revela cuando esta celda está
                    // REALMENTE en edición de texto (doble clic, cursor real)
                    // -- un simple clic de selección (Tier 1) sigue mostrando
                    // el resultado calculado, igual que en Excel.
                    const isActiveCell = textEditingCell?.row === ri && textEditingCell?.column === ci;
                    const numberFormat = liveCellNumberFormats[ri]?.[ci] ?? null;
                    // El overlay (texto crudo invisible + capa con el valor
                    // ya calculado/formateado encima) se activa para DOS
                    // casos: una celda-fórmula (siempre, ver Fase 1), o una
                    // celda numérica normal que además tenga un formato de
                    // número (%, decimales) puesto encima -- "25" con
                    // formato percent debe verse "2500%" aunque no sea
                    // fórmula, igual que en Excel.
                    let overlayText: string | null = null;
                    let overlayIsError = false;
                    if (formulaResult) {
                      overlayText = formulaResult.isError
                        ? formulaResult.display
                        : formatNumberForDisplay(formulaResult.numericValue as number, numberFormat);
                      overlayIsError = formulaResult.isError;
                    } else if (numberFormat) {
                      const plainNumber = parseCellNumber(stripCellHtml(cell));
                      if (plainNumber !== null) overlayText = formatNumberForDisplay(plainNumber, numberFormat);
                    }
                    // Coloreado semántico automático (semáforo): si la celda
                    // es exactamente un estado conocido (VERDE, NO CONFORME,
                    // CRÍTICA, ALTA…) se pinta con el tinte del documento.
                    const sem = semanticStatusStyle(cell, isHeader);
                    const conditionalStyle = conditionalStyles[ri]?.[ci] ?? null;
                    return (
                    <td
                      key={ci}
                      data-cell-key={`${ri}-${ci}`}
                      rowSpan={merge?.rowSpan}
                      colSpan={merge?.colSpan}
                      style={{
                        padding: `${cellPadding}px`,
                        border,
                        textAlign: (liveCellAligns[ri]?.[ci] as 'left' | 'center' | 'right') || cellAlign,
                        backgroundColor: conditionalStyle?.backgroundColor || liveCellBackgrounds[ri]?.[ci] || rowBackgrounds?.[ri] || columnBackgrounds?.[ci] || (isHeader ? headerBg : sem ? sem.bg : isBanded ? bandColor : 'transparent'),
                        fontWeight: isHeader ? (headerBold ? 700 : 400) : sem ? 700 : 400,
                        color: conditionalStyle?.textColor || cellTextColors?.[ri]?.[ci] || (isHeader ? headerTextColor : sem ? sem.color : textColor),
                        verticalAlign: cellVAlign,
                        wordBreak: 'break-word',
                        position: 'relative',
                        minHeight: MIN_ROW_HEIGHT,
                        // El contenedor de la tabla tiene pointer-events:none
                        // a propósito (ver report-canvas-table-edit-host) --
                        // solo elementos puntuales lo reactivan con 'auto'.
                        // Antes esa reactivación vivía SOLO en el <div>
                        // interno editable (.table-cell-editable), que mide
                        // el alto de SU PROPIO texto (una línea), no el alto
                        // real de la celda. En una celda normal ambos altos
                        // coinciden (la fila se ajusta a su contenido), pero
                        // en una celda FUSIONADA verticalmente (rowSpan > 1)
                        // el <td> mide varias filas de alto mientras el div
                        // interno seguía siendo de una sola línea -- el resto
                        // del bloque fusionado quedaba sin pointer-events,
                        // así que solo se podía hacer click/seleccionar/editar
                        // en el espacio de la celda ancla original (bug real
                        // reportado 2026-09-04). Reactivar 'auto' en el <td>
                        // mismo (que sí mide el alto real, incluido el de la
                        // fusión, vía rowSpan) cubre el área completa sin
                        // depender de que el hijo se estire -- percentage
                        // height en hijos de <td> con alto implícito de tabla
                        // no es fiable entre navegadores.
                        pointerEvents: 'auto',
                        boxShadow: selectedCells.some((item) => item.row === ri && item.column === ci)
                          ? 'inset 0 0 0 2px #2563eb'
                          : undefined,
                        // Cursor "+" tipo Excel mientras se pueden seleccionar
                        // celdas (Tier 1); cursor de texto normal solo dentro
                        // de la celda que realmente se está editando.
                        cursor: textEditingCell?.row === ri && textEditingCell?.column === ci ? 'text' : 'cell',
                      }}
                      onMouseDown={(event) => {
                        const selected = { row: ri, column: ci };
                        const isEditingThisCell = textEditingCell?.row === ri && textEditingCell?.column === ci;
                        activeCellRef.current = selected;
                        setActiveCell(selected);
                        if (formatPainterActive) {
                          event.preventDefault();
                          event.stopPropagation();
                          if (event.ctrlKey || event.metaKey) {
                            const next = selectedCellsRef.current.some((item) => cellKey(item) === cellKey(selected))
                              ? selectedCellsRef.current.filter((item) => cellKey(item) !== cellKey(selected))
                              : [...selectedCellsRef.current, selected];
                            selectedCellsRef.current = next;
                            setSelectedCells(next);
                          } else {
                            selectedCellsRef.current = [selected];
                            setSelectedCells([selected]);
                            painterDragRef.current = true;
                          }
                        } else if (isEditingThisCell) {
                          // Ya se está editando el texto de ESTA celda -- se
                          // deja que el navegador maneje el clic como
                          // siempre (colocar el cursor, seleccionar texto
                          // con arrastre normal). Nada de selección múltiple.
                        } else if (event.button === 0) {
                          // Tier 1 (tabla seleccionada, sin editar texto) --
                          // clic en OTRA celda mientras se editaba una
                          // distinta la da por terminada. Sin preventDefault
                          // el navegador colocaría un cursor de texto real
                          // en la celda (comportamiento nativo de
                          // contentEditable al hacer clic), que es
                          // justamente lo que este nivel NO debe mostrar.
                          //
                          // EXCEPCIÓN, bug real encontrado probando el
                          // pincel de formato: event.detail > 1 significa
                          // que este mousedown es el 2do/3er clic de un
                          // doble/triple clic -- llamar preventDefault ahí
                          // también cancelaba la selección nativa de
                          // palabra/párrafo del navegador (el conteo de
                          // clics del navegador es independiente de que
                          // React dispare "onDoubleClick" después), así que
                          // esta rama NUNCA debe interceptar el segundo
                          // clic: se deja pasar sin más, onDoubleClick más
                          // abajo se encarga de entrar a modo edición.
                          if (event.detail > 1) return;
                          event.preventDefault();
                          if (textEditingCell) {
                            // preventDefault() de arriba también cancela el
                            // blur nativo de la celda que se estaba editando
                            // (mismo motivo por el que los botones de esta
                            // barra usan preventDefault para NO robarle el
                            // foco al texto) -- sin este blur explícito
                            // seguiría mostrando el cursor parpadeando ahí.
                            getCellEditableEl(textEditingCell.row, textEditingCell.column)?.blur();
                            setTextEditingCell(null);
                          }
                          tableSelectionDragRef.current = true;
                          selectedCellsRef.current = [selected];
                          setSelectedCells([selected]);
                          const cellEl = getCellEditableEl(ri, ci);
                          if (cellEl) positionToolbar(ri, ci, cellEl);
                        }
                      }}
                      onDoubleClick={() => {
                        if (formatPainterActive) return;
                        // SIN preventDefault: el doble clic nativo del
                        // navegador selecciona la palabra bajo el cursor --
                        // bug real encontrado probando el pincel de formato:
                        // con preventDefault esa selección nunca ocurría, así
                        // que negrita/cursiva/color no tenían texto sobre el
                        // cual aplicarse al entrar recién a editar.
                        const selected = { row: ri, column: ci };
                        setTextEditingCell(selected);
                        tableSelectionDragRef.current = false;
                        selectedCellsRef.current = [selected];
                        setSelectedCells([selected]);
                        getCellEditableEl(ri, ci)?.focus();
                      }}
                      onMouseEnter={(event) => {
                        if (textEditingCell) return;
                        if ((!formatPainterActive || !painterDragRef.current) && !tableSelectionDragRef.current) return;
                        if (event.buttons !== 1) return;
                        const selected = { row: ri, column: ci };
                        if (selectedCellsRef.current.some((item) => cellKey(item) === cellKey(selected))) return;
                        const next = [...selectedCellsRef.current, selected];
                        selectedCellsRef.current = next;
                        setSelectedCells(next);
                      }}
                      onMouseUp={() => {
                        tableSelectionDragRef.current = false;
                        // El pegado del pincel de formato lo dispara SOLO el
                        // listener global de `window` (ver el useEffect de
                        // formatPainterActive) — bug real encontrado: este
                        // mismo mouseup también burbujea hasta window, así
                        // que llamar pasteToSelectedCells() aquí TAMBIÉN
                        // disparaba una segunda ejecución síncrona (sin
                        // re-render entre medio) que recalculaba las celdas
                        // a partir del `rows`/`liveCellBackgrounds` VIEJOS
                        // (previos a la primera pasada) y pisaba/revertía el
                        // formato de texto recién pegado en casi todas las
                        // celdas — "solo queda el color de fondo" encaja
                        // exactamente con ese patrón.
                      }}
                      onContextMenu={(event) => {
                        // Siempre se abre algo: "Fusionar" si hay selección
                        // múltiple válida, "Dividir en N" si esta celda es
                        // el ancla de una fusión existente, o "Dividir en
                        // filas/columnas" si es una celda normal -- ver el
                        // render de `cellMenu` más abajo, que decide cuál de
                        // las tres mostrar (nunca dos a la vez: una
                        // selección válida para fusionar nunca incluye un
                        // ancla ya fusionada, ver `mergeSelection`).
                        event.preventDefault();
                        event.stopPropagation();
                        const bounds = containerRef.current?.getBoundingClientRect();
                        if (!bounds) return;
                        setCellMenu({ top: event.clientY - bounds.top, left: event.clientX - bounds.left, row: ri, column: ci });
                      }}
                    >
                      <TableCell
                        value={cell}
                        onChange={(html) => persistCell(ri, ci, html)}
                        onFocusCell={(el) => positionToolbar(ri, ci, el)}
                        onPasteGrid={(e) => handlePasteGrid(ri, ci, e)}
                        style={{
                          outline: 'none', minHeight: '1.2em', pointerEvents: 'auto', whiteSpace: 'pre-wrap', background: 'transparent',
                          // Mientras la celda-fórmula NO está activa, el texto
                          // crudo ("=SUMA(...)") sigue ahí (editable, real) pero
                          // invisible -- el resultado se ve gracias al overlay
                          // de abajo. Al hacer clic (isActiveCell) se revela el
                          // texto real para poder editar la fórmula/el número.
                          color: overlayText !== null && !isActiveCell ? 'transparent' : undefined,
                        }}
                      />
                      {overlayText !== null && !isActiveCell && (
                        <div
                          aria-hidden="true"
                          title={overlayIsError ? `Error en la fórmula: ${cell}` : undefined}
                          style={{
                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                            padding: `${cellPadding}px`, pointerEvents: 'none',
                            color: overlayIsError ? '#dc2626' : (conditionalStyle?.textColor || (isHeader ? headerTextColor : sem ? sem.color : textColor)),
                            fontWeight: isHeader ? (headerBold ? 700 : 400) : 400,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', boxSizing: 'border-box',
                            // El overlay reemplaza VISUALMENTE al texto real
                            // de la celda (que sigue ahí pero invisible, ver
                            // el comentario de <TableCell> más abajo) -- sin
                            // esto el resultado de la fórmula se quedaba
                            // pegado arriba aunque la celda tuviera
                            // Alineación Vertical en Centro/Abajo (a
                            // diferencia del texto normal, que sí hereda
                            // `verticalAlign` del <td> vía CSS de tabla; un
                            // <div> absoluto no participa de ese mecanismo).
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: cellVAlign === 'middle' ? 'center' : cellVAlign === 'bottom' ? 'flex-end' : 'flex-start',
                          }}
                        >
                          {overlayText}
                        </div>
                      )}
                      {/* Botón eliminar FILA — extremo izquierdo, solo primera celda de cada fila */}
                      {showControls && ci === 0 && rows.length > 1 && (
                        <button
                          type="button"
                          className="table-row-delete-btn"
                          title={`Eliminar fila ${ri + 1}`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); onRemoveRow?.(ri); }}
                        >
                          <X size={10} />
                        </button>
                      )}
                    </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Tiradores de resize de columna — uno por cada borde, con
           pointerEvents:'auto' propio (funcionan seleccionado, sin
           necesidad del modo "doble clic" de edición de celdas).
           Partido en tramos VERTICALES por fila (igual que rowHandleSegments
           parte los de fila por columna) -- bug real reportado: cuando dos
           columnas están fusionadas en una fila, ese borde interior ya no
           tiene ninguna costura real (es un solo bloque), pero el tirador
           seguía cubriendo TODA la altura de la tabla y se sombreaba de
           azul al pasar el mouse por encima del bloque fusionado como si
           hubiera algo que redimensionar ahí. `isColBoundaryMerged` filtra
           esos tramos; solo el contorno DE AFUERA del bloque fusionado
           sigue siendo interactivo. */}
        {showControls && offsets.map((left, i) => {
          const segments: { top: number; height: number }[] = [];
          let segStart: number | null = null;
          for (let ri = 0; ri < rows.length; ri += 1) {
            const rowTop = ri === 0 ? 0 : (rowOffsets[ri - 1] ?? 0);
            const rowBottom = rowOffsets[ri] ?? rowTop;
            if (isColBoundaryMerged(i, ri)) {
              if (segStart !== null) {
                segments.push({ top: segStart, height: rowTop - segStart });
                segStart = null;
              }
            } else if (segStart === null) {
              segStart = rowTop;
            }
            if (ri === rows.length - 1 && segStart !== null) {
              segments.push({ top: segStart, height: rowBottom - segStart });
            }
          }
          return segments.map((seg, si) => (
            <div
              key={`resize-${i}-${si}`}
              className="table-col-resize-handle"
              style={{ left: left - RESIZE_HANDLE_WIDTH / 2, width: RESIZE_HANDLE_WIDTH, top: seg.top, bottom: 'auto', height: seg.height }}
              title={i === offsets.length - 1 ? 'Arrastrar para cambiar el ancho total de la tabla' : 'Arrastrar para redistribuir el ancho entre columnas'}
              onMouseDown={(e) => beginColumnResize(i, e)}
            />
          ));
        })}

        {/* Tiradores de resize de FILA — mismo criterio que los de columna,
           pero cada borde solo controla el alto de su propia fila (no le
           quita alto a la vecina). Posición medida del DOM real porque el
           alto en modo automático depende del contenido. Partido en un
           segmento POR COLUMNA (rowHandleSegments) en vez de un solo div de
           ancho completo -- ver el comentario junto a rowHandleSegments más
           arriba: evita taparle el tirador a la columna en cada cruce.
           Bug real reportado (2026-09-01, mismo día que el fix de arriba):
           partir la barra en pedazos rompió el resaltado azul al pasar el
           mouse -- antes UN solo div coloreaba TODA la línea; ahora, al
           hacer hover sobre un pedazo, solo ESE pedazo se pintaba (los
           demás son elementos DOM hermanos, `:hover` no los toca). El
           envoltorio `.table-row-resize-group` (pointerEvents:none, solo
           agrupa visualmente) + `:has()` en el CSS resuelve esto: cuando
           CUALQUIER pedazo del grupo está en hover, TODOS se pintan juntos,
           dando el mismo efecto de línea completa de antes, sin volver a
           tapar el cursor de columna en los cruces. */}
        {showControls && rowOffsets.map((top, i) => (
          <div
            key={`row-resize-group-${i}`}
            className="table-row-resize-group"
            style={{ top: top - RESIZE_HANDLE_HEIGHT / 2, height: RESIZE_HANDLE_HEIGHT, width: totalWidth }}
          >
            {rowHandleSegments.map((seg, j) => (
              // Mismo criterio que en los tiradores de columna: si dos filas
              // están fusionadas verticalmente en la columna `j`, este tramo
              // cae DENTRO del bloque fusionado (no hay costura real ahí) --
              // se omite por completo, dejando solo el contorno de afuera.
              isRowBoundaryMerged(i, j) ? null : (
                <div
                  key={`row-resize-${i}-${j}`}
                  className="table-row-resize-handle"
                  style={{ top: 0, height: RESIZE_HANDLE_HEIGHT, left: seg.left, width: seg.width }}
                  title="Arrastrar para cambiar el alto de la fila"
                  onMouseDown={(e) => beginRowResize(i, e)}
                />
              )
            ))}
          </div>
        ))}

        {/* Botones eliminar COLUMNA — sobre la fila de cabecera, uno por columna */}
        {showControls && colCount > 1 && offsets.map((rightEdge, i) => (
          <button
            key={`colremove-${i}`}
            type="button"
            className="table-col-delete-btn"
            style={{ left: rightEdge - 16 }}
            title={`Eliminar columna ${i + 1}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRemoveColumn?.(i); }}
          >
            <X size={9} />
          </button>
        ))}
      </div>
      </div>
    </div>
  );
}

function tableBlockPropsAreEqual(prev: TableBlockProps, next: TableBlockProps): boolean {
  return (
    prev.title === next.title &&
    prev.rows === next.rows &&
    prev.colWidths === next.colWidths &&
    // `rowHeights`/`cellBackgrounds`/`rowBackgrounds`/`columnBackgrounds`/
    // `cellAligns`/`cellVAlign` faltaban acá -- bug real encontrado en vivo
    // 2026-09-11 investigando por qué una tabla partida por desborde podía
    // "mostrar contenido distinto antes y después de seleccionarla": estos
    // props solo alimentan estado local (`liveCellBackgrounds`/
    // `liveCellAligns`/`liveRowHeights`) a través de un `useEffect` propio
    // más abajo (`[cellBackgrounds]`/`[cellAligns]`/`[rowHeights]`) -- pero
    // ese efecto nunca llega a dispararse si este comparador ya decidió que
    // "las props no cambiaron" y bloqueó el re-render por completo. El
    // resultado era una tabla mostrando datos VIEJOS hasta que algún otro
    // prop sí comparado (p.ej. `selected`) cambiara por casualidad y
    // destrabara el render.
    prev.rowHeights === next.rowHeights &&
    prev.cellBackgrounds === next.cellBackgrounds &&
    prev.rowBackgrounds === next.rowBackgrounds &&
    prev.columnBackgrounds === next.columnBackgrounds &&
    prev.cellAligns === next.cellAligns &&
    prev.cellTextColors === next.cellTextColors &&
    prev.cellVAlign === next.cellVAlign &&
    prev.mergedCells === next.mergedCells &&
    prev.hasHeader === next.hasHeader &&
    prev.borderColor === next.borderColor &&
    prev.borderWidth === next.borderWidth &&
    prev.borderStyle === next.borderStyle &&
    prev.headerBg === next.headerBg &&
    prev.headerTextColor === next.headerTextColor &&
    prev.headerBold === next.headerBold &&
    prev.cellPadding === next.cellPadding &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.textColor === next.textColor &&
    prev.cellAlign === next.cellAlign &&
    prev.bandedRows === next.bandedRows &&
    prev.bandColor === next.bandColor &&
    prev.containerWidth === next.containerWidth &&
    prev.maxTableWidth === next.maxTableWidth &&
    prev.selected === next.selected &&
    prev.editing === next.editing &&
    prev.elementId === next.elementId &&
    // conditionalFormats se edita SOLO desde RightInspector.tsx (sin estado
    // local espejo acá, a diferencia de cellBackgrounds/cellAligns/etc.) --
    // sin compararlo, una regla nueva no se veía hasta que otra prop
    // cualquiera cambiara por casualidad (mismo bug ya encontrado una vez
    // con `editing`, ver comentario histórico de este comparador).
    prev.conditionalFormats === next.conditionalFormats &&
    prev.colorScales === next.colorScales &&
    prev.cellNumberFormats === next.cellNumberFormats
  );
}

export default memo(TableBlock, tableBlockPropsAreEqual);
