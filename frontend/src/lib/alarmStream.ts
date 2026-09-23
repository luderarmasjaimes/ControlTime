/**
 * alarmStream.ts — Alarmas en tiempo real vía WebSocket + carga inicial REST.
 *
 * El backend (device_alarm_routes.cpp + alarm_notifier.cpp) empuja un evento
 * `{type:"alarm", event:"triggered"|"resolved", ...}` por el WS del tenant al
 * disparar/resolver una alarma (misma infraestructura WsRegistry del mapa en
 * vivo). Este hook:
 *   1. Carga el estado inicial con GET /api/mining/alarms.
 *   2. Se suscribe al WS /ws y aplica los eventos entrantes en vivo.
 *   3. Reconecta con backoff si el enlace cae (sierra/selva, ADR-022/026).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchWithAuthRetry } from './fetchWithAuth';
import { log } from './logger';

export interface LiveAlarm {
  id: string;
  ruleName: string;
  severity: string;      // info | warning | high | critical
  message: string;
  observedValue: number;
  triggeredAt: string;
  resolvedAt: string | null;
  acknowledged: boolean;
}

// ADR-082: ya no se pasa el token en la URL del WebSocket. El handshake de un
// WebSocket al MISMO origen es una petición HTTP normal, así que el navegador
// le adjunta la cookie HttpOnly `access_token` igual que a cualquier fetch —
// el backend resuelve la sesión desde ahí (auth_session.cpp). Además de
// posible, es mejor: la URL de un WS acaba en los logs del proxy igual que
// cualquier otra, y ahí quedaba el JWT completo en claro.

async function fetchInitialAlarms(): Promise<LiveAlarm[]> {
  const res = await fetchWithAuthRetry('/api/mining/alarms');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data?.alarms) ? data.alarms : [];
  return rows.map((a: any) => ({
    id: String(a.id ?? a.alarm_id ?? ''),
    ruleName: a.rule_name || a.message || 'Alarma',
    severity: a.severity || 'warning',
    message: a.message || '',
    observedValue: Number(a.observed_value ?? 0),
    triggeredAt: a.created_at || a.triggered_at || new Date().toISOString(),
    resolvedAt: a.resolved_at || null,
    acknowledged: Boolean(a.acknowledged_at || a.acknowledged),
  }));
}

export interface AlarmStreamState {
  alarms: LiveAlarm[];
  connected: boolean;
  usingLiveData: boolean;  // false = backend no disponible (fallback demo en UI)
}

export function useAlarmStream(): AlarmStreamState & { acknowledge: (id: string) => void } {
  const [alarms, setAlarms] = useState<LiveAlarm[]>([]);
  const [connected, setConnected] = useState(false);
  const [usingLiveData, setUsingLiveData] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const mountedRef = useRef(true);
  // Incrementado en cada resync disparado (mount + cada reconexión); si una
  // respuesta de GET /api/mining/alarms llega después de que ya arrancó un
  // resync más nuevo (otra reconexión de por medio), se descarta en vez de
  // pisar estado más fresco -- ver resync() más abajo.
  const resyncSeqRef = useRef(0);

  const applyEvent = useCallback((ev: any) => {
    if (!ev || ev.type !== 'alarm') return;
    const incoming: LiveAlarm = {
      id: String(ev.alarm_id ?? ''),
      ruleName: ev.message || 'Alarma',
      severity: ev.severity || 'warning',
      message: ev.message || '',
      observedValue: Number(ev.observed_value ?? 0),
      triggeredAt: ev.ts ? new Date(ev.ts * 1000).toISOString() : new Date().toISOString(),
      resolvedAt: ev.event === 'resolved' ? new Date().toISOString() : null,
      acknowledged: false,
    };
    setAlarms(prev => {
      const idx = prev.findIndex(a => a.id === incoming.id);
      if (ev.event === 'resolved') {
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], resolvedAt: incoming.resolvedAt };
        return next;
      }
      if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], ...incoming }; return next; }
      return [incoming, ...prev];
    });
  }, []);

  // Fusiona la respuesta de un resync (GET /api/mining/alarms) con el estado
  // ya en memoria, en vez de reemplazarlo -- el fetch puede tardar mientras
  // el WS (ya reconectado) sigue entregando eventos vía applyEvent(), y una
  // respuesta HTTP más vieja no debe pisar una transición más nueva que ya
  // llegó en vivo. Reglas, ambas monótonas (nunca "retroceden" un estado ya
  // avanzado localmente):
  //   - resolvedAt: se queda con el que esté seteado (fetched u existente).
  //   - acknowledged: una vez true (ack local optimista, ver acknowledge()
  //     abajo) no vuelve a false aunque el fetch todavía no vea el ack en DB.
  // Alarmas que el WS ya aplicó pero que este GET no trajo (p.ej. si el
  // endpoint acota a una ventana) se conservan tal cual, nunca se descartan.
  const mergeResync = useCallback((prev: LiveAlarm[], fetched: LiveAlarm[]): LiveAlarm[] => {
    const prevById = new Map(prev.map(a => [a.id, a] as const));
    const merged = fetched.map(row => {
      const existing = prevById.get(row.id);
      if (!existing) return row;
      return {
        ...row,
        resolvedAt: row.resolvedAt ?? existing.resolvedAt,
        acknowledged: row.acknowledged || existing.acknowledged,
      };
    });
    const fetchedIds = new Set(fetched.map(r => r.id));
    const localOnly = prev.filter(a => !fetchedIds.has(a.id));
    return [...merged, ...localOnly];
  }, []);

  // Resincroniza el estado completo desde REST. Se llama al montar Y en cada
  // `ws.onopen` (conexión inicial y cada reconexión tras un drop) -- sin
  // esto, una alarma disparada/resuelta mientras el WS estaba caído (blip de
  // red, restart del backend) quedaba perdida en la UI hasta un F5 manual.
  const resync = useCallback(() => {
    const seq = ++resyncSeqRef.current;
    fetchInitialAlarms()
      .then(rows => {
        if (!mountedRef.current) return;
        // Un resync más nuevo (otra reconexión) ya arrancó -- esta
        // respuesta quedó vieja, no pisar estado más fresco con ella.
        if (seq !== resyncSeqRef.current) return;
        setAlarms(prev => mergeResync(prev, rows));
        setUsingLiveData(true);
      })
      .catch(err => { log.debug('alarmStream: resync de alarmas falló', err); });
  }, [mergeResync]);

  const connect = useCallback(() => {
    if (typeof process !== 'undefined' && (process as any).env?.VITEST) return;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const url = proto + location.host + '/ws';
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      backoffRef.current = 1000;
      // Resync tras CADA apertura (primera conexión y cada reconexión): una
      // alarma disparada/resuelta mientras esta conexión estaba caída no
      // llega por ningún otro camino, ver resync() arriba.
      resync();
    };
    ws.onmessage = (e) => {
      try { applyEvent(JSON.parse(e.data)); } catch { /* frames no-JSON: ignorar */ }
    };
    ws.onclose = () => { setConnected(false); scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }, [applyEvent, resync]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectRef.current) return;
    const delay = Math.min(backoffRef.current, 30000);
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null;
      backoffRef.current = Math.min(backoffRef.current * 2, 30000);
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    // Fetch inicial en paralelo al handshake del WS (pintado más rápido que
    // esperar a `ws.onopen`); `resync()` también corre en `ws.onopen` (ver
    // connect() arriba), así que la primera conexión resincroniza dos veces
    // -- inofensivo (mergeResync es idempotente) y cubre el caso en que el
    // handshake tarda.
    resync();
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    };
  }, [connect, resync]);

  const acknowledge = useCallback((id: string) => {
    setAlarms(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    fetchWithAuthRetry(`/api/mining/alarms/${encodeURIComponent(id)}/ack`, { method: 'POST' })
      .catch(err => log.debug('ack alarma', err));
  }, []);

  return { alarms, connected, usingLiveData, acknowledge };
}
