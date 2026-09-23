import { Text } from 'react-konva';
import type { ReportElement } from '../../../store/useEditorStore';

interface WordArtVisualProps {
  element: ReportElement;
}

/** Texto decorativo tipo "WordArt" (`type === 'wordart'`) -- relleno sólido
 * o degradado, contorno y sombra opcionales. NO es un cuadro de texto
 * editable en línea (a diferencia de `TextBlock.tsx`): es una sola cadena
 * corta con estilo fijo, mismo criterio de alcance que `ShapeVisual` (forma
 * decorativa, propiedades por el panel derecho, nunca edición directa sobre
 * el lienzo). Konva `Text` soporta relleno por degradado lineal nativo
 * (`fillLinearGradientColorStops`) y contorno/sombra reales -- no hace falta
 * simular nada con CSS acá (a diferencia del render de solo-lectura, que sí
 * usa `background-clip:text` porque ahí el contenedor es HTML real). */
export default function WordArtVisual({ element }: WordArtVisualProps) {
  const props = element.props || {};
  const text = String(props.text || 'TÍTULO');
  const fontSize = Number(props.fontSize) || 48;
  const fontFamily = props.fontFamily || 'Arial';
  const align = props.textAlign === 'left' || props.textAlign === 'right' ? props.textAlign : 'center';
  const hasGradient = !!props.gradientFrom && !!props.gradientTo;
  const strokeWidth = Number(props.strokeWidth) || 0;

  return (
    <Text
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation || 0}
      listening={false}
      text={text}
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontStyle="bold"
      align={align}
      verticalAlign="middle"
      fill={hasGradient ? undefined : (props.fillColor || '#1d4ed8')}
      fillLinearGradientStartPoint={hasGradient ? { x: 0, y: 0 } : undefined}
      fillLinearGradientEndPoint={hasGradient ? { x: element.width, y: element.height } : undefined}
      fillLinearGradientColorStops={hasGradient ? [0, props.gradientFrom, 1, props.gradientTo] : undefined}
      stroke={strokeWidth > 0 ? (props.strokeColor || '#0f172a') : undefined}
      strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
      shadowColor={props.shadow ? 'rgba(0,0,0,0.45)' : undefined}
      shadowBlur={props.shadow ? 8 : undefined}
      shadowOffsetX={props.shadow ? 3 : undefined}
      shadowOffsetY={props.shadow ? 3 : undefined}
    />
  );
}
