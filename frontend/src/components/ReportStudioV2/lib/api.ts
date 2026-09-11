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

// Un informe puede contener decenas (o, en exports grandes DOCX/PPTX/PDF,
// miles) de bloques de sensores. En la página de impresión todos se montan
// según avanza la virtualización, y sin coordinación pueden saturar el
// límite de Nginx (20 req/s, burst 40).
// Se implementa:
// 1. Límite de concurrencia (máximo 16 peticiones simultáneas en vuelo --
//    subido de 3→6→16: medido en vivo en un export de 2104 páginas/6300
//    gráficos. Al ampliar `EXPORT_VIRTUALIZATION_WINDOW` (ReadOnlyViewer.tsx,
//    ver su comentario -- causa raíz real de los abortos de red) de 1 a 6
//    para que un widget no se desmonte antes de que termine su fetch, la
//    población de widgets montados SIMULTÁNEAMENTE subió de ~9 a ~39 -- con
//    solo 6 cupos de concurrencia, la cola de abajo se atascaba (crecía sin
//    drenar: 0 peticiones completadas en 3+ min, confirmado en vivo con
//    `queueLength()`/`runningCount()`). El burst=40 de Nginx da margen para
//    16 cupos sin arriesgar 429s.
// 2. Intervalo mínimo garantizado de 50 ms entre inicios de petición (bajado
//    de 75ms -- a 75ms el propio intervalo topeaba los arranques en ~13.3/s,
//    por debajo de los 20 r/s que Nginx ya permite).
// 3. Deduplicación de peticiones en vuelo con los mismos parámetros.
// 4. Reintento exponencial para 429 Y para timeouts de axios (ver más abajo).
class AsyncTelemetryQueue {
  private maxConcurrency = 16;
  private running = 0;
  private queue: Array<() => void> = [];
  private lastStartAt = 0;
  private minIntervalMs = 50;

  /** Reduce la cuota de ESTA cola (una página = una cola, ver comentario de
   * arriba) -- necesario cuando VARIAS páginas corren en paralelo contra el
   * mismo backend (pipeline DOCX Fase 2, `pdf-export-service/server.js`):
   * los 16 cupos / 50ms fueron calibrados para UNA sola página contra el
   * límite de Nginx (20 r/s) -- con N páginas paralelas, cada una con su
   * propia cola independiente, la demanda agregada es N veces esa cuota
   * (reproducido en vivo: 4 workers, ráfaga sostenida de 429 desde el
   * arranque, cero capturas en varios minutos). Cada worker debe pedir una
   * fracción proporcional para que la SUMA de las N colas siga respetando
   * el límite real del servidor. */
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
        // DIAGNÓSTICO TEMPORAL -- queueLength()/runningCount() exponen el
        // tamaño real de esta cola para confirmar en vivo si el atasco es
        // ACÁ (muchos widgets esperando turno) o en la red/servidor.
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
 * `fetchTelemetryWizardSeries` -- lo usa `print-report/main.tsx` cuando
 * navega como un worker del pipeline DOCX en paralelo. */
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
  // DIAGNÓSTICO TEMPORAL -- contador de aciertos/fallos de caché expuesto en
  // window para medir en vivo (vía consola del sidecar de export, que ya
  // captura console.warn) si la extensión de TTL de telemetryInFlightQueries
  // realmente está evitando refetch en un documento con muchas repeticiones
  // del mismo sensor/rango (ver comentario del TTL de 30 min más abajo).
  const w = window as unknown as { __telemetryCacheStats__?: { hits: number; misses: number } };
  w.__telemetryCacheStats__ = w.__telemetryCacheStats__ || { hits: 0, misses: 0 };
  if (inFlight) {
    w.__telemetryCacheStats__.hits += 1;
    if (w.__telemetryCacheStats__.hits % 50 === 0) {
      console.warn('[TELEMETRY_CACHE]', JSON.stringify(w.__telemetryCacheStats__));
    }
    return inFlight;
  }
  w.__telemetryCacheStats__.misses += 1;
  if (w.__telemetryCacheStats__.misses % 50 === 0) {
    console.warn('[TELEMETRY_CACHE]', JSON.stringify(w.__telemetryCacheStats__));
  }

  const queryPromise = (async () => {
    const maxAttempts = 5;
    // DIAGNÓSTICO TEMPORAL -- separa cuánto tiempo se va en ESPERAR TURNO en
    // AsyncTelemetryQueue (queueWaitMs) de cuánto se va en la llamada de RED
    // en sí (networkMs), para confirmar cuál de las dos es el cuello de
    // botella real antes de decidir qué ajustar.
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // DIAGNÓSTICO TEMPORAL -- logueado ANTES de esperar el cupo (no
      // gateado detrás de un éxito/fallo que quizás nunca llegue): si la
      // cola crece sin drenar, esto lo muestra de inmediato en vez de
      // quedar en silencio total como pasó con el conteo por-éxito de abajo.
      const w3 = window as unknown as { __telemetryAcquireCount__?: number };
      w3.__telemetryAcquireCount__ = (w3.__telemetryAcquireCount__ || 0) + 1;
      if (w3.__telemetryAcquireCount__ % 10 === 0) {
        console.warn('[TELEMETRY_QUEUE]', JSON.stringify({
          acquireCount: w3.__telemetryAcquireCount__,
          queueLength: telemetryQueue.queueLength(),
          running: telemetryQueue.runningCount(),
        }));
      }
      const acquireStartedAt = Date.now();
      const release = await telemetryQueue.acquire();
      const queueWaitMs = Date.now() - acquireStartedAt;
      const networkStartedAt = Date.now();
      try {
        // Timeout propio de 45s (no los 15s por defecto de `api` -- ver su
        // comentario en la definición): reproducido en vivo con
        // "data-export-error":"timeout of 15000ms exceeded" en un export
        // grande -- el widget se quedaba con `data-export-ready=false` para
        // SIEMPRE porque este catch relanzaba el error sin reintentar (el
        // bloque de abajo solo cubría 429), y encima 15s alcanza para que la
        // ESPERA EN COLA (AsyncTelemetryQueue de arriba, bajo carga con miles
        // de widgets) por sí sola agote el reloj de axios antes de que la
        // petición llegue siquiera a salir por la red.
        const response = await api.get('/mining/telemetry/wizard/query', { params: queryParams, timeout: 45000 });
        const networkMs = Date.now() - networkStartedAt;
        const w2 = window as unknown as { __telemetryTiming__?: { count: number; totalQueueMs: number; totalNetworkMs: number; maxQueueMs: number; maxNetworkMs: number } };
        w2.__telemetryTiming__ = w2.__telemetryTiming__ || { count: 0, totalQueueMs: 0, totalNetworkMs: 0, maxQueueMs: 0, maxNetworkMs: 0 };
        w2.__telemetryTiming__.count += 1;
        w2.__telemetryTiming__.totalQueueMs += queueWaitMs;
        w2.__telemetryTiming__.totalNetworkMs += networkMs;
        w2.__telemetryTiming__.maxQueueMs = Math.max(w2.__telemetryTiming__.maxQueueMs, queueWaitMs);
        w2.__telemetryTiming__.maxNetworkMs = Math.max(w2.__telemetryTiming__.maxNetworkMs, networkMs);
        if (w2.__telemetryTiming__.count % 5 === 0) {
          console.warn('[TELEMETRY_TIMING]', JSON.stringify({
            ...w2.__telemetryTiming__,
            avgQueueMs: Math.round(w2.__telemetryTiming__.totalQueueMs / w2.__telemetryTiming__.count),
            avgNetworkMs: Math.round(w2.__telemetryTiming__.totalNetworkMs / w2.__telemetryTiming__.count),
            queueLength: telemetryQueue.queueLength(),
            running: telemetryQueue.runningCount(),
          }));
        }
        return response.data ?? {};
      } catch (error) {
        const status = (error as AxiosError)?.response?.status;
        const isTimeout = (error as AxiosError)?.code === 'ECONNABORTED';
        console.warn('[TELEMETRY_ERROR]', JSON.stringify({
          attempt, status: status ?? null, isTimeout, code: (error as AxiosError)?.code ?? null,
          message: (error as Error)?.message ?? String(error),
          queueWaitMs, networkMs: Date.now() - networkStartedAt,
        }));
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
    // TTL de 30 min (antes 10s). `from`/`to` son literales dentro de
    // `dedupeKey`: un dashboard "en vivo" que recalcula `to=now()` en cada
    // mount ya genera una key DISTINTA cada vez, así que subir el TTL no
    // arriesga mostrar datos viejos ahí -- solo evita refetch cuando el
    // rango realmente es el MISMO. Medido en vivo en un export DOCX de
    // 2104 páginas (generador demo, ADR de prueba de escala): el mismo par
    // de sensores se vuelve a pedir hasta 300 veces (20 tipos de gráfico ×
    // 15 pasadas de REPEAT_PASSES) para el MISMO sensorType/rango, pero
    // separadas por minutos entre sí (no por los 10s que cubría el TTL
    // anterior) -- cada una disparaba un fetch nuevo en vez de reusar el
    // resultado ya obtenido, inflando tanto el tiempo total de export como
    // la carga sobre telemetry_raw sin ninguna razón real.
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
 * GET /api/auth/users — usuarios de la misma empresa que la sesión (el
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
 * POST /api/reports/{id}/share — envía el informe a otro usuario de la
 * empresa: persiste en `report_shares` y dispara notificación in-app +
 * email + WhatsApp + SMS (best-effort, canal por canal — ver
 * `notify/notify_service.cpp`). Antes esta función no existía: el modal
 * llamaba a un mock que no tocaba el backend en absoluto.
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
 * ADR-138: crea un enlace de acceso directo al PDF (token opaco, expira en
 * `expires_in_hours` horas) — a diferencia de `fetchReportPdfBlob` (ADR-080,
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
  // Solo viene poblado mientras el job está 'queued'/'running' -- lo escribe
  // el sidecar periódicamente (pdf-export-service/server.js,
  // `saveJobProgress`) y el backend lo lee del volumen compartido
  // (`readExportJobProgress`, report_routes.cpp). `null` es normal: antes
  // de la primera escritura periódica, o para formatos que no lo reportan.
  progress: { captured: number; total: number } | null;
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
 * Encola la exportación del informe a DOCX vía el pipeline SERVIDOR (sidecar
 * Chromium, endpoint /render-docx) — alternativa al pipeline cliente
 * (`lib/exportEngine.ts::exportDOCX`, que no llama a esta función y no
 * depende del backend). Solo funciona sobre informes YA GUARDADOS y con
 * `layoutMode: 'document'` (A4/A3) — el backend responde 400
 * `layout_mode_not_document` en caso contrario. Async: usar `pollExportJob`.
 */
export async function createDocxExportJob(reportId: string): Promise<{ job_id: string; status: string }> {
  const response = await api.post(`/reports/${encodeURIComponent(reportId)}/export/docx`);
  return response.data;
}

/**
 * Encola la exportación del informe a PDF vía el pipeline ASÍNCRONO (sidecar
 * Chromium, endpoint /render-pdf) — alternativa a `fetchReportPdfBlob`
 * (síncrona, ADR-016), pensada para informes grandes (miles de páginas)
 * donde el render puede exceder cualquier presupuesto razonable de request
 * HTTP directo aunque termine bien. Mismo watermark + cifrado (ADR-080) que
 * la variante síncrona -- la contraseña se recupera de
 * `fetchExportJobBlob` (header `X-Pdf-Password`) una vez el job está en
 * `success`. Async: usar `pollExportJob`.
 */
export async function createPdfExportJob(reportId: string): Promise<{ job_id: string; status: string }> {
  const response = await api.post(`/reports/${encodeURIComponent(reportId)}/export/pdf`);
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
  // Solo viene poblado para jobs 'pdf' (ADR-080, ver runPdfExportJob en el
  // backend) -- axios normaliza los nombres de header a minúsculas, mismo
  // criterio que `fetchReportPdfBlob`.
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
  // maxAttempts=1350 (~45 min de polling total, antes 400/~13.3 min): medido
  // en vivo en un documento de 2104 páginas/6302 gráficos con la Fase 2 de
  // paralelismo (checkpoints + N workers dedicados, ver server.js) — DOCX
  // tomó ~30 min de procesamiento activo, PPTX ~25 min. Con 400 intentos el
  // FRONTEND se rendía y mostraba "export_job_poll_timeout" mientras el job
  // seguía corriendo de verdad en el backend (y terminaba bien poco después,
  // invisible para el usuario que ya vio "error"). 1350 intentos da margen
  // real por encima de esos tiempos medidos, no solo del timeout HTTP del
  // backend (que en la práctica no corta la conexión, ver comentario de
  // `postJsonToSidecar`/`gPdfExportTimeoutMs` en report_export_jobs.cpp).
  const { intervalMs = 2000, maxAttempts = 1350, onProgress } = options;
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
