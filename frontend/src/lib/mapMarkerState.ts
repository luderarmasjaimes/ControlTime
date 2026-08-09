/**
 * Utilidades puras para mantener el conjunto de marcadores del mapa acotado al
 * viewport. Separarlas de Leaflet permite probar los bordes (antimeridiano,
 * padding y diffs WS) sin montar canvas/DOM.
 *
 * SPEC-009 · ADR-023/026: el cliente no debe redibujar el universo completo
 * de sensores en cada zoom; conserva únicamente el viewport más un margen.
 */

export interface MapBoundsLike {
    south: number;
    west: number;
    north: number;
    east: number;
}

export interface MarkerDiffPayload {
    channel?: string;
    added?: any[];
    updated?: any[];
    removed?: Array<string | number>;
}

export function normalizeBounds(bounds: MapBoundsLike): MapBoundsLike {
    return {
        south: Math.min(bounds.south, bounds.north),
        north: Math.max(bounds.south, bounds.north),
        west: bounds.west,
        east: bounds.east,
    };
}

/** Expande el viewport por lado. 0.2 equivale a 20% adicional por borde. */
export function padBounds(bounds: MapBoundsLike, ratio: number): MapBoundsLike {
    const b = normalizeBounds(bounds);
    const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(ratio, 1)) : 0;
    const latPad = (b.north - b.south) * safeRatio;

    // En el caso normal west <= east. Si cruza el antimeridiano, el ancho se
    // calcula sobre el arco corto y se conserva la representación west>east.
    const crossesAntimeridian = b.west > b.east;
    const lngWidth = crossesAntimeridian
        ? (180 - b.west) + (b.east + 180)
        : b.east - b.west;
    const lngPad = lngWidth * safeRatio;

    let west = b.west - lngPad;
    let east = b.east + lngPad;
    if (west < -180) west += 360;
    if (east > 180) east -= 360;

    return {
        south: Math.max(-90, b.south - latPad),
        north: Math.min(90, b.north + latPad),
        west,
        east,
    };
}

export function markerIsInsideBounds(marker: any, bounds: MapBoundsLike): boolean {
    const lat = Number(marker?.lat);
    const lng = Number(marker?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const b = normalizeBounds(bounds);
    const insideLatitude = lat >= b.south && lat <= b.north;
    const insideLongitude = b.west <= b.east
        ? lng >= b.west && lng <= b.east
        : lng >= b.west || lng <= b.east;
    return insideLatitude && insideLongitude;
}

export function markerIdentity(marker: any): string {
    if (marker?.id !== undefined && marker?.id !== null) return String(marker.id);
    return `${Number(marker?.lat)},${Number(marker?.lng)}`;
}

/**
 * Aplica el mensaje `map_markers_diff` sin hacer crecer el estado con puntos
 * que están fuera del viewport cacheado. Las bajas siempre se aplican.
 */
export function applyMarkerDiff(
    current: any[],
    diff: MarkerDiffPayload,
    acceptedBounds: MapBoundsLike | null,
): any[] {
    const byId = new Map(current.map((marker) => [markerIdentity(marker), marker]));

    for (const id of diff.removed || []) byId.delete(String(id));

    const upserts = [...(diff.added || []), ...(diff.updated || [])];
    for (const marker of upserts) {
        const id = markerIdentity(marker);
        if (!acceptedBounds || markerIsInsideBounds(marker, acceptedBounds)) {
            byId.set(id, marker);
        } else {
            // Un equipo que se movió fuera del viewport debe desaparecer del
            // estado local aunque antes sí estuviera visible.
            byId.delete(id);
        }
    }

    return Array.from(byId.values());
}

export function boundsToQuery(bounds: MapBoundsLike): {
    bboxLat: string;
    bboxLng: string;
} {
    const b = normalizeBounds(bounds);
    return {
        bboxLat: `${b.south},${b.north}`,
        bboxLng: `${b.west},${b.east}`,
    };
}
