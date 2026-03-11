import React from 'react';

const AzimuthCompass = ({ angle = 45, offset = 0, showOffset = true }) => {
    const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

    return (
        <div className="flex flex-col items-center gap-8 py-2">
            <div className="relative w-52 h-52 rounded-full border border-slate-100 bg-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] flex items-center justify-center">
                {/* Fine Degree Markers */}
                {[...Array(72)].map((_, i) => (
                    <div
                        key={i}
                        className={`absolute ${i % 9 === 0 ? 'bg-slate-400 w-[1.5px] h-[10px]' : 'bg-slate-200 w-[1px] h-[6px]'}`}
                        style={{
                            transform: `rotate(${i * 5}deg) translateY(-96px)`
                        }}
                    />
                ))}

                {/* Direction Labels */}
                {points.map((p, i) => (
                    <span
                        key={p}
                        className="absolute text-[9px] font-bold text-slate-400 tracking-tighter"
                        style={{
                            transform: `rotate(${i * 45}deg) translateY(-82px) rotate(-${i * 45}deg)`,
                            width: '18px',
                            textAlign: 'center'
                        }}
                    >
                        {p}
                    </span>
                ))}

                {/* Needle Shadow (Subtle) */}
                <div
                    className="absolute w-1 h-24 bg-slate-900/5 blur-[1px] origin-bottom transition-transform duration-300"
                    style={{ transform: `translateY(-48px) rotate(${angle + 2}deg)` }}
                />

                {/* Main Needle (Solid Blue) - "New angle" */}
                <div
                    className="absolute w-[2px] h-[92px] bg-blue-600 origin-bottom transition-transform duration-300 z-20"
                    style={{ transform: `translateY(-46px) rotate(${angle}deg)` }}
                >
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-blue-600 rotate-45" />
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[1px] bg-blue-600/20" />
                </div>

                {/* Installation Needle (Ghost Blue) - Reference at 0 or fixed offset */}
                <div
                    className="absolute w-[1.5px] h-[84px] bg-blue-500/20 origin-bottom transition-transform duration-500 z-10"
                    style={{ transform: `translateY(-42px) rotate(${offset}deg)` }}
                />

                {/* Center Pivot */}
                <div className="relative w-2 h-2 rounded-full bg-slate-500 border-2 border-white shadow-sm z-30" />
            </div>

            {/* Legend - Matches screenshot style */}
            <div className="w-full grid grid-cols-2 gap-2 px-1">
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-0.5 bg-blue-500/20" />
                    <span className="text-[9px] text-slate-400 font-medium whitespace-nowrap">Installation angle</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-0.5 bg-blue-600" />
                    <span className="text-[9px] text-slate-400 font-medium whitespace-nowrap">New angle</span>
                </div>
            </div>
        </div>
    );
};

export default AzimuthCompass;
