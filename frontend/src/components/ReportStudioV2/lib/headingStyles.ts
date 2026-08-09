/**
 * Definición única de los estilos de encabezado (Título/H1-H6/Normal/Cita).
 * Antes vivía duplicada dentro de RibbonToolbar.tsx (aplicación a TODO el
 * bloque); ahora también la usa PageCanvas.tsx (aplicación a la SELECCIÓN
 * de texto, ver la barra de formato flotante) — un solo lugar evita que los
 * dos caminos diverjan en tamaños/colores con el tiempo.
 */

export interface HeadingStyleDef {
  id: string;
  label: string;
  tag: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  color: string;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
}

/** Escala tipográfica corporativa premium: Calibri para encabezados (más
 * "documento oficial"), Arial para cuerpo — mismo criterio que una plantilla
 * Word con Estilos rápidos. Cada nivel es visualmente distinguible del
 * siguiente (tamaño + peso + color, escala de slate) para que la Tabla de
 * Contenidos generada a partir de estos estilos tenga jerarquía clara. */
export const HEADING_STYLES: HeadingStyleDef[] = [
  { id: 'title', label: 'Título',    tag: 'h1', fontFamily: 'Calibri', fontSize: 28, fontWeight: 800, italic: false, underline: false, color: '#0f172a', textAlign: 'center', lineHeight: 1.2 },
  { id: 'h1',    label: 'Heading 1', tag: 'h1', fontFamily: 'Calibri', fontSize: 22, fontWeight: 700, italic: false, underline: false, color: '#1e293b', textAlign: 'left',   lineHeight: 1.25 },
  { id: 'h2',    label: 'Heading 2', tag: 'h2', fontFamily: 'Calibri', fontSize: 18, fontWeight: 700, italic: false, underline: false, color: '#1e40af', textAlign: 'left',   lineHeight: 1.3 },
  { id: 'h3',    label: 'Heading 3', tag: 'h3', fontFamily: 'Calibri', fontSize: 15, fontWeight: 600, italic: false, underline: false, color: '#334155', textAlign: 'left',   lineHeight: 1.3 },
  { id: 'h4',    label: 'Heading 4', tag: 'h4', fontFamily: 'Calibri', fontSize: 13, fontWeight: 600, italic: false, underline: false, color: '#475569', textAlign: 'left',   lineHeight: 1.35 },
  { id: 'h5',    label: 'Heading 5', tag: 'h5', fontFamily: 'Calibri', fontSize: 12, fontWeight: 600, italic: true,  underline: false, color: '#64748b', textAlign: 'left',   lineHeight: 1.35 },
  { id: 'h6',    label: 'Heading 6', tag: 'h6', fontFamily: 'Calibri', fontSize: 11, fontWeight: 600, italic: true,  underline: false, color: '#94a3b8', textAlign: 'left',   lineHeight: 1.4 },
  { id: 'normal', label: 'Normal',   tag: 'p',  fontFamily: 'Arial',   fontSize: 12, fontWeight: 400, italic: false, underline: false, color: '#1e293b', textAlign: 'left',   lineHeight: 1.35 },
  { id: 'quote',  label: 'Cita',     tag: 'blockquote', fontFamily: 'Arial', fontSize: 12, fontWeight: 400, italic: true, underline: false, color: '#64748b', textAlign: 'left', lineHeight: 1.35 },
];

/** Subconjunto que tiene sentido aplicar a una PORCIÓN de texto (span), no
 * a todo el bloque: se excluyen textAlign/lineHeight (propiedades de
 * párrafo, no de carácter) y "Cita" (es un estilo de bloque/blockquote).
 * Incluye una opción explícita de "ninguno" al principio. */
export const SELECTION_HEADING_OPTIONS = HEADING_STYLES.filter(
  (s) => s.id !== 'quote' && s.id !== 'normal',
);

export function findHeadingStyle(id: string): HeadingStyleDef | undefined {
  return HEADING_STYLES.find((s) => s.id === id);
}
