/**
 * Las 5 plantillas de carátula del ribbon ("Carátula" → Corporativo/Técnico/
 * Ejecutivo/Campo/Normativo) insertaban el mismo diseño único — hallazgo de
 * la certificación QA 2026-07-27 (ver ADR-048). Cada entrada aquí define un
 * diseño visual REAL y distinto, pensado para distinguir a simple vista a
 * quién va dirigido el informe (Gerencia, Control Interno, Auditoría
 * Interna, Operaciones de campo, Auditoría/regulación minera) — no solo una
 * etiqueta distinta sobre el mismo fondo.
 *
 * Todo es CSS puro (gradientes + patrones repetidos) — sin imágenes
 * externas, para que la carátula siga siendo 100% autocontenida y
 * exportable a PDF sin depender de assets remotos.
 */

export interface CoverTemplateStyle {
  id: string;
  label: string;
  desc: string;
  /** Fondo de toda la carátula — gradiente base + patrón decorativo apilado
   * (CSS permite varias capas de `background` separadas por coma). */
  background: string;
  textColor: string;
  accentColor: string;
  classificationBg: string;
  classificationColor: string;
  classificationLabel: string;
  titleFallback: string;
  titleFontFamily: string;
  /** Georgia/serif para el tono institucional de Ejecutivo/Normativo; el
   * resto usa la tipografía sans-serif de plataforma. */
  bodyFontFamily?: string;
  footerBg: string;
}

export const COVER_TEMPLATES: CoverTemplateStyle[] = [
  {
    id: 'corporate',
    label: 'Corporativo',
    desc: 'Gerencia General',
    background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #334155 100%)',
    textColor: '#ffffff',
    accentColor: '#fbbf24',
    classificationBg: 'rgba(15,23,42,0.9)',
    classificationColor: '#fbbf24',
    classificationLabel: 'CONFIDENCIAL',
    titleFallback: 'Informe Técnico',
    titleFontFamily: 'inherit',
    footerBg: 'rgba(15,23,42,0.35)',
  },
  {
    id: 'technical',
    label: 'Técnico',
    desc: 'Control Interno / Ingeniería',
    // Degradé azul técnico + grilla tipo plano de ingeniería (líneas finas
    // repetidas horizontales/verticales, muy baja opacidad).
    background:
      'repeating-linear-gradient(0deg, rgba(74,144,217,0.10) 0px, rgba(74,144,217,0.10) 1px, transparent 1px, transparent 32px), ' +
      'repeating-linear-gradient(90deg, rgba(74,144,217,0.10) 0px, rgba(74,144,217,0.10) 1px, transparent 1px, transparent 32px), ' +
      'linear-gradient(160deg, #0b2540 0%, #123456 55%, #1a3e6b 100%)',
    textColor: '#e6f1ff',
    accentColor: '#38bdf8',
    classificationBg: 'rgba(10,30,54,0.92)',
    classificationColor: '#38bdf8',
    classificationLabel: 'USO TÉCNICO — CONTROL INTERNO',
    titleFallback: 'Informe Técnico de Ingeniería',
    titleFontFamily: "'Courier New', monospace",
    footerBg: 'rgba(10,30,54,0.4)',
  },
  {
    id: 'executive',
    label: 'Ejecutivo',
    desc: 'Auditoría Interna',
    // Grises institucionales, deliberadamente sin colores vivos.
    background: 'linear-gradient(160deg, #2b2f36 0%, #3b3f45 60%, #52565c 100%)',
    textColor: '#f4f5f6',
    accentColor: '#7fa8ad',
    classificationBg: '#f4f5f6',
    classificationColor: '#2b2f36',
    classificationLabel: 'USO INTERNO — AUDITORÍA',
    titleFallback: 'Informe de Auditoría Interna',
    titleFontFamily: "Georgia, 'Times New Roman', serif",
    bodyFontFamily: "Georgia, 'Times New Roman', serif",
    footerBg: 'rgba(43,47,54,0.5)',
  },
  {
    id: 'field',
    label: 'Campo',
    desc: 'Operación minera',
    // Tonos tierra + franja de seguridad diagonal (alta visibilidad).
    background:
      'repeating-linear-gradient(45deg, rgba(242,194,48,0.12) 0px, rgba(242,194,48,0.12) 18px, transparent 18px, transparent 36px), ' +
      'linear-gradient(160deg, #5a4632 0%, #7a5c3e 55%, #8b6f4e 100%)',
    textColor: '#fff8ec',
    accentColor: '#f2c230',
    classificationBg: '#f2c230',
    classificationColor: '#3a2a12',
    classificationLabel: 'USO EN CAMPO — OPERACIONES',
    titleFallback: 'Informe de Operación en Campo',
    titleFontFamily: "'Arial Narrow', Arial, sans-serif",
    footerBg: 'rgba(58,42,18,0.45)',
  },
  {
    id: 'normative',
    label: 'Normativo',
    desc: 'Cumplimiento legal',
    // Verde institucional oscuro, tono de documento oficial/regulatorio.
    background: 'linear-gradient(160deg, #0b2b12 0%, #14401d 55%, #1e4620 100%)',
    textColor: '#f1f8f2',
    accentColor: '#d4c78a',
    classificationBg: 'rgba(11,43,18,0.92)',
    classificationColor: '#d4c78a',
    classificationLabel: 'USO OFICIAL — CUMPLIMIENTO NORMATIVO',
    titleFallback: 'Informe de Cumplimiento Normativo',
    titleFontFamily: "Georgia, 'Times New Roman', serif",
    bodyFontFamily: "Georgia, 'Times New Roman', serif",
    footerBg: 'rgba(11,43,18,0.4)',
  },
];

export function findCoverTemplate(id: string | undefined): CoverTemplateStyle {
  return COVER_TEMPLATES.find((t) => t.id === id) ?? COVER_TEMPLATES[0];
}
