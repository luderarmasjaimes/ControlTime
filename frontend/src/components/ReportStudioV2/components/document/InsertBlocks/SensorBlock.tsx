import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import SensorWidget from './SensorWidget';

interface SensorBlockProps {
  element: ReportElement;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
}

/** Sensor de telemetría en tiempo real (lectura única) -- retirado de la
 * biblioteca de inserción (reemplazado por `sensor_multi_chart`, ver
 * SensorMultiChartBlock) pero se sigue renderizando por compatibilidad con
 * informes ya guardados que lo contengan. Delega el dibujo real a
 * `SensorWidget`. */
export default function SensorBlock({ element, onContextMenu }: SensorBlockProps) {
  return (
    <Html key={`${element.id}-sensor`} groupProps={{ x: element.x, y: element.y, rotation: element.rotation || 0, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="report-canvas-html-shield"
        onContextMenu={(e) => onContextMenu(element.id, e)}
        style={{ width: element.width, height: element.height }}
      >
        <SensorWidget
          sensorId={element.props?.sensorId}
          type={element.props?.sensorType}
          title={element.props?.title || 'Telemetría Real-time'}
          connected={element.props?.connected !== false}
          width={element.width}
          height={element.height}
        />
      </div>
    </Html>
  );
}
