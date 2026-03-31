import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
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

export async function createReport(data) {
  const response = await api.post('/reports', data);
  return response.data;
}

export async function updateReport(id, data) {
  const response = await api.put(`/reports/${id}`, data);
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
