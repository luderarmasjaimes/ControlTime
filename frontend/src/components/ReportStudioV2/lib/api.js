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

export async function fetchMineSensors() {
  const response = await api.get('/sensors/data');
  return response.data?.sensors ?? [];
}

export async function fetchProjects() {
  const response = await api.get('/projects');
  return response.data?.projects ?? [];
}

export async function fetchReports() {
  const response = await api.get('/reports');
  return response.data?.reports ?? [];
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
