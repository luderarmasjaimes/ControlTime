/**
 * Tracking facial local (navegador) vía MediaPipe Tasks Vision (WASM),
 * reemplazo de `window.FaceDetector` (Shape Detection API nativa de Chromium,
 * ver ADR-162). Corre EN PROCESO (sin el IPC/Mojo de FaceDetector hacia un
 * proceso aparte) y usa la MISMA topología de 478 landmarks que ya usa
 * `ai_engine/eye_analyzer.py` en el servidor -- los índices de ojos/boca/
 * contorno de aquí son una copia literal de ese archivo (LEFT_EYE, RIGHT_EYE,
 * FACEMESH_FACE_OVAL, mar_inner_ratio). Si cambian de un lado, deben
 * cambiar del otro.
 *
 * Assets self-hosted en frontend/public/mediapipe/ (WASM + modelo .task):
 * el CSP de nginx.conf usa `connect-src 'self'`, así que no se puede apuntar
 * al CDN de Google como hacen los ejemplos oficiales de MediaPipe.
 */
import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { log } from '../lib/logger'
import type { FaceBox } from './faceTrackingUtils'

/** Copia de FACE_OVAL_INDICES en ai_engine/eye_analyzer.py (FACEMESH_FACE_OVAL, 36 puntos). */
export const FACE_OVAL_INDICES = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

/** Copia de LEFT_EYE/RIGHT_EYE en ai_engine/eye_analyzer.py (orden EAR estándar Soukupová-Čech). */
export const LEFT_EYE_EAR_INDICES = [33, 160, 158, 133, 153, 144]
export const RIGHT_EYE_EAR_INDICES = [362, 385, 387, 263, 373, 380]

/** Copia de los índices usados en mar_inner_ratio() de ai_engine/eye_analyzer.py. */
const MOUTH_MAR_TOP = 13
const MOUTH_MAR_BOTTOM = 14
const MOUTH_MAR_LEFT = 78
const MOUTH_MAR_RIGHT = 308

const WASM_BASE_PATH = '/mediapipe/wasm'
const MODEL_ASSET_PATH = '/mediapipe/models/face_landmarker.task'

export interface FaceLandmarkerFaceBox extends FaceBox {
    /** Siempre vacío desde ADR-162: eye/mouth ya no salen de aquí, ver `ear`/`mouthMarRatio` abajo. */
    landmarks: any[];
    /** Eye-Aspect-Ratio real (6 puntos) por ojo -- reemplaza el ratio ancho/alto de FaceDetector. */
    ear: { left: number; right: number };
    /** Centro de cada ojo (promedio de sus 6 puntos EAR) en píxeles -- para chequeo de roll/alineación. */
    eyeCenters: { left: { x: number; y: number }; right: { x: number; y: number } };
    /** Apertura vertical interna / ancho boca -- misma fórmula que mar_inner_ratio() en Python. */
    mouthMarRatio: number;
    /** Contorno facial real (36 puntos, FACEMESH_FACE_OVAL) en píxeles de la grilla pw×ph. */
    ovalPoints: { x: number; y: number }[];
}

interface TrackerState {
    instance: FaceLandmarker | null;
    loading: boolean;
    failed: boolean;
}

const state: TrackerState = { instance: null, loading: false, failed: false }

async function createLandmarker(delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)
    return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
            modelAssetPath: MODEL_ASSET_PATH,
            delegate,
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
    })
}

/**
 * Dispara la carga (una sola vez, no bloqueante) del modelo. Llamar desde el
 * loop de tracking en cada tick es seguro -- es un no-op mientras ya está
 * cargando/cargado/falló.
 */
export function ensureFaceLandmarkerLoading(): void {
    if (state.instance || state.loading || state.failed) {
        return
    }
    state.loading = true
    createLandmarker('GPU')
        .catch((gpuErr) => {
            log.warn('[MEDIAPIPE] fallo delegate GPU, reintentando con CPU', { error: String(gpuErr) })
            return createLandmarker('CPU')
        })
        .then((landmarker) => {
            state.instance = landmarker
            state.loading = false
        })
        .catch((err) => {
            state.failed = true
            state.loading = false
            log.error('[MEDIAPIPE] no se pudo inicializar FaceLandmarker, cae a fallback heurístico', {
                error: String(err),
            })
        })
}

export function getFaceLandmarker(): Readonly<TrackerState> {
    return state
}

function landmarkDistPx(a: NormalizedLandmark, b: NormalizedLandmark, pw: number, ph: number): number {
    const dx = (a.x - b.x) * pw
    const dy = (a.y - b.y) * ph
    return Math.hypot(dx, dy)
}

/** Misma fórmula que calculate_ear() en ai_engine/eye_analyzer.py. */
function calcEar(points: NormalizedLandmark[], idx: number[], pw: number, ph: number): number {
    const v1 = landmarkDistPx(points[idx[1]], points[idx[5]], pw, ph)
    const v2 = landmarkDistPx(points[idx[2]], points[idx[4]], pw, ph)
    const h = landmarkDistPx(points[idx[0]], points[idx[3]], pw, ph)
    return (v1 + v2) / (2 * h + 1e-6)
}

function eyeCenterPx(points: NormalizedLandmark[], idx: number[], pw: number, ph: number): { x: number; y: number } {
    let sx = 0
    let sy = 0
    for (const i of idx) {
        sx += points[i].x
        sy += points[i].y
    }
    return { x: (sx / idx.length) * pw, y: (sy / idx.length) * ph }
}

/**
 * Convierte los 478 landmarks normalizados (0..1) de un resultado de
 * detección a un `FaceLandmarkerFaceBox` en la grilla de píxeles pw×ph --
 * mismo espacio de coordenadas que ya usa el resto del tracking local
 * (isImplausibleFaceJump, EMA, mhist, etc. en AuthGateway.tsx).
 */
export function landmarksToFaceBox(landmarks: NormalizedLandmark[], pw: number, ph: number): FaceLandmarkerFaceBox {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of landmarks) {
        const x = p.x * pw
        const y = p.y * ph
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }
    const ovalPoints = FACE_OVAL_INDICES.map((i) => ({
        x: landmarks[i].x * pw,
        y: landmarks[i].y * ph,
    }))
    const ear = {
        left: calcEar(landmarks, LEFT_EYE_EAR_INDICES, pw, ph),
        right: calcEar(landmarks, RIGHT_EYE_EAR_INDICES, pw, ph),
    }
    const eyeCenters = {
        left: eyeCenterPx(landmarks, LEFT_EYE_EAR_INDICES, pw, ph),
        right: eyeCenterPx(landmarks, RIGHT_EYE_EAR_INDICES, pw, ph),
    }
    const ver = landmarkDistPx(landmarks[MOUTH_MAR_TOP], landmarks[MOUTH_MAR_BOTTOM], pw, ph)
    const hor = landmarkDistPx(landmarks[MOUTH_MAR_LEFT], landmarks[MOUTH_MAR_RIGHT], pw, ph)
    const mouthMarRatio = ver / (hor + 1e-6)
    return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        landmarks: [],
        ear,
        eyeCenters,
        mouthMarRatio,
        ovalPoints,
    }
}
