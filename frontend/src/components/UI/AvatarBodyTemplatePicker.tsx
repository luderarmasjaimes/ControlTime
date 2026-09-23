import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import {
    listAvatarBodyTemplates,
    updateAvatarBodyTemplate,
    type AvatarBodyTemplate,
} from '../../auth/authApi'

// Selector de vestimenta del avatar (rediseño 2026-09-20, ADR-203): el avatar
// recorta solo la cabeza del usuario; el resto del cuerpo/vestimenta viene de
// un catálogo fijo de plantillas pre-hechas (ai_engine/avatar_body_templates.py).
// Elegir una plantilla dispara un recompose RÁPIDO en el backend (sin GPU ni
// difusión, ver POST /api/auth/avatar/body-template) -- se nota en la UI
// porque "Aplicando…" dura menos de un segundo, no los 15-40s de un registro.

interface AvatarBodyTemplatePickerProps {
    onApplied: (result: { avatar_body_template_slug: string; avatar_cartoon_base64: string }) => void
    onHeadUnavailable?: () => void
}

export function AvatarBodyTemplatePicker({ onApplied, onHeadUnavailable }: AvatarBodyTemplatePickerProps) {
    const { t } = useI18n()
    const [templates, setTemplates] = useState<AvatarBodyTemplate[] | null>(null)
    const [loadError, setLoadError] = useState(false)
    const [applyingSlug, setApplyingSlug] = useState<string | null>(null)
    const [applyError, setApplyError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        listAvatarBodyTemplates()
            .then((list) => {
                if (cancelled) return
                setTemplates(list)
                if (list.length > 0 && list.every((tpl) => tpl.avatar_head_available === false)) {
                    onHeadUnavailable?.()
                }
            })
            .catch(() => {
                if (!cancelled) setLoadError(true)
            })
        return () => {
            cancelled = true
        }
    }, [onHeadUnavailable])

    const handlePick = async (slug: string) => {
        if (applyingSlug) return
        setApplyingSlug(slug)
        setApplyError(null)
        try {
            const result = await updateAvatarBodyTemplate(slug)
            setTemplates((prev) => (prev ? prev.map((tpl) => ({ ...tpl, current: tpl.slug === slug })) : prev))
            onApplied(result)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            if (message === 'avatar_head_not_available') {
                onHeadUnavailable?.()
            }
            setApplyError(
                message === 'avatar_head_not_available'
                    ? t('avatar.outfitHeadUnavailable')
                    : t('avatar.outfitApplyError')
            )
        } finally {
            setApplyingSlug(null)
        }
    }

    return (
        <div className="avatar-outfit-panel">
            <h3>{t('avatar.outfitPickerTitle')}</h3>
            {!templates && !loadError && <p className="avatar-outfit-loading">{t('avatar.outfitLoading')}</p>}
            {loadError && <p className="avatar-outfit-error">{t('avatar.outfitLoadError')}</p>}
            {templates && templates.length > 0 && templates.every((tpl) => tpl.avatar_head_available === false) && (
                <p className="avatar-outfit-error">{t('avatar.outfitHeadUnavailable')}</p>
            )}
            {templates && templates.length > 0 && (
                <div className="avatar-outfit-grid">
                    {templates.map((tpl) => {
                        const isApplying = applyingSlug === tpl.slug
                        return (
                            <button
                                key={tpl.slug}
                                type="button"
                                className={`avatar-outfit-item${tpl.current ? ' is-current' : ''}${isApplying ? ' is-applying' : ''}`}
                                disabled={Boolean(applyingSlug)}
                                onClick={() => handlePick(tpl.slug)}
                            >
                                {tpl.thumbnail_base64 && (
                                    <img
                                        src={`data:image/png;base64,${tpl.thumbnail_base64}`}
                                        alt={tpl.display_name}
                                        draggable={false}
                                    />
                                )}
                                <span>{isApplying ? t('avatar.outfitApplying') : tpl.display_name}</span>
                                {tpl.current && !isApplying && <span>{t('avatar.outfitCurrent')}</span>}
                            </button>
                        )
                    })}
                </div>
            )}
            {applyError && <p className="avatar-outfit-error">{applyError}</p>}
        </div>
    )
}
