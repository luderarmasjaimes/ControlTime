/**
 * connectivityMonitor.ts — Detección adaptativa de conectividad para mapas.
 *
 * Por qué existe: `navigator.onLine` solo refleja si la interfaz de red está
 * "arriba" (p.ej. wifi conectado a un router sin salida a internet real sigue
 * marcando `true`), y no sirve para decidir cuándo cambiar de mapas online a
 * mapas locales en unidades mineras con 3G/4G/satelital variable. Este módulo
 * hace heartbeat real contra el propio backend (`/api/health`, ya expuesto
 * por el proxy nginx/vite existente — ver gdal_routes.cpp) y aplica histéresis
 * (N muestras consecutivas antes de cambiar de estado) para no "parpadear"
 * entre estados con un enlace inestable.
 *
 * Estados (3, no solo online/offline binario):
 *   - ONLINE_PLENO: heartbeat rápido y consistente → mapas online a máxima calidad.
 *   - DEGRADADO: hay conectividad pero lenta/intermitente → reducir capas/calidad.
 *   - OFFLINE: sin conectividad real → depender de tiles cacheados (Service
 *     Worker) o mapas locales (mbtileserver).
 *
 * Uso: import { useConnectivity } from '../../lib/connectivityMonitor'
 */

import { useEffect, useState } from 'react';
import { log } from './logger';

export type ConnectivityState = 'ONLINE_PLENO' | 'DEGRADADO' | 'OFFLINE';

export interface ConnectivitySnapshot {
    state: ConnectivityState;
    lastLatencyMs: number | null;
    lastCheckedAt: number | null;
    consecutiveSuccess: number;
    consecutiveFailure: number;
}

const HEARTBEAT_URL = '/api/health';
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 3000;
const DEGRADED_LATENCY_MS = 800;
const HYSTERESIS_SAMPLES = 2;

type Listener = (snapshot: ConnectivitySnapshot) => void;

class ConnectivityMonitor {
    private snapshot: ConnectivitySnapshot = {
        state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'OFFLINE' : 'ONLINE_PLENO',
        lastLatencyMs: null,
        lastCheckedAt: null,
        consecutiveSuccess: 0,
        consecutiveFailure: 0,
    };

    private listeners = new Set<Listener>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private inFlight = false;

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.snapshot);
        this.start();
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0) this.stop();
        };
    }

    getSnapshot(): ConnectivitySnapshot {
        return this.snapshot;
    }

    private start() {
        if (this.timer) return;
        this.checkOnce();
        this.timer = setInterval(() => this.checkOnce(), HEARTBEAT_INTERVAL_MS);
    }

    private stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private emit() {
        this.listeners.forEach((l) => l(this.snapshot));
    }

    private applyResult(ok: boolean, latencyMs: number | null) {
        const s = this.snapshot;
        const consecutiveSuccess = ok ? s.consecutiveSuccess + 1 : 0;
        const consecutiveFailure = ok ? 0 : s.consecutiveFailure + 1;

        let nextState = s.state;
        if (!ok) {
            if (consecutiveFailure >= HYSTERESIS_SAMPLES) nextState = 'OFFLINE';
        } else {
            const isFast = (latencyMs ?? Infinity) < DEGRADED_LATENCY_MS;
            if (s.state === 'OFFLINE') {
                // Nunca saltar directo de OFFLINE a ONLINE_PLENO: primero
                // confirmar DEGRADADO para evitar parpadeo con enlaces
                // inestables (3G/satelital) que responden un ping suelto.
                if (consecutiveSuccess >= HYSTERESIS_SAMPLES) nextState = 'DEGRADADO';
            } else if (isFast) {
                if (consecutiveSuccess >= HYSTERESIS_SAMPLES) nextState = 'ONLINE_PLENO';
            } else {
                if (consecutiveSuccess >= HYSTERESIS_SAMPLES) nextState = 'DEGRADADO';
            }
        }

        this.snapshot = {
            state: nextState,
            lastLatencyMs: latencyMs,
            lastCheckedAt: Date.now(),
            consecutiveSuccess,
            consecutiveFailure,
        };
        this.emit();
    }

    private async checkOnce() {
        if (this.inFlight) return;
        this.inFlight = true;
        const startedAt = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
            const res = await fetch(HEARTBEAT_URL, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const latencyMs = performance.now() - startedAt;
            this.applyResult(res.ok, latencyMs);
        } catch (err) {
            log.debug('connectivityMonitor: heartbeat falló', err);
            this.applyResult(false, null);
        } finally {
            this.inFlight = false;
        }
    }
}

export const connectivityMonitor = new ConnectivityMonitor();

export function useConnectivity(): ConnectivitySnapshot {
    const [snapshot, setSnapshot] = useState<ConnectivitySnapshot>(connectivityMonitor.getSnapshot());
    useEffect(() => connectivityMonitor.subscribe(setSnapshot), []);
    return snapshot;
}
