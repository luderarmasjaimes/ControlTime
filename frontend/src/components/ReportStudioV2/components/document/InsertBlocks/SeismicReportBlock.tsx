import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import SeismicReportWidget from './SeismicReportWidget';

interface SeismicReportBlockProps {
  element: ReportElement;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
}

/** Reporte sísmico (sismos oficiales IGP/CENSIS y/o microsismicidad de la
 * red propia) -- delega el dibujo real a `SeismicReportWidget` (también
 * usado por ReadOnlyViewer.tsx para la vista de solo lectura), este bloque
 * solo resuelve tamaño/posición dentro del lienzo del informe. */
export default function SeismicReportBlock({ element, onContextMenu }: SeismicReportBlockProps) {
  return (
    <Html key={`${element.id}-seismic-report`} groupProps={{ x: element.x + 4, y: element.y + 4, rotation: element.rotation || 0, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="report-canvas-html-shield"
        onContextMenu={(e) => onContextMenu(element.id, e)}
        style={{ width: element.width - 8, height: element.height - 8 }}
      >
        <SeismicReportWidget
          title={element.props?.title}
          source={element.props?.source}
          startDate={element.props?.startDate}
          endDate={element.props?.endDate}
          connected={element.props?.connected !== false}
          snapshot={element.props?.snapshot || null}
          width={Math.max(200, element.width - 8)}
          height={Math.max(140, element.height - 8)}
        />
      </div>
    </Html>
  );
}
