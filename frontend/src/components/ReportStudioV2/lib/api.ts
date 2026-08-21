import axios, { AxiosError } from 'axios';
import { refreshAccessToken } from '../../../auth/authApi';
import { authHeaders } from '../../../auth/authStorage';

export function apiBaseUrl(): string {
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
  // ADR-082: la credencial es la cookie HttpOnly `access_token`; sin esto,
  // axios no la envía cuando el backend está en otro origen.
  withCredentials: true,
});

/**
 * Token Bearer explícito para contextos SIN cookies de sesión.
 *
 * Único consumidor: la página de impresión (`print-report/main.tsx`), a la que
 * navega el Chromium headless del sidecar de export PDF (ADR-016). Ese
 * navegador es un proceso limpio, sin las cookies del usuario, así que la
 * autenticación por cookie de ADR-082 no le sirve: el sidecar le pasa un token
 * en la URL y esa página lo instala aquí, en memoria del módulo.
 *
 * No se persiste en `localStorage` a propósito — vive lo que vive la pestaña
 * headless, que se cierra al terminar la captura.
 */
let explicitBearerToken = '';

/** @brief Instala el token Bearer para el render headless. No usar en la SPA. */
export function setExplicitBearerToken(token: string): void {
  explicitBearerToken = token || '';
}

// ADR-082: ya no hay token que leer de localStorage — el navegador adjunta la
// cookie solo. Lo que sí tiene que poner este código es el token CSRF del
// double-submit, porque una cookie viaja también en peticiones originadas por
// terceros y el backend rechaza las mutaciones que no lo traigan.
api.interceptors.request.use((config) => {
  if (explicitBearerToken) {
    config.headers.set('Authorization', `Bearer ${explicitBearerToken}`);
  }
  Object.entries(authHeaders()).forEach(([key, value]) => {
    config.headers.set(key, value);
  });
  return config;
});

// ADR-029 (revisado): access token de vida corta (~15 min) — un 401 no
// significa necesariamente que la sesión terminó, solo que el token vigente
// venció. Se intenta renovar una sola vez (refreshAccessToken deduplica
// refrescos concurrentes con authApi.ts) y se reintenta la request original.
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _retriedAfterRefresh?: boolean;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original._retriedAfterRefresh) {
      original._retriedAfterRefresh = true;
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // ADR-082: no hay que reinyectar nada en la request. La respuesta de
        // /api/auth/refresh ya trajo un `Set-Cookie` con el access token nuevo,
        // así que el reintento lo lleva solo. Antes se copiaba el token a un
        // header `Authorization`, que es justo el material que este ADR saca
        // del alcance del JS.
        return api.request(original);
      }
    }
    return Promise.reject(error);
  }
);

function backendErrorMessage(error: unknown): { status?: number; backendError?: string; backendMessage?: string } {
  const err = error as AxiosError<{ error?: string; message?: string }>;
  return {
    status: err?.response?.status,
    backendError: err?.response?.data?.error,
    backendMessage: err?.response?.data?.message,
  };
}

export async function fetchMineSensors(tenantId?: string): Promise<any[]> {
  const response = await api.get('/sensors/data', {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return response.data?.sensors ?? [];
}

/** Catálogo completo para informe técnico: categorías, tipos, zonas, sensores, historial. */
export async function fetchSensorDashboardCatalog(params: { tenant_id?: string } = {}): Promise<any> {
  const response = await api.get('/sensors/data', {
    params: {
      ...(params.tenant_id ? { tenant_id: params.tenant_id } : {}),
    },
  });
  return response.data ?? {};
}

/**
 * Catálogo del wizard de gráfico multi-sensor (ReportStudioV2): tipos de
 * sensor disponibles (paso 1), zonas geográficas (db_scripts/54) y, si se
 * pasa `sensor_type`, los sensores de ese tipo agrupados por zona y por
 * dispositivo físico (`device_key`) para el árbol zona→dispositivo→unidad.
 */
export async function fetchTelemetryWizardCatalog(params: {
  sensor_type?: string;
  tenant_id?: string;
} = {}): Promise<any> {
  const response = await api.get('/mining/telemetry/wizard/catalog', {
    params: {
      ...(params.sensor_type ? { sensor_type: params.sensor_type } : {}),
      ...(params.tenant_id ? { tenant_id: params.tenant_id } : {}),
    },
  });
  return response.data ?? {};
}

/**
 * Series históricas de `telemetry_raw` para los sensores ya elegidos en el
 * wizard, acotadas por `from`/`to` (ISO 8601). `agg` por defecto es
 * 'hourly' (mismo criterio de downsampling que /mining/telemetry/summary).
 */
export async function fetchTelemetryWizardSeries(params: {
  sensorIds: string[];
  from: string;
  to: string;
  agg?: 'raw' | 'hourly' | 'daily';
  tenant_id?: string;
}): Promise<any> {
  const response = await api.get('/mining/telemetry/wizard/query', {
    params: {
      sensor_ids: params.sensorIds.join(','),
      from: params.from,
      to: params.to,
      ...(params.agg ? { agg: params.agg } : {}),
      ...(params.tenant_id ? { tenant_id: params.tenant_id } : {}),
    },
  });
  return response.data ?? {};
}

export async function fetchMiningKpis({ category }: { category?: string } = {}): Promise<any[]> {
  const response = await api.get('/mining/kpis', {
    params: category ? { category } : undefined,
  });
  return response.data?.kpis ?? [];
}

export async function upsertMiningKpis(items: unknown[]): Promise<any> {
  const payload = {
    items: Array.isArray(items) ? items : [],
  };
  const response = await api.post('/mining/kpis/upsert', payload, { timeout: 30000 });
  return response.data ?? { status: 'error', upserted: 0 };
}

export async function syncMiningKpisFromDashboard(): Promise<any> {
  try {
    const response = await api.post('/mining/kpis/sync-from-dashboard', {}, { timeout: 30000 });
    return response.data ?? { status: 'error', synced: 0 };
  } catch (error) {
    const { status, backendError, backendMessage } = backendErrorMessage(error);
    if (status === 401) {
      throw new Error('Sesión expirada. Vuelve a iniciar sesión para sincronizar KPI.');
    }
    throw new Error(backendMessage || backendError || 'No se pudo sincronizar KPI desde operación.');
  }
}

/** Sismos oficiales IGP/CENSIS (en vivo) + microsismicidad de la red propia,
 * ambos filtrados al mismo rango start/end -- ver backend/src/mining/mining_routes.cpp
 * (handleSeismicReport) y igp_seismic_client.cpp. */
export async function fetchSeismicReport(start: string, end: string): Promise<any> {
  const response = await api.get('/mining/seismic/report', { params: { start, end } });
  return response.data ?? { igp: { events: [] }, company: { events: [] } };
}

/** Config del chatbot de soporte (¿Ollama configurado? ¿WhatsApp configurado?), sin secretos. */
export async function fetchSupportChatConfig(): Promise<any> {
  const response = await api.get('/support/chat/config');
  return response.data ?? { ollama_url_set: false, whatsapp_configured: false };
}

/**
 * Canal de origen del chat de soporte -- el backend lo usa para decidir el
 * flujo de escalamiento/plantillas por canal (ver ADR del chatbot de
 * soporte). Este widget es el canal web del módulo Informe Técnico, así que
 * siempre manda 'HomeMinero'; 'MovilMinero' queda reservado para el futuro
 * cliente móvil, que reusará estas mismas funciones.
 */
export type SupportChatChannel = 'HomeMinero' | 'MovilMinero';

/** Envía el historial de la conversación + datos de calificación al asistente minero (Ollama). */
export async function sendSupportChatMessage(
  qualifying: Record<string, string>,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options: { channel?: SupportChatChannel; conversationId?: string } = {},
): Promise<{ reply?: string; error?: string; conversation_id?: string }> {
  const { channel = 'HomeMinero', conversationId } = options;
  try {
    const response = await api.post(
      '/support/chat/message',
      { qualifying, messages, channel, ...(conversationId ? { conversation_id: conversationId } : {}) },
      { timeout: 90000 },
    );
    return response.data ?? { error: 'empty_response' };
  } catch (error) {
    const { backendError, backendMessage } = backendErrorMessage(error);
    return { error: backendMessage || backendError || 'chat_request_failed' };
  }
}

/** Intención del turno: el backend la usa para el presupuesto de tokens de la
 * respuesta (ver support::numPredictFor). "expand" necesita mucho más que un
 * turno conversacional; con el límite único anterior la ampliación se cortaba
 * a media frase. */
export type SupportChatIntent = 'chat' | 'summarize' | 'expand' | 'ideas';

/** Mensaje del chat de soporte. `promptContent` permite que lo que se MUESTRA
 * en la burbuja y lo que se ENVÍA al modelo difieran: los chips
 * Resumir/Ampliar/Ideas muestran una etiqueta corta pero envían el texto a
 * procesar incrustado, para no depender de que el modelo resuelva bien a qué
 * se refiere "tu mensaje anterior". `transient` marca los avisos que genera la
 * propia UI (errores de conexión): se ven en pantalla pero nunca se mandan
 * como historial, o el modelo los toma por turnos suyos. */
export interface SupportChatMessage {
  role: 'user' | 'assistant';
  content: string;
  promptContent?: string;
  transient?: boolean;
  /** Saludo inicial del widget: no lleva chips de acciones (copiar/resumir/ampliar/ideas). */
  isWelcome?: boolean;
  /** Adjunto (ADR-129): id devuelto por uploadChatAttachment/submitWebCv, para
   * mostrar una miniatura/chip de descarga bajo la burbuja del mensaje. */
  attachmentId?: string;
  attachmentFilename?: string;
  attachmentMimeType?: string;
}

/**
 * Igual que sendSupportChatMessage, pero consume el endpoint de streaming
 * (backend/src/main.cpp::handleChatStreamSse, text/event-stream) y reenvía
 * cada fragmento vía onChunk a medida que Ollama lo va generando -- el
 * usuario ve el texto aparecer progresivamente en vez de esperar la
 * respuesta completa en silencio. Usa fetch (no axios: la lectura por
 * streaming del body vía ReadableStream no tiene un equivalente directo en
 * axios para navegador) y replica a mano el mismo interceptor de auth que
 * usa `api` (misma clave de localStorage).
 */
export async function streamSupportChatMessage(
  qualifying: Record<string, string>,
  messages: SupportChatMessage[],
  onChunk: (fragment: string) => void,
  intent: SupportChatIntent = 'chat',
  options: { channel?: SupportChatChannel; conversationId?: string } = {},
): Promise<{ error?: string; conversationId?: string }> {
  const { channel = 'HomeMinero', conversationId } = options;
  const wireMessages = messages
    .filter((m) => !m.transient)
    .map((m) => ({ role: m.role, content: m.promptContent ?? m.content }));
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/support/chat/stream`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        qualifying,
        messages: wireMessages,
        intent,
        channel,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    });
  } catch {
    return { error: 'network_error' };
  }
  if (!res.ok || !res.body) {
    return { error: `http_${res.status}` };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let sawError: string | undefined;
  // TODO(reconciliar con backend real): se asume que `conversation_id` puede
  // llegar en cualquier evento SSE del turno (típicamente el primero o el de
  // `done`) -- si el backend real lo manda solo en un evento específico,
  // esta captura "el último que aparezca" sigue funcionando igual.
  let sawConversationId: string | undefined;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    // Eventos SSE separados por línea en blanco ("\n\n") -- cada uno trae una
    // sola línea "data: {...}" (el backend no usa multi-línea por evento).
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const evt = JSON.parse(dataLine.slice(5).trim());
        if (evt.chunk) onChunk(String(evt.chunk));
        if (evt.error) sawError = String(evt.error);
        if (typeof evt.conversation_id === 'string' && evt.conversation_id) sawConversationId = evt.conversation_id;
        if (evt.done) return { error: sawError, conversationId: sawConversationId };
      } catch {
        // Evento malformado -- se ignora, el stream continúa.
      }
    }
  }
  return { error: sawError, conversationId: sawConversationId };
}

/** Escala la conversación a soporte humano por WhatsApp Business Cloud API (plantilla al número configurado). */
export async function escalateSupportChatToWhatsapp(): Promise<{ status?: string; error?: string }> {
  try {
    const response = await api.post('/support/whatsapp/escalate', {}, { timeout: 20000 });
    return response.data ?? { error: 'empty_response' };
  } catch (error) {
    const { backendError, backendMessage } = backendErrorMessage(error);
    return { error: backendMessage || backendError || 'escalate_request_failed' };
  }
}

/** Categorías válidas de `support_ticket` (ver kValidCategories en support_routes.cpp). */
export type SupportTicketCategory = 'soporte' | 'comercial' | 'reclamo' | 'agenda' | 'rrhh';

/** Crea un ticket directamente desde la web (ADR-112: endpoint reservado para
 * este uso desde el principio) -- usado por el menú de WhatsApp del widget
 * (SupportChatWidget.tsx) para las categorías que requieren contacto humano. */
export async function createSupportTicket(payload: {
  category: SupportTicketCategory;
  description: string;
  subject?: string;
  contact_name?: string;
  priority?: 'baja' | 'media' | 'alta';
}): Promise<{ code?: string; status?: string; error?: string }> {
  try {
    const response = await api.post('/support/tickets', payload, { timeout: 20000 });
    return response.data ?? { error: 'empty_response' };
  } catch (error) {
    const { backendError, backendMessage } = backendErrorMessage(error);
    return { error: backendMessage || backendError || 'ticket_create_failed' };
  }
}

/** Extensiones de archivo aceptadas como adjunto del chat (ADR-129) --
 * espejo de allowedChatAttachmentExtensions() en support_routes.cpp. */
export const ALLOWED_CHAT_ATTACHMENT_EXT = ['.docx', '.pptx', '.pdf', '.jpg', '.jpeg', '.png'];

export interface ChatAttachmentUploadResult {
  attachment_id?: string;
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
  /** Solo jpg/png (ADR-129): texto detectado por OCR (pytesseract, ver
   * image_analysis_client.cpp) -- vacío si no había texto legible. */
  ocr_text?: string;
  /** Solo jpg/png: contenido de cualquier QR/código de barras detectado. */
  qr_codes?: string[];
  error?: string;
}

/** Sube un archivo adjunto (docx/pptx/pdf/jpg/png) del widget de chat --
 * cuerpo binario crudo (no multipart), mismo criterio que
 * tenant_assets_routes.cpp (uploadLogo/uploadGalleryImage). Para jpg/png el
 * backend ejecuta QR+OCR vía ai_engine antes de responder (ver ocr_text/
 * qr_codes) -- por eso el timeout es más generoso que otras escrituras. */
export async function uploadChatAttachment(
  file: File,
  conversationId?: string,
): Promise<ChatAttachmentUploadResult> {
  try {
    const params = new URLSearchParams({ filename: file.name });
    if (conversationId) params.set('conversation_id', conversationId);
    const response = await api.post(`/support/chat/attachment?${params.toString()}`, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      timeout: 45000,
    });
    return response.data ?? { error: 'empty_response' };
  } catch (error) {
    const { backendError, backendMessage } = backendErrorMessage(error);
    return { error: backendMessage || backendError || 'attachment_upload_failed' };
  }
}

/** URL de descarga de un adjunto ya subido (requiere la cookie de sesión --
 * mismo origen que el resto de la SPA, ver handleDownloadChatAttachment). */
export function chatAttachmentUrl(attachmentId: string): string {
  return `${apiBaseUrl()}/support/chat/attachment/${attachmentId}`;
}

export interface WebCvSubmitResult {
  submission_id?: string;
  filename?: string;
  status?: string;
  profile_preview?: { cargo_postulado?: string; score?: number } | null;
  error?: string;
}

/** Sube un CV (docx/pptx/pdf) desde el flujo "Recursos Humanos" del widget --
 * reusa el mismo pipeline de extracción+scoring que ya procesa los CV
 * recibidos por WhatsApp (ADR-122/129). */
export async function submitWebCv(file: File): Promise<WebCvSubmitResult> {
  try {
    const params = new URLSearchParams({ filename: file.name });
    const response = await api.post(`/support/cv/submit?${params.toString()}`, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      timeout: 90000,
    });
    return response.data ?? { error: 'empty_response' };
  } catch (error) {
    const { backendError, backendMessage } = backendErrorMessage(error);
    return { error: backendMessage || backendError || 'cv_submit_failed' };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   PANEL ADMIN DE SOPORTE (búsqueda de tickets/conversaciones) -- consume dos
   endpoints paginados en SERVIDOR (page/page_size van en el request, no se
   trae todo para filtrar en cliente):
     GET /api/support/admin/tickets        (soporte.view/soporte.manage o
                                             usuario "department-scoped")
     GET /api/support/admin/chat-messages  (solo soporte.view/soporte.manage)
   RBAC real la aplica el backend (403 si no corresponde); aquí solo se arma
   el request y se propaga el error/status para que la vista pueda mostrar un
   mensaje acorde (sesión expirada / sin permiso / error genérico) -- mismo
   patrón "no-throw, {error}" que el resto de este archivo (sendSupportChatMessage,
   escalateSupportChatToWhatsapp, etc.).
   ───────────────────────────────────────────────────────────────────────── */

export interface SupportTicket {
  id: string;
  code: string;
  channel: string;
  category: string;
  phone_e164: string;
  contact_name: string;
  tenant_id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface SupportChatMessageAdminRow {
  id: string;
  conversation_id: string;
  tenant_id: string;
  user_id: string;
  channel: string;
  role: string;
  content: string;
  intent: string | null;
  created_at: string;
}

export interface SupportAdminSearchResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  error?: string;
  status?: number;
}

export interface SupportTicketFilters {
  category?: string;
  status?: string;
  channel?: string;
  priority?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SupportChatMessageFilters {
  conversationId?: string;
  tenantId?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

function emptyAdminSearchResult<T>(page: number, pageSize: number, error: string, status?: number): SupportAdminSearchResult<T> {
  return { items: [], total: 0, page, page_size: pageSize, pages: 0, error, status };
}

/** GET /api/support/admin/tickets -- 403 si el usuario no tiene soporte.view/soporte.manage/departamento propio.
 * Si el usuario está "department-scoped", el backend fuerza `category` a su
 * departamento server-side -- si el frontend manda una `category` distinta,
 * responde 403 (no es un bug de este cliente, es la regla del contrato). */
export async function searchSupportTickets(
  filters: SupportTicketFilters,
  page = 1,
  pageSize = 20,
): Promise<SupportAdminSearchResult<SupportTicket>> {
  try {
    const response = await api.get('/support/admin/tickets', {
      params: {
        page,
        page_size: pageSize,
        ...(filters.category && filters.category !== 'all' ? { category: filters.category } : {}),
        ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}),
        ...(filters.channel && filters.channel !== 'all' ? { channel: filters.channel } : {}),
        ...(filters.priority && filters.priority !== 'all' ? { priority: filters.priority } : {}),
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
        ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
      },
    });
    const data = response.data ?? {};
    return {
      items: Array.isArray(data.items) ? data.items : [],
      total: Number(data.total) || 0,
      page: Number(data.page) || page,
      page_size: Number(data.page_size) || pageSize,
      pages: Number(data.pages) || 0,
    };
  } catch (error) {
    const { status, backendError, backendMessage } = backendErrorMessage(error);
    return emptyAdminSearchResult(page, pageSize, backendMessage || backendError || 'tickets_search_failed', status);
  }
}

/** GET /api/support/admin/chat-messages -- requiere soporte.view o soporte.manage
 * (403 si el usuario solo tiene `department`, sin esos permisos). */
export async function searchSupportChatMessages(
  filters: SupportChatMessageFilters,
  page = 1,
  pageSize = 20,
): Promise<SupportAdminSearchResult<SupportChatMessageAdminRow>> {
  try {
    const response = await api.get('/support/admin/chat-messages', {
      params: {
        page,
        page_size: pageSize,
        ...(filters.conversationId ? { conversation_id: filters.conversationId } : {}),
        ...(filters.tenantId ? { tenant_id: filters.tenantId } : {}),
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
        ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
      },
    });
    const data = response.data ?? {};
    return {
      items: Array.isArray(data.items) ? data.items : [],
      total: Number(data.total) || 0,
      page: Number(data.page) || page,
      page_size: Number(data.page_size) || pageSize,
      pages: Number(data.pages) || 0,
    };
  } catch (error) {
    const { status, backendError, backendMessage } = backendErrorMessage(error);
    return emptyAdminSearchResult(page, pageSize, backendMessage || backendError || 'chat_messages_search_failed', status);
  }
}

export interface SupportChatAttachmentAdminRow {
  id: string;
  conversation_id: string | null;
  tenant_id: string | null;
  user_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  ocr_text: string;
  qr_codes: string[];
  created_at: string;
}

export interface SupportChatAttachmentFilters {
  conversationId?: string;
  tenantId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** GET /api/support/admin/chat-attachments (ADR-129) -- mismo RBAC que
 * searchSupportChatMessages (soporte.view/soporte.manage). */
export async function searchSupportChatAttachments(
  filters: SupportChatAttachmentFilters,
  page = 1,
  pageSize = 20,
): Promise<SupportAdminSearchResult<SupportChatAttachmentAdminRow>> {
  try {
    const response = await api.get('/support/admin/chat-attachments', {
      params: {
        page,
        page_size: pageSize,
        ...(filters.conversationId ? { conversation_id: filters.conversationId } : {}),
        ...(filters.tenantId ? { tenant_id: filters.tenantId } : {}),
        ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
        ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
      },
    });
    const data = response.data ?? {};
    return {
      items: Array.isArray(data.items) ? data.items : [],
      total: Number(data.total) || 0,
      page: Number(data.page) || page,
      page_size: Number(data.page_size) || pageSize,
      pages: Number(data.pages) || 0,
    };
  } catch (error) {
    const { status, backendError, backendMessage } = backendErrorMessage(error);
    return emptyAdminSearchResult(page, pageSize, backendMessage || backendError || 'chat_attachments_search_failed', status);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   PANEL DE CANDIDATOS RRHH (ADR-122) -- postulaciones de CV recibidas por el
   bot de WhatsApp, extraídas/puntuadas con IA local (Ollama). Mismo patrón de
   paginación server-side que el panel admin de soporte de arriba.
   GET /api/support/admin/candidates            (búsqueda paginada)
   GET /api/support/admin/candidates/{id}        (detalle completo)
   GET /api/support/admin/candidates/{id}/file   (descarga del CV original)
   RBAC (backend): soporte.view/soporte.manage, o department === 'rrhh'.
   ───────────────────────────────────────────────────────────────────────── */

export interface CvCandidateSummary {
  submission_id: string;
  phone_e164: string;
  original_filename: string;
  mime_type: string;
  status: string;
  created_at: string;
  nombres: string;
  apellidos: string;
  cargo_postulado: string;
  score: number | null;
  lugar_residencia: string;
}

export interface CvCandidateDetail {
  submission_id: string;
  phone_e164: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  status: string;
  created_at: string;
  raw_text: string;
  nombres: string;
  apellidos: string;
  telefono_fijo: string;
  celular: string;
  whatsapp: string;
  centro_estudios: string;
  edad: number | null;
  lugar_residencia: string;
  pretensiones_economicas: string;
  anios_experiencia: number | null;
  cargo_postulado: string;
  experiencia_laboral: Array<{ empresa?: string; funciones?: string }>;
  cursos_capacitacion: string[];
  ingles_lectura: string;
  ingles_escritura: string;
  ingles_conversacion: string;
  otra_informacion: string;
  extra_fields: Record<string, unknown>;
  score: number | null;
  score_rationale: string;
  llm_model: string;
  extraction_warnings: string[];
}

export interface CvCandidateFilters {
  q?: string;
  status?: string;
  scoreMin?: number;
  scoreMax?: number;
  dateFrom?: string;
  dateTo?: string;
}

/** GET /api/support/admin/candidates -- 403 si el usuario no tiene
 * soporte.view/soporte.manage/department==='rrhh'. */
export async function searchCvCandidates(
  filters: CvCandidateFilters,
  page = 1,
  pageSize = 20,
): Promise<SupportAdminSearchResult<CvCandidateSummary>> {
  try {
    const response = await api.get('/support/admin/candidates', {
      params: {
        page,
        page_size: pageSize,
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}),
        ...(filters.scoreMin !== undefined ? { score_min: filters.scoreMin } : {}),
        ...(filters.scoreMax !== undefined ? { score_max: filters.scoreMax } : {}),
        ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
        ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
      },
    });
    const data = response.data ?? {};
    return {
      items: Array.isArray(data.items) ? data.items : [],
      total: Number(data.total) || 0,
      page: Number(data.page) || page,
      page_size: Number(data.page_size) || pageSize,
      pages: Number(data.pages) || 0,
    };
  } catch (error) {
    const { status, backendError, backendMessage } = backendErrorMessage(error);
    return emptyAdminSearchResult(page, pageSize, backendMessage || backendError || 'candidates_search_failed', status);
  }
}

/** GET /api/support/admin/candidates/{id} -- detalle completo (sin el
 * archivo -- ver cvCandidateFileUrl para el link de descarga). */
export async function getCvCandidateDetail(submissionId: string): Promise<CvCandidateDetail | null> {
  try {
    const response = await api.get(`/support/admin/candidates/${encodeURIComponent(submissionId)}`);
    return response.data ?? null;
  } catch {
    return null;
  }
}

/** URL directa de descarga del CV original -- autenticada por la cookie
 * HttpOnly de sesión (ADR-082), no necesita pasar por axios/el interceptor
 * Bearer: un <a href> normal ya la envía. */
export function cvCandidateFileUrl(submissionId: string): string {
  return `${apiBaseUrl()}/support/admin/candidates/${encodeURIComponent(submissionId)}/file`;
}

export async function syncMiningKpisFromExternal(): Promise<any> {
  try {
    const response = await api.post('/mining/kpis/sync-from-external', {}, { timeout: 45000 });
    return response.data ?? { status: 'error', synced: 0 };
  } catch (error) {
    const { status, backendError, backendMessage } = backendErrorMessage(error);
    if (status === 401) {
      throw new Error('Sesión expirada. Vuelve a iniciar sesión para sincronizar KPI.');
    }
    throw new Error(backendMessage || backendError || 'No se pudo sincronizar KPI desde fuente externa.');
  }
}

export async function fetchMiningKpiPoints(code: string, days = 7): Promise<any[]> {
  const response = await api.get('/mining/kpis/points', {
    params: {
      code,
      days,
    },
  });
  return response.data?.points ?? [];
}

export async function fetchProjects(): Promise<any[]> {
  const response = await api.get('/projects');
  return response.data?.projects ?? [];
}

// tenantId: unidad minera a consultar (multitenant, UUID). Si se omite, el
// backend usa el tenant activo de la sesión. Si se pasa uno distinto, el
// backend verifica membresía real en auth_user_tenant antes de honrarlo —
// ver resolveAllowedReportTenant en report_routes.cpp (403 si no pertenece).
// ADR-039 (migración completa 2026-07-13): antes se enviaba `company`
// (nombre de empresa); reports.tenant_id es ahora la única clave de
// aislamiento real, igual que el resto de la plataforma.
export async function fetchReports(tenantId?: string): Promise<any[]> {
  const response = await api.get('/reports', { params: tenantId ? { tenant_id: tenantId } : undefined });
  return response.data?.reports ?? [];
}

export async function fetchAnalysisCatalogs(): Promise<any> {
  try {
    const response = await api.get('/analysis/catalogos');
    return response.data ?? { rows: [], usuarios: [] };
  } catch (error) {
    const { status, backendError } = backendErrorMessage(error);
    if (status === 401) {
      throw new Error('Sesion expirada o invalida. Vuelve a iniciar sesion.');
    }
    throw new Error(backendError || 'No se pudo cargar el catalogo de formula minera.');
  }
}

export async function runTemperatureAnalysis(payload: unknown): Promise<any> {
  try {
    const response = await api.post('/analysis/temperaturas', payload, { timeout: 60000 });
    return response.data ?? { rows: [], summary: {} };
  } catch (error) {
    const { status, backendError } = backendErrorMessage(error);
    if (status === 401) {
      throw new Error('Sesion expirada o invalida. Vuelve a iniciar sesion.');
    }
    throw new Error(backendError || 'No fue posible ejecutar la formula minera.');
  }
}

/** Carga un informe completo (incl. content_json) para edición.
 * `tenantId` se reenvía cuando el informe proviene de una búsqueda
 * multitenant (puede no ser el tenant activo de la sesión) — el backend
 * verifica membresía real antes de honrarlo, igual que en fetchReports. */
export async function fetchReportById(id: string, tenantId?: string): Promise<any> {
  const response = await api.get(`/reports/${encodeURIComponent(id)}`, {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return response.data;
}

const REPORT_SAVE_TIMEOUT_MS = 120000;

export async function createReport(data: unknown): Promise<any> {
  const response = await api.post('/reports', data, { timeout: REPORT_SAVE_TIMEOUT_MS });
  return response.data;
}

export async function updateReport(id: string, data: unknown): Promise<any> {
  const response = await api.put(`/reports/${id}`, data, { timeout: REPORT_SAVE_TIMEOUT_MS });
  return response.data;
}

export async function deleteReport(id: string): Promise<any> {
  const response = await api.delete(`/reports/${id}`);
  return response.data;
}

/** ADR-015: historial de revisiones autoritativo del servidor (una por cada guardado confirmado). */
export async function fetchReportRevisions(id: string): Promise<any[]> {
  const response = await api.get(`/reports/${encodeURIComponent(id)}/revisions`);
  return response.data?.revisions || [];
}

/**
 * ADR-016: export PDF server-side (Chromium headless vía sidecar), con la
 * MISMA fidelidad visual que el visor de solo lectura (reusa ReadOnlyViewer).
 * Requiere que el informe ya esté guardado (id real, no borrador sin guardar).
 * ADR-080: el PDF viene con marca de agua y cifrado con una contraseña
 * generada para esta descarga (`password`, header `X-Pdf-Password` — axios
 * normaliza los nombres de header a minúsculas). No se persiste en ningún
 * lado: cada descarga genera un PDF y una contraseña nuevos.
 */
export async function fetchReportPdfBlob(
  id: string,
): Promise<{ blob: Blob; filename: string; password: string | null }> {
  const response = await api.get(`/reports/${encodeURIComponent(id)}/export/pdf`, {
    responseType: 'blob',
    timeout: 60000,
  });
  const disposition = response.headers?.['content-disposition'] || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const password = response.headers?.['x-pdf-password'] || null;
  return { blob: response.data, filename: match ? match[1] : 'informe.pdf', password };
}

/**
 * Exporta el informe como archivo `.mreport` cifrado (AES-256-GCM, clave solo
 * en el backend) — requiere que el informe ya esté guardado (id real). No es
 * un ZIP: no puede abrirse con otra herramienta, solo re-importarse aquí.
 */
export async function fetchReportPortableBlob(id: string): Promise<{ blob: Blob; filename: string }> {
  const response = await api.get(`/reports/${encodeURIComponent(id)}/export/portable`, {
    responseType: 'blob',
    timeout: 60000,
  });
  const disposition = response.headers?.['content-disposition'] || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: response.data, filename: match ? match[1] : 'informe.mreport' };
}

export interface ExportJobStatus {
  job_id: string;
  report_id: string;
  export_format: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
  error_message: string;
  created_at: string;
  started_at: string;
  completed_at: string;
}

/**
 * Encola la exportación del informe a PPTX (sidecar Chromium, mismo pipeline
 * que /export/pdf, endpoint /render-pptx). Solo funciona si el informe está
 * en `layoutMode: 'presentation'` (lienzo 16:9) — el backend responde 400
 * `layout_mode_not_presentation` en caso contrario. Async: usar
 * `pollExportJob` para esperar el resultado antes de descargar.
 */
export async function createPptxExportJob(reportId: string): Promise<{ job_id: string; status: string }> {
  const response = await api.post(`/reports/${encodeURIComponent(reportId)}/export/pptx`);
  return response.data;
}

/**
 * Convierte un job PPTX ya exitoso (`pptxJobId`) en un MP4 sin narración
 * (Stage 3): el backend reutiliza las MISMAS imágenes de diapositiva del
 * .pptx (nunca vuelve a renderizar el informe). `transition`: 'cut' (corte
 * seco) o 'crossfade' (fundido). Requiere que el job pptx referenciado ya
 * esté en estado `success` — el backend responde 409 `pptx_job_not_ready`
 * si no.
 */
export async function createVideoExportJob(
  reportId: string,
  pptxJobId: string,
  options: { slideDurationSeconds?: number; transition?: 'cut' | 'crossfade' } = {},
): Promise<{ job_id: string; status: string }> {
  const response = await api.post(
    `/reports/${encodeURIComponent(reportId)}/export/pptx/${encodeURIComponent(pptxJobId)}/video`,
    {
      slide_duration_seconds: options.slideDurationSeconds ?? 4,
      transition: options.transition ?? 'cut',
    },
  );
  return response.data;
}

/**
 * Adjunta la narración de UNA página de un job PPTX (Stage 4): `audioBlob`
 * (grabación real, se sube como cuerpo binario con su propio Content-Type —
 * el backend la escribe a disco y la referencia queda lista para el próximo
 * `createVideoExportJob`) o `speakerNotes` (texto, guardado para una futura
 * conversión TTS — sin proveedor integrado todavía, la página queda muda
 * hasta que se resuelva ese follow-up). Pasar ambos vacíos no tiene efecto
 * útil — el caller decide cuál de los dos enviar.
 */
export async function uploadSlideNarration(
  reportId: string,
  pptxJobId: string,
  pageNumber: number,
  payload: { audioBlob: Blob; durationSeconds: number } | { speakerNotes: string },
): Promise<{ status: string; kind: string }> {
  const path = `/reports/${encodeURIComponent(reportId)}/export/jobs/${encodeURIComponent(pptxJobId)}/narration/${pageNumber}`;
  if ('audioBlob' in payload) {
    const response = await api.post(path, payload.audioBlob, {
      headers: { 'Content-Type': payload.audioBlob.type || 'audio/webm' },
      params: { duration_seconds: payload.durationSeconds },
      timeout: 30000,
    });
    return response.data;
  }
  const response = await api.post(path, { speaker_notes: payload.speakerNotes }, { timeout: 15000 });
  return response.data;
}

export async function fetchExportJobStatus(reportId: string, jobId: string): Promise<ExportJobStatus> {
  const response = await api.get(
    `/reports/${encodeURIComponent(reportId)}/export/jobs/${encodeURIComponent(jobId)}`,
  );
  return response.data;
}

export async function fetchExportJobBlob(
  reportId: string,
  jobId: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await api.get(
    `/reports/${encodeURIComponent(reportId)}/export/jobs/${encodeURIComponent(jobId)}/download`,
    { responseType: 'blob', timeout: 60000 },
  );
  const disposition = response.headers?.['content-disposition'] || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: response.data, filename: match ? match[1] : 'informe.pptx' };
}

/**
 * Espera a que un job de exportación asíncrono (report_export_job: PPTX/MP4)
 * termine, haciendo polling de `fetchExportJobStatus` cada `intervalMs`.
 * `onProgress` se llama en cada tick con el estado crudo — la UI lo usa para
 * mostrar queued/running antes de que el job resuelva. Lanza
 * `export_job_poll_timeout` si se agotan los intentos sin llegar a un estado
 * terminal (success/failed/cancelled).
 */
export async function pollExportJob(
  reportId: string,
  jobId: string,
  options: { intervalMs?: number; maxAttempts?: number; onProgress?: (status: ExportJobStatus) => void } = {},
): Promise<ExportJobStatus> {
  const { intervalMs = 2000, maxAttempts = 150, onProgress } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await fetchExportJobStatus(reportId, jobId);
    onProgress?.(status);
    if (status.status === 'success' || status.status === 'failed' || status.status === 'cancelled') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('export_job_poll_timeout');
}

export interface PortableImportResponse {
  document: any;
  title: string;
  source_company: string;
  tenant_match: boolean;
  redacted: boolean;
}

/**
 * Sube un `.mreport` para que el backend lo descifre y, si el tenant del
 * usuario no coincide con el de origen, devuelva el documento con
 * imágenes/KPIs/gráficos/mapas/sensores redactados (estructura y texto
 * intactos). El descifrado real SIEMPRE ocurre en el servidor.
 */
export async function importReportPortable(fileBytes: ArrayBuffer): Promise<PortableImportResponse> {
  const response = await api.post('/reports/import/portable', fileBytes, {
    headers: { 'Content-Type': 'application/octet-stream' },
    timeout: 30000,
  });
  return response.data;
}

export async function validateCompany(company: string, ruc: string): Promise<boolean> {
  const response = await api.get('/auth/validate-company', { params: { company, ruc } });
  return response.data?.valid ?? false;
}

const TEXT_SPELL_TIMEOUT_MS = 120000;

/** Corrección ortográfica/gramatical rápida en backend: LanguageTool aplica
 *  solo reemplazos seguros (ortografía/gramática) — preciso y fiel al texto,
 *  nunca parafrasea ni inventa (a diferencia de "Optimizar IA" / rewrite). */
export async function textCorrectQuick(text: unknown): Promise<any> {
  const response = await api.post(
    '/text/correct/quick',
    { text: String(text ?? '') },
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}

/** Sugerencias LanguageTool vía backend (on-premise). */
export async function textCorrectAdvanced(
  text: unknown,
  { language = 'es-PE', level = 'picky' }: { language?: string; level?: string } = {},
): Promise<any> {
  const response = await api.post(
    '/text/correct/advanced',
    { text: String(text ?? ''), language, level },
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}

/** Pasada segura LT + rápido + reescritura Ollama opcional (on-premise). */
export async function textRewriteOnPremise(
  text: unknown,
  { language = 'es-PE', level = 'picky', use_llm = true }: { language?: string; level?: string; use_llm?: boolean } = {},
): Promise<any> {
  const response = await api.post(
    '/text/rewrite',
    { text: String(text ?? ''), language, level, use_llm },
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}

export interface Apa7CitationFields {
  author?: string;
  year?: string;
  title?: string;
  source?: string;
  url?: string;
}

/**
 * Da formato APA 7 a datos bibliográficos que el usuario YA aportó (no busca
 * ni inventa fuentes) — usa el LLM local (Ollama) para puntuar/ordenar esos
 * mismos campos según la norma; si no responde, el backend cae a un
 * formateador determinístico (misma garantía: nunca inventa nada).
 */
export async function formatApa7Citation(fields: Apa7CitationFields): Promise<{ apa: string; source: string }> {
  const response = await api.post(
    '/text/format-apa7',
    fields,
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}

export interface ReferenceSearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

/**
 * Busca fuentes REALES en internet (Tavily, o Serper.dev como respaldo) para
 * un tema, ya filtradas a una lista de dominios de confianza (gobierno,
 * universidades, organismos internacionales, editoriales académicas) — nunca
 * inventa ni "recuerda" una fuente de entrenamiento del LLM. Si el backend no
 * tiene ninguna API key configurada, lanza con `search_not_configured` en el
 * mensaje.
 */
export async function searchTrustedReferences(query: string): Promise<{ results: ReferenceSearchResult[]; excluded_untrusted_count: number; source: string }> {
  const response = await api.post(
    '/text/search-references',
    { query },
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}

export interface ReferenceVerification {
  verified: boolean;
  matched_year: boolean;
  matched_title: boolean;
  source: string;
}

/**
 * Verificación programática (sin LLM) de que una URL de referencia
 * realmente contiene el título y/o año declarados — trae el contenido crudo
 * de la página vía Tavily /extract y hace un chequeo de substring local. Si
 * Tavily no está configurado, lanza con `tavily_not_configured`: esto NO debe
 * bloquear la inserción de la cita, solo se muestra como "no verificable".
 */
export async function verifyReference(url: string, title?: string, year?: string): Promise<ReferenceVerification> {
  const response = await api.post(
    '/text/verify-reference',
    { url, title, year },
    { timeout: TEXT_SPELL_TIMEOUT_MS },
  );
  return response.data;
}
