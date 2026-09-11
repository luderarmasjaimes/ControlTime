import { log } from '../lib/logger'

/**
 * Resolución de ENCODE (no de captura -- eso ya lo resuelve
 * adaptiveCameraCapture.ts, que negocia con getUserMedia la resolución NATIVA
 * más alta que la cámara realmente entrega, verificando que llegue un frame
 * de verdad) usada para el JPEG que se manda a /api/process_frame y para la
 * foto/plantilla final de login/registro.
 *
 * Pedido explícito del usuario 2026-09-07: "no deberíamos depender de la
 * resolución, esta deberá autoajustarse según la máxima resolución y de ahí
 * ir reduciendo la resolución en caso tengamos un problema con el
 * procesamiento". Antes se forzaba SIEMPRE un canvas fijo de 960×720 (4:3)
 * sin importar la resolución/aspecto real negociado con la cámara -- si el
 * hardware entregaba, por ejemplo, 1920×1080 (16:9, muy común en laptops),
 * el frame se ESTIRABA para encajar en 960×720 antes de llegar al motor IA,
 * deformando el óvalo que ajusta MediaPipe sobre esos landmarks (hallazgo
 * real: se veía "más circular" o achatado según el sentido del
 * estiramiento). Ahora se parte de la resolución NATIVA del video (hasta un
 * techo razonable, ver LONG_SIDE_LADDER) preservando SIEMPRE su aspecto
 * real, y sólo se baja de escalón cuando el PROCESAMIENTO (no la cámara) da
 * señales de problema: round-trips lentos o fallidos hacia
 * /api/process_frame. Nunca sube sola de nuevo dentro de la misma sesión de
 * captura (evita oscilar entre escalones) -- una sesión nueva (nuevo
 * montaje de cámara) vuelve a arrancar arriba.
 */
const LONG_SIDE_LADDER = [1920, 1280, 960, 640]

const SLOW_ROUNDTRIP_MS = 900
const CONSECUTIVE_SLOW_TO_DEGRADE = 3
const CONSECUTIVE_ERRORS_TO_DEGRADE = 2

export class AdaptiveEncodeResolution {
    private tierIndex = 0
    private consecutiveSlow = 0
    private consecutiveErrors = 0

    maxLongSide(): number {
        return LONG_SIDE_LADDER[this.tierIndex]
    }

    /**
     * Tamaño de encode a usar dado el tamaño NATIVO actual del video --
     * preserva el aspecto real siempre; nunca agranda (si el nativo ya es
     * más chico que el techo del escalón actual, se manda tal cual, sin
     * upscale artificial que no agregaría detalle real).
     */
    targetSize(nativeW: number, nativeH: number): { width: number; height: number } {
        if (nativeW < 1 || nativeH < 1) {
            return { width: nativeW, height: nativeH }
        }
        const cap = this.maxLongSide()
        const longSide = Math.max(nativeW, nativeH)
        if (longSide <= cap) {
            return { width: Math.round(nativeW), height: Math.round(nativeH) }
        }
        const scale = cap / longSide
        return {
            width: Math.max(1, Math.round(nativeW * scale)),
            height: Math.max(1, Math.round(nativeH * scale)),
        }
    }

    /** Registrar el resultado de un round-trip hacia /api/process_frame --
     * baja un escalón tras varios round-trips lentos o fallidos SEGUIDOS
     * (con histéresis simple: un solo hipo de red no degrada nada). */
    reportRoundTrip(elapsedMs: number, ok: boolean): void {
        if (!ok) {
            this.consecutiveErrors += 1
            this.consecutiveSlow = 0
            if (this.consecutiveErrors >= CONSECUTIVE_ERRORS_TO_DEGRADE) {
                this.degrade('errores consecutivos')
                this.consecutiveErrors = 0
            }
            return
        }
        this.consecutiveErrors = 0
        if (elapsedMs > SLOW_ROUNDTRIP_MS) {
            this.consecutiveSlow += 1
            if (this.consecutiveSlow >= CONSECUTIVE_SLOW_TO_DEGRADE) {
                this.degrade(`round-trip lento (${elapsedMs.toFixed(0)}ms)`)
                this.consecutiveSlow = 0
            }
        } else {
            this.consecutiveSlow = 0
        }
    }

    private degrade(reason: string): void {
        if (this.tierIndex >= LONG_SIDE_LADDER.length - 1) {
            return
        }
        this.tierIndex += 1
        log.warn('[ADAPTIVE_ENCODE] bajando resolución de envío por problema de procesamiento', {
            reason,
            newMaxLongSide: this.maxLongSide(),
        })
    }

    /** Reinicia al escalón más alto -- llamar al arrancar una sesión de
     * captura nueva (nueva cámara montada), no entre frames de la misma
     * sesión. */
    reset(): void {
        this.tierIndex = 0
        this.consecutiveSlow = 0
        this.consecutiveErrors = 0
    }
}
