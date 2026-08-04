import initSqlJs, { type Database } from 'sql.js';
import { authFetch } from '../../../auth/authApi';
import { log } from '../../../lib/logger';
import type { ReportDocument } from '../store/useEditorStore';

/* ─────────────────────────────────────────────────────────────────────────────
   OFFLINE SQLITE — Persistencia local de ediciones del Informe Técnico
   sin conexión al servidor.

   Por qué SQLite (sql.js/WASM) y no solo localStorage: el negocio pidió
   explícitamente una base de datos SQLite que se descarga del servidor al
   cliente en la primera prueba de conectividad del navegador — no un simple
   respaldo de texto. sql.js corre la base completa en memoria (WASM) y la
   serializa a bytes cuando hace falta persistirla; por eso este módulo
   guarda esos bytes en la Cache API del navegador (disponible en todo
   navegador con Service Worker, ya usado en este proyecto para
   tile-cache-sw.js) en vez de IndexedDB crudo — evita reimplementar el
   manejo de transacciones IndexedDB para lo que aquí es, en esencia, "cachear
   un blob".
   ───────────────────────────────────────────────────────────────────────── */

const CACHE_NAME = 'beemetry-offline-sqlite-v1';
const CACHE_KEY = '/__offline/report_offline.sqlite';
const TEMPLATE_ENDPOINT = '/api/reports/offline-template';
const WASM_URL = '/sql-wasm.wasm';

let dbPromise: Promise<Database> | null = null;
let SQLModule: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function loadCachedBytes(): Promise<Uint8Array | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(CACHE_KEY);
    if (!match) return null;
    return new Uint8Array(await match.arrayBuffer());
  } catch (err) {
    log.warn('[OFFLINE_SQLITE] No se pudo leer la caché local:', err);
    return null;
  }
}

async function persistBytes(bytes: Uint8Array): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    // ArrayBuffer nuevo: sql.js reutiliza el buffer interno en llamadas
    // posteriores a export(), y Response no acepta un buffer "en vuelo".
    const copy = bytes.slice().buffer;
    await cache.put(CACHE_KEY, new Response(copy, { headers: { 'Content-Type': 'application/x-sqlite3' } }));
  } catch (err) {
    log.warn('[OFFLINE_SQLITE] No se pudo persistir la base local:', err);
  }
}

/**
 * Descarga la plantilla SQLite del servidor (una sola vez por navegador —
 * las siguientes cargas usan la copia cacheada, que ya incluye cualquier
 * edición offline previa). Se invoca desde el primer chequeo de
 * conectividad exitoso de la sesión (ver connectivityMonitor.ts /
 * useConnectivity en App.tsx).
 */
async function fetchTemplateBytes(): Promise<Uint8Array> {
  // El endpoint exige sesión (igual que el resto de /api/reports) — un
  // fetch() crudo sin el header Authorization devuelve 401. authFetch (la
  // misma función que usa el resto de la plataforma, ADR-041/043) adjunta el
  // Bearer token y reintenta una vez si el access token venció.
  const res = await authFetch(TEMPLATE_ENDPOINT);
  if (!res.ok) throw new Error(`No se pudo descargar la plantilla offline (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** ADR-022: agrega `base_version_number` (versión del servidor de la que
 * partió la edición offline) si la copia local cacheada todavía es de un
 * esquema anterior a esta columna — evita tener que regenerar/versionar la
 * plantilla embebida (`offline_template_data.hpp`) solo por este cambio, y
 * de paso migra en el sitio cualquier copia ya cacheada en un navegador. */
function ensureSchemaUpgraded(db: Database): boolean {
  try {
    const cols = db.exec('PRAGMA table_info(offline_reports)');
    const names = (cols[0]?.values || []).map((row) => String(row[1]));
    if (!names.includes('base_version_number')) {
      db.run('ALTER TABLE offline_reports ADD COLUMN base_version_number INTEGER');
      return true;
    }
  } catch (err) {
    log.warn('[OFFLINE_SQLITE] No se pudo verificar/migrar el esquema local:', err);
  }
  return false;
}

async function openDb(): Promise<Database> {
  if (!SQLModule) {
    SQLModule = await initSqlJs({ locateFile: () => WASM_URL });
  }
  const cached = await loadCachedBytes();
  if (cached) {
    try {
      const db = new SQLModule.Database(cached);
      if (ensureSchemaUpgraded(db)) await persistBytes(db.export());
      return db;
    } catch (err) {
      log.warn('[OFFLINE_SQLITE] Copia local corrupta, se re-descarga la plantilla:', err);
    }
  }
  const template = await fetchTemplateBytes();
  const db = new SQLModule.Database(template);
  ensureSchemaUpgraded(db);
  await persistBytes(db.export());
  return db;
}

/** Inicializa (o reutiliza) la base offline. Idempotente — llamar tantas
 * veces como se quiera; solo la primera hace trabajo real.
 *
 * Si la inicialización FALLA (sin conexión al descargar la plantilla, sesión
 * vencida → 401, o un fallo transitorio al cargar el WASM), la promesa
 * rechazada NO se cachea: se limpia para que el siguiente intento vuelva a
 * probar. De lo contrario, un único fallo temprano (p.ej. arrancar la app ya
 * sin cobertura, el caso más probable en una unidad minera) dejaba la base
 * offline inutilizable para toda la sesión aunque volviera la conexión —
 * justo lo que este módulo existe para evitar. */
export function getOfflineDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = openDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function persistCurrentDb(db: Database): Promise<void> {
  await persistBytes(db.export());
}

/** Guarda (upsert) el documento actual del informe en la base local — se usa
 * mientras el editor está OFFLINE, para no perder cambios si se cierra la
 * pestaña antes de reconectar.
 *
 * `baseVersionNumber` (ADR-022): la versión del servidor de la que partió
 * esta edición offline — SOLO se actualiza si ya existe una fila para este
 * informe con `dirty=0` (o no existe ninguna todavía); si ya había una fila
 * `dirty=1` sin sincronizar, se preserva su `base_version_number` original
 * (no el de esta escritura) — la versión-base debe ser siempre "la última
 * que el servidor confirmó antes de que empezáramos a divergir", no la del
 * autosave offline más reciente. */
export async function saveOfflineSnapshot(
  reportId: string,
  title: string,
  documentJson: unknown,
  baseVersionNumber: number,
): Promise<void> {
  const db = await getOfflineDb();
  db.run(
    `INSERT INTO offline_reports (report_id, title, document_json, updated_at, dirty, base_version_number)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(report_id) DO UPDATE SET
       title = excluded.title,
       document_json = excluded.document_json,
       updated_at = excluded.updated_at,
       dirty = 1,
       base_version_number = CASE WHEN offline_reports.dirty = 1
                                  THEN offline_reports.base_version_number
                                  ELSE excluded.base_version_number END`,
    [reportId, title, JSON.stringify(documentJson), new Date().toISOString(), baseVersionNumber],
  );
  await persistCurrentDb(db);
}

export interface OfflineSnapshot {
  reportId: string;
  title: string;
  /** El documento parseado desde `document_json` — siempre proviene de un
   * JSON.stringify(doc) del propio editor (ver saveOfflineSnapshot), por lo
   * que su forma real es la del documento del editor. Partial<> porque un
   * snapshot guardado por una versión anterior de la app puede carecer de
   * campos agregados después. */
  documentJson: Partial<ReportDocument>;
  updatedAt: string;
  dirty: boolean;
  baseVersionNumber: number | null;
}

/** Recupera el último snapshot guardado localmente para un informe, si existe. */
export async function loadOfflineSnapshot(reportId: string): Promise<OfflineSnapshot | null> {
  const db = await getOfflineDb();
  const res = db.exec(
    'SELECT report_id, title, document_json, updated_at, dirty, base_version_number FROM offline_reports WHERE report_id = ?',
    [reportId],
  );
  const row = res[0]?.values?.[0];
  if (!row) return null;
  const [id, title, documentJson, updatedAt, dirty, baseVersionNumber] = row;
  try {
    return {
      reportId: String(id),
      title: String(title ?? ''),
      documentJson: JSON.parse(String(documentJson)),
      updatedAt: String(updatedAt),
      dirty: Number(dirty) === 1,
      baseVersionNumber: baseVersionNumber === null || baseVersionNumber === undefined
        ? null
        : Number(baseVersionNumber),
    };
  } catch {
    return null;
  }
}

/** Marca un snapshot como ya sincronizado con el servidor (no lo borra —
 * conserva el historial local por si se necesita comparar tras un conflicto). */
export async function markOfflineSnapshotSynced(reportId: string): Promise<void> {
  const db = await getOfflineDb();
  db.run('UPDATE offline_reports SET dirty = 0 WHERE report_id = ?', [reportId]);
  await persistCurrentDb(db);
}

/** Registra el instante exacto en que se perdió la conexión mientras se
 * editaba un informe — el lienzo muestra este dato en el aviso "FUERA DE
 * LÍNEA desde ...". */
export async function recordWentOffline(reportId: string, atIso: string): Promise<string> {
  const db = await getOfflineDb();
  const id = `off-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.run(
    'INSERT INTO offline_connectivity_events (id, report_id, went_offline_at, synced) VALUES (?, ?, ?, 0)',
    [id, reportId, atIso],
  );
  await persistCurrentDb(db);
  return id;
}

/** Cierra el evento de desconexión más reciente sin resolver para un informe. */
export async function recordCameOnline(reportId: string, atIso: string): Promise<void> {
  const db = await getOfflineDb();
  db.run(
    `UPDATE offline_connectivity_events
     SET came_online_at = ?
     WHERE id = (
       SELECT id FROM offline_connectivity_events
       WHERE report_id = ? AND came_online_at IS NULL
       ORDER BY went_offline_at DESC LIMIT 1
     )`,
    [atIso, reportId],
  );
  await persistCurrentDb(db);
}
