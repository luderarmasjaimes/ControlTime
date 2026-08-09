import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PlatformRegionBar from '../components/Platform/PlatformRegionBar'
import { I18nProvider, languageForCountry, translate } from './I18nProvider'
import { formatInternationalTel, phonePrefixForCountry } from '../auth/platformPrefs'
import { ConfirmActionHost, requestConfirmation } from '../components/UI/ConfirmActionDialog'

describe('i18n de país e idioma', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.stubGlobal('fetch', vi.fn(async (input) => {
            const url = String(input)
            return {
                ok: true,
                json: async () => url.includes('ui-languages')
                    ? { languages: [
                        { code: 'es', label_native: 'Español' },
                        { code: 'en', label_native: 'English' },
                        { code: 'fr', label_native: 'Français' },
                        { code: 'pt', label_native: 'Português' },
                    ] }
                    : { countries: [
                        { iso2: 'PE', label: 'Perú', phone_prefix: '51', default_locale: 'es-PE' },
                        { iso2: 'BR', label: 'Brasil', phone_prefix: '55', default_locale: 'pt-BR' },
                        { iso2: 'CA', label: 'Canadá', phone_prefix: '1', default_locale: 'fr-CA' },
                        { iso2: 'US', label: 'Estados Unidos', phone_prefix: '1', default_locale: 'en-US' },
                    ] },
            }
        }))
    })

    it('mapea los cuatro países solicitados a su idioma predeterminado', () => {
        expect(languageForCountry('PE')).toBe('es')
        expect(languageForCountry('BR')).toBe('pt')
        expect(languageForCountry('CA')).toBe('fr')
        expect(languageForCountry('US')).toBe('en')
    })

    it('dispone de traducciones operativas en los cuatro idiomas', () => {
        expect(translate('es', 'auth.secureAccess')).toBe('Acceso seguro')
        expect(translate('en', 'auth.secureAccess')).toBe('Secure access')
        expect(translate('fr', 'auth.secureAccess')).toBe('Accès sécurisé')
        expect(translate('pt', 'auth.secureAccess')).toBe('Acesso seguro')
    })

    it('cambiar Brasil selecciona portugués, persiste y actualiza lang', async () => {
        render(
            <I18nProvider>
                <PlatformRegionBar />
            </I18nProvider>
        )
        const selects = await screen.findAllByRole('combobox')
        fireEvent.change(selects[0], { target: { value: 'BR' } })
        await waitFor(() => {
            expect(selects[1]).toHaveValue('pt')
            expect(document.documentElement.lang).toBe('pt-BR')
        })
        expect(JSON.parse(localStorage.getItem('mining_platform_prefs_v1') || '{}')).toEqual({
            countryIso2: 'BR',
            languageCode: 'pt',
        })
    })

    it('normaliza teléfonos por país sin duplicar un prefijo explícito', () => {
        expect(phonePrefixForCountry('BR', undefined)).toBe('55')
        expect(formatInternationalTel('11987654321', '55')).toBe('+5511987654321')
        expect(formatInternationalTel('+1 416 555 0100', '55')).toBe('+14165550100')
    })

    it('reemplaza confirmaciones nativas por un diálogo accesible traducido', async () => {
        render(
            <I18nProvider>
                <ConfirmActionHost />
            </I18nProvider>
        )
        let answer!: Promise<boolean>
        act(() => {
            answer = requestConfirmation('¿Continuar con la acción?')
        })
        expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await expect(answer).resolves.toBe(true)
    })
})
