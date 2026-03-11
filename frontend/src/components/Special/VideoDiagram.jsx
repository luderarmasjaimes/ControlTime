import React, { useState, useRef } from 'react'
import { Play, Pause, Maximize, Activity, Zap } from 'lucide-react'

const VideoDiagram = ({ src }) => {
    const [isPlaying, setIsPlaying] = useState(false)
    const videoRef = useRef(null)

    const togglePlay = () => {
        if (videoRef.current.paused) {
            videoRef.current.play()
            setIsPlaying(true)
        } else {
            videoRef.current.pause()
            setIsPlaying(false)
        }
    }

    const [videoError, setVideoError] = useState(false)

    return (
        <div className="w-full aspect-video glass relative group overflow-hidden border-white/5 bg-black">
            {/* Real video or placeholder */}
            {(!src || videoError) ? (
                <div className="absolute inset-0 flex items-center justify-center">
                    <img
                        src="/data/demo/video_bg.png"
                        className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay"
                        alt="Video Simulation Background"
                    />
                    <div className="text-sky-500/40 flex flex-col items-center gap-4 relative z-10">
                        <Activity size={64} className="animate-pulse shadow-[0_0_20px_rgba(14,165,233,0.3)]" />
                        <div className="text-center">
                            <span className="text-xs uppercase font-black tracking-[0.3em] text-sky-400 block mb-1">Live Stream Simulation</span>
                            <span className="text-[9px] uppercase font-bold text-slate-600 tracking-tighter">Buscando señal de pozo activo...</span>
                        </div>
                    </div>
                </div>
            ) : null}

            <video
                ref={videoRef}
                src={src}
                className={`w-full h-full object-cover opacity-60 transition-opacity duration-1000 ${videoError ? 'opacity-0' : 'opacity-60'}`}
                autoPlay
                loop
                muted
                playsInline
                onError={() => setVideoError(true)}
            />

            {/* Diagram Overlays (The "WOW" effector) */}
            <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 bg-sky-500/10 backdrop-blur-md px-2 py-1 border border-sky-500/20 rounded">
                            <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                            <span className="text-[9px] font-bold text-sky-400 uppercase">Live Azimuth Correction</span>
                        </div>
                        <div className="text-2xl font-black text-white font-mono mt-1">245.82°</div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                        <div className="bg-emerald-500/10 backdrop-blur-md px-2 py-1 border border-emerald-500/20 rounded">
                            <span className="text-[9px] font-bold text-emerald-400 uppercase">Dip Angle</span>
                        </div>
                        <div className="text-2xl font-black text-white font-mono mt-1">-12.4°</div>
                    </div>
                </div>

                {/* Dynamic Graphic Lines Overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-30">
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-sky-500 to-transparent absolute top-1/2 -translate-y-1/2" />
                    <div className="w-0.5 h-full bg-gradient-to-b from-transparent via-sky-500 to-transparent absolute left-1/2 -translate-x-1/2" />
                    <div className="w-32 h-32 border-2 border-dashed border-sky-500/50 rounded-full animate-[spin_10s_linear_infinite]" />
                </div>

                <div className="flex justify-between items-end">
                    <div className="flex gap-4">
                        <div className="flex flex-col">
                            <span className="text-[8px] text-slate-500 uppercase font-bold">X-Coord</span>
                            <span className="text-xs font-mono text-white">452,128.42</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[8px] text-slate-500 uppercase font-bold">Y-Coord</span>
                            <span className="text-xs font-mono text-white">8,912,404.11</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 pointer-events-auto">
                        <button
                            onClick={togglePlay}
                            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center transition-all"
                        >
                            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-1" />}
                        </button>
                        <button className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center transition-all">
                            <Maximize size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/5">
                <div className="h-full bg-sky-500 w-1/3 shadow-[0_0_10px_#0ea5e9]" />
            </div>
        </div>
    )
}

export default VideoDiagram
