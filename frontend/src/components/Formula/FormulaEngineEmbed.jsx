import React from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';

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
      <iframe
        title="FORMULA — Editor de reglas"
        src="/formula/index.html"
        className="flex-1 w-full min-h-0 border-0 bg-white"
        allow="clipboard-read; clipboard-write"
      />
      <div className="shrink-0 flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/95 px-3 py-2">
        <button
          type="button"
          className="mining-workbench-action-btn inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-200 hover:bg-slate-800"
          onClick={() => window.open('/formula/index.html', '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink size={14} />
          Abrir en ventana
        </button>
        <button
          type="button"
          className="mining-workbench-action-btn inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-200 hover:bg-slate-800"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={14} />
          Recargar
        </button>
      </div>
    </div>
  );
}
