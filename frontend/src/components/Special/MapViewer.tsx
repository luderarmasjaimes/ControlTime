import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, RefreshCw, LocateFixed, Filter, Mountain, ShieldAlert, Route, Drill, Globe2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus, Home, Compass } from 'lucide-react';
import WMS_CATALOG from '../../config/wmsCorporateCatalog.json';
import TerritorialCompliancePanel from './TerritorialCompliancePanel';
import MapConnectivityBadge from './MapConnectivityBadge';
import { useConnectivity } from '../../lib/connectivityMonitor';
import { clusterMarkers, isCluster, type ClusterableMarker } from '../../lib/mapClustering';
import { planForConnectivity, isCompactPayload, decodeCompactMarkers } from '../../lib/mapFieldMode';
import { saveMarkerSnapshot, loadMarkerSnapshot, formatSnapshotAge } from '../../lib/mapOfflineCache';
import { createTimeoutWmsLayer } from '../../lib/timeoutWmsLayer';
import { authHeaders as sharedAuthHeaders } from '../../auth/authStorage';
import { fetchCompanyLocation } from '../../auth/authApi';
import {
    applyMarkerDiff,
    boundsToQuery,
    markerIdentity,
    markerIsInsideBounds,
    padBounds,
    type MapBoundsLike,
} from '../../lib/mapMarkerState';

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

// ADR-121: usado SOLO como fallback cuando la empresa/tenant logueado
// todavía no tiene coordenadas registradas (ver fetchCompanyLocation más
// abajo) -- antes era el centro fijo de Mapas para TODAS las empresas.
const FALLBACK_VIEW = { lat: -17.2464, lng: -70.612, zoom: 13 };

const BASEMAPS: Record<string, { label: string; url: string; attribution: string; maxNativeZoom?: number; subdomains?: string }> = {
    satellite: {
        label: 'Satelital',
        url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        attribution: '© Google Satellite',
        subdomains: '0123',
    },
    hybrid: {
        label: 'Híbrido',
        url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        attribution: '© Google Hybrid',
        subdomains: '0123',
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

type RenderedLayerCache = Map<string, { signature: string; layer: any }>;
type DesiredLayer = { signature: string; create: () => any };

/** Conserva las capas Leaflet que no cambiaron y reemplaza solo el delta. */
const syncLeafletLayers = (group: any, cache: RenderedLayerCache, desired: Map<string, DesiredLayer>) => {
    cache.forEach((entry, key) => {
        const next = desired.get(key);
        if (!next || next.signature !== entry.signature) {
            group.removeLayer(entry.layer);
            cache.delete(key);
        }
    });
    desired.forEach((next, key) => {
        if (cache.has(key)) return;
        const layer = next.create();
        layer.addTo(group);
        cache.set(key, { signature: next.signature, layer });
    });
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
    // ADR-121: destino del botón "Home" -- arranca en el fallback y se
    // actualiza una vez a la ubicación real de la empresa (si existe), sin
    // esperar la red para poder crear el mapa (ver useEffect de abajo).
    const homeViewRef = useRef({ lat: FALLBACK_VIEW.lat, lng: FALLBACK_VIEW.lng, zoom: FALLBACK_VIEW.zoom });
    const baseLayerRef = useRef<any>(null);
    const markerLayerRef = useRef<any>(null);
    const warningLayerRef = useRef<any>(null);
    const geofenceLayerRef = useRef<any>(null);
    const targetLayerRef = useRef<any>(null);
    const haulRouteLayerRef = useRef<any>(null);
    const drillingLayerRef = useRef<any>(null);
    const externalWmsLayerRef = useRef<any>(null);
    const officialGeoLayerRef = useRef<any>(null);
    const markerFetchAbortRef = useRef<AbortController | null>(null);
    const acceptedBoundsRef = useRef<MapBoundsLike | null>(null);
    const viewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const renderedMarkerLayersRef = useRef(new Map<string, { signature: string; layer: any }>());
    const renderedWarningLayersRef = useRef(new Map<string, { signature: string; layer: any }>());
    const renderedTargetLayersRef = useRef(new Map<string, { signature: string; layer: any }>());
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
    const [mapZoom, setMapZoom] = useState(FALLBACK_VIEW.zoom);
    const [viewportBounds, setViewportBounds] = useState<MapBoundsLike | null>(null);
    const [viewportRevision, setViewportRevision] = useState(0);
    // Lectura en vivo de centro/zoom para el widget de navegación -- se
    // actualiza en cada frame de 'move'/'zoom' (no solo 'moveend'), separada
    // de mapZoom/viewportBounds a propósito: esos dos disparan reclustering
    // y refetch de marcadores, algo que sí debe ir debounced a moveend por
    // costo, mientras que el indicador de posición debe sentirse inmediato.
    const [liveCenter, setLiveCenter] = useState({ lat: FALLBACK_VIEW.lat, lng: FALLBACK_VIEW.lng });
    const [liveZoom, setLiveZoom] = useState(FALLBACK_VIEW.zoom);
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
            // El control nativo de Leaflet se dibuja dentro del propio div del
            // mapa (stacking context z-0), por lo que quedaba tapado por el
            // panel de estadísticas superior izquierdo (z-20, hermano en el
            // DOM). Se reemplaza por el widget de navegación propio (D-pad +
            // zoom, abajo a la izquierda) con el mismo lenguaje visual del
            // resto de paneles flotantes.
            zoomControl: false,
            preferCanvas: true,
        } as any).setView([FALLBACK_VIEW.lat, FALLBACK_VIEW.lng], FALLBACK_VIEW.zoom);
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

        markerLayerRef.current = L.layerGroup().addTo(map);
        warningLayerRef.current = L.layerGroup().addTo(map);
        geofenceLayerRef.current = L.layerGroup().addTo(map);
        targetLayerRef.current = L.layerGroup().addTo(map);
        haulRouteLayerRef.current = L.layerGroup().addTo(map);
        drillingLayerRef.current = L.layerGroup().addTo(map);

        const onResize = () => map.invalidateSize({ pan: false });
        window.addEventListener('resize', onResize);

        // El host cambia de tamaño sin que cambie window (menú superior,
        // Suspense, panel de cumplimiento y transiciones flex). Sin observar
        // el DIV, Leaflet conserva el tamaño anterior y solo solicita tiles
        // para un rectángulo pequeño: exactamente los grandes huecos grises
        // observados en producción.
        let resizeFrame: number | null = null;
        let lastWidth = 0;
        let lastHeight = 0;
        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver((entries) => {
                const rect = entries[0]?.contentRect;
                if (!rect || (Math.abs(rect.width - lastWidth) < 1 && Math.abs(rect.height - lastHeight) < 1)) return;
                lastWidth = rect.width;
                lastHeight = rect.height;
                if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
                resizeFrame = requestAnimationFrame(() => {
                    resizeFrame = null;
                    if (mapRef.current === map) map.invalidateSize({ pan: false, debounceMoveend: true });
                });
            })
            : null;
        if (mapContainerRef.current) resizeObserver?.observe(mapContainerRef.current);

        // El tamaño de celda del clustering depende del zoom actual (ver
        // mapClustering.ts) -- sin esto, acercar/alejar el mapa no
        // reagruparía los marcadores.
        const onViewportChanged = () => {
            setMapZoom(map.getZoom());
            const bounds = map.getBounds();
            setViewportBounds({
                south: bounds.getSouth(), west: bounds.getWest(),
                north: bounds.getNorth(), east: bounds.getEast(),
            });
            if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
            viewportDebounceRef.current = setTimeout(() => setViewportRevision((value) => value + 1), 250);
        };
        onViewportChanged();
        map.on('moveend', onViewportChanged);

        // Lectura de posición en tiempo real: 'move' y 'zoom' se disparan en
        // cada frame durante el arrastre/animación (a diferencia de
        // 'moveend'/'zoomend', que solo disparan al soltar), así el widget de
        // navegación refleja el movimiento mientras ocurre, no al finalizar.
        const onLiveViewChange = () => {
            const center = map.getCenter();
            setLiveCenter({ lat: center.lat, lng: center.lng });
            setLiveZoom(map.getZoom());
        };
        onLiveViewChange();
        map.on('move', onLiveViewChange);
        map.on('zoom', onLiveViewChange);

        return () => {
            window.removeEventListener('resize', onResize);
            resizeObserver?.disconnect();
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
            map.off('moveend', onViewportChanged);
            map.off('move', onLiveViewChange);
            map.off('zoom', onLiveViewChange);
            if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
            markerFetchAbortRef.current?.abort();
            renderedMarkerLayersRef.current.clear();
            renderedWarningLayersRef.current.clear();
            renderedTargetLayersRef.current.clear();
            officialGeoLayerRef.current = null;
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // ADR-121: recentra el mapa (y el destino del botón "Home") a la mina de
    // la empresa/tenant logueado, una sola vez al montar -- separado del
    // efecto de creación del mapa para no bloquearlo con una espera de red.
    // Si la empresa aún no tiene coordenadas registradas, o el fetch falla,
    // se queda en FALLBACK_VIEW en silencio -- cero regresión.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const loc = await fetchCompanyLocation();
                if (cancelled || !loc.has_location || loc.latitude == null || loc.longitude == null) return;
                const zoom = loc.zoom ?? FALLBACK_VIEW.zoom;
                homeViewRef.current = { lat: loc.latitude, lng: loc.longitude, zoom };
                if (mapRef.current) {
                    mapRef.current.setView([loc.latitude, loc.longitude], zoom, { animate: false });
                    setMapZoom(zoom);
                    setLiveCenter({ lat: loc.latitude, lng: loc.longitude });
                    setLiveZoom(zoom);
                }
            } catch (err) {
                log.error('company-location', err);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        rebuildOfficialGeoLayer();
    }, [rebuildOfficialGeoLayer]);

    useEffect(() => {
        refreshGeoCompliance();
    }, [refreshGeoCompliance]);

    useEffect(() => {
        if (!mapRef.current) return;
        const cfg = BASEMAPS[baseMap] || BASEMAPS.satellite;
        if (baseLayerRef.current) mapRef.current.removeLayer(baseLayerRef.current);
        baseLayerRef.current = L.tileLayer(cfg.url, {
            maxZoom: 22,
            maxNativeZoom: cfg.maxNativeZoom,
            attribution: cfg.attribution,
            // OJO: NO pasar `subdomains: cfg.subdomains` directo -- BASEMAPS.terrain
            // no define `subdomains`, así que cfg.subdomains es `undefined`, y
            // pasar esa clave con valor `undefined` en el objeto de opciones
            // SOBRESCRIBE el default interno de Leaflet ('abc') con `undefined`
            // (L.extend copia la clave sin importar su valor). El resultado:
            // _getSubdomain() hace `this.options.subdomains.length` sobre
            // `undefined` y lanza una excepción síncrona durante `addTo()` --
            // sin ErrorBoundary en la app, esto desmontaba TODA la plataforma
            // con cada clic en "Terreno". Solo se incluye la clave si el
            // basemap la define; si no, Leaflet aplica su default ('abc'),
            // que es justamente el correcto para OpenTopoMap.
            ...(cfg.subdomains ? { subdomains: cfg.subdomains } : {}),
            updateWhenZooming: false,
            // Paneo: solicitar progresivamente (cada updateInterval), pero
            // conservar cuatro anillos de tiles para que nunca aparezca el
            // fondo gris mientras llega la siguiente columna/fila.
            updateWhenIdle: false,
            updateInterval: 250,
            keepBuffer: 4,
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
            const proxyUrl = new URL('/api/map/wms-proxy', window.location.origin);
            proxyUrl.searchParams.set('source', url);
            const layer = createTimeoutWmsLayer(proxyUrl.pathname + proxyUrl.search, {
                layers,
                format: 'image/png',
                transparent: true,
                version,
                opacity: wmsOpacity / 100,
                tileSize: 512,
                updateWhenZooming: false,
                updateWhenIdle: true,
                keepBuffer: 1,
                maxAttempts: 1,
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
            markerFetchAbortRef.current?.abort();
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

        markerFetchAbortRef.current?.abort();
        const controller = new AbortController();
        markerFetchAbortRef.current = controller;
        setLoading(true);
        try {
            // Todas las consultas quedan acotadas al viewport más un margen.
            // El margen evita refetch en paneos cortos; nunca se recorta el
            // viewport visible, que era la causa de marcadores ausentes.
            const plan = planForConnectivity(connectivity.state);
            const apiUrl = new URL('/api/map/markers', window.location.origin);
            if (plan.requestCompact) apiUrl.searchParams.set('compact', '1');
            apiUrl.searchParams.set('limit', String(plan.limit));
            if (mapRef.current) {
                const b = mapRef.current.getBounds();
                const accepted = padBounds({
                    south: b.getSouth(), west: b.getWest(),
                    north: b.getNorth(), east: b.getEast(),
                }, plan.bboxPaddingRatio);
                acceptedBoundsRef.current = accepted;
                const query = boundsToQuery(accepted);
                apiUrl.searchParams.set('bbox_lat', query.bboxLat);
                apiUrl.searchParams.set('bbox_lng', query.bboxLng);
            }
            const res = await fetch(apiUrl.toString(), { headers: authHeaders(), signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const markers = isCompactPayload(data)
                ? decodeCompactMarkers(data)
                : Array.isArray(data?.markers) ? data.markers : [];
            if (!controller.signal.aborted) setAllMarkers(markers);
            // Guarda el snapshot exitoso para la próxima vez que se pierda
            // la conectividad por completo (best-effort, no bloquea el
            // render si IndexedDB falla por cualquier motivo).
            void saveMarkerSnapshot(markers);
        } catch (err) {
            if ((err as any)?.name === 'AbortError') return;
            log.error('Error loading map markers', err);
            setAllMarkers([]);
        } finally {
            if (markerFetchAbortRef.current === controller) {
                markerFetchAbortRef.current = null;
                setLoading(false);
            }
        }
    }, [connectivity.state]);

    useEffect(() => {
        fetchMarkers();
    }, [fetchMarkers, viewportRevision]);

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

    // El backend publica diffs por tenant. Se aplican por identidad y solo si
    // el punto pertenece al bbox aceptado, evitando descargar y reconciliar
    // nuevamente miles de marcadores en cada actualización.
    useEffect(() => {
        if (typeof process !== 'undefined' && (process as any).env?.VITEST) return;
        if (connectivity.state === 'OFFLINE') return;
        let disposed = false;
        let socket: WebSocket | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let backoffMs = 1000;

        const connect = () => {
            if (disposed) return;
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
            socket.onopen = () => { backoffMs = 1000; };
            socket.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload?.channel !== 'map_markers_diff') return;
                    setAllMarkers((current) => applyMarkerDiff(current, payload, acceptedBoundsRef.current));
                } catch (_) {
                    // Otros canales o frames no JSON comparten este socket.
                }
            };
            socket.onerror = () => { try { socket?.close(); } catch (_) {} };
            socket.onclose = () => {
                if (disposed) return;
                retryTimer = setTimeout(connect, backoffMs);
                backoffMs = Math.min(backoffMs * 2, 30000);
            };
        };
        connect();
        return () => {
            disposed = true;
            if (retryTimer) clearTimeout(retryTimer);
            try { socket?.close(); } catch (_) {}
        };
    }, [connectivity.state]);

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
            if (viewportBounds && !markerIsInsideBounds(m, viewportBounds)) return false;
            return true;
        });
    }, [allMarkers, showEquipment, showPersonnel, showSensors, showWarningsOnly, timeWindow, viewportBounds]);

    useEffect(() => {
        if (!mapRef.current || !markerLayerRef.current) return;
        haulRouteLayerRef.current.clearLayers();
        drillingLayerRef.current.clearLayers();

        const equipmentPoints: [number, number][] = [];
        const warningPoints: [number, number][] = [];
        const sensorPoints: [number, number][] = [];
        const desiredMarkers = new Map<string, DesiredLayer>();
        const desiredWarnings = new Map<string, DesiredLayer>();
        const desiredTargets = new Map<string, DesiredLayer>();

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
                const key = `warning:${markerIdentity(m)}`;
                desiredWarnings.set(key, {
                    signature: `${lat}:${lng}`,
                    create: () => L.circle([lat, lng], {
                        radius: 90, color: '#f59e0b', weight: 2,
                        fillColor: '#f59e0b', fillOpacity: 0.12, pane: 'ops-warning',
                    } as any),
                });
            }

            if (showTargets && (m.type === 'sensor' || String(m.status || '').toLowerCase() === 'warning')) {
                const key = `target:${markerIdentity(m)}`;
                desiredTargets.set(key, {
                    signature: `${lat}:${lng}`,
                    create: () => L.circle([lat, lng], {
                        radius: 180, color: '#38bdf8', weight: 1,
                        dashArray: '4 6', fillOpacity: 0, pane: 'ops-targets',
                    } as any),
                });
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
                const memberIds = item.members.map((member) => String(member.id)).sort().join(',');
                const key = `cluster:${memberIds}`;
                desiredMarkers.set(key, {
                    signature: `${item.lat}:${item.lng}:${item.count}:${mapZoom}`,
                    create: () => L.circleMarker([item.lat, item.lng], {
                        radius, pane: 'ops-markers', color: '#fff', weight: 2,
                        fillColor: '#0ea5e9', fillOpacity: 0.85,
                    } as any)
                        .bindTooltip(`${item.count} activos`, { direction: 'center', permanent: false })
                        .bindPopup(
                            `<div style="padding:4px 2px">
                                <div style="font-weight:700;font-size:12px">${item.count} activos agrupados</div>
                                <div style="font-size:10px;color:#64748b;margin-top:2px">Acercar el zoom para ver el detalle individual</div>
                            </div>`
                        ),
                });
                return;
            }

            const m = (item as ClusterableMarker & { raw: any }).raw;
            const lat = item.lat;
            const lng = item.lng;
            const color = markerColor(m);
            const key = `marker:${markerIdentity(m)}`;
            desiredMarkers.set(key, {
                signature: `${lat}:${lng}:${color}:${m.name || ''}:${m.type || ''}:${m.status || ''}`,
                create: () => L.circleMarker([lat, lng], {
                    radius: 7, pane: 'ops-markers', color: '#fff', weight: 2,
                    fillColor: color, fillOpacity: 0.95,
                } as any).bindPopup(
                    `<div style="padding:4px 2px">
                        <div style="font-weight:700;font-size:12px">${m.name || 'Marcador'}</div>
                        <div style="font-size:11px;color:#475569;text-transform:capitalize">${m.type || 'sensor'} · ${m.status || 'n/a'}</div>
                        <div style="font-size:10px;color:#64748b;margin-top:2px">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                    </div>`
                ),
            });
        });

        syncLeafletLayers(markerLayerRef.current, renderedMarkerLayersRef.current, desiredMarkers);
        syncLeafletLayers(warningLayerRef.current, renderedWarningLayersRef.current, desiredWarnings);
        syncLeafletLayers(targetLayerRef.current, renderedTargetLayersRef.current, desiredTargets);

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

    // Desplazamiento en píxeles de pantalla (no en grados lat/lng): a mayor
    // zoom el mismo salto de 130px cubre menos terreno real, dando siempre
    // una sensación de "paso" consistente sin importar el nivel de zoom.
    const PAN_STEP_PX = 130;
    const panMap = (dx: number, dy: number) => {
        mapRef.current?.panBy([dx, dy], { animate: true });
    };
    const zoomInMap = () => mapRef.current?.zoomIn();
    const zoomOutMap = () => mapRef.current?.zoomOut();
    const resetView = () => {
        const v = homeViewRef.current;
        mapRef.current?.setView([v.lat, v.lng], v.zoom, { animate: true });
    };

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
            {/*
             * position/inset/zIndex van inline (no como clases Tailwind) a
             * propósito: index.html carga Tailwind vía CDN (script async que
             * inyecta su stylesheet en runtime). L.map() lee
             * getComputedStyle(el).position de forma SÍNCRONA en el montaje
             * -- si ese script todavía no inyectó ".absolute", Leaflet ve
             * "static" y fija inline `position: relative` en el contenedor
             * (comportamiento propio de Leaflet para poder posicionar sus
             * panes). Un inline style siempre gana sobre una regla de clase
             * sin importar el orden de carga, así que si eso ocurre, la
             * clase `absolute` de Tailwind queda inutilizada para siempre y
             * el mapa colapsa a height:0 (clippeado por overflow-hidden del
             * contenedor padre) -- incluyendo cualquier control de Leaflet
             * dentro, que se vuelve invisible. Con el estilo inline aplicado
             * por React de forma síncrona, Leaflet ve "absolute" desde el
             * primer instante y no lo toca.
             */}
            <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

            <MapConnectivityBadge />

            <div
                className="absolute left-3 top-3 z-20 w-[min(92vw,360px)] rounded-xl border border-white/10 bg-slate-950/85 p-3 text-slate-100 shadow-2xl backdrop-blur-md"
                style={{ fontFamily: 'var(--font-mining-ui)' }}
            >
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <h3
                            className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide"
                            style={{ fontFamily: 'var(--font-mining-display)' }}
                        >
                            <Layers size={16} className="shrink-0 text-sky-400" />
                            <span className="truncate">{mapTitle}</span>
                        </h3>
                        {geoportalModuleLabel ? (
                            <p
                                className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-cyan-300/90"
                                style={{ fontFamily: 'var(--font-mining-ui)' }}
                            >
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

                <div className="grid grid-cols-3 gap-2 text-[11px]" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/75 px-2 py-1.5">
                        <div className="text-slate-400">Activos</div>
                        <div className="text-base font-bold" style={{ fontFamily: 'var(--font-mining-display)' }}>{totals.total}</div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/75 px-2 py-1.5">
                        <div className="text-slate-400">En línea</div>
                        <div className="text-base font-bold text-emerald-400" style={{ fontFamily: 'var(--font-mining-display)' }}>{totals.online}</div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/75 px-2 py-1.5">
                        <div className="text-slate-400">Alertas</div>
                        <div className="text-base font-bold text-amber-400" style={{ fontFamily: 'var(--font-mining-display)' }}>{totals.warning}</div>
                    </div>
                </div>

                {offlineSnapshotAge ? (
                    <div
                        className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-semibold text-amber-200"
                        style={{ fontFamily: 'var(--font-mining-ui)' }}
                        title="Datos de marcadores servidos desde caché local (IndexedDB) por falta de conectividad"
                    >
                        Datos de marcadores: última actualización {offlineSnapshotAge}
                    </div>
                ) : null}
            </div>

            <div
                className="absolute right-3 top-3 z-20 w-[min(86vw,300px)] rounded-xl border border-white/10 bg-slate-950/85 p-3 text-slate-100 shadow-2xl backdrop-blur-md"
                style={{ fontFamily: 'var(--font-mining-ui)' }}
            >
                <div
                    className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-300"
                    style={{ fontFamily: 'var(--font-mining-display)', letterSpacing: '0.04em' }}
                >
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
                            style={{ fontFamily: 'var(--font-mining-ui)' }}
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
                            style={{ fontFamily: 'var(--font-mining-ui)' }}
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
                            style={{ fontFamily: 'var(--font-mining-ui)' }}
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

            {/* Widget de navegación: paneo direccional + zoom + posición en vivo.
                Ocupa la esquina inferior izquierda, la única sin ocupar por
                otros paneles flotantes. */}
            <div className="absolute bottom-3 left-3 z-20 flex items-end gap-2">
                <div
                    className="rounded-xl border border-white/10 bg-slate-950/88 px-3 py-2 text-slate-100 shadow-2xl backdrop-blur-md"
                    style={{ fontFamily: 'var(--font-mining-ui)' }}
                >
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        <Compass size={12} className="text-cyan-400" />
                        Posición
                    </div>
                    <div
                        className="mt-1 whitespace-nowrap tabular-nums text-xs font-bold text-slate-100"
                        style={{ fontFamily: 'var(--font-mining-display)' }}
                    >
                        {liveCenter.lat.toFixed(5)}, {liveCenter.lng.toFixed(5)}
                    </div>
                    <div className="text-[10px] text-slate-400">Zoom {liveZoom.toFixed(1)}</div>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-950/88 p-2 shadow-2xl backdrop-blur-md">
                    <div className="grid w-[108px] grid-cols-3 grid-rows-3 gap-1">
                        <span />
                        <button
                            type="button"
                            onClick={() => panMap(0, -PAN_STEP_PX)}
                            title="Desplazar arriba"
                            className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-200 transition-colors hover:border-cyan-400/60 hover:bg-slate-800"
                        >
                            <ChevronUp size={14} />
                        </button>
                        <span />
                        <button
                            type="button"
                            onClick={() => panMap(-PAN_STEP_PX, 0)}
                            title="Desplazar izquierda"
                            className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-200 transition-colors hover:border-cyan-400/60 hover:bg-slate-800"
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={resetView}
                            title="Vista inicial"
                            className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-200 transition-colors hover:border-cyan-400/60 hover:bg-slate-800"
                        >
                            <Home size={13} />
                        </button>
                        <button
                            type="button"
                            onClick={() => panMap(PAN_STEP_PX, 0)}
                            title="Desplazar derecha"
                            className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-200 transition-colors hover:border-cyan-400/60 hover:bg-slate-800"
                        >
                            <ChevronRight size={14} />
                        </button>
                        <span />
                        <button
                            type="button"
                            onClick={() => panMap(0, PAN_STEP_PX)}
                            title="Desplazar abajo"
                            className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-200 transition-colors hover:border-cyan-400/60 hover:bg-slate-800"
                        >
                            <ChevronDown size={14} />
                        </button>
                        <span />
                    </div>
                    <div className="mt-1.5 flex items-center justify-center gap-1">
                        <button
                            type="button"
                            onClick={zoomOutMap}
                            title="Alejar zoom"
                            className="flex flex-1 items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-200 transition-colors hover:border-cyan-400/60 hover:bg-slate-800"
                        >
                            <Minus size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={zoomInMap}
                            title="Acercar zoom"
                            className="flex flex-1 items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-200 transition-colors hover:border-cyan-400/60 hover:bg-slate-800"
                        >
                            <Plus size={14} />
                        </button>
                    </div>
                </div>
            </div>

            <div
                // El panel "Capas Técnicas" (derecha, right-3) mide 300px de ancho
                // y ocupa toda la columna derecha de arriba a abajo (ver más
                // arriba, ~top-3 a bottom-3). Con right-3 este panel quedaba
                // exactamente debajo/encima de aquel (mismo x932-1252), tapándolo.
                // right-[340px] lo desplaza a la izquierda lo suficiente para
                // despejar esa columna con margen visible.
                className="absolute bottom-24 right-[340px] z-20 w-[min(92vw,320px)] rounded-xl border border-white/10 bg-slate-950/88 p-3 text-slate-100 shadow-2xl backdrop-blur-md"
                style={{ fontFamily: 'var(--font-mining-ui)' }}
            >
                <div
                    className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-200"
                    style={{ fontFamily: 'var(--font-mining-display)', letterSpacing: '0.04em' }}
                >
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

            <div
                className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/88 p-2.5 shadow-2xl backdrop-blur-md"
                style={{ fontFamily: 'var(--font-mining-ui)' }}
            >
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
