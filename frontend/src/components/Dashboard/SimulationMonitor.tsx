import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { Activity, AlertTriangle, RefreshCw, Gauge } from 'lucide-react';
import MiningWorkbenchHeader from './MiningWorkbenchHeader';
import { TELEMETRY_DEFAULT_TENANT_ID } from '../../auth/telemetryTenant';
import { fetchWithAuthRetry } from '../../lib/fetchWithAuth';

import { log } from '../../lib/logger';

// ADR-136: panel de monitoreo de la simulación de 1h contra board.beemetry.com
// (tb-sync-sim-1h, fuera de este repo/alcance) -- consume el endpoint nuevo
// GET /api/mining/simulation/live-status, que sólo lee agregados de
// telemetry_fact (crudo, ADR-131) y telemetry_fact_calc (métricas calculadas
// por lectura, poblada por un script externo, no por este backend). Poll cada
// 5s (no 15s como AdvancedSensors.tsx): la simulación se mueve más rápido que
// la telemetría normal y el objetivo es observarla en vivo.
const POLL_MS = 5000;
const MAX_POINTS = 120; // 10 minutos de historial de polls a 5s

interface RawLatestRow {
    sensor_code?: string;
    sensor_type?: string;
    value_numeric?: number;
    captured_at?: string;
}

interface CalcLatestRow {
    sensor_code?: string;
    metric_code?: string;
    value_numeric?: number;
    alert_level?: string;
    captured_at?: string;
}

interface LiveStatusResponse {
    tenant_id: string;
    generated_at: string;
    raw: { count_total: number; count_last_hour: number; latest: RawLatestRow[] };
    calc: { count_total: number; count_last_hour: number; latest: CalcLatestRow[] };
}

interface HistoryPoint {
    t: number;
    rawTotal: number;
    rawLastHour: number;
    calcTotal: number;
    calcLastHour: number;
}

const emptyStatus: LiveStatusResponse = {
    tenant_id: '',
    generated_at: '',
    raw: { count_total: 0, count_last_hour: 0, latest: [] },
    calc: { count_total: 0, count_last_hour: 0, latest: [] },
};

function alertBadgeClass(level: unknown): string {
    const s = String(level || '').toLowerCase();
    if (s === 'critical') return 'bg-rose-500/15 text-rose-200 border-rose-500/35';
    if (s === 'warning') return 'bg-amber-500/15 text-amber-200 border-amber-500/35';
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35';
}

function sparklineOption(points: HistoryPoint[], key: 'rawTotal' | 'calcTotal', color: string, label: string) {
    const data = points.map((p) => [p.t, p[key]]);
    return {
        backgroundColor: 'transparent',
        grid: { top: 28, bottom: 24, left: 48, right: 16 },
        title: {
            text: label,
            left: 8,
            top: 4,
            textStyle: { color: '#94a3b8', fontSize: 11, fontWeight: 600 },
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: '#334155',
            textStyle: { color: '#fff' },
            formatter: (params: any) => {
                const p = params[0];
                const tlabel = new Date(p.value[0]).toLocaleTimeString();
                return `${tlabel}<br/><b>${Number(p.value[1]).toLocaleString()}</b>`;
            },
        },
        xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: '#334155' } },
            axisLabel: { color: '#64748b', fontSize: 9 },
            splitLine: { show: false },
        },
        yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: '#64748b', fontSize: 9 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [
            {
                type: 'line',
                smooth: 0.3,
                showSymbol: false,
                data,
                lineStyle: { width: 2, color },
                areaStyle: {
                    color: {
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: `${color}38` },
                            { offset: 1, color: `${color}00` },
                        ],
                    },
                },
            },
        ],
    };
}

interface SimulationMonitorProps {
    telemetryTenantId?: string;
}

const SimulationMonitor = ({ telemetryTenantId = TELEMETRY_DEFAULT_TENANT_ID }: SimulationMonitorProps) => {
    const [status, setStatus] = useState<LiveStatusResponse>(emptyStatus);
    const [history, setHistory] = useState<HistoryPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const historyRef = useRef<HistoryPoint[]>([]);

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            try {
                if (typeof process !== 'undefined' && (process as any).env?.VITEST) {
                    return;
                }
                const url = new URL('/api/mining/simulation/live-status', window.location.origin);
                if (telemetryTenantId) url.searchParams.set('tenant_id', telemetryTenantId);
                const res = await fetchWithAuthRetry(url.toString());
                const text = await res.text();
                let json: any = {};
                try {
                    json = text ? JSON.parse(text) : {};
                } catch {
                    if (!cancelled) setLoadError('Respuesta no válida del servidor');
                    return;
                }
                if (!res.ok) {
                    if (!cancelled) setLoadError(json.error || `Error HTTP ${res.status}`);
                    return;
                }
                if (cancelled) return;
                setLoadError(null);
                const next: LiveStatusResponse = {
                    tenant_id: json.tenant_id || '',
                    generated_at: json.generated_at || '',
                    raw: {
                        count_total: Number(json.raw?.count_total) || 0,
                        count_last_hour: Number(json.raw?.count_last_hour) || 0,
                        latest: json.raw?.latest || [],
                    },
                    calc: {
                        count_total: Number(json.calc?.count_total) || 0,
                        count_last_hour: Number(json.calc?.count_last_hour) || 0,
                        latest: json.calc?.latest || [],
                    },
                };
                setStatus(next);
                setHasLoadedOnce(true);

                const point: HistoryPoint = {
                    t: Date.now(),
                    rawTotal: next.raw.count_total,
                    rawLastHour: next.raw.count_last_hour,
                    calcTotal: next.calc.count_total,
                    calcLastHour: next.calc.count_last_hour,
                };
                const updated = [...historyRef.current, point].slice(-MAX_POINTS);
                historyRef.current = updated;
                setHistory(updated);
            } catch (err) {
                log.error('Error fetching simulation live-status:', err);
                if (!cancelled) setLoadError('No se pudo conectar con /api/mining/simulation/live-status');
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        };

        setLoading(true);
        poll();
        const interval = setInterval(poll, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [telemetryTenantId]);

    const manualRefresh = () => {
        setRefreshing(true);
        const url = new URL('/api/mining/simulation/live-status', window.location.origin);
        if (telemetryTenantId) url.searchParams.set('tenant_id', telemetryTenantId);
        fetchWithAuthRetry(url.toString())
            .then(async (res) => {
                const text = await res.text();
                let json: any = {};
                try {
                    json = text ? JSON.parse(text) : {};
                } catch {
                    setLoadError('Respuesta no válida del servidor');
                    return;
                }
                if (!res.ok) {
                    setLoadError(json.error || `Error HTTP ${res.status}`);
                    return;
                }
                setLoadError(null);
                setStatus({
                    tenant_id: json.tenant_id || '',
                    generated_at: json.generated_at || '',
                    raw: {
                        count_total: Number(json.raw?.count_total) || 0,
                        count_last_hour: Number(json.raw?.count_last_hour) || 0,
                        latest: json.raw?.latest || [],
                    },
                    calc: {
                        count_total: Number(json.calc?.count_total) || 0,
                        count_last_hour: Number(json.calc?.count_last_hour) || 0,
                        latest: json.calc?.latest || [],
                    },
                });
                setHasLoadedOnce(true);
            })
            .catch(() => setLoadError('Error de red al actualizar'))
            .finally(() => setRefreshing(false));
    };

    const rawSparkOption = useMemo(
        () => sparklineOption(history, 'rawTotal', '#38bdf8', 'Ingesta cruda -- total acumulado (telemetry_fact)'),
        [history],
    );
    const calcSparkOption = useMemo(
        () => sparklineOption(history, 'calcTotal', '#a78bfa', 'Métricas calculadas -- total acumulado (telemetry_fact_calc)'),
        [history],
    );

    if (loading && !hasLoadedOnce && !loadError) {
        return (
            <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center bg-[#020617] p-8 text-slate-400">
                <Activity className="mb-3 animate-pulse text-sky-500" size={40} />
                <span className="mining-workbench-page-subtitle text-center !text-slate-500">Cargando estado de la simulación…</span>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#020617] p-4 font-sans text-slate-200 sm:p-6">
            <MiningWorkbenchHeader
                title="Monitor de simulación"
                subtitle="Ingesta cruda vs. métricas calculadas en vivo (ADR-136). Actualiza cada 5s."
                icon={Gauge}
                actions={
                    <button
                        type="button"
                        onClick={manualRefresh}
                        disabled={refreshing}
                        className="mining-workbench-action-btn inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                }
            />

            {loadError && (
                <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-500/35 bg-rose-950/40 p-4 text-sm text-rose-100">
                    <AlertTriangle className="mt-0.5 shrink-0 text-rose-400" size={20} />
                    <div>
                        <div className="font-bold">No se pudo cargar el estado de la simulación</div>
                        <div className="mt-1 text-rose-200/85">{loadError}</div>
                    </div>
                </div>
            )}

            <div className="grid shrink-0 grid-cols-1 gap-4 pb-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 backdrop-blur-sm">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Crudo · total</div>
                    <div className="font-mono text-2xl font-bold text-sky-400">{status.raw.count_total.toLocaleString()}</div>
                    <div className="mt-2 text-[11px] text-slate-500">telemetry_fact</div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 backdrop-blur-sm">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Crudo · última hora</div>
                    <div className="font-mono text-2xl font-bold text-sky-300">{status.raw.count_last_hour.toLocaleString()}</div>
                    <div className="mt-2 text-[11px] text-slate-500">Ventana móvil de 1h</div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 backdrop-blur-sm">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Calculado · total</div>
                    <div className="font-mono text-2xl font-bold text-violet-400">{status.calc.count_total.toLocaleString()}</div>
                    <div className="mt-2 text-[11px] text-slate-500">telemetry_fact_calc</div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 backdrop-blur-sm">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Calculado · última hora</div>
                    <div className="font-mono text-2xl font-bold text-violet-300">{status.calc.count_last_hour.toLocaleString()}</div>
                    <div className="mt-2 text-[11px] text-slate-500">Ventana móvil de 1h</div>
                </div>
            </div>

            <div className="grid shrink-0 grid-cols-1 gap-4 pb-4 lg:grid-cols-2">
                <div className="h-[220px] rounded-2xl border border-slate-800 bg-slate-950/50 p-2 backdrop-blur-sm">
                    {history.length > 1 ? (
                        <ReactECharts option={rawSparkOption} style={{ height: '100%', width: '100%' }} notMerge />
                    ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-600">
                            Esperando más lecturas para graficar la tendencia…
                        </div>
                    )}
                </div>
                <div className="h-[220px] rounded-2xl border border-slate-800 bg-slate-950/50 p-2 backdrop-blur-sm">
                    {history.length > 1 ? (
                        <ReactECharts option={calcSparkOption} style={{ height: '100%', width: '100%' }} notMerge />
                    ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-600">
                            Esperando más lecturas para graficar la tendencia…
                        </div>
                    )}
                </div>
            </div>

            <div className="grid min-h-0 grid-cols-1 gap-5 pb-4 lg:grid-cols-2">
                <div className="flex min-h-[260px] flex-col rounded-2xl border border-slate-800 bg-slate-950/50 shadow-xl backdrop-blur-sm">
                    <div className="border-b border-slate-800 bg-slate-900/40 p-4">
                        <h2 className="text-sm font-bold tracking-wide text-sky-300" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                            Últimas lecturas crudas
                        </h2>
                        <span className="text-xs text-slate-500" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                            telemetry_fact -- hasta 20 filas
                        </span>
                    </div>
                    <div className="adv-scroll flex-1 overflow-y-auto">
                        {status.raw.latest.length === 0 ? (
                            <p className="p-4 text-sm text-slate-500">Sin lecturas todavía.</p>
                        ) : (
                            <table className="w-full text-left text-xs">
                                <thead className="sticky top-0 bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th className="px-4 py-2">Sensor</th>
                                        <th className="px-4 py-2">Tipo</th>
                                        <th className="px-4 py-2">Valor</th>
                                        <th className="px-4 py-2">Captura</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {status.raw.latest.map((row, i) => (
                                        <tr key={`${row.sensor_code}-${row.captured_at}-${i}`} className="border-t border-slate-900">
                                            <td className="truncate px-4 py-2 font-semibold text-slate-200">{row.sensor_code || '—'}</td>
                                            <td className="px-4 py-2 text-slate-400">{row.sensor_type || '—'}</td>
                                            <td className="px-4 py-2 font-mono text-sky-400">
                                                {row.value_numeric != null ? Number(row.value_numeric).toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'}
                                            </td>
                                            <td className="px-4 py-2 text-slate-500">
                                                {row.captured_at ? new Date(row.captured_at).toLocaleTimeString() : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div className="flex min-h-[260px] flex-col rounded-2xl border border-slate-800 bg-slate-950/50 shadow-xl backdrop-blur-sm">
                    <div className="border-b border-slate-800 bg-slate-900/40 p-4">
                        <h2 className="text-sm font-bold tracking-wide text-violet-300" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                            Últimas métricas calculadas
                        </h2>
                        <span className="text-xs text-slate-500" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                            telemetry_fact_calc -- hasta 20 filas
                        </span>
                    </div>
                    <div className="adv-scroll flex-1 overflow-y-auto">
                        {status.calc.latest.length === 0 ? (
                            <p className="p-4 text-sm text-slate-500">
                                Sin filas todavía -- el script externo de cálculo (ADR-136) aún no escribió en telemetry_fact_calc.
                            </p>
                        ) : (
                            <table className="w-full text-left text-xs">
                                <thead className="sticky top-0 bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th className="px-4 py-2">Sensor</th>
                                        <th className="px-4 py-2">Métrica</th>
                                        <th className="px-4 py-2">Valor</th>
                                        <th className="px-4 py-2">Alerta</th>
                                        <th className="px-4 py-2">Captura</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {status.calc.latest.map((row, i) => (
                                        <tr key={`${row.sensor_code}-${row.metric_code}-${row.captured_at}-${i}`} className="border-t border-slate-900">
                                            <td className="truncate px-4 py-2 font-semibold text-slate-200">{row.sensor_code || '—'}</td>
                                            <td className="px-4 py-2 text-slate-400">{row.metric_code || '—'}</td>
                                            <td className="px-4 py-2 font-mono text-violet-400">
                                                {row.value_numeric != null ? Number(row.value_numeric).toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'}
                                            </td>
                                            <td className="px-4 py-2">
                                                <span className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase ${alertBadgeClass(row.alert_level)}`}>
                                                    {row.alert_level || 'normal'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 text-slate-500">
                                                {row.captured_at ? new Date(row.captured_at).toLocaleTimeString() : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
                .adv-scroll::-webkit-scrollbar { width: 5px; }
                .adv-scroll::-webkit-scrollbar-track { background: transparent; }
                .adv-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
                .adv-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }
            `}</style>
        </div>
    );
};

export default memo(SimulationMonitor);
