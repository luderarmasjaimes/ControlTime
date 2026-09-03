import { memo, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface GeoMapPoint {
  sensorId: string;
  label: string;
  unit: string;
  lat: number;
  lng: number;
  value: number;
  color: string;
  opacity: number;
}

interface SensorGeoMapPanelProps {
  points: GeoMapPoint[];
  skippedCount: number;
  /** Se llama una vez que los tiles visibles terminan de cargar (o tras un
   * techo de espera si nunca cargan) -- alimenta `data-export-ready` en
   * SensorMultiChartWidget.tsx, para que la captura de exportación (DOCX/
   * PDF/PPTX) no dispare antes de que el mapa haya pintado. */
  onReady?: () => void;
}

// Mismo basemap satelital que MapViewer.tsx (src/components/Special/) --
// consistencia visual con el resto de la plataforma, sin depender de ese
// componente (está acoplado a sus propios endpoints /api/map/*, ver
// análisis previo). Acá solo se necesita Leaflet "crudo" + tiles públicos,
// igual que allá -- no hace falta react-leaflet ni una capa WMS.
const TILE_URL = 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
const TILE_ATTRIBUTION = '© Google Hybrid';

/**
 * Tipo "Mapa" (coroplético en Word) adaptado a datos de sensores mineros:
 * en vez de regiones administrativas (que este widget no tiene), plotea
 * cada sensor en su coordenada real (sensors.lat/lng, ya expuesta por
 * /wizard/catalog pero antes ignorada por el tipado del frontend) como un
 * círculo cuyo TAMAÑO y COLOR reflejan el promedio del rango seleccionado
 * -- la lectura geoespacial real que un "Mapa" debe mostrar, en vez de
 * forzar un choropleth sin límites geográficos disponibles.
 */
function SensorGeoMapPanel({ points, skippedCount, onReady }: SensorGeoMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // `any`: mismo criterio pragmático que MapViewer.tsx (src/components/Special/)
  // -- los tipos de `leaflet` no exponen `L.Map`/`L.LayerGroup` de forma
  // limpia como namespace members en esta versión de @types/leaflet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null);
  // Ref (no dependencia del efecto de montaje) para poder usar siempre la
  // versión más reciente de `onReady` sin reinicializar el mapa entero.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      // Sin animaciones: cada pan/zoom (incluido el `fitBounds` de abajo)
      // queda SÍNCRONO en vez de interpolar vía requestAnimationFrame. Con
      // animación, ese callback puede seguir pendiente cuando la página sale
      // de la ventana de virtualización de export (ver EXPORT_VIRTUALIZATION_
      // WINDOW en ReadOnlyViewer.tsx) y el efecto de limpieza ya llamó
      // `map.remove()` -- el callback entonces intenta reposicionar un nodo
      // ya destruido y lanza sin capturar ("Cannot read properties of
      // undefined (reading '_leaflet_pos')"), tumbando TODO el árbol de
      // React del informe a mitad de un export grande (mismo mecanismo que
      // el error de WebGL/Three.js documentado en SensorMultiChartWidget.tsx
      // -- reproducido en vivo en un export PPTX de 144 páginas).
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([-9.53, -77.05], 13);
    const tileLayer = L.tileLayer(TILE_URL, { subdomains: '0123', maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    // "Listo para exportar" = los tiles visibles terminaron de cargar. El
    // segundo efecto (abajo) puede mover/hacer zoom al mapa (`fitBounds`)
    // apenas llegan los puntos, lo que dispara una nueva tanda de tiles --
    // por eso se espera a que pase un tramo sin ningún 'load' nuevo (settle)
    // en vez de disparar en el primero. Techo de 6s: el sidecar de export
    // puede no tener salida a internet hacia los tiles de Google -- no debe
    // bloquear el export para siempre si eso pasa (mismo criterio que
    // FRAGILE_CHART_TYPES en captureRasterAssets.ts).
    let fired = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const fireReady = () => {
      if (fired) return;
      fired = true;
      onReadyRef.current?.();
    };
    const scheduleSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(fireReady, 400);
    };
    tileLayer.on('load', scheduleSettle);
    scheduleSettle();
    const hardTimeout = setTimeout(fireReady, 6000);

    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      clearTimeout(hardTimeout);
      tileLayer.off('load', scheduleSettle);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // Solo se inicializa una vez -- el efecto de abajo redibuja los
    // marcadores cuando cambian los puntos, sin recrear el mapa (evita el
    // parpadeo/reset de zoom que tendría reinicializar L.map en cada
    // actualización de datos).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!points.length) return;
    const values = points.map((p) => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const span = Math.max(1e-9, maxV - minV);
    points.forEach((p) => {
      const norm = (p.value - minV) / span;
      const radius = 8 + norm * 18;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius,
        color: p.color,
        weight: 2,
        fillColor: p.color,
        fillOpacity: 0.45 * p.opacity,
        opacity: p.opacity,
      });
      marker.bindTooltip(
        `<strong>${p.label}</strong><br/>Promedio: ${p.value.toFixed(2)} ${p.unit || ''}`,
        { direction: 'top', sticky: true },
      );
      marker.addTo(layer);
    });
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.25), { maxZoom: 17, animate: false });
  }, [points]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 160 }}>
      <div ref={containerRef} className="sensor-geomap-interactive" style={{ width: '100%', height: '100%', pointerEvents: 'auto' }} />
      {!points.length && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(248,250,252,0.92)',
            fontSize: 11,
            color: '#64748b',
            textAlign: 'center',
            padding: 12,
          }}
        >
          Ningún sensor seleccionado tiene coordenadas GPS registradas.
        </div>
      )}
      {points.length > 0 && skippedCount > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            left: 6,
            fontSize: 9,
            background: 'rgba(15,23,42,0.75)',
            color: '#fff',
            borderRadius: 4,
            padding: '2px 6px',
          }}
        >
          {skippedCount} sensor{skippedCount === 1 ? '' : 'es'} sin coordenadas (no se muestran)
        </div>
      )}
    </div>
  );
}

export default memo(SensorGeoMapPanel);
