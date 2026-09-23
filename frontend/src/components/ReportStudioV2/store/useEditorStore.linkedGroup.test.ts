import { describe, it, expect } from 'vitest';
import { useEditorStore, type ReportDocument, type ReportElement, type ReportPage } from './useEditorStore';
import { getReportLayoutMetrics } from '../lib/reportLayoutMetrics';

/**
 * Cubre `linkedGroupId` -- pedido explícito 2026-09-09: un bloque de texto
 * que la paginación automática partió entre páginas (pegado de Word/Docs
 * que no cupo entero) debe seguir "perteneciendo al mismo bloque original":
 * mover UN fragmento (arriba/abajo, o entre columnas) mueve a todos sus
 * hermanos del mismo grupo -- en cualquier página -- por el mismo delta.
 */

const makeElement = (overrides: Partial<ReportElement>): ReportElement => ({
  id: 'el', type: 'text', x: 0, y: 0, width: 100, height: 40, zIndex: 1, locked: false, props: {},
  ...overrides,
});

const makePage = (pageNumber: number, elements: ReportElement[]): ReportPage => ({
  page_number: pageNumber,
  elements: [
    makeElement({ id: `header-${pageNumber}`, type: 'header' }),
    ...elements,
    makeElement({ id: `footer-${pageNumber}`, type: 'footer' }),
  ],
});

const makeDoc = (pages: ReportPage[]): ReportDocument => ({
  document_id: 'rep_test',
  pages,
  meta: {
    author: 'Test', version: 1, updatedAt: new Date().toISOString(),
    layoutMode: 'document', paperSize: 'A4', orientation: 'portrait',
  },
});

const metrics = getReportLayoutMetrics('document', 'A4', 'portrait', undefined, undefined, undefined, undefined);

describe('linkedGroupId -- fragmentos de un mismo bloque partido entre páginas', () => {
  it('mover un fragmento desplaza a su hermano del mismo grupo en OTRA página, por el mismo delta', () => {
    const fragA = makeElement({ id: 'frag-a', x: 40, y: 800, width: 300, height: 100, linkedGroupId: 'group-1' });
    const fragB = makeElement({ id: 'frag-b', x: 40, y: 200, width: 300, height: 150, linkedGroupId: 'group-1' });
    const doc = makeDoc([makePage(1, [fragA]), makePage(2, [fragB])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'frag-a', { y: 750 });

    const updatedDoc = useEditorStore.getState().doc;
    const updatedA = updatedDoc.pages[0].elements.find((el) => el.id === 'frag-a');
    const updatedB = updatedDoc.pages[1].elements.find((el) => el.id === 'frag-b');
    expect(updatedA?.y).toBe(750); // se movió 50px hacia arriba
    expect(updatedB?.y).toBe(150); // el hermano en la otra página se movió el MISMO delta (-50)
  });

  it('un elemento SIN linkedGroupId no arrastra a nadie más', () => {
    const solo = makeElement({ id: 'solo', x: 40, y: 800, width: 300, height: 100 });
    const other = makeElement({ id: 'other', x: 40, y: 200, width: 200, height: 50 });
    const doc = makeDoc([makePage(1, [solo, other])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'solo', { y: 700 });

    const updatedOther = useEditorStore.getState().doc.pages[0].elements.find((el) => el.id === 'other');
    expect(updatedOther?.y).toBe(200); // sin cambios
  });

  it('el hermano se recorta a los límites de SU PROPIA página (no puede salirse del área de contenido)', () => {
    const fragA = makeElement({ id: 'frag-a', x: 40, y: 500, width: 300, height: 100, linkedGroupId: 'group-2' });
    // frag-b ya está pegado al tope de su página -- moverlo más arriba lo sacaría del área de contenido.
    const fragB = makeElement({ id: 'frag-b', x: 40, y: metrics.CONTENT_TOP, width: 300, height: 150, linkedGroupId: 'group-2' });
    const doc = makeDoc([makePage(1, [fragA]), makePage(2, [fragB])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'frag-a', { y: 300 }); // sube 200px

    const updatedB = useEditorStore.getState().doc.pages[1].elements.find((el) => el.id === 'frag-b');
    expect(updatedB?.y).toBe(metrics.CONTENT_TOP); // recortado, nunca por encima del tope de SU página
  });

  it('dos grupos enlazados distintos no se afectan entre sí', () => {
    const groupA1 = makeElement({ id: 'a1', x: 40, y: 800, width: 300, height: 100, linkedGroupId: 'group-a' });
    const groupA2 = makeElement({ id: 'a2', x: 40, y: 72, width: 300, height: 100, linkedGroupId: 'group-a' });
    const groupB1 = makeElement({ id: 'b1', x: 40, y: 300, width: 300, height: 100, linkedGroupId: 'group-b' });
    const doc = makeDoc([makePage(1, [groupA1, groupB1]), makePage(2, [groupA2])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'a1', { y: 750 });

    const updatedB1 = useEditorStore.getState().doc.pages[0].elements.find((el) => el.id === 'b1');
    expect(updatedB1?.y).toBe(300); // grupo distinto, sin cambios
  });

  it('un cambio que no toca x/y (p.ej. solo el texto) no mueve al hermano', () => {
    const fragA = makeElement({ id: 'frag-a', x: 40, y: 800, width: 300, height: 100, linkedGroupId: 'group-3', props: { text: 'antes' } });
    const fragB = makeElement({ id: 'frag-b', x: 40, y: 72, width: 300, height: 100, linkedGroupId: 'group-3' });
    const doc = makeDoc([makePage(1, [fragA]), makePage(2, [fragB])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'frag-a', { props: { text: 'despues' } });

    const updatedB = useEditorStore.getState().doc.pages[1].elements.find((el) => el.id === 'frag-b');
    expect(updatedB?.y).toBe(72);
  });
});

/**
 * Pedido explícito 2026-09-10: seleccionar cualquier fragmento de un bloque
 * partido entre páginas (tabla o texto) debe seleccionar a TODOS sus
 * hermanos del mismo `linkedGroupId` -- antes `selectElement` solo movía
 * los fragmentos en conjunto (ver arriba), nunca los seleccionaba juntos.
 */
describe('selectElement -- selección en conjunto de fragmentos con linkedGroupId', () => {
  it('seleccionar un fragmento selecciona a todos los hermanos del mismo grupo, en cualquier página', () => {
    const fragA = makeElement({ id: 'frag-a', linkedGroupId: 'group-sel' });
    const fragB = makeElement({ id: 'frag-b', linkedGroupId: 'group-sel' });
    const doc = makeDoc([makePage(1, [fragA]), makePage(2, [fragB])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().selectElement('frag-b');

    const state = useEditorStore.getState();
    expect(state.selectedElementId).toBe('frag-b'); // el clickeado sigue siendo el "activo"
    expect(state.selectedElementIds.sort()).toEqual(['frag-a', 'frag-b']);
  });

  it('seleccionar un elemento sin linkedGroupId solo se selecciona a sí mismo', () => {
    const solo = makeElement({ id: 'solo' });
    const other = makeElement({ id: 'other' });
    const doc = makeDoc([makePage(1, [solo, other])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().selectElement('solo');

    const state = useEditorStore.getState();
    expect(state.selectedElementId).toBe('solo');
    expect(state.selectedElementIds).toEqual(['solo']);
  });

  it('selectElement(undefined) limpia la selección', () => {
    const doc = makeDoc([makePage(1, [makeElement({ id: 'el' })])]);
    useEditorStore.setState((state) => ({ ...state, doc, selectedElementId: 'el', selectedElementIds: ['el'] }));

    useEditorStore.getState().selectElement(undefined);

    const state = useEditorStore.getState();
    expect(state.selectedElementId).toBeUndefined();
    expect(state.selectedElementIds).toEqual([]);
  });
});

/**
 * Pedido explícito 2026-09-10: una tabla que no cabe verticalmente en la
 * página debe partirse en fragmentos ENLAZADOS (mismo `linkedGroupId`),
 * no en dos tablas totalmente independientes -- `splitOverflowingTable` ya
 * repetía el encabezado en la continuación; lo que faltaba era el enlace.
 */
describe('splitOverflowingTable -- enlaza el origen y la continuación', () => {
  const makeTableElement = (overrides: Partial<ReportElement>): ReportElement => makeElement({
    id: 'tabla-1', type: 'table', x: metrics.CONTENT_LEFT, y: metrics.CONTENT_TOP,
    width: 300, height: 400,
    props: {
      rows: [
        ['Cabecera 1', 'Cabecera 2'],
        ['Dato 1', 'Dato 2'],
        ['Dato 3', 'Dato 4'],
        ['Dato 5', 'Dato 6'],
        ['Dato 7', 'Dato 8'],
      ],
      hasHeader: true,
    },
    ...overrides,
  });

  it('la primera vez que una tabla se parte, genera un linkedGroupId nuevo compartido por ambos fragmentos', () => {
    const table = makeTableElement({});
    const doc = makeDoc([makePage(1, [table])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().splitOverflowingTable({
      pageNumber: 1, elementId: 'tabla-1', fittingRowCount: 2, fittingHeightPx: 100, overflowHeightPx: 100,
    });

    const updatedDoc = useEditorStore.getState().doc;
    const source = updatedDoc.pages[0].elements.find((el) => el.id === 'tabla-1');
    const continuation = updatedDoc.pages[1]?.elements.find((el) => el.type === 'table');
    expect(source?.linkedGroupId).toBeTruthy();
    expect(continuation?.linkedGroupId).toBe(source?.linkedGroupId);
  });

  it('si la tabla que se parte YA es una continuación enlazada, la nueva continuación reutiliza el mismo grupo', () => {
    const table = makeTableElement({
      id: 'tabla-continuacion', linkedGroupId: 'table-link-original',
      props: {
        rows: [
          ['Cabecera 1', 'Cabecera 2'],
          ['Dato A', 'Dato B'],
          ['Dato C', 'Dato D'],
          ['Dato E', 'Dato F'],
        ],
        hasHeader: true,
      },
    });
    const doc = makeDoc([makePage(1, [table])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().splitOverflowingTable({
      pageNumber: 1, elementId: 'tabla-continuacion', fittingRowCount: 2, fittingHeightPx: 100, overflowHeightPx: 100,
    });

    const updatedDoc = useEditorStore.getState().doc;
    const source = updatedDoc.pages[0].elements.find((el) => el.id === 'tabla-continuacion');
    const continuation = updatedDoc.pages[1]?.elements.find((el) => el.type === 'table');
    expect(source?.linkedGroupId).toBe('table-link-original');
    expect(continuation?.linkedGroupId).toBe('table-link-original');
  });

  it('tras el split, seleccionar cualquiera de los dos fragmentos selecciona ambos', () => {
    const table = makeTableElement({});
    const doc = makeDoc([makePage(1, [table])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().splitOverflowingTable({
      pageNumber: 1, elementId: 'tabla-1', fittingRowCount: 2, fittingHeightPx: 100, overflowHeightPx: 100,
    });
    const continuation = useEditorStore.getState().doc.pages[1]?.elements.find((el) => el.type === 'table');
    expect(continuation).toBeTruthy();

    useEditorStore.getState().selectElement(continuation!.id);

    const state = useEditorStore.getState();
    expect(state.selectedElementIds.sort()).toEqual(['tabla-1', continuation!.id].sort());
  });

  it('la continuación repite el contenido de la fila de encabezado', () => {
    const table = makeTableElement({});
    const doc = makeDoc([makePage(1, [table])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().splitOverflowingTable({
      pageNumber: 1, elementId: 'tabla-1', fittingRowCount: 2, fittingHeightPx: 100, overflowHeightPx: 100,
    });

    const continuation = useEditorStore.getState().doc.pages[1]?.elements.find((el) => el.type === 'table');
    expect(continuation?.props.rows[0]).toEqual(['Cabecera 1', 'Cabecera 2']);
  });
});

/**
 * Bug real reportado en vivo 2026-09-10 (con captura): "el borde negro se
 * divide en 2, como si hubieran 2 tablas... 2 encabezados tambien veo".
 * Cuando solo la fila de encabezado entra en lo que resta de la página
 * (TableBlock.tsx fuerza que se reporte al menos 1 fila aunque ni siquiera
 * termine de entrar), partir ahí dejaba una tabla "origen" con SOLO el
 * encabezado -- cero filas de datos -- seguida de la continuación con
 * encabezado repetido + todo el contenido real: visualmente dos tablas
 * apiladas con dos encabezados. Fix: en vez de partir, la tabla completa se
 * reubica intacta al inicio de la página siguiente.
 */
describe('splitOverflowingTable -- encabezado huérfano (fittingRowCount === solo el encabezado)', () => {
  const makeTableElement = (overrides: Partial<ReportElement>): ReportElement => makeElement({
    id: 'tabla-1', type: 'table', x: metrics.CONTENT_LEFT, y: metrics.CONTENT_TOP,
    width: 300, height: 400,
    props: {
      rows: [
        ['Cabecera 1', 'Cabecera 2'],
        ['Dato 1', 'Dato 2'],
        ['Dato 3', 'Dato 4'],
      ],
      hasHeader: true,
    },
    ...overrides,
  });

  it('con hasHeader=true, fittingRowCount=1 reubica la tabla COMPLETA a la página siguiente en vez de partirla', () => {
    const table = makeTableElement({});
    const doc = makeDoc([makePage(1, [table])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().splitOverflowingTable({
      pageNumber: 1, elementId: 'tabla-1', fittingRowCount: 1, fittingHeightPx: 40, overflowHeightPx: 300,
    });

    const updatedDoc = useEditorStore.getState().doc;
    // La página de origen ya NO tiene la tabla (ni un fragmento degenerado).
    expect(updatedDoc.pages[0].elements.some((el) => el.type === 'table')).toBe(false);
    // La página siguiente tiene la tabla COMPLETA, sin partir.
    const relocated = updatedDoc.pages[1]?.elements.find((el) => el.type === 'table');
    expect(relocated?.id).toBe('tabla-1'); // mismo id -- no es un fragmento nuevo
    expect(relocated?.props.rows).toEqual([
      ['Cabecera 1', 'Cabecera 2'],
      ['Dato 1', 'Dato 2'],
      ['Dato 3', 'Dato 4'],
    ]);
    // Solo hay UNA tabla en todo el documento -- no dos.
    const allTables = updatedDoc.pages.flatMap((p) => p.elements.filter((el) => el.type === 'table'));
    expect(allTables).toHaveLength(1);
  });

  it('una tabla reubicada SIN linkedGroupId previo no obtiene uno nuevo (no hay dos fragmentos que enlazar)', () => {
    const table = makeTableElement({});
    const doc = makeDoc([makePage(1, [table])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().splitOverflowingTable({
      pageNumber: 1, elementId: 'tabla-1', fittingRowCount: 1, fittingHeightPx: 40, overflowHeightPx: 300,
    });

    const relocated = useEditorStore.getState().doc.pages[1]?.elements.find((el) => el.type === 'table');
    expect(relocated?.linkedGroupId).toBeUndefined();
  });

  it('una tabla reubicada que YA era continuación de un split anterior conserva su linkedGroupId', () => {
    const table = makeTableElement({ linkedGroupId: 'table-link-cadena' });
    const doc = makeDoc([makePage(1, [table])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().splitOverflowingTable({
      pageNumber: 1, elementId: 'tabla-1', fittingRowCount: 1, fittingHeightPx: 40, overflowHeightPx: 300,
    });

    const relocated = useEditorStore.getState().doc.pages[1]?.elements.find((el) => el.type === 'table');
    expect(relocated?.linkedGroupId).toBe('table-link-cadena');
  });

  it('con hasHeader=false, fittingRowCount=1 SÍ parte normalmente (no hay encabezado que deje huérfano)', () => {
    const table = makeTableElement({
      props: {
        rows: [['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']],
        hasHeader: false,
      },
    });
    const doc = makeDoc([makePage(1, [table])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().splitOverflowingTable({
      pageNumber: 1, elementId: 'tabla-1', fittingRowCount: 1, fittingHeightPx: 40, overflowHeightPx: 200,
    });

    const updatedDoc = useEditorStore.getState().doc;
    // Split normal -- la tabla de origen SIGUE en la página 1 con 1 fila real.
    const source = updatedDoc.pages[0].elements.find((el) => el.type === 'table');
    expect(source).toBeTruthy();
    expect(source?.props.rows).toEqual([['A1', 'A2']]);
    const continuation = updatedDoc.pages[1]?.elements.find((el) => el.type === 'table');
    expect(continuation?.props.rows).toEqual([['B1', 'B2'], ['C1', 'C2']]);
  });
});

/**
 * Pedido explícito 2026-09-10 (feedback en vivo): "si yo hago ese espacio
 * como usuario de manera manual... las filas que se fueron abajo vayan
 * cupiendo en el espacio libre nuevo que queda en la otra hoja". Mover a
 * mano el fragmento de una tabla partida debe fusionar el contenido de
 * vuelta (en vez de simplemente arrastrar a la continuación por el mismo
 * delta, que es lo que sigue haciendo el texto) -- el mecanismo de
 * desborde YA existente (`onOverflowRows`/`splitOverflowingTable`) se
 * encarga de volver a partir si, medido en el DOM real, todavía no entra
 * completa.
 */
describe('reflowLinkedTableFragments (vía updateElement) -- mover a mano un fragmento de tabla partida', () => {
  const makeSplitTable = () => {
    const source = makeElement({
      id: 'tabla-1', type: 'table', x: metrics.CONTENT_LEFT, y: 300, width: 300, height: 150,
      linkedGroupId: 'table-link-x',
      props: {
        title: 'Instrumentos', caption: 'Fuente: TDR',
        rows: [
          ['Cabecera 1', 'Cabecera 2'],
          ['Dato 1', 'Dato 2'],
          ['Dato 3', 'Dato 4'],
        ],
        hasHeader: true,
        mergedCells: [{ row: 0, column: 0, rowSpan: 1, colSpan: 2 }],
      },
    });
    const continuation = makeElement({
      id: 'tabla-1-cont', type: 'table', x: metrics.CONTENT_LEFT, y: metrics.CONTENT_TOP, width: 300, height: 120,
      linkedGroupId: 'table-link-x',
      props: {
        title: '', caption: '',
        rows: [
          ['Cabecera 1', 'Cabecera 2'],
          ['Dato 5', 'Dato 6'],
          ['Dato 7', 'Dato 8'],
        ],
        hasHeader: true,
        mergedCells: [{ row: 0, column: 0, rowSpan: 1, colSpan: 2 }],
      },
    });
    return { source, continuation };
  };

  it('mover verticalmente el fragmento de origen fusiona TODAS las filas de la continuación de vuelta y elimina la continuación', () => {
    const { source, continuation } = makeSplitTable();
    const doc = makeDoc([makePage(1, [source]), makePage(2, [continuation])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'tabla-1', { y: 200 });

    const updatedDoc = useEditorStore.getState().doc;
    const merged = updatedDoc.pages[0].elements.find((el) => el.id === 'tabla-1');
    expect(merged?.y).toBe(200);
    expect(merged?.props.rows).toEqual([
      ['Cabecera 1', 'Cabecera 2'],
      ['Dato 1', 'Dato 2'],
      ['Dato 3', 'Dato 4'],
      ['Dato 5', 'Dato 6'],
      ['Dato 7', 'Dato 8'],
    ]);
    const stillOnPage2 = updatedDoc.pages[1]?.elements.some((el) => el.id === 'tabla-1-cont');
    expect(stillOnPage2).toBe(false);
  });

  it('conserva la fusión de la cabecera una sola vez y reindexa las fusiones de la continuación', () => {
    const { source, continuation } = makeSplitTable();
    const doc = makeDoc([makePage(1, [source]), makePage(2, [continuation])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'tabla-1', { y: 200 });

    const merged = useEditorStore.getState().doc.pages[0].elements.find((el) => el.id === 'tabla-1');
    expect(merged?.props.mergedCells).toEqual([{ row: 0, column: 0, rowSpan: 1, colSpan: 2 }]);
  });

  it('mover horizontalmente (sin cambiar Y) NO fusiona -- sigue moviendo el grupo en bloque, como el texto', () => {
    const { source, continuation } = makeSplitTable();
    const doc = makeDoc([makePage(1, [source]), makePage(2, [continuation])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'tabla-1', { x: source.x + 20 });

    const updatedDoc = useEditorStore.getState().doc;
    const stillTwoFragments = updatedDoc.pages[1]?.elements.some((el) => el.id === 'tabla-1-cont');
    expect(stillTwoFragments).toBe(true);
  });

  it('mover la CONTINUACIÓN (no el origen) fusiona igual, tomando título/leyenda del PRIMER fragmento', () => {
    const { source, continuation } = makeSplitTable();
    const doc = makeDoc([makePage(1, [source]), makePage(2, [continuation])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(2, 'tabla-1-cont', { y: metrics.CONTENT_TOP + 10 });

    const updatedDoc = useEditorStore.getState().doc;
    const merged = updatedDoc.pages[1].elements.find((el) => el.id === 'tabla-1-cont');
    expect(merged?.props.title).toBe('Instrumentos');
    expect(merged?.props.rows).toHaveLength(5);
    const sourceGone = updatedDoc.pages[0].elements.some((el) => el.id === 'tabla-1');
    expect(sourceGone).toBe(false);
  });

  it('un elemento de TEXTO con linkedGroupId sigue moviéndose en bloque (no lo toca el reflow de tablas)', () => {
    const fragA = makeElement({ id: 'txt-a', type: 'text', x: 40, y: 800, width: 300, height: 100, linkedGroupId: 'text-link-1' });
    const fragB = makeElement({ id: 'txt-b', type: 'text', x: 40, y: 200, width: 300, height: 150, linkedGroupId: 'text-link-1' });
    const doc = makeDoc([makePage(1, [fragA]), makePage(2, [fragB])]);
    useEditorStore.setState((state) => ({ ...state, doc }));

    useEditorStore.getState().updateElement(1, 'txt-a', { y: 750 });

    const updatedB = useEditorStore.getState().doc.pages[1].elements.find((el) => el.id === 'txt-b');
    expect(updatedB?.y).toBe(150); // se movió en bloque, no se fusionó nada
  });
});
