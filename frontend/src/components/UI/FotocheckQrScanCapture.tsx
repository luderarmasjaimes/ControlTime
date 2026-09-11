import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, ScanLine, RotateCcw, AlertTriangle } from 'lucide-react';
import { scanFotocheckQr } from '../../auth/authApi';

interface FotocheckQrScanCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (fields: Record<string, string>) => void;
}

// Mismo criterio de calibración que DocumentScanCapture.tsx (escáner DNI):
// intervalo corto para varios intentos dentro del timeout, sin saturar la
// red -- acá el QR es más simple de leer que PDF417/MRZ, así que el
// timeout es más corto.
const CAPTURE_INTERVAL_MS = 500;
const TIMEOUT_MS = 25_000;

/**
 * Escaneo del QR del fotocheck (foto+datos cifrados) para PRECARGAR campos
 * de un formulario de login/registro -- nunca autentica por sí solo (el QR
 * viene cifrado con una clave que solo el backend conoce; este componente
 * solo captura el frame y muestra el resultado, ver
 * authApi.ts::scanFotocheckQr).
 */
export function FotocheckQrScanCapture({ isOpen, onClose, onSuccess }: FotocheckQrScanCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);
  const mountedRef = useRef(true);

  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(false);

  const stopLoop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timerRef.current = null;
    timeoutRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    stopLoop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (mountedRef.current) setCameraActive(false);
  }, [stopLoop]);

  const startLoop = useCallback(() => {
    stopLoop();
    setTimedOut(false);
    scanningRef.current = false;

    timerRef.current = setInterval(async () => {
      if (!videoRef.current || scanningRef.current || videoRef.current.videoWidth === 0) return;
      scanningRef.current = true;
      try {
        const { buildFullFrameJpegBase64FromVideo } = await import('../../auth/biometricOvalFrame');
        const base64 = buildFullFrameJpegBase64FromVideo(videoRef.current, 1280, 960, 0.85);
        const result = await scanFotocheckQr(base64);
        if (result.ok && result.fields) {
          stopLoop();
          onSuccess(result.fields);
        }
      } catch {
        // Error puntual de un frame -- el siguiente ciclo reintenta.
      } finally {
        scanningRef.current = false;
      }
    }, CAPTURE_INTERVAL_MS);

    timeoutRef.current = setTimeout(() => {
      stopLoop();
      if (mountedRef.current) setTimedOut(true);
    }, TIMEOUT_MS);
  }, [stopLoop, onSuccess]);

  const handleRetry = useCallback(() => {
    setError('');
    if (cameraActive) startLoop();
  }, [cameraActive, startLoop]);

  useEffect(() => {
    mountedRef.current = true;
    if (!isOpen) return undefined;

    setError('');
    setTimedOut(false);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'environment' },
        });
        if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraActive(true);
        startLoop();
      } catch (err) {
        if (mountedRef.current) setError('No se pudo iniciar la cámara: ' + (err as Error).message);
      }
    })();

    return () => {
      mountedRef.current = false;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Escanear fotocheck"
    >
      <div className="bg-[var(--a11y-bg-form)] border border-[var(--a11y-border-form)] w-full max-w-lg rounded-[2rem] overflow-hidden flex flex-col p-5 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-indigo-500/10 text-indigo-400">
              <ScanLine size={18} />
            </div>
            <div>
              <h2 className="text-white font-black uppercase text-[10px] tracking-widest leading-none">
                Escanear fotocheck
              </h2>
              <p className="text-slate-400 text-[8px] font-bold uppercase mt-1">
                Enfoque el código QR de su credencial
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all"
            aria-label="Cerrar escáner"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-black rounded-3xl overflow-hidden mb-3 border border-white/5 shadow-inner">
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          <div className="absolute inset-10 pointer-events-none border-2 border-dashed border-indigo-400/50 rounded-xl" />
          {!cameraActive && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 gap-3">
              <RotateCcw className="text-indigo-400 animate-spin" size={32} />
              <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">
                Iniciando cámara…
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl mb-3">
            <AlertTriangle className="text-rose-500 shrink-0" size={18} />
            <p className="text-[9px] font-black text-rose-400 uppercase leading-tight">{error}</p>
          </div>
        )}

        {timedOut && !error && (
          <div className="flex flex-col gap-2 mb-3">
            <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
              <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
              <p className="text-[9px] font-black text-amber-300 uppercase leading-tight">
                No se detectó el QR. Puede reintentar o llenar los datos a mano.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[9px] font-black uppercase tracking-widest transition-all"
            >
              <RotateCcw size={13} />
              Reintentar
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-1 w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] font-black uppercase tracking-widest transition-all"
        >
          Cancelar y escribir a mano
        </button>
      </div>
    </div>
  );
}

export default FotocheckQrScanCapture;
