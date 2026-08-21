import React, { memo } from 'react';
import { LineChart, BarChart3, AreaChart, ScatterChart, Milestone, Radar, PieChart, Donut, Grid3x3, SquareStack } from 'lucide-react';

export type SensorMultiChartType = 'line' | 'bar' | 'area' | 'scatter' | 'step' | 'radar' | 'pie' | 'donut' | 'heatmap' | 'boxplot';

// Catálogo de modelos ECharts ofrecidos al usuario. Los 5 primeros consumen
// directamente la serie [timestamp, valor] por sensor que devuelve
// /wizard/query; los 5 siguientes (radar/pie/donut/heatmap/boxplot) se
// calculan client-side a partir de esa misma serie sin tocar el backend —
// ver la construcción de "option" en SensorMultiChartWidget.tsx.
const CHART_TYPES: { value: SensorMultiChartType; label: string; icon: React.ElementType }[] = [
  { value: 'line', label: 'Líneas', icon: LineChart },
  { value: 'bar', label: 'Barras', icon: BarChart3 },
  { value: 'area', label: 'Área apilada', icon: AreaChart },
  { value: 'scatter', label: 'Dispersión', icon: ScatterChart },
  { value: 'step', label: 'Escalón', icon: Milestone },
  { value: 'radar', label: 'Radar', icon: Radar },
  { value: 'pie', label: 'Pastel', icon: PieChart },
  { value: 'donut', label: 'Anillo', icon: Donut },
  { value: 'heatmap', label: 'Mapa de calor', icon: Grid3x3 },
  { value: 'boxplot', label: 'Caja y bigotes', icon: SquareStack },
];

interface ChartTypePickerProps {
  values: string[];
  onChange: (values: SensorMultiChartType[]) => void;
  disabled?: boolean;
}

/**
 * Selección múltiple por checkbox: cada modelo marcado inserta su propio
 * bloque de gráfico (mismos sensores y rango de fecha) — ver
 * SensorMultiChartInspector.handleInsert, que crea un elemento por tipo
 * elegido en vez de forzar una única selección.
 */
function ChartTypePicker({ values, onChange, disabled }: ChartTypePickerProps) {
  const selected = new Set<SensorMultiChartType>(values as SensorMultiChartType[]);

  const toggle = (value: SensorMultiChartType) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
      {CHART_TYPES.map((c) => {
        const Icon = c.icon;
        const active = selected.has(c.value);
        return (
          <label
            key={c.value}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 8,
              border: `1.5px solid ${active ? '#6366f1' : '#cbd5e1'}`,
              cursor: disabled ? 'default' : 'pointer',
              background: active ? '#eef2ff' : '#f8fafc',
              color: active ? '#3730a3' : '#1e293b',
              opacity: disabled ? 0.5 : 1,
            }}
            title={`Incluir un gráfico de ${c.label.toLowerCase()}`}
          >
            <input
              type="checkbox"
              checked={active}
              disabled={disabled}
              onChange={() => toggle(c.value)}
              style={{ margin: 0 }}
            />
            <Icon size={16} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'inherit' }}>{c.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export default memo(ChartTypePicker);
