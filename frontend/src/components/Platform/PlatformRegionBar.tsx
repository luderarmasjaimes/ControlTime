import React, { memo, useEffect, useMemo, useState } from 'react'
import { Globe2, Languages } from 'lucide-react'
import { getPlatformPrefs, setPlatformPrefs, applyHtmlLang, type PlatformPrefs } from '../../auth/platformPrefs'
import { loadPlatformCatalog, type PlatformCatalog } from '../../auth/platformCatalog'
import { languageForCountry, useI18n } from '../../i18n/I18nProvider'

interface PlatformRegionBarProps {
    variant?: 'auth' | 'header';
    className?: string;
}

/**
 * País (prefijo telefónico) e idioma UI desde catálogo backend, con persistencia en localStorage.
 */
function PlatformRegionBar({ variant = 'auth', className = '' }: PlatformRegionBarProps) {
    const { t, language } = useI18n()
    const [catalog, setCatalog] = useState<PlatformCatalog | null>(null)
    const [prefs, setPrefs] = useState<PlatformPrefs>(() => getPlatformPrefs())

    useEffect(() => {
        const current = getPlatformPrefs()
        applyHtmlLang(current.languageCode, current.countryIso2)
    }, [])

    useEffect(() => {
        let cancelled = false
        loadPlatformCatalog().then((cat) => {
            if (cancelled || !cat) {
                return
            }
            setCatalog(cat)
            const p = getPlatformPrefs()
            const countryCodes = new Set((cat.countries || []).map((c: any) => c.iso2))
            const langCodes = new Set((cat.languages || []).map((l: any) => String(l.code || '').toLowerCase()))
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

    const countries: any[] = catalog?.countries ?? []
    const languages: any[] = catalog?.languages ?? []
    const regionNames = useMemo(() => {
        try {
            return new Intl.DisplayNames([language === 'pt' ? 'pt-BR' : language], { type: 'region' })
        } catch {
            return null
        }
    }, [language])

    const isHeader = variant === 'header'
    const wrapClass = isHeader
        ? `mining-platform-prefs mining-platform-prefs--header ${className}`.trim()
        : `auth-platform-prefs ${className}`.trim()

    const onCountry = (iso2: string) => {
        const country = countries.find((item) => item.iso2 === iso2)
        const languageCode = languageForCountry(iso2, country?.default_locale)
        const next = { ...prefs, countryIso2: iso2, languageCode }
        setPrefs(next)
        setPlatformPrefs({ countryIso2: iso2, languageCode })
    }

    const onLang = (code: string) => {
        const next = { ...prefs, languageCode: code }
        setPrefs(next)
        setPlatformPrefs({ languageCode: code })
    }

    return (
        <div className={wrapClass} role="region" aria-label={t('common.countryLanguage')}>
            <div className="auth-platform-prefs__item">
                <Globe2 size={isHeader ? 14 : 15} className="auth-platform-prefs__icon" aria-hidden />
                <label className="auth-platform-prefs__label">
                    <span>{t('common.country')}</span>
                    <select
                        className="auth-platform-prefs__select"
                        value={prefs.countryIso2}
                        onChange={(e) => onCountry(e.target.value)}
                        disabled={countries.length === 0}
                    >
                        {countries.map((c) => (
                            <option key={c.iso2} value={c.iso2}>
                                {regionNames?.of(c.iso2) || c.label || c.iso2} · +{String(c.phone_prefix ?? '').replace(/\D/g, '') || '?'}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <div className="auth-platform-prefs__item">
                <Languages size={isHeader ? 14 : 15} className="auth-platform-prefs__icon" aria-hidden />
                <label className="auth-platform-prefs__label">
                    <span>{t('common.language')}</span>
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
        </div>
    )
}

export default memo(PlatformRegionBar);
