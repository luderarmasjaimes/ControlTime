/**
 * Preprocesado del canvas SOLO para FaceDetector (Chromium); el vídeo mostrado no se altera.
 *
 * --- Pila biométrica (dónde corre cada cosa) ---
 * - Este módulo (JS en navegador): luminancia BT.601, estadística de brillo/ruido, ecualización
 *   de histograma en gris, compresión de highlights, gamma, desenfoque caja 3×3 (estabilizar ruido).
 * - FaceDetector: API nativa del navegador (Chromium → modelos internos, no es OpenCV en cliente).
 * - Respaldo sin landmarks: heurística de píxeles tipo piel en canvas reducido (AuthGateway).
 * - Backend C++ (Beast/Boost): /api/process_frame y payloads login/registro usan JPEG 640×480 enmascarado
 *   al óvalo (`biometricOvalFrame.js`); iluminación ICAO usa solo píxeles > 0.
 * - ai_engine Python: MediaPipe + OpenCV/NumPy sobre ese JPEG.
 * - Dermalog (opcional): CLI/SDK en backend si BIOMETRIC_PROVIDER=dermalog_cli; no participa en el canvas.
 */

/** Luminancia media 0–255 (ITU-R BT.601) sobre ImageData RGBA. */
export function meanLuminanceImageData(imageData: ImageData): number {
    const d = imageData.data
    let sum = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    }
    return n > 0 ? sum / n : 128
}

/** Desviación típica de luminancia Y (misma ponderación BT.601). */
export function luminanceStdDevImageData(imageData: ImageData, mean: number): number {
    const d = imageData.data
    let sumSq = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const t = y - mean
        sumSq += t * t
    }
    return n > 0 ? Math.sqrt(sumSq / n) : 0
}

/**
 * Condiciones “difíciles” (noche + artificial, reflejos en paredes): activa filtros extra solo entonces.
 * Zona intermedia (día nublado / oficina uniforme) → false para no suavizar de más.
 */
export function classifyRawDifficultLighting(mean: number, stdDev: number): boolean {
    if (mean < 88) {
        return true
    }
    if (mean > 128 && stdDev > 40) {
        return true
    }
    if (mean < 145 && stdDev / (mean + 18) > 0.31) {
        return true
    }
    return false
}

/** Ecualización de histograma en escala de grises; escribe RGB con el mismo valor (mejor contraste en sombras). */
export function histogramEqualizeGrayInPlace(imageData: ImageData): void {
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

/** Suaviza reflejos fuertes (pared / luz artificial). aggressive: también con brillo medio-elevado y ruido. */
export function compressHighlightsInPlace(imageData: ImageData, meanLum: number, aggressive = false): void {
    if (!aggressive && meanLum < 165) {
        return
    }
    if (aggressive && meanLum < 72) {
        return
    }
    const d = imageData.data
    const gain = aggressive
        ? meanLum > 200
            ? 0.82
            : meanLum > 155
              ? 0.88
              : 0.92
        : meanLum > 210
          ? 0.88
          : 0.94
    const bias = aggressive
        ? meanLum > 200
            ? -10
            : -6
        : meanLum > 210
          ? -8
          : -4
    for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, Math.max(0, d[i] * gain + bias))
        d[i + 1] = Math.min(255, Math.max(0, d[i + 1] * gain + bias))
        d[i + 2] = Math.min(255, Math.max(0, d[i + 2] * gain + bias))
    }
}

/** Eleva sombras ligeramente (gamma > 1 atenúa curva → más luz en medios tonos). */
export function applyGammaInPlace(imageData: ImageData, gamma: number): void {
    if (gamma <= 1.001) {
        return
    }
    const inv = 1 / gamma
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, Math.round(255 * Math.pow(d[i] / 255, inv)))
        d[i + 1] = Math.min(255, Math.round(255 * Math.pow(d[i + 1] / 255, inv)))
        d[i + 2] = Math.min(255, Math.round(255 * Math.pow(d[i + 2] / 255, inv)))
    }
}

/** Desenfoque caja 3×3 por canal (reduce saltos del detector por ruido puntual / brillos). */
export function boxBlur3x3RGBAInPlace(imageData: ImageData): void {
    const w = imageData.width
    const h = imageData.height
    const src = new Uint8ClampedArray(imageData.data)
    const out = new Uint8ClampedArray(imageData.data.length)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0
            let g = 0
            let b = 0
            let cnt = 0
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy
                if (yy < 0 || yy >= h) {
                    continue
                }
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx
                    if (xx < 0 || xx >= w) {
                        continue
                    }
                    const i = (yy * w + xx) * 4
                    r += src[i]
                    g += src[i + 1]
                    b += src[i + 2]
                    cnt++
                }
            }
            const i = (y * w + x) * 4
            out[i] = Math.round(r / cnt)
            out[i + 1] = Math.round(g / cnt)
            out[i + 2] = Math.round(b / cnt)
            out[i + 3] = src[i + 3]
        }
    }
    imageData.data.set(out)
}

export interface PreprocessOpts {
    /** noche / artificial / reflejos (filtros extra). */
    difficultNightMode: boolean;
    lowLumEqBelow: number;
    highlightCompressAbove: number;
    nightLowLumEqBelow: number;
    nightHighlightCompressAbove: number;
    nightGamma: number;
    nightUseBlur: boolean;
}

/**
 * Preprocesa ImageData ya capturada del ROI de tracking.
 */
export function preprocessImageDataForFaceDetection(imageData: ImageData, opts: PreprocessOpts): number {
    const {
        difficultNightMode,
        lowLumEqBelow,
        highlightCompressAbove,
        nightLowLumEqBelow,
        nightHighlightCompressAbove,
        nightGamma,
        nightUseBlur,
    } = opts

    let mean = meanLuminanceImageData(imageData)

    if (difficultNightMode) {
        if (mean < nightLowLumEqBelow) {
            histogramEqualizeGrayInPlace(imageData)
            mean = meanLuminanceImageData(imageData)
        }
        if (mean < 118) {
            applyGammaInPlace(imageData, nightGamma)
            mean = meanLuminanceImageData(imageData)
        }
        compressHighlightsInPlace(imageData, mean, true)
        mean = meanLuminanceImageData(imageData)
        if (mean > nightHighlightCompressAbove) {
            compressHighlightsInPlace(imageData, mean, true)
        }
        if (nightUseBlur) {
            boxBlur3x3RGBAInPlace(imageData)
        }
    } else {
        if (mean < lowLumEqBelow) {
            histogramEqualizeGrayInPlace(imageData)
            mean = meanLuminanceImageData(imageData)
        } else if (mean > highlightCompressAbove) {
            compressHighlightsInPlace(imageData, mean, false)
        }
    }

    return meanLuminanceImageData(imageData)
}

/**
 * @deprecated Usar preprocessImageDataForFaceDetection tras getImageData para control fino.
 * Mantiene compatibilidad: solo modo “día” interno.
 */
export function preprocessCanvasForFaceDetection(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    opts: { lowLumEqBelow: number; highlightCompressAbove: number },
): number {
    const img = ctx.getImageData(0, 0, width, height)
    preprocessImageDataForFaceDetection(img, {
        difficultNightMode: false,
        lowLumEqBelow: opts.lowLumEqBelow,
        highlightCompressAbove: opts.highlightCompressAbove,
        nightLowLumEqBelow: 100,
        nightHighlightCompressAbove: 140,
        nightGamma: 1.12,
        nightUseBlur: false,
    })
    ctx.putImageData(img, 0, 0)
    return meanLuminanceImageData(img)
}

function medianSorted(arr: number[]): number {
    if (arr.length === 0) {
        return 0
    }
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
}

export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
    landmarks?: unknown;
    isFallback?: boolean;
}

/**
 * Mediana por componente del bbox; landmarks del último elemento válido.
 */
export function medianFaceBoundingBox(boxes: (FaceBox | null | undefined)[]): FaceBox | null {
    const valid = boxes.filter(
        (b): b is FaceBox => Boolean(b) && Number.isFinite(b!.x) && Number.isFinite(b!.width) && b!.width > 8 && b!.height > 8
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
export function faceCenterJumpRatio(box: FaceBox | null | undefined, prev: FaceBox | null | undefined): number {
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
