const PLATFORM_PREFS_KEY = 'mining_platform_prefs_v1'

function defaultPrefs() {
    return {
        countryIso2: 'PE',
        languageCode: 'es',
    }
}

const ALLOWED_LANG = new Set(['en', 'es', 'pt', 'fr'])

/** Ajusta `document.documentElement.lang` para accesibilidad y futura i18n. */
export function applyHtmlLang(code) {
    const c = String(code || 'es').toLowerCase()
    const map = { en: 'en', es: 'es', pt: 'pt', fr: 'fr' }
    document.documentElement.lang = map[c] || 'es'
}

export function getPlatformPrefs() {
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

export function setPlatformPrefs(partial) {
    const next = { ...getPlatformPrefs(), ...partial }
    localStorage.setItem(PLATFORM_PREFS_KEY, JSON.stringify(next))
    applyHtmlLang(next.languageCode)
    try {
        window.dispatchEvent(new CustomEvent('mining-platform-prefs', { detail: next }))
    } catch {
        /* ignore */
    }
}

export function phonePrefixForCountry(iso2, countries) {
    const iso = String(iso2 || '').toUpperCase()
    const row = Array.isArray(countries) ? countries.find((c) => c.iso2 === iso) : null
    const raw = row?.phone_prefix != null ? String(row.phone_prefix).trim() : '51'
    const digits = raw.replace(/\D/g, '')
    return digits || '51'
}

/** Compone E.164 a partir del número local (solo dígitos que escribe el usuario) y el prefijo del país. */
export function formatInternationalTel(localDigits, phonePrefix) {
    const p = String(phonePrefix ?? '51').replace(/\D/g, '') || '51'
    const d = String(localDigits ?? '').replace(/\D/g, '')
    if (!d) {
        return ''
    }
    return `+${p}${d}`
}
