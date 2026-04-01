import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers } from 'lucide-react';

const MapViewer = () => {
    const mapContainer = useRef(null);
    const map = useRef(null);
    const markersRef = useRef([]);
    const [lng] = useState(-70.6120); // Toquepala Longitude
    const [lat] = useState(-17.2464); // Toquepala Latitude
    const [zoom] = useState(13); // Closer zoom

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

        map.current.addControl(new L.Control.Zoom({ position: 'topright' }));

        // Fetch Markers
        fetch('/api/map/markers')
            .then(res => res.json())
            .then(data => {
                if (data.markers && map.current) {
                    data.markers.forEach(m => {
                        const el = document.createElement('div');
                        el.className = 'w-4 h-4 rounded-full border-2 border-white shadow-[0_0_10px_rgba(0,0,0,0.5)]';
                        
                        if (m.status === 'warning') {
                            el.className += ' bg-amber-500 animate-pulse';
                        } else if (m.type === 'equipment') {
                            el.className += ' bg-sky-500';
                        } else if (m.type === 'personnel') {
                            el.className += ' bg-emerald-500';
                        } else {
                            el.className += ' bg-purple-500';
                        }

                        const popup = L.popup({ offset: [0, -25] })
                            .setContent(`<div class="p-2"><h4 class="font-bold text-sm m-0">${m.name}</h4><p class="text-xs text-slate-500 m-0 capitalize">${m.type} - ${m.status}</p></div>`);

                        const marker = L.marker([m.lat, m.lng], { 
                            icon: L.divIcon({ 
                                html: el.outerHTML, 
                                iconSize: [16, 16],
                                className: 'leaflet-div-icon' 
                            }) 
                        })
                            .bindPopup(popup)
                            .addTo(map.current);
                        
                        markersRef.current.push(marker);
                    });
                }
            })
            .catch(err => console.error("Error loading map markers", err));

        // Clean up
        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, [lng, lat, zoom]);

    return (
        <div className="map-full w-full h-full relative border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xl">
            <div ref={mapContainer} className="absolute inset-0" />

            {/* Overlay UI for Map */}
            <div className="absolute top-4 left-4 z-10 bg-slate-900/80 backdrop-blur-md p-4 rounded-xl border border-white/10 shadow-xl w-64">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                    <Layers size={16} className="text-sky-400" />
                    Unidad Minera Toquepala
                </h3>
                <p className="text-[10px] text-slate-300 mb-4">Satelital en Tiempo Real + Tracker DB</p>
                
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-sky-500 border border-white" />
                        <span className="text-xs text-slate-200">Equipos Pesados</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500 border border-white" />
                        <span className="text-xs text-slate-200">Personal (Cuadrillas)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-purple-500 border border-white" />
                        <span className="text-xs text-slate-200">Sensores IoT</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-500 border border-white animate-pulse" />
                        <span className="text-xs text-amber-400 font-bold">Alerta / Warning</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MapViewer;
