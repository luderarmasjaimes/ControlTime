import {
  fetchReports,
  createReport,
  updateReport,
  deleteReport as deleteReportApi,
} from './api';

export function buildFullName(user) {
  const first = user?.first_name || user?.firstName || '';
  const last = user?.last_name || user?.lastName || '';
  const full = `${first} ${last}`.trim();
  return full || user?.username || 'Usuario';
}

/**
 * Retorna lista paginada y filtrada de informes activos (desde el backend).
 */
export async function listReportsAsync({
  company,
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
} = {}) {
  try {
    const rawReports = await fetchReports();
    let all = rawReports.filter((r) => !r.deletedAt);

    if (company) {
      all = all.filter((r) => r.company === company);
    }
    // Apply other filters locally for now, or update API to support them
    if (dateFrom) {
      const from = new Date(dateFrom);
      all = all.filter((r) => new Date(r.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
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
    console.error('Error listing reports:', err);
    return { total: 0, page, pageSize, data: [] };
  }
}

/**
 * Guarda un informe nuevo o actualiza uno existente via API.
 */
export async function saveReportAsync({
  id,
  title,
  projectName,
  contentJson,
  status,
  createdBy,
  createdByName,
  company,
}) {
  const payload = { title, project_id: null, content_json: contentJson, status };
  try {
    if (id && !id.startsWith('seed_')) {
      return await updateReport(id, payload);
    } else {
      return await createReport(payload);
    }
  } catch (err) {
    console.error('Error saving report:', err);
    throw err;
  }
}

/**
 * Elimina un informe via API.
 */
export async function deleteReportAsync(id) {
  try {
    await deleteReportApi(id);
    return true;
  } catch (err) {
    console.error('Error deleting report:', err);
    return false;
  }
}

export async function getReportAsync(id) {
    const reports = await fetchReports();
    return reports.find(r => r.id === id) || null;
}

export async function shareReportAsync(id, { toUsername, message }) {
  // Mock background share for now
  console.log('Sharing report', id, 'with', toUsername, ':', message);
  await new Promise(resolve => setTimeout(resolve, 600));
  return true;
}

// Mock placeholder for users (to be replaced by /api/auth/users later)
export function getReportFilterUsers(company) {
  return {
    createdByOptions: [{ value: 'all', label: 'Todos' }],
    reviewedByOptions: [{ value: 'all', label: 'Todos' }],
  };
}
