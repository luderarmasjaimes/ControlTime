/**
 * Geometría del óvalo biométrico (alineada con C:\FACIAL FaceDetectionEngine::getMainFaceOval)
 * y render a canvas / JPEG con máscara elíptica. Usado en:
 * - validación periódica (/api/process_frame)
 * - plantilla 24×24 legacy (login/registro)
 * - JPEG de rostro (login/registro)
 */
import { FACIAL_ICAO } from '../config/facialIcaoConfig'
import type { FaceBox } from './faceTrackingUtils'

/**
 * Óvalo local para seguimiento visual inmediato -- se dibuja en cada frame de
 * cámara, sin depender del round-trip de /api/process_frame ni del tracker
 * Haar del backend (ADR-162: ese óvalo de servidor solo se usa ahora como
 * último recurso si no hay tracking local en absoluto).
 *
 * Fuente preferida: contorno facial REAL de MediaPipe (`box.ovalPoints`, 36
 * puntos FACEMESH_FACE_OVAL calculados en el navegador, ver
 * mediapipeFaceTracker.ts) -- ese contorno ya incluye la frente (el punto 10
 * cae en la línea de nacimiento del pelo), así que solo se le da un margen
 * chico de aire visual, no un factor de inflado adivinado.
 *
 * Los factores de abajo (FACIAL_OVAL_W_FACTOR/H_FACTOR) quedan como fallback
 * SOLO para cuando aún no hay `ovalPoints` (WASM cargando o falló y se usa el
 * heurístico de color de piel) -- ahí no hay contorno real del que partir, y
 * usar alto fijo + aspecto fijo produjo los óvalos altos/angostos reportados
 * el 2026-09-07, de ahí derivar ancho y alto del bbox del fallback con
 * expansión y límites de aspecto en vez de un tamaño fijo.
 */
const FACIAL_OVAL_W_FACTOR = 1.14
const FACIAL_OVAL_H_FACTOR = 1.34
const FACIAL_OVAL_MIN_ASPECT = 0.70
const FACIAL_OVAL_MAX_ASPECT = 0.92
const OVAL_UI_CENTER_OFFSET_LEFT_FRAC = 0.022
export const FACIAL_STRICT_OVAL_MODE = false
export const FACIAL_STRICT_OVAL_W_PCT = 31
export const FACIAL_STRICT_OVAL_H_PCT = 80

/** Calidad JPEG para snapshots enviados en login/registro (no el tick ICAO). */
const FACE_SNAPSHOT_JPEG_QUALITY = 0.88

export interface OvalVideoMetrics {
    cx: number;
    cy: number;
    ow: number;
    oh: number;
}

/** Mínimo de puntos de contorno real para confiar en su bbox en vez del inflado de bbox facial (36 esperados, ver FACE_OVAL_INDICES). */
const MIN_OVAL_CONTOUR_POINTS = 20
/** Margen sobre el bbox del contorno REAL (no un factor de inflado a ciegas: el contorno ya
 * incluye la frente -- punto 10 de FACEMESH_FACE_OVAL cae en la línea de nacimiento del pelo).
 * Solo da un poco de aire visual alrededor del óvalo dibujado. */
const OVAL_CONTOUR_PAD_W_FRAC = 0.04
const OVAL_CONTOUR_PAD_H_FRAC = 0.03

export function getBiometricOvalVideoMetrics(box: FaceBox | null | undefined, vw: number, vh: number): OvalVideoMetrics | null {
    if (vw < 32 || vh < 32) {
        return null
    }
    if (FACIAL_STRICT_OVAL_MODE) {
        const ow = vw * (FACIAL_STRICT_OVAL_W_PCT / 100)
        const oh = vh * (FACIAL_STRICT_OVAL_H_PCT / 100)
        const cx = vw * (0.5 - OVAL_UI_CENTER_OFFSET_LEFT_FRAC)
        const cy = vh * 0.5
        return { cx, cy, ow, oh }
    }
    if (!box) {
        return null
    }
    let cx: number
    let cy: number
    let ow: number
    let oh: number
    if (box.ovalPoints && box.ovalPoints.length >= MIN_OVAL_CONTOUR_POINTS) {
        // ADR-162: contorno facial real (MediaPipe FACEMESH_FACE_OVAL) en vez de
        // inflar el bbox facial con un factor adivinado -- resuelve de raíz el
        // "no cubre toda la frente" que ningún factor fijo lograba acertar para
        // todas las caras/distancias.
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const p of box.ovalPoints) {
            if (p.x < minX) minX = p.x
            if (p.x > maxX) maxX = p.x
            if (p.y < minY) minY = p.y
            if (p.y > maxY) maxY = p.y
        }
        const bw = Math.max(1, maxX - minX)
        const bh = Math.max(1, maxY - minY)
        cx = (minX + maxX) / 2
        cy = (minY + maxY) / 2
        ow = bw * (1 + OVAL_CONTOUR_PAD_W_FRAC)
        oh = bh * (1 + OVAL_CONTOUR_PAD_H_FRAC)
    } else {
        cx = box.x + box.width / 2
        cy = box.y + box.height / 2 - box.height * 0.13
        ow = box.width * FACIAL_OVAL_W_FACTOR
        oh = box.height * FACIAL_OVAL_H_FACTOR
        const aspect = ow / Math.max(1, oh)
        if (aspect < FACIAL_OVAL_MIN_ASPECT) {
            ow = oh * FACIAL_OVAL_MIN_ASPECT
        } else if (aspect > FACIAL_OVAL_MAX_ASPECT) {
            oh = ow / FACIAL_OVAL_MAX_ASPECT
        }
    }
    const maxW = vw * 0.96
    const maxH = vh * 0.96
    const s = Math.min(1, maxW / Math.max(ow, 1e-6), maxH / Math.max(oh, 1e-6))
    ow *= s
    oh *= s
    const halfOw = ow / 2
    const cxNudged = Math.max(
        halfOw + 2,
        Math.min(vw - halfOw - 2, cx - vw * OVAL_UI_CENTER_OFFSET_LEFT_FRAC)
    )
    return { cx: cxNudged, cy, ow, oh }
}

/**
 * Canvas tw×th: vídeo escalado; solo interior de la elipse visible (resto negro).
 */
export function renderOvalMaskedFrameToCanvas(
    video: HTMLVideoElement,
    ovalMetrics: OvalVideoMetrics | null,
    tw: number,
    th: number,
): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')!
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!ovalMetrics || vw < 32 || vh < 32) {
        ctx.drawImage(video, 0, 0, vw, vh, 0, 0, tw, th)
        return canvas
    }
    const { cx, cy, ow, oh } = ovalMetrics
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, tw, th)
    const cxOut = (cx / vw) * tw
    const cyOut = (cy / vh) * th
    const rx = (ow / vw) * tw * 0.5
    const ry = (oh / vh) * th * 0.5
    ctx.save()
    ctx.beginPath()
    if (typeof ctx.ellipse === 'function') {
        ctx.ellipse(cxOut, cyOut, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2)
    } else {
        const erx = Math.max(1, rx)
        const ery = Math.max(1, ry)
        ctx.translate(cxOut, cyOut)
        ctx.scale(erx, ery)
        ctx.arc(0, 0, 1, 0, Math.PI * 2)
        ctx.clip()
        ctx.scale(1 / erx, 1 / ery)
        ctx.translate(-cxOut, -cyOut)
        ctx.drawImage(video, 0, 0, vw, vh, 0, 0, tw, th)
        ctx.restore()
        return canvas
    }
    ctx.clip()
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, tw, th)
    ctx.restore()
    return canvas
}

export function buildVerifyFrameJpegBase64FromVideo(
    video: HTMLVideoElement,
    ovalMetrics: OvalVideoMetrics | null,
    tw: number,
    th: number,
    jpegQuality: number,
): string {
    const canvas = renderOvalMaskedFrameToCanvas(video, ovalMetrics, tw, th)
    return canvas.toDataURL('image/jpeg', jpegQuality).split(',')[1]
}

/**
 * Dibuja `video` en `ctx` recortando el CENTRO al aspecto ancho:alto de
 * destino (tw:th) antes de escalar -- mismo criterio que CSS
 * `object-fit: cover`. Hallazgo real 2026-09-07: `drawImage(video, 0, 0,
 * vw, vh, 0, 0, tw, th)` con tw:th fijo en 4:3 (FACIAL_ICAO.CAMERA,
 * 960×720) ESTIRABA el frame cuando el aspecto nativo de la cámara no era
 * 4:3 -- muy común en webcams/laptops modernas, nativamente 16:9. Esa
 * imagen distorsionada es la que de verdad procesa MediaPipe en el motor
 * IA: el óvalo facial que ajusta cv::fitEllipse sobre los puntos del
 * contorno (ai_engine_client.cpp) heredaba la deformación, viéndose "más
 * circular" o achatado según el sentido del estiramiento -- no era un
 * problema de proporción del óvalo en sí, sino de la imagen fuente ya
 * deformada antes de que el motor la viera. Recortar en vez de estirar
 * mantiene el tamaño de salida (tw×th) sin tocar ningún supuesto aguas
 * abajo (backend, avatar, plantilla) que ya asume esas dimensiones -- sólo
 * cambia el encuadre capturado cuando la cámara no es nativamente 4:3
 * (pierde algo de campo de visión en el eje más largo, en vez de deformar).
 */
export function drawVideoCoverCropped(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    tw: number,
    th: number
): void {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (vw < 1 || vh < 1 || tw < 1 || th < 1) {
        ctx.drawImage(video, 0, 0, Math.max(1, tw), Math.max(1, th))
        return
    }
    const srcAspect = vw / vh
    const dstAspect = tw / th
    let sx = 0
    let sy = 0
    let sw = vw
    let sh = vh
    if (srcAspect > dstAspect) {
        // Fuente más ancha que el destino -- recorta los costados, centrado.
        sw = vh * dstAspect
        sx = (vw - sw) / 2
    } else if (srcAspect < dstAspect) {
        // Fuente más alta que el destino -- recorta arriba/abajo, centrado.
        sh = vw / dstAspect
        sy = (vh - sh) / 2
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, tw, th)
}

/**
 * Frame completo (sin máscara de óvalo), alineado al enfoque de C:\rostro.
 */
export function buildFullFrameJpegBase64FromVideo(video: HTMLVideoElement, tw: number, th: number, jpegQuality: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')!
    drawVideoCoverCropped(ctx, video, tw, th)
    return canvas.toDataURL('image/jpeg', jpegQuality).split(',')[1]
}

/**
 * Puntaje 0..100 para escoger el mejor fotograma ya aprobado por los gates
 * ICAO/liveness. Mide el recorte facial, no el fondo: nitidez (varianza de
 * Laplaciano), exposición, clipping y tamaño útil del rostro.
 */
export function estimateAvatarFrameQuality(
    video: HTMLVideoElement,
    faceBox: FaceBox | null | undefined,
): number {
    const vw = video.videoWidth || 0
    const vh = video.videoHeight || 0
    if (!faceBox || vw < 32 || vh < 32 || faceBox.width < 16 || faceBox.height < 16) {
        return 0
    }
    const padX = faceBox.width * 0.12
    const padY = faceBox.height * 0.12
    const x0 = Math.max(0, Math.floor(faceBox.x - padX))
    const y0 = Math.max(0, Math.floor(faceBox.y - padY))
    const x1 = Math.min(vw, Math.ceil(faceBox.x + faceBox.width + padX))
    const y1 = Math.min(vh, Math.ceil(faceBox.y + faceBox.height + padY))
    const sw = Math.max(1, x1 - x0)
    const sh = Math.max(1, y1 - y0)
    const size = 96
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return 0
    ctx.drawImage(video, x0, y0, sw, sh, 0, 0, size, size)
    const rgba = ctx.getImageData(0, 0, size, size).data
    const gray = new Float32Array(size * size)
    let sum = 0
    let clipped = 0
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
        const lum = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114
        gray[p] = lum
        sum += lum
        if (lum < 12 || lum > 245) clipped += 1
    }
    const mean = sum / gray.length
    let lapSum = 0
    let lapSqSum = 0
    let lapCount = 0
    for (let y = 1; y < size - 1; y += 1) {
        for (let x = 1; x < size - 1; x += 1) {
            const i = y * size + x
            const lap =
                4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size]
            lapSum += lap
            lapSqSum += lap * lap
            lapCount += 1
        }
    }
    const lapMean = lapSum / Math.max(1, lapCount)
    const lapVariance = Math.max(0, lapSqSum / Math.max(1, lapCount) - lapMean * lapMean)
    const sharpness = Math.min(1, lapVariance / 850)
    const exposure = Math.max(0, 1 - Math.abs(mean - 135) / 115)
    const clipping = clipped / gray.length
    const faceScale = Math.min(1, faceBox.width / Math.max(1, vw * 0.34))
    // Penaliza el recorte de frente: el óvalo del busto (frameToBustRectAroundOvalJpegBase64)
    // extiende el crop por encima del faceBox (30% del alto del óvalo desde
    // 2026-09-09, subido de 0.12 tras un segundo incidente real de pelo
    // cortado en línea recta -- ver comentario de esa función), así que un
    // faceBox ya pegado al borde superior del frame (mirar hacia abajo cerca
    // de la cámara, típico de webcam de laptop por encima de la pantalla)
    // termina con la frente/coronilla cortada en el avatar aunque el frame
    // pase el gate ICAO (pitch_ratio tolera hasta 0.95, ver eye_analyzer.py)
    // -- hallazgo real 2026-09-04 (incidente DNI 09637600). No se bloquea el
    // frame, solo se penaliza fuerte para que un frame mejor encuadrado gane
    // el puntaje si existe uno entre los ya aprobados por ICAO/liveness.
    const topMarginRatio = faceBox.y / Math.max(1, vh)
    const framingPenalty =
        topMarginRatio < 0.1 ? (0.1 - topMarginRatio) / 0.1 : 0
    // Ampliación 2026-09-04 (incidente real "HHJ HJHJ"): además del recorte de
    // frente, otras dos formas de mal encuadre llegaban intactas al avatar
    // porque ningún gate ICAO las mira -- el resultado era un primer plano
    // descentrado que el pipeline de estilizado no puede arreglar (ver
    // _diffusion_reframe_pad en ai_engine/eye_analyzer.py: puede dar aire
    // alrededor del rostro, no puede recuperar lo que la cámara no capturó).
    //
    // 1) Demasiado cerca: por encima de ~0.45 del ancho del frame el busto
    //    sale sin cuello ni hombros y la coronilla queda fuera. Ojo: faceScale
    //    premia rostros grandes hasta 0.34 del ancho -- sin esta penalización
    //    "más cerca" era siempre "mejor puntaje", sin techo.
    // 2) Descentrado horizontal: el óvalo se compone alrededor del rostro, así
    //    que un rostro pegado a un borde arrastra medio fondo al avatar.
    //
    // Igual que la penalización de frente: NO bloquea el frame (un encuadre
    // imperfecto sigue siendo mejor que no poder registrarse en una webcam de
    // laptop), solo hace que gane un frame mejor encuadrado si existe alguno
    // entre los ya aprobados por ICAO/liveness.
    const faceWidthRatio = faceBox.width / Math.max(1, vw)
    const tooCloseRatio = 0.45
    const tooClosePenalty =
        faceWidthRatio > tooCloseRatio
            ? Math.min(1, (faceWidthRatio - tooCloseRatio) / 0.25)
            : 0
    const faceCenterX = (faceBox.x + faceBox.width * 0.5) / Math.max(1, vw)
    const offCenter = Math.abs(faceCenterX - 0.5)
    const offCenterPenalty = offCenter > 0.1 ? Math.min(1, (offCenter - 0.1) / 0.2) : 0
    return Math.max(
        0,
        Math.min(
            100,
            100 * (0.56 * sharpness + 0.29 * exposure + 0.15 * faceScale) -
                45 * clipping -
                60 * framingPenalty -
                50 * tooClosePenalty -
                40 * offCenterPenalty,
        ),
    )
}

export interface OvalLayout {
    leftPct: number;
    topPct: number;
    wPct: number;
    hPct: number;
    transform: string;
}

export function computeBiometricOvalLayout(box: FaceBox | null | undefined, vw: number, vh: number): OvalLayout | null {
    if (FACIAL_STRICT_OVAL_MODE) {
        return {
            leftPct: 50 - OVAL_UI_CENTER_OFFSET_LEFT_FRAC * 100,
            topPct: 50,
            wPct: FACIAL_STRICT_OVAL_W_PCT,
            hPct: FACIAL_STRICT_OVAL_H_PCT,
            transform: 'translate(-50%, -50%)',
        }
    }
    const m = getBiometricOvalVideoMetrics(box, vw, vh)
    if (!m) {
        return null
    }
    return {
        leftPct: (m.cx / vw) * 100,
        topPct: (m.cy / vh) * 100,
        wPct: (m.ow / vw) * 100,
        hPct: (m.oh / vh) * 100,
        transform: 'translate(-50%, -50%)',
    }
}

export function mapOvalLayoutVideoToStage(layout: OvalLayout, vw: number, vh: number, stageW: number, stageH: number): OvalLayout {
    if (stageW < 8 || stageH < 8 || vw < 32 || vh < 32) {
        return layout
    }
    const cx = (layout.leftPct / 100) * vw
    const cy = (layout.topPct / 100) * vh
    const ow = (layout.wPct / 100) * vw
    const oh = (layout.hPct / 100) * vh

    const scale = Math.min(stageW / vw, stageH / vh)
    const dispW = vw * scale
    const dispH = vh * scale
    const offX = (stageW - dispW) / 2
    const offY = (stageH - dispH) / 2

    const scx = offX + cx * scale
    const scy = offY + cy * scale
    const sow = ow * scale
    const soh = oh * scale

    const wS = (sow / stageW) * 100
    const hS = (soh / stageH) * 100
    return {
        leftPct: (scx / stageW) * 100,
        topPct: (scy / stageH) * 100,
        wPct: wS,
        hPct: hS,
        transform: layout.transform,
    }
}

function normalizeVector(vector: number[]): number[] {
    const max = Math.max(...vector, 1)
    if (max === 0) {
        return vector
    }
    return vector.map((v) => Number((v / max).toFixed(6)))
}

/**
 * Plantilla 24×24 legacy: misma fuente que validación (640×480 enmascarado al óvalo).
 */
export function frameToTemplate(videoElement: HTMLVideoElement, faceBox: FaceBox | null | undefined): number[] {
    const sourceWidth = videoElement.videoWidth || 960
    const sourceHeight = videoElement.videoHeight || 540
    const tw = FACIAL_ICAO.CAMERA.width.ideal
    const th = FACIAL_ICAO.CAMERA.height.ideal
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = tw
    sourceCanvas.height = th
    const sourceCtx = sourceCanvas.getContext('2d')!
    sourceCtx.drawImage(videoElement, 0, 0, sourceWidth, sourceHeight, 0, 0, tw, th)

    const size = 24
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(sourceCanvas, 0, 0, size, size)
    const pixels = context.getImageData(0, 0, size, size).data

    const vector: number[] = []
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i]
        const g = pixels[i + 1]
        const b = pixels[i + 2]
        const gray = r * 0.299 + g * 0.587 + b * 0.114
        vector.push(gray)
    }

    return normalizeVector(vector)
}

/**
 * JPEG base64 del rostro para login/registro: 640×480 con máscara de óvalo.
 */
export function frameToJpegBase64(videoElement: HTMLVideoElement, faceBox: FaceBox | null | undefined, jpegQuality = FACE_SNAPSHOT_JPEG_QUALITY): string {
    const tw = FACIAL_ICAO.CAMERA.width.ideal
    const th = FACIAL_ICAO.CAMERA.height.ideal
    return buildFullFrameJpegBase64FromVideo(videoElement, tw, th, jpegQuality)
}

/**
 * Recorte del rostro dentro del óvalo biométrico a resolución nativa del video (luego limita el lado largo).
 * Solo base64 JPEG (sin prefijo data:) para generar avatar en servidor.
 */
export function frameToOvalPortraitJpegBase64(
    videoElement: HTMLVideoElement,
    faceBox: FaceBox | null | undefined,
    maxLongSide = 720,
    jpegQuality = 0.92
): string {
    const vw = videoElement.videoWidth || 960
    const vh = videoElement.videoHeight || 540
    const oval = getBiometricOvalVideoMetrics(faceBox, vw, vh)
    if (!oval) {
        return buildFullFrameJpegBase64FromVideo(
            videoElement,
            Math.min(vw, 960),
            Math.min(vh, 720),
            jpegQuality
        )
    }
    const maskCanvas = renderOvalMaskedFrameToCanvas(videoElement, oval, vw, vh)
    const { cx, cy, ow, oh } = oval
    const pad = Math.max(ow, oh) * 0.03
    const x0 = Math.max(0, Math.floor(cx - ow / 2 - pad))
    const y0 = Math.max(0, Math.floor(cy - oh / 2 - pad))
    const x1 = Math.min(vw, Math.ceil(cx + ow / 2 + pad))
    const y1 = Math.min(vh, Math.ceil(cy + oh / 2 + pad))
    const cw = Math.max(1, x1 - x0)
    const ch = Math.max(1, y1 - y0)
    const crop = document.createElement('canvas')
    crop.width = cw
    crop.height = ch
    crop.getContext('2d')!.drawImage(maskCanvas, x0, y0, cw, ch, 0, 0, cw, ch)
    let tw = cw
    let th = ch
    if (Math.max(tw, th) > maxLongSide) {
        const s = maxLongSide / Math.max(tw, th)
        tw = Math.max(1, Math.round(tw * s))
        th = Math.max(1, Math.round(th * s))
        const scaled = document.createElement('canvas')
        scaled.width = tw
        scaled.height = th
        scaled.getContext('2d')!.drawImage(crop, 0, 0, cw, ch, 0, 0, tw, th)
        return scaled.toDataURL('image/jpeg', jpegQuality).split(',')[1]
    }
    return crop.toDataURL('image/jpeg', jpegQuality).split(',')[1]
}

/**
 * Recorte rectangular SIN máscara negra: incluye el óvalo biométrico ampliado
 * (cuello y algo de hombros) desde el frame nativo de la cámara.
 * Pensado para generar avatar cartoon en servidor (fondo real del recorte; el motor pone blanco).
 *
 * Actualización 2026-09-09: el usuario reportó, con el avatar 4K real ya
 * compuesto, el pelo cortado en línea recta arriba -- confirmado que NO es
 * un problema del compuesto en `ai_engine/eye_analyzer.py` (ese margen ya se
 * subió de 0.06 a 0.22*fh en una sesión anterior): el corte es recto, no
 * sigue el contorno del pelo, señal de que el recorte ocurre ACÁ, en el
 * frame que se manda al servidor, antes de que exista cualquier máscara --
 * si el pelo ya no está en este JPEG, ningún fix del lado servidor puede
 * recuperarlo. `top = cy - oh/2 - oh*0.12` dejaba solo 12% del alto del
 * óvalo de aire arriba, insuficiente para volumen de pelo real (mismo
 * hallazgo que motivó subir el margen equivalente del lado servidor a
 * 0.22, acá se sube más porque además hay que sobrevivir el recorte
 * adicional del backend encima de este). `maxLongSide` en 1280 también
 * limitaba la nitidez por debajo de lo que la cámara ya negocia
 * (`acquireFaceCameraStream`, escalera hasta 1920×1440) -- pedido explícito
 * del usuario de usar la máxima resolución de cámara disponible para la
 * fuente del avatar: subido a 1920, el techo real de esa escalera (subirlo
 * más solo escalaría el JPEG sin agregar detalle real).
 */
export function frameToBustRectAroundOvalJpegBase64(
    videoElement: HTMLVideoElement,
    faceBox: FaceBox | null | undefined,
    maxLongSide = 1920,
    jpegQuality = 0.93
): string {
    const vw = videoElement.videoWidth || 960
    const vh = videoElement.videoHeight || 540
    const oval = getBiometricOvalVideoMetrics(faceBox, vw, vh)
    if (!oval) {
        const tw = Math.min(vw, maxLongSide)
        const th = Math.min(vh, Math.round((maxLongSide * vh) / Math.max(vw, 1)))
        return buildFullFrameJpegBase64FromVideo(videoElement, tw, th, jpegQuality)
    }
    const { cx, cy, ow, oh } = oval
    const halfW = (ow / 2) * 1.58
    const top = cy - oh / 2 - oh * 0.3
    const bottom = cy + oh / 2 + oh * 1.02
    const x0 = Math.max(0, Math.floor(cx - halfW))
    const x1 = Math.min(vw, Math.ceil(cx + halfW))
    const y0 = Math.max(0, Math.floor(top))
    const y1 = Math.min(vh, Math.ceil(bottom))
    const cw = Math.max(1, x1 - x0)
    const ch = Math.max(1, y1 - y0)

    const crop = document.createElement('canvas')
    crop.width = cw
    crop.height = ch
    const ctx = crop.getContext('2d')!
    ctx.drawImage(videoElement, x0, y0, cw, ch, 0, 0, cw, ch)

    let tw = cw
    let th = ch
    if (Math.max(tw, th) > maxLongSide) {
        const s = maxLongSide / Math.max(tw, th)
        tw = Math.max(1, Math.round(tw * s))
        th = Math.max(1, Math.round(th * s))
        const scaled = document.createElement('canvas')
        scaled.width = tw
        scaled.height = th
        scaled.getContext('2d')!.drawImage(crop, 0, 0, cw, ch, 0, 0, tw, th)
        return scaled.toDataURL('image/jpeg', jpegQuality).split(',')[1]
    }
    return crop.toDataURL('image/jpeg', jpegQuality).split(',')[1]
}
