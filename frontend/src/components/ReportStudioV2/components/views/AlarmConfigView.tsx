import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing, Plus, Trash2, X, Save, RotateCcw, AlertTriangle, CheckCircle2,
  Mail, Webhook, Gauge, Radio, ShieldAlert,
} from 'lucide-react';
import { getSession, authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { log } from '../../../../lib/logger';
import { useI18n } from '../../../../i18n/I18nProvider';
import { requestConfirmation } from '../../../UI/ConfirmActionDialog';

/* ─────────────────────────────────────────────────────────────────────────
   ALARM CONFIG VIEW — Registro y mantenimiento de reglas de alarma +
   canales de notificación (email/webhook). Consume los endpoints reales de
   device_alarm_routes.cpp (reglas) y notification_routes.cpp (canales) —
   mismo lenguaje visual que UserManagementView/PermissionsManagementView
   (slate-900/950, font-black uppercase tracking-widest, indigo-600 primario,
   colores semánticos emerald/amber/rose/sky, lucide-react, backdrop-blur).
   ───────────────────────────────────────────────────────────────────────── */

interface AlarmRule {
  id: string;
  sensor_id: string | null;
  mining_sensor_id: string | null;
  rule_name: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  threshold: number;
  severity: 'info' | 'warning' | 'high' | 'critical';
  enabled: boolean;
}

interface NotificationChannel {
  channel_id: string;
  channel_type: 'email' | 'webhook';
  label: string;
  config: { to?: string; url?: string };
  min_severity: string;
  enabled: boolean;
}

interface Device {
  sensor_id: string;
  sensor_code: string;
  sensor_name: string;
}

// SPEC-016 (cierre del demo de gate R5, 2026-09-14): antes había que elegir
// el sensor "a ciegas" (solo código+nombre) y adivinar un umbral por consola
// mirando /api/mining/telemetry/summary aparte -- ahora el selector unifica
// AMBOS orígenes de sensor que acepta el backend (`sensor_id` real vía
// telemetry_fact, `mining_sensor_id` de referencia vía mining_sensors) con
// su valor conocido más reciente visible en la propia lista.
interface RealSensorSummary {
  id: string; // UUID real (= Device.sensor_id)
  code: string;
  name: string;
  last_value?: number;
  last_at?: string;
}
interface LegacySensor {
  id: number;
  name: string;
  current_value: number | null;
  status: string;
}
interface SensorOption {
  key: string;
  kind: 'real' | 'legacy';
  id: string | number;
  label: string;
  currentValue: number | null;
  /** 'live': dato real de telemetry_fact hace <15min (mismo umbral que el
   * evaluador de alarmas, ver ADR-186). 'stale': hay último valor real pero
   * más viejo -- el evaluador NO lo va a usar (evita alarmas sobre datos
   * congelados). 'reference': mining_sensors, sin timestamp por diseño --
   * el evaluador SIEMPRE lo usa tal cual esté. 'unknown': sin ningún dato. */
  freshness: 'live' | 'stale' | 'reference' | 'unknown';
  lastAt?: string;
}

// Etiquetas con caracteres Unicode reales (≥ ≤ > <) en vez de entidades
// HTML (&ge; &le;…). Antes se pintaban con dangerouslySetInnerHTML solo
// para decodificar esas entidades — innecesario y un sink de HTML evitable
// (auditoría 2026-07-19). Ahora renderizan como texto plano seguro de React.
const OPERATORS = [
  { value: 'gt', label: 'Mayor que (>)' },
  { value: 'gte', label: 'Mayor o igual (≥)' },
  { value: 'lt', label: 'Menor que (<)' },
  { value: 'lte', label: 'Menor o igual (≤)' },
  { value: 'eq', label: 'Igual a (=)' },
];

const SEVERITIES: { value: AlarmRule['severity']; label: string; color: string; bg: string }[] = [
  { value: 'info', label: 'Info', color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/30' },
  { value: 'warning', label: 'Advertencia', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  { value: 'high', label: 'Alta', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' },
  { value: 'critical', label: 'Crítica', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
];

function severityMeta(sev: string) {
  return SEVERITIES.find((s) => s.value === sev) || SEVERITIES[1];
}

function authHeaders(): Record<string, string> {
  // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
  // navegador adjunta sola. Aqui solo viaja el token CSRF del double-submit,
  // que el backend exige en toda peticion que mute estado.
  return sharedAuthHeaders();
}

function AlarmConfigView() {
  const { t } = useI18n();
  const session = getSession();
  const company = session?.company || '';

  const [rules, setRules] = useState<AlarmRule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [realSummary, setRealSummary] = useState<RealSensorSummary[]>([]);
  const [legacySensors, setLegacySensors] = useState<LegacySensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    rule_name: '', sensorKey: '', operator: 'gt', threshold: '', severity: 'warning',
  });
  const [sensorFilter, setSensorFilter] = useState('');
  const [savingRule, setSavingRule] = useState(false);

  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelForm, setChannelForm] = useState({
    channel_type: 'email' as 'email' | 'webhook', label: '', target: '', min_severity: 'warning',
  });
  const [savingChannel, setSavingChannel] = useState(false);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // El resumen de telemetría (last_value/last_at por sensor real) y los
      // sensores de referencia (mining_sensors) son "best-effort": si
      // fallan, el formulario sigue funcionando igual que antes (elegir por
      // código/nombre a secas), solo sin el valor conocido a la vista.
      const [rRes, cRes, dRes, summaryRes, legacyRes] = await Promise.all([
        fetch('/api/mining/alarms/rules', { headers: authHeaders() }),
        fetch('/api/mining/notifications/channels', { headers: authHeaders() }),
        fetch('/api/mining/devices', { headers: authHeaders() }),
        fetch('/api/mining/telemetry/summary?hours=24', { headers: authHeaders() }),
        fetch('/api/sensors/data', { headers: authHeaders() }),
      ]);
      if (rRes.status === 401 || cRes.status === 401) {
        setError('Sesión expirada. Vuelva a iniciar sesión.');
        return;
      }
      const rData = await rRes.json();
      const cData = await cRes.json();
      const dData = dRes.ok ? await dRes.json() : { devices: [] };
      const summaryData = summaryRes.ok ? await summaryRes.json().catch(() => null) : null;
      const legacyData = legacyRes.ok ? await legacyRes.json().catch(() => null) : null;
      setRules(Array.isArray(rData?.rules) ? rData.rules : []);
      setChannels(Array.isArray(cData?.channels) ? cData.channels : []);
      setDevices(Array.isArray(dData?.devices) ? dData.devices : []);
      setRealSummary(Array.isArray(summaryData?.sensors) ? summaryData.sensors : []);
      setLegacySensors(Array.isArray(legacyData?.sensors) ? legacyData.sensors : []);
    } catch (err) {
      log.error('AlarmConfigView: fallo al cargar', err);
      setError('No se pudo cargar la configuración de alarmas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const deviceLabel = useMemo(() => {
    const map = new Map(devices.map((d) => [d.sensor_id, d.sensor_code || d.sensor_name]));
    const legacyMap = new Map(legacySensors.map((s) => [String(s.id), `${s.name} (referencia)`]));
    return (sensorId: string | null, miningSensorId: string | null) => {
      if (sensorId) return map.get(sensorId) || sensorId.slice(0, 8);
      if (miningSensorId) return legacyMap.get(String(miningSensorId)) || `#${miningSensorId} (referencia)`;
      return '—';
    };
  }, [devices, legacySensors]);

  // SPEC-016: lista unificada de sensores elegibles con su valor conocido más
  // reciente a la vista -- reemplaza el flujo anterior de "elegir a ciegas y
  // adivinar el umbral por consola". `freshness` usa la misma ventana de
  // 15 min que el evaluador real (ADR-186) para que lo que se ve acá sea
  // consistente con lo que de verdad va a evaluar el backend.
  const sensorOptions = useMemo<SensorOption[]>(() => {
    const summaryById = new Map(realSummary.map((s) => [s.id, s]));
    const real: SensorOption[] = devices.map((d) => {
      const s = summaryById.get(d.sensor_id);
      const lastAtMs = s?.last_at ? Date.parse(s.last_at) : NaN;
      const isFresh = Number.isFinite(lastAtMs) && Date.now() - lastAtMs < 15 * 60 * 1000;
      const freshness: SensorOption['freshness'] =
        s?.last_value == null ? 'unknown' : isFresh ? 'live' : 'stale';
      return {
        key: `real:${d.sensor_id}`,
        kind: 'real',
        id: d.sensor_id,
        label: `${d.sensor_code} — ${d.sensor_name}`,
        currentValue: s?.last_value ?? null,
        freshness,
        lastAt: s?.last_at,
      };
    });
    const legacy: SensorOption[] = legacySensors.map((s) => ({
      key: `legacy:${s.id}`,
      kind: 'legacy',
      id: s.id,
      label: s.name,
      currentValue: s.current_value,
      freshness: s.current_value == null ? 'unknown' : 'reference',
    }));
    return [...real, ...legacy];
  }, [devices, realSummary, legacySensors]);

  const filteredSensorOptions = useMemo(() => {
    const q = sensorFilter.trim().toLowerCase();
    if (!q) return sensorOptions;
    return sensorOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [sensorOptions, sensorFilter]);

  const selectedSensor = useMemo(
    () => sensorOptions.find((o) => o.key === ruleForm.sensorKey) || null,
    [sensorOptions, ruleForm.sensorKey],
  );

  /** Autocompleta un umbral que la condición elegida YA cruza con el valor
   * conocido del sensor seleccionado -- para verificar que una regla se
   * dispara de verdad sin tener que adivinar un número a mano. Redondea a
   * un paso "limpio" (10% del valor, mínimo 1) para que quede legible. */
  const suggestTriggeringThreshold = () => {
    if (!selectedSensor || selectedSensor.currentValue == null) return;
    const v = selectedSensor.currentValue;
    const step = Math.max(Math.abs(v) * 0.1, 1);
    const byOperator: Record<string, number> = {
      gt: v - step, gte: v, lt: v + step, lte: v, eq: v,
    };
    const suggested = byOperator[ruleForm.operator] ?? v;
    setRuleForm((f) => ({ ...f, threshold: String(Number(suggested.toFixed(2))) }));
  };

  const createRule = async () => {
    if (!ruleForm.rule_name.trim() || !ruleForm.sensorKey || !ruleForm.threshold.trim()) {
      showToast('error', 'Complete nombre, sensor y umbral.');
      return;
    }
    if (!selectedSensor) {
      showToast('error', 'Seleccione un sensor válido.');
      return;
    }
    setSavingRule(true);
    try {
      const res = await fetch('/api/mining/alarms/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          rule_name: ruleForm.rule_name.trim(),
          ...(selectedSensor.kind === 'real'
            ? { sensor_id: selectedSensor.id }
            : { mining_sensor_id: selectedSensor.id }),
          operator: ruleForm.operator,
          threshold: Number(ruleForm.threshold),
          severity: ruleForm.severity,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showToast('success', 'Regla de alarma creada correctamente.');
      setShowRuleForm(false);
      setRuleForm({ rule_name: '', sensorKey: '', operator: 'gt', threshold: '', severity: 'warning' });
      setSensorFilter('');
      loadAll();
    } catch (err) {
      showToast('error', `No se pudo crear la regla: ${(err as Error).message}`);
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = async (id: string) => {
    if (!(await requestConfirmation(t('confirm.deleteAlarm')))) return;
    try {
      const res = await fetch(`/api/mining/alarms/rules/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('success', 'Regla eliminada.');
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      showToast('error', `No se pudo eliminar: ${(err as Error).message}`);
    }
  };

  const createChannel = async () => {
    if (!channelForm.label.trim() || !channelForm.target.trim()) {
      showToast('error', 'Complete etiqueta y destino del canal.');
      return;
    }
    setSavingChannel(true);
    try {
      const config = channelForm.channel_type === 'email'
        ? { to: channelForm.target.trim() }
        : { url: channelForm.target.trim() };
      const res = await fetch('/api/mining/notifications/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          channel_type: channelForm.channel_type,
          label: channelForm.label.trim(),
          config,
          min_severity: channelForm.min_severity,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showToast('success', 'Canal de notificación creado correctamente.');
      setShowChannelForm(false);
      setChannelForm({ channel_type: 'email', label: '', target: '', min_severity: 'warning' });
      loadAll();
    } catch (err) {
      showToast('error', `No se pudo crear el canal: ${(err as Error).message}`);
    } finally {
      setSavingChannel(false);
    }
  };

  const deleteChannel = async (id: string) => {
    if (!(await requestConfirmation(t('confirm.deleteChannel')))) return;
    try {
      const res = await fetch(`/api/mining/notifications/channels/${id}`, {
        method: 'POST', headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('success', 'Canal eliminado.');
      setChannels((prev) => prev.filter((c) => c.channel_id !== id));
    } catch (err) {
      showToast('error', `No se pudo eliminar: ${(err as Error).message}`);
    }
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center text-slate-500 font-bold uppercase text-[10px] animate-pulse bg-slate-950/20">
      Cargando configuración de alarmas...
    </div>
  );

  if (error) return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-slate-400 bg-slate-950/20">
      <AlertTriangle className="text-amber-400" size={32} />
      <p className="text-xs font-bold text-center max-w-md">{error}</p>
    </div>
  );

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950/20 p-2 lg:p-3 overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
            <BellRing className="text-rose-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-100 uppercase tracking-tight">Configuración de Alarmas</h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
              {company || 'EMPRESA NO IDENTIFICADA'} | {rules.length} Reglas · {channels.length} Canales
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          title="Sincronizar"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Reglas de alarma ── */}
        <div className="lg:col-span-7 flex flex-col min-h-0 bg-slate-900/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
            <h2 className="text-[11px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
              <Gauge size={14} className="text-indigo-400" /> Reglas de Umbral
            </h2>
            <button
              type="button"
              onClick={() => setShowRuleForm((v) => !v)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/20"
            >
              {showRuleForm ? <X size={12} /> : <Plus size={12} />}
              {showRuleForm ? 'Cancelar' : 'Nueva Regla'}
            </button>
          </div>

          {showRuleForm && (
            <div className="p-4 border-b border-white/5 bg-slate-950/40 space-y-3 shrink-0 animate-in fade-in slide-in-from-top-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Nombre de la Regla</label>
                  <input type="text" placeholder="Ej. Temperatura crítica chancadora"
                    className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                    value={ruleForm.rule_name} onChange={(e) => setRuleForm({ ...ruleForm, rule_name: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Sensor / Dispositivo</label>
                  <input
                    type="text"
                    placeholder="Buscar por nombre o código…"
                    className="w-full bg-slate-900 border border-white/10 rounded-t-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50 border-b-0"
                    value={sensorFilter}
                    onChange={(e) => setSensorFilter(e.target.value)}
                  />
                  <select
                    size={5}
                    className="w-full bg-slate-900 border border-white/10 rounded-b-lg px-1 py-1 text-[11px] text-white outline-none focus:border-indigo-500/50"
                    value={ruleForm.sensorKey}
                    onChange={(e) => setRuleForm({ ...ruleForm, sensorKey: e.target.value })}
                  >
                    {filteredSensorOptions.length === 0 && <option disabled value="">Sin coincidencias…</option>}
                    <optgroup label="Sensores en tiempo real (telemetry_fact)">
                      {filteredSensorOptions.filter((o) => o.kind === 'real').map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label} — {
                            o.freshness === 'live' ? `en vivo, ${o.currentValue}`
                            : o.freshness === 'stale' ? `sin dato reciente (últ. ${o.currentValue})`
                            : 'sin dato'
                          }
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Sensores de referencia (mining_sensors, valor fijo de demo)">
                      {filteredSensorOptions.filter((o) => o.kind === 'legacy').map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label} — valor de referencia {o.currentValue ?? 'sin dato'}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {selectedSensor && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-bold text-white">{selectedSensor.label}</div>
                        <div className="text-[9px] uppercase tracking-wide text-slate-500">
                          {selectedSensor.kind === 'real' ? 'Sensor real' : 'Sensor de referencia (demo)'}
                          {' · '}
                          {selectedSensor.freshness === 'live' && <span className="text-emerald-400">dato en vivo</span>}
                          {selectedSensor.freshness === 'stale' && <span className="text-amber-400">último dato viejo — el evaluador no lo usará</span>}
                          {selectedSensor.freshness === 'reference' && <span className="text-sky-400">valor de referencia fijo</span>}
                          {selectedSensor.freshness === 'unknown' && <span className="text-rose-400">sin ningún dato</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-sm font-black text-emerald-400">
                          {selectedSensor.currentValue ?? '—'}
                        </span>
                        <button
                          type="button"
                          disabled={selectedSensor.currentValue == null}
                          onClick={suggestTriggeringThreshold}
                          title="Completa el umbral con un valor que esta condición ya cruza con el dato actual — útil para verificar que la regla se dispara"
                          className="rounded-md bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-40 px-2 py-1 text-[9px] font-black uppercase text-white whitespace-nowrap"
                        >
                          Umbral que dispara ya
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Severidad</label>
                  <select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                    value={ruleForm.severity} onChange={(e) => setRuleForm({ ...ruleForm, severity: e.target.value })}>
                    {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Condición</label>
                  <select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                    value={ruleForm.operator} onChange={(e) => setRuleForm({ ...ruleForm, operator: e.target.value })}>
                    {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Umbral (valor numérico)</label>
                  <input type="number" step="any" placeholder="Ej. 85.5"
                    className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-emerald-400 outline-none focus:border-indigo-500/50"
                    value={ruleForm.threshold} onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })} />
                </div>
              </div>
              <button
                type="button"
                disabled={savingRule}
                onClick={createRule}
                className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2"
              >
                {savingRule ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
                {savingRule ? 'Guardando...' : 'Crear Regla'}
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {rules.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <ShieldAlert size={32} className="text-slate-700 mb-3" />
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Sin reglas configuradas</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur">
                  <tr className="border-b border-white/5">
                    <th className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase">Regla</th>
                    <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">Sensor</th>
                    <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">Condición</th>
                    <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase text-center">Severidad</th>
                    <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rules.map((rule) => {
                    const sev = severityMeta(rule.severity);
                    const opLabel = OPERATORS.find((o) => o.value === rule.operator)?.label || rule.operator;
                    return (
                      <tr key={rule.id} className="group hover:bg-white/5 transition-colors">
                        <td className="px-5 py-2.5">
                          <div className="text-[11px] font-black text-white uppercase tracking-tight leading-none">{rule.rule_name}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] font-mono text-indigo-300/80">{deviceLabel(rule.sensor_id, rule.mining_sensor_id)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] text-slate-300">{opLabel} {rule.threshold}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase border ${sev.bg} ${sev.color}`}>
                            {sev.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button type="button" onClick={() => deleteRule(rule.id)}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                            title="Eliminar regla">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Canales de notificación ── */}
        <div className="lg:col-span-5 flex flex-col min-h-0 bg-slate-900/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
            <h2 className="text-[11px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
              <Radio size={14} className="text-indigo-400" /> Canales de Notificación
            </h2>
            <button
              type="button"
              onClick={() => setShowChannelForm((v) => !v)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/20"
            >
              {showChannelForm ? <X size={12} /> : <Plus size={12} />}
              {showChannelForm ? 'Cancelar' : 'Nuevo Canal'}
            </button>
          </div>

          {showChannelForm && (
            <div className="p-4 border-b border-white/5 bg-slate-950/40 space-y-3 shrink-0 animate-in fade-in slide-in-from-top-2">
              <div className="flex bg-slate-950 rounded-lg p-0.5 border border-white/5">
                <button type="button"
                  onClick={() => setChannelForm({ ...channelForm, channel_type: 'email' })}
                  className={`flex-1 px-3 py-1.5 text-[9px] font-black uppercase rounded flex items-center justify-center gap-1.5 ${channelForm.channel_type === 'email' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <Mail size={11} /> Email
                </button>
                <button type="button"
                  onClick={() => setChannelForm({ ...channelForm, channel_type: 'webhook' })}
                  className={`flex-1 px-3 py-1.5 text-[9px] font-black uppercase rounded flex items-center justify-center gap-1.5 ${channelForm.channel_type === 'webhook' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <Webhook size={11} /> Webhook
                </button>
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Etiqueta</label>
                <input type="text" placeholder="Ej. Guardia turno noche"
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                  value={channelForm.label} onChange={(e) => setChannelForm({ ...channelForm, label: e.target.value })} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">
                  {channelForm.channel_type === 'email' ? 'Correo destino' : 'URL del webhook'}
                </label>
                <input type="text" placeholder={channelForm.channel_type === 'email' ? 'guardia@minera.com' : 'https://hooks.slack.com/...'}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-white outline-none focus:border-indigo-500/50"
                  value={channelForm.target} onChange={(e) => setChannelForm({ ...channelForm, target: e.target.value })} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Severidad mínima que dispara este canal</label>
                <select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                  value={channelForm.min_severity} onChange={(e) => setChannelForm({ ...channelForm, min_severity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <button
                type="button"
                disabled={savingChannel}
                onClick={createChannel}
                className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2"
              >
                {savingChannel ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
                {savingChannel ? 'Guardando...' : 'Crear Canal'}
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto p-3 space-y-2">
            {channels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <Radio size={32} className="text-slate-700 mb-3" />
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Sin canales configurados</p>
                <p className="text-[9px] text-slate-600 mt-1">Las alarmas solo se verán en pantalla (WebSocket)</p>
              </div>
            ) : (
              channels.map((ch) => {
                const sev = severityMeta(ch.min_severity);
                const Icon = ch.channel_type === 'email' ? Mail : Webhook;
                const dest = ch.channel_type === 'email' ? ch.config?.to : ch.config?.url;
                return (
                  <div key={ch.channel_id} className="group flex items-center gap-3 p-3 rounded-xl bg-slate-950/40 border border-white/5 hover:border-indigo-500/20 transition-all">
                    <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0">
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-black text-white uppercase tracking-tight truncate">{ch.label}</div>
                      <div className="text-[9px] text-slate-500 font-mono truncate">{dest}</div>
                    </div>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[7px] font-black uppercase border ${sev.bg} ${sev.color}`}>
                      &ge; {sev.label}
                    </span>
                    <button type="button" onClick={() => deleteChannel(ch.channel_id)}
                      className="shrink-0 p-1.5 rounded-lg bg-slate-800 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100"
                      title="Eliminar canal">
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-4 py-3 bg-slate-900/80 border-t border-white/5 shrink-0">
            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest italic opacity-60 flex items-center gap-1.5">
              <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
              WebSocket en pantalla siempre activo; email/webhook son adicionales.
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl border px-5 py-3 text-xs font-bold shadow-2xl backdrop-blur-md flex items-center gap-2 ${
          toast.type === 'success'
            ? 'border-emerald-400/40 bg-slate-900/95 text-emerald-100'
            : 'border-rose-400/40 bg-slate-900/95 text-rose-100'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default memo(AlarmConfigView);
