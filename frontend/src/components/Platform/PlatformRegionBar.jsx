import React, { useEffect, useState } from 'react'
import { Globe2, Languages } from 'lucide-react'
import { getPlatformPrefs, setPlatformPrefs, applyHtmlLang } from '../../auth/platformPrefs'
import { loadPlatformCatalog } from '../../auth/platformCatalog'

/**
 * País (prefijo telefónico) e idioma UI desde catálogo backend, con persistencia en localStorage.
 * @param {{ variant?: 'auth' | 'header', className?: string }}=} props
 */
export default function PlatformRegionBar({ variant = 'auth', className = '' }) {
    const [catalog, setCatalog] = useState(null)
    const [prefs, setPrefs] = useState(() => getPlatformPrefs())

    useEffect(() => {
        applyHtmlLang(getPlatformPrefs().languageCode)
    }, [])

    useEffect(() => {
        let cancelled = false
        loadPlatformCatalog().then((cat) => {
            if (cancelled || !cat) {
                return
            }
            setCatalog(cat)
            const p = getPlatformPrefs()
            const countryCodes = new Set((cat.countries || []).map((c) => c.iso2))
            const langCodes = new Set((cat.languages || []).map((l) => String(l.code || '').toLowerCase()))
            const preferredCountry = countryCodes.has('PE')
                ? 'PE'
                : cat.countries?.[0]?.iso2 || 'PE'
            const preferredLang = langCodes.has('es')
                ? 'es'
                : String(cat.languages?.[0]?.code || 'es').toLowerCase()

            const next = {
                ...p,
                countryIso2: countryCodes.has(p.countryIso2) ? p.countryIso2 : preferredCountry,
                languageCode: langCodes.has(String(p.languageCode || '').toLowerCase())
                    ? String(p.languageCode || '').toLowerCase()
                    : preferredLang,
            }

            if (next.countryIso2 !== p.countryIso2 || next.languageCode !== p.languageCode) {
                setPlatformPrefs({
                    countryIso2: next.countryIso2,
                    languageCode: next.languageCode,
                })
            }
            setPrefs(next)
        })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        const onExt = () => setPrefs(getPlatformPrefs())
        window.addEventListener('mining-platform-prefs', onExt)
        return () => window.removeEventListener('mining-platform-prefs', onExt)
    }, [])

    const countries = catalog?.countries ?? []
    const languages = catalog?.languages ?? []

    const isHeader = variant === 'header'
    const wrapClass = isHeader
        ? `mining-platform-prefs mining-platform-prefs--header ${className}`.trim()
        : `auth-platform-prefs ${className}`.trim()

    const onCountry = (iso2) => {
        const next = { ...prefs, countryIso2: iso2 }
        setPrefs(next)
        setPlatformPrefs({ countryIso2: iso2 })
    }

    const onLang = (code) => {
        const next = { ...prefs, languageCode: code }
        setPrefs(next)
        setPlatformPrefs({ languageCode: code })
    }

    return (
        <div className={wrapClass} role="region" aria-label="Región e idioma de la plataforma">
            <div className="auth-platform-prefs__item">
                <Languages size={isHeader ? 14 : 15} className="auth-platform-prefs__icon" aria-hidden />
                <label className="auth-platform-prefs__label">
                    <span>Idioma</span>
                    <select
                        className="auth-platform-prefs__select"
                        value={prefs.languageCode}
                        onChange={(e) => onLang(e.target.value)}
                        disabled={languages.length === 0}
                    >
                        {languages.map((L) => (
                            <option key={L.code} value={L.code}>
                                {L.label_native || L.label_es || L.code}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <div className="auth-platform-prefs__item">
                <Globe2 size={isHeader ? 14 : 15} className="auth-platform-prefs__icon" aria-hidden />
                <label className="auth-platform-prefs__label">
                    <span>País / conexión</span>
                    <select
                        className="auth-platform-prefs__select"
                        value={prefs.countryIso2}
                        onChange={(e) => onCountry(e.target.value)}
                        disabled={countries.length === 0}
                    >
                        {countries.map((c) => (
                            <option key={c.iso2} value={c.iso2}>
                                +{String(c.phone_prefix ?? '').replace(/\D/g, '') || '?'} — {c.label || c.iso2}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
        </div>
    )
}
