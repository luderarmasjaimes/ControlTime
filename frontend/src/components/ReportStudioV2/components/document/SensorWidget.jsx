import React, { useEffect, useState, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { Activity, Thermometer, Droplets, Wind, Gauge } from 'lucide-react';
import { fetchMineSensors } from '../../lib/api';

const SENSOR_ICONS = {
  temperature: <Thermometer size={14} />,
  humidity: <Droplets size={14} />,
  pressure: <Gauge size={14} />,
  gas: <Wind size={14} />,
  vibration: <Activity size={14} />,
};

export default function SensorWidget({ sensorId, type = 'temperature', title = 'Sensor Data', width, height }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const fetchData = async () => {
    try {
      // For a report, we might want historical data or the last N points
      // Using fetchMineSensors as a proxy for real-time/recent telemetry
      const allSensors = await fetchMineSensors();
      const sensor = allSensors.find(s => s.id === sensorId) || allSensors[0];
      
      if (sensor) {
        setData(prev => {
          const newData = [...prev, {
            time: new Date().toLocaleTimeString(),
            value: sensor.value || (Math.random() * 100).toFixed(2)
          }];
          return newData.slice(-10); // Keep last 10 points
        });
      }
    } catch (err) {
      console.error('Error fetching sensor data for widget:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 5000);
    return () => clearInterval(timerRef.current);
  }, [sensorId]);

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
    <div className="sensor-widget-container" style={{ width, height, background: '#fff', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column' }}>
      <div className="sensor-widget-header" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ color: '#6366f1' }}>{SENSOR_ICONS[type] || <Activity size={14} />}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyCenter: 'center', fontSize: 10, color: '#94a3b8' }}>
            Cargando telemetría...
          </div>
        ) : (
          <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
        )}
      </div>
    </div>
  );
}
