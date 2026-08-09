import { log } from '../../../lib/logger';
const USERS_KEY = 'mining_auth_users_v1';
const AUDIT_KEY = 'mining_user_maintenance_audit_v1';

async function getAuthApi(): Promise<any> {
  return import('../../../auth/authApi');
}

function readUsers(): any[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeUsers(users: any[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function readAudit(): any[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAudit(logs: any[]): void {
  localStorage.setItem(AUDIT_KEY, JSON.stringify(logs));
}

function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fullName(user: any): string {
  const first = user?.first_name || user?.firstName || '';
  const last = user?.last_name || user?.lastName || '';
  const name = `${first} ${last}`.trim();
  return name || user?.username || 'Usuario';
}

function normalizeStatus(user: any): string {
  if (user?.account_status) {
    return user.account_status;
  }
  if (user?.is_active === false) {
    return 'blocked';
  }
  return 'active';
}

export function listCompanyUsers(company?: string): any[] {
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
      firstName: user.first_name || user.firstName || '',
      lastName: user.last_name || user.lastName || '',
      email: user.email || '',
      phone: user.phone || '',
      mobile: user.mobile || '',
      dni: user.dni || '',
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }));
}

export async function listCompanyUsersUnified(company?: string): Promise<{ source: string; users: any[] }> {
  try {
    const api = await getAuthApi();
    const result = await api.fetchCompanyUsers(company);
    if (Array.isArray(result?.users)) {
      const users = result.users
        .filter((user: any) => !company || (user.company === company || user.company_name === company))
        .map((user: any) => ({
          id: user.id || user.username,
          username: user.username || '',
          fullName: fullName(user),
          role: user.role || 'operator',
          status: normalizeStatus(user),
          isActive: user.is_active !== false,
          suspensionUntil: user.suspension_until || null,
          company: user.company || user.company_name || '',
          firstName: user.first_name || user.firstName || '',
          lastName: user.last_name || user.lastName || '',
          email: user.email || '',
          phone: user.phone || '',
          mobile: user.mobile || '',
          dni: user.dni || '',
        }))
        .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }));

      // Sincronizamos con el storage local como cache para el fallback
      writeUsers(users);

      return {
        source: 'backend',
        users,
      };
    }
  } catch (err) {
    log.warn("[MAINTENANCE_STORAGE] Backend list failed, using local fallback", err);
  }

  return {
    source: 'local',
    users: listCompanyUsers(company),
  };
}

export function listMaintenanceAudit(company?: string): any[] {
  const logs = readAudit()
    .filter((entry) => !company || entry.company === company)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return logs;
}

export async function listMaintenanceAuditUnified(company?: string): Promise<{ source: string; logs: any[] }> {
  try {
    const api = await getAuthApi();
    const result = await api.fetchUserMaintenanceAudit({ company, page: 1, pageSize: 20 });
    const logs = Array.isArray(result?.logs) ? result.logs : [];
    if (logs.length > 0) {
      return {
        source: 'backend',
        logs: logs.map((row: any, index: number) => ({
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

function verifyPasswordSecurity(users: any[], operatorUsername: string, password: string): { ok: boolean; reason: string } {
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

function verifyFaceSecurity(faceCode: string): { ok: boolean; reason: string } {
  if (String(faceCode || '').trim().toUpperCase() !== 'VALIDAR') {
    return { ok: false, reason: 'Confirmacion facial no validada.' };
  }
  return { ok: true, reason: 'Confirmacion facial validada.' };
}

interface ApplyUserMaintenanceParams {
  company?: string;
  targetUsername: string;
  action: string;
  details?: {
    reason?: string;
    suspensionUntil?: string | null;
    newRole?: string;
    observation?: string;
    firstName?: string;
    lastName?: string;
    dni?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    newPassword?: string;
  };
  securityMethod?: string;
  securityPassword?: string;
  securityFaceCode?: string;
  operator?: { username?: string; fullName?: string; company?: string };
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
}: ApplyUserMaintenanceParams): { ok: boolean; message: string; auditEntry: any } {
  const users = readUsers();
  const now = new Date().toISOString();
  const targetIndex = users.findIndex(
    (u) => (u.username || '') === targetUsername && (!company || (u.company || '') === company),
  );

  let success = false;
  let detail = '';

  const security = securityMethod === 'facial'
    ? verifyFaceSecurity(securityFaceCode || '')
    : verifyPasswordSecurity(users, operator?.username || '', securityPassword || '');

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
    } else if (action === 'unblock') {
      target.is_active = true;
      target.account_status = 'active';
      target.suspension_until = null;
      target.maintenance_reason = details?.reason || '';
      detail = 'Usuario desbloqueado / activado.';
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
    } else if (action === 'edit_data') {
      target.first_name = details?.firstName || target.first_name;
      target.last_name = details?.lastName || target.last_name;
      target.dni = details?.dni || target.dni;
      target.email = details?.email || target.email;
      target.phone = details?.phone || target.phone;
      target.mobile = details?.mobile || target.mobile;
      detail = 'Información personal actualizada.';
      success = true;
    } else if (action === 'reset_password') {
      target.password = details?.newPassword || 'Mining123*';
      target.plain_password = details?.newPassword || 'Mining123*';
      detail = 'Contraseña reseteada correctamente.';
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

export async function applyUserMaintenanceUnified(payload: ApplyUserMaintenanceParams): Promise<{ ok: boolean; source: string; message: string; auditEntry?: any }> {
  try {
    const api = await getAuthApi();
    const response = await api.executeUserMaintenance(payload);

    if (response?.status === 'ok' || response?.ok === true || response?.success === true) {
      return {
        ok: true,
        source: 'backend',
        message: response?.message || 'Mantenimiento aplicado correctamente en servidor.',
        auditEntry: response?.audit || null,
      };
    }

    // Si el servidor respondió explícitamente pero con error (ej: 400 Bad Request)
    if (response?.error) {
       return { ok: false, source: 'backend', message: response.error };
    }
  } catch (err) {
    log.error("[MAINTENANCE_STORAGE] Backend apply error:", err);
    // Solo si el error es de conexión o similar, intentamos fallback local
    const message = (err as Error).message;
    if (message?.includes('failed') || message?.includes('network')) {
       const local = applyUserMaintenance(payload);
       return { ...local, source: 'local' };
    }
    return { ok: false, source: 'backend', message };
  }

  return { ok: false, source: 'backend', message: 'Error de comunicación con el servidor.' };
}
