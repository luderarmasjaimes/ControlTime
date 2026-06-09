/* ─────────────────────────────────────────────────────────────────────────────
   AUDIT TRAIL — Bitácora inmutable con hash encadenado blockchain-style
   S01: Sistema antifraude hash encadenado
   QA05-QA06: Validación firma, integridad bitácora
   ───────────────────────────────────────────────────────────────────────── */

const AUDIT_STORAGE_KEY = 'aurixa_audit_trail';

/**
 * Genera un hash SHA-256 a partir de un string
 * @param {string} data - Datos a hashear
 * @returns {Promise<string>} Hash hexadecimal
 */
async function sha256(data) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: simple hash for environments without crypto.subtle
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const chr = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/**
 * Crea una entrada de auditoría con hash encadenado
 * @param {string} action - Tipo de acción
 * @param {Object} details - Detalles del evento
 * @param {string} user - Usuario que ejecuta
 * @param {string} previousHash - Hash de la entrada anterior
 * @returns {Promise<Object>} Entrada de auditoría
 */
export async function createAuditEntry(action, details, user, previousHash = '0000000000000000') {
  const entry = {
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    action,
    user,
    details: typeof details === 'string' ? details : JSON.stringify(details),
    previousHash,
    nonce: Math.floor(Math.random() * 999999),
  };

  // Chain hash: hash(previousHash + timestamp + action + user + details + nonce)
  const payload = `${previousHash}|${entry.timestamp}|${entry.action}|${entry.user}|${entry.details}|${entry.nonce}`;
  entry.hash = await sha256(payload);

  return entry;
}

/**
 * Valida la integridad de la cadena de auditoría
 * @param {Array} chain - Cadena de entradas
 * @returns {Promise<Object>} Resultado de validación
 */
export async function validateAuditChain(chain) {
  if (!chain || chain.length === 0) return { valid: true, entries: 0, broken: [] };

  const broken = [];

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const expectedPrevHash = i === 0 ? '0000000000000000' : chain[i - 1].hash;

    // Check previous hash reference
    if (entry.previousHash !== expectedPrevHash) {
      broken.push({ index: i, id: entry.id, reason: 'previousHash mismatch', expected: expectedPrevHash, actual: entry.previousHash });
    }

    // Re-compute hash and verify
    const payload = `${entry.previousHash}|${entry.timestamp}|${entry.action}|${entry.user}|${entry.details}|${entry.nonce}`;
    const computedHash = await sha256(payload);
    if (computedHash !== entry.hash) {
      broken.push({ index: i, id: entry.id, reason: 'hash tampered', computed: computedHash, stored: entry.hash });
    }
  }

  return {
    valid: broken.length === 0,
    entries: chain.length,
    broken,
    firstEntry: chain[0]?.timestamp,
    lastEntry: chain[chain.length - 1]?.timestamp,
    lastHash: chain[chain.length - 1]?.hash,
  };
}

/**
 * Gestor de auditoría inmutable
 */
class AuditTrailManager {
  constructor() {
    this.chain = this._load();
    this.subscribers = new Set();
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  _persist() {
    try {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.chain));
    } catch { /* storage full */ }
  }

  _notify() {
    this.subscribers.forEach(fn => fn([...this.chain]));
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    fn([...this.chain]);
    return () => this.subscribers.delete(fn);
  }

  getLastHash() {
    return this.chain.length > 0 ? this.chain[this.chain.length - 1].hash : '0000000000000000';
  }

  async append(action, details, user) {
    const entry = await createAuditEntry(action, details, user, this.getLastHash());
    this.chain.push(entry);
    this._persist();
    this._notify();
    return entry;
  }

  async validate() {
    return validateAuditChain(this.chain);
  }

  getChain() {
    return [...this.chain];
  }

  getEntriesByAction(action) {
    return this.chain.filter(e => e.action === action);
  }

  getEntriesByUser(user) {
    return this.chain.filter(e => e.user === user);
  }

  getRecentEntries(count = 20) {
    return this.chain.slice(-count);
  }

  /** Exporta la cadena completa como JSON para auditoría externa */
  exportChain() {
    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      entries: this.chain.length,
      chain: this.chain,
    }, null, 2);
  }
}

/** Singleton instance */
const auditTrail = new AuditTrailManager();

/** Audit action types */
export const AUDIT_ACTIONS = {
  LOGIN: 'user.login',
  LOGOUT: 'user.logout',
  LOGIN_FAILED: 'user.login_failed',
  REPORT_CREATE: 'report.create',
  REPORT_EDIT: 'report.edit',
  REPORT_SAVE: 'report.save',
  REPORT_DELETE: 'report.delete',
  REPORT_EXPORT: 'report.export',
  REPORT_IMPORT: 'report.import',
  REPORT_SHARE: 'report.share',
  WORKFLOW_TRANSITION: 'workflow.transition',
  WORKFLOW_APPROVE: 'workflow.approve',
  WORKFLOW_REJECT: 'workflow.reject',
  ALARM_ACK: 'alarm.acknowledge',
  ALARM_CREATE_REPORT: 'alarm.create_report',
  VERSION_SNAPSHOT: 'version.snapshot',
  VERSION_RESTORE: 'version.restore',
  BIOMETRIC_ENROLL: 'biometric.enroll',
  BIOMETRIC_VERIFY: 'biometric.verify',
  SYSTEM_CONFIG: 'system.config_change',
  DATA_EXPORT: 'data.export',
  SECURITY_VIOLATION: 'security.violation',
};

export default auditTrail;
