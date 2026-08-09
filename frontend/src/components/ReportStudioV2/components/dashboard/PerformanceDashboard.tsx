import React, { memo, useState, useEffect } from 'react';
import {
  Activity, Cpu, HardDrive, Wifi, Zap, AlertTriangle,
  BarChart3, Clock, Monitor, TrendingUp,
} from 'lucide-react';
import {
  getPerformanceSnapshot,
  getPerformanceAlerts,
  getBudgetViolations,
  PERFORMANCE_BUDGETS,
  startFPSMonitor,
  stopFPSMonitor,
  updateMemoryMetrics,
} from '../../lib/performanceMonitor';

/* ─────────────────────────────────────────────────────────────────────────────
   PERFORMANCE DASHBOARD — Panel de observabilidad frontend
   Monitoreo en tiempo real: FPS, memoria, latencia WS, renders
   ───────────────────────────────────────────────────────────────────────── */

type MetricStatus = 'normal' | 'warning' | 'critical';

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  unit: string;
  status?: MetricStatus;
  sparkline?: number[];
}

function MetricCard({ icon: Icon, label, value, unit, status = 'normal', sparkline }: MetricCardProps) {
  return (
    <div className={`pm-card pm-card--${status}`}>
      <div className="pm-card-icon"><Icon size={14} /></div>
      <div className="pm-card-body">
        <div className="pm-card-value">{value}<span className="pm-card-unit">{unit}</span></div>
        <div className="pm-card-label">{label}</div>
      </div>
      {sparkline && (
        <svg className="pm-spark" width="50" height="20" viewBox="0 0 50 20">
          <polyline
            fill="none"
            stroke={status === 'critical' ? '#ef4444' : status === 'warning' ? '#f59e0b' : '#22d3ee'}
            strokeWidth="1.5"
            points={sparkline.map((v, i) => `${(i / (sparkline.length - 1)) * 50},${20 - (v / Math.max(...sparkline, 1)) * 18}`).join(' ')}
          />
        </svg>
      )}
    </div>
  );
}

interface PerformanceDashboardProps {
  visible?: boolean;
  onClose?: () => void;
}

function PerformanceDashboard({ visible = false, onClose }: PerformanceDashboardProps) {
  const [snapshot, setSnapshot] = useState<ReturnType<typeof getPerformanceSnapshot> | null>(null);
  const [alerts, setAlerts] = useState<ReturnType<typeof getPerformanceAlerts>>([]);
  const [budgetViolations, setBudgetViolations] = useState<ReturnType<typeof getBudgetViolations> | null>(null);
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [renderHistory, setRenderHistory] = useState<number[]>([]);

  useEffect(() => {
    if (!visible) return;
    startFPSMonitor();
    const interval = setInterval(() => {
      updateMemoryMetrics();
      const snap = getPerformanceSnapshot();
      setSnapshot(snap);
      setAlerts(getPerformanceAlerts());
      setBudgetViolations(getBudgetViolations());
      setFpsHistory(prev => [...prev.slice(-19), snap.fps]);
      setMemHistory(prev => [...prev.slice(-19), snap.memoryMB]);
      setRenderHistory(prev => [...prev.slice(-19), snap.lastRenderMs]);
    }, 1000);
    return () => { clearInterval(interval); stopFPSMonitor(); };
  }, [visible]);

  if (!visible || !snapshot) return null;

  const fpsStatus: MetricStatus = snapshot.fps >= 50 ? 'normal' : snapshot.fps >= 30 ? 'warning' : 'critical';
  const memStatus: MetricStatus = snapshot.memoryMB < 300 ? 'normal' : snapshot.memoryMB < 700 ? 'warning' : 'critical';
  const wsStatus: MetricStatus = snapshot.wsLatencyMs < 100 ? 'normal' : snapshot.wsLatencyMs < 300 ? 'warning' : 'critical';
  const renderStatus: MetricStatus = snapshot.lastRenderMs < 50 ? 'normal' : snapshot.lastRenderMs < 200 ? 'warning' : 'critical';

  return (
    <div className="pm-panel">
      <div className="pm-header">
        <Monitor size={14} />
        <span>Performance Monitor</span>
        <span className="pm-live-dot" />
        <span className="pm-live-label">LIVE</span>
        {onClose && <button type="button" className="wf-close" onClick={onClose}>✕</button>}
      </div>

      <div className="pm-grid">
        <MetricCard icon={Zap} label="FPS" value={snapshot.fps} unit="fps" status={fpsStatus} sparkline={fpsHistory} />
        <MetricCard icon={HardDrive} label="Memoria" value={snapshot.memoryMB} unit="MB" status={memStatus} sparkline={memHistory} />
        <MetricCard icon={Wifi} label="WS Latencia" value={snapshot.wsLatencyMs} unit="ms" status={wsStatus} />
        <MetricCard icon={Clock} label="Último render" value={snapshot.lastRenderMs.toFixed(1)} unit="ms" status={renderStatus} sparkline={renderHistory} />
        <MetricCard icon={Activity} label="Renders" value={snapshot.renderCount} unit="" />
        <MetricCard icon={BarChart3} label="Avg render" value={snapshot.avgRenderMs.toFixed(1)} unit="ms" />
        <MetricCard icon={TrendingUp} label="Peak render" value={snapshot.peakRenderMs.toFixed(1)} unit="ms" />
        <MetricCard icon={Cpu} label="DOM Nodes" value={snapshot.domNodes} unit="" status={snapshot.domNodes > 5000 ? 'warning' : 'normal'} />
      </div>

      {alerts.length > 0 && (
        <div className="pm-alerts">
          {alerts.map((a, i) => (
            <div key={i} className={`pm-alert pm-alert--${a.level}`}>
              <AlertTriangle size={12} /> {a.msg}
            </div>
          ))}
        </div>
      )}

      {/* ADR-023: presupuestos como restricciones de diseño, no solo diales. */}
      {budgetViolations && (
        <div className="pm-alerts" title="Presupuestos de rendimiento (ADR-023): O1 render, O2 autosave, O3 export, O6 IA local">
          <div className={`pm-alert ${budgetViolations.counts.O1 > 0 ? 'pm-alert--warning' : ''}`}>
            O1 render (&lt;{PERFORMANCE_BUDGETS.O1_RENDER_MS}ms): {budgetViolations.counts.O1} excesos
          </div>
          <div className={`pm-alert ${budgetViolations.counts.O2 > 0 ? 'pm-alert--warning' : ''}`}>
            O2 autosave (&lt;{PERFORMANCE_BUDGETS.O2_AUTOSAVE_MS}ms): {budgetViolations.counts.O2} excesos
          </div>
          <div className={`pm-alert ${budgetViolations.counts.O3 > 0 ? 'pm-alert--warning' : ''}`}>
            O3 export (&lt;{PERFORMANCE_BUDGETS.O3_EXPORT_MS}ms): {budgetViolations.counts.O3} excesos
          </div>
          <div className={`pm-alert ${budgetViolations.counts.O6 > 0 ? 'pm-alert--warning' : ''}`}>
            O6 IA local (&lt;{PERFORMANCE_BUDGETS.O6_IA_MS}ms): {budgetViolations.counts.O6} excesos
          </div>
        </div>
      )}

      <div className="pm-footer">
        <span>WS: {snapshot.wsStatus} | Reconexiones: {snapshot.wsReconnects}</span>
        <span>Pico mem: {snapshot.memoryPeak}MB | Autosave: {snapshot.autosaveMs.toFixed(0)}ms</span>
      </div>
    </div>
  );
}

export default memo(PerformanceDashboard);
