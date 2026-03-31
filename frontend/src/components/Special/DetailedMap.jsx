import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Camera, Layers, RefreshCw } from 'lucide-react';

const DetailedMap = ({ onCaptureMap, captureButtonPlacement = 'bottom' }) => {
    const mapContainer = useRef(null);
    const map = useRef(null);
    const scrollShellRef = useRef(null);
    const resizeRafRef = useRef(null);
    const tileJsonCacheRef = useRef({});
    const [lng, setLng] = useState(-74.0721);
    const [lat, setLat] = useState(4.711);
    const [zoom, setZoom] = useState(6);
    const [tilesets, setTilesets] = useState([]);
    const [currentTileset, setCurrentTileset] = useState(null);
    const [loading, setLoading] = useState(false);
    const [overlayOpacity, setOverlayOpacity] = useState(86);
    const [status, setStatus] = useState({ kind: 'info', text: 'Selecciona una capa para cargarla sobre el mapa base.' });
    const [scrollHints, setScrollHints] = useState({ right: false, bottom: false });
    const currentLayerRef = useRef(null);

    const TILE_BASE = 'http://localhost:8000';

    // Initialize Leaflet Map
    useEffect(() => {
        if (map.current) return;

        map.current = L.map(mapContainer.current, {
            maxZoom: 22,
            zoomControl: true
        }).setView([lat, lng], zoom);

        // Google Satellite Base Layer
        L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            maxZoom: 22,
            attribution: '© Google Satellite'
        }).addTo(map.current);

        map.current.on('moveend', () => {
            const center = map.current.getCenter();
            setLng(center.lng);
            setLat(center.lat);
            setZoom(map.current.getZoom());
        });

        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, []);

    // Load available tilesets
    useEffect(() => {
        fetchTilesets();
    }, []);

    useEffect(() => {
        if (currentLayerRef.current) {
            currentLayerRef.current.setOpacity(overlayOpacity / 100);
        }
    }, [overlayOpacity]);

    useEffect(() => {
        const scheduleInvalidate = () => {
            if (!map.current) return;
            if (resizeRafRef.current) {
                cancelAnimationFrame(resizeRafRef.current);
            }
            resizeRafRef.current = requestAnimationFrame(() => {
                if (map.current) {
                    map.current.invalidateSize({ pan: false });
                }
            });
        };

        scheduleInvalidate();

        const onWindowResize = () => scheduleInvalidate();
        window.addEventListener('resize', onWindowResize);

        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => scheduleInvalidate());
            if (mapContainer.current) observer.observe(mapContainer.current);
            if (scrollShellRef.current) observer.observe(scrollShellRef.current);
        }

        return () => {
            window.removeEventListener('resize', onWindowResize);
            if (observer) observer.disconnect();
            if (resizeRafRef.current) {
                cancelAnimationFrame(resizeRafRef.current);
                resizeRafRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const updateScrollHints = () => {
            const el = scrollShellRef.current;
            if (!el) return;

            const epsilon = 2;
            const hasHorizontalOverflow = el.scrollWidth - el.clientWidth > epsilon;
            const hasVerticalOverflow = el.scrollHeight - el.clientHeight > epsilon;

            const canScrollRight = hasHorizontalOverflow && (el.scrollLeft + el.clientWidth < el.scrollWidth - epsilon);
            const canScrollBottom = hasVerticalOverflow && (el.scrollTop + el.clientHeight < el.scrollHeight - epsilon);

            setScrollHints({ right: canScrollRight, bottom: canScrollBottom });
        };

        updateScrollHints();

        const onResize = () => updateScrollHints();
        window.addEventListener('resize', onResize);

        let observer = null;
        if (typeof ResizeObserver !== 'undefined' && scrollShellRef.current) {
            observer = new ResizeObserver(() => updateScrollHints());
            observer.observe(scrollShellRef.current);
            if (scrollShellRef.current.firstElementChild) {
                observer.observe(scrollShellRef.current.firstElementChild);
            }
        }

        return () => {
            window.removeEventListener('resize', onResize);
            if (observer) {
                observer.disconnect();
            }
        };
    }, [tilesets.length, currentTileset, loading]);

    const fetchTilesets = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${TILE_BASE}/services`);
            if (!res.ok) throw new Error('Failed to fetch tilesets');

            let services = [];
            const data = await res.json();
            if (Array.isArray(data)) services = data;
            else if (Array.isArray(data?.value)) services = data.value;
            else if (data && typeof data === 'object') services = [data];

            setTilesets(services);
        } catch (err) {
            console.error('Error loading tilesets:', err);
            // Fallback: try to load some default tiles if available
        } finally {
            setLoading(false);
        }
    };

    const loadTileset = async (tileset) => {
        if (!map.current) return;

        // Remove previous layer
        if (currentLayerRef.current) {
            map.current.removeLayer(currentLayerRef.current);
            currentLayerRef.current = null;
        }

        try {
            const serviceUrl = tileset.url || `${TILE_BASE}/services/${tileset.name}`;
            setStatus({ kind: 'loading', text: `Cargando capa: ${tileset.name || 'sin nombre'}...` });

            // mbtileserver expone TileJSON directamente en el endpoint del servicio.
            let tileJson = tileJsonCacheRef.current[serviceUrl];
            if (!tileJson) {
                const res = await fetch(serviceUrl);
                if (!res.ok) throw new Error(`No se pudo obtener TileJSON (${res.status})`);
                tileJson = await res.json();
                tileJsonCacheRef.current[serviceUrl] = tileJson;
            }

            const tileUrl = Array.isArray(tileJson?.tiles) ? tileJson.tiles[0] : null;
            if (!tileUrl) throw new Error('TileJSON sin plantilla de tiles.');

            let tileErrorNotified = false;

            const mbLayer = L.tileLayer(tileUrl, {
                maxZoom: tileJson.maxzoom ?? 22,
                minZoom: tileJson.minzoom ?? 0,
                attribution: tileJson?.name || tileset.name || 'MBTiles',
                opacity: overlayOpacity / 100,
                keepBuffer: 8,
                updateWhenIdle: false,
                crossOrigin: true
            });

            mbLayer.on('loading', () => {
                setStatus({ kind: 'loading', text: `Renderizando capa: ${tileset.name || 'sin nombre'}...` });
            });

            mbLayer.on('load', () => {
                setStatus({ kind: 'ok', text: `Capa cargada correctamente: ${tileset.name || 'sin nombre'}.` });
            });

            mbLayer.on('tileerror', () => {
                if (!tileErrorNotified) {
                    tileErrorNotified = true;
                    setStatus({ kind: 'error', text: `Algunos tiles no se pudieron cargar en ${tileset.name || 'la capa seleccionada'}.` });
                }
            });

            mbLayer.addTo(map.current);
            mbLayer.bringToFront();
            currentLayerRef.current = mbLayer;

            // Fit bounds if available
            if (Array.isArray(tileJson?.bounds) && tileJson.bounds.length === 4) {
                const [west, south, east, north] = tileJson.bounds;
                map.current.fitBounds([
                    [south, west],
                    [north, east]
                ], { padding: [50, 50] });
            }

            requestAnimationFrame(() => {
                if (map.current) {
                    map.current.invalidateSize({ pan: false });
                }
            });

            setCurrentTileset(serviceUrl);
        } catch (err) {
            console.error('Error loading tileset:', err);
            setStatus({ kind: 'error', text: `No se pudo cargar la capa: ${err.message}` });
        }
    };

    const captureMap = async () => {
        if (!map.current) return;

        try {
            // Try to get Leaflet's internal canvas first
            const mapContainer = map.current._container;
            const leafletCanvas = mapContainer?.querySelector('canvas');
            
            if (leafletCanvas) {
                // Use Leaflet's canvas directly (faster and more reliable)
                const dataURL = leafletCanvas.toDataURL('image/png');
                if (typeof onCaptureMap === 'function') {
                    onCaptureMap(dataURL);
                } else {
                    const link = document.createElement('a');
                    link.href = dataURL;
                    link.download = `mapa_${new Date().getTime()}.png`;
                    link.click();
                }
            } else {
                // Fallback: use html2canvas if canvas not found
                const html2canvas = (await import('html2canvas')).default;
                const canvas = await html2canvas(mapContainer, {
                    scale: 1.5,
                    useCORS: true,
                    logging: false,
                    backgroundColor: '#ffffff'
                });
                const dataURL = canvas.toDataURL('image/png');
                if (typeof onCaptureMap === 'function') {
                    onCaptureMap(dataURL);
                } else {
                    const link = document.createElement('a');
                    link.href = dataURL;
                    link.download = `mapa_${new Date().getTime()}.png`;
                    link.click();
                }
            }
        } catch (err) {
            console.error('Error capturing map:', err);
        }
    };

    const captureButton = (
        <button
            onClick={captureMap}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white font-medium hover:shadow-lg transition-all"
        >
            <Camera size={16} />
            Capturar Mapa
        </button>
    );

    return (
        <div
            ref={scrollShellRef}
            onScroll={() => {
                const el = scrollShellRef.current;
                if (!el) return;

                const epsilon = 2;
                const hasHorizontalOverflow = el.scrollWidth - el.clientWidth > epsilon;
                const hasVerticalOverflow = el.scrollHeight - el.clientHeight > epsilon;

                const canScrollRight = hasHorizontalOverflow && (el.scrollLeft + el.clientWidth < el.scrollWidth - epsilon);
                const canScrollBottom = hasVerticalOverflow && (el.scrollTop + el.clientHeight < el.scrollHeight - epsilon);

                setScrollHints({ right: canScrollRight, bottom: canScrollBottom });
            }}
            className="relative w-full h-full min-h-0 overflow-auto"
        >
            {scrollHints.right && (
                <>
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-8 z-20 bg-gradient-to-l from-slate-900/20 to-transparent" />
                    <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 z-30 rounded-full bg-slate-900/75 text-white text-[10px] px-2 py-1 shadow-lg backdrop-blur-sm">
                        Desplazar →
                    </div>
                </>
            )}

            {scrollHints.bottom && (
                <>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 z-20 bg-gradient-to-t from-slate-900/20 to-transparent" />
                    <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 z-30 rounded-full bg-slate-900/75 text-white text-[10px] px-2 py-1 shadow-lg backdrop-blur-sm">
                        Desplazar ↓
                    </div>
                </>
            )}

            <div className="min-w-[980px] min-h-full flex gap-4 bg-[#f8fafc] dark:bg-[#020617] p-4">
                {/* Left Panel */}
                <div className="w-80 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 p-4 overflow-y-auto flex flex-col gap-4 max-h-[calc(100vh-160px)]">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Mapa Detallado</h2>
                    <button
                        onClick={fetchTilesets}
                        disabled={loading}
                        className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 transition-colors disabled:opacity-50"
                        title="Actualizar tilesets"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {captureButtonPlacement === 'top' && captureButton}

                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Layers size={14} />
                        Capas disponibles ({tilesets.length})
                    </h3>
                    
                    {loading ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">Cargando...</p>
                    ) : tilesets.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">No hay tilesets disponibles</p>
                    ) : (
                        <div className="space-y-2">
                            {tilesets.map((tileset) => (
                                <button
                                    key={tileset.url || tileset.name}
                                    onClick={() => loadTileset(tileset)}
                                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                                        currentTileset === (tileset.url || `${TILE_BASE}/services/${tileset.name}`)
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100'
                                            : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700'
                                    }`}
                                    title={tileset.name || 'Tileset'}
                                >
                                    <div className="font-medium truncate text-sm">{tileset.name || 'Tileset sin nombre'}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                        {tileset.url || 'Sin URL de servicio'}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className={`rounded-lg px-3 py-2 text-xs border ${
                    status.kind === 'ok'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800'
                        : status.kind === 'error'
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800'
                            : status.kind === 'loading'
                                ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
                                : 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700'
                }`}>
                    {status.text}
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3 bg-slate-50 dark:bg-slate-800/40">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Opacidad de capa</h3>
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-300">{overlayOpacity}%</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={overlayOpacity}
                        onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                        className="w-full accent-blue-600"
                        title="Controla la opacidad de la capa MBTiles sobre el mapa satelital"
                    />
                    <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                        0% = solo mapa base, 100% = solo capa MBTiles.
                    </div>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Ubicación Actual</h3>
                    <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                        <div>Lat: {lat.toFixed(4)}</div>
                        <div>Lng: {lng.toFixed(4)}</div>
                        <div>Zoom: {zoom.toFixed(1)}</div>
                    </div>
                </div>

                {captureButtonPlacement !== 'top' && captureButton}
                </div>

                {/* Map Container */}
                <div className="flex-1 min-w-[620px] rounded-xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
                    <div
                        ref={mapContainer}
                        className="w-full h-full"
                        style={{ minHeight: '600px' }}
                    />
                </div>
            </div>
        </div>
    );
};

export default DetailedMap;
