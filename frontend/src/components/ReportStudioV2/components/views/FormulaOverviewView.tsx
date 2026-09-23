import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator, RotateCcw, AlertTriangle, CheckCircle2, Search, Unplug, Workflow,
} from 'lucide-react';
import { authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { log } from '../../../../lib/logger';

/* ─────────────────────────────────────────────────────────────────────────
   FORMULA OVERVIEW VIEW — ADR-187 Entregable B: vista de nivel superior con
   TODAS las fórmulas configuradas en el tenant (GET /api/mining/formulas),
   sin tener que entrar sensor por sensor en SensorManagementView. Mismo
   lenguaje visual que el resto del panel admin. Solo lectura -- alta/baja/
   edición de fórmulas sigue viviendo en SensorManagementView (por sensor),
   este es el "de un vistazo".
   ───────────────────────────────────────────────────────────────────────── */

interface FormulaOverviewRow {
  formula_id: string;
  sensor_id: string;
  sensor_code: string;
  sensor_name: string;
  formula_name: string;
  expression: string;
  output_channel_code: string;
  output_unit: string;
  warning_low: number | null;
  warning_high: number | null;
  error_low: number | null;
  error_high: number | null;
  enabled: boolean;
  last_value: number | null;
  last_status: 'ok' | 'warning' | 'error' | null;
  last_captured_at: string | null;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  ok: { label: 'OK', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  warning: { label: 'Warning', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  error: { label: 'Error', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
};

function authHeaders(): Record<string, string> {
  return sharedAuthHeaders();
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  return `hace ${Math.floor(hr / 24)} d`;
}

function FormulaOverviewView({ onOpenSensors, onOpenCalculo }: {
  onOpenSensors?: () => void;
  /** ADR-195: navega a la pestaña "Cálculo" ya apuntando al diagrama de la
   * fórmula elegida (ver openInCalculo más abajo). */
  onOpenCalculo?: () => void;
}) {
  const [rows, setRows] = useState<FormulaOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'warning' | 'error'>('all');
  // Distingue la carga inicial (pantalla completa "Cargando...") de los
  // refrescos de fondo (auto-refresh cada 12s + botón "Recargar"): sin esto,
  // loadAll() pondría loading=true en cada ciclo del setInterval y la tabla
  // entera parpadearía a la pantalla de carga cada 12s. Un ref (no state)
  // para que loadAll mantenga identidad estable y el useEffect de abajo no
  // se re-dispare. Mismo criterio que AdvancedSensors.tsx (hasLoadedOnce) y
  // KpiOperationsView.tsx (loading vs refreshing).
  const hasLoadedOnceRef = useRef(false);

  const loadAll = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/mining/formulas', { headers: authHeaders() });
      if (res.status === 401) {
        setError('Sesión expirada. Vuelva a iniciar sesión.');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setRows(Array.isArray(data?.formulas) ? data.formulas : []);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      log.error('FormulaOverviewView: fallo al cargar', err);
      setError('No se pudieron cargar las fórmulas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    // Auto-refresh: el evaluador de fórmulas del backend recalcula cada ~10s
    // (ver nota al pie de esta vista y ADR-187) — antes esta vista solo se
    // refrescaba al montar o con el botón "Recargar" manual, así que un
    // operador mirando la pantalla nunca veía los valores nuevos sin
    // refrescar a mano. 12s da margen sobre el ciclo del backend sin
    // machacarlo con requests innecesarios. El botón "Recargar" sigue
    // funcionando igual (llama a la misma loadAll bajo demanda).
    const interval = setInterval(loadAll, 12000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // ADR-195: el lienzo "Cálculo" lee su contexto (sensor/fórmula) de
  // localStorage (formula_ctx_v2, ver frontend/public/formula/app.js) --
  // mismo mecanismo que ya usan sus combos internos, así no hace falta tocar
  // el iframe ni pasarle props nuevas. sensor_type queda null a propósito:
  // esta vista no lo conoce, y app.js ya sabe resolver el diagrama igual
  // (getDiagramId() lee formula_id directo, sin depender del combo de tipo).
  const openInCalculo = useCallback((r: FormulaOverviewRow) => {
    try {
      localStorage.setItem('formula_ctx_v2', JSON.stringify({
        sensor_type: null,
        sensor_id: r.sensor_id,
        formula_id: r.formula_id,
        sensor_name: r.sensor_name,
        sensor_code: r.sensor_code,
        formula_name: r.formula_name,
      }));
    } catch { /* localStorage no disponible -- el lienzo simplemente abre sin contexto */ }
    onOpenCalculo?.();
  }, [onOpenCalculo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.last_status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.sensor_code.toLowerCase().includes(q) ||
        r.sensor_name.toLowerCase().includes(q) ||
        r.formula_name.toLowerCase().includes(q) ||
        r.expression.toLowerCase().includes(q) ||
        r.output_channel_code.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { ok: 0, warning: 0, error: 0, sin_datos: 0 };
    for (const r of rows) {
      if (!r.last_status) c.sin_datos++;
      else c[r.last_status]++;
    }
    return c;
  }, [rows]);

  if (loading) return (
    <div className="flex h-screen items-center justify-center text-slate-500 font-bold uppercase text-[10px] animate-pulse bg-slate-950/20">
      Cargando fórmulas...
    </div>
  );

  // Pantalla completa de error solo si nunca se cargó nada con éxito. Si el
  // auto-refresh de fondo falla de forma transitoria (red, backend caído un
  // instante) después de una carga previa exitosa, no tiene sentido tapar
  // la tabla ya cargada con un error de pantalla completa -- se mantiene la
  // tabla y se avisa con un banner inline (igual que AdvancedSensors.tsx).
  if (error && rows.length === 0) return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-slate-400 bg-slate-950/20">
      <AlertTriangle className="text-amber-400" size={32} />
      <p className="text-xs font-bold text-center max-w-md">{error}</p>
    </div>
  );

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950/20 p-2 lg:p-3 overflow-hidden">
      {error && rows.length > 0 && (
        <div className="mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-bold text-amber-300">
          <AlertTriangle size={13} className="shrink-0" />
          {error} — mostrando el último dato cargado.
        </div>
      )}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
            <Calculator className="text-indigo-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-100 uppercase tracking-tight">Fórmulas de Sensores</h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
              {rows.length} fórmulas · {counts.ok} OK · {counts.warning} warning · {counts.error} error
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenSensors && (
            <button type="button" onClick={onOpenSensors}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors">
              <Unplug size={13} /> Administrar sensores
            </button>
          )}
          <button type="button" onClick={loadAll}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors" title="Sincronizar">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" placeholder="Buscar por sensor, fórmula, canal..."
            className="w-full bg-slate-900 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex bg-slate-900 rounded-lg p-0.5 border border-white/5">
          {(['all', 'ok', 'warning', 'error'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1.5 text-[9px] font-black uppercase rounded ${statusFilter === s ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              {s === 'all' ? 'Todas' : s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-slate-900/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl flex flex-col">
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <Calculator size={32} className="text-slate-700 mb-3" />
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                {rows.length === 0 ? 'Sin fórmulas configuradas todavía' : 'Sin resultados para el filtro'}
              </p>
              {rows.length === 0 && onOpenSensors && (
                <button type="button" onClick={onOpenSensors}
                  className="mt-4 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest">
                  Crear la primera fórmula en Sensores →
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur">
                <tr className="border-b border-white/5">
                  <th className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase">Sensor</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">Fórmula</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">Último valor</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase text-center">Estado</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase text-center">Habilitada</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase text-right">Cuándo</th>
                  {onOpenCalculo && <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase text-center">Diagrama</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((r) => {
                  const meta = r.last_status ? (STATUS_META[r.last_status] || STATUS_META.ok) : null;
                  return (
                    <tr key={r.formula_id} className="hover:bg-white/5 transition-colors">
                      <td className="px-5 py-2.5">
                        <div className="text-[11px] font-black text-white">{r.sensor_name}</div>
                        <div className="text-[9px] font-mono text-indigo-300/70">{r.sensor_code}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-[10px] font-black text-slate-200">{r.formula_name}</div>
                        <div className="text-[9px] font-mono text-slate-500">{r.expression} → {r.output_channel_code}{r.output_unit ? ` (${r.output_unit})` : ''}</div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] font-mono text-white">
                        {r.last_value != null ? r.last_value.toFixed(3) : <span className="text-slate-600">sin datos</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {meta ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase border ${meta.bg} ${meta.color}`}>{meta.label}</span>
                        ) : (
                          <span className="text-[9px] text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {r.enabled ? (
                          <CheckCircle2 size={14} className="inline text-emerald-400" />
                        ) : (
                          <span className="text-[9px] text-slate-600 uppercase font-bold">Off</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[9px] text-slate-500 text-right">{timeAgo(r.last_captured_at)}</td>
                      {onOpenCalculo && (
                        <td className="px-3 py-2.5 text-center">
                          <button type="button" onClick={() => openInCalculo(r)}
                            title="Ver el diagrama de esta fórmula en Cálculo"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[9px] font-black uppercase tracking-wide transition-colors">
                            <Workflow size={11} /> Ver en Cálculo
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-3 bg-slate-900/80 border-t border-white/5 shrink-0">
          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest italic opacity-60">
            Evaluador corre cada ~10s sobre las fórmulas habilitadas · para crear/editar, entre a Sensores y expanda el dispositivo.
          </p>
        </div>
      </div>
    </div>
  );
}

export default memo(FormulaOverviewView);
