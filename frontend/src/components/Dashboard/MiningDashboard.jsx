import React, { useState, useEffect, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'

const MiningDashboard = () => {
    const [heatmapData, setHeatmapData] = useState([]);
    const [kpis, setKpis] = useState(null);

    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                const apiUrl = '/api/dashboard/metrics'
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
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#334155', textStyle: { color: '#f8fafc' }, axisPointer: { type: 'shadow' } },
        legend: { data: ['Mineral Extraído', 'Desmonte'], textStyle: { color: '#cbd5e1' }, top: 0 },
        grid: { top: 40, bottom: 20, left: 50, right: 10, containLabel: true },
        xAxis: { type: 'category', data: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#cbd5e1' } },
        yAxis: { type: 'value', name: 'Toneladas (kt)', nameTextStyle: { color: '#94a3b8', padding: [0, 0, 0, 20] }, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#cbd5e1' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)', type: 'dashed' } } },
        series: [
            { 
                name: 'Mineral Extraído', 
                type: 'bar', 
                stack: 'total',
                barWidth: '35%',
                data: [1200, 1350, 1150, 1420, 1580, 1300, 980], 
                itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#2563eb' }] }, borderRadius: [0, 0, 0, 0], shadowColor: 'rgba(59, 130, 246, 0.4)', shadowBlur: 10 } 
            },
            { 
                name: 'Desmonte', 
                type: 'bar', 
                stack: 'total',
                barWidth: '35%',
                data: [300, 250, 400, 320, 280, 450, 500], 
                itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#f59e0b' }, { offset: 1, color: '#ea580c' }] }, borderRadius: [4, 4, 0, 0] } 
            }
        ]
    }

    const lineOption = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#334155', textStyle: { color: '#f8fafc' } },
        grid: { top: 40, bottom: 20, left: 40, right: 20, containLabel: true },
        xAxis: { type: 'category', data: ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'], boundaryGap: false, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#cbd5e1' } },
        yAxis: { type: 'value', name: 'Ley Cu (%)', nameTextStyle: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#cbd5e1' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)', type: 'dashed' } } },
        series: [{ 
            name: 'Ley Cu', 
            type: 'line', 
            data: [2.1, 2.3, 2.4, 2.6], 
            smooth: true, 
            symbol: 'circle',
            symbolSize: 8,
            lineStyle: { color: '#10b981', width: 4, shadowColor: 'rgba(16, 185, 129, 0.6)', shadowBlur: 10 }, 
            itemStyle: { color: '#10b981', borderColor: '#fff', borderWidth: 2 },
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
            grid: { top: 20, bottom: 85, left: 80, right: 30 },
            xAxis: { 
                type: 'category', 
                data: days, 
                axisLabel: { color: '#94a3b8', fontSize: 11, interval: 1 }, 
                splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.01)', 'rgba(255,255,255,0.03)'] } }, 
                axisLine: { lineStyle: { color: '#334155' } },
                axisTick: { show: false }
            },
            yAxis: { 
                type: 'category', 
                data: levels, 
                axisLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' }, 
                axisLine: { lineStyle: { color: '#334155' } },
                axisTick: { show: false }
            },
            visualMap: { 
                min: 0, 
                max: maxEvents, 
                calculable: true, 
                orient: 'horizontal', 
                left: 'center', 
                bottom: 15,
                itemWidth: 18,
                itemHeight: 350,
                text: ['Crítico (Alto)', 'Normal (Bajo)'],
                textGap: 20,
                textStyle: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold' },
                inRange: { color: ['#1e293b', '#2563eb', '#10b981', '#fbbf24', '#ef4444', '#7f1d1d'] } 
            },
            series: [{ 
                name: 'Eventos Microsísmicos', 
                type: 'heatmap', 
                data: data, 
                label: { show: true, color: '#ffffff', fontSize: 11, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 4 },
                itemStyle: { borderColor: '#020617', borderWidth: 2, borderRadius: [2, 2, 2, 2] },
                emphasis: { itemStyle: { shadowBlur: 20, shadowColor: 'rgba(255, 255, 255, 0.5)', borderColor: '#fff', borderWidth: 2 } } 
            }]
        };
    }, [heatmapData]);

    const oeeData = kpis?.oee?.value || 92.4;
    const gaugeOption = {
        series: [
            {
                type: 'gauge',
                progress: { show: true, width: 24, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#10b981' }] } } },
                axisLine: { lineStyle: { width: 24, color: [[1, 'rgba(255,255,255,0.04)']] } },
                pointer: { length: '55%', width: 7, itemStyle: { color: '#f8fafc', shadowColor: 'rgba(0,0,0,0.5)', shadowBlur: 10, shadowOffsetY: 3 } },
                axisTick: { show: false },
                splitLine: { length: 28, lineStyle: { color: '#475569', width: 2 } },
                axisLabel: { color: '#94a3b8', distance: 35, fontSize: 11 },
                title: { color: '#cbd5e1', fontSize: 13, offsetCenter: [0, '75%'], fontWeight: '500' },
                detail: { valueAnimation: true, formatter: '{value}%', color: '#10b981', fontSize: 38, fontWeight: '900', offsetCenter: [0, '35%'], textShadowColor: 'rgba(16, 185, 129, 0.4)', textShadowBlur: 15 },
                data: [{ value: oeeData, name: 'Rendimiento General' }]
            }
        ]
    }

    return (
        <div className="w-full h-full p-6 lg:p-8 overflow-y-auto bg-[#020617] text-slate-200">
            <style dangerouslySetInnerHTML={{__html: `
                .premium-glass {
                    background: linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.95));
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    box-shadow: 0 15px 35px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
                    border-radius: 20px;
                    backdrop-filter: blur(24px);
                }
                .glow-text-blue { text-shadow: 0 0 20px rgba(59, 130, 246, 0.6); }
                .glow-text-emerald { text-shadow: 0 0 20px rgba(16, 185, 129, 0.6); }
                .glow-text-rose { text-shadow: 0 0 20px rgba(244, 63, 94, 0.6); }
                /* Customized scrollbar for dashboard */
                ::-webkit-scrollbar { width: 8px; }
                ::-webkit-scrollbar-track { background: #020617; }
                ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 10px; }
                ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
            `}} />
            
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 pb-5 border-b border-slate-800">
                <div>
                    <h2 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-emerald-400 to-emerald-300 tracking-tight drop-shadow-md">
                        Centro de Control Operacional
                    </h2>
                    <p className="text-slate-400 text-sm md:text-base mt-1.5 font-medium flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse"></span>
                        Análisis en tiempo real • Compañía Minera de Metales del Perú
                    </p>
                </div>
                <div className="mt-4 md:mt-0 flex items-center gap-3 bg-slate-800/50 px-5 py-2.5 rounded-full border border-slate-700 shadow-lg backdrop-blur-md">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Status General:</span>
                    <span className="text-xs font-black text-emerald-400 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Óptimo</span>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="premium-glass p-6 relative overflow-hidden group hover:-translate-y-1.5 transition-all duration-300">
                    <div className="absolute -right-8 -top-8 w-40 h-40 bg-blue-500/15 rounded-full blur-3xl group-hover:bg-blue-500/25 transition-all duration-500"></div>
                    <div className="text-xs font-bold text-blue-400 uppercase mb-3 tracking-widest flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                        Prod. Mensual
                    </div>
                    <div className="text-5xl font-extrabold text-white glow-text-blue mt-1">1,240<span className="text-2xl text-blue-200/40 font-semibold ml-1">kt</span></div>
                    <div className="flex items-center gap-2 mt-5">
                        <span className="text-[11px] font-bold text-white bg-blue-500/30 px-2.5 py-1 rounded-md border border-blue-400/30 shadow-[0_0_10px_rgba(59,130,246,0.2)]">+4.2%</span>
                        <span className="text-xs text-slate-400 font-medium">vs mes anterior</span>
                    </div>
                </div>

                <div className="premium-glass p-6 relative overflow-hidden group hover:-translate-y-1.5 transition-all duration-300">
                    <div className="absolute -right-8 -top-8 w-40 h-40 bg-emerald-500/15 rounded-full blur-3xl group-hover:bg-emerald-500/25 transition-all duration-500"></div>
                    <div className="text-xs font-bold text-emerald-400 uppercase mb-3 tracking-widest flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                        Ley de Cu Prom.
                    </div>
                    <div className="text-5xl font-extrabold text-white glow-text-emerald mt-1">2.46<span className="text-2xl text-emerald-200/40 font-semibold ml-1">%</span></div>
                    <div className="flex items-center gap-2 mt-5">
                        <span className="text-[11px] font-bold text-emerald-200 bg-emerald-500/30 px-2.5 py-1 rounded-md border border-emerald-400/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]">En Meta</span>
                        <span className="text-xs text-slate-400 font-medium">Dentro del plan</span>
                    </div>
                </div>

                <div className="premium-glass p-6 relative overflow-hidden group hover:-translate-y-1.5 transition-all duration-300">
                    <div className="absolute -right-8 -top-8 w-40 h-40 bg-rose-500/15 rounded-full blur-3xl group-hover:bg-rose-500/25 transition-all duration-500"></div>
                    <div className="text-xs font-bold text-rose-400 uppercase mb-3 tracking-widest flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        Riesgos Geomec.
                    </div>
                    <div className="text-5xl font-extrabold text-white glow-text-rose mt-1">14</div>
                    <div className="flex items-center gap-2 mt-5">
                        <span className="text-[11px] font-bold text-rose-100 bg-rose-500/40 px-2.5 py-1 rounded-md border border-rose-400/50 shadow-[0_0_10px_rgba(244,63,94,0.3)]">+2 Alertas</span>
                        <span className="text-xs text-slate-400 font-medium">Nuevos hoy</span>
                    </div>
                </div>

                <div className="premium-glass p-6 relative overflow-hidden group hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-center items-center">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-2 w-full text-left">OEE Planta Concentradora</h4>
                    <div className="w-full h-[140px] relative">
                        <div className="absolute inset-0">
                            <ReactECharts option={gaugeOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <div className="premium-glass p-7 flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h4 className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-blue-400">
                            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_#3b82f6]"></div>
                            Extracción de Mineral vs Desmonte
                        </h4>
                        <div className="text-[10px] bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-300 font-bold uppercase tracking-wider">Últimos 7 Días</div>
                    </div>
                    <div className="w-full h-[360px] relative">
                        <div className="absolute inset-0">
                            <ReactECharts option={barOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>
                
                <div className="premium-glass p-7 flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h4 className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-emerald-400">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]"></div>
                            Tendencia de Ley de Cobre (Cu)
                        </h4>
                        <div className="text-[10px] bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-300 font-bold uppercase tracking-wider">Promedio Mensual</div>
                    </div>
                    <div className="w-full h-[360px] relative">
                        <div className="absolute inset-0">
                            <ReactECharts option={lineOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Giant Heatmap */}
            <div className="premium-glass p-7 flex flex-col mb-16 relative">
                <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[100px] pointer-events-none z-0"></div>
                <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[100px] pointer-events-none z-0"></div>
                
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 z-10 mt-4">
                    <div>
                        <h4 className="flex items-center gap-3 text-base font-black uppercase tracking-widest text-amber-400 drop-shadow-md">
                            <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse shadow-[0_0_15px_#f59e0b]"></div>
                            Monitoreo Microsísmico Avanzado 3D
                        </h4>
                        <p className="text-sm text-slate-400 mt-2 ml-6 font-medium">Distribución espacio-temporal de liberación de energía por nivel estructural</p>
                    </div>
                    <div className="mt-4 md:mt-0 ml-6 md:ml-0 text-[11px] bg-slate-800/80 border border-slate-700/50 px-4 py-2 rounded-lg text-slate-300 font-bold tracking-widest uppercase shadow-md backdrop-blur-sm">
                        Últimos 15 Días (Alta Resolución)
                    </div>
                </div>
                
                {/* Massive container with min-h to prevent cutoff */}
                <div className="w-full min-h-[600px] relative z-10 pb-4">
                    <div className="absolute inset-0 rounded-xl overflow-hidden border border-slate-800 bg-slate-900/40 p-2">
                        <ReactECharts option={heatmapOption} style={{ height: '100%', width: '100%' }} />
                    </div>
                </div>
            </div>

            
            <div className="text-center text-xs text-slate-600 pb-12 font-medium tracking-wide">
                © 2026 SENSOR3D Platform - Dashboard Ejecutivo para Compañía Minera de Metales del Perú
            </div>
        </div>
    )
}

export default MiningDashboard
