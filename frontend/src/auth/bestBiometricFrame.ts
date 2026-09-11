import { estimateAvatarFrameQuality } from './biometricOvalFrame'
import type { FaceBox } from './faceTrackingUtils'
import { FACIAL_ICAO } from '../config/facialIcaoConfig'
import { log } from '../lib/logger'

/**
 * Selección del mejor frame de la ETAPA 1 para cualquier pantalla que haga
 * captura biométrica facial (ADR-158).
 *
 * Regla única, común a todas las fuentes: el frame que se envía al servidor
 * -- como plantilla biométrica y como fuente del avatar -- sale del mejor de
 * los frames que cumplen las 5 lecturas ICAO consecutivas (etapa 1), y nunca
 * de un frame tomado durante o después del desafío activo (etapa 2), donde la
 * persona está en movimiento por definición (turn_left/turn_right/
 * move_closer/move_away, ADR-146) y no se puede garantizar frontalidad,
 * centrado, distancia ni encuadre.
 *
 * Antes de esto sólo `AuthGateway.tsx` acumulaba un "mejor candidato" (y lo
 * hacía en la etapa equivocada, ver ADR-158); `UserManagementView` y
 * `MaintenanceBiometricModal` tomaban directamente el frame en vivo del
 * instante en que se cumplía el gate -- es decir, justo al terminar el gesto.
 *
 * Esto NO relaja ninguna prueba de vida: el desafío sigue siendo obligatorio
 * para ENVIAR (`challengesPassedRef`), y el servidor lo revalida (ADR-142).
 * Lo único que decide este módulo es CUÁL de los frames buenos se usa.
 */

/** Vida máxima de un candidato antes de considerarlo vencido.
 *
 * El candidato nace en la etapa 1, así que entre su captura y el envío
 * transcurre todo el desafío activo: hasta `kLivenessChallengeMaxAttempts`(5)
 * x `kLivenessChallengeTimeoutMs`(8000) = 40s, más el tiempo de interacción
 * de la pantalla. 90s deja margen sin llegar a admitir una captura de otra
 * sesión. */
export const BEST_FRAME_MAX_AGE_MS = 90_000

export interface BestFrameCandidate<TPayload> {
    payload: TPayload
    score: number
    visualQuality: number
    capturedAt: number
}

/**
 * Convierte el óvalo facial que devuelve el servidor (`GET /api/status`,
 * campo `face_oval`) en un FaceBox en el espacio de coordenadas del <video>.
 *
 * El servidor razona sobre el frame que se le sube, cuyo tamaño es
 * FACIAL_ICAO.CAMERA.width/height.ideal; el video local puede tener otra
 * resolución nativa. Sin este reescalado, `estimateAvatarFrameQuality`
 * mediría el recorte en el lugar equivocado. Devuelve null si el óvalo no es
 * utilizable -- el llamador debe tratar eso como "sin señal de calidad", no
 * como un fallo.
 */
export function faceBoxFromServerOval(
    oval: { cx?: unknown; cy?: unknown; w?: unknown; h?: unknown } | null | undefined,
    video: HTMLVideoElement | null | undefined
): FaceBox | null {
    if (!oval || !video) return null
    const cx = Number(oval.cx)
    const cy = Number(oval.cy)
    const w = Number(oval.w)
    const h = Number(oval.h)
    if (![cx, cy, w, h].every((v) => Number.isFinite(v)) || w <= 0 || h <= 0) return null
    const vw = video.videoWidth || 0
    const vh = video.videoHeight || 0
    if (vw < 32 || vh < 32) return null
    const srcW = Number(FACIAL_ICAO.CAMERA.width.ideal) || vw
    const srcH = Number(FACIAL_ICAO.CAMERA.height.ideal) || vh
    const sx = vw / Math.max(1, srcW)
    const sy = vh / Math.max(1, srcH)
    return {
        x: (cx - w / 2) * sx,
        y: (cy - h / 2) * sy,
        width: w * sx,
        height: h * sy,
    }
}

export interface BestFrameCollector<TPayload> {
    /**
     * Evalúa el frame actual y lo guarda si supera al mejor acumulado.
     * `build()` sólo se invoca cuando el candidato gana, para no pagar el
     * costo de codificar JPEG/plantilla en cada frame descartado.
     */
    consider(args: {
        video: HTMLVideoElement | null | undefined
        faceBox: FaceBox | null
        /** Puntaje extra ya normalizado (liveness del servidor, etc.). */
        bonus?: number
        build: () => TPayload
    }): void
    /** Mejor candidato si sigue fresco; null si no hay o venció. */
    takeFresh(): BestFrameCandidate<TPayload> | null
    reset(): void
}

export function createBestFrameCollector<TPayload>(options?: {
    maxAgeMs?: number
    /** Etiqueta para los logs, p.ej. 'MAINTENANCE_BIO'. */
    label?: string
}): BestFrameCollector<TPayload> {
    const maxAgeMs = options?.maxAgeMs ?? BEST_FRAME_MAX_AGE_MS
    const label = options?.label || 'BEST_FRAME'
    let best: BestFrameCandidate<TPayload> | null = null

    return {
        consider({ video, faceBox, bonus, build }) {
            if (!video) return
            const visualQuality = estimateAvatarFrameQuality(video, faceBox)
            if (visualQuality <= 0) return
            // Mismo criterio que AuthGateway (ADR-158): dentro de la etapa 1
            // todos los candidatos ya cumplen las mismas condiciones ICAO, así
            // que el desempate real es la calidad visual -- nitidez,
            // exposición, tamaño de rostro, centrado y las penalizaciones de
            // encuadre (demasiado cerca / descentrado / coronilla cortada).
            const score = visualQuality * 2 + Number(bonus || 0)
            if (best && score <= best.score) return
            try {
                best = { payload: build(), score, visualQuality, capturedAt: Date.now() }
            } catch (error) {
                log.warn(`[${label}] no se pudo construir el candidato`, error)
            }
        },
        takeFresh() {
            if (!best) return null
            const ageMs = Date.now() - best.capturedAt
            if (ageMs > maxAgeMs) {
                log.warn(`[${label}] mejor candidato vencido, se usará la captura en vivo`, { ageMs })
                return null
            }
            return best
        },
        reset() {
            best = null
        },
    }
}
