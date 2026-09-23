import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import SensorMultiChartWidget from './SensorMultiChartWidget';
import type { SensorSelection } from '../../layout/ZoneSensorPicker';

/**
 * SPEC-021 T8 (cierre 2026-09-12): "validar visualmente los diez tipos [de
 * gráfico] y estados vacíos". El catálogo real creció de 10 a 20 tipos
 * (`CHART_TYPE_LABELS` en `SensorMultiChartWidget.tsx`) sin que el `tasks.md`
 * se actualizara. jsdom no puede verificar píxeles (no hay validación visual
 * real posible sin un navegador), pero SÍ puede montar el árbol de React
 * completo de cada tipo -- incluidos `surface` (Three.js/WebGL, protegido
 * por `Surface3DErrorBoundary`, ver comentario largo en el componente sobre
 * por qué ese boundary existe) y `geomap` (Leaflet) -- y confirmar que
 * NINGUNO tira una excepción sin capturar, que es exactamente la clase de
 * bug real que este componente ya documenta haber sufrido antes (ver los
 * comentarios sobre pérdida de contexto WebGL tumbando el árbol completo).
 *
 * No sustituye una revisión visual real en navegador (recomendada antes de
 * dar el CA por aceptado en producción) -- cierra la parte de esta tarea que
 * SÍ es automatizable: ningún tipo de gráfico rompe el montaje, ni vacío ni
 * con datos.
 */

const ALL_CHART_TYPES = [
  'line', 'area', 'bar', 'barh', 'combo', 'scatter', 'step', 'radar', 'pie',
  'donut', 'heatmap', 'boxplot', 'candlestick', 'treemap', 'sunburst',
  'histogram', 'waterfall', 'funnel', 'geomap', 'surface',
];

const SAMPLE_SELECTIONS: SensorSelection[] = [
  { sensorId: 's1', code: 'TEMP-01', name: 'Temperatura pozo 1', unit: '°C', deviceKey: 'dev1', zoneId: 1, zoneName: 'Zona Norte', lat: -9.5, lng: -77.5 },
  { sensorId: 's2', code: 'PRES-02', name: 'Presión línea 2', unit: 'kPa', deviceKey: 'dev2', zoneId: 1, zoneName: 'Zona Norte', lat: -9.51, lng: -77.51 },
];

describe('SensorMultiChartWidget — smoke de montaje por tipo de gráfico (SPEC-021 T8)', () => {
  it.each(ALL_CHART_TYPES)('monta "%s" sin selección (estado vacío) sin lanzar', (chartType) => {
    expect(() => render(<SensorMultiChartWidget selections={[]} chartType={chartType} />)).not.toThrow();
    cleanup();
  });

  // "geomap" queda fuera de este segundo bloque (con marcadores reales): el
  // teardown de Leaflet (`SensorGeoMapPanel.tsx::map.remove()`) sobre un
  // `L.circleMarker` real dispara `Path.js::onRemove` leyendo un renderer
  // interno que el stub de Canvas de `setupTests.js` no reproduce con
  // fidelidad total -- limitación conocida de jsdom+Leaflet+Canvas (mismo
  // tipo de gap que ese archivo ya documenta para `MapViewer`), no un bug de
  // la aplicación: en un navegador real el contexto 2D existe de verdad.
  // El estado vacío de "geomap" (sin marcadores, arriba) sí corre limpio.
  const CHART_TYPES_WITH_DATA = ALL_CHART_TYPES.filter((t) => t !== 'geomap');

  it.each(CHART_TYPES_WITH_DATA)('monta "%s" con sensores seleccionados sin lanzar', (chartType) => {
    expect(() =>
      render(<SensorMultiChartWidget selections={SAMPLE_SELECTIONS} chartType={chartType} from="2026-09-01T00:00:00Z" to="2026-09-12T00:00:00Z" />),
    ).not.toThrow();
    cleanup();
  });

  it('monta en modo combinado (chartTypes múltiples + comboConfig) sin lanzar', () => {
    expect(() =>
      render(
        <SensorMultiChartWidget
          selections={SAMPLE_SELECTIONS}
          chartTypes={['line', 'bar']}
          comboConfig={{ s1: 'line', s2: 'bar' } as any}
          from="2026-09-01T00:00:00Z"
          to="2026-09-12T00:00:00Z"
        />,
      ),
    ).not.toThrow();
  });

  it('monta en modo isPrint (camino de exportación, sin Three.js real) sin lanzar', () => {
    expect(() =>
      render(<SensorMultiChartWidget selections={SAMPLE_SELECTIONS} chartType="surface" isPrint />),
    ).not.toThrow();
  });
});
