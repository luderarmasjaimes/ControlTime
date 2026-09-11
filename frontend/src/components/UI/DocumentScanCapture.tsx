import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, ScanLine, RotateCcw, AlertTriangle, CheckCircle2, Camera, RefreshCw, ZoomIn } from 'lucide-react';
import { scanDniDocument, type DniScanResult } from '../../auth/authApi';

interface DocumentScanCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: DniScanResult) => void;
}

// Intervalos calibrados para documentos de identidad:
// 500ms da ~90 intentos en 45s — suficiente para capturar PDF417 o MRZ
// incluso con movimiento suave de mano del usuario.
const CAPTURE_INTERVAL_MS = 500;
const TIMEOUT_MS = 45_000;

/**
 * Lectura de DNI por cámara — PDF417 (DNI antiguo 1997) + MRZ/TD1 (todas
 * las versiones, incluido DNI electrónico). No consulta RENIEC/SUNAT: solo
 * decodifica lo ya impreso en el reverso del documento (ai_engine/dni_scan.py).
 *
 * Mejoras 2026-09-07:
 *  - Timeout extendido a 45 s (antes 20 s) para dar más oportunidades.
 *  - Intervalo reducido a 500 ms (antes 700 ms) → más frames analizados.
 *  - Botón "Reintentar" tras timeout — resetea sin cerrar el modal.
 *  - Botón "Capturar ahora" — envía el frame inmediatamente (útil cuando
 *    el usuario ve el QR/barcode bien encuadrado pero el loop no lo detecta).
 *  - Indicador de progreso visual con porcentaje de tiempo transcurrido.
 *  - Instrucciones diferenciadas: zona PDF417 (barras) vs zona MRZ (texto).
 *  - El usuario siempre puede cancelar y escribir el DNI a mano.
 */
export function DocumentScanCapture({ isOpen, onClose, onSuccess }: DocumentScanCaptureProps) {
  const videoRef    = useRef<HTMLVideoElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanningRef = useRef(false);
  const mountedRef  = useRef(true);

  const [cameraActive, setCameraActive]     = useState(false);
  const [error, setError]                   = useState('');
  const [timedOut, setTimedOut]             = useState(false);
  const [attempts, setAttempts]             = useState(0);
  const [progress, setProgress]             = useState(0);       // 0-100 % del timeout
  const [manualCapturing, setManualCapturing] = useState(false); // captura puntual en curso

  /** Detiene el loop de captura y el timeout, sin cerrar la cámara. */
  const stopLoop = useCallback(() => {
    if (timerRef.current)   clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (progressRef.current) clearInterval(progressRef.current);
    timerRef.current   = null;
    timeoutRef.current = null;
    progressRef.current = null;
  }, []);

  /** Detiene TODO: loop + cámara. Llamado al cerrar o desmontar. */
  const stopAll = useCallback(() => {
    stopLoop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (mountedRef.current) setCameraActive(false);
  }, [stopLoop]);

  /** Arranca (o reinicia) el loop de captura + timeout + barra de progreso. */
  const startLoop = useCallback(() => {
    stopLoop();
    setAttempts(0);
    setTimedOut(false);
    setProgress(0);
    scanningRef.current = false;

    const startAt = Date.now();

    // Barra de progreso — se actualiza cada 250ms
    progressRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      const elapsed = Date.now() - startAt;
      setProgress(Math.min(100, Math.round((elapsed / TIMEOUT_MS) * 100)));
    }, 250);

    // Loop de análisis de frame
    timerRef.current = setInterval(async () => {
      if (!videoRef.current || scanningRef.current || videoRef.current.videoWidth === 0) return;
      scanningRef.current = true;
      try {
        const { buildFullFrameJpegBase64FromVideo } = await import('../../auth/biometricOvalFrame');
        const base64 = buildFullFrameJpegBase64FromVideo(videoRef.current, 1920, 1080, 0.88);
        const result = await scanDniDocument(base64);
        if (mountedRef.current) setAttempts(a => a + 1);
        if (result.found && result.dni) {
          stopLoop();
          onSuccess(result);
        }
      } catch {
        // Error puntual de un frame — el siguiente ciclo reintenta.
      } finally {
        scanningRef.current = false;
      }
    }, CAPTURE_INTERVAL_MS);

    // Timeout global
    timeoutRef.current = setTimeout(() => {
      stopLoop();
      if (mountedRef.current) {
        setTimedOut(true);
        setProgress(100);
      }
    }, TIMEOUT_MS);
  }, [stopLoop, onSuccess]);

  /** Captura manual de un frame individual (botón "Capturar ahora"). */
  const handleManualCapture = useCallback(async () => {
    if (!videoRef.current || videoRef.current.videoWidth === 0 || manualCapturing) return;
    setManualCapturing(true);
    try {
      const { buildFullFrameJpegBase64FromVideo } = await import('../../auth/biometricOvalFrame');
      const base64 = buildFullFrameJpegBase64FromVideo(videoRef.current, 1920, 1080, 0.92);
      const result = await scanDniDocument(base64);
      if (result.found && result.dni) {
        stopLoop();
        onSuccess(result);
      } else {
        // Informa que este frame puntual tampoco lo encontró
        setAttempts(a => a + 1);
      }
    } catch {
      // silencioso
    } finally {
      if (mountedRef.current) setManualCapturing(false);
    }
  }, [manualCapturing, stopLoop, onSuccess]);

  /** Reinicia el escáner tras un timeout sin cerrar el modal. */
  const handleRetry = useCallback(() => {
    setError('');
    if (cameraActive) {
      startLoop();
    }
  }, [cameraActive, startLoop]);

  // ── Ciclo de vida: abre cámara al montar, cierra al desmontar/cerrar ──
  useEffect(() => {
    mountedRef.current = true;
    if (!isOpen) return undefined;

    setError('');
    setTimedOut(false);
    setAttempts(0);
    setProgress(0);
    setManualCapturing(false);

    (async () => {
      try {
        // Resolución 1920×1080 — más píxeles para leer PDF417 chico y texto MRZ.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'environment' },
        });
        if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraActive(true);
        startLoop();
      } catch (err) {
        if (mountedRef.current)
          setError('No se pudo iniciar la cámara: ' + (err as Error).message);
      }
    })();

    return () => {
      mountedRef.current = false;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const progressColor =
    progress < 50 ? '#6366f1'   // indigo
    : progress < 80 ? '#f59e0b'  // amber
    : '#ef4444';                  // rojo → tiempo crítico

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Escanear documento de identidad"
    >
      <div className="bg-[var(--a11y-bg-form)] border border-[var(--a11y-border-form)] w-full max-w-lg rounded-[2rem] overflow-hidden flex flex-col p-5 shadow-[0_0_50px_rgba(0,0,0,0.5)]">

        {/* ── Cabecera ─────────────────────────────────────────── */}
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-indigo-500/10 text-indigo-400">
              <ScanLine size={18} />
            </div>
            <div>
              <h2 className="text-white font-black uppercase text-[10px] tracking-widest leading-none">
                Escanear DNI / QR
              </h2>
              <p className="text-slate-400 text-[8px] font-bold uppercase mt-1">
                Muestre el <span className="text-indigo-300">reverso</span> del documento de identidad
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

        {/* ── Barra de progreso de tiempo ───────────────────────── */}
        {cameraActive && !error && (
          <div className="mb-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: progressColor }}
            />
          </div>
        )}

        {/* ── Visor de cámara ──────────────────────────────────── */}
        <div className="relative aspect-[4/3] bg-black rounded-3xl overflow-hidden mb-3 border border-white/5 shadow-inner">
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />

          {/* Marco de guía — zona superior: PDF417/QR; zona inferior: MRZ */}
          <div className="absolute inset-6 pointer-events-none">
            {/* Marco exterior */}
            <div className="w-full h-full border-2 border-dashed border-indigo-400/50 rounded-xl" />
            {/* Zona MRZ — tercio inferior */}
            <div
              className="absolute left-0 right-0 bottom-0 border-2 border-dashed border-amber-400/40 rounded-b-xl"
              style={{ height: '33%' }}
            />
            {/* Etiqueta PDF417 */}
            <span className="absolute top-2 left-2 text-[7px] font-black text-indigo-300 uppercase tracking-widest bg-black/60 px-1.5 py-0.5 rounded">
              QR / Código barras
            </span>
            {/* Etiqueta MRZ */}
            <span className="absolute bottom-2 left-2 text-[7px] font-black text-amber-300 uppercase tracking-widest bg-black/60 px-1.5 py-0.5 rounded">
              Líneas MRZ (texto)
            </span>
          </div>

          {/* Overlay: iniciando cámara */}
          {!cameraActive && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 gap-3">
              <RotateCcw className="text-indigo-400 animate-spin" size={32} />
              <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">
                Iniciando cámara…
              </span>
            </div>
          )}

          {/* Indicador activo + contador de intentos */}
          {cameraActive && !timedOut && !error && (
            <div className="absolute top-4 left-4 bg-[var(--a11y-bg-form)]/80 backdrop-blur px-3 py-1.5 rounded-xl border border-[var(--a11y-border-form)] flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-black text-white uppercase tracking-wider">
                Buscando código ({attempts})
              </span>
            </div>
          )}

          {/* Indicador de captura manual en proceso */}
          {manualCapturing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="flex flex-col items-center gap-2">
                <Camera className="text-indigo-400 animate-pulse" size={36} />
                <span className="text-[10px] font-black text-white uppercase tracking-widest">
                  Analizando…
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Error de cámara ───────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl mb-3">
            <AlertTriangle className="text-rose-500 shrink-0" size={18} />
            <p className="text-[9px] font-black text-rose-400 uppercase leading-tight">{error}</p>
          </div>
        )}

        {/* ── Timeout: botón de reintento ───────────────────────── */}
        {timedOut && !error && (
          <div className="flex flex-col gap-2 mb-3">
            <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
              <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
              <div>
                <p className="text-[9px] font-black text-amber-300 uppercase leading-tight mb-1">
                  No se pudo leer automáticamente
                </p>
                <p className="text-[8px] text-amber-400/70 leading-tight">
                  Asegúrese de que el reverso esté bien iluminado y encuadrado. 
                  Puede reintentar o escribir el DNI a mano.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[9px] font-black uppercase tracking-widest transition-all"
            >
              <RefreshCw size={13} />
              Reintentar escaneo (45 s)
            </button>
          </div>
        )}

        {/* ── Estado normal: ayuda + botón de captura manual ───── */}
        {!error && !timedOut && cameraActive && (
          <div className="flex items-center gap-2 justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[7px] text-slate-500 font-bold uppercase tracking-widest">
              <CheckCircle2 size={10} className="text-slate-600" />
              <span>PDF417 · MRZ · QR (documento de identidad)</span>
            </div>
            <button
              type="button"
              onClick={handleManualCapture}
              disabled={manualCapturing}
              title="Captura este momento exacto"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-[8px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              <ZoomIn size={11} />
              Capturar ahora
            </button>
          </div>
        )}

        {/* ── Instrucciones breves ─────────────────────────────── */}
        {!error && (
          <div className="grid grid-cols-2 gap-2 mb-3 text-[7px] text-slate-500">
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
              <span className="text-indigo-400 font-black">▪</span>
              <span>Zona superior: código QR o barras PDF417</span>
            </div>
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
              <span className="text-amber-400 font-black">▪</span>
              <span>Zona inferior: 3 líneas de texto MRZ (I&lt;PER…)</span>
            </div>
          </div>
        )}

        {/* ── Botón cancelar ───────────────────────────────────── */}
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

export default DocumentScanCapture;
