import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import type { SensorSelection } from '../../layout/ZoneSensorPicker';

/**
 * SPEC-021 T9 (2026-09-13): regresión para un bug real encontrado al
 * verificar el export de los 20 tipos de gráfico contra el stack real —
 * ver ADR de cierre de T9. `chartType === 'histogram'` formateaba los
 * bordes de cada bucket con `.toFixed(1)` fijo; para sensores de magnitud
 * pequeña (acelerógrafos en "g", ~0.010-0.030) las 10 etiquetas del eje X
 * colapsaban todas al mismo texto "0.0–0.0" -- confirmado en el visor real
 * (PDF exportado de 378 páginas, página 10) antes del fix. Los smoke tests
 * de SPEC-021 T8 (`SensorMultiChartWidget.smoke.test.tsx`) no lo detectaban
 * porque solo prueban que el montaje no lance una excepción, nunca el
 * contenido de las etiquetas, y sus sensores de prueba (TEMP-01/PRES-02)
 * tienen magnitud grande, donde `.toFixed(1)` no colapsa nada.
 */

const capturedOptions: Record<string, unknown>[] = [];

vi.mock('echarts-for-react', () => ({
  default: React.forwardRef((props: any, ref: any) => {
    capturedOptions.push(props.option);
    React.useImperativeHandle(ref, () => ({ getEchartsInstance: () => null }));
    return <div data-testid="mock-echarts" />;
  }),
}));

vi.mock('../../../lib/api', () => ({
  fetchTelemetryWizardSeries: vi.fn().mockRejectedValue(new Error('sin backend en test')),
}));

vi.mock('../../../lib/sensorMockData', () => ({
  generateMockSensorSeries: vi.fn(() => {
    // Reproduce el caso real: 40 lecturas en [0.010, 0.029] g, el mismo
    // orden de magnitud que los sensores ACEL-01/ACEL-03 del informe real
    // donde se encontró el bug.
    const rows: { sensor_id: string; t: string; v: number }[] = [];
    for (let i = 0; i < 40; i += 1) {
      const v = 0.01 + (i % 20) * 0.001;
      rows.push({ sensor_id: 's1', t: `2026-09-0${1 + (i % 9)} 00:00:00+00`, v });
    }
    return rows;
  }),
}));

// eslint-disable-next-line import/first
import SensorMultiChartWidget from './SensorMultiChartWidget';

const SMALL_MAGNITUDE_SELECTION: SensorSelection[] = [
  {
    sensorId: 's1',
    code: 'ACEL-01',
    name: 'Acelerógrafo Triaxial ACEL-01',
    unit: 'g',
    deviceKey: 'dev1',
    zoneId: 1,
    zoneName: 'Zona Norte',
    lat: -9.5,
    lng: -77.5,
  },
];

function lastHistogramOption() {
  return [...capturedOptions]
    .reverse()
    .find((opt) => Array.isArray((opt as any)?.xAxis?.data) && (opt as any).xAxis.data.length > 0) as
    | { xAxis: { data: string[] } }
    | undefined;
}

describe('SensorMultiChartWidget — histograma con sensores de magnitud pequeña (SPEC-021 T9, regresión)', () => {
  beforeEach(() => {
    capturedOptions.length = 0;
    // jsdom no hace layout real: getBoundingClientRect siempre da 0x0, así
    // que <ChartPanel> nunca fija `size` y jamás monta <ReactECharts> (el
    // smoke test de T8 no lo necesita porque solo pide "que no lance" -- acá
    // sí necesitamos que el `option` real llegue a construirse y capturarse).
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 300,
      top: 0,
      left: 0,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('genera 10 etiquetas de bucket DISTINTAS (no "0.0–0.0" repetido) para valores tipo acelerógrafo en g', async () => {
    render(
      <SensorMultiChartWidget
        selections={SMALL_MAGNITUDE_SELECTION}
        chartType="histogram"
        from="2026-09-01T00:00:00Z"
        to="2026-09-10T00:00:00Z"
      />,
    );

    await waitFor(() => expect(lastHistogramOption()).toBeTruthy());

    const labels = lastHistogramOption()!.xAxis.data;
    expect(labels).toHaveLength(10);
    expect(new Set(labels).size).toBe(10);
    expect(labels.every((l) => l !== '0.0–0.0')).toBe(true);

    cleanup();
  });
});
