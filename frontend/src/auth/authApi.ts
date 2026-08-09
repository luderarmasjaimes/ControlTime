import {
    getSession,
    updateSessionTokens,
    clearSession,
    readCookie,
    authHeaders as sharedAuthHeaders,
} from './authStorage'

import { log } from '../lib/logger';

function backendBaseUrl(): string {
    const env = import.meta.env.VITE_BACKEND_URL
    if (env) {
        return String(env).replace(/\/$/, '')
    }
    // Mismo origen: Vite (dev) y Nginx (Docker) proxifican /api -> backend (p. ej. :8082 en el host).
    // Antes se usaba :8081 y el login fallaba con "Failed to fetch".
    return ''
}

async function parseJsonResponse(response: Response): Promise<any> {
    let payload: any = {}
    try {
        payload = await response.json()
    } catch {
        payload = {}
    }

    if (!response.ok) {
        log.error('[AUTH_API] HTTP error', {
            status: response.status,
            statusText: response.statusText,
            payload,
        })
        let message = payload.error || `Error HTTP ${response.status}`
        if (Array.isArray(payload.issues) && payload.issues.length > 0) {
            const translations: Record<string, string> = {
                'suspected_glasses': 'Lentes detectados (Retirar lentes)',
                'suspected_hat': 'Gorra o casco detectado (Retirar accesorio)',
                'suspected_face_accessory': 'Accesorio/Mascarilla cubriendo rostro',
                'suspected_heavy_makeup': 'Maquillaje excesivo detectado',
                'eyes_not_open_or_not_visible': 'Los ojos deben estar abiertos y visibles',
                'eye_open_confidence_low': 'Apertura ocular insuficiente (ICAO): abra bien los ojos',
                'mouth_not_closed': 'Mantener la boca cerrada',
                'face_not_frontal': 'Debe mirar fijamente de frente al lente',
                'head_pose_not_straight': 'La cabeza debe estar recta',
                'face_too_small': 'Acérquese más a la cámara',
                'face_off_center': 'Rostro descentrado',
                'lighting_out_of_range': 'Mejore la iluminación del ambiente',
                'lighting_insufficient_icao': 'Iluminación insuficiente (norma ICAO / FACIAL)',
                'ai_face_not_detected': 'No se detectó rostro en el análisis biométrico',
                'image_not_sharp': 'Imagen borrosa, manténgase quieto',
                'low_dynamic_range': 'Baja calidad de imagen/contraste'
            };
            const translatedIssues = payload.issues.map((issue: string) => translations[issue] || issue);
            message = `Validación Biométrica Fallida: ${translatedIssues.join(' | ')}`
        }
        throw new Error(message)
    }

    return payload
}

/**
 * ADR-082: la credencial viaja en la cookie HttpOnly `access_token`, no en un
 * header que este código pueda construir (ni leer, que es el objetivo). Lo
 * único que aporta el JS es el token CSRF del double-submit — ver
 * `authStorage.authHeaders`.
 */
function authHeaders(): Record<string, string> {
    return sharedAuthHeaders()
}

/**
 * ADR-029, "Actualización 2026-07-19": header de doble envío contra CSRF
 * (double-submit cookie). El backend pone una cookie `csrf_token_v2` legible
 * por JS a propósito (a diferencia de `refresh_token`, HttpOnly); este
 * código la repite en el header para que el servidor pueda verificar que
 * quien llama puede LEER cookies de este origen (un sitio de terceros no
 * puede, aunque el navegador de la víctima sí mande la cookie sola).
 *
 * "Actualización 2026-07-21": la cookie pasó de `csrf_token` (Path=/api/auth)
 * a `csrf_token_v2` (Path=/) porque `document.cookie` NUNCA exponía la
 * versión vieja a este código (que corre en páginas de la SPA como "/" o
 * "/report", nunca "/api/auth") — todo refresh fallaba con
 * `csrf_token_mismatch` en cuanto el access token de 15 min vencía,
 * disparando el logout silencioso que mostraba "Sesión expirada" una y otra
 * vez pese a que el usuario seguía autenticado. El nombre nuevo (no solo el
 * Path) evita además que la cookie vieja, aún viva hasta 7 días en sesiones
 * activas de antes de este fix, siga generando el mismo mismatch.
 */
function csrfHeaders(): Record<string, string> {
    const csrf = readCookie('csrf_token_v2')
    return csrf ? { 'X-CSRF-Token': csrf } : {}
}

/**
 * ADR-029 (revisado): el access token vive ~15 min; en vez de esperar a que
 * el backend responda 401, cualquier fetch autenticado puede pasar por acá
 * para renovarlo una sola vez y reintentar. `refreshInFlight` deduplica
 * refrescos concurrentes (varias llamadas 401 casi simultáneas comparten
 * la misma promesa en vez de rotar el refresh token varias veces).
 *
 * "Actualización 2026-07-19": el refresh token ya no vive en `localStorage`
 * -- viaja como cookie HttpOnly que el navegador adjunta solo. Este código
 * ya no puede (ni necesita) leerlo: simplemente llama al endpoint con
 * `credentials: 'include'` y deja que el navegador mande la cookie; si no
 * hay una cookie de refresh válida, el backend responde 401/400 igual que
 * antes y se limpia la sesión local.
 */
let refreshInFlight: Promise<string | null> | null = null

export async function refreshAccessToken(): Promise<string | null> {
    if (refreshInFlight) {
        return refreshInFlight
    }
    refreshInFlight = (async () => {
        try {
            const response = await fetch(`${backendBaseUrl()}/api/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
            })
            if (!response.ok) {
                // Refresh token inválido/expirado/revocado/ausente: no hay
                // forma de recuperar la sesión sin volver a autenticarse.
                clearSession()
                return null
            }
            const payload = await response.json().catch(() => ({} as any))
            if (typeof payload?.access_token !== 'string') {
                clearSession()
                return null
            }
            updateSessionTokens(payload.access_token, payload.expires_in)
            return payload.access_token as string
        } catch {
            return null
        }
    })()
    try {
        return await refreshInFlight
    } finally {
        refreshInFlight = null
    }
}

/** @brief fetch autenticado con un reintento automático tras renovar el access token si la respuesta es 401.
 * Exportado (ADR-041): única implementación canónica de este patrón para clientes fetch nativo —
 * `frontend/src/lib/fetchWithAuth.ts` re-exporta esta misma función en vez de duplicarla. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const doFetch = () =>
        fetch(`${backendBaseUrl()}${path}`, {
            ...init,
            // ADR-082: `credentials: 'include'` es obligatorio ahora que la
            // credencial es una cookie. En same-origin el default ya la
            // mandaría, pero `VITE_BACKEND_URL` permite apuntar el frontend a
            // un backend de otro origen, y ahí el default ('same-origin') la
            // omitiría y toda la app quedaría sin autenticar.
            credentials: 'include',
            headers: { ...(init.headers || {}), ...authHeaders() },
        })

    let response = await doFetch()
    // ADR-029, "Actualización 2026-07-19": ya no se puede saber desde JS si
    // existe una cookie de refresh vigente (es HttpOnly, a propósito) -- se
    // intenta el refresh siempre que haya un 401; si no hay cookie válida,
    // refreshAccessToken() simplemente devuelve null sin reintentar nada.
    if (response.status === 401 && getSession()) {
        const refreshed = await refreshAccessToken()
        if (refreshed) {
            response = await doFetch()
        }
    }
    return response
}

/** Avatar HD privado del usuario autenticado.
 * Se descarga como Blob solo al abrir el visor para no cargar varios MB en
 * localStorage, en el JWT ni durante cada render de la cabecera.
 */
export async function fetchMyAvatarHd(): Promise<Blob> {
    const response = await authFetch('/api/auth/avatar/hd')
    if (!response.ok) {
        let message = `Avatar HD no disponible (HTTP ${response.status})`
        try {
            const payload = await response.json()
            if (typeof payload?.error === 'string') message = payload.error
        } catch {
            // La respuesta puede no ser JSON (proxy o error de red intermedio).
        }
        throw new Error(message)
    }
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) {
        throw new Error('La respuesta del avatar no es una imagen válida.')
    }
    return blob
}

async function postJson(path: string, body: unknown, options: { timeoutMs?: number } = {}): Promise<any> {
    const timeoutMs =
        Number.isFinite(options?.timeoutMs) && Number(options.timeoutMs) > 0
            ? Number(options.timeoutMs)
            : 30000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await authFetch(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        return parseJsonResponse(response)
    } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
            throw new Error(
                `Tiempo de espera agotado (${Math.round(timeoutMs / 1000)}s). Verifique red/servidor e intente de nuevo.`
            )
        }
        throw err
    } finally {
        clearTimeout(timeoutId)
    }
}

export async function fetchCompanies(): Promise<any[]> {
    const response = await fetch(`${backendBaseUrl()}/api/auth/companies`)
    const payload = await parseJsonResponse(response)
    return Array.isArray(payload.companies) ? payload.companies : []
}

export interface CompanyRecord {
    company_id: string;
    name: string;
    ruc: string;
    country_code: string;
    domicilio_fiscal: string;
    tenant_id: string;
    active: boolean;
    demo_data: boolean;
    created_at: string;
    updated_at: string;
    updated_by: string;
    deactivated_at?: string;
    deactivated_by?: string;
}

export interface CreateCompanyPayload {
    name: string;
    ruc?: string;
    country?: string;
    domicilio_fiscal?: string;
}

/** ADR-085/086: extendido para aceptar RUC/país/domicilio opcionales, además
 * del `name` original — sigue aceptando un `string` a secas por compatibilidad
 * con los call sites existentes (AuthGateway, etc.) que solo mandaban nombre. */
export async function createCompany(payload: string | CreateCompanyPayload): Promise<any> {
    const body: CreateCompanyPayload =
        typeof payload === 'string' ? { name: payload } : payload
    return postJson('/api/auth/companies', {
        name: String(body.name || '').trim(),
        ...(body.ruc ? { ruc: body.ruc } : {}),
        ...(body.country ? { country: body.country } : {}),
        ...(body.domicilio_fiscal ? { domicilio_fiscal: body.domicilio_fiscal } : {}),
    })
}

/** Pantalla de administración (ADR-085): a diferencia de fetchCompanies() (público,
 * solo activas, sin RUC), requiere `empresas.view` e incluye inactivas/RUC. */
export async function fetchCompaniesAdmin(includeInactive = false): Promise<{ companies: CompanyRecord[]; canManage: boolean }> {
    const query = new URLSearchParams()
    if (includeInactive) query.set('include_inactive', 'true')
    const response = await authFetch(`/api/auth/companies/manage?${query.toString()}`)
    const payload = await parseJsonResponse(response)
    return {
        companies: Array.isArray(payload.companies) ? payload.companies : [],
        canManage: payload.can_manage === true,
    }
}

/** Requiere `empresas.manage`. Nunca envía/edita `name` — ver ADR-085 (renombrar queda fuera de alcance). */
export async function updateCompany(companyId: string, patch: {
    ruc?: string;
    country?: string;
    domicilio_fiscal?: string;
}): Promise<CompanyRecord> {
    const response = await authFetch(`/api/auth/companies/${encodeURIComponent(companyId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    })
    return parseJsonResponse(response)
}

/** Baja/reactivación lógica (soft delete — ADR-085). Requiere `empresas.manage`. */
export async function setCompanyActive(companyId: string, active: boolean): Promise<{ ok: boolean; active: boolean; active_users_affected: number }> {
    const query = active ? '?reactivate=true' : ''
    const response = await authFetch(`/api/auth/companies/${encodeURIComponent(companyId)}${query}`, {
        method: 'DELETE',
    })
    return parseJsonResponse(response)
}

interface RegisterUserPayload {
    company: string;
    firstName: string;
    lastName: string;
    dni: string;
    username: string;
    password: string;
    role?: string;
    ruc?: string;
    phone?: string;
    mobile?: string;
    email?: string;
    faceTemplate?: number[];
    faceImageBase64?: string;
    facePortraitOvalBase64?: string;
    faceBustRectBase64?: string;
}

export async function registerUser(payload: RegisterUserPayload): Promise<any> {
    const body: Record<string, unknown> = {
        company: payload.company,
        first_name: payload.firstName,
        last_name: payload.lastName,
        dni: payload.dni,
        username: payload.username,
        password: payload.password,
    }

    if (payload.role) body.role = payload.role
    if (payload.ruc) body.ruc = payload.ruc
    if (payload.phone) body.phone = payload.phone
    if (payload.mobile) body.mobile = payload.mobile
    if (payload.email) body.email = payload.email

    /* Enviar plantilla e imagen si existen: el backend prioriza face_template (rápido)
       y ya no fuerza embedding en ai_engine cuando la plantilla viene del cliente. */
    const hasTemplate =
        Array.isArray(payload.faceTemplate) &&
        payload.faceTemplate.length > 0
    if (hasTemplate) {
        body.face_template = payload.faceTemplate
    }
    if (payload.faceImageBase64) {
        body.face_image_base64 = payload.faceImageBase64
    }
    if (payload.facePortraitOvalBase64) {
        body.face_portrait_oval_base64 = payload.facePortraitOvalBase64
    }
    if (payload.faceBustRectBase64) {
        body.face_bust_rect_base64 = payload.faceBustRectBase64
    }

    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    const out = await postJson(
        '/api/auth/register',
        {
            ...body,
        },
        { timeoutMs: 45000 }
    )
    if (t0 && typeof performance !== 'undefined') {
        const ms = Math.round(performance.now() - t0)
        log.info('[AUTH_API] /api/auth/register OK', {
            ms,
            sent_template: Boolean(body.face_template),
            sent_image: Boolean(body.face_image_base64),
        })
    }
    return out
}

export async function loginWithPassword(payload: { company: string; username: string; password: string }): Promise<any> {
    return postJson('/api/auth/login/password', {
        company: payload.company,
        username: payload.username,
        password: payload.password,
    })
}

/**
 * ADR-029 (revisado): logout real — revoca el access token (jti) y el
 * refresh token en el servidor de inmediato. Antes el "logout" solo
 * limpiaba localStorage; la sesión seguía siendo válida en el backend hasta
 * su expiración natural (hasta 8 h). Best-effort: si el backend no responde,
 * igual se limpia la sesión local para no dejar al usuario atascado.
 *
 * "Actualización 2026-07-19": el refresh token ya no se manda en el body (ya
 * no vive en JS) -- el backend lo lee de su propia cookie HttpOnly vía
 * `credentials: 'include'`, y exige el header X-CSRF-Token (double-submit
 * cookie) para aceptar revocarla.
 */
export async function logout(): Promise<void> {
    try {
        await fetch(`${backendBaseUrl()}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...authHeaders(), ...csrfHeaders() },
        })
    } catch (err) {
        log.warn('[AUTH_API] logout: no se pudo notificar al servidor', err)
    } finally {
        clearSession()
    }
}

const MSG_USUARIO_NO_EXISTE = 'USUARIO NO EXISTE'

/**
 * Comprueba si existe un usuario (Usuario, DNI o RUC) en la empresa antes de abrir la cámara.
 * Usa POST (JSON) para evitar proxies que alteran el query string; si el backend solo tiene GET, reintenta por GET.
 * Solo si payload.ok === true se debe abrir la sesión facial.
 */
export async function checkLoginIdentity(company: string, identity: string): Promise<any> {
    const c = String(company ?? '').trim()
    const id = String(identity ?? '').trim()
    const base = `${backendBaseUrl()}/api/auth/login/check-identity`
    const postOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: c, identity: id }),
    }
    let response = await fetch(base, postOpts)
    if (response.status === 404) {
        const q = new URLSearchParams({ company: c, identity: id })
        response = await fetch(`${base}?${q.toString()}`)
    }
    let payload: any = {}
    try {
        payload = await response.json()
    } catch {
        payload = {}
    }
    if (response.status >= 500) {
        throw new Error(
            payload.error || `Error HTTP ${response.status}: no se pudo verificar el usuario.`
        )
    }
    if (response.status === 400) {
        return {
            ok: false,
            reason: payload.reason || 'bad_request',
            error:
                payload.error ||
                'Indique empresa e identificador (Usuario, DNI o RUC).',
        }
    }
    if (response.status === 200 && payload && typeof payload.ok === 'boolean') {
        log.info('[AUTH_API] checkLoginIdentity', {
            company: c,
            identityLen: id.length,
            ok: payload.ok,
            reason: payload.reason,
            username: payload.username,
        })
        return payload
    }
    return {
        ok: false,
        reason: 'invalid_response',
        error: MSG_USUARIO_NO_EXISTE,
    }
}

interface LoginWithFacePayload {
    company?: string;
    companyName?: string;
    identityLogin?: string;
    identity_login?: string;
    username?: string;
    dni?: string;
    ruc?: string;
    imageBase64?: string;
    template?: number[];
}

export async function loginWithFace(payload: LoginWithFacePayload): Promise<any> {
    const company = String(payload.company ?? payload.companyName ?? '').trim()
    const identity = String(
        payload.identityLogin ??
            payload.identity_login ??
            payload.username ??
            payload.dni ??
            payload.ruc ??
            ''
    ).trim()
    if (!company || !identity) {
        throw new Error(
            'Complete empresa y Usuario/DNI/RUC antes del reconocimiento facial.'
        )
    }
    const body: Record<string, unknown> = {
        company,
        identity_login: identity,
        username: identity,
    }

    if (payload.imageBase64) {
        body.face_image_base64 = payload.imageBase64
    }
    if (payload.template) {
        body.face_template = payload.template
    }
    if (!body.face_image_base64 && !body.face_template) {
        throw new Error('No se capturó imagen o plantilla facial para validar.')
    }

    log.info('[AUTH_FACE] loginWithFace request', {
        company,
        identity_login: identity,
        has_template: Boolean(body.face_template),
        template_dim: Array.isArray(body.face_template) ? body.face_template.length : 0,
        has_image_base64: Boolean(body.face_image_base64),
        image_base64_len: typeof body.face_image_base64 === 'string' ? body.face_image_base64.length : 0,
    })

    return postJson('/api/auth/login/face', {
        ...body,
    })
}

export async function fetchAuthAudit({ page = 1, pageSize = 50, company, username, action, success }: {
    page?: number;
    pageSize?: number;
    company?: string;
    username?: string;
    action?: string;
    success?: boolean;
} = {}): Promise<any> {
    const query = new URLSearchParams()
    query.set('page_size', String(pageSize))
    query.set('page', String(page))
    if (company) query.set('company', company)
    if (username) query.set('username', username)
    if (action) query.set('action', action)
    if (typeof success === 'boolean') query.set('success', success ? 'true' : 'false')

    const response = await authFetch(`/api/auth/audit?${query.toString()}`)
    return parseJsonResponse(response)
}

/**
 * Descarga el CSV de auditoría autenticando por header.
 *
 * Antes esto devolvía una URL con `?auth_token=<jwt>` para colgarla de un
 * `<a href>` (auditoría de seguridad 2026-08-02). Un access token completo en
 * la barra de direcciones acaba escrito en claro en el access log de nginx, en
 * el historial del navegador y —al ser `target="_blank"`— en el header
 * `Referer`. Se descarga vía `authFetch` (Bearer en header, con refresh
 * automático en 401) y se entrega al usuario como Blob, así el token no sale
 * nunca de la memoria del JS.
 */
export async function downloadAuthAuditCsv({ company, username, action, success }: {
    company?: string;
    username?: string;
    action?: string;
    success?: boolean;
} = {}): Promise<void> {
    const query = new URLSearchParams()
    if (company) query.set('company', company)
    if (username) query.set('username', username)
    if (action) query.set('action', action)
    if (typeof success === 'boolean') query.set('success', success ? 'true' : 'false')

    const response = await authFetch(`/api/auth/audit/export.csv?${query.toString()}`)
    if (!response.ok) {
        throw new Error(`export_failed_${response.status}`)
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = 'auditoria.csv'
        document.body.appendChild(link)
        link.click()
        link.remove()
    } finally {
        // Liberar en el siguiente tick: revocar de inmediato puede cancelar la
        // descarga antes de que el navegador haya leído el Blob.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    }
}
export async function verifyBiometricFrame(imageBase64: string): Promise<any> {
    const response = await authFetch('/api/auth/biometric/verify-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ face_image_base64: imageBase64 }),
    })
    return parseJsonResponse(response)
}

/**
 * ID estable por pestaña para /api/process_frame + /api/status. Sin esto, el
 * backend (gBiometricCaptureState) y el ai_engine (histéresis de lentes/EAR
 * en eye_analyzer.py) guardaban el estado en variables globales de proceso
 * compartidas por TODAS las capturas concurrentes -- dos pestañas, o incluso
 * pruebas/health-checks paralelas, se pisaban entre sí (0/3 muestras pegado,
 * "sin lentes"/"ojos abiertos" con falsos negativos por contaminación cruzada).
 */
let _captureSessionId: string | null = null
function getCaptureSessionId(): string {
    if (!_captureSessionId) {
        _captureSessionId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `cap-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    return _captureSessionId
}

export async function processBiometricFrame(imageBase64: string): Promise<any> {
    const raw = atob(imageBase64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) {
        bytes[i] = raw.charCodeAt(i)
    }
    const response = await authFetch('/api/process_frame', {
        method: 'POST',
        headers: {
            'Content-Type': 'image/jpeg',
            'X-Capture-Session-Id': getCaptureSessionId(),
        },
        body: bytes,
    })
    return parseJsonResponse(response)
}

export async function fetchBiometricStatus(): Promise<any> {
    const response = await authFetch('/api/status', {
        headers: { 'X-Capture-Session-Id': getCaptureSessionId() },
    })
    return parseJsonResponse(response)
}

export async function resetBiometricCapture(): Promise<any> {
    const response = await authFetch('/api/reset_capture')
    return parseJsonResponse(response)
}

export interface DniScanResult {
    found: boolean;
    /** "pdf417" (DNI antiguo 1997) | "mrz" (todas las versiones) | "none" */
    method: 'pdf417' | 'mrz' | 'none';
    dni?: string;
    first_name?: string;
    last_name?: string;
    sex?: string;
    birth_date?: string;
    expiry_date?: string;
    /** true si además del método de lectura, el dígito verificador real de
     * RENIEC (Módulo 11) validó el número extraído. */
    checksum_valid?: boolean;
    error?: string;
}

/** Lectura de DNI por cámara (PDF417 del DNI antiguo + MRZ de todas las
 * versiones, ver ai_engine/dni_scan.py). No consulta RENIEC/SUNAT — solo
 * decodifica lo ya impreso en el documento. Público (usable antes de login,
 * igual que processBiometricFrame). */
export async function scanDniDocument(imageBase64: string): Promise<DniScanResult> {
    const raw = atob(imageBase64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) {
        bytes[i] = raw.charCodeAt(i)
    }
    const response = await authFetch('/api/dni/scan-document', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: bytes,
    })
    return parseJsonResponse(response)
}

export async function fetchCompanyUsers(company?: string): Promise<any> {
    const query = new URLSearchParams()
    if (company) query.set('company', company)

    const response = await authFetch(`/api/auth/users?${query.toString()}`)

    return parseJsonResponse(response)
}

export async function executeUserMaintenance(payload: unknown): Promise<any> {
    return postJson('/api/auth/users/maintenance', {
        ...(payload as Record<string, unknown>),
    })
}

export async function fetchUserMaintenanceAudit({ company, page = 1, pageSize = 20 }: {
    company?: string;
    page?: number;
    pageSize?: number;
} = {}): Promise<any> {
    const query = new URLSearchParams()
    query.set('page', String(page))
    query.set('page_size', String(pageSize))
    if (company) query.set('company', company)

    const response = await authFetch(`/api/auth/users/maintenance/audit?${query.toString()}`)

    return parseJsonResponse(response)
}

export async function validateCompany(company?: string, ruc?: string, countryIso2?: string): Promise<boolean> {
    const query = new URLSearchParams()
    if (company) query.set('company', company)
    if (ruc) query.set('ruc', ruc)
    if (countryIso2) query.set('country', countryIso2.toUpperCase())

    const response = await fetch(`${backendBaseUrl()}/api/auth/validate-company?${query.toString()}`)
    const payload = await parseJsonResponse(response)
    return payload.valid === true
}

export interface CompanyValidationResult {
    valid: boolean;
    company_known?: boolean;
    ruc_matches_company?: boolean;
    /** ADR-087: "disabled"|"unavailable"|"not_found"|"confirmed" — consulta opcional a un
     * verificador de RUC de terceros, apagada por defecto (BEEMETRY_TAX_REGISTRY_ENABLED). */
    registry?: 'disabled' | 'unavailable' | 'not_found' | 'confirmed';
    registry_razon_social?: string;
    registry_estado?: string;
}

/** Igual que validateCompany() pero devuelve el payload completo (incluye `registry.*`
 * cuando ADR-087 está habilitado) — usado por CompanyManagementView para mostrar los
 * tres estados posibles: checksum ok / padrón confirmado / padrón no consultado. */
export async function validateCompanyDetailed(ruc: string, countryIso2 = 'PE', company?: string): Promise<CompanyValidationResult> {
    const query = new URLSearchParams()
    if (company) query.set('company', company)
    if (ruc) query.set('ruc', ruc)
    query.set('country', countryIso2.toUpperCase())

    const response = await fetch(`${backendBaseUrl()}/api/auth/validate-company?${query.toString()}`)
    return parseJsonResponse(response)
}

const FALLBACK_PLATFORM_COUNTRIES = [
    { iso2: 'US', label: 'Estados Unidos', phone_prefix: '1', region: 'north_america', default_locale: 'en-US' },
    { iso2: 'CA', label: 'Canadá', phone_prefix: '1', region: 'north_america', default_locale: 'fr-CA' },
    { iso2: 'MX', label: 'México', phone_prefix: '52', region: 'north_america', default_locale: 'es-MX' },
    { iso2: 'PE', label: 'Perú', phone_prefix: '51', region: 'latam', default_locale: 'es-PE' },
    { iso2: 'CL', label: 'Chile', phone_prefix: '56', region: 'latam', default_locale: 'es-CL' },
    { iso2: 'CO', label: 'Colombia', phone_prefix: '57', region: 'latam', default_locale: 'es-CO' },
    { iso2: 'BR', label: 'Brasil', phone_prefix: '55', region: 'latam', default_locale: 'pt-BR' },
    { iso2: 'AR', label: 'Argentina', phone_prefix: '54', region: 'latam', default_locale: 'es-AR' },
    { iso2: 'EC', label: 'Ecuador', phone_prefix: '593', region: 'latam', default_locale: 'es-EC' },
    { iso2: 'BO', label: 'Bolivia', phone_prefix: '591', region: 'latam', default_locale: 'es-BO' },
    { iso2: 'GT', label: 'Guatemala', phone_prefix: '502', region: 'latam', default_locale: 'es-GT' },
    { iso2: 'CU', label: 'Cuba', phone_prefix: '53', region: 'caribbean', default_locale: 'es-CU' },
    { iso2: 'DO', label: 'República Dominicana', phone_prefix: '1', region: 'caribbean', default_locale: 'es-DO' },
]

const FALLBACK_UI_LANGUAGES = [
    { code: 'es', label_es: 'Español', label_native: 'Español', sort_order: 10 },
    { code: 'en', label_es: 'Inglés', label_native: 'English', sort_order: 20 },
    { code: 'pt', label_es: 'Portugués', label_native: 'Português', sort_order: 30 },
    { code: 'fr', label_es: 'Francés', label_native: 'Français', sort_order: 40 },
]

export async function fetchPlatformCountries(): Promise<any[]> {
    try {
        const response = await fetch(`${backendBaseUrl()}/api/platform/countries`)
        if (!response.ok) {
            return [...FALLBACK_PLATFORM_COUNTRIES]
        }
        const payload = await response.json()
        const list = Array.isArray(payload.countries) ? payload.countries : []
        return list.length > 0 ? list : [...FALLBACK_PLATFORM_COUNTRIES]
    } catch {
        return [...FALLBACK_PLATFORM_COUNTRIES]
    }
}

export async function fetchPlatformUiLanguages(): Promise<any[]> {
    try {
        const response = await fetch(`${backendBaseUrl()}/api/platform/ui-languages`)
        if (!response.ok) {
            return [...FALLBACK_UI_LANGUAGES]
        }
        const payload = await response.json()
        const list = Array.isArray(payload.languages) ? payload.languages : []
        return list.length > 0 ? list : [...FALLBACK_UI_LANGUAGES]
    } catch {
        return [...FALLBACK_UI_LANGUAGES]
    }
}
