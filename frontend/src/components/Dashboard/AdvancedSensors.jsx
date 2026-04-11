import React, { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

const defaultScope = {
    miningCompanyName: 'ACTIVOS MINEROS',
    siteUnitName: 'UNIDAD PRINCIPAL',
};

const AdvancedSensors = ({
    miningCompanyName = defaultScope.miningCompanyName,
    siteUnitName = defaultScope.siteUnitName,
}) => {
    const [data, setData] = useState({ categories: [], sensor_types: [], sensors: [], history: [] });
    const [selectedCategoryId, setSelectedCategoryId] = useState(1);
    const [selectedSensorId, setSelectedSensorId] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const fetchData = async () => {
            try {
                if (typeof process !== 'undefined' && process.env?.VITEST) {
                    return;
                }
                const url = new URL('/api/sensors/data', window.location.origin);
                url.searchParams.set('mining_company', miningCompanyName);
                url.searchParams.set('site_unit', siteUnitName);
                const res = await fetch(url.toString());
                if (!res.ok) return;
                const json = await res.json();
                if (cancelled) return;
                setData(json);
                setSelectedSensorId((prev) => {
                    const ids = (json.sensors || []).map((s) => s.id);
                    if (prev != null && ids.includes(prev)) return prev;
                    return json.sensors?.[0]?.id ?? null;
                });
            } catch (err) {
                console.error('Error fetching sensor data:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        setLoading(true);
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [miningCompanyName, siteUnitName]);

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
            geo.some((s) => s.status === 'warning' || s.status === 'critical') ? 'Atención' : 'Bajo Riesgo';
        return { total, lastHour, alerts, geoRisk };
    }, [data.history, data.sensors, data.sensor_types, data.categories]);

    const chartOption = useMemo(() => {
        if (!selectedSensorId) {
            return {
                backgroundColor: 'transparent',
                title: {
                    text: 'Seleccione un sensor',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: '#64748b', fontSize: 14 },
                },
            };
        }
        const sensorHistory = data.history.filter((h) => h.sensor_id === selectedSensorId);
        const sensor = data.sensors.find((s) => s.id === selectedSensorId);
        const type = data.sensor_types.find((t) => t.id === sensor?.type_id);

        if (sensorHistory.length === 0) {
            return {
                backgroundColor: 'transparent',
                title: {
                    text: 'Sin series en el período (7 días)',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: '#64748b', fontSize: 14 },
                },
            };
        }

        const safeValue = type?.name === 'pH' ? 7.0 : type?.unit === 'kPa' ? 200 : 50;
        const warningThreshold = safeValue * 1.2;
        const criticalThreshold = safeValue * 1.4;

        return {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                borderColor: '#334155',
                textStyle: { color: '#fff' },
                formatter: (params) => {
                    const p = params[0];
                    return `<div class="p-2">
                        <div class="text-slate-400 text-xs">${p.name}</div>
                        <div class="font-bold text-lg">${p.value} <span class="text-sm font-normal">${type?.unit || ''}</span></div>
                    </div>`;
                },
            },
            grid: { top: 60, bottom: 40, left: 60, right: 30 },
            xAxis: {
                type: 'category',
                data: sensorHistory.map((h) =>
                    new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                ),
                axisLine: { lineStyle: { color: '#334155' } },
                axisLabel: { color: '#94a3b8', fontSize: 10, interval: Math.floor(sensorHistory.length / 6) },
            },
            yAxis: {
                type: 'value',
                name: type?.unit || '',
                nameTextStyle: { color: '#64748b', fontSize: 10 },
                axisLine: { show: false },
                axisLabel: { color: '#94a3b8' },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
                scale: true,
            },
            visualMap: {
                show: false,
                dimension: 1,
                pieces: [
                    { gt: 0, lte: warningThreshold, color: '#38bdf8' },
                    { gt: warningThreshold, lte: criticalThreshold, color: '#f59e0b' },
                    { gt: criticalThreshold, color: '#f43f5e' },
                ],
            },
            series: [
                {
                    name: sensor?.name,
                    data: sensorHistory.map((h) => h.value),
                    type: 'line',
                    smooth: 0.3,
                    showSymbol: false,
                    lineStyle: { width: 3 },
                    animationDurationUpdate: 1000,
                    markLine: {
                        silent: true,
                        symbol: ['none', 'none'],
                        label: { position: 'end', color: '#f43f5e', fontSize: 10, formatter: 'LIMITE CRÍTICO' },
                        lineStyle: { color: 'rgba(244, 63, 94, 0.3)', type: 'dashed' },
                        data: [{ yAxis: criticalThreshold }],
                    },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(56, 189, 248, 0.2)' },
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

    if (loading) return <div className="p-8 text-slate-400">Cargando telemetría avanzada...</div>;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#020617] p-6 font-sans text-slate-200">
            <header className="mb-6 shrink-0 border-b border-slate-800 pb-4">
                <h1 className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-3xl font-bold text-transparent">
                    Monitoreo Técnico Especializado
                </h1>
                <p className="mt-1 text-slate-500">Telemetría de sensores en tiempo real - Time Telemetry v2.5</p>
                <p className="mt-2 text-xs font-medium uppercase tracking-wide text-sky-500/90">
                    Minera: <span className="text-slate-200">{miningCompanyName}</span>
                    <span className="mx-2 text-slate-600">·</span>
                    Unidad: <span className="text-slate-200">{siteUnitName}</span>
                </p>
            </header>

            <div className="mb-6 flex shrink-0 gap-2 overflow-x-auto pb-2 adv-scroll-hide">
                {data.categories.map((cat) => (
                    <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategoryId(cat.id)}
                        className={`whitespace-nowrap rounded-xl px-6 py-3 font-medium transition-all ${
                            selectedCategoryId === cat.id
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                : 'border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800'
                        }`}
                    >
                        {cat.name}
                    </button>
                ))}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-12 gap-6 pb-4">
                <div className="col-span-12 flex min-h-[280px] flex-col rounded-2xl border border-slate-800 bg-slate-950/50 shadow-xl backdrop-blur-sm lg:col-span-4">
                    <div className="border-b border-slate-800 bg-slate-900/50 p-4">
                        <h2 className="text-lg font-bold uppercase tracking-wider text-indigo-300">
                            Sensores Detallados
                        </h2>
                        <span className="text-xs text-slate-500">{filteredSensors.length} unidades activas</span>
                    </div>
                    <div className="adv-scroll flex-1 space-y-3 overflow-y-auto p-4">
                        {filteredSensors.length === 0 && (
                            <p className="text-sm text-slate-500">
                                No hay sensores en esta categoría para el ámbito seleccionado.
                            </p>
                        )}
                        {filteredSensors.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => setSelectedSensorId(s.id)}
                                className={`w-full rounded-xl border p-4 text-left transition-all ${
                                    selectedSensorId === s.id
                                        ? 'border-indigo-500/50 bg-indigo-600/10 shadow-inner'
                                        : 'border-slate-800 bg-slate-900/30 hover:border-slate-700'
                                }`}
                            >
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="font-bold text-slate-100">{s.name}</div>
                                        <div className="mt-1 text-xs text-slate-500">
                                            ID: S-{s.id.toString().padStart(4, '0')}
                                        </div>
                                    </div>
                                    <div className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold uppercase text-slate-400">
                                        {s.status}
                                    </div>
                                </div>
                                <div className="mt-3 flex items-baseline gap-2">
                                    <span className="font-mono text-2xl font-bold text-sky-400">{s.current_value}</span>
                                    <span className="text-sm text-slate-500">
                                        {data.sensor_types.find((t) => t.id === s.type_id)?.unit}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="col-span-12 flex min-h-0 flex-col gap-6 lg:col-span-8">
                    <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/50 p-6 backdrop-blur-sm">
                        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 bg-indigo-500/5 blur-[120px]" />
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h2 className="text-xl font-bold">Análisis Histórico de Tendencia</h2>
                                <p className="text-sm text-slate-500">
                                    Registro de los últimos 7 días con muestreo automático
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                                Transmisión Live
                            </div>
                        </div>
                        <div className="h-[min(52vh,420px)] min-h-[240px] w-full">
                            <ReactECharts option={chartOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>

                    <div className="grid shrink-0 grid-cols-1 gap-6 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 backdrop-blur-sm">
                            <div className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">
                                Impacto Geotécnico
                            </div>
                            <div className="text-2xl font-bold text-slate-100">{kpiStats.geoRisk}</div>
                            <div className="mt-2 text-xs text-emerald-500">
                                {kpiStats.geoRisk === 'Bajo Riesgo'
                                    ? 'Dentro de parámetros nominales'
                                    : 'Revisar sensores geotécnicos'}
                            </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 backdrop-blur-sm">
                            <div className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">
                                Muestras Acumuladas
                            </div>
                            <div className="text-2xl font-bold text-slate-100">{samplesLabel}</div>
                            <div className="mt-2 text-xs text-sky-500">
                                +{kpiStats.lastHour} en la última hora
                            </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 backdrop-blur-sm">
                            <div className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">
                                Alertas Sistémicas
                            </div>
                            <div className="text-2xl font-bold text-rose-500">{kpiStats.alerts}</div>
                            <div className="mt-2 text-xs text-slate-500">
                                {kpiStats.alerts === 0
                                    ? 'No se detectan discrepancias'
                                    : 'Sensores fuera de estado online'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

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
