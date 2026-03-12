import { getSession } from './authStorage'

function backendBaseUrl() {
    if (import.meta.env.VITE_BACKEND_URL) {
        return import.meta.env.VITE_BACKEND_URL
    }

    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:8081`
}

async function parseJsonResponse(response) {
    let payload = {}
    try {
        payload = await response.json()
    } catch {
        payload = {}
    }

    if (!response.ok) {
        const message = payload.error || `Error HTTP ${response.status}`
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
