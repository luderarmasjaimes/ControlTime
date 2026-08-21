import React, { memo, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, MapPin, Loader2 } from 'lucide-react';
import { geocodeAddress, type GeocodeResult } from '../../auth/authApi';
import { log } from '../../lib/logger';

interface CompanyLocationPickerProps {
    latitude: number | null;
    longitude: number | null;
    zoom?: number | null;
    onChange: (lat: number, lng: number, zoom: number) => void;
}

// ADR-121: centro de Perú -- fallback neutral cuando la empresa todavía no
// tiene coordenadas y el picker se abre por primera vez (no coloca un
// marcador hasta que el usuario busca/hace clic, así que este centro es solo
// un punto de partida, nunca se guarda como valor real).
const DEFAULT_CENTER = { lat: -9.19, lng: -75.015, zoom: 5 };
const PICK_ZOOM = 15;

/**
 * Selector de ubicación de la mina para el alta/edición de empresa (ADR-121):
 * buscador de dirección (proxy backend a Nominatim) que recentra el mapa de
 * forma aproximada, + marcador arrastrable/clicable para el ajuste fino
 * manual. Nunca usa un LLM/IA para inventar coordenadas.
 */
function CompanyLocationPicker({ latitude, longitude, zoom, onChange }: CompanyLocationPickerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const markerRef = useRef<any>(null);

    const [searchText, setSearchText] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [results, setResults] = useState<GeocodeResult[]>([]);

    const placeMarker = (lat: number, lng: number) => {
        if (!mapRef.current) return;
        if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng]);
        } else {
            markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
            markerRef.current.on('dragend', () => {
                const pos = markerRef.current!.getLatLng();
                onChange(pos.lat, pos.lng, mapRef.current!.getZoom());
            });
        }
    };

    useEffect(() => {
        if (mapRef.current || !containerRef.current) return;
        const hasInitial = typeof latitude === 'number' && typeof longitude === 'number';
        const center = hasInitial
            ? { lat: latitude as number, lng: longitude as number }
            : DEFAULT_CENTER;
        const initialZoom = hasInitial ? (zoom || PICK_ZOOM) : DEFAULT_CENTER.zoom;

        const map = L.map(containerRef.current, { maxZoom: 19 }).setView([center.lat, center.lng], initialZoom);
        mapRef.current = map;

        L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            maxZoom: 19,
            attribution: '© Google Satellite',
        }).addTo(map);

        if (hasInitial) {
            placeMarker(center.lat, center.lng);
        }

        map.on('click', (e: any) => {
            placeMarker(e.latlng.lat, e.latlng.lng);
            onChange(e.latlng.lat, e.latlng.lng, map.getZoom());
        });

        return () => {
            map.remove();
            mapRef.current = null;
            markerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        setResults([]);
        // Recentra de forma aproximada -- el usuario puede arrastrar el
        // marcador después para el ajuste fino, pero ya deja un valor
        // guardable sin obligar a esa segunda acción.
        onChange(lat, lng, PICK_ZOOM);
    };

    return (
        <div className="space-y-2">
            <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block flex items-center gap-1.5">
                <MapPin size={11} className="text-indigo-400" /> Ubicación de la mina
            </label>
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
            <div ref={containerRef} className="w-full rounded-lg overflow-hidden border border-white/10" style={{ height: 240 }} />
            <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest opacity-60">
                Arrastre el marcador o haga clic en el mapa para ajustar la ubicación exacta.
            </p>
        </div>
    );
}

export default memo(CompanyLocationPicker);
