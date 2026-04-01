import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Camera,
    Building2,
    UserRound,
    KeyRound,
    ScanFace,
    UserPlus,
    ShieldCheck,
    AlertTriangle,
} from 'lucide-react'
import {
    clearSession,
    createSession,
    getSession,
} from '../../auth/authStorage'
import {
    fetchCompanies,
    loginWithFace,
    loginWithPassword,
    registerUser,
    verifyBiometricFrame,
    validateCompany,
} from '../../auth/authApi'
import { FACIAL_ICAO } from '../../config/facialIcaoConfig'
import {
    mapVerifyIssuesToIcaoFour,
    formatIcaoCell,
} from '../../auth/biometricFiveHelpers'

const DEFAULT_COMPANIES = ['Minera Raura', 'Compania Minera Volcan', 'Minera Antamina', 'Minera Cerro Verde']

// Recorte enviado al motor IA (coherente con óvalo UI en pantalla)
const BIOMETRIC_OVAL_W_FACTOR = 0.98
const BIOMETRIC_OVAL_H_FACTOR = 1.02
const BIOMETRIC_OVAL_X_OFFSET = 0.12
const BIOMETRIC_OVAL_Y_OFFSET = -0.05

/**
 * Óvalo centrado en el rostro; escala con la distancia a la cámara vía tamaño aparente del box.
 * Rostro pequeño en frame (lejos) → óvalo más amplio respecto al box; grande (cerca) → menos margen.
 */
function computeBiometricOvalLayout(box, vw, vh) {
    if (!box || vw < 32 || vh < 32) {
        return {
            leftPct: 50,
            topPct: 44,
            wPct: 46,
            hPct: 84,
            transform: 'translate(-50%, -50%)',
            gradWPct: 48,
            gradHPct: 80,
        }
    }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const rel = Math.sqrt((box.width / vw) * (box.height / vh))
    const t = Math.min(Math.max((rel - 0.08) / 0.38, 0), 1)
    const proximityScale = 1.42 - t * 0.34
    let ow = box.width * BIOMETRIC_OVAL_W_FACTOR * proximityScale
    let oh = box.height * BIOMETRIC_OVAL_H_FACTOR * proximityScale
    const wPct = Math.min((ow / vw) * 100, 90)
    const hPct = Math.min((oh / vh) * 100, 90)
    return {
        leftPct: (cx / vw) * 100,
        topPct: (cy / vh) * 100,
        wPct,
        hPct,
        transform: 'translate(-50%, -50%)',
        gradWPct: Math.min(wPct * 0.55, 48),
        gradHPct: Math.min(hPct * 0.5, 78),
    }
}

function getCropFromFaceBox(videoWidth, videoHeight, faceBox) {
    if (!faceBox) {
        return { x: 0, y: 0, width: videoWidth, height: videoHeight }
    }

    const cropSize = 350;
    const cx = faceBox.x + faceBox.width / 2;
    const cy = faceBox.y + faceBox.height / 2;

    let x = Math.max(0, Math.floor(cx - cropSize / 2));
    let y = Math.max(0, Math.floor(cy - cropSize / 2));

    if (x + cropSize > videoWidth) x = videoWidth - cropSize;
    if (y + cropSize > videoHeight) y = videoHeight - cropSize;
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    return { x, y, width: cropSize, height: cropSize }
}

function normalizeVector(vector) {
    const max = Math.max(...vector, 1)
    if (max === 0) {
        return vector
    }
    return vector.map((v) => Number((v / max).toFixed(6)))
}

function frameToTemplate(videoElement, cropBox) {
    const sourceWidth = videoElement.videoWidth || 960
    const sourceHeight = videoElement.videoHeight || 540
    const crop = getCropFromFaceBox(sourceWidth, sourceHeight, cropBox)

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = crop.width
    sourceCanvas.height = crop.height
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
    sourceContext.drawImage(
        videoElement,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
    )

    const size = 24
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })

    context.drawImage(sourceCanvas, 0, 0, size, size)
    const pixels = context.getImageData(0, 0, size, size).data

    const vector = []
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i]
        const g = pixels[i + 1]
        const b = pixels[i + 2]
        const gray = r * 0.299 + g * 0.587 + b * 0.114
        vector.push(gray)
    }

    return normalizeVector(vector)
}

function frameToJpegBase64(videoElement, cropBox) {
    const sourceWidth = videoElement.videoWidth || 960
    const sourceHeight = videoElement.videoHeight || 540
    const crop = getCropFromFaceBox(sourceWidth, sourceHeight, cropBox)

    const canvas = document.createElement('canvas')
    canvas.width = crop.width
    canvas.height = crop.height
    const context = canvas.getContext('2d')
    context.drawImage(
        videoElement,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
    )
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const [, base64 = ''] = dataUrl.split(',')
    return base64
}

const getSkinCentroid = (ctx, w, h) => {
    try {
        const data = ctx.getImageData(0, 0, w, h).data;
        let sumX = 0, sumY = 0, count = 0;
        for (let y = 0; y < h; y += 4) {
            for (let x = 0; x < w; x += 4) {
                const i = (y * w + x) * 4;
                const r = data[i], g = data[i+1], b = data[i+2];
                if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
                    sumX += x; sumY += y; count++;
                }
            }
        }
        if (count < 50) return null;
        return { x: sumX / count, y: sumY / count, density: count / (w * h / 16) };
    } catch { return null; }
};
const skinPixelRatio = (ctx, x, y, w, h) => {
    try {
        const data = ctx.getImageData(x, y, w, h).data;
        let skinPixels = 0;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            // Simple skin tone heuristic: R > 95, G > 40, B > 20, R > G, R > B, |R-G| > 15
            if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
                skinPixels++;
            }
        }
        return skinPixels / (w * h);
    } catch { return 0; }
};

const AuthGateway = ({ onAuthenticated }) => {
    const [mode, setMode] = useState('login')
    const [registerTab, setRegisterTab] = useState('user')
    const [loginTab, setLoginTab] = useState('user')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [cameraReady, setCameraReady] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [companies, setCompanies] = useState(DEFAULT_COMPANIES)

    const [loginForm, setLoginForm] = useState({
        company: DEFAULT_COMPANIES[0],
        username: '',
        password: '',
    })

    const [registerForm, setRegisterForm] = useState({
        company: DEFAULT_COMPANIES[0],
        firstName: '',
        lastName: '',
        dni: '',
        username: '',
        password: '',
        ruc: '',
        phone: '',
        mobile: '',
        email: '',
        role: 'operator',
        rucValid: false,
        isValidatingRuc: false,
    })

    const [capturedTemplate, setCapturedTemplate] = useState(null)
    const [capturedImageBase64, setCapturedImageBase64] = useState('')
    const [liveFaceBox, setLiveFaceBox] = useState(null)
    const [frameMetrics, setFrameMetrics] = useState({ width: 1, height: 1 })
    const [faceGuide, setFaceGuide] = useState({
        detected: false,
        frontal: false,
        eyesOpen: false,
        mouthClosed: false,
        qualityReady: false,
        lastServerOk: false,
        icaoEyes: null,
        icaoMouth: null,
        icaoFrontal: null,
        icaoNoGlasses: null,
        livenessScore: 0,
    })
    const videoRef = useRef(null)
    const streamRef = useRef(null)
    const detectorRef = useRef(null)
    const prevMouthClosedLandmarkRef = useRef(null)
    const lastSyncRef = useRef(0)
    const syncingRef = useRef(false)
    const smoothedFaceRef = useRef(null)
    const lastVerifyOkRef = useRef(false)
    const lastIcaoFourRef = useRef({
        eyes: false,
        mouth: false,
        frontal: false,
        noGlasses: false,
    })
    const livenessBlinkRef = useRef(0)
    const livenessMouthEventsRef = useRef(0)
    const prevEyesOpenLandmarkRef = useRef(null)
    const blinkCloseStartedAtRef = useRef(null)
    const mouthWasOpenPhaseRef = useRef(false)
    const livenessScoreRef = useRef(0)
    const livenessFallbackRef = useRef(0)
    const lastAutoTriggerRef = useRef(0)
    const cameraRetryTimerRef = useRef(null)

    const ovalLayout = useMemo(
        () => computeBiometricOvalLayout(liveFaceBox, frameMetrics.width, frameMetrics.height),
        [liveFaceBox, frameMetrics.width, frameMetrics.height]
    )

    const canRegister = useMemo(() => {
        let valuesOk = false;
        if (registerTab === 'company') {
            valuesOk =
                registerForm.ruc.trim().length >= 11 &&
                registerForm.rucValid &&
                registerForm.company.trim() &&
                registerForm.firstName.trim() &&
                registerForm.lastName.trim() &&
                registerForm.dni.trim().length >= 8 &&
                registerForm.username.trim().length >= 4 &&
                registerForm.password.trim().length >= 6;
        } else {
            valuesOk =
                registerForm.company.trim() &&
                registerForm.firstName.trim() &&
                registerForm.lastName.trim() &&
                registerForm.dni.trim().length >= 8 &&
                registerForm.email.trim().length >= 5 &&
                registerForm.username.trim().length >= 4 &&
                registerForm.password.trim().length >= 6;
        }
        // Permissive: capturedImageBase64 is enough to signal intent
        return valuesOk && Boolean(capturedImageBase64)
    }, [registerForm, capturedImageBase64, registerTab])

    useEffect(() => {
        const session = getSession()
        if (session) {
            onAuthenticated(session)
        }
    }, [onAuthenticated])

    useEffect(() => {
        let active = true

        async function loadCompanies() {
            try {
                const apiCompanies = await fetchCompanies()
                if (!active || apiCompanies.length === 0) {
                    return
                }

                setCompanies(apiCompanies)
                setLoginForm((prev) => ({ ...prev, company: apiCompanies[0] }))
                setRegisterForm((prev) => ({ ...prev, company: apiCompanies[0] }))
            } catch {
                setCompanies(DEFAULT_COMPANIES)
            }
        }

        loadCompanies()
        return () => {
            active = false
        }
    }, [])

    // Real-time RUC validation
    useEffect(() => {
        if (registerTab !== 'company' || registerForm.ruc.length < 11) {
            setRegisterForm(prev => ({ ...prev, rucValid: false, isValidatingRuc: false }));
            return;
        }

        const timeoutId = setTimeout(async () => {
            setRegisterForm(prev => ({ ...prev, isValidatingRuc: true }));
            try {
                const isValid = await validateCompany(registerForm.company, registerForm.ruc);
                setRegisterForm(prev => ({ ...prev, rucValid: isValid, isValidatingRuc: false }));
            } catch (err) {
                console.error("RUC Validation error:", err);
                setRegisterForm(prev => ({ ...prev, rucValid: false, isValidatingRuc: false }));
            }
        }, 800);

        return () => clearTimeout(timeoutId);
    }, [registerForm.ruc, registerForm.company, registerTab]);

    useEffect(() => {
        let cancelled = false

        const stopCurrentStream = () => {
            const cur = streamRef.current
            if (cur && typeof cur.getTracks === 'function') {
                cur.getTracks().forEach((track) => track.stop())
            }
            streamRef.current = null
            if (videoRef.current) {
                videoRef.current.srcObject = null
            }
        }

        async function startCamera() {
            if (!navigator.mediaDevices?.getUserMedia) {
                setError('API de cámara no disponible en este navegador.')
                setCameraReady(false)
                return
            }
            stopCurrentStream()
            if (cameraRetryTimerRef.current) {
                clearTimeout(cameraRetryTimerRef.current)
                cameraRetryTimerRef.current = null
            }
            try {
                let stream
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: 'user',
                            ...FACIAL_ICAO.CAMERA,
                        },
                        audio: false,
                    })
                } catch {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'user' },
                        audio: false,
                    })
                }

                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }

                streamRef.current = stream
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                    videoRef.current.muted = true
                    videoRef.current.setAttribute('playsinline', '')
                    await videoRef.current.play().catch(() => {})
                }

                setCameraReady(true)
                setError('')
                if (videoRef.current) {
                    videoRef.current.onloadedmetadata = () => {
                        videoRef.current?.play().catch((e) =>
                            console.warn('Reproducción automática:', e)
                        )
                    }
                }
            } catch (err) {
                const name = err?.name || ''
                if (name === 'NotReadableError' || name === 'TrackStartError') {
                    setError('Cámara en uso. Cierre otras aplicaciones; reintentando…')
                } else if (name === 'NotAllowedError') {
                    setError('Permiso de cámara denegado.')
                } else {
                    setError('No se pudo abrir la cámara. Verifique permisos del navegador.')
                }
                setCameraReady(false)
                if (!cancelled && !cameraRetryTimerRef.current) {
                    cameraRetryTimerRef.current = setTimeout(() => {
                        cameraRetryTimerRef.current = null
                        startCamera()
                    }, FACIAL_ICAO.CAMERA_RETRY_MS)
                }
            }
        }

        startCamera()

        return () => {
            cancelled = true
            if (cameraRetryTimerRef.current) {
                clearTimeout(cameraRetryTimerRef.current)
                cameraRetryTimerRef.current = null
            }
            stopCurrentStream()
        }
    }, [])

    useEffect(() => {
        let requestID = null
        let lastTimestamp = 0

        async function detectFaceLoop(timestamp) {
            const video = videoRef.current
            
            if (timestamp - lastTimestamp < FACIAL_ICAO.DETECT_FRAME_MIN_MS) {
                requestID = requestAnimationFrame(detectFaceLoop)
                return
            }
            lastTimestamp = timestamp

            if (!video || !cameraReady || video.videoWidth < 32 || video.videoHeight < 32) {
                requestID = requestAnimationFrame(detectFaceLoop)
                return
            }

            if (frameMetrics.width !== video.videoWidth) {
                setFrameMetrics({ width: video.videoWidth, height: video.videoHeight })
            }

            try {
                let bestFace = null

                // --- Low-Light Adaptive ROI Preprocessing (Frontend) ---
                // Focus detection ONLY on the central region to avoid background noise
                const roiW = video.videoWidth * 0.6;
                const roiH = video.videoHeight * 0.8;
                const roiX = (video.videoWidth - roiW) / 2;
                const roiY = (video.videoHeight - roiH) / 2;

                const trackingCanvas = document.createElement('canvas');
                trackingCanvas.width = roiW / 2; 
                trackingCanvas.height = roiH / 2;
                const trackingCtx = trackingCanvas.getContext('2d');
                // Apply Gamma-like correction and contrast boost
                trackingCtx.filter = 'contrast(1.4) brightness(1.2) saturate(1.1)';
                trackingCtx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, trackingCanvas.width, trackingCanvas.height);

                if ('FaceDetector' in window) {
                    if (!detectorRef.current) {
                        detectorRef.current = new window.FaceDetector({
                            maxDetectedFaces: 1,
                        })
                    }

                    // Detect on the enhanced ROI image
                    const detections = await detectorRef.current.detect(trackingCanvas)
                    if (detections.length > 0) {
                        const box = detections[0].boundingBox
                        // Rescale back to original video dimensions relative to ROI
                        bestFace = {
                            x: roiX + box.x * 2,
                            y: roiY + box.y * 2,
                            width: box.width * 2,
                            height: box.height * 2,
                            landmarks: (detections[0].landmarks || []).map(l => ({
                                ...l,
                                locations: l.locations.map(loc => ({ x: roiX + loc.x * 2, y: roiY + loc.y * 2 }))
                            })),
                        }
                    }
                }

                // --- Dynamic Face Oval Fallback (Centroid Tracking) ---
                if (!bestFace) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 160; canvas.height = 120;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, 160, 120);
                    const centroid = getSkinCentroid(ctx, 160, 120);
                    if (centroid && centroid.density > 0.05) {
                        const targetWidth = video.videoWidth * 0.45;
                        const targetHeight = video.videoHeight * 0.75;
                        bestFace = {
                            x: (centroid.x / 160) * video.videoWidth - targetWidth / 2,
                            y: (centroid.y / 120) * video.videoHeight - targetHeight / 2,
                            width: targetWidth,
                            height: targetHeight,
                            landmarks: [],
                            isFallback: true
                        }
                    }
                }

                let frontal = false
                let hasLandmarks = false
                let eyesOpen = false
                let mouthClosed = false

                if (!bestFace) {
                    setLiveFaceBox(null)
                    smoothedFaceRef.current = null
                    lastVerifyOkRef.current = false
                    livenessBlinkRef.current = 0
                    livenessMouthEventsRef.current = 0
                    prevEyesOpenLandmarkRef.current = null
                    blinkCloseStartedAtRef.current = null
                    mouthWasOpenPhaseRef.current = false
                    livenessScoreRef.current = 0
                    livenessFallbackRef.current = 0
                    prevMouthClosedLandmarkRef.current = null
                    lastIcaoFourRef.current = {
                        eyes: false,
                        mouth: false,
                        frontal: false,
                        noGlasses: false,
                    }
                    setFaceGuide((prev) => ({
                        ...prev,
                        detected: false,
                        qualityReady: false,
                        lastServerOk: false,
                        icaoEyes: null,
                        icaoMouth: null,
                        icaoFrontal: null,
                        icaoNoGlasses: null,
                        livenessScore: 0,
                    }))
                } else {
                    if (smoothedFaceRef.current) {
                        const alpha = FACIAL_ICAO.FACE_BOX_EMA_ALPHA
                        const prev = smoothedFaceRef.current
                        bestFace = {
                            x: prev.x + alpha * (bestFace.x - prev.x),
                            y: prev.y + alpha * (bestFace.y - prev.y),
                            width: prev.width + alpha * (bestFace.width - prev.width),
                            height: prev.height + alpha * (bestFace.height - prev.height),
                            landmarks: bestFace.landmarks,
                            isFallback: bestFace.isFallback,
                        }
                    }
                    smoothedFaceRef.current = bestFace
                    setLiveFaceBox(bestFace)

                    const aspect = bestFace.width / Math.max(1, bestFace.height)
                    const frontalByAspect =
                        aspect > FACIAL_ICAO.FRONTAL_ASPECT_MIN &&
                        aspect < FACIAL_ICAO.FRONTAL_ASPECT_MAX

                    hasLandmarks = bestFace.landmarks.length > 0
                    const leftEye = bestFace.landmarks.find(
                        (l) => l.type === 'leftEye' || l.type === 'eye'
                    )
                    const rightEye = bestFace.landmarks.find((l) => l.type === 'rightEye')
                    const eyeYRatio = FACIAL_ICAO.MAX_EYE_Y_DELTA_RATIO
                    const eyesAligned = hasLandmarks
                        ? leftEye && rightEye
                            ? Math.abs(leftEye.locations[0].y - rightEye.locations[0].y) <
                              bestFace.height * eyeYRatio
                            : true
                        : true

                    const eyeOpenness = (eye) => {
                        if (!eye || !Array.isArray(eye.locations) || eye.locations.length < 2)
                            return 0.5
                        const ys = eye.locations.map((p) => p.y)
                        const xs = eye.locations.map((p) => p.x)
                        return (
                            (Math.max(...ys) - Math.min(...ys)) /
                            Math.max(1, Math.max(...xs) - Math.min(...xs))
                        )
                    }
                    const mouth = bestFace.landmarks.find((l) => l.type === 'mouth')
                    const mouthRatio = (() => {
                        if (!mouth || !Array.isArray(mouth.locations) || mouth.locations.length < 2)
                            return 0.08
                        const ys = mouth.locations.map((p) => p.y)
                        const xs = mouth.locations.map((p) => p.x)
                        return (
                            (Math.max(...ys) - Math.min(...ys)) /
                            Math.max(1, Math.max(...xs) - Math.min(...xs))
                        )
                    })()

                    const earHint = FACIAL_ICAO.EAR_OPEN_HINT
                    eyesOpen = hasLandmarks
                        ? eyeOpenness(leftEye) > earHint && eyeOpenness(rightEye) > earHint
                        : false
                    const isMouthOpen = hasLandmarks
                        ? mouthRatio > FACIAL_ICAO.MOUTH_OPEN_LANDMARK_RATIO
                        : false
                    mouthClosed = hasLandmarks ? !isMouthOpen : false
                    frontal = frontalByAspect && eyesAligned

                    const now = performance.now()

                    if (hasLandmarks) {
                        const prevO = prevEyesOpenLandmarkRef.current
                        if (prevO === true && !eyesOpen) {
                            blinkCloseStartedAtRef.current = now
                        }
                        if (
                            prevO === false &&
                            eyesOpen &&
                            blinkCloseStartedAtRef.current != null
                        ) {
                            const dtBlink = now - blinkCloseStartedAtRef.current
                            if (dtBlink > 80 && dtBlink < 700) {
                                livenessBlinkRef.current += 1
                            }
                            blinkCloseStartedAtRef.current = null
                        }
                        if (
                            !eyesOpen &&
                            blinkCloseStartedAtRef.current != null &&
                            now - blinkCloseStartedAtRef.current > 900
                        ) {
                            blinkCloseStartedAtRef.current = null
                        }
                        prevEyesOpenLandmarkRef.current = eyesOpen

                        const prevM = prevMouthClosedLandmarkRef.current
                        if (prevM === true && !mouthClosed) {
                            mouthWasOpenPhaseRef.current = true
                        }
                        if (mouthWasOpenPhaseRef.current && mouthClosed) {
                            livenessMouthEventsRef.current += 1
                            mouthWasOpenPhaseRef.current = false
                        }
                        prevMouthClosedLandmarkRef.current = mouthClosed
                    }

                    const lvPts =
                        livenessBlinkRef.current * FACIAL_ICAO.LIVENESS_POINTS_PER_BLINK +
                        livenessMouthEventsRef.current *
                            FACIAL_ICAO.LIVENESS_POINTS_PER_MOUTH_EVENT
                    livenessScoreRef.current = Math.min(
                        FACIAL_ICAO.LIVENESS_MAX_SCORE,
                        lvPts
                    )

                    const hasFaceNow = true

                    const nowSync = performance.now()
                    const isFirstSync = lastSyncRef.current === 0
                    if (
                        hasFaceNow &&
                        !syncingRef.current &&
                        (isFirstSync ||
                            nowSync - lastSyncRef.current > FACIAL_ICAO.VERIFY_SYNC_MS)
                    ) {
                        syncingRef.current = true
                        lastSyncRef.current = nowSync

                        const cropX = Math.max(0, bestFace.x + bestFace.width * BIOMETRIC_OVAL_X_OFFSET)
                        const cropY = Math.max(0, bestFace.y + bestFace.height * BIOMETRIC_OVAL_Y_OFFSET)
                        const cropW = Math.min(
                            video.videoWidth - cropX,
                            bestFace.width * BIOMETRIC_OVAL_W_FACTOR
                        )
                        const cropH = Math.min(
                            video.videoHeight - cropY,
                            bestFace.height * BIOMETRIC_OVAL_H_FACTOR
                        )

                        const canvas = document.createElement('canvas')
                        canvas.width = cropW
                        canvas.height = cropH
                        const ctx = canvas.getContext('2d')
                        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
                        const base64 = canvas
                            .toDataURL('image/jpeg', FACIAL_ICAO.VERIFY_JPEG_QUALITY)
                            .split(',')[1]

                        verifyBiometricFrame(base64)
                            .then((res) => {
                                syncingRef.current = false
                                lastVerifyOkRef.current = Boolean(res.ok)
                                const four = mapVerifyIssuesToIcaoFour(
                                    res.issues || [],
                                    frontal
                                )
                                lastIcaoFourRef.current = four
                                if (hasLandmarks) {
                                    if (!res.ok) {
                                        livenessFallbackRef.current = 0
                                    }
                                } else if (res.ok) {
                                    livenessFallbackRef.current = Math.min(
                                        FACIAL_ICAO.LIVENESS_MAX_SCORE,
                                        livenessFallbackRef.current +
                                            FACIAL_ICAO.LIVENESS_POINTS_PER_BLINK
                                    )
                                } else {
                                    livenessFallbackRef.current = 0
                                }
                                setFaceGuide((prev) => ({
                                    ...prev,
                                    lastServerOk: res.ok,
                                    icaoEyes: four.eyes,
                                    icaoMouth: four.mouth,
                                    icaoFrontal: four.frontal,
                                    icaoNoGlasses: four.noGlasses,
                                }))
                            })
                            .catch(() => {
                                syncingRef.current = false
                                lastVerifyOkRef.current = false
                            })
                    }

                    setFaceGuide((prev) => {
                        const I = lastIcaoFourRef.current
                        const lv = hasLandmarks
                            ? livenessScoreRef.current
                            : livenessFallbackRef.current
                        const livenessPass =
                            lv >= FACIAL_ICAO.LIVENESS_SCORE_PASS
                        const qualityReady =
                            lastVerifyOkRef.current &&
                            livenessPass &&
                            I.eyes &&
                            I.mouth &&
                            I.frontal &&
                            I.noGlasses

                        const updated = {
                            ...prev,
                            detected: true,
                            frontal,
                            eyesOpen,
                            mouthClosed,
                            livenessScore: lv,
                            qualityReady,
                        }

                        if (updated.qualityReady && hasFaceNow && !capturedImageBase64) {
                            const template = frameToTemplate(video, bestFace)
                            const imageBase64 = frameToJpegBase64(video, bestFace)
                            setCapturedTemplate(template)
                            setCapturedImageBase64(imageBase64)
                        }
                        return updated
                    })
                }
            } catch (err) { console.error("Tracking Error:", err) }
            requestID = requestAnimationFrame(detectFaceLoop)
        }


        if (cameraReady) {
            console.log("Starting biometric detection loop...");
            requestID = requestAnimationFrame(detectFaceLoop)
        }

        return () => {
            if (requestID) cancelAnimationFrame(requestID)
        }
    }, [cameraReady])


    useEffect(() => {
        let timer = null
        if (faceGuide.qualityReady && !isProcessing) {
            const now = performance.now()
            if (now - lastAutoTriggerRef.current >= FACIAL_ICAO.CAPTURE_COOLDOWN_MS) {
                timer = setTimeout(() => {
                    lastAutoTriggerRef.current = performance.now()
                    if (mode === 'login' && !message.includes('Ingreso autorizado')) {
                        handleFaceLogin()
                    } else if (mode === 'register' && !capturedTemplate) {
                        handleCaptureForRegistration()
                    }
                }, FACIAL_ICAO.AUTO_CAPTURE_DELAY_MS)
            }
        }
        return () => {
            if (timer) clearTimeout(timer)
        }
    }, [faceGuide.qualityReady, isProcessing, mode, capturedTemplate, message])

    const handleFaceLogin = async () => {
        if (!videoRef.current || !cameraReady) {
            setError('La camara no esta lista.')
            return
        }

        setIsProcessing(true)
        setError('')
        setMessage('')

        try {
            const template = frameToTemplate(videoRef.current, liveFaceBox)
            const imageBase64 = frameToJpegBase64(videoRef.current, liveFaceBox)
            const result = await loginWithFace({ company: loginForm.company, template, imageBase64 })
            const user = result.user
            const score = result.score || 0
            const session = createSession(user, loginTab)
            setMessage(`Rostro validado (${(score * 100).toFixed(1)}%). Ingreso autorizado.`)
            onAuthenticated(session)
        } catch (err) {
            setError(err.message)
        } finally {
            setIsProcessing(false)
        }
    }

    const handlePasswordLogin = async (event) => {
        event.preventDefault()
        setIsProcessing(true)
        setError('')
        setMessage('')

        try {
            const result = await loginWithPassword(loginForm)
            const session = createSession(result.user, loginTab)
            setMessage('Autenticacion por usuario y contrasena validada.')
            onAuthenticated(session)
        } catch (err) {
            setError(err.message)
        } finally {
            setIsProcessing(false)
        }
    }

    const handleCaptureForRegistration = () => {
        if (!videoRef.current || !cameraReady) {
            setError('La camara no esta lista para el registro facial.')
            return
        }

        if (!faceGuide.detected || !faceGuide.qualityReady) {
            setError(
                'Complete los 5 parámetros ICAO + liveness (FACIAL): ojos, boca, frontalidad, sin lentes y anti-spoofing ≥ 70%.'
            )
            return
        }

        const template = frameToTemplate(videoRef.current, liveFaceBox)
        const imageBase64 = frameToJpegBase64(videoRef.current, liveFaceBox)
        setCapturedTemplate(template)
        setCapturedImageBase64(imageBase64)
        setMessage('Registro facial capturado correctamente.')
        setError('')
    }

    const handleRegister = async (event) => {
        event.preventDefault()
        if (!canRegister) {
            setError('Completa todos los datos y registra el rostro para continuar.')
            return
        }

        setIsProcessing(true)
        setError('')
        setMessage('')

        try {
            const result = await registerUser({
                ...registerForm,
                faceTemplate: capturedTemplate,
                faceImageBase64: capturedImageBase64,
            })

            const session = createSession(result.user, registerTab)
            setMessage('Usuario registrado y autenticado con exito.')
            onAuthenticated(session)
        } catch (err) {
            setError(err.message)
        } finally {
            setIsProcessing(false)
        }
    }

    return (
        <div className="auth-screen" data-auth-ui="icao-login-v2">
            <div className="auth-background" />
            <div className="auth-shell">
                <section className="auth-panel auth-panel-main">
                    <div className="camera-card camera-card-tall">
                        <div className="camera-header">
                            <div className="camera-title camera-title-with-pill">
                                <span className="auth-pill auth-pill-inline">Control de acceso</span>
                                <Camera size={16} />
                                <span>Cámara</span>
                            </div>
                            <span className={cameraReady ? 'status-dot online' : 'status-dot offline'}>
                                {cameraReady ? 'Activa' : 'Sin acceso'}
                            </span>
                        </div>
                        <div
                            className="camera-stage relative overflow-hidden camera-stage-tall"
                            style={{ background: '#000' }}
                        >
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                className="camera-preview camera-preview-tall w-full h-full object-cover"
                                style={{ display: cameraReady ? 'block' : 'none' }}
                            />
                            
                            <div
                                className="absolute pointer-events-none transition-all duration-100 ease-out biometric-oval"
                                style={{
                                    borderRadius: '50%',
                                    left: `${ovalLayout.leftPct}%`,
                                    top: `${ovalLayout.topPct}%`,
                                    width: `${ovalLayout.wPct}%`,
                                    height: `${ovalLayout.hPct}%`,
                                    transform: ovalLayout.transform,
                                    zIndex: 15,
                                    border: faceGuide.qualityReady
                                        ? '4px solid #22c55e'
                                        : '3px dashed #38bdf8',
                                    boxShadow: faceGuide.qualityReady
                                        ? '0 0 35px rgba(34, 197, 94, 0.8)'
                                        : '0 0 18px rgba(56, 189, 248, 0.45)',
                                }}
                            >
                                {!faceGuide.qualityReady && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="text-sky-400 text-[10px] font-bold bg-black/40 px-2 py-1 rounded animate-pulse">
                                            BUSCANDO ROSTRO...
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Persistent Dark Overlay Mask */}
                            <div
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                    background: `radial-gradient(ellipse ${ovalLayout.gradWPct}% ${ovalLayout.gradHPct}% at ${ovalLayout.leftPct}% ${ovalLayout.topPct}%, transparent 42%, rgba(0, 0, 0, 0.76) 72%)`,
                                    zIndex: 5,
                                }}
                            />

                            {!cameraReady && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white gap-3" style={{ zIndex: 20 }}>
                                    <ScanFace size={48} className="animate-pulse opacity-50" />
                                    <span className="text-sm font-medium">Iniciando Biometría Facial...</span>
                                </div>
                            )}

                            {/* New: Capture Preview Box */}
                            {capturedImageBase64 && (
                                <div className="absolute bottom-4 right-4 w-24 h-24 rounded-full border-2 border-green-500 overflow-hidden shadow-lg z-20 bg-slate-800 flex items-center justify-center">
                                    <img src={`data:image/jpeg;base64,${capturedImageBase64}`} className="w-full h-full object-cover" alt="captured face" />
                                    <div className="absolute inset-0 border border-white/20 rounded-full animate-pulse pointer-events-none"></div>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="bg-green-500 text-[8px] font-bold text-white px-1.5 py-0.5 rounded absolute -top-1">SNAPSHOT</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="bio-icao-panel">
                            <div className="bio-icao-section">
                                <div className="bio-icao-title">CALIDAD ICAO</div>
                                <div className="bio-icao-row">
                                    <span>OJOS ABIERTOS</span>
                                    <span className="bio-icao-val">
                                        {formatIcaoCell(
                                            faceGuide.icaoEyes === null ? null : faceGuide.icaoEyes
                                        )}
                                    </span>
                                </div>
                                <div className="bio-icao-row">
                                    <span>BOCA CERRADA</span>
                                    <span className="bio-icao-val">
                                        {formatIcaoCell(
                                            faceGuide.icaoMouth === null ? null : faceGuide.icaoMouth
                                        )}
                                    </span>
                                </div>
                                <div className="bio-icao-row">
                                    <span>FRONTALIDAD</span>
                                    <span className="bio-icao-val">
                                        {formatIcaoCell(
                                            faceGuide.icaoFrontal === null
                                                ? null
                                                : faceGuide.icaoFrontal
                                        )}
                                    </span>
                                </div>
                                <div className="bio-icao-row">
                                    <span>SIN LENTES</span>
                                    <span className="bio-icao-val">
                                        {formatIcaoCell(
                                            faceGuide.icaoNoGlasses === null
                                                ? null
                                                : faceGuide.icaoNoGlasses
                                        )}
                                    </span>
                                </div>
                            </div>
                            <div className="bio-icao-section">
                                <div className="bio-icao-title">ANTI-SPOOFING (LIVENESS)</div>
                                <div className="bio-icao-bar-track">
                                    <div
                                        className="bio-icao-bar-fill"
                                        style={{
                                            width: `${Math.min(100, faceGuide.livenessScore)}%`,
                                        }}
                                    />
                                </div>
                                <div className="bio-icao-liveness-meta">
                                    <span>Umbral {FACIAL_ICAO.LIVENESS_SCORE_PASS}%</span>
                                    <span className="bio-icao-pct">
                                        {Number(faceGuide.livenessScore || 0).toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mode-switch mode-switch-below-bio">
                        <button
                            type="button"
                            className={mode === 'login' ? 'active' : ''}
                            onClick={() => {
                                setMode('login')
                                setError('')
                                setMessage('')
                            }}
                            style={{padding: '16px', fontSize: '15px'}}
                        >
                            <ShieldCheck size={20} /> Entrar (LOGIN)
                        </button>
                        <button
                            type="button"
                            className={mode === 'register' ? 'active' : ''}
                            onClick={() => {
                                setMode('register')
                                setError('')
                                setMessage('')
                            }}
                            style={{padding: '16px', fontSize: '15px'}}
                        >
                            <UserPlus size={20} /> Crear Cuenta (REGISTRO)
                        </button>
                    </div>
                </section>

                <section className="auth-panel auth-panel-form">
                    {mode === 'login' ? (
                        <>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                <button type="button" className={loginTab === 'user' ? 'secondary-button' : 'logout-demo'} style={{flex: 1, padding: '8px', fontSize: '13px'}} onClick={() => { setLoginTab('user'); setError(''); }}>LOGIN Usuario</button>
                                <button type="button" className={loginTab === 'company' ? 'secondary-button' : 'logout-demo'} style={{flex: 1, padding: '8px', fontSize: '13px'}} onClick={() => { setLoginTab('company'); setError(''); }}>LOGIN Empresa</button>
                            </div>

                            <h2>{loginTab === 'user' ? 'Ingresar como Usuario (Trabajador)' : 'Ingresar como Empresa Contratista'}</h2>
                            
                            <label className="field-label">
                                <Building2 size={14} /> Empresa Asignada / Compañía
                                <select
                                    value={loginForm.company}
                                    onChange={(event) =>
                                        setLoginForm((prev) => ({ ...prev, company: event.target.value }))
                                    }
                                >
                                    {companies.map((company) => (
                                        <option key={company} value={company}>
                                            {company}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            {/* Captured Face Preview for Login */}
                            {capturedImageBase64 && (
                                <div className="captured-preview-container" style={{ margin: '15px 0', padding: '10px', background: 'rgba(30, 41, 59, 0.5)', borderRadius: '8px', border: '1px solid #334155', display: 'flex', alignItems: 'center', gap: '15px' }}>
                                    <div style={{ width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', border: '2px solid #22c55e', boxShadow: '0 0 10px rgba(34, 197, 94, 0.3)' }}>
                                        <img src={`data:image/jpeg;base64,${capturedImageBase64}`} className="w-full h-full object-cover" alt="login face snapshot" />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <span style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Rostro para Validación</span>
                                        <span style={{ fontSize: '13px', color: '#94a3b8' }}>Biometría capturada y lista</span>
                                    </div>
                                </div>
                            )}

                            <button
                                type="button"
                                className="primary-face-button"
                                disabled={!cameraReady || isProcessing}
                                onClick={handleFaceLogin}
                                style={{marginTop: '12px'}}
                            >
                                <ScanFace size={17} />
                                {isProcessing ? 'Validando rostro...' : 'Ingresar con Reconocimiento Facial'}
                            </button>

                            <div className="auth-divider">
                                <span>O Acceso Manual</span>
                            </div>

                            <form onSubmit={handlePasswordLogin} className="stack-form">
                                <label className="field-label">
                                    <UserRound size={14} /> Usuario / DNI / RUC
                                    <input
                                        type="text"
                                        value={loginForm.username}
                                        onChange={(event) =>
                                            setLoginForm((prev) => ({ ...prev, username: event.target.value }))
                                        }
                                        required
                                    />
                                </label>
                                <label className="field-label">
                                    <KeyRound size={14} /> Contraseña
                                    <input
                                        type="password"
                                        value={loginForm.password}
                                        onChange={(event) =>
                                            setLoginForm((prev) => ({ ...prev, password: event.target.value }))
                                        }
                                        required
                                    />
                                </label>
                                <button type="submit" className="secondary-button" disabled={isProcessing} style={{marginTop: '10px'}}>
                                    Ingresar con Usuario y Contraseña
                                </button>
                            </form>
                        </>
                    ) : (
                        <>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                <button type="button" className={registerTab === 'user' ? 'secondary-button' : 'logout-demo'} style={{flex: 1, padding: '8px', fontSize: '13px'}} onClick={() => { setRegisterTab('user'); setError(''); }}>REGISTRO de Persona</button>
                                <button type="button" className={registerTab === 'company' ? 'secondary-button' : 'logout-demo'} style={{flex: 1, padding: '8px', fontSize: '13px'}} onClick={() => { setRegisterTab('company'); setError(''); }}>REGISTRO de Empresa</button>
                            </div>

                            <h2>{registerTab === 'company' ? 'Registrar Empresa Contratista' : 'Registrar Nuevo Usuario'}</h2>
                            <form onSubmit={handleRegister} className="stack-form">
                                {registerTab === 'company' ? (
                                    <>
                                         <label className="field-label">
                                            RUC de la Empresa (Validación automática)
                                            <div style={{ position: 'relative' }}>
                                                <input 
                                                    type="text" 
                                                    maxLength={11} 
                                                    value={registerForm.ruc} 
                                                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, ruc: e.target.value }))} 
                                                    required 
                                                    style={{ 
                                                        borderColor: registerForm.ruc.length === 11 ? (registerForm.rucValid ? '#22c55e' : '#ef4444') : undefined,
                                                        paddingRight: '35px'
                                                    }}
                                                />
                                                <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                                                    {registerForm.isValidatingRuc ? (
                                                        <div className="animate-spin h-4 w-4 border-2 border-sky-500 border-t-transparent rounded-full"></div>
                                                    ) : registerForm.ruc.length === 11 ? (
                                                        registerForm.rucValid ? (
                                                            <ShieldCheck size={16} className="text-green-500" />
                                                        ) : (
                                                            <AlertTriangle size={16} className="text-red-500" title="RUC no válido o no pertenece a la empresa" />
                                                        )
                                                    ) : null}
                                                </div>
                                            </div>
                                            {registerForm.ruc.length === 11 && !registerForm.rucValid && !registerForm.isValidatingRuc && (
                                                <span style={{ fontSize: '10px', color: '#ef4444', marginTop: '4px', display: 'block' }}>
                                                    * RUC no autorizado para esta compañía.
                                                </span>
                                            )}
                                         </label>
                                         <label className="field-label" style={{ clear: 'both' }}>
                                             Razon Social / Nombre Empresa
                                             <input type="text" value={registerForm.company} onChange={(e) => setRegisterForm((prev) => ({ ...prev, company: e.target.value }))} required />
                                         </label>
                                         <div className="auth-divider" style={{margin: '12px 0'}}><span>Representante Legal</span></div>
                                         <label className="field-label">
                                             DNI Representante
                                             <input type="text" maxLength={12} value={registerForm.dni} onChange={(e) => setRegisterForm((prev) => ({ ...prev, dni: e.target.value }))} required />
                                         </label>
                                         <div style={{display: 'flex', gap: '10px'}}>
                                             <label className="field-label" style={{flex: 1}}>
                                                 Nombres
                                                 <input type="text" value={registerForm.firstName} onChange={(e) => setRegisterForm((prev) => ({ ...prev, firstName: e.target.value }))} required />
                                             </label>
                                             <label className="field-label" style={{flex: 1}}>
                                                 Apellidos
                                                 <input type="text" value={registerForm.lastName} onChange={(e) => setRegisterForm((prev) => ({ ...prev, lastName: e.target.value }))} required />
                                             </label>
                                         </div>
                                         <div style={{display: 'flex', gap: '10px'}}>
                                             <label className="field-label" style={{flex: 1}}>
                                                 Telefono Fijo
                                                 <input type="tel" value={registerForm.phone} onChange={(e) => setRegisterForm((prev) => ({ ...prev, phone: e.target.value }))} />
                                             </label>
                                             <label className="field-label" style={{flex: 1}}>
                                                 Celular
                                                 <input type="tel" value={registerForm.mobile} onChange={(e) => setRegisterForm((prev) => ({ ...prev, mobile: e.target.value }))} required />
                                             </label>
                                         </div>
                                    </>
                                ) : (
                                    <>
                                        <label className="field-label">
                                            <Building2 size={14} /> Empresa Asignada
                                            <select value={registerForm.company} onChange={(e) => setRegisterForm((prev) => ({ ...prev, company: e.target.value }))}>
                                                {companies.map((company) => (
                                                    <option key={company} value={company}>{company}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="field-label">
                                            DNI Trabajador
                                            <input type="text" maxLength={12} value={registerForm.dni} onChange={(e) => setRegisterForm((prev) => ({ ...prev, dni: e.target.value }))} required />
                                        </label>
                                        <div style={{display: 'flex', gap: '10px'}}>
                                            <label className="field-label" style={{flex: 1}}>
                                                Nombres
                                                <input type="text" value={registerForm.firstName} onChange={(e) => setRegisterForm((prev) => ({ ...prev, firstName: e.target.value }))} required />
                                            </label>
                                            <label className="field-label" style={{flex: 1}}>
                                                Apellidos
                                                <input type="text" value={registerForm.lastName} onChange={(e) => setRegisterForm((prev) => ({ ...prev, lastName: e.target.value }))} required />
                                            </label>
                                        </div>
                                        <div style={{display: 'flex', gap: '10px'}}>
                                            <label className="field-label" style={{flex: 1}}>
                                                Correo Electronico
                                                <input type="email" value={registerForm.email} onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))} required />
                                            </label>
                                            <label className="field-label" style={{flex: 1}}>
                                                Celular
                                                <input type="tel" value={registerForm.mobile} onChange={(e) => setRegisterForm((prev) => ({ ...prev, mobile: e.target.value }))} required />
                                            </label>
                                        </div>
                                        <label className="field-label">
                                            Cargo / Nivel de Usuario
                                            <select style={{ backgroundColor: '#1e293b', padding: '10px', borderRadius: '6px', color: '#fff', border: '1px solid #334155'}} value={registerForm.role} onChange={(e) => setRegisterForm((prev) => ({...prev, role: e.target.value}))}>
                                                <option value="operator">Operador / Personal Tecnico</option>
                                                <option value="supervisor">Supervisor / Jefe de Guardia</option>
                                                <option value="manager">Gerente de Operaciones</option>
                                                <option value="geologist">Ingeniero Geomecanico</option>
                                                <option value="safety">Prevencionista / SSOMA</option>
                                                <option value="admin">Administrador del Sistema</option>
                                            </select>
                                        </label>

                                        {/* Captured Face Preview for Registration (User) */}
                                        {capturedImageBase64 && (
                                            <div className="captured-preview-container" style={{ margin: '15px 0', padding: '10px', background: 'rgba(30, 41, 59, 0.5)', borderRadius: '8px', border: '1px solid #334155', display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                <div style={{ width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', border: '2px solid #22c55e', boxShadow: '0 0 10px rgba(34, 197, 94, 0.3)' }}>
                                                    <img src={`data:image/jpeg;base64,${capturedImageBase64}`} className="w-full h-full object-cover" alt="registration face snapshot" />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <span style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Biometría para Registro</span>
                                                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Rostro capturado correctamente</span>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                <div className="auth-divider" style={{margin: '12px 0'}}><span>Credenciales de Acceso</span></div>
                                <div style={{display: 'flex', gap: '10px'}}>
                                    <label className="field-label" style={{flex: 1}}>
                                        Usuario de Sistema
                                        <input type="text" value={registerForm.username} onChange={(e) => setRegisterForm((prev) => ({ ...prev, username: e.target.value }))} required />
                                    </label>
                                    <label className="field-label" style={{flex: 1}}>
                                        Contrasena
                                        <input type="password" value={registerForm.password} onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))} required />
                                    </label>
                                </div>

                                <button type="button" className={`secondary-button ${capturedImageBase64 ? 'success' : ''}`} disabled={!cameraReady} onClick={handleCaptureForRegistration} style={{marginTop: '10px'}}>
                                    {capturedImageBase64 ? <ShieldCheck size={15} /> : <Camera size={15} />} 
                                    {capturedImageBase64 ? ' Biometría Capturada' : ' Registrar biometrica facial (Obligatorio)'}
                                </button>
                                <button type="submit" className="primary-face-button" disabled={!canRegister || isProcessing}>
                                    <UserPlus size={17} /> Guardar registro e Iniciar Sesion
                                </button>
                            </form>
                        </>
                    )}

                    {error && (
                        <div className="auth-message error">
                            <AlertTriangle size={15} /> {error}
                        </div>
                    )}
                    {message && <div className="auth-message ok">{message}</div>}
                    <button
                        type="button"
                        className="logout-demo"
                        onClick={() => {
                            clearSession()
                            setMessage('Sesion reiniciada para pruebas de acceso.')
                        }}
                    >
                        Reiniciar sesion local
                    </button>
                </section>
            </div>
        </div>
    )
}

export default AuthGateway
