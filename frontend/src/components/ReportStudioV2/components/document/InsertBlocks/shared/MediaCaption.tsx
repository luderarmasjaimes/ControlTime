/** Leyenda opcional debajo de una imagen o gráfico -- mismo estilo
 * (itálica, azul Word #4F81BD) en ambos bloques, ver ImageBlock/ChartBlock. */
export default function MediaCaption({ width, text }: { width: number; text: string }) {
  return (
    <div
      className="report-media-caption"
      style={{
        width,
        marginTop: 6,
        textAlign: 'center',
        fontFamily: 'Arial, sans-serif',
        fontSize: 12,
        lineHeight: 1.25,
        fontStyle: 'italic',
        color: '#4F81BD',
        overflowWrap: 'anywhere',
      }}
    >
      {text}
    </div>
  );
}
