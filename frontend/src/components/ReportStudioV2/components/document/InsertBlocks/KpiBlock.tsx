import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import MiningKpiWidget from './MiningKpiWidget';

interface KpiBlockProps {
  element: ReportElement;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
}

/** Indicador KPI (valor numérico + tendencia) -- delega el dibujo real a
 * `MiningKpiWidget`, este bloque solo resuelve tamaño/posición dentro del
 * lienzo del informe. */
export default function KpiBlock({ element, onContextMenu }: KpiBlockProps) {
  return (
    <Html key={`${element.id}-kpi`} groupProps={{ x: element.x + 4, y: element.y + 4, rotation: element.rotation || 0, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="report-canvas-html-shield"
        onContextMenu={(e) => onContextMenu(element.id, e)}
        style={{ width: element.width - 8, height: element.height - 8 }}
      >
        <MiningKpiWidget
          kpiCode={element.props?.kpiCode}
          title={element.props?.title}
          trendViz={element.props?.trendViz}
          connected={element.props?.connected !== false}
          width={Math.max(90, element.width - 8)}
          height={Math.max(60, element.height - 8)}
        />
      </div>
    </Html>
  );
}
