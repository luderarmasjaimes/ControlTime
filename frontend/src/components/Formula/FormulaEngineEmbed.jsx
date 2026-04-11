import React from 'react';
import { PlatformBrandDashboardBlock } from '../../brand/PlatformBrandMark';

/**
 * Editor FORMULA embebido desde /formula/index.html (public/formula).
 * Las llamadas API usan el prefijo /formula-api (proxy → servicio formula_engine en Docker).
 */
export default function FormulaEngineEmbed({
  platformCompanyName = 'AURIXA',
  miningCompanyName = 'Empresa minera',
}) {
  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-slate-950">
      <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-cyan-500/25 bg-slate-950/90 backdrop-blur-xl">
        <PlatformBrandDashboardBlock
          linePrimary={platformCompanyName}
          lineSecondary={`Motor de fórmula · ${miningCompanyName}`}
        />
      </header>
      <iframe
        title="FORMULA — Editor de reglas"
        src="/formula/index.html"
        className="flex-1 w-full min-h-0 border-0 bg-white"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
