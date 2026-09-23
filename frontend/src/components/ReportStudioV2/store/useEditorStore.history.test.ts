import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore, type ReportDocument, type ReportElement, type ReportPage } from './useEditorStore';

/**
 * Cubre el historial de Undo/Redo -- bug real reportado 2026-09-10 ("no se
 * si es al agregar una tabla y hacer ediciones"): dos causas raíz distintas
 * hacían que Ctrl+Z/Y se sintieran rotos.
 *
 * 1. `useEditorStore.subscribe` empujaba una entrada de historial por CADA
 *    `set()` del store, sin agrupar -- editar una celda de tabla confirma
 *    al store en cada pulsación (`TableBlock.tsx::persistCell`, sin el
 *    debounce local que sí tiene el editor de texto de bloques), así que
 *    escribir una palabra ahí generaba una letra = un paso de Undo, y con
 *    HISTORY_LIMIT=100 unas pocas frases ya empujaban fuera del historial
 *    cualquier acción real anterior. Este archivo cubre la agrupación por
 *    ventana de tiempo que lo resuelve (ver HISTORY_COALESCE_WINDOW_MS).
 * 2. `createNewDocument`/`loadDocument` nunca vaciaban el historial al
 *    REEMPLAZAR el documento entero -- Ctrl+Z después de abrir otro informe
 *    podía saltar de vuelta al contenido del informe anterior.
 *
 * (El otro bug de este mismo reporte -- el atajo de teclado bloqueado por
 * completo mientras el foco estaba en el textarea/celda que se acababa de
 * editar -- vive en App.tsx::handleGlobalHistoryShortcut y no es testeable
 * aquí sin DOM real; se verificó en vivo en el navegador.)
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

const makeDoc = (text: string): ReportDocument => ({
  document_id: 'rep_test',
  pages: [makePage(1, [makeElement({ id: 'el1', props: { text } })])],
  meta: {
    author: 'Test', version: 1, updatedAt: new Date().toISOString(),
    layoutMode: 'document', paperSize: 'A4', orientation: 'portrait',
  },
});

const currentText = () =>
  useEditorStore.getState().doc.pages[0].elements.find((el) => el.id === 'el1')?.props?.text as string | undefined;

const setText = (text: string) => useEditorStore.getState().updateElement(1, 'el1', { props: { text } });

describe('Historial de Undo/Redo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Documento base + margen amplio para que el push de este setState (que
    // también cuenta como "cambio de doc") quede bien afuera de la ventana
    // de agrupación antes de que empiece cada prueba.
    useEditorStore.setState((state) => ({ ...state, doc: makeDoc('A') }));
    vi.advanceTimersByTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('varios cambios seguidos (dentro de la ventana de agrupación) se deshacen en UN solo Undo', () => {
    setText('AB');
    vi.advanceTimersByTime(100);
    setText('ABC');
    vi.advanceTimersByTime(100);
    setText('ABCD');

    expect(currentText()).toBe('ABCD');
    useEditorStore.getState().undo();
    // Un solo Undo vuelve al estado ANTERIOR a toda la racha, no solo al
    // penúltimo cambio -- si cada tecla generara su propia entrada, este
    // Undo dejaría 'ABC' en vez de 'A'.
    expect(currentText()).toBe('A');
  });

  it('una pausa mayor a la ventana de agrupación abre una entrada nueva', () => {
    setText('AB');
    vi.advanceTimersByTime(1000); // > HISTORY_COALESCE_WINDOW_MS: cierra la racha
    setText('ABC');

    expect(currentText()).toBe('ABC');
    useEditorStore.getState().undo();
    expect(currentText()).toBe('AB'); // solo deshace la segunda racha
    useEditorStore.getState().undo();
    expect(currentText()).toBe('A'); // la primera racha es un paso aparte
  });

  it('Redo despues de Undo restaura exactamente el ultimo estado de la racha', () => {
    setText('AB');
    vi.advanceTimersByTime(100);
    setText('ABC');
    useEditorStore.getState().undo();
    expect(currentText()).toBe('A');
    useEditorStore.getState().redo();
    expect(currentText()).toBe('ABC');
  });

  it('editar justo despues de un Undo no se agrupa con lo ya deshecho (queda su propio paso)', () => {
    setText('AB');
    useEditorStore.getState().undo();
    expect(currentText()).toBe('A');

    // Sin avanzar el reloj -- simula escribir de inmediato tras el Undo.
    setText('X');
    expect(currentText()).toBe('X');

    useEditorStore.getState().undo();
    // Si 'X' se hubiera agrupado silenciosamente con la racha ya deshecha
    // (en vez de abrir su propia entrada), este Undo saltaría directo a
    // un estado incorrecto o no habría nada que deshacer.
    expect(currentText()).toBe('A');
    useEditorStore.getState().redo();
    expect(currentText()).toBe('X');
  });

  it('una modificacion nueva despues de Undo invalida el Redo pendiente', () => {
    setText('AB');
    vi.advanceTimersByTime(1000);
    setText('ABC');
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().canRedo()).toBe(true);

    vi.advanceTimersByTime(1000);
    setText('ZZZ');
    expect(useEditorStore.getState().canRedo()).toBe(false);
  });

  it('createNewDocument() vacia el historial -- Undo no puede saltar al informe anterior', () => {
    setText('AB');
    expect(useEditorStore.getState().canUndo()).toBe(true);

    useEditorStore.getState().createNewDocument('Autor Test');

    expect(useEditorStore.getState().canUndo()).toBe(false);
    expect(useEditorStore.getState().canRedo()).toBe(false);
  });

  it('loadDocument() vacia el historial -- Undo no puede saltar al informe anterior', () => {
    setText('AB');
    expect(useEditorStore.getState().canUndo()).toBe(true);

    useEditorStore.getState().loadDocument(makeDoc('otro informe'), 'rep_other', 'Otro informe');

    expect(useEditorStore.getState().canUndo()).toBe(false);
    expect(useEditorStore.getState().canRedo()).toBe(false);
  });
});
