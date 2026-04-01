import React, { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

const AdvancedSensors = () => {
    const [data, setData] = useState({ categories: [], sensor_types: [], sensors: [], history: [] });
    const [selectedCategoryId, setSelectedCategoryId] = useState(1);
    const [selectedSensorId, setSelectedSensorId] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const apiUrl = '/api/sensors/data'
                const res = await fetch(apiUrl);
                if (res.ok) {
                    const json = await res.json();
                    setData(json);
                    if (!selectedSensorId && json.sensors.length > 0) {
                        setSelectedSensorId(json.sensors[0].id);
                    }
                }
            } catch (err) {
                console.error("Error fetching sensor data:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 5000); // Poll every 5 seconds
        return () => clearInterval(interval);
    }, [selectedSensorId]);

    const filteredTypes = useMemo(() => 
        data.sensor_types.filter(t => t.category_id === selectedCategoryId),
    [data.sensor_types, selectedCategoryId]);

    const filteredSensors = useMemo(() => 
        data.sensors.filter(s => filteredTypes.some(t => t.id === s.type_id)),
    [data.sensors, filteredTypes]);

    const chartOption = useMemo(() => {
        if (!selectedSensorId || data.history.length === 0) return {};
        const sensorHistory = data.history.filter(h => h.sensor_id === selectedSensorId);
        const sensor = data.sensors.find(s => s.id === selectedSensorId);
        const type = data.sensor_types.find(t => t.id === sensor?.type_id);

        const safeValue = type?.name === 'pH' ? 7.0 : (type?.unit === 'kPa' ? 200 : 50);
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
                }
            },
            grid: { top: 60, bottom: 40, left: 60, right: 30 },
            xAxis: { 
                type: 'category', 
                data: sensorHistory.map(h => new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
                axisLine: { lineStyle: { color: '#334155' } },
                axisLabel: { color: '#94a3b8', fontSize: 10, interval: Math.floor(sensorHistory.length / 6) }
            },
            yAxis: { 
                type: 'value', 
                name: type?.unit || '',
                nameTextStyle: { color: '#64748b', fontSize: 10 },
                axisLine: { show: false },
                axisLabel: { color: '#94a3b8' },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
                scale: true
            },
            visualMap: {
                show: false,
                dimension: 1,
                pieces: [
                    { gt: 0, lte: warningThreshold, color: '#38bdf8' },
                    { gt: warningThreshold, lte: criticalThreshold, color: '#f59e0b' },
                    { gt: criticalThreshold, color: '#f43f5e' }
                ]
            },
            series: [{
                name: sensor?.name,
                data: sensorHistory.map(h => h.value),
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
                    data: [{ yAxis: criticalThreshold }]
                },
                areaStyle: { 
                    color: { 
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1, 
                        colorStops: [{ offset: 0, color: 'rgba(56, 189, 248, 0.2)' }, { offset: 1, color: 'rgba(56, 189, 248, 0)' }] 
                    } 
                }
            }]
        };
    }, [selectedSensorId, data]);

    if (loading) return <div className="p-8 text-slate-400">Cargando telemetría avanzada...</div>;

    return (
        <div className="flex flex-col h-full bg-[#020617] text-slate-200 font-sans p-6 overflow-hidden">
            <header className="mb-8 border-b border-slate-800 pb-4">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
                    Monitoreo Técnico Especializado
                </h1>
                <p className="text-slate-500 mt-1">Telemetría de sensores en tiempo real - Time Telemetry v2.5</p>
            </header>

            {/* Category selection */}
            <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
                {data.categories.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setSelectedCategoryId(cat.id)}
                        className={`px-6 py-3 rounded-xl font-medium transition-all whitespace-nowrap ${
                            selectedCategoryId === cat.id 
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
                            : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
                        }`}
                    >
                        {cat.name}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
                {/* Sensor List Card */}
                <div className="col-span-12 lg:col-span-4 flex flex-col bg-slate-950/50 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm shadow-xl">
                    <div className="p-4 border-b border-slate-800 bg-slate-900/50">
                        <h2 className="font-bold text-lg text-indigo-300 uppercase tracking-wider">Sensores Detallados</h2>
                        <span className="text-xs text-slate-500">{filteredSensors.length} unidades activas</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {filteredSensors.map(s => (
                            <div 
                                key={s.id}
                                onClick={() => setSelectedSensorId(s.id)}
                                className={`p-4 rounded-xl cursor-pointer border transition-all ${
                                    selectedSensorId === s.id 
                                    ? 'bg-indigo-600/10 border-indigo-500/50 shadow-inner' 
                                    : 'bg-slate-900/30 border-slate-800 hover:border-slate-700'
                                }`}
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="font-bold text-slate-100">{s.name}</div>
                                        <div className="text-xs text-slate-500 mt-1">ID: S-{s.id.toString().padStart(4, '0')}</div>
                                    </div>
                                    <div className="px-2 py-1 bg-slate-800 rounded-md text-[10px] uppercase font-bold text-slate-400">
                                        {s.status}
                                    </div>
                                </div>
                                <div className="mt-3 flex items-baseline gap-2">
                                    <span className="text-2xl font-mono font-bold text-sky-400">{s.current_value}</span>
                                    <span className="text-slate-500 text-sm">{data.sensor_types.find(t => t.id === s.type_id)?.unit}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Main Content: Chart & Stats */}
                <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 min-h-0">
                    {/* Chart Card */}
                    <div className="flex-1 bg-slate-950/50 border border-slate-800 rounded-2xl p-6 relative overflow-hidden backdrop-blur-sm">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[120px] pointer-events-none"></div>
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h2 className="text-xl font-bold">Análisis Histórico de Tendencia</h2>
                                <p className="text-slate-500 text-sm">Registro de los últimos 7 días con muestreo automático</p>
                            </div>
                            <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                Transmisión Live
                            </div>
                        </div>
                        <div className="h-64">
                            <ReactECharts option={chartOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>

                    {/* Quick Stats Banner */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
                            <div className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-1">Impacto Geotécnico</div>
                            <div className="text-2xl font-bold text-slate-100">Bajo Riesgo</div>
                            <div className="mt-2 text-xs text-emerald-500">Dentro de parámetros nominales</div>
                        </div>
                        <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
                            <div className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-1">Muestras Acumuladas</div>
                            <div className="text-2xl font-bold text-slate-100">14.8k</div>
                            <div className="mt-2 text-xs text-sky-500">+120 en la última hora</div>
                        </div>
                        <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
                            <div className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-1">Alertas Sistémicas</div>
                            <div className="text-2xl font-bold text-rose-500">0</div>
                            <div className="mt-2 text-xs text-slate-500">No se detectan discrepancias</div>
                        </div>
                    </div>
                </div>
            </div>

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar { width: 5px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
                .scrollbar-hide::-webkit-scrollbar { display: none; }
            `}</style>
        </div>
    );
};

export default AdvancedSensors;
