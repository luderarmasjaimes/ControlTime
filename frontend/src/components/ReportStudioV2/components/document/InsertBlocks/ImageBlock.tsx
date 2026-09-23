import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import { resolveReportImageSrc } from '../../../lib/reportImageSrc';
import MediaCaption from './shared/MediaCaption';

interface ImageBlockProps {
  element: ReportElement;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
}

/** Imagen libre (figura o foto) -- 'Detrás/delante del texto': ambos flotan
 * libremente (sin afectar el flujo del texto, ver wrapExclusions en
 * PageCanvas.tsx), difieren solo en apilamiento visual (zIndex). */
export default function ImageBlock({ element, onContextMenu }: ImageBlockProps) {
  const imageZIndex = element.wrapMode === 'behind' ? 5 : 15;
  const caption = String(element.props?.caption ?? '').trim();
  const imageWidth = Math.max(0, element.width - 8);
  const imageHeight = Math.max(0, element.height - 8);

  return (
    <Html
      key={`${element.id}-image`}
      groupProps={{
        x: element.x + 4,
        y: element.y + 4,
        rotation: element.rotation || 0,
        listening: false,
      }}
      divProps={{
        style: {
          pointerEvents: 'none',
          zIndex: imageZIndex,
        },
      }}
    >
      <div
        className="report-canvas-html-shield"
        onContextMenu={(e) => onContextMenu(element.id, e)}
        style={{
          width: imageWidth,
          height: imageHeight + (caption ? 30 : 0),
          overflow: 'visible',
        }}
      >
        <div
          style={{
            width: imageWidth,
            height: imageHeight,
            overflow: 'hidden',
            borderRadius: '4px',
          }}
        >
          <img
            src={resolveReportImageSrc(element)}
            alt={element.props?.alt || element.id}
            style={{
              width: '100%',
              height: '100%',
              objectFit: (element.objectFit as any) || 'cover',
              display: 'block',
            }}
          />
        </div>

        {caption && <MediaCaption width={imageWidth} text={caption} />}
      </div>
    </Html>
  );
}
