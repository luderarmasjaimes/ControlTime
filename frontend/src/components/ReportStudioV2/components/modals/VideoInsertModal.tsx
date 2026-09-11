import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Video as VideoIcon, Camera, MonitorPlay, X, Check, RefreshCw, Circle, Square, AlertCircle } from 'lucide-react';
import { fixRecordedVideoElement } from '../../lib/videoDurationFix';

/**
 * Tope de grabación insertable en el lienzo: el video queda embebido como
 * data URL base64 dentro del JSON del documento (mismo patrón que las
 * imágenes, ver ImageInsertModal.tsx) -- no hay endpoint de almacenamiento
 * de blobs de video en el backend todavía. 60s a bitrate por defecto de
 * MediaRecorder produce un archivo de pocos MB, razonable para ese patrón;
 * grabaciones más largas convendría subirlas a un storage real (MinIO) en
 * vez de inline -- queda como mejora futura si el uso lo pide.
 */
const MAX_RECORDING_SECONDS = 60;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Pide cámara+micrófono; si falla (sin micrófono físico, permiso de audio
 * denegado, o cualquier otro motivo), reintenta solo con video antes de
 * darse por vencido. Sin este fallback, `getUserMedia({video:true,
 * audio:true})` rechaza la promesa COMPLETA en cuanto el audio falla —la
 * cámara nunca llega a activarse aunque el video en sí funcione
 * perfectamente— que es justamente por qué la toma de fotos (solo video,
 * ver ImageInsertModal.tsx) funcionaba mientras la grabación de video
 * (video+audio) no activaba la cámara en equipos sin micrófono utilizable.
 */
async function getUserMediaWithAudioFallback(): Promise<{ stream: MediaStream; hasAudio: boolean }> {
  try {
    // Sin ideal de resolución, el navegador elegía su default (a menudo
    // 640x480) para un video que termina insertado en el informe.
    const videoConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
    return { stream, hasAudio: stream.getAudioTracks().length > 0 };
  } catch {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    return { stream, hasAudio: false };
  }
}

function pickSupportedMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return 'video/webm';
}

interface VideoInsertModalProps {
  onClose: () => void;
  onComplete: (dataUrl: string, meta: { source: 'webcam' | 'screen'; durationSeconds: number; mimeType: string; posterDataUrl?: string }) => void;
  initialTab?: 'webcam' | 'screen';
}

/**
 * Modal "Insertar video": dos orígenes de grabación --
 * (a) cámara web (getUserMedia) y (b) pantalla/ventana seleccionada
 * (getDisplayMedia, mismo mecanismo que ya usaba el botón "Grabar" del
 * TopToolbar para exportar un video del informe -- acá el resultado se
 * inserta como bloque en el lienzo en vez de descargarse).
 */
function VideoInsertModal({ onClose, onComplete, initialTab = 'webcam' }: VideoInsertModalProps) {
  const [tab, setTab] = useState<'webcam' | 'screen'>(initialTab);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [posterDataUrl, setPosterDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resultVideoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPreviewStream(null);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Vista previa en vivo de la cámara web al abrir esa pestaña (sin grabar
  // todavía) -- mismo criterio que la pestaña "camera" de ImageInsertModal.
  useEffect(() => {
    if (tab !== 'webcam' || recordedUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const { stream: ms } = await getUserMediaWithAudioFallback();
        if (cancelled) {
          ms.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = ms;
        setPreviewStream(ms);
        setError(null);
      } catch (e) {
        setError('No se pudo acceder a la cámara web. Verifique permisos del navegador.');
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [tab, recordedUrl, stopStream]);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  useEffect(() => {
    if (resultVideoRef.current && recordedUrl) {
      resultVideoRef.current.src = recordedUrl;
      // El blob que produce MediaRecorder no trae Duration/índice de
      // búsqueda -- sin este fix la vista previa (igual que el bloque ya
      // insertado en el lienzo) se ve en negro con "0:00" hasta que el
      // usuario arrastra el control manualmente (ver lib/videoDurationFix.ts).
      fixRecordedVideoElement(resultVideoRef.current);
      setPosterDataUrl(null);
      // `fixRecordedVideoElement` reproduce brevemente y pausa ~220ms después
      // para forzar el pintado de un frame real -- se espera un margen extra
      // antes de capturarlo a un <canvas> como miniatura ("poster"), que se
      // adjunta al elemento insertado para que DOCX/PDF puedan mostrar una
      // imagen real del video en vez de solo texto (formatos que no pueden
      // reproducir video embebido).
      const captureTimer = setTimeout(() => {
        const video = resultVideoRef.current;
        if (!video || !video.videoWidth || !video.videoHeight) return;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          setPosterDataUrl(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          // Sin póster el DOCX cae al placeholder de texto ya existente --
          // no rompe la inserción del video en el lienzo.
        }
      }, 450);
      return () => clearTimeout(captureTimer);
    }
  }, [recordedUrl]);

  useEffect(() => () => {
    stopStream();
    clearTimer();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const beginRecording = useCallback(async (source: 'webcam' | 'screen') => {
    setError(null);
    let stream: MediaStream;
    try {
      if (source === 'webcam') {
        stream = streamRef.current ?? (await getUserMediaWithAudioFallback()).stream;
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          setError('Grabación de pantalla no disponible en este navegador.');
          return;
        }
        // El propio navegador muestra el selector nativo de ventana/pestaña/
        // pantalla completa -- no hay forma de preseleccionarlo desde código.
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      }
    } catch (e) {
      setError('No se pudo iniciar la grabación (permiso denegado o cancelado).');
      return;
    }

    streamRef.current = stream;
    setPreviewStream(stream);
    chunksRef.current = [];
    const mimeType = pickSupportedMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setPreviewStream(null);
      clearTimer();
      setIsRecording(false);
      // Se convierte a data URL acá mismo (no recién al confirmar) para que
      // la vista previa de revisión use exactamente el mismo `<video src>`
      // (data:) que ya termina insertado en el lienzo -- un `blob:` de
      // URL.createObjectURL usado solo para la vista previa se veía en
      // negro con "0:00" pese a fixRecordedVideoElement, mientras el data:
      // URL (ver ADR-064, Corrección 2026-08-17) ya está verificado
      // funcionando de punta a punta.
      setBusy(true);
      try {
        const dataUrl = await blobToDataUrl(blob);
        setRecordedBlob(blob);
        setRecordedUrl(dataUrl);
      } catch (e) {
        setError('No se pudo procesar la grabación.');
      } finally {
        setBusy(false);
      }
    };

    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    recorder.start(300);
    setIsRecording(true);
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSeconds(secs);
      if (secs >= MAX_RECORDING_SECONDS && recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }
    }, 250);

    // Si el usuario detiene la grabación de pantalla desde el control nativo
    // del navegador (no desde nuestro botón), el track termina solo -- hay
    // que cerrar la grabación igual.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    });
  }, [clearTimer]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  const discardAndRetry = useCallback(() => {
    setRecordedUrl(null);
    setRecordedBlob(null);
    setElapsedSeconds(0);
  }, []);

  const handleConfirmInsert = useCallback(() => {
    if (!recordedUrl || !recordedBlob) return;
    onComplete(recordedUrl, {
      source: tab,
      durationSeconds: elapsedSeconds,
      mimeType: recordedBlob.type || 'video/webm',
      posterDataUrl: posterDataUrl || undefined,
    });
  }, [recordedUrl, recordedBlob, tab, elapsedSeconds, posterDataUrl, onComplete]);

  const switchTab = useCallback((next: 'webcam' | 'screen') => {
    if (isRecording) return;
    discardAndRetry();
    stopStream();
    setError(null);
    setTab(next);
  }, [isRecording, discardAndRetry, stopStream]);

  return (
    <div className="fixed inset-0 z-[20000] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-200"><VideoIcon size={20} /></div>
            <div>
              <h3 className="font-bold text-slate-900 tracking-tight">Insertar Video</h3>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest leading-none">Multimedia</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-xl transition-colors"><X size={20} /></button>
        </div>

        <div className="flex gap-6 px-6 border-b border-slate-100">
          {(['webcam', 'screen'] as const).map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              disabled={isRecording}
              className={`py-3 text-sm font-bold border-b-2 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              {t === 'webcam' ? <Camera size={14} /> : <MonitorPlay size={14} />}
              {t === 'webcam' ? 'Cámara web' : 'Pantalla / Ventana'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-6 scrollbar-thin">
          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-100 text-rose-700 text-sm rounded-2xl flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-500 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {recordedUrl ? (
            <div className="space-y-3">
              <video ref={resultVideoRef} controls className="w-full max-h-80 bg-black rounded-2xl" />
              <p className="text-xs text-slate-500 font-semibold">Duración: {elapsedSeconds}s — revise antes de insertar.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tab === 'webcam' ? (
                <video ref={videoRef} autoPlay muted playsInline className="w-full max-h-80 bg-black rounded-2xl" />
              ) : (
                <div className="py-16 border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center bg-slate-50/50 text-center px-6">
                  <MonitorPlay size={48} className="text-slate-200 mb-4" />
                  {isRecording ? (
                    <p className="text-sm text-slate-600 font-semibold">Grabando pantalla/ventana seleccionada…</p>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Al iniciar, el navegador le pedirá elegir qué compartir: una ventana específica, una pestaña, o toda la pantalla.
                    </p>
                  )}
                </div>
              )}
              {isRecording && (
                <p className="text-xs font-bold text-rose-600 flex items-center gap-1.5">
                  <Circle size={10} className="fill-rose-600 animate-pulse" /> REC {elapsedSeconds}s / {MAX_RECORDING_SECONDS}s
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-end gap-3">
          {recordedUrl ? (
            <>
              <button
                type="button"
                onClick={discardAndRetry}
                className="px-5 py-2.5 rounded-2xl font-bold text-sm text-slate-600 hover:bg-slate-200 transition-colors flex items-center gap-1.5"
              >
                <RefreshCw size={14} /> Descartar y grabar de nuevo
              </button>
              <button
                type="button"
                onClick={handleConfirmInsert}
                className="bg-indigo-600 text-white px-6 py-2.5 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-1.5"
              >
                <Check size={14} /> Insertar en el informe
              </button>
            </>
          ) : isRecording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="bg-rose-600 text-white px-6 py-2.5 rounded-2xl font-bold text-sm shadow-xl shadow-rose-100 hover:bg-rose-700 active:scale-95 transition-all flex items-center gap-1.5"
            >
              <Square size={14} /> Detener grabación
            </button>
          ) : busy ? (
            <button type="button" disabled className="px-6 py-2.5 rounded-2xl font-bold text-sm text-slate-400 flex items-center gap-1.5 cursor-not-allowed">
              <RefreshCw size={14} className="animate-spin" /> Procesando grabación…
            </button>
          ) : (
            <button
              type="button"
              onClick={() => beginRecording(tab)}
              className="bg-indigo-600 text-white px-6 py-2.5 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-1.5"
            >
              <Circle size={14} /> Iniciar grabación ({tab === 'webcam' ? 'cámara web' : 'pantalla/ventana'})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(VideoInsertModal);
