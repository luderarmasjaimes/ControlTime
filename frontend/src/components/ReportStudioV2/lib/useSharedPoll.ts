import { useCallback, useSyncExternalStore } from 'react';

interface PollSnapshot<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
}

interface PollEntry<T> {
  snapshot: PollSnapshot<T>;
  fetcher: () => Promise<T>;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  listeners: Set<() => void>;
}

const registry = new Map<string, PollEntry<any>>();

// Referencia ESTABLE para "sin key"/"sin entry todavía" -- useSyncExternalStore
// exige que getSnapshot devuelva la MISMA referencia mientras el estado real no
// cambió (si no, React re-renderiza en bucle creyendo que el store cambió en
// cada render). Un objeto nuevo en cada llamada rompe esa garantía.
const IDLE_SNAPSHOT: PollSnapshot<any> = { data: null, loading: false, error: null };

function runFetch<T>(key: string): Promise<void> {
  const entry = registry.get(key) as PollEntry<T> | undefined;
  if (!entry) return Promise.resolve();
  // Evita pedidos superpuestos si un refetch manual (p. ej. el evento
  // "report-kpi-sync-complete") cae justo cuando el timer ya está en vuelo.
  if (entry.inFlight) return entry.inFlight;
  entry.inFlight = entry
    .fetcher()
    .then((data) => {
      entry.snapshot = { data, loading: false, error: null };
    })
    .catch((err) => {
      entry.snapshot = { data: entry.snapshot.data, loading: false, error: err };
    })
    .finally(() => {
      entry.inFlight = null;
      entry.listeners.forEach((listener) => listener());
    });
  return entry.inFlight;
}

/**
 * Sondea `fetcher()` cada `intervalMs` ms compartiendo UN SOLO timer/pedido
 * HTTP entre TODOS los componentes que llamen a este hook con la misma
 * `key` -- pedido explícito 2026-09-11: cada bloque de sensor/KPI en el
 * lienzo traía la MISMA lista completa por su cuenta (N bloques = N
 * pedidos idénticos cada 5-30s, sin compartir nada entre sí). Verificado en
 * vivo: 3 widgets sobre la misma key -> 1 solo fetch real, tanto al montar
 * como al refrescar manualmente (evento "report-kpi-sync-complete").
 *
 * `key === null` significa "no sondear" (p. ej. el widget está en modo
 * "Desconectado") -- se cancela la suscripción sin tocar el timer de otros
 * componentes que sigan usando la misma key. El primer suscriptor de una
 * key arranca el timer y dispara el primer fetch de inmediato; el último en
 * desuscribirse lo detiene -- nunca queda sondeando sin consumidores reales.
 */
export function useSharedPoll<T>(key: string | null, fetcher: () => Promise<T>, intervalMs: number) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!key) return () => {};
      let entry = registry.get(key) as PollEntry<T> | undefined;
      if (!entry) {
        entry = { snapshot: { data: null, loading: true, error: null }, fetcher, intervalMs, timer: null, inFlight: null, listeners: new Set() };
        registry.set(key, entry);
      }
      entry.listeners.add(onStoreChange);
      if (entry.timer === null) {
        runFetch<T>(key);
        entry.timer = setInterval(() => runFetch<T>(key), entry!.intervalMs);
      }
      return () => {
        const current = registry.get(key) as PollEntry<T> | undefined;
        if (!current) return;
        current.listeners.delete(onStoreChange);
        if (current.listeners.size === 0) {
          if (current.timer) clearInterval(current.timer);
          registry.delete(key);
        }
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, intervalMs],
  );

  const getSnapshot = useCallback((): PollSnapshot<T> => {
    if (!key) return IDLE_SNAPSHOT;
    const entry = registry.get(key) as PollEntry<T> | undefined;
    return entry ? entry.snapshot : IDLE_SNAPSHOT;
  }, [key]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refetch = useCallback(() => {
    if (key) runFetch(key);
  }, [key]);

  return { ...state, refetch };
}
