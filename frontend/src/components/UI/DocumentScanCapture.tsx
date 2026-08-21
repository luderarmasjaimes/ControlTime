import React, { useEffect, useRef, useState } from 'react';
import { X, ScanLine, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { scanDniDocument, type DniScanResult } from '../../auth/authApi';

interface DocumentScanCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: DniScanResult) => void;
}

const CAPTURE_INTERVAL_MS = 700;
const TIMEOUT_MS = 20000;

/**
 * Lectura de DNI por cámara — PDF417 (DNI antiguo 1997) + MRZ (todas las
 * versiones, incluido DNI electrónico). No consulta RENIEC/SUNAT: solo
 * decodifica lo ya impreso en el reverso del documento (ai_engine/dni_scan.py).
 * QR del DNI electrónico 3.0 queda fuera a propósito (formato no verificado).
 *
 * Mismo patrón de captura continua que IntegratedBiometricModal
 * (UserManagementView.tsx): loop de frames sobre <video>/<canvas> hasta
 * obtener un resultado o agotar el tiempo — nunca bloquea el flujo, el
 * usuario siempre puede cancelar y escribir el DNI a mano.
 */
export function DocumentScanCapture({ isOpen, onClose, onSuccess }: DocumentScanCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    setError('');
    setTimedOut(false);
    setAttempts(0);
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraActive(true);

        timerRef.current = setInterval(async () => {
          if (!videoRef.current || scanningRef.current || videoRef.current.videoWidth === 0) return;
          scanningRef.current = true;
          try {
            const { buildFullFrameJpegBase64FromVideo } = await import('../../auth/biometricOvalFrame');
            const base64 = buildFullFrameJpegBase64FromVideo(videoRef.current, 1280, 720, 0.85);
            const result = await scanDniDocument(base64);
            setAttempts(a => a + 1);
            if (result.found && result.dni) {
              if (timerRef.current) clearInterval(timerRef.current);
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              onSuccess(result);
            }
          } catch {
            // Fallo de un frame individual no detiene el intento -- el
            // siguiente frame del loop simplemente reintenta.
          } finally {
            scanningRef.current = false;
          }
        }, CAPTURE_INTERVAL_MS);

        timeoutRef.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
      } catch (err) {
        setError('No se pudo iniciar la cámara: ' + (err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      setCameraActive(false);
    };
  }, [isOpen, onSuccess]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md">
      <div className="bg-[var(--a11y-bg-form)] border border-[var(--a11y-border-form)] w-full max-w-lg rounded-[2rem] overflow-hidden flex flex-col p-5 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-indigo-500/10 text-indigo-400">
              <ScanLine size={18} />
            </div>
            <div>
              <h2 className="text-white font-black uppercase text-[10px] tracking-widest leading-none">Escanear DNI</h2>
              <p className="text-slate-500 text-[8px] font-bold uppercase mt-1">Muestre el reverso del documento</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all">
            <X size={16} />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-black rounded-3xl overflow-hidden mb-4 border border-white/5 shadow-inner">
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />

          <div className="absolute inset-6 pointer-events-none border-2 border-dashed border-indigo-400/50 rounded-xl" />

          {!cameraActive && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 gap-3">
              <RotateCcw className="text-indigo-400 animate-spin" size={32} />
              <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Iniciando cámara...</span>
            </div>
          )}

          {cameraActive && !timedOut && (
            <div className="absolute top-4 left-4 bg-[var(--a11y-bg-form)]/80 backdrop-blur px-3 py-1.5 rounded-xl border border-[var(--a11y-border-form)] flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-black text-white uppercase tracking-wider">Buscando código ({attempts})</span>
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
          <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl mb-3">
            <AlertTriangle className="text-amber-500 shrink-0" size={18} />
            <p className="text-[9px] font-black text-amber-300 uppercase leading-tight">
              No se pudo leer automáticamente. Puede seguir intentando o escribir el DNI a mano.
            </p>
          </div>
        )}

        {!error && !timedOut && (
          <div className="flex items-center gap-2 text-[8px] text-slate-500 font-bold uppercase tracking-widest justify-center">
            <CheckCircle2 size={11} className="text-slate-600" />
            Funciona con el DNI antiguo (código de barras) y el electrónico (banda de texto)
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase tracking-widest transition-all"
        >
          Cancelar y escribir a mano
        </button>
      </div>
    </div>
  );
}

export default DocumentScanCapture;
