import React, { memo, useState, useEffect, useMemo } from 'react';
import {
  Activity, Zap, Database,
  BarChart3, Layers, Radio,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   REAL-TIME TELEMETRY DASHBOARD — Dual-stream monitoring
   I12-I15: Kinesis hot-path + Kafka cold-path + QuestDB + TimescaleDB
   FX09: Dashboard Kafka telemetría tiempo real avanzado
   ───────────────────────────────────────────────────────────────────────── */

interface TelemetryEvent {
  sensorId: string;
  type: string;
  zone: string;
  value: string;
  timestamp: number;
  stream: 'kafka' | 'kinesis';
}

function generateMockTelemetry(): TelemetryEvent {
  const types = ['temperature', 'pressure', 'humidity', 'gas', 'vibration'];
  const zones = ['Norte-N1', 'Norte-N2', 'Sur-N1', 'Este-N1', 'Oeste-N1', 'Central'];
  return {
    sensorId: `SEN-${String(Math.floor(Math.random() * 10000)).padStart(5, '0')}`,
    type: types[Math.floor(Math.random() * types.length)],
    zone: zones[Math.floor(Math.random() * zones.length)],
    value: (Math.random() * 100).toFixed(2),
    timestamp: Date.now(),
    stream: Math.random() > 0.3 ? 'kafka' : 'kinesis',
  };
}

interface MiniSparkSVGProps {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}

function MiniSparkSVG({ data, color, width = 60, height = 20 }: MiniSparkSVGProps) {
  if (!data?.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 2)}`
  ).join(' ');
  return (
    <svg width={width} height={height}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

interface StreamStatusProps {
  label: string;
  icon: React.ElementType;
  color: string;
  msgPerSec: number;
  latencyMs: number;
  status: 'connected' | 'degraded';
}

function StreamStatus({ label, icon: Icon, color, msgPerSec, latencyMs, status }: StreamStatusProps) {
  return (
    <div className="td-stream" style={{ '--stream-color': color } as React.CSSProperties}>
      <div className="td-stream-header">
        <Icon size={14} style={{ color }} />
        <span className="td-stream-name">{label}</span>
        <span className={`td-stream-status td-stream-status--${status}`}>
          {status === 'connected' ? '●' : '◐'} {status}
        </span>
      </div>
      <div className="td-stream-metrics">
        <div className="td-metric">
          <span className="td-metric-value">{msgPerSec.toFixed(0)}</span>
          <span className="td-metric-label">msg/s</span>
        </div>
        <div className="td-metric">
          <span className="td-metric-value">{latencyMs.toFixed(0)}</span>
          <span className="td-metric-label">ms lat</span>
        </div>
      </div>
    </div>
  );
}

interface DatabaseStatusProps {
  label: string;
  icon: React.ElementType;
  color: string;
  queryMs: number;
  connections: number;
  storage: string;
  status: string;
}

function DatabaseStatus({ label, icon: Icon, color, queryMs, connections, storage, status }: DatabaseStatusProps) {
  return (
    <div className="td-db" style={{ '--db-color': color } as React.CSSProperties}>
      <div className="td-db-header">
        <Icon size={14} style={{ color }} />
        <span>{label}</span>
        <span className={`td-stream-status td-stream-status--${status}`}>
          {status === 'healthy' ? '✓' : '⚠'} {status}
        </span>
      </div>
      <div className="td-db-metrics">
        <span>Query: <b>{queryMs}ms</b></span>
        <span>Conn: <b>{connections}</b></span>
        <span>Store: <b>{storage}</b></span>
      </div>
    </div>
  );
}

interface TelemetryDashboardProps {
  telemetryTenantId?: string;
}

function TelemetryDashboard({ telemetryTenantId }: TelemetryDashboardProps) {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [kinesisRate, setKinesisRate] = useState(0);
  const [kafkaRate, setKafkaRate] = useState(0);
  const [kinesisLatency, setKinesisLatency] = useState(0);
  const [kafkaLatency, setKafkaLatency] = useState(0);
  const [rateHistory, setRateHistory] = useState<number[]>([]);
  const [sensorCounts, setSensorCounts] = useState<Record<string, number>>({});
  const [zoneCounts, setZoneCounts] = useState<Record<string, number>>({});

  // Simulated telemetry feed
  useEffect(() => {
    const interval = setInterval(() => {
      const batch = Array.from({ length: Math.floor(Math.random() * 5) + 1 }, generateMockTelemetry);
      setEvents(prev => [...batch, ...prev].slice(0, 50));
      setTotalEvents(prev => prev + batch.length);

      const kinBatch = batch.filter(e => e.stream === 'kinesis').length;
      const kafBatch = batch.filter(e => e.stream === 'kafka').length;
      setKinesisRate(prev => prev * 0.7 + kinBatch * 60 * 0.3);
      setKafkaRate(prev => prev * 0.7 + kafBatch * 40 * 0.3);
      setKinesisLatency(Math.max(5, Math.random() * 80));
      setKafkaLatency(Math.max(10, Math.random() * 150));
      setRateHistory(prev => [...prev.slice(-29), kinBatch + kafBatch]);

      setSensorCounts(sc => {
        const next = { ...sc };
        batch.forEach(e => { next[e.type] = (next[e.type] || 0) + 1; });
        return next;
      });
      setZoneCounts(zc => {
        const next = { ...zc };
        batch.forEach(e => { next[e.zone] = (next[e.zone] || 0) + 1; });
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const topZones = useMemo(() =>
    Object.entries(zoneCounts).sort(([, a], [, b]) => b - a).slice(0, 6),
    [zoneCounts]
  );

  const typeColors: Record<string, string> = {
    temperature: '#ef4444',
    pressure: '#3b82f6',
    humidity: '#06b6d4',
    gas: '#f59e0b',
    vibration: '#8b5cf6',
  };

  return (
    <div className="td-panel">
      <div className="td-header">
        <Radio size={16} className="td-pulse" />
        <span className="td-title">Telemetría en Vivo</span>
        <span className="td-tenant">Tenant: {telemetryTenantId || 'default'}</span>
        <span className="td-total">{totalEvents.toLocaleString()} eventos</span>
      </div>

      <div className="td-streams-row">
        <StreamStatus
          label="Kinesis Hot-Path"
          icon={Zap}
          color="#f59e0b"
          msgPerSec={kinesisRate}
          latencyMs={kinesisLatency}
          status={kinesisLatency < 100 ? 'connected' : 'degraded'}
        />
        <StreamStatus
          label="Kafka Cold-Path"
          icon={Layers}
          color="#6366f1"
          msgPerSec={kafkaRate}
          latencyMs={kafkaLatency}
          status={kafkaLatency < 200 ? 'connected' : 'degraded'}
        />
      </div>

      <div className="td-dbs-row">
        <DatabaseStatus
          label="QuestDB (RT 72h)"
          icon={Database}
          color="#22d3ee"
          queryMs={Math.floor(Math.random() * 8 + 2)}
          connections={Math.floor(Math.random() * 20 + 10)}
          storage="2.4 GB"
          status="healthy"
        />
        <DatabaseStatus
          label="TimescaleDB (Hist)"
          icon={Database}
          color="#10b981"
          queryMs={Math.floor(Math.random() * 50 + 20)}
          connections={Math.floor(Math.random() * 15 + 5)}
          storage="128 GB"
          status="healthy"
        />
      </div>

      <div className="td-throughput">
        <div className="td-throughput-label">
          <BarChart3 size={12} /> Throughput (msg/s)
        </div>
        <MiniSparkSVG data={rateHistory} color="#22d3ee" width={200} height={30} />
      </div>

      <div className="td-zones">
        <div className="td-zones-title">Distribución por zona</div>
        <div className="td-zone-bars">
          {topZones.map(([zone, count]) => (
            <div key={zone} className="td-zone-bar">
              <span className="td-zone-name">{zone}</span>
              <div className="td-zone-track">
                <div className="td-zone-fill" style={{ width: `${Math.min(100, (count / (topZones[0]?.[1] || 1)) * 100)}%` }} />
              </div>
              <span className="td-zone-count">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="td-events">
        <div className="td-events-title"><Activity size={12} /> Eventos recientes</div>
        <div className="td-events-list">
          {events.slice(0, 15).map((ev, i) => (
            <div key={`${ev.sensorId}-${ev.timestamp}-${i}`} className={`td-event td-event--${ev.stream}`}>
              <span className="td-event-stream">{ev.stream === 'kinesis' ? '⚡' : '📦'}</span>
              <span className="td-event-sensor">{ev.sensorId}</span>
              <span className="td-event-type" style={{ color: typeColors[ev.type] || '#94a3b8' }}>{ev.type}</span>
              <span className="td-event-value">{ev.value}</span>
              <span className="td-event-zone">{ev.zone}</span>
              <span className="td-event-time">{new Date(ev.timestamp).toLocaleTimeString('es-PE')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Mismo razonamiento que AdvancedSensors.tsx: único prop es telemetryTenantId.
export default memo(TelemetryDashboard);
