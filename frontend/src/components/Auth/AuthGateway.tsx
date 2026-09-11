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
    ArrowLeftCircle,
    ArrowRightCircle,
    ZoomIn,
    ZoomOut,
    Volume2,
    VolumeX,
    Mail,
    Smartphone,
    Send,
    RefreshCw,
    Lock,
} from 'lucide-react'
import { DocumentScanCapture } from '../UI/DocumentScanCapture'
import { FotocheckQrScanCapture } from '../UI/FotocheckQrScanCapture'
import type { DniScanResult } from '../../auth/authApi'
import {
    createSession,
    getSession,
    type Session,
} from '../../auth/authStorage'
import {
    checkDniAvailable,
    checkUsernameAvailable,
    checkLoginIdentity,
    fetchCompanies,
    loginWithFace,
    loginWithPassword,
    loginWithMfaCode,
    processBiometricFrame,
    trackBiometricFrameFast,
    fetchBiometricStatus,
    registerUser,
    resetBiometricCapture,
    reportClientIncident,
    validateCompany,
    sendContactOtp,
    verifyContactOtp,
    type ContactOtpSendResult,
    type ContactOtpVerifyResult,
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
    drawVideoCoverCropped,
    computeBiometricOvalLayout,
    mapOvalLayoutVideoToStage,
    frameToTemplate,
    frameToJpegBase64,
    frameToOvalPortraitJpegBase64,
    frameToBustRectAroundOvalJpegBase64,
    estimateAvatarFrameQuality,
    FACIAL_STRICT_OVAL_MODE,
    FACIAL_STRICT_OVAL_W_PCT,
    FACIAL_STRICT_OVAL_H_PCT,
} from '../../auth/biometricOvalFrame'
import { classifyCameraError } from '../../auth/cameraErrorPolicy'
import { acquireFaceCameraStream } from '../../auth/adaptiveCameraCapture'
import { AdaptiveEncodeResolution } from '../../auth/adaptiveEncodeResolution'
import {
    ensureFaceLandmarkerLoading,
    getFaceLandmarker,
    landmarksToFaceBox,
} from '../../auth/mediapipeFaceTracker'
import {
    CHALLENGE_MAX_ATTEMPTS,
    createInitialChallengeState,
    currentChallenge,
    isChallengeSequenceComplete,
    challengeInstructionKey,
    ACTIVE_CHALLENGE_ENABLED,
    type LivenessChallengeState,
    type LivenessChallengeType,
} from '../../auth/livenessChallenge'
import {
    speak,
    stopSpeaking,
    playChallengeArmedTone,
    playChallengeSuccessTone,
    playChallengeRetryTone,
} from '../../auth/challengeVoiceGuide'
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
    /** Espejo de status.quality_gate_reached (ADR-143): captureCount ya llegó
     * al mínimo Y hubo al menos un parpadeo natural observado. Opcional para
     * no tener que tocar cada reset de faceGuide -- ausente/undefined se
     * trata como false (mismo criterio que challenge.complete). */
    qualityGateReached?: boolean;
    icaoEyes: boolean | null;
    icaoMouth: boolean | null;
    icaoFrontal: boolean | null;
    icaoNoGlasses: boolean | null;
    livenessScore: number;
    inTargetZone: boolean;
    serverFaceOval: any;
}

/** Forma de trabajo interna de un bbox de rostro; `landmarks` queda vacío desde ADR-162 (MediaPipe local expone ear/mouthMarRatio/ovalPoints en vez de esa lista dinámica tipo FaceDetector). */
interface WorkingFaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
    landmarks: any[];
    isFallback?: boolean;
    /** EAR real (6 puntos) por ojo -- ver mediapipeFaceTracker.ts. Ausente = sin landmarks reales (fallback de piel o WASM aún cargando). */
    ear?: { left: number; right: number };
    /** Centro de cada ojo en píxeles -- para chequeo de roll/alineación (reemplaza el punto único de FaceDetector). */
    eyeCenters?: { left: { x: number; y: number }; right: { x: number; y: number } };
    /** Apertura vertical interna / ancho boca (misma fórmula que mar_inner_ratio() en ai_engine/eye_analyzer.py). */
    mouthMarRatio?: number;
    /** Contorno facial real (36 puntos, FACEMESH_FACE_OVAL) en píxeles de la grilla pw×ph. */
    ovalPoints?: { x: number; y: number }[];
}

interface LoginProbe {
    template: number[];
    imageBase64: string;
    portraitOvalBase64?: string;
    bustRectBase64?: string;
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

function faceBoxCenter(box: WorkingFaceBox) {
    return {
        x: box.x + box.width * 0.5,
        y: box.y + box.height * 0.5,
    }
}

function faceBoxIoU(a: WorkingFaceBox, b: WorkingFaceBox): number {
    const ax2 = a.x + a.width
    const ay2 = a.y + a.height
    const bx2 = b.x + b.width
    const by2 = b.y + b.height
    const ix1 = Math.max(a.x, b.x)
    const iy1 = Math.max(a.y, b.y)
    const ix2 = Math.min(ax2, bx2)
    const iy2 = Math.min(ay2, by2)
    const iw = Math.max(0, ix2 - ix1)
    const ih = Math.max(0, iy2 - iy1)
    const inter = iw * ih
    const union = a.width * a.height + b.width * b.height - inter
    return union > 0 ? inter / union : 0
}

function predictFaceBox(prev: WorkingFaceBox, history: { nx: number; ny: number; nw: number; nh: number }[], frameW: number, frameH: number): WorkingFaceBox {
    if (history.length < 2) {
        return { ...prev, landmarks: [], isFallback: false }
    }
    const a = history[history.length - 2]
    const b = history[history.length - 1]
    const dx = (b.nx - a.nx) * frameW
    const dy = (b.ny - a.ny) * frameH
    const maxStep = Math.max(prev.width, prev.height) * 0.10
    return {
        ...prev,
        x: Math.max(0, Math.min(frameW - prev.width, prev.x + Math.max(-maxStep, Math.min(maxStep, dx)))),
        y: Math.max(0, Math.min(frameH - prev.height, prev.y + Math.max(-maxStep, Math.min(maxStep, dy)))),
        landmarks: [],
        isFallback: false,
    }
}

function isImplausibleFaceJump(candidate: WorkingFaceBox, prev: WorkingFaceBox, frameW: number, frameH: number): boolean {
    const c = faceBoxCenter(candidate)
    const p = faceBoxCenter(prev)
    const dist = Math.hypot(c.x - p.x, c.y - p.y)
    const ref = Math.max(prev.width, prev.height, 1)
    const jump = dist / ref
    const iou = faceBoxIoU(candidate, prev)
    const areaRatio = (candidate.width * candidate.height) / Math.max(1, prev.width * prev.height)
    const aspect = candidate.width / Math.max(1, candidate.height)
    const frameAreaRatio = (candidate.width * candidate.height) / Math.max(1, frameW * frameH)
    if (aspect < 0.42 || aspect > 1.38 || frameAreaRatio < 0.035 || frameAreaRatio > 0.62) {
        return true
    }
    if (jump > 0.52 && iou < 0.18) {
        return true
    }
    if (jump > 0.34 && iou < 0.28 && (areaRatio < 0.62 || areaRatio > 1.62)) {
        return true
    }
    return false
}

interface AuthGatewayProps {
    onAuthenticated: (session: Session) => void;
}

interface ContactOtpState {
    emailSent: boolean; emailVerified: boolean; emailCode: string; emailError: string;
    emailAttempts: number; sendingEmail: boolean; verifyingEmail: boolean;
    smsSent: boolean; smsVerified: boolean; smsCode: string; smsError: string;
    smsAttempts: number; sendingSms: boolean; verifyingSms: boolean;
}

const INITIAL_CONTACT_OTP_STATE: ContactOtpState = {
    emailSent: false, emailVerified: false, emailCode: '', emailError: '',
    emailAttempts: 0, sendingEmail: false, verifyingEmail: false,
    smsSent: false, smsVerified: false, smsCode: '', smsError: '',
    smsAttempts: 0, sendingSms: false, verifyingSms: false,
}
/** Intentos fallidos de verificación permitidos por canal antes de reactivar
 * el campo para que el usuario corrija el dato (espeja MAX_VERIFY_FAILS en
 * contact_otp_routes.cpp, aunque el backend ya bloquea por su cuenta). */
const CONTACT_OTP_MAX_ATTEMPTS = 3

/** Panel de validación de contacto pre-registro (ADR-161): una fila por canal
 * (email y/o sms), cada una con su propio botón de envío/reenvío y, tras
 * enviar, un input de 6 dígitos + botón de verificación. Definido fuera de
 * `AuthGateway` para no recrearse en cada render. */
function ContactOtpPanel({
    channels,
    contactOtp,
    onSend,
    onVerify,
    onCodeChange,
}: {
    channels: Array<'email' | 'sms'>
    contactOtp: ContactOtpState
    onSend: (channel: 'email' | 'sms') => void
    onVerify: (channel: 'email' | 'sms') => void
    onCodeChange: (channel: 'email' | 'sms', value: string) => void
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '0.25rem 0 0.5rem' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Validar contacto (requerido)
            </span>
            {channels.map((channel) => {
                const isEmail = channel === 'email'
                const sent = isEmail ? contactOtp.emailSent : contactOtp.smsSent
                const verified = isEmail ? contactOtp.emailVerified : contactOtp.smsVerified
                const code = isEmail ? contactOtp.emailCode : contactOtp.smsCode
                const error = isEmail ? contactOtp.emailError : contactOtp.smsError
                const sending = isEmail ? contactOtp.sendingEmail : contactOtp.sendingSms
                const verifying = isEmail ? contactOtp.verifyingEmail : contactOtp.verifyingSms
                const Icon = isEmail ? Mail : Smartphone
                const label = isEmail ? 'Correo' : 'Celular'
                return (
                    <div key={channel} style={{
                        display: 'flex', flexDirection: 'column', gap: '0.4rem',
                        padding: '0.6rem 0.75rem', borderRadius: 10,
                        border: '1px solid rgba(148, 163, 184, 0.2)',
                        background: verified ? 'rgba(16, 185, 129, 0.08)' : 'rgba(15, 23, 42, 0.35)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#cbd5e1', fontWeight: 600 }}>
                                <Icon size={14} /> {label}
                            </span>
                            {verified ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#34d399', fontSize: '0.75rem', fontWeight: 700 }}>
                                    <CheckCircle2 size={14} /> Validado
                                </span>
                            ) : !sent ? (
                                <button
                                    type="button"
                                    onClick={() => onSend(channel)}
                                    disabled={sending}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.3rem',
                                        padding: '0.35rem 0.7rem', borderRadius: 8, cursor: sending ? 'default' : 'pointer',
                                        background: '#f07e41', color: '#0f172a', fontWeight: 700, fontSize: '0.72rem',
                                        border: 'none', opacity: sending ? 0.6 : 1,
                                    }}
                                >
                                    <Send size={12} /> {sending ? 'Enviando…' : `Validar ${label}`}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => onSend(channel)}
                                    disabled={sending}
                                    title="Reenviar código"
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.3rem',
                                        padding: '0.3rem 0.6rem', borderRadius: 8, cursor: sending ? 'default' : 'pointer',
                                        background: 'transparent', color: '#94a3b8', fontSize: '0.68rem', fontWeight: 600,
                                        border: '1px solid rgba(148, 163, 184, 0.3)', opacity: sending ? 0.6 : 1,
                                    }}
                                >
                                    <RefreshCw size={11} /> Reenviar
                                </button>
                            )}
                        </div>

                        {sent && !verified && (
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                <Lock size={12} style={{ color: '#64748b', flexShrink: 0 }} />
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    value={code}
                                    onChange={(e) => onCodeChange(channel, e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    onKeyDown={(e) => { if (e.key === 'Enter') onVerify(channel) }}
                                    placeholder="000000"
                                    style={{
                                        flex: 1, fontSize: '1rem', letterSpacing: '0.35em', textAlign: 'center',
                                        padding: '0.4rem', borderRadius: 6, border: '1px solid rgba(148, 163, 184, 0.35)',
                                        background: '#020617', color: '#e2e8f0',
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => onVerify(channel)}
                                    disabled={verifying || code.length !== 6}
                                    style={{
                                        padding: '0.4rem 0.7rem', borderRadius: 8, cursor: 'pointer',
                                        background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: '0.72rem',
                                        border: 'none', opacity: (verifying || code.length !== 6) ? 0.5 : 1, flexShrink: 0,
                                    }}
                                >
                                    {verifying ? '…' : 'Verificar'}
                                </button>
                            </div>
                        )}

                        {error && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#fca5a5', fontSize: '0.68rem' }}>
                                <AlertTriangle size={11} /> {error}
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

const AuthGateway = ({ onAuthenticated }: AuthGatewayProps) => {
    const { t, language, countryIso2: country, localizeMessage } = useI18n()
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
    /** Escaneo del QR del fotocheck (precarga de formulario, ver
     * FotocheckQrScanCapture.tsx) -- 'register' o 'login' según qué botón lo
     * abrió, para saber en qué formulario volcar los campos leídos. */
    const [showFotocheckScan, setShowFotocheckScan] = useState<'register' | 'login' | null>(null)

    /** Validación 2FA de contacto pre-registro (ADR-161): antes de habilitar
     * el paso biométrico facial, se confirma que el email y el celular
     * ingresados le pertenecen al usuario, enviando un OTP de 6 dígitos por
     * cada canal. `sent && !verified` bloquea el campo de contacto mientras
     * se espera el código; al 3er intento fallido el backend devuelve
     * `invalid_data`, lo que reactiva el campo para corregir el dato. */
    const [contactOtp, setContactOtp] = useState<ContactOtpState>(INITIAL_CONTACT_OTP_STATE)

    const handleDniScanSuccess = (result: DniScanResult) => {
        setShowDniScan(false)
        setRegisterForm((prev) => ({
            ...prev,
            dni: result.dni || prev.dni,
            firstName: result.first_name || prev.firstName,
            lastName: result.last_name || prev.lastName,
        }))
    }

    /** Precarga de campos desde el QR del fotocheck -- NUNCA toca password ni
     * dispara login/registro por sí solo, solo ahorra tecleo (ver
     * fotocheck_crypto.hpp: el QR viene cifrado, esto solo refleja lo que el
     * backend ya descifró y validó). */
    const handleFotocheckScanSuccess = (fields: Record<string, string>) => {
        const target = showFotocheckScan
        setShowFotocheckScan(null)
        if (target === 'login') {
            setLoginForm((prev) => ({
                ...prev,
                company: fields.company || prev.company,
                username: fields.username || prev.username,
            }))
            return
        }
        setRegisterForm((prev) => ({
            ...prev,
            company: fields.company || prev.company,
            dni: fields.dni || prev.dni,
            firstName: fields.first_name || prev.firstName,
            lastName: fields.last_name || prev.lastName,
            email: fields.email || prev.email,
            mobile: fields.mobile || prev.mobile,
            phone: fields.phone || prev.phone,
            username: fields.username || prev.username,
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
    const prevMouthClosedLandmarkRef = useRef<boolean | null>(null)
    const lastSyncRef = useRef(0)
    const syncingRef = useRef(false)
    /** Último disparo "fuera de turno" (bypass de VERIFY_SYNC_MS) por giro
     * rápido detectado localmente -- ver bboxMotionHistRef / detección de
     * giro más abajo. Cooldown propio para no saturar al backend si el
     * usuario mueve la cabeza de forma sostenida. */
    const lastTurnBurstAtRef = useRef(0)
    const smoothedFaceRef = useRef<WorkingFaceBox | null>(null)
    const lastVerifyOkRef = useRef(false)
    const lastIcaoFourRef = useRef<IcaoFour>({
        eyes: false,
        mouth: false,
        frontal: false,
        noGlasses: false,
    })
    /** Último `reset_reason` ya mostrado al usuario (ver biometric_routes.cpp
     * ADR 2026-09-08): evita repetir el mismo `setError` en cada ciclo de
     * polling (~175-300ms) mientras la condición persiste -- solo se vuelve a
     * mostrar si el motivo cambia o si el servidor deja de reportarlo. */
    const lastShownResetReasonRef = useRef('')
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
    /**
     * Guía por voz de los retos (pedido explícito del usuario 2026-09-07):
     * "indicaciones... entendibles tanto visualmente como con el audio".
     * Silenciable (persiste en localStorage) para kioscos/espacios
     * compartidos donde el audio no es deseable -- la guía visual (flechas,
     * texto, cuenta regresiva) sigue funcionando igual estando en mute.
     */
    const [voiceGuideMuted, setVoiceGuideMuted] = useState<boolean>(() => {
        try {
            return window.localStorage.getItem('beemetry_biometric_voice_muted') === '1'
        } catch {
            return false
        }
    })
    const toggleVoiceGuideMuted = useCallback(() => {
        setVoiceGuideMuted((prev) => {
            const next = !prev
            try {
                window.localStorage.setItem('beemetry_biometric_voice_muted', next ? '1' : '0')
            } catch {
                // Best-effort -- si localStorage no está disponible, el toggle
                // sigue funcionando en memoria para esta sesión.
            }
            if (next) stopSpeaking()
            return next
        })
    }, [])
    /** Último {tipo, intento, estado} anunciado por voz -- evita repetir la
     * misma locución en cada re-render mientras el estado no cambió (el
     * polling de /api/status llega cada ~175ms). */
    const lastAnnouncedChallengeRef = useRef<{ type: string | null; attempt: number; status: string }>({
        type: null,
        attempt: 0,
        status: '',
    })
    useEffect(() => {
        if (!ACTIVE_CHALLENGE_ENABLED || voiceGuideMuted) return
        const chType = currentChallenge(challengeUiState)
        const status = challengeUiState.status
        const attempt = challengeUiState.attempt
        const last = lastAnnouncedChallengeRef.current
        if (last.type === chType && last.attempt === attempt && last.status === status) {
            return
        }
        lastAnnouncedChallengeRef.current = { type: chType, attempt, status }
        if (status === 'success') {
            playChallengeSuccessTone()
            speak(t('liveness.challenge.success'), language)
        } else if (status === 'timeout') {
            playChallengeRetryTone()
            speak(t('liveness.challenge.retry'), language)
        } else if (status === 'pending' && chType) {
            playChallengeArmedTone()
            speak(t(challengeInstructionKey(chType)), language)
        }
    }, [challengeUiState, language, t, voiceGuideMuted])
    // Al desmontar (o al abandonar la pantalla de auth) no debe quedar una
    // locución en curso hablando sola en segundo plano.
    useEffect(() => {
        return () => stopSpeaking()
    }, [])
    /**
     * true en cuanto el servidor sortea el primer desafío activo, es decir en
     * cuanto la captura entra en la ETAPA 2. Cierra la ventana de captura del
     * candidato de avatar: la fuente del avatar sale exclusivamente de la
     * etapa 1 (las 5 lecturas ICAO consecutivas), nunca de la etapa 2.
     *
     * Por qué (pedido explícito del usuario, 2026-09-04, ADR-158): en la
     * etapa 2 la persona está EN MOVIMIENTO por definición -- los gestos son
     * turn_left/turn_right/move_closer/move_away (ADR-146). Ahí no se puede
     * garantizar ninguna de las condiciones que hacen buena a una foto de
     * avatar: frontalidad, centrado, distancia y encuadre. `move_closer`
     * termina literalmente con la persona pegada a la cámara -- ese es el
     * primer plano descentrado que produjo el incidente de calidad.
     *
     * Vuelve a false solo si el servidor reinicia toda la captura a la etapa
     * 1 (retos agotados, ver `exhausted`): ahí se abre una etapa 1 nueva y
     * legítima.
     */
    const challengeStartedRef = useRef(false)
    /** Último {index, attempt, type} reflejado del servidor -- para distinguir
     * "avanzó de desafío" vs "se agotó el intento actual" vs "sin cambios"
     * entre dos respuestas de /api/status. */
    const lastSyncedChallengeRef = useRef<{ index: number; attempt: number; type: string | null }>({
        index: -1,
        attempt: 1,
        type: null,
    })
    /** Mientras estamos mostrando el flash de éxito/timeout (ver abajo), no
     * pisarlo con la siguiente respuesta del servidor (llega cada ~175ms,
     * mucho más rápido que la duración del flash). */
    const challengeFlashUntilRef = useRef(0)

    /**
     * ADR-142: el servidor (handleProcessFrame + evaluateLivenessChallenge en
     * biometric_routes.cpp/biometric_types.cpp) es quien sortea la cola de 2
     * desafíos y decide si cada uno se cumplió (parpadeo/boca por flanco
     * cerrado->abierto visto por MediaPipe, giro por head_yaw_ratio) -- el
     * cliente ya NO decide nada, sólo refleja `status.challenge` (GET
     * /api/status) para la UI y para challengesPassedRef. Esto es justamente
     * lo que cierra el hueco de fraude: antes un cliente scripteado podía
     * fingir "ya parpadeé" sin que nadie hubiera visto un parpadeo real.
     */
    const syncChallengeFromServer = (challenge: unknown) => {
        if (!ACTIVE_CHALLENGE_ENABLED) return
        const c = (challenge && typeof challenge === 'object' ? challenge : {}) as Record<string, unknown>
        const queue = Array.isArray(c.queue)
            ? (c.queue.filter(
                  (t): t is LivenessChallengeType =>
                      t === 'turn_left' ||
                      t === 'turn_right' ||
                      t === 'shift_left' ||
                      t === 'shift_right' ||
                      t === 'move_closer' ||
                      t === 'move_away'
              ) as LivenessChallengeType[])
            : []
        const complete = Boolean(c.complete)
        const index = Number(c.index ?? 0)
        const attempt = Number(c.attempt ?? 1)
        const maxAttempts = Number(c.max_attempts ?? CHALLENGE_MAX_ATTEMPTS) || CHALLENGE_MAX_ATTEMPTS
        const deadlineMsRemaining = Number(c.deadline_ms_remaining ?? 0)

        if (complete) {
            challengesPassedRef.current = true
            // La etapa 2 existió y terminó: la ventana de captura del avatar
            // quedó cerrada desde que se sorteó el primer reto.
            challengeStartedRef.current = true
            const finalQueue = queue.length ? queue : livenessChallengeRef.current.queue
            lastSyncedChallengeRef.current = { index: finalQueue.length, attempt: 1, type: null }
            livenessChallengeRef.current = {
                queue: finalQueue,
                index: finalQueue.length,
                status: 'success',
                deadlineAt: null,
                attempt: 1,
                maxAttempts,
            }
            setChallengeUiState(livenessChallengeRef.current)
            return
        }

        if (queue.length === 0) {
            // ADR-156: cola vacía puede ser una de dos cosas. (a) El servidor
            // todavía no cruzó su gate de lecturas ICAO y no sorteó nada aún
            // -- no hay nada que reflejar. (b) Se agotaron los
            // CHALLENGE_MAX_ATTEMPTS retos y el servidor devolvió TODA la
            // captura a la etapa 1, limpiando el desafío: ahí hay que limpiar
            // también el estado local, o el cartel del último reto se queda
            // pegado en pantalla mientras la persona rehace la lectura ICAO,
            // pidiéndole un gesto que el servidor ya no está evaluando.
            if (livenessChallengeRef.current.queue.length > 0) {
                livenessChallengeRef.current = createInitialChallengeState()
                setChallengeUiState(livenessChallengeRef.current)
                challengesPassedRef.current = !ACTIVE_CHALLENGE_ENABLED
                // El servidor devolvió la captura a la etapa 1 (contador ICAO
                // a 0/5): se abre una etapa 1 nueva, así que vuelve a
                // permitirse capturar el candidato de avatar.
                challengeStartedRef.current = false
                lastSyncedChallengeRef.current = { index: -1, attempt: 1, type: null }
                challengeFlashUntilRef.current = 0
            }
            return
        }

        const currentType = queue[index] ?? null
        const last = lastSyncedChallengeRef.current
        const indexAdvanced = last.index >= 0 && index > last.index
        // ADR-156: cada intento nuevo trae un tipo de reto DISTINTO al que
        // acaba de vencer, así que ya no se puede exigir
        // `last.type === currentType` para reconocer un reintento -- alcanza
        // con que suba el número de intento.
        const retriedWithNewChallenge =
            !indexAdvanced && last.index === index && attempt > last.attempt
        // El servidor agotó los CHALLENGE_MAX_ATTEMPTS retos y devolvió TODA
        // la captura a la etapa 1 (contador ICAO a 0/5, ver `exhausted` en
        // handleProcessFrame): vuelve a sortear desde el intento 1. Hay que
        // reflejarlo, o el flash de timeout anterior quedaría pegado encima
        // de un reto que ya no es el que el servidor está pidiendo, y
        // challengesPassedRef seguiría con el valor de la ronda vieja.
        const serverRestarted = last.index >= 0 && (index < last.index || attempt < last.attempt)
        lastSyncedChallengeRef.current = { index, attempt, type: currentType }
        // Hay cola sorteada: la captura está en la ETAPA 2 (persona en
        // movimiento). Desde aquí ya no se admiten candidatos de avatar; el
        // que se haya guardado en la etapa 1 es el que se usa.
        challengeStartedRef.current = true
        if (serverRestarted) {
            challengesPassedRef.current = !ACTIVE_CHALLENGE_ENABLED
            challengeStartedRef.current = false
            challengeFlashUntilRef.current = 0
        }

        const applyPending = () => {
            livenessChallengeRef.current = {
                queue,
                index,
                status: 'pending',
                deadlineAt: deadlineMsRemaining > 0 ? performance.now() + deadlineMsRemaining : null,
                attempt,
                maxAttempts,
            }
            setChallengeUiState(livenessChallengeRef.current)
        }

        if (indexAdvanced) {
            // Confirmación visual breve antes de mostrar el siguiente desafío
            // -- mismo timing que antes (700ms), ahora disparado por el índice
            // que ya avanzó en el servidor en vez de una detección local.
            challengeFlashUntilRef.current = performance.now() + 700
            livenessChallengeRef.current = { queue, index: index - 1, status: 'success', deadlineAt: null, attempt: 1, maxAttempts }
            setChallengeUiState(livenessChallengeRef.current)
            window.setTimeout(applyPending, 700)
            return
        }
        if (retriedWithNewChallenge) {
            // El servidor agotó la ventana del intento actual y sorteó OTRO
            // reto distinto (ADR-156) -- mismo flash de timeout de 1200ms que
            // antes, ahora antes de mostrar la instrucción nueva.
            challengeFlashUntilRef.current = performance.now() + 1200
            livenessChallengeRef.current = { queue, index, status: 'timeout', deadlineAt: null, attempt, maxAttempts }
            setChallengeUiState(livenessChallengeRef.current)
            window.setTimeout(applyPending, 1200)
            return
        }
        if (performance.now() < challengeFlashUntilRef.current) {
            // Ya se está mostrando un flash de éxito/timeout -- no lo cortes
            // a mitad de camino con la siguiente respuesta del servidor.
            return
        }
        applyPending()
    }

    const prevEyesOpenLandmarkRef = useRef<boolean | null>(null)
    const blinkCloseStartedAtRef = useRef<number | null>(null)
    const mouthWasOpenPhaseRef = useRef(false)
    const livenessScoreRef = useRef(0)
    const livenessFallbackRef = useRef(0)
    /** Micro-movimiento del bbox (FaceDetector sin landmarks o parpadeo no detectado). */
    const bboxMotionHistRef = useRef<{ nx: number; ny: number; nw: number; nh: number }[]>([])
    const motionLivenessPtsRef = useRef(0)
    const lastMotionLivenessBoostAtRef = useRef(0)
    const eyesBlinkHystRef = useRef(true)
    const lastServerLivenessRef = useRef(0)
    const lastAutoTriggerRef = useRef(0)
    const cameraRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const cameraStageRef = useRef<HTMLDivElement | null>(null)
    const faceBoxHistoryRef = useRef<WorkingFaceBox[]>([])
    const pendingFaceJumpRef = useRef<WorkingFaceBox | null>(null)
    const pendingFaceJumpCountRef = useRef(0)
    /** Canvas de trabajo local (tracking + JPEG de /api/process_frame) -- su
     * tamaño ya NO es fijo, ver adaptiveEncodeRef/lastSentFrameSizeRef. */
    const processFrameCanvasRef = useRef<HTMLCanvasElement | null>(null)
    /** Resolución de ENVÍO adaptativa (pedido explícito del usuario
     * 2026-09-07): arranca en la resolución NATIVA de la cámara y sólo baja
     * si /api/process_frame da señales de problema de procesamiento (ver
     * adaptiveEncodeResolution.ts). Vive en un ref porque cambia frame a
     * frame según latencia real, no según un render de React. */
    const adaptiveEncodeRef = useRef(new AdaptiveEncodeResolution())
    /** Tamaño REAL del último frame efectivamente enviado a
     * /api/process_frame -- reemplaza el supuesto fijo de 960×720 al
     * interpretar `face_oval` del servidor (ver ovalForStage más abajo): con
     * resolución de envío adaptativa, ese tamaño ya no es una constante. */
    const lastSentFrameSizeRef = useRef({
        width: FACIAL_ICAO.CAMERA.width.ideal,
        height: FACIAL_ICAO.CAMERA.height.ideal,
    })
    const fastTrackInFlightRef = useRef(false)
    const lastFastTrackAtRef = useRef(0)
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
    /**
     * Corrección 2026-09-09: la pestaña/app puede pasar a segundo plano
     * (cambio de app, bloqueo de pantalla, minimizar navegador) en medio de
     * una captura biométrica. Los `setInterval` que descuentan el contador
     * de 120s se throttlean mientras la página está oculta, pero siguen
     * calculando el tiempo transcurrido con `Date.now()` real -- al volver a
     * la pestaña, el primer tick ve `elapsed > 120000ms` y dispara un reset
     * inmediato con el mensaje de timeout, aunque no hubiera ninguna
     * petición en curso (ver [CLIENT_INCIDENT] register_user_capture_reset_unexpected
     * con visibility="hidden", registrationApiInFlight=false, isProcessing=false).
     * Para el usuario esto se ve como que el widget "se cuelga" (última
     * muestra pintada antes de ocultarse la pestaña) y después falla sin
     * explicación. Se trata igual que `isProcessing`: congela el reloj de
     * sesión mientras `document.hidden` es true.
     */
    const [pageHidden, setPageHidden] = useState<boolean>(
        typeof document !== 'undefined' ? document.hidden : false
    )
    useEffect(() => {
        if (typeof document === 'undefined') {
            return
        }
        const onVisibilityChange = () => setPageHidden(document.hidden)
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }, [])

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
        captureResetReasonRef.current = errorMessage
            ? 'end_session_with_error'
            : 'end_session_no_error'
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

    // Watchdog de diagnóstico (hallazgo real 2026-09-04): varios reportes de
    // "la captura biométrica se cerró sola" (registro y login) no dejaban
    // NINGÚN rastro en `docker logs` -- se rastreó la causa a que
    // logger.ts (log.info/warn) SOLO imprime en la consola del navegador,
    // gateada a DEV/VITE_DEBUG, y nunca llega al servidor. En vez de asumir
    // "el fallo es puramente del cliente" cada vez que no aparece nada en
    // el backend, este watchdog reporta con reportClientIncident() (ver
    // authApi.ts) el momento EXACTO en que la captura vuelve a 'form' SIN
    // que haya sido un registro/login exitoso (que además cambia `mode` a
    // 'login'/muestra "Ingreso autorizado" en el mismo tick, así que ese
    // caso legítimo queda excluido solo). Cubre CUALQUIER camino que
    // provoque el reset -- timeout de sesión, el efecto de cambio de modo/
    // pestaña, o algo todavía no identificado -- sin tener que instrumentar
    // cada callsite por separado.
    /** ADR-156: por qué volvió la captura a 'form'. El watchdog de abajo ya
     * reportaba el MOMENTO del reset, pero no el CAMINO -- y los dos cierres
     * silenciosos vistos en vivo (2026-09-04 21:41:50 / 21:42:07, `error:""`)
     * no se pueden atribuir a ninguna ruta concreta sin esto: el timeout de
     * sesión siempre deja mensaje, así que fue otra. Se marca en cada sitio
     * que hace el reset y se adjunta al incidente. */
    const captureResetReasonRef = useRef<string>('unknown')
    /** Espejo de [mode, registerTab, loginTab] para poder decir CUÁL de los
     * tres cambió cuando el reset viene del efecto que depende de ellos. */
    const prevModeTabsRef = useRef({ mode, registerTab, loginTab })
    const prevRegisterUserStepRef = useRef(registerUserBiometricStep)
    useEffect(() => {
        const prev = prevRegisterUserStepRef.current
        if (prev === 'capture' && registerUserBiometricStep === 'form' && mode === 'register') {
            reportClientIncident('register_user_capture_reset_unexpected', {
                registerTab,
                elapsedMs: registerFaceSessionClockRef.current.start
                    ? Date.now() - registerFaceSessionClockRef.current.start
                    : null,
                captureCount: Number(faceGuide.captureCount || 0),
                qualityGateReached: Boolean(faceGuide.qualityGateReached),
                challengesPassed: challengesPassedRef.current,
                registrationApiInFlight: registrationApiInFlightRef.current,
                registerAutoSubmitTriggered: registerAutoSubmitTriggeredRef.current,
                isProcessing,
                error,
                message,
                dniLen: String(registerForm.dni || '').trim().length,
                company: String(registerForm.company || '').trim(),
                resetReason: captureResetReasonRef.current,
                cameraReady,
                visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
                modeTabs: `${mode}/${registerTab}/${loginTab}`,
            })
            captureResetReasonRef.current = 'unknown'
        }
        prevRegisterUserStepRef.current = registerUserBiometricStep
    }, [registerUserBiometricStep, mode])

    const prevRegisterCompanyStepRef = useRef(registerCompanyBiometricStep)
    useEffect(() => {
        const prev = prevRegisterCompanyStepRef.current
        if (prev === 'capture' && registerCompanyBiometricStep === 'form' && mode === 'register') {
            reportClientIncident('register_company_capture_reset_unexpected', {
                elapsedMs: registerFaceSessionClockRef.current.start
                    ? Date.now() - registerFaceSessionClockRef.current.start
                    : null,
                captureCount: Number(faceGuide.captureCount || 0),
                qualityGateReached: Boolean(faceGuide.qualityGateReached),
                challengesPassed: challengesPassedRef.current,
                isProcessing,
                error,
                message,
                company: String(registerForm.company || '').trim(),
            })
        }
        prevRegisterCompanyStepRef.current = registerCompanyBiometricStep
    }, [registerCompanyBiometricStep, mode])

    const prevLoginBiometricSessionRef = useRef(loginBiometricSession)
    useEffect(() => {
        const prev = prevLoginBiometricSessionRef.current
        const authorized = message.includes('Ingreso autorizado')
        if (prev === true && loginBiometricSession === false && mode === 'login' && !authorized) {
            reportClientIncident('login_face_session_reset_unexpected', {
                loginTab,
                captureCount: Number(faceGuide.captureCount || 0),
                qualityGateReached: Boolean(faceGuide.qualityGateReached),
                challengesPassed: challengesPassedRef.current,
                isProcessing,
                error,
                message,
                company: String(loginForm.company || '').trim(),
            })
        }
        prevLoginBiometricSessionRef.current = loginBiometricSession
    }, [loginBiometricSession, mode])

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
        // ADR-143: además de las N lecturas, el servidor exige parpadeo
        // natural observado antes de dar el gate de calidad por cruzado --
        // sin esto, el auto-login/registro podía dispararse apenas
        // captureCount llegaba al máximo aunque el parpadeo aún no se
        // hubiera visto, y el servidor lo iba a rechazar igual (rechazo que
        // el usuario vería como un intento fallido sin explicación).
        const hasReq = n >= FACIAL_ICAO.REQUIRED_VALID_FRAMES && Boolean(faceGuide.qualityGateReached)
        return {
            hasRequiredBiometricSamples: hasReq,
            loginBiometricGate:
                Boolean(faceGuide.qualityReady) ||
                (hasReq && Boolean(faceGuide.lastServerOk)),
        }
    }, [faceGuide.qualityReady, faceGuide.captureCount, faceGuide.lastServerOk, faceGuide.qualityGateReached])
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

        // ADR-162: el óvalo VISIBLE es siempre el tracking local (MediaPipe en
        // el navegador, sub-frame, sin round-trip) mientras haya `liveFaceBox`.
        // Antes se le daba prioridad al óvalo que manda /api/process_frame
        // cuando venía de `opencv_realtime_tracker` (Haar cascade en el
        // backend) -- esa rama es justamente la que atava el borde visible a
        // la cadencia de red (VERIFY_SYNC_MS) pese a que el tracking local ya
        // era más rápido y preciso. El óvalo de servidor queda solo como
        // último recurso, abajo, para cuando no hay tracking local en
        // absoluto (arranque, WASM aún cargando sin fallback de piel activo).
        const layout = computeBiometricOvalLayout(liveFaceBox, fw, fh)
        if (!layout) {
            const serverSourceW = Math.max(
                1,
                Number(
                    so?.source_w ||
                        lastSentFrameSizeRef.current.width ||
                        fw ||
                        FACIAL_ICAO.CAMERA.width.ideal ||
                        640
                )
            )
            const serverSourceH = Math.max(
                1,
                Number(
                    so?.source_h ||
                        lastSentFrameSizeRef.current.height ||
                        fh ||
                        FACIAL_ICAO.CAMERA.height.ideal ||
                        480
                )
            )
            if (
                so &&
                Number.isFinite(Number(so.cx)) &&
                Number.isFinite(Number(so.cy)) &&
                Number.isFinite(Number(so.w)) &&
                Number.isFinite(Number(so.h))
            ) {
                return mapOvalLayoutVideoToStage(
                    {
                        leftPct: (Number(so.cx) / serverSourceW) * 100,
                        topPct: (Number(so.cy) / serverSourceH) * 100,
                        wPct: (Number(so.w) / serverSourceW) * 100,
                        hPct: (Number(so.h) / serverSourceH) * 100,
                        transform: `translate(-50%, -50%) rotate(${Number(so.angle_deg || 0)}deg)`,
                    },
                    serverSourceW,
                    serverSourceH,
                    sw,
                    sh
                )
            }
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
            const video = videoRef.current
            if (!video) {
                return
            }
            try {
                // Prueba una escalera de resoluciones de mayor a menor y
                // verifica en cada escalón que realmente llegue un frame
                // decodificado (no solo que getUserMedia resuelva la
                // Promise) -- ver adaptiveCameraCapture.ts para el hallazgo
                // real 2026-09-04 que motivó esto: a una única resolución
                // "ideal" fija de 1280x960, ciertos drivers UVC/Windows
                // Media Foundation concedían el permiso y "resolvían" pero
                // nunca pintaban un frame real, dejando la UI en "Activa"
                // con el video en negro hasta el timeout de sesión.
                const stream = await acquireFaceCameraStream(video, () => cancelled)

                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }

                streamRef.current = stream
                setCameraReady(true)
                setError('')
                video.onloadedmetadata = () => {
                    video.play().catch((e) =>
                        log.warn('Reproducción automática:', e)
                    )
                }
            } catch (err: any) {
                if (cancelled) {
                    // acquireFaceCameraStream lanza AbortError cuando este
                    // mismo efecto ya se canceló mientras negociaba la
                    // cámara (re-disparo/desmontaje) -- no es un error real
                    // de cámara, así que no debe pisar el estado con
                    // setError/setCameraReady de una ejecución obsoleta.
                    return
                }
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
        challengeStartedRef.current = false
        lastSyncedChallengeRef.current = { index: -1, attempt: 1, type: null }
        challengeFlashUntilRef.current = 0
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
        // ADR-156: este efecto depende de [mode, registerTab, loginTab] y
        // resetea la captura SIN mensaje de error -- candidato principal a los
        // cierres silenciosos. Deja constancia de cuál de los tres cambió.
        {
            const prevTabs = prevModeTabsRef.current
            const changed = [
                prevTabs.mode !== mode ? `mode:${prevTabs.mode}->${mode}` : '',
                prevTabs.registerTab !== registerTab ? `registerTab:${prevTabs.registerTab}->${registerTab}` : '',
                prevTabs.loginTab !== loginTab ? `loginTab:${prevTabs.loginTab}->${loginTab}` : '',
            ].filter(Boolean).join(',')
            captureResetReasonRef.current = `mode_tab_effect(${changed || 'mount_or_no_change'})`
            prevModeTabsRef.current = { mode, registerTab, loginTab }
        }
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
        const shouldPause = isProcessing || pageHidden
        if (mode === 'login' && loginBiometricSession) {
            const c = sessionClockRef.current
            if (shouldPause) {
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
            if (shouldPause) {
                if (!r.pauseSince) {
                    r.pauseSince = Date.now()
                }
            } else if (r.pauseSince) {
                r.pausedMs += Date.now() - r.pauseSince
                r.pauseSince = null
            }
        }
    }, [isProcessing, pageHidden, mode, loginBiometricSession, anyRegisterCaptureView])

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

                // Resolución de trabajo ADAPTATIVA (pedido explícito del
                // usuario 2026-09-07): ya no un 960×720 fijo -- se deriva de
                // la resolución NATIVA real del video (preservando su
                // aspecto siempre), recortada sólo si adaptiveEncodeRef bajó
                // de escalón por problemas de procesamiento reales. Mismo
                // tamaño se usa más abajo para el frame que se manda a
                // /api/process_frame, así ambos quedan siempre en la MISMA
                // grilla de coordenadas.
                const { width: pw, height: ph } = adaptiveEncodeRef.current.targetSize(
                    video.videoWidth,
                    video.videoHeight
                )

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
                // Recorte "cover" en vez de estirar (hallazgo real 2026-09-07,
                // ver drawVideoCoverCropped): con una cámara nativamente 16:9
                // estirar a 4:3 deformaba el frame que ve el FaceDetector
                // local/heurístico de respaldo, produciendo un bbox de rostro
                // con aspecto distorsionado -- óvalo de guía "más circular" o
                // achatado, sin relación con la forma real del rostro.
                drawVideoCoverCropped(pCtx, video, pw, ph)

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

                // ADR-162: tracking local vía MediaPipe Tasks Vision (WASM) en vez de
                // `window.FaceDetector` (Shape Detection API nativa de Chromium, serializaba
                // el bitmap completo por IPC a un proceso aparte en cada llamada -- causa real
                // de la lentitud reportada). Carga perezosa no bloqueante; mientras no esté
                // lista cae al fallback heurístico de piel de abajo, igual que antes.
                ensureFaceLandmarkerLoading()
                const landmarker = getFaceLandmarker()
                let hasMeshDetector = false
                if (landmarker.instance) {
                    hasMeshDetector = true
                    const result = landmarker.instance.detectForVideo(pCanvas, timestamp)
                    const faceLandmarks = result.faceLandmarks?.[0]
                    if (faceLandmarks && faceLandmarks.length > 0) {
                        missedDetectorFramesRef.current = 0
                        bestFace = landmarksToFaceBox(faceLandmarks, pw, ph)
                    } else {
                        missedDetectorFramesRef.current += 1
                    }
                }

                if (!bestFace && !hasMeshDetector) {
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

                if (bestFace && smoothedFaceRef.current && !bestFace.isFallback) {
                    const prev = smoothedFaceRef.current
                    if (isImplausibleFaceJump(bestFace, prev, pw, ph)) {
                        const pending = pendingFaceJumpRef.current
                        const repeated =
                            pending &&
                            faceBoxIoU(bestFace, pending) > 0.42 &&
                            faceCenterJumpRatio(bestFace, pending) < 0.22
                        pendingFaceJumpRef.current = bestFace
                        pendingFaceJumpCountRef.current = repeated
                            ? pendingFaceJumpCountRef.current + 1
                            : 1
                        if (pendingFaceJumpCountRef.current < 2) {
                            bestFace = predictFaceBox(prev, bboxMotionHistRef.current, pw, ph)
                        }
                    } else {
                        pendingFaceJumpRef.current = null
                        pendingFaceJumpCountRef.current = 0
                    }
                }

                if (!bestFace && smoothedFaceRef.current && missedDetectorFramesRef.current <= 3) {
                    bestFace = {
                        ...predictFaceBox(smoothedFaceRef.current, bboxMotionHistRef.current, pw, ph),
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
                    const rawEar = bestFace.ear
                    const rawEyeCenters = bestFace.eyeCenters
                    const rawMouthMarRatio = bestFace.mouthMarRatio
                    const rawOvalPoints = bestFace.ovalPoints
                    if (hist.length >= medianMin) {
                        const med = medianFaceBoundingBox(hist)
                        if (med) {
                            bestFace = {
                                ...med,
                                landmarks: rawLm,
                                isFallback: rawFb,
                                ear: rawEar,
                                eyeCenters: rawEyeCenters,
                                mouthMarRatio: rawMouthMarRatio,
                                ovalPoints: rawOvalPoints,
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
                        const ovalPoints =
                            bestFace.ovalPoints && prev.ovalPoints && prev.ovalPoints.length === bestFace.ovalPoints.length
                                ? bestFace.ovalPoints.map((p, i) => ({
                                      x: prev.ovalPoints![i].x + alpha * (p.x - prev.ovalPoints![i].x),
                                      y: prev.ovalPoints![i].y + alpha * (p.y - prev.ovalPoints![i].y),
                                  }))
                                : bestFace.ovalPoints
                        bestFace = {
                            x: prev.x + alpha * (bestFace.x - prev.x),
                            y: prev.y + alpha * (bestFace.y - prev.y),
                            width: prev.width + alpha * (bestFace.width - prev.width),
                            height: prev.height + alpha * (bestFace.height - prev.height),
                            landmarks: bestFace.landmarks,
                            isFallback: bestFace.isFallback,
                            ear: bestFace.ear,
                            eyeCenters: bestFace.eyeCenters,
                            mouthMarRatio: bestFace.mouthMarRatio,
                            ovalPoints,
                        }
                    }
                    smoothedFaceRef.current = bestFace
                    setLiveFaceBox(bestFace)

                    const aspect = bestFace.width / Math.max(1, bestFace.height)
                    const frontalByAspect =
                        aspect > FACIAL_ICAO.FRONTAL_ASPECT_MIN &&
                        aspect < FACIAL_ICAO.FRONTAL_ASPECT_MAX

                    // ADR-162: landmarks reales de MediaPipe (EAR de 6 puntos, mouth MAR) en
                    // vez de los puntos dispersos tipo {type,locations} de FaceDetector --
                    // disponibles en TODOS los navegadores, ya no solo Chrome desktop.
                    hasLandmarks = Boolean(bestFace.ear && bestFace.eyeCenters)
                    const eyeYRatio = FACIAL_ICAO.MAX_EYE_Y_DELTA_RATIO
                    const eyesAligned =
                        hasLandmarks && bestFace.eyeCenters
                            ? Math.abs(bestFace.eyeCenters.left.y - bestFace.eyeCenters.right.y) <
                              bestFace.height * eyeYRatio
                            : true

                    const mouthRatio = hasLandmarks && bestFace.mouthMarRatio != null ? bestFace.mouthMarRatio : 0.04

                    const earHint = FACIAL_ICAO.EAR_OPEN_HINT
                    eyesOpen =
                        hasLandmarks && bestFace.ear
                            ? bestFace.ear.left > earHint && bestFace.ear.right > earHint
                            : false
                    /** Histéresis sobre apertura mínima (evita que el ratio quede siempre “abierto” y no cuente parpadeos). */
                    let blinkGateOpen = eyesOpen
                    if (hasLandmarks && bestFace.ear) {
                        const eyeMin = Math.min(bestFace.ear.left, bestFace.ear.right)
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
                        nw: bestFace.width / vwM,
                        nh: bestFace.height / vhM,
                    })
                    while (mhist.length > 30) {
                        mhist.shift()
                    }
                    // Desplazamiento horizontal reciente del centro del faceBox (~470ms,
                    // 6 muestras a ritmo de este loop) -- señal LOCAL, disponible cada
                    // frame de tracking (no depende del viaje de ida y vuelta a
                    // /api/process_frame). Pedido explícito del usuario 2026-09-04: el
                    // giro izquierda/derecha se percibía lento porque el desafío solo se
                    // resuelve con el headYawRatio que llega en el próximo ciclo de
                    // VERIFY_SYNC_MS (175ms) MÁS el tiempo real de ida/vuelta con
                    // ai_engine -- este valor no decide nada por sí solo (el servidor
                    // sigue siendo la autoridad, ver ADR-142), solo se usa para adelantar
                    // el próximo envío cuando ya hay un giro claro en curso, en vez de
                    // esperar el próximo tick del throttle normal.
                    const fastTurnDx =
                        mhist.length >= 6
                            ? mhist[mhist.length - 1].nx - mhist[mhist.length - 6].nx
                            : 0
                    const fastScaleDz =
                        mhist.length >= 6
                            ? mhist[mhist.length - 1].nw - mhist[mhist.length - 6].nw
                            : 0
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
                    // Adelanta el envío (se salta el throttle normal de VERIFY_SYNC_MS)
                    // cuando el reto activo ya muestra movimiento local claro. El
                    // servidor sigue siendo autoridad; esto sólo manda el frame cerca
                    // del pico del gesto para que giro/desplazamiento/acercamiento no
                    // se sientan lentos ni imprecisos por esperar el próximo tick.
                    const activeChallengeType =
                        livenessChallengeRef.current.status === 'pending'
                            ? livenessChallengeRef.current.queue[
                                  livenessChallengeRef.current.index
                              ] ?? null
                            : null
                    const isTurnChallengeActive =
                        activeChallengeType === 'turn_left' || activeChallengeType === 'turn_right'
                    const isShiftChallengeActive =
                        activeChallengeType === 'shift_left' || activeChallengeType === 'shift_right'
                    const isMoveChallengeActive =
                        activeChallengeType === 'move_closer' || activeChallengeType === 'move_away'
                    const turnBurstReady =
                        isTurnChallengeActive &&
                        Math.abs(fastTurnDx) > 0.045 &&
                        nowSync - lastTurnBurstAtRef.current > 220
                    const shiftBurstReady =
                        isShiftChallengeActive &&
                        Math.abs(fastTurnDx) > 0.030 &&
                        nowSync - lastTurnBurstAtRef.current > 180
                    const moveBurstReady =
                        isMoveChallengeActive &&
                        Math.abs(fastScaleDz) > 0.020 &&
                        nowSync - lastTurnBurstAtRef.current > 180
                    // Hallazgo real 2026-09-10: el envío final (login/registro)
                    // hace un solo POST a /api/auth/login/face o
                    // /api/auth/register que dispara, del lado del ai_engine,
                    // un /face_embedding -- pero este loop de detección NUNCA
                    // se detiene mientras esa llamada está en vuelo, así que
                    // sigue mandando /api/process_frame cada VERIFY_SYNC_MS
                    // (175ms) contra el MISMO proceso ai_engine. Ese proceso
                    // serializa su trabajo pesado con locks globales
                    // (_mediapipe_lock/_lock, ver eye_analyzer.py/
                    // face_embedding_insight.py) -- la ráfaga continua de
                    // frames en vivo hacía cola por delante del embedding en
                    // curso y lo estiraba a 27-61s reales (visto en
                    // [AUTH_REGISTER] embedding_ai_engine_begin/end de los
                    // logs del backend), exactamente el "se quedó colgado en
                    // 5/5" reportado -- la captura ya había terminado, era el
                    // envío final el que esperaba detrás de su propio tráfico
                    // de fondo. Frenar el envío de frames mientras
                    // isProcessingRef/registrationApiInFlightRef estén en
                    // true deja a la llamada final sola contra ai_engine.
                    const finalSubmitInFlight =
                        isProcessingRef.current || registrationApiInFlightRef.current
                    if (
                        hasFaceNow &&
                        !syncingRef.current &&
                        !finalSubmitInFlight &&
                        (isFirstSync ||
                            nowSync - lastSyncRef.current > FACIAL_ICAO.VERIFY_SYNC_MS ||
                            turnBurstReady ||
                            shiftBurstReady ||
                            moveBurstReady)
                    ) {
                        syncingRef.current = true
                        lastSyncRef.current = nowSync
                        if (turnBurstReady || shiftBurstReady || moveBurstReady) {
                            lastTurnBurstAtRef.current = nowSync
                        }

                        // Motor (/api/process_frame): misma grilla adaptativa
                        // (pw×ph) que el canvas de tracking local de arriba --
                        // ya no un 960×720 fijo, ver adaptiveEncodeRef.
                        // Parpadeo/boca en cliente siguen usando landmarks del FaceDetector sobre el bbox.
                        const base64 = buildFullFrameJpegBase64FromVideo(
                            video,
                            pw,
                            ph,
                            FACIAL_ICAO.VERIFY_JPEG_QUALITY
                        )
                        lastSentFrameSizeRef.current = { width: pw, height: ph }
                        const roundTripStartedAt = performance.now()

                        // Hallazgo real 2026-09-07 ("la detección... tiene que
                        // ser rápida a tiempo real"): antes este ciclo hacía
                        // POST /api/process_frame Y LUEGO, encadenado, GET
                        // /api/status -- dos round-trips de red SECUENCIALES
                        // por cada frame. El backend ahora devuelve el mismo
                        // payload rico directamente en la respuesta de
                        // process_frame (ver buildBiometricStatusJson en
                        // biometric_routes.cpp), así que ya no hace falta el
                        // segundo pedido -- reduce a la mitad la latencia
                        // percibida de cada ciclo.
                        processBiometricFrame(base64)
                            .then((status) => {
                                syncingRef.current = false
                                adaptiveEncodeRef.current.reportRoundTrip(
                                    performance.now() - roundTripStartedAt,
                                    true
                                )
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
                                // ADR 2026-09-08: el servidor puede reiniciar la
                                // captura a la etapa 1 en cualquier momento (incluso
                                // tras completar ICAO + reto) si confirma lentes
                                // puestos con la histéresis lenta de ai_engine --
                                // antes esto no tenía ningún mensaje específico y se
                                // veía como "se colgó" en un reintento silencioso.
                                const resetReason = String(status?.reset_reason || '')
                                if (resetReason === 'glasses_detected') {
                                    if (lastShownResetReasonRef.current !== resetReason) {
                                        lastShownResetReasonRef.current = resetReason
                                        setError('Se detectaron lentes puestos. Retírelos para continuar con la captura.')
                                    }
                                } else {
                                    lastShownResetReasonRef.current = ''
                                }
                                syncChallengeFromServer(status?.challenge)
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
                                    // ADR-143: además de las 5 lecturas, exige parpadeo
                                    // natural observado -- evita que el auto-login/registro
                                    // dispare un intento que el servidor va a rechazar.
                                    qualityGateReached: Boolean(status?.quality_gate_reached),
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

                        // CAMBIO 2026-09-04 (ADR-158, pedido explícito del usuario): la
                        // fuente del avatar se elige EXCLUSIVAMENTE entre los frames de la
                        // ETAPA 1 -- los que forman las 5 lecturas ICAO consecutivas
                        // (`qualityReady`), donde las 4 condiciones (frontal, ojos, boca,
                        // sin lentes) + zona objetivo se cumplen al 100% frame a frame.
                        //
                        // Antes esta condición era `challengesPassedRef.current`, o sea lo
                        // OPUESTO: sólo se capturaba DESPUÉS de completar el desafío. Como
                        // un gesto rompe la frontalidad y resetea el contador a 0/5, los
                        // candidatos salían siempre de los 5 frames que la persona
                        // acumulaba mientras volvía a acomodarse tras el gesto -- y con
                        // `move_closer` eso significa literalmente la cara pegada a la
                        // cámara. Es la causa de los primeros planos descentrados que
                        // llegaban al pipeline de avatar (face_too_large h=0.81 en los logs
                        // reales de ai_engine).
                        //
                        // Esto NO debilita la prueba de vida: el desafío sigue siendo
                        // obligatorio para ENVIAR (challengesPassedRef gatea el auto-envío
                        // de login y el de registro, sin cambios). Lo único que cambia es
                        // de qué etapa sale el píxel del avatar.
                        //
                        // El comentario anterior de esta condición (no capturar en pleno
                        // gesto) sigue cumpliéndose, y de forma más fuerte: ahora ni
                        // siquiera se llega a la etapa del gesto con la ventana abierta.
                        // No capturar el candidato de avatar mientras el desafío activo de
                        // liveness (turn_left/turn_right/move_closer/move_away) sigue en
                        // curso -- pedido explícito del usuario 2026-09-04: el gate ICAO de
                        // "frontal" tolera hasta headYawRatio=0.42 (ver face_frontal_from_points
                        // en eye_analyzer.py) mientras que un giro ya cuenta como completado
                        // el desafío desde 0.20 (kLivenessHeadYawTurnThreshold) -- entre esos
                        // dos umbrales el frame sigue siendo "válido" para el contador de 5/5
                        // pero la cabeza ya está claramente girada, así que sin este gate se
                        // podía capturar un frame en pleno gesto como fuente del avatar.
                        // challengesPassedRef arranca en !ACTIVE_CHALLENGE_ENABLED (ver arriba),
                        // así que con los desafíos desactivados este gate no cambia nada.
                        if (updated.qualityReady && hasFaceNow && bestFace && !challengeStartedRef.current) {
                            const template = frameToTemplate(video, bestFace)
                            const imageBase64 = frameToJpegBase64(video, bestFace)
                            const portraitOvalBase64 = frameToOvalPortraitJpegBase64(
                                video,
                                bestFace
                            )
                            const bustRectBase64 = frameToBustRectAroundOvalJpegBase64(
                                video,
                                bestFace
                            )
                            const visualQuality = estimateAvatarFrameQuality(video, bestFace)
                            // Con la ventana de captura confinada a la etapa 1 (ADR-158),
                            // TODOS los candidatos ya cumplen lo mismo: 5/5 lecturas ICAO
                            // consecutivas (frontal + ojos + boca + sin lentes + dentro de
                            // la zona objetivo) y `lastVerifyOk` del servidor. Esos dos
                            // términos ya casi no discriminan -- son constantes entre
                            // candidatos -- así que el desempate real tiene que venir de la
                            // calidad visual (nitidez, exposición, tamaño de rostro,
                            // centrado y penalizaciones de encuadre, ver
                            // estimateAvatarFrameQuality). De ahí el peso x2: es
                            // exactamente el criterio que decide cuál de los frames buenos
                            // se convierte en el avatar.
                            const candidateScore =
                                Number(lv || 0) +
                                (lastVerifyOkRef.current ? 35 : 0) +
                                Number(validFramesRef.current || 0) * 10 +
                                visualQuality * 2
                            const prevBest = bestLoginProbeRef.current
                            if (!prevBest || candidateScore > prevBest.score) {
                                bestLoginProbeRef.current = {
                                    template,
                                    imageBase64,
                                    portraitOvalBase64,
                                    bustRectBase64,
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
            // Ver comentario en startRegisterUserFaceCapture (hallazgo real
            // 2026-09-04): esperar el reset antes de abrir la cámara evita la
            // carrera con una sesión de captura previa completa en la misma
            // pestaña.
            await resetBiometricCapture().catch(() => {})
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
            // Hallazgo real 2026-09-04: a diferencia del registro
            // (releaseRegisterAutoTrigger, ver handleCaptureForRegistration),
            // acá el trigger se liberaba SIEMPRE, sin importar el motivo del
            // rechazo -- un rechazo DETERMINÍSTICO del servidor (ej. "Se
            // detectaron lentes/gafas puestos", la plantilla guardada no
            // tiene lentes y no va a coincidir mientras la persona no se los
            // quite) reintentaba cada
            // FACIAL_ICAO.LOGIN_FACE_RETRY_COOLDOWN_MS (2.5s) con el MISMO
            // frame condenado a fallar otra vez, hasta agotar el rate limit
            // de la cuenta (5 intentos, ver loginRateCheck en main.cpp) --
            // visto en vivo como "se queda en 5/5, no sale por ningún lado":
            // el mensaje real ("quítese los lentes") quedaba tapado en
            // segundos por el genérico "demasiados intentos" del rate limit.
            // Igual que en el registro, sólo un error transitorio (sin
            // respuesta real del servidor, ver postJson en authApi.ts)
            // justifica reintentar solo -- cualquier OTRO rechazo exige que
            // la persona corrija algo (sacarse los lentes, etc.) y reactive
            // la verificación facial a mano.
            if (err?.transient) {
                loginSubmitTriggeredRef.current = false
            } else if (err?.message === 'liveness_challenge_incomplete') {
                // Hallazgo real 2026-09-07 (mismo caso ya resuelto del lado
                // del registro, ver handleRegister/releaseRegisterAutoTrigger
                // más abajo): esto es una carrera de TIMING, no un rechazo
                // definitivo -- el envío se dispara con el estado local
                // (challengesPassedRef) que tenía el cliente en ese instante,
                // pero el servidor puede confirmar
                // qualityGateReached/challenge.complete unos milisegundos/
                // segundos después. Sin liberar el trigger acá, un solo
                // rechazo dejaba el login facial colgado para siempre (nunca
                // reintentaba) con este error fijo en pantalla, aunque el
                // servidor volviera a quedar completo enseguida -- incidente
                // real: usuario cumplió el reto y quedó "colgado" en 5/5 sin
                // pasar nunca a la etapa 3. El backend ya no cuenta este
                // rechazo contra el límite de intentos de la cuenta (ver
                // handleLoginFace en main.cpp), así que reintentar acá es
                // seguro.
                loginSubmitTriggeredRef.current = false
            }
            log.warn('[AUTH_FACE_UI] login failed', {
                message: err?.message || String(err),
                transient: Boolean(err?.transient),
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

        const bestProbe = bestLoginProbeRef.current
        // 8s -> 20s -> 90s (2026-09-04) -> 20 min (2026-09-09). El salto a
        // 90s fue consecuencia de ADR-158: el candidato se captura en la
        // ETAPA 1, ANTES del desafío activo, así que entre su captura y el
        // envío ocurre todo el desafío -- hasta 5 intentos de 8s
        // (kLivenessChallengeTimeoutMs x kLivenessChallengeMaxAttempts = 40s)
        // más el tiempo de completar el formulario.
        //
        // Hallazgo real 2026-09-09 (usuario real, DNI 09637600, avatar con
        // la cabeza claramente inclinada/en movimiento, exactamente el
        // patrón que este mecanismo existe para evitar): 90s sigue sin ser
        // suficiente -- el tiempo de completar el resto del formulario de
        // registro (nombre, DNI, empresa, rol, contraseña) para una persona
        // real supera holgadamente 90s, así que el candidato bueno vencía
        // igual y se caía a la captura en vivo justo al final del gesto,
        // con la cabeza todavía en movimiento/asentándose. A diferencia del
        // `template` (usado para el matching biométrico en sí), reusar un
        // `bestProbe` "viejo" para las imágenes del avatar no tiene el mismo
        // riesgo de seguridad -- sigue siendo la misma sesión de cámara en
        // vivo ininterrumpida de la misma persona, solo un frame de más
        // atrás en el tiempo, y uno YA validado como estático/frontal en
        // vez de uno fresco pero potencialmente en movimiento.
        //
        // Razón original del mecanismo: el puntaje solo se actualiza mientras
        // qualityReady sigue en true frame a frame: si el usuario tarda en
        // completar el resto del formulario y la calidad flaquea un
        // instante (parpadeo, se corre del encuadre), el mejor candidato
        // deja de refrescarse y podía "vencer" a los 8s aunque siguiera
        // siendo la mejor captura disponible -- forzando una captura del
        // frame en vivo SIN comparar nada, volviendo exactamente al
        // comportamiento que este mecanismo existe para evitar (ver ADR-074
        // y hallazgo real 2026-09-04, incidentes de encuadre/zoom).
        const bestProbeAgeMs = bestProbe?.capturedAt ? Date.now() - bestProbe.capturedAt : null
        const bestProbeIsFresh = Boolean(bestProbeAgeMs !== null && bestProbeAgeMs < 1_200_000)
        if (bestProbe && !bestProbeIsFresh) {
            log.warn('[AUTH_REGISTER_FLOW] bestLoginProbe vencido, usando captura en vivo sin comparar', {
                bestProbeAgeMs,
            })
        } else if (!bestProbe) {
            log.warn('[AUTH_REGISTER_FLOW] sin bestLoginProbe acumulado, usando captura en vivo sin comparar')
        }
        // Hallazgo real 2026-09-10 (usuario real, cuenta de prueba DNI
        // 09637600): cuando bestProbe está vencido o nunca se acumuló (ver
        // comentario arriba), este bloque caía a `frameToJpegBase64`/
        // `frameToOvalPortraitJpegBase64`/`frameToBustRectAroundOvalJpegBase64`
        // sobre el video EN VIVO en el instante exacto del envío, SIN pasar
        // por ningún chequeo de calidad -- a diferencia de cada frame que sí
        // suma al contador 5/5 (baseChecksOk arriba exige I.noGlasses igual
        // que ojos/boca/frontal), este frame de respaldo podía tener lentes
        // puestos (o ojos cerrados, fuera de foco, etc.) y terminar de todos
        // modos como la foto real del avatar/plantilla facial -- confirmado
        // en vivo: el avatar de esa cuenta salió con lentes pese a que el
        // desafío de vida los había bloqueado repetidamente en otros
        // intentos. `lastIcaoFourRef` ya trae la señal de calidad del ÚLTIMO
        // frame en vivo (mismo ref que alimenta baseChecksOk) -- se
        // reutiliza acá para exigirle al frame de respaldo el mismo mínimo
        // que ya exige el contador 5/5, en vez de aceptarlo sin mirar.
        if (!bestProbeIsFresh) {
            const liveQuality = lastIcaoFourRef.current
            const liveQualityOk =
                liveQuality.eyes && liveQuality.mouth && liveQuality.frontal && liveQuality.noGlasses
            if (!liveQualityOk) {
                setError(t('error.faceQuality'))
                log.warn('[AUTH_REGISTER_FLOW] blocked: fallback frame fails live quality check', {
                    eyes: liveQuality.eyes,
                    mouth: liveQuality.mouth,
                    frontal: liveQuality.frontal,
                    noGlasses: liveQuality.noGlasses,
                })
                releaseRegisterAutoTrigger('fallback_frame_quality')
                return
            }
        }
        // El auto-envío ocurre después de acumular frames válidos. Reutilizar
        // el de mayor calidad evita capturar justo un parpadeo o movimiento en
        // el instante final, que era la fuente real del avatar anterior.
        const template = bestProbeIsFresh
            ? bestProbe!.template
            : frameToTemplate(videoRef.current, liveFaceBox)
        const imageBase64 = bestProbeIsFresh
            ? bestProbe!.imageBase64
            : frameToJpegBase64(videoRef.current, liveFaceBox)
        const portraitOvalBase64 = bestProbeIsFresh && bestProbe!.portraitOvalBase64
            ? bestProbe!.portraitOvalBase64
            : frameToOvalPortraitJpegBase64(videoRef.current, liveFaceBox)
        const bustRectBase64 = bestProbeIsFresh && bestProbe!.bustRectBase64
            ? bestProbe!.bustRectBase64
            : frameToBustRectAroundOvalJpegBase64(videoRef.current, liveFaceBox)

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
                // ADR-164: flag leído por AvatarWidget.tsx para disparar
                // "onboarding" en vez de "welcome" en el primer login tras
                // registrarse. El envío auto-disparado (este bloque) es el
                // único camino real a un registro exitoso -- la pantalla
                // "success"/"Entrar al sistema" de este mismo archivo
                // (registerUserBiometricStep === 'success') nunca se llega a
                // mostrar (registerUserBiometricStep nunca se fija en
                // 'success'), así que poner el flag solo ahí lo dejaba
                // muerto: todo registro caía siempre al guion genérico de
                // "welcome" en el primer login, nunca al de "onboarding".
                try {
                    sessionStorage.setItem('beemetry_avatar_just_registered_v1', '1')
                } catch {
                    // No crítico -- si falla, esa sesión cae al "welcome" normal.
                }
                setMode('login')
                setError('')
                registerAutoSubmitTriggeredRef.current = false
            } catch (err: any) {
                setCapturedTemplate(null)
                setCapturedImageBase64('')
                setCapturedPortraitOvalBase64('')
                setCapturedBustRectBase64('')
                setError(localizeMessage(err.message))
                if (err?.transient) {
                    // Timeout/red (ver postJson en authApi.ts) -- nunca hubo
                    // respuesta del servidor, así que SÍ tiene sentido
                    // reintentar con los mismos datos (a diferencia del caso
                    // de abajo). Sin esto, un timeout dejaba la captura
                    // trabada para siempre con "verifique red e intente de
                    // nuevo" en pantalla sin que el reintento fuera posible
                    // -- hallazgo real 2026-09-04.
                    releaseRegisterAutoTrigger('transient_error')
                } else if (err?.message === 'liveness_challenge_incomplete') {
                    // Hallazgo real 2026-09-04: a diferencia de "username
                    // already exists" (rechazo permanente, reintentar con los
                    // mismos datos NUNCA tiene éxito), este es un problema de
                    // TIMING -- el envío se dispara con el estado de
                    // challengesPassedRef que tenía el cliente en ese
                    // instante, pero el servidor (gBiometricCaptureState)
                    // puede completar qualityGateReached/challenge.complete
                    // unos milisegundos/segundos después de que el cliente ya
                    // vio "5/5" y disparó el envío. El servidor SÍ vuelve a
                    // quedar completo poco después (confirmado en vivo:
                    // /api/status siguió reportando challengeComplete=true
                    // tras el rechazo), pero sin liberar el trigger acá la
                    // pantalla quedaba atascada para siempre con este error
                    // fijo en pantalla aunque el reto ya estuviera cumplido.
                    releaseRegisterAutoTrigger('liveness_challenge_incomplete')
                }
                // Para cualquier OTRO error (el servidor sí respondió y
                // rechazó, ej. "username already exists"), NO se libera el
                // trigger: reenviar los MISMOS datos automáticamente nunca va
                // a tener éxito. Sin este guard, el useEffect de auto-envío
                // (captureCount se mantiene en 3/3 mientras la cámara siga
                // corriendo) reintentaba cada ~2-3s con el mismo payload, y
                // cada intento hacía setError('') al arrancar -- el mensaje
                // de error quedaba visible una fracción de segundo y se
                // borraba solo, viéndose como un parpadeo sin error real.
                // Dejar el trigger armado obliga a salir de la captura
                // (cambia usuario/dni) para reintentar.
                log.warn('[AUTH_REGISTER_FLOW] registerUser error', {
                    message: err?.message || String(err),
                    transient: Boolean(err?.transient),
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

    /** Envía (o reenvía) el OTP de validación de contacto por el canal dado. */
    const handleSendContactOtp = async (channel: 'email' | 'sms') => {
        const contact =
            channel === 'email'
                ? String(registerForm.email || '').trim()
                : formatInternationalTel(registerForm.mobile, activePhonePrefix)
        if (channel === 'email' && contact.length < 5) {
            setError(t('error.email'))
            return
        }
        if (channel === 'sms' && String(registerForm.mobile || '').trim().length < 6) {
            setError(t('error.mobile'))
            return
        }
        setError('')
        setContactOtp((prev) => ({
            ...prev,
            ...(channel === 'email'
                ? { sendingEmail: true, emailError: '' }
                : { sendingSms: true, smsError: '' }),
        }))
        const result: ContactOtpSendResult = await sendContactOtp(channel, contact)
        setContactOtp((prev) => ({
            ...prev,
            ...(channel === 'email'
                ? {
                      sendingEmail: false,
                      emailSent: result.sent,
                      emailVerified: false,
                      emailCode: '',
                      emailAttempts: 0,
                      emailError: result.sent ? '' : (result.error || 'No se pudo enviar el código al correo.'),
                  }
                : {
                      sendingSms: false,
                      smsSent: result.sent,
                      smsVerified: false,
                      smsCode: '',
                      smsAttempts: 0,
                      smsError: result.sent ? '' : (result.error || 'No se pudo enviar el código por SMS/WhatsApp.'),
                  }),
        }))
    }

    const handleContactOtpCodeChange = (channel: 'email' | 'sms', value: string) => {
        if (channel === 'email') {
            setContactOtp((prev) => ({ ...prev, emailCode: value }))
        } else {
            setContactOtp((prev) => ({ ...prev, smsCode: value }))
        }
    }

    /** Verifica el código de 6 dígitos ingresado para el canal dado. */
    const handleVerifyContactOtp = async (channel: 'email' | 'sms') => {
        const contact =
            channel === 'email'
                ? String(registerForm.email || '').trim()
                : formatInternationalTel(registerForm.mobile, activePhonePrefix)
        const code = channel === 'email' ? contactOtp.emailCode : contactOtp.smsCode
        if (code.trim().length !== 6) return
        setContactOtp((prev) => ({
            ...prev,
            ...(channel === 'email' ? { verifyingEmail: true } : { verifyingSms: true }),
        }))
        const result: ContactOtpVerifyResult = await verifyContactOtp(channel, contact, code.trim())
        setContactOtp((prev) => {
            const attemptsKey = channel === 'email' ? 'emailAttempts' : 'smsAttempts'
            const nextAttempts = prev[attemptsKey] + (result.valid ? 0 : 1)
            const lockedOut = result.invalid_data || nextAttempts >= CONTACT_OTP_MAX_ATTEMPTS
            return {
                ...prev,
                ...(channel === 'email'
                    ? {
                          verifyingEmail: false,
                          emailVerified: result.valid,
                          emailAttempts: nextAttempts,
                          // Se reactiva el campo (emailSent=false) si se bloqueó por
                          // demasiados intentos o el backend marcó el dato inválido.
                          emailSent: result.valid ? true : !lockedOut,
                          emailCode: result.valid ? prev.emailCode : '',
                          emailError: result.valid
                              ? ''
                              : lockedOut
                                ? 'Demasiados intentos fallidos. Corrija el correo y vuelva a intentar.'
                                : (result.error || 'Código incorrecto.'),
                      }
                    : {
                          verifyingSms: false,
                          smsVerified: result.valid,
                          smsAttempts: nextAttempts,
                          smsSent: result.valid ? true : !lockedOut,
                          smsCode: result.valid ? prev.smsCode : '',
                          smsError: result.valid
                              ? ''
                              : lockedOut
                                ? 'Demasiados intentos fallidos. Corrija el celular y vuelva a intentar.'
                                : (result.error || 'Código incorrecto.'),
                      }),
            }
        })
    }

    const startRegisterUserFaceCapture = async () => {
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

        // Corrección 2026-09-04: DNI y username duplicados se detectaban
        // recién DESPUÉS de completar toda la captura facial (5 lecturas +
        // parpadeo natural + desafío activo), un flujo de ~1-2 minutos que
        // el backend iba a rechazar igual -- reproducido en vivo las DOS
        // veces, primero con "DNI ya existe" y luego, ya corregido ese
        // caso, con "username already exists in this company" en un
        // registro distinto. Ninguna de las dos restricciones depende de
        // nada biométrico: se validan ANTES de siquiera pedir la cámara.
        // checkDniAvailable (no checkLoginIdentity: el DNI es UNIQUE GLOBAL
        // en auth_users, no por empresa -- checkLoginIdentity con la
        // empresa correcta daba falso negativo para un DNI duplicado bajo
        // OTRA empresa, reproducido en vivo) y checkUsernameAvailable
        // (username UNIQUE por empresa, mismo criterio que
        // registerUserPg) nunca lanzan (ver authApi.ts), así que no hace
        // falta try/catch acá: una falla de red simplemente no bloquea, el
        // backend igual rechaza duplicados al final como red de seguridad.
        // En paralelo (Promise.all) para no duplicar la latencia de red de
        // dos round-trips secuenciales.
        {
            const registerDni = String(registerForm.dni || '').trim()
            const registerCompany = String(registerForm.company || '').trim()
            const registerUsername = String(registerForm.username || '').trim()
            setError('')
            setMessage('')
            setIsProcessing(true)
            const [dniCheck, usernameCheck] = await Promise.all([
                checkDniAvailable(registerDni),
                checkUsernameAvailable(registerCompany, registerUsername),
            ])
            setIsProcessing(false)
            if (dniCheck.exists) {
                setError(t('error.dniAlreadyRegistered'))
                log.warn('[AUTH_REGISTER_FLOW] DNI ya registrado, no se abre la cámara', {
                    dniLen: registerDni.length,
                })
                return
            }
            if (usernameCheck.exists) {
                setError(t('error.usernameAlreadyRegistered'))
                log.warn('[AUTH_REGISTER_FLOW] username ya registrado en esta empresa, no se abre la cámara', {
                    usernameLen: registerUsername.length,
                })
                return
            }
        }

        // ADR-161: el email y el celular deben quedar validados por OTP antes
        // de abrir la cámara -- mismo criterio que el bloque de arriba (nunca
        // dejar avanzar al paso biométrico, más largo y costoso, con datos que
        // ya sabemos que están mal).
        if (!contactOtp.emailVerified || !contactOtp.smsVerified) {
            setError('Valide el correo y el celular con el código enviado antes de continuar.')
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
        // Hallazgo real 2026-09-04: este reset NUNCA se esperaba (fire-and-
        // forget) antes de abrir la cámara -- si la MISMA pestaña ya tenía
        // una sesión de captura previa completa (challenge.complete=true,
        // ej. tras una verificación biométrica de admin momentos antes de
        // borrar y volver a registrar el mismo DNI), la cámara podía abrir y
        // los primeros /api/process_frame llegar ANTES de que este reset
        // aterrizara en el servidor -- la sesión "vieja" seguía marcada
        // completa, el auto-envío disparaba de inmediato, y el registro real
        // (que sí corre contra la sesión ya reseteada segundos después)
        // volvía con "liveness_challenge_incomplete" sin que la persona
        // hubiera hecho nada mal: la cámara parecía "cerrarse sola" y volver
        // al formulario. Esperar el reset ANTES de abrir la cámara elimina la
        // carrera de raíz.
        await resetBiometricCapture().catch(() => {})
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

    const startRegisterCompanyFaceCapture = async () => {
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
        // ADR-161: pestaña empresa solo pide celular (no hay campo de email
        // en este formulario) -- ver comentario equivalente en
        // startRegisterUserFaceCapture.
        if (!contactOtp.smsVerified) {
            setError('Valide el celular con el código enviado antes de continuar.')
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
        // Ver comentario en startRegisterUserFaceCapture (hallazgo real
        // 2026-09-04): esperar el reset antes de abrir la cámara evita la
        // carrera con una sesión de captura previa completa en la misma
        // pestaña.
        await resetBiometricCapture().catch(() => {})
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
                                    className="absolute pointer-events-none biometric-oval"
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
                                                position: 'absolute',
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
                                            {/* Silenciar/activar la guía por voz (pedido explícito
                                                del usuario 2026-09-07) -- la guía visual (flechas,
                                                texto, cuenta regresiva) sigue igual en mute. */}
                                            <button
                                                type="button"
                                                onClick={toggleVoiceGuideMuted}
                                                aria-label={
                                                    voiceGuideMuted
                                                        ? t('liveness.challenge.unmute')
                                                        : t('liveness.challenge.mute')
                                                }
                                                title={
                                                    voiceGuideMuted
                                                        ? t('liveness.challenge.unmute')
                                                        : t('liveness.challenge.mute')
                                                }
                                                className="absolute top-1 right-1 p-1 rounded-full hover:bg-white/10 pointer-events-auto"
                                                style={{ zIndex: 26 }}
                                            >
                                                {voiceGuideMuted ? (
                                                    <VolumeX size={14} className="text-slate-300" />
                                                ) : (
                                                    <Volume2 size={14} className="text-sky-300" />
                                                )}
                                            </button>
                                            {/* ADR-156: con CHALLENGE_COUNT=1 el "desafío 1 de 1"
                                                no decía nada; lo útil para quien está frente a la
                                                cámara es cuántos pedidos le quedan antes de que la
                                                captura se reinicie sola. */}
                                            <span className="text-[10px] tracking-wider uppercase text-sky-300">
                                                {t('liveness.challenge.attempt', {
                                                    current: String(challengeUiState.attempt),
                                                    total: String(
                                                        challengeUiState.maxAttempts || CHALLENGE_MAX_ATTEMPTS
                                                    ),
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
                                            {/* Flecha grande animada (ADR-149, ampliada 2026-09-07
                                                a shift_left/shift_right): ayuda visual para los 4
                                                gestos laterales -- puramente decorativa
                                                (pointer-events-none, capa CSS sobre el video), la
                                                captura real lee el frame del <video>/canvas
                                                directamente y nunca incluye este overlay. */}
                                            {!isSuccess &&
                                                !isTimeout &&
                                                (chType === 'turn_left' ||
                                                    chType === 'turn_right' ||
                                                    chType === 'shift_left' ||
                                                    chType === 'shift_right') && (
                                                    <div
                                                        className={`turn-challenge-arrow turn-challenge-arrow-${
                                                            chType === 'turn_left' || chType === 'shift_left'
                                                                ? 'left'
                                                                : 'right'
                                                        } pointer-events-none`}
                                                        aria-hidden="true"
                                                    >
                                                        {chType === 'turn_left' || chType === 'shift_left' ? (
                                                            <ArrowLeftCircle size={56} className="text-sky-300" />
                                                        ) : (
                                                            <ArrowRightCircle size={56} className="text-sky-300" />
                                                        )}
                                                    </div>
                                                )}
                                            {/* Icono pulsante para move_closer/move_away -- mismo
                                                criterio que las flechas de arriba: puramente
                                                decorativo, la captura real nunca lo incluye. Escala
                                                (grande->chico o viceversa) para reforzar visualmente
                                                "acércate"/"aléjate" además del ícono y el texto. */}
                                            {!isSuccess &&
                                                !isTimeout &&
                                                (chType === 'move_closer' || chType === 'move_away') && (
                                                    <div
                                                        className={
                                                            chType === 'move_closer'
                                                                ? 'liveness-zoom-pulse liveness-zoom-pulse-in'
                                                                : 'liveness-zoom-pulse liveness-zoom-pulse-out'
                                                        }
                                                        aria-hidden="true"
                                                    >
                                                        {chType === 'move_closer' ? (
                                                            <ZoomIn size={56} className="text-sky-300" />
                                                        ) : (
                                                            <ZoomOut size={56} className="text-sky-300" />
                                                        )}
                                                    </div>
                                                )}
                                            {challengeUiState.status === 'pending' && (
                                                <span className="text-[11px] text-amber-200 font-mono">
                                                    {secondsLeft}s
                                                </span>
                                            )}
                                        </div>
                                    )
                                })()}

                            {/* Después de "Confirmado" el overlay del desafío desaparece
                                (isChallengeSequenceComplete pasa a true) y el auto-envío de
                                registerUser() queda en curso (isProcessing): sin este cartel
                                la pantalla se veía IDÉNTICA a una que se colgó -- ICAO 5/5,
                                liveness 100%, cronómetro pausado (ver el efecto de
                                sessionClockRef que pausa mientras isProcessing) y ningún
                                indicio de que el pedido al servidor sigue en vuelo. Hallazgo
                                real 2026-09-10: usuario reportó la captura "congelada" tras
                                el "Confirmado" del reto, que en realidad terminó en
                                REGISTRO COMPLETADO unos segundos/minutos después -- nunca
                                hubo cuelgue, sólo ausencia de feedback visual. */}
                            {mode === 'register' &&
                                registerTab === 'user' &&
                                registerUserBiometricStep === 'capture' &&
                                isProcessing && (
                                    <div
                                        className="absolute left-1/2 top-3 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl text-center"
                                        style={{
                                            zIndex: 25,
                                            position: 'absolute',
                                            background: 'rgba(15, 23, 42, 0.88)',
                                            border: '1px solid #38bdf8',
                                            minWidth: 220,
                                        }}
                                    >
                                        <RefreshCw size={16} className="animate-spin text-sky-300" />
                                        <span className="text-white text-sm font-bold">
                                            {t('auth.sendingRegistration')}
                                        </span>
                                    </div>
                                )}

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
                                setContactOtp(INITIAL_CONTACT_OTP_STATE)
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
                            <button
                                type="button"
                                onClick={() => setShowFotocheckScan('login')}
                                title="Escanear fotocheck (precarga empresa y usuario)"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    background: 'transparent', border: 'none', color: '#818cf8',
                                    fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                                    padding: '2px 0', textTransform: 'uppercase', letterSpacing: '.03em',
                                }}
                            >
                                <ScanLine size={13} /> Escanear fotocheck
                            </button>
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
                                        setContactOtp(INITIAL_CONTACT_OTP_STATE)
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
                                        setContactOtp(INITIAL_CONTACT_OTP_STATE)
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
                                                // Flag leído por AvatarWidget.tsx (ADR-164) al montar el
                                                // shell principal -- dispara "onboarding" en vez de
                                                // "welcome" en la primera entrada tras un registro.
                                                try {
                                                    sessionStorage.setItem(
                                                        'beemetry_avatar_just_registered_v1',
                                                        '1',
                                                    )
                                                } catch {
                                                    // No crítico -- si falla, esa sesión cae al "welcome" normal.
                                                }
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
                                                 <button type="button" onClick={() => setShowFotocheckScan('register')} title="Escanear fotocheck (precarga sus datos)" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '8px', border: '1px solid rgba(99,102,241,.4)', background: 'rgba(99,102,241,.1)', color: '#818cf8', cursor: 'pointer', flexShrink: 0 }}>
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
                                                     <input
                                                         type="tel"
                                                         inputMode="tel"
                                                         value={registerForm.mobile}
                                                         onChange={(e) => {
                                                             setRegisterForm((prev) => ({ ...prev, mobile: e.target.value }))
                                                             if (contactOtp.smsSent || contactOtp.smsVerified) {
                                                                 setContactOtp((prev) => ({
                                                                     ...prev, smsSent: false, smsVerified: false,
                                                                     smsCode: '', smsError: '', smsAttempts: 0,
                                                                 }))
                                                             }
                                                         }}
                                                         disabled={contactOtp.smsSent && !contactOtp.smsVerified}
                                                         required
                                                     />
                                                 </div>
                                             </label>
                                         </div>
                                         <ContactOtpPanel
                                             channels={['sms']}
                                             contactOtp={contactOtp}
                                             onSend={handleSendContactOtp}
                                             onVerify={handleVerifyContactOtp}
                                             onCodeChange={handleContactOtpCodeChange}
                                         />
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
                                                <button type="button" onClick={() => setShowFotocheckScan('register')} title="Escanear fotocheck (precarga sus datos)" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '8px', border: '1px solid rgba(99,102,241,.4)', background: 'rgba(99,102,241,.1)', color: '#818cf8', cursor: 'pointer', flexShrink: 0 }}>
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
                                                onChange={(e) => {
                                                    setRegisterForm((prev) => ({
                                                        ...prev,
                                                        email: e.target.value,
                                                    }))
                                                    if (contactOtp.emailSent || contactOtp.emailVerified) {
                                                        setContactOtp((prev) => ({
                                                            ...prev, emailSent: false, emailVerified: false,
                                                            emailCode: '', emailError: '', emailAttempts: 0,
                                                        }))
                                                    }
                                                }}
                                                disabled={contactOtp.emailSent && !contactOtp.emailVerified}
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
                                                    onChange={(e) => {
                                                        setRegisterForm((prev) => ({
                                                            ...prev,
                                                            mobile: e.target.value,
                                                        }))
                                                        if (contactOtp.smsSent || contactOtp.smsVerified) {
                                                            setContactOtp((prev) => ({
                                                                ...prev, smsSent: false, smsVerified: false,
                                                                smsCode: '', smsError: '', smsAttempts: 0,
                                                            }))
                                                        }
                                                    }}
                                                    disabled={contactOtp.smsSent && !contactOtp.smsVerified}
                                                    required
                                                />
                                            </div>
                                        </label>
                                        <div className="reg-grid-full">
                                            <ContactOtpPanel
                                                channels={['email', 'sms']}
                                                contactOtp={contactOtp}
                                                onSend={handleSendContactOtp}
                                                onVerify={handleVerifyContactOtp}
                                                onCodeChange={handleContactOtpCodeChange}
                                            />
                                        </div>
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
            <FotocheckQrScanCapture
                isOpen={showFotocheckScan !== null}
                onClose={() => setShowFotocheckScan(null)}
                onSuccess={handleFotocheckScanSuccess}
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
