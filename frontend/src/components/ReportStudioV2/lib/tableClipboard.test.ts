import { describe, expect, it } from 'vitest';
import { parseHtmlClipboardTable, parsePlainTextClipboardGrid, escapeHtml, computeAutoFitColumnWidths, computeAdaptiveTableFit } from './tableClipboard';

describe('parseHtmlClipboardTable', () => {
  it('extrae filas/columnas de una tabla HTML simple (pegado de Excel/Sheets)', () => {
    const html = `<table><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>`;
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.rows).toEqual([['A1', 'B1'], ['A2', 'B2']]);
    expect(parsed?.merges).toEqual([]);
  });

  it('detecta celdas fusionadas (rowSpan/colSpan)', () => {
    const html = `<table>
      <tr><td colspan="2">Título</td></tr>
      <tr><td rowspan="2">X</td><td>Y1</td></tr>
      <tr><td>Y2</td></tr>
    </table>`;
    const parsed = parseHtmlClipboardTable(html);
    // Solo la celda ANCLA de cada fusión lleva el texto real -- las celdas
    // que cubre quedan vacías en la grilla (así lo espera TableBlock.tsx,
    // que las pinta como cubiertas usando `merges`, no repitiendo el texto).
    expect(parsed?.rows).toEqual([
      ['Título', ''],
      ['X', 'Y1'],
      ['', 'Y2'],
    ]);
    expect(parsed?.merges).toContainEqual({ row: 0, column: 0, rowSpan: 1, colSpan: 2 });
    expect(parsed?.merges).toContainEqual({ row: 1, column: 0, rowSpan: 2, colSpan: 1 });
  });

  it('devuelve null si el HTML no trae ninguna <table>', () => {
    expect(parseHtmlClipboardTable('<p>solo texto</p>')).toBeNull();
    expect(parseHtmlClipboardTable('')).toBeNull();
  });

  it('descarta fondo blanco/transparente pero conserva un color real', () => {
    const html = `<table>
      <tr>
        <td style="background-color: rgb(255,255,255)">A</td>
        <td style="background-color: rgb(255,242,0)">B</td>
      </tr>
    </table>`;
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.backgrounds[0][0]).toBeUndefined();
    expect(parsed?.backgrounds[0][1]).toBe('rgb(255, 242, 0)');
  });
});

describe('parsePlainTextClipboardGrid', () => {
  it('parsea TSV (tabulador entre columnas, salto de línea entre filas)', () => {
    expect(parsePlainTextClipboardGrid('A1\tB1\nA2\tB2')).toEqual([['A1', 'B1'], ['A2', 'B2']]);
  });

  it('descarta la última línea vacía (artefacto típico del portapapeles) y filas totalmente en blanco', () => {
    expect(parsePlainTextClipboardGrid('A1\tB1\n\nA2\tB2\n')).toEqual([['A1', 'B1'], ['A2', 'B2']]);
  });

  it('devuelve null para texto vacío o sin ninguna celda con contenido', () => {
    expect(parsePlainTextClipboardGrid('')).toBeNull();
    expect(parsePlainTextClipboardGrid('\n\n')).toBeNull();
  });
});

describe('escapeHtml', () => {
  it('escapa & < > para que el texto pegado no se interprete como HTML', () => {
    expect(escapeHtml('Costo < 100 & IGV > 0')).toBe('Costo &lt; 100 &amp; IGV &gt; 0');
  });
});

/**
 * Cubre `computeAutoFitColumnWidths` (extraído de
 * TableBlock.tsx::autoFitColumns, ver PageCanvas.tsx::processPasteBlocks
 * para dónde se reutiliza al importar un .docx). NOTA: jsdom no implementa
 * `CanvasRenderingContext2D` de verdad -- `setupTests.js` lo reemplaza por
 * un stub cuyo `measureText` siempre devuelve `{width: 0}` sin importar el
 * texto -- así que estos tests SOLO cubren la forma/casos borde de la
 * función (cantidad de columnas, piso mínimo, reparto proporcional cuando
 * excede el límite), NO la calidad real de la medición de texto (esa parte
 * ya se prueba a ojo en el navegador real, donde measureText sí funciona).
 */
describe('computeAutoFitColumnWidths', () => {
  it('devuelve un ancho por columna, nunca por debajo del piso mínimo (48px)', () => {
    const rows = [['A', 'BB'], ['CCC', 'D']];
    const widths = computeAutoFitColumnWidths(rows, 2, { fontSize: 14, cellPadding: 10, maxTableWidth: 1000 });
    expect(widths).toHaveLength(2);
    widths?.forEach((w) => expect(w).toBeGreaterThanOrEqual(48));
  });

  it('0 columnas devuelve null (nada que ajustar)', () => {
    expect(computeAutoFitColumnWidths([], 0, { fontSize: 14, cellPadding: 10, maxTableWidth: 500 })).toBeNull();
  });

  it('filas de distinta longitud (celdas faltantes) no rompen el cálculo', () => {
    const rows = [['A', 'B', 'C'], ['solo una celda']];
    const widths = computeAutoFitColumnWidths(rows, 3, { fontSize: 14, cellPadding: 10, maxTableWidth: 1000 });
    expect(widths).toHaveLength(3);
  });

  it('la suma nunca excede max(MIN_COL_WIDTH*colCount, maxTableWidth)', () => {
    const rows = Array.from({ length: 5 }, (_, i) => [`Fila ${i} columna larga de prueba`]);
    const maxTableWidth = 200;
    const widths = computeAutoFitColumnWidths(rows, 1, { fontSize: 14, cellPadding: 10, maxTableWidth });
    const total = (widths || []).reduce((sum, w) => sum + w, 0);
    expect(total).toBeLessThanOrEqual(Math.max(48, maxTableWidth));
  });
});

/**
 * Cubre `computeAdaptiveTableFit` -- pedido explícito 2026-09-10 ("siempre
 * las tablas conservan su configuracion de 10 en padding, eso no es una
 * regla... hay que reducirle su padding hasta un maximo de 3 - 10"). Mismo
 * límite del stub de canvas en jsdom que `computeAutoFitColumnWidths`
 * arriba (measureText siempre {width:0}) -- estos tests cubren el CONTRATO
 * (rango de padding, forma del resultado), no la calidad real de la
 * medición de texto.
 */
describe('computeAdaptiveTableFit', () => {
  it('el padding elegido siempre queda dentro de [3, 10]', () => {
    const rows = [['A', 'B'], ['C', 'D']];
    const fit = computeAdaptiveTableFit(rows, 2, { fontSize: 14, maxTableWidth: 500 });
    expect(fit).not.toBeNull();
    expect(fit!.cellPadding).toBeGreaterThanOrEqual(3);
    expect(fit!.cellPadding).toBeLessThanOrEqual(10);
  });

  it('devuelve un ancho por columna', () => {
    const rows = [['A', 'B', 'C']];
    const fit = computeAdaptiveTableFit(rows, 3, { fontSize: 14, maxTableWidth: 500 });
    expect(fit?.colWidths).toHaveLength(3);
  });

  it('0 columnas devuelve null', () => {
    expect(computeAdaptiveTableFit([], 0, { fontSize: 14, maxTableWidth: 500 })).toBeNull();
  });

  it('la suma de colWidths nunca excede max(MIN_COL_WIDTH*colCount, maxTableWidth), incluso en el peor caso (padding mínimo)', () => {
    const rows = Array.from({ length: 8 }, (_, i) => [`Columna con texto largo de prueba numero ${i}`]);
    const maxTableWidth = 150;
    const fit = computeAdaptiveTableFit(rows, 1, { fontSize: 14, maxTableWidth });
    const total = (fit?.colWidths || []).reduce((sum, w) => sum + w, 0);
    expect(total).toBeLessThanOrEqual(Math.max(48, maxTableWidth));
  });
});

/**
 * Cubre `detectCellFontSizePx` (vía `parseHtmlClipboardTable`'s campo
 * `fontSize`) -- pedido explícito 2026-09-10 ("el tamaño de la letra puede
 * ser variable, esto tiene que ajustarse lo mas identico posible al
 * documento original tanto para la importacion como para el
 * portapapeles"). A diferencia del ancho de columna, esto NO depende del
 * canvas de medición -- es puro parseo de `style`/clases del HTML, así que
 * SÍ se prueba con precisión real acá.
 */
describe('parseHtmlClipboardTable -- fontSize (detección de tamaño de fuente de origen)', () => {
  it('detecta font-size en pt (style inline real, típico de Word/Google Docs)', () => {
    const html = '<table><tr><td><span style="font-size:14pt">A</span></td></tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.fontSize).toBeCloseTo(14 * (96 / 72), 5);
  });

  it('detecta font-size en px', () => {
    const html = '<table><tr><td><span style="font-size:20px">A</span></td></tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.fontSize).toBe(20);
  });

  it('detecta el marcador sintético beemetry-size-N (import de .docx, ver docxPageBreaks.ts)', () => {
    const html = '<table><tr><td><span class="beemetry-size-11">A</span></td></tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.fontSize).toBeCloseTo(11 * (96 / 72), 5);
  });

  it('el font-size puede venir directo en la celda, sin span anidado', () => {
    const html = '<table><tr><td style="font-size:18pt">A</td></tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.fontSize).toBeCloseTo(18 * (96 / 72), 5);
  });

  it('usa la PRIMERA celda con señal -- no sigue buscando en las demás', () => {
    const html = '<table><tr>' +
      '<td><span style="font-size:12pt">A</span></td>' +
      '<td><span style="font-size:24pt">B</span></td>' +
      '</tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.fontSize).toBeCloseTo(12 * (96 / 72), 5);
  });

  it('sin ninguna señal de tamaño en toda la tabla, fontSize queda undefined', () => {
    const html = '<table><tr><td>A</td><td>B</td></tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.fontSize).toBeUndefined();
  });
});

/**
 * Cubre `detectCellTextColor` (vía `parseHtmlClipboardTable`'s campos
 * `headerTextColor`/`bodyTextColor`) -- bug real reportado 2026-09-11 con
 * un documento real: "no esta trayendo bien el color del header que lo
 * deja en negro el texto, solo trae el color [de fondo]". Antes de esto,
 * `parseHtmlClipboardTable` solo guardaba `cellEl.textContent` (texto
 * plano puro) -- cualquier `<span class="beemetry-color-...">` o
 * `style="color:..."` que mammoth/Word pusiera adentro de una celda se
 * descartaba por completo, sin importar si la extracción de color de texto
 * de runs (docxPageBreaks.ts) había funcionado bien río arriba o no.
 */
describe('parseHtmlClipboardTable -- headerTextColor/bodyTextColor (color de texto de encabezado/cuerpo)', () => {
  it('detecta el color de texto del encabezado desde el marcador beemetry-color-* dentro de un <th>', () => {
    const html = '<table><thead><tr><th><span class="beemetry-color-FFFFFF">Instrumento</span></th></tr></thead>' +
      '<tbody><tr><td>GB-InSAR</td></tr></tbody></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.headerTextColor).toBe('#FFFFFF');
  });

  it('detecta el color de texto del CUERPO por separado del encabezado', () => {
    const html = '<table><thead><tr><th><span class="beemetry-color-FFFFFF">Instrumento</span></th></tr></thead>' +
      '<tbody><tr><td><span style="color:rgb(51, 65, 85)">GB-InSAR</span></td></tr></tbody></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.headerTextColor).toBe('#FFFFFF');
    expect(parsed?.bodyTextColor).toBe('rgb(51, 65, 85)');
  });

  it('blanco NUNCA se descarta para color de TEXTO (a diferencia del fondo, donde blanco casi siempre es "sin elegir")', () => {
    // El DOM normaliza `style.color` a la forma rgb(...) al leerlo de
    // vuelta -- distinto de `isWhiteOrTransparentColor` (fondo), que
    // compara contra esa MISMA forma normalizada; acá no hay ningún
    // filtro de blanco que lo intercepte en el camino.
    const html = '<table><tr><th><span style="color:#ffffff">Encabezado</span></th></tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.headerTextColor).toBe('rgb(255, 255, 255)');
  });

  it('sin <th> en la tabla (pegado plano de Excel/Sheets), la fila 0 se trata igual como encabezado', () => {
    const html = '<table><tr><td><span class="beemetry-color-000000">Cabecera</span></td></tr>' +
      '<tr><td><span class="beemetry-color-334155">Dato</span></td></tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.headerTextColor).toBe('#000000');
    expect(parsed?.bodyTextColor).toBe('#334155');
  });

  it('sin ninguna señal de color en toda la tabla, ambos quedan undefined', () => {
    const html = '<table><tr><th>A</th></tr><tr><td>B</td></tr></table>';
    const parsed = parseHtmlClipboardTable(html);
    expect(parsed?.headerTextColor).toBeUndefined();
    expect(parsed?.bodyTextColor).toBeUndefined();
  });
});
