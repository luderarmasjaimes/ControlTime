import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Users, X, Lock, UserX, UserCog, Clock3 } from 'lucide-react';
import { getSession } from '../../../../auth/authStorage';
import {
  applyUserMaintenanceUnified,
  listCompanyUsersUnified,
  listMaintenanceAuditUnified,
} from '../../lib/userMaintenanceStorage';
import { ensureCompanyUsers } from '../../lib/userBootstrap';

const ACTIONS = [
  { value: 'delete', label: 'Eliminar', icon: UserX },
  { value: 'block', label: 'Bloquear', icon: Lock },
  { value: 'suspend', label: 'Suspension temporal', icon: Clock3 },
  { value: 'change_profile', label: 'Cambio de perfil', icon: UserCog },
];

const ROLE_OPTIONS = [
  { value: 'operator', label: 'Operator - Jefe de area' },
  { value: 'supervisor', label: 'Supervisor - Gerente de planta' },
  { value: 'admin', label: 'Admin' },
];

function statusLabel(status) {
  if (status === 'blocked') return 'Bloqueado';
  if (status === 'suspended') return 'Suspendido';
  if (status === 'deleted') return 'Eliminado';
  return 'Activo';
}

export default function UserMaintenanceModal({ onClose }) {
  const session = getSession();
  const company = session?.company || '';

  const [users, setUsers] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [dataSource, setDataSource] = useState('local');
  const [selectedUsername, setSelectedUsername] = useState('');
  const [action, setAction] = useState('block');
  const [reason, setReason] = useState('');
  const [suspensionUntil, setSuspensionUntil] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [observation, setObservation] = useState('');
  const [securityMethod, setSecurityMethod] = useState('password');
  const [securityPassword, setSecurityPassword] = useState('');
  const [securityFaceCode, setSecurityFaceCode] = useState('');
  const [status, setStatus] = useState({ type: 'info', text: 'Seleccione usuario y accion para iniciar mantenimiento.' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const target = useMemo(
    () => users.find((u) => u.username === selectedUsername) || null,
    [users, selectedUsername],
  );

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      // Ensure users are bootstrapped first
      ensureCompanyUsers(company);
      
      const usersResult = await listCompanyUsersUnified(company);
      const auditResult = await listMaintenanceAuditUnified(company);

      if (!mounted) return;
      setUsers(usersResult.users);
      setAuditRows(auditResult.logs.slice(0, 8));
      setDataSource(usersResult.source === 'backend' || auditResult.source === 'backend' ? 'backend' : 'local');
      setLoading(false);
    };

    loadData();
    return () => {
      mounted = false;
    };
  }, [company]);

  const requiresReason = action === 'delete' || action === 'block' || action === 'suspend';

  const applyChanges = async () => {
    if (!target) {
      setStatus({ type: 'error', text: 'Seleccione un usuario objetivo.' });
      return;
    }
    if (requiresReason && !reason.trim()) {
      setStatus({ type: 'error', text: 'Ingrese un motivo para la accion seleccionada.' });
      return;
    }
    if (action === 'suspend' && !suspensionUntil) {
      setStatus({ type: 'error', text: 'Indique fecha fin de suspension temporal.' });
      return;
    }
    if (action === 'change_profile' && !newRole) {
      setStatus({ type: 'error', text: 'Seleccione el nuevo perfil del usuario.' });
      return;
    }

    setSaving(true);
    const result = await applyUserMaintenanceUnified({
      company,
      targetUsername: target.username,
      action,
      details: {
        reason,
        suspensionUntil,
        newRole,
        observation,
      },
      securityMethod,
      securityPassword,
      securityFaceCode,
      operator: session,
    });

    const usersResult = await listCompanyUsersUnified(company);
    const auditResult = await listMaintenanceAuditUnified(company);
    setUsers(usersResult.users);
    setAuditRows(auditResult.logs.slice(0, 8));
    setDataSource(usersResult.source === 'backend' || auditResult.source === 'backend' ? 'backend' : 'local');

    const sourceLabel = result.source === 'backend' ? 'Backend' : 'Local';
    setStatus({ type: result.ok ? 'ok' : 'error', text: `${result.message} (${sourceLabel})` });
    setSaving(false);

    if (result.ok) {
      setReason('');
      setSuspensionUntil('');
      setObservation('');
      setSecurityPassword('');
      setSecurityFaceCode('');
    }
  };

  return (
    <div className="ra-overlay" onClick={onClose}>
      <div className="rum-modal" onClick={(event) => event.stopPropagation()}>
        <div className="rum-header">
          <div className="rum-title-wrap">
            <Users size={18} />
            <div>
              <h3>Mantenimiento de Usuarios</h3>
              <p>{company || 'Empresa'} - {users.length} usuario(s) - Fuente: {dataSource}</p>
            </div>
          </div>
          <button className="ra-close-btn" onClick={onClose} title="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="rum-body">
          <div className="rum-users">
            <table className="rum-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Nombre</th>
                  <th>Username</th>
                  <th>Perfil</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="rum-empty">Cargando usuarios...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="rum-empty">No hay usuarios para esta empresa.</td>
                  </tr>
                ) : users.map((user) => (
                  <tr
                    key={user.username}
                    className={selectedUsername === user.username ? 'rum-selected' : ''}
                    onClick={() => setSelectedUsername(user.username)}
                  >
                    <td>
                      <input
                        type="radio"
                        readOnly
                        checked={selectedUsername === user.username}
                        style={{ accentColor: '#2563eb' }}
                      />
                    </td>
                    <td>{user.fullName}</td>
                    <td>{user.username}</td>
                    <td>{user.role}</td>
                    <td><span className={`rum-state rum-${user.status}`}>{statusLabel(user.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rum-form">
            <div className="ra-field">
              <label>Accion de mantenimiento</label>
              <select value={action} onChange={(event) => setAction(event.target.value)}>
                {ACTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>

            {requiresReason && (
              <div className="ra-field">
                <label>Motivo</label>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Motivo obligatorio..."
                />
              </div>
            )}

            {action === 'suspend' && (
              <div className="ra-field">
                <label>Fecha fin suspension</label>
                <input
                  type="date"
                  value={suspensionUntil}
                  onChange={(event) => setSuspensionUntil(event.target.value)}
                />
              </div>
            )}

            {action === 'change_profile' && (
              <>
                <div className="ra-field">
                  <label>Nuevo perfil</label>
                  <select value={newRole} onChange={(event) => setNewRole(event.target.value)}>
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="ra-field">
                  <label>Observacion</label>
                  <textarea
                    rows={2}
                    value={observation}
                    onChange={(event) => setObservation(event.target.value)}
                    placeholder="Detalle del cambio de perfil..."
                  />
                </div>
              </>
            )}

            <div className="rum-security">
              <div className="rum-security-title">
                <ShieldCheck size={14} /> Confirmacion de seguridad
              </div>

              <div className="rum-security-methods">
                <label>
                  <input
                    type="radio"
                    checked={securityMethod === 'password'}
                    onChange={() => setSecurityMethod('password')}
                  />
                  Password de confirmacion
                </label>
                <label>
                  <input
                    type="radio"
                    checked={securityMethod === 'facial'}
                    onChange={() => setSecurityMethod('facial')}
                  />
                  Confirmacion facial
                </label>
              </div>

              {securityMethod === 'password' ? (
                <div className="ra-field">
                  <label>Password de confirmacion</label>
                  <input
                    type="password"
                    value={securityPassword}
                    onChange={(event) => setSecurityPassword(event.target.value)}
                    placeholder="Ingrese password del operador"
                  />
                </div>
              ) : (
                <div className="ra-field">
                  <label>Confirmacion facial (simulada)</label>
                  <input
                    type="text"
                    value={securityFaceCode}
                    onChange={(event) => setSecurityFaceCode(event.target.value)}
                    placeholder="Escriba VALIDAR para confirmar"
                  />
                </div>
              )}
            </div>

            <div className={`rum-status rum-status-${status.type}`}>{status.text}</div>

            <div className="rum-actions">
              <button className="ra-btn-ghost" onClick={onClose}>Cerrar</button>
              <button className="ra-btn-primary" onClick={applyChanges} disabled={saving || !selectedUsername}>
                {saving ? 'Aplicando...' : 'Aplicar Cambios'}
              </button>
            </div>
          </div>
        </div>

        <div className="rum-audit">
          <h4>Auditoria reciente</h4>
          <div className="rum-audit-list">
            {auditRows.length === 0 ? (
              <p>Sin registros de auditoria.</p>
            ) : auditRows.map((log) => (
              <div key={log.id} className="rum-audit-item">
                <span className={`rum-dot ${log.success ? 'ok' : 'fail'}`} />
                <div>
                  <strong>{log.success ? 'Exito' : 'Falla'} - {log.action}</strong>
                  <div>{log.targetUsername} | operador: {log.operatorUsername} | {new Date(log.timestamp).toLocaleString('es-PE')}</div>
                  <div>{log.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
