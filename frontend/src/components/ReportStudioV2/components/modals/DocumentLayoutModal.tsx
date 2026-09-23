import React, { useEffect, useState } from 'react';
import type { GlobalTextFormat } from '../../store/useEditorStore';

const CM_TO_PX = 96 / 2.54;
const PT_TO_PX = 96 / 72;
// Mismos presets del Ribbon de Inicio. Incluyen los valores más usados de
// Word (sencillo, 1.5 y doble) y los intermedios ya existentes en Beemetry.
const LINE_SPACING_OPTIONS = [
  { value: 1, label: 'Sencillo' },
  { value: 1.15, label: '1,15 líneas' },
  { value: 1.35, label: '1,35 líneas (predeterminado)' },
  { value: 1.5, label: '1,5 líneas' },
  { value: 2, label: 'Doble' },
];

const FONT_FAMILIES = [
  'Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Verdana',
  'Tahoma', 'Trebuchet MS', 'Garamond', 'Courier New',
];

export interface DocumentMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface DocumentLayoutModalProps {
  margins: DocumentMargins;
  textFormat: Required<Pick<GlobalTextFormat, 'fontFamily' | 'fontSize' | 'fontColor' | 'textAlign' | 'lineHeight' | 'indentLeft' | 'indentRight' | 'specialIndent' | 'specialIndentBy' | 'spacingBefore' | 'spacingAfter'>>;
  onApply: (margins: DocumentMargins, textFormat: GlobalTextFormat) => void;
  onClose: () => void;
}

const cm = (px: number) => Number((px / CM_TO_PX).toFixed(2));
const pxFromCm = (value: number) => Math.max(0, value || 0) * CM_TO_PX;
const pt = (px: number) => Number((px / PT_TO_PX).toFixed(1));
const pxFromPt = (value: number) => Math.max(0, value || 0) * PT_TO_PX;

/** Modal global equivalente a "Configurar página / Párrafo" de Word.
 * Los valores se aplican deliberadamente a todos los globos `text`, incluso
 * si viven en páginas distintas; otros tipos de bloque se dejan intactos. */
export default function DocumentLayoutModal({ margins, textFormat, onApply, onClose }: DocumentLayoutModalProps) {
  const [draftMargins, setDraftMargins] = useState<DocumentMargins>(margins);
  const [draft, setDraft] = useState(textFormat);

  useEffect(() => {
    setDraftMargins(margins);
    setDraft(textFormat);
  }, [margins, textFormat]);

  const setMargin = (key: keyof DocumentMargins, value: number) => {
    setDraftMargins((current) => ({ ...current, [key]: pxFromCm(value) }));
  };

  const setParagraph = (key: keyof typeof draft, value: string | number) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    onApply(draftMargins, {
      fontFamily: draft.fontFamily,
      fontSize: Math.max(7, Math.min(Number(draft.fontSize) || 14, 200)),
      fontColor: draft.fontColor,
      textAlign: draft.textAlign,
      lineHeight: Math.max(0.8, Number(draft.lineHeight) || 1.35),
      indentLeft: pxFromCm(Number(draft.indentLeft) / CM_TO_PX),
      indentRight: pxFromCm(Number(draft.indentRight) / CM_TO_PX),
      specialIndent: draft.specialIndent,
      specialIndentBy: pxFromCm(Number(draft.specialIndentBy) / CM_TO_PX),
      spacingBefore: pxFromPt(Number(draft.spacingBefore) / PT_TO_PX),
      spacingAfter: pxFromPt(Number(draft.spacingAfter) / PT_TO_PX),
    });
    onClose();
  };

  return (
    <div className="document-layout-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="document-layout-modal" role="dialog" aria-modal="true" aria-labelledby="document-layout-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="document-layout-modal__header">
          <div>
            <h2 id="document-layout-title">Propiedades del documento</h2>
            <p>Los ajustes de párrafo se aplican a todos los globos de texto del informe. La fuente, el tamaño y el color de "Fuente global" también se aplican al texto dentro de las tablas.</p>
          </div>
          <button type="button" className="document-layout-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="document-layout-grid">
          <fieldset className="document-layout-section">
            <legend>Márgenes de página</legend>
            <div className="document-layout-field-grid">
              {(['top', 'right', 'bottom', 'left'] as const).map((key) => (
                <label key={key}>
                  {{ top: 'Superior', right: 'Derecho', bottom: 'Inferior', left: 'Izquierdo' }[key]}
                  <span className="document-layout-number">
                    <input type="number" min="0.2" max="15" step="0.1" value={cm(draftMargins[key])} onChange={(event) => setMargin(key, Number(event.target.value))} />
                    <small>cm</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="document-layout-section">
            <legend>Fuente global</legend>
            <div className="document-layout-field-grid">
              <label>
                Fuente
                <select value={draft.fontFamily} onChange={(event) => setParagraph('fontFamily', event.target.value)}>
                  {FONT_FAMILIES.map((font) => <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>)}
                </select>
              </label>
              <label>
                Tamaño
                <span className="document-layout-number"><input type="number" min="7" max="200" step="1" value={draft.fontSize} onChange={(event) => setParagraph('fontSize', Number(event.target.value))} /><small>pt</small></span>
              </label>
              <label>
                Color de fuente
                <input type="color" value={draft.fontColor} onChange={(event) => setParagraph('fontColor', event.target.value)} aria-label="Color de fuente global" />
              </label>
            </div>
          </fieldset>

          <fieldset className="document-layout-section">
            <legend>Párrafo global</legend>
            <div className="document-layout-field-grid">
              <label>
                Alineación
                <select value={draft.textAlign} onChange={(event) => setParagraph('textAlign', event.target.value as NonNullable<GlobalTextFormat['textAlign']>)}>
                  <option value="left">Izquierda</option><option value="center">Centrada</option><option value="right">Derecha</option><option value="justify">Justificada</option>
                </select>
              </label>
              <label>
                Interlineado
                <select value={draft.lineHeight} onChange={(event) => setParagraph('lineHeight', Number(event.target.value))}>
                  {!LINE_SPACING_OPTIONS.some((option) => Math.abs(option.value - draft.lineHeight) < 0.001) && (
                    <option value={draft.lineHeight}>{draft.lineHeight.toFixed(2).replace('.', ',')} líneas (personalizado)</option>
                  )}
                  {LINE_SPACING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Sangría izquierda
                <span className="document-layout-number"><input type="number" min="0" max="15" step="0.1" value={cm(draft.indentLeft)} onChange={(event) => setParagraph('indentLeft', pxFromCm(Number(event.target.value)))} /><small>cm</small></span>
              </label>
              <label>
                Sangría derecha
                <span className="document-layout-number"><input type="number" min="0" max="15" step="0.1" value={cm(draft.indentRight)} onChange={(event) => setParagraph('indentRight', pxFromCm(Number(event.target.value)))} /><small>cm</small></span>
              </label>
              <label>
                Especial
                <select value={draft.specialIndent} onChange={(event) => setParagraph('specialIndent', event.target.value as NonNullable<GlobalTextFormat['specialIndent']>)}>
                  <option value="none">Ninguna</option><option value="firstLine">Primera línea</option><option value="hanging">Francesa (APA)</option>
                </select>
              </label>
              <label>
                Por
                <span className="document-layout-number"><input type="number" min="0" max="15" step="0.1" disabled={draft.specialIndent === 'none'} value={cm(draft.specialIndentBy)} onChange={(event) => setParagraph('specialIndentBy', pxFromCm(Number(event.target.value)))} /><small>cm</small></span>
              </label>
              <label>
                Espacio antes
                <span className="document-layout-number"><input type="number" min="0" max="144" step="1" value={pt(draft.spacingBefore)} onChange={(event) => setParagraph('spacingBefore', pxFromPt(Number(event.target.value)))} /><small>pt</small></span>
              </label>
              <label>
                Espacio después
                <span className="document-layout-number"><input type="number" min="0" max="144" step="1" value={pt(draft.spacingAfter)} onChange={(event) => setParagraph('spacingAfter', pxFromPt(Number(event.target.value)))} /><small>pt</small></span>
              </label>
            </div>
          </fieldset>
        </div>

        <footer className="document-layout-modal__footer">
          <span>La fuente/tamaño/color alcanza también a las tablas; el resto de los ajustes no modifica tablas, imágenes, gráficos ni sensores.</span>
          <div><button type="button" className="document-layout-button document-layout-button--secondary" onClick={onClose}>Cancelar</button><button type="button" className="document-layout-button document-layout-button--primary" style={{color: 'white'}} onClick={submit}>Aplicar a todo el documento</button></div>
        </footer>
      </section>
    </div>
  );
}
