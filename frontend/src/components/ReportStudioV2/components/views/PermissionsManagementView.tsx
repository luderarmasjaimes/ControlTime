import React, { memo, useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Check, X, Save, RotateCcw, AlertTriangle,
} from 'lucide-react';
import { getSession, authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { log } from '../../../../lib/logger';
import { ADMIN_ASSIGNABLE_ROLES } from '../../../../auth/roleConstants';
import { useI18n } from '../../../../i18n/I18nProvider';
import { requestConfirmation } from '../../../UI/ConfirmActionDialog';
import './accessAdministration.css';

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

  const enabledCount = catalog.reduce((total, permission) =>
    total + ROLES.filter(role => role.id === 'admin' || matrix[role.id]?.has(permission.code)).length, 0);

  return (
    <main className="access-admin access-permissions" aria-labelledby="permissions-title">
      <header className="access-admin__header">
        <div className="access-admin__identity">
          <span className="access-admin__eyebrow">Seguridad y control de acceso</span>
          <div className="access-admin__title-row">
            <span className="access-admin__title-icon"><ShieldCheck size={25} /></span>
            <div>
              <h1 id="permissions-title">Matriz de permisos</h1>
              <p>{company || 'Unidad minera'} · Control de acceso basado en roles</p>
            </div>
          </div>
        </div>
        <div className="access-admin__actions">
          <span className={`access-admin__change-count ${dirtyRoles.size ? 'is-dirty' : ''}`}>
            {dirtyRoles.size ? `${dirtyRoles.size} perfiles modificados` : 'Configuración sincronizada'}
          </span>
          <button type="button" className="access-button access-button--ghost" onClick={resetMatrix} disabled={!dirtyRoles.size || saving}>
            <RotateCcw size={15} /> Descartar
          </button>
          <button type="button" className="access-button access-button--primary" onClick={saveMatrix} disabled={!dirtyRoles.size || saving}>
            {saving ? <RotateCcw className="access-spin" size={15} /> : <Save size={15} />}
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </header>

      <section className="access-summary" aria-label="Resumen de permisos">
        <div><strong>{ROLES.length}</strong><span>Perfiles operativos</span></div>
        <div><strong>{catalog.length}</strong><span>Capacidades controladas</span></div>
        <div><strong>{modules.length}</strong><span>Módulos protegidos</span></div>
        <div><strong>{enabledCount}</strong><span>Asignaciones activas</span></div>
      </section>

      <section className="permission-matrix-card">
        <div className="permission-matrix-card__intro">
          <div>
            <h2>Accesos por perfil</h2>
            <p>Active únicamente las capacidades necesarias para cada responsabilidad.</p>
          </div>
          <span className="permission-matrix-card__locked"><ShieldCheck size={14} /> Administrador protegido</span>
        </div>
        <div className="permission-matrix-scroll">
          <table className="permission-matrix">
            <thead>
              <tr>
                <th scope="col">Módulo y capacidad</th>
                {ROLES.map(role => (
                  <th scope="col" key={role.id}>
                    <span>{role.label}</span>
                    <small>{role.id === 'admin' ? 'Acceso total' : role.id}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map(module => (
                <React.Fragment key={module}>
                  <tr className="permission-matrix__module">
                    <th colSpan={ROLES.length + 1} scope="colgroup">{module}</th>
                  </tr>
                  {catalog.filter(c => c.module === module).map(perm => (
                    <tr key={perm.code}>
                      <th scope="row">
                        <span className="permission-matrix__permission-icon"><ShieldCheck size={15} /></span>
                        <span><strong>{perm.description}</strong><small>{perm.code}</small></span>
                      </th>
                      {ROLES.map(role => {
                        const active = role.id === 'admin' || matrix[role.id]?.has(perm.code);
                        const locked = role.id === 'admin';
                        return (
                          <td key={role.id}>
                            <button
                              type="button"
                              onClick={() => togglePermission(role.id, perm.code)}
                              disabled={locked}
                              aria-pressed={active}
                              aria-label={`${active ? 'Desactivar' : 'Activar'} ${perm.description} para ${role.label}`}
                              title={locked ? 'El administrador conserva acceso total' : `${active ? 'Restringir' : 'Habilitar'} para ${role.label}`}
                              className={`permission-toggle ${active ? 'is-enabled' : ''} ${locked ? 'is-locked' : ''}`}
                            >
                              {active ? <Check size={15} strokeWidth={3} /> : <X size={14} />}
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
        <footer className="permission-matrix-card__footer">
          <span><i className="permission-key permission-key--on" /> Habilitado</span>
          <span><i className="permission-key" /> Restringido</span>
          <p>Los cambios se aplican al guardar y quedan sujetos a auditoría.</p>
        </footer>
      </section>

      {toast && <div className="access-toast" role="status">{toast}</div>}
    </main>
  );
}

export default memo(PermissionsManagementView);
