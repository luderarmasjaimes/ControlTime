import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    checkLoginIdentity,
    fetchAuthAudit,
    fetchCompanies,
    fetchMyAvatarHd,
    downloadAuthAuditCsv,
    loginWithFace,
    loginWithPassword,
    registerUser,
} from './authApi'

describe('authApi', () => {
    beforeEach(() => {
        // ADR-082: `authHeaders()` lee la cookie CSRF de document.cookie para
        // el double-submit. Sin sembrarla, las peticiones saldrian sin header.
        // Nombre namespaced desde la migración a Bearer-en-memoria
        // (2026-08-27) -- antes `csrf_token_v2`, ver csrfHeaders() en authApi.ts.
        document.cookie = 'beemetry_csrf_token=csrf_abc; path=/'
    })

    afterEach(() => {
        vi.restoreAllMocks()
        localStorage.clear()
        document.cookie = 'beemetry_csrf_token=; path=/; max-age=0'
    })

    it('fetches companies from backend', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ companies: ['Minera Raura'] }),
        })

        const companies = await fetchCompanies()

        expect(companies).toEqual(['Minera Raura'])
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const calledUrl = String(fetchMock.mock.calls[0][0])
        expect(calledUrl).toContain('/api/auth/companies')
    })

    it('fetches the authenticated user HD avatar as an image blob', async () => {
        localStorage.setItem(
            'mining_auth_session_v1',
            JSON.stringify({ username: 'luder', token: 'tok_avatar' })
        )
        const expected = new Blob(['png-bytes'], { type: 'image/png' })
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            blob: async () => expected,
        })

        const avatar = await fetchMyAvatarHd()

        expect(avatar).toBe(expected)
        expect(String(fetchMock.mock.calls[0][0])).toContain('/api/auth/avatar/hd')
        // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
        // navegador adjunta sola. Lo que este codigo NO debe hacer nunca mas es
        // montar un Authorization desde algo guardado en localStorage.
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
        expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
    })

    // Corrección de seguridad 2026-08-13 (ver comentario en authApi.ts junto a
    // registerUser): un face_template calculado en el cliente nunca pasó por
    // análisis facial real -- el backend lo marca "unknown_client_supplied" y
    // rechaza cualquier login facial posterior con esa cuenta. registerUser()
    // deja de enviarlo deliberadamente, aunque la firma lo siga aceptando por
    // compatibilidad con otros llamadores (p.ej. el óvalo en pantalla).
    it('nunca envía face_template, aunque se provea una plantilla clásica', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'registered', user: { id: 'u1' } }),
        })

        await registerUser({
            company: 'Minera Raura',
            firstName: 'Luder',
            lastName: 'Armas',
            dni: '12345678',
            username: 'luder',
            password: 'secret123',
            faceTemplate: [0.11, 0.22, 0.33],
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, options] = fetchMock.mock.calls[0]
        expect(String(url)).toContain('/api/auth/register')
        const payload = JSON.parse(options.body)
        expect(payload).toMatchObject({
            company: 'Minera Raura',
            first_name: 'Luder',
            last_name: 'Armas',
            dni: '12345678',
            username: 'luder',
            password: 'secret123',
        })
        expect(payload.face_template).toBeUndefined()
        expect(payload.face_image_base64).toBeUndefined()
    })

    it('envía solo face_image_base64 cuando se proveen plantilla clásica e imagen juntas', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'registered', user: { id: 'u1' } }),
        })

        await registerUser({
            company: 'Minera Raura',
            firstName: 'Luder',
            lastName: 'Armas',
            dni: '12345678',
            username: 'luder',
            password: 'secret123',
            faceTemplate: [0.11, 0.22, 0.33],
            faceImageBase64: 'BASE64JPEG==',
        })

        const [, options] = fetchMock.mock.calls[0]
        const payload = JSON.parse(options.body)
        expect(payload.face_template).toBeUndefined()
        expect(payload.face_image_base64).toBe('BASE64JPEG==')
    })

    it('sends registration payload with biometric image', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'registered', user: { id: 'u1' } }),
        })

        await registerUser({
            company: 'Minera Raura',
            firstName: 'Luder',
            lastName: 'Armas',
            dni: '12345678',
            username: 'luder',
            password: 'secret123',
            faceImageBase64: 'BASE64JPEG==',
        })

        const [, options] = fetchMock.mock.calls[0]
        const payload = JSON.parse(options.body)
        expect(payload.face_image_base64).toBe('BASE64JPEG==')
        expect(payload.face_template).toBeUndefined()
        expect(payload.capture_conditions).toBeUndefined()
    })

    it('sends face_portrait_oval_base64 when provided', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'registered', user: { id: 'u1' } }),
        })

        await registerUser({
            company: 'Minera Raura',
            firstName: 'Luder',
            lastName: 'Armas',
            dni: '12345678',
            username: 'luder',
            password: 'secret123',
            faceImageBase64: 'BASE64JPEG==',
            facePortraitOvalBase64: 'OVAlCROP==',
        })

        const [, options] = fetchMock.mock.calls[0]
        const payload = JSON.parse(options.body)
        expect(payload.face_portrait_oval_base64).toBe('OVAlCROP==')
    })

    it('sends face_bust_rect_base64 when provided', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'registered', user: { id: 'u1' } }),
        })

        await registerUser({
            company: 'Minera Raura',
            firstName: 'Luder',
            lastName: 'Armas',
            dni: '12345678',
            username: 'luder',
            password: 'secret123',
            faceImageBase64: 'BASE64JPEG==',
            faceBustRectBase64: 'BUSTRECT==',
        })

        const [, options] = fetchMock.mock.calls[0]
        const payload = JSON.parse(options.body)
        expect(payload.face_bust_rect_base64).toBe('BUSTRECT==')
    })

    it('checkLoginIdentity POSTs JSON and returns ok when user exists', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, username: 'op_raura' }),
        })

        const r = await checkLoginIdentity('Minera Raura', '12345678904')

        expect(r.ok).toBe(true)
        expect(r.username).toBe('op_raura')
        const [url, opts] = fetchMock.mock.calls[0]
        expect(String(url)).toContain('/api/auth/login/check-identity')
        expect(opts.method).toBe('POST')
        expect(opts.headers['Content-Type']).toBe('application/json')
        expect(JSON.parse(opts.body)).toEqual({
            company: 'Minera Raura',
            identity: '12345678904',
        })
    })

    it('checkLoginIdentity falls back to GET when POST returns 404', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: async () => ({}),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ ok: true, username: 'u1' }),
            })

        const r = await checkLoginIdentity('Minera Raura', '111')
        expect(r.ok).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(String(fetchMock.mock.calls[1][0])).toContain('company=Minera+Raura')
        expect(String(fetchMock.mock.calls[1][0])).toContain('identity=111')
    })

    it('checkLoginIdentity returns ok false without throwing on not_found', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                ok: false,
                reason: 'not_found',
                error: 'USUARIO NO EXISTE',
            }),
        })

        const r = await checkLoginIdentity('Minera Raura', '99999999')
        expect(r.ok).toBe(false)
        expect(r.reason).toBe('not_found')
        expect(r.error).toContain('USUARIO')
    })

    it('sends password login request', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'authenticated', method: 'password' }),
        })

        await loginWithPassword({
            company: 'Minera Raura',
            username: 'luder',
            password: 'secret123',
        })

        const [url, options] = fetchMock.mock.calls[0]
        expect(String(url)).toContain('/api/auth/login/password')
        expect(JSON.parse(options.body)).toEqual({
            company: 'Minera Raura',
            username: 'luder',
            password: 'secret123',
        })
    })

    // Corrección de seguridad 2026-08-13 (ver comentario en authApi.ts junto a
    // loginWithFace): la plantilla "clásica" del cliente tiene otra dimensión
    // que el embedding InsightFace real guardado en el registro -- con
    // BEEMETRY_BIOMETRIC_PROVIDER=legacy, mandarla SIEMPRE hacía fallar el
    // login con "La plantilla enviada no coincide con el tipo biométrico
    // registrado" (reproducido en vivo). loginWithFace() ahora exige imagen y
    // rechaza explícitamente un login solo-con-plantilla antes de llamar a la red.
    it('rechaza un login facial que solo trae plantilla clásica, sin imagen', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')

        await expect(
            loginWithFace({
                company: 'Minera Raura',
                identityLogin: 'jdoe',
                template: [0.1, 0.2],
            })
        ).rejects.toThrow('No se capturó imagen facial para validar.')

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends face login image payload when provided', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'authenticated', method: 'face', score: 0.94 }),
        })

        await loginWithFace({
            company: 'Minera Raura',
            username: '9637521',
            imageBase64: 'BASE64JPEG==',
        })

        const [, options] = fetchMock.mock.calls[0]
        expect(JSON.parse(options.body)).toEqual({
            company: 'Minera Raura',
            face_image_base64: 'BASE64JPEG==',
            identity_login: '9637521',
            username: '9637521',
        })
    })

    it('sends audit filters in query params', async () => {
        localStorage.setItem(
            'mining_auth_session_v1',
            JSON.stringify({ username: 'admin_user', token: 'tok_123' })
        )

        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ logs: [], count: 0 }),
        })

        await fetchAuthAudit({
            page: 2,
            pageSize: 25,
            company: 'Minera Raura',
            username: 'luder',
            action: 'login_face',
            success: true,
        })

        const calledUrl = String(fetchMock.mock.calls[0][0])
        expect(calledUrl).toContain('/api/auth/audit?')
        expect(calledUrl).toContain('page=2')
        expect(calledUrl).toContain('page_size=25')
        expect(calledUrl).toContain('company=Minera+Raura')
        expect(calledUrl).toContain('username=luder')
        expect(calledUrl).toContain('action=login_face')
        expect(calledUrl).toContain('success=true')
        // ADR-082: sin Authorization; la cookie viaja sola y el JS solo aporta
        // el token CSRF del double-submit.
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
        expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
        expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBe('csrf_abc')
    })

    it('exports CSV with filters, authenticating by header and never by URL', async () => {
        localStorage.setItem(
            'mining_auth_session_v1',
            JSON.stringify({ username: 'admin_user', token: 'tok_123' })
        )
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            blob: async () => new Blob(['a,b\n1,2'], { type: 'text/csv' }),
        })
        // jsdom no implementa la Object URL API: se inyectan stubs (vi.stubGlobal
        // no aplica a métodos de URL, así que se asignan y se restauran a mano).
        URL.createObjectURL = vi.fn(() => 'blob:fake')
        URL.revokeObjectURL = vi.fn()

        await downloadAuthAuditCsv({
            company: 'Minera Raura',
            username: 'luder',
            action: 'login_password',
            success: false,
        })

        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toContain('/api/auth/audit/export.csv?')
        expect(url).toContain('company=Minera+Raura')
        expect(url).toContain('username=luder')
        expect(url).toContain('action=login_password')
        expect(url).toContain('success=false')
        // ADR-082: la credencial nunca viaja en la URL (quedaria en el access
        // log de nginx, el historial y el Referer) NI en un header que el JS
        // pueda construir — va en la cookie HttpOnly.
        expect(url).not.toContain('auth_token')
        expect(url).not.toContain('tok_123')
        expect(init.headers.Authorization).toBeUndefined()
        expect(init.credentials).toBe('include')
    })
})
