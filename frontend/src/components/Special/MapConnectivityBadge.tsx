import React from 'react';
import { Wifi, WifiOff, SignalMedium } from 'lucide-react';
import { useConnectivity } from '../../lib/connectivityMonitor';

/**
 * Indicador de conectividad del mapa. Texto exigido explícitamente por el
 * cliente: "MAPA - OFFLINE" mientras no hay red real, y "MAPA - CONECTADO"
 * (aceptado también como ONLINE) al restablecerse — transición automática,
 * sin acción del usuario, controlada por connectivityMonitor.ts.
 */
const MapConnectivityBadge = () => {
    const { state } = useConnectivity();

    const config = {
        ONLINE_PLENO: {
            text: 'MAPA - CONECTADO',
            icon: Wifi,
            className: 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100',
        },
        DEGRADADO: {
            text: 'MAPA - CONECTADO (RED LIMITADA)',
            icon: SignalMedium,
            className: 'border-amber-400/60 bg-amber-500/15 text-amber-100',
        },
        OFFLINE: {
            text: 'MAPA - OFFLINE',
            icon: WifiOff,
            className: 'border-rose-400/60 bg-rose-500/15 text-rose-100',
        },
    }[state];

    const Icon = config.icon;

    return (
        <div
            className={`pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide shadow-lg backdrop-blur-md ${config.className}`}
            role="status"
        >
            <Icon size={13} />
            {config.text}
        </div>
    );
};

export default MapConnectivityBadge;
