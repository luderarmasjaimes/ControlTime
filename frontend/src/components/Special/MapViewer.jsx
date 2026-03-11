import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const TILE_BASE = 'http://localhost:8000';

const MapViewer = () => {
    const mapContainer = useRef(null);
    const map = useRef(null);
    const [lng] = useState(-74.0721);
    const [lat] = useState(4.711);
    const [zoom] = useState(6);

    useEffect(() => {
        if (map.current) return;

        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: {
                version: 8,
                sources: {
                    'google-satellite': {
                        type: 'raster',
                        tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
                        tileSize: 256,
                        attribution: '© Google Satellite'
                    }
                },
                layers: [
                    {
                        id: 'google-satellite',
                        type: 'raster',
                        source: 'google-satellite',
                        minzoom: 0,
                        maxzoom: 22
                    }
                ]
            },
            center: [lng, lat],
            zoom: zoom
        });

        map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

        // Clean up on unmount
        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, [lng, lat, zoom]);

    return (
        <div className="map-full w-full h-full relative">
            <div ref={mapContainer} className="absolute inset-0" />

            {/* Overlay UI for Map */}
            <div className="absolute top-4 left-4 z-10 bg-white/80 backdrop-blur-md p-3 rounded-xl border border-slate-200 shadow-xl max-w-xs">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Visor Satelital</h3>
                <p className="text-[10px] text-slate-500 mb-3">Mapa base Google Satellite activo. MBTileserv de tiles locales disponible.</p>
                <div className="flex gap-2">
                    <div className="flex-1 h-1 bg-blue-500 rounded-full" />
                    <div className="flex-1 h-1 bg-slate-200 rounded-full" />
                </div>
            </div>
        </div>
    );
};

export default MapViewer;
