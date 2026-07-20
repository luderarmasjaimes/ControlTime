const SESSION_KEY = 'mining_auth_session_v1'

export interface Session {
    userId: string
    username: string
    fullName: string
    company: string
    tenantId: string
    role: string
    loginType: string
    /** Access token JWT de vida corta (ADR-029 revisado). Se renueva vía POST /api/auth/refresh sin repetir login. */
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
 * `document.cookie`. Solo sirve para cookies NO HttpOnly (p.ej. `csrf_token`)
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

export function createSession(user: SessionUser, loginType = 'user'): Session {
    const role = typeof user.role === 'string' ? user.role.toLowerCase() : 'operator'
    const accessToken = typeof user.access_token === 'string' ? user.access_token : (typeof user.token === 'string' ? user.token : '')
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
export function updateSessionTokens(accessToken: string, expiresInSeconds?: number): Session | null {
    const session = getSession()
    if (!session) {
        return null
    }
    session.token = accessToken
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
