import React, { memo, useEffect, useRef, useState } from 'react';
import { BookmarkPlus, X, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react';
import ColorPalette from '../shared/ColorPalette';
import { FONT_FAMILIES, FONT_SIZES } from '../../lib/fontOptions';
import type { HeadingStyleDef } from '../../lib/headingStyles';

interface SaveTextStyleModalProps {
  /** Formato de partida -- si había un bloque de texto seleccionado al
   * abrir el modal, App.tsx pasa SU formato actual (mismo criterio que
   * Word, que muestra "Estilo basado en: Mi párrafo"); si no había
   * selección, pasa un formato por defecto razonable. TODO es editable
   * acá mismo -- a diferencia de la primera versión de este modal, NO hace
   * falta tener texto seleccionado para nada: el estilo se arma entero
   * dentro del propio diálogo, igual que "Crear nuevo estilo a partir del
   * formato" de Word. */
  initialFormat: Omit<HeadingStyleDef, 'id' | 'label' | 'tag'>;
  onConfirm: (label: string, format: Omit<HeadingStyleDef, 'id' | 'label' | 'tag'>) => void;
  onCancel: () => void;
}

const ALIGN_OPTIONS: { value: HeadingStyleDef['textAlign']; icon: typeof AlignLeft; title: string }[] = [
  { value: 'left', icon: AlignLeft, title: 'Alinear a la izquierda' },
  { value: 'center', icon: AlignCenter, title: 'Centrar' },
  { value: 'right', icon: AlignRight, title: 'Alinear a la derecha' },
  { value: 'justify', icon: AlignJustify, title: 'Justificar' },
];

/**
 * "Crear nuevo estilo a partir del formato" de Word, aplicado al ribbon
 * (Inicio → Estilos) -- ver lib/customTextStyles.ts para dónde vive el
 * estilo guardado y cómo se reaplica. A diferencia de la primera versión
 * (que solo pedía un nombre y capturaba el formato de la selección tal
 * cual), este formulario deja editar cada propiedad desde cero: fuente,
 * tamaño, negrita/cursiva/subrayado, alineación, color e interlineado --
 * el botón del ribbon funciona sin importar si hay texto seleccionado.
 * Mismo lenguaje visual que SaveTitleModal.tsx (clases ra-* de styles.css).
 */
function SaveTextStyleModal({ initialFormat, onConfirm, onCancel }: SaveTextStyleModalProps) {
  const [label, setLabel] = useState('');
  const [fontFamily, setFontFamily] = useState(initialFormat.fontFamily);
  const [fontSize, setFontSize] = useState(initialFormat.fontSize);
  const [bold, setBold] = useState(initialFormat.fontWeight >= 600);
  const [italic, setItalic] = useState(initialFormat.italic);
  const [underline, setUnderline] = useState(initialFormat.underline);
  const [color, setColor] = useState(initialFormat.color);
  const [textAlign, setTextAlign] = useState(initialFormat.textAlign);
  const [lineHeight, setLineHeight] = useState(initialFormat.lineHeight);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = label.trim();
  const confirm = () => {
    if (!trimmed) return;
    onConfirm(trimmed, { fontFamily, fontSize, fontWeight: bold ? 700 : 400, italic, underline, color, textAlign, lineHeight });
  };

  return (
    <div className="ra-overlay" onClick={onCancel}>
      <div
        className="ra-sub-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // El selector de color abre su propio popover (portal a
          // document.body) con un campo de hex -- un Enter ahí es para
          // confirmar ESE valor, no para guardar todo el estilo. Los
          // eventos de un portal SÍ burbujean por el árbol de React (no el
          // de DOM), así que sin este chequeo llegaban hasta acá.
          const target = e.target as HTMLElement;
          if (e.key === 'Enter') {
            if (target.closest('.color-palette-popover')) return;
            e.preventDefault();
            confirm();
          }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
      >
        <div className="ra-sub-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BookmarkPlus size={18} style={{ color: '#818cf8' }} />
            <h3>Crear estilo de texto</h3>
          </div>
          <button className="ra-close-btn" onClick={onCancel} title="Cancelar"><X size={16} /></button>
        </div>

        <div className="ra-sub-body">
          <div className="ra-field">
            <label>Nombre del estilo</label>
            <input
              ref={inputRef}
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej. Subtítulo azul, Nota de pie"
            />
          </div>

          <div className="ra-filters-row">
            <div className="ra-field">
              <label>Fuente</label>
              <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
                {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="ra-field" style={{ flex: '0 0 90px' }}>
              <label>Tamaño</label>
              <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
                {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="ra-field">
            <label>Formato y alineación</label>
            <div className="save-style-toggle-row">
              <button type="button" className={`save-style-toggle-btn${bold ? ' is-active' : ''}`} onClick={() => setBold((v) => !v)} title="Negrita">
                <Bold size={14} />
              </button>
              <button type="button" className={`save-style-toggle-btn${italic ? ' is-active' : ''}`} onClick={() => setItalic((v) => !v)} title="Cursiva">
                <Italic size={14} />
              </button>
              <button type="button" className={`save-style-toggle-btn${underline ? ' is-active' : ''}`} onClick={() => setUnderline((v) => !v)} title="Subrayado">
                <Underline size={14} />
              </button>
              <span className="save-style-toggle-sep" />
              {ALIGN_OPTIONS.map(({ value, icon: Icon, title }) => (
                <button
                  key={value}
                  type="button"
                  className={`save-style-toggle-btn${textAlign === value ? ' is-active' : ''}`}
                  onClick={() => setTextAlign(value)}
                  title={title}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
          </div>

          <div className="ra-filters-row">
            <div className="ra-field">
              <label>Color de texto</label>
              <ColorPalette value={color} onChange={setColor} title="Color del texto" />
            </div>
            <div className="ra-field" style={{ flex: '0 0 120px' }}>
              <label>Interlineado</label>
              <input
                type="number"
                step={0.05}
                min={0.8}
                max={3}
                value={lineHeight}
                onChange={(e) => setLineHeight(Math.max(0.8, Number(e.target.value) || 1))}
              />
            </div>
          </div>

          <div className="save-style-preview-label">Vista previa</div>
          <div
            className="save-style-preview"
            style={{
              fontFamily,
              fontSize: Math.min(fontSize, 20),
              fontWeight: bold ? 700 : 400,
              fontStyle: italic ? 'italic' : 'normal',
              textDecoration: underline ? 'underline' : 'none',
              color,
              textAlign,
              lineHeight,
            }}
          >
            Texto de ejemplo
          </div>
        </div>

        <div className="ra-sub-footer">
          <button className="ra-btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="ra-btn-primary" onClick={confirm} disabled={!trimmed}>
            <BookmarkPlus size={14} /> Guardar estilo
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(SaveTextStyleModal);
