import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, type ReportDocument, type ReportElement, type ReportPage } from './useEditorStore';

/**
 * Cubre el portapapeles múltiple/multi-página (`selectAllDocument`,
 * `copySelection`, `pasteSelection`) -- pedido explícito 2026-09-09: Ctrl+A
 * debe seleccionar el documento COMPLETO (todas las páginas), y
 * Ctrl+C/Ctrl+V debe poder reconstruir esa misma cantidad de páginas al
 * pegar (p.ej. duplicar un informe entero pegándolo en uno nuevo). No se
 * puede verificar el atajo de teclado real en un navegador headless (el
 * evento `paste` nativo depende de permisos de portapapeles del sistema que
 * el entorno de pruebas deniega) -- esto prueba la lógica del store
 * directamente, sin pasar por el DOM.
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

function setupTwoPageDoc() {
  const table = makeElement({ id: 'table-1', type: 'table', x: 10, y: 20, width: 300, height: 100, props: { rows: [['A', 'B']] } });
  const text = makeElement({ id: 'text-2', type: 'text', x: 5, y: 15, width: 200, height: 40, props: { text: 'Página 2' } });
  const doc = makeDoc([makePage(1, [table]), makePage(2, [text])]);
  useEditorStore.setState((state) => ({
    ...state, doc, selectedPage: 1, selectedElementIds: [], selectedElementId: undefined, clipboardElements: null,
  }));
  return { table, text };
}

describe('selectAllDocument', () => {
  it('selecciona el contenido de TODAS las páginas, sin encabezado/pie', () => {
    setupTwoPageDoc();
    useEditorStore.getState().selectAllDocument();
    const { selectedElementIds } = useEditorStore.getState();
    expect(new Set(selectedElementIds)).toEqual(new Set(['table-1', 'text-2']));
  });

  it('no cambia la página que el usuario está viendo', () => {
    setupTwoPageDoc();
    useEditorStore.setState((s) => ({ ...s, selectedPage: 1 }));
    useEditorStore.getState().selectAllDocument();
    expect(useEditorStore.getState().selectedPage).toBe(1);
  });
});

describe('copySelection', () => {
  it('agrupa los elementos copiados por su página de origen, normalizada a partir de 0', () => {
    setupTwoPageDoc();
    useEditorStore.getState().copySelection(['table-1', 'text-2']);
    const groups = useEditorStore.getState().clipboardElements;
    expect(groups).toHaveLength(2);
    expect(groups?.find((g) => g.pageOffset === 0)?.elements.map((e) => e.id)).toEqual(['table-1']);
    expect(groups?.find((g) => g.pageOffset === 1)?.elements.map((e) => e.id)).toEqual(['text-2']);
  });

  it('nunca copia encabezado/pie/carátula aunque su id venga incluido', () => {
    setupTwoPageDoc();
    useEditorStore.getState().copySelection(['table-1', 'header-1', 'footer-1']);
    const groups = useEditorStore.getState().clipboardElements;
    const allIds = groups?.flatMap((g) => g.elements.map((e) => e.id)) ?? [];
    expect(allIds).toEqual(['table-1']);
  });

  it('no toca el portapapeles si ningún id copiado existe', () => {
    setupTwoPageDoc();
    useEditorStore.getState().copySelection(['table-1']);
    const before = useEditorStore.getState().clipboardElements;
    useEditorStore.getState().copySelection(['id-inexistente']);
    expect(useEditorStore.getState().clipboardElements).toBe(before);
  });
});

describe('pasteSelection', () => {
  beforeEach(() => {
    setupTwoPageDoc();
  });

  it('el grupo de offset 0 se agrega a la página destino, y cada offset mayor crea una página NUEVA al final', () => {
    useEditorStore.getState().copySelection(['table-1', 'text-2']);
    const newIds = useEditorStore.getState().pasteSelection(1);

    const doc = useEditorStore.getState().doc;
    expect(doc.pages).toHaveLength(3); // 2 originales + 1 nueva para el offset 1
    expect(newIds).toHaveLength(2);

    // Página 1: la tabla original sigue ahí, MÁS un clon nuevo pegado (2 en total).
    const page1Types = doc.pages[0].elements.map((e) => e.type);
    expect(page1Types.filter((t) => t === 'table')).toHaveLength(2);
    expect(doc.pages[0].elements.some((e) => e.id === 'table-1')).toBe(true);
    expect(doc.pages[0].elements.some((e) => newIds.includes(e.id))).toBe(true);

    // Página 3 (nueva): trae el clon del texto de la página 2 original,
    // más su propio encabezado/pie automático (createHeaderFooterPair).
    const page3 = doc.pages[2];
    expect(page3.page_number).toBe(3);
    expect(page3.elements.some((e) => e.type === 'header')).toBe(true);
    expect(page3.elements.some((e) => e.type === 'footer')).toBe(true);
    const pastedTextClone = page3.elements.find((e) => e.type === 'text' && e.props.text === 'Página 2');
    expect(pastedTextClone).toBeDefined();
    expect(pastedTextClone?.id).not.toBe('text-2'); // clon con id propio, no el original
  });

  it('nunca reutiliza/sobrescribe una página existente ajena aunque su número coincida por aritmética', () => {
    // El documento ya tiene una página 3 con SU PROPIO contenido, antes de pegar.
    const ownPage3Element = makeElement({ id: 'own-page-3-el', type: 'text', props: { text: 'Ya estaba acá' } });
    useEditorStore.setState((state) => ({
      ...state,
      doc: { ...state.doc, pages: [...state.doc.pages, makePage(3, [ownPage3Element])] },
    }));

    useEditorStore.getState().copySelection(['table-1', 'text-2']); // offsets 0 y 1
    useEditorStore.getState().pasteSelection(1);

    const doc = useEditorStore.getState().doc;
    // Se agregó una página NUEVA (la 4ta) para el offset 1 -- la página 3
    // preexistente no se tocó.
    expect(doc.pages).toHaveLength(4);
    const originalPage3 = doc.pages.find((p) => p.page_number === 3);
    expect(originalPage3?.elements.some((e) => e.id === 'own-page-3-el')).toBe(true);
    expect(originalPage3?.elements.some((e) => e.type === 'text' && e.props.text === 'Página 2')).toBe(false);
  });

  it('conserva la disposición relativa entre elementos de un mismo grupo al pegar', () => {
    const a = makeElement({ id: 'a', type: 'text', x: 10, y: 10, width: 50, height: 20, props: {} });
    const b = makeElement({ id: 'b', type: 'text', x: 60, y: 10, width: 50, height: 20, props: {} }); // 50px a la derecha de 'a'
    useEditorStore.setState((state) => ({
      ...state, doc: makeDoc([makePage(1, [a, b])]), clipboardElements: null, selectedElementIds: [],
    }));
    useEditorStore.getState().copySelection(['a', 'b']);
    const newIds = useEditorStore.getState().pasteSelection(1);
    const pastedEls = useEditorStore.getState().doc.pages[0].elements.filter((e) => newIds.includes(e.id));
    const sorted = [...pastedEls].sort((x, y) => x.x - y.x);
    expect(sorted[1].x - sorted[0].x).toBe(50); // misma distancia relativa que el original (60-10)
  });

  it('devuelve un array vacío si no hay nada que pegar', () => {
    useEditorStore.setState((s) => ({ ...s, clipboardElements: null }));
    expect(useEditorStore.getState().pasteSelection(1)).toEqual([]);
  });
});
