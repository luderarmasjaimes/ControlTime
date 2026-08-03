/**
 * Los blobs .webm que produce MediaRecorder no traen escrito el elemento
 * EBML Duration ni un índice de búsqueda (comportamiento documentado de
 * Chromium/Firefox al grabar en streaming por chunks, no un bug de esta
 * app) -- un <video src> plano con ese blob/data-URL a menudo pinta en
 * negro con "0:00" porque el decoder nunca llega a decodificar/mostrar un
 * frame real hasta que el navegador construye su propio índice de búsqueda.
 *
 * Corrección 2026-08-01 (2ª vuelta -- verificado en vivo con grabación REAL
 * de cámara y de pantalla que el intento anterior seguía en negro): un
 * simple seek a un tiempo pequeño (`currentTime = 0.05`) no basta, porque
 * MediaRecorder no garantiza un keyframe exactamente ahí -- si el seek cae
 * sobre un P-frame sin su keyframe de referencia ya decodificado, el
 * navegador simplemente no tiene nada que pintar (negro), sin importar
 * cuántas veces se reintente el seek. La solución robusta es reproducir
 * brevemente (silenciado, para que el navegador no bloquee el autoplay
 * programático) y pausar poco después: reproducir SIEMPRE avanza
 * correctamente desde el primer keyframe real disponible (es el mismo
 * mecanismo que usa el reproductor nativo al darle Play), a diferencia de
 * un seek ciego a un punto arbitrario.
 */
export function fixRecordedVideoElement(video: HTMLVideoElement | null): void {
  if (!video) return;
  const marked = video as HTMLVideoElement & { __durationFixSrc?: string };
  const currentSrc = video.currentSrc || video.src;
  if (!currentSrc || marked.__durationFixSrc === currentSrc) return;
  marked.__durationFixSrc = currentSrc;

  const playThenPauseToPaint = () => {
    const wasMuted = video.muted;
    // Silenciado a propósito: un play() disparado por código (no por click
    // del usuario) puede ser bloqueado por la política de autoplay del
    // navegador salvo que el video esté muted -- sin esto, playPromise
    // rechaza y nunca llegamos a pintar nada.
    video.muted = true;
    const restore = () => {
      video.pause();
      video.muted = wasMuted;
    };
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.then(() => { setTimeout(restore, 220); }).catch(() => { video.muted = wasMuted; });
    } else {
      setTimeout(restore, 220);
    }
  };

  const onLoadedMetadata = () => {
    if (video.duration === Infinity || Number.isNaN(video.duration)) {
      // Sin índice de búsqueda (típico de un webm streameado por chunks):
      // forzar un escaneo completo primero para que el navegador reporte
      // una duración real -- independiente del fix de "pintar un frame"
      // (reproducir) que sigue abajo sin importar si esto funcionó o no.
      const onSeekedToEnd = () => {
        video.removeEventListener('seeked', onSeekedToEnd);
        video.currentTime = 0;
        playThenPauseToPaint();
      };
      video.addEventListener('seeked', onSeekedToEnd, { once: true });
      video.currentTime = 1e101;
    } else {
      playThenPauseToPaint();
    }
  };

  // Si el <video> es un nodo DOM reutilizado (mismo elemento, `src` nuevo)
  // los metadatos del nuevo recurso puede que YA estén listos para cuando
  // se llama esta función (p. ej. si el navegador cachea agresivamente) --
  // en ese caso 'loadedmetadata' del nuevo `src` podría no volver a
  // disparar; se chequea `readyState` para cubrir ese caso también.
  if (video.readyState >= 1) {
    onLoadedMetadata();
  } else {
    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
  }
}
