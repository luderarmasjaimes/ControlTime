import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * React.lazy() que sobrevive a un deploy mientras la pestaña ya estaba
 * abierta: el bundle raíz (ya cargado en el navegador) referencia el chunk
 * con el hash de la build ANTERIOR; tras reconstruir el frontend ese archivo
 * ya no existe en el servidor, el import() dinámico devuelve 404 y
 * React.lazy relanza esa falla como excepción de render -- ViewErrorBoundary
 * la atrapa con un mensaje genérico que no tiene relación con un bug real de
 * la vista. Se reintenta UNA vez con un reload completo de la página (trae
 * el index.html/manifiesto de chunks actual); si vuelve a fallar después del
 * reload, se deja propagar el error normalmente (evita un loop infinito de
 * recargas cuando la falla es real, p.ej. sin conexión).
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    const storageKey = 'beemetry:chunk-reload-attempted';
    try {
      const mod = await factory();
      sessionStorage.removeItem(storageKey);
      return mod;
    } catch (err) {
      if (sessionStorage.getItem(storageKey) !== '1') {
        sessionStorage.setItem(storageKey, '1');
        window.location.reload();
        // La página se está recargando -- no hay nada útil que resolver o
        // rechazar mientras tanto.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
