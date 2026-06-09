import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, RefreshCw, LocateFixed, Filter, Mountain, ShieldAlert, Route, Drill, Globe2 } from 'lucide-react';
import WMS_CATALOG from '../../config/wmsCorporateCatalog.json';
import TerritorialCompliancePanel from './TerritorialCompliancePanel.jsx';

const INITIAL_VIEW = { lat: -17.2464, lng: -70.612, zoom: 13 };

const BASEMAPS = {
    satellite: {
        label: 'Satelital',
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        attribution: '© Google Satellite',
    },
    hybrid: {
        label: 'Híbrido',
        url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        attribution: '© Google Hybrid',
    },
    terrain: {
        label: 'Terreno',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '© OpenTopoMap contributors',
    },
};

const GEO_FENCES = [
    { id: 'rampa-norte', name: 'Rampa Norte', lat: -17.2448, lng: -70.6112, radius: 340 },
    { id: 'chancadora', name: 'Zona Chancadora', lat: -17.2471, lng: -70.6087, radius: 260 },
];

const getFirstCatalogPreset = () => {
    const r = WMS_CATALOG.regions?.[0];
    const s = r?.sources?.[0];
    if (r?.id && s?.id) return `${r.id}:${s.id}`;
    return 'manual';
};

const inferWmsVersion = (serviceUrl) => {
    const u = String(serviceUrl || '').toLowerCase();
    if (!u) return '1.1.1';
    if (u.includes('/arcgis/') && u.includes('wmsserver')) return '1.3.0';
    if (u.includes('geoportal.minem.gob.pe') && u.includes('wmsserver')) return '1.3.0';
    if (u.includes('nationalmap.gov') && u.includes('wmsserver')) return '1.3.0';
    return '1.1.1';
};

const getWmsFromPreset = (presetId) => {
    if (!presetId || presetId === 'manual') {
        return {
            url: '',
            layer: '',
            regionLabel: null,
            sourceName: null,
            docUrl: null,
            wmsVersion: null,
        };
    }
    const idx = presetId.indexOf(':');
    if (idx < 0) {
        return { url: '', layer: '', regionLabel: null, sourceName: null, docUrl: null, wmsVersion: null };
    }
    const regionId = presetId.slice(0, idx);
    const sourceId = presetId.slice(idx + 1);
    const region = WMS_CATALOG.regions.find((reg) => reg.id === regionId);
    const source = region?.sources?.find((src) => src.id === sourceId);
    const url = source?.url ?? '';
    const explicit = source?.wmsVersion;
    return {
        url,
        layer: source?.defaultLayer ?? '',
        regionLabel: region?.label ?? null,
        sourceName: source?.name ?? null,
        docUrl: source?.docUrl ?? null,
        wmsVersion: explicit || (url ? inferWmsVersion(url) : null),
    };
};

const catalogHasCompositePreset = (compositeKey) => {
    if (!compositeKey || compositeKey === 'manual') return false;
    const idx = compositeKey.indexOf(':');
    if (idx <= 0) return false;
    const regionId = compositeKey.slice(0, idx);
    const sourceId = compositeKey.slice(idx + 1);
    const region = WMS_CATALOG.regions.find((r) => r.id === regionId);
    return Boolean(region?.sources?.some((s) => s.id === sourceId));
};

const markerColor = (marker) => {
    if (String(marker.status || '').toLowerCase() === 'warning') return '#f59e0b';
    if (marker.type === 'equipment') return '#0ea5e9';
    if (marker.type === 'personnel') return '#10b981';
    return '#a855f7';
};

const getMarkerTimestamp = (marker) => {
    const raw = marker?.timestamp || marker?.updated_at || marker?.created_at || null;
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
};

const officialGeoStyle = (feature) => {
    const sev = String(feature?.properties?.severity || 'medium').toLowerCase();
    const color = sev === 'high' ? '#f87171' : sev === 'low' ? '#4ade80' : '#fbbf24';
    return {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.2,
        dashArray: sev === 'high' ? '6 4' : undefined,
    };
};

const MapViewer = ({
    layout = 'default',
    siteLabel,
    mapTitle = 'Mapa Satelital Operacional',
    syncedWmsPresetKey = null,
    geoportalModuleLabel = null,
} = {}) => {
    const isComplianceLayout = layout === 'compliance';
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const baseLayerRef = useRef(null);
    const markerLayerRef = useRef(null);
    const warningLayerRef = useRef(null);
    const geofenceLayerRef = useRef(null);
    const targetLayerRef = useRef(null);
    const haulRouteLayerRef = useRef(null);
    const drillingLayerRef = useRef(null);
    const externalWmsLayerRef = useRef(null);
    const officialGeoLayerRef = useRef(null);
    const [baseMap, setBaseMap] = useState('satellite');
    const [allMarkers, setAllMarkers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showEquipment, setShowEquipment] = useState(true);
    const [showPersonnel, setShowPersonnel] = useState(true);
    const [showSensors, setShowSensors] = useState(true);
    const [showWarningsOnly, setShowWarningsOnly] = useState(false);
    const [showGeofences, setShowGeofences] = useState(true);
    const [showTargets, setShowTargets] = useState(true);
    const [showHaulRoutes, setShowHaulRoutes] = useState(true);
    const [showDrillZones, setShowDrillZones] = useState(true);
    const [timeWindow, setTimeWindow] = useState('all');
    const [selectedWmsPreset, setSelectedWmsPreset] = useState(() => getFirstCatalogPreset());
    const [wmsUrl, setWmsUrl] = useState(() => getWmsFromPreset(getFirstCatalogPreset()).url);
    const [wmsLayerName, setWmsLayerName] = useState(() => getWmsFromPreset(getFirstCatalogPreset()).layer);
    const [wmsOpacity, setWmsOpacity] = useState(72);
    const [showExternalWms, setShowExternalWms] = useState(false);
    const [wmsStatus, setWmsStatus] = useState('WMS inactivo');
    const [showOfficialGeo, setShowOfficialGeo] = useState(true);
    const [geoCompliance, setGeoCompliance] = useState(null);
    const [geoComplianceLoading, setGeoComplianceLoading] = useState(false);
    const [geoComplianceError, setGeoComplianceError] = useState(null);

    const refreshGeoCompliance = useCallback(async () => {
        if (typeof process !== 'undefined' && process.env?.VITEST) return;
        setGeoComplianceLoading(true);
        try {
            const res = await fetch(new URL('/api/map/compliance-intersections', window.location.origin).toString());
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setGeoCompliance(data);
            setGeoComplianceError(null);
        } catch (err) {
            console.error('compliance-intersections', err);
            setGeoComplianceError(err?.message || 'Error al evaluar cumplimiento');
            setGeoCompliance(null);
        } finally {
            setGeoComplianceLoading(false);
        }
    }, []);

    const rebuildOfficialGeoLayer = useCallback(async () => {
        const map = mapRef.current;
        if (!map) return;
        if (officialGeoLayerRef.current) {
            map.removeLayer(officialGeoLayerRef.current);
            officialGeoLayerRef.current = null;
        }
        if (!showOfficialGeo) return;
        if (typeof process !== 'undefined' && process.env?.VITEST) return;
        try {
            const res = await fetch(new URL('/api/map/official-zones', window.location.origin).toString());
            const data = await res.json();
            if (!mapRef.current) return;
            const gj = L.geoJSON(data, { pane: 'ops-official', style: officialGeoStyle });
            gj.addTo(mapRef.current);
            officialGeoLayerRef.current = gj;
        } catch (err) {
            console.error('official-zones', err);
        }
    }, [showOfficialGeo]);

    useEffect(() => {
        if (mapRef.current) return;
        const map = L.map(mapContainerRef.current, {
            maxZoom: 22,
            zoomControl: true,
            preferCanvas: true,
        }).setView([INITIAL_VIEW.lat, INITIAL_VIEW.lng], INITIAL_VIEW.zoom);
        mapRef.current = map;

        map.createPane('ops-markers');
        map.getPane('ops-markers').style.zIndex = '660';
        map.createPane('ops-warning');
        map.getPane('ops-warning').style.zIndex = '640';
        map.createPane('ops-geofence');
        map.getPane('ops-geofence').style.zIndex = '620';
        map.createPane('ops-targets');
        map.getPane('ops-targets').style.zIndex = '630';
        map.createPane('ops-official');
        map.getPane('ops-official').style.zIndex = '605';

        baseLayerRef.current = L.tileLayer(BASEMAPS.satellite.url, {
            maxZoom: 22,
            attribution: BASEMAPS.satellite.attribution,
        }).addTo(map);

        markerLayerRef.current = L.layerGroup().addTo(map);
        warningLayerRef.current = L.layerGroup().addTo(map);
        geofenceLayerRef.current = L.layerGroup().addTo(map);
        targetLayerRef.current = L.layerGroup().addTo(map);
        haulRouteLayerRef.current = L.layerGroup().addTo(map);
        drillingLayerRef.current = L.layerGroup().addTo(map);

        const onResize = () => map.invalidateSize({ pan: false });
        window.addEventListener('resize', onResize);

        return () => {
            window.removeEventListener('resize', onResize);
            officialGeoLayerRef.current = null;
            map.remove();
            mapRef.current = null;
        };
    }, []);

    useEffect(() => {
        rebuildOfficialGeoLayer();
    }, [rebuildOfficialGeoLayer]);

    useEffect(() => {
        refreshGeoCompliance();
    }, [refreshGeoCompliance]);

    useEffect(() => {
        if (!mapRef.current || !baseLayerRef.current) return;
        const cfg = BASEMAPS[baseMap] || BASEMAPS.satellite;
        mapRef.current.removeLayer(baseLayerRef.current);
        baseLayerRef.current = L.tileLayer(cfg.url, {
            maxZoom: 22,
            attribution: cfg.attribution,
        }).addTo(mapRef.current);
    }, [baseMap]);

    useEffect(() => {
        if (selectedWmsPreset === 'manual') return;
        const { url, layer } = getWmsFromPreset(selectedWmsPreset);
        setWmsUrl(url);
        setWmsLayerName(layer);
    }, [selectedWmsPreset]);

    const catalogMeta = useMemo(() => {
        if (selectedWmsPreset === 'manual') {
            return { regionLabel: null, sourceName: null, docUrl: null };
        }
        const { regionLabel, sourceName, docUrl } = getWmsFromPreset(selectedWmsPreset);
        return { regionLabel, sourceName, docUrl };
    }, [selectedWmsPreset]);

    useEffect(() => {
        if (syncedWmsPresetKey == null || syncedWmsPresetKey === '') return;
        if (!catalogHasCompositePreset(syncedWmsPresetKey)) return;
        setSelectedWmsPreset(syncedWmsPresetKey);
    }, [syncedWmsPresetKey]);

    useEffect(() => {
        if (!mapRef.current) return;

        if (externalWmsLayerRef.current) {
            mapRef.current.removeLayer(externalWmsLayerRef.current);
            externalWmsLayerRef.current = null;
        }

        if (!showExternalWms) {
            setWmsStatus('WMS inactivo');
            return;
        }

        const url = String(wmsUrl || '').trim();
        const layers = String(wmsLayerName || '').trim();
        if (!url || !layers) {
            setWmsStatus('Complete URL y capa WMS');
            return;
        }

        const version =
            selectedWmsPreset !== 'manual'
                ? getWmsFromPreset(selectedWmsPreset).wmsVersion || inferWmsVersion(url)
                : inferWmsVersion(url);

        try {
            const layer = L.tileLayer.wms(url, {
                layers,
                format: 'image/png',
                transparent: true,
                version,
                opacity: wmsOpacity / 100,
            });
            layer.on('loading', () => setWmsStatus(`Cargando WMS (${version}): ${layers}`));
            layer.on('load', () => setWmsStatus(`WMS activo (${version}): ${layers}`));
            layer.on('tileerror', () => setWmsStatus(`Error tiles WMS (${version}): ${layers}`));
            layer.addTo(mapRef.current);
            externalWmsLayerRef.current = layer;
        } catch (err) {
            console.error('WMS layer error', err);
            setWmsStatus('Error al activar capa WMS');
        }
    }, [showExternalWms, wmsUrl, wmsLayerName, wmsOpacity, selectedWmsPreset]);

    const fetchMarkers = useCallback(async () => {
        if (typeof process !== 'undefined' && process.env?.VITEST) return;
        setLoading(true);
        try {
            const apiUrl = new URL('/api/map/markers', window.location.origin).toString();
            const res = await fetch(apiUrl);
            const data = await res.json();
            setAllMarkers(Array.isArray(data?.markers) ? data.markers : []);
        } catch (err) {
            console.error('Error loading map markers', err);
            setAllMarkers([]);
        } finally {
            setLoading(false);
            refreshGeoCompliance();
        }
    }, [refreshGeoCompliance]);

    useEffect(() => {
        fetchMarkers();
    }, [fetchMarkers]);

    const visibleMarkers = useMemo(() => {
        const now = Date.now();
        const limitMs =
            timeWindow === '24h' ? 24 * 60 * 60 * 1000 :
            timeWindow === '7d' ? 7 * 24 * 60 * 60 * 1000 :
            timeWindow === '30d' ? 30 * 24 * 60 * 60 * 1000 :
            null;

        return allMarkers.filter((m) => {
            const t = String(m.type || '').toLowerCase();
            const s = String(m.status || '').toLowerCase();
            if (limitMs != null) {
                const ts = getMarkerTimestamp(m);
                if (ts != null && now - ts > limitMs) return false;
            }
            if (showWarningsOnly && s !== 'warning') return false;
            if (t === 'equipment' && !showEquipment) return false;
            if (t === 'personnel' && !showPersonnel) return false;
            if (t !== 'equipment' && t !== 'personnel' && !showSensors) return false;
            return true;
        });
    }, [allMarkers, showEquipment, showPersonnel, showSensors, showWarningsOnly, timeWindow]);

    useEffect(() => {
        if (!mapRef.current || !markerLayerRef.current) return;
        markerLayerRef.current.clearLayers();
        warningLayerRef.current.clearLayers();
        targetLayerRef.current.clearLayers();
        haulRouteLayerRef.current.clearLayers();
        drillingLayerRef.current.clearLayers();

        const equipmentPoints = [];
        const warningPoints = [];
        const sensorPoints = [];

        visibleMarkers.forEach((m) => {
            const lat = Number(m.lat);
            const lng = Number(m.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            const markerType = String(m.type || '').toLowerCase();
            const markerStatus = String(m.status || '').toLowerCase();
            if (markerType === 'equipment') equipmentPoints.push([lat, lng]);
            if (markerType === 'sensor') sensorPoints.push([lat, lng]);
            if (markerStatus === 'warning') warningPoints.push([lat, lng]);

            const color = markerColor(m);
            const icon = L.divIcon({
                html: `<div style="width:14px;height:14px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:0 0 14px rgba(2,6,23,0.8)"></div>`,
                iconSize: [14, 14],
                className: 'leaflet-div-icon',
            });

            L.marker([lat, lng], { icon, pane: 'ops-markers' })
                .bindPopup(
                    `<div style="padding:4px 2px">
                        <div style="font-weight:700;font-size:12px">${m.name || 'Marcador'}</div>
                        <div style="font-size:11px;color:#475569;text-transform:capitalize">${m.type || 'sensor'} · ${m.status || 'n/a'}</div>
                        <div style="font-size:10px;color:#64748b;margin-top:2px">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                    </div>`
                )
                .addTo(markerLayerRef.current);

            if (markerStatus === 'warning') {
                L.circle([lat, lng], {
                    radius: 90,
                    color: '#f59e0b',
                    weight: 2,
                    fillColor: '#f59e0b',
                    fillOpacity: 0.12,
                    pane: 'ops-warning',
                }).addTo(warningLayerRef.current);
            }

            if (showTargets && (m.type === 'sensor' || String(m.status || '').toLowerCase() === 'warning')) {
                L.circle([lat, lng], {
                    radius: 180,
                    color: '#38bdf8',
                    weight: 1,
                    dashArray: '4 6',
                    fillOpacity: 0,
                    pane: 'ops-targets',
                }).addTo(targetLayerRef.current);
            }
        });

        // Rutas de acarreo: une equipos visibles para visualizar flujo operacional.
        if (showHaulRoutes && equipmentPoints.length >= 2) {
            L.polyline(equipmentPoints, {
                color: '#f97316',
                weight: 4,
                opacity: 0.78,
                dashArray: '10 8',
                pane: 'ops-targets',
            })
                .bindTooltip('Ruta de acarreo', { sticky: true })
                .addTo(haulRouteLayerRef.current);
        }

        // Zonas de perforación: polígonos alrededor de sensores/alertas como área técnica.
        if (showDrillZones) {
            const source = warningPoints.length ? warningPoints : sensorPoints;
            source.slice(0, 8).forEach(([lat, lng], idx) => {
                const ring = [
                    [lat + 0.0014, lng - 0.0016],
                    [lat + 0.0012, lng + 0.0017],
                    [lat - 0.0015, lng + 0.0016],
                    [lat - 0.0013, lng - 0.0018],
                ];
                L.polygon(ring, {
                    color: '#a855f7',
                    weight: 2,
                    fillColor: '#a855f7',
                    fillOpacity: 0.1 + (idx % 2) * 0.05,
                    pane: 'ops-geofence',
                })
                    .bindTooltip(`Zona perforación ${idx + 1}`, { sticky: true })
                    .addTo(drillingLayerRef.current);
            });
        }
    }, [visibleMarkers, showTargets, showHaulRoutes, showDrillZones]);

    useEffect(() => {
        if (!mapRef.current || !geofenceLayerRef.current) return;
        geofenceLayerRef.current.clearLayers();
        if (!showGeofences) return;
        GEO_FENCES.forEach((f) => {
            L.circle([f.lat, f.lng], {
                radius: f.radius,
                color: '#22d3ee',
                weight: 2,
                dashArray: '8 6',
                fillColor: '#22d3ee',
                fillOpacity: 0.06,
                pane: 'ops-geofence',
            })
                .bindTooltip(f.name, { sticky: true })
                .addTo(geofenceLayerRef.current);
        });
    }, [showGeofences]);

    const fitToVisible = () => {
        if (!mapRef.current || visibleMarkers.length === 0) return;
        const points = visibleMarkers
            .map((m) => [Number(m.lat), Number(m.lng)])
            .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!points.length) return;
        mapRef.current.fitBounds(points, { padding: [40, 40], maxZoom: 17 });
    };

    const totals = useMemo(() => {
        const online = visibleMarkers.filter((m) => String(m.status || '').toLowerCase() === 'online').length;
        const warning = visibleMarkers.filter((m) => String(m.status || '').toLowerCase() === 'warning').length;
        return { total: visibleMarkers.length, online, warning };
    }, [visibleMarkers]);

    const incidents = useMemo(() => {
        return visibleMarkers
            .filter((m) => String(m.status || '').toLowerCase() === 'warning')
            .map((m) => ({
                id: m.id,
                name: m.name || `Activo ${m.id ?? 'N/A'}`,
                type: m.type || 'sensor',
                lat: Number(m.lat),
                lng: Number(m.lng),
                ts: getMarkerTimestamp(m),
            }))
            .sort((a, b) => (b.ts || 0) - (a.ts || 0))
            .slice(0, 6);
    }, [visibleMarkers]);

    const mapInner = (
        <>
            <div ref={mapContainerRef} className="absolute inset-0 z-0" />

            <div className="absolute left-3 top-3 z-20 w-[min(92vw,360px)] rounded-xl border border-white/10 bg-slate-950/85 p-3 text-slate-100 shadow-2xl backdrop-blur-md">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <h3 className="flex items-center gap-2 text-sm font-bold tracking-wide">
                            <Layers size={16} className="shrink-0 text-sky-400" />
                            <span className="truncate">{mapTitle}</span>
                        </h3>
                        {geoportalModuleLabel ? (
                            <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-cyan-300/90">
                                Módulo: {geoportalModuleLabel}
                            </p>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={fetchMarkers}
                        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs hover:bg-slate-800"
                        title="Actualizar datos"
                    >
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded-lg border border-slate-700 bg-slate-900/75 px-2 py-1.5">
                        <div className="text-slate-400">Activos</div>
                        <div className="text-base font-bold">{totals.total}</div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/75 px-2 py-1.5">
                        <div className="text-slate-400">En línea</div>
                        <div className="text-base font-bold text-emerald-400">{totals.online}</div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/75 px-2 py-1.5">
                        <div className="text-slate-400">Alertas</div>
                        <div className="text-base font-bold text-amber-400">{totals.warning}</div>
                    </div>
                </div>
            </div>

            <div className="absolute right-3 top-3 z-20 w-[min(86vw,300px)] rounded-xl border border-white/10 bg-slate-950/85 p-3 text-slate-100 shadow-2xl backdrop-blur-md">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-300">
                    <Filter size={14} className="text-sky-400" />
                    Capas Técnicas
                </div>
                <div className="mb-2 grid grid-cols-4 gap-1.5 text-[10px]">
                    {[
                        ['all', 'Todo'],
                        ['24h', '24h'],
                        ['7d', '7d'],
                        ['30d', '30d'],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setTimeWindow(value)}
                            className={`rounded-md border px-1.5 py-1 ${timeWindow === value ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100' : 'border-slate-700 bg-slate-900 text-slate-400'}`}
                            title="Ventana temporal de datos"
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="space-y-2 text-xs">
                    {[
                        ['Equipos', showEquipment, setShowEquipment],
                        ['Personal', showPersonnel, setShowPersonnel],
                        ['Sensores', showSensors, setShowSensors],
                        ['Solo alertas', showWarningsOnly, setShowWarningsOnly],
                        ['Geocercas', showGeofences, setShowGeofences],
                        ['Zonas oficiales (GeoJSON)', showOfficialGeo, setShowOfficialGeo],
                        ['Targets geológicos', showTargets, setShowTargets],
                        ['Rutas acarreo', showHaulRoutes, setShowHaulRoutes],
                        ['Zonas perforación', showDrillZones, setShowDrillZones],
                    ].map(([label, value, setter]) => (
                        <button
                            key={label}
                            type="button"
                            onClick={() => setter(!value)}
                            className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 ${value ? 'border-sky-500/45 bg-sky-500/15 text-sky-100' : 'border-slate-700 bg-slate-900 text-slate-400'}`}
                        >
                            <span>{label}</span>
                            <span className="text-[10px]">{value ? 'ON' : 'OFF'}</span>
                        </button>
                    ))}
                </div>
                <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/70 p-2.5">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-300">
                        <Globe2 size={13} className="text-cyan-300" />
                        Integración WMS Oficial
                    </div>
                    <div className="mb-2 space-y-1">
                        <label className="text-[10px] text-slate-400">Preset</label>
                        <select
                            value={selectedWmsPreset}
                            onChange={(e) => setSelectedWmsPreset(e.target.value)}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                        >
                            {WMS_CATALOG.regions.map((region) => (
                                <optgroup key={region.id} label={region.label}>
                                    {region.sources.map((s) => (
                                        <option key={`${region.id}:${s.id}`} value={`${region.id}:${s.id}`}>
                                            {s.name}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                            <option value="manual">WMS personalizado (URL manual)</option>
                        </select>
                    </div>
                    <div className="mb-2 space-y-1">
                        <label className="text-[10px] text-slate-400">URL WMS</label>
                        <input
                            type="text"
                            value={wmsUrl}
                            onChange={(e) => setWmsUrl(e.target.value)}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                            placeholder="https://.../geoserver/wms"
                        />
                    </div>
                    <div className="mb-2 space-y-1">
                        <label className="text-[10px] text-slate-400">Capa (workspace:capa)</label>
                        <input
                            type="text"
                            value={wmsLayerName}
                            onChange={(e) => setWmsLayerName(e.target.value)}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                            placeholder="minam:riesgo_desastres"
                        />
                    </div>
                    <div className="mb-2 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>Opacidad WMS</span>
                            <span>{wmsOpacity}%</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={wmsOpacity}
                            onChange={(e) => setWmsOpacity(Number(e.target.value))}
                            className="w-full accent-cyan-500"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowExternalWms((v) => !v)}
                        className={`w-full rounded border px-2 py-1.5 text-xs font-semibold ${showExternalWms ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
                    >
                        {showExternalWms ? 'Desactivar WMS' : 'Activar WMS'}
                    </button>
                    <div className="mt-1.5 text-[10px] text-slate-500">{wmsStatus}</div>
                </div>
            </div>

            <div className="absolute bottom-24 right-3 z-20 w-[min(92vw,320px)] rounded-xl border border-white/10 bg-slate-950/88 p-3 text-slate-100 shadow-2xl backdrop-blur-md">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-200">
                    <ShieldAlert size={14} className="text-amber-400" />
                    Incidentes Recientes
                </div>
                {incidents.length === 0 ? (
                    <p className="text-xs text-slate-400">Sin incidentes para el filtro temporal activo.</p>
                ) : (
                    <div className="space-y-1.5">
                        {incidents.map((inc) => (
                            <button
                                key={inc.id}
                                type="button"
                                onClick={() => {
                                    if (mapRef.current && Number.isFinite(inc.lat) && Number.isFinite(inc.lng)) {
                                        mapRef.current.setView([inc.lat, inc.lng], Math.max(mapRef.current.getZoom(), 16), { animate: true });
                                    }
                                }}
                                className="flex w-full items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-left hover:bg-amber-500/20"
                                title="Centrar mapa en incidente"
                            >
                                <span className="truncate text-xs font-semibold">{inc.name}</span>
                                <span className="ml-2 shrink-0 text-[10px] text-amber-100/80">
                                    {inc.ts ? new Date(inc.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 's/f'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/88 p-2.5 shadow-2xl backdrop-blur-md">
                {Object.entries(BASEMAPS).map(([key, cfg]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setBaseMap(key)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${baseMap === key ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
                    >
                        {cfg.label}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={fitToVisible}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800"
                    title="Ajustar vista a capas visibles"
                >
                    <LocateFixed size={13} className="mr-1 inline-block" />
                    Enfocar
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setShowWarningsOnly((v) => !v);
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${showWarningsOnly ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
                >
                    <ShieldAlert size={13} className="mr-1 inline-block" />
                    Alertas
                </button>
                <button
                    type="button"
                    onClick={() => setShowTargets((v) => !v)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${showTargets ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
                >
                    <Mountain size={13} className="mr-1 inline-block" />
                    Targets
                </button>
                <button
                    type="button"
                    onClick={() => setShowHaulRoutes((v) => !v)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${showHaulRoutes ? 'border-orange-400 bg-orange-500/20 text-orange-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
                >
                    <Route size={13} className="mr-1 inline-block" />
                    Acarreo
                </button>
                <button
                    type="button"
                    onClick={() => setShowDrillZones((v) => !v)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${showDrillZones ? 'border-violet-400 bg-violet-500/20 text-violet-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
                >
                    <Drill size={13} className="mr-1 inline-block" />
                    Perforación
                </button>
            </div>
        </>
    );

    if (isComplianceLayout) {
        return (
            <div className="flex min-h-0 min-w-0 flex-1 flex-row gap-3">
                <TerritorialCompliancePanel
                    siteLabel={siteLabel}
                    totals={totals}
                    showExternalWms={showExternalWms}
                    wmsStatus={wmsStatus}
                    wmsUrl={wmsUrl}
                    wmsLayerName={wmsLayerName}
                    showGeofences={showGeofences}
                    loading={loading}
                    catalogRegionLabel={catalogMeta.regionLabel}
                    catalogSourceName={catalogMeta.sourceName}
                    docUrl={catalogMeta.docUrl}
                    geoCompliance={geoCompliance}
                    geoComplianceLoading={geoComplianceLoading}
                    geoComplianceError={geoComplianceError}
                />
                <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 shadow-2xl dark:border-slate-800">
                    {mapInner}
                </div>
            </div>
        );
    }

    return (
        <div className="map-full relative h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden rounded-xl border border-slate-200 shadow-2xl dark:border-slate-800">
            {mapInner}
        </div>
    );
};

export default MapViewer;
