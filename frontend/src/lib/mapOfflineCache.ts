/**
 * mapOfflineCache.ts — Caché de "último estado conocido" de marcadores de
 * mapa en IndexedDB, para pérdida total de conectividad.
 *
 * Alcance deliberadamente MÁS ACOTADO que ADR-022 (docs/decisions/022-offline-
 * cola-versionada-indexeddb.md): ese ADR es para EDICIÓN de informes offline
 * (cola de operaciones versionada, resolución explícita de conflictos al
 * reconectar). Los marcadores de mapa/sensores son telemetría de solo
 * lectura desde la perspectiva del cliente -- no hay "conflicto" que
 * resolver, solo un snapshot que puede quedar obsoleto. Por eso este módulo
 * es deliberadamente simple: IndexedDB como caché de lectura (guardar el
 * último /api/map/markers exitoso, leerlo de vuelta cuando
 * useConnectivity().state === 'OFFLINE'), no una cola de escritura.
 *
 * Por qué IndexedDB y no localStorage: localStorage tiene un límite práctico
 * de ~5MB y es síncrono (bloquea el hilo principal) -- con hasta 10.000
 * sensores geolocalizados el payload puede acercarse a ese límite. IndexedDB
 * no tiene ese techo práctico y es asíncrono.
 *
 * Nota: NO se usa `tile-cache-sw.js` (Service Worker) para esto -- ese SW
 * cachea imágenes de tiles vía Cache API, no datos JSON estructurados; no es
 * la herramienta correcta para esta necesidad (ver brief de la tarea).
 */

import { log } from './logger';

const DB_NAME = 'beemetry_map_offline';
const DB_VERSION = 1;
const STORE_NAME = 'marker_snapshots';
// Clave fija: un único "último snapshot" por instancia de navegador. Si en
// el futuro hace falta multi-tenant en el mismo navegador simultáneamente,
// esto se puede parametrizar por tenant_id sin cambiar el esquema (la key
// ya es un string libre).
const SNAPSHOT_KEY = 'last_markers_snapshot';

export interface MarkerSnapshot {
    markers: any[];
    savedAt: number; // Date.now() en el momento del guardado
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB no disponible en este entorno'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

/** @brief Guarda el snapshot de marcadores más reciente (sobrescribe el anterior -- solo interesa el último). */
export async function saveMarkerSnapshot(markers: any[]): Promise<void> {
    try {
        const db = await openDb();
        const snapshot: MarkerSnapshot = { markers, savedAt: Date.now() };
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        log.debug('mapOfflineCache: no se pudo guardar snapshot', err);
    }
}

/** @brief Lee el último snapshot guardado, o `null` si nunca se guardó uno (primera carga offline, sin datos previos). */
export async function loadMarkerSnapshot(): Promise<MarkerSnapshot | null> {
    try {
        const db = await openDb();
        return await new Promise<MarkerSnapshot | null>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
            req.onsuccess = () => resolve((req.result as MarkerSnapshot) ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        log.debug('mapOfflineCache: no se pudo leer snapshot', err);
        return null;
    }
}

/** @brief Texto legible ("hace N min/h") para mostrar la antigüedad del snapshot cacheado junto al mapa. */
export function formatSnapshotAge(savedAt: number): string {
    const diffMs = Date.now() - savedAt;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'hace instantes';
    if (diffMin < 60) return `hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `hace ${diffH} h`;
    const diffD = Math.floor(diffH / 24);
    return `hace ${diffD} d`;
}
