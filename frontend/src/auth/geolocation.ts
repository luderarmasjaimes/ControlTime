import { log } from '../lib/logger'

export interface GeoLocationSample {
    latitude: number
    longitude: number
    accuracy: number
    capturedAt: string
}

const CACHE_KEY = 'beemetry_login_geo_v1'
/** Ventana de reuso dentro de la misma sesión de navegador -- evita volver a
 * pedirle la posición al SO en cada intento de login facial consecutivo.
 * No reemplaza ni suprime el permiso del navegador: el usuario ya lo otorgó
 * (o lo negó) la primera vez; esto solo evita llamadas repetidas. */
const CACHE_MAX_AGE_MS = 5 * 60 * 1000

function readCache(): GeoLocationSample | null {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as GeoLocationSample
        const age = Date.now() - new Date(parsed.capturedAt).getTime()
        if (!Number.isFinite(age) || age > CACHE_MAX_AGE_MS) return null
        return parsed
    } catch {
        return null
    }
}

function writeCache(sample: GeoLocationSample): void {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(sample))
    } catch {
        // sessionStorage puede no estar disponible (modo privado); no es crítico.
    }
}

/**
 * Ubicación aproximada de la PC cliente, capturada vía la API estándar de
 * geolocalización del navegador (nunca desde el servidor). Requiere el
 * consentimiento nativo del navegador -- no existe forma legítima de omitir
 * ese diálogo desde el cliente, y no debe intentarse: la ubicación es un dato
 * personal sensible, más aún combinada con biometría facial.
 *
 * Best-effort y no bloqueante: si el usuario rechaza el permiso, el
 * dispositivo no tiene servicio de ubicación, o se agota el tiempo, resuelve
 * `null` y el login facial continúa sin ubicación.
 */
export async function getBestEffortLocation(timeoutMs = 4000): Promise<GeoLocationSample | null> {
    const cached = readCache()
    if (cached) return cached

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return null
    }

    return new Promise((resolve) => {
        let settled = false
        const finish = (value: GeoLocationSample | null) => {
            if (settled) return
            settled = true
            resolve(value)
        }
        const timer = setTimeout(() => finish(null), timeoutMs)

        navigator.geolocation.getCurrentPosition(
            ({ coords, timestamp }) => {
                clearTimeout(timer)
                const sample: GeoLocationSample = {
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    accuracy: coords.accuracy,
                    capturedAt: new Date(timestamp).toISOString(),
                }
                writeCache(sample)
                finish(sample)
            },
            (error) => {
                clearTimeout(timer)
                log.info('[AUTH_GEO] no se pudo obtener ubicación', {
                    code: error.code,
                    message: error.message,
                })
                finish(null)
            },
            { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: CACHE_MAX_AGE_MS }
        )
    })
}
