import React from 'react';

/**
 * Editor FORMULA embebido desde /formula/index.html (public/formula).
 * Las llamadas API usan el prefijo /formula-api (proxy → servicio formula_engine en Docker).
 */
export default function FormulaEngineEmbed() {
  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-slate-100 dark:bg-slate-950">
      <iframe
        title="FORMULA — Editor de reglas"
        src="/formula/index.html"
        className="flex-1 w-full min-h-[70vh] border-0 bg-white"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
