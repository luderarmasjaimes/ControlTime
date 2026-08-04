import React, { memo, useEffect, useRef, useState } from 'react';
import { Save, X } from 'lucide-react';

interface SaveTitleModalProps {
  /** Texto pre-cargado en el campo (título actual o sugerido). */
  defaultValue: string;
  /** Texto del encabezado — permite reutilizar este modal tanto para
   *  "nombrar un informe nuevo" como para el caso de conflicto offline
   *  ("guardar como copia nueva"), ver App.tsx/promptForTitle. */
  heading?: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

/**
 * Reemplazo de `window.prompt()` con el mismo lenguaje visual que el resto
 * de modales de la plataforma (ReportsAdminModal / DeleteReportConfirm —
 * clases `ra-*` en styles.css: overlay oscuro con blur, tarjeta #0f172a con
 * borde #334155, encabezado #0a1020 con acento índigo, botones ra-btn-ghost
 * / ra-btn-primary). Antes de esto, guardar un informe SIN id todavía
 * disparaba un `window.prompt()` nativo del navegador -- funcional para un
 * usuario real, pero visualmente inconsistente con el resto de la app (y no
 * automatizable/probable por QA, a diferencia de un modal propio).
 */
function SaveTitleModal({ defaultValue, heading, onConfirm, onCancel }: SaveTitleModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();
  const confirm = () => onConfirm(trimmed || defaultValue || 'Informe sin título');

  return (
    <div className="ra-overlay" onClick={onCancel}>
      <div
        className="ra-sub-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirm(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
      >
        <div className="ra-sub-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Save size={18} style={{ color: '#818cf8' }} />
            <h3>{heading || 'Guardar Informe Técnico'}</h3>
          </div>
          <button className="ra-close-btn" onClick={onCancel} title="Cancelar"><X size={16} /></button>
        </div>

        <div className="ra-sub-body">
          <div className="ra-field">
            <label>Nombre del informe</label>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ej. Informe Técnico Integral — Alpayana"
            />
          </div>
        </div>

        <div className="ra-sub-footer">
          <button className="ra-btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="ra-btn-primary" onClick={confirm}>
            <Save size={14} /> Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(SaveTitleModal);
