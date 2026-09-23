import React, { memo, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, MapPin, Loader2, Satellite, Map as MapIcon } from 'lucide-react';
import { geocodeAddress, type GeocodeResult } from '../../auth/authApi';
import { log } from '../../lib/logger';

interface CompanyLocationPickerProps {
    latitude: number | null;
    longitude: number | null;
    zoom?: number | null;
    onChange: (lat: number, lng: number, zoom: number) => void;
    /** Sin permiso de mantenimiento: mapa/coordenadas visibles pero no editables (ni buscador, ni arrastre, ni clic). */
    readOnly?: boolean;
}

// ADR-121: centro de Perú -- fallback neutral cuando la empresa todavía no
// tiene coordenadas y el picker se abre por primera vez (no coloca un
// marcador hasta que el usuario busca/hace clic, así que este centro es solo
// un punto de partida, nunca se guarda como valor real).
const DEFAULT_CENTER = { lat: -9.19, lng: -75.015, zoom: 5 };
const PICK_ZOOM = 15;

type BaseLayerKind = 'satellite' | 'roadmap';

const GOOGLE_TILE_URL: Record<BaseLayerKind, string> = {
    satellite: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    roadmap: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
};

// ADR-190: el icono por defecto de Leaflet (marker-icon.png/marker-shadow.png)
// se rompe al empaquetar con Vite -- rutas relativas que no resuelven, dejan
// el marcador invisible o roto sobre el satelital. Reemplazado por un pin
// propio (mismo criterio que GeocatminWorkbench.tsx), con forma de gota
// reconocible + glifo de montaña (representa la mina) + halo pulsante para
// que sea inequívoco cuál es el punto exacto marcado.
let pinStyleInjected = false;
function ensurePinStyle() {
    if (pinStyleInjected || typeof document === 'undefined') return;
    pinStyleInjected = true;
    const style = document.createElement('style');
    style.id = 'company-location-pin-style';
    style.textContent = `
        .company-location-pin { position: relative; }
        .company-location-pin__pulse {
            position: absolute; left: 50%; bottom: 3px; width: 12px; height: 12px;
            margin-left: -6px; border-radius: 50%; background: rgba(99,102,241,0.55);
            animation: companyLocationPulse 1.8s ease-out infinite;
        }
        @keyframes companyLocationPulse {
            0% { transform: scale(0.6); opacity: 0.8; }
            100% { transform: scale(2.8); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

const MINE_PIN_ICON = (() => {
    ensurePinStyle();
    return L.divIcon({
        className: 'company-location-pin',
        html: `
            <div class="company-location-pin__pulse"></div>
            <svg width="34" height="42" viewBox="0 0 34 42" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 5px rgba(0,0,0,0.45));">
                <defs>
                    <linearGradient id="companyPinGrad" x1="0" y1="0" x2="34" y2="42" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stop-color="#818cf8" />
                        <stop offset="1" stop-color="#4338ca" />
                    </linearGradient>
                </defs>
                <path d="M17 0C7.6 0 0 7.6 0 17c0 12.4 17 25 17 25s17-12.6 17-25C34 7.6 26.4 0 17 0z" fill="url(#companyPinGrad)" stroke="#ffffff" stroke-width="2"/>
                <circle cx="17" cy="16.5" r="10.5" fill="#000000" opacity="0.12"/>
                <path d="M8.5 21.5l4.7-7.6 2.7 3.7 2.3-3.1 5.3 7z" fill="#ffffff"/>
            </svg>
        `,
        iconSize: [34, 42],
        iconAnchor: [17, 42],
    });
})();

const formatCoord = (v: number) => v.toFixed(6);

/**
 * Selector de ubicación de la mina para el alta/edición de empresa (ADR-121,
 * rediseñado en ADR-190): buscador de dirección (proxy backend a Nominatim)
 * que recentra el mapa de forma aproximada, marcador arrastrable/clicable
 * para el ajuste fino manual, campos de Latitud/Longitud editables como
 * fuente alternativa de entrada precisa, y selector Satélite/Plano (ambas
 * capas son de Google). Nunca usa un LLM/IA para inventar coordenadas.
 */
function CompanyLocationPicker({ latitude, longitude, zoom, onChange, readOnly = false }: CompanyLocationPickerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const markerRef = useRef<any>(null);
    const tileLayerRef = useRef<any>(null);

    const [searchText, setSearchText] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [results, setResults] = useState<GeocodeResult[]>([]);
    const [baseLayer, setBaseLayer] = useState<BaseLayerKind>('satellite');

    const hasInitial = typeof latitude === 'number' && typeof longitude === 'number';
    const [latText, setLatText] = useState(hasInitial ? formatCoord(latitude as number) : '');
    const [lngText, setLngText] = useState(hasInitial ? formatCoord(longitude as number) : '');

    const updateDisplay = (lat: number, lng: number) => {
        setLatText(formatCoord(lat));
        setLngText(formatCoord(lng));
    };

    const placeMarker = (lat: number, lng: number) => {
        if (!mapRef.current) return;
        if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng]);
        } else {
            markerRef.current = L.marker([lat, lng], { draggable: !readOnly, icon: MINE_PIN_ICON }).addTo(mapRef.current);
            // Arrastre en curso: refleja la posición en los campos de
            // inmediato para feedback visual continuo.
            markerRef.current.on('drag', () => {
                const pos = markerRef.current!.getLatLng();
                updateDisplay(pos.lat, pos.lng);
            });
            // Al soltar: recién ahí se confirma el cambio hacia el formulario
            // padre (evita disparar guardados/renders en cada píxel arrastrado).
            markerRef.current.on('dragend', () => {
                const pos = markerRef.current!.getLatLng();
                updateDisplay(pos.lat, pos.lng);
                onChange(pos.lat, pos.lng, mapRef.current!.getZoom());
            });
        }
    };

    useEffect(() => {
        if (mapRef.current || !containerRef.current) return;
        const center = hasInitial
            ? { lat: latitude as number, lng: longitude as number }
            : DEFAULT_CENTER;
        const initialZoom = hasInitial ? (zoom || PICK_ZOOM) : DEFAULT_CENTER.zoom;

        const map = L.map(containerRef.current, { maxZoom: 19 }).setView([center.lat, center.lng], initialZoom);
        mapRef.current = map;
        // La capa base (satélite/plano) la crea el efecto de baseLayer de
        // abajo, que también corre al montar -- una sola fuente de verdad
        // para no crear+destruir la capa dos veces en el mismo commit.

        if (hasInitial) {
            placeMarker(center.lat, center.lng);
        }

        if (!readOnly) {
            map.on('click', (e: any) => {
                placeMarker(e.latlng.lat, e.latlng.lng);
                updateDisplay(e.latlng.lat, e.latlng.lng);
                onChange(e.latlng.lat, e.latlng.lng, map.getZoom());
            });
        }

        return () => {
            map.remove();
            mapRef.current = null;
            markerRef.current = null;
            tileLayerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selector Satélite/Plano -- ambas son capas de Google, se intercambian
    // sin recrear el mapa ni perder el marcador ya colocado.
    useEffect(() => {
        if (!mapRef.current) return;
        if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
        tileLayerRef.current = L.tileLayer(GOOGLE_TILE_URL[baseLayer], {
            maxZoom: 19,
            attribution: '© Google',
        }).addTo(mapRef.current);
        // Sin bringToFront(): el pane del marcador de Leaflet ya está por
        // encima del pane de tiles por defecto (markerPane z-index > tilePane),
        // no hace falta forzarlo -- esa llamada además rompía en producción
        // (bringToFront no resultaba invocable en este bundle).
    }, [baseLayer]);

    const runSearch = async () => {
        const q = searchText.trim();
        if (q.length < 2) return;
        setSearching(true);
        setSearchError('');
        try {
            const found = await geocodeAddress(q);
            setResults(found);
            if (found.length === 0) setSearchError('Sin resultados para esa búsqueda.');
        } catch (err) {
            log.error('[COMPANY_LOCATION_PICKER] geocode failed', err);
            setSearchError((err as Error).message || 'No se pudo buscar la dirección.');
        } finally {
            setSearching(false);
        }
    };

    const pickResult = (r: GeocodeResult) => {
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        mapRef.current?.setView([lat, lng], PICK_ZOOM, { animate: true });
        placeMarker(lat, lng);
        updateDisplay(lat, lng);
        setResults([]);
        // Recentra de forma aproximada -- el usuario puede arrastrar el
        // marcador después para el ajuste fino, pero ya deja un valor
        // guardable sin obligar a esa segunda acción.
        onChange(lat, lng, PICK_ZOOM);
    };

    // Campos de Latitud/Longitud como entrada alternativa: al tipear un par
    // de valores válidos, mueve el marcador y confirma el cambio de
    // inmediato, igual que el arrastre o el clic en el mapa.
    const handleCoordInput = (which: 'lat' | 'lng', value: string) => {
        if (which === 'lat') setLatText(value); else setLngText(value);
        const latVal = parseFloat(which === 'lat' ? value : latText);
        const lngVal = parseFloat(which === 'lng' ? value : lngText);
        if (
            Number.isFinite(latVal) && Number.isFinite(lngVal) &&
            latVal >= -90 && latVal <= 90 && lngVal >= -180 && lngVal <= 180
        ) {
            placeMarker(latVal, lngVal);
            mapRef.current?.panTo([latVal, lngVal]);
            onChange(latVal, lngVal, mapRef.current?.getZoom() || PICK_ZOOM);
        }
    };

    const reformatOnBlur = (which: 'lat' | 'lng') => {
        const raw = which === 'lat' ? latText : lngText;
        const v = parseFloat(raw);
        if (!Number.isFinite(v)) return;
        if (which === 'lat') setLatText(formatCoord(v)); else setLngText(formatCoord(v));
    };

    return (
        <div className="space-y-2">
            <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block flex items-center gap-1.5">
                <MapPin size={11} className="text-indigo-400" /> Ubicación de la mina / unidad minera
            </label>

            {!readOnly && (
                <>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Buscar dirección o lugar..."
                            className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
                        />
                        <button
                            type="button"
                            disabled={searching}
                            onClick={runSearch}
                            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase flex items-center gap-1.5"
                        >
                            {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                            Buscar
                        </button>
                    </div>
                    {searchError && <p className="text-[9px] text-amber-400">{searchError}</p>}
                    {results.length > 0 && (
                        <ul className="max-h-28 overflow-auto rounded-lg border border-white/10 bg-slate-950/70 divide-y divide-white/5">
                            {results.map((r, i) => (
                                <li key={`${r.lat}-${r.lon}-${i}`}>
                                    <button
                                        type="button"
                                        onClick={() => pickResult(r)}
                                        className="w-full text-left px-2 py-1.5 text-[10px] text-slate-300 hover:bg-indigo-500/10 hover:text-white"
                                    >
                                        {r.display_name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}

            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="grid grid-cols-2 gap-2 flex-1 min-w-[200px]">
                    <div>
                        <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Latitud</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            readOnly={readOnly}
                            value={latText}
                            placeholder="—"
                            onChange={e => handleCoordInput('lat', e.target.value)}
                            onBlur={() => reformatOnBlur('lat')}
                            className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-emerald-300 outline-none focus:border-indigo-500/50 read-only:opacity-70 read-only:cursor-default"
                        />
                    </div>
                    <div>
                        <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Longitud</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            readOnly={readOnly}
                            value={lngText}
                            placeholder="—"
                            onChange={e => handleCoordInput('lng', e.target.value)}
                            onBlur={() => reformatOnBlur('lng')}
                            className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-emerald-300 outline-none focus:border-indigo-500/50 read-only:opacity-70 read-only:cursor-default"
                        />
                    </div>
                </div>

                <div className="inline-flex rounded-lg border border-white/10 overflow-hidden shrink-0">
                    <button
                        type="button"
                        onClick={() => setBaseLayer('satellite')}
                        title="Vista satelital (Google)"
                        className={`px-2.5 py-1.5 text-[9px] font-black uppercase flex items-center gap-1 transition-colors ${baseLayer === 'satellite' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'}`}
                    >
                        <Satellite size={11} /> Satélite
                    </button>
                    <button
                        type="button"
                        onClick={() => setBaseLayer('roadmap')}
                        title="Vista de plano (Google)"
                        className={`px-2.5 py-1.5 text-[9px] font-black uppercase flex items-center gap-1 transition-colors border-l border-white/10 ${baseLayer === 'roadmap' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'}`}
                    >
                        <MapIcon size={11} /> Plano
                    </button>
                </div>
            </div>

            <div ref={containerRef} className="w-full rounded-lg overflow-hidden border border-white/10" style={{ height: 260 }} />

            <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest opacity-60">
                {readOnly
                    ? 'Ubicación registrada de la mina — solo lectura.'
                    : 'Arrastre el marcador, haga clic en el mapa o escriba las coordenadas para ajustar la ubicación exacta.'}
            </p>
        </div>
    );
}

export default memo(CompanyLocationPicker);
