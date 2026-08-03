import React, { useEffect, useRef, useState } from 'react';

/**
 * Paleta de colores amplia y visible — reemplaza el `<input type="color">`
 * nativo (un solo swatch opaco, sin previsualización de opciones) que el
 * negocio reportó como "muy opaco, solo muestra 4 colores". Ofrece una
 * grilla de ~40 colores organizados (grises + fila de matices vivos) más un
 * selector personalizado para cualquier color fuera de la paleta.
 *
 * Se usa tanto en la barra de formato del editor de texto (aplicar a la
 * selección) como en el panel derecho (color de todo el bloque/celda).
 */

export const REPORT_COLOR_SWATCHES: string[] = [
  // Escala de grises (negro → blanco)
  '#000000', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#ffffff',
  // Rojos / naranjas / ámbar
  '#7f1d1d', '#dc2626', '#ef4444', '#f97316', '#ea580c', '#d97706', '#f59e0b', '#fbbf24',
  // Verdes / teal
  '#14532d', '#15803d', '#16a34a', '#22c55e', '#059669', '#10b981', '#0d9488', '#14b8a6',
  // Azules / cian
  '#0c4a6e', '#0369a1', '#0284c7', '#0ea5e9', '#1d4ed8', '#2563eb', '#3b82f6', '#38bdf8',
  // Morados / rosas
  '#4c1d95', '#6d28d9', '#7c3aed', '#a855f7', '#9d174d', '#be185d', '#db2777', '#ec4899',
];

interface ColorPaletteProps {
  value: string;
  onChange: (color: string) => void;
  /** Etiqueta del disparador (botón). Por defecto muestra solo el swatch. */
  label?: string;
  /** Título accesible / tooltip del botón disparador. */
  title?: string;
  /** Se llama justo antes de abrir el popover — útil para capturar la
   *  selección del textarea antes de que el clic le quite el foco. */
  onOpen?: () => void;
  /** Muestra un botón "Sin color" arriba de la grilla que llama a
   * `onClear` (o a `onChange('transparent')` si no se da `onClear`) — para
   * usos donde "ningún color" es un estado real y distinto de cualquier
   * swatch (p.ej. resaltado de texto: por defecto no hay ninguno). */
  allowClear?: boolean;
  onClear?: () => void;
}

export default function ColorPalette({ value, onChange, label, title, onOpen, allowClear, onClear }: ColorPaletteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const pick = (color: string) => {
    onChange(color);
    setOpen(false);
  };

  return (
    <div className="color-palette" ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="color-palette-trigger"
        title={title || 'Elegir color'}
        // mousedown preventDefault: no robar el foco/selección del textarea
        // que se está formateando (mismo criterio que la barra de formato).
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={() => { if (!open) onOpen?.(); setOpen((v) => !v); }}
      >
        <span
          className={`color-palette-swatch-preview${!value || value === 'transparent' ? ' color-palette-swatch-preview--empty' : ''}`}
          style={{ background: value && value !== 'transparent' ? value : undefined }}
        />
        {label && <span className="color-palette-label">{label}</span>}
        <span className="color-palette-caret">▾</span>
      </button>
      {open && (
        <div className="color-palette-popover" onMouseDown={(e) => e.preventDefault()}>
          {allowClear && (
            <button
              type="button"
              className="color-palette-clear"
              onClick={() => { (onClear ?? (() => onChange('transparent')))(); setOpen(false); }}
            >
              <span className="color-palette-swatch-preview color-palette-swatch-preview--empty" />
              Sin color
            </button>
          )}
          <div className="color-palette-grid">
            {REPORT_COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-palette-cell${value?.toLowerCase() === c.toLowerCase() ? ' color-palette-cell--active' : ''}`}
                style={{ background: c, border: c.toLowerCase() === '#ffffff' ? '1px solid #cbd5e1' : undefined }}
                title={c}
                onClick={() => pick(c)}
              />
            ))}
          </div>
          <div className="color-palette-custom">
            <label>Personalizado</label>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
              onChange={(e) => onChange(e.target.value)}
            />
            <input
              type="text"
              className="color-palette-hex"
              value={value}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
                else onChange(v); // deja escribir; se valida al perder foco
              }}
              placeholder="#rrggbb"
            />
          </div>
        </div>
      )}
    </div>
  );
}
