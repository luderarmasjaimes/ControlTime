/* ─────────────────────────────────────────────────────────────────────────────
   PERFORMANCE MONITOR — Observabilidad frontend producción
   FX03: Lazy loading, memoización, métricas performance
   I22-I24: Monitoreo conexiones WebSocket, CPU, memoria
   ───────────────────────────────────────────────────────────────────────── */

const PERF_STORAGE_KEY = 'aurixa_perf_metrics';
const MAX_ENTRIES = 200;

/** Métricas de rendimiento del editor */
const metrics = {
  renderCount: 0,
  lastRenderMs: 0,
  avgRenderMs: 0,
  peakRenderMs: 0,
  wsLatencyMs: 0,
  wsReconnects: 0,
  wsStatus: 'disconnected',
  memoryMB: 0,
  memoryPeak: 0,
  autosaveMs: 0,
  exportMs: 0,
  domNodes: 0,
  fps: 0,
  history: [],
};

let fpsFrameCount = 0;
let fpsLastTime = performance.now();
let fpsAnimId = null;

function startFPSMonitor() {
  const tick = () => {
    fpsFrameCount++;
    const now = performance.now();
    if (now - fpsLastTime >= 1000) {
      metrics.fps = fpsFrameCount;
      fpsFrameCount = 0;
      fpsLastTime = now;
    }
    fpsAnimId = requestAnimationFrame(tick);
  };
  tick();
}

function stopFPSMonitor() {
  if (fpsAnimId) cancelAnimationFrame(fpsAnimId);
}

/** Mide tiempo de ejecución de una función */
export function measurePerf(label, fn) {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;

  metrics.renderCount++;
  metrics.lastRenderMs = elapsed;
  metrics.avgRenderMs = (metrics.avgRenderMs * (metrics.renderCount - 1) + elapsed) / metrics.renderCount;
  if (elapsed > metrics.peakRenderMs) metrics.peakRenderMs = elapsed;

  metrics.history.push({
    label,
    ms: elapsed,
    timestamp: Date.now(),
  });
  if (metrics.history.length > MAX_ENTRIES) metrics.history = metrics.history.slice(-MAX_ENTRIES);

  return result;
}

/** Mide tiempo async */
export async function measurePerfAsync(label, fn) {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;

  if (label === 'autosave') metrics.autosaveMs = elapsed;
  if (label === 'export') metrics.exportMs = elapsed;

  metrics.history.push({ label, ms: elapsed, timestamp: Date.now() });
  if (metrics.history.length > MAX_ENTRIES) metrics.history = metrics.history.slice(-MAX_ENTRIES);

  return result;
}

/** Actualiza métricas de memoria */
export function updateMemoryMetrics() {
  if (performance.memory) {
    metrics.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    if (metrics.memoryMB > metrics.memoryPeak) metrics.memoryPeak = metrics.memoryMB;
  }
  metrics.domNodes = document.querySelectorAll('*').length;
}

/** WebSocket latency tracker */
export function trackWebSocketLatency(latencyMs) {
  metrics.wsLatencyMs = latencyMs;
}

export function trackWebSocketStatus(status) {
  metrics.wsStatus = status;
  if (status === 'reconnecting') metrics.wsReconnects++;
}

/** Obtiene snapshot de métricas */
export function getPerformanceSnapshot() {
  updateMemoryMetrics();
  return { ...metrics, fps: metrics.fps };
}

/** Performance thresholds para alertas */
export function getPerformanceAlerts() {
  const alerts = [];
  if (metrics.lastRenderMs > 100) alerts.push({ level: 'warning', msg: `Render lento: ${metrics.lastRenderMs.toFixed(0)}ms` });
  if (metrics.lastRenderMs > 500) alerts.push({ level: 'critical', msg: `Render crítico: ${metrics.lastRenderMs.toFixed(0)}ms` });
  if (metrics.memoryMB > 500) alerts.push({ level: 'warning', msg: `Memoria alta: ${metrics.memoryMB}MB` });
  if (metrics.memoryMB > 1000) alerts.push({ level: 'critical', msg: `Memory leak posible: ${metrics.memoryMB}MB` });
  if (metrics.wsLatencyMs > 200) alerts.push({ level: 'warning', msg: `WS latencia: ${metrics.wsLatencyMs}ms` });
  if (metrics.fps < 30 && metrics.fps > 0) alerts.push({ level: 'warning', msg: `FPS bajo: ${metrics.fps}` });
  if (metrics.domNodes > 5000) alerts.push({ level: 'warning', msg: `DOM pesado: ${metrics.domNodes} nodos` });
  return alerts;
}

/** Guarda métricas en localStorage para análisis */
export function persistMetrics() {
  try {
    const snapshot = getPerformanceSnapshot();
    const stored = JSON.parse(localStorage.getItem(PERF_STORAGE_KEY) || '[]');
    stored.push({ ...snapshot, timestamp: Date.now(), history: undefined });
    if (stored.length > 100) stored.splice(0, stored.length - 100);
    localStorage.setItem(PERF_STORAGE_KEY, JSON.stringify(stored));
  } catch { /* silently fail */ }
}

export { startFPSMonitor, stopFPSMonitor };
