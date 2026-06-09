import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Cpu, Globe2, Layers, Link2, MapPinned } from 'lucide-react';
import MapViewer from './MapViewer';
import HUB from '../../config/miningGeoportalHub.json';

/**
 * Hub «Geoservidor minero»: concepto, módulos A–F, arquitectura MVP, referencias y visor sincronizado con preset WMS sugerido.
 */
export default function MiningGeoportalView() {
    const modules = useMemo(() => (Array.isArray(HUB.modules) ? HUB.modules : []), []);
    const [activeId, setActiveId] = useState(modules[0]?.id || 'catastro');
    const [openConcept, setOpenConcept] = useState(true);
    const [openArch, setOpenArch] = useState(true);
    const [openRefs, setOpenRefs] = useState(false);

    const active = modules.find((m) => m.id === activeId) || modules[0];

    return (
        <div className="mining-geoportal-root flex min-h-0 min-w-0 w-full flex-1 flex-col gap-0 lg:flex-row lg:gap-3">
            <aside className="mining-geoportal-aside flex max-h-[42vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-cyan-500/15 bg-slate-950/80 px-3 py-3 backdrop-blur-md lg:max-h-none lg:w-[min(100%,400px)] lg:border-b-0 lg:border-r lg:px-4">
                <div className="flex items-start gap-2 border-b border-slate-700/60 pb-3">
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/35 bg-amber-500/10 text-amber-200">
                        <Globe2 size={20} />
                    </span>
                    <div className="min-w-0">
                        <h2 className="mining-workbench-page-title !text-base !leading-tight !tracking-wide">
                            {HUB.title}
                        </h2>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{HUB.concept?.lead}</p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => setOpenConcept((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-900/50 px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-300 hover:bg-slate-900/80"
                >
                    <span className="flex items-center gap-2">
                        <BookOpen size={14} className="text-cyan-400" />
                        Rol del Geoservidor
                    </span>
                    {openConcept ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {openConcept && HUB.concept?.bullets?.length ? (
                    <ul className="space-y-1.5 text-[11px] leading-snug text-slate-400">
                        {HUB.concept.bullets.map((b) => (
                            <li key={b} className="flex gap-2">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-500/80" />
                                <span>{b}</span>
                            </li>
                        ))}
                    </ul>
                ) : null}

                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Módulos</div>
                <nav className="flex flex-col gap-1.5">
                    {modules.map((m) => {
                        const isOn = m.id === activeId;
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setActiveId(m.id)}
                                className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                                    isOn
                                        ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-50'
                                        : 'border-slate-700/60 bg-slate-900/40 text-slate-300 hover:border-slate-600 hover:bg-slate-900/65'
                                }`}
                            >
                                <div className="text-[11px] font-bold">
                                    <span className="mr-1.5 font-mono text-cyan-400/90">{m.letter}.</span>
                                    {m.title}
                                </div>
                                <div className="mt-0.5 line-clamp-2 text-[10px] font-normal text-slate-400">{m.summary}</div>
                            </button>
                        );
                    })}
                </nav>

                {active ? (
                    <div className="rounded-lg border border-slate-700/70 bg-slate-900/45 p-2.5">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            <Layers size={12} className="text-sky-400" />
                            Detalle del módulo {active.letter}
                        </div>
                        <ul className="list-inside list-disc space-y-1 text-[10px] text-slate-400">
                            {(active.details || []).map((d) => (
                                <li key={d}>{d}</li>
                            ))}
                        </ul>
                        {active.wmsPreset ? (
                            <p className="mt-2 text-[10px] text-cyan-200/80">
                                Preset WMS sugerido cargado en el visor:{' '}
                                <code className="rounded bg-slate-950 px-1 py-0.5 text-cyan-300">{active.wmsPreset}</code>
                            </p>
                        ) : (
                            <p className="mt-2 text-[10px] text-amber-200/85">
                                Sin preset WMS dedicado: use operación en mapa y enlaces BI externos cuando aplique.
                            </p>
                        )}
                        {(active.links || []).length ? (
                            <div className="mt-2 flex flex-col gap-1 border-t border-slate-700/50 pt-2">
                                {(active.links || []).map((lnk) => (
                                    <a
                                        key={lnk.href}
                                        href={lnk.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-400 hover:text-sky-300"
                                    >
                                        <Link2 size={10} />
                                        {lnk.label}
                                    </a>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <button
                    type="button"
                    onClick={() => setOpenArch((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-900/50 px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-300 hover:bg-slate-900/80"
                >
                    <span className="flex items-center gap-2">
                        <Cpu size={14} className="text-amber-400" />
                        {HUB.mvpStack?.title || 'Arquitectura MVP'}
                    </span>
                    {openArch ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {openArch && HUB.mvpStack?.items?.length ? (
                    <ul className="space-y-1.5 text-[10px] leading-snug text-slate-400">
                        {HUB.mvpStack.items.map((item) => (
                            <li key={item} className="flex gap-2">
                                <span className="text-amber-500/90">—</span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                ) : null}

                {HUB.differential?.bullets?.length ? (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 p-2.5">
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-200/90">
                            {HUB.differential.title}
                        </div>
                        <ul className="space-y-1 text-[10px] text-amber-100/80">
                            {HUB.differential.bullets.map((b) => (
                                <li key={b}>• {b}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                <button
                    type="button"
                    onClick={() => setOpenRefs((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-900/50 px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-300 hover:bg-slate-900/80"
                >
                    <span className="flex items-center gap-2">
                        <MapPinned size={14} className="text-emerald-400" />
                        Referencias por país
                    </span>
                    {openRefs ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {openRefs && HUB.references?.length ? (
                    <div className="space-y-2 text-[10px]">
                        {HUB.references.map((block) => (
                            <div key={block.region}>
                                <div className="mb-1 font-bold text-slate-400">{block.region}</div>
                                <ul className="space-y-1">
                                    {(block.items || []).map((it) => (
                                        <li key={it.href}>
                                            <a
                                                href={it.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sky-400 hover:text-sky-300"
                                            >
                                                {it.label}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                ) : null}

                {HUB.useCases?.length ? (
                    <div className="rounded-lg border border-slate-700/60 bg-slate-900/35 p-2.5">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Casos de uso</div>
                        <ul className="space-y-1 text-[10px] text-slate-500">
                            {HUB.useCases.map((u) => (
                                <li key={u}>• {u}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </aside>

            <div className="relative min-h-[min(55vh,520px)] min-w-0 flex-1 lg:min-h-0">
                <MapViewer
                    layout="default"
                    mapTitle="Visor Geoservidor minero"
                    syncedWmsPresetKey={active?.wmsPreset || null}
                    geoportalModuleLabel={active?.title || null}
                />
            </div>
        </div>
    );
}
