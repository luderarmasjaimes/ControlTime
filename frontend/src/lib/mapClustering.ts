/**
 * mapClustering.ts — Agrupamiento (clustering) de marcadores por grilla,
 * dependiente del zoom actual del mapa.
 *
 * Por qué existe: con hasta 10.000 sensores por unidad minera, renderizar un
 * `L.marker`/`L.divIcon` por punto (DOM real, un <div> por marcador) no
 * escala -- cientos/miles de nodos DOM con reflow en cada pan/zoom. La
 * solución de dos partes:
 *   1) Renderizar con `L.circleMarker` (dibujado en el <canvas> del mapa
 *      cuando el mapa tiene `preferCanvas: true`, sin nodos DOM por punto) en
 *      vez de `L.marker`+`L.divIcon`.
 *   2) Agrupar puntos cercanos en una sola "burbuja" con contador cuando hay
 *      demasiados en el viewport actual -- así ni siquiera se dibujan miles
 *      de círculos individuales cuando están muy juntos a un zoom bajo.
 *
 * Se optó por un bucketing de grilla simple (deliberado, ver brief: "grid
 * based bucketing by zoom level is fine ... prefer minimal footprint") en
 * vez de agregar `leaflet.markercluster` como dependencia nueva: esa
 * librería además vuelve a renderizar sus íconos de cluster como DOM
 * (`L.divIcon` internamente), lo cual reintroduce exactamente el problema de
 * performance que se busca evitar a escala de 10k. Un bucket de grilla +
 * `L.circleMarker` para los clusters mantiene TODO en canvas.
 */

export interface ClusterableMarker {
    id: string | number;
    lat: number;
    lng: number;
    [key: string]: any;
}

export interface MarkerCluster<T extends ClusterableMarker> {
    isCluster: true;
    lat: number;
    lng: number;
    count: number;
    members: T[];
}

export type ClusterOrMarker<T extends ClusterableMarker> = MarkerCluster<T> | T;

export function isCluster<T extends ClusterableMarker>(
    item: ClusterOrMarker<T>
): item is MarkerCluster<T> {
    return (item as MarkerCluster<T>).isCluster === true;
}

/**
 * Tamaño de celda de grilla en grados, dependiente del zoom. A zoom alto
 * (>=16, escala de planta/faena) el tamaño de celda es tan pequeño que en la
 * práctica cada sensor cae en su propia celda -- sin agrupar, se ven todos.
 * A zoom bajo (vista de toda la unidad minera o más) las celdas son grandes
 * y agrupan cientos de sensores cercanos en una sola burbuja con contador.
 *
 * Progresión geométrica simple (÷2 por nivel de zoom), acotada a un mínimo
 * para no generar celdas de tamaño cero por errores de punto flotante.
 */
export function cellSizeForZoom(zoom: number): number {
    const clampedZoom = Math.max(1, Math.min(22, zoom));
    // A zoom 13 (vista inicial de este mapa) ~0.01 grados (~1km en el
    // ecuador) es un tamaño de celda razonable para agrupar sensores
    // cercanos sin ocultar detalle operacional real.
    const base = 0.02;
    const size = base / Math.pow(2, clampedZoom - 10);
    return Math.max(size, 0.00005);
}

/**
 * Agrupa `markers` en celdas de grilla del tamaño correspondiente a `zoom`.
 * Celdas con más de `minClusterSize` puntos se colapsan en un único
 * MarkerCluster (posicionado en el centroide de sus miembros); celdas con
 * menos se devuelven como marcadores individuales sin modificar.
 *
 * O(n): un solo paso por los marcadores usando un Map con clave de celda.
 */
export function clusterMarkers<T extends ClusterableMarker>(
    markers: T[],
    zoom: number,
    minClusterSize = 3
): ClusterOrMarker<T>[] {
    if (markers.length === 0) return [];
    const cellSize = cellSizeForZoom(zoom);
    const buckets = new Map<string, T[]>();

    for (const m of markers) {
        if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
        const cellX = Math.floor(m.lng / cellSize);
        const cellY = Math.floor(m.lat / cellSize);
        const key = `${cellX}:${cellY}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(m);
        else buckets.set(key, [m]);
    }

    const out: ClusterOrMarker<T>[] = [];
    buckets.forEach((members) => {
        if (members.length < minClusterSize) {
            out.push(...members);
            return;
        }
        let sumLat = 0;
        let sumLng = 0;
        for (const m of members) {
            sumLat += m.lat;
            sumLng += m.lng;
        }
        out.push({
            isCluster: true,
            lat: sumLat / members.length,
            lng: sumLng / members.length,
            count: members.length,
            members,
        });
    });
    return out;
}
