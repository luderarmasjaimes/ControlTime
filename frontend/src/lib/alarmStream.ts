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

  const connect = useCallback(() => {
    if (typeof process !== 'undefined' && (process as any).env?.VITEST) return;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const url = proto + location.host + '/ws';
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
    wsRef.current = ws;
    ws.onopen = () => { setConnected(true); backoffRef.current = 1000; };
    ws.onmessage = (e) => {
      try { applyEvent(JSON.parse(e.data)); } catch { /* frames no-JSON: ignorar */ }
    };
    ws.onclose = () => { setConnected(false); scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }, [applyEvent]);

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
    let mounted = true;
    fetchInitialAlarms()
      .then(rows => { if (mounted) { setAlarms(rows); setUsingLiveData(true); } })
      .catch(err => { log.debug('alarmStream: sin backend de alarmas, usando demo', err); });
    connect();
    return () => {
      mounted = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    };
  }, [connect]);

  const acknowledge = useCallback((id: string) => {
    setAlarms(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    fetchWithAuthRetry(`/api/mining/alarms/${encodeURIComponent(id)}/ack`, { method: 'POST' })
      .catch(err => log.debug('ack alarma', err));
  }, []);

  return { alarms, connected, usingLiveData, acknowledge };
}
