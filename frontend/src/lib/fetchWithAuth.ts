/**
 * Re-exporta `authFetch` de `auth/authApi.ts` bajo el nombre histórico
 * `fetchWithAuthRetry` (ADR-041 — consolidación de las 3 implementaciones
 * paralelas de fetch-con-reintento-de-sesión detectadas en auditoría:
 * el interceptor axios de ReportStudioV2 sigue siendo una implementación
 * separada por necesidad, ya que opera sobre un cliente HTTP distinto —
 * pero las dos implementaciones basadas en `fetch()` nativo, antes
 * duplicadas, ahora convergen en una sola función real).
 *
 * No se renombran los call sites existentes (AdvancedSensors.tsx,
 * VideoDiagram.tsx, alarmStream.ts) para minimizar el diff — importan
 * `fetchWithAuthRetry` de aquí exactamente igual que antes.
 */
export { authFetch as fetchWithAuthRetry } from '../auth/authApi';
