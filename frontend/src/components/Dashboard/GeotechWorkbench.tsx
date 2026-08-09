import React, { memo } from 'react';
import { Activity, Layers, Box } from 'lucide-react';

interface GeotechMeta {
    title: string;
    subtitle: string;
    icon: React.ElementType;
}

const META: Record<string, GeotechMeta> = {
    Inclinometer: {
        title: 'Estabilidad de talud',
        subtitle: 'Curvas inclinómetro X/Y por profundidad, alineadas con azimut e instalación del panel derecho.',
        icon: Activity,
    },
    'Displacement Cumulative': {
        title: 'Movimiento del terreno',
        subtitle: 'Evolución acumulada frente a profundidad para seguimiento geomecánico de instrumentación.',
        icon: Layers,
    },
    '3D': {
        title: 'Vista 3D de la mina',
        subtitle: 'Trayectorias sintéticas en volumen técnico; orbitar con el puntero para inspección espacial.',
        icon: Box,
    },
};

interface GeotechWorkbenchProps {
    tabKey: string;
    children?: React.ReactNode;
}

/**
 * Marco común para la categoría «Geotecnia y modelado 3D»: título, subtítulo y contenedor del área central.
 */
function GeotechWorkbench({ tabKey, children }: GeotechWorkbenchProps) {
    const meta = META[tabKey] || META.Inclinometer;
    const Icon = meta.icon;

    return (
        <div className="geotech-workbench-root flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3">
            <header className="geotech-workbench-toolbar shrink-0 rounded-xl border border-cyan-500/20 bg-slate-950/55 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md">
                <div className="flex flex-wrap items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-cyan-200">
                        <Icon size={20} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h1 className="mining-workbench-page-title text-[clamp(1.1rem,2.5vw,1.55rem)]">{meta.title}</h1>
                        <p className="mining-workbench-page-subtitle mt-1 text-[13px] leading-snug">{meta.subtitle}</p>
                    </div>
                </div>
            </header>
            <div className="geotech-workbench-stage relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto rounded-xl border border-slate-600/40 bg-slate-950/35 shadow-inner">
                {children}
            </div>
        </div>
    );
}

export default memo(GeotechWorkbench);
