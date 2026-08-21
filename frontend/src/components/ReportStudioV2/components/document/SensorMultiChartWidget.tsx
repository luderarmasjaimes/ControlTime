import React, { memo, useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Radar } from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import { telemetryTenantIdFromSession } from '../../../../auth/telemetryTenant';
import { fetchTelemetryWizardSeries } from '../../lib/api';
import { log } from '../../../../lib/logger';
import type { SensorSelection } from '../layout/ZoneSensorPicker';

interface SensorMultiChartWidgetProps {
  title?: string;
  selections?: SensorSelection[];
  chartType?: string;
  from?: string | null;
  to?: string | null;
  width?: number | string;
  height?: number | string;
}

interface SeriesRow {
  sensor_id: string;
  t: string;
  v: number;
}

function SensorMultiChartWidget({ title = 'Gráfico de sensores', selections = [], chartType = 'line', from, to, width, height }: SensorMultiChartWidgetProps) {
  const [seriesRaw, setSeriesRaw] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensorIdsKey = useMemo(() => [...selections.map((s) => s.sensorId)].sort().join(','), [selections]);
  const configured = selections.length > 0 && Boolean(from) && Boolean(to);

  useEffect(() => {
    if (!configured) {
      setSeriesRaw([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const session = getSession();
        const tenantId = telemetryTenantIdFromSession(session);
        const data = await fetchTelemetryWizardSeries({
          sensorIds: selections.map((s) => s.sensorId),
          from: from as string,
          to: to as string,
          tenant_id: tenantId,
        });
        if (!cancelled) setSeriesRaw(Array.isArray(data.series) ? data.series : []);
      } catch (err) {
        log.error('Error fetching sensor_multi_chart series:', err);
        if (!cancelled) setError((err as Error)?.message || 'No se pudo cargar la telemetría');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, sensorIdsKey, from, to]);

  const option = useMemo(() => {
    const bySensor = new Map<string, [string, number][]>();
    for (const row of seriesRaw) {
      if (!bySensor.has(row.sensor_id)) bySensor.set(row.sensor_id, []);
      bySensor.get(row.sensor_id)!.push([row.t, row.v]);
    }
    const sensorLabel = (sel: SensorSelection) => `${sel.name || sel.code}${sel.unit ? ` (${sel.unit})` : ''}`;
    const valuesOf = (sel: SensorSelection) => (bySensor.get(sel.sensorId) || []).map(([, v]) => v);
    const avgOf = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);

    if (chartType === 'radar') {
      const indicator = selections.map((sel) => {
        const max = Math.max(...valuesOf(sel), 0) * 1.15 || 1;
        return { name: sensorLabel(sel), max };
      });
      const value = selections.map((sel) => Number(avgOf(valuesOf(sel)).toFixed(2)));
      return {
        tooltip: {},
        legend: { top: 0, textStyle: { fontSize: 9 } },
        radar: { indicator, radius: '62%', axisName: { fontSize: 8, color: '#64748b' } },
        series: [{ type: 'radar', data: [{ value, name: 'Promedio' }] }],
        animation: false,
      };
    }

    if (chartType === 'pie' || chartType === 'donut') {
      const data = selections.map((sel) => ({ name: sensorLabel(sel), value: Number(avgOf(valuesOf(sel)).toFixed(2)) }));
      return {
        tooltip: { trigger: 'item' },
        legend: { top: 0, textStyle: { fontSize: 9 } },
        series: [
          {
            type: 'pie',
            radius: chartType === 'donut' ? ['40%', '70%'] : '65%',
            center: ['50%', '58%'],
            data,
            label: { fontSize: 9 },
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
        yAxis: { type: 'category', data: yCats, axisLabel: { fontSize: 9, color: '#94a3b8' }, splitArea: { show: true } },
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
      const data = selections.map((sel) => {
        const vals = [...valuesOf(sel)].sort((a, b) => a - b);
        if (!vals.length) return [0, 0, 0, 0, 0];
        return [vals[0], quantile(vals, 0.25), quantile(vals, 0.5), quantile(vals, 0.75), vals[vals.length - 1]].map((n) => Number(n.toFixed(2)));
      });
      return {
        tooltip: { trigger: 'item' },
        grid: { top: 16, right: 16, bottom: 54, left: 46 },
        xAxis: { type: 'category', data: selections.map(sensorLabel), axisLabel: { fontSize: 8, rotate: 30, color: '#94a3b8' } },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
          axisLabel: { fontSize: 9, color: '#94a3b8' },
        },
        series: [{ type: 'boxplot', data }],
        animation: false,
      };
    }

    const isLineFamily = chartType === 'area' || chartType === 'line' || chartType === 'step';
    const echartsType = isLineFamily ? 'line' : chartType === 'scatter' ? 'scatter' : 'bar';
    const series = selections.map((sel) => ({
      name: sensorLabel(sel),
      type: echartsType,
      data: bySensor.get(sel.sensorId) || [],
      smooth: chartType === 'line',
      step: chartType === 'step' ? ('middle' as const) : undefined,
      symbol: echartsType === 'scatter' ? 'circle' : 'none',
      ...(chartType === 'area' ? { areaStyle: {}, stack: 'total' } : {}),
    }));
    return {
      grid: { top: 28, right: 12, bottom: 24, left: 46 },
      legend: { top: 0, textStyle: { fontSize: 9 } },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'time', axisLabel: { fontSize: 9, color: '#94a3b8' } },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
        axisLabel: { fontSize: 9, color: '#94a3b8' },
      },
      series,
      animation: false,
    };
  }, [seriesRaw, selections, chartType]);

  return (
    <div
      className="sensor-multi-chart-widget-container"
      style={{ width, height, background: '#fff', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ color: '#6366f1' }}><Radar size={14} /></div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
          {title}
        </span>
      </div>
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
        ) : (
          // pointerEvents:'none' explícito acá también (además del contenedor
          // raíz arriba): ECharts/zrender crea su propio <canvas> con
          // listeners propios (tooltip, zoom) — sin esto, ese canvas podría
          // interceptar el mousedown antes de que llegue al Rect de Konva que
          // maneja arrastre/selección, dejando el bloque "atascado" tras
          // insertarse (antes de tener datos no había canvas de ECharts que
          // pudiera interceptar nada, por eso el síntoma solo aparece "una
          // vez insertado").
          <ReactECharts option={option} style={{ height: '100%', width: '100%', pointerEvents: 'none' }} />
        )}
      </div>
    </div>
  );
}

export default memo(SensorMultiChartWidget);
