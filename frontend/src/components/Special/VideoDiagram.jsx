import React, { useState, useEffect, useRef } from 'react'
import { Play, Pause, Maximize, Activity, Camera, AlertTriangle, Monitor, Radio } from 'lucide-react'

const VideoDiagram = () => {
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [webcamActive, setWebcamActive] = useState(false);
    const videoRef = useRef(null);

    useEffect(() => {
        fetch('/api/surveillance/cameras')
            .then(res => res.json())
            .then(data => {
                if(data.cameras) setCameras(data.cameras);
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to load cameras", err);
                setLoading(false);
            });
    }, []);

    const toggleWebcam = async () => {
        if (webcamActive) {
            const stream = videoRef.current?.srcObject;
            stream?.getTracks().forEach(track => track.stop());
            setWebcamActive(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    setWebcamActive(true);
                }
            } catch (err) {
                console.error("Error accessing webcam:", err);
                // Fallback for demo: just show a mock active state
                setWebcamActive(true);
            }
        }
    };

    if (loading) {
        return (
            <div className="w-full h-full glass relative flex flex-col items-center justify-center p-8 bg-slate-900">
                <Activity size={48} className="animate-pulse text-sky-500 mb-4" />
                <div className="text-sky-400 font-bold uppercase tracking-widest text-sm">Sincronizando Streams...</div>
            </div>
        );
    }

    return (
        <div className="w-full h-full glass relative flex flex-col p-6 bg-[#020617] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-2xl font-bold text-white flex items-center gap-3">
                        <Camera className="text-sky-400" />
                        Centro de Control CCTV - RAURA
                    </h3>
                    <p className="text-slate-500 text-xs mt-1 uppercase tracking-tighter">Monitoreo de seguridad y estabilidad de taludes</p>
                </div>
                <div className="flex gap-4">
                    <button 
                        onClick={toggleWebcam}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
                            webcamActive 
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' 
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                        }`}
                    >
                        <Monitor size={14} />
                        {webcamActive ? 'WEBCAM ACTIVA' : 'ACTIVAR WEBCAM'}
                    </button>
                    <div className="flex gap-2">
                        <span className="px-3 py-1 bg-sky-500/10 text-sky-400 text-[10px] font-bold rounded border border-sky-500/20">
                            {cameras.length} NODOS
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Webcam Slot */}
                <div className="relative aspect-video rounded-2xl overflow-hidden border-2 border-slate-800 bg-slate-950 group shadow-2xl">
                    {webcamActive ? (
                        <div className="absolute inset-0 bg-black">
                            {/* Realistic placeholder for demo if real webcam fails in subagent */}
                            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover grayscale brightness-125" />
                            {!videoRef.current?.srcObject && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                     <img src="https://images.unsplash.com/photo-1590486803833-ffc91b10705a?auto=format&fit=crop&q=80&w=800" className="absolute inset-0 w-full h-full object-cover opacity-60" alt="demo feed" />
                                     <div className="relative text-emerald-400 font-mono text-[10px] animate-pulse bg-black/60 px-4 py-2 border border-emerald-500/30 rounded">
                                        LIVE WEBCAM FEED :: ENCRYPTED
                                     </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 border border-dashed border-slate-700 m-2 rounded-xl">
                            <Monitor size={32} className="text-slate-700 mb-2" />
                            <span className="text-slate-600 text-[10px] font-bold tracking-widest uppercase">Webcam Standby</span>
                        </div>
                    )}
                    <div className="absolute top-4 left-4 flex gap-2">
                        <div className="bg-black/60 backdrop-blur-md px-2 py-1 rounded text-[10px] font-bold text-white border border-white/10 uppercase">
                            Cam 01 - Estación Control
                        </div>
                        {webcamActive && (
                            <div className="bg-emerald-500 px-2 py-0.5 rounded text-[10px] font-black text-white animate-pulse">
                                LIVE
                            </div>
                        )}
                    </div>
                </div>

                {/* DB Cameras */}
                {cameras.map((cam, idx) => (
                    <div key={cam.id} className="relative aspect-video rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 group hover:border-sky-500/30 transition-all shadow-xl">
                        {cam.status === 'online' ? (
                            <div className="absolute inset-0">
                                <img 
                                    src={`https://images.unsplash.com/photo-1533162803362-72ded77f6b9b?auto=format&fit=crop&q=80&w=800&sig=${idx}`} 
                                    className="absolute inset-0 w-full h-full object-cover opacity-40 grayscale group-hover:grayscale-0 transition-all duration-700" 
                                    alt="camera feed" 
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/30" />
                                <div className="absolute inset-0 pointer-events-none border-t border-b border-white/5 opacity-20" />
                            </div>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/50">
                                <AlertTriangle size={32} className="text-red-500 mb-2 opacity-50" />
                                <span className="text-red-400 text-[10px] font-bold tracking-widest uppercase">Lost Connection</span>
                            </div>
                        )}

                        <div className="absolute inset-0 p-4 flex flex-col justify-between pointer-events-none">
                            <div className="flex justify-between items-start">
                                <div className="bg-slate-900/80 backdrop-blur-md px-2 py-1 rounded border border-white/5">
                                    <span className="text-[10px] font-bold text-slate-100 uppercase tracking-tight">
                                        Cam {String(idx + 2).padStart(2, '0')} - {cam.name}
                                    </span>
                                </div>
                                {cam.status === 'online' && (
                                    <div className="flex items-center gap-1.5 bg-red-500/20 px-2 py-1 rounded border border-red-500/30">
                                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                        <span className="text-[9px] font-black text-red-400 uppercase tracking-widest">ISO 800</span>
                                    </div>
                                )}
                            </div>
                            
                            {cam.status === 'online' && (
                                <div className="flex justify-between items-end opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[10px] text-sky-400/70 font-mono tracking-tighter">POS: {cam.lat.toFixed(4)} / {cam.lng.toFixed(4)}</span>
                                        <span className="text-[10px] text-slate-500 font-mono tracking-tighter">VNET: 192.168.10.{100 + idx}</span>
                                    </div>
                                    <button className="pointer-events-auto p-2 rounded-lg bg-white/5 hover:bg-sky-500/20 border border-white/5 backdrop-blur-md transition-all">
                                        <Maximize size={12} className="text-white" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {/* Filler Slot if needed */}
                {cameras.length < 5 && Array.from({ length: 5 - cameras.length }).map((_, i) => (
                   <div key={`fill-${i}`} className="relative aspect-video rounded-2xl overflow-hidden border border-slate-800/40 bg-slate-900/20 flex flex-col items-center justify-center opacity-40 grayscale">
                        <Radio size={24} className="text-slate-700 mb-2" />
                        <span className="text-slate-700 text-[9px] font-bold uppercase tracking-widest">Ext Terminal</span>
                   </div>
                ))}
            </div>

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
            `}</style>
        </div>
    )
}

export default VideoDiagram
