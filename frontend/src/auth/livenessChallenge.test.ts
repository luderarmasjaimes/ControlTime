import { describe, expect, it } from 'vitest'
import {
    ACTIVE_CHALLENGE_ENABLED,
    CHALLENGE_COUNT,
    CHALLENGE_MAX_ATTEMPTS,
    CHALLENGE_TIMEOUT_MS,
    HEAD_YAW_TURN_THRESHOLD,
    MOVE_CLOSER_RATIO,
    MOVE_AWAY_RATIO,
    challengeInstructionKey,
    createInitialChallengeState,
    currentChallenge,
    isChallengeSequenceComplete,
    type LivenessChallengeState,
} from './livenessChallenge'

// ADR-142: la cola de desafíos y si cada uno se cumplió las decide el
// servidor (backend/src/biometric/liveness_challenge.cpp) -- este archivo ya
// no sortea nada ni evalúa gestos, sólo aporta tipos/constantes que deben
// coincidir con el backend y los textos de instrucción para la UI. Estas
// pruebas cubren lo que sigue siendo lógica real de cliente.

describe('livenessChallenge', () => {
    it('activa el challenge por defecto (gate real, no cosmético)', () => {
        expect(ACTIVE_CHALLENGE_ENABLED).toBe(true)
    })

    it('constants coinciden con backend/src/biometric/liveness_challenge.hpp', () => {
        // Si alguno de estos cambia, hay que actualizar también
        // kLivenessChallengeCount/kLivenessChallengeTimeoutMs/
        // kLivenessChallengeMaxAttempts/kLivenessHeadYawTurnThreshold/
        // kLivenessMoveCloserRatio/kLivenessMoveAwayRatio ahí.
        expect(CHALLENGE_COUNT).toBe(1)
        expect(CHALLENGE_TIMEOUT_MS).toBe(8000)
        expect(CHALLENGE_MAX_ATTEMPTS).toBe(5)
        expect(HEAD_YAW_TURN_THRESHOLD).toBeCloseTo(0.2)
        expect(MOVE_CLOSER_RATIO).toBeCloseTo(1.25)
        expect(MOVE_AWAY_RATIO).toBeCloseTo(0.80)
    })

    it('createInitialChallengeState arranca con cola vacía (el servidor la sortea)', () => {
        const state = createInitialChallengeState()
        expect(state.queue).toEqual([])
        expect(state.index).toBe(0)
        expect(state.status).toBe('pending')
        expect(state.deadlineAt).toBeNull()
        expect(state.attempt).toBe(1)
        expect(state.maxAttempts).toBe(CHALLENGE_MAX_ATTEMPTS)
    })

    it('currentChallenge devuelve null sin cola (antes de la primera respuesta del servidor)', () => {
        expect(currentChallenge(createInitialChallengeState())).toBeNull()
    })

    it('currentChallenge devuelve el tipo en el índice actual', () => {
        const state: LivenessChallengeState = { queue: ['move_closer', 'turn_left'], index: 1, status: 'pending', deadlineAt: null, attempt: 1, maxAttempts: CHALLENGE_MAX_ATTEMPTS }
        expect(currentChallenge(state)).toBe('turn_left')
    })

    it('isChallengeSequenceComplete es false con cola vacía (aún no llegó respuesta del servidor)', () => {
        expect(isChallengeSequenceComplete(createInitialChallengeState())).toBe(false)
    })

    it('isChallengeSequenceComplete es true cuando index alcanzó el largo de la cola', () => {
        const state: LivenessChallengeState = { queue: ['turn_left'], index: 1, status: 'success', deadlineAt: null, attempt: 1, maxAttempts: CHALLENGE_MAX_ATTEMPTS }
        expect(isChallengeSequenceComplete(state)).toBe(true)
    })

    it('isChallengeSequenceComplete es false a mitad de la cola', () => {
        const state: LivenessChallengeState = { queue: ['turn_left', 'move_away'], index: 1, status: 'pending', deadlineAt: null, attempt: 1, maxAttempts: CHALLENGE_MAX_ATTEMPTS }
        expect(isChallengeSequenceComplete(state)).toBe(false)
    })

    it('challengeInstructionKey mapea cada tipo a una clave i18n distinta', () => {
        const keys = new Set([
            challengeInstructionKey('turn_left'),
            challengeInstructionKey('turn_right'),
            challengeInstructionKey('shift_left'),
            challengeInstructionKey('shift_right'),
            challengeInstructionKey('move_closer'),
            challengeInstructionKey('move_away'),
        ])
        expect(keys.size).toBe(6)
        expect(challengeInstructionKey('turn_left')).toBe('liveness.challenge.turnLeft')
        expect(challengeInstructionKey('turn_right')).toBe('liveness.challenge.turnRight')
        expect(challengeInstructionKey('shift_left')).toBe('liveness.challenge.shiftLeft')
        expect(challengeInstructionKey('shift_right')).toBe('liveness.challenge.shiftRight')
        expect(challengeInstructionKey('move_closer')).toBe('liveness.challenge.moveCloser')
        expect(challengeInstructionKey('move_away')).toBe('liveness.challenge.moveAway')
    })
})
