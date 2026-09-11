import { useCallback, useRef, useState } from 'react'
import {
    ACTIVE_CHALLENGE_ENABLED,
    CHALLENGE_MAX_ATTEMPTS,
    createInitialChallengeState,
    type LivenessChallengeState,
    type LivenessChallengeType,
} from './livenessChallenge'

const VALID_TYPES: ReadonlySet<string> = new Set<LivenessChallengeType>([
    'turn_left',
    'turn_right',
    'shift_left',
    'shift_right',
    'move_closer',
    'move_away',
])

/**
 * Espejo del desafío de liveness activo (ADR-142/145/146) que decide el
 * SERVIDOR, extraído de AuthGateway.tsx::syncChallengeFromServer para que
 * cualquier pantalla que haga captura biométrica (login/registro principal,
 * pero también re-verificaciones de administración como
 * UserManagementView/MaintenanceBiometricModal) pueda exigir el mismo gate
 * real en vez de disparar el login/registro apenas llega a N muestras ICAO
 * -- sin esto, esas pantallas quedaban rotas en cuanto se reactivó el
 * desafío (BEEMETRY_LIVENESS_CHALLENGE_REQUIRED=true): nunca mostraban el
 * gesto pedido, así que `challenge.complete` nunca llegaba a true y el
 * backend las rechazaba siempre con `liveness_challenge_incomplete`.
 *
 * Llamar `syncChallengeFromServer(status.challenge)` con la respuesta de
 * `GET /api/status` (mismo objeto `challenge` que ya expone el backend) en
 * cada ciclo de polling, y `resetChallengeState()` al arrancar una captura
 * nueva. `challengesPassedRef.current` es la única fuente de verdad para
 * decidir si ya se puede llamar a loginWithFace/registerUser -- el servidor
 * sigue validando esto de nuevo igual (ADR-142), este ref sólo evita
 * disparar un intento que el backend va a rechazar.
 */
export function useLivenessChallengeSync() {
    const stateRef = useRef<LivenessChallengeState>(createInitialChallengeState())
    const [challengeUiState, setChallengeUiState] = useState<LivenessChallengeState>(stateRef.current)
    const challengesPassedRef = useRef(!ACTIVE_CHALLENGE_ENABLED)
    /**
     * ADR-158: true en cuanto el servidor sortea el primer desafío, es decir
     * en cuanto la captura entra en la ETAPA 2 (persona en movimiento). Las
     * pantallas lo usan para cerrar la ventana de selección del mejor frame:
     * el candidato que se envía sale exclusivamente de la etapa 1 (las 5
     * lecturas ICAO consecutivas), nunca de un frame tomado durante o después
     * del gesto. Vuelve a false sólo si el servidor reinicia toda la captura
     * a la etapa 1 (`exhausted`, ADR-156) o al resetear la captura.
     */
    const challengeStartedRef = useRef(false)
    const lastSyncedRef = useRef<{ index: number; attempt: number; type: string | null }>({
        index: -1,
        attempt: 1,
        type: null,
    })
    const flashUntilRef = useRef(0)

    const resetChallengeState = useCallback(() => {
        stateRef.current = createInitialChallengeState()
        setChallengeUiState(stateRef.current)
        challengesPassedRef.current = !ACTIVE_CHALLENGE_ENABLED
        challengeStartedRef.current = false
        lastSyncedRef.current = { index: -1, attempt: 1, type: null }
        flashUntilRef.current = 0
    }, [])

    const syncChallengeFromServer = useCallback((challenge: unknown) => {
        if (!ACTIVE_CHALLENGE_ENABLED) return
        const c = (challenge && typeof challenge === 'object' ? challenge : {}) as Record<string, unknown>
        const queue = Array.isArray(c.queue)
            ? (c.queue.filter((t): t is LivenessChallengeType => VALID_TYPES.has(t as string)) as LivenessChallengeType[])
            : []
        const complete = Boolean(c.complete)
        const index = Number(c.index ?? 0)
        const attempt = Number(c.attempt ?? 1)
        const maxAttempts = Number(c.max_attempts ?? CHALLENGE_MAX_ATTEMPTS) || CHALLENGE_MAX_ATTEMPTS
        const deadlineMsRemaining = Number(c.deadline_ms_remaining ?? 0)

        if (complete) {
            challengesPassedRef.current = true
            challengeStartedRef.current = true
            const finalQueue = queue.length ? queue : stateRef.current.queue
            lastSyncedRef.current = { index: finalQueue.length, attempt: 1, type: null }
            stateRef.current = {
                queue: finalQueue,
                index: finalQueue.length,
                status: 'success',
                deadlineAt: null,
                attempt: 1,
                maxAttempts,
            }
            setChallengeUiState(stateRef.current)
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
            if (stateRef.current.queue.length > 0) {
                stateRef.current = createInitialChallengeState()
                setChallengeUiState(stateRef.current)
                challengesPassedRef.current = !ACTIVE_CHALLENGE_ENABLED
                challengeStartedRef.current = false
                lastSyncedRef.current = { index: -1, attempt: 1, type: null }
                flashUntilRef.current = 0
            }
            return
        }

        const currentType = queue[index] ?? null
        const last = lastSyncedRef.current
        const indexAdvanced = last.index >= 0 && index > last.index
        // ADR-156: un intento nuevo trae un tipo de reto DISTINTO al anterior,
        // así que ya no se puede exigir `last.type === currentType` para
        // reconocerlo -- alcanza con que el número de intento suba.
        const retriedWithNewChallenge = !indexAdvanced && last.index === index && attempt > last.attempt
        // El servidor agotó los CHALLENGE_MAX_ATTEMPTS retos y devolvió TODA
        // la captura a la etapa 1 (contador ICAO a 0/5): vuelve a sortear
        // desde el intento 1. Se refleja limpiando el estado local, o si no
        // el flash de timeout anterior se quedaría pegado sobre un reto que
        // ya no es el que el servidor está pidiendo.
        const serverRestarted = last.index >= 0 && (index < last.index || attempt < last.attempt)
        lastSyncedRef.current = { index, attempt, type: currentType }
        // Hay cola sorteada: la captura está en la ETAPA 2 (ADR-158).
        challengeStartedRef.current = true
        if (serverRestarted) {
            challengesPassedRef.current = !ACTIVE_CHALLENGE_ENABLED
            challengeStartedRef.current = false
            flashUntilRef.current = 0
        }

        const applyPending = () => {
            stateRef.current = {
                queue,
                index,
                status: 'pending',
                deadlineAt: deadlineMsRemaining > 0 ? performance.now() + deadlineMsRemaining : null,
                attempt,
                maxAttempts,
            }
            setChallengeUiState(stateRef.current)
        }

        if (indexAdvanced) {
            // Confirmación visual breve antes de mostrar el siguiente desafío.
            flashUntilRef.current = performance.now() + 700
            stateRef.current = { queue, index: index - 1, status: 'success', deadlineAt: null, attempt: 1, maxAttempts }
            setChallengeUiState(stateRef.current)
            window.setTimeout(applyPending, 700)
            return
        }
        if (retriedWithNewChallenge) {
            // El servidor agotó la ventana del intento actual y sorteó OTRO
            // reto distinto (ADR-156) -- flash de timeout de 1200ms antes de
            // mostrar la instrucción nueva.
            flashUntilRef.current = performance.now() + 1200
            stateRef.current = { queue, index, status: 'timeout', deadlineAt: null, attempt, maxAttempts }
            setChallengeUiState(stateRef.current)
            window.setTimeout(applyPending, 1200)
            return
        }
        if (performance.now() < flashUntilRef.current) {
            // Ya se está mostrando un flash de éxito/timeout -- no lo cortes.
            return
        }
        applyPending()
    }, [])

    return {
        challengeUiState,
        challengesPassedRef,
        challengeStartedRef,
        syncChallengeFromServer,
        resetChallengeState,
    }
}
