import React from 'react';
import ReactECharts from 'echarts-for-react';

const TIMESTAMPS = [
    '04/08/2025 06:00 PM', '09/01/2024 06:00 PM', '01/27/2024 12:00 AM',
    '08/13/2023 12:00 AM', '12/08/2022 09:52 AM', '05/04/2022 10:42 AM',
    '09/11/2021 03:17 PM', '01/29/2021 10:49 AM', '06/27/2020 04:05 PM',
    '11/22/2019 11:30 AM', '07/26/2019 10:03 AM', '06/07/2018 03:35 PM',
    '01/27/2018 12:52 PM'
];

const COLORS = [
    '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
    '#06b6d4', '#84cc16', '#a855f7', '#6366f1', '#14b8a6', '#f97316', '#64748b'
];

const DisplacementCharts = ({ xRange = [-50, 50], yRange = [0, 60] }) => {

    const generateSyntheticData = (index) => {
        const points = [];
        let currentVal = 0;
        const baseCurve = (index % 3) - 1;

        for (let i = 0; i <= 40; i++) {
            const seed = (i * 0.123 + index * 0.456);
            currentVal += (Math.sin(seed) * 0.5) + baseCurve * 0.1;
            points.push([i, currentVal]);
        }
        return points;
    };

    const getOption = () => {
        return {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                textStyle: { color: '#f8fafc', fontSize: 11 },
                formatter: (params) => {
                    let html = `<div style="font-weight: bold; margin-bottom: 4px;">Depth: ${params[0].value[0]}m</div>`;
                    params.forEach(p => {
                        html += `<div style="display: flex; justify-content: space-between; gap: 12px;">
                            <span>${p.seriesName}:</span>
                            <span style="font-weight: bold; color: ${p.color}">${p.value[1].toFixed(2)} mm</span>
                        </div>`;
                    });
                    return html;
                }
            },
            grid: { top: 40, right: 30, bottom: 40, left: 50, containLabel: true },
            xAxis: {
                type: 'value',
                name: 'Depth (m)',
                nameLocation: 'middle',
                nameGap: 30,
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
                axisLabel: { color: '#94a3b8' }
            },
            yAxis: {
                type: 'value',
                name: 'Cumulative Disp. (mm)',
                nameLocation: 'middle',
                nameGap: 40,
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
                axisLabel: { color: '#94a3b8' }
            },
            series: TIMESTAMPS.map((t, i) => ({
                name: t,
                type: 'line',
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1.5, color: COLORS[i % COLORS.length] },
                data: generateSyntheticData(i)
            }))
        };
    };

    return (
        <div className="w-full h-full p-4 bg-slate-900/50">
            <ReactECharts option={getOption()} style={{ height: '100%', width: '100%' }} />
        </div>
    );
};

export default DisplacementCharts;
