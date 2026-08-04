import React, { memo, useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Check, X, Save, RotateCcw, AlertTriangle,
} from 'lucide-react';
import { getSession, authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { log } from '../../../../lib/logger';
import { ADMIN_ASSIGNABLE_ROLES } from '../../../../auth/roleConstants';
import { useI18n } from '../../../../i18n/I18nProvider';
import { requestConfirmation } from '../../../UI/ConfirmActionDialog';

// ADMIN_ASSIGNABLE_ROLES (roleConstants.ts) ya incluye los 7 roles reales
// de la plataforma, incluido 'viewer' -- el backend es autoritativo: admin
// siempre tiene todo (no editable en la matriz).
const ROLES = ADMIN_ASSIGNABLE_ROLES.map(r => ({ id: r.value, label: r.label, color: r.color }));

interface PermissionDef {
  code: string;
  module: string;
  description: string;
}

// matrix[role] = Set de códigos de permiso habilitados.
type PermissionMatrix = Record<string, Set<string>>;

function authHeaders(): Record<string, string> {
  // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
  // navegador adjunta sola. Aqui solo viaja el token CSRF del double-submit,
  // que el backend exige en toda peticion que mute estado.
  return sharedAuthHeaders();
}

function PermissionsManagementView() {
  const { t } = useI18n();
  const session = getSession();
  const company = session?.company || '';

  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrix>({});
  const [dirtyRoles, setDirtyRoles] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/permissions/matrix', { headers: authHeaders() });
      if (res.status === 403) {
        setError('No tiene permiso para administrar la matriz de accesos (requiere permisos.manage).');
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
      const m: PermissionMatrix = {};
      ROLES.forEach(r => {
        m[r.id] = new Set<string>(Array.isArray(data.matrix?.[r.id]) ? data.matrix[r.id] : []);
      });
      setMatrix(m);
      setDirtyRoles(new Set());
    } catch (err) {
      log.error('cargar matriz de permisos', err);
      setError('No se pudo cargar la matriz de permisos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  const togglePermission = (roleId: string, code: string) => {
    if (roleId === 'admin') return; // admin siempre tiene todo, no editable
    setMatrix(prev => {
      const next = { ...prev };
      const s = new Set(next[roleId]);
      s.has(code) ? s.delete(code) : s.add(code);
      next[roleId] = s;
      return next;
    });
    setDirtyRoles(prev => new Set(prev).add(roleId));
  };

  const saveMatrix = async () => {
    setSaving(true);
    try {
      // Persistir cada rol modificado (override completo por rol en el backend).
      for (const roleId of dirtyRoles) {
        const res = await fetch('/api/auth/permissions/matrix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ role: roleId, permissions: Array.from(matrix[roleId] || []) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} guardando rol ${roleId}`);
      }
      setToast('Matriz de permisos actualizada correctamente.');
      setTimeout(() => setToast(null), 3000);
      await loadMatrix();
    } catch (err) {
      log.error('guardar matriz de permisos', err);
      setToast('Error al guardar. Reintente.');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const resetMatrix = async () => {
    if (!(await requestConfirmation(t('confirm.resetPermissions')))) return;
    loadMatrix();
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-slate-500 font-bold uppercase text-[10px] animate-pulse">
      Cargando configuración de seguridad...
    </div>
  );

  if (error) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
      <AlertTriangle className="text-amber-400" size={32} />
      <p className="text-xs font-bold text-center max-w-md">{error}</p>
    </div>
  );

  // Catálogo agrupado por módulo (orden estable del backend).
  const modules = Array.from(new Set(catalog.map(c => c.module)));

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950/20 p-4 lg:p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
            <ShieldCheck className="text-indigo-400" size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-100 uppercase tracking-tight leading-none">Matriz de Permisos</h1>
            <p className="text-[10px] text-slate-450 font-bold uppercase tracking-[0.2em] mt-2 opacity-60">Control de Acceso Basado en Roles (RBAC) | {company}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={resetMatrix}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase transition-all flex items-center gap-2 border border-white/5"
          >
            <RotateCcw size={14} /> Restablecer
          </button>
          <button
            onClick={saveMatrix}
            disabled={saving}
            className={`px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/20 ${saving ? 'opacity-50 animate-pulse' : ''}`}
          >
            {saving ? <RotateCcw className="animate-spin" size={14} /> : <Save size={14} />}
            {saving ? 'Guardando...' : 'Aplicar Cambios'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-slate-900/40 border border-white/5 rounded-[2.5rem] overflow-hidden backdrop-blur-3xl flex flex-col shadow-2xl">
        <div className="flex-1 overflow-auto custom-scrollbar">
          <table className="w-full text-left border-collapse table-fixed">
            <thead className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md shadow-sm">
              <tr className="border-b border-white/5">
                <th className="w-80 px-8 py-6 text-[11px] font-black text-slate-500 uppercase tracking-widest bg-slate-900/50">Funcionalidad / Módulos</th>
                {ROLES.map(role => (
                   <th key={role.id} className="px-4 py-6 text-center">
                      <div className={`text-[10px] font-black uppercase tracking-wider mb-1 ${role.color}`}>{role.label}</div>
                      <div className="text-[8px] text-slate-500 font-bold uppercase opacity-40">{role.id}</div>
                   </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {modules.map(module => (
                <React.Fragment key={module}>
                  <tr className="bg-slate-800/30">
                    <td colSpan={ROLES.length + 1} className="px-8 py-2 text-[8px] font-black text-indigo-400/60 uppercase tracking-[0.3em]">
                      // {module}
                    </td>
                  </tr>
                  {catalog.filter(c => c.module === module).map(perm => (
                    <tr key={perm.code} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="px-8 py-4 bg-slate-900/20">
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-lg bg-slate-800 text-slate-400 group-hover:text-indigo-400 transition-colors">
                            <ShieldCheck size={16} />
                          </div>
                          <div>
                            <div className="text-[11px] font-black text-slate-200 uppercase tracking-tight group-hover:text-white transition-colors">{perm.description}</div>
                            <div className="text-[9px] text-slate-500 font-mono italic mt-0.5">{perm.code}</div>
                          </div>
                        </div>
                      </td>
                      {ROLES.map(role => {
                        const active = role.id === 'admin' ? true : matrix[role.id]?.has(perm.code);
                        const locked = role.id === 'admin';
                        return (
                          <td key={role.id} className="px-4 py-4 text-center">
                            <button
                              onClick={() => togglePermission(role.id, perm.code)}
                              disabled={locked}
                              title={locked ? 'El administrador siempre tiene todos los permisos' : undefined}
                              className={`mx-auto w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-300 transform active:scale-90 ${
                                active
                                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                : 'bg-slate-800/50 text-slate-600 hover:bg-slate-700/50'
                              } ${locked ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              {active ? <Check size={18} strokeWidth={3} /> : <X size={16} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-8 py-4 bg-slate-900/80 border-t border-white/5 flex items-center justify-between">
           <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-indigo-500 shadow-lg shadow-indigo-500/50" />
                 <span className="text-[9px] font-black text-slate-400 uppercase">Habilitado</span>
              </div>
              <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-md bg-slate-700" />
                 <span className="text-[9px] font-black text-slate-500 uppercase">Restringido</span>
              </div>
           </div>
           <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest italic opacity-40">
              * Los cambios se aplican globalmente al perfil seleccionado tras guardar.
           </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-indigo-400/40 bg-slate-900/95 px-5 py-3 text-xs font-bold text-indigo-100 shadow-2xl backdrop-blur-md">
          {toast}
        </div>
      )}
    </div>
  );
}

export default memo(PermissionsManagementView);
