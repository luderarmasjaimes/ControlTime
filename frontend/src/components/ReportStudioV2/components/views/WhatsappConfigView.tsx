import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Phone, Briefcase, UserCog, Save, RotateCcw, AlertTriangle, CheckCircle2, History } from 'lucide-react';
import { getSession, authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { log } from '../../../../lib/logger';

/* ─────────────────────────────────────────────────────────────────────────
   WHATSAPP CONFIG VIEW (ADR-114) — Números de escalamiento humano (soporte/
   comercial) que usa el bot conversacional de WhatsApp para derivar cada
   categoría del menú. Consume GET/PUT /api/support/whatsapp/contact-numbers
   (RBAC soporte.manage). Mismo lenguaje visual que AlarmConfigView/
   PermissionsManagementView (slate-900/950, font-black uppercase tracking-
   widest, indigo-600 primario, backdrop-blur).

   Si un número nunca se editó desde acá, el backend sigue usando el valor
   "de fábrica" de las variables de entorno (BEEMETRY_WHATSAPP_SUPPORT_TO_E164/
   _COMERCIAL_TO_E164) -- este panel solo escribe un override que vive en
   `whatsapp_contact_number` (db_scripts/61), la MISMA tabla que edita la
   opción "Administración" del propio bot por WhatsApp -- ambos caminos
   terminan en el mismo lugar.
   ───────────────────────────────────────────────────────────────────────── */

interface ContactNumber {
  key: 'soporte' | 'comercial' | 'rrhh';
  label: string;
  phone_e164: string;
  edited_in_platform: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

const CONTACT_META: Record<string, { icon: React.ElementType; color: string; bg: string; description: string }> = {
  soporte: {
    icon: Phone,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/30',
    description: 'Recibe los casos del menú "Soporte técnico", "Emergencia" y "Agendar visita" del bot de WhatsApp.',
  },
  comercial: {
    icon: Briefcase,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    description: 'Recibe los casos del menú "Área comercial" del bot de WhatsApp.',
  },
  rrhh: {
    icon: UserCog,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
    description: 'Recibe los casos del menú "Recursos Humanos" del bot de WhatsApp (ADR-115).',
  },
};

function authHeaders(): Record<string, string> {
  // ADR-082: la credencial es la cookie HttpOnly `access_token`; aquí solo
  // viaja el token CSRF del double-submit, exigido en toda mutación.
  return sharedAuthHeaders();
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function WhatsappConfigView() {
  const session = getSession();
  const company = session?.company || '';

  const [contacts, setContacts] = useState<ContactNumber[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/support/whatsapp/contact-numbers', { headers: authHeaders() });
      if (res.status === 401) {
        setError('Sesión expirada. Vuelva a iniciar sesión.');
        return;
      }
      if (res.status === 403) {
        setError('No tienes permiso para ver esta configuración (se requiere soporte.manage).');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const items: ContactNumber[] = Array.isArray(data?.contact_numbers) ? data.contact_numbers : [];
      setContacts(items);
      setDrafts(Object.fromEntries(items.map((c) => [c.key, c.phone_e164])));
    } catch (err) {
      log.error('WhatsappConfigView: fallo al cargar', err);
      setError('No se pudo cargar la configuración de WhatsApp.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveContact = async (key: string) => {
    const phone = (drafts[key] || '').trim();
    if (!/^\d{8,15}$/.test(phone)) {
      showToast('error', 'El número debe ser E.164 sin el "+" (solo dígitos, 8 a 15) -- ej. 51945095575.');
      return;
    }
    setSavingKey(key);
    try {
      const res = await fetch(`/api/support/whatsapp/contact-numbers/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ phone_e164: phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showToast('success', `Número de ${CONTACT_META[key]?.description ? key : key} actualizado correctamente.`);
      await load();
    } catch (err) {
      showToast('error', `No se pudo guardar: ${(err as Error).message}`);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center text-slate-500 font-bold uppercase text-[10px] animate-pulse bg-slate-950/20">
      Cargando configuración de WhatsApp...
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
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <MessageCircle className="text-emerald-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-100 uppercase tracking-tight">Configuración de WhatsApp</h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
              {company || 'EMPRESA NO IDENTIFICADA'} · Números de escalamiento del bot conversacional
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          title="Sincronizar"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-6 pb-4">
        {(['soporte', 'comercial', 'rrhh'] as const).map((key) => {
          const meta = CONTACT_META[key];
          const Icon = meta.icon;
          const contact = contacts.find((c) => c.key === key);
          const dirty = contact ? drafts[key] !== contact.phone_e164 : false;
          return (
            <div key={key} className="bg-slate-900/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
                <h2 className="text-[11px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
                  <Icon size={14} className={meta.color} /> {contact?.label || key}
                </h2>
                {contact?.edited_in_platform ? (
                  <span className={`px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider ${meta.bg} ${meta.color}`}>
                    Editado
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full border border-slate-600/40 bg-slate-800/60 text-[9px] font-black uppercase tracking-wider text-slate-400">
                    Valor de fábrica
                  </span>
                )}
              </div>

              <div className="p-4 space-y-3 flex-1">
                <p className="text-[11px] text-slate-400 leading-relaxed">{meta.description}</p>

                <div>
                  <label className="form-label">Número de WhatsApp (E.164, sin "+")</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Ej. 51945095575"
                    className="form-input-base"
                    value={drafts[key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value.replace(/[^\d]/g, '') }))}
                  />
                </div>

                {contact?.edited_in_platform && contact.updated_at && (
                  <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                    <History size={11} /> Última edición: {formatUpdatedAt(contact.updated_at)}
                    {contact.updated_by ? ` — ${contact.updated_by}` : ''}
                  </p>
                )}

                <button
                  type="button"
                  disabled={!dirty || savingKey === key}
                  onClick={() => saveContact(key)}
                  className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-indigo-600/20 disabled:shadow-none"
                >
                  {savingKey === key ? 'Guardando…' : <><Save size={12} /> Guardar</>}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-bold z-50 ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}
