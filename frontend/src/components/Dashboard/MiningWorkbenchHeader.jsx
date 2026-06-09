import React from 'react';

/**
 * Encabezado unificado para Centro de control, Sensores y Videovigilancia.
 * Tipografía: display minera + UI Rajdhani (variables CSS del tema).
 */
export default function MiningWorkbenchHeader({ title, subtitle, icon: Icon, actions }) {
    return (
        <header className="mining-workbench-header-row flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
                <h1 className="mining-workbench-page-title flex items-center gap-2.5">
                    {Icon ? <Icon className="h-7 w-7 shrink-0 text-sky-400" strokeWidth={2} aria-hidden /> : null}
                    <span>{title}</span>
                </h1>
                {subtitle ? <p className="mining-workbench-page-subtitle">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
    );
}
