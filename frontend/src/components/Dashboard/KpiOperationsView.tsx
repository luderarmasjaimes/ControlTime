import React, { memo, useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Gauge, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus, Cpu } from 'lucide-react';
import MiningWorkbenchHeader from './MiningWorkbenchHeader';
import { TELEMETRY_DEFAULT_TENANT_ID } from '../../auth/telemetryTenant';
import { fetchWithAuthRetry } from '../../lib/fetchWithAuth';
import { log } from '../../lib/logger';

/* ─────────────────────────────────────────────────────────────────────────────
   KPIs DE OPERACIÓN — Monitoreo → KPIs

   Tres bloques, cada uno atado a una fuente de datos REAL (nada simulado):

   1. KPIs corporativos: /api/mining/kpis (mining_runtime_kpis) — tonelaje,
      ley de cabeza, recuperación, dilución, TRIFR, disponibilidad mecánica…
      El backend y la tabla existían desde antes, pero NINGÚN menú los
      mostraba: solo el widget KPI dentro del editor de informes. Esta vista
      es su primer dashboard.

   2. Indicadores derivados de sensores: /api/sensors/data (mismo endpoint
      que Monitoreo→Sensores) — cumplimiento normativo PM10 y ruido,
      velocidad de inclinación del talud y disponibilidad de la red de
      sensores, calculados sobre el historial real de 7 días.

   3. Telemetría IoT/ThingsBoard: /api/mining/telemetry/summary (nuevo
      endpoint de lectura sobre sensors + telemetry_raw, ADR-034/054) — los
      dispositivos sincronizados desde ThingsBoard, agrupados por tipo, con
      última lectura, frescura y tendencia horaria. Hasta ahora esos ~2M de
      muestras por tipo eran invisibles para el frontend.
   ───────────────────────────────────────────────────────────────────────── */

interface KpiRow {
    code: string;
    category: string;
    title: string;
    description: string;
    unit: string;
    current_value: number;
    target_value: number;
    trend_direction: 'up' | 'down' | 'flat' | string;
    trend_percent: number;
    status_color: string;
}

/** Umbrales normativos de los indicadores derivados. Fuentes: ECA aire
 * D.S. 003-2017-MINAM (PM10 24h = 100 µg/m³) y exposición ocupacional a
 * ruido D.S. 024-2016-EM (85 dBA / 8h). La velocidad de talud usa el
 * criterio operativo interno (alerta > 0.5°/día). */
const PM10_LIMIT = 100;
const NOISE_LIMIT = 85;
const SLOPE_ALERT_DEG_PER_DAY = 0.5;

const STATUS_STYLES: Record<string, string> = {
    green: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
    yellow: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
    red: 'border-rose-500/35 bg-rose-500/10 text-rose-300',
};

function TrendBadge({ direction, percent }: { direction: string; percent: number }) {
    const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
    const color = direction === 'up' ? 'text-emerald-400' : direction === 'down' ? 'text-rose-400' : 'text-slate-400';
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${color}`}>
            <Icon size={12} />
            {percent > 0 ? '+' : ''}{Number(percent).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
        </span>
    );
}

/** Tarjeta KPI estilo ThingsBoard (value card + efficiency_progress_bar):
 * valor actual vs meta con barra de avance y tendencia. */
function KpiCard({ kpi }: { kpi: KpiRow }) {
    const hasTarget = Number.isFinite(kpi.target_value) && kpi.target_value !== 0;
    const ratio = hasTarget ? Math.max(0, Math.min(1.25, kpi.current_value / kpi.target_value)) : 0;
    const barColor = kpi.status_color === 'green' ? '#10b981' : kpi.status_color === 'red' ? '#ef4444' : '#f59e0b';
    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{kpi.title}</div>
                <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_STYLES[kpi.status_color] || STATUS_STYLES.yellow}`}>
                    {kpi.category.replace(/_/g, ' ')}
                </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-slate-100">
                    {Number(kpi.current_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-slate-500">{kpi.unit}</span>
                <span className="ml-auto"><TrendBadge direction={kpi.trend_direction} percent={kpi.trend_percent} /></span>
            </div>
            {hasTarget && (
                <div className="mt-3">
                    <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Meta: {Number(kpi.target_value).toLocaleString(undefined, { maximumFractionDigits: 2 })} {kpi.unit}</span>
                        <span>{Math.round(ratio * 100)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: barColor }} />
                    </div>
                </div>
            )}
            <div className="mt-2 text-[10px] leading-snug text-slate-600">{kpi.description}</div>
        </div>
    );
}

/** Pendiente (unidades/día) por regresión lineal simple sobre puntos
 * {t: ms, v} — velocidad de inclinación del talud. */
function slopePerDay(points: { t: number; v: number }[]): number | null {
    if (points.length < 3) return null;
    const n = points.length;
    const meanT = points.reduce((a, p) => a + p.t, 0) / n;
    const meanV = points.reduce((a, p) => a + p.v, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of points) {
        num += (p.t - meanT) * (p.v - meanV);
        den += (p.t - meanT) * (p.t - meanT);
    }
    if (den === 0) return null;
    return (num / den) * 86400000; // por ms → por día
}

interface DerivedCard {
    label: string;
    value: string;
    note: string;
    status: 'green' | 'yellow' | 'red' | 'gray';
}

const DERIVED_STATUS: Record<string, string> = {
    green: 'text-emerald-400',
    yellow: 'text-amber-400',
    red: 'text-rose-400',
    gray: 'text-slate-400',
};

interface KpiOperationsViewProps {
    telemetryTenantId?: string;
}

const KpiOperationsView = ({ telemetryTenantId = TELEMETRY_DEFAULT_TENANT_ID }: KpiOperationsViewProps) => {
    const [kpis, setKpis] = useState<KpiRow[]>([]);
    const [sensorData, setSensorData] = useState<any>({ sensors: [], sensor_types: [], history: [] });
    const [iot, setIot] = useState<{ sensors: any[]; series: any[]; window_hours: number }>({ sensors: [], series: [], window_hours: 168 });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const fetchAll = async () => {
        try {
            setLoadError(null);
            const [kpiRes, sensRes, iotRes] = await Promise.all([
                fetchWithAuthRetry(new URL('/api/mining/kpis', window.location.origin).toString()),
                fetchWithAuthRetry((() => {
                    const u = new URL('/api/sensors/data', window.location.origin);
                    if (telemetryTenantId) u.searchParams.set('tenant_id', telemetryTenantId);
                    return u.toString();
                })()),
                fetchWithAuthRetry(new URL('/api/mining/telemetry/summary?hours=168', window.location.origin).toString()),
            ]);
            if (kpiRes.ok) {
                const j = await kpiRes.json();
                setKpis(Array.isArray(j?.kpis) ? j.kpis : Array.isArray(j) ? j : []);
            }
            if (sensRes.ok) {
                const j = await sensRes.json();
                setSensorData({ sensors: j.sensors || [], sensor_types: j.sensor_types || [], history: j.history || [] });
            }
            if (iotRes.ok) {
                const j = await iotRes.json();
                setIot({ sensors: j.sensors || [], series: j.series || [], window_hours: j.window_hours || 168 });
            }
            if (!kpiRes.ok && !sensRes.ok && !iotRes.ok) {
                setLoadError('No se pudo cargar ninguna fuente de indicadores');
            }
        } catch (err) {
            log.error('KpiOperationsView fetch', err);
            setLoadError('Error de red al cargar indicadores');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 60000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [telemetryTenantId]);

    // ── Bloque 2: indicadores derivados del historial real de sensores ──
    const derived = useMemo((): DerivedCard[] => {
        const { sensors, sensor_types, history } = sensorData;
        const typeByName = (needle: string) =>
            sensor_types.filter((t: any) => String(t.name || '').toLowerCase().includes(needle));
        const historyOfTypes = (types: any[]) => {
            const sensorIds = new Set(
                sensors.filter((s: any) => types.some((t: any) => t.id === s.type_id)).map((s: any) => s.id),
            );
            return history.filter((h: any) => sensorIds.has(h.sensor_id));
        };
        const compliance = (rows: any[], limit: number) => {
            const vals = rows.map((h: any) => Number(h.value)).filter(Number.isFinite);
            if (vals.length === 0) return null;
            return (vals.filter((v) => v <= limit).length / vals.length) * 100;
        };

        const cards: DerivedCard[] = [];

        const pm10 = compliance(historyOfTypes(typeByName('pm10')), PM10_LIMIT);
        cards.push({
            label: 'Cumplimiento PM10 · ECA aire',
            value: pm10 == null ? 's/d' : `${pm10.toFixed(1)}%`,
            note: `Muestras 7d ≤ ${PM10_LIMIT} µg/m³ (D.S. 003-2017-MINAM)`,
            status: pm10 == null ? 'gray' : pm10 >= 98 ? 'green' : pm10 >= 90 ? 'yellow' : 'red',
        });

        const noise = compliance(historyOfTypes(typeByName('ruido')), NOISE_LIMIT);
        cards.push({
            label: 'Cumplimiento ruido · exposición',
            value: noise == null ? 's/d' : `${noise.toFixed(1)}%`,
            note: `Muestras 7d ≤ ${NOISE_LIMIT} dB (D.S. 024-2016-EM)`,
            status: noise == null ? 'gray' : noise >= 98 ? 'green' : noise >= 90 ? 'yellow' : 'red',
        });

        const inclRows = historyOfTypes(typeByName('inclina'))
            .map((h: any) => ({ t: new Date(h.timestamp).getTime(), v: Number(h.value) }))
            .filter((p: any) => Number.isFinite(p.t) && Number.isFinite(p.v))
            .sort((a: any, b: any) => a.t - b.t);
        const slope = slopePerDay(inclRows);
        cards.push({
            label: 'Velocidad de talud',
            value: slope == null ? 's/d' : `${slope >= 0 ? '+' : ''}${slope.toFixed(3)} °/día`,
            note: `Regresión sobre inclinómetros 7d · alerta > ${SLOPE_ALERT_DEG_PER_DAY}°/día`,
            status: slope == null ? 'gray' : Math.abs(slope) <= SLOPE_ALERT_DEG_PER_DAY * 0.5 ? 'green'
                : Math.abs(slope) <= SLOPE_ALERT_DEG_PER_DAY ? 'yellow' : 'red',
        });

        const online = sensors.filter((s: any) => String(s.status).toLowerCase() === 'online').length;
        const avail = sensors.length > 0 ? (online / sensors.length) * 100 : null;
        cards.push({
            label: 'Disponibilidad red de sensores',
            value: avail == null ? 's/d' : `${avail.toFixed(1)}%`,
            note: `${online}/${sensors.length} sensores en línea`,
            status: avail == null ? 'gray' : avail >= 95 ? 'green' : avail >= 80 ? 'yellow' : 'red',
        });

        return cards;
    }, [sensorData]);

    // ── Bloque 3: telemetría IoT/ThingsBoard agregada por tipo ──────────
    const iotByType = useMemo(() => {
        const groups = new Map<string, { sensors: any[]; series: { t: number; v: number }[] }>();
        iot.sensors.forEach((s: any) => {
            if (!groups.has(s.type)) groups.set(s.type, { sensors: [], series: [] });
            groups.get(s.type)!.sensors.push(s);
        });
        // Serie horaria promedio del TIPO: promedia los promedios horarios de
        // sus sensores (los buckets ya vienen por hora del backend).
        const byHour = new Map<string, Map<number, { sum: number; n: number }>>();
        const typeById = new Map<string, string>(iot.sensors.map((s: any) => [s.id, s.type]));
        iot.series.forEach((p: any) => {
            const type = typeById.get(p.sensor_id);
            if (!type) return;
            const t = new Date(p.t).getTime();
            if (!Number.isFinite(t)) return;
            if (!byHour.has(type)) byHour.set(type, new Map());
            const m = byHour.get(type)!;
            const cur = m.get(t) || { sum: 0, n: 0 };
            cur.sum += Number(p.v);
            cur.n += 1;
            m.set(t, cur);
        });
        byHour.forEach((m, type) => {
            const g = groups.get(type);
            if (!g) return;
            g.series = Array.from(m.entries())
                .map(([t, { sum, n }]) => ({ t, v: sum / n }))
                .sort((a, b) => a.t - b.t);
        });
        return Array.from(groups.entries());
    }, [iot]);

    const iotSparkOption = (series: { t: number; v: number }[]) => ({
        backgroundColor: 'transparent',
        grid: { top: 4, bottom: 4, left: 4, right: 4 },
        xAxis: { type: 'time', show: false },
        yAxis: { type: 'value', show: false, scale: true },
        series: [{
            type: 'line',
            data: series.map((p) => [p.t, p.v]),
            showSymbol: false,
            smooth: 0.3,
            lineStyle: { width: 1.5, color: '#38bdf8' },
            areaStyle: {
                color: {
                    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: 'rgba(56,189,248,0.25)' },
                        { offset: 1, color: 'rgba(56,189,248,0)' },
                    ],
                },
            },
        }],
    });

    const freshness = (lastAt: string) => {
        const t = new Date(lastAt).getTime();
        if (!Number.isFinite(t)) return 'sin lecturas';
        const mins = Math.round((Date.now() - t) / 60000);
        if (mins < 60) return `hace ${mins} min`;
        if (mins < 2880) return `hace ${Math.round(mins / 60)} h`;
        return `hace ${Math.round(mins / 1440)} días`;
    };

    if (loading) {
        return (
            <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center bg-[#020617] p-8 text-slate-400">
                <Gauge className="mb-3 animate-pulse text-sky-500" size={40} />
                <span className="mining-workbench-page-subtitle text-center !text-slate-500">Cargando indicadores…</span>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#020617] p-4 font-sans text-slate-200 sm:p-6">
            <MiningWorkbenchHeader
                title="KPIs de operación"
                subtitle="Indicadores corporativos, cumplimiento derivado de sensores y telemetría IoT sincronizada."
                icon={Gauge}
                actions={
                    <button
                        type="button"
                        onClick={() => { setRefreshing(true); fetchAll(); }}
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
                    <div>{loadError}</div>
                </div>
            )}

            {/* ── 1. KPIs corporativos ─────────────────────────────────── */}
            <h2 className="mb-3 text-sm font-bold tracking-wide text-sky-300">KPIs corporativos de la operación</h2>
            {kpis.length === 0 ? (
                <div className="mb-6 rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-6 text-center text-sm text-slate-500">
                    Sin KPIs registrados. Use “Sincronizar KPIs” en el editor de informes o el endpoint /api/mining/kpis/upsert.
                </div>
            ) : (
                <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {kpis.map((k) => <KpiCard key={k.code} kpi={k} />)}
                </div>
            )}

            {/* ── 2. Indicadores derivados de sensores ─────────────────── */}
            <h2 className="mb-3 text-sm font-bold tracking-wide text-sky-300">Cumplimiento y estabilidad (derivado de sensores · 7 días)</h2>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {derived.map((c) => (
                    <div key={c.label} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 backdrop-blur-sm">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{c.label}</div>
                        <div className={`mt-2 font-mono text-2xl font-bold ${DERIVED_STATUS[c.status]}`}>{c.value}</div>
                        <div className="mt-2 text-[10px] leading-snug text-slate-600">{c.note}</div>
                    </div>
                ))}
            </div>

            {/* ── 3. Telemetría IoT / ThingsBoard sincronizada ─────────── */}
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-wide text-sky-300">
                <Cpu size={14} />
                Telemetría IoT sincronizada (ThingsBoard · ventana {Math.round(iot.window_hours / 24)} días)
            </h2>
            {iotByType.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-6 text-center text-sm text-slate-500">
                    Sin dispositivos IoT sincronizados en la tabla de telemetría.
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
                    {iotByType.map(([type, g]) => {
                        const withValue = g.sensors.filter((s: any) => Number.isFinite(Number(s.last_value)));
                        const avgLast = withValue.length > 0
                            ? withValue.reduce((a: number, s: any) => a + Number(s.last_value), 0) / withValue.length
                            : null;
                        const lastAt = g.sensors
                            .map((s: any) => s.last_at)
                            .filter(Boolean)
                            .sort()
                            .pop();
                        const samples = g.sensors.reduce((a: number, s: any) => a + Number(s.samples_window || 0), 0);
                        return (
                            <div key={type} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 backdrop-blur-sm">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{type}</div>
                                    <span className="shrink-0 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
                                        {g.sensors.length} disp.
                                    </span>
                                </div>
                                <div className="mt-2 flex items-baseline gap-2">
                                    <span className="font-mono text-2xl font-bold text-slate-100">
                                        {avgLast == null ? 's/d' : avgLast.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-xs text-slate-500">últ. valor prom.</span>
                                </div>
                                <div className="mt-1 h-[46px]">
                                    {g.series.length > 1
                                        ? <ReactECharts option={iotSparkOption(g.series)} style={{ height: '100%', width: '100%' }} notMerge />
                                        : <div className="flex h-full items-center text-[10px] text-slate-600">Sin serie en la ventana</div>}
                                </div>
                                <div className="mt-1 flex justify-between text-[10px] text-slate-600">
                                    <span>{samples.toLocaleString()} muestras</span>
                                    <span>{lastAt ? freshness(lastAt) : 'sin lecturas'}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default memo(KpiOperationsView);
