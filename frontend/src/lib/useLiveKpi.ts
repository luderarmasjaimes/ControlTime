/**
 * useLiveKpi.ts — Push de KPIs en tiempo real vía SSE (SPEC-005, cierre 2026-09-12).
 *
 * Consume `GET /api/live/kpi` (backend `main.cpp::handleLiveKpiSse`), que
 * empuja un evento cada `BEEMETRY_LIVE_PUSH_INTERVAL_MS` (2s por defecto)
 * con los KPIs corporativos actuales de `mining_runtime_kpis` — reemplaza el
 * polling de 60s que usaba `KpiOperationsView` hasta ahora.
 *
 * Autenticación: `EventSource` nativo no puede mandar un header
 * `Authorization` custom, así que este endpoint depende de la cookie
 * HttpOnly `beemetry_access_token` (ADR-082, `setAccessTokenCookie`) que el
 * backend ya fija en cada login/refresh junto al Bearer en memoria — mismo
 * patrón que `alarmStream.ts` ya usa para el WebSocket de alarmas. No hace
 * falta ninguna cabecera manual ni `withCredentials` (la request es
 * same-origin, el navegador adjunta la cookie sola).
 *
 * `EventSource` reconecta solo ante un corte de red — el único caso que se
 * maneja a mano acá es una sesión vencida (401): el navegador reintentaría
 * para siempre contra un endpoint que nunca va a autorizar, así que se
 * detecta `readyState === CLOSED` tras el primer error y se deja de
 * reconectar (el usuario ya está deslogueado en ese punto, `AuthGateway` se
 * encarga de la sesión).
 */
import { useEffect, useRef, useState } from 'react';
import { log } from './logger';

export interface LiveKpiPoint {
    name: string;
    value: number;
    unit: string;
    category: string;
}

export interface LiveKpiSnapshot {
    /** Último lote de KPIs recibido, o null si aún no llegó ninguno. */
    kpis: LiveKpiPoint[] | null;
    /** true mientras la conexión SSE está abierta y recibiendo eventos. */
    connected: boolean;
    /** true si el último evento venía marcado `degraded` (backend usando la
     * BD primaria porque `db_replica` no respondía — ver comentario de
     * `handleLiveKpiSse` en main.cpp). Dato real, no un error del cliente. */
    degraded: boolean;
    /** Timestamp (`ts` del backend) del último evento aplicado. */
    lastUpdate: string | null;
}

const SSE_URL = '/api/live/kpi';

export interface ParsedLiveKpiEvent {
    kpis: LiveKpiPoint[];
    degraded: boolean;
    ts: string;
}

/** Lógica pura de parseo del payload `data:` del SSE — separada de
 * `useLiveKpi` para poder probarla sin montar un `EventSource` real (no
 * disponible en jsdom), mismo criterio que `offlineSqlite.ts::isLocalDraftId`.
 * Devuelve `null` ante JSON inválido o sin forma reconocible, nunca lanza. */
export function parseLiveKpiEvent(rawData: string): ParsedLiveKpiEvent | null {
    let data: any;
    try {
        data = JSON.parse(rawData);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object') return null;
    return {
        kpis: Array.isArray(data.kpis) ? data.kpis : [],
        degraded: Boolean(data.degraded),
        ts: typeof data.ts === 'string' ? data.ts : new Date().toISOString(),
    };
}

export function useLiveKpi(): LiveKpiSnapshot {
    const [kpis, setKpis] = useState<LiveKpiPoint[] | null>(null);
    const [connected, setConnected] = useState(false);
    const [degraded, setDegraded] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<string | null>(null);
    const esRef = useRef<EventSource | null>(null);

    useEffect(() => {
        // A diferencia de MapViewer/alarmStream (que además excluyen VITEST
        // explícitamente): jsdom no implementa `EventSource` en absoluto, así
        // que este único chequeo ya basta para no conectar en el entorno de
        // test real -- y deja la puerta abierta a que un test inyecte su
        // propio mock de `EventSource` para probar el hook completo (ver
        // `useLiveKpi.test.ts`).
        if (typeof EventSource === 'undefined') return undefined;

        const es = new EventSource(SSE_URL);
        esRef.current = es;

        es.onopen = () => setConnected(true);

        es.onmessage = (ev) => {
            const parsed = parseLiveKpiEvent(ev.data);
            if (!parsed) {
                log.warn('[useLiveKpi] evento SSE no parseable, ignorado:', ev.data);
                return;
            }
            setKpis(parsed.kpis);
            setDegraded(parsed.degraded);
            setLastUpdate(parsed.ts);
            setConnected(true);
        };

        es.onerror = () => {
            setConnected(false);
            // readyState === CLOSED (2): el navegador ya decidió no reintentar
            // más (p.ej. el servidor respondió 401 en el intento inicial o en
            // un reintento) -- cerrar explícitamente evita quedar con un
            // EventSource "zombie" que nunca vuelve a conectar pero tampoco
            // se libera hasta desmontar el componente.
            if (es.readyState === EventSource.CLOSED) {
                es.close();
            }
        };

        return () => {
            es.close();
            esRef.current = null;
        };
    }, []);

    return { kpis, connected, degraded, lastUpdate };
}
