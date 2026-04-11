import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
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
    createSession,
    getSession,
} from '../../auth/authStorage'
import {
    checkLoginIdentity,
    fetchCompanies,
    loginWithFace,
    loginWithPassword,
    processBiometricFrame,
    fetchBiometricStatus,
    registerUser,
    resetBiometricCapture,
    validateCompany,
} from '../../auth/authApi'
import { FACIAL_ICAO } from '../../config/facialIcaoConfig'
import {
    formatIcaoCell,
} from '../../auth/biometricFiveHelpers'
import {
    preprocessImageDataForFaceDetection,
    
    meanLuminanceImageData,
    luminanceStdDevImageData,
    classifyRawDifficultLighting,
    medianFaceBoundingBox,
    faceCenterJumpRatio,
} from '../../auth/faceTrackingUtils'
import {
    getBiometricOvalVideoMetrics,
    buildFullFrameJpegBase64FromVideo,
    computeBiometricOvalLayout,
    mapOvalLayoutVideoToStage,
    frameToTemplate,
    frameToJpegBase64,
    frameToOvalPortraitJpegBase64,
    frameToBustRectAroundOvalJpegBase64,
    FACIAL_STRICT_OVAL_MODE,
    FACIAL_STRICT_OVAL_W_PCT,
    FACIAL_STRICT_OVAL_H_PCT,
} from '../../auth/biometricOvalFrame'
import enterpriseMiningMark from '../../brand/enterprise-mining-mark.svg'

const DEFAULT_COMPANIES = [
    'Alpayana',
    'Anglo American Quellaveco',
    'Ares',
    'Bear Creek Mining',
    'Buenaventura',
    'Catalina Huanca',
    'Chinalco Peru',
    'Compania Minera Antamina',
    'Compania Minera Ares',
    'Compania Minera Poderosa',
    'Compania Minera Raura',
    'Compania Minera San Ignacio de Morococha',
    'Compania Minera Volcan',
    'Consorcio Minero Horizonte',
    'DOE Run Peru',
    'Dynacor',
    'El Brocal',
    'Gold Fields La Cima',
    'Hochschild Mining Peru',
    'Hudbay Peru',
    'Jinzhao Mining Peru',
    'Las Bambas',
    'Marcobre',
    'Minera Antamina',
    'Minera Antapaccay',
    'Minera Bateas',
    'Minera Boroo Misquichilca',
    'Minera Caraveli',
    'Minera Cerro Verde',
    'Minera Condestable',
    'Minera Corona',
    'Minera IRL',
    'Minera Los Quenuales',
    'Minera Poderosa',
    'Minera Raura',
    'Minsur',
    'Nexa Resources Peru',
    'Pan American Silver Peru',
    'Shougang Hierro Peru',
    'Sierra Metals Yauricocha',
    'Sociedad Minera El Brocal',
    'Southern Peru Copper Corporation',
    'Summa Gold',
    'Yanacocha',
]
const DEFAULT_LOGIN_BG_URL = '/data/Image/Login/MINA_image.jpg'
const LOGIN_BG_BY_COMPANY = {
    'minera raura': '/data/Image/Login/Minera%20raura.jpg',
    'compania minera volcan': '/data/Image/Login/Compa%C3%B1ia%20Minera%20Volcal.jpg',
    'compania minera volcal': '/data/Image/Login/Compa%C3%B1ia%20Minera%20Volcal.jpg',
    'minera antamina': '/data/Image/Login/Minera%20antamina.jpg',
    'minera cerro verde': '/data/Image/Login/MINERa%20cerro%20verde.jpg',
    'minera antapaccay': '/data/Image/Login/Minera%20antapaccay.jpg',
}

function normalizeCompanyKey(companyName) {
    return String(companyName || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

const BUILD_STAMP = import.meta.env.VITE_BUILD_STAMP || 'dev'

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

const AuthGateway = ({ onAuthenticated }) => {
    const [mode, setMode] = useState('login')
    const [registerTab, setRegisterTab] = useState('user')
    const [loginTab, setLoginTab] = useState('user')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [cameraReady, setCameraReady] = useState(false)
    /** Login: cámara solo tras «Ingresar con Reconocimiento Facial»; ventana limitada en tiempo. */
    const [loginBiometricSession, setLoginBiometricSession] = useState(false)
    const [loginSessionSecondsLeft, setLoginSessionSecondsLeft] = useState(null)
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
        passwordConfirm: '',
    })

    const [registerUserBiometricStep, setRegisterUserBiometricStep] = useState('form')
    const [registerSessionSecondsLeft, setRegisterSessionSecondsLeft] = useState(null)
    const [registrationCompleteSession, setRegistrationCompleteSession] = useState(null)

    const [capturedTemplate, setCapturedTemplate] = useState(null)
    const [capturedImageBase64, setCapturedImageBase64] = useState('')
    const [capturedPortraitOvalBase64, setCapturedPortraitOvalBase64] = useState('')
    const [capturedBustRectBase64, setCapturedBustRectBase64] = useState('')
    const [liveFaceBox, setLiveFaceBox] = useState(null)
    const [frameMetrics, setFrameMetrics] = useState(() => ({
        width: FACIAL_ICAO.CAMERA.width.ideal,
        height: FACIAL_ICAO.CAMERA.height.ideal,
    }))
    const [faceGuide, setFaceGuide] = useState({
        detected: false,
        frontal: false,
        eyesOpen: false,
        mouthClosed: false,
        qualityReady: false,
        validFrames: 0,
        captureCount: 0,
        lastServerOk: false,
        icaoEyes: null,
        icaoMouth: null,
        icaoFrontal: null,
        icaoNoGlasses: null,
        livenessScore: 0,
        inTargetZone: true,
        serverFaceOval: null,
    })
    const [cameraStageSize, setCameraStageSize] = useState({ width: 0, height: 0 })
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
    /** Micro-movimiento del bbox (FaceDetector sin landmarks o parpadeo no detectado). */
    const bboxMotionHistRef = useRef([])
    const motionLivenessPtsRef = useRef(0)
    const lastMotionLivenessBoostAtRef = useRef(0)
    const eyesBlinkHystRef = useRef(true)
    const lastServerLivenessRef = useRef(0)
    const lastAutoTriggerRef = useRef(0)
    const cameraRetryTimerRef = useRef(null)
    const cameraStageRef = useRef(null)
    const faceBoxHistoryRef = useRef([])
    /** 640×480: misma rejilla que C:\FACIAL\www\main.js (process-canvas) y que el JPEG de /api/process_frame */
    const processFrameCanvasRef = useRef(null)
    const trackingFallbackCanvasRef = useRef(null)
    const validFramesRef = useRef(0)
    const missedDetectorFramesRef = useRef(0)
    /** 0..1 con histéresis: modo noche/reflejos para filtros extra y borde más estable */
    const difficultLightingScoreRef = useRef(0)
    const faceInTargetZoneRef = useRef(true)
    const loginBiometricSessionRef = useRef(false)
    const isProcessingRef = useRef(false)
    /** Reloj de sesión login: el tiempo se congela mientras isProcessing (petición al backend). */
    const sessionClockRef = useRef({ start: 0, pausedMs: 0, pauseSince: null })
    const identityAnchorRef = useRef('')
    const endLoginFaceSessionRef = useRef((/** @type {{ errorMessage?: string }} */ _o) => {})
    const bestLoginProbeRef = useRef(null)
    const loginSubmitTriggeredRef = useRef(false)
    /** Evita spam en consola cuando el gate de login facial está cerrado con 3/3 muestras. */
    const authFaceAutoDiagAtRef = useRef(0)
    const registerFaceSessionClockRef = useRef({
        start: 0,
        pausedMs: 0,
        pauseSince: null,
    })
    const registerAutoSubmitTriggeredRef = useRef(false)
    const registerUserBiometricStepRef = useRef('form')
    const endRegisterFaceSessionRef = useRef(
        (/** @type {{ errorMessage?: string }} */ _o) => {}
    )
    const registrationApiInFlightRef = useRef(false)

    const endLoginFaceSession = useCallback((opts) => {
        const errorMessage = opts?.errorMessage
        setLoginBiometricSession(false)
        setLoginSessionSecondsLeft(null)
        sessionClockRef.current = { start: 0, pausedMs: 0, pauseSince: null }
        identityAnchorRef.current = ''
        setCapturedTemplate(null)
        setCapturedImageBase64('')
        setCapturedPortraitOvalBase64('')
        setCapturedBustRectBase64('')
        bestLoginProbeRef.current = null
        loginSubmitTriggeredRef.current = false
        validFramesRef.current = 0
        resetBiometricCapture().catch(() => {})
        setFaceGuide((prev) => ({
            ...prev,
            qualityReady: false,
            validFrames: 0,
            captureCount: 0,
            lastServerOk: false,
            serverFaceOval: null,
        }))
        if (errorMessage) {
            setError(errorMessage)
        }
    }, [])

    const endRegisterFaceSession = useCallback((opts) => {
        const errorMessage = opts?.errorMessage
        setRegisterUserBiometricStep('form')
        setRegisterSessionSecondsLeft(null)
        registerFaceSessionClockRef.current = { start: 0, pausedMs: 0, pauseSince: null }
        setCapturedTemplate(null)
        setCapturedImageBase64('')
        setCapturedPortraitOvalBase64('')
        setCapturedBustRectBase64('')
        bestLoginProbeRef.current = null
        registrationApiInFlightRef.current = false
        registerAutoSubmitTriggeredRef.current = false
        validFramesRef.current = 0
        resetBiometricCapture().catch(() => {})
        setFaceGuide((prev) => ({
            ...prev,
            qualityReady: false,
            validFrames: 0,
            captureCount: 0,
            lastServerOk: false,
            serverFaceOval: null,
        }))
        setRegistrationCompleteSession(null)
        if (errorMessage) {
            setError(errorMessage)
        }
    }, [])

    useEffect(() => {
        endLoginFaceSessionRef.current = endLoginFaceSession
    }, [endLoginFaceSession])

    useEffect(() => {
        endRegisterFaceSessionRef.current = endRegisterFaceSession
    }, [endRegisterFaceSession])

    useEffect(() => {
        registerUserBiometricStepRef.current = registerUserBiometricStep
    }, [registerUserBiometricStep])

    useEffect(() => {
        loginBiometricSessionRef.current = loginBiometricSession
    }, [loginBiometricSession])

    useEffect(() => {
        isProcessingRef.current = isProcessing
    }, [isProcessing])

    const registerUserCaptureView =
        mode === 'register' &&
        registerTab === 'user' &&
        registerUserBiometricStep === 'capture'
    /** Formulario registro persona (sin panel cámara): layout denso, sin scroll en pantallas típicas. */
    const registerPersonFormOnlyView =
        mode === 'register' &&
        registerTab === 'user' &&
        registerUserBiometricStep === 'form'
    const showBiometricPanel =
        loginBiometricSession ||
        (mode === 'register' && registerTab === 'company') ||
        registerUserCaptureView
    const faceCaptureOnlyView =
        (mode === 'login' && loginBiometricSession) || registerUserCaptureView
    const loginSessionTotalSec = Math.max(
        1,
        Math.round(FACIAL_ICAO.LOGIN_FACE_SESSION_MS / 1000)
    )
    const loginSessionSecondsSafe = Math.max(
        0,
        Math.min(loginSessionTotalSec, Number(loginSessionSecondsLeft ?? loginSessionTotalSec))
    )
    const registerSessionSecondsSafe = Math.max(
        0,
        Math.min(
            loginSessionTotalSec,
            Number(registerSessionSecondsLeft ?? loginSessionTotalSec)
        )
    )
    const faceSessionTimerActive =
        (mode === 'login' && loginBiometricSession) || registerUserCaptureView
    const faceTimerSecondsLeft = registerUserCaptureView
        ? registerSessionSecondsLeft
        : loginSessionSecondsLeft
    const faceTimerSecondsSafe = registerUserCaptureView
        ? registerSessionSecondsSafe
        : loginSessionSecondsSafe
    const faceTimerProgress = faceTimerSecondsSafe / loginSessionTotalSec
    const timerCirc = 2 * Math.PI * 20
    const timerStrokeColor =
        faceTimerProgress > 0.66 ? '#22c55e' : faceTimerProgress > 0.33 ? '#f59e0b' : '#ef4444'
    const timerGlowColor =
        faceTimerProgress > 0.66
            ? 'rgba(34,197,94,0.35)'
            : faceTimerProgress > 0.33
              ? 'rgba(245,158,11,0.35)'
              : 'rgba(239,68,68,0.45)'
    const isCriticalTimer = faceSessionTimerActive && faceTimerSecondsSafe <= 10
    /** El panel muestra muestras del servidor (captureCount); qualityReady es local y puede desincronizarse. */
    const { hasRequiredBiometricSamples, loginBiometricGate } = useMemo(() => {
        const n = Number(faceGuide.captureCount || 0)
        const hasReq = n >= FACIAL_ICAO.REQUIRED_VALID_FRAMES
        return {
            hasRequiredBiometricSamples: hasReq,
            loginBiometricGate:
                Boolean(faceGuide.qualityReady) ||
                (hasReq && Boolean(faceGuide.lastServerOk)),
        }
    }, [faceGuide.qualityReady, faceGuide.captureCount, faceGuide.lastServerOk])
    const selectedLoginBgUrl = useMemo(() => {
        const key = normalizeCompanyKey(loginForm.company)
        return LOGIN_BG_BY_COMPANY[key] || DEFAULT_LOGIN_BG_URL
    }, [loginForm.company])

    const ovalForStage = useMemo(() => {
        const sw = cameraStageSize.width
        const sh = cameraStageSize.height
        const fw = frameMetrics.width
        const fh = frameMetrics.height
        const so = faceGuide.serverFaceOval
        const serverSourceW = Number(FACIAL_ICAO.CAMERA.width.ideal || 640)
        const serverSourceH = Number(FACIAL_ICAO.CAMERA.height.ideal || 480)
        if (
            so &&
            Number.isFinite(Number(so.cx)) &&
            Number.isFinite(Number(so.cy)) &&
            Number.isFinite(Number(so.w)) &&
            Number.isFinite(Number(so.h)) &&
            fw > 0 &&
            fh > 0
        ) {
            const serverLayout = {
                leftPct: (Number(so.cx) / Math.max(1, serverSourceW)) * 100,
                topPct: (Number(so.cy) / Math.max(1, serverSourceH)) * 100,
                wPct: (Number(so.w) / Math.max(1, serverSourceW)) * 100,
                hPct: (Number(so.h) / Math.max(1, serverSourceH)) * 100,
                transform: `translate(-50%, -50%) rotate(${Number(so.angle_deg || 0)}deg)`,
            }
            if (FACIAL_STRICT_OVAL_MODE) {
                return serverLayout
            }
            return mapOvalLayoutVideoToStage(
                serverLayout,
                serverSourceW,
                serverSourceH,
                sw,
                sh
            )
        }
        const layout = computeBiometricOvalLayout(liveFaceBox, fw, fh)
        if (!layout) {
            return null
        }
        if (FACIAL_STRICT_OVAL_MODE) {
            return layout
        }
        return mapOvalLayoutVideoToStage(layout, fw, fh, sw, sh)
    }, [
        liveFaceBox,
        frameMetrics.width,
        frameMetrics.height,
        cameraStageSize.width,
        cameraStageSize.height,
        faceGuide.serverFaceOval,
    ])

    const canRegister = useMemo(() => {
        const passwordsMatch =
            registerForm.password.trim().length >= 6 &&
            registerForm.password === registerForm.passwordConfirm
        let valuesOk = false
        if (registerTab === 'company') {
            valuesOk =
                registerForm.ruc.trim().length >= 11 &&
                registerForm.rucValid &&
                registerForm.company.trim() &&
                registerForm.firstName.trim() &&
                registerForm.lastName.trim() &&
                registerForm.dni.trim().length >= 8 &&
                registerForm.username.trim().length >= 4 &&
                passwordsMatch
        } else {
            valuesOk =
                registerForm.company.trim() &&
                registerForm.firstName.trim() &&
                registerForm.lastName.trim() &&
                registerForm.dni.trim().length >= 8 &&
                registerForm.email.trim().length >= 5 &&
                registerForm.mobile.trim().length >= 6 &&
                registerForm.username.trim().length >= 4 &&
                passwordsMatch
        }
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
                if (!active) {
                    return
                }
                if (!Array.isArray(apiCompanies) || apiCompanies.length === 0) {
                    setCompanies(DEFAULT_COMPANIES)
                    setLoginForm((prev) => ({ ...prev, company: DEFAULT_COMPANIES[0] }))
                    setRegisterForm((prev) => ({ ...prev, company: DEFAULT_COMPANIES[0] }))
                    return
                }

                const uniqueCompanies = Array.from(new Set(apiCompanies))
                setCompanies(uniqueCompanies)
                setLoginForm((prev) => {
                    const cur = String(prev.company || '').trim()
                    if (cur && uniqueCompanies.includes(cur)) {
                        return prev
                    }
                    return { ...prev, company: uniqueCompanies[0] }
                })
                setRegisterForm((prev) => {
                    const cur = String(prev.company || '').trim()
                    if (cur && uniqueCompanies.includes(cur)) {
                        return prev
                    }
                    return { ...prev, company: uniqueCompanies[0] }
                })
            } catch (err) {
                console.warn('[AUTH_UI] fetchCompanies failed; using local catalog', err)
                setCompanies(DEFAULT_COMPANIES)
                setLoginForm((prev) => ({ ...prev, company: DEFAULT_COMPANIES[0] }))
                setRegisterForm((prev) => ({ ...prev, company: DEFAULT_COMPANIES[0] }))
            }
        }

        loadCompanies()
        return () => {
            active = false
        }
    }, [])

    useLayoutEffect(() => {
        const el = cameraStageRef.current
        if (!el || typeof ResizeObserver === 'undefined') {
            return undefined
        }
        const apply = (w, h) => {
            if (w > 0 && h > 0) {
                setCameraStageSize({ width: w, height: h })
            }
        }
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect
            if (cr) {
                apply(cr.width, cr.height)
            }
        })
        ro.observe(el)
        apply(el.clientWidth, el.clientHeight)
        return () => ro.disconnect()
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

    const shouldUseFaceCamera =
        (mode === 'login' && loginBiometricSession) ||
        (mode === 'register' && registerTab === 'company') ||
        registerUserCaptureView

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
                            width: { ideal: 640, min: 320 },
                            height: { ideal: 480, min: 240 },
                            aspectRatio: { ideal: 4 / 3 },
                            frameRate: FACIAL_ICAO.CAMERA.frameRate,
                        },
                        audio: false,
                    })
                } catch {
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

        if (!shouldUseFaceCamera) {
            if (cameraRetryTimerRef.current) {
                clearTimeout(cameraRetryTimerRef.current)
                cameraRetryTimerRef.current = null
            }
            stopCurrentStream()
            setCameraReady(false)
            return () => {
                cancelled = true
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
    }, [shouldUseFaceCamera])

    useEffect(() => {
        setLoginBiometricSession(false)
        setLoginSessionSecondsLeft(null)
        identityAnchorRef.current = ''
        sessionClockRef.current = { start: 0, pausedMs: 0, pauseSince: null }
        setCapturedTemplate(null)
        setCapturedImageBase64('')
        setCapturedPortraitOvalBase64('')
        setCapturedBustRectBase64('')
        bestLoginProbeRef.current = null
        loginSubmitTriggeredRef.current = false
        validFramesRef.current = 0
        resetBiometricCapture().catch(() => {})
        setFaceGuide((prev) => ({
            ...prev,
            qualityReady: false,
            validFrames: 0,
            captureCount: 0,
            serverFaceOval: null,
        }))
        setRegisterUserBiometricStep('form')
        setRegistrationCompleteSession(null)
        setRegisterSessionSecondsLeft(null)
        registerFaceSessionClockRef.current = { start: 0, pausedMs: 0, pauseSince: null }
        registrationApiInFlightRef.current = false
        registerAutoSubmitTriggeredRef.current = false
    }, [mode, registerTab, loginTab])

    useEffect(() => {
        if (mode !== 'login' || !loginBiometricSession) {
            return
        }
        const key = `${loginForm.company}|${String(loginForm.username || '').trim()}`
        if (identityAnchorRef.current && identityAnchorRef.current !== key) {
            endLoginFaceSession({
                errorMessage:
                    'Se modificó empresa o usuario. Active de nuevo la verificación facial.',
            })
        }
    }, [loginForm.company, loginForm.username, mode, loginBiometricSession, endLoginFaceSession])

    useEffect(() => {
        if (mode === 'login' && loginBiometricSession) {
            const c = sessionClockRef.current
            if (isProcessing) {
                if (!c.pauseSince) {
                    c.pauseSince = Date.now()
                }
            } else if (c.pauseSince) {
                c.pausedMs += Date.now() - c.pauseSince
                c.pauseSince = null
            }
        }
        if (registerUserCaptureView) {
            const r = registerFaceSessionClockRef.current
            if (isProcessing) {
                if (!r.pauseSince) {
                    r.pauseSince = Date.now()
                }
            } else if (r.pauseSince) {
                r.pausedMs += Date.now() - r.pauseSince
                r.pauseSince = null
            }
        }
    }, [isProcessing, mode, loginBiometricSession, registerUserCaptureView])

    useEffect(() => {
        if (!loginBiometricSession || mode !== 'login') {
            setLoginSessionSecondsLeft(null)
            return
        }
        const id = setInterval(() => {
            if (!loginBiometricSessionRef.current) {
                return
            }
            const c = sessionClockRef.current
            if (!c.start) {
                return
            }
            let pausedExtra = 0
            if (c.pauseSince) {
                pausedExtra = Date.now() - c.pauseSince
            }
            const elapsed = Date.now() - c.start - c.pausedMs - pausedExtra
            const left = Math.ceil(
                (FACIAL_ICAO.LOGIN_FACE_SESSION_MS - elapsed) / 1000
            )
            if (left <= 0 && !isProcessingRef.current) {
                endLoginFaceSessionRef.current({
                    errorMessage: FACIAL_ICAO.LOGIN_FACE_TIMEOUT_MESSAGE,
                })
                return
            }
            setLoginSessionSecondsLeft(Math.max(0, left))
        }, 250)
        return () => clearInterval(id)
    }, [loginBiometricSession, mode])

    useEffect(() => {
        if (!registerUserCaptureView) {
            setRegisterSessionSecondsLeft(null)
            return
        }
        const id = setInterval(() => {
            if (registerUserBiometricStepRef.current !== 'capture') {
                return
            }
            const c = registerFaceSessionClockRef.current
            if (!c.start) {
                return
            }
            let pausedExtra = 0
            if (c.pauseSince) {
                pausedExtra = Date.now() - c.pauseSince
            }
            const elapsed = Date.now() - c.start - c.pausedMs - pausedExtra
            const left = Math.ceil(
                (FACIAL_ICAO.LOGIN_FACE_SESSION_MS - elapsed) / 1000
            )
            if (
                left <= 0 &&
                !isProcessingRef.current &&
                !registrationApiInFlightRef.current
            ) {
                endRegisterFaceSessionRef.current({
                    errorMessage: FACIAL_ICAO.LOGIN_FACE_TIMEOUT_MESSAGE,
                })
                return
            }
            setRegisterSessionSecondsLeft(Math.max(0, left))
        }, 250)
        return () => clearInterval(id)
    }, [registerUserCaptureView])

    useEffect(() => {
        let requestID = null
        let lastTimestamp = 0

        async function detectFaceLoop(timestamp) {
            const video = videoRef.current
            
            const difficultPrev =
                difficultLightingScoreRef.current >= FACIAL_ICAO.DIFFICULT_LIGHTING_ON_THRESHOLD
            const frameMinMs = difficultPrev
                ? FACIAL_ICAO.NIGHT_DETECT_FRAME_MIN_MS
                : FACIAL_ICAO.DETECT_FRAME_MIN_MS
            if (timestamp - lastTimestamp < frameMinMs) {
                requestID = requestAnimationFrame(detectFaceLoop)
                return
            }
            lastTimestamp = timestamp

            if (!video || !cameraReady || video.videoWidth < 32 || video.videoHeight < 32) {
                requestID = requestAnimationFrame(detectFaceLoop)
                return
            }

            try {
                let bestFace = null

                const pw = FACIAL_ICAO.CAMERA.width.ideal
                const ph = FACIAL_ICAO.CAMERA.height.ideal
                const vw = video.videoWidth
                const vh = video.videoHeight

                const pCanvas =
                    processFrameCanvasRef.current || document.createElement('canvas')
                processFrameCanvasRef.current = pCanvas
                pCanvas.width = pw
                pCanvas.height = ph
                const pCtx = pCanvas.getContext('2d', { willReadFrequently: true })
                pCtx.filter = 'none'
                pCtx.drawImage(video, 0, 0, vw, vh, 0, 0, pw, ph)

                const lightSample = pCtx.getImageData(0, 0, pw, ph)
                const rawMean = meanLuminanceImageData(lightSample)
                const rawStd = luminanceStdDevImageData(lightSample, rawMean)
                const rawHard = classifyRawDifficultLighting(rawMean, rawStd)
                let dlScore =
                    difficultLightingScoreRef.current +
                    (rawHard
                        ? FACIAL_ICAO.DIFFICULT_LIGHTING_RISE_PER_FRAME
                        : -FACIAL_ICAO.DIFFICULT_LIGHTING_FALL_PER_FRAME)
                dlScore = Math.max(0, Math.min(1, dlScore))
                difficultLightingScoreRef.current = dlScore
                const difficultActive =
                    dlScore >= FACIAL_ICAO.DIFFICULT_LIGHTING_ON_THRESHOLD

                if (
                    frameMetrics.width !== pw ||
                    frameMetrics.height !== ph
                ) {
                    setFrameMetrics({ width: pw, height: ph })
                }

                const hasNativeFaceDetector = 'FaceDetector' in window
                if (hasNativeFaceDetector) {
                    if (!detectorRef.current) {
                        detectorRef.current = new window.FaceDetector({
                            maxDetectedFaces: 1,
                        })
                    }

                    const detections = await detectorRef.current.detect(pCanvas)
                    if (detections.length > 0) {
                        missedDetectorFramesRef.current = 0
                        const box = detections[0].boundingBox
                        bestFace = {
                            x: box.x,
                            y: box.y,
                            width: box.width,
                            height: box.height,
                            landmarks: (detections[0].landmarks || []).map((l) => ({
                                ...l,
                                locations: l.locations.map((loc) => ({
                                    x: loc.x,
                                    y: loc.y,
                                })),
                            })),
                        }
                    } else {
                        missedDetectorFramesRef.current += 1
                    }
                }

                if (!bestFace && !hasNativeFaceDetector) {
                    const canvas =
                        trackingFallbackCanvasRef.current ||
                        document.createElement('canvas')
                    trackingFallbackCanvasRef.current = canvas
                    canvas.width = 160
                    canvas.height = 120
                    const ctx = canvas.getContext('2d', { willReadFrequently: true })
                    ctx.drawImage(pCanvas, 0, 0, pw, ph, 0, 0, 160, 120)
                    const centroid = getSkinCentroid(ctx, 160, 120)
                    if (centroid && centroid.density > 0.05) {
                        const targetWidth = pw * 0.45
                        const targetHeight = ph * 0.75
                        const x = Math.max(
                            0,
                            Math.min(
                                pw - targetWidth,
                                (centroid.x / 160) * pw - targetWidth / 2
                            )
                        )
                        const y = Math.max(
                            0,
                            Math.min(
                                ph - targetHeight,
                                (centroid.y / 120) * ph - targetHeight / 2
                            )
                        )
                        bestFace = {
                            x,
                            y,
                            width: targetWidth,
                            height: targetHeight,
                            landmarks: [],
                            isFallback: true,
                        }
                    }
                }

                if (!bestFace && smoothedFaceRef.current && missedDetectorFramesRef.current <= 6) {
                    bestFace = {
                        ...smoothedFaceRef.current,
                        landmarks: [],
                        isFallback: false,
                    }
                }

                    if (bestFace) {
                    const hist = faceBoxHistoryRef.current
                    const histMax = difficultActive
                        ? FACIAL_ICAO.NIGHT_FACE_BOX_HISTORY_LEN
                        : FACIAL_ICAO.FACE_BOX_HISTORY_LEN
                    const medianMin = difficultActive
                        ? FACIAL_ICAO.NIGHT_FACE_BOX_MEDIAN_MIN_SAMPLES
                        : FACIAL_ICAO.FACE_BOX_MEDIAN_MIN_SAMPLES
                    hist.push({
                        x: bestFace.x,
                        y: bestFace.y,
                        width: bestFace.width,
                        height: bestFace.height,
                        landmarks: bestFace.landmarks,
                        isFallback: bestFace.isFallback,
                    })
                    while (hist.length > histMax) {
                        hist.shift()
                    }
                    const rawLm = bestFace.landmarks
                    const rawFb = bestFace.isFallback
                    if (hist.length >= medianMin) {
                        const med = medianFaceBoundingBox(hist)
                        if (med) {
                            bestFace = {
                                ...med,
                                landmarks: rawLm,
                                isFallback: rawFb,
                            }
                        }
                    }
                } else {
                    faceBoxHistoryRef.current = []
                }

                let frontal = false
                let hasLandmarks = false
                let eyesOpen = false
                let mouthClosed = false

                if (!bestFace) {
                    setLiveFaceBox(null)
                    setCapturedTemplate(null)
                    setCapturedImageBase64('')
                    setCapturedPortraitOvalBase64('')
                    setCapturedBustRectBase64('')
                    bestLoginProbeRef.current = null
                    validFramesRef.current = 0
                    smoothedFaceRef.current = null
                    lastVerifyOkRef.current = false
                    lastServerLivenessRef.current = 0
                    livenessBlinkRef.current = 0
                    livenessMouthEventsRef.current = 0
                    prevEyesOpenLandmarkRef.current = null
                    blinkCloseStartedAtRef.current = null
                    mouthWasOpenPhaseRef.current = false
                    livenessScoreRef.current = 0
                    livenessFallbackRef.current = 0
                    bboxMotionHistRef.current = []
                    motionLivenessPtsRef.current = 0
                    lastMotionLivenessBoostAtRef.current = 0
                    eyesBlinkHystRef.current = true
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
                        validFrames: 0,
                        captureCount: 0,
                        lastServerOk: false,
                        icaoEyes: null,
                        icaoMouth: null,
                        icaoFrontal: null,
                        icaoNoGlasses: null,
                        livenessScore: 0,
                        serverFaceOval: null,
                    }))
                } else {
                    if (smoothedFaceRef.current) {
                        let alpha = difficultActive
                            ? FACIAL_ICAO.NIGHT_FACE_BOX_EMA_ALPHA
                            : FACIAL_ICAO.FACE_BOX_EMA_ALPHA
                        const jump = faceCenterJumpRatio(
                            bestFace,
                            smoothedFaceRef.current
                        )
                        const jumpTh = difficultActive
                            ? FACIAL_ICAO.NIGHT_FACE_BOX_OUTLIER_JUMP_RATIO
                            : FACIAL_ICAO.FACE_BOX_OUTLIER_JUMP_RATIO
                        if (jump > jumpTh) {
                            alpha = difficultActive
                                ? FACIAL_ICAO.NIGHT_FACE_BOX_EMA_ALPHA_OUTLIER
                                : FACIAL_ICAO.FACE_BOX_EMA_ALPHA_OUTLIER
                        } else if (jump < 0.04) {
                            // Mayor respuesta al movimiento real (menos retardo perceptible).
                            alpha = Math.max(alpha, 0.28)
                        }
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
                    /** Histéresis sobre apertura mínima (evita que el ratio quede siempre “abierto” y no cuente parpadeos). */
                    let blinkGateOpen = eyesOpen
                    if (hasLandmarks && leftEye && rightEye) {
                        const eyeMin = Math.min(
                            eyeOpenness(leftEye),
                            eyeOpenness(rightEye)
                        )
                        const hi = 0.2
                        const lo = 0.1
                        if (eyesBlinkHystRef.current) {
                            if (eyeMin < lo) {
                                eyesBlinkHystRef.current = false
                            }
                        } else if (eyeMin > hi) {
                            eyesBlinkHystRef.current = true
                        }
                        blinkGateOpen = eyesBlinkHystRef.current
                    } else {
                        eyesBlinkHystRef.current = true
                        blinkGateOpen = true
                    }

                    const isMouthOpen = hasLandmarks
                        ? mouthRatio > FACIAL_ICAO.MOUTH_OPEN_LANDMARK_RATIO
                        : false
                    mouthClosed = hasLandmarks ? !isMouthOpen : false
                    frontal = frontalByAspect && eyesAligned

                    const now = performance.now()

                    const vwM = pw
                    const vhM = ph
                    const mhist = bboxMotionHistRef.current
                    mhist.push({
                        nx: (bestFace.x + bestFace.width / 2) / vwM,
                        ny: (bestFace.y + bestFace.height / 2) / vhM,
                    })
                    while (mhist.length > 30) {
                        mhist.shift()
                    }
                    if (mhist.length >= 8) {
                        const mx =
                            mhist.reduce((s, p) => s + p.nx, 0) / mhist.length
                        const my =
                            mhist.reduce((s, p) => s + p.ny, 0) / mhist.length
                        let vx = 0
                        let vy = 0
                        for (const p of mhist) {
                            const dx = p.nx - mx
                            const dy = p.ny - my
                            vx += dx * dx
                            vy += dy * dy
                        }
                        const v = (vx + vy) / mhist.length
                        if (v > 3e-6 && v < 0.00014) {
                            if (now - lastMotionLivenessBoostAtRef.current >= 160) {
                                lastMotionLivenessBoostAtRef.current = now
                                motionLivenessPtsRef.current = Math.min(
                                    100,
                                    motionLivenessPtsRef.current + 11
                                )
                            }
                        } else if (v < 4e-8) {
                            motionLivenessPtsRef.current = Math.max(
                                0,
                                motionLivenessPtsRef.current - 0.55
                            )
                        }
                    }

                    if (hasLandmarks) {
                        const prevO = prevEyesOpenLandmarkRef.current
                        if (prevO === true && !blinkGateOpen) {
                            blinkCloseStartedAtRef.current = now
                        }
                        if (
                            prevO === false &&
                            blinkGateOpen &&
                            blinkCloseStartedAtRef.current != null
                        ) {
                            const dtBlink = now - blinkCloseStartedAtRef.current
                            if (dtBlink > 80 && dtBlink < 700) {
                                livenessBlinkRef.current += 1
                            }
                            blinkCloseStartedAtRef.current = null
                        }
                        if (
                            !blinkGateOpen &&
                            blinkCloseStartedAtRef.current != null &&
                            now - blinkCloseStartedAtRef.current > 900
                        ) {
                            blinkCloseStartedAtRef.current = null
                        }
                        prevEyesOpenLandmarkRef.current = blinkGateOpen

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

                        // Motor (/api/process_frame): JPEG 640×480 misma escala que process-canvas en C:\FACIAL\www\main.js
                        // y que el FaceDetector (processFrameCanvasRef).
                        // Parpadeo/boca en cliente siguen usando landmarks del FaceDetector sobre el bbox.
                        const tw = FACIAL_ICAO.CAMERA.width.ideal
                        const th = FACIAL_ICAO.CAMERA.height.ideal
                        const base64 = buildFullFrameJpegBase64FromVideo(
                            video,
                            tw,
                            th,
                            FACIAL_ICAO.VERIFY_JPEG_QUALITY
                        )

                        processBiometricFrame(base64)
                            .then(() => fetchBiometricStatus())
                            .then((status) => {
                                syncingRef.current = false
                                const icao = status?.icao || {}
                                const four = {
                                    eyes: Boolean(icao.eyes_open),
                                    mouth: Boolean(icao.mouth_closed),
                                    frontal: Boolean(icao.face_straight),
                                    noGlasses: Boolean(icao.no_glasses),
                                }
                                lastServerLivenessRef.current = Number(
                                    status?.liveness_score ?? 0
                                )
                                lastVerifyOkRef.current = Boolean(
                                    four.eyes &&
                                        four.mouth &&
                                        four.frontal &&
                                        four.noGlasses
                                )
                                lastIcaoFourRef.current = four
                                if (hasLandmarks) {
                                    if (!lastVerifyOkRef.current) {
                                        livenessFallbackRef.current = 0
                                    }
                                } else if (lastVerifyOkRef.current) {
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
                                    lastServerOk: lastVerifyOkRef.current,
                                    captureCount: Number(status?.capture_count || 0),
                                    icaoEyes: four.eyes,
                                    icaoMouth: four.mouth,
                                    icaoFrontal: four.frontal,
                                    icaoNoGlasses: four.noGlasses,
                                    serverFaceOval:
                                        status?.face_oval &&
                                        typeof status.face_oval === 'object'
                                            ? status.face_oval
                                            : null,
                                }))
                            })
                            .catch(() => {
                                syncingRef.current = false
                                lastVerifyOkRef.current = false
                            })
                    }

                    setFaceGuide((prev) => {
                        const frameW = pw
                        const frameH = ph
                        let faceInsideTargetZone = true
                        if (FACIAL_STRICT_OVAL_MODE) {
                            const centerX = bestFace.x + bestFace.width / 2
                            const centerY = bestFace.y + bestFace.height / 2
                            const zoneCx = frameW * 0.5
                            const zoneCy = frameH * 0.5
                            const zoneRx = frameW * (FACIAL_STRICT_OVAL_W_PCT / 100) * 0.5
                            const zoneRy = frameH * (FACIAL_STRICT_OVAL_H_PCT / 100) * 0.5
                            const nx = (centerX - zoneCx) / Math.max(1, zoneRx)
                            const ny = (centerY - zoneCy) / Math.max(1, zoneRy)
                            faceInsideTargetZone = nx * nx + ny * ny <= 1
                        }
                        faceInTargetZoneRef.current = faceInsideTargetZone

                        const I = lastIcaoFourRef.current
                        const blinkPts = livenessScoreRef.current
                        const motionPts = motionLivenessPtsRef.current
                        const clientLv = Math.min(
                            100,
                            Math.max(blinkPts, motionPts)
                        )
                        const fallbackLv = livenessFallbackRef.current
                        const lv = Math.min(
                            100,
                            Math.max(
                                hasLandmarks ? clientLv : Math.max(clientLv, fallbackLv),
                                lastServerLivenessRef.current
                            )
                        )
                        const livenessPass =
                            lv >= FACIAL_ICAO.LIVENESS_SCORE_PASS
                        const baseChecksOk =
                            faceInsideTargetZone &&
                            lastVerifyOkRef.current &&
                            livenessPass &&
                            I.eyes &&
                            I.mouth &&
                            I.frontal &&
                            I.noGlasses
                        if (baseChecksOk) {
                            validFramesRef.current = Math.min(
                                FACIAL_ICAO.REQUIRED_VALID_FRAMES,
                                validFramesRef.current + 1
                            )
                        } else {
                            validFramesRef.current = 0
                        }
                        const qualityReady =
                            validFramesRef.current >= FACIAL_ICAO.REQUIRED_VALID_FRAMES

                        const updated = {
                            ...prev,
                            detected: true,
                            frontal,
                            eyesOpen,
                            mouthClosed,
                            livenessScore: lv,
                            inTargetZone: faceInsideTargetZone,
                            validFrames: validFramesRef.current,
                            qualityReady,
                        }

                        if (updated.qualityReady && hasFaceNow) {
                            const template = frameToTemplate(video, bestFace)
                            const imageBase64 = frameToJpegBase64(video, bestFace)
                            const portraitOvalBase64 = frameToOvalPortraitJpegBase64(
                                video,
                                bestFace
                            )
                            const candidateScore =
                                Number(lv || 0) +
                                (lastVerifyOkRef.current ? 35 : 0) +
                                Number(validFramesRef.current || 0) * 10
                            const prevBest = bestLoginProbeRef.current
                            if (!prevBest || candidateScore >= prevBest.score) {
                                bestLoginProbeRef.current = {
                                    template,
                                    imageBase64,
                                    portraitOvalBase64,
                                    score: candidateScore,
                                    capturedAt: Date.now(),
                                }
                                setCapturedTemplate(template)
                                setCapturedImageBase64(imageBase64)
                                setCapturedPortraitOvalBase64(portraitOvalBase64)
                            }
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
        const shouldAutoFaceLogin =
            mode === 'login' &&
            loginBiometricSession &&
            !message.includes('Ingreso autorizado')
        const shouldAutoRegisterCapture =
            mode === 'register' &&
            (registerTab === 'company' ||
                (registerTab === 'user' &&
                    registerUserBiometricStep === 'capture'))
        const gateOk = loginBiometricGate && !isProcessing
        if (shouldAutoFaceLogin && hasRequiredBiometricSamples && !isProcessing) {
            const now = performance.now()
            if (!gateOk && now - authFaceAutoDiagAtRef.current > 2000) {
                authFaceAutoDiagAtRef.current = now
                console.info('[AUTH_FACE_AUTO] 3/3 muestras pero gate de envío cerrado', {
                    qualityReady: Boolean(faceGuide.qualityReady),
                    validFrames: Number(faceGuide.validFrames || 0),
                    captureCount: Number(faceGuide.captureCount || 0),
                    lastServerOk: Boolean(faceGuide.lastServerOk),
                    loginBiometricGate,
                    isProcessing,
                    loginSubmitTriggered: loginSubmitTriggeredRef.current,
                    hint: 'El contador en pantalla es del servidor; qualityReady es local (ICAO+liveness). Si divergen, antes no se disparaba el login.',
                })
            }
        }
        if (gateOk) {
            if (
                shouldAutoFaceLogin &&
                hasRequiredBiometricSamples &&
                !loginSubmitTriggeredRef.current
            ) {
                console.info('[AUTH_FACE_AUTO] disparando login facial', {
                    qualityReady: Boolean(faceGuide.qualityReady),
                    captureCount: Number(faceGuide.captureCount || 0),
                    lastServerOk: Boolean(faceGuide.lastServerOk),
                    hasProbe: Boolean(bestLoginProbeRef.current),
                })
                loginSubmitTriggeredRef.current = true
                lastAutoTriggerRef.current = performance.now()
                handleFaceLogin(bestLoginProbeRef.current)
            } else {
                const now = performance.now()
                if (now - lastAutoTriggerRef.current >= FACIAL_ICAO.CAPTURE_COOLDOWN_MS) {
                    timer = setTimeout(() => {
                        lastAutoTriggerRef.current = performance.now()
                        /* Registro usuario 3/3: solo useEffect directo (sin delay). Empresa u otros flujos siguen aquí. */
                        if (
                            shouldAutoRegisterCapture &&
                            hasRequiredBiometricSamples &&
                            !(
                                registerTab === 'user' &&
                                registerUserBiometricStep === 'capture'
                            )
                        ) {
                            console.info('[AUTH_REGISTER_FLOW] auto trigger 3/3', {
                                mode,
                                registerTab,
                                step: registerUserBiometricStep,
                                captureCount: Number(faceGuide.captureCount || 0),
                                requiredFrames: Number(FACIAL_ICAO.REQUIRED_VALID_FRAMES),
                            })
                            handleCaptureForRegistration()
                        }
                    }, FACIAL_ICAO.AUTO_CAPTURE_DELAY_MS)
                }
            }
        }
        return () => {
            if (timer) clearTimeout(timer)
        }
    }, [
        loginBiometricGate,
        hasRequiredBiometricSamples,
        isProcessing,
        mode,
        capturedTemplate,
        message,
        loginBiometricSession,
        faceGuide.captureCount,
        faceGuide.qualityReady,
        faceGuide.validFrames,
        faceGuide.lastServerOk,
        registerTab,
        registerUserBiometricStep,
    ])

    useEffect(() => {
        const inRegisterCapture =
            mode === 'register' &&
            registerTab === 'user' &&
            registerUserBiometricStep === 'capture'
        const samples = Number(faceGuide.captureCount || 0)
        if (!inRegisterCapture) {
            registerAutoSubmitTriggeredRef.current = false
            return
        }
        if (samples < FACIAL_ICAO.REQUIRED_VALID_FRAMES) {
            registerAutoSubmitTriggeredRef.current = false
            return
        }
        if (isProcessing || registrationApiInFlightRef.current) {
            return
        }
        if (registerAutoSubmitTriggeredRef.current) {
            return
        }
        registerAutoSubmitTriggeredRef.current = true
        console.info('[AUTH_REGISTER_FLOW] direct trigger by samples', {
            samples,
            requiredFrames: Number(FACIAL_ICAO.REQUIRED_VALID_FRAMES),
            qualityReady: Boolean(faceGuide.qualityReady),
            lastServerOk: Boolean(faceGuide.lastServerOk),
        })
        handleCaptureForRegistration()
    }, [
        mode,
        registerTab,
        registerUserBiometricStep,
        faceGuide.captureCount,
        faceGuide.qualityReady,
        faceGuide.lastServerOk,
        isProcessing,
    ])

    const startLoginFaceSession = async () => {
        const id = String(loginForm.username || '').trim()
        const company = String(loginForm.company || '').trim()
        console.info('[AUTH_FACE_UI] start session requested', {
            company,
            identity: id,
            loginTab,
        })
        if (!id) {
            setError(
                'Indique Usuario, DNI o RUC antes del reconocimiento facial.'
            )
            return
        }
        if (!company) {
            setError('Seleccione la empresa asignada / compañía.')
            return
        }
        setError('')
        setMessage('')
        setIsProcessing(true)
        try {
            const check = await checkLoginIdentity(company, id)
            if (check.ok !== true) {
                const msg =
                    check.reason === 'not_found' || check.reason === 'invalid_response'
                        ? 'USUARIO NO EXISTE'
                        : check.error || 'USUARIO NO EXISTE'
                setError(msg)
                console.warn('[AUTH_FACE_UI] identidad rechazada antes de cámara', {
                    company,
                    identity: id,
                    reason: check.reason,
                    rawOk: check.ok,
                })
                return
            }
            console.info('[AUTH_FACE_UI] identidad verificada, abriendo sesión facial', {
                company,
                resolvedUsername: check.username,
            })
            identityAnchorRef.current = `${company}|${id}`
            sessionClockRef.current = {
                start: Date.now(),
                pausedMs: 0,
                pauseSince: null,
            }
            setCapturedTemplate(null)
            setCapturedImageBase64('')
            setCapturedPortraitOvalBase64('')
            setCapturedBustRectBase64('')
            bestLoginProbeRef.current = null
            loginSubmitTriggeredRef.current = false
            authFaceAutoDiagAtRef.current = 0
            validFramesRef.current = 0
            resetBiometricCapture().catch(() => {})
            setFaceGuide((prev) => ({
                ...prev,
                qualityReady: false,
                validFrames: 0,
                captureCount: 0,
                lastServerOk: false,
            }))
            setLoginBiometricSession(true)
        } catch (e) {
            setError(
                e?.message ||
                    'No se pudo comprobar el usuario con el servidor. Intente de nuevo.'
            )
        } finally {
            setIsProcessing(false)
        }
    }

    const handleFaceLogin = async (probeOverride = null) => {
        if (!videoRef.current || !cameraReady) {
            loginSubmitTriggeredRef.current = false
            console.warn('[AUTH_FACE_UI] handleFaceLogin abort: camera', {
                hasVideo: Boolean(videoRef.current),
                cameraReady,
            })
            setError('La camara no esta lista.')
            return
        }
        if (mode === 'login' && !loginBiometricSessionRef.current) {
            loginSubmitTriggeredRef.current = false
            console.warn('[AUTH_FACE_UI] handleFaceLogin abort: no sesión biométrica login')
            setError(
                'Active la verificación facial con el botón «Ingresar con Reconocimiento Facial».'
            )
            return
        }

        const id = String(loginForm.username || '').trim()
        if (!id) {
            loginSubmitTriggeredRef.current = false
            console.warn('[AUTH_FACE_UI] handleFaceLogin abort: identidad vacía')
            setError(
                'Indique Usuario, DNI o RUC antes del reconocimiento facial.'
            )
            return
        }

        setIsProcessing(true)
        setError('')
        setMessage('')

        try {
            const probe =
                probeOverride ||
                bestLoginProbeRef.current || {
                    template: frameToTemplate(videoRef.current, liveFaceBox),
                    imageBase64: frameToJpegBase64(videoRef.current, liveFaceBox),
                    score: -1,
                }
            const template = probe.template
            const imageBase64 = probe.imageBase64
            console.info('[AUTH_FACE_UI] submit face login', {
                company: String(loginForm.company || '').trim(),
                identity: id,
                template_dim: Array.isArray(template) ? template.length : 0,
                has_image_base64: Boolean(imageBase64),
                image_base64_len: imageBase64?.length || 0,
                chosen_probe_score: Number(probe?.score || 0),
                quality_ready: Boolean(faceGuide.qualityReady),
                capture_count: Number(faceGuide.captureCount || 0),
            })
            const result = await loginWithFace({
                company: loginForm.company,
                identityLogin: id,
                template,
                imageBase64,
            })
            const user = result.user
            const score = result.score || 0
            console.info('[AUTH_FACE_UI] login success', {
                user: user?.username,
                company: user?.company,
                score,
                provider: result?.biometric_provider || 'unknown',
            })
            const session = createSession(user, loginTab)
            setMessage(`Rostro validado (${(score * 100).toFixed(1)}%). Ingreso autorizado.`)
            onAuthenticated(session)
        } catch (err) {
            loginSubmitTriggeredRef.current = false
            console.warn('[AUTH_FACE_UI] login failed', {
                message: err?.message || String(err),
                company: String(loginForm.company || '').trim(),
                identity: id,
            })
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
            if (!String(loginForm.username || '').trim()) {
                setError('Indique Usuario, DNI o RUC.')
                return
            }
            if (!String(loginForm.password || '').trim()) {
                setError('Indique la contraseña.')
                return
            }
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

    const handleCaptureForRegistration = async () => {
        const isUserRegisterCapture =
            mode === 'register' &&
            registerTab === 'user' &&
            registerUserBiometricStepRef.current === 'capture'

        const releaseRegisterAutoTrigger = (reason) => {
            if (!isUserRegisterCapture) return
            console.info('[AUTH_REGISTER_FLOW] registerAutoSubmit ref liberado', { reason })
            registerAutoSubmitTriggeredRef.current = false
        }

        const serverSamplesReady =
            Number(faceGuide.captureCount || 0) >= FACIAL_ICAO.REQUIRED_VALID_FRAMES &&
            Boolean(faceGuide.lastServerOk)

        console.info('[AUTH_REGISTER_FLOW] capture invoked', {
            mode,
            registerTab,
            step: registerUserBiometricStepRef.current,
            captureCount: Number(faceGuide.captureCount || 0),
            lastServerOk: Boolean(faceGuide.lastServerOk),
            serverSamplesReady,
            qualityReady: Boolean(faceGuide.qualityReady),
            detected: Boolean(faceGuide.detected),
            cameraReady: Boolean(cameraReady),
            inFlight: Boolean(registrationApiInFlightRef.current),
            isUserRegisterCapture,
        })
        if (registrationApiInFlightRef.current) {
            console.info('[AUTH_REGISTER_FLOW] blocked: request already in flight')
            return
        }
        if (!videoRef.current || !cameraReady) {
            setError('La camara no esta lista para el registro facial.')
            console.warn('[AUTH_REGISTER_FLOW] blocked: camera not ready')
            releaseRegisterAutoTrigger('camera_not_ready')
            return
        }

        if (!faceGuide.detected) {
            setError('Mantenga el rostro visible y centrado en el ovalo.')
            console.warn('[AUTH_REGISTER_FLOW] blocked: face not detected')
            releaseRegisterAutoTrigger('not_detected')
            return
        }
        if (!faceGuide.qualityReady && !serverSamplesReady) {
            setError(
                'Complete los 5 parámetros ICAO + liveness (FACIAL): ojos, boca, frontalidad, sin lentes y anti-spoofing ≥ 70%.'
            )
            console.warn('[AUTH_REGISTER_FLOW] blocked: quality_gate', {
                qualityReady: Boolean(faceGuide.qualityReady),
                captureCount: Number(faceGuide.captureCount || 0),
                lastServerOk: Boolean(faceGuide.lastServerOk),
                serverSamplesReady,
            })
            releaseRegisterAutoTrigger('quality_gate')
            return
        }
        if (isUserRegisterCapture && serverSamplesReady && !faceGuide.qualityReady) {
            console.info(
                '[AUTH_REGISTER_FLOW] envío permitido por 3/3 servidor + último frame OK (qualityReady local false)'
            )
        }

        const template = frameToTemplate(videoRef.current, liveFaceBox)
        const imageBase64 = frameToJpegBase64(videoRef.current, liveFaceBox)
        const portraitOvalBase64 = frameToOvalPortraitJpegBase64(
            videoRef.current,
            liveFaceBox
        )
        const bustRectBase64 = frameToBustRectAroundOvalJpegBase64(
            videoRef.current,
            liveFaceBox
        )

        if (isUserRegisterCapture) {
            registrationApiInFlightRef.current = true
            setIsProcessing(true)
            setError('')
            setMessage('')
            console.info('[AUTH_REGISTER_FLOW] registerUser request', {
                company: String(registerForm.company || '').trim(),
                username: String(registerForm.username || '').trim(),
                dni: String(registerForm.dni || '').trim(),
                role: String(registerForm.role || '').trim(),
                imageB64Len: Number(imageBase64?.length || 0),
                portraitB64Len: Number(portraitOvalBase64?.length || 0),
                bustB64Len: Number(bustRectBase64?.length || 0),
                templateDim: Array.isArray(template) ? template.length : 0,
            })
            try {
                const result = await registerUser({
                    ...registerForm,
                    faceTemplate: template,
                    faceImageBase64: imageBase64,
                    facePortraitOvalBase64: portraitOvalBase64,
                    faceBustRectBase64: bustRectBase64,
                })
                console.info('[AUTH_REGISTER_FLOW] registerUser success', {
                    user: result?.user?.username,
                    company: result?.user?.company,
                    provider: result?.biometric_provider || 'unknown',
                    qualityScore: Number(result?.quality_score || 0),
                })
                setCapturedTemplate(template)
                setCapturedImageBase64(imageBase64)
                setRegisterUserBiometricStep('form')
                setRegisterSessionSecondsLeft(null)
                registerFaceSessionClockRef.current = {
                    start: 0,
                    pausedMs: 0,
                    pauseSince: null,
                }
                setCapturedTemplate(null)
                setCapturedImageBase64('')
                setCapturedPortraitOvalBase64('')
                setCapturedBustRectBase64('')
                setMessage(
                    'Registro completado. Ya puede iniciar sesión con su usuario y reconocimiento facial.'
                )
                /* alert() bloquea el hilo: difiere un tick para pintar fin de "procesando" */
                setTimeout(() => {
                    window.alert(
                        'Registro facial completado correctamente. Presione OK para volver a LOGIN.'
                    )
                }, 0)
                setMode('login')
                setError('')
                registerAutoSubmitTriggeredRef.current = false
            } catch (err) {
                setCapturedTemplate(null)
                setCapturedImageBase64('')
                setCapturedPortraitOvalBase64('')
                setCapturedBustRectBase64('')
                setError(err.message)
                releaseRegisterAutoTrigger('api_error')
                console.warn('[AUTH_REGISTER_FLOW] registerUser error', {
                    message: err?.message || String(err),
                    stack: err?.stack || null,
                })
            } finally {
                setIsProcessing(false)
                registrationApiInFlightRef.current = false
            }
            return
        }

        setCapturedTemplate(template)
        setCapturedImageBase64(imageBase64)
        setCapturedPortraitOvalBase64(portraitOvalBase64)
        setCapturedBustRectBase64(bustRectBase64)
        setMessage('Registro facial capturado correctamente.')
        setError('')
    }

    const startRegisterUserFaceCapture = () => {
        if (registerTab !== 'user') {
            return
        }
        const pw = String(registerForm.password || '')
        const pc = String(registerForm.passwordConfirm || '')
        if (pw.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres.')
            return
        }
        if (pw !== pc) {
            setError('Las contraseñas no coinciden.')
            return
        }
        if (!String(registerForm.company || '').trim()) {
            setError('Seleccione la empresa asignada.')
            return
        }
        if (!String(registerForm.dni || '').trim() || registerForm.dni.trim().length < 8) {
            setError('Indique un DNI válido (mínimo 8 caracteres).')
            return
        }
        if (!String(registerForm.firstName || '').trim()) {
            setError('Indique los nombres.')
            return
        }
        if (!String(registerForm.lastName || '').trim()) {
            setError('Indique los apellidos.')
            return
        }
        if (!String(registerForm.email || '').trim() || registerForm.email.trim().length < 5) {
            setError('Indique un correo electrónico válido.')
            return
        }
        if (!String(registerForm.mobile || '').trim() || registerForm.mobile.trim().length < 6) {
            setError('Indique un número de celular válido.')
            return
        }
        if (!String(registerForm.username || '').trim() || registerForm.username.trim().length < 4) {
            setError('El usuario de sistema debe tener al menos 4 caracteres.')
            return
        }
        setError('')
        setMessage('')
        setCapturedTemplate(null)
        setCapturedImageBase64('')
        setCapturedPortraitOvalBase64('')
        setCapturedBustRectBase64('')
        bestLoginProbeRef.current = null
        validFramesRef.current = 0
        resetBiometricCapture().catch(() => {})
        setFaceGuide((prev) => ({
            ...prev,
            qualityReady: false,
            validFrames: 0,
            captureCount: 0,
            lastServerOk: false,
        }))
        registerFaceSessionClockRef.current = {
            start: Date.now(),
            pausedMs: 0,
            pauseSince: null,
        }
        setRegisterSessionSecondsLeft(
            Math.max(1, Math.round(FACIAL_ICAO.LOGIN_FACE_SESSION_MS / 1000))
        )
        registerAutoSubmitTriggeredRef.current = false
        setRegisterUserBiometricStep('capture')
    }

    const handleRegister = async (event) => {
        event.preventDefault()
        if (registerForm.password !== registerForm.passwordConfirm) {
            setError('Las contraseñas no coinciden.')
            return
        }
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
                facePortraitOvalBase64: capturedPortraitOvalBase64 || undefined,
                faceBustRectBase64: capturedBustRectBase64 || undefined,
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
        <div
            className={`auth-screen${
                registerPersonFormOnlyView
                    ? ' auth-screen--register-person-fit'
                    : ''
            }`}
            data-auth-ui="icao-login-v2"
        >
            <div
                className="auth-background"
                style={{
                    backgroundImage: `url("${selectedLoginBgUrl}")`,
                }}
            />
            <div
                className="auth-shell"
                style={{
                    gridTemplateColumns: faceCaptureOnlyView
                        ? '1fr'
                        : showBiometricPanel
                          ? '1.1fr 1fr'
                          : '1fr',
                    width: faceCaptureOnlyView
                        ? 'min(900px, 100%)'
                        : showBiometricPanel
                          ? 'min(1080px, 100%)'
                          : registerPersonFormOnlyView
                            ? 'min(960px, 100%)'
                            : 'min(720px, 100%)',
                }}
            >
                {showBiometricPanel && (
                <section className="auth-panel auth-panel-main">
                    <div className="camera-card camera-card-tall">
                        <div className="camera-header">
                            <div className="camera-title camera-title-with-pill">
                                <span className="auth-pill auth-pill-inline">Control de acceso</span>
                                <Camera size={16} />
                                <span>Cámara</span>
                                <span
                                    className="auth-pill auth-pill-inline"
                                    style={{ opacity: 0.8, fontSize: '10px' }}
                                >
                                    build {BUILD_STAMP}
                                </span>
                            </div>
                            <span className={cameraReady ? 'status-dot online' : 'status-dot offline'}>
                                {cameraReady
                                    ? 'Activa'
                                    : mode === 'login' && !loginBiometricSession
                                      ? 'En espera'
                                      : 'Sin acceso'}
                            </span>
                            {faceSessionTimerActive &&
                                faceTimerSecondsLeft != null && (
                                    <div
                                        className={isCriticalTimer ? 'timer-critical-wrap' : ''}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            marginLeft: '10px',
                                            padding: '4px 8px',
                                            borderRadius: '10px',
                                            border: '1px solid rgba(34,211,238,0.45)',
                                            background: 'rgba(15, 23, 42, 0.82)',
                                        }}
                                    >
                                        <svg width="44" height="44" viewBox="0 0 52 52">
                                            <circle
                                                cx="26"
                                                cy="26"
                                                r="20"
                                                stroke="rgba(148,163,184,0.35)"
                                                strokeWidth="5"
                                                fill="none"
                                            />
                                            <circle
                                                cx="26"
                                                cy="26"
                                                r="20"
                                                stroke={timerStrokeColor}
                                                strokeWidth="5"
                                                fill="none"
                                                strokeLinecap="round"
                                                transform="rotate(-90 26 26)"
                                                strokeDasharray={timerCirc}
                                                strokeDashoffset={timerCirc * (1 - faceTimerProgress)}
                                                style={{
                                                    transition:
                                                        'stroke-dashoffset 650ms linear, stroke 250ms ease',
                                                    filter: `drop-shadow(0 0 6px ${timerGlowColor})`,
                                                }}
                                            />
                                            <text
                                                x="26"
                                                y="29"
                                                textAnchor="middle"
                                                fontSize="11"
                                                fontWeight="700"
                                                fill={faceTimerProgress > 0.33 ? '#fde68a' : '#fecaca'}
                                            >
                                                {faceTimerSecondsSafe}s
                                            </text>
                                        </svg>
                                        <div
                                            className={`text-[10px] tracking-wider uppercase opacity-90 ${
                                                isCriticalTimer ? 'text-red-300' : 'text-amber-200'
                                            }`}
                                        >
                                            Tiempo restante
                                        </div>
                                    </div>
                                )}
                        </div>
                        <div
                            ref={cameraStageRef}
                            className="camera-stage relative overflow-hidden camera-stage-tall"
                            style={{ background: '#000' }}
                        >
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                className="camera-preview camera-preview-tall w-full h-full object-contain"
                                style={{ display: cameraReady ? 'block' : 'none' }}
                            />
                            
                            {/* Marco: mismo tamaño que cv::ellipse en C:\FACIAL (FaceDetectionEngine::getMainFaceOval). border-radius 50% = elipse en rectángulo ow×oh. */}
                            {ovalForStage && (
                                <div
                                    className="absolute pointer-events-none transition-all duration-100 ease-out biometric-oval"
                                    style={{
                                        borderRadius: '50%',
                                        left: `${ovalForStage.leftPct}%`,
                                        top: `${ovalForStage.topPct}%`,
                                        width: `${ovalForStage.wPct}%`,
                                        height: `${ovalForStage.hPct}%`,
                                        transform: ovalForStage.transform,
                                        zIndex: 15,
                                        border: faceGuide.qualityReady
                                            ? '3px solid #22c55e'
                                            : '3px solid rgba(239, 68, 68, 0.95)',
                                        boxShadow: 'none',
                                    }}
                                >
                                    <div
                                        className="absolute inset-0 pointer-events-none"
                                        style={{
                                            borderRadius: '50%',
                                            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.42)',
                                        }}
                                    />
                                    {/* Mira como FacialRecognitionSystem::drawUI (líneas ~587–590) */}
                                    <div
                                        className="absolute left-1/2 top-1/2 z-[1] pointer-events-none"
                                        style={{
                                            transform: 'translate(-50%, -50%)',
                                            width: 21,
                                            height: 21,
                                        }}
                                    >
                                        <div
                                            className="absolute left-1/2 top-1/2"
                                            style={{
                                                transform: 'translate(-50%, -50%)',
                                                width: 20,
                                                height: 1,
                                                backgroundColor: faceGuide.qualityReady
                                                    ? '#22c55e'
                                                    : 'rgba(239, 68, 68, 0.95)',
                                            }}
                                        />
                                        <div
                                            className="absolute left-1/2 top-1/2"
                                            style={{
                                                transform: 'translate(-50%, -50%)',
                                                width: 1,
                                                height: 20,
                                                backgroundColor: faceGuide.qualityReady
                                                    ? '#22c55e'
                                                    : 'rgba(239, 68, 68, 0.95)',
                                            }}
                                        />
                                    </div>
                                    {!faceGuide.qualityReady && (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span
                                                className="text-sky-300 text-[10px] font-semibold px-1"
                                                style={{
                                                    textShadow:
                                                        '0 0 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.95)',
                                                }}
                                            >
                                                {faceGuide.detected
                                                    ? 'RASTREANDO ROSTRO...'
                                                    : 'BUSCANDO ROSTRO...'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {!cameraReady && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white gap-3 px-4 text-center" style={{ zIndex: 20 }}>
                                    <ScanFace size={48} className="animate-pulse opacity-50" />
                                    {mode === 'login' && !loginBiometricSession ? (
                                        <span className="text-sm font-medium max-w-xs">
                                            Seleccione empresa y usuario, luego pulse «Ingresar con Reconocimiento
                                            Facial». La cámara se activará solo entonces (máx.{' '}
                                            {Math.round(FACIAL_ICAO.LOGIN_FACE_SESSION_MS / 1000)} s).
                                        </span>
                                    ) : (
                                        <span className="text-sm font-medium">Iniciando Biometría Facial...</span>
                                    )}
                                </div>
                            )}

                            {cameraReady && (
                                <div
                                    className="absolute top-4 left-1/2 -translate-x-1/2 rounded-xl border px-4 py-2 bg-slate-900/80 text-cyan-200"
                                    style={{
                                        zIndex: 21,
                                        borderColor: 'rgba(34,211,238,0.65)',
                                        boxShadow: '0 0 14px rgba(34,211,238,0.22)',
                                    }}
                                >
                                    <div className="text-[10px] tracking-wider uppercase opacity-80">
                                        Muestras
                                    </div>
                                    <div className="text-lg font-bold leading-tight text-center">
                                        {Math.min(3, Number(faceGuide.captureCount || 0))}/3
                                    </div>
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

                        {faceCaptureOnlyView && error && (
                            <div
                                className="auth-message error"
                                style={{ margin: '10px 12px 0', flexShrink: 0 }}
                                role="alert"
                            >
                                <AlertTriangle size={15} /> {error}
                            </div>
                        )}
                        {faceCaptureOnlyView && message && !error && (
                            <div
                                className="auth-message ok"
                                style={{ margin: '10px 12px 0', flexShrink: 0 }}
                            >
                                {message}
                            </div>
                        )}

                        <div className="bio-icao-panel">
                            <div className="bio-icao-section">
                                <div className="bio-icao-title">CALIDAD ICAO</div>
                                <div className="bio-icao-grid-2">
                                    <div className="bio-icao-row">
                                        <span>OJOS ABIERTOS</span>
                                        <span
                                            className={`bio-icao-val${
                                                faceGuide.icaoEyes === false
                                                    ? ' bio-icao-val--fail'
                                                    : ''
                                            }`}
                                        >
                                            {formatIcaoCell(
                                                faceGuide.icaoEyes === null ? null : faceGuide.icaoEyes
                                            )}
                                        </span>
                                    </div>
                                    <div className="bio-icao-row">
                                        <span>BOCA CERRADA</span>
                                        <span
                                            className={`bio-icao-val${
                                                faceGuide.icaoMouth === false
                                                    ? ' bio-icao-val--fail'
                                                    : ''
                                            }`}
                                        >
                                            {formatIcaoCell(
                                                faceGuide.icaoMouth === null ? null : faceGuide.icaoMouth
                                            )}
                                        </span>
                                    </div>
                                    <div className="bio-icao-row">
                                        <span>FRONTALIDAD</span>
                                        <span
                                            className={`bio-icao-val${
                                                faceGuide.icaoFrontal === false
                                                    ? ' bio-icao-val--fail'
                                                    : ''
                                            }`}
                                        >
                                            {formatIcaoCell(
                                                faceGuide.icaoFrontal === null
                                                    ? null
                                                    : faceGuide.icaoFrontal
                                            )}
                                        </span>
                                    </div>
                                    <div className="bio-icao-row">
                                        <span>SIN LENTES</span>
                                        <span
                                            className={`bio-icao-val${
                                                faceGuide.icaoNoGlasses === false
                                                    ? ' bio-icao-val--fail'
                                                    : ''
                                            }`}
                                        >
                                            {formatIcaoCell(
                                                faceGuide.icaoNoGlasses === null
                                                    ? null
                                                    : faceGuide.icaoNoGlasses
                                            )}
                                        </span>
                                    </div>
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
                                    <span
                                        className={`bio-icao-pct${
                                            Number(faceGuide.livenessScore || 0) <
                                            FACIAL_ICAO.LIVENESS_SCORE_PASS
                                                ? ' bio-icao-pct--warn'
                                                : ''
                                        }`}
                                    >
                                        {Number(faceGuide.livenessScore || 0).toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                        {faceCaptureOnlyView && (
                            <button
                                type="button"
                                className="logout-demo"
                                disabled={isProcessing}
                                onClick={() => {
                                    if (registerUserCaptureView) {
                                        endRegisterFaceSession({})
                                    } else {
                                        endLoginFaceSession({})
                                    }
                                }}
                                style={{ marginTop: '8px', width: '100%', padding: '10px', fontSize: '13px' }}
                            >
                                Cancelar verificación facial
                            </button>
                        )}
                    </div>

                    {!faceCaptureOnlyView && (
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
                    )}
                </section>
                )}

                {!faceCaptureOnlyView && (
                <section
                    className={`auth-panel auth-panel-form${
                        registerPersonFormOnlyView
                            ? ' auth-panel-form--register-person'
                            : ''
                    }`}
                >
                    {mode === 'login' ? (
                        <>
                            <div
                                style={{
                                    marginBottom: '14px',
                                    border: '1px solid rgba(56, 189, 248, 0.26)',
                                    borderRadius: '12px',
                                    padding: '10px 12px',
                                    background:
                                        'linear-gradient(120deg, rgba(8,47,73,0.38), rgba(15,23,42,0.25))',
                                }}
                            >
                                <img
                                    src={enterpriseMiningMark}
                                    alt="NEXMINE"
                                    style={{ width: '320px', maxWidth: '100%', height: 'auto', display: 'block' }}
                                />
                                <h2 style={{ margin: '6px 0 3px' }}>Acceso Seguro</h2>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                <button type="button" className={loginTab === 'user' ? 'secondary-button' : 'logout-demo'} style={{flex: 1, padding: '8px', fontSize: '13px'}} onClick={() => { setLoginTab('user'); setError(''); }}>LOGIN Usuario</button>
                                <button type="button" className={loginTab === 'company' ? 'secondary-button' : 'logout-demo'} style={{flex: 1, padding: '8px', fontSize: '13px'}} onClick={() => { setLoginTab('company'); setError(''); }}>LOGIN Empresa</button>
                            </div>
                            
                            <form
                                id="auth-login-credentials-form"
                                className="stack-form"
                                onSubmit={handlePasswordLogin}
                                style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
                            >
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

                            <label className="field-label">
                                <UserRound size={14} /> Usuario / DNI / RUC
                                <input
                                    type="text"
                                    value={loginForm.username}
                                    onChange={(event) =>
                                        setLoginForm((prev) => ({
                                            ...prev,
                                            username: event.target.value,
                                        }))
                                    }
                                    placeholder="Requerido para facial y para acceso manual"
                                    autoComplete="username"
                                />
                            </label>
                            <label className="field-label">
                                <KeyRound size={14} /> Contraseña
                                <input
                                    id="auth-login-password-input"
                                    type="password"
                                    value={loginForm.password}
                                    onChange={(event) =>
                                        setLoginForm((prev) => ({
                                            ...prev,
                                            password: event.target.value,
                                        }))
                                    }
                                    placeholder="Para ingreso con contraseña"
                                    autoComplete="current-password"
                                />
                            </label>
                            </form>
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
                                disabled={
                                    isProcessing ||
                                    (loginBiometricSession &&
                                        (!cameraReady || !loginBiometricGate))
                                }
                                onClick={async () => {
                                    if (!loginBiometricSession) {
                                        await startLoginFaceSession()
                                        return
                                    }
                                    if (cameraReady && loginBiometricGate && !isProcessing) {
                                        loginSubmitTriggeredRef.current = true
                                        handleFaceLogin(bestLoginProbeRef.current)
                                    } else {
                                        setError(
                                            'Verificación biométrica en curso: espere 3 muestras válidas (ICAO + liveness) o 3/3 del servidor con último frame OK.'
                                        )
                                    }
                                }}
                                style={{ marginTop: '12px' }}
                            >
                                <ScanFace size={17} />
                                {isProcessing
                                    ? 'Validando rostro...'
                                    : !loginBiometricSession
                                      ? 'Ingresar con Reconocimiento Facial'
                                      : !cameraReady
                                        ? 'Abriendo cámara…'
                                        : !loginBiometricGate
                                          ? 'Verificación biométrica en curso…'
                                          : hasRequiredBiometricSamples
                                            ? 'Envío automático en curso…'
                                            : `Capturando biometría (${Number(
                                                  faceGuide.captureCount || 0
                                              )}/${FACIAL_ICAO.REQUIRED_VALID_FRAMES})…`}
                            </button>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                                <button
                                    type="submit"
                                    form="auth-login-credentials-form"
                                    className="auth-login-password-button"
                                    disabled={isProcessing}
                                >
                                    <KeyRound size={16} /> Ingresar con Password
                                </button>
                                <button
                                    type="button"
                                    className="secondary-button"
                                    disabled={isProcessing}
                                    onClick={() => {
                                        setMode('register')
                                        setRegisterTab('user')
                                        setError('')
                                        setMessage('')
                                    }}
                                >
                                    <UserPlus size={16} /> Registrar Usuario
                                </button>
                            </div>
                            {mode === 'login' && loginBiometricSession && (
                                <button
                                    type="button"
                                    className="logout-demo"
                                    disabled={isProcessing}
                                    onClick={() => endLoginFaceSession({})}
                                    style={{
                                        marginTop: '8px',
                                        width: '100%',
                                        padding: '10px',
                                        fontSize: '13px',
                                    }}
                                >
                                    Cancelar verificación facial
                                </button>
                            )}

                        </>
                    ) : (
                        <>
                            <div
                                className="auth-login-brand-block auth-register-brand-block"
                                style={{
                                    marginBottom: '10px',
                                    border: '1px solid rgba(56, 189, 248, 0.26)',
                                    borderRadius: '12px',
                                    padding: '8px 10px',
                                    background:
                                        'linear-gradient(120deg, rgba(8,47,73,0.38), rgba(15,23,42,0.25))',
                                }}
                            >
                                <img
                                    src={enterpriseMiningMark}
                                    alt="NEXMINE"
                                    className="auth-register-brand-img"
                                    style={{
                                        width: 'min(300px, 100%)',
                                        height: 'auto',
                                        display: 'block',
                                    }}
                                />
                                <h2
                                    className="auth-register-brand-title"
                                    style={{ margin: '4px 0 2px' }}
                                >
                                    Acceso Seguro
                                </h2>
                            </div>
                            <div className="register-mode-tabs">
                                <button
                                    type="button"
                                    className={
                                        registerTab === 'user'
                                            ? 'secondary-button'
                                            : 'logout-demo'
                                    }
                                    onClick={() => {
                                        setRegisterTab('user')
                                        setError('')
                                    }}
                                >
                                    REGISTRO de Persona
                                </button>
                                <button
                                    type="button"
                                    className={
                                        registerTab === 'company'
                                            ? 'secondary-button'
                                            : 'logout-demo'
                                    }
                                    onClick={() => {
                                        setRegisterTab('company')
                                        setError('')
                                    }}
                                >
                                    REGISTRO de Empresa
                                </button>
                            </div>
                            {mode === 'register' &&
                                registerTab === 'user' &&
                                registerUserBiometricStep === 'form' &&
                                !showBiometricPanel && (
                                    <button
                                        type="button"
                                        className="logout-demo register-back-login-btn"
                                        onClick={() => {
                                            setMode('login')
                                            setError('')
                                            setMessage('')
                                        }}
                                    >
                                        Volver al inicio de sesión
                                    </button>
                                )}

                            {registerTab === 'user' &&
                            registerUserBiometricStep === 'success' ? (
                                <div
                                    className="stack-form"
                                    style={{ padding: '8px 0 24px', textAlign: 'center' }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            marginBottom: '16px',
                                        }}
                                    >
                                        <ShieldCheck
                                            size={56}
                                            strokeWidth={1.5}
                                            style={{ color: '#22c55e' }}
                                        />
                                    </div>
                                    <h2 style={{ marginBottom: '8px' }}>Registro exitoso</h2>
                                    <p
                                        style={{
                                            color: '#94a3b8',
                                            marginBottom: '24px',
                                            fontSize: '15px',
                                            lineHeight: 1.45,
                                        }}
                                    >
                                        El registro facial se completó correctamente. Ya puede acceder al
                                        sistema.
                                    </p>
                                    <button
                                        type="button"
                                        className="primary-face-button"
                                        disabled={!registrationCompleteSession || isProcessing}
                                        onClick={() => {
                                            if (registrationCompleteSession) {
                                                onAuthenticated(registrationCompleteSession)
                                            }
                                        }}
                                        style={{ width: '100%', marginBottom: '10px' }}
                                    >
                                        <UserPlus size={17} /> Entrar al sistema
                                    </button>
                                    <button
                                        type="button"
                                        className="secondary-button"
                                        disabled={isProcessing}
                                        onClick={() => {
                                            setMode('login')
                                            setRegisterUserBiometricStep('form')
                                            setRegistrationCompleteSession(null)
                                            setMessage('')
                                            setError('')
                                        }}
                                        style={{ width: '100%' }}
                                    >
                                        Volver al inicio de sesión
                                    </button>
                                </div>
                            ) : (
                            <>
                            {registerTab === 'company' && (
                                <h2>Registrar Empresa Contratista</h2>
                            )}
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault()
                                    if (registerTab === 'company') {
                                        handleRegister(e)
                                    }
                                }}
                                className={`stack-form${
                                    registerTab === 'user'
                                        ? ' stack-form--register-person'
                                        : ''
                                }`}
                            >
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
                                    <div className="register-person-fields">
                                        <label className="field-label reg-grid-full">
                                            <Building2 size={16} /> Empresa Asignada
                                            <select
                                                value={registerForm.company}
                                                onChange={(e) =>
                                                    setRegisterForm((prev) => ({
                                                        ...prev,
                                                        company: e.target.value,
                                                    }))
                                                }
                                                required
                                            >
                                                {companies.map((company) => (
                                                    <option key={company} value={company}>
                                                        {company}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="field-label reg-grid-dni">
                                            DNI Trabajador
                                            <input
                                                type="text"
                                                maxLength={12}
                                                value={registerForm.dni}
                                                onChange={(e) =>
                                                    setRegisterForm((prev) => ({
                                                        ...prev,
                                                        dni: e.target.value,
                                                    }))
                                                }
                                                required
                                            />
                                        </label>
                                        <label className="field-label reg-grid-nombres">
                                            Nombres
                                            <input
                                                type="text"
                                                value={registerForm.firstName}
                                                onChange={(e) =>
                                                    setRegisterForm((prev) => ({
                                                        ...prev,
                                                        firstName: e.target.value,
                                                    }))
                                                }
                                                required
                                            />
                                        </label>
                                        <label className="field-label reg-grid-apellidos">
                                            Apellidos
                                            <input
                                                type="text"
                                                value={registerForm.lastName}
                                                onChange={(e) =>
                                                    setRegisterForm((prev) => ({
                                                        ...prev,
                                                        lastName: e.target.value,
                                                    }))
                                                }
                                                required
                                            />
                                        </label>
                                        <label className="field-label reg-grid-email">
                                            Correo electrónico
                                            <input
                                                type="email"
                                                value={registerForm.email}
                                                onChange={(e) =>
                                                    setRegisterForm((prev) => ({
                                                        ...prev,
                                                        email: e.target.value,
                                                    }))
                                                }
                                                required
                                            />
                                        </label>
                                        <label className="field-label reg-grid-celular">
                                            Celular
                                            <input
                                                type="tel"
                                                value={registerForm.mobile}
                                                onChange={(e) =>
                                                    setRegisterForm((prev) => ({
                                                        ...prev,
                                                        mobile: e.target.value,
                                                    }))
                                                }
                                                required
                                            />
                                        </label>
                                        <label className="field-label reg-grid-full">
                                            Cargo / Nivel de Usuario
                                            <select
                                                className="register-role-select"
                                                value={registerForm.role}
                                                onChange={(e) =>
                                                    setRegisterForm((prev) => ({
                                                        ...prev,
                                                        role: e.target.value,
                                                    }))
                                                }
                                                required
                                            >
                                                <option value="operator">
                                                    Operador / Personal Tecnico
                                                </option>
                                                <option value="supervisor">
                                                    Supervisor / Jefe de Guardia
                                                </option>
                                                <option value="manager">
                                                    Gerente de Operaciones
                                                </option>
                                                <option value="geologist">
                                                    Ingeniero Geomecanico
                                                </option>
                                                <option value="safety">
                                                    Prevencionista / SSOMA
                                                </option>
                                                <option value="admin">
                                                    Administrador del Sistema
                                                </option>
                                            </select>
                                        </label>
                                    </div>
                                )}

                                <div className="auth-divider auth-divider--tight">
                                    <span>Credenciales de Acceso</span>
                                </div>
                                <label className="field-label register-credentials-username">
                                    Usuario de Sistema
                                    <input
                                        type="text"
                                        value={registerForm.username}
                                        onChange={(e) =>
                                            setRegisterForm((prev) => ({
                                                ...prev,
                                                username: e.target.value,
                                            }))
                                        }
                                        autoComplete="username"
                                        required
                                    />
                                </label>
                                <div className="register-password-row">
                                    <label className="field-label">
                                        Contraseña
                                        <input
                                            type="password"
                                            value={registerForm.password}
                                            onChange={(e) =>
                                                setRegisterForm((prev) => ({
                                                    ...prev,
                                                    password: e.target.value,
                                                }))
                                            }
                                            autoComplete="new-password"
                                            required
                                            minLength={6}
                                        />
                                    </label>
                                    <label className="field-label">
                                        Confirmar contraseña
                                        <input
                                            type="password"
                                            value={registerForm.passwordConfirm}
                                            onChange={(e) =>
                                                setRegisterForm((prev) => ({
                                                    ...prev,
                                                    passwordConfirm: e.target.value,
                                                }))
                                            }
                                            autoComplete="new-password"
                                            required
                                            minLength={6}
                                        />
                                    </label>
                                </div>

                                <button
                                    type="button"
                                    className={`${
                                        registerTab === 'user'
                                            ? 'register-biometric-btn '
                                            : ''
                                    }secondary-button ${
                                        registerTab === 'company' &&
                                        capturedImageBase64
                                            ? 'success'
                                            : ''
                                    }`}
                                    disabled={
                                        registerTab === 'user' &&
                                        registerUserBiometricStep === 'form'
                                            ? isProcessing
                                            : !cameraReady
                                    }
                                    onClick={
                                        registerTab === 'user' &&
                                        registerUserBiometricStep === 'form'
                                            ? startRegisterUserFaceCapture
                                            : handleCaptureForRegistration
                                    }
                                    style={
                                        registerTab === 'user'
                                            ? undefined
                                            : { marginTop: '10px' }
                                    }
                                >
                                    {registerTab === 'company' && capturedImageBase64 ? (
                                        <ShieldCheck size={15} />
                                    ) : (
                                        <Camera size={15} />
                                    )}
                                    {registerTab === 'company' && capturedImageBase64
                                        ? ' Biometría Capturada'
                                        : ' Registrar biometrica facial (Obligatorio)'}
                                </button>
                                {registerTab === 'company' && (
                                    <button
                                        type="submit"
                                        className="primary-face-button"
                                        disabled={!canRegister || isProcessing}
                                    >
                                        <UserPlus size={17} /> Guardar registro e Iniciar Sesion
                                    </button>
                                )}
                            </form>
                            </>
                            )}
                        </>
                    )}

                    {error && (
                        <div className="auth-message error">
                            <AlertTriangle size={15} /> {error}
                        </div>
                    )}
                    {message && <div className="auth-message ok">{message}</div>}
                </section>
                )}
            </div>
        </div>
    )
}

export default AuthGateway
