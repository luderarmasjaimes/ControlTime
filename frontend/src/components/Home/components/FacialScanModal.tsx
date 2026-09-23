import React, { useState, useEffect } from 'react';
import { Camera, ShieldCheck, CheckCircle2, AlertCircle, RefreshCw, X } from 'lucide-react';

interface FacialScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanComplete: () => void;
}

export const FacialScanModal: React.FC<FacialScanModalProps> = ({
  isOpen,
  onClose,
  onScanComplete,
}) => {
  const [scanState, setScanState] = useState<'scanning' | 'verifying' | 'success'>('scanning');
  const [scanProgress, setScanProgress] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setScanState('scanning');
      setScanProgress(0);
      return;
    }

    const interval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setScanState('verifying');
          setTimeout(() => {
            setScanState('success');
            setTimeout(() => {
              onScanComplete();
            }, 1200);
          }, 1000);
          return 100;
        }
        return prev + 10;
      });
    }, 150);

    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200">
      
      <div className="relative w-full max-w-md bg-[#0b1320] border border-amber-500/50 rounded-2xl p-6 text-center space-y-6 shadow-2xl text-slate-100">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-bold uppercase tracking-widest">
            Simulación de demostración — sin cámara ni servidor real
          </div>
          <h3 className="text-lg font-black font-mono uppercase tracking-wider text-amber-400">
            RECONOCIMIENTO FACIAL BIOMÉTRICO
          </h3>
          <p className="text-xs text-slate-400">
            Vista previa animada del flujo de acceso — la biometría real de BEEMETRY se activa dentro de la plataforma, tras iniciar sesión
          </p>
        </div>

        {/* Biometric Scan Frame Box */}
        <div className="relative w-56 h-56 mx-auto rounded-full bg-slate-950 border-4 border-amber-500/60 overflow-hidden flex flex-col items-center justify-center shadow-inner">
          
          {/* Simulated Miner Portrait */}
          <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-amber-600 via-orange-600 to-amber-400 flex items-center justify-center text-3xl font-bold font-mono text-white shadow-md">
            👷‍♂️
          </div>

          {/* Laser Scanning Line Animation */}
          {scanState === 'scanning' && (
            <div
              className="absolute inset-x-0 h-1 bg-amber-400 shadow-[0_0_15px_#f59e0b] transition-all duration-150"
              style={{ top: `${scanProgress}%` }}
            />
          )}

          {/* Scan Overlay HUD */}
          <div className="absolute inset-0 border-2 border-dashed border-amber-400/30 rounded-full animate-spin-slow pointer-events-none" />
        </div>

        {/* Status Messaging */}
        <div className="space-y-2">
          {scanState === 'scanning' && (
            <div className="space-y-2">
              <p className="text-xs font-mono font-bold text-amber-400">
                ESCANEAR FACIAL: {scanProgress}%
              </p>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-orange-600 to-amber-500 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${scanProgress}%` }}
                />
              </div>
            </div>
          )}

          {scanState === 'verifying' && (
            <p className="text-xs font-mono font-bold text-cyan-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Simulando verificación biométrica...
            </p>
          )}

          {scanState === 'success' && (
            <p className="text-xs font-mono font-bold text-emerald-400 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Demostración completa — entrando al panel de ejemplo...
            </p>
          )}
        </div>

      </div>

    </div>
  );
};
