import React, {
    memo,
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
    ScanLine,
    CheckCircle2,
} from 'lucide-react'
import { DocumentScanCapture } from '../UI/DocumentScanCapture'
import type { DniScanResult } from '../../auth/authApi'
import {
    createSession,
    getSession,
    type Session,
} from '../../auth/authStorage'
import {
    checkLoginIdentity,
    fetchCompanies,
    loginWithFace,
    loginWithPassword,
    loginWithMfaCode,
    processBiometricFrame,
    fetchBiometricStatus,
    registerUser,
    resetBiometricCapture,
    validateCompany,
} from '../../auth/authApi'
import { getBestEffortLocation, type GeoLocationSample } from '../../auth/geolocation'
import { FACIAL_ICAO } from '../../config/facialIcaoConfig'
import {
    formatIcaoCell,
} from '../../auth/biometricFiveHelpers'
import {
    meanLuminanceImageData,
    luminanceStdDevImageData,
    classifyRawDifficultLighting,
    medianFaceBoundingBox,
    faceCenterJumpRatio,
} from '../../auth/faceTrackingUtils'
import {
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
import { classifyCameraError } from '../../auth/cameraErrorPolicy'
import {
    createInitialChallengeState,
    currentChallenge,
    isChallengeSequenceComplete,
    pickReplacementChallenge,
    yawSatisfiesChallenge,
    challengeInstructionKey,
    CHALLENGE_TIMEOUT_MS,
    CHALLENGE_MAX_ATTEMPTS,
    ACTIVE_CHALLENGE_ENABLED,
    type LivenessChallengeState,
    type LivenessChallengeType,
} from '../../auth/livenessChallenge'
import { PlatformBrandPanelHeader } from '../../brand/PlatformBrandMark'
import PlatformRegionBar from '../Platform/PlatformRegionBar'
import { useI18n } from '../../i18n/I18nProvider'
import { formatInternationalTel, phonePrefixForCountry } from '../../auth/platformPrefs'

import { log } from '../../lib/logger';

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
const LOGIN_BG_BY_COMPANY: Record<string, string> = {
    'minera raura': '/data/Image/Login/Minera%20raura.jpg',
    'compania minera volcan': '/data/Image/Login/Compa%C3%B1ia%20Minera%20Volcal.jpg',
    'compania minera volcal': '/data/Image/Login/Compa%C3%B1ia%20Minera%20Volcal.jpg',
    'minera antamina': '/data/Image/Login/Minera%20antamina.jpg',
    'minera cerro verde': '/data/Image/Login/MINERa%20cerro%20verde.jpg',
    'minera antapaccay': '/data/Image/Login/Minera%20antapaccay.jpg',
}

function normalizeCompanyKey(companyName: unknown): string {
    return String(companyName || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

const BUILD_STAMP = import.meta.env.VITE_BUILD_STAMP || 'dev'

const getSkinCentroid = (ctx: CanvasRenderingContext2D, w: number, h: number): { x: number; y: number; density: number } | null => {
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

interface LoginForm {
    company: string;
    username: string;
    password: string;
}

interface RegisterForm {
    company: string;
    firstName: string;
    lastName: string;
    dni: string;
    username: string;
    password: string;
    ruc: string;
    phone: string;
    mobile: string;
    email: string;
    role: string;
    rucValid: boolean;
    isValidatingRuc: boolean;
    passwordConfirm: string;
    /** Razón social del contratista (solo pestaña empresa); `company` = empresa minera para RUC/login. */
    contractorLegalName: string;
}

interface FaceGuideState {
    detected: boolean;
    frontal: boolean;
    eyesOpen: boolean;
    mouthClosed: boolean;
    qualityReady: boolean;
    validFrames: number;
    captureCount: number;
    lastServerOk: boolean;
    icaoEyes: boolean | null;
    icaoMouth: boolean | null;
    icaoFrontal: boolean | null;
    icaoNoGlasses: boolean | null;
    livenessScore: number;
    inTargetZone: boolean;
    serverFaceOval: any;
}

/** Forma de trabajo interna de un bbox de rostro; `landmarks` es dinámico (FaceDetector/fallback, sin tipos oficiales). */
interface WorkingFaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
    landmarks: any[];
    isFallback?: boolean;
}

interface LoginProbe {
    template: number[];
    imageBase64: string;
    portraitOvalBase64?: string;
    score: number;
    capturedAt?: number;
}

interface SessionClock {
    start: number;
    pausedMs: number;
    pauseSince: number | null;
}

interface IcaoFour {
    eyes: boolean;
    mouth: boolean;
    frontal: boolean;
    noGlasses: boolean;
}

interface AuthGatewayProps {
    onAuthenticated: (session: Session) => void;
}

const AuthGateway = ({ onAuthenticated }: AuthGatewayProps) => {
    const { t, countryIso2: country, localizeMessage } = useI18n()
    const activePhonePrefix = phonePrefixForCountry(country, undefined)
    const [mode, setMode] = useState('login')
    const [registerTab, setRegisterTab] = useState('user')
    const [loginTab, setLoginTab] = useState('user')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [cameraReady, setCameraReady] = useState(false)
    /** Login: cámara solo tras «Ingresar con Reconocimiento Facial»; ventana limitada en tiempo. */
    const [loginBiometricSession, setLoginBiometricSession] = useState(false)
    const [loginSessionSecondsLeft, setLoginSessionSecondsLeft] = useState<number | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const [companies, setCompanies] = useState<string[]>(DEFAULT_COMPANIES)
    /** MFA/TOTP (ADR-135): distinto de `null` cuando password/biometría ya
     * fueron correctos pero la cuenta exige segundo factor -- el login queda
     * en este paso intermedio hasta un código válido o hasta que el usuario
     * cancele (vuelve al formulario normal). */
    const [mfaPending, setMfaPending] = useState<{ token: string } | null>(null)
    const [mfaCode, setMfaCode] = useState('')
    const [mfaError, setMfaError] = useState('')
    const [showDniScan, setShowDniScan] = useState(false)

    const handleDniScanSuccess = (result: DniScanResult) => {
        setShowDniScan(false)
        setRegisterForm((prev) => ({
            ...prev,
            dni: result.dni || prev.dni,
            firstName: result.first_name || prev.firstName,
            lastName: result.last_name || prev.lastName,
        }))
    }

    const [loginForm, setLoginForm] = useState<LoginForm>({
        company: DEFAULT_COMPANIES[0],
        username: '',
        password: '',
    })

    const [registerForm, setRegisterForm] = useState<RegisterForm>({
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
        /** Razón social del contratista (solo pestaña empresa); `company` = empresa minera para RUC/login. */
        contractorLegalName: '',
    })

    const [registerUserBiometricStep, setRegisterUserBiometricStep] = useState('form')
    /** Igual que registro persona: formulario estrecho primero; cámara solo en paso capture. */
    const [registerCompanyBiometricStep, setRegisterCompanyBiometricStep] = useState('form')
    const [registerSessionSecondsLeft, setRegisterSessionSecondsLeft] = useState<number | null>(null)
    const [registrationCompleteSession, setRegistrationCompleteSession] = useState<Session | null>(null)

    const [capturedTemplate, setCapturedTemplate] = useState<number[] | null>(null)
    const [capturedImageBase64, setCapturedImageBase64] = useState('')
    const [capturedPortraitOvalBase64, setCapturedPortraitOvalBase64] = useState('')
    const [capturedBustRectBase64, setCapturedBustRectBase64] = useState('')
    const [liveFaceBox, setLiveFaceBox] = useState<WorkingFaceBox | null>(null)
    const [frameMetrics, setFrameMetrics] = useState(() => ({
        width: FACIAL_ICAO.CAMERA.width.ideal,
        height: FACIAL_ICAO.CAMERA.height.ideal,
    }))
    const [faceGuide, setFaceGuide] = useState<FaceGuideState>({
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
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const detectorRef = useRef<any>(null)
    const prevMouthClosedLandmarkRef = useRef<boolean | null>(null)
    const lastSyncRef = useRef(0)
    const syncingRef = useRef(false)
    const smoothedFaceRef = useRef<WorkingFaceBox | null>(null)
    const lastVerifyOkRef = useRef(false)
    const lastIcaoFourRef = useRef<IcaoFour>({
        eyes: false,
        mouth: false,
        frontal: false,
        noGlasses: false,
    })
    const livenessBlinkRef = useRef(0)
    const livenessMouthEventsRef = useRef(0)
    /** Liveness ACTIVA (challenge-response, ver ../../auth/livenessChallenge.ts):
     * a diferencia de livenessBlinkRef/livenessMouthEventsRef (pasivo -- cuentan
     * cualquier parpadeo/apertura de boca que ocurra en algún momento), esto exige
     * cumplir 2 desafíos sorteados al azar (parpadear/boca/girar cabeza) dentro de
     * una ventana de tiempo corta cada uno. El ref es la fuente de verdad (leído en
     * el loop de detección, no dispara render); challengeUiState es su espejo para
     * pintar el overlay de instrucciones.
     */
    const livenessChallengeRef = useRef<LivenessChallengeState>(createInitialChallengeState())
    const [challengeUiState, setChallengeUiState] = useState<LivenessChallengeState>(
        livenessChallengeRef.current
    )
    const challengesPassedRef = useRef(false)

    const advanceOrCompleteChallenge = () => {
        const st = livenessChallengeRef.current
        const nextIndex = st.index + 1
        const isLast = nextIndex >= st.queue.length
        // Confirmación visual breve (ver overlay) antes de pasar al siguiente
        // desafío o de cerrar la secuencia -- sin esto el cambio de
        // instrucción se sentía abrupto en pruebas.
        livenessChallengeRef.current = { ...st, status: 'success', deadlineAt: null }
        setChallengeUiState(livenessChallengeRef.current)
        if (isLast) {
            challengesPassedRef.current = true
            livenessChallengeRef.current = { ...st, index: nextIndex, status: 'success', deadlineAt: null }
            setChallengeUiState(livenessChallengeRef.current)
            return
        }
        window.setTimeout(() => {
            const cur = livenessChallengeRef.current
            if (cur.index === st.index && cur.status === 'success') {
                livenessChallengeRef.current = {
                    ...cur,
                    index: nextIndex,
                    status: 'pending',
                    deadlineAt: performance.now() + CHALLENGE_TIMEOUT_MS,
                    attempt: 1,
                }
                setChallengeUiState(livenessChallengeRef.current)
            }
        }, 700)
    }

    /** Llamado desde los bordes de detección de parpadeo/boca ya existentes
     * (no agrega un detector nuevo -- reutiliza el mismo evento que ya
     * alimenta livenessBlinkRef/livenessMouthEventsRef). */
    const trySatisfyGestureChallenge = (type: 'blink' | 'mouth') => {
        const st = livenessChallengeRef.current
        if (challengesPassedRef.current || st.status !== 'pending') {
            return
        }
        if (currentChallenge(st) !== type) {
            return
        }
        advanceOrCompleteChallenge()
    }

    /** Chequeo continuo (no de borde): el giro de cabeza se sostiene mientras
     * dura el desafío, no es un evento puntual como el parpadeo. */
    const trySatisfyYawChallenge = (headYawRatio: number) => {
        const st = livenessChallengeRef.current
        if (challengesPassedRef.current || st.status !== 'pending') {
            return
        }
        const cur = currentChallenge(st)
        if (cur !== 'turn_left' && cur !== 'turn_right') {
            return
        }
        if (yawSatisfiesChallenge(cur, headYawRatio)) {
            advanceOrCompleteChallenge()
        }
    }

    /** Vencimiento del desafío actual: reintenta el mismo tipo hasta
     * CHALLENGE_MAX_ATTEMPTS veces (evita que un gesto que le cuesta al
     * usuario trabe la sesión), luego sortea un reemplazo para ese puesto. */
    const checkChallengeTimeout = (now: number) => {
        const st = livenessChallengeRef.current
        if (challengesPassedRef.current || st.status !== 'pending' || st.deadlineAt == null) {
            return
        }
        if (now < st.deadlineAt) {
            return
        }
        if (st.attempt < CHALLENGE_MAX_ATTEMPTS) {
            const attemptAfterTimeout = st.attempt + 1
            livenessChallengeRef.current = { ...st, status: 'timeout', deadlineAt: null }
            setChallengeUiState(livenessChallengeRef.current)
            window.setTimeout(() => {
                const cur = livenessChallengeRef.current
                if (cur.index === st.index && cur.status === 'timeout') {
                    livenessChallengeRef.current = {
                        ...cur,
                        status: 'pending',
                        deadlineAt: performance.now() + CHALLENGE_TIMEOUT_MS,
                        attempt: attemptAfterTimeout,
                    }
                    setChallengeUiState(livenessChallengeRef.current)
                }
            }, 1200)
        } else {
            const replacement = pickReplacementChallenge(st.queue)
            const newQueue = [...st.queue]
            newQueue[st.index] = replacement
            livenessChallengeRef.current = {
                ...st,
                queue: newQueue,
                status: 'pending',
                deadlineAt: performance.now() + CHALLENGE_TIMEOUT_MS,
                attempt: 1,
            }
            setChallengeUiState(livenessChallengeRef.current)
        }
    }

    const prevEyesOpenLandmarkRef = useRef<boolean | null>(null)
    const blinkCloseStartedAtRef = useRef<number | null>(null)
    const mouthWasOpenPhaseRef = useRef(false)
    const livenessScoreRef = useRef(0)
    const livenessFallbackRef = useRef(0)
    /** Micro-movimiento del bbox (FaceDetector sin landmarks o parpadeo no detectado). */
    const bboxMotionHistRef = useRef<{ nx: number; ny: number }[]>([])
    const motionLivenessPtsRef = useRef(0)
    const lastMotionLivenessBoostAtRef = useRef(0)
    const eyesBlinkHystRef = useRef(true)
    const lastServerLivenessRef = useRef(0)
    const lastAutoTriggerRef = useRef(0)
    const cameraRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const cameraStageRef = useRef<HTMLDivElement | null>(null)
    const faceBoxHistoryRef = useRef<WorkingFaceBox[]>([])
    /** 640×480: misma rejilla que C:\FACIAL\www\main.js (process-canvas) y que el JPEG de /api/process_frame */
    const processFrameCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const trackingFallbackCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const validFramesRef = useRef(0)
    const missedDetectorFramesRef = useRef(0)
    /** 0..1 con histéresis: modo noche/reflejos para filtros extra y borde más estable */
    const difficultLightingScoreRef = useRef(0)
    const faceInTargetZoneRef = useRef(true)
    const loginBiometricSessionRef = useRef(false)
    const isProcessingRef = useRef(false)
    /** Reloj de sesión login: el tiempo se congela mientras isProcessing (petición al backend). */
    const sessionClockRef = useRef<SessionClock>({ start: 0, pausedMs: 0, pauseSince: null })
    const identityAnchorRef = useRef('')
    const endLoginFaceSessionRef = useRef((_o?: { errorMessage?: string }) => {})
    const bestLoginProbeRef = useRef<LoginProbe | null>(null)
    /** Ubicación de la PC cliente, pedida al abrir la sesión facial (junto con
     * la cámara) para que ya esté resuelta cuando el usuario confirme el
     * login -- ver ../../auth/geolocation.ts. Best-effort: nunca bloquea ni
     * condiciona el resultado de la autenticación facial. */
    const pendingLocationRef = useRef<Promise<GeoLocationSample | null> | null>(null)
    /** Igual que pendingLocationRef pero para el login por contraseña/PIN
     * (ADR-107): se pide apenas se muestra ese formulario (ver useEffect más
     * abajo) para que ya esté resuelta cuando el usuario confirme el login,
     * sin agregar latencia perceptible al submit. Best-effort: nunca bloquea
     * ni condiciona el resultado de la autenticación. */
    const pendingPasswordLocationRef = useRef<Promise<GeoLocationSample | null> | null>(null)
    const loginSubmitTriggeredRef = useRef(false)
    /** Evita spam en consola cuando el gate de login facial está cerrado con 3/3 muestras. */
    const authFaceAutoDiagAtRef = useRef(0)
    const registerFaceSessionClockRef = useRef<SessionClock>({
        start: 0,
        pausedMs: 0,
        pauseSince: null,
    })
    const registerAutoSubmitTriggeredRef = useRef(false)
    const registerUserBiometricStepRef = useRef('form')
    const registerCompanyBiometricStepRef = useRef('form')
    const endRegisterFaceSessionRef = useRef(
        (_o?: { errorMessage?: string }) => {}
    )
    const registrationApiInFlightRef = useRef(false)
    /** Registro empresa: envío automático solo al pasar canRegister de false → true (evita bucle si el API falla). */
    const prevCompanyCanRegisterRef = useRef(false)

    const endLoginFaceSession = useCallback((opts?: { errorMessage?: string }) => {
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

    const endRegisterFaceSession = useCallback((opts?: { errorMessage?: string }) => {
        const errorMessage = opts?.errorMessage
        setRegisterUserBiometricStep('form')
        setRegisterCompanyBiometricStep('form')
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
        registerCompanyBiometricStepRef.current = registerCompanyBiometricStep
    }, [registerCompanyBiometricStep])

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
    const registerCompanyCaptureView =
        mode === 'register' &&
        registerTab === 'company' &&
        registerCompanyBiometricStep === 'capture'
    const anyRegisterCaptureView = registerUserCaptureView || registerCompanyCaptureView
    /** Formulario registro persona (sin panel cámara): layout denso, sin scroll en pantallas típicas. */
    const registerPersonFormOnlyView =
        mode === 'register' &&
        registerTab === 'user' &&
        registerUserBiometricStep === 'form'
    const registerCompanyFormOnlyView =
        mode === 'register' &&
        registerTab === 'company' &&
        registerCompanyBiometricStep === 'form'
    const registerFormNarrowFitView =
        registerPersonFormOnlyView || registerCompanyFormOnlyView
    const showBiometricPanel =
        loginBiometricSession || anyRegisterCaptureView
    const faceCaptureOnlyView =
        (mode === 'login' && loginBiometricSession) || anyRegisterCaptureView
    /** `camera-only`: solo biometría; `single`: login o registro en tarjeta (sin cámara simultánea). */
    const authShellLayout = faceCaptureOnlyView ? 'camera-only' : 'single'
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
        (mode === 'login' && loginBiometricSession) || anyRegisterCaptureView
    const faceTimerSecondsLeft = anyRegisterCaptureView
        ? registerSessionSecondsLeft
        : loginSessionSecondsLeft
    const faceTimerSecondsSafe = anyRegisterCaptureView
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
            valuesOk = Boolean(
                registerForm.company.trim() &&
                registerForm.ruc.trim().length >= (country === 'BR' ? 14 : country === 'PE' ? 11 : 9) &&
                registerForm.rucValid &&
                registerForm.contractorLegalName.trim() &&
                registerForm.firstName.trim() &&
                registerForm.lastName.trim() &&
                registerForm.dni.trim().length >= 8 &&
                registerForm.username.trim().length >= 4 &&
                passwordsMatch
            )
        } else {
            valuesOk = Boolean(
                registerForm.company.trim() &&
                registerForm.firstName.trim() &&
                registerForm.lastName.trim() &&
                registerForm.dni.trim().length >= 8 &&
                registerForm.email.trim().length >= 5 &&
                registerForm.mobile.trim().length >= 6 &&
                registerForm.username.trim().length >= 4 &&
                passwordsMatch
            )
        }
        return valuesOk && Boolean(capturedImageBase64)
    }, [registerForm, capturedImageBase64, registerTab, country])

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

                const uniqueCompanies = Array.from(new Set(apiCompanies)) as string[]
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
                log.warn('[AUTH_UI] fetchCompanies failed; using local catalog', err)
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
        const apply = (w: number, h: number) => {
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
        const requiredLength = country === 'BR' ? 14 : country === 'PE' ? 11 : 9
        if (registerTab !== 'company' || registerForm.ruc.length !== requiredLength) {
            setRegisterForm(prev => ({ ...prev, rucValid: false, isValidatingRuc: false }));
            return;
        }

        const timeoutId = setTimeout(async () => {
            setRegisterForm(prev => ({ ...prev, isValidatingRuc: true }));
            try {
                const isValid = await validateCompany(registerForm.company, registerForm.ruc, country);
                setRegisterForm(prev => ({ ...prev, rucValid: isValid, isValidatingRuc: false }));
            } catch (err) {
                log.error("RUC Validation error:", err);
                setRegisterForm(prev => ({ ...prev, rucValid: false, isValidatingRuc: false }));
            }
        }, 800);

        return () => clearTimeout(timeoutId);
    }, [registerForm.ruc, registerForm.company, registerTab, country]);

    const shouldUseFaceCamera =
        (mode === 'login' && loginBiometricSession) ||
        registerUserCaptureView ||
        registerCompanyCaptureView

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
                setError(t('error.cameraApi'))
                setCameraReady(false)
                return
            }
            stopCurrentStream()
            if (cameraRetryTimerRef.current) {
                clearTimeout(cameraRetryTimerRef.current)
                cameraRetryTimerRef.current = null
            }
            try {
                let stream: MediaStream
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: 'user',
                            // 960x720 (no 640x480): más píxeles reales para MediaPipe en
                            // el mismo encuadre físico -- a distancia media/lejana, el EAR
                            // medido a 640x480 se degrada y el blink blendshape se eleva
                            // por falta de resolución en la región del ojo, no porque los
                            // ojos estén cerrados (confirmado con datos reales, 2026-08-19).
                            width: { ideal: FACIAL_ICAO.CAMERA.width.ideal, min: 320 },
                            height: { ideal: FACIAL_ICAO.CAMERA.height.ideal, min: 240 },
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
                            log.warn('Reproducción automática:', e)
                        )
                    }
                }
            } catch (err: any) {
                setCameraReady(false)
                const { messageKey, shouldRetry } = classifyCameraError(err?.name || '')
                setError(t(messageKey))
                // shouldRetry es false para un permiso denegado (ver
                // classifyCameraError): antes este catch reintentaba SIEMPRE
                // con el mismo timer, generando un bucle infinito de llamadas
                // a getUserMedia() sin ningún efecto visible -- Chrome no
                // vuelve a mostrar el diálogo tras un rechazo, solo rechaza
                // de inmediato cada vez. El listener de navigator.permissions
                // (más abajo) retoma solo si el usuario cambia el permiso a
                // "granted" desde el navegador.
                if (shouldRetry && !cancelled && !cameraRetryTimerRef.current) {
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

        // Nueva sesión de cámara -> nuevos desafíos de liveness sorteados
        // (evita que un intento previo fallido/cancelado deje el mismo
        // desafío ya "adivinado" para el siguiente intento).
        // ACTIVE_CHALLENGE_ENABLED=false (ver livenessChallenge.ts): no
        // bloquear el envío -- challengesPassedRef arranca en true, el resto
        // del código de desafíos queda intacto pero inerte.
        livenessChallengeRef.current = createInitialChallengeState()
        challengesPassedRef.current = !ACTIVE_CHALLENGE_ENABLED
        setChallengeUiState(livenessChallengeRef.current)

        // Si el permiso ya está "granted" (concedido en una visita anterior,
        // o por política empresarial VideoCaptureAllowedUrls en equipos
        // administrados), getUserMedia() de arriba abre la cámara al toque,
        // SIN mostrar ningún diálogo -- eso ya es el comportamiento nativo
        // del navegador, no algo que este código deba forzar. Lo que sí
        // vigilamos acá es el caso en que el usuario cambia el permiso desde
        // el candado de la barra de direcciones DESPUÉS de que ya fallamos
        // (denegado -> concedido): sin este listener, la cámara se quedaría
        // apagada hasta un F5 manual.
        let permissionStatus: PermissionStatus | null = null
        const handlePermissionChange = () => {
            if (cancelled || !permissionStatus) {
                return
            }
            if (permissionStatus.state === 'granted') {
                startCamera()
            } else if (permissionStatus.state === 'denied') {
                if (cameraRetryTimerRef.current) {
                    clearTimeout(cameraRetryTimerRef.current)
                    cameraRetryTimerRef.current = null
                }
                stopCurrentStream()
                setCameraReady(false)
                setError(t('error.cameraPermission'))
            }
        }

        startCamera()

        // Permissions API para 'camera' no existe en todos los navegadores
        // (Firefox/Safari no la implementan) -- degrada con gracia: sin el
        // listener, getUserMedia() sigue funcionando igual, solo se pierde el
        // auto-retoque cuando el permiso cambia sin recargar la página.
        if (navigator.permissions?.query) {
            navigator.permissions
                .query({ name: 'camera' })
                .then((status) => {
                    if (cancelled) {
                        return
                    }
                    permissionStatus = status
                    status.onchange = handlePermissionChange
                })
                .catch(() => {})
        }

        return () => {
            cancelled = true
            if (permissionStatus) {
                permissionStatus.onchange = null
            }
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
        setRegisterCompanyBiometricStep('form')
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

    // ADR-107: prefetch de ubicación del cliente para el login por
    // contraseña/PIN -- se dispara al entrar a esa pantalla (no en el
    // submit) por el mismo motivo que el flujo facial de arriba: que la
    // resolución del permiso del navegador no agregue latencia al momento
    // de confirmar el login.
    useEffect(() => {
        if (mode === 'login' && !loginBiometricSession) {
            pendingPasswordLocationRef.current = getBestEffortLocation()
        }
    }, [mode, loginBiometricSession])

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
        if (anyRegisterCaptureView) {
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
    }, [isProcessing, mode, loginBiometricSession, anyRegisterCaptureView])

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
        if (!anyRegisterCaptureView) {
            setRegisterSessionSecondsLeft(null)
            return
        }
        const id = setInterval(() => {
            const inUserCap = registerUserBiometricStepRef.current === 'capture'
            const inCompanyCap = registerCompanyBiometricStepRef.current === 'capture'
            if (!inUserCap && !inCompanyCap) {
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
    }, [anyRegisterCaptureView])

    useEffect(() => {
        let requestID: number | null = null
        let lastTimestamp = 0

        async function detectFaceLoop(timestamp: number) {
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
                let bestFace: WorkingFaceBox | null = null

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
                if (!pCtx) {
                    requestID = requestAnimationFrame(detectFaceLoop)
                    return
                }
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
                        detectorRef.current = new (window as any).FaceDetector({
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
                            landmarks: (detections[0].landmarks || []).map((l: any) => ({
                                ...l,
                                locations: l.locations.map((loc: any) => ({
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
                    if (ctx) {
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
                        (l: any) => l.type === 'leftEye' || l.type === 'eye'
                    )
                    const rightEye = bestFace.landmarks.find((l: any) => l.type === 'rightEye')
                    const eyeYRatio = FACIAL_ICAO.MAX_EYE_Y_DELTA_RATIO
                    const eyesAligned = hasLandmarks
                        ? leftEye && rightEye
                            ? Math.abs(leftEye.locations[0].y - rightEye.locations[0].y) <
                              bestFace.height * eyeYRatio
                            : true
                        : true

                    const eyeOpenness = (eye: any) => {
                        if (!eye || !Array.isArray(eye.locations) || eye.locations.length < 2)
                            return 0.5
                        const ys = eye.locations.map((p: any) => p.y)
                        const xs = eye.locations.map((p: any) => p.x)
                        return (
                            (Math.max(...ys) - Math.min(...ys)) /
                            Math.max(1, Math.max(...xs) - Math.min(...xs))
                        )
                    }
                    const mouth = bestFace.landmarks.find((l: any) => l.type === 'mouth')
                    const mouthRatio = (() => {
                        if (!mouth || !Array.isArray(mouth.locations) || mouth.locations.length < 2)
                            return 0.08
                        const ys = mouth.locations.map((p: any) => p.y)
                        const xs = mouth.locations.map((p: any) => p.x)
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
                                trySatisfyGestureChallenge('blink')
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
                            trySatisfyGestureChallenge('mouth')
                            mouthWasOpenPhaseRef.current = false
                        }
                        prevMouthClosedLandmarkRef.current = mouthClosed
                    }

                    checkChallengeTimeout(now)

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
                                const four: IcaoFour = {
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
                                const headYawRatio = Number(status?.head_yaw_ratio ?? 0)
                                if (Number.isFinite(headYawRatio)) {
                                    trySatisfyYawChallenge(headYawRatio)
                                }
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
                        if (FACIAL_STRICT_OVAL_MODE && bestFace) {
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

                        const updated: FaceGuideState = {
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

                        if (updated.qualityReady && hasFaceNow && bestFace) {
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
            } catch (err) { log.error("Tracking Error:", err) }
            requestID = requestAnimationFrame(detectFaceLoop)
        }


        if (cameraReady) {
            log.debug("Starting biometric detection loop...");
            requestID = requestAnimationFrame(detectFaceLoop)
        }

        return () => {
            if (requestID) cancelAnimationFrame(requestID)
        }
    }, [cameraReady])


    useEffect(() => {
        const shouldAutoFaceLogin =
            mode === 'login' &&
            loginBiometricSession &&
            !message.includes('Ingreso autorizado')
        const gateOk = loginBiometricGate && !isProcessing
        if (shouldAutoFaceLogin && hasRequiredBiometricSamples && !isProcessing) {
            const now = performance.now()
            if (!gateOk && now - authFaceAutoDiagAtRef.current > 2000) {
                authFaceAutoDiagAtRef.current = now
                log.info('[AUTH_FACE_AUTO] 3/3 muestras pero gate de envío cerrado', {
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
        const sinceLastAutoTrigger = performance.now() - lastAutoTriggerRef.current
        const cooldownOk = sinceLastAutoTrigger >= FACIAL_ICAO.LOGIN_FACE_RETRY_COOLDOWN_MS
        if (
            gateOk &&
            shouldAutoFaceLogin &&
            hasRequiredBiometricSamples &&
            challengesPassedRef.current &&
            !loginSubmitTriggeredRef.current &&
            cooldownOk
        ) {
            log.info('[AUTH_FACE_AUTO] disparando login facial', {
                qualityReady: Boolean(faceGuide.qualityReady),
                captureCount: Number(faceGuide.captureCount || 0),
                lastServerOk: Boolean(faceGuide.lastServerOk),
                hasProbe: Boolean(bestLoginProbeRef.current),
            })
            loginSubmitTriggeredRef.current = true
            lastAutoTriggerRef.current = performance.now()
            handleFaceLogin(bestLoginProbeRef.current)
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
        challengeUiState,
    ])

    useEffect(() => {
        const inRegisterCapture =
            mode === 'register' &&
            ((registerTab === 'user' &&
                registerUserBiometricStep === 'capture') ||
                (registerTab === 'company' &&
                    registerCompanyBiometricStep === 'capture'))
        const samples = Number(faceGuide.captureCount || 0)
        if (!inRegisterCapture) {
            registerAutoSubmitTriggeredRef.current = false
            return
        }
        if (samples < FACIAL_ICAO.REQUIRED_VALID_FRAMES) {
            registerAutoSubmitTriggeredRef.current = false
            return
        }
        if (!challengesPassedRef.current) {
            return
        }
        if (isProcessing || registrationApiInFlightRef.current) {
            return
        }
        if (registerAutoSubmitTriggeredRef.current) {
            return
        }
        registerAutoSubmitTriggeredRef.current = true
        log.info('[AUTH_REGISTER_FLOW] direct trigger by samples', {
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
        registerCompanyBiometricStep,
        faceGuide.captureCount,
        faceGuide.qualityReady,
        faceGuide.lastServerOk,
        isProcessing,
        challengeUiState,
    ])

    const startLoginFaceSession = async () => {
        const id = String(loginForm.username || '').trim()
        const company = String(loginForm.company || '').trim()
        log.info('[AUTH_FACE_UI] start session requested', {
            company,
            identity: id,
            loginTab,
        })
        if (!id) {
            setError(t('error.identityRequired'))
            return
        }
        if (!company) {
            setError(t('error.companyRequired'))
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
                        ? t('error.userNotFound')
                        : localizeMessage(check.error || t('error.userNotFound'))
                setError(msg)
                log.warn('[AUTH_FACE_UI] identidad rechazada antes de cámara', {
                    company,
                    identity: id,
                    reason: check.reason,
                    rawOk: check.ok,
                })
                return
            }
            log.info('[AUTH_FACE_UI] identidad verificada, abriendo sesión facial', {
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
            // Se dispara junto con la cámara (no en el submit) para que la
            // resolución del permiso del navegador no agregue latencia al
            // momento de confirmar el login.
            pendingLocationRef.current = getBestEffortLocation()
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
        } catch (e: any) {
            setError(localizeMessage(e?.message || t('error.identityRequired')))
        } finally {
            setIsProcessing(false)
        }
    }

    const handleFaceLogin = async (probeOverride: LoginProbe | null = null) => {
        if (!videoRef.current || !cameraReady) {
            loginSubmitTriggeredRef.current = false
            log.warn('[AUTH_FACE_UI] handleFaceLogin abort: camera', {
                hasVideo: Boolean(videoRef.current),
                cameraReady,
            })
            setError(t('error.cameraNotReady'))
            return
        }
        if (mode === 'login' && !loginBiometricSessionRef.current) {
            loginSubmitTriggeredRef.current = false
            log.warn('[AUTH_FACE_UI] handleFaceLogin abort: no sesión biométrica login')
            setError(t('error.activateFace'))
            return
        }

        const id = String(loginForm.username || '').trim()
        if (!id) {
            loginSubmitTriggeredRef.current = false
            log.warn('[AUTH_FACE_UI] handleFaceLogin abort: identidad vacía')
            setError(t('error.identityRequired'))
            return
        }

        setIsProcessing(true)
        setError('')
        setMessage('')

        try {
            const probe: LoginProbe =
                probeOverride ||
                bestLoginProbeRef.current || {
                    template: frameToTemplate(videoRef.current, liveFaceBox),
                    imageBase64: frameToJpegBase64(videoRef.current, liveFaceBox),
                    score: -1,
                }
            const template = probe.template
            const imageBase64 = probe.imageBase64
            log.info('[AUTH_FACE_UI] submit face login', {
                company: String(loginForm.company || '').trim(),
                identity: id,
                template_dim: Array.isArray(template) ? template.length : 0,
                has_image_base64: Boolean(imageBase64),
                image_base64_len: imageBase64?.length || 0,
                chosen_probe_score: Number(probe?.score || 0),
                quality_ready: Boolean(faceGuide.qualityReady),
                capture_count: Number(faceGuide.captureCount || 0),
            })
            const location = pendingLocationRef.current
                ? await pendingLocationRef.current.catch(() => null)
                : null
            const result = await loginWithFace({
                company: loginForm.company,
                identityLogin: id,
                template,
                imageBase64,
                location,
            })
            // MFA/TOTP (ADR-135): mismo gate que el login por contraseña --
            // la biometría es un factor fuerte, pero si la cuenta además
            // activó TOTP, se exige igual.
            if (result?.status === 'mfa_required' && result?.mfa_token) {
                setMfaPending({ token: result.mfa_token })
                setMfaError('')
                setMfaCode('')
                return
            }
            const user = result.user
            const score = result.score || 0
            log.info('[AUTH_FACE_UI] login success', {
                user: user?.username,
                company: user?.company,
                score,
                provider: result?.biometric_provider || 'unknown',
            })
            const session = createSession(user, loginTab)
            setMessage(t('message.faceAuthorized', { score: (score * 100).toFixed(1) }))
            onAuthenticated(session)
        } catch (err: any) {
            loginSubmitTriggeredRef.current = false
            log.warn('[AUTH_FACE_UI] login failed', {
                message: err?.message || String(err),
                company: String(loginForm.company || '').trim(),
                identity: id,
            })
            setError(localizeMessage(err.message))
        } finally {
            setIsProcessing(false)
        }
    }

    const handlePasswordLogin = async (event: React.FormEvent) => {
        event.preventDefault()
        setIsProcessing(true)
        setError('')
        setMessage('')

        try {
            if (!String(loginForm.username || '').trim()) {
                setError(t('error.identityRequired'))
                return
            }
            if (!String(loginForm.password || '').trim()) {
                setError(t('error.passwordRequired'))
                return
            }
            const location = pendingPasswordLocationRef.current
                ? await pendingPasswordLocationRef.current.catch(() => null)
                : null
            const result = await loginWithPassword({ ...loginForm, location })
            // MFA/TOTP (ADR-135): password correcto, pero la cuenta exige un
            // segundo factor -- todavía no hay sesión, se pasa al paso de
            // código en vez de autenticar.
            if (result?.status === 'mfa_required' && result?.mfa_token) {
                setMfaPending({ token: result.mfa_token })
                setMfaError('')
                setMfaCode('')
                return
            }
            const session = createSession(result.user, loginTab)
            setMessage(t('message.passwordAuthorized'))
            onAuthenticated(session)
        } catch (err: any) {
            setError(localizeMessage(err.message))
        } finally {
            setIsProcessing(false)
        }
    }

    const handleMfaCodeSubmit = async () => {
        if (!mfaPending) return
        if (!/^\d{6}$/.test(mfaCode.trim())) {
            setMfaError('Ingrese el código de 6 dígitos.')
            return
        }
        setIsProcessing(true)
        setMfaError('')
        try {
            const result = await loginWithMfaCode(mfaPending.token, mfaCode.trim())
            const session = createSession(result.user, loginTab)
            setMfaPending(null)
            setMfaCode('')
            setMessage(t('message.passwordAuthorized'))
            onAuthenticated(session)
        } catch (err: any) {
            setMfaError(localizeMessage(err.message))
        } finally {
            setIsProcessing(false)
        }
    }

    const handleMfaCancel = () => {
        setMfaPending(null)
        setMfaCode('')
        setMfaError('')
    }

    const handleCaptureForRegistration = async () => {
        const isUserRegisterCapture =
            mode === 'register' &&
            registerTab === 'user' &&
            registerUserBiometricStepRef.current === 'capture'

        const releaseRegisterAutoTrigger = (reason: string) => {
            if (!isUserRegisterCapture) return
            log.info('[AUTH_REGISTER_FLOW] registerAutoSubmit ref liberado', { reason })
            registerAutoSubmitTriggeredRef.current = false
        }

        const serverSamplesReady =
            Number(faceGuide.captureCount || 0) >= FACIAL_ICAO.REQUIRED_VALID_FRAMES &&
            Boolean(faceGuide.lastServerOk)

        log.info('[AUTH_REGISTER_FLOW] capture invoked', {
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
            log.info('[AUTH_REGISTER_FLOW] blocked: request already in flight')
            return
        }
        if (!videoRef.current || !cameraReady) {
            setError(t('error.cameraNotReady'))
            log.warn('[AUTH_REGISTER_FLOW] blocked: camera not ready')
            releaseRegisterAutoTrigger('camera_not_ready')
            return
        }

        if (!faceGuide.detected) {
            setError(t('error.faceCentered'))
            log.warn('[AUTH_REGISTER_FLOW] blocked: face not detected')
            releaseRegisterAutoTrigger('not_detected')
            return
        }
        if (!faceGuide.qualityReady && !serverSamplesReady) {
            setError(t('error.faceQuality'))
            log.warn('[AUTH_REGISTER_FLOW] blocked: quality_gate', {
                qualityReady: Boolean(faceGuide.qualityReady),
                captureCount: Number(faceGuide.captureCount || 0),
                lastServerOk: Boolean(faceGuide.lastServerOk),
                serverSamplesReady,
            })
            releaseRegisterAutoTrigger('quality_gate')
            return
        }
        if (isUserRegisterCapture && serverSamplesReady && !faceGuide.qualityReady) {
            log.info(
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
            log.info('[AUTH_REGISTER_FLOW] registerUser request', {
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
                    phone: formatInternationalTel(registerForm.phone, activePhonePrefix),
                    mobile: formatInternationalTel(registerForm.mobile, activePhonePrefix),
                    faceTemplate: template,
                    faceImageBase64: imageBase64,
                    facePortraitOvalBase64: portraitOvalBase64,
                    faceBustRectBase64: bustRectBase64,
                })
                log.info('[AUTH_REGISTER_FLOW] registerUser success', {
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
                setMessage(t('message.registerComplete'))
                setMode('login')
                setError('')
                registerAutoSubmitTriggeredRef.current = false
            } catch (err: any) {
                setCapturedTemplate(null)
                setCapturedImageBase64('')
                setCapturedPortraitOvalBase64('')
                setCapturedBustRectBase64('')
                setError(localizeMessage(err.message))
                // NO releaseRegisterAutoTrigger aqui (a diferencia de los otros
                // early-return de esta funcion): el servidor ya rechazo esta
                // solicitud (ej. "username already exists"), reenviar los
                // MISMOS datos automaticamente nunca va a tener exito. Sin este
                // guard, el useEffect de auto-envio (captureCount se mantiene
                // en 3/3 mientras la camara siga corriendo) reintentaba cada
                // ~2-3s con el mismo payload, y cada intento hacia setError('')
                // al arrancar -- el mensaje de error quedaba visible una
                // fraccion de segundo y se borraba solo, viendose como un
                // parpadeo sin error real. Dejar el trigger armado obliga a
                // salir de la captura (cambia usuario/dni) para reintentar.
                log.warn('[AUTH_REGISTER_FLOW] registerUser error', {
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
        setMessage(t('message.faceCaptured'))
        setError('')
    }

    const startRegisterUserFaceCapture = () => {
        if (registerTab !== 'user') {
            return
        }
        const pw = String(registerForm.password || '')
        const pc = String(registerForm.passwordConfirm || '')
        if (pw.length < 6) {
            setError(t('error.passwordLength'))
            return
        }
        if (pw !== pc) {
            setError(t('error.passwordMismatch'))
            return
        }
        if (!String(registerForm.company || '').trim()) {
            setError(t('error.companyRequired'))
            return
        }
        if (!String(registerForm.dni || '').trim() || registerForm.dni.trim().length < 8) {
            setError(t('error.workerId'))
            return
        }
        if (!String(registerForm.firstName || '').trim()) {
            setError(t('error.firstNames'))
            return
        }
        if (!String(registerForm.lastName || '').trim()) {
            setError(t('error.lastNames'))
            return
        }
        if (!String(registerForm.email || '').trim() || registerForm.email.trim().length < 5) {
            setError(t('error.email'))
            return
        }
        if (!String(registerForm.mobile || '').trim() || registerForm.mobile.trim().length < 6) {
            setError(t('error.mobile'))
            return
        }
        if (!String(registerForm.username || '').trim() || registerForm.username.trim().length < 4) {
            setError(t('error.usernameLength'))
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

    const startRegisterCompanyFaceCapture = () => {
        if (registerTab !== 'company') {
            return
        }
        const pw = String(registerForm.password || '')
        const pc = String(registerForm.passwordConfirm || '')
        if (pw.length < 6) {
            setError(t('error.passwordLength'))
            return
        }
        if (pw !== pc) {
            setError(t('error.passwordMismatch'))
            return
        }
        const requiredTaxIdLength = country === 'BR' ? 14 : country === 'PE' ? 11 : 9
        if (registerForm.ruc.trim().length !== requiredTaxIdLength || !registerForm.rucValid) {
            setError(t('error.ruc'))
            return
        }
        if (!String(registerForm.contractorLegalName || '').trim()) {
            setError(t('error.contractorName'))
            return
        }
        if (!String(registerForm.company || '').trim()) {
            setError(t('error.companyRequired'))
            return
        }
        if (!String(registerForm.dni || '').trim() || registerForm.dni.trim().length < 8) {
            setError(t('error.representativeId'))
            return
        }
        if (!String(registerForm.firstName || '').trim()) {
            setError(t('error.representativeFirstNames'))
            return
        }
        if (!String(registerForm.lastName || '').trim()) {
            setError(t('error.representativeLastNames'))
            return
        }
        if (!String(registerForm.mobile || '').trim() || registerForm.mobile.trim().length < 6) {
            setError(t('error.mobile'))
            return
        }
        if (!String(registerForm.username || '').trim() || registerForm.username.trim().length < 4) {
            setError(t('error.usernameLength'))
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
        setRegisterCompanyBiometricStep('capture')
    }

    const handleRegister = async (event: { preventDefault: () => void }) => {
        event.preventDefault()
        if (registerForm.password !== registerForm.passwordConfirm) {
            setError(t('error.passwordMismatch'))
            return
        }
        if (!canRegister) {
            setError(t('error.completeRegistration'))
            return
        }

        setIsProcessing(true)
        setError('')
        setMessage('')

        try {
            // Decisión de Gerencia (2026-07-21): el login/tenant del contratista
            // debe quedar SIEMPRE bajo la razón social de la EMPRESA MINERA
            // asociada (registerForm.company, elegida del select de empresas
            // reales) -- nunca bajo la razón social propia del contratista
            // (contractorLegalName, texto libre). Antes se sobreescribía
            // `company` con contractorLegalName antes de enviar, lo que creaba
            // una empresa/tenant fantasma sin unidad minera real asociada (ver
            // auditoría RUC/tenant, Auditoria_Registro_RUC_Tenant_2026-07-21.md)
            // -- el contratista quedaba autenticado pero sin poder crear
            // informes. `contractorLegalName` se sigue capturando y enviando
            // (queda disponible como dato del contratista), pero ya no
            // reemplaza a `company`.
            const registrationPayload = {
                ...registerForm,
                phone: formatInternationalTel(registerForm.phone, activePhonePrefix),
                mobile: formatInternationalTel(registerForm.mobile, activePhonePrefix),
            }
            const result = await registerUser({
                ...registrationPayload,
                faceTemplate: capturedTemplate ?? undefined,
                faceImageBase64: capturedImageBase64,
                facePortraitOvalBase64: capturedPortraitOvalBase64 || undefined,
                faceBustRectBase64: capturedBustRectBase64 || undefined,
            })

            const session = createSession(result.user, registerTab)
            setMessage(t('message.registered'))
            onAuthenticated(session)
        } catch (err: any) {
            setError(localizeMessage(err.message))
        } finally {
            setIsProcessing(false)
        }
    }

    useEffect(() => {
        if (mode !== 'register' || registerTab !== 'company') {
            prevCompanyCanRegisterRef.current = false
            return
        }
        if (!capturedImageBase64) {
            prevCompanyCanRegisterRef.current = false
            return
        }
        const prev = prevCompanyCanRegisterRef.current
        const rose = Boolean(canRegister) && !prev
        prevCompanyCanRegisterRef.current = Boolean(canRegister)
        if (!rose || isProcessing) {
            return
        }
        handleRegister({ preventDefault() {} })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- handleRegister; canRegister resume el formulario completo
    }, [mode, registerTab, capturedImageBase64, canRegister, isProcessing])

    return (
        <div
            className={`auth-screen${
                registerFormNarrowFitView ? ' auth-screen--register-person-fit' : ''
            }`}
            data-auth-ui="icao-login-v2"
        >
            <div
                className="auth-background"
                style={{
                    backgroundImage: `url("${selectedLoginBgUrl}")`,
                }}
            />
            <div className="auth-screen-content">
            <div
                className={`auth-shell${
                    registerFormNarrowFitView && !showBiometricPanel
                        ? ' auth-shell--narrow-only'
                        : ''
                }`}
                data-auth-layout={authShellLayout}
                style={{
                    gridTemplateColumns: faceCaptureOnlyView
                        ? '1fr'
                        : showBiometricPanel
                          ? '1.05fr 1fr'
                          : '1fr',
                    width: faceCaptureOnlyView
                        ? 'min(880px, 100%)'
                        : showBiometricPanel
                          ? 'min(920px, 100%)'
                          : registerFormNarrowFitView
                            ? 'min(720px, 100%)'
                            : 'min(720px, 100%)',
                }}
            >
                {showBiometricPanel && (
                <section className="auth-panel auth-panel-main">
                    {faceCaptureOnlyView && (
                        <PlatformBrandPanelHeader compact subtitle={t('auth.platformSubtitle')} />
                    )}
                    <div className="camera-card camera-card-tall">
                        <div className="camera-header">
                            <div className="camera-title camera-title-with-pill">
                                <span className="auth-pill auth-pill-inline">{t('auth.accessControl')}</span>
                                <Camera size={16} />
                                <span>{t('auth.camera')}</span>
                                <span
                                    className="auth-pill auth-pill-inline"
                                    style={{ opacity: 0.8, fontSize: '10px' }}
                                >
                                    build {BUILD_STAMP}
                                </span>
                            </div>
                            <span className={cameraReady ? 'status-dot online' : 'status-dot offline'}>
                                {cameraReady
                                    ? t('auth.cameraActive')
                                    : mode === 'login' && !loginBiometricSession
                                      ? t('auth.cameraWaiting')
                                      : t('auth.cameraUnavailable')}
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
                                            {t('auth.timeRemaining')}
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
                                                className="text-orange-300 text-[10px] font-semibold px-1"
                                                style={{
                                                    textShadow:
                                                        '0 0 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.95)',
                                                }}
                                            >
                                                {faceGuide.detected
                                                    ? t('auth.trackingFace')
                                                    : t('auth.searchingFace')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {ACTIVE_CHALLENGE_ENABLED &&
                                cameraReady &&
                                !isChallengeSequenceComplete(challengeUiState) &&
                                (() => {
                                    const chType = currentChallenge(challengeUiState)
                                    if (!chType) {
                                        return null
                                    }
                                    const isSuccess = challengeUiState.status === 'success'
                                    const isTimeout = challengeUiState.status === 'timeout'
                                    const secondsLeft =
                                        challengeUiState.deadlineAt != null
                                            ? Math.max(
                                                  0,
                                                  Math.ceil(
                                                      (challengeUiState.deadlineAt - performance.now()) / 1000
                                                  )
                                              )
                                            : 0
                                    return (
                                        <div
                                            className="absolute left-1/2 top-3 -translate-x-1/2 flex flex-col items-center gap-1 px-4 py-2 rounded-xl text-center"
                                            style={{
                                                zIndex: 25,
                                                background: isSuccess
                                                    ? 'rgba(22, 101, 52, 0.92)'
                                                    : isTimeout
                                                      ? 'rgba(127, 29, 29, 0.92)'
                                                      : 'rgba(15, 23, 42, 0.88)',
                                                border: `1px solid ${
                                                    isSuccess
                                                        ? '#22c55e'
                                                        : isTimeout
                                                          ? '#ef4444'
                                                          : '#38bdf8'
                                                }`,
                                                minWidth: 220,
                                            }}
                                        >
                                            <span className="text-[10px] tracking-wider uppercase text-sky-300">
                                                {t('liveness.challenge.progress', {
                                                    current: String(challengeUiState.index + 1),
                                                    total: String(challengeUiState.queue.length),
                                                })}
                                            </span>
                                            <span className="text-white text-sm font-bold flex items-center gap-2">
                                                {isSuccess ? (
                                                    <CheckCircle2 size={18} className="text-green-400" />
                                                ) : (
                                                    <ScanFace size={18} className="animate-pulse text-sky-300" />
                                                )}
                                                {isSuccess
                                                    ? t('liveness.challenge.success')
                                                    : isTimeout
                                                      ? t('liveness.challenge.retry')
                                                      : t(challengeInstructionKey(chType))}
                                            </span>
                                            {challengeUiState.status === 'pending' && (
                                                <span className="text-[11px] text-amber-200 font-mono">
                                                    {secondsLeft}s
                                                </span>
                                            )}
                                        </div>
                                    )
                                })()}

                            {!cameraReady && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white gap-3 px-4 text-center" style={{ zIndex: 20 }}>
                                    <ScanFace size={48} className="animate-pulse opacity-50" />
                                    {mode === 'login' && !loginBiometricSession ? (
                                        <>
                                            <span className="text-sm font-medium max-w-xs">
                                                {t('auth.cameraStartHelp', {
                                                    seconds: Math.round(FACIAL_ICAO.LOGIN_FACE_SESSION_MS / 1000),
                                                })}
                                            </span>
                                            <span className="text-xs opacity-70 max-w-xs">
                                                {t('auth.locationNotice')}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="text-sm font-medium">{t('auth.startingBiometric')}</span>
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
                                        {t('auth.samples')}
                                    </div>
                                    <div className="text-lg font-bold leading-tight text-center">
                                        {Math.min(FACIAL_ICAO.REQUIRED_VALID_FRAMES, Number(faceGuide.captureCount || 0))}/{FACIAL_ICAO.REQUIRED_VALID_FRAMES}
                                    </div>
                                </div>
                            )}

                            {/* New: Capture Preview Box */}
                            {capturedImageBase64 && (
                                <div className="absolute bottom-4 right-4 w-24 h-24 rounded-full border-2 border-green-500 overflow-hidden shadow-lg z-20 bg-slate-800 flex items-center justify-center">
                                    <img src={`data:image/jpeg;base64,${capturedImageBase64}`} className="w-full h-full object-cover" alt="captured face" />
                                    <div className="absolute inset-0 border border-white/20 rounded-full animate-pulse pointer-events-none"></div>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="bg-green-500 text-[8px] font-bold text-white px-1.5 py-0.5 rounded absolute -top-1">{t('auth.snapshot')}</div>
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
                                <div className="bio-icao-title">{t('auth.icaoQuality')}</div>
                                <div className="bio-icao-grid-2">
                                    <div className="bio-icao-row">
                                        <span>{t('auth.eyesOpen')}</span>
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
                                        <span>{t('auth.mouthClosed')}</span>
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
                                        <span>{t('auth.frontal')}</span>
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
                                        <span>{t('auth.noGlasses')}</span>
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
                                <div className="bio-icao-title">{t('auth.liveness')}</div>
                                <div className="bio-icao-bar-track">
                                    <div
                                        className="bio-icao-bar-fill"
                                        style={{
                                            width: `${Math.min(100, faceGuide.livenessScore)}%`,
                                        }}
                                    />
                                </div>
                                <div className="bio-icao-liveness-meta">
                                    <span>{t('auth.threshold', { value: FACIAL_ICAO.LIVENESS_SCORE_PASS })}</span>
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
                                    if (anyRegisterCaptureView) {
                                        endRegisterFaceSession({})
                                    } else {
                                        endLoginFaceSession({})
                                    }
                                }}
                                style={{ marginTop: '8px', width: '100%', padding: '10px', fontSize: '13px' }}
                            >
                                {t('auth.cancelFace')}
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
                            style={{padding: '8px', fontSize: '12px'}}
                        >
                            <ShieldCheck size={20} /> {t('auth.enter')}
                        </button>
                        <button
                            type="button"
                            className={mode === 'register' ? 'active' : ''}
                            onClick={() => {
                                setMode('register')
                                setRegisterTab('user')
                                setRegisterUserBiometricStep('form')
                                setRegisterCompanyBiometricStep('form')
                                setError('')
                                setMessage('')
                            }}
                            style={{padding: '8px', fontSize: '12px'}}
                        >
                            <UserPlus size={20} /> {t('auth.register')}
                        </button>
                    </div>
                    )}
                </section>
                )}

                {!faceCaptureOnlyView && (
                <section
                    className={`auth-panel auth-panel-form auth-panel-form--auth-compact${
                        registerFormNarrowFitView
                            ? ' auth-panel-form--register-person'
                            : ''
                    }`}
                >
                    <PlatformBrandPanelHeader compact={registerFormNarrowFitView} subtitle={t('auth.platformSubtitle')} />
                    <PlatformRegionBar variant="auth" />
                    {mode === 'login' ? (
                        <>
                            <div className="auth-form-section-intro">
                                <h2 className="auth-form-section-intro-title">{t('auth.secureAccess')}</h2>
                                <p className="auth-form-section-intro-text">
                                    {t('auth.loginHelp')}
                                </p>
                            </div>
                            <div className="auth-login-tab-row">
                                <button type="button" className={loginTab === 'user' ? 'secondary-button' : 'logout-demo'} style={{flex: 1, padding: '6px', fontSize: '11px'}} onClick={() => { setLoginTab('user'); setError(''); }}>{t('auth.loginUser')}</button>
                                <button type="button" className={loginTab === 'company' ? 'secondary-button' : 'logout-demo'} style={{flex: 1, padding: '6px', fontSize: '11px'}} onClick={() => { setLoginTab('company'); setError(''); }}>{t('auth.loginCompany')}</button>
                            </div>

                            <form
                                id="auth-login-credentials-form"
                                className="stack-form auth-login-credentials-stack"
                                onSubmit={handlePasswordLogin}
                            >
                            <label className="field-label">
                                <Building2 size={14} /> {t('auth.assignedCompany')}
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
                                <UserRound size={14} /> {t('auth.identity')}
                                <input
                                    type="text"
                                    value={loginForm.username}
                                    onChange={(event) =>
                                        setLoginForm((prev) => ({
                                            ...prev,
                                            username: event.target.value,
                                        }))
                                    }
                                    placeholder={t('auth.identityPlaceholder')}
                                    autoComplete="username"
                                />
                            </label>
                            <label className="field-label">
                                <KeyRound size={14} /> {t('auth.password')}
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
                                    placeholder={t('auth.passwordPlaceholder')}
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
                                        <span style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('auth.faceReadyTitle')}</span>
                                        <span style={{ fontSize: '13px', color: '#94a3b8' }}>{t('auth.faceReadyText')}</span>
                                    </div>
                                </div>
                            )}

                            <button
                                type="button"
                                className="primary-face-button"
                                disabled={
                                    isProcessing ||
                                    (loginBiometricSession &&
                                        (!cameraReady || !loginBiometricGate || !challengesPassedRef.current))
                                }
                                onClick={async () => {
                                    if (!loginBiometricSession) {
                                        await startLoginFaceSession()
                                        return
                                    }
                                    if (cameraReady && loginBiometricGate && challengesPassedRef.current && !isProcessing) {
                                        loginSubmitTriggeredRef.current = true
                                        handleFaceLogin(bestLoginProbeRef.current)
                                    } else if (!challengesPassedRef.current) {
                                        setError(t('liveness.challenge.retry'))
                                    } else {
                                        setError(
                                            t('error.biometricWait')
                                        )
                                    }
                                }}
                                style={{ marginTop: '12px' }}
                            >
                                <ScanFace size={17} />
                                {isProcessing
                                    ? t('auth.validatingFace')
                                    : !loginBiometricSession
                                      ? t('auth.faceLogin')
                                      : !cameraReady
                                        ? t('auth.openingCamera')
                                        : !loginBiometricGate
                                          ? t('auth.biometricRunning')
                                          : hasRequiredBiometricSamples
                                            ? t('auth.autoSending')
                                            : t('auth.capturing', {
                                                current: Number(faceGuide.captureCount || 0),
                                                total: FACIAL_ICAO.REQUIRED_VALID_FRAMES,
                                            })}
                            </button>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                                <button
                                    type="submit"
                                    form="auth-login-credentials-form"
                                    className="auth-login-password-button"
                                    disabled={isProcessing}
                                >
                                    <KeyRound size={16} /> {t('auth.passwordLogin')}
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
                                    <UserPlus size={16} /> {t('auth.registerUser')}
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
                                    {t('auth.cancelFace')}
                                </button>
                            )}

                        </>
                    ) : (
                        <>
                            <div className="auth-form-section-intro">
                                <h2 className="auth-form-section-intro-title">{t('auth.secureAccess')}</h2>
                                <p className="auth-form-section-intro-text">
                                    {t('auth.registerHelp')}
                                </p>
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
                                        setRegisterCompanyBiometricStep('form')
                                        setRegisterUserBiometricStep('form')
                                        setError('')
                                    }}
                                >
                                    {t('auth.registerPersonTab')}
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
                                        setRegisterCompanyBiometricStep('form')
                                        setRegisterUserBiometricStep('form')
                                        setRegisterForm((prev) => ({
                                            ...prev,
                                            contractorLegalName: '',
                                        }))
                                        setError('')
                                    }}
                                >
                                    {t('auth.registerCompanyTab')}
                                </button>
                            </div>
                            {mode === 'register' &&
                                !showBiometricPanel &&
                                !(registerTab === 'user' && registerUserBiometricStep === 'success') && (
                                    <button
                                        type="button"
                                        className="logout-demo register-back-login-btn"
                                        onClick={() => {
                                            setMode('login')
                                            setRegisterUserBiometricStep('form')
                                            setRegisterCompanyBiometricStep('form')
                                            setError('')
                                            setMessage('')
                                        }}
                                    >
                                        {t('auth.backToLogin')}
                                    </button>
                                )}
                            {mode === 'register' &&
                                registerTab === 'company' &&
                                registerCompanyBiometricStep === 'capture' && (
                                    <button
                                        type="button"
                                        className="logout-demo register-back-login-btn"
                                        onClick={() => {
                                            endRegisterFaceSession({})
                                            setMode('login')
                                            setError('')
                                            setMessage('')
                                        }}
                                    >
                                        {t('auth.backToLogin')}
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
                                    <h2 style={{ marginBottom: '8px' }}>{t('auth.registerSuccess')}</h2>
                                    <p
                                        style={{
                                            color: '#94a3b8',
                                            marginBottom: '24px',
                                            fontSize: '15px',
                                            lineHeight: 1.45,
                                        }}
                                    >
                                        {t('auth.registerSuccessText')}
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
                                        <UserPlus size={17} /> {t('auth.enterSystem')}
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
                                        {t('auth.backToLogin')}
                                    </button>
                                </div>
                            ) : (
                            <>
                            {registerTab === 'company' && registerCompanyBiometricStep === 'form' && (
                                <h2 className="auth-register-section-heading">
                                    <Building2 size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                                    {t('auth.contractorRegistration')}
                                </h2>
                            )}
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault()
                                }}
                                className={`stack-form${
                                    registerFormNarrowFitView
                                        ? ' stack-form--register-person'
                                        : ''
                                }`}
                            >
                                {registerTab === 'company' ? (
                                    <div className="register-company-fields">
                                        <label className="field-label">
                                            <Building2 size={16} /> {t('auth.associatedMine')}
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
                                         <label className="field-label">
                                            {t('auth.companyRuc')}
                                            <div style={{ position: 'relative' }}>
                                                <input
                                                    type="text"
                                                    maxLength={country === 'BR' ? 14 : country === 'PE' ? 11 : 9}
                                                    value={registerForm.ruc}
                                                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, ruc: e.target.value }))}
                                                    required
                                                    style={{
                                                        borderColor: registerForm.ruc.length === (country === 'BR' ? 14 : country === 'PE' ? 11 : 9) ? (registerForm.rucValid ? '#22c55e' : '#ef4444') : undefined,
                                                        paddingRight: '35px'
                                                    }}
                                                />
                                                <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                                                    {registerForm.isValidatingRuc ? (
                                                        <div className="animate-spin h-4 w-4 border-2 border-orange-500 border-t-transparent rounded-full"></div>
                                                    ) : registerForm.ruc.length === (country === 'BR' ? 14 : country === 'PE' ? 11 : 9) ? (
                                                        registerForm.rucValid ? (
                                                            <ShieldCheck size={16} className="text-green-500" />
                                                        ) : (
                                                            <span title={t('auth.rucInvalid')}>
                                                                <AlertTriangle size={16} className="text-red-500" />
                                                            </span>
                                                        )
                                                    ) : null}
                                                </div>
                                            </div>
                                            {registerForm.ruc.length === (country === 'BR' ? 14 : country === 'PE' ? 11 : 9) && !registerForm.rucValid && !registerForm.isValidatingRuc && (
                                                <span style={{ fontSize: '10px', color: '#ef4444', marginTop: '4px', display: 'block' }}>
                                                    {t('auth.rucInvalid')}
                                                </span>
                                            )}
                                         </label>
                                         <label className="field-label" style={{ clear: 'both' }}>
                                             {t('auth.contractorName')}
                                             <input
                                                 type="text"
                                                 value={registerForm.contractorLegalName}
                                                 onChange={(e) =>
                                                     setRegisterForm((prev) => ({
                                                         ...prev,
                                                         contractorLegalName: e.target.value,
                                                     }))
                                                 }
                                                 required
                                             />
                                         </label>
                                         <div className="auth-divider auth-divider--tight"><span>{t('auth.legalRepresentative')}</span></div>
                                         <label className="field-label">
                                             {t('auth.representativeId')}
                                             <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                 <input type="text" maxLength={12} value={registerForm.dni} onChange={(e) => setRegisterForm((prev) => ({ ...prev, dni: e.target.value }))} required style={{ flex: 1 }} />
                                                 <button type="button" onClick={() => setShowDniScan(true)} title="Escanear DNI con la cámara" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '8px', border: '1px solid rgba(240,126,65,.4)', background: 'rgba(240,126,65,.1)', color: '#f07e41', cursor: 'pointer', flexShrink: 0 }}>
                                                     <ScanLine size={16} />
                                                 </button>
                                             </div>
                                         </label>
                                         <div style={{display: 'flex', gap: '10px'}}>
                                             <label className="field-label" style={{flex: 1}}>
                                                 {t('auth.firstNames')}
                                                 <input type="text" value={registerForm.firstName} onChange={(e) => setRegisterForm((prev) => ({ ...prev, firstName: e.target.value }))} required />
                                             </label>
                                             <label className="field-label" style={{flex: 1}}>
                                                 {t('auth.lastNames')}
                                                 <input type="text" value={registerForm.lastName} onChange={(e) => setRegisterForm((prev) => ({ ...prev, lastName: e.target.value }))} required />
                                             </label>
                                         </div>
                                         <div style={{display: 'flex', gap: '10px'}}>
                                             <label className="field-label" style={{flex: 1}}>
                                                 {t('auth.landline')}
                                                 <div className="field-tel-wrap">
                                                     <span className="field-tel-prefix">+{activePhonePrefix}</span>
                                                     <input type="tel" inputMode="tel" value={registerForm.phone} onChange={(e) => setRegisterForm((prev) => ({ ...prev, phone: e.target.value }))} />
                                                 </div>
                                             </label>
                                             <label className="field-label" style={{flex: 1}}>
                                                 {t('auth.mobile')}
                                                 <div className="field-tel-wrap">
                                                     <span className="field-tel-prefix">+{activePhonePrefix}</span>
                                                     <input type="tel" inputMode="tel" value={registerForm.mobile} onChange={(e) => setRegisterForm((prev) => ({ ...prev, mobile: e.target.value }))} required />
                                                 </div>
                                             </label>
                                         </div>
                                    </div>
                                ) : (
                                    <div className="register-person-fields">
                                        <h2 className="auth-register-section-heading reg-grid-full">
                                            <UserRound size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                                            {t('auth.personRegistration')}
                                        </h2>
                                        <label className="field-label reg-grid-full">
                                            <Building2 size={16} /> {t('auth.assignedCompany')}
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
                                            {t('auth.workerId')}
                                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
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
                                                    style={{ flex: 1 }}
                                                />
                                                <button type="button" onClick={() => setShowDniScan(true)} title="Escanear DNI con la cámara" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '8px', border: '1px solid rgba(240,126,65,.4)', background: 'rgba(240,126,65,.1)', color: '#f07e41', cursor: 'pointer', flexShrink: 0 }}>
                                                    <ScanLine size={16} />
                                                </button>
                                            </div>
                                        </label>
                                        <label className="field-label reg-grid-nombres">
                                            {t('auth.firstNames')}
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
                                            {t('auth.lastNames')}
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
                                            {t('auth.email')}
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
                                            {t('auth.mobile')}
                                            <div className="field-tel-wrap">
                                                <span className="field-tel-prefix">+{activePhonePrefix}</span>
                                                <input
                                                    type="tel"
                                                    inputMode="tel"
                                                    value={registerForm.mobile}
                                                    onChange={(e) =>
                                                        setRegisterForm((prev) => ({
                                                            ...prev,
                                                            mobile: e.target.value,
                                                        }))
                                                    }
                                                    required
                                                />
                                            </div>
                                        </label>
                                        <label className="field-label reg-grid-full">
                                            {t('auth.role')}
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
                                                    {t('role.operator')}
                                                </option>
                                                <option value="supervisor">
                                                    {t('role.supervisor')}
                                                </option>
                                                <option value="manager">
                                                    {t('role.manager')}
                                                </option>
                                                <option value="geologist">
                                                    {t('role.geologist')}
                                                </option>
                                                <option value="safety">
                                                    {t('role.safety')}
                                                </option>
                                                <option value="admin">
                                                    {t('role.admin')}
                                                </option>
                                            </select>
                                        </label>
                                    </div>
                                )}

                                <div className="auth-divider auth-divider--tight">
                                    <span>{t('auth.credentials')}</span>
                                </div>
                                <label className="field-label register-credentials-username">
                                    {t('auth.systemUser')}
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
                                        {t('auth.password')}
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
                                        {t('auth.confirmPassword')}
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
                                            : registerTab === 'company' &&
                                                registerCompanyBiometricStep === 'form'
                                              ? isProcessing
                                              : !cameraReady
                                    }
                                    onClick={
                                        registerTab === 'user' &&
                                        registerUserBiometricStep === 'form'
                                            ? startRegisterUserFaceCapture
                                            : registerTab === 'company' &&
                                                registerCompanyBiometricStep === 'form'
                                              ? startRegisterCompanyFaceCapture
                                              : handleCaptureForRegistration
                                    }
                                    style={
                                        (registerTab === 'user' &&
                                            registerUserBiometricStep === 'form') ||
                                        (registerTab === 'company' &&
                                            registerCompanyBiometricStep === 'form')
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
                                        ? t('auth.captureReady')
                                        : t('auth.registerBiometric')}
                                </button>
                                {registerTab === 'company' && capturedImageBase64 && canRegister && isProcessing && (
                                    <p className="auth-company-register-pending" role="status">
                                        {t('auth.sendingRegistration')}
                                    </p>
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
            <DocumentScanCapture
                isOpen={showDniScan}
                onClose={() => setShowDniScan(false)}
                onSuccess={handleDniScanSuccess}
            />
            {mfaPending && (
                <div
                    role="dialog"
                    aria-modal="true"
                    style={{
                        position: 'fixed', inset: 0, zIndex: 1000,
                        background: 'rgba(2, 6, 23, 0.75)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                >
                    <div style={{
                        background: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.25)',
                        borderRadius: 12, padding: '1.75rem', width: '90%', maxWidth: 360,
                        boxShadow: '0 20px 40px -12px rgba(0,0,0,0.6)',
                    }}>
                        <h3 style={{ color: '#e2e8f0', fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
                            Verificación en dos pasos
                        </h3>
                        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 1rem' }}>
                            Ingrese el código de 6 dígitos de su aplicación de autenticación.
                        </p>
                        <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={mfaCode}
                            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleMfaCodeSubmit() }}
                            placeholder="000000"
                            autoFocus
                            style={{
                                width: '100%', boxSizing: 'border-box', fontSize: '1.4rem',
                                letterSpacing: '0.4em', textAlign: 'center', padding: '0.6rem',
                                borderRadius: 8, border: '1px solid rgba(148, 163, 184, 0.35)',
                                background: '#020617', color: '#e2e8f0', marginBottom: '0.75rem',
                            }}
                        />
                        {mfaError && (
                            <div className="auth-message error" style={{ marginBottom: '0.75rem' }}>
                                <AlertTriangle size={15} /> {mfaError}
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '0.6rem' }}>
                            <button
                                type="button"
                                onClick={handleMfaCancel}
                                disabled={isProcessing}
                                style={{
                                    flex: 1, padding: '0.55rem', borderRadius: 8, cursor: 'pointer',
                                    background: 'transparent', color: '#94a3b8',
                                    border: '1px solid rgba(148, 163, 184, 0.35)',
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleMfaCodeSubmit}
                                disabled={isProcessing || mfaCode.length !== 6}
                                style={{
                                    flex: 1, padding: '0.55rem', borderRadius: 8, cursor: 'pointer',
                                    background: '#f07e41', color: '#0f172a', fontWeight: 600,
                                    border: 'none', opacity: (isProcessing || mfaCode.length !== 6) ? 0.6 : 1,
                                }}
                            >
                                Verificar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default memo(AuthGateway)
