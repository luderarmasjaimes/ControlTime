import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import LiveChartBlock from '../../dashboard/LiveChartBlock';
import MediaCaption from './shared/MediaCaption';

interface ChartBlockProps {
  element: ReportElement;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
}

/** Gráfico de series y ejes -- delega el dibujo real a `LiveChartBlock`
 * (dashboard/), este bloque solo resuelve tamaño/posición/leyenda dentro
 * del lienzo del informe. */
export default function ChartBlock({ element, onContextMenu }: ChartBlockProps) {
  const caption = String(element.props?.caption ?? '').trim();
  const chartWidth = Math.max(120, element.width);
  const chartHeight = Math.max(80, element.height);

  return (
    <Html
      key={`${element.id}-chart`}
      groupProps={{
        x: element.x,
        y: element.y,
        rotation: element.rotation || 0,
        listening: false,
      }}
      divProps={{
        style: {
          pointerEvents: 'none',
        },
      }}
    >
      <div
        className="report-canvas-html-shield"
        onContextMenu={(e) => onContextMenu(element.id, e)}
        style={{
          width: chartWidth,
          height: chartHeight + (caption ? 30 : 0),
          overflow: 'visible',
        }}
      >
        <div
          style={{
            width: chartWidth,
            height: chartHeight,
          }}
        >
          <LiveChartBlock
            width={chartWidth}
            height={chartHeight}
            data={element.props}
          />
        </div>

        {caption && <MediaCaption width={chartWidth} text={caption} />}
      </div>
    </Html>
  );
}
