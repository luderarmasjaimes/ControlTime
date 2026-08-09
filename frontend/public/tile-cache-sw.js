/**
 * Caché de cartografía operativa (SPEC-009).
 *
 * Las teselas propias se sirven stale-while-revalidate: una copia existente
 * vuelve inmediatamente y la actualización ocurre fuera del camino crítico.
 * Los proveedores externos no pasan por el SW: el navegador/Leaflet conserva
 * así su cancelación nativa y no se introduce un timeout artificial.
 */

const CACHE_NAME = 'beemetry-tile-cache-v2';
const NETWORK_TIMEOUT_MS = 15000;
const MAX_ENTRIES = 4000;
const QUOTA_SAFETY_RATIO = 0.85;

function classifyTileRequest(request) {
    if (request.method !== 'GET') return null;
    const url = new URL(request.url);
    const ownOrigin = url.origin === self.location.origin;
    if (ownOrigin && (url.pathname.startsWith('/tiles/services/') || url.pathname === '/api/map/wms-proxy')) {
        return { cacheable: true };
    }
    return null;
}

async function fetchWithAbort(request, timeoutMs) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort('tile_timeout'), timeoutMs);
    try {
        return await fetch(request, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', forwardAbort);
    }
}

async function hasQuota() {
    try {
        const estimate = await self.navigator?.storage?.estimate?.();
        return !estimate?.quota || (estimate.usage || 0) / estimate.quota < QUOTA_SAFETY_RATIO;
    } catch (_) {
        return true;
    }
}

async function trimCache(cache) {
    const keys = await cache.keys();
    const excess = keys.length - MAX_ENTRIES;
    for (let i = 0; i < excess; i += 1) await cache.delete(keys[i]);
}

async function cacheResponse(request, response) {
    try {
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.toLowerCase().startsWith('image/') || !(await hasQuota())) return;
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(request);
        await cache.put(request, response);
        await trimCache(cache);
    } catch (_) {
        // El mapa debe seguir funcionando aunque la cuota o Cache Storage fallen.
    }
}

async function refresh(request) {
    const response = await fetchWithAbort(request, NETWORK_TIMEOUT_MS);
    await cacheResponse(request, response.clone());
    return response;
}

async function handleTileFetch(request, event, classification) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
        // No bloquea el render con red ni escrituras de Cache Storage.
        event.waitUntil(refresh(request).catch(() => undefined));
        return cached;
    }

    const response = await fetchWithAbort(request, NETWORK_TIMEOUT_MS);
    event.waitUntil(cacheResponse(request, response.clone()));
    return response;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith('beemetry-tile-cache-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const classification = classifyTileRequest(event.request);
    if (!classification) return;
    event.respondWith(handleTileFetch(event.request, event, classification));
});
