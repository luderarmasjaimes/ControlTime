/**
 * logger.ts — Logger con gate de entorno para el frontend.
 *
 * Problema que resuelve: el código tenía 50+ `console.log/warn/error` sueltos
 * que llegaban a producción (ruido en consola, posible fuga de información y
 * overhead). Este módulo centraliza el logging y lo silencia en producción,
 * salvo errores, que siempre se emiten porque son accionables.
 *
 * Activación de logs de debug en producción: definir `VITE_DEBUG=true` al build,
 * o `localStorage.setItem('beemetry:debug','1')` en runtime.
 *
 * Uso:
 *   import { log } from '@/lib/logger';   // o ruta relativa
 *   log.debug('cargando informe', reportId);
 *   log.warn('widget sin snapshot, mostrando sin dato');
 *   log.error('fallo al guardar', err);   // siempre visible
 */

function debugEnabled(): boolean {
  try {
    // Vite: import.meta.env.DEV es true en `npm run dev`.
    if (import.meta?.env?.DEV) return true;
    if (import.meta?.env?.VITE_DEBUG === 'true') return true;
  } catch {
    /* import.meta no disponible (tests/SSR) → seguir con localStorage */
  }
  try {
    return typeof localStorage !== 'undefined' &&
      localStorage.getItem('beemetry:debug') === '1';
  } catch {
    return false;
  }
}

const enabled = debugEnabled();

export interface Logger {
  /** Diagnóstico verboso; solo en debug. */
  debug: (...args: unknown[]) => void;
  /** Información de flujo; solo en debug. */
  info: (...args: unknown[]) => void;
  /** Advertencia no fatal; solo en debug. */
  warn: (...args: unknown[]) => void;
  /** Error accionable; SIEMPRE visible. */
  error: (...args: unknown[]) => void;
  /** Estado del gate de debug (para condicionales caros). */
  isDebug: () => boolean;
}

export const log: Logger = {
  debug: (...args) => { if (enabled) console.log('[beemetry]', ...args); },
  info: (...args) => { if (enabled) console.info('[beemetry]', ...args); },
  warn: (...args) => { if (enabled) console.warn('[beemetry]', ...args); },
  error: (...args) => { console.error('[beemetry]', ...args); },
  isDebug: () => enabled,
};

export default log;
