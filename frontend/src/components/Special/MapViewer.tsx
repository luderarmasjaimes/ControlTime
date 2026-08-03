import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, RefreshCw, LocateFixed, Filter, Mountain, ShieldAlert, Route, Drill, Globe2 } from 'lucide-react';
import WMS_CATALOG from '../../config/wmsCorporateCatalog.json';
import TerritorialCompliancePanel from './TerritorialCompliancePanel';
import MapConnectivityBadge from './MapConnectivityBadge';
import { useConnectivity } from '../../lib/connectivityMonitor';
import { clusterMarkers, isCluster, type ClusterableMarker } from '../../lib/mapClustering';
import { planForConnectivity, isCompactPayload, decodeCompactMarkers } from '../../lib/mapFieldMode';
import { saveMarkerSnapshot, loadMarkerSnapshot, formatSnapshotAge } from '../../lib/mapOfflineCache';
import { createTimeoutWmsLayer } from '../../lib/timeoutWmsLayer';
import { getSession, authHeaders as sharedAuthHeaders } from '../../auth/authStorage';

import { log } from '../../lib/logger';

/**
 * /api/map/markers y /api/map/compliance-intersections ahora exigen sesión
 * (ver fix de IDOR en backend/src/map/map_routes.cpp -- antes de eso
 * cualquiera podía leer marcadores de cualquier tenant sin token). El
 * handshake WS del navegador no permite headers custom, pero fetch() sí --
 * mismo patrón ya usado en ImageInsertModal.tsx (Authorization: Bearer).
 */
const authHeaders = (): Record<string, string> => {
    // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
    // navegador adjunta sola. Aqui solo viaja el token CSRF del double-submit.
    return sharedAuthHeaders();
};

const WMS_CATALOG_DATA: any = WMS_CATALOG;

const INITIAL_VIEW = { lat: -17.2464, lng: -70.612, zoom: 13 };

const BASEMAPS: Record<string, { label: string; url: string; attribution: string; maxNativeZoom?: number }> = {
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
        // OpenTopoMap no tiene tiles nativos más allá de z=17: por encima de
        // ese nivel el servidor responde HTTP 200 con una imagen placeholder
        // ("max zoom / layer = 17") en vez de un error, por lo que Leaflet no
        // puede detectarlo solo. maxNativeZoom hace que Leaflet deje de pedir
        // tiles al servidor pasado ese nivel y reescale el último tile válido.
        maxNativeZoom: 17,
    },
};

const GEO_FENCES = [
    { id: 'rampa-norte', name: 'Rampa Norte', lat: -17.2448, lng: -70.6112, radius: 340 },
    { id: 'chancadora', name: 'Zona Chancadora', lat: -17.2471, lng: -70.6087, radius: 260 },
];

const getFirstCatalogPreset = (): string => {
    const r = WMS_CATALOG_DATA.regions?.[0];
    const s = r?.sources?.[0];
    if (r?.id && s?.id) return `${r.id}:${s.id}`;
    return 'manual';
};

const inferWmsVersion = (serviceUrl: unknown): string => {
    const u = String(serviceUrl || '').toLowerCase();
    if (!u) return '1.1.1';
    if (u.includes('/arcgis/') && u.includes('wmsserver')) return '1.3.0';
    if (u.includes('geoportal.minem.gob.pe') && u.includes('wmsserver')) return '1.3.0';
    if (u.includes('nationalmap.gov') && u.includes('wmsserver')) return '1.3.0';
    return '1.1.1';
};

const getWmsFromPreset = (presetId: string) => {
    if (!presetId || presetId === 'manual') {
        return {
            url: '',
            layer: '',
            regionLabel: null as string | null,
            sourceName: null as string | null,
            docUrl: null as string | null,
            wmsVersion: null as string | null,
        };
    }
    const idx = presetId.indexOf(':');
    if (idx < 0) {
        return { url: '', layer: '', regionLabel: null, sourceName: null, docUrl: null, wmsVersion: null };
    }
    const regionId = presetId.slice(0, idx);
    const sourceId = presetId.slice(idx + 1);
    const region = WMS_CATALOG_DATA.regions.find((reg: any) => reg.id === regionId);
    const source = region?.sources?.find((src: any) => src.id === sourceId);
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

const catalogHasCompositePreset = (compositeKey: string | null): boolean => {
    if (!compositeKey || compositeKey === 'manual') return false;
    const idx = compositeKey.indexOf(':');
    if (idx <= 0) return false;
    const regionId = compositeKey.slice(0, idx);
    const sourceId = compositeKey.slice(idx + 1);
    const region = WMS_CATALOG_DATA.regions.find((r: any) => r.id === regionId);
    return Boolean(region?.sources?.some((s: any) => s.id === sourceId));
};

const markerColor = (marker: any): string => {
    if (String(marker.status || '').toLowerCase() === 'warning') return '#f59e0b';
    if (marker.type === 'equipment') return '#0ea5e9';
    if (marker.type === 'personnel') return '#10b981';
    return '#a855f7';
};

const getMarkerTimestamp = (marker: any): number | null => {
    const raw = marker?.timestamp || marker?.updated_at || marker?.created_at || null;
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
};

const officialGeoStyle = (feature: any) => {
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

interface MapViewerProps {
    layout?: string;
    siteLabel?: string;
    mapTitle?: string;
    syncedWmsPresetKey?: string | null;
    geoportalModuleLabel?: string | null;
}

const MapViewer = ({
    layout = 'default',
    siteLabel,
    mapTitle = 'Mapa Satelital Operacional',
    syncedWmsPresetKey = null,
    geoportalModuleLabel = null,
}: MapViewerProps = {}) => {
    const isComplianceLayout = layout === 'compliance';
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const baseLayerRef = useRef<any>(null);
    const markerLayerRef = useRef<any>(null);
    const warningLayerRef = useRef<any>(null);
    const geofenceLayerRef = useRef<any>(null);
    const targetLayerRef = useRef<any>(null);
    const haulRouteLayerRef = useRef<any>(null);
    const drillingLayerRef = useRef<any>(null);
    const externalWmsLayerRef = useRef<any>(null);
    const officialGeoLayerRef = useRef<any>(null);
    const [baseMap, setBaseMap] = useState('satellite');
    const [allMarkers, setAllMarkers] = useState<any[]>([]);
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
    const [geoCompliance, setGeoCompliance] = useState<any>(null);
    const [geoComplianceLoading, setGeoComplianceLoading] = useState(false);
    const [geoComplianceError, setGeoComplianceError] = useState<string | null>(null);
    const [mapZoom, setMapZoom] = useState(INITIAL_VIEW.zoom);
    // "Última actualización: hace N min" -- solo se muestra cuando los
    // marcadores en pantalla vienen del snapshot de IndexedDB (conectividad
    // OFFLINE total), no cuando vienen de un fetch en vivo exitoso. No
    // confundir con el badge "MAPA - OFFLINE" (MapConnectivityBadge, ya
    // existente) -- ese indica el estado de RED; esto indica la antigüedad
    // de los DATOS de marcadores específicamente.
    const [offlineSnapshotAge, setOfflineSnapshotAge] = useState<string | null>(null);
    const connectivity = useConnectivity();

    // "Modo campo": sin red real no tiene sentido seguir pidiendo tiles WMS
    // remotos (fallarían de todas formas) — se apaga automáticamente al caer
    // a OFFLINE; el usuario puede reactivarlo manualmente si la red vuelve.
    useEffect(() => {
        if (connectivity.state === 'OFFLINE' && showExternalWms) {
            setShowExternalWms(false);
            log.debug('MapViewer: WMS externo desactivado automáticamente (sin conectividad)');
        }
    }, [connectivity.state, showExternalWms]);

    const refreshGeoCompliance = useCallback(async () => {
        if (typeof process !== 'undefined' && (process as any).env?.VITEST) return;
        setGeoComplianceLoading(true);
        try {
            const res = await fetch(new URL('/api/map/compliance-intersections', window.location.origin).toString(), {
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setGeoCompliance(data);
            setGeoComplianceError(null);
        } catch (err) {
            log.error('compliance-intersections', err);
            setGeoComplianceError((err as Error)?.message || 'Error al evaluar cumplimiento');
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
        if (typeof process !== 'undefined' && (process as any).env?.VITEST) return;
        try {
            const res = await fetch(new URL('/api/map/official-zones', window.location.origin).toString());
            const data = await res.json();
            if (!mapRef.current) return;
            const gj = L.geoJSON(data, { pane: 'ops-official', style: officialGeoStyle } as any);
            gj.addTo(mapRef.current);
            officialGeoLayerRef.current = gj;
        } catch (err) {
            log.error('official-zones', err);
        }
    }, [showOfficialGeo]);

    useEffect(() => {
        if (mapRef.current) return;
        const map = L.map(mapContainerRef.current!, {
            maxZoom: 22,
            zoomControl: true,
            preferCanvas: true,
        } as any).setView([INITIAL_VIEW.lat, INITIAL_VIEW.lng], INITIAL_VIEW.zoom);
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
            maxNativeZoom: BASEMAPS.satellite.maxNativeZoom,
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

        // El tamaño de celda del clustering depende del zoom actual (ver
        // mapClustering.ts) -- sin esto, acercar/alejar el mapa no
        // reagruparía los marcadores.
        const onZoomEnd = () => setMapZoom(map.getZoom());
        map.on('zoomend', onZoomEnd);

        return () => {
            window.removeEventListener('resize', onResize);
            map.off('zoomend', onZoomEnd);
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
            maxNativeZoom: cfg.maxNativeZoom,
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
            // Teselas de 512px (en vez de las 256px por defecto de Leaflet):
            // la mitad de peticiones HTTP para cubrir el mismo viewport, lo
            // que importa mucho contra geoservidores de gobierno lentos
            // (ver timeoutWmsLayer.ts). updateWhenZooming:false evita pedir
            // teselas nuevas en cada frame de la animación de zoom -- contra
            // un servidor lento eso solo satura el cupo de conexiones con
            // peticiones que quedan obsoletas antes de completarse.
            const layer = createTimeoutWmsLayer(url, {
                layers,
                format: 'image/png',
                transparent: true,
                version,
                opacity: wmsOpacity / 100,
                tileSize: 512,
                updateWhenZooming: false,
                keepBuffer: 4,
            } as any);
            layer.on('loading', () => setWmsStatus(`Cargando WMS (${version}): ${layers}`));
            layer.on('load', () => setWmsStatus(`WMS activo (${version}): ${layers}`));
            layer.on('tileerror', () => setWmsStatus(`Error tiles WMS (${version}): ${layers}`));
            layer.addTo(mapRef.current);
            externalWmsLayerRef.current = layer;
        } catch (err) {
            log.error('WMS layer error', err);
            setWmsStatus('Error al activar capa WMS');
        }
    }, [showExternalWms, wmsUrl, wmsLayerName, wmsOpacity, selectedWmsPreset]);

    const fetchMarkers = useCallback(async () => {
        if (typeof process !== 'undefined' && (process as any).env?.VITEST) return;

        // Pérdida total de conectividad: no tiene sentido intentar un fetch
        // (fallaría, o colgaría hasta timeout) -- servir el último snapshot
        // conocido desde IndexedDB (ver mapOfflineCache.ts) en vez de dejar
        // el mapa en blanco. Alcance acotado respecto a ADR-022: esto es
        // solo lectura de "último estado conocido", no una cola de
        // escrituras pendientes (los marcadores son telemetría de servidor,
        // no ediciones del usuario -- no hay conflicto que resolver).
        if (connectivity.state === 'OFFLINE') {
            const snapshot = await loadMarkerSnapshot();
            if (snapshot) {
                setAllMarkers(snapshot.markers);
                setOfflineSnapshotAge(formatSnapshotAge(snapshot.savedAt));
            }
            // Si no hay snapshot previo (primera carga ya offline, sin datos
            // históricos), se deja `allMarkers` como estaba -- no se
            // sobreescribe con un array vacío, que sería peor que no hacer
            // nada.
            return;
        }
        setOfflineSnapshotAge(null);

        setLoading(true);
        try {
            // "Modo campo" (ver mapFieldMode.ts): con DEGRADADO, se pide
            // formato compacto + un bbox recortado sobre el viewport actual
            // + un limit más bajo -- reusa useConnectivity() como único
            // detector de calidad de conexión, no se construye uno nuevo.
            const plan = planForConnectivity(connectivity.state);
            const apiUrl = new URL('/api/map/markers', window.location.origin);
            if (plan.requestCompact) apiUrl.searchParams.set('compact', '1');
            apiUrl.searchParams.set('limit', String(plan.limit));
            if (plan.bboxShrinkFactor < 1 && mapRef.current) {
                const b = mapRef.current.getBounds();
                const latCenter = (b.getNorth() + b.getSouth()) / 2;
                const lngCenter = (b.getEast() + b.getWest()) / 2;
                const latHalf = ((b.getNorth() - b.getSouth()) / 2) * plan.bboxShrinkFactor;
                const lngHalf = ((b.getEast() - b.getWest()) / 2) * plan.bboxShrinkFactor;
                apiUrl.searchParams.set('bbox_lat', `${latCenter - latHalf},${latCenter + latHalf}`);
                apiUrl.searchParams.set('bbox_lng', `${lngCenter - lngHalf},${lngCenter + lngHalf}`);
            }
            const res = await fetch(apiUrl.toString(), { headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const markers = isCompactPayload(data)
                ? decodeCompactMarkers(data)
                : Array.isArray(data?.markers) ? data.markers : [];
            setAllMarkers(markers);
            // Guarda el snapshot exitoso para la próxima vez que se pierda
            // la conectividad por completo (best-effort, no bloquea el
            // render si IndexedDB falla por cualquier motivo).
            void saveMarkerSnapshot(markers);
        } catch (err) {
            log.error('Error loading map markers', err);
            setAllMarkers([]);
        } finally {
            setLoading(false);
            refreshGeoCompliance();
        }
    }, [refreshGeoCompliance, connectivity.state]);

    useEffect(() => {
        fetchMarkers();
    }, [fetchMarkers]);

    // Intervalo de refresco adaptativo: en ONLINE_PLENO no hace falta poll
    // activo aparte del inicial (el push diferencial por WS, tarea 3, cubre
    // los cambios en vivo); en DEGRADADO/recuperando de OFFLINE, modo campo
    // define un intervalo largo explícito (ver mapFieldMode.ts) como
    // respaldo por si el WS no está disponible en ese enlace.
    useEffect(() => {
        if (connectivity.state === 'ONLINE_PLENO') return;
        const plan = planForConnectivity(connectivity.state);
        if (connectivity.state === 'OFFLINE') return; // sin red: nada que refrescar activamente
        const id = setInterval(fetchMarkers, plan.refreshIntervalMs);
        return () => clearInterval(id);
    }, [connectivity.state, fetchMarkers]);

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

        const equipmentPoints: [number, number][] = [];
        const warningPoints: [number, number][] = [];
        const sensorPoints: [number, number][] = [];

        // Normaliza a ClusterableMarker (lat/lng numéricos ya validados) y
        // agrupa por grilla dependiente del zoom actual -- a 10k sensores
        // esto reduce drásticamente cuántos elementos gráficos hay que
        // dibujar en el viewport actual. Ver mapClustering.ts para el
        // razonamiento de por qué grilla propia en vez de una librería de
        // clustering basada en DOM.
        const normalizedMarkers: (ClusterableMarker & { raw: any })[] = [];
        visibleMarkers.forEach((m) => {
            const lat = Number(m.lat);
            const lng = Number(m.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            normalizedMarkers.push({ id: m.id ?? `${lat},${lng}`, lat, lng, raw: m });

            const markerType = String(m.type || '').toLowerCase();
            const markerStatus = String(m.status || '').toLowerCase();
            if (markerType === 'equipment') equipmentPoints.push([lat, lng]);
            if (markerType === 'sensor') sensorPoints.push([lat, lng]);
            if (markerStatus === 'warning') warningPoints.push([lat, lng]);

            if (markerStatus === 'warning') {
                L.circle([lat, lng], {
                    radius: 90,
                    color: '#f59e0b',
                    weight: 2,
                    fillColor: '#f59e0b',
                    fillOpacity: 0.12,
                    pane: 'ops-warning',
                } as any).addTo(warningLayerRef.current);
            }

            if (showTargets && (m.type === 'sensor' || String(m.status || '').toLowerCase() === 'warning')) {
                L.circle([lat, lng], {
                    radius: 180,
                    color: '#38bdf8',
                    weight: 1,
                    dashArray: '4 6',
                    fillOpacity: 0,
                    pane: 'ops-targets',
                } as any).addTo(targetLayerRef.current);
            }
        });

        const clustered = clusterMarkers(normalizedMarkers, mapZoom);
        clustered.forEach((item) => {
            if (isCluster(item)) {
                // Burbuja de cluster: radio proporcional a la cantidad
                // agrupada (con techo, para no tapar el mapa con un círculo
                // gigante si 2000 sensores caen en la misma celda a zoom
                // bajo). Todo dibujado en canvas -- circleMarker, no DOM.
                const radius = Math.min(11 + Math.log2(item.count) * 3, 26);
                L.circleMarker([item.lat, item.lng], {
                    radius,
                    pane: 'ops-markers',
                    color: '#fff',
                    weight: 2,
                    fillColor: '#0ea5e9',
                    fillOpacity: 0.85,
                } as any)
                    .bindTooltip(`${item.count} activos`, { direction: 'center', permanent: false })
                    .bindPopup(
                        `<div style="padding:4px 2px">
                            <div style="font-weight:700;font-size:12px">${item.count} activos agrupados</div>
                            <div style="font-size:10px;color:#64748b;margin-top:2px">Acercar el zoom para ver el detalle individual</div>
                        </div>`
                    )
                    .addTo(markerLayerRef.current);
                return;
            }

            const m = (item as ClusterableMarker & { raw: any }).raw;
            const lat = item.lat;
            const lng = item.lng;
            const color = markerColor(m);
            L.circleMarker([lat, lng], {
                radius: 7,
                pane: 'ops-markers',
                color: '#fff',
                weight: 2,
                fillColor: color,
                fillOpacity: 0.95,
            } as any)
                .bindPopup(
                    `<div style="padding:4px 2px">
                        <div style="font-weight:700;font-size:12px">${m.name || 'Marcador'}</div>
                        <div style="font-size:11px;color:#475569;text-transform:capitalize">${m.type || 'sensor'} · ${m.status || 'n/a'}</div>
                        <div style="font-size:10px;color:#64748b;margin-top:2px">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                    </div>`
                )
                .addTo(markerLayerRef.current);
        });

        // Rutas de acarreo: une equipos visibles para visualizar flujo operacional.
        if (showHaulRoutes && equipmentPoints.length >= 2) {
            L.polyline(equipmentPoints, {
                color: '#f97316',
                weight: 4,
                opacity: 0.78,
                dashArray: '10 8',
                pane: 'ops-targets',
            } as any)
                .bindTooltip('Ruta de acarreo', { sticky: true })
                .addTo(haulRouteLayerRef.current);
        }

        // Zonas de perforación: polígonos alrededor de sensores/alertas como área técnica.
        if (showDrillZones) {
            const source = warningPoints.length ? warningPoints : sensorPoints;
            source.slice(0, 8).forEach(([lat, lng], idx) => {
                const ring: [number, number][] = [
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
                } as any)
                    .bindTooltip(`Zona perforación ${idx + 1}`, { sticky: true })
                    .addTo(drillingLayerRef.current);
            });
        }
    }, [visibleMarkers, showTargets, showHaulRoutes, showDrillZones, mapZoom]);

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
            } as any)
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

            <MapConnectivityBadge />

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

                {offlineSnapshotAge ? (
                    <div
                        className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-semibold text-amber-200"
                        title="Datos de marcadores servidos desde caché local (IndexedDB) por falta de conectividad"
                    >
                        Datos de marcadores: última actualización {offlineSnapshotAge}
                    </div>
                ) : null}
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
                    {([
                        ['Equipos', showEquipment, setShowEquipment],
                        ['Personal', showPersonnel, setShowPersonnel],
                        ['Sensores', showSensors, setShowSensors],
                        ['Solo alertas', showWarningsOnly, setShowWarningsOnly],
                        ['Geocercas', showGeofences, setShowGeofences],
                        ['Zonas oficiales (GeoJSON)', showOfficialGeo, setShowOfficialGeo],
                        ['Targets geológicos', showTargets, setShowTargets],
                        ['Rutas acarreo', showHaulRoutes, setShowHaulRoutes],
                        ['Zonas perforación', showDrillZones, setShowDrillZones],
                    ] as [string, boolean, React.Dispatch<React.SetStateAction<boolean>>][]).map(([label, value, setter]) => (
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
                            {WMS_CATALOG_DATA.regions.map((region: any) => (
                                <optgroup key={region.id} label={region.label}>
                                    {region.sources.map((s: any) => (
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
                    catalogRegionLabel={catalogMeta.regionLabel || undefined}
                    catalogSourceName={catalogMeta.sourceName || undefined}
                    docUrl={catalogMeta.docUrl || undefined}
                    geoCompliance={geoCompliance}
                    geoComplianceLoading={geoComplianceLoading}
                    geoComplianceError={geoComplianceError || undefined}
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

export default memo(MapViewer);
