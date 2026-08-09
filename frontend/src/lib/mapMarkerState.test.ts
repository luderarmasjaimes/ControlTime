import { describe, expect, it } from 'vitest';
import {
    applyMarkerDiff,
    boundsToQuery,
    markerIsInsideBounds,
    padBounds,
} from './mapMarkerState';

describe('mapMarkerState', () => {
    it('expande el viewport y genera bbox para el backend', () => {
        const padded = padBounds({ south: -18, west: -71, north: -17, east: -70 }, 0.2);
        expect(padded).toEqual({ south: -18.2, west: -71.2, north: -16.8, east: -69.8 });
        expect(boundsToQuery(padded)).toEqual({
            bboxLat: '-18.2,-16.8',
            bboxLng: '-71.2,-69.8',
        });
    });

    it('reconoce puntos cuando el viewport cruza el antimeridiano', () => {
        const bounds = { south: -10, west: 170, north: 10, east: -170 };
        expect(markerIsInsideBounds({ lat: 0, lng: 179 }, bounds)).toBe(true);
        expect(markerIsInsideBounds({ lat: 0, lng: -179 }, bounds)).toBe(true);
        expect(markerIsInsideBounds({ lat: 0, lng: 0 }, bounds)).toBe(false);
    });

    it('aplica altas/cambios/bajas sin retener marcadores fuera del viewport', () => {
        const current = [
            { id: 'a', lat: -17.2, lng: -70.6, status: 'online' },
            { id: 'b', lat: -17.21, lng: -70.61, status: 'online' },
        ];
        const next = applyMarkerDiff(current, {
            channel: 'map_markers_diff',
            removed: ['b'],
            updated: [{ id: 'a', lat: -10, lng: -70.6, status: 'warning' }],
            added: [
                { id: 'c', lat: -17.22, lng: -70.62, status: 'online' },
                { id: 'd', lat: -12, lng: -75, status: 'online' },
            ],
        }, { south: -18, west: -71, north: -17, east: -70 });

        expect(next).toEqual([{ id: 'c', lat: -17.22, lng: -70.62, status: 'online' }]);
    });
});
