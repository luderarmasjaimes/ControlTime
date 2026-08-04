/**
 * Geometría del óvalo biométrico (alineada con C:\FACIAL FaceDetectionEngine::getMainFaceOval)
 * y render a canvas / JPEG con máscara elíptica. Usado en:
 * - validación periódica (/api/process_frame)
 * - plantilla 24×24 legacy (login/registro)
 * - JPEG de rostro (login/registro)
 */
import { FACIAL_ICAO } from '../config/facialIcaoConfig'
import type { FaceBox } from './faceTrackingUtils'

const FACIAL_CPP_OVAL_W_FACTOR = 0.89
const FACIAL_CPP_OVAL_H_FACTOR = 1.57
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
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    let ow = box.width * FACIAL_CPP_OVAL_W_FACTOR
    let oh = box.height * FACIAL_CPP_OVAL_H_FACTOR
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
 * Frame completo (sin máscara de óvalo), alineado al enfoque de C:\rostro.
 */
export function buildFullFrameJpegBase64FromVideo(video: HTMLVideoElement, tw: number, th: number, jpegQuality: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')!
    const vw = video.videoWidth
    const vh = video.videoHeight
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, tw, th)
    return canvas.toDataURL('image/jpeg', jpegQuality).split(',')[1]
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
        ).split(',')[1]
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
 */
export function frameToBustRectAroundOvalJpegBase64(
    videoElement: HTMLVideoElement,
    faceBox: FaceBox | null | undefined,
    maxLongSide = 1280,
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
    const top = cy - oh / 2 - oh * 0.12
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
