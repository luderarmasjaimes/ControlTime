/**
 * timeoutWmsLayer.ts — capa WMS con timeout real y aborto de teselas obsoletas.
 *
 * Motivo: los geoservidores externos (INGEMMET, OEFA, ANA, SENAMHI, MTC/IGN,
 * USGS -- ver wmsCorporateCatalog.json) son lentos e inconsistentes; el
 * propio catálogo documenta un caso confirmado (SENAMHI /geoserver/wms
 * responde >25s en ese alias, por eso se usa /ows para esa fuente). `L.tileLayer.wms`
 * estándar de Leaflet crea un <img src="..."> por tesela: el navegador no
 * tiene forma de cancelarlo salvo esperar a que el propio socket falle o
 * responda, y solo permite ~6 conexiones concurrentes por origen. Si varias
 * teselas de un mismo geoservidor quedan colgadas 20-60s, agotan ese cupo de
 * 6 conexiones y las teselas restantes del viewport (las que sí tendrían
 * datos) quedan en cola indefinidamente -- de ahí el síntoma reportado:
 * "muy lento, parece que se cuelga, solo se ve la mitad del mapa".
 *
 * Esta capa reemplaza `<img>` directo por `fetch()` + `AbortController`:
 * (a) aplica un timeout real por tesela (WMS_TILE_TIMEOUT_MS) en vez de
 * esperar al timeout TCP del navegador, (b) reintenta una vez antes de darse
 * por vencida (los geoservidores de gobierno suelen fallar por saturación
 * momentánea, no por estar caídos), y (c) aborta explícitamente el fetch de
 * cualquier tesela que salga del viewport (_removeTile) para liberar esa
 * conexión a favor de las teselas que sí hacen falta -- Leaflet no hace esto
 * por sí solo con <img>.
 */

import L from 'leaflet';

const WMS_TILE_TIMEOUT_MS = 15000;
const WMS_TILE_MAX_ATTEMPTS = 2;

export interface TimeoutWmsOptions extends Record<string, any> {
    timeoutMs?: number;
    maxAttempts?: number;
}

interface WmsTileImg extends HTMLImageElement {
    _wmsAbort?: AbortController | null;
    _wmsRemoved?: boolean;
}

/**
 * @brief Crea una capa WMS (L.TileLayer.WMS) cuyas teselas se piden con
 * fetch + AbortController en vez de <img src>, con timeout y un reintento.
 * Misma API pública que `L.tileLayer.wms(url, options)`.
 */
export function createTimeoutWmsLayer(url: string, options: TimeoutWmsOptions): any {
    const timeoutMs = options.timeoutMs ?? WMS_TILE_TIMEOUT_MS;
    const maxAttempts = options.maxAttempts ?? WMS_TILE_MAX_ATTEMPTS;

    const TimeoutWMS = (L.TileLayer.WMS as any).extend({
        createTile(this: any, coords: any, done: (err: any, tile: HTMLImageElement) => void) {
            const tile: WmsTileImg = document.createElement('img');
            tile.alt = '';
            tile.setAttribute('role', 'presentation');

            const tileUrl = this.getTileUrl(coords);
            let objectUrl: string | null = null;

            const cleanup = () => {
                if (objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                    objectUrl = null;
                }
            };

            const attemptLoad = (attempt: number) => {
                // Cada intento requiere una señal nueva: un AbortController
                // abortado no puede reutilizarse para el reintento.
                const controller = new AbortController();
                tile._wmsAbort = controller;
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                fetch(tileUrl, { signal: controller.signal })
                    .then((res) => {
                        clearTimeout(timer);
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return res.blob();
                    })
                    .then((blob) => {
                        objectUrl = URL.createObjectURL(blob);
                        tile.onload = () => {
                            cleanup();
                            done(undefined as any, tile);
                        };
                        tile.onerror = (err) => {
                            cleanup();
                            done(err as any, tile);
                        };
                        tile.src = objectUrl;
                    })
                    .catch((err) => {
                        clearTimeout(timer);
                        // AbortError por _removeTile (tesela ya no hace
                        // falta, salió del viewport): no reintentar, no es
                        // un fallo del servidor.
                        if (err?.name === 'AbortError' && tile._wmsRemoved) {
                            return;
                        }
                        if (attempt < maxAttempts) {
                            attemptLoad(attempt + 1);
                            return;
                        }
                        done(err, tile);
                    });
            };

            attemptLoad(1);
            return tile;
        },

        _removeTile(this: any, key: string) {
            const tile = this._tiles[key]?.el;
            if (tile?._wmsAbort) {
                tile._wmsRemoved = true;
                tile._wmsAbort.abort();
                tile._wmsAbort = null;
            }
            L.TileLayer.WMS.prototype._removeTile.call(this, key);
        },
    });

    return new TimeoutWMS(url, options);
}
