const SESSION_KEY = 'mining_auth_session_v1'

/**
 * Migración a Bearer-en-memoria (2026-08-27): el access token vuelve a viajar
 * también como `Authorization: Bearer` en cada petición (además de la cookie
 * HttpOnly de compatibilidad), guardado ÚNICAMENTE en esta variable de
 * módulo -- nunca en `localStorage`, nunca en `sessionStorage`, nunca en el
 * objeto `Session` persistido (ver `Session.token`, que se mantiene SIEMPRE
 * en '""' a propósito, igual que antes de este cambio).
 *
 * Por qué se reintroduce Bearer si ADR-082 lo había eliminado por el riesgo
 * de robo vía XSS: se detectó en pruebas reales que dos frontends distintos
 * corriendo en el mismo host (aunque en puertos distintos -- p. ej. esta
 * plataforma y otra app de un equipo/proveedor distinto probándose en la
 * misma laptop) SE PISAN la cookie de sesión, porque las cookies HTTP se
 * comparten por dominio, no por puerto (RFC 6265). Un login en la otra app
 * deja a esta plataforma autenticada silenciosamente como la sesión de la
 * otra app. Bearer-en-memoria es inmune a eso: cada pestaña/aplicación
 * mantiene su propio token en su propio contexto de JS, sin depender de un
 * cajón de cookies compartido por host.
 *
 * Mitigación del riesgo que esto reabre (XSS podría leer esta variable
 * mientras la página sigue cargada -- nunca podría antes, con el token solo
 * en cookie HttpOnly): el TTL del access token bajó de 60 a 15 min
 * (`BEEMETRY_JWT_ACCESS_TTL_MINUTES`), el refresh token de larga vida (7
 * días) SIGUE siendo exclusivamente una cookie HttpOnly namespaced
 * (`beemetry_refresh_token`) -- nunca se expone por Bearer, así que un XSS
 * que robe el access token de memoria solo gana una ventana de ~15 min, no
 * la sesión completa. Ver ADR de esta migración.
 */
let inMemoryAccessToken = ''

/** @brief Token de acceso actual en memoria (o cadena vacía si no hay uno). Nunca perzistido. */
export function getInMemoryAccessToken(): string {
    return inMemoryAccessToken
}

/** @brief Reemplaza el token de acceso en memoria (tras login/registro/refresh/switch-tenant exitoso). */
export function setInMemoryAccessToken(token: string): void {
    inMemoryAccessToken = typeof token === 'string' ? token : ''
}

/** @brief Limpia el token de acceso en memoria (logout, o refresh fallido). */
export function clearInMemoryAccessToken(): void {
    inMemoryAccessToken = ''
}

export interface Session {
    userId: string
    username: string
    fullName: string
    company: string
    tenantId: string
    role: string
    /**
     * Departamento del usuario (soporte técnico, comercial, etc.) tal como lo
     * devuelve el backend en `user.department` -- solo lo traen los usuarios
     * "department-scoped" del panel admin de soporte (ver
     * SupportAdminView.tsx / ADR del chatbot de soporte). `null`/ausente para
     * el resto de usuarios, igual que `role`.
     */
    department?: string | null
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
    department?: string | null
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
    clearInMemoryAccessToken()
    // Hallazgo real, sesión 2026-09-09: AvatarWidget.tsx guarda "welcome ya
    // se disparó" en una variable de módulo (para sobrevivir remontes,
    // ver su propio comentario) y en sessionStorage -- ninguno de los dos
    // se limpiaba al cerrar sesión, así que un logout + login DENTRO de la
    // misma pestaña nunca volvía a mostrar el avatar de bienvenida
    // ("hice login nuevo pero no veo ni escucho nada", sin ningún error).
    // Evento en vez de importar AvatarWidget.tsx acá directo -- ese
    // componente ya importa de este archivo, un import inverso crearía un
    // ciclo. AvatarWidget escucha este mismo evento también en
    // `createSession()` más abajo (login real), no solo acá.
    window.dispatchEvent(new CustomEvent('beemetry-auth-session-cleared'))
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
 * Migración a Bearer-en-memoria: la credencial primaria vuelve a ser el
 * header `Authorization: Bearer <token>` (token guardado SOLO en la variable
 * de módulo `inMemoryAccessToken`, ver comentario arriba -- nunca en disco).
 * La cookie HttpOnly `beemetry_access_token` (ADR-082) se sigue enviando por
 * el navegador como respaldo/compatibilidad, pero el backend prioriza
 * siempre el header sobre la cookie.
 *
 * También se agrega el token CSRF del patrón double-submit: la cookie
 * `beemetry_csrf_token` SÍ es legible por JS a propósito, y repetir su valor
 * en `X-CSRF-Token` demuestra que la petición viene de código del propio
 * origen (necesario para /api/auth/refresh y /api/auth/logout, que dependen
 * de la cookie de refresh, no del Bearer).
 *
 * Se envía también en GET (donde el backend no lo exige) para no obligar a
 * cada punto de llamada a saber si su método muta estado o no.
 */
export function authHeaders(): Record<string, string> {
    const csrf = readCookie('beemetry_csrf_token')
    const headers: Record<string, string> = csrf ? { 'X-CSRF-Token': csrf } : {}
    if (inMemoryAccessToken) {
        headers['Authorization'] = `Bearer ${inMemoryAccessToken}`
    }
    return headers
}

export function createSession(user: SessionUser, loginType = 'user'): Session {
    const role = typeof user.role === 'string' ? user.role.toLowerCase() : 'operator'
    // El access_token que devuelve el backend NUNCA se persiste en el objeto
    // `Session` (localStorage) -- se guarda SOLO en la variable de módulo
    // `inMemoryAccessToken` (ver comentario arriba de este archivo), que
    // desaparece al recargar la pestaña. `session.token` se mantiene en ''
    // a propósito, igual que antes de la migración a Bearer-en-memoria.
    const accessToken = ''
    if (typeof user.access_token === 'string' && user.access_token) {
        setInMemoryAccessToken(user.access_token)
    }
    const session: Session = {
        userId: user.id,
        username: user.username,
        fullName: user.full_name || user.fullName || '',
        company: user.company,
        tenantId: typeof user.tenant_id === 'string' ? user.tenant_id : typeof user.tenantId === 'string' ? user.tenantId : '',
        role,
        department: typeof user.department === 'string' && user.department ? user.department : null,
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
    // Ver comentario largo en clearSession() -- mismo evento, disparado acá
    // también: un login real (no solo un logout) debe poder volver a
    // mostrar el avatar de bienvenida aunque ya se hubiera mostrado antes
    // en esta misma pestaña para OTRA cuenta.
    window.dispatchEvent(new CustomEvent('beemetry-auth-session-cleared'))
    return session
}

/**
 * @brief Reemplaza el access token tras un refresh exitoso, preservando el
 * resto de la sesión. El refresh token en sí sigue viviendo únicamente en la
 * cookie HttpOnly que pone el backend (invisible para este código, a
 * propósito) -- lo que cambia con la migración a Bearer-en-memoria es que el
 * `accessToken` nuevo (recibido en el body de /api/auth/refresh) SÍ se
 * guarda ahora, pero solo en la variable de módulo `inMemoryAccessToken`,
 * nunca en `localStorage`.
 */
export function updateSessionTokens(accessToken: string, expiresInSeconds?: number): Session | null {
    const session = getSession()
    if (!session) {
        return null
    }
    if (typeof accessToken === 'string' && accessToken) {
        setInMemoryAccessToken(accessToken)
    }
    // `session.token` (el campo persistido) se mantiene SIEMPRE en '' -- solo
    // se cachea el vencimiento (lo usa `isAccessTokenExpiringSoon` para
    // renovar de forma preventiva). El valor real del token vive nada más
    // que en memoria, ver `inMemoryAccessToken`.
    session.token = ''
    session.accessTokenExpiresAt = computeExpiresAt(expiresInSeconds)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return session
}

/**
 * @brief Actualiza tenant/empresa/rol activos en la sesión cacheada tras un
 * cambio de unidad minera (POST /api/auth/tenants/switch). Antes de este
 * fix, TenantSwitcher.switchTo() solo llamaba a updateSessionTokens (que
 * únicamente refresca el vencimiento) y luego recargaba la página — el JWT
 * quedaba apuntando al tenant nuevo (correcto en el backend), pero
 * getSession().tenantId/company/role en localStorage se quedaban con los
 * valores del tenant ANTERIOR, así que cualquier código que arme un query
 * param a partir de getSession() (p.ej. telemetryTenantIdFromSession, usada
 * por los bloques de sensores del editor de reportes) seguía pidiendo datos
 * del tenant viejo hasta un logout/login manual.
 *
 * No decodifica el JWT (seguiría siendo el patrón que ADR-082 eliminó si se
 * persistiera el token) — el propio backend ya devuelve tenant_id y role en
 * el body de la respuesta del switch; el nombre de la unidad se toma de la
 * lista que TenantSwitcher ya cargó vía GET /api/auth/tenants.
 */
export function updateSessionTenant(tenantId: string, company: string, role?: string): Session | null {
    const session = getSession()
    if (!session) {
        return null
    }
    session.tenantId = tenantId
    if (company) {
        session.company = company
    }
    if (typeof role === 'string' && role) {
        session.role = role.toLowerCase()
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return session
}

/**
 * @brief Completa la sesión guardada con el avatar que el backend terminó de
 * generar DESPUÉS del registro (hilo asíncrono AUTH_REGISTER_CARTOON_BG).
 *
 * La respuesta de /api/auth/register nunca trae avatar: se genera en 15-40 s
 * en segundo plano para no bloquear el alta. Sin esto, la sesión recién
 * creada se quedaba para siempre sin avatar y el usuario veía el placeholder
 * de iniciales hasta cerrar sesión y volver a entrar (bug real, 2026-09-04).
 */
export function updateSessionAvatar(avatarBase64: string): Session | null {
    const session = getSession()
    if (!session) {
        return null
    }
    const av = String(avatarBase64 || '').replace(/\s/g, '').trim()
    if (!av) {
        return session
    }
    session.avatarCartoonBase64 = av
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
