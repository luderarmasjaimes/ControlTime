import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X, Check, AlertCircle, RefreshCw, Images, MonitorPlay } from 'lucide-react';
import CctvStreamVideo from '../../../Special/CctvStreamVideo';
import { getSession, authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { TELEMETRY_DEFAULT_TENANT_ID } from '../../../../auth/telemetryTenant';
import { fetchWithAuthRetry } from '../../../../lib/fetchWithAuth';
import { fetchTenantGallery, fetchTenantGalleryImageDataUrl, type TenantGalleryImage } from '../../lib/tenantGallery';

const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read'));
    reader.readAsDataURL(file);
  });
}

function isWebPlayableCamera(camera: any): boolean {
  const url = String(camera?.rtmp_url || camera?.stream_url || camera?.hls_url || '').trim().toLowerCase();
  return url.startsWith('http://') || url.startsWith('https://');
}

interface ImageInsertModalProps {
  onClose: () => void;
  onComplete: (dataUrl: string) => void;
  telemetryTenantId?: string;
  /** Tenant real de la empresa (sesión de auth) — distinto de telemetryTenantId,
   * usado para la pestaña "Galería" (fotos JPEG de la unidad minera, ADR-047). */
  assetTenantId?: string;
  initialTab?: string;
  openSequence?: number;
}

/**
 * Modal Insertar Imagen: Diseño Compacto y Premium.
 * Permite: Archivo Local, Cámara Web (Browser), y Cámaras de Red (Server + Browser fallbacks).
 */
function ImageInsertModal({
  onClose,
  onComplete,
  telemetryTenantId = TELEMETRY_DEFAULT_TENANT_ID,
  assetTenantId,
  initialTab = 'file',
}: ImageInsertModalProps) {
  const [tab, setTab] = useState(initialTab);
  const [galleryImages, setGalleryImages] = useState<TenantGalleryImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [galleryInsertingId, setGalleryInsertingId] = useState<string | null>(null);
  const [pcTabError, setPcTabError] = useState<string | null>(null);
  const [networkSnapshotError, setNetworkSnapshotError] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const networkVideoRef = useRef<HTMLVideoElement | null>(null);
  // Guarda el MediaStream vivo fuera del ciclo de render para poder detenerlo
  // sin meterlo en dependencias de efectos (evita el bucle de re-adquisición).
  const streamRef = useRef<MediaStream | null>(null);

  const [networkCameras, setNetworkCameras] = useState<any[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [selectedNetworkId, setSelectedNetworkId] = useState('');
  const [networkSnapshotBusy, setNetworkSnapshotBusy] = useState(false);

  // Pestaña "Pantalla" -- captura de foto de la PC (getDisplayMedia), pedido
  // explícito junto a la webcam ya existente arriba (pestaña "camera"): a
  // diferencia de esa, requiere un clic explícito para compartir pantalla/
  // ventana (el navegador no permite disparar el selector nativo solo con
  // cambiar de pestaña, y tampoco conviene pedirlo sin que el usuario lo
  // busque).
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);

  // Estable ([] deps): detener el stream NO debe cambiar la identidad de este
  // callback, o el efecto de arranque de cámara se re-ejecutaría en bucle.
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
  }, []);

  // Espeja `deviceId` sin ser dependencia de efectos — ver más abajo por qué.
  const deviceIdRef = useRef('');

  // Solo enumera dispositivos para poblar el <select>; YA NO decide ni
  // dispara la adquisición de cámara (ver fix de parpadeo más abajo).
  const refreshVideoDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const videos = all.filter((d) => d.kind === 'videoinput');
      setVideoDevices(videos);
      return videos;
    } catch { return []; }
  }, []);

  // Fix de parpadeo negro↔cámara: antes, un efecto separado enumeraba
  // dispositivos y auto-seleccionaba el primero con `setDeviceId(...)` en
  // cuanto `enumerateDevices()` resolvía — como el efecto de abajo dependía
  // de `deviceId`, ese cambio de estado lo volvía a disparar: la cámara ya
  // había arrancado con el dispositivo POR DEFECTO (`{video:true}`), y
  // milisegundos después se detenía y reabría con el deviceId "exacto" recién
  // resuelto — dos adquisiciones de `getUserMedia()` por cada apertura de la
  // pestaña, visibles como el parpadeo reportado. Ahora se resuelve el
  // dispositivo (si aún no hay uno elegido) y se adquiere la cámara UNA sola
  // vez, en la misma secuencia async — `deviceId` queda deliberadamente FUERA
  // del arreglo de dependencias para que la auto-detección nunca reabra la
  // cámara; solo un cambio EXPLÍCITO del usuario en el <select> lo hace, vía
  // `switchCamera` más abajo.
  useEffect(() => {
    if (tab !== 'camera') { stopStream(); return; }
    let cancelled = false;
    let localStream: MediaStream | null = null;
    (async () => {
      let targetDeviceId = deviceIdRef.current;
      if (!targetDeviceId) {
        const videos = await refreshVideoDevices();
        if (cancelled) return;
        targetDeviceId = videos[0]?.deviceId || '';
      }
      try {
        // Sin ideal de resolución, el navegador elegía su default (a menudo
        // 640x480) para una foto que termina insertada en el informe --
        // pedimos la mayor calidad razonable (el navegador ajusta al máximo
        // real de la cámara si no llega a este ideal).
        const constraints = targetDeviceId
          ? { video: { deviceId: { exact: targetDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } }
          : { video: { width: { ideal: 1920 }, height: { ideal: 1080 } } };
        const ms = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { ms.getTracks().forEach((t) => t.stop()); return; }
        localStream = ms;
        streamRef.current = ms;
        setStream(ms);
        if (targetDeviceId && targetDeviceId !== deviceIdRef.current) {
          deviceIdRef.current = targetDeviceId;
          setDeviceId(targetDeviceId); // solo refleja el <select>, no reabre la cámara
        }
        // Asignación directa: el <video> ya está montado (tab === 'camera').
        if (videoRef.current) videoRef.current.srcObject = ms;
      } catch (e) {
        if (!cancelled) setPcTabError((e as Error).message || 'Error de cámara');
      }
    })();
    return () => {
      cancelled = true;
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, stopStream, refreshVideoDevices]);

  // Cambio EXPLÍCITO de cámara desde el <select> (única vía legítima para
  // reabrir con un dispositivo distinto tras la adquisición inicial).
  const switchCamera = useCallback(async (newDeviceId: string) => {
    deviceIdRef.current = newDeviceId;
    setDeviceId(newDeviceId);
    if (tab !== 'camera' || !newDeviceId) return;
    stopStream();
    try {
      const ms = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: newDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = ms;
      setStream(ms);
      if (videoRef.current) videoRef.current.srcObject = ms;
    } catch (e) {
      setPcTabError((e as Error).message || 'Error de cámara');
    }
  }, [tab, stopStream]);

  // Red de seguridad: si el <video> se (re)monta con un stream vivo, reasigna.
  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
  }, []);

  const startScreenShare = useCallback(async () => {
    setScreenError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenError('Captura de pantalla no disponible en este navegador.');
      return;
    }
    try {
      const ms = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      screenStreamRef.current = ms;
      setScreenStream(ms);
      if (screenVideoRef.current) screenVideoRef.current.srcObject = ms;
      // Si el usuario detiene el compartir desde el control nativo del
      // navegador (no desde nuestro botón "Detener"), el track termina solo.
      ms.getVideoTracks()[0]?.addEventListener('ended', () => {
        screenStreamRef.current = null;
        setScreenStream(null);
      });
    } catch {
      setScreenError('No se pudo iniciar la captura de pantalla (permiso denegado o cancelado).');
    }
  }, []);

  const captureScreenPhoto = useCallback(() => {
    const v = screenVideoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const dataUrl = c.toDataURL('image/png');
    stopScreenShare();
    onComplete(dataUrl);
    onClose();
  }, [onComplete, onClose, stopScreenShare]);

  // Deja de compartir al salir de la pestaña o cerrar el modal -- mismo
  // criterio que `stopStream` (webcam) al cambiar de pestaña.
  useEffect(() => {
    if (tab !== 'screen') stopScreenShare();
  }, [tab, stopScreenShare]);
  useEffect(() => () => stopScreenShare(), [stopScreenShare]);

  const loadNetworkCameras = useCallback(async () => {
    setNetworkError(null);
    setNetworkLoading(true);
    try {
      const apiUrl = new URL('/api/surveillance/cameras', window.location.origin);
      if (telemetryTenantId) apiUrl.searchParams.set('tenant_id', telemetryTenantId);
      const res = await fetchWithAuthRetry(apiUrl.toString());
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

  const loadGallery = useCallback(async () => {
    if (!assetTenantId) {
      setGalleryError('No hay empresa activa para listar la galería.');
      return;
    }
    setGalleryError(null);
    setGalleryLoading(true);
    try {
      const images = await fetchTenantGallery(assetTenantId);
      setGalleryImages(images);
    } finally {
      setGalleryLoading(false);
    }
  }, [assetTenantId]);

  useEffect(() => {
    if (tab === 'gallery') loadGallery();
  }, [tab, loadGallery]);

  const insertFromGallery = async (image: TenantGalleryImage) => {
    if (!assetTenantId) return;
    setGalleryInsertingId(image.image_id);
    try {
      // El JPEG completo se descarga recién aquí — "bajo demanda", solo al
      // insertar de verdad (la lista de galería solo trajo la miniatura).
      const dataUrl = await fetchTenantGalleryImageDataUrl(assetTenantId, image.image_id);
      if (!dataUrl) {
        setGalleryError('No se pudo descargar la imagen completa.');
        return;
      }
      onComplete(dataUrl);
      onClose();
    } finally {
      setGalleryInsertingId(null);
    }
  };

  /**
   * Valida brillo. Retorna true (ok), false (oscuro), o 'tainted' (CORS).
   */
  const validateImage = (src: string): Promise<boolean | 'tainted'> => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 100; c.height = 100;
        const ctx = c.getContext('2d')!;
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
        c.getContext('2d')!.drawImage(video, 0, 0);
        const url = c.toDataURL('image/jpeg', 0.9);
        const resV = await validateImage(url);
        if (resV !== false) { onComplete(url); onClose(); return; }
      }

      // 2. Intento Servidor
      // ADR-082: basta con estar autenticado; la cookie HttpOnly viaja sola.
      if (getSession()) {
        const apiUrl = new URL('/api/surveillance/camera-snapshot', window.location.origin);
        apiUrl.searchParams.set('camera_id', String(selectedNetworkId));
        apiUrl.searchParams.set('tenant_id', String(telemetryTenantId));
        const resp = await fetch(apiUrl.toString(), {
          credentials: 'include',
          headers: sharedAuthHeaders(),
        });
        if (resp.ok) {
           const blob = await resp.blob();
           const reader = new FileReader();
           const urlS = await new Promise<string>(r => { reader.onloadend = () => r(reader.result as string); reader.readAsDataURL(blob); });
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
          {['file', 'gallery', 'camera', 'screen', 'network'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`py-3 text-sm font-bold border-b-2 transition-all ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t === 'file' ? 'Local' : t === 'gallery' ? 'Galería' : t === 'camera' ? 'Webcam' : t === 'screen' ? 'Pantalla' : 'Cámara Red'}
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
               <button onClick={() => fileInputRef.current?.click()} className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all">Seleccionar Archivo</button>
            </div>
          )}

          {tab === 'gallery' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500 font-semibold">
                  Fotos de la unidad minera registradas en la plataforma — clic para insertar en el lienzo.
                </p>
                <button onClick={loadGallery} className="p-2 bg-slate-100 rounded-xl text-slate-600 hover:bg-slate-200 shrink-0" title="Actualizar galería">
                  <RefreshCw size={16} className={galleryLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              {galleryError && (
                <div className="p-3 bg-amber-50 border border-amber-100 text-amber-800 text-sm rounded-2xl flex items-center gap-2">
                  <AlertCircle size={16} className="text-amber-600 shrink-0" /> <span>{galleryError}</span>
                </div>
              )}
              {galleryLoading ? (
                <div className="py-16 flex items-center justify-center text-slate-400">
                  <RefreshCw size={24} className="animate-spin" />
                </div>
              ) : galleryImages.length === 0 ? (
                <div className="py-16 border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center bg-slate-50/50 text-center px-6">
                  <Images size={40} className="text-slate-200 mb-3" />
                  <p className="text-sm text-slate-500 font-semibold">Sin imágenes registradas para esta empresa todavía.</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-96 overflow-auto pr-1">
                  {galleryImages.map((img) => (
                    <button
                      key={img.image_id}
                      onClick={() => insertFromGallery(img)}
                      disabled={galleryInsertingId !== null}
                      className="relative aspect-square rounded-2xl overflow-hidden border border-slate-200 hover:border-indigo-400 hover:shadow-lg transition-all group disabled:opacity-50"
                      title={img.filename}
                    >
                      <img src={img.thumbnail_data_url} alt={img.filename} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-colors flex items-center justify-center">
                        {galleryInsertingId === img.image_id && <RefreshCw size={20} className="animate-spin text-white" />}
                      </div>
                      <span className="absolute bottom-0 inset-x-0 bg-slate-900/70 text-white text-[10px] px-1.5 py-1 truncate">{img.filename}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'camera' && (
            <div className="space-y-4 max-w-xl mx-auto">
               <div className="flex gap-2">
                 <select className="flex-1 p-3 border rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10" value={deviceId} onChange={e => switchCamera(e.target.value)}>
                   {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Detectando...'}</option>)}
                 </select>
                 <button onClick={refreshVideoDevices} className="p-3 bg-slate-100 rounded-2xl text-slate-600 hover:bg-slate-200"><RefreshCw size={18}/></button>
               </div>
               <div className="aspect-video bg-slate-900 rounded-3xl overflow-hidden shadow-inner border border-slate-200">
                 <video ref={videoRef} className="w-full h-full object-contain" autoPlay muted playsInline/>
               </div>
               <button onClick={() => {
                 const v = videoRef.current!;
                 const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
                 c.getContext('2d')!.drawImage(v, 0, 0); onComplete(c.toDataURL('image/jpeg', 0.9)); onClose();
               }} disabled={!stream} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-emerald-50 hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-30">Capturar e Insertar</button>
            </div>
          )}

          {tab === 'screen' && (
            <div className="space-y-4 max-w-xl mx-auto">
              {screenError && (
                <div className="p-3 bg-amber-50 border border-amber-100 text-amber-800 text-sm rounded-2xl flex items-center gap-2">
                  <AlertCircle size={16} className="text-amber-600 shrink-0" /> <span>{screenError}</span>
                </div>
              )}
              <div className="aspect-video bg-slate-900 rounded-3xl overflow-hidden shadow-inner border border-slate-200 flex items-center justify-center">
                {screenStream ? (
                  <video ref={screenVideoRef} className="w-full h-full object-contain" autoPlay muted playsInline />
                ) : (
                  <div className="text-center px-6">
                    <MonitorPlay size={40} className="text-slate-600 mb-3 mx-auto" />
                    <p className="text-sm text-slate-400">Comparta una ventana, pestaña o pantalla completa para capturarla.</p>
                  </div>
                )}
              </div>
              {screenStream ? (
                <div className="flex gap-2">
                  <button onClick={stopScreenShare} className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold text-sm hover:bg-slate-200 transition-all">Detener</button>
                  <button onClick={captureScreenPhoto} className="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-emerald-50 hover:bg-emerald-700 active:scale-[0.98] transition-all">Capturar e Insertar</button>
                </div>
              ) : (
                <button onClick={startScreenShare} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-[0.98] transition-all">Compartir pantalla/ventana</button>
              )}
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

export default memo(ImageInsertModal);
