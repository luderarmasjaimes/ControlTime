import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import SensorMultiChartWidget from './SensorMultiChartWidget';

interface SensorMultiChartBlockProps {
  element: ReportElement;
  tenantId?: string;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
}

/** Gráfico de sensores en tiempo real (tipo/zona/unidad elegibles, combo de
 * doble eje, mapa geo, vista 3D...) -- delega el dibujo real a
 * `SensorMultiChartWidget`. */
export default function SensorMultiChartBlock({ element, tenantId, onContextMenu }: SensorMultiChartBlockProps) {
  return (
    <Html key={`${element.id}-sensor-multi-chart`} groupProps={{ x: element.x, y: element.y, rotation: element.rotation || 0, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="report-canvas-html-shield"
        onContextMenu={(e) => onContextMenu(element.id, e)}
        // overflow:hidden a propósito -- defensa adicional (ver
        // SensorMultiChartWidget.tsx, que ya deja de forzar un
        // alto mínimo propio) para que, pase lo que pase adentro,
        // el contenido del gráfico NUNCA se dibuje visualmente
        // más allá del recuadro que el usuario definió al
        // redimensionar el bloque.
        style={{ width: element.width, height: element.height, overflow: 'hidden' }}
      >
        <SensorMultiChartWidget
          title={element.props?.title || 'Gráfico de sensores'}
          selections={element.props?.selections}
          chartType={element.props?.chartType}
          chartTypes={element.props?.chartTypes}
          comboConfig={element.props?.comboConfig}
          from={element.props?.from}
          to={element.props?.to}
          liveWindowMinutes={element.props?.liveWindowMinutes}
          tenantId={tenantId}
          width={element.width}
          height={element.height}
        />
      </div>
    </Html>
  );
}
