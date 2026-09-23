import { describe, expect, it } from 'vitest';
import { buildThreeTierRules, computeConditionalStyles, THREE_TIER_TEMPLATES, type ColorScaleFormat, type ConditionalFormatRule } from './tableConditionalFormat';
import type { EffectiveCellValue } from './tableFormulas';

function grid(values: (number | null)[][]): EffectiveCellValue[][] {
  return values.map((row) => row.map((v) => ({ numeric: v, text: v === null ? '' : String(v) })));
}

describe('computeConditionalStyles', () => {
  it('sin reglas, ninguna celda tiene estilo', () => {
    const results = computeConditionalStyles(grid([[10, 20]]), [], false);
    expect(results).toEqual([[null, null]]);
  });

  it('greaterThan pinta solo las celdas que cumplen', () => {
    const rules: ConditionalFormatRule[] = [{ id: '1', condition: 'greaterThan', value: '15', backgroundColor: '#ff0000' }];
    const results = computeConditionalStyles(grid([[10, 20]]), rules, false);
    expect(results[0][0]).toBeNull();
    expect(results[0][1]).toEqual({ backgroundColor: '#ff0000', textColor: undefined });
  });

  it('between usa el umbral menor/mayor sin importar el orden', () => {
    const rules: ConditionalFormatRule[] = [{ id: '1', condition: 'between', value: '20', value2: '10', backgroundColor: '#0f0' }];
    const results = computeConditionalStyles(grid([[5, 15, 25]]), rules, false);
    expect(results[0][0]).toBeNull();
    expect(results[0][1]?.backgroundColor).toBe('#0f0');
    expect(results[0][2]).toBeNull();
  });

  it('textContains no distingue mayúsculas', () => {
    const values: EffectiveCellValue[][] = [[{ numeric: null, text: 'Estado CRÍTICO' }, { numeric: null, text: 'Estado normal' }]];
    const rules: ConditionalFormatRule[] = [{ id: '1', condition: 'textContains', value: 'crítico', textColor: '#dc2626' }];
    const results = computeConditionalStyles(values, rules, false);
    expect(results[0][0]?.textColor).toBe('#dc2626');
    expect(results[0][1]).toBeNull();
  });

  it('excluye la fila de encabezado cuando hasHeader es true', () => {
    const rules: ConditionalFormatRule[] = [{ id: '1', condition: 'greaterThan', value: '0', backgroundColor: '#f00' }];
    const results = computeConditionalStyles(grid([[5], [5]]), rules, true);
    expect(results[0][0]).toBeNull(); // encabezado, excluido
    expect(results[1][0]?.backgroundColor).toBe('#f00');
  });

  it('una regla posterior pisa la propiedad que choque de una anterior', () => {
    const rules: ConditionalFormatRule[] = [
      { id: '1', condition: 'greaterThan', value: '0', backgroundColor: '#f00', textColor: '#fff' },
      { id: '2', condition: 'greaterThan', value: '5', backgroundColor: '#00f' },
    ];
    const results = computeConditionalStyles(grid([[10]]), rules, false);
    expect(results[0][0]).toEqual({ backgroundColor: '#00f', textColor: '#fff' });
  });

  it('condición numérica no aplica sobre texto/celda vacía', () => {
    const values: EffectiveCellValue[][] = [[{ numeric: null, text: 'texto' }]];
    const rules: ConditionalFormatRule[] = [{ id: '1', condition: 'greaterThan', value: '0', backgroundColor: '#f00' }];
    expect(computeConditionalStyles(values, rules, false)[0][0]).toBeNull();
  });
});

describe('buildThreeTierRules', () => {
  const template = THREE_TIER_TEMPLATES[0];

  it('arma 3 reglas: menor que mínimo, entre, mayor o igual que máximo', () => {
    const rules = buildThreeTierRules(template, 10, 20);
    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatchObject({ condition: 'lessThan', value: '10', backgroundColor: template.low.backgroundColor });
    expect(rules[1]).toMatchObject({ condition: 'between', value: '10', value2: '20', backgroundColor: template.mid.backgroundColor });
    expect(rules[2]).toMatchObject({ condition: 'greaterOrEqual', value: '20', backgroundColor: template.high.backgroundColor });
  });

  it('el valor exacto en el umbral máximo cae en la franja alta, no la media', () => {
    const rules = buildThreeTierRules(template, 10, 20);
    const values: EffectiveCellValue[][] = [[{ numeric: 20, text: '20' }]];
    const styles = computeConditionalStyles(values, rules, false);
    expect(styles[0][0]?.backgroundColor).toBe(template.high.backgroundColor);
  });

  it('el valor exacto en el umbral mínimo cae en la franja media, no la baja', () => {
    const rules = buildThreeTierRules(template, 10, 20);
    const values: EffectiveCellValue[][] = [[{ numeric: 10, text: '10' }]];
    const styles = computeConditionalStyles(values, rules, false);
    expect(styles[0][0]?.backgroundColor).toBe(template.mid.backgroundColor);
  });
});

describe('computeConditionalStyles con escalas de color', () => {
  it('escala de 2 puntos interpola el color a mitad de camino', () => {
    const scales: ColorScaleFormat[] = [
      { id: 's1', stops: [{ value: '0', backgroundColor: '#000000' }, { value: '100', backgroundColor: '#ffffff' }] },
    ];
    const styles = computeConditionalStyles(grid([[0, 50, 100]]), [], false, scales);
    expect(styles[0][0]?.backgroundColor).toBe('#000000');
    expect(styles[0][1]?.backgroundColor).toBe('#808080');
    expect(styles[0][2]?.backgroundColor).toBe('#ffffff');
  });

  it('escala de 3 puntos interpola por segmento (mín-medio y medio-máx)', () => {
    const scales: ColorScaleFormat[] = [
      {
        id: 's1',
        stops: [
          { value: '0', backgroundColor: '#ff0000' },
          { value: '50', backgroundColor: '#00ff00' },
          { value: '100', backgroundColor: '#0000ff' },
        ],
      },
    ];
    const styles = computeConditionalStyles(grid([[0, 50, 100, 25]]), [], false, scales);
    expect(styles[0][0]?.backgroundColor).toBe('#ff0000');
    expect(styles[0][1]?.backgroundColor).toBe('#00ff00');
    expect(styles[0][2]?.backgroundColor).toBe('#0000ff');
    expect(styles[0][3]?.backgroundColor).toBe('#808000'); // a mitad entre rojo y verde (255*0.5 redondea a 128)
  });

  it('valores fuera de rango quedan fijos al color del extremo (clamp)', () => {
    const scales: ColorScaleFormat[] = [
      { id: 's1', stops: [{ value: '10', backgroundColor: '#000000' }, { value: '20', backgroundColor: '#ffffff' }] },
    ];
    const styles = computeConditionalStyles(grid([[5, 25]]), [], false, scales);
    expect(styles[0][0]?.backgroundColor).toBe('#000000');
    expect(styles[0][1]?.backgroundColor).toBe('#ffffff');
  });

  it('interpola también el color de texto cuando los stops lo traen', () => {
    const scales: ColorScaleFormat[] = [
      {
        id: 's1',
        stops: [
          { value: '0', backgroundColor: '#000000', textColor: '#000000' },
          { value: '100', backgroundColor: '#ffffff', textColor: '#ffffff' },
        ],
      },
    ];
    const styles = computeConditionalStyles(grid([[0, 50, 100]]), [], false, scales);
    expect(styles[0][0]?.textColor).toBe('#000000');
    expect(styles[0][1]?.textColor).toBe('#808080');
    expect(styles[0][2]?.textColor).toBe('#ffffff');
  });

  it('un stop sin textColor no rompe la interpolación de fondo ni fuerza texto', () => {
    const scales: ColorScaleFormat[] = [
      { id: 's1', stops: [{ value: '0', backgroundColor: '#000000' }, { value: '100', backgroundColor: '#ffffff', textColor: '#ffffff' }] },
    ];
    const styles = computeConditionalStyles(grid([[50]]), [], false, scales);
    expect(styles[0][0]?.backgroundColor).toBe('#808080');
    expect(styles[0][0]?.textColor).toBe('#ffffff'); // solo un extremo tiene textColor -- se usa ese, sin interpolar
  });

  it('una regla de umbral pisa el color de la escala si ambas matchean la misma celda', () => {
    const scales: ColorScaleFormat[] = [
      { id: 's1', stops: [{ value: '0', backgroundColor: '#000000' }, { value: '100', backgroundColor: '#ffffff' }] },
    ];
    const rules: ConditionalFormatRule[] = [{ id: 'r1', condition: 'equal', value: '50', backgroundColor: '#ff00ff' }];
    const styles = computeConditionalStyles(grid([[50]]), rules, false, scales);
    expect(styles[0][0]?.backgroundColor).toBe('#ff00ff');
  });

  it('sin escalas ni reglas, ninguna celda tiene estilo (compatibilidad hacia atrás)', () => {
    expect(computeConditionalStyles(grid([[1, 2]]), undefined, false, undefined)).toEqual([[null, null]]);
  });
});

describe('computeConditionalStyles con scope (celda/fila/columna)', () => {
  it('scope undefined sigue aplicando a toda la tabla (compatibilidad hacia atrás)', () => {
    const rules: ConditionalFormatRule[] = [{ id: 'r1', condition: 'greaterThan', value: '0', backgroundColor: '#f00' }];
    const styles = computeConditionalStyles(grid([[1, 2], [3, 4]]), rules, false);
    expect(styles[0][0]?.backgroundColor).toBe('#f00');
    expect(styles[0][1]?.backgroundColor).toBe('#f00');
    expect(styles[1][0]?.backgroundColor).toBe('#f00');
    expect(styles[1][1]?.backgroundColor).toBe('#f00');
  });

  it("scope { type: 'cells' } solo pinta esas celdas puntuales", () => {
    const rules: ConditionalFormatRule[] = [{
      id: 'r1', condition: 'greaterThan', value: '0', backgroundColor: '#f00',
      scope: { type: 'cells', cells: [{ row: 0, column: 1 }, { row: 1, column: 0 }] },
    }];
    const styles = computeConditionalStyles(grid([[1, 2], [3, 4]]), rules, false);
    expect(styles[0][0]).toBeNull();
    expect(styles[0][1]?.backgroundColor).toBe('#f00');
    expect(styles[1][0]?.backgroundColor).toBe('#f00');
    expect(styles[1][1]).toBeNull();
  });

  it("scope { type: 'row' } pinta toda esa fila, sin importar la columna", () => {
    const rules: ConditionalFormatRule[] = [{
      id: 'r1', condition: 'greaterThan', value: '0', backgroundColor: '#f00',
      scope: { type: 'row', row: 1 },
    }];
    const styles = computeConditionalStyles(grid([[1, 2], [3, 4], [5, 6]]), rules, false);
    expect(styles[0][0]).toBeNull();
    expect(styles[0][1]).toBeNull();
    expect(styles[1][0]?.backgroundColor).toBe('#f00');
    expect(styles[1][1]?.backgroundColor).toBe('#f00');
    expect(styles[2][0]).toBeNull();
  });

  it("scope { type: 'column' } pinta toda esa columna, sin importar la fila", () => {
    const rules: ConditionalFormatRule[] = [{
      id: 'r1', condition: 'greaterThan', value: '0', backgroundColor: '#f00',
      scope: { type: 'column', column: 0 },
    }];
    const styles = computeConditionalStyles(grid([[1, 2], [3, 4], [5, 6]]), rules, false);
    expect(styles[0][0]?.backgroundColor).toBe('#f00');
    expect(styles[0][1]).toBeNull();
    expect(styles[1][0]?.backgroundColor).toBe('#f00');
    expect(styles[2][0]?.backgroundColor).toBe('#f00');
  });

  it('el scope también acota las escalas de color, no solo las reglas de umbral', () => {
    const scales: ColorScaleFormat[] = [{
      id: 's1',
      stops: [{ value: '0', backgroundColor: '#000000' }, { value: '100', backgroundColor: '#ffffff' }],
      scope: { type: 'column', column: 1 },
    }];
    const styles = computeConditionalStyles(grid([[50, 50]]), [], false, scales);
    expect(styles[0][0]).toBeNull(); // columna 0 fuera del scope
    expect(styles[0][1]?.backgroundColor).toBe('#808080'); // columna 1 sí
  });

  it('dos reglas con distinto scope conviven sin pisarse entre celdas que no comparten', () => {
    const rules: ConditionalFormatRule[] = [
      { id: 'r1', condition: 'greaterThan', value: '0', backgroundColor: '#f00', scope: { type: 'row', row: 0 } },
      { id: 'r2', condition: 'greaterThan', value: '0', backgroundColor: '#00f', scope: { type: 'row', row: 1 } },
    ];
    const styles = computeConditionalStyles(grid([[1], [2]]), rules, false);
    expect(styles[0][0]?.backgroundColor).toBe('#f00');
    expect(styles[1][0]?.backgroundColor).toBe('#00f');
  });
});
