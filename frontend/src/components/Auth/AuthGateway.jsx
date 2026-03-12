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

function normalizeVector(vector) {
    const max = Math.max(...vector, 1)
    if (max === 0) {
        return vector
    }
    return vector.map((v) => Number((v / max).toFixed(6)))
}

function frameToTemplate(videoElement) {
    const size = 24
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })

    context.drawImage(videoElement, 0, 0, size, size)
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

function frameToJpegBase64(videoElement) {
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth || 960
    canvas.height = videoElement.videoHeight || 540
    const context = canvas.getContext('2d')
    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const [, base64 = ''] = dataUrl.split(',')
    return base64
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
    const videoRef = useRef(null)
    const streamRef = useRef(null)

    const canRegister = useMemo(() => {
        const valuesOk =
            registerForm.firstName.trim() &&
            registerForm.lastName.trim() &&
            registerForm.dni.trim().length >= 8 &&
            registerForm.username.trim().length >= 4 &&
            registerForm.password.trim().length >= 6
        return valuesOk && Array.isArray(capturedTemplate)
    }, [registerForm, capturedTemplate])

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

    const handleFaceLogin = async () => {
        if (!videoRef.current || !cameraReady) {
            setError('La camara no esta lista.')
            return
        }

        setIsProcessing(true)
        setError('')
        setMessage('')

        try {
            const template = frameToTemplate(videoRef.current)
            const imageBase64 = frameToJpegBase64(videoRef.current)
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

        const template = frameToTemplate(videoRef.current)
        const imageBase64 = frameToJpegBase64(videoRef.current)
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
                        <video ref={videoRef} autoPlay muted playsInline className="camera-preview" />
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
