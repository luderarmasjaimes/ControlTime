import React from 'react';
import Plot from 'react-plotly.js';

export default function LiveChartBlock({ width, height }) {
  const x = Array.from({ length: 20 }, (_, i) => i);
  const y = x.map((index) => Math.sin(index / 3) * 10 + 50 + (Math.random() * 2 - 1));

  return (
    <div style={{ width, height }}>
      <Plot
        data={[{ x, y, type: 'scatter', mode: 'lines', line: { color: '#2d6cdf' } }]}
        layout={{
          margin: { l: 20, r: 10, t: 10, b: 20 },
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#ffffff',
          width,
          height,
        }}
        config={{ displayModeBar: false, responsive: true }}
      />
    </div>
  );
}
