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
} from '../../auth/authApi'

const DEFAULT_COMPANIES = ['Minera Raura', 'Compania Minera Volcan', 'Minera Antamina', 'Minera Cerro Verde']
const GUIDE_BOX_PADDING = 0.18

function getCropFromFaceBox(videoWidth, videoHeight, faceBox) {
    if (!faceBox) {
        return { x: 0, y: 0, width: videoWidth, height: videoHeight }
    }

    const expandX = faceBox.width * GUIDE_BOX_PADDING
    const expandY = faceBox.height * GUIDE_BOX_PADDING
    const x = Math.max(0, Math.floor(faceBox.x - expandX))
    const y = Math.max(0, Math.floor(faceBox.y - expandY))
    const width = Math.min(videoWidth - x, Math.floor(faceBox.width + expandX * 2))
    const height = Math.min(videoHeight - y, Math.floor(faceBox.height + expandY * 2))

    return { x, y, width, height }
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
    })

    const [capturedTemplate, setCapturedTemplate] = useState(null)
    const [capturedImageBase64, setCapturedImageBase64] = useState('')
    const [liveFaceBox, setLiveFaceBox] = useState(null)
    const [frameMetrics, setFrameMetrics] = useState({ width: 1, height: 1 })
    const [faceGuide, setFaceGuide] = useState({
        detected: false,
        centered: false,
        frontal: false,
        eyesOpen: false,
        mouthClosed: false,
        stable: false,
        lighting: false,
        qualityReady: false,
        notes: ['Activa modo Registro y alinea el rostro para iniciar analisis.'],
    })
    const [manualChecks, setManualChecks] = useState({
        noGlasses: false,
        noHat: false,
        noAccessories: false,
        noMakeup: false,
    })
    const videoRef = useRef(null)
    const streamRef = useRef(null)
    const detectorRef = useRef(null)
    const motionRef = useRef({ cx: 0, cy: 0, t: 0 })

    const canRegister = useMemo(() => {
        const valuesOk =
            registerForm.firstName.trim() &&
            registerForm.lastName.trim() &&
            registerForm.dni.trim().length >= 8 &&
            registerForm.username.trim().length >= 4 &&
            registerForm.password.trim().length >= 6
        return valuesOk && Array.isArray(capturedTemplate) && Boolean(capturedImageBase64)
    }, [registerForm, capturedTemplate, capturedImageBase64])

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
        let cancelled = false
        let timerId = null

        async function detectFaceLoop() {
            if (mode !== 'register') {
                setLiveFaceBox(null)
                setFaceGuide({
                    detected: false,
                    centered: false,
                    frontal: false,
                    eyesOpen: false,
                    mouthClosed: false,
                    stable: false,
                    lighting: false,
                    qualityReady: false,
                    notes: ['La validacion biometrica avanzada se activa en modo Registro.'],
                })
                return
            }

            const video = videoRef.current
            if (!video || !cameraReady || video.videoWidth < 32 || video.videoHeight < 32) {
                timerId = window.setTimeout(detectFaceLoop, 500)
                return
            }

            setFrameMetrics({ width: video.videoWidth, height: video.videoHeight })

            try {
                let bestFace = null

                if ('FaceDetector' in window) {
                    if (!detectorRef.current) {
                        detectorRef.current = new window.FaceDetector({
                            maxDetectedFaces: 1,
                            fastMode: true,
                        })
                    }

                    const detections = await detectorRef.current.detect(video)
                    if (detections.length > 0) {
                        const box = detections[0].boundingBox
                        bestFace = {
                            x: box.x,
                            y: box.y,
                            width: box.width,
                            height: box.height,
                            landmarks: detections[0].landmarks || [],
                        }
                    }
                }

                if (!bestFace) {
                    setLiveFaceBox(null)
                    setFaceGuide({
                        detected: false,
                        centered: false,
                        frontal: false,
                        eyesOpen: false,
                        mouthClosed: false,
                        stable: false,
                        lighting: false,
                        qualityReady: false,
                        notes: [
                            'No se detecta rostro. Acercate y mira al frente.',
                            'Evita lentes oscuros, gorra y accesorios al capturar.',
                        ],
                    })
                } else {
                    setLiveFaceBox(bestFace)

                    const { offsetX, offsetY } = centerOffsetRatio(
                        bestFace,
                        video.videoWidth,
                        video.videoHeight
                    )
                    const centered = offsetX < 0.1 && offsetY < 0.1

                    const aspect = bestFace.width / Math.max(1, bestFace.height)
                    const frontalByAspect = aspect > 0.65 && aspect < 1.02

                    const leftEye = bestFace.landmarks.find((l) => l.type === 'leftEye')
                    const rightEye = bestFace.landmarks.find((l) => l.type === 'rightEye')
                    const eyesAligned =
                        leftEye && rightEye
                            ? Math.abs(leftEye.locations[0].y - rightEye.locations[0].y) < bestFace.height * 0.08
                            : false

                    const eyeOpenness = (eye) => {
                        if (!eye || !Array.isArray(eye.locations) || eye.locations.length < 4) {
                            return 0
                        }
                        const xs = eye.locations.map((p) => p.x)
                        const ys = eye.locations.map((p) => p.y)
                        const width = Math.max(...xs) - Math.min(...xs)
                        const height = Math.max(...ys) - Math.min(...ys)
                        return height / Math.max(1, width)
                    }

                    const mouth = bestFace.landmarks.find((l) => l.type === 'mouth')
                    const mouthRatio = (() => {
                        if (!mouth || !Array.isArray(mouth.locations) || mouth.locations.length < 4) {
                            return 0
                        }
                        const xs = mouth.locations.map((p) => p.x)
                        const ys = mouth.locations.map((p) => p.y)
                        const width = Math.max(...xs) - Math.min(...xs)
                        const height = Math.max(...ys) - Math.min(...ys)
                        return height / Math.max(1, width)
                    })()

                    const eyesOpen =
                        eyeOpenness(leftEye) > 0.12 && eyeOpenness(rightEye) > 0.12
                    const mouthClosed = mouthRatio > 0 && mouthRatio < 0.25

                    const frontal = frontalByAspect && eyesAligned

                    const now = performance.now()
                    const cx = bestFace.x + bestFace.width / 2
                    const cy = bestFace.y + bestFace.height / 2
                    const prev = motionRef.current
                    const dt = Math.max(1, now - prev.t)
                    const speed = Math.hypot(cx - prev.cx, cy - prev.cy) / dt
                    const stable = prev.t === 0 ? false : speed < 0.07
                    motionRef.current = { cx, cy, t: now }

                    const brightness = brightnessScore(video, bestFace)
                    const lighting = brightness > 75 && brightness < 190

                    const manualOk =
                        manualChecks.noGlasses &&
                        manualChecks.noHat &&
                        manualChecks.noAccessories &&
                        manualChecks.noMakeup

                    const notes = []
                    if (!centered) notes.push('Centra tu rostro dentro del recuadro punteado.')
                    if (!frontal) notes.push('Coloca la cara recta, mirando de frente y sin giro lateral.')
                    if (!eyesOpen) notes.push('Mantén los ojos abiertos y visibles.')
                    if (!mouthClosed) notes.push('Mantén la boca cerrada durante la captura.')
                    if (!stable) notes.push('Evita moverte: mantén la cabeza estable por unos segundos.')
                    if (!lighting) notes.push('Ajusta la iluminacion para evitar sombras o sobreexposicion.')
                    if (!manualOk) {
                        notes.push('Confirma condiciones: sin lentes, gorros, accesorios y sin maquillaje.')
                    }

                    const qualityReady =
                        centered && frontal && eyesOpen && mouthClosed && stable && lighting && manualOk
                    setFaceGuide({
                        detected: true,
                        centered,
                        frontal,
                        eyesOpen,
                        mouthClosed,
                        stable,
                        lighting,
                        qualityReady,
                        notes,
                    })
                }
            } catch {
                setFaceGuide({
                    detected: false,
                    centered: false,
                    frontal: false,
                    eyesOpen: false,
                    mouthClosed: false,
                    stable: false,
                    lighting: false,
                    qualityReady: false,
                    notes: [
                        'El navegador no soporta deteccion facial avanzada en tiempo real.',
                        'Alinea manualmente el rostro en el recuadro y evita accesorios.',
                    ],
                })
            }

            if (!cancelled) {
                timerId = window.setTimeout(detectFaceLoop, 500)
            }
        }

        if (cameraReady) {
            detectFaceLoop()
        }

        return () => {
            cancelled = true
            if (timerId) {
                window.clearTimeout(timerId)
            }
        }
    }, [cameraReady, manualChecks, mode])

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
            const session = createSession(user)
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
            const session = createSession(result.user)
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

        if (!faceGuide.qualityReady) {
            setError('La calidad facial aun no cumple criterios. Ajusta postura, estabilidad y condiciones de captura.')
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
                captureConditions: manualChecks,
            })

            const session = createSession(result.user)
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
                        <div className="camera-stage">
                            <video ref={videoRef} autoPlay muted playsInline className="camera-preview" />
                            {liveFaceBox && (
                                <div
                                    className="face-guide-box"
                                    style={{
                                        left: `${(liveFaceBox.x / frameMetrics.width) * 100}%`,
                                        top: `${(liveFaceBox.y / frameMetrics.height) * 100}%`,
                                        width: `${(liveFaceBox.width / frameMetrics.width) * 100}%`,
                                        height: `${(liveFaceBox.height / frameMetrics.height) * 100}%`,
                                    }}
                                />
                            )}
                        </div>
                        {mode === 'register' && (
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

                                <div className="manual-checks">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={manualChecks.noGlasses}
                                            onChange={(event) =>
                                                setManualChecks((prev) => ({ ...prev, noGlasses: event.target.checked }))
                                            }
                                        />
                                        Sin lentes
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={manualChecks.noHat}
                                            onChange={(event) =>
                                                setManualChecks((prev) => ({ ...prev, noHat: event.target.checked }))
                                            }
                                        />
                                        Sin gorros
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={manualChecks.noAccessories}
                                            onChange={(event) =>
                                                setManualChecks((prev) => ({ ...prev, noAccessories: event.target.checked }))
                                            }
                                        />
                                        Sin accesorios
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={manualChecks.noMakeup}
                                            onChange={(event) =>
                                                setManualChecks((prev) => ({ ...prev, noMakeup: event.target.checked }))
                                            }
                                        />
                                        Sin maquillaje
                                    </label>
                                </div>

                                <ul>
                                    {faceGuide.notes.map((note) => (
                                        <li key={note}>{note}</li>
                                    ))}
                                </ul>
                                <p className={faceGuide.qualityReady ? 'quality-ready ok' : 'quality-ready warn'}>
                                    {faceGuide.qualityReady
                                        ? 'Calidad sugerida: lista para captura biometrica de registro.'
                                        : 'Calidad sugerida: ajusta postura, movimiento y condiciones antes de capturar.'}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="mode-switch">
                        <button
                            type="button"
                            className={mode === 'login' ? 'active' : ''}
                            onClick={() => {
                                setMode('login')
                                setError('')
                                setMessage('')
                            }}
                        >
                            <ShieldCheck size={16} /> Ingreso
                        </button>
                        <button
                            type="button"
                            className={mode === 'register' ? 'active' : ''}
                            onClick={() => {
                                setMode('register')
                                setError('')
                                setMessage('')
                            }}
                        >
                            <UserPlus size={16} /> Registro
                        </button>
                    </div>
                </section>

                <section className="auth-panel auth-panel-form">
                    {mode === 'login' ? (
                        <>
                            <h2>Ingresar al sistema</h2>
                            <label className="field-label">
                                <Building2 size={14} /> Nombre Empresa Minera
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

                            <button
                                type="button"
                                className="primary-face-button"
                                disabled={!cameraReady || isProcessing}
                                onClick={handleFaceLogin}
                            >
                                <ScanFace size={17} />
                                {isProcessing ? 'Validando rostro...' : 'Ingresar con reconocimiento facial'}
                            </button>

                            <div className="auth-divider">
                                <span>Opcional</span>
                            </div>

                            <form onSubmit={handlePasswordLogin} className="stack-form">
                                <label className="field-label">
                                    <UserRound size={14} /> Usuario
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
                                    <KeyRound size={14} /> Contrasena
                                    <input
                                        type="password"
                                        value={loginForm.password}
                                        onChange={(event) =>
                                            setLoginForm((prev) => ({ ...prev, password: event.target.value }))
                                        }
                                        required
                                    />
                                </label>
                                <button type="submit" className="secondary-button" disabled={isProcessing}>
                                    Ingresar con usuario y contrasena
                                </button>
                            </form>
                        </>
                    ) : (
                        <>
                            <h2>Registrar nuevo usuario</h2>
                            <form onSubmit={handleRegister} className="stack-form">
                                <label className="field-label">
                                    <Building2 size={14} /> Empresa Minera
                                    <select
                                        value={registerForm.company}
                                        onChange={(event) =>
                                            setRegisterForm((prev) => ({ ...prev, company: event.target.value }))
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
                                    Nombres
                                    <input
                                        type="text"
                                        value={registerForm.firstName}
                                        onChange={(event) =>
                                            setRegisterForm((prev) => ({ ...prev, firstName: event.target.value }))
                                        }
                                        required
                                    />
                                </label>
                                <label className="field-label">
                                    Apellidos
                                    <input
                                        type="text"
                                        value={registerForm.lastName}
                                        onChange={(event) =>
                                            setRegisterForm((prev) => ({ ...prev, lastName: event.target.value }))
                                        }
                                        required
                                    />
                                </label>
                                <label className="field-label">
                                    DNI
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={12}
                                        value={registerForm.dni}
                                        onChange={(event) =>
                                            setRegisterForm((prev) => ({ ...prev, dni: event.target.value }))
                                        }
                                        required
                                    />
                                </label>
                                <label className="field-label">
                                    Usuario
                                    <input
                                        type="text"
                                        value={registerForm.username}
                                        onChange={(event) =>
                                            setRegisterForm((prev) => ({ ...prev, username: event.target.value }))
                                        }
                                        required
                                    />
                                </label>
                                <label className="field-label">
                                    Contrasena
                                    <input
                                        type="password"
                                        value={registerForm.password}
                                        onChange={(event) =>
                                            setRegisterForm((prev) => ({ ...prev, password: event.target.value }))
                                        }
                                        required
                                    />
                                </label>

                                <button
                                    type="button"
                                    className="secondary-button"
                                    disabled={!cameraReady}
                                    onClick={handleCaptureForRegistration}
                                >
                                    <Camera size={15} /> Registrar rostro ahora
                                </button>

                                <button type="submit" className="primary-face-button" disabled={!canRegister || isProcessing}>
                                    <UserPlus size={17} /> Guardar registro y entrar
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
