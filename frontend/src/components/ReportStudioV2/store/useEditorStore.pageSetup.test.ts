import { describe, it, expect } from 'vitest';
import { useEditorStore, type ReportDocument, type ReportElement } from './useEditorStore';
import { getReportLayoutMetrics } from '../lib/reportLayoutMetrics';

/**
 * Cubre el reescalado proporcional que `applyPageSetup` aplica a los
 * bloques normales (texto/tabla/imagen/etc.) al cambiar tamaño de hoja,
 * orientación o modo documento/presentación — antes esos bloques
 * conservaban sus coordenadas absolutas en píxeles tal cual, lo que dejaba
 * un informe completo "descuadrado" al exportar a PPTX (el propio botón
 * "PPTX" cambia el informe a modo presentación con un clic). Ver el
 * comentario de `applyPageSetup` en useEditorStore.ts.
 */

const makeTextElement = (overrides: Partial<ReportElement> = {}): ReportElement => ({
  id: 'el-1',
  type: 'text',
  x: 100,
  y: 200,
  width: 300,
  height: 80,
  zIndex: 1,
  locked: false,
  props: {},
  ...overrides,
});

const makeDoc = (element: ReportElement): ReportDocument => ({
  document_id: 'rep_test',
  pages: [
    {
      page_number: 1,
      elements: [element],
    },
  ],
  meta: {
    author: 'Test',
    version: 1,
    updatedAt: new Date().toISOString(),
    layoutMode: 'document',
    paperSize: 'A4',
    orientation: 'portrait',
  },
});

describe('applyPageSetup — reescalado proporcional de bloques', () => {
  it('reescala x/y/width/height de un bloque normal al pasar de documento (A4) a presentación', () => {
    const element = makeTextElement();
    useEditorStore.setState((state) => ({ ...state, doc: makeDoc(element) }));

    const before = getReportLayoutMetrics('document', 'A4', 'portrait');
    const after = getReportLayoutMetrics('presentation');
    const scaleX = after.PAGE_WIDTH / before.PAGE_WIDTH;
    const scaleY = after.PAGE_HEIGHT / before.PAGE_HEIGHT;

    useEditorStore.getState().setLayoutMode('presentation');

    const result = useEditorStore.getState().doc.pages[0].elements[0];
    expect(result.x).toBeCloseTo(element.x * scaleX, 5);
    expect(result.y).toBeCloseTo(element.y * scaleY, 5);
    expect(result.width).toBeCloseTo(element.width * scaleX, 5);
    expect(result.height).toBeCloseTo(element.height * scaleY, 5);
  });

  it('reescala también al cambiar de A4 a A3 dentro de modo documento', () => {
    const element = makeTextElement();
    useEditorStore.setState((state) => ({ ...state, doc: makeDoc(element) }));

    const before = getReportLayoutMetrics('document', 'A4', 'portrait');
    const after = getReportLayoutMetrics('document', 'A3', 'portrait');
    const scaleX = after.PAGE_WIDTH / before.PAGE_WIDTH;
    const scaleY = after.PAGE_HEIGHT / before.PAGE_HEIGHT;

    useEditorStore.getState().setPaperSize('A3');

    const result = useEditorStore.getState().doc.pages[0].elements[0];
    expect(result.x).toBeCloseTo(element.x * scaleX, 5);
    expect(result.width).toBeCloseTo(element.width * scaleX, 5);
  });

  it('no cambia nada cuando el tamaño de página efectivo no cambia', () => {
    const element = makeTextElement();
    useEditorStore.setState((state) => ({ ...state, doc: makeDoc(element) }));

    // paperSize ya es 'A4' — este set no cambia PAGE_WIDTH/PAGE_HEIGHT.
    useEditorStore.getState().setPaperSize('A4');

    const result = useEditorStore.getState().doc.pages[0].elements[0];
    expect(result.x).toBe(element.x);
    expect(result.y).toBe(element.y);
    expect(result.width).toBe(element.width);
    expect(result.height).toBe(element.height);
  });

  it('sigue posicionando header/footer/cover a la geometría fija de la hoja nueva, no proporcional', () => {
    const cover = makeTextElement({ id: 'cover-1', type: 'cover', x: 10, y: 10, width: 50, height: 50 });
    useEditorStore.setState((state) => ({ ...state, doc: makeDoc(cover) }));

    useEditorStore.getState().setLayoutMode('presentation');

    const result = useEditorStore.getState().doc.pages[0].elements[0];
    const after = getReportLayoutMetrics('presentation');
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(after.PAGE_WIDTH);
    expect(result.height).toBe(after.PAGE_HEIGHT);
  });
});
