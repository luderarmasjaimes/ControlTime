/**
 * mapFieldMode.ts — "Modo campo": formato de wire compacto + intervalos más
 * largos + menos capas, activo cuando useConnectivity() reporta DEGRADADO u
 * OFFLINE-recuperando (nunca en ONLINE_PLENO, donde no hay motivo para
 * sacrificar payload/latencia).
 *
 * Reusa useConnectivity()/connectivityMonitor.ts como ÚNICO detector de
 * calidad de conexión (ver nota del brief: no construir un segundo
 * mecanismo). Este módulo solo TRADUCE ese estado a: (a) qué parámetros de
 * query mandarle a /api/map/markers (bbox más chico, limit más bajo -- capas
 * "menos"), (b) cada cuánto refrescar, y (c) cómo decodificar la respuesta
 * si el backend la sirve en el formato compacto (ver decodeCompactMarkers).
 *
 * Formato compacto: en vez de un array de objetos JSON completos
 * (`{"id":"...","type":"sensor","lat":...,"lng":...,"name":"...",
 * "status":"...","updated_at":"..."}`, ~140+ bytes por marcador con claves
 * repetidas n veces), se usa una tabla: una fila de claves una sola vez +
 * arrays de valores posicionales (`{"k":["id","type","lat","lng","name",
 * "status","updated_at"],"v":[["1","sensor",-17.24,-70.6,"A","warning",...],
 * ...]}`) -- típicamente 40-60% menos bytes en la práctica para listas de
 * cientos/miles de marcadores, sin necesitar un códec binario nuevo (mantiene
 * el payload JSON, inspeccionable con curl/devtools, como ya se hace en el
 * resto de este backend).
 */

import type { ConnectivityState } from './connectivityMonitor';

export interface FieldModePlan {
    /** Si está activo el modo campo (compacta wire format + intervalos largos + bbox más chico). */
    active: boolean;
    /** Intervalo de refresco de marcadores, ms. */
    refreshIntervalMs: number;
    /** Si se debe pedir el formato compacto vía `?compact=1`. */
    requestCompact: boolean;
    /** Factor de recorte del bbox actual del viewport (1 = sin recorte, 0.5 = mitad del área). */
    bboxShrinkFactor: number;
    /** Límite de marcadores a pedir (más bajo en campo, para no saturar un enlace 3G/satelital). */
    limit: number;
}

const NORMAL_REFRESH_MS = 15000;
const DEGRADED_REFRESH_MS = 45000;
const OFFLINE_RECOVERING_REFRESH_MS = 60000;

const NORMAL_LIMIT = 2000;
const FIELD_LIMIT = 300;

/** @brief Deriva el plan de fetch de marcadores a partir del estado de conectividad (useConnectivity()). No usar en ONLINE_PLENO -- ahí el plan "normal" ya es el correcto. */
export function planForConnectivity(state: ConnectivityState): FieldModePlan {
    if (state === 'OFFLINE') {
        // Sin red real no tiene sentido programar un fetch en absoluto (ver
        // MapViewer: en OFFLINE se sirve el snapshot de mapOfflineCache.ts,
        // no se llama a este plan para fetch activo). Se documenta igual
        // por completitud/uso futuro.
        return {
            active: true,
            refreshIntervalMs: OFFLINE_RECOVERING_REFRESH_MS,
            requestCompact: true,
            bboxShrinkFactor: 0.5,
            limit: FIELD_LIMIT,
        };
    }
    if (state === 'DEGRADADO') {
        return {
            active: true,
            refreshIntervalMs: DEGRADED_REFRESH_MS,
            requestCompact: true,
            bboxShrinkFactor: 0.6,
            limit: FIELD_LIMIT,
        };
    }
    return {
        active: false,
        refreshIntervalMs: NORMAL_REFRESH_MS,
        requestCompact: false,
        bboxShrinkFactor: 1,
        limit: NORMAL_LIMIT,
    };
}

/** Formato compacto tipo "tabla": claves una vez + filas de valores posicionales. */
export interface CompactMarkersPayload {
    k: string[];
    v: (string | number | null)[][];
}

export function isCompactPayload(data: any): data is CompactMarkersPayload {
    return !!data && Array.isArray(data.k) && Array.isArray(data.v);
}

/** @brief Decodifica el formato compacto de vuelta a la forma de objetos que ya consume el resto de MapViewer (mismo shape que el endpoint normal). */
export function decodeCompactMarkers(payload: CompactMarkersPayload): any[] {
    const { k, v } = payload;
    return v.map((row) => {
        const obj: Record<string, any> = {};
        k.forEach((key, idx) => {
            obj[key] = row[idx];
        });
        return obj;
    });
}

/** @brief Codifica una lista de marcadores (shape normal) al formato compacto -- uso: tests / referencia de lo que el backend debería producir con `?compact=1`. */
export function encodeCompactMarkers(markers: any[]): CompactMarkersPayload {
    const keySet = new Set<string>();
    markers.forEach((m) => Object.keys(m).forEach((k) => keySet.add(k)));
    const k = Array.from(keySet);
    const v = markers.map((m) => k.map((key) => (m[key] === undefined ? null : m[key])));
    return { k, v };
}
