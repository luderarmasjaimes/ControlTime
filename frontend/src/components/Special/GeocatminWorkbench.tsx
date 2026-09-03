import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Globe2,
  HelpCircle,
  Info,
  Layers,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Navigation,
  RefreshCw,
  Ruler,
  Search,
  Shield,
  Sliders,
  Sparkles,
  TreePine,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { log } from '../../lib/logger';
import { getSession } from '../../auth/authStorage';
import { fetchCompanyLocation } from '../../auth/authApi';
import { getMiningLocation, MINING_LOCATIONS } from '../../config/miningLocations';
import {
  GEOCATMIN_CATEGORIES,
  GEOCATMIN_LAYERS,
  GEOCATMIN_OFFICIAL_DOWNLOADS,
  type GeocatminLayer,
} from '../../config/geocatminCatalog';
import {
  convertUtmToWgs84,
  convertWgs84ToUtm,
  evaluateSpatialOverlap,
  identifyPoint,
  queryIngemmetConcessions,
  type ConcessionFeature,
  type IdentifyResult,
  type OverlapEvaluation,
} from '../../lib/geocatminService';

interface GeocatminWorkbenchProps {
  initialCompanyName?: string;
  onCaptureComplete?: (imageDataUrl: string) => void;
}

const FALLBACK_SITE = { lat: -9.549, lng: -77.054, zoom: 14, name: 'Antamina' }; // Ancash

function GeocatminWorkbench({ initialCompanyName, onCaptureComplete }: GeocatminWorkbenchProps) {
  const session = useMemo(() => getSession(), []);
  const activeCompanyName = initialCompanyName || session?.company || 'Compañía Minera Antamina';

  // Map state
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const layerGroupsRef = useRef<Map<string, any>>(new Map());
  const polygonHighlightGroupRef = useRef<any>(null);
  const measureGroupRef = useRef<any>(null);
  const bufferGroupRef = useRef<any>(null);

  const [currentCenter, setCurrentCenter] = useState<{ lat: number; lng: number; zoom: number }>({
    lat: FALLBACK_SITE.lat,
    lng: FALLBACK_SITE.lng,
    zoom: FALLBACK_SITE.zoom,
  });
  const [resolvedSiteName, setResolvedSiteName] = useState<string>(activeCompanyName);
  const [utmInfo, setUtmInfo] = useState<{ easting: number; northing: number; zone: number }>(() =>
    convertWgs84ToUtm(FALLBACK_SITE.lat, FALLBACK_SITE.lng)
  );

  // Active UI tabs and drawers
  const [activeCategory, setActiveCategory] = useState<string>('catastro');
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const l of GEOCATMIN_LAYERS) {
      init[l.id] = l.defaultVisible;
    }
    return init;
  });
  const [layerOpacity, setLayerOpacity] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const l of GEOCATMIN_LAYERS) {
      init[l.id] = l.opacity;
    }
    return init;
  });

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTool, setActiveTool] = useState<
    'inspect' | 'measure' | 'buffer' | 'overlap' | 'convert' | 'downloads' | 'search' | null
  >('search');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ConcessionFeature[]>([]);
  const [selectedConcession, setSelectedConcession] = useState<ConcessionFeature | null>(null);

  // Inspection / Identify state
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectResults, setInspectResults] = useState<IdentifyResult[]>([]);
  const [inspectPoint, setInspectPoint] = useState<{ lat: number; lng: number } | null>(null);

  // Overlap Pre-Evaluation state
  const [overlapData, setOverlapData] = useState<OverlapEvaluation | null>(null);
  const [overlapLoading, setOverlapLoading] = useState(false);
  const [bufferRadiusKm, setBufferRadiusKm] = useState<number>(2.0);

  // Measure state
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const [measureDistanceKm, setMeasureDistanceKm] = useState<number>(0);

  // Coordinate converter input state
  const [coordMode, setCoordMode] = useState<'geoToUtm' | 'utmToGeo'>('geoToUtm');
  const [convLat, setConvLat] = useState<string>('');
  const [convLng, setConvLng] = useState<string>('');
  const [convEast, setConvEast] = useState<string>('');
  const [convNorth, setConvNorth] = useState<string>('');
  const [convZone, setConvZone] = useState<number>(18);
  const [convResult, setConvResult] = useState<string | null>(null);

  // Dual-mode state (Native vs Official Web)
  const [viewMode, setViewMode] = useState<'native' | 'officialWeb'>('native');

  // Base map style
  const [baseMapType, setBaseMapType] = useState<'satellite' | 'terrain' | 'topo'>('satellite');

  // 1. Resolve Mining Location on Mount
  useEffect(() => {
    let isCancelled = false;

    async function resolveLocation() {
      // 1. Try company location from backend (ADR-121)
      try {
        const remote = await fetchCompanyLocation();
        if (!isCancelled && remote && remote.latitude && remote.longitude) {
          const target = {
            lat: remote.latitude,
            lng: remote.longitude,
            zoom: remote.zoom || 14,
          };
          setCurrentCenter(target);
          setResolvedSiteName(activeCompanyName);
          setUtmInfo(convertWgs84ToUtm(target.lat, target.lng));
          if (mapInstanceRef.current) {
            mapInstanceRef.current.setView([target.lat, target.lng], target.zoom);
          }
          return;
        }
      } catch (err) {
        log.warn('[GeocatminWorkbench] Remote company location fetch failed, using fallback.', err);
      }

      // 2. Try static mining location dictionary
      const local = getMiningLocation(activeCompanyName);
      if (!isCancelled && local) {
        const target = { lat: local.lat, lng: local.lng, zoom: local.zoom };
        setCurrentCenter(target);
        setResolvedSiteName(activeCompanyName);
        setUtmInfo(convertWgs84ToUtm(target.lat, target.lng));
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([target.lat, target.lng], target.zoom);
        }
      }
    }

    resolveLocation();
    return () => {
      isCancelled = true;
    };
  }, [activeCompanyName]);

  // 2. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [currentCenter.lat, currentCenter.lng],
      zoom: currentCenter.zoom,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    });

    mapInstanceRef.current = map;

    // Groups for overlays
    polygonHighlightGroupRef.current = L.layerGroup().addTo(map);
    measureGroupRef.current = L.layerGroup().addTo(map);
    bufferGroupRef.current = L.layerGroup().addTo(map);

    // Initial Mine Marker
    const mineIcon = L.divIcon({
      className: 'custom-mine-pin',
      html: `<div style="background: #0ea5e9; border: 2px solid #ffffff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 15px rgba(14,165,233,0.8);"><div style="background: #ffffff; width: 8px; height: 8px; border-radius: 50%;"></div></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    const mineMarker = L.marker([currentCenter.lat, currentCenter.lng], { icon: mineIcon })
      .bindPopup(
        `<div style="font-family: sans-serif; font-size: 12px; color: #0f172a; padding: 4px;">
          <strong style="font-size: 13px; color: #0284c7;">📍 ${resolvedSiteName}</strong><br/>
          <span>Lat: ${currentCenter.lat.toFixed(5)}, Lng: ${currentCenter.lng.toFixed(5)}</span><br/>
          <span style="font-size: 11px; color: #64748b;">Unidad Minera Activa</span>
        </div>`
      )
      .addTo(map);

    mineMarker.openPopup();

    // Map Click Handler for Inspection / Measurement
    map.on('click', async (e: any) => {
      const { lat, lng } = e.latlng;
      setInspectPoint({ lat, lng });

      if (activeTool === 'inspect') {
        setInspectLoading(true);
        try {
          const res = await identifyPoint(lat, lng);
          setInspectResults(res);
        } catch (err) {
          log.warn('[GeocatminWorkbench] Identify failed:', err);
        } finally {
          setInspectLoading(false);
        }
      } else if (activeTool === 'measure') {
        setMeasurePoints((prev) => {
          const next = [...prev, [lat, lng] as [number, number]];
          if (next.length > 1) {
            let total = 0;
            for (let i = 1; i < next.length; i++) {
              const p1 = L.latLng(next[i - 1][0], next[i - 1][1]);
              const p2 = L.latLng(next[i][0], next[i][1]);
              total += p1.distanceTo(p2) / 1000;
            }
            setMeasureDistanceKm(Math.round(total * 1000) / 1000);
          }
          return next;
        });
      }
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      setCurrentCenter({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
      setUtmInfo(convertWgs84ToUtm(c.lat, c.lng));
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 3. Base Map Switcher Effect
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove existing base layer if any
    const existingBase = (map as any)._baseLayer;
    if (existingBase) {
      map.removeLayer(existingBase);
    }

    let tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    let maxZoom = 19;

    if (baseMapType === 'terrain') {
      tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}';
      maxZoom = 13;
    } else if (baseMapType === 'topo') {
      tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
      maxZoom = 18;
    }

    const baseLayer = L.tileLayer(tileUrl, {
      maxZoom,
      attribution: 'Esri & INGEMMET',
    }).addTo(map);

    baseLayer.bringToBack();
    (map as any)._baseLayer = baseLayer;
  }, [baseMapType]);

  // 4. Synchronize GEOCATMIN ArcGIS REST / WMS Layers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    for (const layerDef of GEOCATMIN_LAYERS) {
      const isVisible = layerVisibility[layerDef.id] ?? layerDef.defaultVisible;
      const opacity = layerOpacity[layerDef.id] ?? layerDef.opacity;

      let layerGroup = layerGroupsRef.current.get(layerDef.id);

      if (isVisible) {
        if (!layerGroup) {
          // Use ArcGIS WMS export tiles
          const wmsUrl =
            layerDef.wmsUrl ||
            `${layerDef.restUrl.replace('/arcgis/rest/services/', '/arcgis/services/')}/WMSServer`;

          const leafletWms = L.tileLayer.wms(wmsUrl, {
            layers: '0',
            format: 'image/png',
            transparent: true,
            opacity: opacity,
            version: '1.3.0',
            crs: L.CRS.EPSG4326,
            maxZoom: 19,
          });

          layerGroupsRef.current.set(layerDef.id, leafletWms);
          leafletWms.addTo(map);
        } else {
          layerGroup.setOpacity(opacity);
          if (!map.hasLayer(layerGroup)) {
            layerGroup.addTo(map);
          }
        }
      } else {
        if (layerGroup && map.hasLayer(layerGroup)) {
          map.removeLayer(layerGroup);
        }
      }
    }
  }, [layerVisibility, layerOpacity]);

  // 5. Draw Buffer Circle when buffer tool is active
  useEffect(() => {
    if (!bufferGroupRef.current || !mapInstanceRef.current) return;
    bufferGroupRef.current.clearLayers();

    if (activeTool === 'buffer' || activeTool === 'overlap') {
      const center = inspectPoint || { lat: currentCenter.lat, lng: currentCenter.lng };
      const circle = L.circle([center.lat, center.lng], {
        radius: bufferRadiusKm * 1000,
        color: '#f59e0b',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 0.15,
        dashArray: '5, 5',
      }).addTo(bufferGroupRef.current);

      circle.bindTooltip(`Radio de influencia: ${bufferRadiusKm} km`, { permanent: true, direction: 'top' });
    }
  }, [activeTool, bufferRadiusKm, inspectPoint, currentCenter]);

  // 6. Draw Measurement Polyline
  useEffect(() => {
    if (!measureGroupRef.current || !mapInstanceRef.current) return;
    measureGroupRef.current.clearLayers();

    if (measurePoints.length > 0) {
      const latlngs = measurePoints.map((p) => [p[0], p[1]] as [number, number]);
      L.polyline(latlngs, { color: '#ec4899', weight: 3, dashArray: '6, 6' }).addTo(measureGroupRef.current);

      for (let i = 0; i < latlngs.length; i++) {
        L.circleMarker(latlngs[i], { radius: 5, color: '#ec4899', fillColor: '#ffffff', fillOpacity: 1 }).addTo(
          measureGroupRef.current
        );
      }
    }
  }, [measurePoints]);

  // Search Concessions Handler
  const handleSearchConcessions = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery || searchQuery.trim().length < 2) return;

    setIsSearching(true);
    try {
      const results = await queryIngemmetConcessions(searchQuery, 30);
      setSearchResults(results);
    } catch (err) {
      log.warn('[GeocatminWorkbench] Search query failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  // Select Concession and Fly To Polygon
  const handleSelectConcession = useCallback((c: ConcessionFeature) => {
    setSelectedConcession(c);
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    polygonHighlightGroupRef.current?.clearLayers();

    if (c.geometry && c.geometry.coordinates) {
      const rings = c.geometry.coordinates;
      // Convert ArcGIS rings [lng, lat] to Leaflet [lat, lng]
      const leafletCoords = rings.map((ring: any[]) => ring.map((pt) => [pt[1], pt[0]]));

      const poly = L.polygon(leafletCoords, {
        color: c.estado === 'TITULADO' ? '#3b82f6' : c.estado === 'EN TRAMITE' ? '#10b981' : '#ef4444',
        weight: 3,
        fillOpacity: 0.35,
      }).addTo(polygonHighlightGroupRef.current);

      map.fitBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 16 });

      poly
        .bindPopup(
          `<div style="font-family: sans-serif; font-size: 12px; color: #0f172a; min-width: 200px;">
            <div style="font-weight: bold; font-size: 13px; color: #1e40af; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
              ${c.nombre}
            </div>
            <div style="margin-top: 4px;"><strong>Código:</strong> ${c.codigo}</div>
            <div><strong>Titular:</strong> ${c.titular}</div>
            <div><strong>Estado:</strong> <span style="font-weight: 600; color: ${
              c.estado === 'TITULADO' ? '#1d4ed8' : '#047857'
            };">${c.estado}</span></div>
            <div><strong>Área:</strong> ${c.hectareas || '-'} Ha</div>
            <div><strong>Sustancia:</strong> ${c.sustancia || 'Metálica'}</div>
            <div><strong>Zona UTM:</strong> ${c.zonaUtm || '-'}</div>
          </div>`
        )
        .openPopup();
    }
  }, []);

  // Run Overlap Pre-Evaluation
  const handleRunOverlap = useCallback(async () => {
    setOverlapLoading(true);
    try {
      const center = inspectPoint || currentCenter;
      const res = await evaluateSpatialOverlap(center.lat, center.lng, bufferRadiusKm);
      setOverlapData(res);
    } catch (e) {
      log.warn('[GeocatminWorkbench] Overlap test failed:', e);
    } finally {
      setOverlapLoading(false);
    }
  }, [inspectPoint, currentCenter, bufferRadiusKm]);

  // Coordinate Conversion calculation
  const handleConvertCoordinates = useCallback(() => {
    if (coordMode === 'geoToUtm') {
      const lat = parseFloat(convLat);
      const lng = parseFloat(convLng);
      if (isNaN(lat) || isNaN(lng)) {
        setConvResult('Ingrese valores numéricos válidos para Latitud y Longitud.');
        return;
      }
      const res = convertWgs84ToUtm(lat, lng, convZone);
      setConvResult(`Este (X): ${res.easting.toLocaleString()} m | Norte (Y): ${res.northing.toLocaleString()} m | Zona: ${res.zone}S`);
    } else {
      const east = parseFloat(convEast);
      const north = parseFloat(convNorth);
      if (isNaN(east) || isNaN(north)) {
        setConvResult('Ingrese valores numéricos válidos para Este y Norte.');
        return;
      }
      const res = convertUtmToWgs84(east, north, convZone);
      setConvResult(`Latitud: ${res.lat.toFixed(6)}° | Longitud: ${res.lng.toFixed(6)}° (WGS84)`);
    }
  }, [coordMode, convLat, convLng, convEast, convNorth, convZone]);

  // Toggle Layer Visibility
  const toggleLayer = useCallback((id: string) => {
    setLayerVisibility((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Reset to Active Mine View
  const handleResetMineView = useCallback(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([currentCenter.lat, currentCenter.lng], 14);
    }
  }, [currentCenter]);

  // Capture High-Res Snapshot
  const handleExportMap = useCallback(() => {
    if (!mapContainerRef.current) return;
    const canvas = mapContainerRef.current.querySelector('canvas');
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      if (onCaptureComplete) {
        onCaptureComplete(dataUrl);
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `GEOCATMIN_${resolvedSiteName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
      }
    }
  }, [onCaptureComplete, resolvedSiteName]);

  const filteredLayers = useMemo(() => {
    return GEOCATMIN_LAYERS.filter((l) => l.category === activeCategory);
  }, [activeCategory]);

  return (
    <div className="geocatmin-workbench-root flex h-full w-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* ─── CABECERA PRINCIPAL GEOCATMIN ────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-cyan-500/20 bg-slate-900/90 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 shadow-inner">
            <Globe2 size={20} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wide text-cyan-50">GEOCATMIN INGEMMET</h1>
              <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                134 Servicios REST
              </span>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                ● En vivo
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>Unidad:</span>
              <strong className="text-sky-300">{resolvedSiteName}</strong>
              <span className="text-slate-600">|</span>
              <span className="font-mono text-[10px] text-slate-300">
                UTM: {utmInfo.easting.toLocaleString()} E, {utmInfo.northing.toLocaleString()} N (Zona {utmInfo.zone}S)
              </span>
            </div>
          </div>
        </div>

        {/* Acciones Rápidas Superior */}
        <div className="flex items-center gap-2">
          {/* Base Map Picker */}
          <div className="flex items-center rounded-lg border border-slate-700/80 bg-slate-950/80 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setBaseMapType('satellite')}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                baseMapType === 'satellite' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Satélite
            </button>
            <button
              type="button"
              onClick={() => setBaseMapType('topo')}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                baseMapType === 'topo' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Topográfico
            </button>
            <button
              type="button"
              onClick={() => setBaseMapType('terrain')}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                baseMapType === 'terrain' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Relieve
            </button>
          </div>

          {/* Reset View Button */}
          <button
            type="button"
            onClick={handleResetMineView}
            title="Centrar en la Unidad Minera"
            className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/20"
          >
            <Navigation size={13} />
            <span>Mi Mina</span>
          </button>

          {/* Export Map Button */}
          <button
            type="button"
            onClick={handleExportMap}
            title="Exportar plano cartográfico de alta resolución"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
          >
            <Download size={13} />
            <span>Exportar Plano</span>
          </button>

          {/* Dual-Mode Toggle */}
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'native' ? 'officialWeb' : 'native'))}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              viewMode === 'officialWeb'
                ? 'border-amber-500/50 bg-amber-500/20 text-amber-200'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Globe2 size={13} />
            <span>{viewMode === 'native' ? 'Portal Web INGEMMET' : 'Suite Nativa'}</span>
          </button>
        </div>
      </header>

      {/* ─── CUERPO PRINCIPAL CON CONTROLES Y MAPA ────────────────────────────── */}
      <div className="relative flex flex-1 overflow-hidden">
        {viewMode === 'officialWeb' ? (
          /* MODO PORTAL OFICIAL EMBEBIDO CON BYPASS DE SPLASH */
          <div className="relative flex h-full w-full flex-col bg-slate-900">
            <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-950/40 px-4 py-2 text-[12px] text-amber-200">
              <div className="flex items-center gap-2">
                <Info size={14} className="text-amber-400" />
                <span>
                  Portal Oficial INGEMMET cargado en vivo. Centrado objetivo en coordenadas de{' '}
                  <strong>{resolvedSiteName}</strong> ({currentCenter.lat.toFixed(4)}, {currentCenter.lng.toFixed(4)}).
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('native')}
                className="rounded bg-amber-500/20 px-2.5 py-1 text-[11px] font-bold text-amber-100 hover:bg-amber-500/30"
              >
                Volver a Suite Nativa
              </button>
            </div>
            <iframe
              src="https://geocatmin.ingemmet.gob.pe/geocatmin/"
              title="GEOCATMIN Oficial"
              className="h-full w-full border-0"
              allow="geolocation"
            />
          </div>
        ) : (
          /* MODO SUITE NATIVA GEOCATMIN WORKBENCH */
          <>
            {/* PANEL LATERAL IZQUIERDO (DRAWER DE HERRAMIENTAS Y CAPAS) */}
            <aside
              className={`flex shrink-0 flex-col border-r border-cyan-500/15 bg-slate-950/95 backdrop-blur-md transition-all duration-300 ${
                sidebarOpen ? 'w-80 md:w-96' : 'w-0 overflow-hidden border-r-0'
              }`}
            >
              {/* Barra de Pestañas de Herramientas */}
              <div className="flex border-b border-slate-800 bg-slate-900/70 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTool('search')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    activeTool === 'search'
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Search size={13} />
                  <span>Buscar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('inspect')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    activeTool === 'inspect'
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Info size={13} />
                  <span>Capas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('overlap')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    activeTool === 'overlap'
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Shield size={13} />
                  <span>Evaluación</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('downloads')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    activeTool === 'downloads'
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Download size={13} />
                  <span>Descargas</span>
                </button>
              </div>

              {/* CONTENIDO DEL PANEL SEGÚN LA HERRAMIENTA ACTIVA */}
              <div className="flex-1 overflow-y-auto p-3 text-slate-200">
                {/* 1. HERRAMIENTA DE BÚSQUEDA DE DERECHOS MINEROS */}
                {activeTool === 'search' && (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                        Buscador de Derechos Mineros
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Consulte en vivo por Nombre de Concesión, Código Único o Titular en INGEMMET.
                      </p>
                    </div>

                    <form onSubmit={handleSearchConcessions} className="flex gap-1.5">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Ej. ANTAMINA, 010002305, CERRO VERDE..."
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[12px] text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={isSearching}
                        className="flex items-center justify-center rounded-lg bg-cyan-600 px-3 py-2 text-white hover:bg-cyan-500 disabled:opacity-50"
                      >
                        {isSearching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                      </button>
                    </form>

                    {searchResults.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Resultados ({searchResults.length})
                        </div>
                        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                          {searchResults.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => handleSelectConcession(c)}
                              className={`w-full rounded-lg border p-2 text-left transition-all ${
                                selectedConcession?.id === c.id
                                  ? 'border-cyan-500 bg-cyan-950/40 text-cyan-100 shadow-md'
                                  : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[12px] font-bold text-sky-300">{c.nombre}</span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                    c.estado === 'TITULADO'
                                      ? 'bg-blue-500/20 text-blue-300'
                                      : c.estado === 'EN TRAMITE'
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : 'bg-rose-500/20 text-rose-300'
                                  }`}
                                >
                                  {c.estado}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                                <span>Cód: {c.codigo}</span>
                                <span>{c.hectareas ? `${c.hectareas} Ha` : ''}</span>
                              </div>
                              <div className="mt-0.5 line-clamp-1 text-[10px] text-slate-500">
                                Titular: {c.titular}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedConcession && (
                      <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 p-2.5 text-[11px] space-y-1">
                        <div className="font-bold text-cyan-200">Ficha Técnica Concesión</div>
                        <div>
                          <strong>Nombre:</strong> {selectedConcession.nombre}
                        </div>
                        <div>
                          <strong>Código:</strong> {selectedConcession.codigo}
                        </div>
                        <div>
                          <strong>Titular:</strong> {selectedConcession.titular}
                        </div>
                        <div>
                          <strong>Estado:</strong> {selectedConcession.estado}
                        </div>
                        <div>
                          <strong>Sustancia:</strong> {selectedConcession.sustancia}
                        </div>
                        <div>
                          <strong>Área:</strong> {selectedConcession.hectareas} Ha
                        </div>
                        <div>
                          <strong>Zona UTM:</strong> {selectedConcession.zonaUtm}
                        </div>
                        <div>
                          <strong>Ubicación:</strong> {selectedConcession.distrito}, {selectedConcession.provincia} (
                          {selectedConcession.departamento})
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. ÁRBOL Y GESTIÓN DE CAPAS INGEMMET */}
                {activeTool === 'inspect' && (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                        Catálogo de 134 Capas Oficiales
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Seleccione las capas temáticas a superponer en el visor.
                      </p>
                    </div>

                    {/* Categorías */}
                    <div className="grid grid-cols-2 gap-1">
                      {GEOCATMIN_CATEGORIES.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setActiveCategory(cat.id)}
                          className={`rounded-lg border p-1.5 text-left transition-colors ${
                            activeCategory === cat.id
                              ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-100'
                              : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <div className="text-[11px] font-bold">{cat.name}</div>
                          <div className="text-[9px] text-slate-500">{cat.badgeCount} servicios</div>
                        </button>
                      ))}
                    </div>

                    {/* Lista de Capas de la Categoría */}
                    <div className="space-y-2 pt-1">
                      {filteredLayers.map((l) => {
                        const isVis = layerVisibility[l.id] ?? l.defaultVisible;
                        const op = layerOpacity[l.id] ?? l.opacity;
                        return (
                          <div
                            key={l.id}
                            className={`rounded-lg border p-2 transition-colors ${
                              isVis
                                ? 'border-cyan-500/40 bg-slate-900/80'
                                : 'border-slate-800/80 bg-slate-950/40 opacity-75'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-slate-200">{l.name}</div>
                                <div className="text-[9px] text-slate-400">{l.description}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleLayer(l.id)}
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${
                                  isVis ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {isVis ? <Eye size={13} /> : <EyeOff size={13} />}
                              </button>
                            </div>

                            {isVis && (
                              <div className="mt-2 flex items-center gap-2 border-t border-slate-800/80 pt-1.5 text-[10px]">
                                <span className="text-slate-400">Opacidad:</span>
                                <input
                                  type="range"
                                  min={0.1}
                                  max={1.0}
                                  step={0.05}
                                  value={op}
                                  onChange={(e) =>
                                    setLayerOpacity((prev) => ({
                                      ...prev,
                                      [l.id]: parseFloat(e.target.value),
                                    }))
                                  }
                                  className="h-1 flex-1 accent-cyan-500"
                                />
                                <span className="font-mono text-slate-300">{Math.round(op * 100)}%</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Resultados del Inspector al Clic */}
                    {inspectLoading && (
                      <div className="flex items-center gap-2 rounded-lg bg-slate-900 p-2 text-[11px] text-cyan-300">
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Consultando atributos en INGEMMET...</span>
                      </div>
                    )}

                    {inspectResults.length > 0 && (
                      <div className="space-y-2 border-t border-slate-800 pt-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                          Atributos Identificados en el Punto
                        </div>
                        {inspectResults.map((r, i) => (
                          <div key={i} className="rounded-lg border border-slate-700 bg-slate-900/70 p-2 text-[10px]">
                            <div className="font-bold text-sky-300">{r.layerName}</div>
                            <div className="font-semibold text-slate-200">{r.featureName}</div>
                            <div className="mt-1 space-y-0.5 text-slate-400">
                              {Object.entries(r.attributes).map(([k, v]) => (
                                <div key={k} className="flex justify-between">
                                  <span>{k}:</span>
                                  <span className="font-medium text-slate-300">{v || '-'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. PRE-EVALUACIÓN Y SUPERPOSICIÓN */}
                {activeTool === 'overlap' && (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                        Pre-Evaluación de Superposición
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Analice colisiones con derechos mineros colindantes, ANP (SERNANP) y zonas arqueológicas.
                      </p>
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 space-y-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Radio de Análisis:</span>
                        <select
                          value={bufferRadiusKm}
                          onChange={(e) => setBufferRadiusKm(parseFloat(e.target.value))}
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-cyan-300"
                        >
                          <option value="0.5">500 metros</option>
                          <option value="1.0">1.0 km</option>
                          <option value="2.0">2.0 km</option>
                          <option value="5.0">5.0 km</option>
                          <option value="10.0">10.0 km</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={handleRunOverlap}
                        disabled={overlapLoading}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-50"
                      >
                        {overlapLoading ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          <Shield size={14} />
                        )}
                        <span>Ejecutar Pre-Evaluación</span>
                      </button>
                    </div>

                    {overlapData && (
                      <div className="space-y-2">
                        <div
                          className={`rounded-lg border p-2.5 text-[11px] ${
                            overlapData.hasCollisions
                              ? 'border-amber-500/40 bg-amber-950/20 text-amber-200'
                              : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                          }`}
                        >
                          <div className="font-bold">
                            {overlapData.hasCollisions ? '⚠️ Alerta de Superposiciones' : '✅ Sin Superposiciones Críticas'}
                          </div>
                          <div className="mt-1 text-[10px] leading-relaxed">{overlapData.summary}</div>
                        </div>

                        {overlapData.concessions.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[10px] font-bold text-slate-400">
                              Concesiones Detectadas ({overlapData.concessions.length}):
                            </div>
                            <div className="max-h-48 space-y-1 overflow-y-auto text-[10px]">
                              {overlapData.concessions.map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/60 p-1.5"
                                >
                                  <div>
                                    <strong className="text-sky-300">{c.nombre}</strong>
                                    <div className="text-[9px] text-slate-400">{c.titular}</div>
                                  </div>
                                  <span className="text-[9px] font-bold text-slate-300">{c.estado}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. CENTRO DE DESCARGAS OFICIALES */}
                {activeTool === 'downloads' && (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                        Descargas Oficiales INGEMMET
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Archivos Shapefile completos de Catastro Minero en WGS84 por zona UTM.
                      </p>
                    </div>

                    <div className="space-y-2">
                      {GEOCATMIN_OFFICIAL_DOWNLOADS.map((item) => (
                        <a
                          key={item.id}
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-start justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-left transition-colors hover:border-cyan-500/50 hover:bg-slate-900"
                        >
                          <div>
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-300">
                              <Download size={12} />
                              <span>{item.title}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-400">{item.description}</div>
                            <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-500">
                              <span className="rounded bg-slate-800 px-1 py-0.5 font-mono text-cyan-400">
                                {item.format}
                              </span>
                              <span>Zona: {item.zone}</span>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>

            {/* TOGGLE DEL SIDEBAR */}
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="absolute left-0 top-3 z-[1000] flex h-8 w-6 items-center justify-center rounded-r-md border border-l-0 border-cyan-500/30 bg-slate-900/90 text-cyan-300 shadow-md backdrop-blur hover:bg-slate-800"
              style={{ left: sidebarOpen ? '20rem' : '0' }}
            >
              {sidebarOpen ? <ChevronRight size={14} /> : <ChevronRight size={14} className="rotate-180" />}
            </button>

            {/* CONTENEDOR DEL MAPA LEAFLET */}
            <div className="relative flex-1">
              <div ref={mapContainerRef} className="h-full w-full bg-slate-950" />

              {/* BARRA FLOTANTE DE HERRAMIENTAS ESPACIALES (SUPERIOR DERECHA) */}
              <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1.5 rounded-xl border border-cyan-500/20 bg-slate-900/90 p-1.5 shadow-xl backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setActiveTool(activeTool === 'inspect' ? null : 'inspect')}
                  title="Identificar atributos al clic"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    activeTool === 'inspect' ? 'bg-cyan-500 text-white shadow' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Info size={16} />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTool(activeTool === 'measure' ? null : 'measure');
                    setMeasurePoints([]);
                    setMeasureDistanceKm(0);
                  }}
                  title="Medir distancia lineal"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    activeTool === 'measure' ? 'bg-pink-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Ruler size={16} />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTool(activeTool === 'buffer' ? null : 'buffer')}
                  title="Radio de influencia (Buffer)"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    activeTool === 'buffer' ? 'bg-amber-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Shield size={16} />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTool(activeTool === 'convert' ? null : 'convert')}
                  title="Conversor de coordenadas UTM / WGS84"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    activeTool === 'convert' ? 'bg-purple-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Compass size={16} />
                </button>
              </div>

              {/* CARD FLOTANTE DE MEDICIÓN ACTIVA */}
              {activeTool === 'measure' && measurePoints.length > 0 && (
                <div className="absolute bottom-6 left-6 z-[1000] rounded-xl border border-pink-500/40 bg-slate-950/90 p-3 shadow-2xl backdrop-blur-md">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Ruler size={16} className="text-pink-400" />
                      <span className="text-xs font-bold text-pink-200">Distancia Acumulada:</span>
                    </div>
                    <strong className="font-mono text-sm text-pink-300">{measureDistanceKm.toFixed(3)} km</strong>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    Haga clic en el mapa para añadir vértices.
                    <button
                      type="button"
                      onClick={() => {
                        setMeasurePoints([]);
                        setMeasureDistanceKm(0);
                      }}
                      className="ml-2 font-bold text-pink-400 underline"
                    >
                      Limpiar
                    </button>
                  </div>
                </div>
              )}

              {/* MODAL / POPUP FLOTANTE DE CONVERSOR DE COORDENADAS */}
              {activeTool === 'convert' && (
                <div className="absolute right-14 top-3 z-[1000] w-80 rounded-xl border border-purple-500/30 bg-slate-950/95 p-3.5 shadow-2xl backdrop-blur-md">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                      <Compass size={15} />
                      <span>Conversor de Coordenadas</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTool(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-2.5 space-y-2 text-[11px]">
                    <div className="flex gap-1 rounded bg-slate-900 p-0.5">
                      <button
                        type="button"
                        onClick={() => setCoordMode('geoToUtm')}
                        className={`flex-1 rounded py-1 font-semibold ${
                          coordMode === 'geoToUtm' ? 'bg-purple-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        Lat/Lng → UTM
                      </button>
                      <button
                        type="button"
                        onClick={() => setCoordMode('utmToGeo')}
                        className={`flex-1 rounded py-1 font-semibold ${
                          coordMode === 'utmToGeo' ? 'bg-purple-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        UTM → Lat/Lng
                      </button>
                    </div>

                    {coordMode === 'geoToUtm' ? (
                      <div className="space-y-1.5">
                        <div>
                          <label className="text-[10px] text-slate-400">Latitud (°):</label>
                          <input
                            type="text"
                            value={convLat}
                            onChange={(e) => setConvLat(e.target.value)}
                            placeholder="-9.5490"
                            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400">Longitud (°):</label>
                          <input
                            type="text"
                            value={convLng}
                            onChange={(e) => setConvLng(e.target.value)}
                            placeholder="-77.0540"
                            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] text-slate-400">Este (X):</label>
                            <input
                              type="text"
                              value={convEast}
                              onChange={(e) => setConvEast(e.target.value)}
                              placeholder="274500"
                              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                            />
                          </div>
                          <div className="w-20">
                            <label className="text-[10px] text-slate-400">Zona:</label>
                            <select
                              value={convZone}
                              onChange={(e) => setConvZone(parseInt(e.target.value))}
                              className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-1 text-slate-100"
                            >
                              <option value="17">17S</option>
                              <option value="18">18S</option>
                              <option value="19">19S</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400">Norte (Y):</label>
                          <input
                            type="text"
                            value={convNorth}
                            onChange={(e) => setConvNorth(e.target.value)}
                            placeholder="8943200"
                            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleConvertCoordinates}
                      className="w-full rounded bg-purple-600 py-1.5 font-bold text-white hover:bg-purple-500"
                    >
                      Calcular Coordenadas
                    </button>

                    {convResult && (
                      <div className="rounded border border-purple-500/40 bg-purple-950/30 p-2 font-mono text-[10px] text-purple-200">
                        {convResult}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(GeocatminWorkbench);
