import axios from 'axios';

function apiBaseUrl() {
  const env = import.meta.env.VITE_BACKEND_URL;
  if (env) {
    return `${String(env).replace(/\/$/, '')}/api`;
  }
  // Mismo origen: Vite (dev/preview con proxy) y Nginx en Docker proxifican /api al backend.
  return '/api';
}

export const api = axios.create({
  baseURL: apiBaseUrl(),
  timeout: 15000,
});

// Interceptor to add auth token
api.interceptors.request.use((config) => {
  const session = JSON.parse(localStorage.getItem('mining_auth_session_v1') || '{}');
  if (session.token) {
    config.headers.Authorization = `Bearer ${session.token}`;
  }
  return config;
});

export async function fetchMineSensors(tenantId) {
  const response = await api.get('/sensors/data', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return response.data?.sensors ?? [];
}

/** Catálogo completo para informe técnico: categorías, tipos, zonas, sensores, historial. */
export async function fetchSensorDashboardCatalog(params = {}) {
  const response = await api.get('/sensors/data', {
    params: {
      ...(params.tenant_id ? { tenant_id: params.tenant_id } : {}),
    },
  });
  return response.data ?? {};
}

export async function fetchMiningKpis({ category } = {}) {
  const response = await api.get('/mining/kpis', {
    params: category ? { category } : undefined,
  });
  return response.data?.kpis ?? [];
}

export async function upsertMiningKpis(items) {
  const payload = {
    items: Array.isArray(items) ? items : [],
  };
  const response = await api.post('/mining/kpis/upsert', payload, { timeout: 30000 });
  return response.data ?? { status: 'error', upserted: 0 };
}

export async function syncMiningKpisFromDashboard() {
  try {
    const response = await api.post('/mining/kpis/sync-from-dashboard', {}, { timeout: 30000 });
    return response.data ?? { status: 'error', synced: 0 };
  } catch (error) {
    const backendError = error?.response?.data?.error;
    const backendMessage = error?.response?.data?.message;
    const status = error?.response?.status;
    if (status === 401) {
      throw new Error('Sesión expirada. Vuelve a iniciar sesión para sincronizar KPI.');
    }
    throw new Error(backendMessage || backendError || 'No se pudo sincronizar KPI desde operación.');
  }
}

export async function syncMiningKpisFromExternal() {
  try {
    const response = await api.post('/mining/kpis/sync-from-external', {}, { timeout: 45000 });
    return response.data ?? { status: 'error', synced: 0 };
  } catch (error) {
    const backendError = error?.response?.data?.error;
    const backendMessage = error?.response?.data?.message;
    const status = error?.response?.status;
    if (status === 401) {
      throw new Error('Sesión expirada. Vuelve a iniciar sesión para sincronizar KPI.');
    }
    throw new Error(backendMessage || backendError || 'No se pudo sincronizar KPI desde fuente externa.');
  }
}

export async function fetchMiningKpiPoints(code, days = 7) {
  const response = await api.get('/mining/kpis/points', {
    params: {
      code,
      days,
    },
  });
  return response.data?.points ?? [];
}

export async function fetchProjects() {
  const response = await api.get('/projects');
  return response.data?.projects ?? [];
}

export async function fetchReports() {
  const response = await api.get('/reports');
  return response.data?.reports ?? [];
}

export async function fetchAnalysisCatalogs() {
  try {
    const response = await api.get('/analysis/catalogos');
    return response.data ?? { rows: [], usuarios: [] };
  } catch (error) {
    const status = error?.response?.status;
    const backendError = error?.response?.data?.error;
    if (status === 401) {
      throw new Error('Sesion expirada o invalida. Vuelve a iniciar sesion.');
    }
    throw new Error(backendError || 'No se pudo cargar el catalogo de formula minera.');
  }
}

export async function runTemperatureAnalysis(payload) {
  try {
    const response = await api.post('/analysis/temperaturas', payload, { timeout: 60000 });
    return response.data ?? { rows: [], summary: {} };
  } catch (error) {
    const status = error?.response?.status;
    const backendError = error?.response?.data?.error;
    if (status === 401) {
      throw new Error('Sesion expirada o invalida. Vuelve a iniciar sesion.');
    }
    throw new Error(backendError || 'No fue posible ejecutar la formula minera.');
  }
}

/** Carga un informe completo (incl. content_json) para edición. */
export async function fetchReportById(id) {
  const response = await api.get(`/reports/${encodeURIComponent(id)}`);
  return response.data;
}

const REPORT_SAVE_TIMEOUT_MS = 120000;

export async function createReport(data) {
  const response = await api.post('/reports', data, { timeout: REPORT_SAVE_TIMEOUT_MS });
  return response.data;
}

export async function updateReport(id, data) {
  const response = await api.put(`/reports/${id}`, data, { timeout: REPORT_SAVE_TIMEOUT_MS });
  return response.data;
}

export async function deleteReport(id) {
  const response = await api.delete(`/reports/${id}`);
  return response.data;
}

export async function validateCompany(company, ruc) {
  const response = await api.get('/auth/validate-company', { params: { company, ruc } });
  return response.data?.valid ?? false;
}

const TEXT_SPELL_TIMEOUT_MS = 120000;

/** Corrección rápida local en backend (regex + normalización). */
export async function textCorrectQuick(text) {
  const response = await api.post(
    '/text/correct/quick',
    { text: String(text ?? '') },
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}

/** Sugerencias LanguageTool vía backend (on-premise). */
export async function textCorrectAdvanced(text, { language = 'es-PE', level = 'picky' } = {}) {
  const response = await api.post(
    '/text/correct/advanced',
    { text: String(text ?? ''), language, level },
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}

/** Pasada segura LT + rápido + reescritura Ollama opcional (on-premise). */
export async function textRewriteOnPremise(
  text,
  { language = 'es-PE', level = 'picky', use_llm = true } = {},
) {
  const response = await api.post(
    '/text/rewrite',
    { text: String(text ?? ''), language, level, use_llm },
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}
