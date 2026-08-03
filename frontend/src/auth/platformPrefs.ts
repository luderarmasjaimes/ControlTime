const PLATFORM_PREFS_KEY = 'mining_platform_prefs_v1'

export interface PlatformPrefs {
    countryIso2: string;
    languageCode: string;
}

function defaultPrefs(): PlatformPrefs {
    return {
        countryIso2: 'PE',
        languageCode: 'es',
    }
}

const ALLOWED_LANG = new Set(['en', 'es', 'pt', 'fr'])

/** Ajusta `document.documentElement.lang` con región para accesibilidad, voz y correctores. */
export function applyHtmlLang(code: string | undefined, countryIso2?: string): void {
    const c = String(code || 'es').toLowerCase()
    const country = String(countryIso2 || getPlatformPrefs().countryIso2 || 'PE').toUpperCase()
    const defaults: Record<string, string> = { en: 'en-US', es: 'es-PE', pt: 'pt-BR', fr: 'fr-CA' }
    document.documentElement.lang = defaults[c] || `${c}-${country}`
}

export function getPlatformPrefs(): PlatformPrefs {
    try {
        const raw = localStorage.getItem(PLATFORM_PREFS_KEY)
        if (!raw) {
            return defaultPrefs()
        }
        const o = JSON.parse(raw)
        const countryIso2 =
            typeof o.countryIso2 === 'string' && /^[A-Za-z]{2}$/.test(o.countryIso2)
                ? o.countryIso2.toUpperCase()
                : defaultPrefs().countryIso2
        const languageCode = ALLOWED_LANG.has(String(o.languageCode || '').toLowerCase())
            ? String(o.languageCode).toLowerCase()
            : defaultPrefs().languageCode
        return { countryIso2, languageCode }
    } catch {
        return defaultPrefs()
    }
}

export function setPlatformPrefs(partial: Partial<PlatformPrefs>): void {
    const next = { ...getPlatformPrefs(), ...partial }
    localStorage.setItem(PLATFORM_PREFS_KEY, JSON.stringify(next))
    applyHtmlLang(next.languageCode, next.countryIso2)
    try {
        window.dispatchEvent(new CustomEvent('mining-platform-prefs', { detail: next }))
    } catch {
        /* ignore */
    }
}

export function phonePrefixForCountry(iso2: string | undefined, countries: { iso2: string; phone_prefix?: string | number }[] | undefined): string {
    const iso = String(iso2 || '').toUpperCase()
    const row = Array.isArray(countries) ? countries.find((c) => c.iso2 === iso) : null
    const commonPrefixes: Record<string, string> = {
        AR: '54', BO: '591', BR: '55', CA: '1', CL: '56', CO: '57',
        CR: '506', CU: '53', DO: '1', EC: '593', GT: '502', HN: '504',
        MX: '52', NI: '505', PA: '507', PE: '51', PY: '595', SV: '503',
        US: '1', UY: '598', VE: '58',
    }
    const raw = row?.phone_prefix != null
        ? String(row.phone_prefix).trim()
        : commonPrefixes[iso] || '51'
    const digits = raw.replace(/\D/g, '')
    return digits || '51'
}

/** Compone E.164 a partir del número local (solo dígitos que escribe el usuario) y el prefijo del país. */
export function formatInternationalTel(localDigits: string | undefined, phonePrefix: string | number | undefined): string {
    const p = String(phonePrefix ?? '51').replace(/\D/g, '') || '51'
    const source = String(localDigits ?? '').trim()
    const d = source.replace(/\D/g, '')
    if (!d) {
        return ''
    }
    if (source.startsWith('+')) {
        return `+${d}`
    }
    return `+${p}${d}`
}
