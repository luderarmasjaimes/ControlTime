import React, { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Activity, AlertTriangle, RefreshCw, Radio, MapPin } from 'lucide-react';
import MiningWorkbenchHeader from './MiningWorkbenchHeader.jsx';
import { TELEMETRY_DEFAULT_TENANT_ID } from '../../auth/telemetryTenant';

const defaultScope = {
    telemetryTenantId: TELEMETRY_DEFAULT_TENANT_ID,
};

function statusBadgeClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'online' || s === 'ok') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35';
    if (s === 'warning' || s === 'degraded') return 'bg-amber-500/15 text-amber-200 border-amber-500/35';
    if (s === 'critical' || s === 'alarm') return 'bg-rose-500/15 text-rose-200 border-rose-500/35';
    if (s === 'offline' || s === 'down') return 'bg-slate-700 text-slate-400 border-slate-600';
    return 'bg-slate-800 text-slate-400 border-slate-700';
}

const AdvancedSensors = ({ telemetryTenantId = defaultScope.telemetryTenantId }) => {
    const [data, setData] = useState({ categories: [], sensor_types: [], sensors: [], history: [] });
    const [selectedCategoryId, setSelectedCategoryId] = useState(1);
    const [selectedSensorId, setSelectedSensorId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const fetchData = async () => {
            try {
                if (typeof process !== 'undefined' && process.env?.VITEST) {
                    return;
                }
                setLoadError(null);
                const url = new URL('/api/sensors/data', window.location.origin);
                if (telemetryTenantId) url.searchParams.set('tenant_id', telemetryTenantId);
                const res = await fetch(url.toString());
                const text = await res.text();
                let json = {};
                try {
                    json = text ? JSON.parse(text) : {};
                } catch {
                    if (!cancelled) {
                        setLoadError('Respuesta no válida del servidor');
                        setLoading(false);
                        setRefreshing(false);
                    }
                    return;
                }
                if (!res.ok) {
                    if (!cancelled) {
                        setLoadError(json.error || `Error HTTP ${res.status}`);
                        setData({ categories: [], sensor_types: [], sensors: [], history: [] });
                    }
                    return;
                }
                if (cancelled) return;
                setData({
                    categories: json.categories || [],
                    sensor_types: json.sensor_types || [],
                    sensors: json.sensors || [],
                    history: json.history || [],
                });
                setHasLoadedOnce(true);
                setSelectedSensorId((prev) => {
                    const ids = (json.sensors || []).map((s) => s.id);
                    if (prev != null && ids.includes(prev)) return prev;
                    return json.sensors?.[0]?.id ?? null;
                });
            } catch (err) {
                console.error('Error fetching sensor data:', err);
                if (!cancelled) setLoadError('No se pudo conectar con /api/sensors/data');
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        };

        setLoading(true);
        fetchData();
        const interval = setInterval(fetchData, 15000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [telemetryTenantId]);

    const manualRefresh = () => {
        setRefreshing(true);
        const url = new URL('/api/sensors/data', window.location.origin);
        if (telemetryTenantId) url.searchParams.set('tenant_id', telemetryTenantId);
        fetch(url.toString())
            .then(async (res) => {
                const text = await res.text();
                let json = {};
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
                setData({
                    categories: json.categories || [],
                    sensor_types: json.sensor_types || [],
                    sensors: json.sensors || [],
                    history: json.history || [],
                });
                setHasLoadedOnce(true);
                setSelectedSensorId((prev) => {
                    const ids = (json.sensors || []).map((s) => s.id);
                    if (prev != null && ids.includes(prev)) return prev;
                    return json.sensors?.[0]?.id ?? null;
                });
            })
            .catch(() => setLoadError('Error de red al actualizar'))
            .finally(() => setRefreshing(false));
    };

    useEffect(() => {
        const types = data.sensor_types;
        const sensors = data.sensors;
        if (!types?.length || !sensors?.length) return;
        const catIds = [
            ...new Set(
                types.filter((t) => sensors.some((s) => s.type_id === t.id)).map((t) => t.category_id),
            ),
        ].sort((a, b) => a - b);
        if (catIds.length === 0) return;
        setSelectedCategoryId((prev) => (catIds.includes(prev) ? prev : catIds[0]));
    }, [data.sensor_types, data.sensors]);

    const filteredTypes = useMemo(
        () => data.sensor_types.filter((t) => t.category_id === selectedCategoryId),
        [data.sensor_types, selectedCategoryId],
    );

    const filteredSensors = useMemo(
        () => data.sensors.filter((s) => filteredTypes.some((t) => t.id === s.type_id)),
        [data.sensors, filteredTypes],
    );

    const kpiStats = useMemo(() => {
        const total = data.history.length;
        const now = Date.now();
        const lastHour = data.history.filter((h) => {
            const t = new Date(h.timestamp).getTime();
            return Number.isFinite(t) && now - t < 3600000;
        }).length;
        const alerts = data.sensors.filter((s) => s.status && s.status !== 'online').length;
        const geo = data.sensors.filter((s) => {
            const ty = data.sensor_types.find((t) => t.id === s.type_id);
            const cat = data.categories.find((c) => c.id === ty?.category_id);
            return cat?.name === 'Geotecnia';
        });
        const geoRisk =
            geo.some((s) => s.status === 'warning' || s.status === 'critical') ? 'Atención' : 'Bajo riesgo';
        return { total, lastHour, alerts, geoRisk };
    }, [data.history, data.sensors, data.sensor_types, data.categories]);

    const chartOption = useMemo(() => {
        if (!selectedSensorId) {
            return {
                backgroundColor: 'transparent',
                title: {
                    text: 'Seleccione un sensor en la lista',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: '#64748b', fontSize: 14 },
                },
            };
        }
        const sensorHistory = data.history
            .filter((h) => h.sensor_id === selectedSensorId)
            .slice()
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const sensor = data.sensors.find((s) => s.id === selectedSensorId);
        const type = data.sensor_types.find((t) => t.id === sensor?.type_id);

        if (sensorHistory.length === 0) {
            return {
                backgroundColor: 'transparent',
                title: {
                    text: 'Sin historial en los últimos 7 días',
                    subtext: 'Tabla mining_sensor_history · mismo ámbito mina/unidad',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: '#64748b', fontSize: 14 },
                    subtextStyle: { color: '#475569', fontSize: 11 },
                },
            };
        }

        const values = sensorHistory.map((h) => Number(h.value));
        const minV = Math.min(...values);
        const maxV = Math.max(...values);
        const span = Math.max(maxV - minV, 1e-6);
        const pad = span * 0.12;

        const seriesData = sensorHistory.map((h) => [h.timestamp, h.value]);

        return {
            backgroundColor: 'transparent',
            title: {
                text: `${sensor?.name || 'Sensor'}`,
                subtext: `${type?.name || 'Magnitud'} (${type?.unit || '—'}) · ${sensorHistory.length} puntos`,
                left: 'center',
                top: 4,
                textStyle: { color: '#e2e8f0', fontSize: 15 },
                subtextStyle: { color: '#64748b', fontSize: 11 },
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                borderColor: '#334155',
                textStyle: { color: '#fff' },
                formatter: (params) => {
                    const p = params[0];
                    const ts = p.value[0];
                    const val = p.value[1];
                    const tlabel = new Date(ts).toLocaleString();
                    return `<div class="p-1">
                        <div class="text-slate-400 text-xs">${tlabel}</div>
                        <div class="font-bold text-lg">${Number(val).toLocaleString(undefined, { maximumFractionDigits: 3 })} <span class="text-sm font-normal">${type?.unit || ''}</span></div>
                    </div>`;
                },
            },
            grid: { top: 72, bottom: 48, left: 56, right: 24 },
            xAxis: {
                type: 'time',
                axisLine: { lineStyle: { color: '#334155' } },
                axisLabel: { color: '#94a3b8', fontSize: 10 },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                name: type?.unit || '',
                min: minV - pad,
                max: maxV + pad,
                nameTextStyle: { color: '#64748b', fontSize: 10 },
                axisLine: { show: false },
                axisLabel: { color: '#94a3b8' },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series: [
                {
                    name: sensor?.name,
                    type: 'line',
                    smooth: 0.25,
                    showSymbol: sensorHistory.length < 48,
                    symbolSize: 4,
                    data: seriesData,
                    lineStyle: { width: 2, color: '#38bdf8' },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(56, 189, 248, 0.22)' },
                                { offset: 1, color: 'rgba(56, 189, 248, 0)' },
                            ],
                        },
                    },
                },
            ],
        };
    }, [selectedSensorId, data]);

    const samplesLabel =
        kpiStats.total >= 1000 ? `${(kpiStats.total / 1000).toFixed(1)}k` : String(kpiStats.total);

    if (loading && !hasLoadedOnce && !loadError) {
        return (
            <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center bg-[#020617] p-8 text-slate-400">
                <Activity className="mb-3 animate-pulse text-sky-500" size={40} />
                <span className="mining-workbench-page-subtitle text-center !text-slate-500">Cargando sensores…</span>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#020617] p-4 font-sans text-slate-200 sm:p-6">
            <MiningWorkbenchHeader
                title="Sensores de mina"
                subtitle="Telemetría e historial por categoría. Los datos se actualizan automáticamente."
                icon={Radio}
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
                        <div className="font-bold">No se pudo cargar la telemetría</div>
                        <div className="mt-1 text-rose-200/85">{loadError}</div>
                    </div>
                </div>
            )}

            {!loadError && data.sensors.length === 0 && (
                <div className="mb-5 rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-8 text-center">
                    <Radio className="mx-auto mb-3 text-slate-600" size={36} />
                    <p className="text-sm font-semibold text-slate-300">No hay sensores para este ámbito</p>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                        No hay sensores configurados para su unidad. Contacte al administrador de la plataforma.
                    </p>
                </div>
            )}

            {data.categories.length > 0 && data.sensors.length > 0 && (
                <>
                    <div className="mb-5 flex shrink-0 gap-2 overflow-x-auto pb-1 adv-scroll-hide">
                        {data.categories.map((cat) => (
                            <button
                                key={cat.id}
                                type="button"
                                onClick={() => setSelectedCategoryId(cat.id)}
                                className={`whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
                                    selectedCategoryId === cat.id
                                        ? 'bg-sky-600 text-white shadow-lg shadow-sky-900/40'
                                        : 'border border-slate-800 bg-slate-900/80 text-slate-400 hover:border-slate-700 hover:bg-slate-800'
                                }`}
                            >
                                {cat.name}
                            </button>
                        ))}
                    </div>

                    <div className="grid min-h-0 flex-1 grid-cols-12 gap-5 pb-4">
                        <div className="col-span-12 flex min-h-[300px] flex-col rounded-2xl border border-slate-800 bg-slate-950/50 shadow-xl backdrop-blur-sm lg:col-span-4">
                            <div className="border-b border-slate-800 bg-slate-900/40 p-4">
                                <h2 className="text-sm font-bold tracking-wide text-sky-300" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                                    Inventario por categoría
                                </h2>
                                <span className="text-xs text-slate-500" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                                    {filteredSensors.length} sensores en esta vista
                                </span>
                            </div>
                            <div className="adv-scroll flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
                                {filteredSensors.length === 0 && (
                                    <p className="text-sm text-slate-500">
                                        No hay sensores en esta categoría para el ámbito seleccionado.
                                    </p>
                                )}
                                {filteredSensors.map((s) => {
                                    const ty = data.sensor_types.find((t) => t.id === s.type_id);
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            onClick={() => setSelectedSensorId(s.id)}
                                            className={`w-full rounded-xl border p-4 text-left transition-all ${
                                                selectedSensorId === s.id
                                                    ? 'border-sky-500/50 bg-sky-950/40 shadow-inner ring-1 ring-sky-500/20'
                                                    : 'border-slate-800 bg-slate-900/30 hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="truncate font-bold text-slate-100">{s.name}</div>
                                                    <div className="mt-0.5 text-[11px] text-slate-500">
                                                        {ty?.name || 'Tipo'} {ty?.unit ? `· ${ty.unit}` : ''}
                                                    </div>
                                                    <div className="mt-1 font-mono text-[10px] text-slate-600">
                                                        ID {s.id}
                                                    </div>
                                                </div>
                                                <div
                                                    className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase ${statusBadgeClass(s.status)}`}
                                                >
                                                    {s.status || '—'}
                                                </div>
                                            </div>
                                            <div className="mt-3 flex items-baseline gap-2">
                                                <span className="font-mono text-2xl font-bold text-sky-400">
                                                    {Number(s.current_value).toLocaleString(undefined, {
                                                        maximumFractionDigits: 2,
                                                    })}
                                                </span>
                                                <span className="text-sm text-slate-500">{ty?.unit || ''}</span>
                                            </div>
                                            {Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)) && (
                                                <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-600">
                                                    <MapPin size={10} className="shrink-0" />
                                                    {Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="col-span-12 flex min-h-0 flex-col gap-5 lg:col-span-8">
                            <div className="relative flex min-h-[340px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/50 p-4 backdrop-blur-sm sm:p-5">
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <h2 className="text-lg font-bold text-slate-100" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                                            Historial reciente
                                        </h2>
                                        <p className="text-xs text-slate-500" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                                            Últimos 7 días
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-emerald-400" style={{ fontFamily: 'var(--font-mining-ui)', fontSize: '0.75rem', fontWeight: 600 }}>
                                        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                                        En vivo
                                    </div>
                                </div>
                                <div className="h-[min(50vh,400px)] min-h-[220px] w-full flex-1">
                                    <ReactECharts option={chartOption} style={{ height: '100%', width: '100%' }} />
                                </div>
                            </div>

                            <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-3">
                                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 backdrop-blur-sm">
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                        Riesgo geotecnia
                                    </div>
                                    <div className="text-xl font-bold text-slate-100">{kpiStats.geoRisk}</div>
                                    <div className="mt-2 text-[11px] text-slate-500">
                                        Basado en estado de sensores de categoría Geotecnia.
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 backdrop-blur-sm">
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                        Muestras en historial
                                    </div>
                                    <div className="text-xl font-bold text-slate-100">{samplesLabel}</div>
                                    <div className="mt-2 text-[11px] text-sky-500">
                                        +{kpiStats.lastHour} registradas en la última hora
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 backdrop-blur-sm">
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                        Sensores no “online”
                                    </div>
                                    <div className="text-xl font-bold text-rose-400">{kpiStats.alerts}</div>
                                    <div className="mt-2 text-[11px] text-slate-500">
                                        Cuenta estados distintos de <span className="font-mono">online</span>.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}

            <style>{`
                .adv-scroll::-webkit-scrollbar { width: 5px; }
                .adv-scroll::-webkit-scrollbar-track { background: transparent; }
                .adv-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
                .adv-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }
                .adv-scroll-hide::-webkit-scrollbar { display: none; }
            `}</style>
        </div>
    );
};

export default AdvancedSensors;
