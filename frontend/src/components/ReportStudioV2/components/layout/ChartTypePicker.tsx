import React, { memo } from 'react';
import {
  LineChart, BarChart3, BarChartHorizontal, AreaChart, ScatterChart, Milestone, Radar, PieChart, Donut,
  Grid3x3, SquareStack, Combine, CandlestickChart, LayoutGrid, Sun, BarChart4, Waypoints, Filter, MapPin, Mountain,
} from 'lucide-react';

export type SensorMultiChartType =
  | 'line' | 'bar' | 'barh' | 'area' | 'scatter' | 'step' | 'radar' | 'pie' | 'donut' | 'heatmap' | 'boxplot'
  | 'combo' | 'candlestick' | 'treemap' | 'sunburst' | 'histogram' | 'waterfall' | 'funnel' | 'geomap' | 'surface';

// Catálogo de modelos ofrecidos al usuario -- calcado del diálogo "Insertar
// gráfico" de Word/Excel (Columnas/Líneas/Circular/Barras/Áreas/XY/Radial/
// Rectángulos/Proyección solar/Histograma/Cajas y bigotes/Cascada/Embudo/
// Combinado/Mapa/Superficie). A diferencia de Word (series sueltas sin
// relación geográfica ni temporal entre sí), acá SÍ hay datos reales para
// dar sentido propio a "Mapa" y "Superficie":
//  - "geomap" ("Mapa"): sensors.lat/lng (WGS84, ya expuesto por
//    /wizard/catalog) -- un mapa satelital real con Leaflet (SensorGeoMapPanel),
//    no un choropleth de regiones administrativas que este sitio minero no
//    tiene. Ver SensorGeoMapPanel.tsx.
//  - "surface" ("Superficie" 3D): grilla tiempo × sensor × valor via
//    echarts-gl (import 'echarts-gl' en SensorMultiChartWidget.tsx registra
//    el tipo 'surface' sobre la misma instancia de echarts que ya usan
//    todos los demás tipos -- sin visor 3D aparte).
//
// Los primeros consumen directamente la serie [timestamp, valor] por sensor
// que devuelve /wizard/query; el resto (radar/pie/donut/heatmap/boxplot/
// treemap/sunburst/histogram/waterfall/funnel/candlestick/surface) se
// calculan client-side a partir de esa misma serie sin tocar el backend --
// ver la construcción de "option" en SensorMultiChartWidget.tsx. "combo"
// (línea + barra mixtas, eje secundario opcional por sensor) replica el
// modelo "Combinado" de Word -- ver ComboSeriesEditor en
// SensorMultiChartInspector.tsx para la configuración por sensor.
// "treemap"/"sunburst" agrupan por zona (SensorSelection.zoneName) porque
// acá SÍ hay una jerarquía natural zona → sensor disponible.
const CHART_TYPES: { value: SensorMultiChartType; label: string; icon: React.ElementType }[] = [
  { value: 'line', label: 'Líneas', icon: LineChart },
  { value: 'bar', label: 'Columnas', icon: BarChart3 },
  { value: 'barh', label: 'Barras', icon: BarChartHorizontal },
  { value: 'combo', label: 'Combinado', icon: Combine },
  { value: 'area', label: 'Áreas', icon: AreaChart },
  { value: 'scatter', label: 'Dispersión (XY)', icon: ScatterChart },
  { value: 'step', label: 'Escalón', icon: Milestone },
  { value: 'radar', label: 'Radial', icon: Radar },
  { value: 'pie', label: 'Circular', icon: PieChart },
  { value: 'donut', label: 'Anillo', icon: Donut },
  { value: 'heatmap', label: 'Mapa de calor', icon: Grid3x3 },
  { value: 'boxplot', label: 'Cajas y bigotes', icon: SquareStack },
  { value: 'candlestick', label: 'Cotizaciones', icon: CandlestickChart },
  { value: 'treemap', label: 'Rectángulos', icon: LayoutGrid },
  { value: 'sunburst', label: 'Proyección solar', icon: Sun },
  { value: 'histogram', label: 'Histograma', icon: BarChart4 },
  { value: 'waterfall', label: 'Cascada', icon: Waypoints },
  { value: 'funnel', label: 'Embudo', icon: Filter },
  { value: 'geomap', label: 'Mapa', icon: MapPin },
  { value: 'surface', label: 'Superficie (3D)', icon: Mountain },
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
