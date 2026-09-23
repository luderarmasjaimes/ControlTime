import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import { PLATFORM_CHROME_FONT, PLATFORM_CHROME_FONT_SIZE, PLATFORM_CHROME_COLOR } from './shared/platformChrome';

interface FooterBlockProps {
  element: ReportElement;
  pageNumber: number;
  totalPages?: number;
}

/** Pie automático de página (ADR-046) -- "BEEMETRY" fijo a la izquierda y
 * "PÁGINA X / Total" calculado en vivo a la derecha (nunca un literal
 * editable). Bloqueado, sin interacción (`pointerEvents: 'none'` en el
 * `<Html>`) -- no acepta menú contextual ni arrastre. */
export default function FooterBlock({ element, pageNumber, totalPages }: FooterBlockProps) {
  const p = element.props || {};
  return (
    <Html key={`${element.id}-footer`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="report-canvas-html-shield"
        style={{
          width: element.width - 8, height: element.height - 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid #cbd5e1', boxSizing: 'border-box', padding: '0 4px', gap: 12,
        }}>
        {/* Extremo izquierdo — literal fijo, no editable */}
        <span style={{
          fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
          letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap',
        }}>
          BEEMETRY
        </span>
        {/* Extremo derecho — Página X / Total, siempre calculado en
           render (nunca literal editable, ver defaultPropsByType). */}
        {p.showPageNumber !== false && (
          <span style={{
            fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
            letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            PÁGINA {pageNumber} / {totalPages || pageNumber}
          </span>
        )}
      </div>
    </Html>
  );
}
