import { describe, expect, it } from 'vitest';
import { computeTableFormulas, evaluateFormula, isFormulaText, parseCellRef } from './tableFormulas';

describe('isFormulaText', () => {
  it('reconoce una fórmula', () => {
    expect(isFormulaText('=SUMA(A1:A3)')).toBe(true);
    expect(isFormulaText('  =A1+1')).toBe(true);
  });
  it('rechaza texto normal', () => {
    expect(isFormulaText('42')).toBe(false);
    expect(isFormulaText('')).toBe(false);
  });
});

describe('parseCellRef', () => {
  it('convierte letras de columna a índice 0-based', () => {
    expect(parseCellRef('A1')).toEqual({ row: 0, col: 0 });
    expect(parseCellRef('C10')).toEqual({ row: 9, col: 2 });
    expect(parseCellRef('AA1')).toEqual({ row: 0, col: 26 });
  });
  it('devuelve null si no es una referencia válida', () => {
    expect(parseCellRef('1A')).toBeNull();
    expect(parseCellRef('A')).toBeNull();
  });
});

describe('evaluateFormula', () => {
  const resolve = (row: number, col: number): number | null => {
    const grid: Record<string, number | null> = {
      '0-0': 10, '1-0': 20, '2-0': 30, '3-0': null, // A1=10 A2=20 A3=30 A4=texto
    };
    return grid[`${row}-${col}`] ?? null;
  };

  it('suma un rango con SUMA/SUM', () => {
    expect(evaluateFormula('=SUMA(A1:A3)', resolve)).toMatchObject({ numericValue: 60, isError: false });
    expect(evaluateFormula('=SUM(A1:A3)', resolve)).toMatchObject({ numericValue: 60, isError: false });
  });

  it('promedia ignorando celdas no numéricas', () => {
    expect(evaluateFormula('=PROMEDIO(A1:A4)', resolve)).toMatchObject({ numericValue: 20, isError: false });
  });

  it('cuenta solo celdas numéricas', () => {
    expect(evaluateFormula('=CONTAR(A1:A4)', resolve)).toMatchObject({ numericValue: 3 });
  });

  it('resuelve aritmética con referencias y precedencia', () => {
    expect(evaluateFormula('=A1+A2*2', resolve)).toMatchObject({ numericValue: 50 });
    expect(evaluateFormula('=(A1+A2)*2', resolve)).toMatchObject({ numericValue: 60 });
  });

  it('resuelve exponente asociativo a la derecha', () => {
    expect(evaluateFormula('=2^3^2', resolve)).toMatchObject({ numericValue: 512 });
  });

  it('MAX y MIN de un rango', () => {
    expect(evaluateFormula('=MAX(A1:A3)', resolve)).toMatchObject({ numericValue: 30 });
    expect(evaluateFormula('=MIN(A1:A3)', resolve)).toMatchObject({ numericValue: 10 });
  });

  it('ABS y REDONDEAR/ROUND', () => {
    expect(evaluateFormula('=ABS(-5)', resolve)).toMatchObject({ numericValue: 5 });
    expect(evaluateFormula('=REDONDEAR(3.14159, 2)', resolve)).toMatchObject({ numericValue: 3.14 });
  });

  it('división por cero da #DIV/0!', () => {
    expect(evaluateFormula('=A1/0', resolve)).toMatchObject({ display: '#DIV/0!', isError: true });
  });

  it('referenciar directamente una celda no numérica da #VALUE!', () => {
    expect(evaluateFormula('=A4+1', resolve)).toMatchObject({ display: '#VALUE!', isError: true });
  });

  it('sintaxis inválida da #ERROR!', () => {
    expect(evaluateFormula('=A1+*2', resolve)).toMatchObject({ isError: true });
    expect(evaluateFormula('=SUMA(A1:A3', resolve)).toMatchObject({ isError: true });
  });

  it('función desconocida da #NAME?', () => {
    expect(evaluateFormula('=NOEXISTE(A1)', resolve)).toMatchObject({ display: '#NAME?' });
  });
});

describe('computeTableFormulas', () => {
  it('calcula una fórmula simple sobre datos planos', () => {
    const rows = [['10', '20'], ['30', '=SUMA(A1:A2)']];
    const results = computeTableFormulas(rows);
    expect(results[1][1]).toMatchObject({ display: '40', numericValue: 40, isError: false });
    expect(results[0][0]).toBeNull(); // celda normal, no es fórmula
  });

  it('encadena fórmulas que dependen de otras fórmulas', () => {
    const rows = [['5'], ['=A1*2'], ['=A2+1']];
    const results = computeTableFormulas(rows);
    expect(results[1][0]).toMatchObject({ numericValue: 10 });
    expect(results[2][0]).toMatchObject({ numericValue: 11 });
  });

  it('detecta referencia circular directa', () => {
    const rows = [['=A1+1']];
    const results = computeTableFormulas(rows);
    expect(results[0][0]).toMatchObject({ display: '#CIRC!', isError: true });
  });

  it('detecta referencia circular indirecta (A1 -> A2 -> A1)', () => {
    const rows = [['=A2+1'], ['=A1+1']];
    const results = computeTableFormulas(rows);
    expect(results[0][0]?.isError).toBe(true);
    expect(results[1][0]?.isError).toBe(true);
  });

  it('ignora HTML enriquecido al leer números de otras celdas', () => {
    const rows = [['<b>10</b>'], ['<span style="color:red">20</span>'], ['=SUMA(A1:A2)']];
    const results = computeTableFormulas(rows);
    expect(results[2][0]).toMatchObject({ numericValue: 30 });
  });

  it('referenciar directamente una celda vacía/fuera de rango da error (a diferencia de Excel, que la trata como 0) -- limitación conocida y documentada', () => {
    const rows = [['=Z99+1']];
    const results = computeTableFormulas(rows);
    expect(results[0][0]?.isError).toBe(true);
  });
});
