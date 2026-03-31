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
        let message = payload.error || `Error HTTP ${response.status}`
        if (Array.isArray(payload.issues) && payload.issues.length > 0) {
            const translations = {
                'suspected_glasses': 'Lentes detectados (Retirar lentes)',
                'suspected_hat': 'Gorra o casco detectado (Retirar accesorio)',
                'suspected_face_accessory': 'Accesorio/Mascarilla cubriendo rostro',
                'suspected_heavy_makeup': 'Maquillaje excesivo detectado',
                'eyes_not_open_or_not_visible': 'Los ojos deben estar abiertos y visibles',
                'mouth_not_closed': 'Mantener la boca cerrada',
                'face_not_frontal': 'Debe mirar fijamente de frente al lente',
                'head_pose_not_straight': 'La cabeza debe estar recta',
                'face_too_small': 'Acérquese más a la cámara',
                'face_off_center': 'Rostro descentrado',
                'lighting_out_of_range': 'Mejore la iluminación del ambiente',
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

    if (payload.faceImageBase64) {
        body.face_image_base64 = payload.faceImageBase64
    } else {
        body.face_template = payload.faceTemplate
    }

    return postJson('/api/auth/register', {
        ...body,
    })
}

export async function loginWithPassword(payload) {
    return postJson('/api/auth/login/password', {
        company: payload.company,
        username: payload.username,
        password: payload.password,
    })
}

export async function loginWithFace(payload) {
    const body = {
        company: payload.company,
        threshold: 0.89,
    }

    if (payload.imageBase64) {
        body.face_image_base64 = payload.imageBase64
    } else {
        body.face_template = payload.template
    }

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
    return postJson('/api/auth/biometric/verify-frame', {
        face_image_base64: imageBase64,
    })
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
