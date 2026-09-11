import { FACIAL_ICAO } from '../config/facialIcaoConfig'
import { log } from '../lib/logger'

/**
 * Hallazgo real 2026-09-04: pedir una única resolución "ideal" fija a
 * getUserMedia() no alcanza -- a 1280x960 el permiso se concedía y la
 * Promise resolvía igual (MediaStream "activo"), pero en ciertos drivers
 * UVC/Windows Media Foundation el <video> nunca llegaba a pintar un frame
 * real: la cámara quedaba "Activa" en la UI y la sesión terminaba en el
 * timeout de 120s sin que el usuario pudiera avanzar. Ese driver no negocia
 * bien esa combinación resolución+aspect ratio+framerate, pero SÍ funciona
 * bien a resoluciones menores -- no hay forma de saberlo de antemano sin
 * probar.
 *
 * En vez de adivinar un único valor "ideal" (que ya se tuvo que bajar una
 * vez por esto), se prueba esta escalera de mayor a menor, verificando en
 * cada escalón que realmente llegue un frame decodificado (no solo que la
 * Promise de getUserMedia resuelva) antes de aceptarlo. FACIAL_ICAO.CAMERA
 * (960x720) sigue siendo el último escalón "seguro" conocido antes del
 * fallback final sin restricción de resolución.
 *
 * Esto es seguro para la calibración del backend (EAR_IED_REF_PX en
 * ai_engine/eye_analyzer.py): el JPEG/plantilla que se envía al servidor
 * SIEMPRE se normaliza a FACIAL_ICAO.CAMERA.width/height.ideal en el canvas
 * de salida (ver frameToJpegBase64/frameToTemplate en biometricOvalFrame.ts),
 * sin importar a qué resolución se haya negociado la captura real -- una
 * resolución de captura más alta solo da más detalle real para ese
 * downscale, nunca cambia lo que el servidor recibe.
 */
const RESOLUTION_LADDER: Array<{ width: number; height: number }> = [
    { width: 1920, height: 1440 },
    { width: 1280, height: 960 },
    { width: FACIAL_ICAO.CAMERA.width.ideal, height: FACIAL_ICAO.CAMERA.height.ideal },
    { width: 640, height: 480 },
]

const FRAME_VERIFY_TIMEOUT_MS = 1500
const FRAME_VERIFY_POLL_MS = 100

function stopStream(stream: MediaStream | null | undefined) {
    stream?.getTracks().forEach((track) => track.stop())
}

function isPermissionError(err: unknown): boolean {
    const name = (err as { name?: string } | null)?.name
    return name === 'NotAllowedError' || name === 'SecurityError'
}

/**
 * Espera hasta FRAME_VERIFY_TIMEOUT_MS a que el <video> reciba un frame
 * REAL decodificado -- no solo que el track esté "live"/videoWidth>0, que
 * algunos drivers reportan igual aunque el frame quede congelado en negro.
 * Preferimos requestVideoFrameCallback (Chrome/Edge: confirma que un frame
 * se presentó de verdad); sin eso (Firefox/Safari), exigimos videoWidth>0 Y
 * que currentTime avance entre dos lecturas.
 */
async function waitForRealFrame(video: HTMLVideoElement): Promise<boolean> {
    type VideoWithRvfc = HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number
        cancelVideoFrameCallback?: (handle: number) => void
    }
    const rvfcVideo = video as VideoWithRvfc
    if (typeof rvfcVideo.requestVideoFrameCallback === 'function') {
        return new Promise<boolean>((resolve) => {
            let settled = false
            const handle = rvfcVideo.requestVideoFrameCallback!(() => {
                if (settled) return
                settled = true
                resolve(true)
            })
            setTimeout(() => {
                if (settled) return
                settled = true
                rvfcVideo.cancelVideoFrameCallback?.(handle)
                resolve(false)
            }, FRAME_VERIFY_TIMEOUT_MS)
        })
    }

    const deadline = Date.now() + FRAME_VERIFY_TIMEOUT_MS
    let baselineTime: number | null = null
    while (Date.now() < deadline) {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            if (baselineTime === null) {
                baselineTime = video.currentTime
            } else if (video.currentTime > baselineTime + 0.05) {
                return true
            }
        }
        await new Promise((resolve) => setTimeout(resolve, FRAME_VERIFY_POLL_MS))
    }
    return false
}

async function attachAndVerify(video: HTMLVideoElement, stream: MediaStream): Promise<boolean> {
    video.srcObject = stream
    video.muted = true
    video.setAttribute('playsinline', '')
    await video.play().catch(() => {})
    return waitForRealFrame(video)
}

/**
 * Abre la cámara probando la resolución más alta posible que el hardware
 * real entregue frames de verdad, bajando automáticamente escalón por
 * escalón cuando uno "resuelve" pero nunca pinta imagen (ver comentario de
 * RESOLUTION_LADDER arriba). Deja al llamador el resto del manejo de estado
 * (streamRef, cameraReady, etc.) -- esta función solo consigue y valida el
 * stream, y lo deja ya asignado a `video`.
 *
 * `isCancelled` se consulta entre pasos para no seguir negociando cámara
 * (ni dejar streams huérfanos abiertos) si el efecto que llamó a esto ya se
 * desmontó/re-disparó mientras la promesa estaba en vuelo.
 */
export async function acquireFaceCameraStream(
    video: HTMLVideoElement,
    isCancelled: () => boolean
): Promise<MediaStream> {
    let lastErr: unknown = null

    for (const step of RESOLUTION_LADDER) {
        if (isCancelled()) {
            throw new DOMException('cancelled', 'AbortError')
        }
        let stream: MediaStream
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: step.width, min: 320 },
                    height: { ideal: step.height, min: 240 },
                    aspectRatio: { ideal: step.width / step.height },
                    frameRate: FACIAL_ICAO.CAMERA.frameRate,
                },
                audio: false,
            })
        } catch (err) {
            if (isPermissionError(err)) {
                // No depende de la resolución: reintentar en un escalón más
                // bajo no va a cambiar un permiso denegado.
                throw err
            }
            lastErr = err
            continue
        }

        if (isCancelled()) {
            stopStream(stream)
            throw new DOMException('cancelled', 'AbortError')
        }

        const gotRealFrame = await attachAndVerify(video, stream)

        if (isCancelled()) {
            stopStream(stream)
            throw new DOMException('cancelled', 'AbortError')
        }

        if (gotRealFrame) {
            return stream
        }

        log.warn('[ADAPTIVE_CAMERA] Escalón sin frame real, bajando resolución', {
            width: step.width,
            height: step.height,
        })
        video.srcObject = null
        stopStream(stream)
        lastErr = new Error(`camera_no_frame_at_${step.width}x${step.height}`)
    }

    // Último recurso: exactamente el fallback que ya existía antes de la
    // escalera (sin ninguna restricción de resolución).
    if (isCancelled()) {
        throw new DOMException('cancelled', 'AbortError')
    }
    let fallbackStream: MediaStream
    try {
        fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: false,
        })
    } catch (err) {
        throw isPermissionError(err) ? err : lastErr ?? err
    }

    if (isCancelled()) {
        stopStream(fallbackStream)
        throw new DOMException('cancelled', 'AbortError')
    }

    const gotRealFrame = await attachAndVerify(video, fallbackStream)
    if (isCancelled()) {
        stopStream(fallbackStream)
        throw new DOMException('cancelled', 'AbortError')
    }
    if (!gotRealFrame) {
        // Ni siquiera el fallback sin restricción de resolución entrega un
        // frame real -- ya no es un problema de resolución (cámara ocupada
        // por otra app, driver caído, etc.). Se lo pasamos al llamador como
        // NotReadableError para que caiga en el mismo bucket "cameraBusy" +
        // reintento automático que ya existe (ver cameraErrorPolicy.ts) en
        // vez de dejar la UI en "Activa" mintiendo sobre el estado real.
        video.srcObject = null
        stopStream(fallbackStream)
        throw new DOMException(
            'La cámara no entregó imagen en ningún modo probado',
            'NotReadableError'
        )
    }
    return fallbackStream
}
