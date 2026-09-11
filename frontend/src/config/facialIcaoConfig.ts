/**
 * Parámetros alineados con C:\FACIAL (www/main.js, canvas 640×480, etc.).
 *
 * --- Resumen de algoritmos / componentes (biométrica ICAO en esta app) ---
 * | Ámbito | Tecnología |
 * |--------|------------|
 * | Borde del rostro (óvalo UI) | Navegador: MediaPipe Tasks Vision (WASM local, `mediapipeFaceTracker.ts`, ADR-162) + canvas preprocesado (JS: BT.601, histograma, gamma, blur 3×3 solo en modo noche/reflejos). Mismos índices de landmarks (478 puntos) que `ai_engine/eye_analyzer.py`. |
 * | Validación servidor | C++17 (Boost.Beast): JPEG, umbral de iluminación, EMA lentes, llamada HTTP al motor IA. |
 * | Ojos / boca / lentes en frame | Python 3 + MediaPipe Tasks Face Landmarker + OpenCV (NumPy) en `ai_engine/eye_analyzer.py`. |
 * | Plantilla / match facial (login/registro) | Cliente: vector 24×24 desde JPEG 640×480 con máscara elíptica (`biometricOvalFrame.js`); backend C++ OpenCV legacy o Dermalog si aplica. |
 *
 * OpenCV en el cliente: no. MediaPipe Tasks Vision SÍ corre en el cliente
 * desde ADR-162 (WASM, self-hosted en frontend/public/mediapipe/ por el CSP
 * `connect-src 'self'` de nginx.conf) -- antes solo corría en Python
 * (ai_engine) y en el binario C++ del backend (Haar cascade de
 * `realtime_face_tracker.cpp`, que sigue existiendo pero ya no decide el
 * óvalo VISIBLE, ver ovalForStage en AuthGateway.tsx).
 */
export const FACIAL_ICAO = {
    /**
     * Frames ICAO válidos consecutivos antes de considerar captura completa
     * (FACIAL REQUIRED_VALID_FRAMES). 5 lecturas (ADR-143; pasó por 3 en
     * ADR-142). Subido de nuevo a pedido explícito del usuario para cerrar
     * la validación biométrica de cara a producción -- ya no hace falta
     * elegir entre "más lecturas" y "tolerar el parpadeo natural": un
     * parpadeo breve durante la captura NO cuenta como frame inválido en el
     * backend (ver NaturalBlinkState/updateNaturalBlink en
     * liveness_challenge.hpp), así que subir el número de lecturas no
     * penaliza a nadie por parpadear con normalidad. Debe coincidir con
     * backend/src/biometric/biometric_types.hpp
     * (kRequiredValidCaptureFrames) -- el backend es quien manda de verdad
     * (ver `capture_count`/`quality_gate_reached` en GET /api/status); este
     * valor sólo controla el contador visual local del cliente.
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
    /** Umbral apertura boca local (MAR real, MediaPipe -- ver mar_inner_ratio() en
     * ai_engine/eye_analyzer.py: abre >0.056, cierra <0.040 con histéresis allá). Antes
     * era 0.2 para un ratio ancho/alto tosco de FaceDetector -- ADR-162 cambió la fórmula
     * de origen (EAR/MAR reales de MediaPipe, misma escala que el backend), así que el
     * umbral tuvo que recalibrarse a la escala real en vez de mantenerse "por compatibilidad". */
    MOUTH_OPEN_LANDMARK_RATIO: 0.05,
    /** Intervalo mínimo entre frames de detección (~30 fps): seguimiento visual inmediato del óvalo. */
    DETECT_FRAME_MIN_MS: 33,
    /** Intervalo entre envíos al backend: más bajo para que los retos respondan en tiempo real. */
    VERIFY_SYNC_MS: 80,
    /** Calidad JPEG para verify-frame: sube detalle facial sin abandonar el encode adaptativo. */
    VERIFY_JPEG_QUALITY: 0.72,
    /** getUserMedia video ideal. Antes 640x480 (FACIAL www/main.js), subido a
     * 960x720 el 2026-08-19 (misma razón: EAR/parpadeo de MediaPipe se
     * degradaba a distancia media/lejana por falta de píxeles en la región
     * del ojo). Se probó 1280x960 el 2026-09-03 pero se revirtió el
     * 2026-09-04: reproducido en vivo, con esa resolución `ideal` la cámara
     * queda "Activa" (el stream se obtiene, sin error de permiso) pero el
     * `<video>` nunca pinta un frame real y la sesión termina en el timeout
     * de 120s sin que el usuario pueda avanzar -- el driver/webcam usado en
     * la prueba no negocia bien ese modo 4:3 a esa resolución+framerate.
     * Este mismo valor también fija el tamaño del canvas JPEG enviado al
     * servidor (frameToJpegBase64/buildFullFrameJpegBase64FromVideo), no
     * solo la resolución pedida a getUserMedia -- si se vuelve a subir,
     * reescalar proporcionalmente EAR_IED_REF en ai_engine/eye_analyzer.py
     * (ver comentario ahí) es el único umbral en píxeles absolutos atado a
     * esta resolución. */
    CAMERA: {
        width: { ideal: 960 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
    },
    /** Reintento cámara ocupada (ms) — FACIAL main.js */
    CAMERA_RETRY_MS: 2000,
    /**
     * Login facial: tiempo máximo con cámara activa para completar ICAO +
     * liveness y validar en servidor. El contador se pausa mientras dura la
     * petición HTTP de login. Subido de 60s a 120s (ADR-145, 2026-09-03):
     * el flujo ahora tiene 3 etapas en vez de 1 (5 lecturas ICAO + espera
     * pasiva de un parpadeo natural, que no se le pide a la persona y puede
     * tardar varios segundos si está concentrada mirando la cámara + 2
     * desafíos activos SECUENCIALES de hasta 8s×4 intentos cada uno = hasta
     * 64s sólo en desafíos en el peor caso). Con 60s el usuario podía perder
     * el progreso por timeout antes de completar las 3 etapas, sintiéndose
     * como que "nunca avanza" aunque cada etapa individual funcionara bien.
     */
    LOGIN_FACE_SESSION_MS: 120_000,
    LOGIN_FACE_TIMEOUT_MESSAGE:
        'Timeout de operación en validación facial: se excedieron 120 segundos. Intente de nuevo pulsando «Ingresar con Reconocimiento Facial».',
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
    /** Suavizado EMA del box facial (alto = reacción más rápida) */
    FACE_BOX_EMA_ALPHA: 0.78,
    /** EMA cuando el detector salta (reflejo / falso positivo) */
    FACE_BOX_EMA_ALPHA_OUTLIER: 0.18,
    /** Ventana de mediana sobre detecciones crudas (baja = menos latencia) */
    FACE_BOX_HISTORY_LEN: 2,
    /** Mínimo de muestras para usar mediana */
    FACE_BOX_MEDIAN_MIN_SAMPLES: 1,
    /** Si el centro salta más que esta fracción del tamaño previo → EMA outlier */
    FACE_BOX_OUTLIER_JUMP_RATIO: 0.30,
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
    /** Modo difícil mantiene algo de estabilidad sin frenar varios frames el borde. */
    NIGHT_FACE_BOX_HISTORY_LEN: 3,
    NIGHT_FACE_BOX_MEDIAN_MIN_SAMPLES: 2,
    NIGHT_FACE_BOX_EMA_ALPHA: 0.58,
    NIGHT_FACE_BOX_EMA_ALPHA_OUTLIER: 0.16,
    /** Menos saltos “outlier” de noche (paredes / parpadeo de luz) */
    NIGHT_FACE_BOX_OUTLIER_JUMP_RATIO: 0.42,
    /** Un poco menos de FPS al detector en modo difícil */
    NIGHT_DETECT_FRAME_MIN_MS: 45,

    /** LivenessProcessor.cpp (modo IA / fallback): puntos por parpadeo y por evento boca */
    LIVENESS_POINTS_PER_BLINK: 35,
    LIVENESS_POINTS_PER_MOUTH_EVENT: 35,
    /** scoreReady cuando livenessScore_ >= 70 */
    LIVENESS_SCORE_PASS: 70,
    LIVENESS_MAX_SCORE: 100,
}
