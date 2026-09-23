import { describe, expect, it } from 'vitest';
import { serializeElementsForClipboard, extractInternalElementsFromHtml, stripLiveBindingForCrossUserPaste, type ClipboardPageGroup } from './elementsClipboard';
import type { ReportElement } from '../store/useEditorStore';

function textEl(overrides: Partial<ReportElement> = {}): ReportElement {
  return {
    id: 't1', type: 'text', x: 10, y: 20, width: 200, height: 40, zIndex: 1, locked: false,
    props: { text: 'Hola mundo', fontSize: 14, fontFamily: 'Inter', fontColor: '#111111' },
    ...overrides,
  };
}

function tableEl(overrides: Partial<ReportElement> = {}): ReportElement {
  return {
    id: 'tb1', type: 'table', x: 0, y: 0, width: 300, height: 100, zIndex: 2, locked: false,
    props: {
      rows: [['Cabecera 1', 'Cabecera 2'], ['Dato 1', 'Dato 2']],
      hasHeader: true,
      mergedCells: [],
      cellBackgrounds: [],
      cellAligns: [],
    },
    ...overrides,
  };
}

function oneGroup(elements: ReportElement[], pageOffset = 0): ClipboardPageGroup[] {
  return [{ pageOffset, elements }];
}

function sensorEl(overrides: Partial<ReportElement> = {}): ReportElement {
  return {
    id: 's1', type: 'sensor', x: 0, y: 0, width: 200, height: 120, zIndex: 1, locked: false,
    props: { title: 'Piezómetro P-04', sensorId: 'p04', tenantId: 'tenant-a' },
    ...overrides,
  };
}

describe('serializeElementsForClipboard', () => {
  it('produce HTML con el marcador interno y markup visual real (texto + tabla)', () => {
    const groups = oneGroup([textEl(), tableEl()]);
    const { html, text } = serializeElementsForClipboard(groups);
    expect(html).toContain('<!--beemetry-elements-v2:');
    expect(html).toContain('Hola mundo');
    expect(html).toMatch(/<table/);
    expect(html).toContain('Cabecera 1');
    expect(html).toContain('Dato 1');
    expect(text).toContain('Hola mundo');
    expect(text).toContain('Cabecera 1\tCabecera 2');
  });

  it('renderiza rowspan/colspan y omite las celdas cubiertas por una fusión', () => {
    const merged = tableEl({
      props: {
        rows: [['Título', ''], ['X', 'Y1'], ['', 'Y2']],
        hasHeader: false,
        mergedCells: [
          { row: 0, column: 0, rowSpan: 1, colSpan: 2 },
          { row: 1, column: 0, rowSpan: 2, colSpan: 1 },
        ],
        cellBackgrounds: [],
        cellAligns: [],
      },
    });
    const { html } = serializeElementsForClipboard(oneGroup([merged]));
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    // La celda (0,1) está cubierta por el colspan de (0,0) -- no debe
    // generarse una <td> aparte para ella.
    const tdCount = (html.match(/<td/g) || []).length;
    // 6 celdas en la grilla, 2 cubiertas (0,1) y (2,0) -> 4 <td> reales.
    expect(tdCount).toBe(4);
  });

  it('deja una nota, nunca un valor inventado, para bloques de datos en vivo (sensor/KPI)', () => {
    const sensor: ReportElement = {
      id: 's1', type: 'sensor', x: 0, y: 0, width: 100, height: 60, zIndex: 1, locked: false,
      props: { title: 'Piezómetro P-1' },
    };
    const { html, text } = serializeElementsForClipboard(oneGroup([sensor]));
    expect(html).toContain('[Piezómetro P-1 -- datos en vivo, no disponibles fuera de Beemetry]');
    expect(text).toBe('[Piezómetro P-1 -- datos en vivo]');
  });

  it('omite encabezado/pie/carátula de la capa visual', () => {
    const header: ReportElement = {
      id: 'h1', type: 'header', x: 0, y: 0, width: 100, height: 20, zIndex: 0, locked: true, props: { text: 'Encabezado' },
    };
    const { html } = serializeElementsForClipboard(oneGroup([header, textEl()]));
    expect(html).not.toContain('Encabezado');
    expect(html).toContain('Hola mundo');
  });

  it('ordena la capa visual por pageOffset -- documento multi-página en orden de lectura', () => {
    const page2Text = textEl({ id: 't2', props: { text: 'Contenido de la página 2' } });
    const groups: ClipboardPageGroup[] = [
      { pageOffset: 1, elements: [page2Text] },
      { pageOffset: 0, elements: [textEl()] }, // fuera de orden a propósito
    ];
    const { text } = serializeElementsForClipboard(groups);
    expect(text.indexOf('Hola mundo')).toBeLessThan(text.indexOf('Contenido de la página 2'));
  });
});

describe('extractInternalElementsFromHtml', () => {
  it('reconstruye exactamente los grupos originales (round-trip)', () => {
    const groups = oneGroup([textEl(), tableEl()]);
    const { html } = serializeElementsForClipboard(groups);
    const roundTripped = extractInternalElementsFromHtml(html);
    expect(roundTripped?.groups).toEqual(groups);
  });

  it('conserva varios grupos de página (documento de varias páginas copiado entero)', () => {
    const groups: ClipboardPageGroup[] = [
      { pageOffset: 0, elements: [textEl()] },
      { pageOffset: 1, elements: [tableEl()] },
    ];
    const { html } = serializeElementsForClipboard(groups);
    const roundTripped = extractInternalElementsFromHtml(html);
    expect(roundTripped?.groups).toEqual(groups);
    expect(roundTripped?.groups.map((g) => g.pageOffset)).toEqual([0, 1]);
  });

  it('devuelve null para HTML externo (Word/Docs/otra fuente) sin el marcador', () => {
    expect(extractInternalElementsFromHtml('<p>Texto pegado desde Word</p>')).toBeNull();
    expect(extractInternalElementsFromHtml('')).toBeNull();
  });

  it('devuelve null si el marcador está corrupto en vez de lanzar una excepción', () => {
    expect(extractInternalElementsFromHtml('<!--beemetry-elements-v2:%%%no-es-base64%%%-->')).toBeNull();
  });

  it('preserva texto con acentos/emoji a través del round-trip (base64 UTF-8 seguro)', () => {
    const groups = oneGroup([textEl({ props: { text: 'Informe técnico — sección § 4.2 ⚠️ ñoño' } })]);
    const { html } = serializeElementsForClipboard(groups);
    const roundTripped = extractInternalElementsFromHtml(html);
    expect(roundTripped?.groups[0]?.elements[0]?.props.text).toBe('Informe técnico — sección § 4.2 ⚠️ ñoño');
  });

  it('incluye ownerUserId en el marcador (null sin sesión activa, como en este entorno de test)', () => {
    const { html } = serializeElementsForClipboard(oneGroup([textEl()]));
    const roundTripped = extractInternalElementsFromHtml(html);
    expect(roundTripped?.ownerUserId).toBeNull();
  });
});

describe('stripLiveBindingForCrossUserPaste', () => {
  it('degrada sensor/kpi/gráfico a un bloque de texto sin binding, preservando posición/tamaño', () => {
    const groups = oneGroup([sensorEl(), textEl()]);
    const [stripped] = stripLiveBindingForCrossUserPaste(groups);
    const [sensor, text] = stripped.elements;
    expect(sensor.type).toBe('text');
    expect(sensor.props.text).toContain('Piezómetro P-04');
    expect(sensor.props.text).toContain('datos en vivo');
    expect(sensor.props).not.toHaveProperty('sensorId');
    expect(sensor.x).toBe(0);
    expect(sensor.y).toBe(0);
    expect(sensor.width).toBe(200);
    expect(sensor.height).toBe(120);
    // Un bloque de texto normal (sin datos en vivo) no se toca.
    expect(text.type).toBe('text');
    expect(text.props.text).toBe('Hola mundo');
  });
});
