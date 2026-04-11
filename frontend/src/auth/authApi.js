import { getSession } from './authStorage'

function backendBaseUrl() {
    const env = import.meta.env.VITE_BACKEND_URL
    if (env) {
        return String(env).replace(/\/$/, '')
    }
    // Mismo origen: Vite (dev) y Nginx (Docker) proxifican /api -> backend (p. ej. :8082 en el host).
    // Antes se usaba :8081 y el login fallaba con "Failed to fetch".
    return ''
}

async function parseJsonResponse(response) {
    let payload = {}
    try {
        payload = await response.json()
    } catch {
        payload = {}
    }

    if (!response.ok) {
        console.error('[AUTH_API] HTTP error', {
            status: response.status,
            statusText: response.statusText,
            payload,
        })
        let message = payload.error || `Error HTTP ${response.status}`
        if (Array.isArray(payload.issues) && payload.issues.length > 0) {
            const translations = {
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
            const translatedIssues = payload.issues.map(issue => translations[issue] || issue);
            message = `Validación Biométrica Fallida: ${translatedIssues.join(' | ')}`
        }
        throw new Error(message)
    }

    return payload
}

async function postJson(path, body) {
    const response = await fetch(`${backendBaseUrl()}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    })

    return parseJsonResponse(response)
}

function authHeaders() {
    const session = getSession()
    if (session?.token) {
        return {
            Authorization: `Bearer ${session.token}`,
        }
    }
    return {}
}

export async function fetchCompanies() {
    const response = await fetch(`${backendBaseUrl()}/api/auth/companies`)
    const payload = await parseJsonResponse(response)
    return Array.isArray(payload.companies) ? payload.companies : []
}

export async function registerUser(payload) {
    const body = {
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
    const out = await postJson('/api/auth/register', {
        ...body,
    })
    if (t0 && typeof performance !== 'undefined') {
        const ms = Math.round(performance.now() - t0)
        console.info('[AUTH_API] /api/auth/register OK', {
            ms,
            sent_template: Boolean(body.face_template),
            sent_image: Boolean(body.face_image_base64),
        })
    }
    return out
}

export async function loginWithPassword(payload) {
    return postJson('/api/auth/login/password', {
        company: payload.company,
        username: payload.username,
        password: payload.password,
    })
}

const MSG_USUARIO_NO_EXISTE = 'USUARIO NO EXISTE'

/**
 * Comprueba si existe un usuario (Usuario, DNI o RUC) en la empresa antes de abrir la cámara.
 * Usa POST (JSON) para evitar proxies que alteran el query string; si el backend solo tiene GET, reintenta por GET.
 * Solo si payload.ok === true se debe abrir la sesión facial.
 */
export async function checkLoginIdentity(company, identity) {
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
    let payload = {}
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
        console.info('[AUTH_API] checkLoginIdentity', {
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

export async function loginWithFace(payload) {
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
    const body = {
        company,
        identity_login: identity,
        username: identity,
    }

    if (payload.imageBase64) {
        body.face_image_base64 = payload.imageBase64
    } else if (payload.template) {
        body.face_template = payload.template
    } else {
        throw new Error('No se capturó imagen o plantilla facial para validar.')
    }

    console.info('[AUTH_FACE] loginWithFace request', {
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

export async function fetchAuthAudit({ page = 1, pageSize = 50, company, username, action, success } = {}) {
    const query = new URLSearchParams()
    query.set('page_size', String(pageSize))
    query.set('page', String(page))
    if (company) query.set('company', company)
    if (username) query.set('username', username)
    if (action) query.set('action', action)
    if (typeof success === 'boolean') query.set('success', success ? 'true' : 'false')

    const response = await fetch(`${backendBaseUrl()}/api/auth/audit?${query.toString()}`, {
        headers: {
            ...authHeaders(),
        },
    })
    return parseJsonResponse(response)
}

export function getAuthAuditCsvUrl({ company, username, action, success } = {}) {
    const query = new URLSearchParams()
    if (company) query.set('company', company)
    if (username) query.set('username', username)
    if (action) query.set('action', action)
    if (typeof success === 'boolean') query.set('success', success ? 'true' : 'false')
    const token = getSession()?.token
    if (token) {
        query.set('auth_token', token)
    }
    return `${backendBaseUrl()}/api/auth/audit/export.csv?${query.toString()}`
}
export async function verifyBiometricFrame(imageBase64) {
    const response = await fetch(`${backendBaseUrl()}/api/auth/biometric/verify-frame`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
        },
        body: JSON.stringify({ face_image_base64: imageBase64 }),
    })
    return parseJsonResponse(response)
}

export async function processBiometricFrame(imageBase64) {
    const raw = atob(imageBase64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) {
        bytes[i] = raw.charCodeAt(i)
    }
    const response = await fetch(`${backendBaseUrl()}/api/process_frame`, {
        method: 'POST',
        headers: {
            ...authHeaders(),
            'Content-Type': 'image/jpeg',
        },
        body: bytes,
    })
    return parseJsonResponse(response)
}

export async function fetchBiometricStatus() {
    const response = await fetch(`${backendBaseUrl()}/api/status`, {
        headers: {
            ...authHeaders(),
        },
    })
    return parseJsonResponse(response)
}

export async function resetBiometricCapture() {
    const response = await fetch(`${backendBaseUrl()}/api/reset_capture`, {
        headers: {
            ...authHeaders(),
        },
    })
    return parseJsonResponse(response)
}

export async function fetchCompanyUsers(company) {
    const query = new URLSearchParams()
    if (company) query.set('company', company)

    const response = await fetch(`${backendBaseUrl()}/api/auth/users?${query.toString()}`, {
        headers: {
            ...authHeaders(),
        },
    })

    return parseJsonResponse(response)
}

export async function executeUserMaintenance(payload) {
    return postJson('/api/auth/users/maintenance', {
        ...payload,
    })
}

export async function fetchUserMaintenanceAudit({ company, page = 1, pageSize = 20 } = {}) {
    const query = new URLSearchParams()
    query.set('page', String(page))
    query.set('page_size', String(pageSize))
    if (company) query.set('company', company)

    const response = await fetch(`${backendBaseUrl()}/api/auth/users/maintenance/audit?${query.toString()}`, {
        headers: {
            ...authHeaders(),
        },
    })

    return parseJsonResponse(response)
}

export async function validateCompany(company, ruc) {
    const query = new URLSearchParams()
    if (company) query.set('company', company)
    if (ruc) query.set('ruc', ruc)

    const response = await fetch(`${backendBaseUrl()}/api/auth/validate-company?${query.toString()}`)
    const payload = await parseJsonResponse(response)
    return payload.valid === true
}
