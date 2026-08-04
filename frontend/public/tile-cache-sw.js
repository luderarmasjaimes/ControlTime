/**
 * tile-cache-sw.js — Service Worker de cacheo de tiles de mapas.
 *
 * Por qué existe: en unidades mineras remotas (sierra/selva) la conectividad
 * es intermitente (3G/4G/satelital). Este SW deja que Leaflet siga pidiendo
 * las MISMAS URLs de siempre (Google satelital/híbrido, OpenTopoMap, WMS
 * oficiales, tileserver local /tiles/) y responde desde caché cuando la red
 * falla o tarda demasiado — así el mapa de una zona ya visitada sigue
 * funcionando en modo offline sin que el frontend tenga que cambiar de URL.
 *
 * Estrategia: network-first con timeout corto + fallback a caché; si la red
 * responde bien, se actualiza la caché (stale-while-revalidate implícito).
 * Eviction: LRU acotado por número de entradas (aproximado moviendo cada hit
 * al final de la caché) y por cuota real vía navigator.storage.estimate().
 */

const CACHE_NAME = 'beemetry-tile-cache-v1';
// Timeout ADAPTATIVO (incidente 2026-07-18): el timeout corto solo tiene
// sentido cuando HAY una copia en caché a la cual caer rápido — con la
// caché vacía, rendirse a los 2.5s no ofrece nada a cambio y mata tiles de
// servidores estatales lentos (un GetMap de SENAMHI tarda ~3s por sí solo,
// y bajo la ráfaga inicial de Leaflet —~18 tiles contra el límite de 6
// conexiones por host— los últimos de la cola arrancan ya "tarde"). Sin
// éxito nunca, la caché jamás se poblaba y el fallo era permanente.
const NETWORK_TIMEOUT_WITH_FALLBACK_MS = 2500;
const NETWORK_TIMEOUT_NO_FALLBACK_MS = 20000;
const MAX_ENTRIES = 4000;
const QUOTA_SAFETY_RATIO = 0.85; // no superar el 85% de la cuota estimada del origen

const TILE_URL_PATTERNS = [
    /^https:\/\/mt\d\.google\.com\/vt\//,
    /^https:\/\/[a-z]\.tile\.opentopomap\.org\//,
    /\/tiles\/services\//,      // tileserver local proxificado (mismo origen)
    /[?&]service=wms/i,          // GetMap de WMS (MINAM/INGEMMET/MINEM/etc.)
];

function isTileRequest(request) {
    if (request.method !== 'GET') return false;
    return TILE_URL_PATTERNS.some((re) => re.test(request.url));
}

async function trimCache() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        if (keys.length <= MAX_ENTRIES) return;
        const excess = keys.length - MAX_ENTRIES;
        for (let i = 0; i < excess; i++) {
            await cache.delete(keys[i]);
        }
    } catch (_) {
        /* best-effort */
    }
}

async function checkQuota() {
    try {
        if (!self.registration || !('storage' in self)) return true;
        if (!self.navigator?.storage?.estimate) return true;
        const { usage, quota } = await self.navigator.storage.estimate();
        if (!quota) return true;
        return usage / quota < QUOTA_SAFETY_RATIO;
    } catch (_) {
        return true;
    }
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('network_timeout')), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

async function handleTileFetch(request) {
    const cache = await caches.open(CACHE_NAME);
    // Ver comentario de los timeouts arriba: con respaldo en caché conviene
    // fallar rápido a la copia local; sin respaldo, esperar a la red es la
    // única opción útil (el tile roto es el peor resultado posible).
    const cachedFallback = await cache.match(request);
    const timeoutMs = cachedFallback
        ? NETWORK_TIMEOUT_WITH_FALLBACK_MS
        : NETWORK_TIMEOUT_NO_FALLBACK_MS;

    try {
        const networkResponse = await withTimeout(fetch(request), timeoutMs);
        // Los tiles de Google/WMS externos se piden en modo no-cors (sin
        // cabeceras CORS del servidor) → la Response es "opaque": .ok es
        // SIEMPRE false y .status SIEMPRE 0, aunque el tile haya cargado
        // bien (no hay forma de distinguir éxito de error en modo opaco).
        // Solo se descarta cachear cuando SÍ es inspeccionable (same-origin
        // /tiles/ o WMS con CORS) y vino con un status de error real.
        const isOpaque = networkResponse && networkResponse.type === 'opaque';
        const isUsable = networkResponse && (isOpaque || networkResponse.ok);
        if (isUsable) {
            const hasQuota = await checkQuota();
            if (hasQuota) {
                // Mover a "más reciente" en la caché (aproximación LRU): borrar
                // e insertar de nuevo para que quede al final de cache.keys().
                await cache.delete(request);
                await cache.put(request, networkResponse.clone());
                trimCache();
            }
        }
        return networkResponse;
    } catch (_) {
        if (cachedFallback) return cachedFallback;
        throw new Error('tile_unavailable_offline');
    }
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (!isTileRequest(request)) return;
    event.respondWith(handleTileFetch(request));
});
