import React, { memo, useEffect, useState, useCallback } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { getSession, updateSessionTokens, authHeaders as sharedAuthHeaders } from '../../auth/authStorage';
import { log } from '../../lib/logger';
import { useI18n } from '../../i18n/I18nProvider';

interface TenantEntry {
    tenant_id: string;
    tenant_name: string;
    role: string;
    is_default: boolean;
    active: boolean;
}

function authHeaders(): Record<string, string> {
  // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
  // navegador adjunta sola. Aqui solo viaja el token CSRF del double-submit,
  // que el backend exige en toda peticion que mute estado.
  return sharedAuthHeaders();
}

/**
 * Selector de unidad minera activa. Un usuario puede pertenecer a varias
 * (auth_user_tenant) — cambia el tenant de la sesión sin recargar login,
 * reemitiendo el token vía POST /api/auth/tenants/switch. Si el usuario solo
 * pertenece a una unidad (caso más común hoy), se muestra como etiqueta fija
 * sin dropdown — no hay nada que "cambiar".
 */
const TenantSwitcher = () => {
    const { t } = useI18n();
    const [tenants, setTenants] = useState<TenantEntry[]>([]);
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/auth/tenants', { headers: authHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            setTenants(Array.isArray(data?.tenants) ? data.tenants : []);
        } catch (err) {
            log.error('TenantSwitcher: no se pudo cargar la lista de unidades', err);
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const switchTo = async (tenantId: string) => {
        if (switching) return;
        setSwitching(true);
        try {
            const res = await fetch('/api/auth/tenants/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ tenant_id: tenantId }),
            });
            const data = await res.json();
            if (!res.ok || !data?.access_token) {
                log.error('TenantSwitcher: cambio de unidad rechazado', data);
                setSwitching(false);
                return;
            }
            // ADR-029, "Actualización 2026-07-19": el refresh token ya no
            // viaja en el body -- va en la cookie HttpOnly que el backend
            // adjunta a esta misma respuesta (fetch same-origin la guarda solo).
            updateSessionTokens(data.access_token, data.expires_in);
            // Recarga completa: todo el estado de la app (mapas, informes,
            // permisos cacheados en memoria) queda scopeado al tenant viejo;
            // más simple y confiable que intentar re-hidratar cada módulo.
            window.location.reload();
        } catch (err) {
            log.error('TenantSwitcher: error de red al cambiar de unidad', err);
            setSwitching(false);
        }
    };

    if (!loaded || tenants.length === 0) return null;

    const active = tenants.find((t) => t.active) || tenants[0];

    if (tenants.length === 1) {
        return (
            <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/35 bg-emerald-950/30 text-[10px] text-emerald-100">
                <Building2 size={12} className="text-emerald-300" />
                <span>{active.tenant_name}</span>
            </div>
        );
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                disabled={switching}
                className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/45 bg-emerald-950/30 text-[10px] text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-60"
                title={t('tenant.change')}
                aria-label={t('tenant.change')}
            >
                <Building2 size={12} className="text-emerald-300" />
                <span className="max-w-[10rem] truncate">{active.tenant_name}</span>
                <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-lg border border-slate-700 bg-slate-950/95 py-1 shadow-2xl backdrop-blur-md">
                    <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        {t('tenant.units')}
                    </div>
                    {tenants.map((t) => (
                        <button
                            key={t.tenant_id}
                            type="button"
                            onClick={() => { setOpen(false); if (!t.active) switchTo(t.tenant_id); }}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-slate-800 ${t.active ? 'text-emerald-300' : 'text-slate-200'}`}
                        >
                            <span className="truncate">
                                {t.tenant_name}
                                <span className="ml-1.5 text-[9px] uppercase text-slate-500">{t.role}</span>
                            </span>
                            {t.active && <Check size={12} className="shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default memo(TenantSwitcher);
