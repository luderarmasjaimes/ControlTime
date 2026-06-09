import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Thermometer, Droplets, Wind, Gauge, TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   DYNAMIC SENSOR FIELDS — Bloques de sensor vinculados a datos reales
   Se insertan en el documento y se actualizan automáticamente con telemetría
   ───────────────────────────────────────────────────────────────────────── */

const SENSOR_DEFS = {
  temperature: { label: 'Temperatura', unit: '°C', icon: Thermometer, color: '#ef4444', ranges: { min: -20, max: 200, warning: 80, critical: 120 } },
  pressure:    { label: 'Presión', unit: 'PSI', icon: Gauge, color: '#3b82f6', ranges: { min: 0, max: 5000, warning: 3500, critical: 4500 } },
  humidity:    { label: 'Humedad', unit: '%RH', icon: Droplets, color: '#06b6d4', ranges: { min: 0, max: 100, warning: 85, critical: 95 } },
  gas:         { label: 'Gas', unit: 'ppm', icon: Wind, color: '#f59e0b', ranges: { min: 0, max: 1000, warning: 500, critical: 800 } },
  vibration:   { label: 'Vibración', unit: 'mm/s', icon: Activity, color: '#8b5cf6', ranges: { min: 0, max: 50, warning: 25, critical: 40 } },
  flow:        { label: 'Caudal', unit: 'L/min', icon: Activity, color: '#10b981', ranges: { min: 0, max: 500, warning: 350, critical: 450 } },
  level:       { label: 'Nivel', unit: 'm', icon: Activity, color: '#6366f1', ranges: { min: 0, max: 100, warning: 80, critical: 95 } },
};

function generateSparkData(count = 20) {
  const data = [];
  let val = 50 + Math.random() * 30;
  for (let i = 0; i < count; i++) {
    val += (Math.random() - 0.5) * 10;
    val = Math.max(10, Math.min(95, val));
    data.push(val);
  }
  return data;
}

function MiniSparkline({ data, color, width = 80, height = 24 }) {
  if (!data?.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="sensor-sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

function getValueStatus(value, ranges) {
  if (value >= ranges.critical) return 'critical';
  if (value >= ranges.warning) return 'warning';
  return 'normal';
}

export default function DynamicSensorField({
  sensorType = 'temperature',
  sensorId = 'SEN-00001',
  zone = 'Zona Norte',
  compact = false,
  showSparkline = true,
  showThresholds = true,
  refreshInterval = 5000,
}) {
  const def = SENSOR_DEFS[sensorType] || SENSOR_DEFS.temperature;
  const Icon = def.icon;
  const [value, setValue] = useState(() => def.ranges.min + Math.random() * (def.ranges.max - def.ranges.min) * 0.6);
  const [prevValue, setPrevValue] = useState(value);
  const [sparkData, setSparkData] = useState(() => generateSparkData());
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setPrevValue(value);
      const next = value + (Math.random() - 0.48) * (def.ranges.max * 0.05);
      const clamped = Math.max(def.ranges.min, Math.min(def.ranges.max, next));
      setValue(clamped);
      setSparkData(prev => [...prev.slice(1), clamped]);
      setLastUpdate(new Date());
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [value, refreshInterval, def.ranges]);

  const status = getValueStatus(value, def.ranges);
  const trend = value > prevValue ? 'up' : value < prevValue ? 'down' : 'stable';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const pct = ((value - def.ranges.min) / (def.ranges.max - def.ranges.min)) * 100;

  if (compact) {
    return (
      <div className={`dsf-compact dsf-compact--${status}`}>
        <Icon size={12} style={{ color: def.color }} />
        <span className="dsf-compact-value">{value.toFixed(1)}</span>
        <span className="dsf-compact-unit">{def.unit}</span>
        <TrendIcon size={10} className={`dsf-trend dsf-trend--${trend}`} />
      </div>
    );
  }

  return (
    <div className={`dsf-card dsf-card--${status}`}>
      <div className="dsf-card-header">
        <div className="dsf-type-badge" style={{ '--dsf-color': def.color }}>
          <Icon size={14} />
          <span>{def.label}</span>
        </div>
        <div className="dsf-meta">
          <span className="dsf-sensor-id">{sensorId}</span>
          <span className="dsf-zone">{zone}</span>
        </div>
      </div>

      <div className="dsf-card-body">
        <div className="dsf-value-block">
          <span className={`dsf-value dsf-value--${status}`}>{value.toFixed(1)}</span>
          <span className="dsf-unit">{def.unit}</span>
          <TrendIcon size={14} className={`dsf-trend dsf-trend--${trend}`} />
        </div>

        {showSparkline && <MiniSparkline data={sparkData} color={def.color} width={100} height={28} />}
      </div>

      {showThresholds && (
        <div className="dsf-gauge-bar">
          <div className="dsf-gauge-track">
            <div className="dsf-gauge-fill" style={{ width: `${Math.min(100, pct)}%`, background: status === 'critical' ? '#ef4444' : status === 'warning' ? '#f59e0b' : def.color }} />
            <div className="dsf-gauge-warn-mark" style={{ left: `${(def.ranges.warning / def.ranges.max) * 100}%` }} title={`Alerta: ${def.ranges.warning}`} />
            <div className="dsf-gauge-crit-mark" style={{ left: `${(def.ranges.critical / def.ranges.max) * 100}%` }} title={`Crítico: ${def.ranges.critical}`} />
          </div>
          <div className="dsf-gauge-labels">
            <span>{def.ranges.min}</span>
            <span className="dsf-gauge-warn">{def.ranges.warning}</span>
            <span className="dsf-gauge-crit">{def.ranges.critical}</span>
            <span>{def.ranges.max}</span>
          </div>
        </div>
      )}

      <div className="dsf-card-footer">
        <span className="dsf-timestamp">{lastUpdate.toLocaleTimeString('es-PE')}</span>
        {status !== 'normal' && (
          <span className={`dsf-status-pill dsf-status-pill--${status}`}>
            <AlertTriangle size={10} />
            {status === 'critical' ? 'CRÍTICO' : 'ALERTA'}
          </span>
        )}
      </div>
    </div>
  );
}

export function DynamicSensorFieldConfig({ onInsert }) {
  const [sType, setSType] = useState('temperature');
  const [sId, setSId] = useState('SEN-00001');
  const [zone, setZone] = useState('Zona Norte - Nivel 1');

  return (
    <div className="dsf-config">
      <h4>Configurar Campo de Sensor</h4>
      <label>Tipo sensor
        <select value={sType} onChange={(e) => setSType(e.target.value)}>
          {Object.entries(SENSOR_DEFS).map(([k, v]) => (
            <option key={k} value={k}>{v.label} ({v.unit})</option>
          ))}
        </select>
      </label>
      <label>ID Sensor<input value={sId} onChange={(e) => setSId(e.target.value)} /></label>
      <label>Zona<input value={zone} onChange={(e) => setZone(e.target.value)} /></label>
      <button type="button" onClick={() => onInsert?.({ sensorType: sType, sensorId: sId, zone })} className="alarm-btn alarm-btn--ack">
        <Activity size={14} /> Insertar en documento
      </button>
    </div>
  );
}

export { SENSOR_DEFS };
