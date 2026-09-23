import axios, { AxiosError } from 'axios';
import { refreshAccessToken, authFetch } from '../../../auth/authApi';
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

// Un informe puede contener decenas (o, en exports grandes DOCX/PPTX/PDF,
// miles) de bloques de sensores. En la página de impresión todos se montan
// según avanza la virtualización, y sin coordinación pueden saturar el
// límite de Nginx (20 req/s, burst 40) -- hallazgo de Luder, portado aquí
// (2026-09-11) tras confirmarlo en un export real de 2104 páginas/6300
// gráficos. Se implementa:
// 1. Límite de concurrencia (16 peticiones simultáneas en vuelo -- ver
//    nginx.conf::api_general_limit_key, calibrado junto con este número).
// 2. Intervalo mínimo garantizado de 50ms entre inicios de petición.
// 3. Caché/deduplicación por parámetros exactos, con TTL de 30 min (no solo
//    peticiones EN VUELO: dos pedidos con el mismo sensor/rango dentro de
//    esos 30 min reusan el mismo resultado sin ir a red -- medido en vivo:
//    el mismo par sensor/rango se repetía hasta 300 veces en un export
//    grande, separadas por minutos, así que un TTL corto no evitaba nada).
// 4. Reintento con backoff exponencial para 429 y para timeouts.
class AsyncTelemetryQueue {
  private maxConcurrency = 16;
  private running = 0;
  private queue: Array<() => void> = [];
  private lastStartAt = 0;
  private minIntervalMs = 50;

  /** Reduce la cuota de ESTA cola (una página = una cola) -- necesario
   * cuando VARIAS páginas corren en paralelo contra el mismo backend
   * (pipeline DOCX Fase 2): los 16 cupos/50ms se calibraron para UNA sola
   * página contra el límite de Nginx -- con N páginas paralelas, cada una
   * con su propia cola, la demanda agregada es N veces esa cuota. Cada
   * worker debe pedir una fracción proporcional para que la SUMA de las N
   * colas siga respetando el límite real del servidor. */
  setQuota(maxConcurrency: number, minIntervalMs: number): void {
    this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
    this.minIntervalMs = Math.max(1, Math.floor(minIntervalMs));
  }

  async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryExecute = async () => {
        const now = Date.now();
        const waitTime = Math.max(0, this.lastStartAt + this.minIntervalMs - now);
        if (waitTime > 0) {
          await new Promise((r) => setTimeout(r, waitTime));
        }
        this.lastStartAt = Date.now();
        this.running++;
        resolve(() => {
          this.running--;
          if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) next();
          }
        });
      };

      if (this.running < this.maxConcurrency) {
        tryExecute();
      } else {
        this.queue.push(() => tryExecute());
      }
    });
  }

  queueLength(): number {
    return this.queue.length;
  }

  runningCount(): number {
    return this.running;
  }
}

const telemetryQueue = new AsyncTelemetryQueue();
const telemetryInFlightQueries = new Map<string, Promise<any>>();

/** Ver `AsyncTelemetryQueue.setQuota`. Llamarlo ANTES de cualquier
 * `fetchTelemetryWizardSeries` si varias páginas de export corren en
 * paralelo contra el mismo backend. */
export function setTelemetryQueueQuota(maxConcurrency: number, minIntervalMs: number): void {
  telemetryQueue.setQuota(maxConcurrency, minIntervalMs);
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
  const queryParams = {
    sensor_ids: params.sensorIds.join(','),
    from: params.from,
    to: params.to,
    ...(params.agg ? { agg: params.agg } : {}),
    ...(params.tenant_id ? { tenant_id: params.tenant_id } : {}),
  };

  const dedupeKey = `${queryParams.tenant_id || ''}|${queryParams.sensor_ids}|${queryParams.from}|${queryParams.to}|${queryParams.agg || 'hourly'}`;
  const inFlight = telemetryInFlightQueries.get(dedupeKey);
  if (inFlight) return inFlight;

  const queryPromise = (async () => {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const release = await telemetryQueue.acquire();
      try {
        // Timeout propio de 45s (no los 15s por defecto de `api`): la espera
        // en cola bajo carga (miles de widgets) puede por sí sola acercarse
        // a 15s antes de que la petición llegue siquiera a salir por la red.
        const response = await api.get('/mining/telemetry/wizard/query', { params: queryParams, timeout: 45000 });
        return response.data ?? {};
      } catch (error) {
        const status = (error as AxiosError)?.response?.status;
        const isTimeout = (error as AxiosError)?.code === 'ECONNABORTED';
        if ((status === 429 || isTimeout) && attempt < maxAttempts - 1) {
          const retryAfter = Number((error as AxiosError)?.response?.headers?.['retry-after']);
          const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 350 * (2 ** attempt) + Math.floor(Math.random() * 150);
          await new Promise((resolve) => window.setTimeout(resolve, backoffMs));
          continue;
        }
        throw error;
      } finally {
        release();
      }
    }
    return {};
  })();

  telemetryInFlightQueries.set(dedupeKey, queryPromise);
  try {
    return await queryPromise;
  } finally {
    // `from`/`to` son literales dentro de `dedupeKey`: un dashboard "en vivo"
    // que recalcula `to=now()` en cada mount ya genera una key DISTINTA cada
    // vez, así que un TTL largo no arriesga mostrar datos viejos ahí -- solo
    // evita refetch cuando el rango realmente es el MISMO.
    window.setTimeout(() => {
      telemetryInFlightQueries.delete(dedupeKey);
    }, 30 * 60 * 1000);
  }
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
  noWatermark = false,
): Promise<{ blob: Blob; filename: string; password: string | null }> {
  // 650s: por encima de BEEMETRY_PDF_EXPORT_TIMEOUT_MS (docker-compose.yml,
  // 600s -- el backend esperando al sidecar Chromium) y por debajo de
  // proxy_read_timeout/proxy_send_timeout (nginx.conf, 900s, en la location
  // dedicada a esta misma ruta) -- si el backend agota SU presupuesto,
  // queremos que llegue su respuesta de error real en vez de que axios
  // aborte la conexión primero con un timeout genérico del lado del
  // navegador. Antes en 60s (heredado del resto de llamadas cortas de este
  // archivo): un informe grande captura página por página en serie (ver
  // pdf-export-service/server.js::renderCanvasesToPdf) y supera eso solo con
  // el tiempo real de captura, sin que nada esté colgado.
  // `no_watermark` (ADR-204): el backend rechaza con 403
  // informes.export_sin_marca_agua si el rol no tiene el permiso -- nunca lo
  // aplica en silencio como si fuera `false`.
  const response = await api.get(`/reports/${encodeURIComponent(id)}/export/pdf`, {
    responseType: 'blob',
    timeout: 650000,
    params: noWatermark ? { no_watermark: 1 } : undefined,
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
  // Solo viene poblado mientras el job está 'queued'/'running', si el
  // backend/sidecar lo exponen (avance de Luder 2026-09-11: el sidecar
  // escribe progreso periódicamente y el backend lo expone en este campo).
  // `undefined` es el caso normal hoy -- la UI que lo consume (App.tsx,
  // barra de progreso de export) debe tolerar su ausencia sin romperse.
  progress?: { captured: number; total: number } | null;
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
 * Encola la exportación del informe a PDF vía el pipeline ASÍNCRONO (sidecar
 * Chromium, endpoint /render-pdf) -- portado del avance de Luder
 * (2026-09-11), alternativa a `fetchReportPdfBlob` (síncrona, ADR-016):
 * pensada para informes grandes (miles de páginas) donde el render puede
 * exceder cualquier presupuesto razonable de request HTTP directo aunque
 * termine bien. Mismo watermark + cifrado (ADR-080) que la variante
 * síncrona -- la contraseña se recupera de `fetchExportJobBlob` (header
 * `X-Pdf-Password`) una vez el job está en `success`. Async: usar
 * `pollExportJob`. `usePdfExport.ts` intenta esta variante primero y cae de
 * vuelta a `fetchReportPdfBlob` si el backend todavía no expone esta ruta
 * (404) -- no reemplaza al pipeline síncrono hasta confirmar que el backend
 * real la soporta. `unprotected` (default `false`, ADR-080 sigue siendo el
 * comportamiento normal): pide el PDF SIN contraseña -- el backend lo
 * rechaza con 403 `informes.export_sin_clave` si el rol de la sesión no
 * tiene ese permiso (perfiles avanzados, db_scripts/112), nunca lo aplica
 * en silencio como si fuera `false`. `noWatermark` (default `false`,
 * ADR-204): mismo criterio pero para `informes.export_sin_marca_agua`
 * (db_scripts/115) -- pide el PDF SIN marca de agua.
 */
export async function createPdfExportJob(
  reportId: string,
  unprotected = false,
  noWatermark = false,
): Promise<{ job_id: string; status: string }> {
  const response = await api.post(`/reports/${encodeURIComponent(reportId)}/export/pdf`, {
    unprotected,
    no_watermark: noWatermark,
  });
  return response.data;
}

/**
 * Lista de correos adicionales a quienes se envía automáticamente el PDF
 * exportado de `reportId` (ADR-204, además del correo del usuario que
 * exportó) -- persistida en `report_document_settings.pdf_share_recipients_json`.
 * Gateado por `informes.share` (mismo permiso que compartir el informe).
 */
export async function fetchPdfShareRecipients(reportId: string): Promise<string[]> {
  const response = await api.get(`/reports/${encodeURIComponent(reportId)}/pdf-share-recipients`);
  return Array.isArray(response.data?.recipients) ? response.data.recipients : [];
}

/**
 * Reemplaza por completo la lista de `fetchPdfShareRecipients` -- se manda
 * la lista entera en cada guardado (no hay agregar/borrar incremental del
 * lado del servidor), el backend valida formato y trunca a 10
 * (`report_document_settings.cpp::savePdfShareRecipients`).
 */
export async function savePdfShareRecipients(
  reportId: string,
  emails: string[],
): Promise<string[]> {
  const response = await api.post(`/reports/${encodeURIComponent(reportId)}/pdf-share-recipients`, {
    recipients: emails,
  });
  return Array.isArray(response.data?.recipients) ? response.data.recipients : [];
}

/**
 * Encola la exportación del informe a DOCX vía el pipeline SERVIDOR (sidecar
 * Chromium, endpoint /render-docx + reportDocxBuilder.js) -- mismo patrón
 * asíncrono que PPTX/PDF (ver report_routes.cpp, sección /export/docx).
 * A diferencia del pipeline cliente (exportEngine.ts::exportDOCX, ADR-139),
 * este SÍ requiere que el informe esté guardado en servidor (no funciona
 * sobre un borrador en memoria) y solo acepta layoutMode 'document' (A4/A3)
 * -- el backend responde 400 `layout_mode_not_document` en modo presentación
 * y 503 `docx_export_disabled` si el sidecar no está configurado
 * (`gPdfExportUrl` vacío), único caso en que App.tsx cae de vuelta al
 * pipeline cliente. `layout`: 'absolute' (default, ADR-139) ancla cada
 * bloque a su x/y exacto del lienzo (cuadros de texto independientes);
 * 'flow' (pedido explícito 2026-09-18) lo reflowa como documento Word
 * tradicional -- ver `reportDocxBuilder.js::buildPageSection`. El fallback
 * cliente (exportDOCX) NO soporta 'flow' todavía, así que ese caso 503
 * siempre entrega layout absoluto sin importar lo pedido acá. Async: usar
 * `pollExportJob`.
 */
export async function createDocxExportJob(
  reportId: string,
  layout: 'absolute' | 'flow' = 'absolute',
): Promise<{ job_id: string; status: string }> {
  const response = await api.post(`/reports/${encodeURIComponent(reportId)}/export/docx`, { layout });
  return response.data;
}

/**
 * Encola la exportación del informe a XLSX (sidecar Chromium, endpoint
 * /render-xlsx + reportXlsxBuilder.js) -- mismo patrón asíncrono que
 * PPTX/DOCX/PDF. Alcance explícito: exporta ÚNICAMENTE los bloques `table`
 * ya insertados en el informe (una hoja real por tabla + una hoja "Índice"
 * con hipervínculos reales), sin restricción de `layoutMode`. Async: usar
 * `pollExportJob`.
 */
export async function createXlsxExportJob(reportId: string): Promise<{ job_id: string; status: string }> {
  const response = await api.post(`/reports/${encodeURIComponent(reportId)}/export/xlsx`);
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
): Promise<{ blob: Blob; filename: string; password: string | null }> {
  const response = await api.get(
    `/reports/${encodeURIComponent(reportId)}/export/jobs/${encodeURIComponent(jobId)}/download`,
    { responseType: 'blob', timeout: 60000 },
  );
  const disposition = response.headers?.['content-disposition'] || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  // Solo viene poblado para jobs 'pdf' (ADR-080) -- axios normaliza los
  // nombres de header a minúsculas, mismo criterio que `fetchReportPdfBlob`.
  const password = response.headers?.['x-pdf-password'] || null;
  return { blob: response.data, filename: match ? match[1] : 'informe.pptx', password };
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

export interface PdfOcrImportApiResponse {
  ok: boolean;
  page_count?: number;
  pages?: import('./pdfOcrImport').PdfOcrPageDto[];
  error?: string;
  scanned_pages?: number;
  limit?: number;
}

/**
 * Importación de PDF con OCR avanzado (ADR-199): sube el PDF crudo (mismo
 * patrón que importReportPortable -- cuerpo = bytes, filename por query) y
 * el backend hace de proxy hacia ai_engine/ocr_engine (PaddleOCR
 * PP-StructureV2, texto digital cuando lo hay, OCR real solo en páginas
 * escaneadas). Timeout largo a propósito: coincide con
 * BEEMETRY_AI_ENGINE_PDF_OCR_TIMEOUT_MS del backend (600s) más margen --
 * documentos con varias páginas escaneadas tardan de verdad en CPU.
 */
export async function importReportPdfOcr(
  fileBytes: ArrayBuffer,
  filename: string,
): Promise<PdfOcrImportApiResponse> {
  try {
    const response = await api.post(
      `/reports/import/pdf-ocr?filename=${encodeURIComponent(filename)}`,
      fileBytes,
      { headers: { 'Content-Type': 'application/octet-stream' }, timeout: 620000 },
    );
    return { ok: true, ...response.data };
  } catch (error) {
    const { backendError } = backendErrorMessage(error);
    const data = (error as AxiosError<Record<string, unknown>>)?.response?.data;
    return {
      ok: false,
      error: backendError || 'pdf_ocr_import_failed',
      scanned_pages: typeof data?.scanned_pages === 'number' ? data.scanned_pages : undefined,
      limit: typeof data?.limit === 'number' ? data.limit : undefined,
    };
  }
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
  author: string;
  year: string;
  source: string;
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

// ─────────────────────────────────────────────────────────────────────────
// Merge del zip del ingeniero (2026-09-01): tickets/adjuntos de soporte,
// candidatos RRHH y enlace de acceso directo al PDF. Bloque traído tal cual
// de su versión de este archivo -- consumido por CandidatesRrhhView.tsx,
// SupportAdminView.tsx y useShareLink.ts/ShareLinkModal.tsx (nuevos, no
// existían en la versión previa de este módulo).
// ─────────────────────────────────────────────────────────────────────────

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

/**
 * ADR-138: crea un enlace de acceso directo al PDF (token opaco, expira en
 * `expires_in_hours` horas) -- a diferencia de `fetchReportPdfBlob` (ADR-080,
 * PDF cifrado con contraseña), el PDF servido por esa URL NO pide nada: la
 * protección es el token en sí, pensado para un QR que se escanea y abre
 * directo, sin ningún paso manual.
 */
export async function createReportShareLink(
  id: string,
): Promise<{ url: string; expiresInHours: number }> {
  const response = await api.post(`/reports/${encodeURIComponent(id)}/share-link`, {});
  // El backend devuelve una ruta same-origin para no fijar localhost ni un
  // host interno en el QR. Resolverla donde corre la SPA garantiza que un
  // celular abra exactamente el host/puerto/protocolo que ve el usuario.
  const url = resolveReportShareLinkUrl(String(response.data.url), window.location.origin);
  return { url, expiresInHours: response.data.expires_in_hours };
}

export function resolveReportShareLinkUrl(pathOrUrl: string, browserOrigin: string): string {
  return new URL(pathOrUrl, browserOrigin).toString();
}

export interface CompanyUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  role: string;
  email: string;
  avatarBase64: string;
}

/**
 * GET /api/auth/users -- usuarios de la misma empresa que la sesión (el
 * backend filtra por `session.company`, nunca por un parámetro del cliente).
 * Usado por ShareReportModal.tsx para el picker de destinatarios con avatar
 * real (antes leía una lista mock de localStorage con solo iniciales).
 */
export async function fetchCompanyUsers(): Promise<CompanyUser[]> {
  try {
    const response = await api.get('/auth/users');
    const raw = Array.isArray(response.data?.users) ? response.data.users : [];
    return raw.map((u: any) => ({
      id: u.id,
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      username: u.username || '',
      role: u.role || 'operator',
      email: u.email || '',
      avatarBase64: u.avatar_base64 || '',
    }));
  } catch {
    return [];
  }
}

export interface ShareReportChannelResult {
  channel: string;
  ok: boolean;
  detail: string;
}

/**
 * POST /api/reports/{id}/share -- envía el informe a otro usuario de la
 * empresa: persiste en `report_shares` y dispara notificación in-app +
 * email + WhatsApp + SMS (best-effort, canal por canal). Antes esta función
 * no existía: el modal llamaba a un mock que no tocaba el backend.
 */
export async function shareReport(
  reportId: string,
  payload: { toUserId: string; message?: string },
): Promise<{ status: string; recipientName?: string; channels: ShareReportChannelResult[]; error?: string }> {
  try {
    const response = await api.post(`/reports/${encodeURIComponent(reportId)}/share`, {
      to_user_id: payload.toUserId,
      message: payload.message || '',
    });
    const data = response.data ?? {};
    return {
      status: data.status || 'shared',
      recipientName: data.recipient_name,
      channels: Array.isArray(data.channels) ? data.channels : [],
    };
  } catch (error) {
    const { backendError, backendMessage } = backendErrorMessage(error);
    return { status: 'error', channels: [], error: backendMessage || backendError || 'share_failed' };
  }
}
