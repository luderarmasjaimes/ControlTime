import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactECharts from 'echarts-for-react';
import { Radar, Maximize2, Minimize2, Download, X } from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { telemetryTenantIdFromSession } from '../../../../auth/telemetryTenant';
import { fetchTelemetryWizardSeries } from '../../lib/api';
import { log } from '../../../../lib/logger';
import type { SensorSelection } from '../layout/ZoneSensorPicker';
import { comboEntryFor, type ComboSeriesConfig } from '../layout/ComboSeriesEditor';
import SensorGeoMapPanel, { type GeoMapPoint } from './SensorGeoMapPanel';
import SensorSurface3DPanel, { type Surface3DPoint } from './SensorSurface3DPanel';
import { sensorDashboardLayout } from '../../lib/sensorMultiChartLayout';

// SensorSurface3DPanel usa Three.js/WebGL sin ningún try/catch propio: si el
// contexto WebGL no se puede crear (GPU deshabilitada, navegador con WebGL
// bloqueado, o el sidecar de export PDF -- Chromium headless sin GPU real
// pierde el contexto y Three.js lanza sin capturar), ese error no manejado
// desmontaba TODO el árbol de React del informe, no solo este panel
// (confirmado: `no_pages_to_render` en pdf-export-service/server.js al
// intentar forzar WebGL por software en el sidecar). Un solo tipo de gráfico
// fallando no debe tumbar las otras 55 páginas del informe.
class Surface3DErrorBoundary extends React.Component<{ children: React.ReactNode; onReady?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    log.error('Superficie (3D): WebGL no disponible, se omite el gráfico', error);
    // El panel real nunca llega a pintar (por eso no puede llamar su propio
    // `onReady`) -- el aviso de "no disponible" de abajo es todo lo que hay
    // que mostrar, así que cuenta como "listo" para no bloquear el export
    // esperando un frame que jamás va a llegar.
    this.props.onReady?.();
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8', textAlign: 'center', padding: 8, background: '#0b1220', borderRadius: 6 }}>
          Vista 3D no disponible en este navegador/entorno (WebGL). Los demás gráficos del informe no se ven afectados.
        </div>
      );
    }
    return this.props.children;
  }
}

// Export server-side (isPrint, ver ReadOnlyViewer.tsx/pdf-export-service):
// ni siquiera se intenta crear el contexto WebGL. `Surface3DErrorBoundary`
// solo atrapa errores SÍNCRONOS de montaje/render -- la pérdida de contexto
// ("webglcontextlost") es un evento ASÍNCRONO que React NO puede capturar
// con un error boundary, y en el sidecar de export (mucho mount/unmount por
// la virtualización de páginas grandes, ver EXPORT_VIRTUALIZATION_WINDOW)
// se crean/destruyen decenas de contextos WebGL seguidos -- suficiente para
// chocar con el límite de ~16 contextos vivos de Chromium y perder uno que
// sigue intentando pintar, lanzando sin capturar y tumbando TODO el árbol de
// React del informe (reproducido en vivo: exports de 144+ páginas con solo
// las primeras ~5 capturas reales y el resto placeholders "no se pudo
// capturar", ver `handle nulo` en pdf-export-service/server.js). Evitar el
// Canvas/Three.js por completo en export es más confiable que intentar
// blindar cada camino de error asíncrono de react-three-fiber.
function Surface3DPrintFallback({ onReady }: { onReady?: () => void }) {
  useEffect(() => {
    onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8', textAlign: 'center', padding: 8, background: '#0b1220', borderRadius: 6 }}>
      Vista 3D no disponible en la exportación a documento. Disponible en el editor/vista interactiva.
    </div>
  );
}

interface SensorMultiChartWidgetProps {
  title?: string;
  selections?: SensorSelection[];
  chartType?: string;
  chartTypes?: string[];
  comboConfig?: ComboSeriesConfig;
  from?: string | null;
  to?: string | null;
  tenantId?: string;
  width?: number | string;
  height?: number | string;
  isPrint?: boolean;
}

const CHART_TYPE_LABELS: Record<string, string> = {
  line: 'Líneas',
  area: 'Áreas',
  bar: 'Columnas',
  barh: 'Barras',
  combo: 'Combinado',
  scatter: 'Dispersión (XY)',
  step: 'Escalón',
  radar: 'Radial',
  pie: 'Circular',
  donut: 'Anillo',
  heatmap: 'Mapa de calor',
  boxplot: 'Cajas y bigotes',
  candlestick: 'Cotizaciones',
  treemap: 'Rectángulos',
  sunburst: 'Proyección solar',
  histogram: 'Histograma',
  waterfall: 'Cascada',
  funnel: 'Embudo',
  geomap: 'Mapa',
  surface: 'Superficie (3D)',
};

interface SeriesRow {
  sensor_id: string;
  t: string;
  v: number;
}

// Paleta fija y distinguible (subconjunto saturado de MINING_COLORS en
// RibbonToolbar.tsx) — un color estable por posición de sensor en la
// selección, para que cada serie sea identificable de un vistazo tanto en
// el gráfico ECharts como en la leyenda propia de abajo.
const SENSOR_SERIES_COLORS = [
  '#dc2626', '#2563eb', '#059669', '#d97706', '#7c3aed',
  '#0891b2', '#e11d48', '#65a30d', '#4f46e5', '#c026d3',
  '#ca8a04', '#0f766e',
];

function colorForIndex(i: number): string {
  return SENSOR_SERIES_COLORS[i % SENSOR_SERIES_COLORS.length];
}

// Envoltorio que mide su propio contenedor con ResizeObserver ANTES de
// montar ECharts, y le da un tamaño ya conocido en PÍXELES vía `style`
// (NO vía `opts.width/height`, ver por qué abajo).
//
// Reemplaza dos intentos anteriores:
//  1. Varios `.resize()` con backoff tras el montaje -- no determinístico
//     (probado en vivo: funcionó una vez, falló la siguiente con la misma
//     selección). El problema de fondo: echarts-for-react mide
//     `clientWidth/clientHeight` en un instante interno propio (su
//     `initEchartsInstance` crea una instancia temporal, espera su evento
//     'finished' y recién ahí mide) que no es controlable desde afuera, y
//     dentro del portal <Html> de Konva (se re-renderiza en cada commit del
//     lienzo) ese instante puede caer antes de que el layout esté resuelto.
//  2. Pasar `opts={{width,height}}` explícito -- el tamaño SÍ quedaba
//     correcto (confirmado: canvas con dimensiones reales) pero el gráfico
//     seguía en blanco. Causa (confirmada leyendo `componentDidUpdate` de
//     echarts-for-react): un cambio en `opts` dispara `dispose()` +
//     reconstrucción COMPLETA de la instancia (no un resize seguro) -- si el
//     ResizeObserver dispara más de una vez mientras el layout se asienta
//     (normal, p. ej. al aparecer texto/reflow), cada disparo destruye y
//     recrea la instancia de ECharts, y el ciclo interno de esa librería
//     (temporal -> medir -> disponer -> real) puede solaparse entre
//     reconstrucciones sucesivas -- confirmado leyendo el `option` real vía
//     el fiber de React: los 167 puntos de datos SÍ estaban ahí, pero el
//     canvas visible nunca los pintó. Pasando el tamaño por `style` (número
//     en px, no `opts`) el cambio de tamaño entra por la rama SEGURA de
//     `componentDidUpdate` (`!isEqual(prevProps.style, ...)` -> `.resize()`
//     simple), nunca por la rama destructiva.
function ChartPanel({
  option,
  registerRef,
}: {
  option: Record<string, unknown>;
  registerRef: (inst: ReactECharts | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReactECharts | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    // `onChartReady` de echarts-for-react solo se dispara al CREAR la
    // instancia. Cuando llega la telemetría, `option` cambia sobre la misma
    // instancia: el código anterior ponía `rendered=false` aquí y nunca lo
    // devolvía a true, dejando al exportador esperando hasta el timeout aun
    // cuando el canvas ya estaba pintado. Dos frames después del commit de
    // React, setOption/resize ya se aplicaron (animation=false en todas las
    // opciones de export) y la captura es estable.
    setRendered(false);
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const chart = chartRef.current?.getEchartsInstance();
        if (!chart || chart.isDisposed()) return;
        chart.resize();
        setRendered(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [option]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const measure = () => {
      const r = node.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      setSize((prev) => (prev && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1 ? prev : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      const iv = window.setInterval(measure, 200);
      return () => window.clearInterval(iv);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      data-export-chart="true"
      data-export-ready={rendered ? 'true' : 'false'}
      style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
    >
      {size && (
        <ReactECharts
          ref={(inst) => {
            chartRef.current = inst;
            registerRef(inst);
          }}
          option={option}
          notMerge
          onChartReady={() => window.requestAnimationFrame(() => setRendered(true))}
          style={{ width: `${Math.round(size.w)}px`, height: `${Math.round(size.h)}px`, pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}

function SensorMultiChartWidget({ title = 'Gráfico de sensores', selections = [], chartType = 'line', chartTypes, comboConfig = {}, from, to, tenantId, width, height, isPrint }: SensorMultiChartWidgetProps) {
  const [seriesRaw, setSeriesRaw] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadComplete, setLoadComplete] = useState(false);
  // Aislar un sensor: clic en su nombre en la leyenda propia atenúa el resto
  // (opacidad baja) y resalta el elegido — clic de nuevo sobre el mismo
  // vuelve a mostrar todos. Por índice de selección, no por sensorId, porque
  // es lo que indexa `selections`/`colorForIndex` en todo este archivo.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const toggleIsolate = (i: number) => setSelectedIdx((prev) => (prev === i ? null : i));
  const opacityFor = (i: number) => (selectedIdx === null || selectedIdx === i ? 1 : 0.1);
  // Pantalla completa: mejora "premium" pedida explícitamente (referencia:
  // paneles tipo software de monitoreo geotécnico con ícono de expandir) --
  // saca el widget del flujo normal del lienzo a un overlay a pantalla
  // completa para leer series densas con muchos sensores con comodidad.
  const [isFullscreen, setIsFullscreen] = useState(false);

  // El widget se monta dentro de un portal HTML de Konva
  // (react-konva-utils <Html>, ver PageCanvas.tsx), cuyo tamaño final a
  // veces no está resuelto en el primer paint. Cada mini-gráfico se mide y
  // se dimensiona a sí mismo (ver <ChartPanel> más arriba, con
  // ResizeObserver + `opts` explícito) en vez de depender de que este
  // componente adivine cuándo forzar un resize -- por eso no hay lógica de
  // tamaño acá, solo el registro de instancias (para exportar a PNG) por
  // tipo de gráfico, ya que un mismo dashboard puede alojar varios
  // mini-gráficos (uno por tipo marcado en el paso 4 del wizard).
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const echartsInstMap = useRef<Map<string, ReactECharts>>(new Map());
  const registerChartRef = (type: string) => (inst: ReactECharts | null) => {
    if (inst) echartsInstMap.current.set(type, inst);
    else echartsInstMap.current.delete(type);
  };
  // Exportar el panel como PNG -- mejora "premium" pedida explícitamente
  // (referencia: ícono de descarga por gráfico en el software de
  // monitoreo). No es Claude descargando nada: es un botón del propio
  // reporte que el usuario final acciona para guardar la imagen.
  const downloadChartPng = (type: string, label: string) => {
    const inst = echartsInstMap.current.get(type)?.getEchartsInstance();
    if (!inst) return;
    const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label.replace(/[^a-z0-9_-]+/gi, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Tipos de gráfico a mostrar en este dashboard: la lista completa
  // (`chartTypes`, wizard nuevo) tiene prioridad; si no viene, se cae al
  // `chartType` singular (bloques ya insertados antes de este cambio).
  const typesList = useMemo(
    () => (chartTypes && chartTypes.length ? chartTypes : [chartType]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartTypes ? chartTypes.join(',') : '', chartType],
  );

  const sensorIdsKey = useMemo(() => [...selections.map((s) => s.sensorId)].sort().join(','), [selections]);
  const configured = selections.length > 0 && Boolean(from) && Boolean(to);

  // geomap/surface no pasan por <ChartPanel> (que ya trackea "listo" vía
  // onChartReady de ECharts, ver más abajo) -- se trackean acá por separado,
  // alimentando `data-export-ready` (línea ~910), para que la captura de
  // exportación (DOCX/PDF/PPTX) no dispare sobre un mapa sin tiles cargados
  // o un canvas WebGL todavía sin pintar ningún frame (ver `onReady` en
  // SensorGeoMapPanel.tsx / SensorSurface3DPanel.tsx).
  const specialTypesKey = useMemo(
    () => typesList.filter((t) => t === 'geomap' || t === 'surface').join(','),
    [typesList],
  );
  const specialTypes = useMemo(() => (specialTypesKey ? specialTypesKey.split(',') : []), [specialTypesKey]);
  const [specialReady, setSpecialReady] = useState<Set<string>>(new Set());
  useEffect(() => setSpecialReady(new Set()), [specialTypesKey]);
  const markSpecialReady = (type: string) =>
    setSpecialReady((prev) => (prev.has(type) ? prev : new Set(prev).add(type)));
  const specialPanelsReady = specialTypes.every((t) => specialReady.has(t));

  useEffect(() => {
    if (!configured) {
      setSeriesRaw([]);
      setLoadComplete(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadComplete(false);
      setError(null);
      try {
        const session = getSession();
        const effectiveTenantId = tenantId || telemetryTenantIdFromSession(session);
        const data = await fetchTelemetryWizardSeries({
          sensorIds: selections.map((s) => s.sensorId),
          from: from as string,
          to: to as string,
          tenant_id: effectiveTenantId,
        });
        if (!cancelled) setSeriesRaw(Array.isArray(data.series) ? data.series : []);
      } catch (err) {
        log.error('Error fetching sensor_multi_chart series:', err);
        if (!cancelled) setError((err as Error)?.message || 'No se pudo cargar la telemetría');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadComplete(true);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, sensorIdsKey, from, to, tenantId]);

  const buildOptionFor = (chartType: string) => {
    // `row.t` llega del backend como timestamp de Postgres
    // ("2026-08-20 22:00:00+00" -- con espacio y offset de 2 dígitos SIN
    // minutos). El `Date` nativo del navegador lo parsea bien, pero el
    // parser de fechas INTERNO de ECharts para ejes `type:'time'` es un
    // regex propio, más estricto, que NO reconoce ese formato -- resultado:
    // ECharts recibe series con datos "válidos" (confirmado inspeccionando
    // `chart.getOption()`: los 166 puntos estaban ahí) pero no logra
    // ubicarlos en el eje X, así que no dibuja ninguna línea/barra, sin
    // ningún error visible (confirmado en vivo: forzar `setOption` con los
    // mismos puntos convertidos a epoch numérico hizo aparecer las líneas
    // al instante). Se convierte acá, una sola vez, a epoch en ms -- ECharts
    // sí soporta timestamps numéricos sin ambigüedad.
    const bySensor = new Map<string, [number, number][]>();
    for (const row of seriesRaw) {
      if (!bySensor.has(row.sensor_id)) bySensor.set(row.sensor_id, []);
      bySensor.get(row.sensor_id)!.push([new Date(row.t).getTime(), row.v]);
    }
    const sensorLabel = (sel: SensorSelection) => `${sel.name || sel.code}${sel.unit ? ` (${sel.unit})` : ''}`;
    const valuesOf = (sel: SensorSelection) => (bySensor.get(sel.sensorId) || []).map(([, v]) => v);
    const avgOf = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);

    if (chartType === 'geomap') {
      // "Mapa" no produce un `option` de ECharts -- se renderiza aparte con
      // Leaflet (ver <SensorGeoMapPanel> y `geoPoints` más abajo), porque un
      // mapa satelital georreferenciado no es una serie ECharts. Se
      // devuelve un objeto vacío solo para que `optionsByType` mantenga la
      // misma forma { type, option } que el resto de los tipos.
      return {};
    }

    if (chartType === 'radar') {
      const indicator = selections.map((sel) => {
        const max = Math.max(...valuesOf(sel), 0) * 1.15 || 1;
        return { name: sensorLabel(sel), max };
      });
      const value = selections.map((sel) => Number(avgOf(valuesOf(sel)).toFixed(2)));
      return {
        color: selections.map((_, i) => colorForIndex(i)),
        tooltip: {},
        legend: { show: false },
        radar: { indicator, radius: '58%', axisName: { fontSize: 9, color: '#475569' } },
        series: [{ type: 'radar', data: [{ value, name: 'Promedio', areaStyle: { opacity: 0.15 } }] }],
        animation: false,
      };
    }

    if (chartType === 'pie' || chartType === 'donut') {
      const data = selections.map((sel, i) => ({
        name: sensorLabel(sel),
        value: Number(avgOf(valuesOf(sel)).toFixed(2)),
        itemStyle: { color: colorForIndex(i), opacity: opacityFor(i) },
      }));
      return {
        color: selections.map((_, i) => colorForIndex(i)),
        tooltip: { trigger: 'item' },
        legend: { show: false },
        series: [
          {
            type: 'pie',
            radius: chartType === 'donut' ? ['40%', '70%'] : '65%',
            center: ['50%', '60%'],
            data,
            label: { fontSize: 10, color: '#334155' },
            itemStyle: { borderColor: '#fff', borderWidth: 1 },
          },
        ],
        animation: false,
      };
    }

    if (chartType === 'heatmap') {
      const BUCKETS = 12;
      const allTimes = seriesRaw.map((r) => new Date(r.t).getTime()).filter((t) => !Number.isNaN(t));
      const minT = allTimes.length ? Math.min(...allTimes) : 0;
      const maxT = allTimes.length ? Math.max(...allTimes) : 1;
      const span = Math.max(1, maxT - minT);
      const xCats = Array.from({ length: BUCKETS }, (_, i) =>
        new Date(minT + (span * i) / BUCKETS).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      );
      const yCats = selections.map(sensorLabel);
      const sums = new Map<string, number>();
      const counts = new Map<string, number>();
      selections.forEach((sel, yi) => {
        for (const [t, v] of bySensor.get(sel.sensorId) || []) {
          const tt = new Date(t).getTime();
          let xi = Math.floor(((tt - minT) / span) * BUCKETS);
          xi = Math.min(BUCKETS - 1, Math.max(0, xi));
          const key = `${xi}:${yi}`;
          sums.set(key, (sums.get(key) || 0) + v);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      });
      const data: [number, number, number][] = [];
      for (let xi = 0; xi < BUCKETS; xi++) {
        for (let yi = 0; yi < yCats.length; yi++) {
          const key = `${xi}:${yi}`;
          const c = counts.get(key) || 0;
          data.push([xi, yi, c ? Number(((sums.get(key) || 0) / c).toFixed(2)) : 0]);
        }
      }
      const heat = data.map((d) => d[2]);
      return {
        tooltip: { position: 'top' },
        grid: { top: 12, right: 12, bottom: 46, left: 90 },
        xAxis: { type: 'category', data: xCats, axisLabel: { fontSize: 8, rotate: 45, color: '#94a3b8' }, splitArea: { show: true } },
        yAxis: {
          type: 'category',
          data: yCats,
          axisLabel: { fontSize: 9, fontWeight: 600 as const, color: (_v: string, i: number) => colorForIndex(i) },
          splitArea: { show: true },
        },
        visualMap: {
          min: 0,
          max: heat.length ? Math.max(...heat) || 1 : 1,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          itemWidth: 10,
          itemHeight: 80,
          textStyle: { fontSize: 8 },
        },
        series: [{ type: 'heatmap', data, label: { show: false } }],
        animation: false,
      };
    }

    if (chartType === 'boxplot') {
      const quantile = (sorted: number[], p: number) => {
        if (!sorted.length) return 0;
        const idx = (sorted.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
      };
      const data = selections.map((sel, i) => {
        const vals = [...valuesOf(sel)].sort((a, b) => a - b);
        const box = vals.length
          ? [vals[0], quantile(vals, 0.25), quantile(vals, 0.5), quantile(vals, 0.75), vals[vals.length - 1]].map((n) => Number(n.toFixed(2)))
          : [0, 0, 0, 0, 0];
        return { value: box, itemStyle: { color: colorForIndex(i), opacity: opacityFor(i) } };
      });
      return {
        tooltip: { trigger: 'item' },
        grid: { top: 16, right: 16, bottom: 54, left: 46 },
        xAxis: {
          type: 'category',
          data: selections.map(sensorLabel),
          axisLabel: { fontSize: 8, rotate: 30, fontWeight: 600 as const, color: (_v: string, i: number) => colorForIndex(i) },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
          axisLabel: { fontSize: 9, color: '#94a3b8' },
        },
        series: [{ type: 'boxplot', data }],
        animation: false,
      };
    }

    if (chartType === 'barh') {
      // "Barras" de Word == barras HORIZONTALES (categoría en Y, valor en
      // X) -- distinto de "Columnas" (chartType 'bar' de arriba, que en
      // realidad dibuja barras verticales sobre eje de tiempo). Igual que
      // pie/boxplot, compara el promedio del rango por sensor -- una barra
      // horizontal por sensor no tiene un eje de tiempo natural.
      const data = selections.map((sel, i) => ({
        value: Number(avgOf(valuesOf(sel)).toFixed(2)),
        itemStyle: { color: colorForIndex(i), opacity: opacityFor(i) },
      }));
      return {
        tooltip: { trigger: 'item' },
        grid: { top: 16, right: 24, bottom: 26, left: 130 },
        xAxis: {
          type: 'value',
          splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
          axisLabel: { fontSize: 9, color: '#64748b' },
        },
        yAxis: {
          type: 'category',
          data: selections.map(sensorLabel),
          axisLabel: { fontSize: 9, fontWeight: 600 as const, color: (_v: string, i: number) => colorForIndex(i) },
        },
        series: [{ type: 'bar', data, barMaxWidth: 22 }],
        animation: false,
      };
    }

    if (chartType === 'candlestick') {
      // "Cotizaciones" (OHLC): no tenemos apertura/cierre/máx/mín nativos
      // (un sensor entrega un único valor por lectura), así que se calculan
      // agrupando por día -- apertura = primera lectura del día, cierre =
      // última, máximo/mínimo = extremos del día. Útil para ver volatilidad
      // diaria de un sensor, no como gráfico bursátil real. Un candlestick
      // por sensor sobre las mismas categorías de día (mismo criterio que
      // combo: varias series independientes comparables).
      const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const allDays = [...new Set(seriesRaw.map((r) => dayKey(new Date(r.t).getTime())))].sort();
      const series = selections.map((sel, i) => {
        const color = colorForIndex(i);
        const byDay = new Map<string, number[]>();
        for (const [t, v] of bySensor.get(sel.sensorId) || []) {
          const k = dayKey(t);
          if (!byDay.has(k)) byDay.set(k, []);
          byDay.get(k)!.push(v);
        }
        const data = allDays.map((d) => {
          const vals = byDay.get(d);
          if (!vals || !vals.length) return [null, null, null, null];
          const open = vals[0];
          const close = vals[vals.length - 1];
          const low = Math.min(...vals);
          const high = Math.max(...vals);
          return [open, close, low, high].map((n) => Number(n.toFixed(2)));
        });
        return {
          name: sensorLabel(sel),
          type: 'candlestick',
          data,
          // Un solo color por sensor (no el habitual rojo/verde subida-baja
          // -- no aplica a lecturas de sensores mineros) para poder
          // distinguir series cuando hay varios sensores a la vez.
          itemStyle: { color, color0: color, borderColor: color, borderColor0: color, opacity: opacityFor(i) },
        };
      });
      return {
        color: selections.map((_, i) => colorForIndex(i)),
        grid: { top: 16, right: 20, bottom: 46, left: 54 },
        legend: { show: false },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: allDays, axisLabel: { fontSize: 8, rotate: 30, color: '#64748b' } },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
          axisLabel: { fontSize: 9, color: '#64748b' },
        },
        series,
        animation: false,
      };
    }

    if (chartType === 'treemap' || chartType === 'sunburst') {
      // Rectángulos (treemap) y Proyección solar (sunburst) comparten la
      // misma jerarquía: zona → sensor, valor = promedio del rango. A
      // diferencia de Word (series sueltas sin relación), acá SÍ hay una
      // jerarquía natural disponible (SensorSelection.zoneName), así que se
      // aprovecha en vez de forzar un solo nivel plano.
      const zoneGroups = new Map<string, { name: string; value: number; itemStyle: Record<string, unknown> }[]>();
      selections.forEach((sel, i) => {
        const zone = sel.zoneName || 'Sin zona';
        if (!zoneGroups.has(zone)) zoneGroups.set(zone, []);
        zoneGroups.get(zone)!.push({
          name: sensorLabel(sel),
          value: Number(avgOf(valuesOf(sel)).toFixed(2)) || 0.001,
          itemStyle: { color: colorForIndex(i), opacity: opacityFor(i) },
        });
      });
      const data = [...zoneGroups.entries()].map(([zone, children]) => ({ name: zone, children }));
      if (chartType === 'treemap') {
        return {
          tooltip: { formatter: (p: { name: string; value: number }) => `${p.name}: ${p.value ?? '—'}` },
          series: [
            {
              type: 'treemap',
              data,
              roam: false,
              breadcrumb: { show: false },
              label: { fontSize: 9, color: '#fff' },
              upperLabel: { show: true, height: 18, fontSize: 9, color: '#fff' },
              levels: [
                { itemStyle: { borderColor: '#f8fafc', borderWidth: 2, gapWidth: 2 } },
                { itemStyle: { borderColor: '#f8fafc', borderWidth: 1, gapWidth: 1 } },
              ],
            },
          ],
          animation: false,
        };
      }
      return {
        tooltip: {},
        series: [
          {
            type: 'sunburst',
            radius: [0, '85%'],
            data,
            label: { fontSize: 8, color: '#fff' },
            itemStyle: { borderColor: '#f8fafc', borderWidth: 1 },
          },
        ],
        animation: false,
      };
    }

    if (chartType === 'histogram') {
      // Distribución de frecuencias de TODAS las lecturas del rango (no
      // promedio) -- se combinan los valores de todos los sensores
      // seleccionados para fijar los límites de los buckets, y cada sensor
      // aporta su propio conteo apilado por bucket (mismo criterio de color
      // por sensor que el resto de tipos).
      const BINS = 10;
      const allVals = selections.flatMap((sel) => valuesOf(sel));
      const minV = allVals.length ? Math.min(...allVals) : 0;
      const maxV = allVals.length ? Math.max(...allVals) : 1;
      const span = Math.max(1e-9, maxV - minV);
      const binEdges = Array.from({ length: BINS + 1 }, (_, i) => minV + (span * i) / BINS);
      const binLabels = Array.from({ length: BINS }, (_, i) => `${binEdges[i].toFixed(1)}–${binEdges[i + 1].toFixed(1)}`);
      const series = selections.map((sel, i) => {
        const counts = new Array(BINS).fill(0);
        for (const v of valuesOf(sel)) {
          let bi = Math.floor(((v - minV) / span) * BINS);
          bi = Math.min(BINS - 1, Math.max(0, bi));
          counts[bi] += 1;
        }
        return {
          name: sensorLabel(sel),
          type: 'bar',
          stack: 'hist',
          data: counts,
          itemStyle: { color: colorForIndex(i), opacity: opacityFor(i) },
        };
      });
      return {
        color: selections.map((_, i) => colorForIndex(i)),
        grid: { top: 16, right: 20, bottom: 58, left: 40 },
        legend: { show: false },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: binLabels, axisLabel: { fontSize: 8, rotate: 45, color: '#64748b' } },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
          axisLabel: { fontSize: 9, color: '#64748b' },
        },
        series,
        animation: false,
      };
    }

    if (chartType === 'waterfall') {
      // Cascada: barra base transparente (acumulado previo) + barra visible
      // (aporte del sensor), categoría final "Total" -- el patrón estándar
      // para simular cascada en ECharts (no existe un `series.type:
      // 'waterfall'` nativo). El promedio de cada sensor es su "aporte" a la
      // acumulación total, en el orden en que fueron seleccionados.
      const avgs = selections.map((sel) => Number(avgOf(valuesOf(sel)).toFixed(2)));
      let running = 0;
      const baseData: number[] = [];
      const deltaData: { value: number; itemStyle: Record<string, unknown> }[] = [];
      avgs.forEach((v, i) => {
        baseData.push(Math.min(running, running + v));
        deltaData.push({ value: Math.abs(v), itemStyle: { color: colorForIndex(i), opacity: opacityFor(i) } });
        running += v;
      });
      const categories = [...selections.map(sensorLabel), 'Total'];
      baseData.push(0);
      deltaData.push({ value: running, itemStyle: { color: '#0f172a' } });
      return {
        grid: { top: 16, right: 20, bottom: 64, left: 54 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: categories, axisLabel: { fontSize: 8, rotate: 30, color: '#64748b' } },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
          axisLabel: { fontSize: 9, color: '#64748b' },
        },
        series: [
          { name: 'Base', type: 'bar', stack: 'total', itemStyle: { color: 'transparent' }, data: baseData, silent: true },
          { name: 'Aporte', type: 'bar', stack: 'total', data: deltaData, barMaxWidth: 34 },
        ],
        animation: false,
      };
    }

    if (chartType === 'funnel') {
      // Embudo: etapas ordenadas de mayor a menor promedio del rango --
      // mismo dato base que pie/donut (promedio por sensor), en formato de
      // ranking en vez de proporción circular.
      const items = selections
        .map((sel, i) => ({
          name: sensorLabel(sel),
          value: Number(avgOf(valuesOf(sel)).toFixed(2)),
          itemStyle: { color: colorForIndex(i), opacity: opacityFor(i) },
        }))
        .sort((a, b) => b.value - a.value);
      return {
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'funnel',
            left: '8%',
            width: '84%',
            sort: 'descending',
            label: { fontSize: 9, color: '#334155' },
            data: items,
          },
        ],
        animation: false,
      };
    }

    if (chartType === 'surface') {
      // "Superficie" no produce un `option` de ECharts -- se renderiza
      // aparte con Three.js (ver <SensorSurface3DPanel> y `surfaceData` más
      // abajo). Intento inicial con `echarts-gl` revertido: esa librería
      // requiere el permiso CSP 'unsafe-eval' (arma su pipeline de
      // post-procesado vía `new Function(...)`), que la política de
      // seguridad del sitio deniega a propósito -- ver
      // Content-Security-Policy en nginx.conf. Se devuelve un objeto vacío
      // solo para que `optionsByType` mantenga la misma forma { type,
      // option } que el resto de los tipos.
      return {};
    }

    if (chartType === 'combo') {
      // Modelo "Combinado" (equivalente a Word/Excel > Insertar gráfico >
      // Combinado > Combinación personalizada): cada sensor es una serie
      // independiente con su propio tipo (línea/barra, ComboSeriesEditor) y,
      // opcionalmente, su propio eje Y -- el eje secundario (derecha) solo
      // se agrega al `option` si al menos un sensor lo pidió, para no
      // desperdiciar espacio en el caso común de un solo eje.
      const hasSecondary = selections.some((sel) => comboEntryFor(comboConfig, sel.sensorId).secondaryAxis);
      const series = selections.map((sel, i) => {
        const entry = comboEntryFor(comboConfig, sel.sensorId);
        const color = colorForIndex(i);
        const opacity = opacityFor(i);
        const emphasized = selectedIdx === i;
        return {
          name: sensorLabel(sel),
          type: entry.type,
          yAxisIndex: entry.secondaryAxis ? 1 : 0,
          data: bySensor.get(sel.sensorId) || [],
          smooth: entry.type === 'line',
          symbol: 'none',
          barMaxWidth: entry.type === 'bar' ? 18 : undefined,
          itemStyle: { color, opacity },
          lineStyle: entry.type === 'line' ? { color, width: emphasized ? 3.5 : 2, opacity } : undefined,
          z: emphasized ? 10 : 1,
        };
      });
      const yAxis: Record<string, unknown>[] = [
        {
          type: 'value',
          splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
          axisLabel: { fontSize: 9, color: '#64748b' },
        },
      ];
      if (hasSecondary) {
        yAxis.push({
          type: 'value',
          position: 'right',
          splitLine: { show: false },
          axisLabel: { fontSize: 9, color: '#7c3aed' },
          axisLine: { show: true, lineStyle: { color: '#7c3aed' } },
        });
      }
      return {
        color: selections.map((_, i) => colorForIndex(i)),
        grid: { top: 16, right: hasSecondary ? 44 : 20, bottom: 26, left: 54 },
        legend: { show: false },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'time', axisLabel: { fontSize: 9, color: '#64748b' } },
        yAxis,
        series,
        animation: false,
      };
    }

    const isLineFamily = chartType === 'area' || chartType === 'line' || chartType === 'step';
    const echartsType = isLineFamily ? 'line' : chartType === 'scatter' ? 'scatter' : 'bar';
    const series = selections.map((sel, i) => {
      const color = colorForIndex(i);
      const opacity = opacityFor(i);
      const emphasized = selectedIdx === i;
      return {
        name: sensorLabel(sel),
        type: echartsType,
        data: bySensor.get(sel.sensorId) || [],
        smooth: chartType === 'line',
        step: chartType === 'step' ? ('middle' as const) : undefined,
        symbol: echartsType === 'scatter' ? 'circle' : 'none',
        symbolSize: 6,
        itemStyle: { color, opacity },
        lineStyle: isLineFamily ? { color, width: emphasized ? 3.5 : 2, opacity } : undefined,
        z: emphasized ? 10 : 1,
        ...(chartType === 'area' ? { areaStyle: { color, opacity: opacity * 0.14 }, stack: undefined } : {}),
      };
    });
    return {
      color: selections.map((_, i) => colorForIndex(i)),
      grid: { top: 16, right: 20, bottom: 26, left: 54 },
      legend: { show: false },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'time', axisLabel: { fontSize: 9, color: '#64748b' } },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
        axisLabel: { fontSize: 9, color: '#64748b' },
      },
      series,
      animation: false,
    };
  };

  // Un `option` de ECharts por cada tipo marcado -- `buildOptionFor` no está
  // memoizada en sí misma (se recrea cada render, cierra sobre el estado
  // actual), pero el array resultante sí, para no reconstruir N charts en
  // cada render sin necesidad.
  const optionsByType = useMemo(
    () => typesList.map((t) => ({ type: t, option: buildOptionFor(t) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seriesRaw, selections, typesList, selectedIdx, comboConfig],
  );
  const isDashboard = optionsByType.length > 1;
  const dashboardLayout = sensorDashboardLayout(
    optionsByType.length,
    typeof width === 'number' ? width : chartWrapRef.current?.getBoundingClientRect().width || 0,
    configured && selections.length > 0,
  );

  // Puntos para el tipo "Mapa" (geomap) -- promedio del rango por sensor en
  // su coordenada real (sensors.lat/lng). Se calcula aparte de
  // `buildOptionFor` porque no es un `option` de ECharts (ver
  // <SensorGeoMapPanel>). Sensores sin lat/lng se cuentan pero no se
  // grafican -- no todos los 142 sensores de prueba tienen coordenadas
  // cargadas.
  const geoData = useMemo(() => {
    const bySensorVals = new Map<string, number[]>();
    for (const row of seriesRaw) {
      if (!bySensorVals.has(row.sensor_id)) bySensorVals.set(row.sensor_id, []);
      bySensorVals.get(row.sensor_id)!.push(row.v);
    }
    const points: GeoMapPoint[] = [];
    let skipped = 0;
    selections.forEach((sel, i) => {
      if (sel.lat == null || sel.lng == null) {
        skipped += 1;
        return;
      }
      const vals = bySensorVals.get(sel.sensorId) || [];
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      points.push({
        sensorId: sel.sensorId,
        label: `${sel.name || sel.code}`,
        unit: sel.unit,
        lat: sel.lat,
        lng: sel.lng,
        value: Number(avg.toFixed(2)),
        color: colorForIndex(i),
        opacity: opacityFor(i),
      });
    });
    return { points, skipped };
  }, [seriesRaw, selections, selectedIdx]);

  // Datos para el tipo "Superficie" (3D, Three.js) -- misma grilla
  // tiempo × sensor × valor que se usaba para echarts-gl (BUCKETS
  // intervalos iguales, promedio por celda), independiente de cualquier
  // `option` de ECharts. Ver <SensorSurface3DPanel>.
  const surfaceData = useMemo(() => {
    const BUCKETS = 16;
    const bySensorTV = new Map<string, [number, number][]>();
    for (const row of seriesRaw) {
      if (!bySensorTV.has(row.sensor_id)) bySensorTV.set(row.sensor_id, []);
      bySensorTV.get(row.sensor_id)!.push([new Date(row.t).getTime(), row.v]);
    }
    const allTimes = seriesRaw.map((r) => new Date(r.t).getTime()).filter((t) => !Number.isNaN(t));
    const minT = allTimes.length ? Math.min(...allTimes) : 0;
    const maxT = allTimes.length ? Math.max(...allTimes) : 1;
    const span = Math.max(1, maxT - minT);
    const xCats = Array.from({ length: BUCKETS }, (_, i) =>
      new Date(minT + (span * i) / BUCKETS).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit' }),
    );
    const yCats = selections.map((sel) => `${sel.name || sel.code}${sel.unit ? ` (${sel.unit})` : ''}`);
    const yColors = selections.map((_, i) => colorForIndex(i));
    const sums = new Map<string, number>();
    const counts = new Map<string, number>();
    selections.forEach((sel, yi) => {
      for (const [t, v] of bySensorTV.get(sel.sensorId) || []) {
        let xi = Math.floor(((t - minT) / span) * BUCKETS);
        xi = Math.min(BUCKETS - 1, Math.max(0, xi));
        const key = `${xi}:${yi}`;
        sums.set(key, (sums.get(key) || 0) + v);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    const points: Surface3DPoint[] = [];
    for (let xi = 0; xi < BUCKETS; xi++) {
      for (let yi = 0; yi < yCats.length; yi++) {
        const key = `${xi}:${yi}`;
        const c = counts.get(key) || 0;
        points.push({ xi, yi, z: c ? Number(((sums.get(key) || 0) / c).toFixed(2)) : 0 });
      }
    }
    return { xCats, yCats, yColors, points };
  }, [seriesRaw, selections]);

  // Resumen por sensor (color + último valor) para la franja de leyenda
  // propia, independiente del tipo de gráfico ECharts elegido — así el
  // usuario siempre puede identificar "qué color es qué sensor" incluso en
  // tipos (heatmap, boxplot) donde ECharts no dibuja una leyenda por sensor.
  const sensorSummaries = useMemo(() => {
    const bySensor = new Map<string, [string, number][]>();
    for (const row of seriesRaw) {
      if (!bySensor.has(row.sensor_id)) bySensor.set(row.sensor_id, []);
      bySensor.get(row.sensor_id)!.push([row.t, row.v]);
    }
    return selections.map((sel, i) => {
      const points = bySensor.get(sel.sensorId) || [];
      const last = points.length ? points[points.length - 1][1] : null;
      return {
        id: sel.sensorId,
        color: colorForIndex(i),
        code: sel.code || sel.name,
        label: sel.name || sel.code,
        zone: sel.zoneName,
        unit: sel.unit,
        lastValue: last,
      };
    });
  }, [seriesRaw, selections]);

  const showSidebar = configured && !loading && !error && sensorSummaries.length > 0;

  // El widget vive dentro del portal <Html> de Konva, cuyo wrapper aplica
  // un CSS `transform` (translate/scale) para seguir la posición del
  // lienzo -- eso convierte a ese wrapper en el "containing block" de
  // cualquier descendiente con `position:fixed`, así que un fixed normal
  // NO cubre el viewport real, queda anclado al wrapper transformado
  // (confirmado probando en vivo: el overlay aparecía descentrado y
  // desplazado). Por eso el modo pantalla completa se renderiza vía
  // `createPortal` directo a `document.body`, fuera de ese ancestro.
  const widgetBody = (
      <div
        ref={chartWrapRef}
        className="sensor-multi-chart-widget-container"
        data-export-widget="sensor-multi-chart"
        data-export-ready={(!configured || loadComplete) && specialPanelsReady ? 'true' : 'false'}
        data-export-error={error || undefined}
        style={
          isFullscreen
            ? {
                position: 'fixed', top: '4vh', left: '4vw', width: '92vw', height: '92vh', zIndex: 99999,
                background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                padding: 12, display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
              }
            : {
                width: width || '100%',
                height: height || '100%',
                minHeight: dashboardLayout.minHeight,
                boxSizing: 'border-box',
                background: '#fff',
                borderRadius: 8,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: 'none',
                overflow: 'hidden',
              }
        }
      >
        <div className="sensor-widget-controls" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexShrink: 0 }}>
          <div style={{ color: '#6366f1' }}><Radar size={14} /></div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
            {title}
          </span>
          {/* Botón de pantalla completa -- ver referencia de diseño (software de
             monitoreo geotécnico): ícono de expandir en la esquina de cada
             panel. La clase "sensor-widget-controls" (ver styles.css) es lo
             que realmente lo hace clickeable: un !important global
             (`.report-canvas-html-shield *{pointer-events:none!important}`)
             anula cualquier pointer-events:auto inline por sí solo -- ver el
             comentario extenso en styles.css junto a esa clase. */}
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: '1px solid #e2e8f0', borderRadius: 5, background: '#f8fafc', color: '#475569', cursor: 'pointer', pointerEvents: 'auto', flexShrink: 0 }}
          >
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          {isFullscreen && (
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              title="Cerrar"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: '1px solid #e2e8f0', borderRadius: 5, background: '#fef2f2', color: '#b91c1c', cursor: 'pointer', pointerEvents: 'auto', flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Cuerpo: leyenda lateral (izquierda, con scroll propio) + área de
           gráfico(s) (derecha) -- mismo patrón que paneles profesionales de
           monitoreo geotécnico (referencia de diseño del usuario): lista
           compacta de sensores por color a un costado, gráfico grande al
           lado, en vez de una franja de leyenda arriba del gráfico. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8 }}>
          {showSidebar && (
            <div
              className="sensor-widget-controls"
              style={{
                width: isFullscreen ? 220 : 160,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                background: '#f8fafc',
                pointerEvents: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 7px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Sensores ({sensorSummaries.length})
                </span>
                {selectedIdx !== null && (
                  <button
                    type="button"
                    onClick={() => setSelectedIdx(null)}
                    title="Mostrar todos los sensores"
                    style={{ fontSize: 9, fontWeight: 700, color: '#4338ca', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Ver todos
                  </button>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 4 }}>
                {sensorSummaries.map((s, i) => {
                  const isSelected = selectedIdx === i;
                  const isDimmed = selectedIdx !== null && !isSelected;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleIsolate(i)}
                      title={
                        `${s.label}${s.zone ? ` · ${s.zone}` : ''}`
                        + (isSelected ? ' — clic para mostrar todos' : ' — clic para resaltar solo este sensor')
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        width: '100%',
                        fontSize: 11,
                        color: '#1e293b',
                        textAlign: 'left',
                        cursor: 'pointer',
                        border: isSelected ? `1.5px solid ${s.color}` : '1px solid transparent',
                        background: isSelected ? '#ffffff' : 'transparent',
                        borderRadius: 5,
                        padding: '4px 6px',
                        marginBottom: 2,
                        opacity: isDimmed ? 0.4 : 1,
                        transition: 'opacity 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0, boxShadow: '0 0 0 1px rgba(0,0,0,0.08)' }} />
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10.5 }}>
                          {s.code}
                        </span>
                        {s.lastValue != null && (
                          <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums', fontSize: 9.5 }}>
                            {s.lastValue.toFixed(2)}{s.unit ? ` ${s.unit}` : ''}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0 }}>
            {!configured ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8', textAlign: 'center', padding: 8 }}>
                Configure el tipo de sensor, la selección por zona, el tipo de gráfico y el rango de fecha en el panel de propiedades, y presione «Insertar gráfico».
              </div>
            ) : loading ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8' }}>
                Cargando telemetría…
              </div>
            ) : error ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#b91c1c', textAlign: 'center', padding: 8 }}>
                {error}
              </div>
            ) : isDashboard ? (
              // Dashboard: varios tipos de gráfico marcados en el wizard -> una
              // sola tarjeta con todos, en vez de un bloque separado por tipo
              // (pedido explícito: "en solo 1 dashboard del sensor se muestren
              // todos los diagramas de telemetría de todos los sensores
              // seleccionados"). Grilla responsiva; la leyenda de sensores es
              // compartida (barra lateral) y controla los 3 gráficos a la vez.
              <div
                style={{
                  height: '100%',
                  overflow: 'hidden',
                  display: 'grid',
                  gridTemplateColumns: `repeat(${dashboardLayout.columns}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${dashboardLayout.rows}, minmax(0, 1fr))`,
                  gap: 8,
                  pointerEvents: 'auto',
                }}
              >
                {optionsByType.map(({ type, option: opt }) => (
                  <div
                    key={type}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      padding: 6,
                      background: '#fff',
                    }}
                  >
                    <div className="sensor-widget-controls" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                        {CHART_TYPE_LABELS[type] || type}
                      </span>
                      {type !== 'geomap' && type !== 'surface' && (
                        <button
                          type="button"
                          onClick={() => downloadChartPng(type, `${title}-${type}`)}
                          title="Descargar como imagen (PNG)"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer' }}
                        >
                          <Download size={12} />
                        </button>
                      )}
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      {type === 'geomap' ? (
                        <SensorGeoMapPanel points={geoData.points} skippedCount={geoData.skipped} onReady={() => markSpecialReady('geomap')} />
                      ) : type === 'surface' ? (
                        isPrint ? (
                          <Surface3DPrintFallback onReady={() => markSpecialReady('surface')} />
                        ) : (
                          <Surface3DErrorBoundary onReady={() => markSpecialReady('surface')}>
                            <SensorSurface3DPanel xCats={surfaceData.xCats} yCats={surfaceData.yCats} yColors={surfaceData.yColors} data={surfaceData.points} onReady={() => markSpecialReady('surface')} />
                          </Surface3DErrorBoundary>
                        )
                      ) : (
                        <ChartPanel option={opt} registerRef={registerChartRef(type)} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {optionsByType[0].type !== 'geomap' && optionsByType[0].type !== 'surface' && (
                  <div className="sensor-widget-controls" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
                    <button
                      type="button"
                      onClick={() => downloadChartPng(optionsByType[0].type, title)}
                      title="Descargar como imagen (PNG)"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', pointerEvents: 'auto' }}
                    >
                      <Download size={12} />
                    </button>
                  </div>
                )}
                <div style={{ flex: 1, minHeight: 0 }}>
                  {optionsByType[0].type === 'geomap' ? (
                    <SensorGeoMapPanel points={geoData.points} skippedCount={geoData.skipped} onReady={() => markSpecialReady('geomap')} />
                  ) : optionsByType[0].type === 'surface' ? (
                    isPrint ? (
                      <Surface3DPrintFallback onReady={() => markSpecialReady('surface')} />
                    ) : (
                      <Surface3DErrorBoundary onReady={() => markSpecialReady('surface')}>
                        <SensorSurface3DPanel xCats={surfaceData.xCats} yCats={surfaceData.yCats} yColors={surfaceData.yColors} data={surfaceData.points} onReady={() => markSpecialReady('surface')} />
                      </Surface3DErrorBoundary>
                    )
                  ) : (
                    <ChartPanel option={optionsByType[0].option} registerRef={registerChartRef(optionsByType[0].type)} />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
  );

  if (isFullscreen) {
    return createPortal(
      <>
        {/* Fondo de pantalla completa -- clic afuera cierra. pointerEvents
           auto explícito porque este overlay vive fuera del árbol normal de
           Konva (no necesita el bloqueo pointerEvents:none del widget). */}
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', zIndex: 99998, pointerEvents: 'auto' }}
          onClick={() => setIsFullscreen(false)}
        />
        {widgetBody}
      </>,
      document.body,
    );
  }
  return widgetBody;
}

export default memo(SensorMultiChartWidget);
