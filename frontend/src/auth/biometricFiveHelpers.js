/**
 * Cinco parámetros de validación alineados con C:\FACIAL\ICAOValidator + LivenessProcessor:
 * - Ojos / boca / frontalidad / sin lentes: mismas señales que consolidate en isCompletelyValid
 * - Liveness: LivenessProcessor.cpp puntos = parpadeos*35 + eventos boca*35, listo si score >= 70
 */

export const ICAO_EYE_ISSUES = new Set([
    'eyes_not_open_or_not_visible',
    'eye_open_confidence_low',
    'ai_face_not_detected',
    'face_not_detected',
])

export const ICAO_MOUTH_ISSUES = new Set(['mouth_not_closed'])

export const ICAO_FRONTAL_ISSUES = new Set(['face_not_frontal', 'head_pose_not_straight'])

export const ICAO_GLASSES_ISSUES = new Set(['suspected_glasses'])

/**
 * @param {string[]} issues
 * @param {boolean} localFrontal — frontalidad geométrica local (landmarks / aspecto)
 * @returns {{ eyes: boolean, mouth: boolean, frontal: boolean, noGlasses: boolean }}
 */
export function mapVerifyIssuesToIcaoFour(issues, localFrontal) {
    const list = Array.isArray(issues) ? issues : []
    const hit = (set) => list.some((i) => set.has(i))
    return {
        eyes: !hit(ICAO_EYE_ISSUES),
        mouth: !hit(ICAO_MOUTH_ISSUES),
        frontal: !hit(ICAO_FRONTAL_ISSUES) && localFrontal,
        noGlasses: !hit(ICAO_GLASSES_ISSUES),
    }
}

/**
 * @param {boolean|null|undefined} ok — null/undefined => pendiente (--)
 */
export function formatIcaoCell(ok) {
    if (ok === true) return 'OK'
    if (ok === false) return 'NO'
    return '--'
}
