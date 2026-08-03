import {
  fetchReports,
  createReport,
  updateReport,
  deleteReport as deleteReportApi,
} from './api';

import { log } from '../../../lib/logger';

function normalizeReport(r: any = {}): any {
  return {
    ...r,
    createdAt: r.createdAt || r.created_at || null,
    updatedAt: r.updatedAt || r.updated_at || null,
    deletedAt: r.deletedAt || r.deleted_at || null,
    company: r.company || r.company_name || '',
    tenantId: r.tenant_id || r.tenantId || '',
    projectName: r.projectName || r.project_name || '',
    createdBy: r.createdBy || r.created_by || '',
    createdByName: r.createdByName || r.created_by_name || '',
    reviewedBy: r.reviewedBy || r.reviewed_by || '',
    reviewedByName: r.reviewedByName || r.reviewed_by_name || '',
    versionNumber: r.versionNumber || r.version_number || 1,
  };
}

export function buildFullName(user: any): string {
  const first = user?.first_name || user?.firstName || '';
  const last = user?.last_name || user?.lastName || '';
  const full = `${first} ${last}`.trim();
  return full || user?.username || 'Usuario';
}

interface ListReportsParams {
  tenantId?: string;
  dateFrom?: string;
  dateTo?: string;
  createdBy?: string;
  reviewedBy?: string;
  status?: string;
  title?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/**
 * Retorna lista paginada y filtrada de informes activos (desde el backend).
 */
export async function listReportsAsync({
  tenantId,
  dateFrom,
  dateTo,
  createdBy,
  reviewedBy,
  status,
  title,
  page = 1,
  pageSize = 20,
  sortBy = 'createdAt',
  sortDir = 'desc',
}: ListReportsParams = {}): Promise<{ total: number; page: number; pageSize: number; data: any[] }> {
  try {
    // tenantId se reenvía al servidor (multitenant real, ver fetchReports en
    // api.ts): el backend valida membresía en auth_user_tenant antes de
    // honrarlo — no hace falta re-filtrar en cliente lo que el servidor ya
    // acotó correctamente (y evita el falso-negativo de antes, donde el
    // filtro cliente comparaba contra datos que el servidor YA había
    // limitado a un solo tenant, haciendo la opción "otra empresa" un no-op).
    const rawReports = await fetchReports(tenantId);
    let all = rawReports.map(normalizeReport).filter((r) => !r.deletedAt);

    // Apply other filters locally for now, or update API to support them.
    // Límites explícitos en UTC (no `new Date(dateTo); .setHours(...)`, que
    // muta en hora LOCAL del navegador): en cualquier timezone UTC-negativo
    // (p.ej. Perú, UTC-5) eso corría el límite superior casi un día hacia
    // atrás, excluyendo silenciosamente los informes creados "hoy" (sus
    // `created_at` en UTC caían después del límite mal calculado).
    if (dateFrom) {
      const from = new Date(`${dateFrom}T00:00:00.000Z`);
      all = all.filter((r) => new Date(r.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(`${dateTo}T23:59:59.999Z`);
      all = all.filter((r) => new Date(r.createdAt) <= to);
    }
    if (status && status !== 'all') {
      all = all.filter((r) => r.status === status);
    }
    if (title) {
      const q = title.toLowerCase();
      all = all.filter((r) => (r.title || '').toLowerCase().includes(q));
    }

    // Sort
    all.sort((a, b) => {
      const av = a[sortBy] || '';
      const bv = b[sortBy] || '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    const total = all.length;
    const data = all.slice((page - 1) * pageSize, page * pageSize);
    return { total, page, pageSize, data };
  } catch (err) {
    log.error('Error listing reports:', err);
    return { total: 0, page, pageSize, data: [] };
  }
}

interface SaveReportParams {
  id?: string;
  title?: string;
  projectName?: string;
  contentJson?: unknown;
  status?: string;
  createdBy?: string;
  createdByName?: string;
  company?: string;
  workflowComment?: string;
  // ADR-022: versión de la que partió la edición (concurrencia optimista).
  // Solo se envía en la reconciliación offline — el guardado normal en
  // línea no la necesita (siempre parte de la versión recién confirmada).
  // Si no coincide con la versión real del servidor, el backend responde
  // 409 `version_conflict` sin tocar el informe — ver reconcileOfflineSave.
  expectedVersion?: number;
}

/**
 * Guarda un informe nuevo o actualiza uno existente via API.
 */
export async function saveReportAsync({
  id,
  title,
  contentJson,
  status,
  workflowComment,
  expectedVersion,
}: SaveReportParams): Promise<any> {
  const payload: Record<string, unknown> = { title, project_id: null, content_json: contentJson, status };
  if (workflowComment) {
    payload.workflow_comment = workflowComment;
  }
  if (typeof expectedVersion === 'number') {
    payload.expected_version = String(expectedVersion);
  }
  try {
    if (id && !id.startsWith('seed_')) {
      return await updateReport(id, payload);
    } else {
      return await createReport(payload);
    }
  } catch (err) {
    log.error('Error saving report:', err);
    throw err;
  }
}

/**
 * Elimina un informe via API.
 */
export async function deleteReportAsync(id: string): Promise<boolean> {
  try {
    await deleteReportApi(id);
    return true;
  } catch (err) {
    log.error('Error deleting report:', err);
    return false;
  }
}

export async function getReportAsync(id: string): Promise<any | null> {
    const reports = await fetchReports();
    return reports.find(r => r.id === id) || null;
}

export async function shareReportAsync(id: string, { toUsername, message }: { toUsername?: string; message?: string }): Promise<boolean> {
  // Mock background share for now
  log.debug('Sharing report', id, 'with', toUsername, ':', message);
  await new Promise(resolve => setTimeout(resolve, 600));
  return true;
}

// Mock placeholder for users (to be replaced by /api/auth/users later)
export function getReportFilterUsers(company?: string) {
  return {
    createdByOptions: [{ value: 'all', label: 'Todos' }],
    reviewedByOptions: [{ value: 'all', label: 'Todos' }],
  };
}
