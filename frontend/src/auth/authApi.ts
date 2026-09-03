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
        // 429/502/503/504: responden desde nginx (rate limit o backend caído/
        // reiniciando), no desde el backend C++ -- el cuerpo nunca trae
        // {error, issues} en el formato de la app, así que sin este caso el
        // usuario final veía literalmente "Error HTTP 503" (confirmado en
        // pruebas reales, 2026-08-19: varios reintentos de login en poco
        // tiempo calibrando distancia/iluminación superaron el límite de
        // ráfaga de nginx en /api/auth/login/). 429 es el límite de intentos
        // (esperado en uso normal si se reintenta muy seguido); 502/503/504
        // es el backend realmente no disponible.
        if (response.status === 429) {
            message = 'Demasiados intentos en poco tiempo. Espere unos segundos y vuelva a intentar.'
        } else if (
            !payload.error &&
            (response.status === 502 || response.status === 503 || response.status === 504)
        ) {
            message = 'El servicio no está disponible en este momento. Intente nuevamente en unos segundos.'
        }
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
 * Migración a Bearer-en-memoria: la credencial primaria vuelve a ser
 * `Authorization: Bearer <token>` (token en memoria de JS, nunca en disco --
 * ver `authStorage.ts`), no la cookie HttpOnly `beemetry_access_token` (que
 * se sigue enviando como respaldo). El motivo del cambio: dos frontends
 * distintos en el mismo host (mismo dominio, distinto puerto) comparten el
 * mismo cajón de cookies del navegador y se pisan la sesión entre sí; Bearer
 * en memoria es inmune a eso porque vive en el contexto de JS de cada
 * aplicación, no en un recurso compartido por host.
 */
function authHeaders(): Record<string, string> {
    return sharedAuthHeaders()
}

/**
 * Header de doble envío contra CSRF (double-submit cookie) -- sigue siendo
 * necesario para `/api/auth/refresh` y `/api/auth/logout`, que dependen de
 * la cookie `beemetry_refresh_token` (HttpOnly), no del Bearer. El backend
 * pone una cookie `beemetry_csrf_token` legible por JS a propósito (a
 * diferencia de `beemetry_refresh_token`); este código la repite en el
 * header para que el servidor pueda verificar que quien llama puede LEER
 * cookies de este origen (un sitio de terceros no puede, aunque el
 * navegador de la víctima sí mande la cookie sola).
 *
 * Nombre namespaced `beemetry_csrf_token` (antes `csrf_token_v2`, migración
 * 2026-08-27): mismo motivo que el resto de las cookies de esta migración --
 * evitar colisión con una cookie genérica de otro frontend en el mismo host.
 */
function csrfHeaders(): Record<string, string> {
    const csrf = readCookie('beemetry_csrf_token')
    return csrf ? { 'X-CSRF-Token': csrf } : {}
}

/**
 * El access token vive ~15 min; en vez de esperar a que el backend responda
 * 401, cualquier fetch autenticado puede pasar por acá para renovarlo una
 * sola vez y reintentar. `refreshInFlight` deduplica refrescos concurrentes
 * (varias llamadas 401 casi simultáneas comparten la misma promesa en vez de
 * rotar el refresh token varias veces).
 *
 * El refresh token en sí NUNCA vive en JS -- viaja como cookie HttpOnly
 * namespaced (`beemetry_refresh_token`) que el navegador adjunta solo. Este
 * código no puede (ni necesita) leerlo: llama al endpoint con
 * `credentials: 'include'` + `X-CSRF-Token` y deja que el navegador mande la
 * cookie; si no hay una cookie de refresh válida, el backend responde
 * 401/400 y se limpia la sesión local. El `access_token` NUEVO que sí viene
 * en el body de la respuesta se guarda vía `updateSessionTokens` en la
 * variable de memoria de `authStorage.ts` (Bearer-en-memoria) -- también
 * exportado como `refreshAccessToken()` para que `AuthGateway`/el arranque
 * de la app puedan llamarlo directo y restaurar la sesión sin re-loguear
 * tras una recarga (el token en memoria se pierde con cada reload, a
 * propósito).
 */
let refreshInFlight: Promise<string | null> | null = null

export async function refreshAccessToken(): Promise<string | null> {
    if (refreshInFlight) {
        return refreshInFlight
    }
    refreshInFlight = (async () => {
        // Sin timeout (versión anterior) este fetch podía quedar colgado
        // indefinidamente si el backend estaba sobrecargado/lento -- axios
        // NO protege este camino: el `timeout` de la instancia `api` (ver
        // ReportStudioV2/lib/api.ts) solo acota la request ORIGINAL que
        // disparó el 401, no este `await refreshAccessToken()` que corre
        // DENTRO del interceptor. Reproducido en vivo: un export de un
        // informe grande (378 páginas / 1120 gráficos en vivo, cada uno con
        // su propia petición de telemetría) se colgó 10 minutos completos --
        // un 401 a mitad de export (el access token dura ~15 min) disparaba
        // este refresh, que nunca resolvía ni rechazaba bajo backend
        // sobrecargado, dejando el widget del gráfico en estado "cargando"
        // para siempre (nunca llegaba a su propio catch/finally). Mismo
        // patrón AbortController que ya usa `postJson` más abajo en este
        // mismo archivo.
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)
        try {
            const response = await fetch(`${backendBaseUrl()}/api/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
                signal: controller.signal,
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
            // Incluye AbortError (timeout): no limpia la sesión -- puede ser
            // un problema transitorio de red/servidor, no un refresh token
            // realmente inválido. El caller (authFetch/interceptor de axios)
            // trata `null` como "no se pudo renovar" y sigue con el 401
            // original en vez de quedarse esperando para siempre.
            return null
        } finally {
            clearTimeout(timeoutId)
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

/** db_scripts/72: 'mining_client' (empresa minera cliente, default) | 'organization' (Beemetry/TimeTelemetry). */
export type CompanyType = 'mining_client' | 'organization';

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
    latitude: number | null;
    longitude: number | null;
    location_zoom: number | null;
    company_type: CompanyType;
}

export interface CreateCompanyPayload {
    name: string;
    ruc?: string;
    country?: string;
    domicilio_fiscal?: string;
    latitude?: number;
    longitude?: number;
    location_zoom?: number;
    company_type?: CompanyType;
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
        ...(body.company_type ? { company_type: body.company_type } : {}),
        // ADR-121: lat/lng viajan juntas o ninguna -- ver auth_routes.cpp.
        ...(typeof body.latitude === 'number' && typeof body.longitude === 'number'
            ? {
                  latitude: body.latitude,
                  longitude: body.longitude,
                  ...(typeof body.location_zoom === 'number' ? { location_zoom: body.location_zoom } : {}),
              }
            : {}),
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
    latitude?: number;
    longitude?: number;
    location_zoom?: number;
    company_type?: CompanyType;
}): Promise<CompanyRecord> {
    const response = await authFetch(`/api/auth/companies/${encodeURIComponent(companyId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    })
    return parseJsonResponse(response)
}

// ── db_scripts/72: acceso cruzado de personal de organización ─────────────
// (Beemetry/TimeTelemetry) a empresas mineras clientes. Todo esto solo tiene
// efecto si el tenant activo de la sesión es company_type='organization' Y el
// usuario tiene el permiso de plataforma `org.cross_tenant.manage` -- el
// backend re-valida ambas condiciones en cada request (ver
// backend/src/auth/org_access_routes.cpp), esto es solo para no mostrar la UI
// a quien de todas formas no podría usarla.

export interface OrgAccessCandidateTenant {
    tenant_id: string;
    tenant_name: string;
    country_code: string;
    region: string;
}

/** GET /api/auth/org-access/candidates — tenants mineros disponibles para otorgar acceso cruzado. */
export async function fetchOrgAccessCandidates(): Promise<OrgAccessCandidateTenant[]> {
    const response = await authFetch('/api/auth/org-access/candidates')
    const payload = await parseJsonResponse(response)
    return Array.isArray(payload.tenants) ? payload.tenants : []
}

/** POST /api/auth/org-access/grant — otorga (o actualiza el rol de) acceso cruzado. */
export async function grantOrgAccess(username: string, tenantId: string, role: string): Promise<any> {
    return postJson('/api/auth/org-access/grant', { username, tenant_id: tenantId, role })
}

/** POST /api/auth/org-access/revoke — revoca un acceso cruzado ya otorgado. */
export async function revokeOrgAccess(username: string, tenantId: string): Promise<any> {
    return postJson('/api/auth/org-access/revoke', { username, tenant_id: tenantId })
}

export interface OrgAccessAuditRow {
    event_time: string;
    action: string;
    actor_username: string;
    success: boolean;
    detail: string;
}

/** GET /api/auth/org-access/audit — historial dedicado de concesiones/revocaciones. */
export async function fetchOrgAccessAudit(limit = 50, offset = 0): Promise<OrgAccessAuditRow[]> {
    const response = await authFetch(`/api/auth/org-access/audit?limit=${limit}&offset=${offset}`)
    const payload = await parseJsonResponse(response)
    return Array.isArray(payload.items) ? payload.items : []
}

export interface CompanyLocation {
    has_location: boolean;
    latitude?: number;
    longitude?: number;
    zoom?: number;
}

/** ADR-121: coordenadas de la mina del tenant de la sesión actual — usado por
 * MapViewer.tsx para reemplazar el centro fijo. Cualquier usuario autenticado
 * puede consultar la ubicación de su propia empresa (sin permiso especial). */
export async function fetchCompanyLocation(): Promise<CompanyLocation> {
    const response = await authFetch('/api/map/company-location')
    return parseJsonResponse(response)
}

export interface GeocodeResult {
    lat: string;
    lon: string;
    display_name: string;
}

/** Proxy server-side a Nominatim (ADR-121) — requiere `empresas.manage`, usado
 * solo por el buscador de dirección del picker de ubicación de empresa. */
export async function geocodeAddress(query: string): Promise<GeocodeResult[]> {
    const params = new URLSearchParams({ q: query })
    const response = await authFetch(`/api/map/geocode?${params.toString()}`)
    const payload = await parseJsonResponse(response)
    return Array.isArray(payload) ? payload : []
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

    /* Corrección 2026-08-13: NO enviar face_template (plantilla calculada en el
       cliente). El backend (auth_storage_pg.cpp, hallazgo de seguridad
       2026-08-10 / db_scripts/53) marca cualquier registro con face_template
       como provider "unknown_client_supplied" y lo RECHAZA explícitamente en
       cada login facial posterior -- nunca pasó por análisis facial real. El
       comentario anterior de este archivo ("el backend prioriza
       face_template") describía el síntoma, no la intención: quedó
       desactualizado tras el hallazgo de seguridad, y toda cuenta nueva
       registrada por esta pantalla terminaba con el login facial
       permanentemente roto (confirmado en vivo 2026-08-13). Enviar solo
       face_image_base64 fuerza siempre el embedding real vía ai_engine.
       payload.faceTemplate se sigue aceptando en la firma por si algún
       llamador todavía lo usa para otra cosa (p.ej. el óvalo en pantalla),
       pero ya no viaja al backend. */
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

export async function loginWithPassword(payload: {
    company: string;
    username: string;
    password: string;
    /** Ubicación de la PC/dispositivo cliente (API de geolocalización del navegador), best-effort. */
    location?: {
        latitude: number;
        longitude: number;
        accuracy: number;
        capturedAt: string;
    } | null;
}): Promise<any> {
    const body: Record<string, unknown> = {
        company: payload.company,
        username: payload.username,
        password: payload.password,
    }
    if (
        payload.location &&
        Number.isFinite(payload.location.latitude) &&
        Number.isFinite(payload.location.longitude)
    ) {
        body.location = {
            latitude: payload.location.latitude,
            longitude: payload.location.longitude,
            accuracy: payload.location.accuracy,
            captured_at: payload.location.capturedAt,
        }
    }
    return postJson('/api/auth/login/password', body)
}

/**
 * Segundo paso del login cuando loginWithPassword (o el login facial)
 * devuelve `{status: "mfa_required", mfa_token}` (ADR-135, MFA/TOTP). El
 * `mfa_token` es de un solo uso real y expira en 5 min -- si el código es
 * incorrecto se puede reintentar con el MISMO mfa_token hasta esa ventana.
 */
export async function loginWithMfaCode(mfaToken: string, code: string): Promise<any> {
    return postJson('/api/auth/login/mfa', { mfa_token: mfaToken, code })
}

/** Estado actual de MFA/TOTP de la cuenta logueada. */
export async function getMfaStatus(): Promise<{ enabled: boolean }> {
    return authFetch('/api/auth/mfa/status').then((r) => r.json())
}

/** Inicia el enrolamiento: genera un secreto pendiente + la URI otpauth:// para QR/ingreso manual. */
export async function enrollMfa(): Promise<{ secret: string; otpauth_uri: string }> {
    return authFetch('/api/auth/mfa/enroll', { method: 'POST' }).then((r) => r.json())
}

/** Confirma el enrolamiento con el primer código real del authenticator. */
export async function verifyMfaEnroll(code: string): Promise<any> {
    return authFetch('/api/auth/mfa/verify-enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    }).then((r) => r.json())
}

/** Desactiva MFA -- exige el código vigente (prueba de posesión del segundo factor). */
export async function disableMfa(code: string): Promise<any> {
    return authFetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    }).then((r) => r.json())
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
    /** Ubicación de la PC cliente (API de geolocalización del navegador), best-effort. */
    location?: {
        latitude: number;
        longitude: number;
        accuracy: number;
        capturedAt: string;
    } | null;
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
    /* Corrección 2026-08-13: NO enviar face_template (plantilla "clásica"
       calculada en el cliente, distinta dimensión que el embedding
       InsightFace real). Con BEEMETRY_BIOMETRIC_PROVIDER=legacy, buildFaceLoginProbe
       (face_analysis.cpp) revisa clientProbeTemplate ANTES que la imagen: si
       llega no-vacío compara tamaños contra el embedding guardado (512) y
       siempre falla con "La plantilla enviada no coincide con el tipo
       biométrico registrado (embedding vs clásico)" -- reproducido en vivo
       2026-08-13 con has_template=1 has_image=1 en el log del backend.
       Mismo problema y misma solución que registerUser() más arriba: enviar
       solo la imagen fuerza siempre el embedding real vía ai_engine. */
    if (!body.face_image_base64) {
        throw new Error('No se capturó imagen facial para validar.')
    }

    if (
        payload.location &&
        Number.isFinite(payload.location.latitude) &&
        Number.isFinite(payload.location.longitude)
    ) {
        body.location = {
            latitude: payload.location.latitude,
            longitude: payload.location.longitude,
            accuracy: payload.location.accuracy,
            captured_at: payload.location.capturedAt,
        }
    }

    log.info('[AUTH_FACE] loginWithFace request', {
        company,
        identity_login: identity,
        has_template: Boolean(body.face_template),
        template_dim: Array.isArray(body.face_template) ? body.face_template.length : 0,
        has_image_base64: Boolean(body.face_image_base64),
        image_base64_len: typeof body.face_image_base64 === 'string' ? body.face_image_base64.length : 0,
        has_location: Boolean(body.location),
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
