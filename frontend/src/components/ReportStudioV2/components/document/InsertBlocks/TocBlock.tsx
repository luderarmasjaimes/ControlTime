import { Html } from 'react-konva-utils';
import { RefreshCw } from 'lucide-react';
import { useEditorStore, tocSliceForElementId, type ReportElement } from '../../../store/useEditorStore';
import { navigateToTocEntry } from './shared/tocNavigation';

interface TocBlockProps {
  element: ReportElement;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
}

const LEVEL_STYLE: Record<number, { fontSize: number; fontWeight: number; color: string; fontStyle?: string }> = {
  1: { fontSize: 14,   fontWeight: 700, color: '#0f172a' },
  2: { fontSize: 13,   fontWeight: 700, color: '#1e40af' },
  3: { fontSize: 12.5, fontWeight: 600, color: '#334155' },
  4: { fontSize: 12,   fontWeight: 500, color: '#475569' },
  5: { fontSize: 11.5, fontWeight: 500, color: '#64748b', fontStyle: 'italic' },
  6: { fontSize: 11,   fontWeight: 400, color: '#94a3b8', fontStyle: 'italic' },
};

/** Tabla de contenidos automática (ADR-011/019) -- una sola fuente de
 * verdad para la numeración (`tocSliceForElementId`, useEditorStore.ts),
 * compartida con `generateTocData()` en TableOfContents.tsx. Cada bloque
 * toc (original o de continuación, ver useEditorStore.ts::syncTocPages)
 * solo muestra SU tramo de entradas, nunca la lista completa repetida en
 * cada página. */
export default function TocBlock({ element, onContextMenu }: TocBlockProps) {
  const p = element.props || {};
  const isContinuation = typeof p.tocContinuationIndex === 'number';
  const tocEntries = tocSliceForElementId(useEditorStore.getState().doc, element.id);
  return (
    <Html key={`${element.id}-toc`} groupProps={{ x: element.x + 4, y: element.y + 4, rotation: element.rotation || 0, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="report-canvas-html-shield"
        onContextMenu={(e) => onContextMenu(element.id, e)}
        style={{
          width: element.width - 8, height: element.height - 8, overflow: 'auto', position: 'relative',
          border: '1px solid #e2e8f0', borderRadius: 6, background: '#ffffff', boxSizing: 'border-box', padding: 18,
        }}>
        <button
          type="button"
          className="report-canvas-toc-refresh"
          onClick={() => useEditorStore.getState().refreshTocDisplay()}
          title="Actualizar índice — vuelve a leer la página actual de cada título (útil tras mover bloques entre hojas)"
          style={{
            position: 'absolute', top: 10, right: 10, width: 26, height: 26,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc',
            color: '#475569', cursor: 'pointer', padding: 0,
          }}
        >
          <RefreshCw size={13} />
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 12px', paddingRight: 34, borderBottom: '2px solid #0f172a', paddingBottom: 6 }}>
          {p.title || 'Tabla de Contenidos'}{isContinuation ? ' (continuación)' : ''}
        </h2>
        {tocEntries.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
            Aplique estilos Título, Heading 1-6 a bloques de texto para generar el índice automáticamente.
          </div>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {tocEntries.map((item, i) => {
              // Estilo corporativo premium por nivel — misma escala
              // tipográfica que HEADING_STYLES (RibbonToolbar.tsx),
              // reducida a tamaño de línea de índice: cada nivel se
              // distingue claramente del siguiente (tamaño, peso,
              // color, cursiva en los más profundos), igual que la
              // Tabla de Contenidos automática de Word.
              const st = LEVEL_STYLE[item.level] || LEVEL_STYLE[6];
              return (
                <li key={`${item.id}-${i}`} style={{
                  display: 'flex', alignItems: 'baseline', gap: 6,
                  padding: '3px 0', paddingLeft: (item.level - 1) * 16,
                }}>
                  <button
                    type="button"
                    className="report-canvas-toc-entry"
                    onClick={(event) => navigateToTocEntry(event, item.elementId, item.pageNumber)}
                    title={`Ctrl + clic para ir a: ${item.text} (página ${item.pageNumber})`}
                  >
                    <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>{item.number}</span>
                    <span style={{ fontSize: st.fontSize, fontWeight: st.fontWeight, color: st.color, fontStyle: st.fontStyle }}>{item.text}</span>
                    <span style={{ flex: 1, borderBottom: '1px dotted #cbd5e1', margin: '0 2px', transform: 'translateY(-3px)' }} />
                    <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>{item.pageNumber}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Html>
  );
}
