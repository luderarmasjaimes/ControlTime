import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { log } from '../lib/logger';

interface Props {
    children: React.ReactNode;
    /** Al cambiar (p.ej. la pestaña activa), limpia un error atrapado previamente. */
    resetKey?: unknown;
}

interface State {
    error: Error | null;
}

/**
 * Sin esto, cualquier excepción no capturada durante el render de UNA vista
 * (p.ej. un tile layer de Leaflet mal configurado -- ver MapViewer.tsx,
 * basemap "Terreno") desmontaba TODA la plataforma a pantalla en blanco: no
 * había ningún Error Boundary en el árbol. Se envuelve el host de vistas con
 * este componente para que un fallo quede contenido al área de contenido —
 * el resto del shell (menú, header, sesión) sigue operativo y el usuario
 * puede reintentar o cambiar de módulo.
 */
export class ViewErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        log.error('[ViewErrorBoundary] vista con error no capturado', error, info.componentStack);
    }

    componentDidUpdate(prevProps: Props) {
        if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex h-full min-h-[320px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/30 bg-rose-950/20 p-8 text-center text-slate-200">
                    <AlertTriangle className="text-rose-400" size={32} />
                    <div
                        className="text-sm font-bold uppercase tracking-wide"
                        style={{ fontFamily: 'var(--font-mining-display)' }}
                    >
                        Esta vista tuvo un error inesperado
                    </div>
                    <p className="max-w-md text-xs text-slate-400" style={{ fontFamily: 'var(--font-mining-ui)' }}>
                        El resto de la plataforma sigue funcionando con normalidad. Puede reintentar
                        o cambiar de módulo desde el menú.
                    </p>
                    <button
                        type="button"
                        onClick={() => this.setState({ error: null })}
                        className="mt-1 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-slate-800"
                        style={{ fontFamily: 'var(--font-mining-ui)' }}
                    >
                        <RefreshCw size={14} />
                        Reintentar
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ViewErrorBoundary;
