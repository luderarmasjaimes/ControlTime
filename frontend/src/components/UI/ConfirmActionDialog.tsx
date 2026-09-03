import React, { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'

interface ConfirmationRequest {
    kind: 'confirm' | 'notice'
    message: string
    resolve: (accepted: boolean) => void
}

const CONFIRM_EVENT = 'beemetry-confirm-action'

export function requestConfirmation(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent<ConfirmationRequest>(CONFIRM_EVENT, {
            detail: { kind: 'confirm', message, resolve },
        }))
    })
}

export function requestNotice(message: string): Promise<void> {
    return new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent<ConfirmationRequest>(CONFIRM_EVENT, {
            detail: { kind: 'notice', message, resolve: () => resolve() },
        }))
    })
}

export function ConfirmActionHost() {
    const { t } = useI18n()
    const [request, setRequest] = useState<ConfirmationRequest | null>(null)

    useEffect(() => {
        const onRequest = (event: Event) => {
            const next = (event as CustomEvent<ConfirmationRequest>).detail
            setRequest((previous) => {
                previous?.resolve(false)
                return next
            })
        }
        window.addEventListener(CONFIRM_EVENT, onRequest)
        return () => window.removeEventListener(CONFIRM_EVENT, onRequest)
    }, [])

    useEffect(() => {
        if (!request) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                request.resolve(false)
                setRequest(null)
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [request])

    if (!request) return null

    const finish = (accepted: boolean) => {
        request.resolve(accepted)
        setRequest(null)
    }

    return (
        <div
            // z-[1600] originalmente dejaba este diálogo GLOBAL por debajo de
            // modales normales (.ra-overlay usa z-index:9999) y muy por debajo
            // de los modales de inserción de medios (image/video/map/etc usan
            // z-[20000]+) -- el diálogo SE RENDERIZABA (visible en el DOM,
            // getBoundingClientRect correcto) pero era completamente
            // inclickeable: el overlay del modal que lo disparó quedaba
            // encima y absorbía el puntero, dejando el flujo de confirmación
            // colgado sin ningún error visible. z-[20050] lo deja por encima
            // del mayor z-index conocido en la app (20010, MapCaptureModal).
            className="fixed inset-0 z-[20050] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={() => finish(false)}
        >
            <section
                className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/35 bg-slate-950 text-slate-100 shadow-2xl"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-action-title"
                aria-describedby="confirm-action-message"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="flex items-center justify-between border-b border-slate-700/70 px-5 py-4">
                    <h2 id="confirm-action-title" className="flex items-center gap-2 text-base font-extrabold">
                        <AlertTriangle size={20} className="text-amber-300" />
                        {t('common.warning')}
                    </h2>
                    <button
                        type="button"
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                        onClick={() => finish(false)}
                        aria-label={t('common.close')}
                    >
                        <X size={18} />
                    </button>
                </header>
                <p id="confirm-action-message" className="px-5 py-5 text-sm leading-6 text-slate-200">
                    {request.message}
                </p>
                <footer className="flex justify-end gap-3 border-t border-slate-700/70 bg-slate-900/70 px-5 py-4">
                    {request.kind === 'confirm' && (
                        <button
                            type="button"
                            className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold hover:bg-slate-800"
                            onClick={() => finish(false)}
                        >
                            {t('common.cancel')}
                        </button>
                    )}
                    <button
                        type="button"
                        className="rounded-xl border border-amber-300/50 bg-amber-500 px-4 py-2 text-sm font-black text-slate-950 hover:bg-amber-400"
                        onClick={() => finish(true)}
                        autoFocus
                    >
                        {request.kind === 'confirm' ? t('common.confirm') : t('common.accept')}
                    </button>
                </footer>
            </section>
        </div>
    )
}
