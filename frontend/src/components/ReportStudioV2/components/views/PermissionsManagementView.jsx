import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, Check, X, Save, RotateCcw, 
  Menu, Edit2, Eye, Trash2, Zap, 
  Image, Mail, FileText, Lock, Globe
} from 'lucide-react';
import { USER_ROLES } from '../../../../auth/roleConstants';
import { getSession } from '../../../../auth/authStorage';

const ROLES = USER_ROLES.map(r => ({ id: r.value, label: r.label, color: r.color }));

const FUNCTIONALITIES = [
  { id: 'menu_access', label: 'Acceso a Menús Principal', icon: Menu, group: 'Navegación' },
  { id: 'view_docs', label: 'Visualización de Documentos', icon: Eye, group: 'Operaciones' },
  { id: 'edit_docs', label: 'Edición de Registros', icon: Edit2, group: 'Operaciones' },
  { id: 'delete_docs', label: 'Borrado de Información', icon: Trash2, group: 'Operaciones' },
  { id: 'run_processes', label: 'Ejecución de Procesos', icon: Zap, group: 'Operaciones' },
  { id: 'upload_images', label: 'Envío de Imágenes / Bio', icon: Image, group: 'Comunicaciones' },
  { id: 'send_emails', label: 'Envío de Correos / Alertas', icon: Mail, group: 'Comunicaciones' },
  { id: 'gen_reports', label: 'Generación de Informes', icon: FileText, group: 'Reportabilidad' },
  { id: 'local_auth', label: 'Autorización Local', icon: Lock, group: 'Seguridad' },
  { id: 'remote_auth', label: 'Autorización Remota', icon: Globe, group: 'Seguridad' },
];

export default function PermissionsManagementView() {
  const session = getSession();
  const company = session?.company || '';
  
  // State for the matrix: { [roleId]: { [funcId]: boolean } }
  const [matrix, setMatrix] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initializing with default values (everything off except maybe admin)
    const initial = {};
    ROLES.forEach(r => {
      initial[r.id] = {};
      FUNCTIONALITIES.forEach(f => {
        initial[r.id][f.id] = r.id === 'admin'; // Admin has everything by default
      });
    });
    
    // Attempt to load from localStorage for persistence in this demo/client-side state
    const saved = localStorage.getItem(`perm_matrix_${company}`);
    if (saved) {
      try {
        setMatrix(JSON.parse(saved));
      } catch (e) {
        setMatrix(initial);
      }
    } else {
      setMatrix(initial);
    }
    setLoading(false);
  }, [company]);

  const togglePermission = (roleId, funcId) => {
    setMatrix(prev => ({
      ...prev,
      [roleId]: {
        ...prev[roleId],
        [funcId]: !prev[roleId][funcId]
      }
    }));
  };

  const saveMatrix = () => {
    setSaving(true);
    localStorage.setItem(`perm_matrix_${company}`, JSON.stringify(matrix));
    setTimeout(() => {
      setSaving(false);
      alert('Matriz de permisos actualizada correctamente.');
    }, 800);
  };

  const resetMatrix = () => {
    if (!window.confirm('¿Está seguro de restablecer los permisos por defecto?')) return;
    const initial = {};
    ROLES.forEach(r => {
      initial[r.id] = {};
      FUNCTIONALITIES.forEach(f => {
        initial[r.id][f.id] = r.id === 'admin';
      });
    });
    setMatrix(initial);
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-slate-500 font-bold uppercase text-[10px] animate-pulse">
      Cargando configuración de seguridad...
    </div>
  );

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
              {FUNCTIONALITIES.map((func, idx) => {
                const isGroupStart = idx === 0 || FUNCTIONALITIES[idx-1].group !== func.group;
                return (
                  <React.Fragment key={func.id}>
                    {isGroupStart && (
                      <tr className="bg-slate-800/30">
                        <td colSpan={ROLES.length + 1} className="px-8 py-2 text-[8px] font-black text-indigo-400/60 uppercase tracking-[0.3em]">
                          // {func.group}
                        </td>
                      </tr>
                    )}
                    <tr className="group hover:bg-white/[0.02] transition-colors">
                      <td className="px-8 py-4 bg-slate-900/20">
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-lg bg-slate-800 text-slate-400 group-hover:text-indigo-400 transition-colors">
                            <func.icon size={16} />
                          </div>
                          <div>
                            <div className="text-[11px] font-black text-slate-200 uppercase tracking-tight group-hover:text-white transition-colors">{func.label}</div>
                            <div className="text-[9px] text-slate-500 font-medium italic mt-0.5">Control de {func.id}</div>
                          </div>
                        </div>
                      </td>
                      {ROLES.map(role => {
                        const active = matrix[role.id]?.[func.id];
                        return (
                          <td key={role.id} className="px-4 py-4 text-center">
                            <button 
                              onClick={() => togglePermission(role.id, func.id)}
                              className={`mx-auto w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-300 transform active:scale-90 ${
                                active 
                                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                                : 'bg-slate-800/50 text-slate-600 hover:bg-slate-700/50'
                              }`}
                            >
                              {active ? <Check size={18} strokeWidth={3} /> : <X size={16} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
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

      <style jsx>{`
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
    </div>
  );
}
