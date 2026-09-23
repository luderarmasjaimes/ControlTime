import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Unplug, Plus, X, Save, RotateCcw, Trash2, KeyRound, Send, MapPin,
  Activity, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, BellRing,
  ShieldAlert, Radio, SlidersHorizontal, Sigma, ToggleLeft, ToggleRight, Info,
  Search, FilterX, Wrench,
} from 'lucide-react';
import { authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { log } from '../../../../lib/logger';
import { requestConfirmation } from '../../../UI/ConfirmActionDialog';

/* ─────────────────────────────────────────────────────────────────────────
   SENSOR MANAGEMENT VIEW — Registro/administración de dispositivos (ADR-034
   device_alarm_routes.cpp), test de conexión y parámetros (zona/geo/label/
   serie/id externo). Mismo lenguaje visual que AlarmConfigView/
   UserManagementView (slate-900/950, font-black uppercase tracking-widest,
   indigo-600 primario, lucide-react, backdrop-blur). Los umbrales de alarma
   NO se duplican acá — el botón "Configurar umbrales" navega a AlarmConfig
   (ya existente) vía `onOpenAlarmConfig`.
   ───────────────────────────────────────────────────────────────────────── */

interface Device {
  sensor_id: string;
  sensor_code: string;
  sensor_name: string;
  sensor_type: string;
  protocol: string;
  connection_status: string;
  last_seen_at: string | null;
  revoked: boolean;
  has_credential: boolean;
  unit: string | null;
  zone_id: number | null;
  lat: number | null;
  lng: number | null;
  label: string | null;
  serial_number: string | null;
  external_id: string | null;
  // SPEC-027 (T10) / ADR-192: metadatos ligeros de trazabilidad
  // directo/gateway -- nullable, no cambia el flujo de ingesta/autenticación.
  connection_mode: 'direct' | 'gateway' | null;
  gateway_label: string | null;
}

// SPEC-027 (T11) / ADR-188: catálogo real de tipo de sensor
// (GET /api/mining/sensor-types, sensor_type_def -- ya existe desde
// sensor_type_catalog_routes.cpp) -- reemplaza la lista fija SENSOR_TYPES
// como fuente de opciones del selector de alta.
interface SensorTypeOption {
  type_code: string;
  display_name: string;
}

interface Zone {
  id: number;
  code: string;
  name_es: string;
  sort_order?: number;
  sensor_count?: number;
}

interface TrendPoint { t: string; v: number; }

interface IssuedKey {
  sensor_id: string;
  sensor_code: string;
  device_api_key: string;
}

interface FormulaParameter {
  param_key: string;
  data_type: string;
  default_value: unknown;
  is_required: boolean;
  sort_order: number;
  description_key: string | null;
  value: unknown;
}

interface SensorFormula {
  formula_id: string;
  formula_name: string;
  expression: string;
  output_channel_code: string;
  output_unit: string;
  warning_low: number | null;
  warning_high: number | null;
  error_low: number | null;
  error_high: number | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface FormulaResult {
  channel_code: string;
  captured_at: string;
  value_numeric: number | null;
  status: 'ok' | 'warning' | 'error';
}

// ADR-189: catálogo de plantillas de fórmula de calibración geotécnica
// (GET /api/mining/formula-templates) -- reproducción de las 23 familias del
// rule chain legado ThingsBoard "PiezometerRC-V2" sobre el motor real.
interface FormulaTemplateParam {
  param_key: string;
  is_required: boolean;
  default_value: number | string | null;
}
interface FormulaTemplate {
  template_code: string;
  display_name: string;
  instrument_family: string;
  description: string | null;
  requires_geometry: boolean;
  output_unit: string;
  input_channels: string[];
  parameters: FormulaTemplateParam[];
  output_channels: { output_channel_code: string }[];
}

const RESULT_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  ok: { label: 'OK', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  warning: { label: 'Warning', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  error: { label: 'Error', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
};

function authHeaders(): Record<string, string> {
  // Igual que AlarmConfigView: cookie httpOnly + Bearer en memoria cuando
  // hay sesión, más el token CSRF de double-submit para el fallback de
  // cookie. Válido para TODAS las llamadas de esta pantalla salvo el envío
  // de lectura de prueba (ver sendTestReading) -- esa usa la API key del
  // dispositivo, no la sesión del admin.
  return sharedAuthHeaders();
}

// SPEC-027 (T10) / ADR-192: modo de conexión directo/gateway -- solo
// metadatos de trazabilidad, no cambia el flujo de ingesta/autenticación
// (ver comentario en el ALTER TABLE de db_scripts/102).
const CONNECTION_MODES: { value: 'direct' | 'gateway'; label: string }[] = [
  { value: 'direct', label: 'Directo' },
  { value: 'gateway', label: 'Por gateway' },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  online: { label: 'En línea', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  unknown: { label: 'Sin datos', color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/30' },
  offline: { label: 'Sin conexión', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
};

function statusMeta(status: string) {
  return STATUS_META[status] || STATUS_META.unknown;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  return `hace ${Math.floor(hr / 24)} d`;
}

// POST /api/mining/telemetry se autentica SOLO por X-Device-Key, no por
// sesión -- a diferencia de authHeaders()/fetch normal de esta pantalla,
// esta llamada NO debe llevar cookies ni Authorization: si la pestaña tiene
// una sesión de admin activa (que sí las lleva), el backend la detecta como
// auth por cookie y exige X-CSRF-Token en cualquier POST (router.cpp,
// ADR-082) -- un check que no tiene sentido para una llamada de dispositivo
// y que un dispositivo real nunca dispararía. Reproducido en vivo mientras
// se armaba external-api-test-page/phone-sensor-test.html (ver
// deviceFetch() ahí, mismo patrón).
async function sendDeviceTestReading(apiKey: string, value: number): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch('/api/mining/telemetry', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Device-Key': apiKey },
      body: JSON.stringify({ value }),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { network_or_cors_error: String(err) } };
  }
}

// ADR-189: POST /api/mining/telemetry/multi -- mismo criterio de auth por
// X-Device-Key/credentials:'omit' que sendDeviceTestReading, pero manda 2-3
// canales nombrados de una vez (Freq/Temp/Press) en vez de un solo `value` --
// exclusivo de sensores que ya declararon sensor_input_channel_def (al
// aplicar una plantilla, ver applyFormulaTemplate).
async function sendMultiChannelTestReading(
  apiKey: string,
  channels: Record<string, number>,
): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch('/api/mining/telemetry/multi', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Device-Key': apiKey },
      body: JSON.stringify({ channels }),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { network_or_cors_error: String(err) } };
  }
}

function SensorManagementView({ onOpenAlarmConfig }: { onOpenAlarmConfig?: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    sensor_code: '', sensor_name: '', sensor_type: '', unit: '',
  });
  const [registering, setRegistering] = useState(false);

  // SPEC-027 (T11) / ADR-188: catálogo real de tipo de sensor, cargado desde
  // GET /api/mining/sensor-types (sensor_type_def) -- reemplaza la lista
  // fija SENSOR_TYPES como fuente de opciones del selector de alta.
  const [sensorTypeCatalog, setSensorTypeCatalog] = useState<SensorTypeOption[]>([]);

  const [issuedKey, setIssuedKey] = useState<IssuedKey | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    zone_id: '', lat: '', lng: '', label: '', serial_number: '', external_id: '',
    // SPEC-027 (T10): '' = sin especificar (no se manda en el PUT, ver saveEdit).
    connection_mode: '' as '' | 'direct' | 'gateway', gateway_label: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [trend, setTrend] = useState<{ loading: boolean; error: string | null; points: TrendPoint[] }>({
    loading: false, error: null, points: [],
  });

  // ADR-187 (motor de fórmulas): pestañas del panel expandido -- "datos" es
  // lo que ya existía (parámetros de sensors + tendencia real); "parametros"
  // y "formulas" son las nuevas.
  const [detailTab, setDetailTab] = useState<'datos' | 'parametros' | 'formulas'>('datos');

  const [parameters, setParameters] = useState<FormulaParameter[]>([]);
  const [paramsLoading, setParamsLoading] = useState(false);
  const [newParam, setNewParam] = useState({ param_key: '', data_type: 'numeric', value: '' });
  const [savingParam, setSavingParam] = useState(false);

  const [formulas, setFormulas] = useState<SensorFormula[]>([]);
  const [formulasLoading, setFormulasLoading] = useState(false);
  const [showFormulaForm, setShowFormulaForm] = useState(false);
  const [formulaForm, setFormulaForm] = useState({
    formula_name: '', expression: '', output_channel_code: '', output_unit: '',
    warning_low: '', warning_high: '', error_low: '', error_high: '',
  });
  const [savingFormula, setSavingFormula] = useState(false);
  const [formulaError, setFormulaError] = useState<string | null>(null);

  const [formulaResults, setFormulaResults] = useState<FormulaResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  // ADR-189: aplicar una plantilla del catálogo (canales de entrada +
  // parámetros de calibración + N fórmulas de salida de una vez).
  const [templates, setTemplates] = useState<FormulaTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState('');
  const [templateParamValues, setTemplateParamValues] = useState<Record<string, string>>({});
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // ADR-189: tras aplicar una plantilla, se sabe qué canales crudos declaró
  // (Freq/Temp/Press) -- se usa para ofrecer el envío de una prueba
  // multicanal real sin tener que consultarlo aparte.
  const [appliedTemplateChannels, setAppliedTemplateChannels] =
    useState<{ sensorId: string; channels: string[] } | null>(null);
  const [multiChannelValues, setMultiChannelValues] = useState<Record<string, string>>({});
  const [multiSending, setMultiSending] = useState(false);
  const [multiResult, setMultiResult] = useState<{ ok: boolean; text: string } | null>(null);

  // ADR-208: panel de administración de zonas mineras (crear/renombrar/
  // borrar) -- antes solo existía el dropdown de reasignación a una zona
  // YA sembrada por db_scripts/54.
  const [showZonesPanel, setShowZonesPanel] = useState(false);
  const [zoneForm, setZoneForm] = useState({ code: '', name_es: '' });
  const [savingZone, setSavingZone] = useState(false);
  const [zoneFormError, setZoneFormError] = useState<string | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<number | null>(null);
  const [zoneEditForm, setZoneEditForm] = useState({ code: '', name_es: '' });
  const [busyZoneId, setBusyZoneId] = useState<number | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dRes, zRes, tRes] = await Promise.all([
        fetch('/api/mining/devices', { headers: authHeaders() }),
        // ADR-208: CRUD real de zonas -- reemplaza el subconjunto de solo
        // lectura que antes se tomaba de wizard/catalog (mismo `sensor_zones`,
        // pero este endpoint además trae sensor_count, necesario para el
        // panel de administración de zonas de más abajo).
        fetch('/api/mining/zones', { headers: authHeaders() }),
        // SPEC-027 (T11) / ADR-188: catálogo real de sensor_type -- ya
        // existía el endpoint desde sensor_type_catalog_routes.cpp, esta
        // pantalla simplemente no lo consumía todavía.
        fetch('/api/mining/sensor-types', { headers: authHeaders() }),
      ]);
      if (dRes.status === 401) {
        setError('Sesión expirada. Vuelva a iniciar sesión.');
        return;
      }
      const dData = await dRes.json();
      const zData = zRes.ok ? await zRes.json() : { zones: [] };
      const tData = tRes.ok ? await tRes.json() : { sensor_types: [] };
      setDevices(Array.isArray(dData?.devices) ? dData.devices : []);
      const zoneList: Zone[] = Array.isArray(zData?.zones)
        ? zData.zones.map((z: any) => ({
            id: z.zone_id, code: z.code, name_es: z.name_es,
            sort_order: z.sort_order, sensor_count: z.sensor_count,
          }))
        : [];
      setZones(zoneList);
      const catalog: SensorTypeOption[] = Array.isArray(tData?.sensor_types)
        ? tData.sensor_types.map((t: any) => ({ type_code: t.type_code, display_name: t.display_name || t.type_code }))
        : [];
      setSensorTypeCatalog(catalog);
      // Default del formulario de alta: el primer tipo del catálogo real,
      // en vez del 'vibration' hardcodeado que ya no existe como fuente de
      // verdad (ver hallazgo ADR-189: un tenant real trae decenas de tipos
      // que esa lista fija ni conocía).
      setRegisterForm((prev) => (prev.sensor_type === '' && catalog.length > 0
        ? { ...prev, sensor_type: catalog[0].type_code }
        : prev));
    } catch (err) {
      log.error('SensorManagementView: fallo al cargar', err);
      setError('No se pudo cargar el listado de dispositivos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const zoneLabel = useMemo(() => {
    const map = new Map(zones.map((z) => [z.id, z.name_es]));
    return (id: number | null) => (id != null ? map.get(id) || `Zona ${id}` : '—');
  }, [zones]);

  // Filtros de la tabla de sensores: búsqueda por texto + tipo/zona/estado.
  // Los tipos y zonas de las opciones se derivan de los dispositivos
  // REALMENTE cargados (no del catálogo `sensorTypeCatalog`, que alimenta el
  // selector de alta -- ver SPEC-027 T11 -- pero un tenant real puede tener
  // sensor_type legados que ni siquiera están en ese catálogo, ver ADR-189).
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'unknown' | 'offline' | 'revoked'>('all');

  const availableTypes = useMemo(
    () => Array.from(new Set(devices.map((d) => d.sensor_type).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [devices],
  );
  const availableZones = useMemo(() => {
    const ids = Array.from(new Set(devices.map((d) => d.zone_id)));
    const withZone = ids.filter((id): id is number => id != null)
      .sort((a, b) => zoneLabel(a).localeCompare(zoneLabel(b)))
      .map((id) => ({ value: String(id), label: zoneLabel(id) }));
    const hasUnzoned = ids.includes(null);
    return hasUnzoned ? [...withZone, { value: 'none', label: 'Sin zona asignada' }] : withZone;
  }, [devices, zoneLabel]);

  const filteredDevices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return devices.filter((d) => {
      if (filterType !== 'all' && d.sensor_type !== filterType) return false;
      if (filterZone !== 'all') {
        if (filterZone === 'none' ? d.zone_id != null : String(d.zone_id) !== filterZone) return false;
      }
      if (filterStatus !== 'all') {
        if (filterStatus === 'revoked') {
          if (!d.revoked) return false;
        } else if (d.connection_status !== filterStatus) {
          return false;
        }
      }
      if (!q) return true;
      return (
        d.sensor_code.toLowerCase().includes(q) ||
        d.sensor_name.toLowerCase().includes(q) ||
        d.sensor_type.toLowerCase().includes(q) ||
        (d.label || '').toLowerCase().includes(q) ||
        (d.serial_number || '').toLowerCase().includes(q) ||
        (d.external_id || '').toLowerCase().includes(q)
      );
    });
  }, [devices, searchQuery, filterType, filterZone, filterStatus]);

  const hasActiveFilters = searchQuery.trim() !== '' || filterType !== 'all' || filterZone !== 'all' || filterStatus !== 'all';
  const clearFilters = () => {
    setSearchQuery(''); setFilterType('all'); setFilterZone('all'); setFilterStatus('all');
  };

  const registerDevice = async () => {
    if (!registerForm.sensor_code.trim() || !registerForm.sensor_name.trim()) {
      showToast('error', 'Complete código y nombre del sensor.');
      return;
    }
    setRegistering(true);
    try {
      const res = await fetch('/api/mining/devices/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          sensor_code: registerForm.sensor_code.trim(),
          sensor_name: registerForm.sensor_name.trim(),
          sensor_type: registerForm.sensor_type,
          unit: registerForm.unit.trim() || undefined,
          protocol: 'http_push',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showToast('success', 'Sensor registrado. Guarde la API key ahora — no se puede recuperar después.');
      setIssuedKey({ sensor_id: data.sensor_id, sensor_code: registerForm.sensor_code.trim(), device_api_key: data.device_api_key });
      setTestResult(null);
      setShowRegisterForm(false);
      setRegisterForm({
        sensor_code: '', sensor_name: '',
        sensor_type: sensorTypeCatalog[0]?.type_code || '', unit: '',
      });
      loadAll();
    } catch (err) {
      showToast('error', `No se pudo registrar el sensor: ${(err as Error).message}`);
    } finally {
      setRegistering(false);
    }
  };

  // ADR-208: crear una zona minera nueva (POST /api/mining/zones).
  const createZone = async () => {
    const code = zoneForm.code.trim().toUpperCase();
    const nameEs = zoneForm.name_es.trim();
    if (!code || !nameEs) {
      setZoneFormError('Complete código y nombre de la zona.');
      return;
    }
    setSavingZone(true);
    setZoneFormError(null);
    try {
      const res = await fetch('/api/mining/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ code, name_es: nameEs }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error === 'zone_code_ya_existe'
          ? `Ya existe una zona con el código "${code}".`
          : (data?.error || `HTTP ${res.status}`));
      }
      showToast('success', `Zona "${nameEs}" creada.`);
      setZoneForm({ code: '', name_es: '' });
      loadAll();
    } catch (err) {
      setZoneFormError((err as Error).message);
    } finally {
      setSavingZone(false);
    }
  };

  const startEditZone = (zone: Zone) => {
    setEditingZoneId(zone.id);
    setZoneEditForm({ code: zone.code, name_es: zone.name_es });
  };

  // ADR-208: renombrar/recodificar una zona existente (PUT /api/mining/zones/{id}).
  const saveZoneEdit = async (zoneId: number) => {
    const code = zoneEditForm.code.trim().toUpperCase();
    const nameEs = zoneEditForm.name_es.trim();
    if (!code || !nameEs) {
      showToast('error', 'Complete código y nombre de la zona.');
      return;
    }
    setBusyZoneId(zoneId);
    try {
      const res = await fetch(`/api/mining/zones/${zoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ code, name_es: nameEs }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error === 'zone_code_ya_existe'
          ? `Ya existe una zona con el código "${code}".`
          : (data?.error || `HTTP ${res.status}`));
      }
      showToast('success', 'Zona actualizada.');
      setEditingZoneId(null);
      loadAll();
    } catch (err) {
      showToast('error', `No se pudo actualizar la zona: ${(err as Error).message}`);
    } finally {
      setBusyZoneId(null);
    }
  };

  // ADR-208: borrar una zona (DELETE /api/mining/zones/{id}) -- los sensores
  // que la tenían asignada quedan "Sin zona asignada" (ON DELETE SET NULL,
  // ver handleDeleteZone en el backend), no se pierden ni se bloquean.
  const deleteZone = async (zone: Zone) => {
    const warn = zone.sensor_count && zone.sensor_count > 0
      ? ` ${zone.sensor_count} sensor(es) asignado(s) quedarán "Sin zona asignada".`
      : '';
    if (!(await requestConfirmation(`¿Eliminar la zona "${zone.name_es}"?${warn}`))) return;
    setBusyZoneId(zone.id);
    try {
      const res = await fetch(`/api/mining/zones/${zone.id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showToast('success', `Zona "${zone.name_es}" eliminada.`);
      loadAll();
    } catch (err) {
      showToast('error', `No se pudo eliminar la zona: ${(err as Error).message}`);
    } finally {
      setBusyZoneId(null);
    }
  };

  const rotateKey = async (device: Device) => {
    if (!(await requestConfirmation('Esto invalida la API key actual del dispositivo -- cualquier integración que la use dejará de funcionar hasta que se actualice. ¿Continuar?'))) return;
    setBusyId(device.sensor_id);
    try {
      const res = await fetch(`/api/mining/devices/${device.sensor_id}/rotate-key`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showToast('success', 'Nueva API key emitida. Guárdela ahora.');
      setIssuedKey({ sensor_id: device.sensor_id, sensor_code: device.sensor_code, device_api_key: data.device_api_key });
      setTestResult(null);
      loadAll();
    } catch (err) {
      showToast('error', `No se pudo rotar la key: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  // Recalibración/reset remoto (pedido explícito 2026-09-18). Downlink real
  // solo entrega el comando si sensors.protocol es 'mqtt' (publica al
  // broker) o 'http_push' (el dispositivo lo recoge en su próximo poll a
  // GET /api/mining/telemetry/commands, ver frontend/public/phone-sensor/
  // para el caso del smartphone de prueba) -- cualquier otro protocolo
  // (legacy_tls/modbus/opcua) responde con un error explícito, no un éxito
  // simulado, porque escribir a ciegas un registro Modbus/NodeId OPC UA de
  // un dispositivo real sin su ficha técnica es peligroso.
  const sendCommand = async (device: Device, commandType: 'recalibrate' | 'reset_factory' | 'reconfigure') => {
    const reason = window.prompt(
      `Motivo/justificación obligatorio para "${commandType}" en "${device.sensor_code}":`,
    );
    if (reason == null) return; // cancelado
    if (!reason.trim()) {
      showToast('error', 'El motivo es obligatorio -- no se envió el comando.');
      return;
    }
    if (!(await requestConfirmation(
      `¿Enviar "${commandType}" a "${device.sensor_code}"? Esta acción queda auditada con el motivo que ingresaste.`,
    ))) return;
    setBusyId(device.sensor_id);
    try {
      const res = await fetch(`/api/mining/devices/${device.sensor_id}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ command_type: commandType, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.status === 'failed') {
        showToast('error', `Comando #${data.command_id} no se pudo entregar: ${data.detail}`);
      } else if (data.status === 'pending') {
        showToast('success', `Comando #${data.command_id} encolado -- se entrega cuando el dispositivo consulte.`);
      } else {
        showToast('success', `Comando #${data.command_id}: ${data.detail}`);
      }
    } catch (err) {
      showToast('error', `No se pudo enviar el comando: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const revokeDevice = async (device: Device) => {
    if (!(await requestConfirmation(`¿Revocar el sensor "${device.sensor_code}"? Dejará de aceptar lecturas hasta que se le emita una key nueva.`))) return;
    setBusyId(device.sensor_id);
    try {
      const res = await fetch(`/api/mining/devices/${device.sensor_id}`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('success', 'Sensor revocado.');
      if (issuedKey?.sensor_id === device.sensor_id) setIssuedKey(null);
      loadAll();
    } catch (err) {
      showToast('error', `No se pudo revocar: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const loadTrend = useCallback(async (sensorId: string) => {
    setTrend({ loading: true, error: null, points: [] });
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      const url = `/api/mining/telemetry/wizard/query?sensor_ids=${sensorId}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&agg=hourly`;
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const points: TrendPoint[] = Array.isArray(data?.series)
        ? data.series.map((r: any) => ({ t: r.t, v: r.v })) : [];
      setTrend({ loading: false, error: null, points });
    } catch (err) {
      setTrend({ loading: false, error: (err as Error).message, points: [] });
    }
  }, []);

  const toggleExpand = (device: Device) => {
    if (expandedId === device.sensor_id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(device.sensor_id);
    setDetailTab('datos');
    setParameters([]);
    setFormulas([]);
    setFormulaResults([]);
    setShowFormulaForm(false);
    setFormulaError(null);
    setEditForm({
      zone_id: device.zone_id != null ? String(device.zone_id) : '',
      lat: device.lat != null ? String(device.lat) : '',
      lng: device.lng != null ? String(device.lng) : '',
      label: device.label || '',
      serial_number: device.serial_number || '',
      external_id: device.external_id || '',
      connection_mode: device.connection_mode || '',
      gateway_label: device.gateway_label || '',
    });
    loadTrend(device.sensor_id);
  };

  const saveEdit = async (device: Device) => {
    setSavingEdit(true);
    try {
      const body: Record<string, unknown> = {};
      if (editForm.zone_id.trim() !== '') body.zone_id = Number(editForm.zone_id);
      if (editForm.lat.trim() !== '') body.lat = Number(editForm.lat);
      if (editForm.lng.trim() !== '') body.lng = Number(editForm.lng);
      if (editForm.label.trim() !== '') body.label = editForm.label.trim();
      if (editForm.serial_number.trim() !== '') body.serial_number = editForm.serial_number.trim();
      if (editForm.external_id.trim() !== '') body.external_id = editForm.external_id.trim();
      // SPEC-027 (T10): '' = sin especificar -- no se manda (COALESCE del
      // lado backend deja el valor actual sin cambios, mismo criterio que
      // el resto de los campos de este body).
      if (editForm.connection_mode !== '') body.connection_mode = editForm.connection_mode;
      if (editForm.connection_mode === 'gateway' && editForm.gateway_label.trim() !== '') {
        body.gateway_label = editForm.gateway_label.trim();
      }
      const res = await fetch(`/api/mining/devices/${device.sensor_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showToast('success', 'Parámetros guardados.');
      loadAll();
    } catch (err) {
      showToast('error', `No se pudo guardar: ${(err as Error).message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  // ---- ADR-187: parámetros de fórmula (sensor_input_parameter_def/_value) ----
  const loadParameters = async (sensorId: string) => {
    setParamsLoading(true);
    try {
      const res = await fetch(`/api/mining/devices/${sensorId}/parameters`, { headers: authHeaders() });
      const data = await res.json();
      setParameters(Array.isArray(data?.parameters) ? data.parameters : []);
    } catch (err) {
      log.error('SensorManagementView: fallo al cargar parámetros', err);
    } finally {
      setParamsLoading(false);
    }
  };

  const saveParameter = async (sensorId: string) => {
    const key = newParam.param_key.trim();
    if (!key) { showToast('error', 'Complete la clave del parámetro.'); return; }
    setSavingParam(true);
    try {
      let value: unknown = newParam.value;
      if (newParam.data_type === 'numeric') {
        const n = Number(newParam.value);
        if (Number.isNaN(n)) { showToast('error', 'El valor debe ser numérico.'); setSavingParam(false); return; }
        value = n;
      } else if (newParam.data_type === 'boolean') {
        value = newParam.value === 'true';
      }
      const res = await fetch(`/api/mining/devices/${sensorId}/parameters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parameters: [{ param_key: key, data_type: newParam.data_type, value }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showToast('success', 'Parámetro guardado.');
      setNewParam({ param_key: '', data_type: 'numeric', value: '' });
      loadParameters(sensorId);
    } catch (err) {
      showToast('error', `No se pudo guardar el parámetro: ${(err as Error).message}`);
    } finally {
      setSavingParam(false);
    }
  };

  const deleteParameter = async (sensorId: string, paramKey: string) => {
    if (!(await requestConfirmation(
      `¿Eliminar el parámetro "${paramKey}"? Cualquier fórmula que lo use dejará de poder evaluarse hasta que se corrija.`
    ))) return;
    try {
      const res = await fetch(`/api/mining/devices/${sensorId}/parameters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parameters: [{ param_key: paramKey, delete: true }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('success', 'Parámetro eliminado.');
      loadParameters(sensorId);
    } catch (err) {
      showToast('error', `No se pudo eliminar: ${(err as Error).message}`);
    }
  };

  // ---- ADR-187: fórmulas (sensor_formula_def) + resultados (telemetry_multivariate) ----
  const loadFormulas = async (sensorId: string) => {
    setFormulasLoading(true);
    try {
      const res = await fetch(`/api/mining/devices/${sensorId}/formulas`, { headers: authHeaders() });
      const data = await res.json();
      setFormulas(Array.isArray(data?.formulas) ? data.formulas : []);
    } catch (err) {
      log.error('SensorManagementView: fallo al cargar fórmulas', err);
    } finally {
      setFormulasLoading(false);
    }
  };

  const loadFormulaResults = async (sensorId: string) => {
    setResultsLoading(true);
    try {
      const res = await fetch(`/api/mining/devices/${sensorId}/formula-results?limit=20`, { headers: authHeaders() });
      const data = await res.json();
      setFormulaResults(Array.isArray(data?.results) ? data.results : []);
    } catch (err) {
      log.error('SensorManagementView: fallo al cargar resultados', err);
    } finally {
      setResultsLoading(false);
    }
  };

  const loadFormulaTemplates = async () => {
    if (templates.length > 0) return; // catálogo global, no cambia por sensor -- se carga una vez
    setTemplatesLoading(true);
    try {
      const res = await fetch('/api/mining/formula-templates', { headers: authHeaders() });
      const data = await res.json();
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    } catch (err) {
      log.error('SensorManagementView: fallo al cargar plantillas de fórmula', err);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const openFormulasTab = (sensorId: string) => {
    setDetailTab('formulas');
    loadFormulas(sensorId);
    loadFormulaResults(sensorId);
    if (parameters.length === 0) loadParameters(sensorId);
    loadFormulaTemplates();
    // ADR-189: si este sensor YA tiene canales de entrada declarados (de
    // una plantilla aplicada en cualquier sesión anterior, no solo la
    // actual), ofrece "probar con datos reales" igual -- sin esto, recargar
    // la página o reabrir el panel hacía desaparecer esa sección aunque el
    // sensor siguiera siendo multicanal.
    (async () => {
      try {
        const res = await fetch(`/api/mining/devices/${sensorId}/input-channels`, { headers: authHeaders() });
        const data = await res.json();
        const channels = Array.isArray(data?.channels) ? data.channels : [];
        if (channels.length > 0) {
          setAppliedTemplateChannels({ sensorId, channels });
          setMultiChannelValues((prev) => (appliedTemplateChannels?.sensorId === sensorId ? prev : Object.fromEntries(channels.map((c: string) => [c, '']))));
        } else {
          setAppliedTemplateChannels((prev) => (prev?.sensorId === sensorId ? null : prev));
        }
      } catch (err) {
        log.error('SensorManagementView: fallo al cargar canales de entrada', err);
      }
    })();
  };

  const selectedTemplate = templates.find((t) => t.template_code === selectedTemplateCode) || null;

  const selectTemplate = (code: string) => {
    setSelectedTemplateCode(code);
    setTemplateError(null);
    const tpl = templates.find((t) => t.template_code === code);
    const initial: Record<string, string> = {};
    if (tpl) {
      for (const p of tpl.parameters) {
        initial[p.param_key] = p.default_value != null ? String(p.default_value) : '';
      }
    }
    setTemplateParamValues(initial);
  };

  const applyFormulaTemplate = async (sensorId: string) => {
    if (!selectedTemplate) {
      setTemplateError('Elija una plantilla.');
      return;
    }
    const paramValues: Record<string, number> = {};
    for (const p of selectedTemplate.parameters) {
      const raw = (templateParamValues[p.param_key] ?? '').trim();
      if (raw === '') {
        if (p.is_required && p.default_value == null) {
          setTemplateError(`Falta el parámetro requerido "${p.param_key}".`);
          return;
        }
        continue; // sin valor y sin requerir -- el backend usa el default de la plantilla
      }
      const num = Number(raw);
      if (Number.isNaN(num)) {
        setTemplateError(`El parámetro "${p.param_key}" debe ser numérico.`);
        return;
      }
      paramValues[p.param_key] = num;
    }
    setApplyingTemplate(true);
    setTemplateError(null);
    try {
      const res = await fetch(`/api/mining/devices/${sensorId}/formulas/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ template_code: selectedTemplate.template_code, param_values: paramValues }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
      const count = Array.isArray(data?.formula_ids) ? data.formula_ids.length : 0;
      showToast('success', `Plantilla aplicada: ${count} fórmula(s) creada(s)/actualizada(s). El evaluador las toma en el próximo ciclo (hasta ~10s).`);
      setAppliedTemplateChannels({ sensorId, channels: selectedTemplate.input_channels });
      setMultiChannelValues(Object.fromEntries(selectedTemplate.input_channels.map((c) => [c, ''])));
      setMultiResult(null);
      setShowTemplateForm(false);
      setSelectedTemplateCode('');
      setTemplateParamValues({});
      loadFormulas(sensorId);
      loadParameters(sensorId);
    } catch (err) {
      setTemplateError((err as Error).message);
    } finally {
      setApplyingTemplate(false);
    }
  };

  const sendMultiTestReading = async () => {
    if (!issuedKey || !appliedTemplateChannels) return;
    const channels: Record<string, number> = {};
    for (const c of appliedTemplateChannels.channels) {
      const raw = (multiChannelValues[c] ?? '').trim();
      if (raw === '') {
        setMultiResult({ ok: false, text: `Falta un valor para el canal "${c}".` });
        return;
      }
      const num = Number(raw);
      if (Number.isNaN(num)) {
        setMultiResult({ ok: false, text: `El canal "${c}" debe ser numérico.` });
        return;
      }
      channels[c] = num;
    }
    setMultiSending(true);
    setMultiResult(null);
    try {
      const r = await sendMultiChannelTestReading(issuedKey.device_api_key, channels);
      if (r.ok) {
        setMultiResult({ ok: true, text: `Aceptada (${r.body?.channels_written ?? 0} canal(es) escrito(s)). El motor de fórmulas calcula en el próximo ciclo (hasta ~10s).` });
      } else {
        setMultiResult({ ok: false, text: r.body?.error || `HTTP ${r.status}` });
      }
    } finally {
      setMultiSending(false);
    }
  };

  const createFormula = async (sensorId: string) => {
    const { formula_name, expression, output_channel_code } = formulaForm;
    if (!formula_name.trim() || !expression.trim() || !output_channel_code.trim()) {
      setFormulaError('Complete nombre, expresión y código de canal de salida.');
      return;
    }
    setSavingFormula(true);
    setFormulaError(null);
    try {
      const body: Record<string, unknown> = {
        formula_name: formula_name.trim(),
        expression: expression.trim(),
        output_channel_code: output_channel_code.trim(),
      };
      if (formulaForm.output_unit.trim()) body.output_unit = formulaForm.output_unit.trim();
      for (const k of ['warning_low', 'warning_high', 'error_low', 'error_high'] as const) {
        if (formulaForm[k].trim() !== '') body[k] = Number(formulaForm[k]);
      }
      const res = await fetch(`/api/mining/devices/${sensorId}/formulas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
      showToast('success', 'Fórmula creada. El evaluador la tomará en el próximo ciclo (hasta ~10s).');
      setShowFormulaForm(false);
      setFormulaForm({ formula_name: '', expression: '', output_channel_code: '', output_unit: '', warning_low: '', warning_high: '', error_low: '', error_high: '' });
      loadFormulas(sensorId);
    } catch (err) {
      setFormulaError((err as Error).message);
    } finally {
      setSavingFormula(false);
    }
  };

  const toggleFormulaEnabled = async (sensorId: string, formula: SensorFormula) => {
    try {
      const res = await fetch(`/api/mining/devices/${sensorId}/formulas/${formula.formula_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: !formula.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadFormulas(sensorId);
    } catch (err) {
      showToast('error', `No se pudo actualizar: ${(err as Error).message}`);
    }
  };

  const deleteFormula = async (sensorId: string, formula: SensorFormula) => {
    if (!(await requestConfirmation(`¿Eliminar la fórmula "${formula.formula_name}"?`))) return;
    try {
      const res = await fetch(`/api/mining/devices/${sensorId}/formulas/${formula.formula_id}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('success', 'Fórmula eliminada.');
      loadFormulas(sensorId);
    } catch (err) {
      showToast('error', `No se pudo eliminar: ${(err as Error).message}`);
    }
  };

  const sendTestReading = async () => {
    if (!issuedKey) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const value = Math.round(Math.random() * 1000) / 10;
      const r = await sendDeviceTestReading(issuedKey.device_api_key, value);
      if (r.ok) {
        setTestResult({ ok: true, text: `Aceptada (valor de prueba ${value}). El estado del sensor pasará a "En línea" en unos segundos.` });
        setTimeout(loadAll, 1500);
      } else {
        setTestResult({ ok: false, text: r.body?.error || `HTTP ${r.status}` });
      }
    } finally {
      setTestSending(false);
    }
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center text-slate-500 font-bold uppercase text-[10px] animate-pulse bg-slate-950/20">
      Cargando dispositivos...
    </div>
  );

  if (error) return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-slate-400 bg-slate-950/20">
      <AlertTriangle className="text-amber-400" size={32} />
      <p className="text-xs font-bold text-center max-w-md">{error}</p>
    </div>
  );

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950/20 p-2 lg:p-3 overflow-hidden overflow-y-auto">
      {/* Cabecera */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
            <Unplug className="text-indigo-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-100 uppercase tracking-tight">Administración de Sensores</h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
              {devices.length} Dispositivos · {devices.filter((d) => d.connection_status === 'online').length} En línea
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenAlarmConfig && (
            <button type="button" onClick={onOpenAlarmConfig}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors">
              <BellRing size={13} /> Configurar umbrales
            </button>
          )}
          <button type="button" onClick={loadAll}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors" title="Sincronizar">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {issuedKey && (
        <div className="mb-3 shrink-0 rounded-2xl border border-amber-400/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                API key de "{issuedKey.sensor_code}" — visible una sola vez
              </p>
              <code className="block mt-1.5 text-[11px] font-mono text-white bg-slate-950/60 rounded-lg px-3 py-2 break-all">
                {issuedKey.device_api_key}
              </code>
            </div>
            <button type="button" onClick={() => { setIssuedKey(null); setTestResult(null); }}
              className="shrink-0 p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" disabled={testSending} onClick={sendTestReading}
              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all">
              {testSending ? <RotateCcw size={12} className="animate-spin" /> : <Send size={12} />}
              {testSending ? 'Enviando...' : 'Probar ahora'}
            </button>
            {testResult && (
              <span className={`text-[10px] font-bold flex items-center gap-1.5 ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {testResult.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {testResult.text}
              </span>
            )}
          </div>
          <p className="text-[9px] text-amber-200/60 leading-relaxed">
            Esto inserta una lectura real (valor sintético) en el historial del sensor -- úselo solo
            para confirmar conectividad, no como lectura periódica.
          </p>
        </div>
      )}

      {/* Registro */}
      <div className="mb-3 shrink-0 bg-slate-900/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl">
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[11px] font-black text-slate-300 uppercase tracking-widest">Registrar sensor</h2>
          <button type="button" onClick={() => setShowRegisterForm((v) => !v)}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/20">
            {showRegisterForm ? <X size={12} /> : <Plus size={12} />}
            {showRegisterForm ? 'Cancelar' : 'Nuevo Sensor'}
          </button>
        </div>
        {showRegisterForm && (
          <div className="px-5 pb-4 space-y-3 border-t border-white/5 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Código único</label>
                <input type="text" placeholder="Ej. vib-chancadora-01"
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-white outline-none focus:border-indigo-500/50"
                  value={registerForm.sensor_code} onChange={(e) => setRegisterForm({ ...registerForm, sensor_code: e.target.value })} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Nombre</label>
                <input type="text" placeholder="Ej. Acelerómetro chancadora primaria"
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                  value={registerForm.sensor_name} onChange={(e) => setRegisterForm({ ...registerForm, sensor_name: e.target.value })} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Tipo</label>
                <select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                  value={registerForm.sensor_type} onChange={(e) => setRegisterForm({ ...registerForm, sensor_type: e.target.value })}>
                  {sensorTypeCatalog.length === 0 && <option value="">Cargando catálogo...</option>}
                  {/* Dato legado: si el valor actual no está en el catálogo real, se
                      muestra igual como opción seleccionable en vez de perderlo
                      silenciosamente (T11) -- las opciones NUEVAS siempre vienen
                      del catálogo, esta es solo la excepción para no perder datos
                      existentes que el catálogo todavía no cubre. */}
                  {registerForm.sensor_type &&
                    !sensorTypeCatalog.some((t) => t.type_code === registerForm.sensor_type) && (
                      <option value={registerForm.sensor_type}>{registerForm.sensor_type} (no está en el catálogo)</option>
                  )}
                  {sensorTypeCatalog.map((t) => <option key={t.type_code} value={t.type_code}>{t.display_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Unidad (opcional)</label>
                <input type="text" placeholder="Ej. m/s2"
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-white outline-none focus:border-indigo-500/50"
                  value={registerForm.unit} onChange={(e) => setRegisterForm({ ...registerForm, unit: e.target.value })} />
              </div>
            </div>
            <button type="button" disabled={registering} onClick={registerDevice}
              className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2">
              {registering ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
              {registering ? 'Registrando...' : 'Registrar Sensor'}
            </button>
          </div>
        )}
      </div>

      {/* Zonas mineras (ADR-208) */}
      <div className="mb-3 shrink-0 bg-slate-900/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl">
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[11px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
            <MapPin size={13} className="text-indigo-400" /> Zonas mineras ({zones.length})
          </h2>
          <button type="button" onClick={() => setShowZonesPanel((v) => !v)}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/20">
            {showZonesPanel ? <X size={12} /> : <Plus size={12} />}
            {showZonesPanel ? 'Cerrar' : 'Gestionar zonas'}
          </button>
        </div>
        {showZonesPanel && (
          <div className="px-5 pb-4 space-y-3 border-t border-white/5 pt-4">
            <div className="space-y-1.5">
              {zones.length === 0 && (
                <p className="text-[10px] text-slate-500">Sin zonas registradas todavía.</p>
              )}
              {zones.map((z) => (
                <div key={z.id} className="flex items-center gap-2 bg-slate-950/60 border border-white/5 rounded-lg px-3 py-2">
                  {editingZoneId === z.id ? (
                    <>
                      <input type="text" value={zoneEditForm.code}
                        onChange={(e) => setZoneEditForm({ ...zoneEditForm, code: e.target.value })}
                        placeholder="Código" className="w-32 bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50" />
                      <input type="text" value={zoneEditForm.name_es}
                        onChange={(e) => setZoneEditForm({ ...zoneEditForm, name_es: e.target.value })}
                        placeholder="Nombre" className="flex-1 bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white outline-none focus:border-indigo-500/50" />
                      <button type="button" disabled={busyZoneId === z.id} onClick={() => saveZoneEdit(z.id)}
                        className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors" title="Guardar">
                        <Save size={12} />
                      </button>
                      <button type="button" onClick={() => setEditingZoneId(null)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors" title="Cancelar">
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-[9px] font-mono font-bold text-indigo-300 bg-indigo-500/10 rounded px-1.5 py-0.5">{z.code}</span>
                      <span className="flex-1 text-[11px] text-white">{z.name_es}</span>
                      <span className="text-[9px] text-slate-500">
                        {z.sensor_count ?? 0} sensor{(z.sensor_count ?? 0) === 1 ? '' : 'es'}
                      </span>
                      <button type="button" onClick={() => startEditZone(z)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-500/20 hover:text-indigo-400 text-slate-400 transition-colors" title="Renombrar">
                        <Wrench size={12} />
                      </button>
                      <button type="button" disabled={busyZoneId === z.id} onClick={() => deleteZone(z)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 disabled:opacity-50 transition-colors" title="Eliminar">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 pt-2 border-t border-white/5">
              <input type="text" placeholder="Código (ej. TAJO-NORTE)"
                className="w-40 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-white outline-none focus:border-indigo-500/50"
                value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value })} />
              <input type="text" placeholder="Nombre (ej. Tajo Norte)"
                className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={zoneForm.name_es} onChange={(e) => setZoneForm({ ...zoneForm, name_es: e.target.value })} />
              <button type="button" disabled={savingZone} onClick={createZone}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shrink-0">
                {savingZone ? <RotateCcw size={12} className="animate-spin" /> : <Plus size={12} />}
                {savingZone ? 'Creando...' : 'Crear zona'}
              </button>
            </div>
            {zoneFormError && <p className="text-[10px] text-rose-400">{zoneFormError}</p>}
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="mb-3 shrink-0 bg-slate-900/40 border border-white/5 rounded-2xl backdrop-blur-xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Buscar por código, nombre, serie, ID externo..."
              className="w-full bg-slate-950 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-slate-200 outline-none focus:border-indigo-500/50">
            <option value="all">Todos los tipos</option>
            {availableTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterZone} onChange={(e) => setFilterZone(e.target.value)}
            className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-slate-200 outline-none focus:border-indigo-500/50">
            <option value="all">Todas las zonas</option>
            {availableZones.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
            className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-slate-200 outline-none focus:border-indigo-500/50">
            <option value="all">Todos los estados</option>
            <option value="online">En línea</option>
            <option value="unknown">Sin datos</option>
            <option value="offline">Sin conexión</option>
            <option value="revoked">Revocado</option>
          </select>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters}
              className="p-2 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
              title="Limpiar filtros">
              <FilterX size={14} />
            </button>
          )}
          <span className="ml-auto text-[9px] font-black text-slate-500 uppercase tracking-widest shrink-0">
            {filteredDevices.length} de {devices.length}
          </span>
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 min-h-0 bg-slate-900/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl flex flex-col">
        <div className="flex-1 overflow-auto">
          {devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <ShieldAlert size={32} className="text-slate-700 mb-3" />
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Sin sensores registrados</p>
            </div>
          ) : filteredDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <Search size={32} className="text-slate-700 mb-3" />
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-3">Sin resultados para estos filtros</p>
              <button type="button" onClick={clearFilters}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                <FilterX size={11} /> Limpiar filtros
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur">
                <tr className="border-b border-white/5">
                  <th className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase">Sensor</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">Tipo</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">Zona</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase text-center">Estado</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">Última lectura</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredDevices.map((device) => {
                  const status = statusMeta(device.connection_status);
                  const isExpanded = expandedId === device.sensor_id;
                  const isBusy = busyId === device.sensor_id;
                  return (
                    <React.Fragment key={device.sensor_id}>
                      <tr className={`group hover:bg-white/5 transition-colors cursor-pointer ${device.revoked ? 'opacity-50' : ''}`}
                        onClick={() => toggleExpand(device)}>
                        <td className="px-5 py-2.5">
                          <div className="text-[11px] font-black text-white uppercase tracking-tight leading-none">{device.sensor_name}</div>
                          <div className="text-[9px] font-mono text-indigo-300/70 mt-0.5">{device.sensor_code}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[10px] text-slate-300">{device.sensor_type}{device.unit ? ` (${device.unit})` : ''}</td>
                        <td className="px-3 py-2.5 text-[10px] text-slate-300">{zoneLabel(device.zone_id)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase border ${status.bg} ${status.color}`}>
                            {device.revoked ? 'Revocado' : status.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[10px] text-slate-400">{timeAgo(device.last_seen_at)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button type="button" disabled={isBusy} onClick={() => rotateKey(device)}
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-400 transition-colors disabled:opacity-40"
                              title="Rotar API key (para volver a probar la conexión)">
                              <KeyRound size={12} />
                            </button>
                            {!device.revoked && (
                              <button type="button" disabled={isBusy} onClick={() => sendCommand(device, 'recalibrate')}
                                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:bg-amber-500/20 hover:text-amber-400 transition-colors disabled:opacity-40"
                                title="Recalibrar / resetear remotamente (requiere motivo, queda auditado)">
                                <Wrench size={12} />
                              </button>
                            )}
                            {!device.revoked && (
                              <button type="button" disabled={isBusy} onClick={() => revokeDevice(device)}
                                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors disabled:opacity-40"
                                title="Revocar dispositivo">
                                <Trash2 size={12} />
                              </button>
                            )}
                            <button type="button" onClick={() => toggleExpand(device)}
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors">
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-950/40">
                          <td colSpan={6} className="px-5 py-4">
                            <div className="flex items-center gap-1.5 mb-4 border-b border-white/5 pb-0">
                              <button type="button" onClick={() => setDetailTab('datos')}
                                className={`px-3 py-2 text-[9px] font-black uppercase tracking-widest border-b-2 transition-colors ${detailTab === 'datos' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                                Datos y conexión
                              </button>
                              <button type="button" onClick={() => { setDetailTab('parametros'); loadParameters(device.sensor_id); }}
                                className={`px-3 py-2 text-[9px] font-black uppercase tracking-widest border-b-2 transition-colors flex items-center gap-1.5 ${detailTab === 'parametros' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                                <SlidersHorizontal size={11} /> Parámetros de fórmula
                              </button>
                              <button type="button" onClick={() => openFormulasTab(device.sensor_id)}
                                className={`px-3 py-2 text-[9px] font-black uppercase tracking-widest border-b-2 transition-colors flex items-center gap-1.5 ${detailTab === 'formulas' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                                <Sigma size={11} /> Fórmulas y resultados
                                {formulas.length > 0 && detailTab !== 'formulas' && (
                                  <span className="px-1 py-px rounded bg-slate-800 text-slate-400 text-[8px]">{formulas.length}</span>
                                )}
                              </button>
                            </div>

                            {detailTab === 'datos' && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              {/* Parámetros */}
                              <div>
                                <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                                  <MapPin size={12} className="text-indigo-400" /> Parámetros
                                </h3>
                                <div className="grid grid-cols-2 gap-2.5">
                                  <div>
                                    <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Zona</label>
                                    <select className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white outline-none focus:border-indigo-500/50"
                                      value={editForm.zone_id} onChange={(e) => setEditForm({ ...editForm, zone_id: e.target.value })}>
                                      <option value="">— sin asignar —</option>
                                      {zones.map((z) => <option key={z.id} value={z.id}>{z.name_es}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Etiqueta</label>
                                    <input type="text" className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white outline-none focus:border-indigo-500/50"
                                      value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                                  </div>
                                  <div>
                                    <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Latitud</label>
                                    <input type="number" step="any" className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                      value={editForm.lat} onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })} />
                                  </div>
                                  <div>
                                    <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Longitud</label>
                                    <input type="number" step="any" className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                      value={editForm.lng} onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })} />
                                  </div>
                                  <div>
                                    <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Número de serie</label>
                                    <input type="text" className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                      value={editForm.serial_number} onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })} />
                                  </div>
                                  <div>
                                    <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">ID externo</label>
                                    <input type="text" className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                      value={editForm.external_id} onChange={(e) => setEditForm({ ...editForm, external_id: e.target.value })} />
                                  </div>
                                  {/* SPEC-027 (T10) / ADR-192: metadatos ligeros de trazabilidad
                                      directo/gateway -- opcionales, sin default obligatorio, no
                                      tocan el flujo de ingesta/autenticación existente. */}
                                  <div>
                                    <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Modo de conexión</label>
                                    <select className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white outline-none focus:border-indigo-500/50"
                                      value={editForm.connection_mode}
                                      onChange={(e) => setEditForm({
                                        ...editForm,
                                        connection_mode: e.target.value as '' | 'direct' | 'gateway',
                                        gateway_label: e.target.value === 'gateway' ? editForm.gateway_label : '',
                                      })}>
                                      <option value="">— sin especificar —</option>
                                      {CONNECTION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Etiqueta del gateway</label>
                                    <input type="text" placeholder="Ej. GW-NORTE-03"
                                      disabled={editForm.connection_mode !== 'gateway'}
                                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                                      value={editForm.gateway_label} onChange={(e) => setEditForm({ ...editForm, gateway_label: e.target.value })} />
                                  </div>
                                </div>
                                <button type="button" disabled={savingEdit} onClick={() => saveEdit(device)}
                                  className="mt-3 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                  {savingEdit ? <RotateCcw size={11} className="animate-spin" /> : <Save size={11} />}
                                  {savingEdit ? 'Guardando...' : 'Guardar parámetros'}
                                </button>
                              </div>

                              {/* Tendencia */}
                              <div>
                                <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                                  <Activity size={12} className="text-indigo-400" /> Lecturas recientes (7 días, promedio horario)
                                </h3>
                                {trend.loading ? (
                                  <p className="text-[10px] text-slate-500">Cargando...</p>
                                ) : trend.error ? (
                                  <p className="text-[10px] text-rose-400">{trend.error}</p>
                                ) : trend.points.length === 0 ? (
                                  <p className="text-[10px] text-slate-500">Sin lecturas en los últimos 7 días. Los datos nuevos pueden tardar unos minutos en aparecer aquí (pipeline de agregación).</p>
                                ) : (
                                  (() => {
                                    const values = trend.points.map((p) => p.v);
                                    const min = Math.min(...values);
                                    const max = Math.max(...values);
                                    const avg = values.reduce((a, b) => a + b, 0) / values.length;
                                    const last = trend.points[trend.points.length - 1];
                                    return (
                                      <div className="space-y-2">
                                        <div className="grid grid-cols-3 gap-2">
                                          <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                                            <div className="text-[13px] font-mono font-black text-emerald-400">{min.toFixed(2)}</div>
                                            <div className="text-[8px] text-slate-500 uppercase">Mín</div>
                                          </div>
                                          <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                                            <div className="text-[13px] font-mono font-black text-sky-400">{avg.toFixed(2)}</div>
                                            <div className="text-[8px] text-slate-500 uppercase">Prom</div>
                                          </div>
                                          <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                                            <div className="text-[13px] font-mono font-black text-amber-400">{max.toFixed(2)}</div>
                                            <div className="text-[8px] text-slate-500 uppercase">Máx</div>
                                          </div>
                                        </div>
                                        <p className="text-[9px] text-slate-500">
                                          Última: <span className="font-mono text-slate-300">{last.v.toFixed(2)}</span> · {new Date(last.t).toLocaleString()}
                                        </p>
                                      </div>
                                    );
                                  })()
                                )}
                              </div>
                            </div>
                            )}

                            {detailTab === 'parametros' && (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div>
                                  <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                                    <SlidersHorizontal size={12} className="text-indigo-400" /> Parámetros configurados
                                  </h3>
                                  {paramsLoading ? (
                                    <p className="text-[10px] text-slate-500">Cargando...</p>
                                  ) : parameters.length === 0 ? (
                                    <p className="text-[10px] text-slate-500">Sin parámetros configurados todavía. Agregue uno abajo -- estarán disponibles como variables en las fórmulas de este sensor.</p>
                                  ) : (
                                    <div className="space-y-1.5">
                                      {parameters.map((p) => (
                                        <div key={p.param_key} className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-white/5">
                                          <div className="min-w-0 flex-1">
                                            <div className="text-[10px] font-mono font-black text-white">{p.param_key}</div>
                                            <div className="text-[9px] text-slate-500">
                                              {p.data_type} · valor: <span className="text-slate-300 font-mono">{p.value !== null && p.value !== undefined ? JSON.stringify(p.value) : (p.default_value !== null && p.default_value !== undefined ? `${JSON.stringify(p.default_value)} (default)` : '—')}</span>
                                            </div>
                                          </div>
                                          <button type="button" onClick={() => deleteParameter(device.sensor_id, p.param_key)}
                                            className="shrink-0 p-1.5 rounded-lg bg-slate-800 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 transition-colors">
                                            <Trash2 size={11} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                                    <Plus size={12} className="text-indigo-400" /> Agregar / actualizar parámetro
                                  </h3>
                                  <div className="grid grid-cols-2 gap-2.5">
                                    <div>
                                      <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Clave</label>
                                      <input type="text" placeholder="Ej. offset_calibracion"
                                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                        value={newParam.param_key} onChange={(e) => setNewParam({ ...newParam, param_key: e.target.value })} />
                                    </div>
                                    <div>
                                      <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Tipo</label>
                                      <select className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white outline-none focus:border-indigo-500/50"
                                        value={newParam.data_type} onChange={(e) => setNewParam({ ...newParam, data_type: e.target.value })}>
                                        <option value="numeric">numeric (usable en fórmulas)</option>
                                        <option value="text">text</option>
                                        <option value="boolean">boolean</option>
                                      </select>
                                    </div>
                                    <div className="col-span-2">
                                      <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Valor</label>
                                      {newParam.data_type === 'boolean' ? (
                                        <select className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white outline-none focus:border-indigo-500/50"
                                          value={newParam.value} onChange={(e) => setNewParam({ ...newParam, value: e.target.value })}>
                                          <option value="">—</option>
                                          <option value="true">true</option>
                                          <option value="false">false</option>
                                        </select>
                                      ) : (
                                        <input type={newParam.data_type === 'numeric' ? 'number' : 'text'} step="any"
                                          className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                          value={newParam.value} onChange={(e) => setNewParam({ ...newParam, value: e.target.value })} />
                                      )}
                                    </div>
                                  </div>
                                  <button type="button" disabled={savingParam} onClick={() => saveParameter(device.sensor_id)}
                                    className="mt-3 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                    {savingParam ? <RotateCcw size={11} className="animate-spin" /> : <Save size={11} />}
                                    {savingParam ? 'Guardando...' : 'Guardar parámetro'}
                                  </button>
                                  <p className="text-[9px] text-slate-500 mt-2 flex items-start gap-1">
                                    <Info size={10} className="mt-0.5 shrink-0" />
                                    Solo los parámetros <span className="font-mono">numeric</span> quedan disponibles como variable en el motor de fórmulas (además de <span className="font-mono">value</span>, la última lectura real del sensor).
                                  </p>
                                </div>
                              </div>
                            )}

                            {detailTab === 'formulas' && (
                              <div className="space-y-5">
                                <div className="flex items-center justify-between gap-2">
                                  <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1.5">
                                    <Sigma size={12} className="text-indigo-400" /> Fórmulas de este sensor
                                  </h3>
                                  <div className="flex items-center gap-1.5">
                                    <button type="button" onClick={() => { setShowTemplateForm((v) => !v); setShowFormulaForm(false); setTemplateError(null); }}
                                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                      {showTemplateForm ? <X size={11} /> : <SlidersHorizontal size={11} />}
                                      {showTemplateForm ? 'Cancelar' : 'Aplicar plantilla'}
                                    </button>
                                    <button type="button" onClick={() => { setShowFormulaForm((v) => !v); setShowTemplateForm(false); setFormulaError(null); }}
                                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                      {showFormulaForm ? <X size={11} /> : <Plus size={11} />}
                                      {showFormulaForm ? 'Cancelar' : 'Nueva fórmula'}
                                    </button>
                                  </div>
                                </div>

                                {showTemplateForm && (
                                  <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2.5">
                                    <p className="text-[9px] text-slate-500">
                                      Plantillas de calibración de instrumentos geotécnicos (Geokon, RST, Soil Instruments,
                                      Slope Indicator, Casagrande...) -- reproducen las fórmulas del sistema legado. Al aplicar
                                      una, se declaran los canales de entrada crudos que necesita (Freq/Temp/Press), se guardan
                                      los parámetros de calibración y se crea una fórmula por cada canal de salida (MPA/MCA/ALT...).
                                    </p>
                                    {templatesLoading ? (
                                      <p className="text-[10px] text-slate-500">Cargando catálogo...</p>
                                    ) : (
                                      <div>
                                        <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Plantilla</label>
                                        <select value={selectedTemplateCode} onChange={(e) => selectTemplate(e.target.value)}
                                          className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white outline-none focus:border-indigo-500/50">
                                          <option value="">Seleccionar...</option>
                                          {Object.entries(
                                            templates.reduce<Record<string, FormulaTemplate[]>>((acc, t) => {
                                              (acc[t.instrument_family] ||= []).push(t);
                                              return acc;
                                            }, {})
                                          ).map(([family, items]) => (
                                            <optgroup key={family} label={family}>
                                              {items.map((t) => (
                                                <option key={t.template_code} value={t.template_code}>
                                                  {t.display_name} ({t.output_unit})
                                                </option>
                                              ))}
                                            </optgroup>
                                          ))}
                                        </select>
                                      </div>
                                    )}

                                    {selectedTemplate && (
                                      <div className="space-y-2.5">
                                        {selectedTemplate.description && (
                                          <p className="text-[9px] text-indigo-300/80">{selectedTemplate.description}</p>
                                        )}
                                        <p className="text-[9px] text-slate-500">
                                          Requiere canales de entrada: <span className="font-mono text-indigo-300">{selectedTemplate.input_channels.join(', ')}</span>
                                          {selectedTemplate.requires_geometry ? ' -- incluye parámetros de geometría de sondaje inclinado.' : ''}
                                        </p>
                                        <div className="grid grid-cols-2 gap-2.5">
                                          {selectedTemplate.parameters.map((p) => (
                                            <div key={p.param_key}>
                                              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">
                                                {p.param_key}{p.is_required && p.default_value == null ? ' *' : ''}
                                              </label>
                                              <input type="number" step="any"
                                                placeholder={p.default_value != null ? String(p.default_value) : ''}
                                                className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                                value={templateParamValues[p.param_key] ?? ''}
                                                onChange={(e) => setTemplateParamValues({ ...templateParamValues, [p.param_key]: e.target.value })} />
                                            </div>
                                          ))}
                                        </div>
                                        {templateError && (
                                          <p className="text-[10px] text-rose-400 flex items-start gap-1.5"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {templateError}</p>
                                        )}
                                        <button type="button" disabled={applyingTemplate} onClick={() => applyFormulaTemplate(device.sensor_id)}
                                          className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2">
                                          {applyingTemplate ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
                                          {applyingTemplate ? 'Aplicando...' : 'Aplicar plantilla'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {appliedTemplateChannels?.sensorId === device.sensor_id && (
                                  <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-2.5">
                                    <p className="text-[10px] font-black text-emerald-300 uppercase tracking-widest flex items-center gap-1.5">
                                      <Send size={12} /> Probar la plantilla con datos reales
                                    </p>
                                    {issuedKey?.sensor_id === device.sensor_id ? (
                                      <>
                                        <p className="text-[9px] text-slate-500">
                                          Envía una lectura real por canal usando la clave de dispositivo mostrada arriba
                                          (pestaña "Datos") -- el evaluador la toma en el próximo ciclo (~10s).
                                        </p>
                                        <div className="grid grid-cols-2 gap-2.5">
                                          {appliedTemplateChannels.channels.map((c) => (
                                            <div key={c}>
                                              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">{c}</label>
                                              <input type="number" step="any"
                                                className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-emerald-500/50"
                                                value={multiChannelValues[c] ?? ''}
                                                onChange={(e) => setMultiChannelValues({ ...multiChannelValues, [c]: e.target.value })} />
                                            </div>
                                          ))}
                                        </div>
                                        {multiResult && (
                                          <span className={`text-[10px] font-bold flex items-start gap-1.5 ${multiResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {multiResult.ok ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                                            {multiResult.text}
                                          </span>
                                        )}
                                        <button type="button" disabled={multiSending} onClick={sendMultiTestReading}
                                          className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2">
                                          {multiSending ? <RotateCcw size={12} className="animate-spin" /> : <Send size={12} />}
                                          {multiSending ? 'Enviando...' : 'Enviar lectura de prueba'}
                                        </button>
                                      </>
                                    ) : (
                                      <p className="text-[9px] text-amber-300/80">
                                        Este sensor todavía no tiene una clave de dispositivo visible en esta sesión.
                                        Cerrá este panel y usá el ícono de llave (<KeyRound size={10} className="inline align-text-bottom" />
                                        "Rotar API key") en la fila de este sensor en la tabla -- eso muestra la
                                        clave nueva, y con esta sección abierta de nuevo ya vas a poder enviar la
                                        prueba real.
                                      </p>
                                    )}
                                  </div>
                                )}

                                {showFormulaForm && (
                                  <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2.5">
                                    <div className="grid grid-cols-2 gap-2.5">
                                      <div className="col-span-2">
                                        <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Nombre</label>
                                        <input type="text" placeholder="Ej. Índice de vibración corregido"
                                          className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-white outline-none focus:border-indigo-500/50"
                                          value={formulaForm.formula_name} onChange={(e) => setFormulaForm({ ...formulaForm, formula_name: e.target.value })} />
                                      </div>
                                      <div className="col-span-2">
                                        <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">
                                          Expresión (variables: <span className="font-mono text-indigo-300">value</span>{parameters.filter((p) => p.data_type === 'numeric').length > 0 ? <> , <span className="font-mono text-indigo-300">{parameters.filter((p) => p.data_type === 'numeric').map((p) => p.param_key).join(', ')}</span></> : null})
                                        </label>
                                        <input type="text" placeholder="Ej. (value - offset) * slope"
                                          className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-emerald-400 outline-none focus:border-indigo-500/50"
                                          value={formulaForm.expression} onChange={(e) => setFormulaForm({ ...formulaForm, expression: e.target.value })} />
                                      </div>
                                      <div>
                                        <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Código de canal de salida</label>
                                        <input type="text" placeholder="Ej. vib_corregida"
                                          className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                          value={formulaForm.output_channel_code} onChange={(e) => setFormulaForm({ ...formulaForm, output_channel_code: e.target.value })} />
                                      </div>
                                      <div>
                                        <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Unidad (opcional)</label>
                                        <input type="text" placeholder="Ej. mm/s"
                                          className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white outline-none focus:border-indigo-500/50"
                                          value={formulaForm.output_unit} onChange={(e) => setFormulaForm({ ...formulaForm, output_unit: e.target.value })} />
                                      </div>
                                      <div>
                                        <label className="text-[8px] font-black text-amber-400 uppercase mb-1 block">Warning mín</label>
                                        <input type="number" step="any" className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-amber-300 outline-none focus:border-indigo-500/50"
                                          value={formulaForm.warning_low} onChange={(e) => setFormulaForm({ ...formulaForm, warning_low: e.target.value })} />
                                      </div>
                                      <div>
                                        <label className="text-[8px] font-black text-amber-400 uppercase mb-1 block">Warning máx</label>
                                        <input type="number" step="any" className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-amber-300 outline-none focus:border-indigo-500/50"
                                          value={formulaForm.warning_high} onChange={(e) => setFormulaForm({ ...formulaForm, warning_high: e.target.value })} />
                                      </div>
                                      <div>
                                        <label className="text-[8px] font-black text-rose-400 uppercase mb-1 block">Error mín</label>
                                        <input type="number" step="any" className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-rose-300 outline-none focus:border-indigo-500/50"
                                          value={formulaForm.error_low} onChange={(e) => setFormulaForm({ ...formulaForm, error_low: e.target.value })} />
                                      </div>
                                      <div>
                                        <label className="text-[8px] font-black text-rose-400 uppercase mb-1 block">Error máx</label>
                                        <input type="number" step="any" className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-rose-300 outline-none focus:border-indigo-500/50"
                                          value={formulaForm.error_high} onChange={(e) => setFormulaForm({ ...formulaForm, error_high: e.target.value })} />
                                      </div>
                                    </div>
                                    {formulaError && (
                                      <p className="text-[10px] text-rose-400 flex items-start gap-1.5"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {formulaError}</p>
                                    )}
                                    <button type="button" disabled={savingFormula} onClick={() => createFormula(device.sensor_id)}
                                      className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2">
                                      {savingFormula ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
                                      {savingFormula ? 'Validando y guardando...' : 'Crear fórmula'}
                                    </button>
                                  </div>
                                )}

                                {formulasLoading ? (
                                  <p className="text-[10px] text-slate-500">Cargando fórmulas...</p>
                                ) : formulas.length === 0 ? (
                                  <p className="text-[10px] text-slate-500">Sin fórmulas configuradas para este sensor.</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {formulas.map((f) => (
                                      <div key={f.formula_id} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900/60 border border-white/5">
                                        <button type="button" onClick={() => toggleFormulaEnabled(device.sensor_id, f)}
                                          title={f.enabled ? 'Deshabilitar' : 'Habilitar'}
                                          className={f.enabled ? 'text-emerald-400' : 'text-slate-600'}>
                                          {f.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                                        </button>
                                        <div className="min-w-0 flex-1">
                                          <div className="text-[10px] font-black text-white">{f.formula_name}</div>
                                          <div className="text-[9px] font-mono text-indigo-300/80 truncate">{f.expression} → {f.output_channel_code}{f.output_unit ? ` (${f.output_unit})` : ''}</div>
                                        </div>
                                        <button type="button" onClick={() => deleteFormula(device.sensor_id, f)}
                                          className="shrink-0 p-1.5 rounded-lg bg-slate-800 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 transition-colors">
                                          <Trash2 size={11} />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div>
                                  <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                                    <Activity size={12} className="text-indigo-400" /> Resultados calculados recientes
                                  </h3>
                                  {resultsLoading ? (
                                    <p className="text-[10px] text-slate-500">Cargando...</p>
                                  ) : formulaResults.length === 0 ? (
                                    <p className="text-[10px] text-slate-500">Sin resultados todavía -- el evaluador corre cada ~10s sobre las fórmulas habilitadas (necesita una lectura real del sensor en los últimos 15 min).</p>
                                  ) : (
                                    <table className="w-full text-left border-collapse">
                                      <thead>
                                        <tr className="border-b border-white/5">
                                          <th className="py-1.5 text-[8px] font-black text-slate-500 uppercase">Canal</th>
                                          <th className="py-1.5 text-[8px] font-black text-slate-500 uppercase">Valor</th>
                                          <th className="py-1.5 text-[8px] font-black text-slate-500 uppercase text-center">Estado</th>
                                          <th className="py-1.5 text-[8px] font-black text-slate-500 uppercase text-right">Cuándo</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-white/5">
                                        {formulaResults.map((r, idx) => {
                                          const meta = RESULT_STATUS_META[r.status] || RESULT_STATUS_META.ok;
                                          return (
                                            <tr key={`${r.channel_code}-${r.captured_at}-${idx}`}>
                                              <td className="py-1.5 text-[10px] font-mono text-slate-300">{r.channel_code}</td>
                                              <td className="py-1.5 text-[10px] font-mono text-white">{r.value_numeric != null ? r.value_numeric.toFixed(3) : '—'}</td>
                                              <td className="py-1.5 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase border ${meta.bg} ${meta.color}`}>{meta.label}</span>
                                              </td>
                                              <td className="py-1.5 text-[9px] text-slate-500 text-right">{new Date(r.captured_at).toLocaleString()}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-3 bg-slate-900/80 border-t border-white/5 shrink-0">
          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest italic opacity-60 flex items-center gap-1.5">
            <Radio size={10} className="text-slate-600 shrink-0" />
            Ingesta por API key (POST /api/mining/telemetry) — para MQTT/Modbus/OPC-UA/gateway TLS, ver protocolo en el registro.
          </p>
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

export default memo(SensorManagementView);
