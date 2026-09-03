import { describe, expect, it } from 'vitest';
import { sensorDashboardLayout, sensorDashboardMinHeight, sensorChartTypes } from './sensorMultiChartLayout';

describe('sensorDashboardLayout', () => {
  it('usa dos filas en un bloque de 600 px porque la leyenda deja una sola columna real', () => {
    expect(sensorDashboardLayout(2, 600)).toEqual({ columns: 1, rows: 2, minHeight: 500 });
  });

  it('mantiene el alto compacto para un unico grafico', () => {
    expect(sensorDashboardLayout(1, 480)).toEqual({ columns: 1, rows: 1, minHeight: 260 });
  });

  it('distribuye cuatro graficos en dos columnas cuando el ancho alcanza', () => {
    expect(sensorDashboardLayout(4, 960)).toEqual({ columns: 2, rows: 2, minHeight: 500 });
  });

  it('soporta informes antiguos con chartType singular', () => {
    expect(sensorChartTypes({ chartType: 'bar' })).toEqual(['bar']);
    expect(sensorDashboardMinHeight({ chartTypes: ['line', 'combo'] }, 600)).toBe(500);
  });
});
