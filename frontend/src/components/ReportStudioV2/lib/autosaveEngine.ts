import { log } from '../../../lib/logger';
import { measurePerfAsync } from './performanceMonitor';
/* ─────────────────────────────────────────────────────────────────────────────
   AUTOSAVE ENGINE — Diff incremental vía WebSocket con recovery
   Guarda cambios cada 5 segundos, con indicador visual de estado.
   ───────────────────────────────────────────────────────────────────────── */

const AUTOSAVE_INTERVAL_MS = 5000;
const MAX_RETRY_ATTEMPTS = 3;

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface DocumentDiffChange {
  type: 'meta' | 'page_add' | 'page_remove' | 'page_update';
  index?: number;
  data?: unknown;
  elements?: { index: number; data: unknown }[];
}

export interface DocumentDiff {
  timestamp: string;
  version: number;
  changes: DocumentDiffChange[];
}

interface AutosaveState {
  status: AutosaveStatus;
  lastSavedAt: string | null;
  lastSavedVersion: number;
  retryCount: number;
  timerId: ReturnType<typeof setInterval> | null;
  wsConnection: unknown;
  pendingDiff: DocumentDiff | null;
}

/** Estado global del autosave */
let autosaveState: AutosaveState = {
  status: 'idle',       // idle | saving | saved | error
  lastSavedAt: null,
  lastSavedVersion: 0,
  retryCount: 0,
  timerId: null,
  wsConnection: null,
  pendingDiff: null,
};

const listeners = new Set<(snapshot: AutosaveState) => void>();

function notify(): void {
  const snapshot = { ...autosaveState };
  listeners.forEach((fn) => fn(snapshot));
}

export function subscribeAutosave(fn: (snapshot: AutosaveState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAutosaveStatus(): AutosaveState {
  return { ...autosaveState };
}

/** Calcula diff mínimo entre dos estados del documento */
export function computeDocumentDiff(oldDoc: any, newDoc: any): DocumentDiff | null {
  if (!oldDoc || !newDoc) return null;

  const changes: DocumentDiffChange[] = [];

  // Compare metadata
  if (JSON.stringify(oldDoc.meta) !== JSON.stringify(newDoc.meta)) {
    changes.push({ type: 'meta', data: newDoc.meta });
  }

  // Compare pages
  const maxPages = Math.max(
    (oldDoc.pages || []).length,
    (newDoc.pages || []).length
  );

  for (let i = 0; i < maxPages; i++) {
    const oldPage = (oldDoc.pages || [])[i];
    const newPage = (newDoc.pages || [])[i];

    if (!oldPage && newPage) {
      changes.push({ type: 'page_add', index: i, data: newPage });
    } else if (oldPage && !newPage) {
      changes.push({ type: 'page_remove', index: i });
    } else if (JSON.stringify(oldPage) !== JSON.stringify(newPage)) {
      // Compare elements within the page
      const maxEls = Math.max(
        (oldPage.elements || []).length,
        (newPage.elements || []).length
      );
      const elementChanges: { index: number; data: unknown }[] = [];

      for (let j = 0; j < maxEls; j++) {
        const oldEl = (oldPage.elements || [])[j];
        const newEl = (newPage.elements || [])[j];
        if (JSON.stringify(oldEl) !== JSON.stringify(newEl)) {
          elementChanges.push({ index: j, data: newEl || null });
        }
      }

      if (elementChanges.length > 0) {
        changes.push({ type: 'page_update', index: i, elements: elementChanges });
      }
    }
  }

  return changes.length > 0 ? {
    timestamp: new Date().toISOString(),
    version: newDoc.meta?.version || 1,
    changes,
  } : null;
}

/** Guarda localmente en localStorage como respaldo */
export function saveLocalBackup(doc: any, reportId?: string | null): boolean {
  try {
    const key = `autosave_backup_${reportId || 'unsaved'}`;
    const backup = {
      doc,
      savedAt: new Date().toISOString(),
      version: doc.meta?.version || 1,
    };
    localStorage.setItem(key, JSON.stringify(backup));
    return true;
  } catch (err) {
    log.warn('[AUTOSAVE] Local backup failed:', err);
    return false;
  }
}

/** Recupera backup local si existe */
export function loadLocalBackup(reportId?: string | null): any | null {
  try {
    const key = `autosave_backup_${reportId || 'unsaved'}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Limpia backup local */
export function clearLocalBackup(reportId?: string | null): void {
  try {
    localStorage.removeItem(`autosave_backup_${reportId || 'unsaved'}`);
  } catch {}
}

/** Inicia el motor de autosave */
export function startAutosave(
  getDocument: () => any,
  saveCallback: (doc: any, diff: DocumentDiff) => Promise<void>,
  reportId?: string | null,
): void {
  stopAutosave();

  let previousDoc = JSON.parse(JSON.stringify(getDocument()));

  autosaveState.timerId = setInterval(async () => {
    const currentDoc = getDocument();
    const diff = computeDocumentDiff(previousDoc, currentDoc);

    if (!diff) return; // No changes

    autosaveState.status = 'saving';
    autosaveState.pendingDiff = diff;
    notify();

    try {
      // Always save local backup first
      saveLocalBackup(currentDoc, reportId);

      // Then attempt server save — medido contra el presupuesto O2 de ADR-023
      // (<0.5s por autoguardado); antes se medía tiempo pero nunca se llamaba
      // esta función, así que la métrica siempre quedaba en 0.
      await measurePerfAsync('autosave', () => saveCallback(currentDoc, diff));

      autosaveState.status = 'saved';
      autosaveState.lastSavedAt = new Date().toISOString();
      autosaveState.lastSavedVersion = diff.version;
      autosaveState.retryCount = 0;
      autosaveState.pendingDiff = null;
      previousDoc = JSON.parse(JSON.stringify(currentDoc));
    } catch (err) {
      autosaveState.retryCount++;
      // Un fallo de autosave es siempre accionable (dato del usuario en
      // riesgo) — a diferencia de otros warnings de diagnóstico, debe
      // quedar visible también en producción (log.error, no log.warn que
      // solo emite en dev — ver logger.ts). Confirmado necesario durante la
      // implementación de edición offline: un fallo silencioso de
      // saveOfflineSnapshot no dejaba ningún rastro en consola de producción.
      log.error('[AUTOSAVE] Save failed, attempt', autosaveState.retryCount, err);

      if (autosaveState.retryCount >= MAX_RETRY_ATTEMPTS) {
        autosaveState.status = 'error';
      }
    }

    notify();
  }, AUTOSAVE_INTERVAL_MS);

  autosaveState.status = 'idle';
  notify();
}

/** Detiene el autosave */
export function stopAutosave(): void {
  if (autosaveState.timerId) {
    clearInterval(autosaveState.timerId);
    autosaveState.timerId = null;
  }
  autosaveState.status = 'idle';
  notify();
}
