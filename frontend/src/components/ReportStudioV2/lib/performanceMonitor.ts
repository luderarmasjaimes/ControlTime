/* ─────────────────────────────────────────────────────────────────────────────
   PERFORMANCE MONITOR — Observabilidad frontend producción
   FX03: Lazy loading, memoización, métricas performance
   I22-I24: Monitoreo conexiones WebSocket, CPU, memoria
   ───────────────────────────────────────────────────────────────────────── */

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

declare global {
  interface Performance {
    memory?: PerformanceMemory;
  }
}

const PERF_STORAGE_KEY = 'aurixa_perf_metrics';
const MAX_ENTRIES = 200;

/**
 * ADR-023 — presupuestos de rendimiento como restricciones de diseño, no
 * solo diales informativos. Antes se medían tiempos pero nunca se
 * comparaban contra estos números concretos del ADR; ahora cada exceso
 * incrementa un contador de violación visible (`getBudgetViolations()`) y
 * queda logueado — la forma honesta de "enforcement" para una app
 * interactiva de cliente (no tiene sentido bloquear un render lento, sí
 * tiene sentido dejar de fingir que no se está midiendo contra el número
 * real que el ADR fija).
 */
export const PERFORMANCE_BUDGETS = {
  O1_RENDER_MS: 20,
  O2_AUTOSAVE_MS: 500,
  O3_EXPORT_MS: 5000,
  O6_IA_MS: 1000,
} as const;

const budgetViolations = { O1: 0, O2: 0, O3: 0, O6: 0 };
const lastBudgetViolations: { code: keyof typeof budgetViolations; label: string; ms: number; budgetMs: number; timestamp: number }[] = [];

function recordBudgetViolation(code: keyof typeof budgetViolations, label: string, ms: number, budgetMs: number): void {
  budgetViolations[code]++;
  lastBudgetViolations.push({ code, label, ms, budgetMs, timestamp: Date.now() });
  if (lastBudgetViolations.length > 50) lastBudgetViolations.shift();
  // eslint-disable-next-line no-console
  console.warn(`[ADR-023][${code}] presupuesto excedido: "${label}" tomó ${ms.toFixed(0)}ms (límite ${budgetMs}ms)`);
}

export function getBudgetViolations() {
  return { counts: { ...budgetViolations }, recent: [...lastBudgetViolations] };
}

interface PerfHistoryEntry {
  label: string;
  ms: number;
  timestamp: number;
}

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
  history: [] as PerfHistoryEntry[],
};

let fpsFrameCount = 0;
let fpsLastTime = performance.now();
let fpsAnimId: number | null = null;

function startFPSMonitor(): void {
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

function stopFPSMonitor(): void {
  if (fpsAnimId) cancelAnimationFrame(fpsAnimId);
}

/** Mide tiempo de ejecución de una función */
export function measurePerf<T>(label: string, fn: () => T): T {
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

  // O1: latencia de pantalla (render local) < 20ms.
  if (elapsed > PERFORMANCE_BUDGETS.O1_RENDER_MS) {
    recordBudgetViolation('O1', label, elapsed, PERFORMANCE_BUDGETS.O1_RENDER_MS);
  }

  return result;
}

/** Mide tiempo async */
export async function measurePerfAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;

  if (label === 'autosave') metrics.autosaveMs = elapsed;
  if (label === 'export') metrics.exportMs = elapsed;

  metrics.history.push({ label, ms: elapsed, timestamp: Date.now() });
  if (metrics.history.length > MAX_ENTRIES) metrics.history = metrics.history.slice(-MAX_ENTRIES);

  // O2/O3/O6: autoguardado, export e IA local contra sus presupuestos ADR-023.
  if (label === 'autosave' && elapsed > PERFORMANCE_BUDGETS.O2_AUTOSAVE_MS) {
    recordBudgetViolation('O2', label, elapsed, PERFORMANCE_BUDGETS.O2_AUTOSAVE_MS);
  } else if (label === 'export' && elapsed > PERFORMANCE_BUDGETS.O3_EXPORT_MS) {
    recordBudgetViolation('O3', label, elapsed, PERFORMANCE_BUDGETS.O3_EXPORT_MS);
  } else if (label === 'ia_correction' && elapsed > PERFORMANCE_BUDGETS.O6_IA_MS) {
    recordBudgetViolation('O6', label, elapsed, PERFORMANCE_BUDGETS.O6_IA_MS);
  }

  return result;
}

/** Actualiza métricas de memoria */
export function updateMemoryMetrics(): void {
  if (performance.memory) {
    metrics.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    if (metrics.memoryMB > metrics.memoryPeak) metrics.memoryPeak = metrics.memoryMB;
  }
  metrics.domNodes = document.querySelectorAll('*').length;
}

/** WebSocket latency tracker */
export function trackWebSocketLatency(latencyMs: number): void {
  metrics.wsLatencyMs = latencyMs;
}

export function trackWebSocketStatus(status: string): void {
  metrics.wsStatus = status;
  if (status === 'reconnecting') metrics.wsReconnects++;
}

/** Obtiene snapshot de métricas */
export function getPerformanceSnapshot() {
  updateMemoryMetrics();
  return { ...metrics, fps: metrics.fps };
}

export interface PerformanceAlert {
  level: 'warning' | 'critical';
  msg: string;
}

/** Performance thresholds para alertas */
export function getPerformanceAlerts(): PerformanceAlert[] {
  const alerts: PerformanceAlert[] = [];
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
export function persistMetrics(): void {
  try {
    const snapshot = getPerformanceSnapshot();
    const stored = JSON.parse(localStorage.getItem(PERF_STORAGE_KEY) || '[]');
    stored.push({ ...snapshot, timestamp: Date.now(), history: undefined });
    if (stored.length > 100) stored.splice(0, stored.length - 100);
    localStorage.setItem(PERF_STORAGE_KEY, JSON.stringify(stored));
  } catch { /* silently fail */ }
}

export { startFPSMonitor, stopFPSMonitor };
