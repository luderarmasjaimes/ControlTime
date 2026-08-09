const SESSION_KEY = 'mining_auth_session_v1'

export interface Session {
    userId: string
    username: string
    fullName: string
    company: string
    tenantId: string
    role: string
    loginType: string
    /**
     * ADR-082 (auditoría de seguridad 2026-08-02): SIEMPRE cadena vacía.
     *
     * El access token ya no se guarda aquí ni en ningún sitio accesible por JS
     * — vive en la cookie HttpOnly `access_token` que emite el backend. Se
     * conserva el campo, vacío, porque hay ~15 puntos del código que hacen
     * `session?.token ? { Authorization: ... } : {}`: con la cadena vacía esos
     * puntos simplemente no añaden el header y la petición se autentica por
     * cookie, sin necesidad de tocarlos uno a uno.
     *
     * Antes se persistía el JWT en localStorage, así que cualquier XSS en la
     * SPA podía leerlo y mandárselo a un servidor externo, convirtiendo un
     * fallo puntual de sanitización en una toma de cuenta que sobrevivía al
     * cierre de la pestaña.
     *
     * @deprecated No leer. Se eliminará cuando no queden consumidores.
     */
    token: string
    /** ISO 8601 — vencimiento estimado del access token (claim `exp` del JWT). */
    accessTokenExpiresAt?: string
    loggedAt: string
    avatarCartoonBase64?: string
}

interface SessionUser {
    id: string
    username: string
    full_name?: string
    fullName?: string
    company: string
    tenant_id?: string
    tenantId?: string
    role?: string
    /** ADR-029 (revisado): nombres actuales devueltos por el backend. */
    access_token?: string
    expires_in?: number
    /** Legado: algunos flujos antiguos aún podrían enviar `token` plano. */
    token?: string
    avatar_cartoon_base64?: string
    avatarCartoonBase64?: string
}

/**
 * ADR-029, "Actualización 2026-07-19": lee una cookie por nombre desde
 * `document.cookie`. Solo sirve para cookies NO HttpOnly (p.ej. `csrf_token_v2`)
 * -- una cookie HttpOnly como `refresh_token` es invisible para JS a
 * propósito y nunca aparecerá acá, lo cual es el objetivo del fix.
 */
export function readCookie(name: string): string {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : ''
}

export function getSession(): Session | null {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) {
        return null
    }

    try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed.username === 'string' ? parsed : null
    } catch {
        return null
    }
}

export function clearSession(): void {
    localStorage.removeItem(SESSION_KEY)
}

function computeExpiresAt(expiresInSeconds?: number): string | undefined {
    if (!Number.isFinite(expiresInSeconds) || !expiresInSeconds || expiresInSeconds <= 0) {
        return undefined
    }
    return new Date(Date.now() + expiresInSeconds * 1000).toISOString()
}

/**
 * Cabeceras de autenticación para cualquier petición a la API.
 *
 * ADR-082: la credencial va en la cookie HttpOnly `access_token`, que el
 * navegador adjunta sola en peticiones al mismo origen. Lo que este helper
 * añade es el token CSRF del patrón double-submit: la cookie `csrf_token_v2`
 * SÍ es legible por JS a propósito, y repetir su valor en `X-CSRF-Token`
 * demuestra que la petición viene de código del propio origen. Un sitio de
 * terceros puede conseguir que el navegador mande la cookie, pero no puede
 * leerla para reproducir el header.
 *
 * Se envía también en GET (donde el backend no lo exige) para no obligar a
 * cada punto de llamada a saber si su método muta estado o no.
 */
export function authHeaders(): Record<string, string> {
    const csrf = readCookie('csrf_token_v2')
    return csrf ? { 'X-CSRF-Token': csrf } : {}
}

export function createSession(user: SessionUser, loginType = 'user'): Session {
    const role = typeof user.role === 'string' ? user.role.toLowerCase() : 'operator'
    // ADR-082: el access_token que devuelve el backend NO se persiste — ya
    // llegó como cookie HttpOnly en la misma respuesta. Se ignora aquí a
    // propósito para que no acabe en localStorage por accidente.
    const accessToken = ''
    const session: Session = {
        userId: user.id,
        username: user.username,
        fullName: user.full_name || user.fullName || '',
        company: user.company,
        tenantId: typeof user.tenant_id === 'string' ? user.tenant_id : typeof user.tenantId === 'string' ? user.tenantId : '',
        role,
        loginType: loginType, // 'user' or 'company'
        token: accessToken,
        accessTokenExpiresAt: computeExpiresAt(user.expires_in),
        loggedAt: new Date().toISOString(),
    }
    const avRaw = user.avatar_cartoon_base64 ?? user.avatarCartoonBase64
    if (typeof avRaw === 'string') {
        const av = avRaw.replace(/\s/g, '').trim()
        if (av.length > 0) {
            session.avatarCartoonBase64 = av
        }
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return session
}

/**
 * @brief Reemplaza el access token tras un refresh exitoso, preservando el
 * resto de la sesión. ADR-029, "Actualización 2026-07-19": ya no recibe
 * `refreshToken` -- ese token vive únicamente en la cookie HttpOnly que pone
 * el backend (invisible para este código, a propósito).
 */
export function updateSessionTokens(_accessToken: string, expiresInSeconds?: number): Session | null {
    const session = getSession()
    if (!session) {
        return null
    }
    // ADR-082: solo se refresca el vencimiento (lo usa
    // `isAccessTokenExpiringSoon` para renovar de forma preventiva). El token
    // en sí lo renovó el backend en la cookie HttpOnly de esta misma respuesta;
    // guardarlo aquí reintroduciría justo el problema que el ADR elimina.
    session.token = ''
    session.accessTokenExpiresAt = computeExpiresAt(expiresInSeconds)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return session
}

/** @brief true si el access token ya venció o vence en menos de `marginSeconds` (refrescar preventivamente). */
export function isAccessTokenExpiringSoon(marginSeconds = 20): boolean {
    const session = getSession()
    if (!session?.accessTokenExpiresAt) {
        return false
    }
    const expiresAtMs = Date.parse(session.accessTokenExpiresAt)
    if (!Number.isFinite(expiresAtMs)) {
        return false
    }
    return Date.now() >= expiresAtMs - marginSeconds * 1000
}
