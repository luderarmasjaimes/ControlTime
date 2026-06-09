const SESSION_KEY = 'mining_auth_session_v1'

export function getSession() {
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

export function clearSession() {
    localStorage.removeItem(SESSION_KEY)
}

export function createSession(user, loginType = 'user') {
    const role = typeof user.role === 'string' ? user.role.toLowerCase() : 'operator'
    const session = {
        userId: user.id,
        username: user.username,
        fullName: user.full_name || user.fullName || '',
        company: user.company,
        tenantId: typeof user.tenant_id === 'string' ? user.tenant_id : typeof user.tenantId === 'string' ? user.tenantId : '',
        role,
        loginType: loginType, // 'user' or 'company'
        token: typeof user.token === 'string' ? user.token : '',
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
