import React, { memo, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

/* ─────────────────────────────────────────────────────────────────────────────
   SENSOR WIDGETS — familias de widget portadas de ThingsBoard CE
   (C:\thingsboard-master → ui-ngx widget library / system widget_types).

   Análisis 2026-07-18 contra los 522 widget_types de ThingsBoard: las
   familias con valor para esta plataforma Y con datos reales disponibles en
   /api/sensors/data (sensors.current_value + sensor_types.unit + history +
   status) son tres — gauge radial con zonas, tarjetas de agregación y
   doughnut de distribución. Las familias descartadas (tanques de líquido,
   battery_level, signal_strength/RSSI, gateway/edge) NO tienen columnas de
   respaldo en el esquema `sensors` (verificado contra sensors_db) — se
   implementarán cuando la telemetría transporte esos campos, no antes:
   un widget sobre datos inventados es peor que ningún widget.
   ───────────────────────────────────────────────────────────────────────── */

/** Zonas de color del gauge derivadas del rango observado del propio sensor
 * (historial de 7 días) — el esquema no tiene umbrales por sensor todavía,
 * así que se usa el criterio estándar de ThingsBoard para gauges sin
 * configuración explícita: verde hasta el 75% del rango, ámbar hasta el
 * 90%, rojo el resto. El rango se acolcha ±12% para que el valor actual no
 * quede pegado a los extremos del arco. */
export function deriveGaugeBounds(values: number[], currentValue: number): {
    min: number; max: number; warn: number; crit: number;
} {
    const finite = values.filter((v) => Number.isFinite(v));
    const base = finite.length > 0 ? finite : [currentValue];
    let min = Math.min(...base, currentValue);
    let max = Math.max(...base, currentValue);
    const span = Math.max(max - min, Math.abs(max) * 0.1, 1e-6);
    min -= span * 0.12;
    max += span * 0.12;
    const range = max - min;
    return { min, max, warn: min + range * 0.75, crit: min + range * 0.9 };
}

interface RadialGaugeWidgetProps {
    value: number;
    unit: string;
    title: string;
    min: number;
    max: number;
    /** Inicio de la zona ámbar (valor absoluto, no %). */
    warn: number;
    /** Inicio de la zona roja (valor absoluto, no %). */
    crit: number;
}

/** Gauge radial estilo ThingsBoard (analogue_radial_gauge /
 * digital_speedometer): arco con zonas verde→ámbar→rojo, aguja y valor
 * grande al centro. */
export const RadialGaugeWidget = memo(function RadialGaugeWidget({
    value, unit, title, min, max, warn, crit,
}: RadialGaugeWidgetProps) {
    const option = useMemo(() => {
        const range = Math.max(max - min, 1e-6);
        const warnStop = Math.min(1, Math.max(0, (warn - min) / range));
        const critStop = Math.min(1, Math.max(0, (crit - min) / range));
        return {
            backgroundColor: 'transparent',
            series: [{
                type: 'gauge',
                min,
                max,
                startAngle: 210,
                endAngle: -30,
                splitNumber: 4,
                axisLine: {
                    lineStyle: {
                        width: 14,
                        color: [
                            [warnStop, '#10b981'],
                            [critStop, '#f59e0b'],
                            [1, '#ef4444'],
                        ],
                    },
                },
                pointer: { width: 4, length: '58%', itemStyle: { color: '#e2e8f0' } },
                axisTick: { distance: -14, length: 4, lineStyle: { color: 'rgba(226,232,240,0.35)' } },
                splitLine: { distance: -14, length: 10, lineStyle: { color: 'rgba(226,232,240,0.45)', width: 1 } },
                axisLabel: {
                    distance: -32,
                    color: '#64748b',
                    fontSize: 9,
                    formatter: (v: number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }),
                },
                anchor: { show: true, size: 8, itemStyle: { color: '#e2e8f0' } },
                title: { show: false },
                detail: {
                    valueAnimation: true,
                    offsetCenter: [0, '68%'],
                    formatter: (v: number) =>
                        `{val|${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}}\n{unit|${unit || ''}}`,
                    rich: {
                        val: { color: '#38bdf8', fontSize: 22, fontWeight: 700, fontFamily: 'monospace' },
                        unit: { color: '#64748b', fontSize: 11, padding: [2, 0, 0, 0] },
                    },
                },
                data: [{ value }],
            }],
        };
    }, [value, unit, min, max, warn, crit]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="mb-1 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</div>
            <div className="min-h-0 flex-1">
                <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />
            </div>
        </div>
    );
});

interface AggregationCardsProps {
    values: number[];
    unit: string;
}

/** Tarjetas de agregación estilo ThingsBoard (value/aggregation cards):
 * mínimo, promedio, máximo y último valor de la serie seleccionada. */
export const AggregationCards = memo(function AggregationCards({ values, unit }: AggregationCardsProps) {
    const stats = useMemo(() => {
        const finite = values.filter((v) => Number.isFinite(v));
        if (finite.length === 0) return null;
        const sum = finite.reduce((a, b) => a + b, 0);
        return {
            min: Math.min(...finite),
            avg: sum / finite.length,
            max: Math.max(...finite),
            last: finite[finite.length - 1],
            n: finite.length,
        };
    }, [values]);

    const fmt = (v: number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

    if (!stats) {
        return <div className="flex h-full items-center justify-center text-xs text-slate-600">Sin datos en el periodo</div>;
    }

    const cells: { label: string; value: string; accent: string }[] = [
        { label: 'Mínimo', value: fmt(stats.min), accent: 'text-emerald-400' },
        { label: 'Promedio', value: fmt(stats.avg), accent: 'text-sky-400' },
        { label: 'Máximo', value: fmt(stats.max), accent: 'text-amber-400' },
        { label: 'Último', value: fmt(stats.last), accent: 'text-slate-100' },
    ];

    return (
        <div className="grid h-full grid-cols-2 content-center gap-2">
            {cells.map((c) => (
                <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{c.label}</div>
                    <div className={`mt-0.5 font-mono text-lg font-bold ${c.accent}`}>
                        {c.value} <span className="text-[10px] font-normal text-slate-500">{unit}</span>
                    </div>
                </div>
            ))}
        </div>
    );
});

interface StatusDonutWidgetProps {
    sensors: { status?: string | null }[];
    title: string;
}

const STATUS_COLORS: Record<string, string> = {
    online: '#10b981',
    ok: '#10b981',
    warning: '#f59e0b',
    degraded: '#f59e0b',
    critical: '#ef4444',
    alarm: '#ef4444',
    offline: '#475569',
    down: '#475569',
};

/** Doughnut de distribución estilo ThingsBoard (doughnut / entity count):
 * sensores del ámbito visible agrupados por estado, con el total al centro. */
export const StatusDonutWidget = memo(function StatusDonutWidget({ sensors, title }: StatusDonutWidgetProps) {
    const option = useMemo(() => {
        const counts = new Map<string, number>();
        sensors.forEach((s) => {
            const key = String(s.status || 'desconocido').toLowerCase();
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        const data = Array.from(counts.entries()).map(([name, value]) => ({
            name,
            value,
            itemStyle: { color: STATUS_COLORS[name] || '#64748b' },
        }));
        return {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                borderColor: '#334155',
                textStyle: { color: '#fff' },
                formatter: '{b}: {c} ({d}%)',
            },
            legend: {
                bottom: 0,
                textStyle: { color: '#94a3b8', fontSize: 10 },
                itemWidth: 10,
                itemHeight: 10,
                icon: 'circle',
            },
            series: [{
                type: 'pie',
                radius: ['52%', '74%'],
                center: ['50%', '44%'],
                avoidLabelOverlap: true,
                itemStyle: { borderColor: '#020617', borderWidth: 2 },
                label: {
                    show: true,
                    position: 'center',
                    formatter: () => `{n|${sensors.length}}\n{t|sensores}`,
                    rich: {
                        n: { color: '#e2e8f0', fontSize: 20, fontWeight: 700, fontFamily: 'monospace' },
                        t: { color: '#64748b', fontSize: 10 },
                    },
                },
                labelLine: { show: false },
                data,
            }],
        };
    }, [sensors]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="mb-1 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</div>
            <div className="min-h-0 flex-1">
                <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />
            </div>
        </div>
    );
});
