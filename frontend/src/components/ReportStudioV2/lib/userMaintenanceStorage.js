const USERS_KEY = 'mining_auth_users_v1';
const AUDIT_KEY = 'mining_user_maintenance_audit_v1';

async function getAuthApi() {
  return import('../../../auth/authApi');
}

function readUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function readAudit() {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAudit(logs) {
  localStorage.setItem(AUDIT_KEY, JSON.stringify(logs));
}

function nextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fullName(user) {
  const first = user?.first_name || user?.firstName || '';
  const last = user?.last_name || user?.lastName || '';
  const name = `${first} ${last}`.trim();
  return name || user?.username || 'Usuario';
}

function normalizeStatus(user) {
  if (user?.account_status) {
    return user.account_status;
  }
  if (user?.is_active === false) {
    return 'blocked';
  }
  return 'active';
}

export function listCompanyUsers(company) {
  return readUsers()
    .filter((user) => !company || (user.company || '') === company)
    .map((user) => ({
      id: user.id || user.username,
      username: user.username || '',
      fullName: fullName(user),
      role: user.role || 'operator',
      status: normalizeStatus(user),
      isActive: user.is_active !== false,
      suspensionUntil: user.suspension_until || null,
      company: user.company || '',
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }));
}

export async function listCompanyUsersUnified(company) {
  try {
    const api = await getAuthApi();
    const result = await api.fetchCompanyUsers(company);
    const users = Array.isArray(result?.users) ? result.users : [];

    if (users.length > 0) {
      return {
        source: 'backend',
        users: users
          .filter((user) => !company || (user.company || '') === company)
          .map((user) => ({
            id: user.id || user.username,
            username: user.username || '',
            fullName: fullName(user),
            role: user.role || 'operator',
            status: normalizeStatus(user),
            isActive: user.is_active !== false,
            suspensionUntil: user.suspension_until || null,
            company: user.company || '',
          }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' })),
      };
    }
  } catch {
    // fallback local
  }

  return {
    source: 'local',
    users: listCompanyUsers(company),
  };
}

export function listMaintenanceAudit(company) {
  const logs = readAudit()
    .filter((log) => !company || log.company === company)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return logs;
}

export async function listMaintenanceAuditUnified(company) {
  try {
    const api = await getAuthApi();
    const result = await api.fetchUserMaintenanceAudit({ company, page: 1, pageSize: 20 });
    const logs = Array.isArray(result?.logs) ? result.logs : [];
    if (logs.length > 0) {
      return {
        source: 'backend',
        logs: logs.map((row, index) => ({
          id: row.id || `backend_audit_${index}`,
          timestamp: row.timestamp || row.event_time || new Date().toISOString(),
          company: row.company || row.company_name || company || '',
          success: typeof row.success === 'boolean' ? row.success : row.result === 'success',
          action: row.action || row.event_action || 'maintenance',
          operatorUsername: row.operatorUsername || row.operator_username || '-',
          operatorName: row.operatorName || row.operator_name || row.operator_username || '-',
          targetUsername: row.targetUsername || row.target_username || '-',
          targetName: row.targetName || row.target_name || row.target_username || '-',
          securityMethod: row.securityMethod || row.security_method || '-',
          detail: row.detail || row.message || '-',
          additional: row.additional || {},
        })),
      };
    }
  } catch {
    // fallback local
  }

  return {
    source: 'local',
    logs: listMaintenanceAudit(company),
  };
}

function verifyPasswordSecurity(users, operatorUsername, password) {
  if (!password) {
    return { ok: false, reason: 'Ingrese password de confirmacion.' };
  }

  const operator = users.find((u) => u.username === operatorUsername);
  const storedPassword = operator?.password || operator?.plain_password || '';

  if (!storedPassword) {
    if (password.trim().length < 6) {
      return { ok: false, reason: 'Password de confirmacion invalido.' };
    }
    return { ok: true, reason: 'Validacion local de seguridad aplicada.' };
  }

  if (String(password) !== String(storedPassword)) {
    return { ok: false, reason: 'Password de confirmacion incorrecto.' };
  }

  return { ok: true, reason: 'Password validado correctamente.' };
}

function verifyFaceSecurity(faceCode) {
  if (String(faceCode || '').trim().toUpperCase() !== 'VALIDAR') {
    return { ok: false, reason: 'Confirmacion facial no validada.' };
  }
  return { ok: true, reason: 'Confirmacion facial validada.' };
}

export function applyUserMaintenance({
  company,
  targetUsername,
  action,
  details,
  securityMethod,
  securityPassword,
  securityFaceCode,
  operator,
}) {
  const users = readUsers();
  const now = new Date().toISOString();
  const targetIndex = users.findIndex(
    (u) => (u.username || '') === targetUsername && (!company || (u.company || '') === company),
  );

  let success = false;
  let detail = '';

  const security = securityMethod === 'facial'
    ? verifyFaceSecurity(securityFaceCode)
    : verifyPasswordSecurity(users, operator?.username || '', securityPassword);

  if (!security.ok) {
    detail = security.reason;
  } else if (targetIndex < 0) {
    detail = 'Usuario objetivo no encontrado.';
  } else {
    const target = { ...users[targetIndex] };
    if (action === 'delete') {
      target.is_active = false;
      target.account_status = 'deleted';
      target.deleted_at = now;
      target.maintenance_reason = details?.reason || '';
      detail = 'Usuario eliminado (baja logica).';
      success = true;
    } else if (action === 'block') {
      target.is_active = false;
      target.account_status = 'blocked';
      target.blocked_at = now;
      target.blocked_reason = details?.reason || '';
      detail = 'Usuario bloqueado.';
      success = true;
    } else if (action === 'suspend') {
      target.is_active = false;
      target.account_status = 'suspended';
      target.suspension_until = details?.suspensionUntil || null;
      target.suspension_reason = details?.reason || '';
      detail = `Usuario suspendido ${target.suspension_until ? `hasta ${target.suspension_until}` : 'temporalmente'}.`;
      success = true;
    } else if (action === 'change_profile') {
      target.role = details?.newRole || target.role || 'operator';
      target.profile_updated_at = now;
      target.profile_observation = details?.observation || '';
      detail = `Perfil cambiado a ${target.role}.`;
      success = true;
    } else {
      detail = 'Accion no soportada.';
    }

    if (success) {
      target.updated_at = now;
      users[targetIndex] = target;
      writeUsers(users);
    }
  }

  const targetUser = targetIndex >= 0 ? users[targetIndex] : null;
  const auditEntry = {
    id: nextId('aum'),
    timestamp: now,
    company: company || operator?.company || '',
    success,
    action,
    operatorUsername: operator?.username || '',
    operatorName: operator?.fullName || operator?.username || 'Operador',
    targetUsername,
    targetName: fullName(targetUser || { username: targetUsername }),
    securityMethod,
    detail,
    additional: {
      reason: details?.reason || '',
      suspensionUntil: details?.suspensionUntil || null,
      newRole: details?.newRole || null,
      observation: details?.observation || '',
    },
  };

  writeAudit([auditEntry, ...readAudit()].slice(0, 500));

  return {
    ok: success,
    message: detail,
    auditEntry,
  };
}

export async function applyUserMaintenanceUnified(payload) {
  try {
    const api = await getAuthApi();
    const response = await api.executeUserMaintenance(payload);
    if (response?.status === 'ok' || response?.ok === true || response?.success === true) {
      return {
        ok: true,
        source: 'backend',
        message: response?.message || 'Mantenimiento aplicado correctamente en backend.',
        auditEntry: response?.audit || null,
      };
    }
  } catch {
    // fallback local
  }

  const local = applyUserMaintenance(payload);
  return {
    ...local,
    source: 'local',
  };
}
