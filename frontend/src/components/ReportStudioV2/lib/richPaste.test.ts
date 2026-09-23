import { describe, expect, it } from 'vitest';
import { parseRichClipboardPaste, parseRichClipboardBlocks, pairCaptionsWithMedia, type PasteBlock } from './richPaste';

function spanText(text: string, span: { start: number; end: number }): string {
  return text.slice(span.start, span.end);
}

describe('parseRichClipboardPaste — fallback a texto plano', () => {
  it('sin HTML, usa el texto plano tal cual, sin spans', () => {
    const result = parseRichClipboardPaste('', 'hola\nmundo');
    expect(result).toEqual({ text: 'hola\nmundo', spans: [] });
  });

  it('normaliza saltos de linea CRLF/CR del texto plano', () => {
    const result = parseRichClipboardPaste('', 'a\r\nb\rc');
    expect(result?.text).toBe('a\nb\nc');
  });

  it('sin html ni texto plano, devuelve null', () => {
    expect(parseRichClipboardPaste('', '')).toBeNull();
  });

  it('HTML sin ninguna etiqueta real (solo texto) tambien funciona', () => {
    const result = parseRichClipboardPaste('hola simple', 'hola simple');
    expect(result?.text).toBe('hola simple');
  });
});

describe('parseRichClipboardPaste — formato por caracter (negrita/cursiva/color/tamano)', () => {
  it('preserva negrita de <b> y dejar el resto sin marcar', () => {
    const result = parseRichClipboardPaste('<p>hola <b>mundo</b> feliz</p>', 'hola mundo feliz');
    expect(result?.text).toBe('hola mundo feliz');
    const boldSpan = result?.spans.find((s) => s.bold && spanText(result.text, s) === 'mundo');
    expect(boldSpan).toBeTruthy();
    const plainSpan = result?.spans.find((s) => spanText(result.text, s) === 'hola ');
    expect(plainSpan?.bold).toBe(false);
  });

  it('preserva color y tamano de fuente via style inline (pt se convierte a px)', () => {
    const result = parseRichClipboardPaste(
      '<span style="color:rgb(200,0,0);font-size:12pt">rojo</span>',
      'rojo',
    );
    const span = result?.spans.find((s) => spanText(result.text, s) === 'rojo');
    expect(span?.color).toBe('rgb(200,0,0)');
    expect(span?.fontSize).toBe(16); // 12pt * 96/72 = 16px
  });

  it('dos parrafos quedan separados por un salto de linea', () => {
    const result = parseRichClipboardPaste('<p>primero</p><p>segundo</p>', 'primero\nsegundo');
    expect(result?.text).toBe('primero\nsegundo');
  });

  it('<br> dentro de un parrafo tambien corta la linea', () => {
    const result = parseRichClipboardPaste('<p>uno<br>dos</p>', 'uno\ndos');
    expect(result?.text).toBe('uno\ndos');
  });
});

describe('parseRichClipboardPaste — encabezados (h1-h6)', () => {
  it('un <h1> se marca con headingStyle y usa el tamano/negrita del preset de la app', () => {
    const result = parseRichClipboardPaste('<h1>Titulo</h1><p>cuerpo</p>', 'Titulo\ncuerpo');
    expect(result?.text).toBe('Titulo\ncuerpo');
    const span = result?.spans.find((s) => spanText(result!.text, s) === 'Titulo');
    expect(span?.headingStyle).toBe('h1');
    expect(span?.bold).toBe(true);
    expect(span?.fontSize).toBe(22);
  });
});

describe('parseRichClipboardPaste — listas (SCRUM-30 extendido, mismo esquema de sangria por TAB)', () => {
  it('una lista <ul> simple usa el marcador de vineta de la app', () => {
    const result = parseRichClipboardPaste('<ul><li>uno</li><li>dos</li></ul>', 'uno\ndos');
    expect(result?.text).toBe('• uno\n• dos');
  });

  it('una lista <ol> simple usa numeracion', () => {
    const result = parseRichClipboardPaste('<ol><li>uno</li><li>dos</li></ol>', 'uno\ndos');
    expect(result?.text).toBe('1. uno\n2. dos');
  });

  it('una sub-lista anidada queda un nivel mas indentada (letras en el nivel 2)', () => {
    const result = parseRichClipboardPaste(
      '<ol><li>uno<ul><li>sub-a</li></ul></li><li>dos</li></ol>',
      'uno\nsub-a\ndos',
    );
    expect(result?.text).toBe('1. uno\n\ta. sub-a\n2. dos');
  });

  it('el formato caracter a caracter dentro de un item de lista sigue correcto tras el corrimiento del marcador', () => {
    const result = parseRichClipboardPaste('<ul><li><b>negrita</b> normal</li></ul>', 'negrita normal');
    expect(result?.text).toBe('• negrita normal');
    const boldSpan = result?.spans.find((s) => s.bold);
    expect(boldSpan).toBeTruthy();
    expect(spanText(result!.text, boldSpan!)).toBe('negrita');
  });

  it('texto normal antes y despues de una lista no se ve afectado', () => {
    const result = parseRichClipboardPaste(
      '<p>antes</p><ul><li>item</li></ul><p>despues</p>',
      'antes\nitem\ndespues',
    );
    expect(result?.text).toBe('antes\n• item\ndespues');
  });
});

describe('parseRichClipboardPaste — espaciado exagerado (párrafos vacíos / <br> en cadena de Word/Docs)', () => {
  it('varios parrafos vacios seguidos (espaciador de Word) colapsan a lo sumo una linea en blanco', () => {
    const html = '<p>antes</p><p>&nbsp;</p><p></p><p><br></p><p>&nbsp;</p><p>despues</p>';
    const result = parseRichClipboardPaste(html, 'antes\ndespues');
    expect(result?.text).toBe('antes\n\ndespues');
  });

  it('varios <br> seguidos dentro de un mismo parrafo colapsan a lo sumo una linea en blanco', () => {
    const html = '<p>antes<br><br><br><br><br>despues</p>';
    const result = parseRichClipboardPaste(html, 'antes\ndespues');
    expect(result?.text).toBe('antes\n\ndespues');
  });

  it('un solo parrafo vacio entre dos con contenido se conserva como una linea en blanco (no se elimina)', () => {
    const html = '<p>antes</p><p>&nbsp;</p><p>despues</p>';
    const result = parseRichClipboardPaste(html, 'antes\ndespues');
    expect(result?.text).toBe('antes\n\ndespues');
  });

  it('dos parrafos seguidos sin ninguno vacio en medio no ganan una linea en blanco de mas', () => {
    const result = parseRichClipboardPaste('<p>antes</p><p>despues</p>', 'antes\ndespues');
    expect(result?.text).toBe('antes\ndespues');
  });
});

describe('parseRichClipboardBlocks — documento mixto (Word/Google Docs)', () => {
  it('separa texto + tabla + imagen en bloques, en el mismo orden del documento', () => {
    const html = `
      <h1>Introducción</h1>
      <p>Un párrafo antes de la tabla.</p>
      <table><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>
      <p>Un párrafo después de la tabla.</p>
      <img src="data:image/png;base64,AAAA">
    `;
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'table', 'text', 'image']);
    expect((blocks[0] as { text: string }).text).toContain('Introducción');
    expect((blocks[0] as { text: string }).text).toContain('párrafo antes');
    expect((blocks[1] as { rows: string[][] }).rows).toEqual([['A1', 'B1'], ['A2', 'B2']]);
    expect((blocks[2] as { text: string }).text).toContain('párrafo después');
    expect((blocks[3] as { src: string }).src).toBe('data:image/png;base64,AAAA');
  });

  it('un solo párrafo sin tabla ni imagen -- un único bloque de texto', () => {
    const blocks = parseRichClipboardBlocks('<p>solo texto, nada más</p>');
    expect(blocks).toEqual([{ kind: 'text', text: 'solo texto, nada más', spans: expect.any(Array) }]);
  });

  it('una tabla sola (pegado de Excel/Sheets) -- un único bloque de tabla, sin bloques de texto vacíos', () => {
    const blocks = parseRichClipboardBlocks('<table><tr><td>X</td><td>Y</td></tr></table>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('table');
  });

  it('dos tablas separadas por un párrafo quedan como tres bloques distintos', () => {
    const html = '<table><tr><td>1</td></tr></table><p>en medio</p><table><tr><td>2</td></tr></table>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['table', 'text', 'table']);
    expect((blocks[0] as { rows: string[][] }).rows).toEqual([['1']]);
    expect((blocks[2] as { rows: string[][] }).rows).toEqual([['2']]);
  });

  it('conserva celdas fusionadas (rowspan/colspan) de la tabla en medio de un documento mixto', () => {
    const html = `<p>antes</p><table><tr><td colspan="2">Título</td></tr><tr><td>A</td><td>B</td></tr></table><p>despues</p>`;
    const blocks = parseRichClipboardBlocks(html);
    const table = blocks.find((b) => b.kind === 'table') as { merges: { row: number; column: number; rowSpan: number; colSpan: number }[] };
    expect(table.merges).toContainEqual({ row: 0, column: 0, rowSpan: 1, colSpan: 2 });
  });

  it('sin HTML aprovechable, devuelve un array vacío', () => {
    expect(parseRichClipboardBlocks('')).toEqual([]);
  });

  it('parrafos vacios seguidos antes de una tabla no inflan el bloque de texto con lineas en blanco de mas', () => {
    const html = '<p>antes</p><p>&nbsp;</p><p></p><p></p><p></p><table><tr><td>X</td></tr></table>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'table']);
    expect((blocks[0] as { text: string }).text).toBe('antes\n\n');
  });

  it('un salto de pagina manual de Word (marcador <hr class="docx-page-break">, ver App.tsx::handleImportDocx) parte el texto en bloques separados', () => {
    const html = '<h1>Pagina 1</h1><p>Contenido de la primera pagina.</p><hr class="docx-page-break"><h1>Pagina 2</h1><p>Contenido de la segunda pagina.</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'text']);
    expect((blocks[0] as { text: string }).text).toContain('Pagina 1');
    expect((blocks[0] as { text: string }).text).toContain('primera pagina');
    expect((blocks[0] as { text: string }).text).not.toContain('Pagina 2');
    expect((blocks[1] as { text: string }).text).toContain('Pagina 2');
    expect((blocks[1] as { text: string }).text).toContain('segunda pagina');
  });

  it('varios saltos de pagina seguidos producen un bloque de texto por cada pagina, sin bloques vacios de por medio', () => {
    const html = '<p>uno</p><hr class="docx-page-break"><p>dos</p><hr class="docx-page-break"><p>tres</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'text', 'text']);
    expect((blocks[0] as { text: string }).text).toBe('uno');
    expect((blocks[1] as { text: string }).text).toBe('dos');
    expect((blocks[2] as { text: string }).text).toBe('tres');
  });

  it('un <hr> normal (sin la clase del marcador) no fuerza ningun corte -- no confundir con un divisor decorativo cualquiera', () => {
    const html = '<p>antes</p><hr><p>despues</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text']);
    expect((blocks[0] as { text: string }).text).toBe('antes\ndespues');
  });
});

describe('parseRichClipboardBlocks — disposición del texto (alineación, sangría, tamaño de imagen)', () => {
  it('lee text-align del primer parrafo y lo aplica al bloque completo', () => {
    const html = '<p style="text-align: center">Titulo centrado</p><p style="text-align: center">Segunda linea, mismo bloque</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { textAlign?: string }).textAlign).toBe('center');
  });

  it('reconoce las 4 alineaciones (left/center/right/justify)', () => {
    expect((parseRichClipboardBlocks('<p style="text-align:left">x</p>')[0] as any).textAlign).toBe('left');
    expect((parseRichClipboardBlocks('<p style="text-align:right">x</p>')[0] as any).textAlign).toBe('right');
    expect((parseRichClipboardBlocks('<p style="text-align:justify">x</p>')[0] as any).textAlign).toBe('justify');
  });

  it('sin text-align en el HTML, el bloque no trae textAlign (deja el default de la app)', () => {
    const blocks = parseRichClipboardBlocks('<p>sin alineacion</p>');
    expect((blocks[0] as any).textAlign).toBeUndefined();
  });

  it('el PRIMER parrafo con contenido real decide la alineacion del bloque -- el segundo no la pisa', () => {
    const html = '<p style="text-align: center">Encabezado</p><p style="text-align: left">Cuerpo normal</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect((blocks[0] as any).textAlign).toBe('center');
  });

  it('margin-left se traduce a indentLeft en px (soporta pt, in, cm)', () => {
    expect((parseRichClipboardBlocks('<p style="margin-left: 36px">x</p>')[0] as any).indentLeft).toBe(36);
    expect((parseRichClipboardBlocks('<p style="margin-left: 0.5in">x</p>')[0] as any).indentLeft).toBe(48);
    expect((parseRichClipboardBlocks('<p style="margin-left: 18pt">x</p>')[0] as any).indentLeft).toBe(24);
  });

  it('text-indent positivo es sangria de primera linea (firstLine); negativo es sangria francesa (hanging)', () => {
    const firstLine = parseRichClipboardBlocks('<p style="text-indent: 20px">x</p>')[0] as any;
    expect(firstLine.specialIndent).toBe('firstLine');
    expect(firstLine.specialIndentBy).toBe(20);

    const hanging = parseRichClipboardBlocks('<p style="text-indent: -20px">x</p>')[0] as any;
    expect(hanging.specialIndent).toBe('hanging');
    expect(hanging.specialIndentBy).toBe(20);
  });

  it('align="center" (atributo legado, sin style) tambien se reconoce', () => {
    const blocks = parseRichClipboardBlocks('<p align="center">Titulo</p>');
    expect((blocks[0] as any).textAlign).toBe('center');
  });

  it('el tamaño de una imagen se lee de los atributos width/height del <img>', () => {
    const html = '<img src="data:image/png;base64,AAAA" width="300" height="150">';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks[0]).toMatchObject({ kind: 'image', width: 300, height: 150 });
  });

  it('el tamaño de una imagen tambien se lee de style="width:...;height:...;" si no hay atributos', () => {
    const html = '<img src="data:image/png;base64,AAAA" style="width: 200px; height: 100px;">';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks[0]).toMatchObject({ kind: 'image', width: 200, height: 100 });
  });

  it('una imagen sin tamaño en el HTML no trae width/height (el caller decide el respaldo)', () => {
    const html = '<img src="data:image/png;base64,AAAA">';
    const blocks = parseRichClipboardBlocks(html);
    expect((blocks[0] as any).width).toBeUndefined();
    expect((blocks[0] as any).height).toBeUndefined();
  });

  it('un cambio de alineacion entre parrafos consecutivos fuerza un bloque nuevo -- un titulo centrado no le "contagia" su centrado al parrafo normal siguiente', () => {
    const html = '<p style="text-align:center">Titulo Centrado</p><p style="text-align:left">Parrafo normal debajo, sin salto de pagina de por medio.</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'text']);
    expect((blocks[0] as any).textAlign).toBe('center');
    expect((blocks[0] as any).text).toBe('Titulo Centrado');
    expect((blocks[1] as any).textAlign).toBe('left');
    expect((blocks[1] as any).text).toBe('Parrafo normal debajo, sin salto de pagina de por medio.');
  });

  it('parrafos CONSECUTIVOS con la MISMA alineacion siguen fusionandose en un solo bloque (no se fragmenta de mas)', () => {
    const html = '<p style="text-align:center">Linea uno</p><p style="text-align:center">Linea dos</p><p style="text-align:center">Linea tres</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).textAlign).toBe('center');
    expect((blocks[0] as any).text).toBe('Linea uno\nLinea dos\nLinea tres');
  });

  it('un documento mixto real conserva alineacion/sangria del texto Y tamaño de la imagen a la vez', () => {
    const html = '<p style="text-align:center">Titulo centrado</p><img src="data:image/png;base64,AAAA" width="400" height="250"><p style="margin-left:40px">Parrafo con sangria despues de la imagen.</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'image', 'text']);
    expect((blocks[0] as any).textAlign).toBe('center');
    expect(blocks[1]).toMatchObject({ width: 400, height: 250 });
    expect((blocks[2] as any).indentLeft).toBe(40);
  });
});

/**
 * Bug real reportado 2026-09-11 con un documento .docx real ("figura 5 lo
 * esta colocando como texto centrado y como esta centrado centra todo el
 * contenido de abajo"): el corte-por-cambio-de-alineación de arriba (ver
 * "un cambio de alineacion... fuerza un bloque nuevo") solo miraba
 * `style="text-align:..."` -- pero un .docx importado NUNCA trae eso
 * directo en el `<p>`/`<h1>`, solo el marcador `<span class="docx-align-...">`
 * ANIDADO que produce `lib/docxPageBreaks.ts::markParagraphAlignment`. Sin
 * verlo, el corte nunca se disparaba para contenido de .docx: una leyenda
 * centrada ("Figura N.") fusionaba TODO lo que viniera después (incluido
 * un encabezado sin `w:jc` propio, y el párrafo normal siguiente) en un
 * solo bloque que heredaba el centrado de la leyenda.
 */
describe('parseRichClipboardBlocks — alineación vía marcador docx-align-* (import de .docx)', () => {
  const wrapDocxAlign = (align: string, text: string) => `<p><span class="docx-align-${align}">${text}</span></p>`;

  it('un cambio de alineación entre marcadores docx-align-* consecutivos también corta el bloque', () => {
    const html = wrapDocxAlign('center', 'Leyenda centrada') + wrapDocxAlign('justify', 'Parrafo normal justificado despues.');
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'text']);
    expect((blocks[0] as any).textAlign).toBe('center');
    expect((blocks[0] as any).text).toBe('Leyenda centrada');
    expect((blocks[1] as any).textAlign).toBe('justify');
    expect((blocks[1] as any).text).toBe('Parrafo normal justificado despues.');
  });

  it('un <h1> SIEMPRE corta el bloque ANTERIOR (nunca queda fusionado hacia atrás con una leyenda/párrafo previo)', () => {
    const html = wrapDocxAlign('center', 'Figura 1. Una leyenda.') + '<h1>2. Un encabezado</h1>' + '<p>Parrafo normal.</p>';
    const blocks = parseRichClipboardBlocks(html);
    // La leyenda queda SOLA, sin el encabezado colgado atrás -- ese era el
    // bug real (una leyenda "adoptaba" el encabezado siguiente). El
    // encabezado SÍ puede seguir fusionándose hacia ADELANTE con el
    // párrafo que lo sigue (no tiene alineación propia que difiera de la
    // de ese párrafo) -- eso no es el bug reportado, ver el comentario de
    // `pairCaptionsWithMedia` para cómo se resuelve del todo con leyendas.
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as any).text).toBe('Figura 1. Una leyenda.');
    expect((blocks[0] as any).textAlign).toBe('center');
    expect((blocks[1] as any).text).toBe('2. Un encabezado\nParrafo normal.');
  });

  it('escenario real completo: leyenda centrada + encabezado + cuerpo -- la leyenda queda sola, sin heredar el encabezado', () => {
    const html =
      wrapDocxAlign('center', 'Figura 5. Registro de asentamiento.') +
      '<h1>4. Caso particular: Celda 7CR2</h1>' +
      '<p><span class="docx-align-justify">La celda 7CR2 presenta una anomalia evidente.</span></p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as any).text).toBe('Figura 5. Registro de asentamiento.');
    expect((blocks[0] as any).textAlign).toBe('center');
    expect((blocks[1] as any).text).toBe('4. Caso particular: Celda 7CR2\nLa celda 7CR2 presenta una anomalia evidente.');
  });

  it('párrafos consecutivos con el MISMO marcador docx-align-* siguen fusionándose (no se fragmenta de más)', () => {
    const html = wrapDocxAlign('justify', 'Linea uno.') + wrapDocxAlign('justify', 'Linea dos.');
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).text).toBe('Linea uno.\nLinea dos.');
  });
});

/**
 * Cubre las clases sintéticas `beemetry-color-*`/`beemetry-size-*` --
 * pedido explícito 2026-09-10, ver lib/docxPageBreaks.ts::enrichDocxTextStyles
 * para el porqué el color/tamaño de un .docx llegan como estas clases en
 * vez de un `style="..."` inline normal (mammoth no las emite de otra
 * forma). Estos tests usan el HTML tal como mammoth ya lo produciría, sin
 * pasar por mammoth de verdad (ese round-trip completo está cubierto en
 * docxPageBreaks.test.ts).
 */
describe('parseRichClipboardBlocks — marcadores beemetry-color-*/beemetry-size-* (import de .docx)', () => {
  it('beemetry-color-RRGGBB se traduce a TextStyleSpan.color', () => {
    const html = '<p><span class="beemetry-color-ff0000">Rojo</span></p>';
    const blocks = parseRichClipboardBlocks(html);
    const spans = (blocks[0] as any).spans;
    expect(spans[0].color).toBe('#ff0000');
  });

  it('beemetry-size-N (puntos) se traduce a TextStyleSpan.fontSize en px (96/72)', () => {
    const html = '<p><span class="beemetry-size-14">Grande</span></p>';
    const blocks = parseRichClipboardBlocks(html);
    const spans = (blocks[0] as any).spans;
    expect(spans[0].fontSize).toBeCloseTo(14 * (96 / 72), 5);
  });

  it('admite tamaños con decimales (medio-punto de OOXML, p.ej. 10.5pt)', () => {
    const html = '<p><span class="beemetry-size-10.5">Texto</span></p>';
    const blocks = parseRichClipboardBlocks(html);
    const spans = (blocks[0] as any).spans;
    expect(spans[0].fontSize).toBeCloseTo(10.5 * (96 / 72), 5);
  });

  it('color y tamaño anidados (como los produce mammoth de verdad) se combinan en el mismo span', () => {
    const html = '<p><span class="beemetry-color-0000ff"><span class="beemetry-size-18">Azul y grande</span></span></p>';
    const blocks = parseRichClipboardBlocks(html);
    const spans = (blocks[0] as any).spans;
    expect(spans[0].color).toBe('#0000ff');
    expect(spans[0].fontSize).toBeCloseTo(18 * (96 / 72), 5);
  });

  it('negrita real dentro de un span de color se conserva', () => {
    const html = '<p><span class="beemetry-color-ff0000"><strong>Rojo y en negrita</strong></span></p>';
    const blocks = parseRichClipboardBlocks(html);
    const spans = (blocks[0] as any).spans;
    expect(spans[0].color).toBe('#ff0000');
    expect(spans[0].bold).toBe(true);
  });

  it('una clase SPAN que no coincide con ninguno de los dos patrones no afecta el estilo', () => {
    const html = '<p><span class="cualquier-otra-clase">Normal</span></p>';
    const blocks = parseRichClipboardBlocks(html);
    const spans = (blocks[0] as any).spans;
    expect(spans[0].color).toBeUndefined();
    expect(spans[0].fontSize).toBeUndefined();
  });
});

/**
 * Cubre el marcador `beemetry-hr` (línea horizontal de un .docx importado,
 * ver lib/docxPageBreaks.ts::markHorizontalRuleParagraphs) -- pedido
 * explícito 2026-09-10. Debe cortar el bloque de texto en curso y empujar
 * un bloque de forma tipo línea, sin que el caracter marcador (invisible,
 * solo existe para que mammoth genere el span) termine como texto real.
 */
describe('parseRichClipboardBlocks — línea horizontal (marcador beemetry-hr)', () => {
  it('produce un bloque { kind: "shape", shapeType: "line" } en el lugar correcto de la secuencia', () => {
    const html = '<p>Titulo con linea debajo<span class="beemetry-hr">―</span></p><p>Parrafo normal despues</p>';
    const blocks = parseRichClipboardBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'shape', 'text']);
    expect(blocks[1]).toEqual({ kind: 'shape', shapeType: 'line' });
    expect((blocks[0] as any).text).toBe('Titulo con linea debajo');
    expect((blocks[2] as any).text).toBe('Parrafo normal despues');
  });

  it('el caracter marcador del span NO aparece en el texto del bloque anterior', () => {
    const html = '<p>Texto<span class="beemetry-hr">―</span></p>';
    const blocks = parseRichClipboardBlocks(html);
    expect((blocks[0] as any).text).toBe('Texto');
    expect((blocks[0] as any).text).not.toContain('―');
  });

  it('un documento sin ningún marcador beemetry-hr no produce bloques de forma', () => {
    const blocks = parseRichClipboardBlocks('<p>Solo texto normal</p>');
    expect(blocks.every((b) => b.kind !== 'shape')).toBe(true);
  });
});

/**
 * Cubre `pairCaptionsWithMedia` -- pedido explícito 2026-09-11, con un
 * documento .docx real: "figura 5 lo esta colocando como texto centrado...
 * esos bloques colocalos dentro de la propiedad de las imagenes o tablas
 * en el campo de leyenda opcional que para eso fue hecho". Antes de esto,
 * una leyenda ("Figura N."/"Tabla N.") se insertaba como un bloque de
 * texto centrado suelto -- este helper la saca de la secuencia y la
 * empareja con la imagen/tabla vecina, lista para ir a su prop `caption`.
 */
describe('pairCaptionsWithMedia', () => {
  const textBlock = (text: string): PasteBlock => ({ kind: 'text', text, spans: [] });
  const imageBlock = (src = 'data:image/png;base64,AAAA'): PasteBlock => ({ kind: 'image', src });
  const tableBlock = (): PasteBlock => ({ kind: 'table', rows: [['A']], merges: [], backgrounds: [[undefined]], aligns: [[undefined]] });

  it('una leyenda "Figura N." INMEDIATAMENTE DESPUÉS de una imagen se empareja con ella', () => {
    const blocks = [imageBlock(), textBlock('Figura 1. Una leyenda.')];
    const result = pairCaptionsWithMedia(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].block.kind).toBe('image');
    expect(result[0].caption).toBe('Figura 1. Una leyenda.');
  });

  it('una leyenda "Tabla N." INMEDIATAMENTE ANTES de una tabla también se empareja (Word a veces la pone arriba)', () => {
    const blocks = [textBlock('Tabla 1. Instrumentos evaluados.'), tableBlock()];
    const result = pairCaptionsWithMedia(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].block.kind).toBe('table');
    expect(result[0].caption).toBe('Tabla 1. Instrumentos evaluados.');
  });

  it('un párrafo normal que solo MENCIONA "la Figura 5" a mitad de oración no se confunde con una leyenda', () => {
    const blocks = [imageBlock(), textBlock('El comportamiento se verifica en la Figura 5: ascenso pronunciado.')];
    const result = pairCaptionsWithMedia(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].caption).toBeUndefined();
    expect(result[1].block.kind).toBe('text');
  });

  it('un párrafo largo (>220 caracteres) que empieza como "Tabla N." no se trata como leyenda -- una leyenda real es corta', () => {
    const longText = `Tabla 1. ${'x'.repeat(230)}`;
    const blocks = [tableBlock(), textBlock(longText)];
    const result = pairCaptionsWithMedia(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].caption).toBeUndefined();
  });

  it('cada bloque de texto solo puede ser leyenda de UN vecino -- no se reutiliza para dos imágenes seguidas', () => {
    const blocks = [imageBlock(), textBlock('Figura 1. Leyenda unica.'), imageBlock()];
    const result = pairCaptionsWithMedia(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].caption).toBe('Figura 1. Leyenda unica.');
    expect(result[1].caption).toBeUndefined();
  });

  it('bloques de texto normales (sin patrón de leyenda) pasan intactos, sin emparejar con nada', () => {
    const blocks = [textBlock('Un párrafo cualquiera.'), imageBlock()];
    const result = pairCaptionsWithMedia(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].caption).toBeUndefined();
    expect(result[1].caption).toBeUndefined();
  });

  it('reconoce "Cuadro N."/"Fig."/"Imagen N." además de "Figura N."/"Tabla N."', () => {
    expect(pairCaptionsWithMedia([tableBlock(), textBlock('Cuadro 3. Resumen.')])[0].caption).toBe('Cuadro 3. Resumen.');
    expect(pairCaptionsWithMedia([imageBlock(), textBlock('Fig. 2: Detalle.')])[0].caption).toBe('Fig. 2: Detalle.');
  });
});
