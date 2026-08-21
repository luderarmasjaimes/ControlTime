/**
 * Parámetros alineados con C:\FACIAL (www/main.js, canvas 640×480, etc.).
 *
 * --- Resumen de algoritmos / componentes (biométrica ICAO en esta app) ---
 * | Ámbito | Tecnología |
 * |--------|------------|
 * | Borde del rostro (óvalo UI) | Navegador: FaceDetector API + canvas preprocesado (JS: BT.601, histograma, gamma, blur 3×3 solo en modo noche/reflejos). |
 * | Validación servidor | C++17 (Boost.Beast): JPEG, umbral de iluminación, EMA lentes, llamada HTTP al motor IA. |
 * | Ojos / boca / lentes en frame | Python 3 + MediaPipe Tasks Face Landmarker + OpenCV (NumPy) en `ai_engine/eye_analyzer.py`. |
 * | Plantilla / match facial (login/registro) | Cliente: vector 24×24 desde JPEG 640×480 con máscara elíptica (`biometricOvalFrame.js`); backend C++ OpenCV legacy o Dermalog si aplica. |
 *
 * OpenCV en el cliente: no; solo en Python (ai_engine) y en el binario C++ del backend.
 */
export const FACIAL_ICAO = {
    /**
     * Frames ICAO válidos consecutivos antes de considerar captura completa
     * (FACIAL REQUIRED_VALID_FRAMES). Antes 3 -- por debajo de la ventana de
     * evidencia que usa la histéresis de lentes en ai_engine/eye_analyzer.py
     * (GLASSES_SCORE_HIST_LEN, default 5 muestras): esa histéresis empieza
     * cada sesión asumiendo "sin lentes" y necesita varias muestras
     * consistentes para voltear a "con lentes" (evita falsos positivos por
     * cejas/nariz/reflejos). Con solo 3 frames (~525ms a VERIFY_SYNC_MS) la
     * captura podía completarse antes de que el detector de lentes tuviera
     * evidencia suficiente, dejando pasar a alguien con lentes puestos por
     * pura carrera, no por mala calibración. Debe coincidir con
     * backend/src/biometric/biometric_types.hpp (kRequiredValidCaptureFrames).
     */
    REQUIRED_VALID_FRAMES: 5,
    /** Enfriamiento entre capturas automáticas (ms) */
    CAPTURE_COOLDOWN_MS: 1000,
    /** Coherente con backend BIOMETRIC_ICAO_EYE_CONFIDENCE_MIN (sobre confidence 0..1 del ai_engine) */
    EYE_CONFIDENCE_MIN_PERCENT: 70,
    /** Iluminación global 0–100 (ICAO analyzeFrameIllumination): mínimo 40 */
    ILLUMINATION_MIN_PERCENT: 40,
    /** Evitar sobreexposición extrema en cliente (complemento a lighting_out_of_range del backend) */
    ILLUMINATION_MAX_PERCENT: 98,
    /** EAR mínimo por ojo en motor IA Python (eye_analyzer): coherente con C++ 0.18–0.20 */
    EAR_OPEN_HINT: 0.18,
    /** Centrado: máx. desplazamiento normalizado del centro del rostro respecto al frame */
    MAX_CENTER_OFFSET_RATIO: 0.18,
    /** Estabilidad: velocidad máx. del centro del rostro (px/ms), aprox. tracking FACIAL */
    MAX_FACE_CENTER_SPEED: 0.12,
    /** Relación ancho/alto del box facial para frontalidad */
    FRONTAL_ASPECT_MIN: 0.4,
    FRONTAL_ASPECT_MAX: 1.3,
    /** Alineación vertical de ojos (landmarks) */
    MAX_EYE_Y_DELTA_RATIO: 0.14,
    /** Umbral apertura boca local (landmarks FaceDetector) — respaldo cuando no hay respuesta aún */
    MOUTH_OPEN_LANDMARK_RATIO: 0.2,
    /** Intervalo mínimo entre frames de detección (~12–13 fps: menos ruido que 15 fps) */
    DETECT_FRAME_MIN_MS: 78,
    /** Intervalo entre envíos al backend verify-frame (ms), cercano al loop de estado de FACIAL */
    VERIFY_SYNC_MS: 175,
    /** Calidad JPEG para verify-frame (FACIAL main.js usa 0.6) */
    VERIFY_JPEG_QUALITY: 0.6,
    /** getUserMedia video ideal. Antes 640x480 (FACIAL www/main.js) -- subido a
     * 960x720 el 2026-08-19: a esa resolución, la lectura de ojos/parpadeo de
     * MediaPipe se degradaba notablemente a distancia media/lejana de la cámara
     * (confirmado con logs reales: EAR bajo y blink blendshape elevado juntos,
     * sin evidencia de parpadeo real, solo a IED bajo). Mismo aspecto 4:3, 2.25x
     * más píxeles -- extiende el rango de distancia utilizable sin tocar los
     * umbrales de aceptación. Este mismo valor también fija el tamaño del canvas
     * JPEG enviado al servidor (frameToJpegBase64/buildFullFrameJpegBase64FromVideo),
     * no solo la resolución pedida a getUserMedia. */
    CAMERA: {
        width: { ideal: 960 },
        height: { ideal: 720 },
        frameRate: { ideal: 15, max: 20 },
    },
    /** Reintento cámara ocupada (ms) — FACIAL main.js */
    CAMERA_RETRY_MS: 2000,
    /**
     * Login facial: tiempo máximo con cámara activa para completar ICAO + liveness y validar en servidor.
     * El contador se pausa mientras dura la petición HTTP de login.
     */
    LOGIN_FACE_SESSION_MS: 60_000,
    LOGIN_FACE_TIMEOUT_MESSAGE:
        'Timeout de operación en validación facial: se excedieron 60 segundos. Intente de nuevo pulsando «Ingresar con Reconocimiento Facial».',
    /** Retardo tras calidad OK antes de auto-login/captura (ms) */
    AUTO_CAPTURE_DELAY_MS: 350,
    /**
     * Corrección 2026-08-13: cooldown mínimo entre reintentos automáticos de
     * POST /api/auth/login/face. Sin esto, un fallo (p.ej. 503 por
     * limit_req de nginx en /api/auth/login/, rate=5r/m burst=5) reseteaba
     * loginSubmitTriggeredRef de inmediato y el useEffect volvía a disparar
     * en el siguiente frame (~150-200ms) -- loop de reintento sin espera que
     * agotaba el burst de nginx al instante y ya nunca podía tener éxito
     * (parpadeo constante + "Error HTTP 503" reportado en vivo). lastAutoTriggerRef
     * ya existía pero no se usaba como gate; este valor lo activa.
     */
    LOGIN_FACE_RETRY_COOLDOWN_MS: 2500,
    /** Suavizado EMA del box facial (más bajo = borde más estable) */
    FACE_BOX_EMA_ALPHA: 0.22,
    /** EMA cuando el detector salta (reflejo / falso positivo) */
    FACE_BOX_EMA_ALPHA_OUTLIER: 0.12,
    /** Ventana de mediana sobre detecciones crudas (reduce jitter) */
    FACE_BOX_HISTORY_LEN: 4,
    /** Mínimo de muestras para usar mediana */
    FACE_BOX_MEDIAN_MIN_SAMPLES: 3,
    /** Si el centro salta más que esta fracción del tamaño previo → EMA outlier */
    FACE_BOX_OUTLIER_JUMP_RATIO: 0.24,
    /** Escala del canvas de tracking respecto al ROI (más alto = más resolución para el detector) */
    TRACKING_CANVAS_SCALE: 0.74,
    /** Ecualizar histograma solo en canvas de detección si luminancia media < esto */
    TRACKING_LOW_LUM_EQ_BELOW: 78,
    /** Comprimir highlights en canvas de detección si luminancia > esto (reflejos) */
    TRACKING_HIGH_LUM_COMPRESS_ABOVE: 168,

    /** Modo noche / luz artificial dura / reflejos en paredes: histéresis 0..1 (sube con frames “difíciles”). */
    DIFFICULT_LIGHTING_ON_THRESHOLD: 0.52,
    DIFFICULT_LIGHTING_RISE_PER_FRAME: 0.2,
    DIFFICULT_LIGHTING_FALL_PER_FRAME: 0.14,
    /** Ecualizar si media Y < esto solo en modo difícil (más amplio que día) */
    NIGHT_TRACKING_LOW_LUM_EQ_BELOW: 102,
    /** Tras ecualizar/gamma, comprimir highlights si media > esto (reflejos) */
    NIGHT_TRACKING_HIGH_LUM_COMPRESS_ABOVE: 132,
    /** Gamma > 1 eleva sombras en modo difícil */
    NIGHT_TRACKING_GAMMA: 1.14,
    /** Desenfoque 3×3 en canvas de tracking solo modo difícil (reduce ruido del borde) */
    NIGHT_TRACKING_USE_BLUR: true,
    /** Más frames en mediana + EMA más bajo = borde más estable de noche */
    NIGHT_FACE_BOX_HISTORY_LEN: 5,
    NIGHT_FACE_BOX_MEDIAN_MIN_SAMPLES: 3,
    NIGHT_FACE_BOX_EMA_ALPHA: 0.16,
    NIGHT_FACE_BOX_EMA_ALPHA_OUTLIER: 0.10,
    /** Menos saltos “outlier” de noche (paredes / parpadeo de luz) */
    NIGHT_FACE_BOX_OUTLIER_JUMP_RATIO: 0.42,
    /** Un poco menos de FPS al detector en modo difícil */
    NIGHT_DETECT_FRAME_MIN_MS: 92,

    /** LivenessProcessor.cpp (modo IA / fallback): puntos por parpadeo y por evento boca */
    LIVENESS_POINTS_PER_BLINK: 35,
    LIVENESS_POINTS_PER_MOUTH_EVENT: 35,
    /** scoreReady cuando livenessScore_ >= 70 */
    LIVENESS_SCORE_PASS: 70,
    LIVENESS_MAX_SCORE: 100,
}
