import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Activity, Maximize, Camera, Monitor, Radio } from 'lucide-react'

/** Rejilla fija: misma señal de webcam en todas las celdas (pruebas). */
const GRID_SLOTS = 9

const VideoDiagram = ({ miningCompanyName, siteUnitName }) => {
    const [cameras, setCameras] = useState([])
    const [loading, setLoading] = useState(true)
    const [webcamActive, setWebcamActive] = useState(false)
    const streamRef = useRef(null)
    const videoRefs = useRef([])

    useEffect(() => {
        if (typeof process !== 'undefined' && process.env?.VITEST) {
            setLoading(false)
            return
        }

        const apiUrl = new URL('/api/surveillance/cameras', window.location.origin)
        if (miningCompanyName) apiUrl.searchParams.set('mining_company', miningCompanyName)
        if (siteUnitName) apiUrl.searchParams.set('site_unit', siteUnitName)

        fetch(apiUrl.toString())
            .then((res) => res.json())
            .then((data) => {
                if (data.cameras) setCameras(data.cameras)
                setLoading(false)
            })
            .catch((err) => {
                console.error('Failed to load cameras', err)
                setLoading(false)
            })
    }, [miningCompanyName, siteUnitName])

    const syncStreamToVideos = () => {
        const stream = streamRef.current
        videoRefs.current.forEach((el) => {
            if (el) {
                el.srcObject = stream
            }
        })
    }

    useEffect(() => {
        if (!webcamActive) {
            videoRefs.current.forEach((el) => {
                if (el) el.srcObject = null
            })
            return
        }
        syncStreamToVideos()
    }, [webcamActive, cameras.length])

    const toggleWebcam = async () => {
        if (webcamActive) {
            streamRef.current?.getTracks().forEach((track) => track.stop())
            streamRef.current = null
            syncStreamToVideos()
            setWebcamActive(false)
            return
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            })
            streamRef.current = stream
            setWebcamActive(true)
            requestAnimationFrame(() => syncStreamToVideos())
        } catch (err) {
            console.error('Error accessing webcam:', err)
        }
    }

    const slotLabels = useMemo(() => {
        return Array.from({ length: GRID_SLOTS }, (_, i) => {
            const cam = cameras[i]
            const suffix = cam ? cam.name : 'Prueba local (misma señal)'
            return `CAM ${String(i + 1).padStart(2, '0')} — ${suffix}`
        })
    }, [cameras])

    if (loading) {
        return (
            <div className="flex h-full min-h-0 w-full flex-col items-center justify-center bg-slate-900 p-8">
                <Activity size={48} className="mb-4 animate-pulse text-sky-500" />
                <div className="text-sm font-bold uppercase tracking-widest text-sky-400">Sincronizando Streams...</div>
            </div>
        )
    }

    return (
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-[#020617] p-4 sm:p-6 vid-scroll">
            <div className="mb-4 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="flex items-center gap-3 text-xl font-bold text-white sm:text-2xl">
                        <Camera className="text-sky-400" />
                        Centro de Control CCTV - RAURA
                    </h3>
                    <p className="mt-1 text-xs uppercase tracking-tighter text-slate-500">
                        Monitoreo de seguridad y estabilidad de taludes
                    </p>
                    {(miningCompanyName || siteUnitName) && (
                        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-sky-500/90">
                            Minera: <span className="text-slate-200">{miningCompanyName || '—'}</span>
                            <span className="mx-2 text-slate-600">·</span>
                            Unidad: <span className="text-slate-200">{siteUnitName || '—'}</span>
                        </p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={toggleWebcam}
                        className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold transition-all ${
                            webcamActive
                                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-400'
                                : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                    >
                        <Monitor size={14} />
                        {webcamActive ? 'DETENER WEBCAM' : 'ACTIVAR WEBCAM'}
                    </button>
                    <span className="rounded border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[10px] font-bold text-sky-400">
                        {GRID_SLOTS} celdas · {cameras.length} nodos BD
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:gap-6">
                {slotLabels.map((label, idx) => (
                    <div
                        key={idx}
                        className="group relative aspect-video overflow-hidden rounded-2xl border-2 border-slate-800 bg-slate-950 shadow-2xl"
                    >
                        <video
                            ref={(el) => {
                                videoRefs.current[idx] = el
                                if (el && streamRef.current) el.srcObject = streamRef.current
                            }}
                            autoPlay
                            playsInline
                            muted
                            className={`h-full w-full object-cover ${webcamActive ? 'opacity-100' : 'opacity-0'}`}
                        />

                        {!webcamActive && (
                            <div className="absolute inset-0 m-2 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900">
                                <Monitor size={32} className="mb-2 text-slate-700" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                    Webcam standby
                                </span>
                                <span className="mt-1 text-[9px] text-slate-700">Pulse activar para esta celda y las demás</span>
                            </div>
                        )}

                        {webcamActive && (
                            <div className="pointer-events-none absolute inset-0 border-t border-b border-white/5 opacity-20" />
                        )}

                        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="max-w-[85%] rounded border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-bold uppercase text-white backdrop-blur-md">
                                    {label}
                                </div>
                                {webcamActive && (
                                    <div className="animate-pulse rounded bg-emerald-500 px-2 py-0.5 text-[9px] font-black text-white">
                                        LIVE
                                    </div>
                                )}
                            </div>
                            {cameras[idx] && (
                                <div className="flex items-end justify-between opacity-0 transition-opacity group-hover:opacity-100">
                                    <span className="font-mono text-[9px] text-sky-400/80">
                                        {Number(cameras[idx].lat).toFixed(4)} / {Number(cameras[idx].lng).toFixed(4)}
                                    </span>
                                    <span className="pointer-events-auto rounded-lg border border-white/10 bg-white/5 p-2 backdrop-blur-md">
                                        <Maximize size={12} className="text-white" />
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 flex shrink-0 items-center gap-2 text-[10px] text-slate-600">
                <Radio size={14} />
                Todas las celdas reutilizan el mismo MediaStream del navegador (solo pruebas locales).
            </div>

            <style>{`
                .vid-scroll::-webkit-scrollbar { width: 6px; }
                .vid-scroll::-webkit-scrollbar-track { background: transparent; }
                .vid-scroll::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
            `}</style>
        </div>
    )
}

export default VideoDiagram
