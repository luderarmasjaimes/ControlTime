import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, ScanFace, Check, MinusCircle, AlertTriangle, ShieldCheck, Loader2, Clock } from 'lucide-react';
import { 
  processBiometricFrame, 
  fetchBiometricStatus, 
  resetBiometricCapture, 
  loginWithFace 
} from '../../../../auth/authApi';
import { computeBiometricOvalLayout, buildFullFrameJpegBase64FromVideo, frameToTemplate } from '../../../../auth/biometricOvalFrame';

export default function MaintenanceBiometricModal({ isOpen, onClose, onSuccess, operatorUsername, company }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [faceSamples, setFaceSamples] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);

  // DEBUG LOGS
  useEffect(() => {
    if (isOpen) {
      console.log("[MAINTENANCE_BIO_UI] Modal Opened. Props:", { operatorUsername, company });
    }
  }, [isOpen, operatorUsername, company]);
  const [cameraActive, setCameraActive] = useState(false);
  const [faceGuide, setFaceGuide] = useState({
    eyesOpen: false,
    mouthClosed: false,
    frontal: false,
    noGlasses: false,
    qualityReady: false
  });

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const isVerifyingRef = useRef(false);

  const [serverOval, setServerOval] = useState(null);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen]);

  const stopCamera = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setCameraActive(false);
    setFaceSamples(0);
    setTimeLeft(60);
    setError('');
    setServerOval(null);
    isVerifyingRef.current = false;
  };

  const startCamera = async () => {
    try {
      setLoading(true);
      setError('');
      console.log("[MAINTENANCE_BIO_UI] startCamera beginning...");
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Su navegador no soporta acceso a la cámara o no está en un entorno seguro (HTTPS).');
      }

      await resetBiometricCapture();
      
      const constraints = { 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 }, 
          facingMode: 'user' 
        } 
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
      setLoading(false);
      setTimeLeft(60);
      console.log("[MAINTENANCE_BIO_UI] Camera active. Timer started.");
      
      timerRef.current = setInterval(async () => {
        if (!videoRef.current || isVerifyingRef.current) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        
        try {
          await processBiometricFrame(base64);
          const status = await fetchBiometricStatus();
          const currentSamples = status.capture_count || 0;
          setFaceSamples(currentSamples);
          
          if (status.face_oval) {
            setServerOval(status.face_oval);
          }

          setFaceGuide({
            eyesOpen: !!status.icao?.eyes_open,
            mouthClosed: !!status.icao?.mouth_closed,
            frontal: !!status.icao?.face_straight,
            noGlasses: !!status.icao?.no_glasses,
            qualityReady: !!status.icao?.is_ready
          });

          if (currentSamples >= 3 && !isVerifyingRef.current) {
            isVerifyingRef.current = true;
            handleAutoVerify();
          }
        } catch (e) { /* ignore loop errors */ }
      }, 700);

    } catch (err) {
      console.error("Camera Error:", err);
      let msg = 'No se pudo acceder a la cámara.';
      if (err.name === 'NotAllowedError') msg = 'Acceso a la cámara denegado. Por favor, habilite los permisos en su navegador.';
      if (err.name === 'NotFoundError') msg = 'No se encontró una cámara conectada.';
      setError(err.message || msg);
      setLoading(false);
    }
  };

  const handleAutoVerify = async () => {
    try {
      setLoading(true);
      setError('');
      
      const highResBase64 = buildFullFrameJpegBase64FromVideo(videoRef.current, 640, 480, 0.9);
      const template = frameToTemplate(videoRef.current);
      
      console.log("[MAINTENANCE_BIO_UI] Attempting verification with engine...", {
        operator: operatorUsername,
        company,
        templateLen: Array.isArray(template) ? template.length : 'not_array'
      });

      const result = await loginWithFace({
        company,
        username: operatorUsername,
        imageBase64: highResBase64,
        template: template
      });

      console.info("[MAINTENANCE_BIO_UI] Engine Result Received:", result);

      if (result.status === 'authenticated' || result.token || result.ok || result.success) {
        onSuccess(result);
      } else {
        setError(result.message || 'Verificación fallida. El rostro no coincide con el administrador.');
        isVerifyingRef.current = false;
      }
    } catch (err) {
      console.error("[MAINTENANCE_BIO_UI] Critical Verification Error:", err);
      setError(err.message || 'Error en validación biométrica.');
      isVerifyingRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const defaultOvalLayout = computeBiometricOvalLayout(null, 640, 480);

  // Timer Effect
  useEffect(() => {
    let interval = null;
    if (isOpen && cameraActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            onClose();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isOpen, cameraActive, timeLeft, onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-slate-900 border border-white/10 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl shadow-indigo-500/10 flex flex-col min-h-0">
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/20">
              <ScanFace className="text-indigo-400" size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-tight">Validación Biométrica</h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Confirmación de identidad del operador</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
              <div className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] font-black flex items-center gap-2 ${timeLeft < 10 ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 animate-pulse' : 'bg-white/5 border-white/10 text-slate-300'}`}>
                <Clock size={14} className={timeLeft < 10 ? 'text-rose-500' : 'text-slate-400'} />
                {timeLeft}s
              </div>
              <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-white/5 text-slate-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
          </div>
        </div>

        <div className="p-6 space-y-6 flex-1 min-h-0 overflow-auto">
          {/* Cámara Section */}
          <div className="relative aspect-video bg-black rounded-2xl border border-white/10 overflow-hidden shadow-inner group">
             <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover grayscale-[0.25]" />
             
             {/* Óvalo Guía */}
             {cameraActive && (
                <div 
                  className={`absolute rounded-[50%] border-2 transition-all duration-300 pointer-events-none ${faceGuide.qualityReady ? 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.4)]' : 'border-indigo-500/40'}`}
                  style={serverOval ? {
                    left: `${(serverOval.cx / 640) * 100}%`,
                    top: `${(serverOval.cy / 480) * 100}%`,
                    width: `${(serverOval.ow / 640) * 100}%`,
                    height: `${(serverOval.oh / 480) * 100}%`,
                    transform: 'translate(-50%, -50%)'
                  } : defaultOvalLayout ? {
                    left: `${defaultOvalLayout.leftPct}%`,
                    top: `${defaultOvalLayout.topPct}%`,
                    width: `${defaultOvalLayout.leftPct / 2}%`, // fallback size
                    height: `${defaultOvalLayout.topPct}%`,
                    transform: defaultOvalLayout.transform
                  } : { 
                    left: '50%', top: '50%', width: '35%', height: '70%', transform: 'translate(-50%, -50%)' 
                  }}
                >
                  <div className="absolute inset-0 border border-white/5 rounded-[50%]" />
                  {!faceGuide.qualityReady && (
                    <div className="absolute inset-0 flex items-center justify-center">
                       <span className="text-[9px] font-bold text-white/40 uppercase tracking-tighter">
                         {serverOval ? 'Rostro Detectado' : 'Alinear Rostro'}
                       </span>
                    </div>
                  )}
                </div>
             )}

             {/* Contador de Muestras */}
             <div className="absolute top-4 right-4 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-xl text-[11px] font-black text-white uppercase flex items-center gap-2 border border-white/10">
               <div className={`w-2 h-2 rounded-full ${faceSamples > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
               <span>{faceSamples}/3 Muestras</span>
             </div>

             {loading && (
               <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center">
                 <Loader2 className="text-indigo-400 animate-spin" size={40} />
               </div>
             )}
          </div>

          {/* ICAO Feedback Grid */}
          <div className="grid grid-cols-2 gap-3">
             {[
               { label: 'Ojos Abiertos', val: faceGuide.eyesOpen },
               { label: 'Boca Cerrada', val: faceGuide.mouthClosed },
               { label: 'Frente a Cámara', val: faceGuide.frontal },
               { label: 'Sin Lentes Obsc.', val: faceGuide.noGlasses }
             ].map(icao => (
               <div key={icao.label} className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${icao.val ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-slate-800/40 border-white/5 text-slate-500'}`}>
                 {icao.val ? <Check size={16} strokeWidth={3} /> : <MinusCircle size={16} />}
                 <span className="text-[10px] font-black uppercase tracking-wider">{icao.label}</span>
               </div>
             ))}
          </div>

          {error && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
              <AlertTriangle size={20} />
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-tight leading-tight">{error}</p>
              </div>
              <button 
                type="button"
                onClick={() => { setError(''); isVerifyingRef.current = false; }} 
                className="px-3 py-1.5 rounded-lg bg-rose-500 text-white text-[10px] font-black uppercase"
              >Reintentar</button>
            </div>
          )}

          {!error && !loading && (
            <div className="text-center p-3 rounded-2xl bg-indigo-500/5 text-indigo-300">
               <p className="text-[10px] font-bold uppercase tracking-widest">Siga las indicaciones visuales para completar la confirmación</p>
            </div>
          )}
        </div>

        <div className="p-6 bg-slate-800/30 border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400">
             <ShieldCheck size={16} />
             <span className="text-[10px] font-bold uppercase tracking-tight">Operador: {operatorUsername}</span>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-black uppercase tracking-widest transition-all"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
