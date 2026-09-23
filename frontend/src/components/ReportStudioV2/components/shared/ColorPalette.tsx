import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

// Últimos colores aplicados (de cualquier instancia de la paleta, en
// cualquier parte del informe) -- persistidos en localStorage porque la
// mayoría de usuarios usa colores personalizados propios de la empresa, no
// los 40 de la grilla fija, y perder esa lista al recargar sería inútil.
const RECENT_COLORS_KEY = 'reportstudio-v2-recent-colors';
const MAX_RECENT_COLORS = 5;

function loadRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string').slice(0, MAX_RECENT_COLORS)
      : [];
  } catch {
    return [];
  }
}

function rememberRecentColor(color: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
  try {
    const current = loadRecentColors().filter((c) => c.toLowerCase() !== color.toLowerCase());
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify([color, ...current].slice(0, MAX_RECENT_COLORS)));
  } catch {
    // localStorage no disponible (privado/cuota) -- no crítico, se omite.
  }
}

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
  /** Reemplaza el botón disparador por defecto (swatch + caret) por uno a
   * medida -- para lugares que ya tienen su propio botón con look distinto
   * (p.ej. "A" + barra de color para "color de texto") pero quieren
   * reusar exactamente el mismo popover (grilla + recientes + personalizado
   * + posicionamiento consciente del viewport) en vez de reimplementarlo. */
  renderTrigger?: (trigger: { onClick: () => void; onMouseDown: (e: React.MouseEvent) => void }) => React.ReactNode;
  /** 'left' (por defecto) abre el popover hacia la DERECHA del disparador
   * (su borde izquierdo queda alineado al disparador). 'right' lo abre
   * hacia la IZQUIERDA (borde derecho del popover alineado al disparador) --
   * necesario cuando el disparador está cerca del borde derecho de un panel
   * angosto (p.ej. este inspector): técnicamente el popover sigue cabiendo
   * en la ventana completa, pero visualmente se sale del panel y tapa el
   * contenido de al lado. */
  align?: 'left' | 'right';
}

// Tamaño estimado del popover (grilla de 8 columnas de 22px + gaps/padding
// ~226px de ancho; alto generoso que cubre el caso más alto: "Sin color" +
// "Recientes" + grilla completa + selector personalizado, medido ~285px en
// vivo, redondeado hacia arriba). Bug real reportado (2026-08-31): calcular
// la posición recién DESPUÉS de que el popover ya está en el DOM (vía
// useLayoutEffect, midiendo su tamaño real) dejaba una ventana donde el
// popover se pintaba con la posición cruda sin acotar -- y en la práctica
// esa primera posición sin corregir es la que el usuario terminaba viendo
// (se cortaba por la derecha o se abría fuera de la ventana, obligando a
// hacer scroll). Calcular la posición ACOTADA a partir de esta estimación,
// ya en el mismo clic que abre el popover (antes de que exista en el DOM),
// evita depender de esa medición posterior por completo.
const POPOVER_SIZE_ESTIMATE = { width: 246, height: 300 };

/** Posición (top/left en viewport) para un popover `position:fixed`, dado el
 * rect del disparador y el tamaño (real o estimado) del popover -- se abre
 * debajo del disparador y, si no cabe, se voltea arriba; si tampoco cabe
 * entero así, se ajusta al hueco más grande disponible. Igual en horizontal
 * (hacia la derecha del disparador, o hacia la izquierda si `align="right"`)
 * para que nunca se salga de la ventana. */
function clampToViewport(
  triggerRect: { top: number; bottom: number; left: number; right: number },
  align: 'left' | 'right',
  size: { width: number; height: number } = POPOVER_SIZE_ESTIMATE,
): { top: number; left: number } {
  const margin = 8;

  let top = triggerRect.bottom + 4;
  if (top + size.height > window.innerHeight - margin) {
    const above = triggerRect.top - 4 - size.height;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - size.height);
  }

  let left = align === 'right' ? triggerRect.right - size.width : triggerRect.left;
  if (left + size.width > window.innerWidth - margin) {
    left = window.innerWidth - margin - size.width;
  }
  left = Math.max(margin, left);

  return { top, left };
}

export default function ColorPalette({ value, onChange, label, title, onOpen, allowClear, onClear, renderTrigger, align = 'left' }: ColorPaletteProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      setCoords(clampToViewport(rect, align));
      setRecentColors(loadRecentColors());
      onOpen?.();
    }
    setOpen((prev) => !prev);
  };

  useEffect(() => {
  if (!open) return;

  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node; // Casteamos a Node para que .contains() lo acepte
    if (
      rootRef.current && !rootRef.current.contains(target) &&
      popoverRef.current && !popoverRef.current.contains(target)
    ) {
      setOpen(false);
    }
  };

  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Refinamiento opcional: una vez que el popover tiene su tamaño REAL en
  // pantalla (puede diferir un poco de la estimación de clampToViewport --
  // p.ej. si hay más/menos colores "Recientes" de lo previsto), se recalcula
  // con las medidas exactas. `clampToViewport` ya deja el popover dentro de
  // la ventana desde el primer frame (ver su comentario) -- esto solo afina.
  useLayoutEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    const trigger = rootRef.current;
    if (!popover || !trigger) return;
    const popRect = popover.getBoundingClientRect();
    if (popRect.width === 0 && popRect.height === 0) return;
    const triggerRect = trigger.getBoundingClientRect();
    const next = clampToViewport(triggerRect, align, { width: popRect.width, height: popRect.height });
    setCoords((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (color: string) => {
    rememberRecentColor(color);
    onChange(color);
    setOpen(false);
  };

  const popoverJSX = (
    <div
      className="color-palette-popover"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed', // Fixed evita que el scroll del padre lo afecte
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 9999, // Queda por encima de cualquier otro componente
      }}
    >
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
          {recentColors.length > 0 && (
            <div className="color-palette-recent">
              <label className="color-palette-recent-label">Recientes</label>
              <div className="color-palette-recent-row">
                {recentColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-palette-cell${value?.toLowerCase() === c.toLowerCase() ? ' color-palette-cell--active' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => pick(c)}
                  />
                ))}
              </div>
            </div>
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
              // El picker nativo del sistema operativo no siempre dispara
              // `blur` en este input al cerrarse (varía por navegador/SO, y
              // si el popover se cierra por clic afuera puede desmontarse
              // antes de que llegue el evento) -- bug real reportado: los
              // colores elegidos ahí nunca quedaban en "Recientes". `change`
              // sí dispara de forma confiable con cada color aplicado.
              onChange={(e) => { onChange(e.target.value); rememberRecentColor(e.target.value); }}
            />
            <input
              type="text"
              className="color-palette-hex"
              value={value}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value.trim();
                onChange(v); // deja escribir; se valida el hex antes de recordar
                rememberRecentColor(v);
              }}
              placeholder="#rrggbb"
            />
          </div>
    </div>
  );

  const triggerProps = {
    onClick: handleToggle,
    // mousedown preventDefault: no robar el foco/selección del textarea
    // que se está formateando (mismo criterio que la barra de formato).
    onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); },
  };

  return (
    <div className="color-palette" ref={rootRef} style={{ position: 'relative' }}>
      {renderTrigger ? renderTrigger(triggerProps) : (
        <button
          type="button"
          className="color-palette-trigger"
          title={title || 'Elegir color'}
          onMouseDown={triggerProps.onMouseDown}
          onClick={triggerProps.onClick}
        >
          <span
            className={`color-palette-swatch-preview${!value || value === 'transparent' ? ' color-palette-swatch-preview--empty' : ''}`}
            style={{ background: value && value !== 'transparent' ? value : undefined }}
          />
          {label && <span className="color-palette-label">{label}</span>}
          <span className="color-palette-caret">▾</span>
        </button>
      )}
      {open && createPortal(popoverJSX, document.body)}
    </div>
  );
}
