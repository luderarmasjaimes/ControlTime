import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    fetchAuthAudit,
    fetchCompanies,
    getAuthAuditCsvUrl,
    loginWithFace,
    loginWithPassword,
    registerUser,
} from './authApi'

describe('authApi', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        localStorage.clear()
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

    it('sends registration payload with biometric template', async () => {
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
        expect(payload.face_template).toEqual([0.11, 0.22, 0.33])
        expect(payload.face_image_base64).toBeUndefined()
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

    it('sends face login request with threshold', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'authenticated', method: 'face', score: 0.94 }),
        })

        await loginWithFace({ company: 'Minera Raura', template: [0.1, 0.2] })

        const [url, options] = fetchMock.mock.calls[0]
        expect(String(url)).toContain('/api/auth/login/face')
        expect(JSON.parse(options.body)).toEqual({
            company: 'Minera Raura',
            face_template: [0.1, 0.2],
            threshold: 0.89,
        })
    })

    it('sends face login image payload when provided', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'authenticated', method: 'face', score: 0.94 }),
        })

        await loginWithFace({ company: 'Minera Raura', imageBase64: 'BASE64JPEG==' })

        const [, options] = fetchMock.mock.calls[0]
        expect(JSON.parse(options.body)).toEqual({
            company: 'Minera Raura',
            face_image_base64: 'BASE64JPEG==',
            threshold: 0.89,
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
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            headers: {
                Authorization: 'Bearer tok_123',
            },
        })
    })

    it('builds CSV export URL with filters', () => {
        localStorage.setItem(
            'mining_auth_session_v1',
            JSON.stringify({ username: 'admin_user', token: 'tok_123' })
        )

        const url = getAuthAuditCsvUrl({
            company: 'Minera Raura',
            username: 'luder',
            action: 'login_password',
            success: false,
        })

        expect(url).toContain('/api/auth/audit/export.csv?')
        expect(url).toContain('company=Minera+Raura')
        expect(url).toContain('username=luder')
        expect(url).toContain('action=login_password')
        expect(url).toContain('success=false')
        expect(url).toContain('auth_token=tok_123')
    })
})
