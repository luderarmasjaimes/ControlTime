import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('react-konva', () => ({
    Layer: () => null,
    Rect: () => null,
    Stage: () => null,
    Text: () => null,
    Transformer: () => null,
}))
vi.mock('react-konva-utils', () => ({ Html: () => null }))
vi.mock('react-plotly.js', () => ({ default: () => null }))
vi.mock('echarts-for-react', () => ({ default: () => null }))

import { DashboardApp } from './App'
import { I18nProvider } from './i18n/I18nProvider'

const session = {
    userId: '8e31cc46-846a-4d76-a835-df9726a9c003',
    username: 'luder',
    fullName: 'LUDER armas',
    company: 'Alpayana',
    tenantId: 'tenant-1',
    role: 'operator',
    loginType: 'user',
    token: 'access-token',
    loggedAt: new Date().toISOString(),
    // PNG 1×1 válido; basta para probar el contrato de interacción del visor.
    avatarCartoonBase64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=',
}

describe('visor de avatar del dashboard', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', class {
            observe() {}
            unobserve() {}
            disconnect() {}
        })
        vi.stubGlobal('fetch', vi.fn(async (input) => {
            const url = String(input)
            if (url.includes('/api/auth/avatar/hd')) {
                return {
                    ok: true,
                    status: 200,
                    blob: async () => new Blob(['png'], { type: 'image/png' }),
                }
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ tenants: [] }),
            }
        }))
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: vi.fn(() => 'blob:avatar-hd'),
            revokeObjectURL: vi.fn(),
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('abre con doble clic, conserva el modal al pulsar la imagen y cierra fuera', async () => {
        const { container, unmount } = render(
            <I18nProvider>
                <DashboardApp session={session} onLogout={() => {}} />
            </I18nProvider>
        )
        const avatarButton = screen.getByRole('button', { name: 'Ampliar avatar' })

        fireEvent.doubleClick(avatarButton)
        expect(await screen.findByRole('dialog', { name: 'LUDER armas' })).toBeInTheDocument()

        fireEvent.mouseDown(screen.getByAltText('Avatar ampliado de LUDER armas'))
        expect(screen.getByRole('dialog', { name: 'LUDER armas' })).toBeInTheDocument()

        const overlay = container.querySelector('.avatar-preview-overlay')
        expect(overlay).not.toBeNull()
        fireEvent.mouseDown(overlay)
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'LUDER armas' })).not.toBeInTheDocument()
        })
        unmount()
    })
})
