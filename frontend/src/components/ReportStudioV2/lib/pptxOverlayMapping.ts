/**
 * Tabla de cobertura de bloques para el overlay de texto nativo del export
 * PPTX: qué tipos de bloque obtienen un cuadro de texto EDITABLE de
 * PowerPoint superpuesto sobre la captura de fondo (mismo mecanismo que ya
 * usa el sidecar para /render-pptx), frente a los que quedan exclusivamente
 * como contenido de imagen — igual que hoy en el export PDF.
 *
 * Única fuente de verdad, referenciada tanto por el frontend (ReadOnlyViewer,
 * para decidir qué bloques ocultar-y-marcar antes de la captura) como por el
 * sidecar (pdf-export-service/server.js, para saber qué buscar en el DOM).
 *
 * Solo `text` está habilitado: es el único tipo cuya geometría (x/y/width/
 * height) y contenido (spans con estilo por rango, ver lib/textSpans.ts) ya
 * viven en el propio ReportElement, sin necesitar medir un sub-rectángulo
 * dentro de un bloque más grande. `cover` (el título es un <h1> centrado
 * dinámicamente dentro de un bloque full-page), `kpi`/`sensor` (la etiqueta
 * es un sub-elemento de una tarjeta compuesta) y `header`/`footer` (chrome de
 * plataforma fijo, no contenido autorado por el usuario — sin valor real en
 * hacerlo editable) quedan deliberadamente fuera de esta primera versión;
 * `table`, `chart`, `seismic-report`, `toc`, `image` y `video` nunca se
 * consideraron overlay-eligible (demasiado estructurados para reproducirse
 * como texto plano de PowerPoint).
 */
export const PPTX_OVERLAY_ELIGIBLE_TYPES: ReadonlySet<string> = new Set(['text']);

export function isPptxOverlayEligible(elementType: string): boolean {
  return PPTX_OVERLAY_ELIGIBLE_TYPES.has(elementType);
}

/** Un "run" de texto con estilo uniforme — mapea 1:1 a un segmento de
 * lib/textSpans.ts::buildStyledSegments, y a un run de pptxgenjs::addText. */
export interface PptxOverlayRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
}

export interface PptxOverlayMeta {
  align: 'left' | 'center' | 'right' | 'justify';
  runs: PptxOverlayRun[];
}
