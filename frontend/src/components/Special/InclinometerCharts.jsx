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
    '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
    '#06b6d4', '#84cc16', '#a855f7', '#6366f1', '#14b8a6', '#f97316', '#64748b'
];

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

        // First pass: Generate and rotate steps
        const tempPoints = Array.from({ length: 41 }, (_, depth) => {
            if (depth > 2) {
                // Use deterministic seed for stability during rotation
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

        // Second pass: Shift all points so the bottom (depth=40) is the anchor (0,0)
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
            animation: false,
            tooltip: {
                trigger: 'axis',
                backgroundColor: '#ffffff',
                borderColor: '#e2e8f0',
                borderWidth: 1,
                padding: [10, 15],
                shadowBlur: 10,
                shadowColor: 'rgba(0,0,0,0.05)',
                textStyle: { color: '#475569', fontSize: 11 },
                extraCssText: 'border-radius: 8px;',
                formatter: (params) => {
                    const depth = params[0].value[1];
                    let html = `<div style="font-weight: 800; margin-bottom: 5px; color: #1e293b;">Depth: ${depth} m</div>`;
                    params.forEach(p => {
                        html += `<div style="display: flex; justify-content: space-between; gap: 20px; align-items: center; margin-bottom: 2px;">
                       <div style="display: flex; align-items: center; gap: 6px;">
                         <div style="width: 8px; height: 2px; background: ${p.color}; border-radius: 1px;"></div>
                         <span style="font-size: 10px; color: #64748b;">${p.seriesName}</span>
                       </div>
                       <span style="font-weight: 700; color: #1e293b;">${p.value[0].toFixed(2)} mm</span>
                     </div>`;
                    });
                    return html;
                }
            },
            grid: { top: 60, bottom: 60, left: 50, right: 30, containLabel: true },
            xAxis: {
                type: 'value',
                name: 'Displacement mm',
                nameLocation: 'middle',
                nameGap: 35,
                splitLine: { lineStyle: { color: '#f1f5f9' } },
                axisLabel: { color: '#94a3b8', fontSize: 10 },
                min: xRange[0],
                max: xRange[1]
            },
            yAxis: {
                type: 'value',
                name: 'Depth m',
                nameLocation: 'middle',
                nameGap: 40,
                inverse: true,
                min: yRange[0],
                max: yRange[1],
                splitLine: { lineStyle: { color: '#f1f5f9' } },
                axisLabel: { color: '#94a3b8', fontSize: 10 }
            },
        };

        const chartX = echarts.init(chartRefX.current);
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
            title: { text: 'Inclinometer X axis', left: 'center', top: 10, textStyle: { color: '#64748b', fontSize: 12, fontWeight: 'bold' } },
            series: seriesX
        });

        const chartY = echarts.init(chartRefY.current);
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
            title: { text: 'Inclinometer Y axis', left: 'center', top: 10, textStyle: { color: '#64748b', fontSize: 12, fontWeight: 'bold' } },
            series: seriesY
        });

        charts.current = { x: chartX, y: chartY };

        const handleResize = () => {
            chartX.resize();
            chartY.resize();
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            chartX.dispose();
            chartY.dispose();
        };
    }, [xRange, yRange, azimuthAngle]);

    return (
        <div className="flex w-full h-full bg-white p-6 gap-8 select-none">
            <div ref={chartRefX} className="flex-1 h-full" />
            <div ref={chartRefY} className="flex-1 h-full border-l border-slate-50" />
        </div>
    );
};

export default InclinometerCharts;
