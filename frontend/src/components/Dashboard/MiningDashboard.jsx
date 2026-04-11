import React, { useState, useEffect, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'

const MiningDashboard = () => {
    const [heatmapData, setHeatmapData] = useState([]);
    const [kpis, setKpis] = useState(null);

    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                if (typeof process !== 'undefined' && process.env?.VITEST) {
                    return
                }
                const apiUrl = new URL('/api/dashboard/metrics', window.location.origin).toString()
                const res = await fetch(apiUrl);
                if (res.ok) {
                    const data = await res.json();
                    if (data.heatmap) setHeatmapData(data.heatmap);
                    if (data.kpis) setKpis(data.kpis);
                }
            } catch (err) {
                console.error("Error fetching dashboard metrics:", err);
            }
        };
        fetchMetrics();
    }, []);

    const barOption = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#475569', borderWidth: 1, textStyle: { color: '#f8fafc', fontSize: 12 }, axisPointer: { type: 'shadow' } },
        legend: { data: ['Mineral Extraído', 'Desmonte'], textStyle: { color: '#cbd5e1', fontSize: 11 }, top: 4, itemGap: 16 },
        grid: { top: 44, bottom: 22, left: 52, right: 14, containLabel: true },
        xAxis: {
            type: 'category',
            data: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
            axisLine: { lineStyle: { color: '#64748b', width: 1 } },
            axisLabel: { color: '#cbd5e1', fontSize: 11, margin: 10 },
            axisTick: { alignWithLabel: true, lineStyle: { color: '#475569' } },
        },
        yAxis: {
            type: 'value',
            name: 'Toneladas (kt)',
            nameTextStyle: { color: '#94a3b8', fontSize: 11, padding: [0, 0, 8, 0] },
            axisLine: { show: true, lineStyle: { color: '#64748b', width: 1 } },
            axisLabel: { color: '#cbd5e1', fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)', type: 'dashed', width: 1 } },
        },
        series: [
            { 
                name: 'Mineral Extraído', 
                type: 'bar', 
                stack: 'total',
                barWidth: '35%',
                data: [1200, 1350, 1150, 1420, 1580, 1300, 980], 
                itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#2563eb' }] }, borderRadius: [2, 2, 0, 0], borderColor: 'rgba(15,23,42,0.9)', borderWidth: 1, shadowColor: 'rgba(59, 130, 246, 0.25)', shadowBlur: 6 } 
            },
            { 
                name: 'Desmonte', 
                type: 'bar', 
                stack: 'total',
                barWidth: '35%',
                data: [300, 250, 400, 320, 280, 450, 500], 
                itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#f59e0b' }, { offset: 1, color: '#ea580c' }] }, borderRadius: [2, 2, 0, 0], borderColor: 'rgba(15,23,42,0.9)', borderWidth: 1 } 
            }
        ]
    }

    const lineOption = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#475569', borderWidth: 1, textStyle: { color: '#f8fafc', fontSize: 12 } },
        grid: { top: 36, bottom: 20, left: 48, right: 16, containLabel: true },
        xAxis: {
            type: 'category',
            data: ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'],
            boundaryGap: false,
            axisLine: { lineStyle: { color: '#64748b', width: 1 } },
            axisLabel: { color: '#cbd5e1', fontSize: 11, margin: 10 },
            axisTick: { lineStyle: { color: '#475569' } },
        },
        yAxis: {
            type: 'value',
            name: 'Ley Cu (%)',
            nameTextStyle: { color: '#94a3b8', fontSize: 11 },
            axisLine: { show: true, lineStyle: { color: '#64748b', width: 1 } },
            axisLabel: { color: '#cbd5e1', fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)', type: 'dashed', width: 1 } },
        },
        series: [{ 
            name: 'Ley Cu', 
            type: 'line', 
            data: [2.1, 2.3, 2.4, 2.6], 
            smooth: true, 
            symbol: 'circle',
            symbolSize: 7,
            lineStyle: { color: '#10b981', width: 2.5, shadowColor: 'rgba(16, 185, 129, 0.35)', shadowBlur: 6 }, 
            itemStyle: { color: '#10b981', borderColor: '#ecfdf5', borderWidth: 1.5 },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(16, 185, 129, 0.4)' }, { offset: 1, color: 'rgba(16, 185, 129, 0.01)' }] } } 
        }]
    }

    const heatmapOption = useMemo(() => {
        const days = Array.from({length: 15}, (_, i) => `Día ${i + 1}`);
        const levels = ['Nv. 3800', 'Nv. 3850', 'Nv. 3900', 'Nv. 3950', 'Nv. 4000', 'Nv. 4050', 'Nv. 4100', 'Nv. 4150', 'Nv. 4200'];
        const data = [];
        let maxEvents = 100;
        
        if (heatmapData && heatmapData.length > 0) {
            // Aggregate database points by day & level
            const grid = {};
            heatmapData.forEach(pt => {
                const d_idx = pt.day - 1;
                const l_idx = levels.indexOf(pt.level);
                if (d_idx >= 0 && l_idx >= 0) {
                    const key = `${d_idx}_${l_idx}`;
                    grid[key] = (grid[key] || 0) + 1; // Count events
                }
            });

            let currentMax = 0;
            for (let i = 0; i < days.length; i++) {
                for (let j = 0; j < levels.length; j++) {
                    const val = grid[`${i}_${j}`] || 0;
                    if (val > currentMax) currentMax = val;
                    data.push([i, j, val]);
                }
            }
            // Adjust visual scale to match DB density
            maxEvents = Math.max(10, currentMax + 5);
        } else {
            // Fallback generated data while loading or if offline
            for (let i = 0; i < days.length; i++) {
                for (let j = 0; j < levels.length; j++) {
                    let val = Math.round(Math.random() * 15);
                    if (j === Math.floor(i / 2)) val += 40; 
                    if (j === Math.floor(i / 2) + 1) val += 20;
                    if (j > 5 && i > 10) val += 30;
                    if (j === 7 && i === 12) val += 90;
                    if (j === 8 && i === 13) val += 70;
                    data.push([i, j, Math.min(val, 100)]);
                }
            }
        }

        return {
            backgroundColor: 'transparent',
            tooltip: { 
                position: 'top',
                backgroundColor: 'rgba(15, 23, 42, 0.98)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                textStyle: { color: '#f8fafc' },
                formatter: function (params) {
                    return `<div style="padding: 6px;">
                        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px; border-bottom: 1px solid #334155; padding-bottom: 4px;">${days[params.data[0]]} | Perfil ${levels[params.data[1]]}</div>
                        <div style="font-size: 16px; font-weight: bold; display: flex; align-items: center; gap: 8px;">
                            <div style="width: 10px; height: 10px; border-radius: 2px; box-shadow: 0 0 8px ${params.color}; background-color: ${params.color};"></div>
                            <span style="color: #f8fafc">${params.data[2]} Eventos detectados</span>
                        </div>
                    </div>`;
                }
            },
            /* Leyenda a la derecha: evita recorte inferior del mapa en contenedor fijo */
            grid: { top: 14, bottom: 36, left: 68, right: 108, containLabel: false },
            xAxis: { 
                type: 'category', 
                data: days, 
                axisLabel: { color: '#94a3b8', fontSize: 10, interval: 1 }, 
                splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.05)'] } }, 
                axisLine: { lineStyle: { color: '#64748b', width: 1 } },
                axisTick: { show: false }
            },
            yAxis: { 
                type: 'category', 
                data: levels, 
                axisLabel: { color: '#cbd5e1', fontSize: 10, fontWeight: '600' }, 
                axisLine: { lineStyle: { color: '#64748b', width: 1 } },
                axisTick: { show: false }
            },
            visualMap: {
                min: 0,
                max: maxEvents,
                calculable: true,
                orient: 'vertical',
                right: 6,
                top: 'middle',
                itemWidth: 14,
                itemHeight: 120,
                text: ['Alto', 'Bajo'],
                textGap: 6,
                textStyle: { color: '#94a3b8', fontSize: 9, fontWeight: 'bold' },
                inRange: { color: ['#1e293b', '#2563eb', '#10b981', '#fbbf24', '#ef4444', '#7f1d1d'] },
            },
            series: [{ 
                name: 'Eventos Microsísmicos', 
                type: 'heatmap', 
                data: data, 
                label: { show: true, color: '#f8fafc', fontSize: 9, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.85)', textShadowBlur: 3 },
                itemStyle: { borderColor: 'rgba(51, 65, 85, 0.95)', borderWidth: 1, borderRadius: [3, 3, 3, 3] },
                emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(56, 189, 248, 0.35)', borderColor: '#38bdf8', borderWidth: 1.5 } } 
            }]
        };
    }, [heatmapData]);

    const oeeData = kpis?.oee?.value || 92.4;
    const gaugeOption = {
        series: [
            {
                type: 'gauge',
                progress: { show: true, width: 14, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#10b981' }] } } },
                axisLine: { lineStyle: { width: 14, color: [[1, 'rgba(255,255,255,0.04)']] } },
                pointer: { length: '50%', width: 5, itemStyle: { color: '#f8fafc', shadowColor: 'rgba(0,0,0,0.5)', shadowBlur: 8, shadowOffsetY: 2 } },
                axisTick: { show: false },
                splitLine: { length: 18, lineStyle: { color: '#475569', width: 1 } },
                axisLabel: { color: '#94a3b8', distance: 22, fontSize: 9 },
                title: { color: '#cbd5e1', fontSize: 11, offsetCenter: [0, '72%'], fontWeight: '500' },
                detail: { valueAnimation: true, formatter: '{value}%', color: '#10b981', fontSize: 26, fontWeight: '900', offsetCenter: [0, '32%'], textShadowColor: 'rgba(16, 185, 129, 0.4)', textShadowBlur: 12 },
                data: [{ value: oeeData, name: 'Rendimiento General' }]
            }
        ]
    }

    return (
        <div className="mining-dashboard-root box-border w-full max-w-full min-w-0 bg-[#020617] px-3 py-3 pb-12 text-slate-200 sm:px-4 sm:py-4">
            <style dangerouslySetInnerHTML={{__html: `
                .mining-dashboard-root .premium-glass {
                    background: linear-gradient(145deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.96));
                    border: 1px solid rgba(148, 163, 184, 0.28);
                    box-shadow: 0 8px 24px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);
                    border-radius: 12px;
                    backdrop-filter: blur(16px);
                    min-width: 0;
                }
                .mining-dashboard-root .mining-chart-frame {
                    border: 1px solid rgba(100, 116, 139, 0.65);
                    border-radius: 10px;
                    background: rgba(2, 6, 23, 0.72);
                    box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.85);
                    min-width: 0;
                }
                .mining-dashboard-root .glow-text-blue { text-shadow: 0 0 12px rgba(59, 130, 246, 0.45); }
                .mining-dashboard-root .glow-text-emerald { text-shadow: 0 0 12px rgba(16, 185, 129, 0.45); }
                .mining-dashboard-root .glow-text-rose { text-shadow: 0 0 12px rgba(244, 63, 94, 0.45); }
            `}} />

            <div className="mb-4 flex min-w-0 flex-col justify-between gap-3 border-b border-slate-800 pb-3 md:flex-row md:items-center">
                <div className="min-w-0">
                    <h2 className="text-xl sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-emerald-400 to-emerald-300 tracking-tight drop-shadow-md leading-tight">
                        Centro de Control Operacional
                    </h2>
                    <p className="text-slate-400 text-[11px] sm:text-xs mt-1 font-medium flex items-center gap-2 flex-wrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981] animate-pulse shrink-0"></span>
                        <span className="min-w-0">Análisis en tiempo real · Compañía Minera de Metales del Perú</span>
                    </p>
                </div>
                <div className="shrink-0 flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700 shadow-lg backdrop-blur-md">
                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Status General:</span>
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Óptimo</span>
                </div>
            </div>

            {/* KPI Cards — min-w-0 evita desborde horizontal en grillas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4 min-w-0">
                <div className="premium-glass p-3 sm:p-4 relative overflow-hidden group min-w-0">
                    <div className="absolute -right-6 -top-6 w-28 h-28 bg-blue-500/15 rounded-full blur-2xl group-hover:bg-blue-500/25 transition-all duration-500"></div>
                    <div className="text-[10px] font-bold text-blue-400 uppercase mb-1.5 tracking-wider flex items-center gap-1.5">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                        Prod. Mensual
                    </div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-white glow-text-blue mt-0.5 tabular-nums">1,240<span className="text-lg text-blue-200/40 font-semibold ml-0.5">kt</span></div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] font-bold text-white bg-blue-500/30 px-2 py-0.5 rounded border border-blue-400/30">+4.2%</span>
                        <span className="text-[10px] text-slate-400 font-medium">vs mes anterior</span>
                    </div>
                </div>

                <div className="premium-glass p-3 sm:p-4 relative overflow-hidden group min-w-0">
                    <div className="absolute -right-6 -top-6 w-28 h-28 bg-emerald-500/15 rounded-full blur-2xl group-hover:bg-emerald-500/25 transition-all duration-500"></div>
                    <div className="text-[10px] font-bold text-emerald-400 uppercase mb-1.5 tracking-wider flex items-center gap-1.5">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                        Ley de Cu Prom.
                    </div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-white glow-text-emerald mt-0.5 tabular-nums">2.46<span className="text-lg text-emerald-200/40 font-semibold ml-0.5">%</span></div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] font-bold text-emerald-200 bg-emerald-500/30 px-2 py-0.5 rounded border border-emerald-400/30">En Meta</span>
                        <span className="text-[10px] text-slate-400 font-medium">Dentro del plan</span>
                    </div>
                </div>

                <div className="premium-glass p-3 sm:p-4 relative overflow-hidden group min-w-0">
                    <div className="absolute -right-6 -top-6 w-28 h-28 bg-rose-500/15 rounded-full blur-2xl group-hover:bg-rose-500/25 transition-all duration-500"></div>
                    <div className="text-[10px] font-bold text-rose-400 uppercase mb-1.5 tracking-wider flex items-center gap-1.5">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        Riesgos Geomec.
                    </div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-white glow-text-rose mt-0.5 tabular-nums">14</div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] font-bold text-rose-100 bg-rose-500/40 px-2 py-0.5 rounded border border-rose-400/50">+2 Alertas</span>
                        <span className="text-[10px] text-slate-400 font-medium">Nuevos hoy</span>
                    </div>
                </div>

                <div className="premium-glass p-3 sm:p-4 relative overflow-hidden flex flex-col justify-center items-center min-w-0">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1 w-full text-left">OEE Planta Concentradora</h4>
                    <div className="mining-chart-frame w-full h-[118px] sm:h-[128px] relative min-h-[112px] p-1">
                        <div className="absolute inset-1 min-w-0">
                            <ReactECharts option={gaugeOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Gráficos principales */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4 min-w-0">
                <div className="premium-glass p-3 sm:p-4 flex flex-col min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-blue-400 min-w-0">
                            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_#3b82f6] shrink-0"></div>
                            <span className="truncate">Extracción Mineral vs Desmonte</span>
                        </h4>
                        <div className="text-[9px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 font-bold uppercase tracking-wide shrink-0">Últimos 7 Días</div>
                    </div>
                    <div className="mining-chart-frame w-full h-[268px] sm:h-[288px] relative min-h-[248px] min-w-0 p-2">
                        <div className="absolute inset-2 min-w-0">
                            <ReactECharts option={barOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>

                <div className="premium-glass p-3 sm:p-4 flex flex-col min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-400 min-w-0">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981] shrink-0"></div>
                            <span className="truncate">Tendencia Ley de Cobre (Cu)</span>
                        </h4>
                        <div className="text-[9px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 font-bold uppercase tracking-wide shrink-0">Promedio Mensual</div>
                    </div>
                    <div className="mining-chart-frame w-full h-[268px] sm:h-[288px] relative min-h-[248px] min-w-0 p-2">
                        <div className="absolute inset-2 min-w-0">
                            <ReactECharts option={lineOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Heatmap microsísmico */}
            <div className="premium-glass p-3 sm:p-4 flex flex-col mb-6 relative min-w-0">
                <div className="absolute -top-24 -right-24 w-64 h-64 bg-amber-500/10 rounded-full blur-[80px] pointer-events-none z-0"></div>
                <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-blue-500/5 rounded-full blur-[80px] pointer-events-none z-0"></div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3 z-10 min-w-0">
                    <div className="min-w-0">
                        <h4 className="flex items-center gap-2 text-xs sm:text-sm font-black uppercase tracking-wider text-amber-400 drop-shadow-md">
                            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_10px_#f59e0b] shrink-0"></div>
                            <span className="min-w-0">Monitoreo Microsísmico Avanzado 3D</span>
                        </h4>
                        <p className="text-[10px] sm:text-xs text-slate-400 mt-1 font-medium pl-4 sm:pl-5">Distribución espacio-temporal por nivel estructural</p>
                    </div>
                    <div className="shrink-0 text-[9px] bg-slate-800/80 border border-slate-700/50 px-2.5 py-1.5 rounded text-slate-300 font-bold tracking-wide uppercase">
                        Últimos 15 Días
                    </div>
                </div>

                <div className="mining-chart-frame relative z-10 min-h-[360px] w-full min-w-0 overflow-visible p-2 sm:min-h-[400px]" style={{ height: 'clamp(360px, 52vh, 520px)' }}>
                    <ReactECharts option={heatmapOption} style={{ height: '100%', width: '100%', minHeight: 300 }} />
                </div>
            </div>

            <div className="pb-2 text-center text-[10px] font-medium tracking-wide text-slate-600">
                © 2026 SENSOR3D Platform — Dashboard ejecutivo · Compañía Minera de Metales del Perú
            </div>
        </div>
    )
}

export default MiningDashboard
