/**
 * Liveness activa (challenge-response): en vez de solo contar parpadeos/boca
 * que ocurran en algún momento de la sesión (pasivo -- un video pregrabado de
 * la persona real lo cumple sin que nadie esté presente), se sortean 2
 * desafíos de una lista de 4 en orden impredecible por sesión y se le pide
 * al usuario cumplir cada uno dentro de una ventana de tiempo corta. Mismo
 * principio que usan los proveedores líderes del mercado (ISO/IEC 30107-3:
 * la liveness activa se considera más confiable que la pasiva porque exige
 * una respuesta específica, no solo "estar presente en algún momento").
 *
 * ADR-142/146: la cola de desafíos y si cada uno se cumplió las decide el
 * SERVIDOR (evaluateLivenessChallenge en
 * backend/src/biometric/liveness_challenge.cpp), a partir de los mismos
 * headYawRatio/interEyePx que ya calcula MediaPipe por frame en
 * /api/process_frame -- antes esas decisiones las tomaba este archivo con
 * datos locales del cliente, lo que permitía a un cliente scripteado
 * fingir "ya cumplí el desafío" sin que nadie hubiera visto un gesto
 * real. Este módulo ahora sólo aporta tipos, textos de instrucción y las
 * constantes que documentan qué debe coincidir con el backend; el
 * frontend (AuthGateway.tsx::syncChallengeFromServer) sólo REFLEJA el
 * `challenge` que manda GET /api/status.
 */

/**
 * REACTIVADO 2026-08-21 (ADR-126), recalibrado tras el fallo de
 * 2026-08-19: ningún intento real había completado la secuencia con la
 * ventana original de 4.5s/intento (cero peticiones al backend durante toda
 * la sesión de pruebas, con los 4 tipos de desafío igual de afectados -- no
 * era un gesto puntual fallando, era el presupuesto de tiempo total). Sin
 * telemetría de campo nueva disponible en este momento para calibrar con
 * datos reales, se opta por un ensanchamiento conservador (casi el doble de
 * ventana, un intento más antes de reemplazar el desafío) en vez de una
 * recalibración fina -- MISMO CRITERIO que ya usa este archivo para
 * `EAR_IED_REF_PX`/`EAR_IED_SCALE_MAX` en `eye_analyzer.py` (ver ADR-125):
 * preferir un ajuste amplio y verificable a ojo antes que un número
 * "exacto" sin evidencia detrás. Si una nueva ronda de pruebas reales vuelve
 * a mostrar 0% de finalización, el primer sospechoso a revisar es el tiempo
 * de LECTURA de la instrucción (el usuario necesita leer "gira a la
 * izquierda" antes de poder ejecutar el gesto, y ese tiempo de comprensión
 * consume buena parte de la ventana), no necesariamente la detección en sí.
 */
export const ACTIVE_CHALLENGE_ENABLED = true

/**
 * ADR-146 (2026-09-03): blink/mouth salieron de la lista de desafíos
 * ACTIVOS -- el parpadeo ya queda cubierto, mejor, por el parpadeo NATURAL
 * pasivo de ADR-143 (no hay que pedirlo a propósito), y abrir la boca a
 * pedido resultaba menos manejable que otros gestos. Se reemplazan por
 * move_closer/move_away (acercarse/alejarse de la cámara), a pedido
 * explícito del usuario: "mejor control y facilidad de verificación" que
 * inclinar la cabeza (primera opción probada, descartada de inmediato).
 *
 * Ampliado 2026-09-07 (pedido explícito del usuario, etapa 2 del registro/
 * login biométrico) con shift_left/shift_right: DESPLAZAR toda la cabeza de
 * lado sin girarla, distinto de turn_left/turn_right (que SÍ giran la
 * cabeza sobre su propio eje). Ver kLivenessHeadShiftRatio en
 * backend/src/biometric/liveness_challenge.hpp para la señal que lo mide
 * (faceOvalCx, no headYawRatio).
 */
export type LivenessChallengeType =
    | 'turn_left'
    | 'turn_right'
    | 'shift_left'
    | 'shift_right'
    | 'move_closer'
    | 'move_away'

export type LivenessChallengeStatus = 'pending' | 'success' | 'timeout'

export interface LivenessChallengeState {
    /** Los 2 (o CHALLENGE_COUNT) desafíos sorteados para esta sesión, en el orden a cumplir. */
    queue: LivenessChallengeType[]
    index: number
    status: LivenessChallengeStatus
    deadlineAt: number | null
    /** Cuál de los CHALLENGE_MAX_ATTEMPTS retos de la sesión se está pidiendo
     * (1..CHALLENGE_MAX_ATTEMPTS). ADR-156: cada intento es un tipo DISTINTO
     * sorteado por el servidor, no una repetición del que acaba de vencer. */
    attempt: number
    /** CHALLENGE_MAX_ATTEMPTS según el servidor (`challenge.max_attempts`),
     * para mostrar "intento 2 de 5" sin que el cliente lo adivine. */
    maxAttempts: number
}

/** Cuántos desafíos hay que cumplir por sesión. ADR-146: bajado de 2 a 1 a
 * pedido explícito del usuario. Debe coincidir con kLivenessChallengeCount
 * en backend/src/biometric/liveness_challenge.hpp. */
export const CHALLENGE_COUNT = 1

/** Ventana para cumplir CADA desafío una vez mostrado. Debe coincidir con
 * kLivenessChallengeTimeoutMs en backend/src/biometric/biometric_types.hpp
 * (el servidor es quien de verdad cuenta el tiempo, ver ADR-142). Subida de
 * 4.5s a 8s el 2026-08-21 (ADR-126) -- la original resultó en 0% de
 * finalización en pruebas reales; ver nota de reactivación arriba. */
export const CHALLENGE_TIMEOUT_MS = 8000

/**
 * ADR-156 (2026-09-04, pedido explícito del usuario): cuántas VECES se pide
 * un reto en una sesión antes de rendirse. Ya no son "reintentos del mismo
 * tipo": cada intento sortea un tipo DISTINTO al que acaba de vencer, así
 * que el reto es variado y aleatorio en cada pedido. Al vencer el intento
 * número CHALLENGE_MAX_ATTEMPTS sin cumplir ninguno, el SERVIDOR devuelve
 * toda la captura a la etapa 1 (contador ICAO a 0/5, ver
 * `exhausted`/handleProcessFrame en el backend) -- antes eran 4 reintentos
 * del mismo tipo seguidos de un reemplazo con reintentos frescos, es decir
 * un bucle infinito que dejaba la sesión colgada hasta el timeout del
 * navegador. Debe coincidir con kLivenessChallengeMaxAttempts en
 * backend/src/biometric/liveness_challenge.hpp.
 */
export const CHALLENGE_MAX_ATTEMPTS = 5

/** |head_yaw_ratio| a partir del cual se considera un giro de cabeza deliberado
 * (ver head_yaw_ratio_from_points en ai_engine/eye_analyzer.py -- 0.42 es el límite
 * de "no frontal" del chequeo ICAO, mucho más extremo; esto solo pide un giro claro
 * y visible, no forzar el límite de detección del rostro). Debe coincidir con
 * kLivenessHeadYawTurnThreshold en backend/src/biometric/liveness_challenge.hpp. */
export const HEAD_YAW_TURN_THRESHOLD = 0.20

/**
 * Proporción de interEyePx (distancia interocular en píxeles) respecto a la
 * referencia capturada por el servidor al sortear la cola, para
 * move_closer/move_away (ADR-146): acercarse agranda la cara en el frame
 * (IED sube), alejarse la achica (IED baja). Debe coincidir con
 * kLivenessMoveCloserRatio/kLivenessMoveAwayRatio en
 * backend/src/biometric/liveness_challenge.hpp -- PENDIENTE DE VALIDAR con
 * datos reales de producción, igual que HEAD_YAW_TURN_THRESHOLD en su
 * momento (ver ADR-125/126).
 */
export const MOVE_CLOSER_RATIO = 1.25
export const MOVE_AWAY_RATIO = 0.80

/**
 * Estado inicial antes de que el servidor haya sorteado su cola (recién
 * arrancada la cámara, o mientras el gate de calidad ICAO de 5 lecturas +
 * parpadeo natural todavía no se cruzó) -- cola vacía a propósito: la cola
 * real la decide evaluateLivenessChallenge en el backend (ADR-142), nunca
 * el cliente.
 */
export function createInitialChallengeState(): LivenessChallengeState {
    return {
        queue: [],
        index: 0,
        status: 'pending',
        deadlineAt: null,
        attempt: 1,
        maxAttempts: CHALLENGE_MAX_ATTEMPTS,
    }
}

export function currentChallenge(state: LivenessChallengeState): LivenessChallengeType | null {
    return state.queue[state.index] ?? null
}

export function isChallengeSequenceComplete(state: LivenessChallengeState): boolean {
    return state.queue.length > 0 && state.index >= state.queue.length
}

const INSTRUCTION_KEYS = {
    turn_left: 'liveness.challenge.turnLeft',
    turn_right: 'liveness.challenge.turnRight',
    shift_left: 'liveness.challenge.shiftLeft',
    shift_right: 'liveness.challenge.shiftRight',
    move_closer: 'liveness.challenge.moveCloser',
    move_away: 'liveness.challenge.moveAway',
} as const satisfies Record<LivenessChallengeType, string>

export function challengeInstructionKey(
    type: LivenessChallengeType
): (typeof INSTRUCTION_KEYS)[LivenessChallengeType] {
    return INSTRUCTION_KEYS[type]
}
