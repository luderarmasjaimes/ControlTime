import {
  getSession,
  isAccessTokenExpiringSoon,
} from './authStorage';
import { refreshAccessToken } from './authApi';
import { log } from '../lib/logger';

const CHECK_INTERVAL_MS = 30_000; // 30 segundos
const REFRESH_MARGIN_SECONDS = 120; // 2 minutos antes de expirar

let intervalId: number | null = null;
let started = false;
let refreshing = false;

async function ensureFreshAccessToken(reason: string): Promise<void> {
  if (refreshing) {
    return;
  }

  const session = getSession();

  // No hay sesión local: no hacemos nada.
  if (!session) {
    return;
  }

  if (!isAccessTokenExpiringSoon(REFRESH_MARGIN_SECONDS)) {
    return;
  }

  refreshing = true;

  try {
    log.info('[AUTH_SESSION] Renovando access token', {
      reason,
    });

    const refreshed = await refreshAccessToken();

    if (refreshed) {
      log.info('[AUTH_SESSION] Access token renovado correctamente');
    } else {
      log.warn('[AUTH_SESSION] No se pudo renovar el access token');
    }
  } catch (error) {
    log.warn('[AUTH_SESSION] Error durante refresh preventivo', error);
  } finally {
    refreshing = false;
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    void ensureFreshAccessToken('visibilitychange');
  }
}

function handleWindowFocus(): void {
  void ensureFreshAccessToken('focus');
}

export function startAuthSessionManager(): () => void {
  if (started) {
    return () => {};
  }

  started = true;

  // Primera comprobación al arrancar la SPA.
  void ensureFreshAccessToken('startup');

  intervalId = window.setInterval(() => {
    void ensureFreshAccessToken('interval');
  }, CHECK_INTERVAL_MS);

  document.addEventListener(
    'visibilitychange',
    handleVisibilityChange,
  );

  window.addEventListener('focus', handleWindowFocus);

  return () => {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }

    document.removeEventListener(
      'visibilitychange',
      handleVisibilityChange,
    );

    window.removeEventListener('focus', handleWindowFocus);

    started = false;
  };
}