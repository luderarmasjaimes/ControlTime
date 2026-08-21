import { describe, expect, it } from 'vitest'
import { classifyCameraError } from './cameraErrorPolicy'

describe('classifyCameraError', () => {
    it('no reintenta un permiso denegado explícitamente (NotAllowedError)', () => {
        // Bug real: antes de esta corrección, AuthGateway.tsx reintentaba
        // getUserMedia() cada FACIAL_ICAO.CAMERA_RETRY_MS incluso tras un
        // rechazo explícito del usuario/navegador -- el navegador nunca
        // vuelve a mostrar el diálogo tras "denied", así que el efecto neto
        // era un bucle infinito de llamadas sin ningún resultado distinto.
        const decision = classifyCameraError('NotAllowedError')
        expect(decision.shouldRetry).toBe(false)
        expect(decision.messageKey).toBe('error.cameraPermission')
    })

    it('no reintenta un permiso bloqueado por política de seguridad (SecurityError)', () => {
        const decision = classifyCameraError('SecurityError')
        expect(decision.shouldRetry).toBe(false)
        expect(decision.messageKey).toBe('error.cameraPermission')
    })

    it('no reintenta cuando no hay cámara conectada (NotFoundError)', () => {
        const decision = classifyCameraError('NotFoundError')
        expect(decision.shouldRetry).toBe(false)
        expect(decision.messageKey).toBe('error.cameraNotFound')
    })

    it('no reintenta cuando ninguna cámara cumple las restricciones pedidas (OverconstrainedError)', () => {
        const decision = classifyCameraError('OverconstrainedError')
        expect(decision.shouldRetry).toBe(false)
        expect(decision.messageKey).toBe('error.cameraNotFound')
    })

    it('sí reintenta cuando la cámara está ocupada por otra app (NotReadableError)', () => {
        const decision = classifyCameraError('NotReadableError')
        expect(decision.shouldRetry).toBe(true)
        expect(decision.messageKey).toBe('error.cameraBusy')
    })

    it('sí reintenta cuando el track no pudo iniciar (TrackStartError)', () => {
        const decision = classifyCameraError('TrackStartError')
        expect(decision.shouldRetry).toBe(true)
        expect(decision.messageKey).toBe('error.cameraBusy')
    })

    it('no reintenta errores desconocidos/no clasificados', () => {
        const decision = classifyCameraError('AbortError')
        expect(decision.shouldRetry).toBe(false)
        expect(decision.messageKey).toBe('error.cameraOpen')
    })

    it('no reintenta cuando el nombre de error viene vacío', () => {
        const decision = classifyCameraError('')
        expect(decision.shouldRetry).toBe(false)
        expect(decision.messageKey).toBe('error.cameraOpen')
    })
})
