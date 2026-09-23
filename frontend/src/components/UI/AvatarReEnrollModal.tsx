import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { reEnrollAvatarPhoto } from '../../auth/authApi'

// "Actualizar mi foto" (pedido real 2026-09-20): las cuentas creadas antes
// del rediseño de avatar (ADR-203) no tienen recorte de cabeza persistido, así
// que el selector de vestimenta (AvatarBodyTemplatePicker.tsx) les devuelve
// 409 para siempre. Este modal es la única vía de regenerarlo sin repetir
// todo el registro. A propósito NO reusa el reto de vivacidad de
// AuthGateway.tsx: esto es puramente cosmético (no reemplaza ni reverifica la
// identidad biométrica de la cuenta), así que una captura simple alcanza.

interface AvatarReEnrollModalProps {
    onApplied: (avatarCartoonBase64: string) => void
    onClose: () => void
}

export function AvatarReEnrollModal({ onApplied, onClose }: AvatarReEnrollModalProps) {
    const { t } = useI18n()
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const [cameraError, setCameraError] = useState<string | null>(null)
    const [captured, setCaptured] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        if (!navigator.mediaDevices?.getUserMedia) {
            setCameraError(t('avatar.reenrollCameraError'))
            return
        }
        navigator.mediaDevices
            .getUserMedia({ video: { facingMode: 'user' }, audio: false })
            .then((stream) => {
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }
                streamRef.current = stream
                if (videoRef.current) videoRef.current.srcObject = stream
            })
            .catch(() => {
                if (!cancelled) setCameraError(t('avatar.reenrollCameraError'))
            })
        return () => {
            cancelled = true
            streamRef.current?.getTracks().forEach((track) => track.stop())
            streamRef.current = null
        }
    }, [t])

    const handleCapture = () => {
        const video = videoRef.current
        if (!video || !video.videoWidth || !video.videoHeight) return
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        setCaptured(canvas.toDataURL('image/jpeg', 0.92))
    }

    const handleConfirm = async () => {
        if (!captured) return
        setSubmitting(true)
        setSubmitError(null)
        try {
            const result = await reEnrollAvatarPhoto(captured)
            onApplied(result.avatar_cartoon_base64)
        } catch {
            setSubmitError(t('avatar.reenrollApplyError'))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="avatar-reenroll-panel">
            <h3>{t('avatar.reenrollTitle')}</h3>
            <p className="avatar-reenroll-hint">{t('avatar.reenrollHint')}</p>
            {cameraError && <p className="avatar-outfit-error">{cameraError}</p>}
            <div className="avatar-reenroll-frame">
                {!captured && (
                    <video ref={videoRef} autoPlay playsInline muted />
                )}
                {captured && <img src={captured} alt="" draggable={false} />}
            </div>
            <div className="avatar-reenroll-actions">
                {!captured && (
                    <button type="button" onClick={handleCapture} disabled={Boolean(cameraError)}>
                        {t('avatar.reenrollCapture')}
                    </button>
                )}
                {captured && (
                    <>
                        <button type="button" onClick={() => setCaptured(null)} disabled={submitting}>
                            {t('avatar.reenrollRetry')}
                        </button>
                        <button type="button" onClick={handleConfirm} disabled={submitting}>
                            {submitting ? t('avatar.reenrollSubmitting') : t('avatar.reenrollConfirm')}
                        </button>
                    </>
                )}
                <button type="button" onClick={onClose} disabled={submitting}>
                    {t('avatar.close')}
                </button>
            </div>
            {submitError && <p className="avatar-outfit-error">{submitError}</p>}
        </div>
    )
}
