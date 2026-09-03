import React, { memo, useState, useEffect, useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import MiningWorkbenchHeader from './MiningWorkbenchHeader'
import { fetchWithAuthRetry } from '../../lib/fetchWithAuth'
import { toTrustedHtml } from '../../lib/trustedHtml'

import { log } from '../../lib/logger';

// Utilidades de fecha para los selectores de rango (heatmap + reporte
// sísmico) -- ISO 'YYYY-MM-DD' en UTC, sin dependencias externas.
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
};
const diffDaysInclusive = (start: string, end: string) => {
    const a = new Date(start + 'T00:00:00Z').getTime();
    const b = new Date(end + 'T00:00:00Z').getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return 15;
    return Math.max(1, Math.min(90, Math.round((b - a) / 86400000) + 1));
};

const MiningDashboard = () => {
    const [heatmapData, setHeatmapData] = useState<any[]>([]);
    const [kpis, setKpis] = useState<any>(null);
    const [sensorData, setSensorData] = useState<any>(null);
    const [seismicReport, setSeismicReport] = useState<any>(null);

    // Rango del heatmap microsísmico -- por defecto los últimos 15 días
    // (igual que antes), pero ahora seleccionable libremente.
    const [heatmapStart, setHeatmapStart] = useState(isoDaysAgo(14));
    const [heatmapEnd, setHeatmapEnd] = useState(isoToday());
    // Rango del Reporte Sismográfico (IGP/CENSIS + sensores propios) --
    // compartido entre ambas columnas, por defecto últimos 30 días.
    const [seismicStart, setSeismicStart] = useState(isoDaysAgo(29));
    const [seismicEnd, setSeismicEnd] = useState(isoToday());

    useEffect(() => {
        const fetchSensors = async () => {
            try {
                if (typeof process !== 'undefined' && (process as any).env?.VITEST) {
                    return
                }
                const apiUrl = new URL('/api/sensors/data', window.location.origin).toString()
                const res = await fetchWithAuthRetry(apiUrl);
                if (res.ok) {
                    setSensorData(await res.json());
                }
            } catch (err) {
                log.error("Error fetching sensor data:", err);
            }
        };
        fetchSensors();
    }, []);

    // Guards de orden de respuesta: <input type="date"> dispara onChange por
    // cada segmento completado (día, luego mes, luego año) al escribir con
    // teclado -- eso encadena varios fetch en paralelo, y si la respuesta de
    // un rango VIEJO llega después que la de uno NUEVO (orden de red no
    // garantizado), pisaba el estado bueno con datos obsoletos: el título
    // (ligado directo al estado local) se veía actualizado pero la tabla no,
    // exactamente el síntoma reportado. Cada efecto descarta cualquier
    // respuesta que no sea la del último request emitido.
    const metricsReqIdRef = useRef(0);
    const seismicReqIdRef = useRef(0);

    useEffect(() => {
        const reqId = ++metricsReqIdRef.current;
        const fetchMetrics = async () => {
            try {
                if (typeof process !== 'undefined' && (process as any).env?.VITEST) {
                    return
                }
                const days = diffDaysInclusive(heatmapStart, heatmapEnd);
                const apiUrl = new URL('/api/dashboard/metrics', window.location.origin);
                apiUrl.searchParams.set('days', String(days));
                const res = await fetchWithAuthRetry(apiUrl.toString());
                if (res.ok) {
                    const data = await res.json();
                    if (reqId !== metricsReqIdRef.current) return; // respuesta obsoleta, descartada
                    if (data.heatmap) setHeatmapData(data.heatmap);
                    if (data.kpis) setKpis(data.kpis);
                }
            } catch (err) {
                log.error("Error fetching dashboard metrics:", err);
            }
        };
        fetchMetrics();
    }, [heatmapStart, heatmapEnd]);

    useEffect(() => {
        // IGP/CENSIS (sismicidad oficial Perú) en vivo + microsismicidad propia
        // combinadas -- ver backend/src/mining/igp_seismic_client.cpp.
        const reqId = ++seismicReqIdRef.current;
        const fetchSeismicReport = async () => {
            try {
                if (typeof process !== 'undefined' && (process as any).env?.VITEST) {
                    return
                }
                const apiUrl = new URL('/api/mining/seismic/report', window.location.origin);
                apiUrl.searchParams.set('start', seismicStart);
                apiUrl.searchParams.set('end', seismicEnd);
                const res = await fetchWithAuthRetry(apiUrl.toString());
                if (res.ok) {
                    const json = await res.json();
                    if (reqId !== seismicReqIdRef.current) return; // respuesta obsoleta, descartada
                    setSeismicReport(json);
                }
            } catch (err) {
                log.error("Error fetching seismic report:", err);
            }
        };
        fetchSeismicReport();
    }, [seismicStart, seismicEnd]);

    // Agrupa mining_sensors por tipo (ver seed dashboard.sql) usando
    // sensor_types como diccionario id->nombre. Cubre las categorías reales
    // que ofrece la empresa (ver timetelemetry.com): Geotécnico/Estructural
    // (inclinómetros/piezómetros/radar), Ambiental (PM10/CO2) e Hidrológico
    // (nivel de relaves/caudal/pH) -- ya no KPIs de producción genéricos.
    const geotechSensors = useMemo(() => {
        const empty = { inclinometros: [] as any[], piezometros: [] as any[], radares: [] as any[] };
        if (!sensorData?.sensor_types || !sensorData?.sensors) return empty;
        const typeNameById: Record<number, string> = {};
        sensorData.sensor_types.forEach((t: any) => { typeNameById[t.id] = t.name; });
        const out = { inclinometros: [] as any[], piezometros: [] as any[], radares: [] as any[] };
        sensorData.sensors.forEach((s: any) => {
            const typeName = typeNameById[s.type_id];
            if (typeName === 'Inclinómetro') out.inclinometros.push(s);
            else if (typeName === 'Piezómetro') out.piezometros.push(s);
            else if (typeName === 'Radar de Taludes') out.radares.push(s);
        });
        return out;
    }, [sensorData]);

    const envSensors = useMemo(() => {
        const empty = { pm10: [] as any[], co2: [] as any[], relaves: [] as any[], ph: [] as any[], caudal: [] as any[] };
        if (!sensorData?.sensor_types || !sensorData?.sensors) return empty;
        const typeNameById: Record<number, string> = {};
        sensorData.sensor_types.forEach((t: any) => { typeNameById[t.id] = t.name; });
        const out = { pm10: [] as any[], co2: [] as any[], relaves: [] as any[], ph: [] as any[], caudal: [] as any[] };
        sensorData.sensors.forEach((s: any) => {
            const typeName = typeNameById[s.type_id];
            if (typeName === 'Partículas PM10') out.pm10.push(s);
            else if (typeName === 'Gas CO2') out.co2.push(s);
            else if (typeName === 'Nivel de Relaves') out.relaves.push(s);
            else if (typeName === 'Sensor de pH') out.ph.push(s);
            else if (typeName === 'Caudalímetro') out.caudal.push(s);
        });
        return out;
    }, [sensorData]);

    // Reemplaza "Extracción Mineral vs Desmonte" -- Recursos Hídricos:
    // nivel del dique de relaves por sensor (m), la métrica de seguridad
    // hídrica real que ofrece Telemetry Mining, no un KPI de producción.
    const hydroOption = useMemo(() => {
        const list = envSensors.relaves;
        const names = list.length > 0 ? list.map((s: any) => s.name) : ['Relaves Dique 1', 'Relaves Dique 2', 'Relaves Dique 3'];
        const values = list.length > 0 ? list.map((s: any) => Number(s.current_value) || 0) : [3.2, 4.1, 2.6];
        return {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#475569', borderWidth: 1, textStyle: { color: '#f8fafc', fontSize: 12 }, axisPointer: { type: 'shadow' } },
            grid: { top: 20, bottom: 26, left: 52, right: 14, containLabel: true },
            xAxis: {
                type: 'category',
                data: names,
                axisLine: { lineStyle: { color: '#64748b', width: 1 } },
                axisLabel: { color: '#cbd5e1', fontSize: 10, margin: 10, interval: 0 },
                axisTick: { alignWithLabel: true, lineStyle: { color: '#475569' } },
            },
            yAxis: {
                type: 'value',
                name: 'Nivel (m)',
                nameTextStyle: { color: '#94a3b8', fontSize: 11, padding: [0, 0, 8, 0] },
                axisLine: { show: true, lineStyle: { color: '#64748b', width: 1 } },
                axisLabel: { color: '#cbd5e1', fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)', type: 'dashed', width: 1 } },
            },
            series: [{
                name: 'Nivel de Relaves', type: 'bar', barWidth: '42%', data: values,
                itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#22d3ee' }, { offset: 1, color: '#0e7490' }] }, borderRadius: [2, 2, 0, 0], borderColor: 'rgba(15,23,42,0.9)', borderWidth: 1, shadowColor: 'rgba(34, 211, 238, 0.25)', shadowBlur: 6 }
            }]
        };
    }, [envSensors]);

    // Reemplaza "Tendencia Ley de Cobre (Cu)" -- Monitoreo Ambiental: serie
    // histórica real de PM10 (sensorData.history) si existe, o tendencia
    // ilustrativa si el sensor aún no tiene historial cargado.
    const envTrendOption = useMemo(() => {
        const pm10Ids = new Set(envSensors.pm10.map((s: any) => s.id));
        const points = (sensorData?.history || []).filter((h: any) => pm10Ids.has(h.sensor_id));
        let labels: string[];
        let values: number[];
        if (points.length > 0) {
            const sorted = [...points].sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            labels = sorted.map((p: any) => new Date(p.timestamp).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }));
            values = sorted.map((p: any) => Number(p.value) || 0);
        } else {
            labels = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
            values = [38, 46, 41, 52];
        }
        return {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#475569', borderWidth: 1, textStyle: { color: '#f8fafc', fontSize: 12 } },
            grid: { top: 36, bottom: 20, left: 48, right: 16, containLabel: true },
            xAxis: {
                type: 'category', data: labels, boundaryGap: false,
                axisLine: { lineStyle: { color: '#64748b', width: 1 } },
                axisLabel: { color: '#cbd5e1', fontSize: 10, margin: 10, interval: Math.max(0, Math.floor(labels.length / 8)) },
                axisTick: { lineStyle: { color: '#475569' } },
            },
            yAxis: {
                type: 'value', name: 'PM10 (µg/m³)', nameTextStyle: { color: '#94a3b8', fontSize: 11 },
                axisLine: { show: true, lineStyle: { color: '#64748b', width: 1 } },
                axisLabel: { color: '#cbd5e1', fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)', type: 'dashed', width: 1 } },
            },
            series: [{
                name: 'PM10', type: 'line', data: values, smooth: true, symbol: 'circle', symbolSize: 6,
                lineStyle: { color: '#f59e0b', width: 2.5, shadowColor: 'rgba(245, 158, 11, 0.35)', shadowBlur: 6 },
                itemStyle: { color: '#f59e0b', borderColor: '#fff7ed', borderWidth: 1.5 },
                areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(245, 158, 11, 0.35)' }, { offset: 1, color: 'rgba(245, 158, 11, 0.01)' }] } }
            }]
        };
    }, [envSensors, sensorData]);

    const heatmapOption = useMemo(() => {
        // Etiquetas de fecha real derivadas del rango elegido por el usuario
        // (antes fijo "Día 1".."Día 15"). day=1 del dataset mapea al primer
        // día del rango seleccionado, day=2 al segundo, etc. -- el dataset de
        // demo (dashboard_heatmap) no trae timestamp real, solo un índice
        // relativo, así que esto es un mapeo posicional honesto.
        const dayCount = diffDaysInclusive(heatmapStart, heatmapEnd);
        const days = Array.from({length: dayCount}, (_, i) => {
            const d = new Date(heatmapStart + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() + i);
            return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
        });
        const levels = ['Nv. 3800', 'Nv. 3850', 'Nv. 3900', 'Nv. 3950', 'Nv. 4000', 'Nv. 4050', 'Nv. 4100', 'Nv. 4150', 'Nv. 4200'];
        const data: [number, number, number][] = [];
        let maxEvents = 100;

        if (heatmapData && heatmapData.length > 0) {
            // Aggregate database points by day & level
            const grid: Record<string, number> = {};
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
                formatter: function (params: any) {
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
                axisLabel: { color: '#94a3b8', fontSize: 10, interval: Math.max(0, Math.ceil(days.length / 20) - 1), rotate: days.length > 20 ? 45 : 0 },
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
    }, [heatmapData, heatmapStart, heatmapEnd]);

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

    // Radar de Taludes (GB-SAR) -- velocidad de desplazamiento por sensor,
    // con bandas de alarma al estilo GroundProbe MonitorIQ: verde <2mm/h
    // (estable), ámbar 2-5mm/h (vigilancia), rojo >5mm/h (alerta de colapso).
    const radarOption = useMemo(() => {
        const radares = geotechSensors.radares;
        const names = radares.length > 0 ? radares.map((s: any) => s.name) : ['Talud Norte', 'Talud Sur', 'Botadero Este', 'Tajo Principal'];
        const values = radares.length > 0 ? radares.map((s: any) => Number(s.current_value) || 0) : [0.8, 1.6, 4.2, 6.9];
        const colorFor = (v: number) => v > 5 ? '#ef4444' : v > 2 ? '#f59e0b' : '#10b981';
        return {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#475569', borderWidth: 1, textStyle: { color: '#f8fafc', fontSize: 12 }, axisPointer: { type: 'shadow' } },
            grid: { top: 18, bottom: 34, left: 44, right: 14, containLabel: true },
            xAxis: { type: 'category', data: names, axisLabel: { color: '#cbd5e1', fontSize: 10, interval: 0, rotate: names.length > 3 ? 20 : 0 }, axisLine: { lineStyle: { color: '#64748b' } } },
            yAxis: { type: 'value', name: 'mm/h', nameTextStyle: { color: '#94a3b8', fontSize: 10 }, axisLabel: { color: '#cbd5e1', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)', type: 'dashed' } } },
            series: [{
                type: 'bar', barWidth: '46%', data: values.map((v: number) => ({ value: v, itemStyle: { color: colorFor(v), borderRadius: [3, 3, 0, 0] } })),
                markLine: { silent: true, symbol: 'none', lineStyle: { color: '#f59e0b', type: 'dashed', width: 1 }, label: { color: '#f59e0b', fontSize: 9, formatter: 'Umbral vigilancia' }, data: [{ yAxis: 2 }] },
            }]
        };
    }, [geotechSensors]);

    const inclinometerOption = useMemo(() => {
        const list = geotechSensors.inclinometros;
        const maxDeg = list.length > 0 ? Math.max(...list.map((s: any) => Math.abs(Number(s.current_value) || 0))) : 0.34;
        return {
            series: [{
                type: 'gauge', min: 0, max: 2, splitNumber: 4,
                progress: { show: true, width: 12, itemStyle: { color: maxDeg > 1 ? '#ef4444' : maxDeg > 0.5 ? '#f59e0b' : '#0ea5e9' } },
                axisLine: { lineStyle: { width: 12, color: [[1, 'rgba(255,255,255,0.04)']] } },
                pointer: { length: '52%', width: 4, itemStyle: { color: '#f8fafc' } },
                axisTick: { show: false }, splitLine: { length: 14, lineStyle: { color: '#475569' } },
                axisLabel: { color: '#94a3b8', distance: 18, fontSize: 8 },
                detail: { valueAnimation: true, formatter: '{value}°', color: '#e2e8f0', fontSize: 22, fontWeight: '900', offsetCenter: [0, '38%'] },
                data: [{ value: Number(maxDeg.toFixed(2)), name: 'Desplaz. Angular Máx.' }],
                title: { color: '#cbd5e1', fontSize: 10, offsetCenter: [0, '75%'] }
            }]
        };
    }, [geotechSensors]);

    const piezometerOption = useMemo(() => {
        const list = geotechSensors.piezometros;
        const names = list.length > 0 ? list.map((s: any) => s.name) : ['Piezómetro P-1', 'Piezómetro P-2', 'Piezómetro P-3'];
        const values = list.length > 0 ? list.map((s: any) => Number(s.current_value) || 0) : [112, 98, 134];
        return {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: '#475569', borderWidth: 1, textStyle: { color: '#f8fafc', fontSize: 12 } },
            grid: { top: 12, bottom: 30, left: 44, right: 14, containLabel: true },
            xAxis: { type: 'category', data: names, axisLabel: { color: '#cbd5e1', fontSize: 9, interval: 0 }, axisLine: { lineStyle: { color: '#64748b' } } },
            yAxis: { type: 'value', name: 'kPa', nameTextStyle: { color: '#94a3b8', fontSize: 10 }, axisLabel: { color: '#cbd5e1', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)', type: 'dashed' } } },
            series: [{ type: 'bar', barWidth: '46%', data: values, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#38bdf8' }, { offset: 1, color: '#0369a1' }] }, borderRadius: [3, 3, 0, 0] } }]
        };
    }, [geotechSensors]);

    // Sismos IGP/CENSIS (oficial) más recientes, ya normalizados por el backend.
    const igpEvents: any[] = (seismicReport?.igp?.events || []).slice(-8).reverse();

    // KPIs de cabecera reemplazados: red de sensores + calidad del aire, en
    // vez de producción/ley de mineral (no son el servicio que ofrece la
    // empresa -- ver timetelemetry.com).
    const totalSensorsCount = sensorData?.sensors?.length ?? 0;
    const categoriesCount = sensorData?.categories?.length ?? 0;
    const pm10Value = envSensors.pm10.length > 0 ? Number(envSensors.pm10[0].current_value) || 0 : 42;
    const pm10Level = pm10Value > 100 ? { label: 'Crítico', cls: 'bg-rose-500/40 border-rose-400/50 text-rose-100' }
        : pm10Value > 50 ? { label: 'Vigilancia', cls: 'bg-amber-500/30 border-amber-400/30 text-amber-100' }
        : { label: 'Dentro de ECA', cls: 'bg-emerald-500/30 border-emerald-400/30 text-emerald-200' };

    return (
        <div className="mining-dashboard-root box-border w-full max-w-full min-w-0 bg-[#020617] px-3 py-3 pb-12 text-slate-200 sm:px-4 sm:py-4">
            <style dangerouslySetInnerHTML={{__html: toTrustedHtml(`
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
            `)}} />

            <MiningWorkbenchHeader
                title="Centro de control operacional"
                subtitle="Análisis en tiempo real · Compañía Minera de Metales del Perú"
                actions={
                    <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/50 px-3 py-2 shadow-lg backdrop-blur-md">
                        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                        <span className="mining-workbench-action-btn text-emerald-400">Estado general óptimo</span>
                    </div>
                }
            />

            {/* KPI Cards — min-w-0 evita desborde horizontal en grillas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4 min-w-0">
                <div className="premium-glass p-3 sm:p-4 relative overflow-hidden group min-w-0">
                    <div className="absolute -right-6 -top-6 w-28 h-28 bg-blue-500/15 rounded-full blur-2xl group-hover:bg-blue-500/25 transition-all duration-500"></div>
                    <div className="text-[10px] font-bold text-blue-400 uppercase mb-1.5 tracking-wider flex items-center gap-1.5">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
                        Sensores en Red
                    </div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-white glow-text-blue mt-0.5 tabular-nums">{totalSensorsCount || '—'}</div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] font-bold text-white bg-blue-500/30 px-2 py-0.5 rounded border border-blue-400/30">{categoriesCount} categorías</span>
                        <span className="text-[10px] text-slate-400 font-medium">Geotécnico · Geoespacial · Ambiental · Hídrico</span>
                    </div>
                </div>

                <div className="premium-glass p-3 sm:p-4 relative overflow-hidden group min-w-0">
                    <div className="absolute -right-6 -top-6 w-28 h-28 bg-emerald-500/15 rounded-full blur-2xl group-hover:bg-emerald-500/25 transition-all duration-500"></div>
                    <div className="text-[10px] font-bold text-emerald-400 uppercase mb-1.5 tracking-wider flex items-center gap-1.5">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Calidad del Aire (PM10)
                    </div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-white glow-text-emerald mt-0.5 tabular-nums">{pm10Value}<span className="text-lg text-emerald-200/40 font-semibold ml-0.5">µg/m³</span></div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${pm10Level.cls}`}>{pm10Level.label}</span>
                        <span className="text-[10px] text-slate-400 font-medium">Estación Ambiental</span>
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

            {/* Monitoreo de Seguridad Geotécnica — inclinómetros, radar de taludes
                (GB-SAR) y piezómetros: los sensores reales que dan seguridad a la
                operación (ver GroundProbe MonitorIQ / Telemetry Mining), no solo
                KPIs de producción. */}
            <div className="premium-glass p-3 sm:p-4 flex flex-col mb-4 relative min-w-0 border-amber-500/20">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h4 className="flex items-center gap-2 text-xs sm:text-sm font-black uppercase tracking-wider text-orange-400 drop-shadow-md">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shadow-[0_0_10px_#f97316] shrink-0"></div>
                        Monitoreo de Seguridad Geotécnica
                    </h4>
                    <div className="shrink-0 text-[9px] bg-slate-800/80 border border-slate-700/50 px-2.5 py-1.5 rounded text-slate-300 font-bold tracking-wide uppercase">
                        Inclinómetros · Radar GB-SAR · Piezómetros
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 min-w-0">
                    <div className="mining-chart-frame flex flex-col p-2 min-w-0">
                        <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider px-1 pt-1">Inclinómetros — Talud/Botadero</div>
                        <div className="h-[180px] relative min-w-0">
                            <ReactECharts option={inclinometerOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                    <div className="mining-chart-frame flex flex-col p-2 min-w-0">
                        <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider px-1 pt-1">Radar de Taludes (GB-SAR) — Velocidad Desplaz.</div>
                        <div className="h-[180px] relative min-w-0">
                            <ReactECharts option={radarOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                    <div className="mining-chart-frame flex flex-col p-2 min-w-0">
                        <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider px-1 pt-1">Piezómetros — Presión de Poros</div>
                        <div className="h-[180px] relative min-w-0">
                            <ReactECharts option={piezometerOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Gráficos principales */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4 min-w-0">
                <div className="premium-glass p-3 sm:p-4 flex flex-col min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-cyan-400 min-w-0">
                            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_8px_#22d3ee] shrink-0"></div>
                            <span className="truncate">Recursos Hídricos — Nivel Dique de Relaves</span>
                        </h4>
                        <div className="text-[9px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 font-bold uppercase tracking-wide shrink-0">Lectura Actual</div>
                    </div>
                    <div className="mining-chart-frame w-full h-[268px] sm:h-[288px] relative min-h-[248px] min-w-0 p-2">
                        <div className="absolute inset-2 min-w-0">
                            <ReactECharts option={hydroOption} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>

                <div className="premium-glass p-3 sm:p-4 flex flex-col min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber-400 min-w-0">
                            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_#f59e0b] shrink-0"></div>
                            <span className="truncate">Monitoreo Ambiental — Partículas PM10</span>
                        </h4>
                        <div className="text-[9px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 font-bold uppercase tracking-wide shrink-0">Serie Histórica</div>
                    </div>
                    <div className="mining-chart-frame w-full h-[268px] sm:h-[288px] relative min-h-[248px] min-w-0 p-2">
                        <div className="absolute inset-2 min-w-0">
                            <ReactECharts option={envTrendOption} style={{ height: '100%', width: '100%' }} />
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
                    <div className="shrink-0 flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/50 px-2.5 py-1.5 rounded">
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">Rango</span>
                        <input type="date" value={heatmapStart} max={heatmapEnd} onChange={(e) => setHeatmapStart(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 tabular-nums" />
                        <span className="text-slate-500 text-[10px]">→</span>
                        <input type="date" value={heatmapEnd} min={heatmapStart} max={isoToday()} onChange={(e) => setHeatmapEnd(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 tabular-nums" />
                    </div>
                </div>

                <div className="mining-chart-frame relative z-10 min-h-[360px] w-full min-w-0 overflow-visible p-2 sm:min-h-[400px]" style={{ height: 'clamp(360px, 52vh, 520px)' }}>
                    <ReactECharts option={heatmapOption} style={{ height: '100%', width: '100%', minHeight: 300 }} />
                </div>
            </div>

            {/* Reporte Sismográfico combinado: sismos oficiales IGP/CENSIS (en
                vivo, ultimosismo.igp.gob.pe) vs. microsismicidad detectada por
                la red de sensores propia de la mina. */}
            <div className="premium-glass p-3 sm:p-4 flex flex-col mb-6 relative min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1 min-w-0">
                    <h4 className="flex items-center gap-2 text-xs sm:text-sm font-black uppercase tracking-wider text-red-400 drop-shadow-md">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_#ef4444] shrink-0"></div>
                        Reporte Sismográfico — IGP/CENSIS vs. Sensores Propios
                    </h4>
                    <div className="shrink-0 flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/50 px-2.5 py-1.5 rounded">
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">Rango</span>
                        <input type="date" value={seismicStart} max={seismicEnd} onChange={(e) => setSeismicStart(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 tabular-nums" />
                        <span className="text-slate-500 text-[10px]">→</span>
                        <input type="date" value={seismicEnd} min={seismicStart} max={isoToday()} onChange={(e) => setSeismicEnd(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 tabular-nums" />
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pl-4 sm:pl-5">
                    <p className="text-[10px] sm:text-xs text-slate-400 font-medium">
                        Fuente oficial de sismicidad en Perú: IGP (Instituto Geofísico del Perú) / CENSIS — no INDECI/Defensa Civil, que coordinan respuesta a emergencias, no detección sísmica.
                    </p>
                    <span className={`shrink-0 text-[9px] px-2 py-1 rounded font-bold tracking-wide uppercase border ${seismicReport?.igp?.available ? 'bg-emerald-900/40 border-emerald-600/40 text-emerald-300' : 'bg-slate-800/80 border-slate-700/50 text-slate-400'}`}>
                        {seismicReport?.igp?.available ? '● Conexión en vivo IGP' : 'Cargando IGP…'}
                    </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0">
                    <div className="mining-chart-frame p-2 min-w-0 flex flex-col">
                        <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider px-1 pt-1 mb-1">Sismos Oficiales IGP/CENSIS ({seismicStart} → {seismicEnd})</div>
                        <div className="overflow-y-auto max-h-[260px] min-w-0">
                            <table className="w-full text-[10px] text-left">
                                <thead className="text-slate-500 uppercase sticky top-0 bg-[#020617]">
                                    <tr>
                                        <th className="px-1.5 py-1">Fecha</th>
                                        <th className="px-1.5 py-1">Mag.</th>
                                        <th className="px-1.5 py-1">Prof.(km)</th>
                                        <th className="px-1.5 py-1">Referencia</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {igpEvents.length > 0 ? igpEvents.map((ev, i) => (
                                        <tr key={ev.codigo || i} className="border-t border-slate-800/70 text-slate-300">
                                            <td className="px-1.5 py-1 whitespace-nowrap tabular-nums">{ev.fecha_local || '—'}</td>
                                            <td className="px-1.5 py-1 tabular-nums font-bold text-amber-300">{ev.magnitud ?? '—'}</td>
                                            <td className="px-1.5 py-1 tabular-nums">{ev.profundidad ?? '—'}</td>
                                            <td className="px-1.5 py-1 truncate max-w-[180px]">{ev.referencia || '—'}</td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan={4} className="px-1.5 py-4 text-center text-slate-500">Sin datos del IGP disponibles en este momento.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div className="mining-chart-frame p-2 min-w-0 flex flex-col">
                        <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider px-1 pt-1 mb-1">Microsismicidad — Sensores Propios de la Mina</div>
                        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-4">
                            <div className="text-4xl font-extrabold text-white glow-text-blue tabular-nums">
                                {(seismicReport?.company?.events || []).length}
                            </div>
                            <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Eventos detectados ({seismicReport?.company?.days ?? diffDaysInclusive(seismicStart, seismicEnd)} días, todos los niveles)</div>
                            <div className="text-[9px] text-slate-500 mt-2 text-center px-4">
                                Cruce entre red interna (arreglo de geófonos/acelerógrafos por nivel estructural) y catálogo oficial permite discriminar sismicidad regional de eventos inducidos por la operación.
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="pb-2 text-center text-[10px] font-medium tracking-wide text-slate-600">
                © 2026 SENSOR3D Platform — Dashboard ejecutivo · Compañía Minera de Metales del Perú
            </div>
        </div>
    )
}

// Sin props: cualquier re-render de MiningDashboard disparado por el padre
// (src/App.tsx tiene 22 useState compartidos entre TODAS las pestañas de
// activeTab, incluyendo sliders de Azimuth/Inclinómetro que no le conciernen
// a este tab) es 100% desperdiciado — memo sin comparador (props siempre
// iguales: ninguna) elimina ese trabajo, sin afectar su estado/polling propio.
export default memo(MiningDashboard)
