import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLiveKpi, parseLiveKpiEvent } from './useLiveKpi';

/**
 * SPEC-005 (push realtime, cierre 2026-09-12). Dos niveles de prueba:
 *
 * 1. `parseLiveKpiEvent` — lógica pura de parseo, sin dependencias de red.
 * 2. `useLiveKpi` completo, contra un mock real de `EventSource` (jsdom no
 *    lo implementa, así que se inyecta acá) — sí ejercita el ciclo de vida
 *    completo del hook (conectar, recibir evento, degradado, error terminal,
 *    limpieza al desmontar), a diferencia de otros módulos de este repo que
 *    dependen de APIs más difíciles de mockear con fidelidad (sql.js, Cache
 *    API) y por eso quedan fuera de alcance de test automatizado.
 */

describe('parseLiveKpiEvent', () => {
  it('parsea un evento válido con kpis', () => {
    const raw = JSON.stringify({
      tenant: 't1',
      ts: '2026-09-12T10:00:00Z',
      kpis: [{ name: 'tonelaje_movido', value: 12500, unit: 't/día', category: 'produccion' }],
    });
    const parsed = parseLiveKpiEvent(raw);
    expect(parsed).toEqual({
      kpis: [{ name: 'tonelaje_movido', value: 12500, unit: 't/día', category: 'produccion' }],
      degraded: false,
      ts: '2026-09-12T10:00:00Z',
    });
  });

  it('marca degraded:true cuando el backend usó la BD primaria', () => {
    const raw = JSON.stringify({ tenant: 't1', ts: '2026-09-12T10:00:02Z', kpis: [], degraded: true });
    expect(parseLiveKpiEvent(raw)?.degraded).toBe(true);
  });

  it('devuelve kpis:[] si el backend manda un array vacío (query sin resultados)', () => {
    const raw = JSON.stringify({ tenant: 't1', ts: '2026-09-12T10:00:04Z', kpis: [] });
    expect(parseLiveKpiEvent(raw)?.kpis).toEqual([]);
  });

  it('devuelve null ante JSON inválido, sin lanzar', () => {
    expect(parseLiveKpiEvent('esto no es json')).toBeNull();
  });

  it('devuelve null ante un valor JSON válido pero sin forma de objeto', () => {
    expect(parseLiveKpiEvent('42')).toBeNull();
    expect(parseLiveKpiEvent('null')).toBeNull();
  });

  it('usa un timestamp propio si el backend no manda ts', () => {
    const parsed = parseLiveKpiEvent(JSON.stringify({ kpis: [] }));
    expect(typeof parsed?.ts).toBe('string');
    expect(parsed?.ts.length).toBeGreaterThan(0);
  });
});

/** Mock mínimo pero fiel de la API real de EventSource (open/message/error,
 * readyState, close) — suficiente para ejercitar `useLiveKpi` de punta a
 * punta sin un backend real. */
class MockEventSource {
  static instances: MockEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = MockEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emitOpen() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  emitError(terminal: boolean) {
    if (terminal) this.readyState = MockEventSource.CLOSED;
    this.onerror?.();
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
}

describe('useLiveKpi', () => {
  let originalEventSource: any;

  beforeEach(() => {
    originalEventSource = (globalThis as any).EventSource;
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
  });

  it('se conecta a /api/live/kpi al montar', () => {
    renderHook(() => useLiveKpi());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/live/kpi');
  });

  it('refleja connected:true y los kpis recibidos tras un evento real', async () => {
    const { result } = renderHook(() => useLiveKpi());
    const es = MockEventSource.instances[0];

    act(() => {
      es.emitOpen();
      es.emitMessage({
        tenant: 't1',
        ts: '2026-09-12T10:00:00Z',
        kpis: [{ name: 'tonelaje_movido', value: 12500, unit: 't/día', category: 'produccion' }],
      });
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
      expect(result.current.kpis).toEqual([
        { name: 'tonelaje_movido', value: 12500, unit: 't/día', category: 'produccion' },
      ]);
      expect(result.current.lastUpdate).toBe('2026-09-12T10:00:00Z');
    });
  });

  it('expone degraded:true cuando el backend cae a la BD primaria', async () => {
    const { result } = renderHook(() => useLiveKpi());
    const es = MockEventSource.instances[0];

    act(() => {
      es.emitMessage({ tenant: 't1', ts: '2026-09-12T10:00:02Z', kpis: [], degraded: true });
    });

    await waitFor(() => expect(result.current.degraded).toBe(true));
  });

  it('marca connected:false ante un error, sin tirar la conexión si no es terminal', async () => {
    const { result } = renderHook(() => useLiveKpi());
    const es = MockEventSource.instances[0];
    act(() => es.emitOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => es.emitError(false));
    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(es.closed).toBe(false);
  });

  it('cierra la conexión explícitamente ante un error terminal (readyState CLOSED, p.ej. 401)', () => {
    renderHook(() => useLiveKpi());
    const es = MockEventSource.instances[0];

    act(() => es.emitError(true));

    expect(es.closed).toBe(true);
  });

  it('cierra el EventSource al desmontar el componente', () => {
    const { unmount } = renderHook(() => useLiveKpi());
    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);

    unmount();

    expect(es.closed).toBe(true);
  });

  it('ignora un evento con JSON inválido sin romper el estado ya aplicado', async () => {
    const { result } = renderHook(() => useLiveKpi());
    const es = MockEventSource.instances[0];

    act(() => {
      es.emitMessage({ tenant: 't1', ts: '2026-09-12T10:00:00Z', kpis: [{ name: 'x', value: 1, unit: 'u', category: 'c' }] });
    });
    await waitFor(() => expect(result.current.kpis).not.toBeNull());

    act(() => es.emitMessage('esto no es json'));

    // El último estado válido se conserva -- un frame corrupto no borra los
    // datos ya mostrados en pantalla.
    expect(result.current.kpis).toEqual([{ name: 'x', value: 1, unit: 'u', category: 'c' }]);
  });
});
