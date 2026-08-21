/**
 * Liveness activa (challenge-response): en vez de solo contar parpadeos/boca
 * que ocurran en algún momento de la sesión (pasivo -- un video pregrabado de
 * la persona real lo cumple sin que nadie esté presente), se sortean 2
 * desafíos de una lista de 4 en orden impredecible por sesión y se le pide
 * al usuario cumplir cada uno dentro de una ventana de tiempo corta. Mismo
 * principio que usan los proveedores líderes del mercado (ISO/IEC 30107-3:
 * la liveness activa se considera más confiable que la pasiva porque exige
 * una respuesta específica, no solo "estar presente en algún momento").
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

export type LivenessChallengeType = 'blink' | 'mouth' | 'turn_left' | 'turn_right'

export type LivenessChallengeStatus = 'pending' | 'success' | 'timeout'

export interface LivenessChallengeState {
    /** Los 2 (o CHALLENGE_COUNT) desafíos sorteados para esta sesión, en el orden a cumplir. */
    queue: LivenessChallengeType[]
    index: number
    status: LivenessChallengeStatus
    deadlineAt: number | null
    /** Reintentos del desafío ACTUAL (mismo desafío, no se cambia por un timeout -- evita que
     * el usuario nunca pueda completar la sesión si un gesto en particular le cuesta más). */
    attempt: number
}

const ALL_CHALLENGES: LivenessChallengeType[] = ['blink', 'mouth', 'turn_left', 'turn_right']

/** Cuántos desafíos hay que cumplir por sesión. */
export const CHALLENGE_COUNT = 2

/** Ventana para cumplir CADA desafío una vez mostrado. Subida de 4.5s a 8s
 * el 2026-08-21 (ADR-126) -- la original resultó en 0% de finalización en
 * pruebas reales; ver nota de reactivación arriba. */
export const CHALLENGE_TIMEOUT_MS = 8000

/** Reintentos del mismo desafío antes de sortear uno nuevo en su lugar (nunca se traba).
 * Subido de 3 a 4 el 2026-08-21 junto con CHALLENGE_TIMEOUT_MS (ADR-126). */
export const CHALLENGE_MAX_ATTEMPTS = 4

/** |head_yaw_ratio| a partir del cual se considera un giro de cabeza deliberado
 * (ver head_yaw_ratio_from_points en ai_engine/eye_analyzer.py -- 0.42 es el límite
 * de "no frontal" del chequeo ICAO, mucho más extremo; esto solo pide un giro claro
 * y visible, no forzar el límite de detección del rostro). */
export const HEAD_YAW_TURN_THRESHOLD = 0.20

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

/** Sortea CHALLENGE_COUNT desafíos distintos, en orden aleatorio. */
export function pickChallengeQueue(): LivenessChallengeType[] {
    return shuffle(ALL_CHALLENGES).slice(0, CHALLENGE_COUNT)
}

/** Sortea un reemplazo para `exclude` (usado cuando un desafío agota sus reintentos). */
export function pickReplacementChallenge(exclude: LivenessChallengeType[]): LivenessChallengeType {
    const pool = ALL_CHALLENGES.filter((c) => !exclude.includes(c))
    if (pool.length === 0) {
        // Los 4 ya están en la cola (CHALLENGE_COUNT>=4): no hay reemplazo posible,
        // se repite el mismo tipo con reintentos frescos.
        return exclude[exclude.length - 1]
    }
    return pool[Math.floor(Math.random() * pool.length)]
}

export function createInitialChallengeState(): LivenessChallengeState {
    return {
        queue: pickChallengeQueue(),
        index: 0,
        status: 'pending',
        deadlineAt: null,
        attempt: 1,
    }
}

export function currentChallenge(state: LivenessChallengeState): LivenessChallengeType | null {
    return state.queue[state.index] ?? null
}

export function isChallengeSequenceComplete(state: LivenessChallengeState): boolean {
    return state.index >= state.queue.length
}

/** Evalúa si el head_yaw_ratio del frame actual satisface un desafío de giro pendiente. */
export function yawSatisfiesChallenge(
    challenge: LivenessChallengeType,
    headYawRatio: number
): boolean {
    if (challenge === 'turn_left') {
        return headYawRatio >= HEAD_YAW_TURN_THRESHOLD
    }
    if (challenge === 'turn_right') {
        return headYawRatio <= -HEAD_YAW_TURN_THRESHOLD
    }
    return false
}

const INSTRUCTION_KEYS = {
    blink: 'liveness.challenge.blink',
    mouth: 'liveness.challenge.mouth',
    turn_left: 'liveness.challenge.turnLeft',
    turn_right: 'liveness.challenge.turnRight',
} as const satisfies Record<LivenessChallengeType, string>

export function challengeInstructionKey(
    type: LivenessChallengeType
): (typeof INSTRUCTION_KEYS)[LivenessChallengeType] {
    return INSTRUCTION_KEYS[type]
}
