import { useCallback, useEffect, useRef } from 'react'
import Hls from 'hls.js'

/**
 * Reproduce URL HTTP(S) en <video>: MP4/WebM directo o HLS (.m3u8) vía hls.js.
 * RTMP no es reproducible en navegadores; usar otro componente para mostrar la URL.
 *
 * @param {{ current: HTMLVideoElement | null } | undefined} captureVideoRef — opcional: ref al nodo video (p. ej. captura a lienzo).
 * @param {() => void} [onVideoReady] — fotograma listo (loadeddata / canplay).
 */
export default function CctvStreamVideo({ streamUrl, className, muted = true, captureVideoRef, onVideoReady }) {
    const videoRef = useRef(null)

    const setVideoEl = useCallback(
        (node) => {
            videoRef.current = node
            if (captureVideoRef) {
                captureVideoRef.current = node
            }
        },
        [captureVideoRef],
    )

    const hlsRef = useRef(null)

    useEffect(() => {
        const el = videoRef.current
        if (!el || !streamUrl) return
        const u = String(streamUrl).trim()
        if (!u.startsWith('http://') && !u.startsWith('https://')) return

        const lower = u.toLowerCase()
        const isM3u8 = lower.includes('.m3u8') || lower.includes('type=m3u8')

        const cleanup = () => {
            if (hlsRef.current) {
                try {
                    hlsRef.current.destroy()
                } catch {
                    /* ignore */
                }
                hlsRef.current = null
            }
            el.removeAttribute('src')
            el.removeAttribute('crossorigin')
            try {
                el.load()
            } catch {
                /* ignore */
            }
        }

        /* Permite capturar fotograma a canvas cuando el CDN envía CORS (p. ej. informe técnico). */
        el.crossOrigin = 'anonymous'

        if (isM3u8) {
            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    maxBufferLength: 45,
                })
                hlsRef.current = hls
                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) {
                        console.warn('[CCTV HLS]', data.type, data.details)
                    }
                })
                hls.loadSource(u)
                hls.attachMedia(el)
            } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
                el.src = u
            }
        } else {
            el.src = u
        }

        el.play().catch(() => {
            /* autoplay bloqueado sin interacción: normal */
        })

        return cleanup
    }, [streamUrl])

    useEffect(
        () => () => {
            if (captureVideoRef) {
                captureVideoRef.current = null
            }
        },
        [captureVideoRef],
    )

    return (
        <video
            ref={setVideoEl}
            className={className}
            autoPlay
            playsInline
            muted={muted}
            controls={false}
            onLoadedData={() => onVideoReady?.()}
            onCanPlay={() => onVideoReady?.()}
        />
    )
}
