/**
 * Parámetros alineados con C:\FACIAL:
 * - ICAOValidator.cpp (ojos, boca, lentes EMA, iluminación > 40; confianza ojos default 95% como FACIAL)
 * - FacialRecognitionSystem (REQUIRED_VALID_FRAMES=3, CAPTURE_COOLDOWN_MS=1000, tracking conf >= threshold-10)
 * - www/main.js (cámara 640x480, fps 15–20, JPEG proceso ~0.6)
 */
export const FACIAL_ICAO = {
    /** Frames ICAO válidos consecutivos antes de considerar captura (FACIAL REQUIRED_VALID_FRAMES) */
    REQUIRED_VALID_FRAMES: 3,
    /** Enfriamiento entre capturas automáticas (ms) */
    CAPTURE_COOLDOWN_MS: 1000,
    /** Alineado con C:\\FACIAL\\ICAOValidator.cpp confidenceThreshold_ y backend BIOMETRIC_ICAO_EYE_CONFIDENCE_MIN */
    EYE_CONFIDENCE_MIN_PERCENT: 95,
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
    /** Intervalo entre envíos al backend verify-frame (ms) */
    VERIFY_SYNC_MS: 450,
    /** Calidad JPEG para verify-frame (FACIAL process_frame usa ~0.6) */
    VERIFY_JPEG_QUALITY: 0.62,
    /** getUserMedia video ideal (FACIAL www/main.js) */
    CAMERA: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15, max: 20 },
    },
    /** Reintento cámara ocupada (ms) — FACIAL main.js */
    CAMERA_RETRY_MS: 2000,
    /** Retardo tras calidad OK antes de auto-login/captura (ms) */
    AUTO_CAPTURE_DELAY_MS: 350,
    /** Suavizado EMA del box facial (más bajo = borde más estable) */
    FACE_BOX_EMA_ALPHA: 0.16,
    /** EMA cuando el detector salta (reflejo / falso positivo) */
    FACE_BOX_EMA_ALPHA_OUTLIER: 0.05,
    /** Ventana de mediana sobre detecciones crudas (reduce jitter) */
    FACE_BOX_HISTORY_LEN: 5,
    /** Mínimo de muestras para usar mediana */
    FACE_BOX_MEDIAN_MIN_SAMPLES: 3,
    /** Si el centro salta más que esta fracción del tamaño previo → EMA outlier */
    FACE_BOX_OUTLIER_JUMP_RATIO: 0.42,
    /** Escala del canvas de tracking respecto al ROI (más alto = más resolución para el detector) */
    TRACKING_CANVAS_SCALE: 0.58,
    /** Ecualizar histograma solo en canvas de detección si luminancia media < esto */
    TRACKING_LOW_LUM_EQ_BELOW: 78,
    /** Comprimir highlights en canvas de detección si luminancia > esto (reflejos) */
    TRACKING_HIGH_LUM_COMPRESS_ABOVE: 168,

    /** LivenessProcessor.cpp (modo IA / fallback): puntos por parpadeo y por evento boca */
    LIVENESS_POINTS_PER_BLINK: 35,
    LIVENESS_POINTS_PER_MOUTH_EVENT: 35,
    /** scoreReady cuando livenessScore_ >= 70 */
    LIVENESS_SCORE_PASS: 70,
    LIVENESS_MAX_SCORE: 100,
}
