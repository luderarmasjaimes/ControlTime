import React, { memo, useState } from 'react';
import { BookOpen, Globe2, Layers, MapPinned, Sliders } from 'lucide-react';
import GeocatminWorkbench from './GeocatminWorkbench';
import MapViewer from './MapViewer';
import HUB from '../../config/miningGeoportalHub.json';

const HUB_DATA: any = HUB;

/**
 * Vista Integrada GEOCATMIN INGEMMET + Geoservidor Minero
 *
 * Ofrece la Suite Operativa Completa de GEOCATMIN con ingreso directo por unidad minera
 * y acceso alternativo a la arquitectura conceptual del Geoservidor.
 * Conforme a SPEC-024 y ADR-123.
 */
function MiningGeoportalView() {
  const [viewMode, setViewMode] = useState<'workbench' | 'architecture'>('workbench');

  return (
    <div className="mining-geoportal-root flex h-full w-full flex-col overflow-hidden bg-slate-950">
      {/* Selector de Modo Superior */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-[11px]">
        <div className="flex items-center gap-2 text-slate-300">
          <Globe2 size={15} className="text-cyan-400" />
          <span className="font-bold text-slate-100">Portal Geocientífico & Catastro Minero (INGEMMET)</span>
          <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
            SPEC-024 / ADR-123
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('workbench')}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-semibold transition-colors ${
              viewMode === 'workbench'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers size={13} />
            <span>Suite Operativa GEOCATMIN</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('architecture')}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-semibold transition-colors ${
              viewMode === 'architecture'
                ? 'bg-amber-500/20 text-amber-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen size={13} />
            <span>Arquitectura Geoservidor</span>
          </button>
        </div>
      </div>

      {/* Contenido según el modo */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'workbench' ? (
          <GeocatminWorkbench />
        ) : (
          <div className="flex h-full w-full flex-col gap-0 lg:flex-row lg:gap-3">
            <aside className="mining-geoportal-aside flex max-h-[42vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-cyan-500/15 bg-slate-950/80 px-3 py-3 backdrop-blur-md lg:max-h-none lg:w-[min(100%,400px)] lg:border-b-0 lg:border-r lg:px-4">
              <div className="flex items-start gap-2 border-b border-slate-700/60 pb-3">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/35 bg-amber-500/10 text-amber-200">
                  <Globe2 size={20} />
                </span>
                <div className="min-w-0">
                  <h2 className="mining-workbench-page-title !text-base !leading-tight !tracking-wide">
                    {HUB_DATA.title}
                  </h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{HUB_DATA.concept?.lead}</p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-700/70 bg-slate-900/45 p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <BookOpen size={12} className="text-cyan-400" />
                  Módulos de Arquitectura Geoespacial
                </div>
                <ul className="list-inside list-disc space-y-1 text-[10px] text-slate-400">
                  {(HUB_DATA.concept?.bullets || []).map((b: string) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 p-2.5">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-200/90">
                  {HUB_DATA.differential?.title || 'Plataforma Inteligente'}
                </div>
                <ul className="space-y-1 text-[10px] text-amber-100/80">
                  {(HUB_DATA.differential?.bullets || []).map((b: string) => (
                    <li key={b}>• {b}</li>
                  ))}
                </ul>
              </div>
            </aside>

            <div className="relative min-h-[min(55vh,520px)] min-w-0 flex-1 lg:min-h-0">
              <MapViewer
                layout="default"
                mapTitle="Visor Geoservidor Minero"
                syncedWmsPresetKey="PERMIN:ingemmet-catastro"
                geoportalModuleLabel="Catastro Minero Oficial INGEMMET"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MiningGeoportalView);
