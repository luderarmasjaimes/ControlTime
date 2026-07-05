import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, X, Check, AlertCircle, MonitorPlay, RefreshCw } from 'lucide-react';
import CctvStreamVideo from '../../../Special/CctvStreamVideo.jsx';
import { getSession } from '../../../../auth/authStorage.js';
import { TELEMETRY_DEFAULT_TENANT_ID } from '../../../../auth/telemetryTenant';

const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read'));
    reader.readAsDataURL(file);
  });
}

function isWebPlayableCamera(camera) {
  const url = String(camera?.rtmp_url || camera?.stream_url || camera?.hls_url || '').trim().toLowerCase();
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Modal Insertar Imagen: Diseño Compacto y Premium.
 * Permite: Archivo Local, Cámara Web (Browser), y Cámaras de Red (Server + Browser fallbacks).
 */
export default function ImageInsertModal({
  onClose,
  onComplete,
  telemetryTenantId = TELEMETRY_DEFAULT_TENANT_ID,
  initialTab = 'file',
  openSequence = 0,
}) {
  const [tab, setTab] = useState(initialTab);
  const [pcTabError, setPcTabError] = useState(null);
  const [networkSnapshotError, setNetworkSnapshotError] = useState(null);
  const [videoDevices, setVideoDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const networkVideoRef = useRef(null);
  // Guarda el MediaStream vivo fuera del ciclo de render para poder detenerlo
  // sin meterlo en dependencias de efectos (evita el bucle de re-adquisición).
  const streamRef = useRef(null);

  const [networkCameras, setNetworkCameras] = useState([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const [selectedNetworkId, setSelectedNetworkId] = useState('');
  const [networkSnapshotBusy, setNetworkSnapshotBusy] = useState(false);

  // Estable ([] deps): detener el stream NO debe cambiar la identidad de este
  // callback, o el efecto de arranque de cámara se re-ejecutaría en bucle.
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
  }, []);

  const refreshVideoDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const videos = all.filter((d) => d.kind === 'videoinput');
      setVideoDevices(videos);
      if (!deviceId && videos.length > 0) setDeviceId(videos[0].deviceId);
    } catch { /* ignore */ }
  }, [deviceId]);

  useEffect(() => {
    if (tab === 'camera') refreshVideoDevices();
  }, [tab, refreshVideoDevices]);

  // Adquiere el stream UNA vez por (tab, deviceId). El cleanup detiene
  // exactamente el stream adquirido en esta ejecución → sin re-adquisición
  // repetida ni parpadeo negro↔cámara.
  useEffect(() => {
    if (tab !== 'camera') { stopStream(); return; }
    let cancelled = false;
    let localStream = null;
    (async () => {
      try {
        const constraints = deviceId
          ? { video: { deviceId: { exact: deviceId } } }
          : { video: true };
        const ms = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { ms.getTracks().forEach((t) => t.stop()); return; }
        localStream = ms;
        streamRef.current = ms;
        setStream(ms);
        // Asignación directa: el <video> ya está montado (tab === 'camera').
        if (videoRef.current) videoRef.current.srcObject = ms;
      } catch (e) {
        if (!cancelled) setPcTabError(e.message || 'Error de cámara');
      }
    })();
    return () => {
      cancelled = true;
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [tab, deviceId, stopStream]);

  // Red de seguridad: si el <video> se (re)monta con un stream vivo, reasigna.
  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const loadNetworkCameras = useCallback(async () => {
    setNetworkError(null);
    setNetworkLoading(true);
    try {
      const apiUrl = new URL('/api/surveillance/cameras', window.location.origin);
      if (telemetryTenantId) apiUrl.searchParams.set('tenant_id', telemetryTenantId);
      const res = await fetch(apiUrl.toString());
      const data = await res.json();
      const list = Array.isArray(data.cameras) ? data.cameras : [];
      setNetworkCameras(list);
      const playable = list.filter(isWebPlayableCamera);
      if (playable.length > 0 && !selectedNetworkId) setSelectedNetworkId(String(playable[0].id));
    } catch {
      setNetworkError('Error al cargar cámaras');
    } finally {
      setNetworkLoading(false);
    }
  }, [telemetryTenantId, selectedNetworkId]);

  useEffect(() => {
    if (tab === 'network') loadNetworkCameras();
  }, [tab, loadNetworkCameras]);

  /** 
   * Valida brillo. Retorna true (ok), false (oscuro), o 'tainted' (CORS).
   */
  const validateImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 100; c.height = 100;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 100, 100);
        const data = ctx.getImageData(0,0,100,100).data;
        let sum = 0;
        for (let i=0; i<data.length; i+=4) sum += (data[i]+data[i+1]+data[i+2])/3;
        const avg = sum / (data.length/4);
        resolve(avg > 10 && avg < 245);
      } catch { resolve('tainted'); }
    };
    img.onerror = () => resolve(false);
    img.src = src;
  });

  const captureFromNetworkCamera = async () => {
    setNetworkSnapshotError(null);
    setNetworkSnapshotBusy(true);
    try {
      const video = networkVideoRef.current;
      // 1. Intento Browser
      if (video && video.videoWidth > 0) {
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        const url = c.toDataURL('image/jpeg', 0.9);
        const resV = await validateImage(url);
        if (resV !== false) { onComplete(url); onClose(); return; }
      }
      
      // 2. Intento Servidor
      const session = getSession();
      if (session?.token) {
        const apiUrl = new URL('/api/surveillance/camera-snapshot', window.location.origin);
        apiUrl.searchParams.set('camera_id', String(selectedNetworkId));
        apiUrl.searchParams.set('tenant_id', String(telemetryTenantId));
        const resp = await fetch(apiUrl.toString(), { headers: { Authorization: `Bearer ${session.token}` } });
        if (resp.ok) {
           const blob = await resp.blob();
           const reader = new FileReader();
           const urlS = await new Promise(r => { reader.onloadend = () => r(reader.result); reader.readAsDataURL(blob); });
           const resV = await validateImage(urlS);
           if (resV !== false) { onComplete(urlS); onClose(); return; }
        }
      }
      setNetworkSnapshotError('Captura no disponible (imagen negra o inactiva).');
    } catch (e) {
      setNetworkSnapshotError('Error en servidor.');
    } finally {
      setNetworkSnapshotBusy(false);
    }
  };

  const selectedCam = networkCameras.find(c => String(c.id) === String(selectedNetworkId));
  const streamUrl = selectedCam ? String(selectedCam.stream_url || selectedCam.hls_url || '').trim() : '';
  const playable = networkCameras.filter(isWebPlayableCamera);

  return (
    <div className="fixed inset-0 z-[20000] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-200"><ImageIcon size={20}/></div>
             <div>
               <h3 className="font-bold text-slate-900 tracking-tight">Insertar Imagen</h3>
               <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest leading-none">Multimedia</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-xl transition-colors"><X size={20}/></button>
        </div>

        <div className="flex gap-6 px-6 border-b border-slate-100">
          {['file', 'camera', 'network'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`py-3 text-sm font-bold border-b-2 transition-all ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t === 'file' ? 'Local' : t === 'camera' ? 'Webcam' : 'Cámara Red'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-6 scrollbar-thin">
          {(tab === 'network' ? networkSnapshotError : pcTabError) && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-100 text-amber-800 text-sm rounded-2xl flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0"/> <span>{tab === 'network' ? networkSnapshotError : pcTabError}</span>
            </div>
          )}

          {tab === 'file' && (
            <div className="py-12 border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center bg-slate-50/50">
               <ImageIcon size={48} className="text-slate-200 mb-4"/>
               <input type="file" ref={fileInputRef} className="hidden" accept={ACCEPT_IMAGE} onChange={async e => {
                 const f = e.target.files?.[0]; if (f) { onComplete(await readFileAsDataUrl(f)); onClose(); }
               }}/>
               <button onClick={() => fileInputRef.current.click()} className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all">Seleccionar Archivo</button>
            </div>
          )}

          {tab === 'camera' && (
            <div className="space-y-4 max-w-xl mx-auto">
               <div className="flex gap-2">
                 <select className="flex-1 p-3 border rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10" value={deviceId} onChange={e => setDeviceId(e.target.value)}>
                   {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Detectando...'}</option>)}
                 </select>
                 <button onClick={refreshVideoDevices} className="p-3 bg-slate-100 rounded-2xl text-slate-600 hover:bg-slate-200"><RefreshCw size={18}/></button>
               </div>
               <div className="aspect-video bg-slate-900 rounded-3xl overflow-hidden shadow-inner border border-slate-200">
                 <video ref={videoRef} className="w-full h-full object-contain" autoPlay muted playsInline/>
               </div>
               <button onClick={() => {
                 const c = document.createElement('canvas'); c.width = videoRef.current.videoWidth; c.height = videoRef.current.videoHeight;
                 c.getContext('2d').drawImage(videoRef.current, 0, 0); onComplete(c.toDataURL('image/jpeg', 0.9)); onClose();
               }} disabled={!stream} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-emerald-50 hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-30">Capturar e Insertar</button>
            </div>
          )}

          {tab === 'network' && (
            <div className="space-y-4 max-w-xl mx-auto">
              <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200">
                 <select className="flex-1 bg-transparent px-3 text-sm font-bold text-slate-700 outline-none" value={selectedNetworkId} onChange={e => setSelectedNetworkId(e.target.value)}>
                    {playable.length === 0 ? <option value="">Cargando...</option> : playable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                 </select>
                 <button onClick={loadNetworkCameras} className="p-2.5 bg-white rounded-xl shadow-sm text-indigo-600 border border-slate-200/50 hover:bg-slate-50"><RefreshCw size={16} className={networkLoading ? 'animate-spin': ''}/></button>
              </div>
              <div className="aspect-video bg-slate-900 rounded-3xl overflow-hidden relative shadow-inner border border-slate-200">
                 {streamUrl && <CctvStreamVideo key={streamUrl} streamUrl={streamUrl} className="w-full h-full object-contain" captureVideoRef={networkVideoRef} muted/>}
                 <div className="absolute top-4 right-4 bg-black/40 px-3 py-1 rounded-full text-[10px] text-white flex items-center gap-1.5 backdrop-blur-md border border-white/10 font-bold uppercase tracking-widest">
                    <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"/>Live View
                 </div>
              </div>
              <button onClick={captureFromNetworkCamera} disabled={networkSnapshotBusy || !selectedNetworkId} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold shadow-xl shadow-indigo-100 disabled:opacity-30 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                 {networkSnapshotBusy ? <RefreshCw className="animate-spin" size={18}/> : <Check size={18}/>}
                 {networkSnapshotBusy ? 'Procesando...' : 'Tomar Instantánea e Insertar'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
