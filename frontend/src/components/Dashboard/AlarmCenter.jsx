import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertTriangle, Bell, BellRing, CheckCircle2, XCircle, Clock,
  Activity, Thermometer, Droplets, Wind, Gauge, FileText,
  ChevronDown, ChevronUp, Filter, Search, Volume2, VolumeX,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   ALARM CENTER — Motor de Alarmas Automáticas con Umbrales y Prioridades
   Flujo: Alarma detectada → Panel alertas prioridad → Crear informe desde alarma
   ───────────────────────────────────────────────────────────────────────── */

const PRIORITY = {
  critical: { label: 'CRÍTICA', color: '#ef4444', bg: '#fef2f2', icon: AlertTriangle, pulse: true },
  high:     { label: 'ALTA',    color: '#f59e0b', bg: '#fffbeb', icon: BellRing, pulse: false },
  medium:   { label: 'MEDIA',   color: '#3b82f6', bg: '#eff6ff', icon: Bell, pulse: false },
  low:      { label: 'BAJA',    color: '#64748b', bg: '#f8fafc', icon: Activity, pulse: false },
};

const SENSOR_TYPES = {
  temperature: { label: 'Temperatura', unit: '°C', icon: Thermometer },
  pressure:    { label: 'Presión', unit: 'PSI', icon: Gauge },
  humidity:    { label: 'Humedad', unit: '%', icon: Droplets },
  gas:         { label: 'Gas', unit: 'ppm', icon: Wind },
  vibration:   { label: 'Vibración', unit: 'mm/s', icon: Activity },
};

/** Genera alarma de demostración para desarrollo */
function generateDemoAlarm(id) {
  const types = Object.keys(SENSOR_TYPES);
  const priorities = Object.keys(PRIORITY);
  const zones = ['Zona Norte - Nivel 1', 'Zona Sur - Nivel 2', 'Socavón Principal', 'Tajo Abierto', 'Planta Procesamiento'];
  const sType = types[id % types.length];
  const prio = priorities[id % priorities.length];
  const sensor = SENSOR_TYPES[sType];

  return {
    id: `ALM-${String(id).padStart(4, '0')}`,
    sensorId: `SEN-${String(100 + id).padStart(5, '0')}`,
    sensorType: sType,
    sensorLabel: `${sensor.label} ${zones[id % zones.length]}`,
    zone: zones[id % zones.length],
    priority: prio,
    value: (Math.random() * 100 + 50).toFixed(1),
    threshold: (Math.random() * 80 + 30).toFixed(1),
    unit: sensor.unit,
    timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString(),
    acknowledged: false,
    reportCreated: false,
    message: `Lectura fuera de umbral en ${sensor.label.toLowerCase()}`,
  };
}

function AlarmCard({ alarm, onAcknowledge, onCreateReport, expanded, onToggle }) {
  const prio = PRIORITY[alarm.priority] || PRIORITY.medium;
  const sensorInfo = SENSOR_TYPES[alarm.sensorType] || SENSOR_TYPES.temperature;
  const PrioIcon = prio.icon;
  const SensorIcon = sensorInfo.icon;

  return (
    <div
      className={`alarm-card alarm-card--${alarm.priority} ${alarm.acknowledged ? 'alarm-card--acked' : ''} ${prio.pulse ? 'alarm-card--pulse' : ''}`}
    >
      <div className="alarm-card-header" onClick={onToggle}>
        <div className="alarm-card-prio" style={{ color: prio.color }}>
          <PrioIcon size={16} />
          <span className="alarm-prio-label">{prio.label}</span>
        </div>
        <div className="alarm-card-info">
          <span className="alarm-id">{alarm.id}</span>
          <span className="alarm-sensor"><SensorIcon size={12} /> {alarm.sensorLabel}</span>
        </div>
        <div className="alarm-card-value" style={{ color: prio.color }}>
          <span className="alarm-reading">{alarm.value}</span>
          <span className="alarm-unit">{alarm.unit}</span>
        </div>
        <div className="alarm-card-time">
          <Clock size={11} />
          <span>{new Date(alarm.timestamp).toLocaleTimeString('es-PE')}</span>
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>

      {expanded && (
        <div className="alarm-card-body">
          <div className="alarm-detail-grid">
            <div className="alarm-detail"><span>Zona:</span><strong>{alarm.zone}</strong></div>
            <div className="alarm-detail"><span>Umbral:</span><strong>{alarm.threshold} {alarm.unit}</strong></div>
            <div className="alarm-detail"><span>Lectura:</span><strong style={{ color: prio.color }}>{alarm.value} {alarm.unit}</strong></div>
            <div className="alarm-detail"><span>Mensaje:</span><strong>{alarm.message}</strong></div>
          </div>
          <div className="alarm-actions">
            {!alarm.acknowledged && (
              <button type="button" className="alarm-btn alarm-btn--ack" onClick={() => onAcknowledge?.(alarm.id)}>
                <CheckCircle2 size={14} /> Reconocer
              </button>
            )}
            {!alarm.reportCreated && (
              <button type="button" className="alarm-btn alarm-btn--report" onClick={() => onCreateReport?.(alarm)}>
                <FileText size={14} /> Crear Informe
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AlarmCenter({ telemetryTenantId, onCreateReportFromAlarm }) {
  const [alarms, setAlarms] = useState(() =>
    Array.from({ length: 12 }, (_, i) => generateDemoAlarm(i + 1))
  );
  const [expandedId, setExpandedId] = useState(null);
  const [filterPriority, setFilterPriority] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showAcked, setShowAcked] = useState(false);

  const filteredAlarms = useMemo(() => {
    let filtered = alarms;
    if (!showAcked) filtered = filtered.filter((a) => !a.acknowledged);
    if (filterPriority !== 'all') filtered = filtered.filter((a) => a.priority === filterPriority);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter((a) =>
        a.id.toLowerCase().includes(q) ||
        a.sensorLabel.toLowerCase().includes(q) ||
        a.zone.toLowerCase().includes(q)
      );
    }
    return filtered.sort((a, b) => {
      const prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (prioOrder[a.priority] || 9) - (prioOrder[b.priority] || 9);
    });
  }, [alarms, filterPriority, searchTerm, showAcked]);

  const counts = useMemo(() => ({
    total: alarms.filter((a) => !a.acknowledged).length,
    critical: alarms.filter((a) => a.priority === 'critical' && !a.acknowledged).length,
    high: alarms.filter((a) => a.priority === 'high' && !a.acknowledged).length,
    medium: alarms.filter((a) => a.priority === 'medium' && !a.acknowledged).length,
    low: alarms.filter((a) => a.priority === 'low' && !a.acknowledged).length,
  }), [alarms]);

  const handleAcknowledge = useCallback((id) => {
    setAlarms((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a));
  }, []);

  const handleCreateReport = useCallback((alarm) => {
    setAlarms((prev) => prev.map((a) => a.id === alarm.id ? { ...a, reportCreated: true } : a));
    onCreateReportFromAlarm?.(alarm);
  }, [onCreateReportFromAlarm]);

  return (
    <div className="alarm-center">
      <div className="alarm-center-header">
        <div className="alarm-header-title">
          <BellRing size={18} className={counts.critical > 0 ? 'alarm-icon-pulse' : ''} />
          <span>Centro de Alarmas</span>
          {counts.total > 0 && <span className="alarm-total-badge">{counts.total}</span>}
        </div>
        <div className="alarm-header-controls">
          <button type="button" className="alarm-sound-btn"
            onClick={() => setSoundEnabled((v) => !v)} title={soundEnabled ? 'Silenciar' : 'Activar sonido'}>
            {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button type="button" className={`alarm-filter-btn ${showAcked ? 'active' : ''}`}
            onClick={() => setShowAcked((v) => !v)}>
            {showAcked ? 'Ocultar reconocidas' : 'Ver todas'}
          </button>
        </div>
      </div>

      {/* Priority summary */}
      <div className="alarm-prio-summary">
        {Object.entries(PRIORITY).map(([key, p]) => (
          <button
            key={key}
            className={`alarm-prio-chip ${filterPriority === key ? 'alarm-prio-chip--active' : ''}`}
            style={{ '--prio-color': p.color, '--prio-bg': p.bg }}
            onClick={() => setFilterPriority(filterPriority === key ? 'all' : key)}
          >
            <span className="alarm-prio-count">{counts[key] || 0}</span>
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="alarm-search">
        <Search size={14} />
        <input
          type="text"
          placeholder="Buscar por ID, sensor o zona..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Alarm list */}
      <div className="alarm-list">
        {filteredAlarms.length === 0 ? (
          <div className="alarm-empty">
            <CheckCircle2 size={24} />
            <p>Sin alarmas activas para el filtro actual.</p>
          </div>
        ) : (
          filteredAlarms.map((alarm) => (
            <AlarmCard
              key={alarm.id}
              alarm={alarm}
              expanded={expandedId === alarm.id}
              onToggle={() => setExpandedId(expandedId === alarm.id ? null : alarm.id)}
              onAcknowledge={handleAcknowledge}
              onCreateReport={handleCreateReport}
            />
          ))
        )}
      </div>
    </div>
  );
}

export { PRIORITY, SENSOR_TYPES, generateDemoAlarm };
