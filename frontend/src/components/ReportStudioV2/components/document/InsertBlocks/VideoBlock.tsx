import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import { fixRecordedVideoElement } from '../../../lib/videoDurationFix';

interface VideoBlockProps {
  element: ReportElement;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
  /** `true` cuando este video en particular está "perforado" para recibir el
   * puntero (play/pausa/volumen nativos) -- ver `canvasVideoInteractId` en
   * PageCanvas.tsx. El toggle (doble clic para entrar, Esc/deseleccionar
   * para salir) vive en el loop de interacción genérico de PageCanvas, no
   * acá -- este componente solo LEE el estado para decidir pointerEvents. */
  isInteracting: boolean;
}

/** Video insertado (webcam o pantalla/ventana grabada, ADR-064/065) -- a
 * diferencia de las imágenes, el `<video>` necesita `pointerEvents` activo
 * para que sus controles nativos respondan al click. Si eso estuviera
 * SIEMPRE activo, un solo click sobre el reproductor nunca llegaría al Rect
 * de Konva y el bloque quedaría imposible de arrastrar/seleccionar por
 * encima -- mismo criterio que la edición de tabla en el lienzo, pero
 * invertido: el video arranca BLOQUEADO (un clic selecciona/arrastra el
 * bloque como cualquier otro) y recién se perfora tras doble clic, hasta
 * deseleccionar o Esc. */
export default function VideoBlock({ element, onContextMenu, isInteracting }: VideoBlockProps) {
  return (
    <Html key={`${element.id}-video`} groupProps={{ x: element.x + 4, y: element.y + 4, rotation: element.rotation || 0, listening: false }} divProps={{ style: { pointerEvents: isInteracting ? 'auto' : 'none', zIndex: element.wrapMode === 'behind' ? 5 : 15 } }}>
      <div
        className={isInteracting ? 'report-canvas-video-interact-host' : 'report-canvas-html-shield'}
        onContextMenu={(e) => onContextMenu(element.id, e)}
        style={{
          position: 'relative',
          width: element.width - 8,
          height: element.height - 8,
          overflow: 'hidden',
          borderRadius: '4px',
          background: '#000',
        }}
      >
        {element.src ? (
          <video
            src={element.src}
            controls
            // ADR-064/065: los .webm de MediaRecorder no traen
            // Duration/índice de búsqueda -- sin este fix se ven
            // en negro con "0:00" (ver lib/videoDurationFix.ts).
            ref={(el) => fixRecordedVideoElement(el)}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
            Sin video
          </div>
        )}
        {!isInteracting && element.src && (
          <div className="report-canvas-video-hint" onContextMenu={(e) => onContextMenu(element.id, e)}>
            Doble clic para reproducir
          </div>
        )}
      </div>
    </Html>
  );
}
