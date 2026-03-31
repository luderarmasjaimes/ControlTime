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

const DEFAULT_COMPANIES = ['Minera Raura', 'Compania Minera Volcan', 'Minera Antamina', 'Minera Cerro Verde']
const GUIDE_BOX_PADDING = 0.18

// Biometric Oval Configuration (snug ROI-based fit)
const BIOMETRIC_OVAL_W_FACTOR = 0.76;
const BIOMETRIC_OVAL_H_FACTOR = 0.85; 
const BIOMETRIC_OVAL_X_OFFSET = 0.12; 
const BIOMETRIC_OVAL_Y_OFFSET = -0.05; // Moved up as requested

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

function centerOffsetRatio(box, width, height) {
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    const offsetX = Math.abs(centerX - width / 2) / width
    const offsetY = Math.abs(centerY - height / 2) / height
    return { offsetX, offsetY }
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

function brightnessScore(videoElement, box) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(64, Math.floor(box.width / 2))
    canvas.height = Math.max(64, Math.floor(box.height / 2))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(
        videoElement,
        box.x,
        box.y,
        box.width,
        box.height,
        0,
        0,
        canvas.width,
        canvas.height
    )
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data

    let sum = 0
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i]
        const g = pixels[i + 1]
        const b = pixels[i + 2]
        sum += r * 0.299 + g * 0.587 + b * 0.114
    }

    return sum / (pixels.length / 4)
}

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
        centered: false,
        frontal: false,
        eyesOpen: true, // Optimistic initial state
        mouthClosed: true, // Optimistic initial state
        stable: false,
        lighting: false,
        qualityReady: false,
        localReady: false,
        localNotes: [],
        notes: ['Iniciando cámara...'],
    })
    const [autoTriggerTimer, setAutoTriggerTimer] = useState(0)
    const videoRef = useRef(null)
    const streamRef = useRef(null)
    const detectorRef = useRef(null)
    const motionRef = useRef({ cx: 0, cy: 0, t: 0 })
    const lastSyncRef = useRef(0)
    const syncingRef = useRef(false)
    const smoothedFaceRef = useRef(null) // Added for EMA smoothing

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

        async function startCamera() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: { ideal: 960 },
                        height: { ideal: 540 },
                    },
                    audio: false,
                })

                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }

                streamRef.current = stream
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                    await videoRef.current.play()
                }

                setCameraReady(true)
                setError('')

                // Force video play and wait a tick for metadata
                if (videoRef.current) {
                    videoRef.current.onloadedmetadata = () => {
                        videoRef.current.play().catch(e => console.error("Auto-play prevented", e))
                    }
                }
            } catch {
                setError('No se pudo abrir la camara de la laptop. Verifica permisos del navegador.')
                setCameraReady(false)
            }
        }

        startCamera()

        return () => {
            cancelled = true
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop())
                streamRef.current = null
            }
        }
    }, [])

    useEffect(() => {
        let requestID = null
        let lastTimestamp = 0

        async function detectFaceLoop(timestamp) {
            const video = videoRef.current
            
            // Limit loop frequency to ~15fps to balance performance and latency
            if (timestamp - lastTimestamp < 66) {
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

                let centered = false, frontal = false, stable = false, lighting = false;
                let localReady = false, localNotes = [];
                let hasLandmarks = false, eyesOpen = true, mouthClosed = true;

                if (!bestFace) {
                    setLiveFaceBox(null)
                    smoothedFaceRef.current = null
                } else {
                    // --- Exponential Moving Average (EMA) Smoothing ---
                    if (smoothedFaceRef.current) {
                        const alpha = 0.25; // Smoothing factor (0.1 = very slow/smooth, 0.9 = fast/jittery)
                        const prev = smoothedFaceRef.current;
                        bestFace = {
                            x: prev.x + alpha * (bestFace.x - prev.x),
                            y: prev.y + alpha * (bestFace.y - prev.y),
                            width: prev.width + alpha * (bestFace.width - prev.width),
                            height: prev.height + alpha * (bestFace.height - prev.height),
                            landmarks: bestFace.landmarks, // Keep raw landmarks for accuracy check
                            isFallback: bestFace.isFallback
                        };
                    }
                    smoothedFaceRef.current = bestFace;
                    setLiveFaceBox(bestFace)

                    const { offsetX, offsetY } = centerOffsetRatio(bestFace, video.videoWidth, video.videoHeight)
                    centered = offsetX < 0.20 && offsetY < 0.20 
                    const aspect = bestFace.width / Math.max(1, bestFace.height)
                    const frontalByAspect = aspect > 0.4 && aspect < 1.3 // Relaxed from 0.5-1.2

                    hasLandmarks = bestFace.landmarks.length > 0
                    const leftEye = bestFace.landmarks.find((l) => l.type === 'leftEye' || l.type === 'eye')
                    const rightEye = bestFace.landmarks.find((l) => l.type === 'rightEye')
                    const eyesAligned = hasLandmarks ? (
                        leftEye && rightEye 
                            ? Math.abs(leftEye.locations[0].y - rightEye.locations[0].y) < bestFace.height * 0.15
                            : true
                    ) : true
                    
                    const eyeOpenness = (eye) => {
                        if (!eye || !Array.isArray(eye.locations) || eye.locations.length < 2) return 0.5
                        const ys = eye.locations.map((p) => p.y)
                        const xs = eye.locations.map((p) => p.x)
                        return (Math.max(...ys) - Math.min(...ys)) / Math.max(1, Math.max(...xs) - Math.min(...xs))
                    }
                    const mouth = bestFace.landmarks.find((l) => l.type === 'mouth')
                    const mouthRatio = (() => {
                        if (!mouth || !Array.isArray(mouth.locations) || mouth.locations.length < 2) return 0.1
                        const ys = mouth.locations.map((p) => p.y)
                        const xs = mouth.locations.map((p) => p.x)
                        return (Math.max(...ys) - Math.min(...ys)) / Math.max(1, Math.max(...xs) - Math.min(...xs))
                    })()

                    eyesOpen = hasLandmarks ? (eyeOpenness(leftEye) > 0.15) : true
                    // Adjusted mouth threshold: even MORE permissive and robust
                    const isMouthOpen = hasLandmarks ? (mouthRatio > 0.22) : false;
                    mouthClosed = !isMouthOpen;
                    frontal = frontalByAspect && eyesAligned

                    const now = performance.now()
                    const cx = bestFace.x + bestFace.width / 2
                    const cy = bestFace.y + bestFace.height / 2
                    const prevMot = motionRef.current
                    const dt = Math.max(1, now - prevMot.t)
                    const speed = Math.hypot(cx - prevMot.cx, cy - prevMot.cy) / dt
                    stable = prevMot.t === 0 ? false : speed < 0.15
                    motionRef.current = { cx, cy, t: now }

                    const brightness = brightnessScore(video, bestFace)
                    lighting = brightness > 30 && brightness < 250 // Extremely permissive
                    
                    // NEW: Simplified 'Three Validations' strategy as requested
                    // 1. Face Presence (localReady)
                    // 2. Eyes (eyesOpen)
                    // 3. Mouth (mouthClosed)
                    // 1. Face Presence (localReady)
                    // 2. Eyes (eyesOpen)
                    // 3. Mouth (mouthClosed)
                    const hasFaceNow = bestFace !== null;

                    localReady = (hasFaceNow || (syncingRef.current))
                    if (hasFaceNow) {
                        if (!localReady) localNotes.push('Posicione su rostro dentro del recuadro central.')
                        if (!eyesOpen) localNotes.push('Abra los ojos.')
                        if (!mouthClosed) localNotes.push('Cierre la boca.')
                    }

                    // --- Server-Side Biometric Validation Sync with CROPPING ---
                    const nowSync = performance.now()
                    const isFirstSync = lastSyncRef.current === 0;
                    if (hasFaceNow && !syncingRef.current && (isFirstSync || nowSync - lastSyncRef.current > 800)) {
                        syncingRef.current = true
                        lastSyncRef.current = nowSync

                        const cropX = Math.max(0, bestFace.x + bestFace.width * BIOMETRIC_OVAL_X_OFFSET);
                        const cropY = Math.max(0, bestFace.y + bestFace.height * BIOMETRIC_OVAL_Y_OFFSET);
                        const cropW = Math.min(video.videoWidth - cropX, bestFace.width * BIOMETRIC_OVAL_W_FACTOR);
                        const cropH = Math.min(video.videoHeight - cropY, bestFace.height * BIOMETRIC_OVAL_H_FACTOR);

                        const canvas = document.createElement('canvas')
                        canvas.width = cropW; canvas.height = cropH;
                        const ctx = canvas.getContext('2d')
                        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                        const base64 = canvas.toDataURL('image/jpeg', 0.90).split(',')[1]

                        verifyBiometricFrame(base64)
                            .then((res) => {
                                syncingRef.current = false
                                setFaceGuide(prev => {
                                    const serverNotes = (res.issues || []).map(i => i.replace(/_/g, ' '));
                                    const detectedByServer = res.ok || (res.issues && !res.issues.includes('face_not_detected'));
                                    const mergedNotes = [...new Set([...prev.localNotes, ...serverNotes])];
                                    return {
                                        ...prev,
                                        detected: prev.detected || detectedByServer || hasFaceNow,
                                        eyesOpen: res.issues ? !res.issues.includes('eyes_not_open_or_not_visible') : prev.eyesOpen,
                                        mouthClosed: res.issues ? !res.issues.includes('mouth_not_closed') : prev.mouthClosed,
                                        serverOk: res.ok, 
                                        qualityReady: (prev.localReady || detectedByServer) && (res.ok || (!res.issues?.includes('eyes_not_open_or_not_visible') && !res.issues?.includes('mouth_not_closed'))),
                                        notes: mergedNotes
                                    };
                                });
                            })
                            .catch(() => { syncingRef.current = false })
                    }

                    setFaceGuide((prev) => {
                        const updated = {
                            ...prev,
                            detected: hasFaceNow || prev.detected, 
                            centered: hasFaceNow ? centered : prev.centered,
                            frontal: hasFaceNow ? frontal : prev.frontal,
                            eyesOpen: hasFaceNow && hasLandmarks ? eyesOpen : prev.eyesOpen,
                            mouthClosed: hasFaceNow && hasLandmarks ? mouthClosed : prev.mouthClosed,
                            stable: hasFaceNow ? stable : prev.stable,
                            lighting: hasFaceNow ? lighting : prev.lighting,
                            localReady: hasFaceNow ? localReady : false,
                            localNotes,
                            qualityReady: (hasFaceNow && prev.eyesOpen && prev.mouthClosed) || (prev.serverOk && hasFaceNow), 
                            notes: [...new Set([...localNotes, ...prev.notes.filter(n => !localNotes.includes(n))])]
                        };

                        if (updated.qualityReady && hasFaceNow && !capturedImageBase64) {
                             const template = frameToTemplate(video, bestFace);
                             const imageBase64 = frameToJpegBase64(video, bestFace);
                             setCapturedTemplate(template);
                             setCapturedImageBase64(imageBase64);
                        }
                        return updated;
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


    // Effect for Automatic Biometric Login / Capture
    useEffect(() => {
        let timer = null
        if (faceGuide.qualityReady && !isProcessing) {
            console.log("Face quality ready, triggering instant capture...");
            timer = setTimeout(() => {
                if (mode === 'login' && !message.includes('Ingreso autorizado')) {
                    console.log("Auto-trigger: Face Login");
                    handleFaceLogin()
                } else if (mode === 'register' && !capturedTemplate) {
                    console.log("Auto-trigger: Face Capture for Registration");
                    handleCaptureForRegistration()
                }
            }, 300) // Reduced to 300ms for near-instant capture while ensuring stability
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

        // Quality check removed as requested by user
        if (!faceGuide.detected) {
            setError('Rostro no detectado.')
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
        <div className="auth-screen">
            <div className="auth-background" />
            <div className="auth-shell">
                <section className="auth-panel auth-panel-main">
                    <div className="auth-brand">
                        <span className="auth-pill">Control de Acceso Minero</span>
                        <h1>Ingreso Seguro Prioritario por Reconocimiento Facial</h1>
                        <p>
                            La autenticacion facial es el metodo principal. El acceso por usuario y contrasena
                            queda como opcion de respaldo.
                        </p>
                    </div>

                    <div className="camera-card">
                        <div className="camera-header">
                            <div className="camera-title">
                                <Camera size={16} />
                                <span>Camara de laptop</span>
                            </div>
                            <span className={cameraReady ? 'status-dot online' : 'status-dot offline'}>
                                {cameraReady ? 'Activa' : 'Sin acceso'}
                            </span>
                        </div>
                        <div className="camera-stage relative overflow-hidden" style={{ minHeight: '300px', background: '#000' }}>
                            <video ref={videoRef} autoPlay muted playsInline className="camera-preview w-full h-full object-cover" style={{ display: cameraReady ? 'block' : 'none' }} />
                            
                            {/* Dynamic Face Oval Tracking - NEW (10% Smaller) */}
                            <div 
                                className="absolute pointer-events-none transition-all duration-75"
                                style={{
                                    borderRadius: '50%', 
                                    left: liveFaceBox 
                                        ? `${(liveFaceBox.x + (liveFaceBox.width * 0.24) / 2) / frameMetrics.width * 100}%` 
                                        : '37.5%',
                                    top: liveFaceBox 
                                        ? `${(liveFaceBox.y + (liveFaceBox.height * BIOMETRIC_OVAL_Y_OFFSET)) / frameMetrics.height * 100}%` 
                                        : '10%',
                                    width: liveFaceBox 
                                        ? `${(liveFaceBox.width * 0.76 / frameMetrics.width) * 100}%` 
                                        : '25%',
                                    height: liveFaceBox 
                                        ? `${(liveFaceBox.height * 0.85 / frameMetrics.height) * 100}%` 
                                        : '80%',
                                    zIndex: 15,
                                    border: faceGuide.qualityReady ? '4px solid #22c55e' : '3px dashed #38bdf8', // Sky blue dashed
                                    boxShadow: faceGuide.qualityReady ? '0 0 35px rgba(34, 197, 94, 0.8)' : '0 0 15px rgba(56, 189, 248, 0.4)'
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
                            <div className="absolute inset-0 pointer-events-none" style={{
                                background: `radial-gradient(circle 180px at ${
                                    liveFaceBox 
                                        ? ((liveFaceBox.x + liveFaceBox.width / 2) / frameMetrics.width * 100)
                                        : 50
                                }% ${
                                    liveFaceBox
                                        ? ((liveFaceBox.y + liveFaceBox.height / 2) / frameMetrics.height * 100)
                                        : 50
                                }%, transparent 50%, rgba(0, 0, 0, 0.75) 100%)`,
                                zIndex: 5
                            }}></div>

                            {/* Persistent Guide Box (Target) */}
                            <div
                                className={`face-guide-box fixed-face-box absolute pointer-events-none border-2 transition-all duration-75 ${
                                    faceGuide.qualityReady ? 'border-green-500' : 'border-sky-400 border-dashed'
                                }`}
                                style={{
                                    left: 'calc(50% - 125px)',
                                    top: 'calc(50% - 125px)',
                                    width: '250px',
                                    height: '250px',
                                    borderRadius: '20px',
                                    zIndex: 10,
                                    boxShadow: faceGuide.qualityReady ? '0 0 30px rgba(34, 197, 94, 0.6)' : '0 0 15px rgba(56, 189, 248, 0.3)',
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

                        <div className="face-guidance-panel">
                            <div className="face-guidance-grid">
                                    <span className={faceGuide.detected ? 'ok' : 'warn'}>
                                        {faceGuide.detected ? 'Rostro detectado' : 'Sin rostro detectado'}
                                    </span>
                                    <span className={faceGuide.centered ? 'ok' : 'warn'}>
                                        {faceGuide.centered ? 'Rostro centrado' : 'Ajustar centrado'}
                                    </span>
                                    <span className={faceGuide.frontal ? 'ok' : 'warn'}>
                                        {faceGuide.frontal ? 'Mirada frontal' : 'Cara girada/inclinada'}
                                    </span>
                                    <span className={faceGuide.eyesOpen ? 'ok' : 'warn'}>
                                        {faceGuide.eyesOpen ? 'Ojos abiertos' : 'Abrir ojos'}
                                    </span>
                                    <span className={faceGuide.mouthClosed ? 'ok' : 'warn'}>
                                        {faceGuide.mouthClosed ? 'Boca cerrada' : 'Cerrar boca'}
                                    </span>
                                    <span className={faceGuide.stable ? 'ok' : 'warn'}>
                                        {faceGuide.stable ? 'Sin movimiento' : 'No moverse'}
                                    </span>
                                    <span className={faceGuide.lighting ? 'ok' : 'warn'}>
                                        {faceGuide.lighting ? 'Iluminacion correcta' : 'Mejorar iluminacion'}
                                    </span>
                                </div>

                                <ul>
                                    {faceGuide.notes && faceGuide.notes.map((note) => (
                                        <li key={note}>{note}</li>
                                    ))}
                                </ul>
                                <p className={faceGuide.qualityReady ? 'quality-ready ok' : 'quality-ready warn'}>
                                    {faceGuide.qualityReady
                                        ? 'Calidad sugerida: rostro posicionado correctamente.'
                                        : 'Calidad sugerida: ajusta postura, movimiento y condiciones del entorno.'}
                                </p>
                            </div>
                    </div>

                    <div className="mode-switch" style={{marginTop: '24px'}}>
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
