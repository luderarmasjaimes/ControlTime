import React from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
// Distribución "basic" de Plotly en vez del bundle completo (2026-08-02).
// El bundle completo pesa 4.75MB (1.43MB gzip) porque arrastra TODOS los tipos
// de traza: mapas geográficos, 3D/WebGL, financieros, ternarios, sankey…
// Este componente —el único de toda la app que usa Plotly— solo dibuja
// `scatter` y `bar` (ver los traces de abajo), y ambos vienen en la
// distribución `basic`, que baja a ~1MB. El resto de gráficos de la
// plataforma ya usan echarts.
import Plotly from 'plotly.js-basic-dist-min';

// react-plotly.js/factory y plotly.js-basic-dist-min son módulos CommonJS.
// Vite 8 puede entregar su exportación como el valor directo o envuelta en
// `.default` según se ejecute en dev o en el bundle de producción. Invocar el
// wrapper sin normalizar hacía colapsar todo ReportStudioV2 al abrirlo con
// `TypeError: createPlotlyComponent is not a function`.
const factoryModule: any = createPlotlyComponent;
const plotlyModule: any = Plotly;
const plotlyFactory = typeof factoryModule === 'function' ? factoryModule : factoryModule.default;
const plotlyRuntime = plotlyModule?.default ?? plotlyModule;
const Plot = plotlyFactory(plotlyRuntime);

/**
 * Bloque de gráfico del editor de informes. Dos modos:
 *  - ESTÁTICO (props.live === false y props.chartKind): dibuja los datos
 *    ingresados en el elemento. Soporta los 3 tipos de figura del modelo
 *    corporativo minero: `line` (línea con línea de meta), `hbar` (barras
 *    horizontales con etiquetas) y `combo` (línea + barras, doble eje).
 *  - EN VIVO (por defecto, comportamiento histórico): onda seno demostrativa,
 *    para el bloque "Gráfico" genérico que aún no tiene datos.
 */
interface LiveChartBlockProps {
  width?: number | string;
  height?: number | string;
  /** props del elemento chart (categories, series, chartKind, threshold…). */
  data?: Record<string, any>;
}

const BLUE = '#2d6cdf';
const BAR_LIGHT = '#bcd3f2';
const NAVY = '#17365D';
const GRID = '#eef2f7';

export default function LiveChartBlock({ width, height, data }: LiveChartBlockProps) {
  const p = data || {};
  const kind: string | undefined = p.chartKind;
  const isStatic = p.live === false && !!kind;

  let traces: any[] = [];
  const layout: any = {
    margin: { l: 52, r: 18, t: p.title ? 36 : 12, b: 42 },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    width,
    height,
    font: { family: 'Arial, sans-serif', size: 11, color: '#334155' },
    title: p.title ? { text: String(p.title), font: { size: 13, color: NAVY } } : undefined,
    showlegend: false,
  };

  if (isStatic && kind === 'line') {
    const cats: any[] = p.categories || [];
    traces = [{
      x: cats, y: p.series || [], type: 'scatter', mode: 'lines+markers',
      line: { color: BLUE, width: 3 }, marker: { size: 7, color: BLUE },
      name: p.seriesLabel || '',
    }];
    if (typeof p.threshold === 'number') {
      traces.push({
        x: cats, y: cats.map(() => p.threshold), type: 'scatter', mode: 'lines',
        line: { color: BLUE, width: 1.5, dash: 'dash' }, name: p.thresholdLabel || 'Meta',
        hoverinfo: 'skip',
      });
    }
    layout.yaxis = { title: { text: p.seriesLabel || '', font: { size: 10 } }, gridcolor: GRID };
    layout.xaxis = { gridcolor: GRID };
  } else if (isStatic && kind === 'hbar') {
    const cats: any[] = p.categories || [];
    const vals: number[] = p.series || [];
    traces = [{
      x: vals, y: cats, type: 'bar', orientation: 'h', marker: { color: BLUE },
      text: vals.map((v) => `${v}%`), textposition: 'outside', cliponaxis: false,
    }];
    layout.xaxis = { title: { text: p.xLabel || '', font: { size: 10 } }, gridcolor: GRID, range: [0, 108] };
    layout.yaxis = { automargin: true };
  } else if (isStatic && kind === 'combo') {
    const cats: any[] = p.categories || [];
    traces = [
      {
        x: cats, y: p.series2 || [], type: 'bar', marker: { color: BAR_LIGHT },
        name: p.series2Label || 'Serie 2', yaxis: 'y2',
      },
      {
        x: cats, y: p.series || [], type: 'scatter', mode: 'lines+markers',
        line: { color: BLUE, width: 3 }, marker: { size: 6, color: BLUE },
        name: p.seriesLabel || 'Serie 1', yaxis: 'y1',
      },
    ];
    layout.showlegend = true;
    layout.legend = { orientation: 'h', y: -0.25, font: { size: 10 } };
    layout.yaxis = { title: { text: p.seriesLabel || '', font: { size: 10 } }, gridcolor: GRID };
    layout.yaxis2 = { title: { text: p.series2Label || '', font: { size: 10 } }, overlaying: 'y', side: 'right', showgrid: false };
    layout.xaxis = { title: { text: p.xLabel || 'Día del periodo', font: { size: 10 } } };
    layout.margin.b = 54;
  } else {
    // Demo en vivo (histórico).
    const x = Array.from({ length: 20 }, (_, i) => i);
    const y = x.map((index) => Math.sin(index / 3) * 10 + 50 + (Math.random() * 2 - 1));
    traces = [{ x, y, type: 'scatter', mode: 'lines', line: { color: BLUE } }];
    layout.margin = { l: 20, r: 10, t: 10, b: 20 };
  }

  return (
    <div style={{ width, height }}>
      <Plot
        data={traces}
        layout={layout}
        config={{ displayModeBar: false, responsive: true, staticPlot: isStatic }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
