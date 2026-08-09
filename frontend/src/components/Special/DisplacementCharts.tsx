import React, { memo, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

const TIMESTAMPS = [
    '04/08/2025 06:00 PM', '09/01/2024 06:00 PM', '01/27/2024 12:00 AM',
    '08/13/2023 12:00 AM', '12/08/2022 09:52 AM', '05/04/2022 10:42 AM',
    '09/11/2021 03:17 PM', '01/29/2021 10:49 AM', '06/27/2020 04:05 PM',
    '11/22/2019 11:30 AM', '07/26/2019 10:03 AM', '06/07/2018 03:35 PM',
    '01/27/2018 12:52 PM'
];

const COLORS = [
    '#f59e0b', '#10b981', '#38bdf8', '#8b5cf6', '#ec4899', '#f43f5e',
    '#06b6d4', '#84cc16', '#a855f7', '#6366f1', '#14b8a6', '#f97316', '#94a3b8'
];

interface DisplacementChartsProps {
    xRange?: [number, number];
    yRange?: [number, number];
}

const DisplacementCharts = ({ xRange = [-50, 50], yRange = [0, 60] }: DisplacementChartsProps) => {
    const generateSyntheticData = (index: number): [number, number][] => {
        const points: [number, number][] = [];
        let currentVal = 0;
        const baseCurve = (index % 3) - 1;

        for (let i = 0; i <= 40; i++) {
            const seed = (i * 0.123 + index * 0.456);
            currentVal += (Math.sin(seed) * 0.5) + baseCurve * 0.1;
            points.push([i, currentVal]);
        }
        return points;
    };

    const option = useMemo(() => {
        const depthMin = Math.min(yRange[0], 0);
        const depthMax = Math.max(yRange[1], 40);
        return {
            backgroundColor: 'transparent',
            title: {
                text: 'Curvas acumuladas vs profundidad',
                left: 'center',
                top: 6,
                textStyle: { color: '#cbd5e1', fontSize: 12, fontWeight: 'bold' },
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15, 23, 42, 0.94)',
                borderColor: 'rgba(56, 189, 248, 0.22)',
                textStyle: { color: '#f8fafc', fontSize: 11 },
                formatter: (params: any[]) => {
                    let html = `<div style="font-weight: bold; margin-bottom: 4px; color:#f8fafc;">Profundidad: ${params[0].value[0]} m</div>`;
                    params.forEach(p => {
                        html += `<div style="display: flex; justify-content: space-between; gap: 12px;">
                            <span style="color:#94a3b8">${p.seriesName}</span>
                            <span style="font-weight: bold; color: ${p.color}">${p.value[1].toFixed(2)} mm</span>
                        </div>`;
                    });
                    return html;
                }
            },
            grid: { top: 44, right: 28, bottom: 44, left: 52, containLabel: true },
            xAxis: {
                type: 'value',
                name: 'Profundidad (m)',
                nameLocation: 'middle',
                nameGap: 30,
                min: depthMin,
                max: depthMax,
                nameTextStyle: { color: '#cbd5e1', fontSize: 11 },
                axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.35)' } },
                splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.45)' } },
                axisLabel: { color: '#94a3b8', fontSize: 10 }
            },
            yAxis: {
                type: 'value',
                name: 'Desplaz. acum. (mm)',
                nameLocation: 'middle',
                nameGap: 48,
                min: xRange[0],
                max: xRange[1],
                nameTextStyle: { color: '#cbd5e1', fontSize: 11 },
                axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.35)' } },
                splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.45)' } },
                axisLabel: { color: '#94a3b8', fontSize: 10 }
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
    }, [xRange, yRange]);

    return (
        <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col p-3 md:p-4">
            <div className="min-h-[220px] flex-1">
                <ReactECharts option={option} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
            </div>
        </div>
    );
};

export default memo(DisplacementCharts);
