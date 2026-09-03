import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  Building2, Search, RotateCcw, Plus, X, Save, ShieldOff, ShieldCheck,
  CheckCircle2, AlertTriangle, Lock, Eye, Globe2
} from 'lucide-react';
import { useI18n } from '../../../../i18n/I18nProvider';
import { requestConfirmation } from '../../../UI/ConfirmActionDialog';
import { usePermissions } from '../../../../auth/usePermissions';
import {
  fetchCompaniesAdmin, createCompany, updateCompany, setCompanyActive,
  validateCompanyDetailed, type CompanyRecord, type CompanyType,
} from '../../../../auth/authApi';
import CompanyLocationPicker from '../../../Special/CompanyLocationPicker';
import { log } from '../../../../lib/logger';
import './accessAdministration.css';

const COUNTRY_OPTIONS = [
  { value: 'PE', label: 'Perú' },
  { value: 'BR', label: 'Brasil' },
  { value: 'US', label: 'Estados Unidos' },
  { value: 'CA', label: 'Canadá' },
];

type RegistryState = 'idle' | 'checking' | 'checksum_only' | 'confirmed' | 'not_found' | 'unavailable';

/**
 * ADR-085/086: mantenimiento administrado de empresas (tenants) — mismo
 * patrón estructural que UserManagementView.tsx (lista + panel de detalle),
 * pero gateado por `empresas.view`/`empresas.manage` en vez de
 * `usuarios.manage`. Con solo `empresas.view` el backend ya enmascara el RUC
 * (GET /api/auth/companies/manage) — este componente además oculta los
 * controles de alta/edición/baja, doble cinturón de seguridad (mismo
 * criterio que App.tsx aplica al punto de montaje).
 */
function CompanyManagementView() {
  const { t } = useI18n();
  const { hasPermission, isAdmin, loading: permsLoading } = usePermissions();
  const canManage = isAdmin || hasPermission('empresas.manage');

  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusMsg, setStatusMsg] = useState({ type: 'info', text: '' });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<{
    name: string; ruc: string; country: string; domicilio_fiscal: string;
    latitude: number | null; longitude: number | null; location_zoom: number | null;
    company_type: CompanyType;
  }>({ name: '', ruc: '', country: 'PE', domicilio_fiscal: '', latitude: null, longitude: null, location_zoom: null, company_type: 'mining_client' });
  const [createRegistry, setCreateRegistry] = useState<RegistryState>('idle');

  const [editForm, setEditForm] = useState<{
    ruc: string; country: string; domicilio_fiscal: string;
    latitude: number | null; longitude: number | null; location_zoom: number | null;
    company_type: CompanyType;
  }>({ ruc: '', country: 'PE', domicilio_fiscal: '', latitude: null, longitude: null, location_zoom: null, company_type: 'mining_client' });
  const [saving, setSaving] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { companies: rows } = await fetchCompaniesAdmin(includeInactive);
      setCompanies(rows);
    } catch (err) {
      log.error('[COMPANY_MGMT] loadData failed', err);
      setStatusMsg({ type: 'error', text: `No se pudo cargar el catálogo de empresas: ${(err as Error).message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [includeInactive]);

  const filteredCompanies = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return companies.filter(c =>
      (c.name || '').toLowerCase().includes(term) || (c.ruc || '').includes(term)
    );
  }, [companies, searchTerm]);

  const selectedCompany = useMemo(
    () => companies.find(c => c.company_id === selectedId),
    [companies, selectedId],
  );

  useEffect(() => {
    if (selectedCompany) {
      setEditForm({
        ruc: selectedCompany.ruc || '',
        country: selectedCompany.country_code || 'PE',
        domicilio_fiscal: selectedCompany.domicilio_fiscal || '',
        latitude: selectedCompany.latitude ?? null,
        longitude: selectedCompany.longitude ?? null,
        location_zoom: selectedCompany.location_zoom ?? null,
        company_type: selectedCompany.company_type || 'mining_client',
      });
    }
  }, [selectedCompany]);

  const checkRegistry = async (ruc: string, country: string, target: 'create' | 'edit') => {
    const digits = ruc.replace(/\D/g, '');
    const setState = target === 'create' ? setCreateRegistry : (_: RegistryState) => {};
    if (!digits) { if (target === 'create') setCreateRegistry('idle'); return; }
    if (target === 'create') setCreateRegistry('checking');
    try {
      const result = await validateCompanyDetailed(digits, country);
      if (!result.valid) { setState('idle'); return; }
      if (result.registry === 'confirmed') setState('confirmed');
      else if (result.registry === 'not_found') setState('not_found');
      else if (result.registry === 'unavailable') setState('unavailable');
      else setState('checksum_only');
    } catch {
      setState('checksum_only');
    }
  };

  const submitCreate = async () => {
    const name = createForm.name.trim();
    if (!name) {
      setStatusMsg({ type: 'error', text: 'Indique la razón social de la empresa.' });
      return;
    }
    setCreating(true);
    setStatusMsg({ type: 'info', text: 'Creando empresa...' });
    try {
      await createCompany({
        name,
        ruc: createForm.ruc.replace(/\D/g, '') || undefined,
        country: createForm.country,
        domicilio_fiscal: createForm.domicilio_fiscal.trim() || undefined,
        company_type: createForm.company_type,
        ...(createForm.latitude != null && createForm.longitude != null
          ? {
              latitude: createForm.latitude,
              longitude: createForm.longitude,
              ...(createForm.location_zoom != null ? { location_zoom: createForm.location_zoom } : {}),
            }
          : {}),
      });
      setStatusMsg({ type: 'success', text: `Empresa "${name}" creada correctamente.` });
      setShowCreateForm(false);
      setCreateForm({ name: '', ruc: '', country: 'PE', domicilio_fiscal: '', latitude: null, longitude: null, location_zoom: null, company_type: 'mining_client' });
      setCreateRegistry('idle');
      loadData();
    } catch (err) {
      setStatusMsg({ type: 'error', text: `No se pudo crear la empresa: ${(err as Error).message}` });
    } finally {
      setCreating(false);
    }
  };

  const submitEdit = async () => {
    if (!selectedCompany) return;
    setSaving(true);
    setStatusMsg({ type: 'info', text: 'Guardando cambios...' });
    try {
      await updateCompany(selectedCompany.company_id, {
        ruc: editForm.ruc.replace(/\D/g, ''),
        country: editForm.country,
        domicilio_fiscal: editForm.domicilio_fiscal.trim(),
        company_type: editForm.company_type,
        ...(editForm.latitude != null && editForm.longitude != null
          ? {
              latitude: editForm.latitude,
              longitude: editForm.longitude,
              ...(editForm.location_zoom != null ? { location_zoom: editForm.location_zoom } : {}),
            }
          : {}),
      });
      setStatusMsg({ type: 'success', text: `Datos de "${selectedCompany.name}" actualizados.` });
      loadData();
    } catch (err) {
      setStatusMsg({ type: 'error', text: `No se pudo guardar: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!selectedCompany) return;
    const goingActive = !selectedCompany.active;
    const confirmKey = goingActive ? 'confirm.reactivateCompany' : 'confirm.deactivateCompany';
    if (!(await requestConfirmation(t(confirmKey, { company: selectedCompany.name })))) return;
    setTogglingActive(true);
    try {
      const result = await setCompanyActive(selectedCompany.company_id, goingActive);
      setStatusMsg({
        type: 'success',
        text: goingActive
          ? `Empresa "${selectedCompany.name}" reactivada.`
          : `Empresa "${selectedCompany.name}" dada de baja. ${result.active_users_affected} usuario(s) activo(s) quedaron sin acceso hasta la reactivación.`,
      });
      loadData();
    } catch (err) {
      setStatusMsg({ type: 'error', text: `No se pudo actualizar el estado: ${(err as Error).message}` });
    } finally {
      setTogglingActive(false);
    }
  };

  const registryBadge = (state: RegistryState) => {
    if (state === 'idle' || state === 'checking') return null;
    const map: Record<string, { label: string; cls: string }> = {
      confirmed: { label: 'Confirmado en padrón SUNAT (vía terceros)', cls: 'text-emerald-400' },
      not_found: { label: 'No encontrado en el padrón consultado', cls: 'text-amber-400' },
      unavailable: { label: 'Padrón no disponible — solo checksum validado', cls: 'text-slate-400' },
      checksum_only: { label: 'Forma de RUC válida (padrón no consultado)', cls: 'text-slate-400' },
    };
    const info = map[state];
    if (!info) return null;
    return <span className={`text-[8px] font-black uppercase tracking-wider ${info.cls}`}>{info.label}</span>;
  };

  return (
    <main className="access-admin access-users" aria-labelledby="companies-title">
      <header className="access-admin__header access-users__header">
        <div className="access-admin__identity">
          <span className="access-admin__eyebrow">Administración de plataforma</span>
          <div className="access-admin__title-row">
            <div className="access-admin__title-icon">
              <Building2 className="text-indigo-400" size={24} />
            </div>
            <div>
              <h1 id="companies-title">Administración de empresas</h1>
              <p>{companies.length} registro(s) {includeInactive ? '(incluye inactivas)' : ''}</p>
            </div>
          </div>
        </div>

        <div className="access-admin__actions access-users__toolbar">
          <div className="access-search">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="text"
              placeholder="Buscar por razón social o RUC..."
              className="access-search__input"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => setIncludeInactive(v => !v)}
            className={`access-button ${includeInactive ? 'access-button--primary' : 'access-button--ghost'}`}
            title="Incluir empresas dadas de baja"
          >
            <Eye size={14} /> {includeInactive ? 'Con inactivas' : 'Solo activas'}
          </button>
          <button type="button" onClick={loadData} className="access-button access-button--icon" title="Sincronizar">
            <RotateCcw size={16} />
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => { setShowCreateForm(v => !v); setSelectedId(''); }}
              className={`access-button ${showCreateForm ? 'access-button--ghost' : 'access-button--primary'}`}
            >
              {showCreateForm ? <X size={14} /> : <Plus size={14} />}
              {showCreateForm ? 'Cancelar' : 'Nueva Empresa'}
            </button>
          )}
        </div>
      </header>

      {!canManage && !permsLoading && (
        <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-300 text-[10px] font-bold uppercase flex items-center gap-2">
          <Lock size={12} /> Modo solo lectura — su perfil no tiene la facultad de mantenimiento (empresas.manage).
        </div>
      )}

      {showCreateForm && canManage && (
        <section className="access-create-panel">
          <h3 className="text-[11px] font-black text-slate-100 uppercase tracking-wider flex items-center gap-2 mb-3">
            <Plus size={13} className="text-indigo-400" /> Alta de Nueva Empresa
          </h3>
          <div className="access-create-grid">
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Razón Social</label>
              <input type="text" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">País</label>
              <select className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={createForm.country} onChange={e => setCreateForm({ ...createForm, country: e.target.value })}>
                {COUNTRY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">RUC (opcional)</label>
              <input type="text" placeholder="11 dígitos" className="form-input-base"
                value={createForm.ruc}
                onChange={e => setCreateForm({ ...createForm, ruc: e.target.value })}
                onBlur={() => checkRegistry(createForm.ruc, createForm.country, 'create')} />
              <div className="mt-1">{registryBadge(createRegistry)}</div>
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Domicilio Fiscal (opcional)</label>
              <input type="text" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={createForm.domicilio_fiscal} onChange={e => setCreateForm({ ...createForm, domicilio_fiscal: e.target.value })} />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Tipo de empresa</label>
              <select className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={createForm.company_type}
                onChange={e => setCreateForm({ ...createForm, company_type: e.target.value as CompanyType })}>
                <option value="mining_client">Empresa minera (cliente)</option>
                <option value="organization">Empresa de organización (Beemetry/TimeTelemetry)</option>
              </select>
            </div>
          </div>
          <div className="mt-3">
            <CompanyLocationPicker
              latitude={createForm.latitude}
              longitude={createForm.longitude}
              zoom={createForm.location_zoom}
              onChange={(lat, lng, zoom) => setCreateForm({ ...createForm, latitude: lat, longitude: lng, location_zoom: zoom })}
            />
          </div>
          <div className="flex items-end mt-3">
            <button type="button" disabled={creating} onClick={submitCreate}
              className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2">
              {creating ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
              {creating ? 'Creando...' : 'Crear Empresa'}
            </button>
          </div>
          <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest mt-2 opacity-60">
            Se provisiona un tenant real automáticamente. El nombre no podrá editarse luego de creada (ADR-085).
          </p>
        </section>
      )}

      <div className="access-users__workspace">
        <section className="access-users__list-card">
          <div className="access-users__table-scroll">
            <table className="access-users-table">
              <thead className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur shadow-sm">
                <tr className="border-b border-white/5">
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase">Razón Social</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase">RUC</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase text-center">País</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase text-center">Tipo</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr><td colSpan={5} className="py-10 text-center text-slate-500 animate-pulse font-bold uppercase text-[9px]">Cargando empresas...</td></tr>
                ) : filteredCompanies.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-slate-500 font-bold uppercase text-[9px]">No hay registros.</td></tr>
                ) : filteredCompanies.map(c => (
                  <tr key={c.company_id} onClick={() => { setSelectedId(c.company_id); setShowCreateForm(false); }}
                      className={selectedId === c.company_id ? 'is-selected' : ''}>
                    <td className="px-3 py-1.5">
                      <div className="text-[11px] font-black text-white uppercase tracking-tight leading-none">{c.name}</div>
                      {c.demo_data && <div className="text-[8px] text-amber-400 font-bold uppercase mt-0.5">Dato de prueba</div>}
                    </td>
                    <td className="px-3 py-1.5"><div className="text-xs font-mono text-indigo-300/80">{c.ruc || '—'}</div></td>
                    <td className="px-3 py-1.5 text-center"><span className="text-[10px] font-bold text-slate-400 uppercase">{c.country_code}</span></td>
                    <td className="px-3 py-1.5 text-center">
                      {/* Selector por substring de clase (patrón de accessAdministration.css,
                          badge de estado de cuenta): 'sky' = organización, sin clase extra = minera. */}
                      <span className={c.company_type === 'organization' ? 'access-badge-sky' : 'access-badge-neutral'}>
                        {c.company_type === 'organization' ? 'Organización' : 'Minera cliente'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold ${c.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        <div className={`w-1 h-1 rounded-full ${c.active ? 'bg-emerald-400' : 'bg-current'}`} />
                        {c.active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="access-users__detail-card">
          <div className="access-users__detail-inner">
            {selectedCompany ? (
              <div className="flex flex-col h-full min-h-0">
                <div className="p-4 border-b border-white/5 bg-gradient-to-br from-slate-800/50 to-transparent shrink-0">
                  <div className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-0.5">Empresa Seleccionada</div>
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400"><Building2 size={16} /></div>
                    <div>
                      <h2 className="text-sm font-black text-white leading-none">{selectedCompany.name}</h2>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">tenant: {selectedCompany.tenant_id || 'sin provisionar'}</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-4 scrollbar-thin">
                  <div className="p-3 rounded-xl bg-slate-950/40 border border-white/10 space-y-3">
                    <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Globe2 size={11} className="text-indigo-400" /> Datos tributarios
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">País</label>
                        <select disabled={!canManage} className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white disabled:opacity-60"
                          value={editForm.country} onChange={e => setEditForm({ ...editForm, country: e.target.value })}>
                          {COUNTRY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">RUC</label>
                        <input type="text" disabled={!canManage} className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] font-mono text-indigo-300 disabled:opacity-60"
                          value={editForm.ruc}
                          onChange={e => setEditForm({ ...editForm, ruc: e.target.value })}
                          onBlur={() => checkRegistry(editForm.ruc, editForm.country, 'edit')} />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Domicilio Fiscal</label>
                        <input type="text" disabled={!canManage} className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white disabled:opacity-60"
                          value={editForm.domicilio_fiscal} onChange={e => setEditForm({ ...editForm, domicilio_fiscal: e.target.value })} />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Tipo de empresa</label>
                        <select disabled={!canManage} className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white disabled:opacity-60"
                          value={editForm.company_type}
                          onChange={e => setEditForm({ ...editForm, company_type: e.target.value as CompanyType })}>
                          <option value="mining_client">Empresa minera (cliente)</option>
                          <option value="organization">Empresa de organización (Beemetry/TimeTelemetry)</option>
                        </select>
                      </div>
                    </div>
                    {canManage && (
                      // key=company_id: fuerza remount del mapa (y su centro
                      // inicial) al cambiar de empresa seleccionada -- el
                      // picker solo posiciona el mapa una vez al montar.
                      <CompanyLocationPicker
                        key={selectedCompany.company_id}
                        latitude={editForm.latitude}
                        longitude={editForm.longitude}
                        zoom={editForm.location_zoom}
                        onChange={(lat, lng, zoom) => setEditForm({ ...editForm, latitude: lat, longitude: lng, location_zoom: zoom })}
                      />
                    )}
                    {canManage && (
                      <button type="button" disabled={saving} onClick={submitEdit}
                        className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2">
                        {saving ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
                        {saving ? 'Guardando...' : 'Guardar Datos'}
                      </button>
                    )}
                    <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest opacity-60">
                      La razón social no se puede editar aquí — ver ADR-085.
                    </p>
                  </div>

                  {canManage && (
                    <div className="p-3 rounded-xl bg-slate-950/40 border border-white/10 space-y-2">
                      <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <ShieldCheck size={11} className="text-indigo-400" /> Estado de la empresa
                      </h3>
                      <button type="button" disabled={togglingActive} onClick={toggleActive}
                        className={`w-full py-2 rounded-lg text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 ${
                          selectedCompany.active ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
                        }`}>
                        {togglingActive ? <RotateCcw size={12} className="animate-spin" /> : <ShieldOff size={12} />}
                        {selectedCompany.active ? 'Dar de baja' : 'Reactivar'}
                      </button>
                    </div>
                  )}

                  {statusMsg.text && (
                    <div className={`p-3 rounded-xl border flex items-center gap-3 animate-in fade-in zoom-in-95 ${
                      statusMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                      statusMsg.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                      'bg-sky-500/10 border-sky-500/20 text-sky-400'
                    }`}>
                      {statusMsg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                      <span className="text-[10px] font-bold uppercase leading-tight">{statusMsg.text}</span>
                      <button className="ml-auto" onClick={() => setStatusMsg({ type: 'info', text: '' })}><X size={12} /></button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-900/40">
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 text-slate-600">
                  <Building2 size={32} />
                </div>
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Catálogo de Empresas</h3>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">Seleccione una empresa de la lista para ver o editar sus datos tributarios y su estado.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default memo(CompanyManagementView);
