import React, { memo, useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Activity, Thermometer, Droplets, Wind, Gauge } from 'lucide-react';
import { telemetryTenantIdFromSession } from '../../../../../auth/telemetryTenant';
import { getSession } from '../../../../../auth/authStorage';
import { fetchMineSensors } from '../../../lib/api';
import { useSharedPoll } from '../../../lib/useSharedPoll';

import { log } from '../../../../../lib/logger';

const SENSOR_ICONS: Record<string, React.ReactNode> = {
  temperature: <Thermometer size={14} />,
  humidity: <Droplets size={14} />,
  pressure: <Gauge size={14} />,
  gas: <Wind size={14} />,
  vibration: <Activity size={14} />,
};

interface SensorWidgetProps {
  sensorId?: string | number;
  type?: string;
  title?: string;
  width?: number | string;
  height?: number | string;
  /** Botón "Conectar/Desconectar de la base de datos" del inspector — en
   * `false` deja de sondear el servidor; el historial ya cargado queda
   * congelado en pantalla. */
  connected?: boolean;
}

interface SensorDataPoint {
  time: string;
  value: string;
}

function SensorWidget({ sensorId, type = 'temperature', title = 'Sensor Data', width, height, connected = true }: SensorWidgetProps) {
  const [data, setData] = useState<SensorDataPoint[]>([]);
  const tenantId = telemetryTenantIdFromSession(getSession());
  // Todos los SensorWidget del mismo tenant comparten UN solo timer/pedido
  // HTTP (ver useSharedPoll.ts) -- antes cada widget traía la lista COMPLETA
  // de sensores por su cuenta cada 5s (N bloques de sensores en una página =
  // N pedidos idénticos redundantes cada 5s), pedido explícito 2026-09-11
  // tras confirmar el patrón en vivo. `key=null` cuando está "Desconectado"
  // saca a este widget del pool compartido sin afectar a los demás.
  const { data: allSensors, loading, error } = useSharedPoll(
    connected ? `sensors:${tenantId}` : null,
    () => fetchMineSensors(tenantId),
    5000,
  );

  useEffect(() => {
    if (error) log.error('Error fetching sensor data for widget:', error);
  }, [error]);

  useEffect(() => {
    if (!connected || !allSensors) return;
    const sid = Number(sensorId);
    const sensor = allSensors.find((s: any) => Number(s.id) === sid) || allSensors[0];
    if (!sensor) return;
    const v =
      sensor.current_value != null && !Number.isNaN(Number(sensor.current_value))
        ? Number(sensor.current_value).toFixed(2)
        : (Math.random() * 100).toFixed(2);
    setData((prev) => [...prev, { time: new Date().toLocaleTimeString(), value: v }].slice(-10));
  }, [allSensors, connected, sensorId]);

  const option = {
    grid: { top: 10, right: 10, bottom: 20, left: 40 },
    xAxis: {
      type: 'category',
      data: data.map(d => d.time),
      axisLabel: { fontSize: 9, color: '#94a3b8' }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
      axisLabel: { fontSize: 9, color: '#94a3b8' }
    },
    series: [
      {
        data: data.map(d => d.value),
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#6366f1', width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(99, 102, 241, 0.2)' },
              { offset: 1, color: 'rgba(99, 102, 241, 0)' }
            ]
          }
        }
      }
    ],
    animation: false
  };

  return (
    <div
      className="sensor-widget-container"
      style={{
        width,
        height,
        background: '#fff',
        borderRadius: 8,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'none',
      }}
    >
      <div className="sensor-widget-header" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ color: '#6366f1' }}>{SENSOR_ICONS[type] || <Activity size={14} />}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
          {title}
        </span>
        {!connected && (
          <span
            title="Desconectado de la base de datos — historial congelado, no se actualiza"
            style={{ fontSize: 9, fontWeight: 700, color: '#64748b', border: '1px solid #94a3b8', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}
          >
            desconectado
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8' }}>
            Cargando telemetría...
          </div>
        ) : (
          <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
        )}
      </div>
    </div>
  );
}

// Props llegan como valores derivados de element.props en PageCanvas.tsx, que
// preserva la identidad de los elementos hermanos sin cambios (useEditorStore
// ::updateElement solo reemplaza el elemento editado) — memo evita el
// re-render de este widget (su estado de telemetría vive en useSharedPoll,
// fuera de React, no afectado por saltarse renders del padre) cuando el
// usuario edita OTRO elemento de la página.
export default memo(SensorWidget);
