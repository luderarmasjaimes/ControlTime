/**
 * Utilidades para tracking facial estable (baja luz, reflejos, ruido de fondo).
 * El preprocesado solo afecta al canvas enviado a FaceDetector, no al vídeo mostrado.
 */

/** Luminancia media 0–255 (ITU-R BT.601) sobre ImageData RGBA. */
export function meanLuminanceImageData(imageData) {
    const d = imageData.data
    let sum = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    }
    return n > 0 ? sum / n : 128
}

/** Ecualización de histograma en escala de grises; escribe RGB con el mismo valor (mejor contraste en sombras). */
export function histogramEqualizeGrayInPlace(imageData) {
    const d = imageData.data
    const w = imageData.width
    const h = imageData.height
    const pix = w * h
    const gray = new Uint8Array(pix)
    let j = 0
    for (let i = 0; i < d.length; i += 4) {
        gray[j++] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    }
    const hist = new Uint32Array(256)
    for (let i = 0; i < pix; i++) {
        hist[gray[i]]++
    }
    const cdf = new Uint32Array(256)
    cdf[0] = hist[0]
    for (let i = 1; i < 256; i++) {
        cdf[i] = cdf[i - 1] + hist[i]
    }
    let cdfMin = 0
    for (let i = 0; i < 256; i++) {
        if (cdf[i] > 0) {
            cdfMin = cdf[i]
            break
        }
    }
    const denom = Math.max(1, pix - cdfMin)
    const map = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
        map[i] = Math.round(((cdf[i] - cdfMin) / denom) * 255)
    }
    j = 0
    for (let i = 0; i < d.length; i += 4) {
        const v = map[gray[j++]]
        d[i] = v
        d[i + 1] = v
        d[i + 2] = v
    }
}

/** Suaviza reflejos fuertes (pared/luz artificial) sin tocar sombras. */
export function compressHighlightsInPlace(imageData, meanLum) {
    if (meanLum < 165) {
        return
    }
    const d = imageData.data
    const gain = meanLum > 210 ? 0.88 : 0.94
    const bias = meanLum > 210 ? -8 : -4
    for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, Math.max(0, d[i] * gain + bias))
        d[i + 1] = Math.min(255, Math.max(0, d[i + 1] * gain + bias))
        d[i + 2] = Math.min(255, Math.max(0, d[i + 2] * gain + bias))
    }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ lowLumEqBelow: number, highlightCompressAbove: number }} opts
 */
export function preprocessCanvasForFaceDetection(ctx, width, height, opts) {
    const { lowLumEqBelow, highlightCompressAbove } = opts
    const img = ctx.getImageData(0, 0, width, height)
    const mean = meanLuminanceImageData(img)
    if (mean < lowLumEqBelow) {
        histogramEqualizeGrayInPlace(img)
    } else if (mean > highlightCompressAbove) {
        compressHighlightsInPlace(img, mean)
    }
    ctx.putImageData(img, 0, 0)
    return mean
}

function medianSorted(arr) {
    if (arr.length === 0) {
        return 0
    }
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
}

/**
 * Mediana por componente del bbox; landmarks del último elemento válido.
 * @param {Array<{x:number,y:number,width:number,height:number,landmarks?:any,isFallback?:boolean}|null|undefined>} boxes
 */
export function medianFaceBoundingBox(boxes) {
    const valid = boxes.filter(
        (b) => b && Number.isFinite(b.x) && Number.isFinite(b.width) && b.width > 8 && b.height > 8
    )
    if (valid.length === 0) {
        return null
    }
    const last = valid[valid.length - 1]
    return {
        x: medianSorted(valid.map((b) => b.x)),
        y: medianSorted(valid.map((b) => b.y)),
        width: medianSorted(valid.map((b) => b.width)),
        height: medianSorted(valid.map((b) => b.height)),
        landmarks: last.landmarks || [],
        isFallback: Boolean(last.isFallback),
    }
}

/**
 * Salto del centro normalizado por tamaño de referencia del box previo.
 */
export function faceCenterJumpRatio(box, prev) {
    if (!prev || !box) {
        return 0
    }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const pcx = prev.x + prev.width / 2
    const pcy = prev.y + prev.height / 2
    const dist = Math.hypot(cx - pcx, cy - pcy)
    const ref = Math.max(prev.width, prev.height, 1)
    return dist / ref
}
