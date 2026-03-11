import React from 'react'
import ReactECharts from 'echarts-for-react'

const MiningDashboard = () => {
    const barOption = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'], axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#1e293b' } } },
        series: [{ type: 'bar', data: [120, 200, 150, 80, 70, 110], itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#6366f1' }] }, borderRadius: [6, 6, 0, 0] } }]
    }

    const lineOption = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'], axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#1e293b' } } },
        series: [{ type: 'line', data: [5, 7, 6, 8, 9, 10], smooth: true, lineStyle: { color: '#0ea5e9' }, areaStyle: { color: 'rgba(14,165,233,0.12)' } }]
    }

    // create small heatmap matrix sample
    const heatmapData = []
    for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 10; j++) {
            heatmapData.push([i, j, Math.round(Math.random() * 100)])
        }
    }

    const heatmapOption = {
        backgroundColor: 'transparent',
        tooltip: { position: 'top' },
        xAxis: { type: 'category', data: Array.from({ length: 20 }, (_, i) => `X${i}`), axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'category', data: Array.from({ length: 10 }, (_, i) => `Y${i}`), axisLabel: { color: '#94a3b8' } },
        visualMap: { min: 0, max: 100, orient: 'vertical', left: 'right', top: 'middle', inRange: { color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'] } },
        series: [{ name: 'heat', type: 'heatmap', data: heatmapData, emphasis: { itemStyle: { borderColor: '#333', borderWidth: 1 } } }]
    }

    const gaugeOption = {
        series: [
            {
                type: 'gauge',
                progress: { show: true, width: 18, itemStyle: { color: '#0ea5e9' } },
                axisLine: { lineStyle: { width: 18 } },
                pointer: { length: '70%', width: 6 },
                detail: { valueAnimation: true, formatter: '{value}%', color: '#94a3b8' },
                data: [{ value: 78, name: 'Recovery' }]
            }
        ]
    }

    return (
        <div className="w-full h-full p-6">
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="glass p-4">
                    <div className="text-xs font-bold text-slate-400 uppercase mb-2">Producción (kt)</div>
                    <div className="text-2xl font-extrabold">1,240</div>
                    <div className="text-[11px] text-slate-500 mt-2">Último mes</div>
                </div>
                <div className="glass p-4">
                    <div className="text-xs font-bold text-slate-400 uppercase mb-2">Tasa de recuperación</div>
                    <div className="text-2xl font-extrabold">78%</div>
                    <div className="text-[11px] text-slate-500 mt-2">Últimos 30 días</div>
                </div>
                <div className="glass p-4">
                    <div className="text-xs font-bold text-slate-400 uppercase mb-2">Rendimiento</div>
                    <div className="text-2xl font-extrabold">+15%</div>
                    <div className="text-[11px] text-slate-500 mt-2">vs mes anterior</div>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
                <div className="glass p-4 col-span-2">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Rendimiento Operativo</h4>
                    <ReactECharts option={barOption} style={{ height: '320px' }} />
                </div>
                <div className="glass p-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Recovery Gauge</h4>
                    <ReactECharts option={gaugeOption} style={{ height: '320px' }} />
                </div>
            </div>

            <div className="mt-4 glass p-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Actividad Térmica (Heatmap)</h4>
                <ReactECharts option={heatmapOption} style={{ height: '380px' }} />
            </div>
        </div>
    )
}

export default MiningDashboard
