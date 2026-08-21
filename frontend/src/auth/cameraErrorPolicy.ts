export type CameraErrorMessageKey =
    | 'error.cameraPermission'
    | 'error.cameraNotFound'
    | 'error.cameraBusy'
    | 'error.cameraOpen'

export interface CameraErrorDecision {
    messageKey: CameraErrorMessageKey
    /**
     * Solo true para errores transitorios (cámara ocupada por otra app):
     * un permiso denegado (NotAllowedError/SecurityError) nunca debe
     * reintentarse -- el navegador recuerda el rechazo por origen y
     * getUserMedia() vuelve a rechazar de inmediato en cada intento, sin
     * mostrar el diálogo de nuevo. Reintentar ahí solo produce un bucle de
     * llamadas sin ningún efecto visible.
     */
    shouldRetry: boolean
}

export function classifyCameraError(errorName: string): CameraErrorDecision {
    if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
        return { messageKey: 'error.cameraPermission', shouldRetry: false }
    }
    if (errorName === 'NotFoundError' || errorName === 'OverconstrainedError') {
        return { messageKey: 'error.cameraNotFound', shouldRetry: false }
    }
    if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        return { messageKey: 'error.cameraBusy', shouldRetry: true }
    }
    return { messageKey: 'error.cameraOpen', shouldRetry: false }
}
