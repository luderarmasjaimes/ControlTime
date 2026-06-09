/* ─────────────────────────────────────────────────────────────────────────────
   OFFLINE SYNC ENGINE — Sincronización inteligente offline/online
   P12: Edición offline .miningreport y re-sincronización
   I11b: Edge Gateway firmware buffer 72h
   ───────────────────────────────────────────────────────────────────────── */

const SYNC_STORAGE_KEY = 'aurixa_offline_queue';
const CONNECTIVITY_CHECK_URL = '/api/health';
const CONNECTIVITY_INTERVAL_MS = 10000;

/** Estado de conectividad */
let isOnline = navigator.onLine;
const connectivitySubscribers = new Set();

function notifyConnectivity() {
  connectivitySubscribers.forEach(fn => fn(isOnline));
}

export function subscribeConnectivity(fn) {
  connectivitySubscribers.add(fn);
  fn(isOnline);
  return () => connectivitySubscribers.delete(fn);
}

export function getConnectivityStatus() {
  return isOnline;
}

/** Monitor de conectividad con verificación real al servidor */
let connectivityTimer = null;

export function startConnectivityMonitor() {
  window.addEventListener('online', () => { isOnline = true; notifyConnectivity(); processQueue(); });
  window.addEventListener('offline', () => { isOnline = false; notifyConnectivity(); });

  connectivityTimer = setInterval(async () => {
    try {
      const res = await fetch(CONNECTIVITY_CHECK_URL, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const wasOffline = !isOnline;
      isOnline = res.ok;
      if (wasOffline && isOnline) {
        notifyConnectivity();
        processQueue();
      }
    } catch {
      if (isOnline) { isOnline = false; notifyConnectivity(); }
    }
  }, CONNECTIVITY_INTERVAL_MS);
}

export function stopConnectivityMonitor() {
  if (connectivityTimer) clearInterval(connectivityTimer);
}

/** Cola de operaciones offline */
function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveQueue(queue) {
  try {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(queue));
  } catch { /* storage full */ }
}

/**
 * Encola una operación para sincronización
 * @param {string} type - Tipo de operación (save, export, share, workflow)
 * @param {Object} payload - Datos de la operación
 * @param {string} userId - Usuario que ejecuta
 */
export function enqueueOperation(type, payload, userId) {
  const queue = loadQueue();
  queue.push({
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    payload,
    userId,
    createdAt: new Date().toISOString(),
    retries: 0,
    status: 'pending',
  });
  saveQueue(queue);

  // If online, try to process immediately
  if (isOnline) processQueue();
}

/** Procesa la cola de operaciones pendientes */
async function processQueue() {
  if (!isOnline) return;

  const queue = loadQueue();
  const pending = queue.filter(op => op.status === 'pending');
  if (pending.length === 0) return;

  for (const op of pending) {
    try {
      await executeOperation(op);
      op.status = 'completed';
      op.completedAt = new Date().toISOString();
    } catch (err) {
      op.retries++;
      if (op.retries >= 3) {
        op.status = 'failed';
        op.error = err.message;
      }
      // On network error, stop processing
      if (!navigator.onLine) break;
    }
  }

  // Clean completed entries older than 24h
  const cutoff = Date.now() - 86400000;
  const cleaned = queue.filter(op =>
    op.status !== 'completed' || new Date(op.completedAt).getTime() > cutoff
  );
  saveQueue(cleaned);
}

async function executeOperation(op) {
  const endpoints = {
    save: '/api/reports/save',
    export: '/api/reports/export',
    share: '/api/reports/share',
    workflow: '/api/workflow/transition',
    alarm_ack: '/api/alarms/acknowledge',
    audit: '/api/audit/append',
  };

  const url = endpoints[op.type];
  if (!url) throw new Error(`Unknown operation type: ${op.type}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(op.payload),
    credentials: 'include',
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  return response.json();
}

/** Obtiene estadísticas de la cola */
export function getQueueStats() {
  const queue = loadQueue();
  return {
    total: queue.length,
    pending: queue.filter(q => q.status === 'pending').length,
    completed: queue.filter(q => q.status === 'completed').length,
    failed: queue.filter(q => q.status === 'failed').length,
    oldestPending: queue.find(q => q.status === 'pending')?.createdAt,
  };
}

/** Reintenta operaciones fallidas */
export function retryFailedOperations() {
  const queue = loadQueue();
  queue.forEach(op => {
    if (op.status === 'failed') {
      op.status = 'pending';
      op.retries = 0;
      delete op.error;
    }
  });
  saveQueue(queue);
  if (isOnline) processQueue();
}

/** Limpia la cola */
export function clearSyncQueue() {
  saveQueue([]);
}
