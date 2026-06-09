import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

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

const axisLine = { lineStyle: { color: 'rgba(148, 163, 184, 0.35)' } };
const splitLine = { lineStyle: { color: 'rgba(51, 65, 85, 0.45)' } };
const axisLabel = { color: '#94a3b8', fontSize: 10 };
const nameTextStyle = { color: '#cbd5e1', fontSize: 11 };

const InclinometerCharts = ({ xRange = [-40, 40], yRange = [0, 40], azimuthAngle = 0, installationAngle = 0 }) => {
    const chartRefX = useRef(null);
    const chartRefY = useRef(null);
    const charts = useRef({ x: null, y: null });

    const generateRotatedData = (index) => {
        let currentX = 0;
        let currentY = 0;
        const rad = ((installationAngle + azimuthAngle) * Math.PI) / 180;

        const baseCurveX = (index % 3) - 1;
        const baseCurveY = (index % 2) - 0.5;

        const tempPoints = Array.from({ length: 41 }, (_, depth) => {
            if (depth > 2) {
                const seed = (depth * 0.123 + index * 0.456);
                const stepX = (Math.sin(seed) * 0.3) + baseCurveX * 0.2;
                const stepY = (Math.cos(seed * 0.8) * 0.3) + baseCurveY * 0.2;

                const rotatedStepX = stepX * Math.cos(rad) - stepY * Math.sin(rad);
                const rotatedStepY = stepX * Math.sin(rad) + stepY * Math.cos(rad);

                currentX += rotatedStepX;
                currentY += rotatedStepY;
            }
            return { depth, x: currentX, y: currentY };
        });

        const anchorX = tempPoints[40].x;
        const anchorY = tempPoints[40].y;

        return tempPoints.map(p => ({
            depth: p.depth,
            x: p.x - anchorX,
            y: p.y - anchorY
        }));
    };

    useEffect(() => {
        const fullData = TIMESTAMPS.map((_, i) => generateRotatedData(i));

        const commonOption = {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15, 23, 42, 0.94)',
                borderColor: 'rgba(56, 189, 248, 0.25)',
                borderWidth: 1,
                padding: [10, 14],
                textStyle: { color: '#e2e8f0', fontSize: 11 },
                extraCssText: 'border-radius: 10px;',
                formatter: (params) => {
                    const depth = params[0].value[1];
                    let html = `<div style="font-weight: 800; margin-bottom: 6px; color: #f8fafc;">Profundidad: ${depth} m</div>`;
                    params.forEach(p => {
                        html += `<div style="display: flex; justify-content: space-between; gap: 20px; align-items: center; margin-bottom: 2px;">
                       <div style="display: flex; align-items: center; gap: 6px;">
                         <div style="width: 8px; height: 2px; background: ${p.color}; border-radius: 1px;"></div>
                         <span style="font-size: 10px; color: #94a3b8;">${p.seriesName}</span>
                       </div>
                       <span style="font-weight: 700; color: #f1f5f9;">${p.value[0].toFixed(2)} mm</span>
                     </div>`;
                    });
                    return html;
                }
            },
            grid: { top: 52, bottom: 48, left: 52, right: 28, containLabel: true },
            xAxis: {
                type: 'value',
                name: 'Desplazamiento (mm)',
                nameLocation: 'middle',
                nameGap: 32,
                nameTextStyle,
                splitLine,
                axisLine,
                axisLabel,
                min: xRange[0],
                max: xRange[1]
            },
            yAxis: {
                type: 'value',
                name: 'Profundidad (m)',
                nameLocation: 'middle',
                nameGap: 44,
                nameTextStyle,
                inverse: true,
                min: yRange[0],
                max: yRange[1],
                splitLine,
                axisLine,
                axisLabel
            },
        };

        const chartX = echarts.init(chartRefX.current, null, { renderer: 'canvas' });
        const seriesX = TIMESTAMPS.map((t, i) => ({
            name: t,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.2, color: COLORS[i % COLORS.length] },
            data: fullData[i].map(d => [d.x, d.depth])
        }));

        chartX.setOption({
            ...commonOption,
            title: {
                text: 'Eje X — inclinómetro',
                left: 'center',
                top: 8,
                textStyle: { color: '#cbd5e1', fontSize: 12, fontWeight: 'bold' }
            },
            series: seriesX
        });

        const chartY = echarts.init(chartRefY.current, null, { renderer: 'canvas' });
        const seriesY = TIMESTAMPS.map((t, i) => ({
            name: t,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.2, color: COLORS[i % COLORS.length] },
            data: fullData[i].map(d => [d.y, d.depth])
        }));

        chartY.setOption({
            ...commonOption,
            title: {
                text: 'Eje Y — inclinómetro',
                left: 'center',
                top: 8,
                textStyle: { color: '#cbd5e1', fontSize: 12, fontWeight: 'bold' }
            },
            series: seriesY
        });

        charts.current = { x: chartX, y: chartY };

        const handleResize = () => {
            chartX.resize();
            chartY.resize();
        };

        window.addEventListener('resize', handleResize);
        handleResize();
        return () => {
            window.removeEventListener('resize', handleResize);
            chartX.dispose();
            chartY.dispose();
        };
    }, [xRange, yRange, azimuthAngle, installationAngle]);

    return (
        <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col gap-0 select-none md:flex-row md:gap-0">
            <div ref={chartRefX} className="min-h-[240px] flex-1 p-3 md:min-h-0 md:p-4" />
            <div
                ref={chartRefY}
                className="min-h-[240px] flex-1 border-t border-slate-600/40 p-3 md:min-h-0 md:border-l md:border-t-0 md:p-4"
            />
        </div>
    );
};

export default InclinometerCharts;
