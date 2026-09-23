import { Shape } from 'react-konva';
import { defaultBorderByType, type ReportElement } from '../../../store/useEditorStore';

/** Dibuja el contorno geométrico real de la forma (rectángulo/círculo/
 * elipse/rombo/triángulo/estrella/línea) sobre el contexto de Konva --
 * compartido por las dos pasadas que necesitan renderizarla (detrás/en
 * flujo normal, en PageCanvas.tsx, y "delante de todo", ver el `.filter`
 * con `wrapMode === 'infront'` más abajo) -- antes este switch de 25 líneas
 * estaba literalmente duplicado en ambos sitios. */
function drawShapePath(context: any, element: ReportElement) {
  const w = element.width;
  const h = element.height;
  const type = element.props?.shapeType || 'rectangle';
  context.beginPath();
  if (type === 'circle' || type === 'ellipse') {
    context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (type === 'diamond') {
    context.moveTo(w / 2, 0); context.lineTo(w, h / 2);
    context.lineTo(w / 2, h); context.lineTo(0, h / 2); context.closePath();
  } else if (type === 'triangle') {
    context.moveTo(w / 2, 0); context.lineTo(w, h); context.lineTo(0, h); context.closePath();
  } else if (type === 'star') {
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? Math.min(w, h) / 2 : Math.min(w, h) / 4;
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const x = w / 2 + Math.cos(angle) * radius;
      const y = h / 2 + Math.sin(angle) * radius;
      if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
  } else if (type === 'line') {
    context.moveTo(0, h / 2); context.lineTo(w, h / 2);
  } else {
    context.rect(0, 0, w, h);
  }
}

interface ShapeVisualProps {
  element: ReportElement;
}

/** Contorno visual de una forma (`type === 'shape'`) -- NO incluye el Rect
 * interactivo (selección/arrastre/redimensión), que sigue viviendo en el
 * loop genérico de PageCanvas.tsx junto al de cualquier otro tipo de
 * bloque. `listening={false}` a propósito: los clics los recibe siempre el
 * Rect interactivo por encima, nunca esta forma. El caller es responsable
 * del `key` de React (esta misma pieza se usa en DOS pasadas distintas --
 * flujo normal y "delante de todo", ver el `.filter` con
 * `wrapMode === 'infront'` en PageCanvas.tsx -- cada una con su propio key). */
export default function ShapeVisual({ element }: ShapeVisualProps) {
  const isLineShape = element.props?.shapeType === 'line';
  const effectiveBorder = element.border || defaultBorderByType('shape');
  return (
    <Shape
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation || 0}
      listening={false}
      fill={isLineShape ? 'transparent' : (element.props?.fill || '#dbeafe')}
      opacity={Number(element.props?.opacity ?? 1)}
      stroke={isLineShape ? (element.props?.stroke || '#2563eb') : (effectiveBorder.enabled ? effectiveBorder.color : 'transparent')}
      strokeWidth={isLineShape ? Number(element.props?.strokeWidth ?? 2) : (effectiveBorder.enabled ? effectiveBorder.width : 0)}
      dash={isLineShape ? undefined : (effectiveBorder.style === 'dashed' ? [8, 4] : effectiveBorder.style === 'dotted' ? [2, 4] : undefined)}
      sceneFunc={(context, shape) => {
        drawShapePath(context, element);
        context.fillStrokeShape(shape);
      }}
    />
  );
}
