import { describe, expect, it } from 'vitest';
import { bumpDecimals, formatNumberForDisplay, parseNumberFormat, togglePercentFormat } from './tableNumberFormat';

describe('parseNumberFormat', () => {
  it('formato ausente o inválido es general', () => {
    expect(parseNumberFormat(null)).toEqual({ kind: 'general', decimals: 0 });
    expect(parseNumberFormat('cualquier-cosa')).toEqual({ kind: 'general', decimals: 0 });
  });
  it('parsea percent/decimal con sus decimales', () => {
    expect(parseNumberFormat('percent:2')).toEqual({ kind: 'percent', decimals: 2 });
    expect(parseNumberFormat('decimal:0')).toEqual({ kind: 'decimal', decimals: 0 });
  });
});

describe('formatNumberForDisplay', () => {
  it('general: entero tal cual, decimal redondeado suave', () => {
    expect(formatNumberForDisplay(42, null)).toBe('42');
    expect(formatNumberForDisplay(0.1 + 0.2, null)).toBe('0.3');
  });
  it('percent multiplica por 100 y agrega %', () => {
    expect(formatNumberForDisplay(0.256, 'percent:1')).toBe('25.6%');
    expect(formatNumberForDisplay(1, 'percent:0')).toBe('100%');
  });
  it('decimal fija la cantidad de decimales', () => {
    expect(formatNumberForDisplay(3, 'decimal:2')).toBe('3.00');
    expect(formatNumberForDisplay(3.14159, 'decimal:2')).toBe('3.14');
  });
  it('valor no finito da #ERROR!', () => {
    expect(formatNumberForDisplay(NaN, null)).toBe('#ERROR!');
  });
});

describe('togglePercentFormat', () => {
  it('de general a percent con 0 decimales', () => {
    expect(togglePercentFormat(null)).toBe('percent:0');
  });
  it('de percent de vuelta a decimal, conservando decimales', () => {
    expect(togglePercentFormat('percent:2')).toBe('decimal:2');
  });
});

describe('bumpDecimals', () => {
  it('sobre general arranca en modo decimal', () => {
    expect(bumpDecimals(null, 1)).toBe('decimal:1');
  });
  it('no baja de 0 decimales', () => {
    expect(bumpDecimals('decimal:0', -1)).toBe('decimal:0');
  });
  it('conserva el tipo percent al subir/bajar decimales', () => {
    expect(bumpDecimals('percent:1', 1)).toBe('percent:2');
  });
});
