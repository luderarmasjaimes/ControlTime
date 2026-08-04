import type { ReportDocument, ReportElement, ReportPage } from '../store/useEditorStore';
import { getReportLayoutMetrics, type ReportLayoutMetrics } from './reportLayoutMetrics';
import { getSession } from '../../../auth/authStorage';
import { resolveMiningUnitName } from './sessionChrome';

/**
 * Plantillas de documento completo (pedido explícito 2026-07-30): a
 * diferencia de "Bloques Técnicos"/"Plantillas de sección" (que insertan UN
 * bloque en la página actual), esto reemplaza el documento ENTERO por una
 * estructura multi-página ya redactada, personalizada con la sesión activa
 * (empresa/unidad minera/usuario), lista para que el usuario edite los
 * datos específicos del caso en vez de partir de una hoja en blanco.
 */

export interface DocumentTemplateMeta {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  group: 'principal' | 'otros';
  classification: string;
  docCodePrefix: string;
}

export const DOCUMENT_TEMPLATES: DocumentTemplateMeta[] = [
  {
    id: 'informe-tecnico',
    label: 'Informe Técnico',
    shortLabel: 'Informe Técnico',
    description: 'Informe técnico estándar: antecedentes, metodología, hallazgos, sensores y conclusiones.',
    group: 'principal',
    classification: 'CONFIDENCIAL',
    docCodePrefix: 'IT',
  },
  {
    id: 'propuesta-tecnica',
    label: 'Propuesta Técnica',
    shortLabel: 'Prop. Técnica',
    description: 'Propuesta de solución técnica: alcance, metodología, cronograma y equipo de trabajo.',
    group: 'principal',
    classification: 'CONFIDENCIAL — USO COMERCIAL',
    docCodePrefix: 'PT',
  },
  {
    id: 'propuesta-tecnica-economica',
    label: 'Propuesta Técnica Económica',
    shortLabel: 'Prop. Técn-Econ.',
    description: 'Propuesta técnica + presupuesto detallado, forma de pago y condiciones comerciales.',
    group: 'principal',
    classification: 'CONFIDENCIAL — USO COMERCIAL',
    docCodePrefix: 'PTE',
  },
  {
    id: 'informe-instalacion-reparacion',
    label: 'Informe de Instalación / Reparación',
    shortLabel: 'Instalación/Reparación',
    description: 'Registro de intervención en campo: equipo afectado, diagnóstico, trabajo realizado y pruebas.',
    group: 'principal',
    classification: 'USO INTERNO',
    docCodePrefix: 'IIR',
  },
  {
    id: 'informe-mantenimiento',
    label: 'Informe de Mantenimiento',
    shortLabel: 'Mantenimiento',
    description: 'Mantenimiento preventivo/correctivo de la red de sensores: checklist, hallazgos y próxima revisión.',
    group: 'principal',
    classification: 'USO INTERNO',
    docCodePrefix: 'IM',
  },
  {
    id: 'acta-reunion',
    label: 'Acta de Reunión',
    shortLabel: 'Acta de Reunión',
    description: 'Acta formal: asistentes, agenda, acuerdos y responsables con fecha compromiso.',
    group: 'otros',
    classification: 'USO INTERNO',
    docCodePrefix: 'ACT',
  },
  {
    id: 'informe-incidente',
    label: 'Informe de Incidente / No Conformidad',
    shortLabel: 'Incidente / NC',
    description: 'Registro de incidente o no conformidad: hechos, causa raíz, acción correctiva y cierre.',
    group: 'otros',
    classification: 'CONFIDENCIAL',
    docCodePrefix: 'INC',
  },
  {
    id: 'ficha-inspeccion-campo',
    label: 'Ficha de Inspección de Campo',
    shortLabel: 'Inspección de Campo',
    description: 'Checklist de inspección en terreno de sensores/estaciones, con estado y observaciones.',
    group: 'otros',
    classification: 'USO INTERNO',
    docCodePrefix: 'FIC',
  },
];

export function findDocumentTemplate(id: string): DocumentTemplateMeta | undefined {
  return DOCUMENT_TEMPLATES.find((t) => t.id === id);
}

// ─────────────────────────────────────────────────────────────────────────
// Secciones "rellenables" por plantilla -- metadatos para el asistente del
// chatbot (SupportChatWidget): pregunta, por sección, el texto real que
// reemplaza el placeholder entre corchetes del builder correspondiente. Solo
// cubre párrafos/listas narrativas (no celdas de tabla individuales, que se
// siguen editando directamente en el lienzo como cualquier otra tabla).
// ─────────────────────────────────────────────────────────────────────────

export type TemplateAnswers = Record<string, string>;

export interface TemplateSectionDef {
  id: string;
  label: string;
  kind: 'paragraph' | 'bullets';
}

export const TEMPLATE_SECTIONS: Record<string, TemplateSectionDef[]> = {
  'informe-tecnico': [
    { id: 'objetivo', label: 'Objetivo del informe', kind: 'paragraph' },
    { id: 'metodologia', label: 'Metodología (un punto por línea)', kind: 'bullets' },
    { id: 'hallazgos', label: 'Hallazgos del periodo', kind: 'paragraph' },
    { id: 'analisis', label: 'Análisis y discusión', kind: 'paragraph' },
    { id: 'conclusiones', label: 'Conclusiones y recomendaciones (un punto por línea)', kind: 'bullets' },
  ],
  'propuesta-tecnica': [
    { id: 'antecedentes', label: 'Antecedentes y necesidad identificada', kind: 'paragraph' },
    { id: 'alcance', label: 'Alcance de la propuesta (un punto por línea)', kind: 'bullets' },
    { id: 'metodologia', label: 'Metodología de trabajo', kind: 'paragraph' },
    { id: 'condiciones', label: 'Condiciones generales (un punto por línea)', kind: 'bullets' },
  ],
  'propuesta-tecnica-economica': [
    { id: 'alcance', label: 'Alcance técnico — resumen (un punto por línea)', kind: 'bullets' },
    { id: 'forma-pago', label: 'Forma de pago (un punto por línea)', kind: 'bullets' },
    { id: 'condiciones', label: 'Condiciones comerciales (un punto por línea)', kind: 'bullets' },
  ],
  'informe-instalacion-reparacion': [
    { id: 'diagnostico', label: 'Diagnóstico', kind: 'paragraph' },
    { id: 'trabajo', label: 'Trabajo realizado (un punto por línea)', kind: 'bullets' },
    { id: 'pruebas', label: 'Pruebas de funcionamiento', kind: 'paragraph' },
    { id: 'conclusion', label: 'Conclusión', kind: 'paragraph' },
  ],
  'informe-mantenimiento': [
    { id: 'alcance', label: 'Alcance del mantenimiento', kind: 'paragraph' },
    { id: 'hallazgos', label: 'Hallazgos y acciones correctivas', kind: 'paragraph' },
    { id: 'proxima-revision', label: 'Próxima revisión programada', kind: 'paragraph' },
  ],
  'acta-reunion': [
    { id: 'agenda', label: 'Agenda (un punto por línea)', kind: 'bullets' },
    { id: 'desarrollo', label: 'Desarrollo y acuerdos', kind: 'paragraph' },
    { id: 'proxima-reunion', label: 'Próxima reunión', kind: 'paragraph' },
  ],
  'informe-incidente': [
    { id: 'descripcion', label: 'Descripción de los hechos', kind: 'paragraph' },
    { id: 'causa-raiz', label: 'Análisis de causa raíz', kind: 'paragraph' },
    { id: 'impacto', label: 'Impacto (un punto por línea)', kind: 'bullets' },
    { id: 'verificacion', label: 'Verificación de cierre', kind: 'paragraph' },
  ],
  'ficha-inspeccion-campo': [
    { id: 'condiciones-acceso', label: 'Condiciones de acceso y seguridad', kind: 'paragraph' },
    { id: 'hallazgos', label: 'Hallazgos prioritarios (un punto por línea)', kind: 'bullets' },
    { id: 'recomendaciones', label: 'Recomendaciones', kind: 'paragraph' },
  ],
};

export function getTemplateSections(templateId: string): TemplateSectionDef[] {
  return TEMPLATE_SECTIONS[templateId] || [];
}

function answerText(answers: TemplateAnswers, id: string, fallback: string): string {
  const v = answers[id];
  return v && v.trim() ? v.trim() : fallback;
}

function answerBullets(answers: TemplateAnswers, id: string, fallback: string[]): string[] {
  const v = answers[id];
  if (!v || !v.trim()) return fallback;
  return v.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────
// Motor de flujo: coloca bloques en secuencia, saltando de página cuando no
// entran más (estimación de alto por caracteres/renglón -- no es pixel-
// perfect, pero evita que el contenido se corte o se solape; el usuario
// puede ajustar tamaños/posiciones a mano después, igual que con cualquier
// otro bloque insertado en el lienzo).
// ─────────────────────────────────────────────────────────────────────────

interface Flow {
  m: ReportLayoutMetrics;
  pages: ReportPage[];
  y: number;
  zIndex: number;
  uid: number;
}

function newFlow(m: ReportLayoutMetrics, startPageNumber: number): Flow {
  return { m, pages: [{ page_number: startPageNumber, elements: [] }], y: m.CONTENT_TOP, zIndex: 10, uid: 0 };
}

function currentPage(flow: Flow): ReportPage {
  return flow.pages[flow.pages.length - 1];
}

function nextId(flow: Flow, tag: string): string {
  flow.uid += 1;
  return `tpl-${tag}-${currentPage(flow).page_number}-${Date.now()}-${flow.uid}`;
}

function ensureSpace(flow: Flow, neededHeight: number): void {
  if (flow.y + neededHeight > flow.m.CONTENT_BOTTOM) {
    const pageNumber = currentPage(flow).page_number + 1;
    flow.pages.push({ page_number: pageNumber, elements: [] });
    flow.y = flow.m.CONTENT_TOP;
  }
}

const baseTextProps = {
  fontFamily: 'Arial',
  fontColor: '#0f172a',
  backgroundColor: 'transparent',
  textAlign: 'left' as const,
  listType: 'none',
  bold: false,
  italic: false,
  underline: false,
  spans: [],
};

function addHeading(flow: Flow, text: string, level: 1 | 2 | 3 = 1): void {
  const fontSize = level === 1 ? 18 : level === 2 ? 15 : 13;
  const width = flow.m.CONTENT_RIGHT - flow.m.CONTENT_LEFT;
  // Alto calculado igual que un párrafo (texto medido con métricas reales),
  // en vez de un alto fijo -- un título largo que envuelve a 2 líneas ya no
  // se recorta/solapa con lo que viene después.
  const height = estimateParagraphHeight(text, width, fontSize, 1.2);
  const gapAfter = level === 1 ? 10 : 6;
  ensureSpace(flow, height + gapAfter);
  const el: ReportElement = {
    id: nextId(flow, 'h'),
    type: 'text',
    x: flow.m.CONTENT_LEFT,
    y: flow.y,
    width: flow.m.CONTENT_RIGHT - flow.m.CONTENT_LEFT,
    height,
    zIndex: flow.zIndex++,
    locked: false,
    props: {
      ...baseTextProps,
      text,
      fontSize,
      bold: true,
      lineHeight: 1.2,
      headingStyle: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3',
    },
  };
  currentPage(flow).elements.push(el);
  flow.y += height + gapAfter;
}

// Mismo criterio de medición que usa el editor para autoajustar un bloque de
// texto real (PageCanvas.tsx: getAutoSizedTextBox / measureWordCached), para
// que el alto ESTIMADO aquí coincida con el alto que el editor calcularía si
// el usuario abriera y cerrara el bloque -- evita que el texto real (medido
// con las métricas reales de la fuente) desborde una caja calculada con un
// promedio de ancho de caracter, que es lo que causaba el solapamiento.
let sharedMeasureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (sharedMeasureCtx !== undefined) return sharedMeasureCtx;
  try {
    sharedMeasureCtx = document.createElement('canvas').getContext('2d');
  } catch {
    sharedMeasureCtx = null;
  }
  return sharedMeasureCtx;
}

const TEXT_HORIZONTAL_PADDING = 16; // debe igualar el padding real del bloque en PageCanvas.tsx (8px por lado)
const TEXT_VERTICAL_PADDING = 16;

function estimateParagraphHeight(text: string, width: number, fontSize: number, lineHeight = 1.4, fontFamily = 'Arial'): number {
  const usableWidth = Math.max(20, width - TEXT_HORIZONTAL_PADDING);
  const ctx = getMeasureCtx();
  const rawParagraphs = text.split('\n');
  let visualLines = 0;

  if (ctx) {
    ctx.font = `${fontSize}px ${fontFamily}`;
    rawParagraphs.forEach((paragraph) => {
      if (paragraph.length === 0) { visualLines += 1; return; }
      const words = paragraph.split(/\s+/).filter(Boolean);
      let lineWidth = 0;
      let linesForParagraph = 1;
      words.forEach((word, idx) => {
        const wordWidth = ctx.measureText(idx === 0 ? word : ` ${word}`).width;
        if (lineWidth + wordWidth > usableWidth && lineWidth > 0) {
          linesForParagraph += 1;
          lineWidth = ctx.measureText(word).width;
        } else {
          lineWidth += wordWidth;
        }
      });
      visualLines += Math.max(1, linesForParagraph);
    });
  } else {
    // Sin canvas disponible (no debería ocurrir en el navegador real):
    // fallback conservador, sobreestima en vez de subestimar.
    const avgCharWidth = fontSize * 0.5;
    const charsPerLine = Math.max(15, Math.floor(usableWidth / avgCharWidth));
    rawParagraphs.forEach((l) => { visualLines += Math.max(1, Math.ceil(l.length / charsPerLine)); });
  }

  const lineHeightPx = fontSize * lineHeight;
  // +15% de margen de seguridad: aunque la medición ya usa las métricas
  // reales de la fuente, el renderer de Konva puede envolver ligeramente
  // distinto (kerning, subpíxeles) -- preferimos una caja algo más alta
  // (espacio en blanco de sobra, inocuo) a una más baja (solapamiento real).
  const raw = Math.max(1, visualLines) * lineHeightPx + TEXT_VERTICAL_PADDING;
  return Math.ceil(raw * 1.15);
}

function addParagraph(flow: Flow, text: string, opts: { bold?: boolean; italic?: boolean; fontSize?: number } = {}): void {
  const width = flow.m.CONTENT_RIGHT - flow.m.CONTENT_LEFT;
  const fontSize = opts.fontSize ?? 12;
  const lineHeight = 1.4;
  const height = estimateParagraphHeight(text, width, fontSize, lineHeight);
  ensureSpace(flow, height);
  const el: ReportElement = {
    id: nextId(flow, 'p'),
    type: 'text',
    x: flow.m.CONTENT_LEFT,
    y: flow.y,
    width,
    height,
    zIndex: flow.zIndex++,
    locked: false,
    props: {
      ...baseTextProps,
      text,
      fontSize,
      bold: Boolean(opts.bold),
      italic: Boolean(opts.italic),
      lineHeight,
    },
  };
  currentPage(flow).elements.push(el);
  flow.y += height + 10;
}

function addBullets(flow: Flow, items: string[], opts: { fontSize?: number } = {}): void {
  const text = items.map((i) => `•  ${i}`).join('\n');
  const width = flow.m.CONTENT_RIGHT - flow.m.CONTENT_LEFT;
  const fontSize = opts.fontSize ?? 12;
  const lineHeight = 1.5;
  const height = estimateParagraphHeight(text, width, fontSize, lineHeight) + items.length * 2;
  ensureSpace(flow, height);
  const el: ReportElement = {
    id: nextId(flow, 'ul'),
    type: 'text',
    x: flow.m.CONTENT_LEFT,
    y: flow.y,
    width,
    height,
    zIndex: flow.zIndex++,
    locked: false,
    props: { ...baseTextProps, text, fontSize, lineHeight },
  };
  currentPage(flow).elements.push(el);
  flow.y += height + 10;
}

function addTable(flow: Flow, rows: string[][], opts: { title?: string } = {}): void {
  const width = flow.m.CONTENT_RIGHT - flow.m.CONTENT_LEFT;
  const rowHeight = 28;
  const height = rows.length * rowHeight + 16;
  // Reserva el mismo alto que `addHeading(..., 3)` calculará realmente (en
  // vez de un número fijo de 24 desalineado con su lógica interna), para que
  // el chequeo de salto de página aquí y el salto real que decide addHeading
  // coincidan siempre.
  const titleReserve = opts.title
    ? estimateParagraphHeight(opts.title, width, 13, 1.2) + 6
    : 0;
  ensureSpace(flow, height + titleReserve);
  if (opts.title) {
    addHeading(flow, opts.title, 3);
  }
  const el: ReportElement = {
    id: nextId(flow, 'tbl'),
    type: 'table',
    x: flow.m.CONTENT_LEFT,
    y: flow.y,
    width,
    height,
    zIndex: flow.zIndex++,
    locked: false,
    wrapMode: 'square',
    props: {
      title: '',
      rows,
      hasHeader: true,
      borderColor: '#cbd5e1',
      borderWidth: 1,
      borderStyle: 'solid',
      headerBg: '#1e293b',
      headerTextColor: '#f8fafc',
      headerBold: true,
      cellPadding: 8,
      fontSize: 11,
      cellAlign: 'left',
      bandedRows: true,
      bandColor: '#f1f5f9',
    },
  };
  currentPage(flow).elements.push(el);
  flow.y += height + 14;
}

function addSpacer(flow: Flow, px = 10): void {
  flow.y += px;
}

// ─────────────────────────────────────────────────────────────────────────
// Personalización desde la sesión activa
// ─────────────────────────────────────────────────────────────────────────

interface PersonalizationContext {
  company: string;
  unit: string;
  userName: string;
  todayIso: string;
  todayEs: string;
  docCode: string;
}

function buildPersonalization(docCodePrefix: string): PersonalizationContext {
  const session = getSession();
  const company = session?.company?.trim() || 'la empresa minera';
  const unit = resolveMiningUnitName(session);
  const userName = session?.fullName?.trim() || session?.username?.trim() || 'Usuario';
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const todayEs = now.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
  const seq = String(now.getTime()).slice(-5);
  const docCode = `${docCodePrefix}-${now.getFullYear()}-${seq}`;
  return { company, unit, userName, todayIso, todayEs, docCode };
}

function buildCoverPage(
  pageNumber: number,
  m: ReportLayoutMetrics,
  title: string,
  ctx: PersonalizationContext,
  classification: string,
  coverTemplate: string,
): ReportPage {
  const cover: ReportElement = {
    id: `tpl-cover-${pageNumber}-${Date.now()}`,
    type: 'cover',
    x: 0,
    y: 0,
    width: m.PAGE_WIDTH,
    height: m.PAGE_HEIGHT,
    zIndex: 0,
    locked: true,
    props: {
      title,
      date: ctx.todayIso,
      classification,
      docCode: ctx.docCode,
      bgColor: '',
      textColor: '',
      coverTemplate,
    },
  };
  return { page_number: pageNumber, elements: [cover] };
}

function buildTocPage(pageNumber: number, m: ReportLayoutMetrics): ReportPage {
  const toc: ReportElement = {
    id: `tpl-toc-${pageNumber}-${Date.now()}`,
    type: 'toc',
    x: m.CONTENT_LEFT,
    y: m.CONTENT_TOP,
    width: m.CONTENT_RIGHT - m.CONTENT_LEFT,
    height: Math.max(200, m.CONTENT_BOTTOM - m.CONTENT_TOP),
    zIndex: 0,
    locked: false,
    props: { title: 'Tabla de Contenidos', autoGenerate: true },
  };
  return { page_number: pageNumber, elements: [toc] };
}

// ─────────────────────────────────────────────────────────────────────────
// Contenido por plantilla -- cada builder recibe `flow` ya posicionado en la
// página de contenido (después de carátula + índice) y solo agrega bloques.
// ─────────────────────────────────────────────────────────────────────────

function buildInformeTecnico(flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers): void {
  addHeading(flow, '1. Antecedentes', 1);
  addParagraph(flow, `El presente informe técnico documenta el estado de la operación de monitoreo geotécnico, geoespacial, ambiental e hidrológico de ${ctx.unit}, ${ctx.company}, correspondiente al periodo informado. La información se obtiene de la red de sensores de la plataforma Beemetry y, en el caso de sismicidad, de la combinación de la red propia con el catálogo oficial del IGP/CENSIS (Instituto Geofísico del Perú).`);
  addParagraph(flow, `Objetivo: ${answerText(answers, 'objetivo', '[Describir el objetivo específico de este informe — p. ej. evaluación de estabilidad de talud, seguimiento de un evento particular, reporte periódico programado].')}`);

  addHeading(flow, '2. Metodología', 1);
  addBullets(flow, answerBullets(answers, 'metodologia', [
    'Revisión de la telemetría registrada por la red de sensores de la unidad (piezómetros, inclinómetros, radar de taludes GB-SAR, GPS geodésico).',
    'Verificación cruzada de sismicidad regional (IGP/CENSIS) frente a microsismicidad detectada por la red propia.',
    'Análisis de tendencias y comparación contra los umbrales de alerta configurados en la plataforma.',
    'Inspección de campo complementaria [indicar fecha y responsable, si corresponde].',
  ]));

  addHeading(flow, '3. Hallazgos', 1);
  addParagraph(flow, answerText(answers, 'hallazgos', '[Completar con los hallazgos específicos del periodo: lecturas relevantes, alarmas activadas, desviaciones respecto de la línea base, y cualquier evento que requiera seguimiento.]'));
  addTable(flow, [
    ['Sensor / Estación', 'Tipo', 'Lectura actual', 'Umbral', 'Estado'],
    ['[Nombre del sensor]', '[Piezómetro / Inclinómetro / Radar / etc.]', '[Valor]', '[Umbral configurado]', '[Normal / Vigilancia / Alerta]'],
    ['[Nombre del sensor]', '[Tipo]', '[Valor]', '[Umbral configurado]', '[Normal / Vigilancia / Alerta]'],
  ], { title: '3.1 Resumen de lecturas relevantes' });

  addHeading(flow, '4. Análisis y Discusión', 1);
  addParagraph(flow, answerText(answers, 'analisis', '[Interpretar los hallazgos: ¿las lecturas están dentro de rango esperado? ¿hay una tendencia sostenida que amerite escalamiento? ¿existe correlación entre eventos sísmicos regionales y la respuesta de los sensores geotécnicos?]'));

  addHeading(flow, '5. Conclusiones y Recomendaciones', 1);
  addBullets(flow, answerBullets(answers, 'conclusiones', [
    '[Conclusión principal 1]',
    '[Conclusión principal 2]',
    'Recomendación: [acción sugerida, responsable y plazo].',
  ]));

  addHeading(flow, '6. Elaborado por', 1);
  addParagraph(flow, `${ctx.userName}\n${ctx.unit} — ${ctx.company}\nFecha: ${ctx.todayEs}`);
}

function buildPropuestaTecnica(flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers): void {
  addHeading(flow, '1. Presentación', 1);
  addParagraph(flow, `${ctx.company} presenta a continuación una propuesta técnica para atender el requerimiento planteado por ${ctx.unit}, orientada a fortalecer la capacidad de monitoreo, seguridad operacional y toma de decisiones basada en datos en tiempo real.`);

  addHeading(flow, '2. Antecedentes y Necesidad Identificada', 1);
  addParagraph(flow, answerText(answers, 'antecedentes', '[Describir el problema u oportunidad que motiva esta propuesta: brecha de monitoreo, renovación de infraestructura, ampliación de cobertura de sensores, etc.]'));

  addHeading(flow, '3. Alcance de la Propuesta', 1);
  addBullets(flow, answerBullets(answers, 'alcance', [
    'Suministro/configuración de sensores: [detallar tipos — geotécnicos, geoespaciales, ambientales, hidrológicos].',
    'Integración a la plataforma de monitoreo en tiempo real (dashboard, alertas, reportabilidad automática).',
    'Capacitación al personal de la unidad minera en el uso de la plataforma.',
    'Soporte técnico durante el periodo de implementación y puesta en marcha.',
  ]));

  addHeading(flow, '4. Metodología de Trabajo', 1);
  addParagraph(flow, answerText(answers, 'metodologia', '[Describir el enfoque: levantamiento de información en campo, diseño de la solución, instalación/configuración, pruebas de aceptación, entrega y cierre.]'));

  addHeading(flow, '5. Cronograma Estimado', 1);
  addTable(flow, [
    ['Etapa', 'Descripción', 'Duración estimada'],
    ['1. Diagnóstico', 'Levantamiento de información y validación de requerimientos', '[X] días'],
    ['2. Implementación', 'Instalación/configuración de sensores y plataforma', '[X] días'],
    ['3. Pruebas', 'Validación funcional y ajuste de umbrales de alerta', '[X] días'],
    ['4. Cierre', 'Capacitación, entrega de documentación y acta de conformidad', '[X] días'],
  ]);

  addHeading(flow, '6. Equipo de Trabajo', 1);
  addParagraph(flow, `Responsable técnico: ${ctx.userName} — ${ctx.company}\n[Agregar otros integrantes del equipo según corresponda.]`);

  addHeading(flow, '7. Condiciones Generales', 1);
  addBullets(flow, answerBullets(answers, 'condiciones', [
    'Vigencia de la propuesta: [X] días a partir de la fecha de emisión.',
    'La propuesta no incluye aspectos económicos — ver documento "Propuesta Técnica Económica" si se requiere.',
    '[Otras condiciones aplicables].',
  ]));
}

function buildPropuestaTecnicaEconomica(flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers): void {
  addHeading(flow, '1. Presentación', 1);
  addParagraph(flow, `${ctx.company} presenta la propuesta técnica-económica para el requerimiento de ${ctx.unit}, incluyendo el detalle de alcance, cronograma, inversión y condiciones comerciales.`);

  addHeading(flow, '2. Alcance Técnico (Resumen)', 1);
  addBullets(flow, answerBullets(answers, 'alcance', [
    '[Resumen del alcance técnico — ver detalle completo en la Propuesta Técnica asociada, si existe como documento separado.]',
    'Sensores y equipos incluidos: [detallar].',
    'Servicios incluidos: instalación, configuración, capacitación, soporte durante [X] meses.',
  ]));

  addHeading(flow, '3. Presupuesto Detallado', 1);
  addTable(flow, [
    ['Ítem', 'Descripción', 'Cantidad', 'Precio Unit. (USD)', 'Subtotal (USD)'],
    ['1', '[Equipo/servicio 1]', '[Cant.]', '[Precio]', '[Subtotal]'],
    ['2', '[Equipo/servicio 2]', '[Cant.]', '[Precio]', '[Subtotal]'],
    ['3', '[Equipo/servicio 3]', '[Cant.]', '[Precio]', '[Subtotal]'],
    ['', '', '', 'Subtotal', '[Monto]'],
    ['', '', '', 'IGV (18%)', '[Monto]'],
    ['', '', '', 'TOTAL', '[Monto]'],
  ]);

  addHeading(flow, '4. Forma de Pago', 1);
  addBullets(flow, answerBullets(answers, 'forma-pago', [
    '[X]% a la aceptación de la propuesta (adelanto).',
    '[X]% contra entrega/puesta en marcha.',
    '[X]% a los [X] días de la conformidad final.',
  ]));

  addHeading(flow, '5. Condiciones Comerciales', 1);
  addBullets(flow, answerBullets(answers, 'condiciones', [
    'Validez de la oferta: [X] días calendario.',
    'Precios expresados en Dólares Americanos (USD), no incluyen impuestos salvo indicación contraria.',
    'Garantía: [X] meses sobre equipos/servicios instalados.',
    '[Otras condiciones — penalidades, fuerza mayor, jurisdicción, etc.]',
  ]));

  addHeading(flow, '6. Aprobación', 1);
  addParagraph(flow, `Elaborado por: ${ctx.userName} — ${ctx.company}\nFecha: ${ctx.todayEs}\n\nAceptado por (${ctx.unit}): _______________________  Fecha: _______________`);
}

function buildInformeInstalacionReparacion(flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers): void {
  addHeading(flow, '1. Datos Generales de la Intervención', 1);
  addTable(flow, [
    ['Campo', 'Detalle'],
    ['Unidad minera', ctx.unit],
    ['Empresa', ctx.company],
    ['Tipo de intervención', '[Instalación / Reparación]'],
    ['Fecha de intervención', ctx.todayEs],
    ['Técnico responsable', ctx.userName],
  ]);

  addHeading(flow, '2. Equipo / Sensor Afectado', 1);
  addTable(flow, [
    ['Campo', 'Detalle'],
    ['Nombre / código del sensor', '[Ej: PZ-TAJO-NORTE-01]'],
    ['Tipo de sensor', '[Piezómetro / Inclinómetro / Radar / GPS / Ambiental / Hidrológico]'],
    ['Ubicación / zona', '[Zona o coordenadas]'],
    ['Estado previo', '[Fuera de línea / Lectura errática / Instalación nueva / etc.]'],
  ]);

  addHeading(flow, '3. Diagnóstico', 1);
  addParagraph(flow, answerText(answers, 'diagnostico', '[Describir el diagnóstico técnico: causa de la falla identificada, o motivo de la nueva instalación.]'));

  addHeading(flow, '4. Trabajo Realizado', 1);
  addBullets(flow, answerBullets(answers, 'trabajo', [
    '[Detalle del trabajo 1 — ej. reemplazo de sensor, recalibración, reconexión de cableado].',
    '[Detalle del trabajo 2].',
    '[Materiales/repuestos utilizados].',
  ]));

  addHeading(flow, '5. Pruebas de Funcionamiento', 1);
  addParagraph(flow, answerText(answers, 'pruebas', '[Describir las pruebas realizadas tras la intervención: verificación de lectura en la plataforma, comparación contra valor esperado, tiempo de estabilización, etc.]'));
  addTable(flow, [
    ['Prueba', 'Resultado esperado', 'Resultado obtenido', 'Conforme'],
    ['[Prueba 1]', '[Valor esperado]', '[Valor obtenido]', '[Sí / No]'],
    ['[Prueba 2]', '[Valor esperado]', '[Valor obtenido]', '[Sí / No]'],
  ]);

  addHeading(flow, '6. Conclusión', 1);
  addParagraph(flow, answerText(answers, 'conclusion', '[Indicar si el equipo quedó operativo y disponible en la plataforma, y cualquier seguimiento pendiente.]'));

  addHeading(flow, '7. Firmas', 1);
  addParagraph(flow, `Técnico responsable: ${ctx.userName}\nFecha: ${ctx.todayEs}\n\nConformidad del cliente (${ctx.unit}): _______________________  Fecha: _______________`);
}

function buildInformeMantenimiento(flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers): void {
  addHeading(flow, '1. Datos Generales', 1);
  addTable(flow, [
    ['Campo', 'Detalle'],
    ['Unidad minera', ctx.unit],
    ['Empresa', ctx.company],
    ['Tipo de mantenimiento', '[Preventivo / Correctivo]'],
    ['Fecha', ctx.todayEs],
    ['Responsable', ctx.userName],
  ]);

  addHeading(flow, '2. Alcance del Mantenimiento', 1);
  addParagraph(flow, answerText(answers, 'alcance', '[Describir qué parte de la red de sensores/plataforma fue objeto de este mantenimiento — ej. estaciones geotécnicas de un sector, red completa, revisión de comunicaciones, etc.]'));

  addHeading(flow, '3. Checklist de Revisión', 1);
  addTable(flow, [
    ['Ítem', 'Verificación', 'Estado', 'Observaciones'],
    ['1', 'Comunicación sensor–plataforma (estado en línea)', '[OK / Falla]', '[Detalle]'],
    ['2', 'Calibración / lectura dentro de rango esperado', '[OK / Falla]', '[Detalle]'],
    ['3', 'Estado físico del equipo (carcasa, cableado, fijación)', '[OK / Falla]', '[Detalle]'],
    ['4', 'Alimentación eléctrica / batería / panel solar', '[OK / Falla]', '[Detalle]'],
    ['5', 'Umbrales de alerta configurados correctamente', '[OK / Falla]', '[Detalle]'],
  ]);

  addHeading(flow, '4. Hallazgos y Acciones Correctivas', 1);
  addParagraph(flow, answerText(answers, 'hallazgos', '[Detallar cualquier hallazgo que haya requerido acción inmediata durante el mantenimiento, y las acciones tomadas.]'));

  addHeading(flow, '5. Próxima Revisión Programada', 1);
  addParagraph(flow, answerText(answers, 'proxima-revision', '[Fecha estimada de la siguiente revisión de mantenimiento preventivo, según la periodicidad establecida para este tipo de sensor/estación.]'));

  addHeading(flow, '6. Firma', 1);
  addParagraph(flow, `Responsable de mantenimiento: ${ctx.userName}\nFecha: ${ctx.todayEs}`);
}

function buildActaReunion(flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers): void {
  addHeading(flow, '1. Datos de la Reunión', 1);
  addTable(flow, [
    ['Campo', 'Detalle'],
    ['Unidad minera', ctx.unit],
    ['Empresa', ctx.company],
    ['Fecha', ctx.todayEs],
    ['Hora de inicio / término', '[HH:MM] — [HH:MM]'],
    ['Lugar / modalidad', '[Presencial / Videollamada]'],
    ['Convocado por', ctx.userName],
  ]);

  addHeading(flow, '2. Asistentes', 1);
  addTable(flow, [
    ['Nombre', 'Cargo / Empresa', 'Asistencia'],
    [ctx.userName, '[Cargo]', 'Presente'],
    ['[Nombre]', '[Cargo]', '[Presente / Ausente]'],
    ['[Nombre]', '[Cargo]', '[Presente / Ausente]'],
  ]);

  addHeading(flow, '3. Agenda', 1);
  addBullets(flow, answerBullets(answers, 'agenda', ['[Punto de agenda 1]', '[Punto de agenda 2]', '[Punto de agenda 3]']));

  addHeading(flow, '4. Desarrollo y Acuerdos', 1);
  addParagraph(flow, answerText(answers, 'desarrollo', '[Resumir lo tratado en cada punto de agenda y los acuerdos alcanzados.]'));

  addHeading(flow, '5. Compromisos', 1);
  addTable(flow, [
    ['#', 'Compromiso', 'Responsable', 'Fecha compromiso'],
    ['1', '[Compromiso 1]', '[Nombre]', '[Fecha]'],
    ['2', '[Compromiso 2]', '[Nombre]', '[Fecha]'],
  ]);

  addHeading(flow, '6. Próxima Reunión', 1);
  addParagraph(flow, answerText(answers, 'proxima-reunion', '[Fecha y tema propuesto para la siguiente reunión, si aplica.]'));
}

function buildInformeIncidente(flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers): void {
  addHeading(flow, '1. Identificación del Incidente / No Conformidad', 1);
  addTable(flow, [
    ['Campo', 'Detalle'],
    ['Unidad minera', ctx.unit],
    ['Empresa', ctx.company],
    ['Fecha y hora del evento', '[Fecha] [Hora]'],
    ['Reportado por', ctx.userName],
    ['Clasificación', '[Incidente de seguridad / No conformidad de calidad / Falla de equipo / Otro]'],
    ['Severidad', '[Baja / Media / Alta / Crítica]'],
  ]);

  addHeading(flow, '2. Descripción de los Hechos', 1);
  addParagraph(flow, answerText(answers, 'descripcion', '[Describir de forma objetiva y cronológica lo ocurrido: qué pasó, dónde, cuándo, quiénes estuvieron involucrados, y qué equipos/sensores/procesos se vieron afectados.]'));

  addHeading(flow, '3. Análisis de Causa Raíz', 1);
  addParagraph(flow, answerText(answers, 'causa-raiz', '[Aplicar la metodología de análisis definida (5 porqués, Ishikawa, etc.) y documentar la causa raíz identificada, no solo el síntoma inmediato.]'));

  addHeading(flow, '4. Impacto', 1);
  addBullets(flow, answerBullets(answers, 'impacto', [
    'Impacto operacional: [describir].',
    'Impacto en la seguridad: [describir].',
    'Impacto en la disponibilidad de datos/monitoreo: [describir, si aplica — ej. sensor fuera de línea durante X horas].',
  ]));

  addHeading(flow, '5. Acción Correctiva y Preventiva', 1);
  addTable(flow, [
    ['#', 'Acción', 'Responsable', 'Fecha compromiso', 'Estado'],
    ['1', '[Acción correctiva inmediata]', '[Nombre]', '[Fecha]', '[Pendiente / En curso / Cerrado]'],
    ['2', '[Acción preventiva para evitar recurrencia]', '[Nombre]', '[Fecha]', '[Pendiente / En curso / Cerrado]'],
  ]);

  addHeading(flow, '6. Verificación de Cierre', 1);
  addParagraph(flow, answerText(answers, 'verificacion', '[Evidencia de que las acciones fueron efectivas y el incidente/no conformidad puede cerrarse formalmente. Adjuntar registros de verificación si corresponde.]'));

  addHeading(flow, '7. Aprobación', 1);
  addParagraph(flow, `Elaborado por: ${ctx.userName}\nFecha: ${ctx.todayEs}\n\nRevisado y cerrado por: _______________________  Fecha: _______________`);
}

function buildFichaInspeccionCampo(flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers): void {
  addHeading(flow, '1. Datos de la Inspección', 1);
  addTable(flow, [
    ['Campo', 'Detalle'],
    ['Unidad minera', ctx.unit],
    ['Empresa', ctx.company],
    ['Fecha', ctx.todayEs],
    ['Inspector responsable', ctx.userName],
    ['Zona / sector inspeccionado', '[Zona]'],
  ]);

  addHeading(flow, '2. Checklist de Estaciones/Sensores', 1);
  addTable(flow, [
    ['Sensor / Estación', 'Tipo', 'Estado físico', 'Comunicación', 'Observaciones'],
    ['[Código]', '[Piezómetro / Inclinómetro / Radar / GPS / Ambiental]', '[Bueno / Regular / Malo]', '[En línea / Fuera de línea]', '[Detalle]'],
    ['[Código]', '[Tipo]', '[Bueno / Regular / Malo]', '[En línea / Fuera de línea]', '[Detalle]'],
    ['[Código]', '[Tipo]', '[Bueno / Regular / Malo]', '[En línea / Fuera de línea]', '[Detalle]'],
  ]);

  addHeading(flow, '3. Condiciones de Acceso y Seguridad', 1);
  addParagraph(flow, answerText(answers, 'condiciones-acceso', '[Observaciones sobre el acceso a la zona, condiciones de seguridad durante la inspección, y cualquier riesgo identificado en el trayecto o en el entorno de las estaciones.]'));

  addHeading(flow, '4. Hallazgos Prioritarios', 1);
  addBullets(flow, answerBullets(answers, 'hallazgos', ['[Hallazgo 1 — priorizar por severidad]', '[Hallazgo 2]', '[Hallazgo 3]']));

  addHeading(flow, '5. Recomendaciones', 1);
  addParagraph(flow, answerText(answers, 'recomendaciones', '[Acciones recomendadas a partir de los hallazgos: mantenimiento correctivo, reubicación de sensor, refuerzo de acceso, etc.]'));

  addHeading(flow, '6. Registro Fotográfico', 1);
  addParagraph(flow, '[Insertar fotografías de campo relevantes usando el botón "Imagen" del ribbon — se recomienda una foto por hallazgo con su pie de figura correspondiente.]', { italic: true });

  addHeading(flow, '7. Firma', 1);
  addParagraph(flow, `Inspector: ${ctx.userName}\nFecha: ${ctx.todayEs}`);
}

const TEMPLATE_BUILDERS: Record<string, (flow: Flow, ctx: PersonalizationContext, answers: TemplateAnswers) => void> = {
  'informe-tecnico': buildInformeTecnico,
  'propuesta-tecnica': buildPropuestaTecnica,
  'propuesta-tecnica-economica': buildPropuestaTecnicaEconomica,
  'informe-instalacion-reparacion': buildInformeInstalacionReparacion,
  'informe-mantenimiento': buildInformeMantenimiento,
  'acta-reunion': buildActaReunion,
  'informe-incidente': buildInformeIncidente,
  'ficha-inspeccion-campo': buildFichaInspeccionCampo,
};

const COVER_TEMPLATE_BY_ID: Record<string, string> = {
  'informe-tecnico': 'corporate',
  'propuesta-tecnica': 'executive',
  'propuesta-tecnica-economica': 'executive',
  'informe-instalacion-reparacion': 'technical',
  'informe-mantenimiento': 'technical',
  'acta-reunion': 'normative',
  'informe-incidente': 'field',
  'ficha-inspeccion-campo': 'field',
};

/**
 * Construye el documento completo (carátula + índice + contenido
 * multi-página) para la plantilla `templateId`, ya personalizado con la
 * sesión activa. Devuelve un `Partial<ReportDocument>` listo para pasar a
 * `useEditorStore.getState().loadDocument(...)` (que además rellena
 * encabezado/pie por página automáticamente).
 *
 * `answers` (opcional): contenido real recogido por el asistente del chatbot
 * (SupportChatWidget) para las secciones definidas en `TEMPLATE_SECTIONS`,
 * indexado por `section.id`. Toda sección sin respuesta cae al placeholder
 * entre corchetes de siempre, igual que al aplicar la plantilla desde el
 * ribbon sin pasar por el chatbot.
 */
export function buildDocumentTemplate(templateId: string, answers: TemplateAnswers = {}): Partial<ReportDocument> | null {
  const meta = findDocumentTemplate(templateId);
  const builder = TEMPLATE_BUILDERS[templateId];
  if (!meta || !builder) return null;

  const ctx = buildPersonalization(meta.docCodePrefix);
  const m = getReportLayoutMetrics('document', 'A4', 'portrait');

  const coverPage = buildCoverPage(1, m, meta.label, ctx, meta.classification, COVER_TEMPLATE_BY_ID[templateId] || 'corporate');
  const tocPage = buildTocPage(2, m);

  const flow = newFlow(m, 3);
  builder(flow, ctx, answers);

  return {
    pages: [coverPage, tocPage, ...flow.pages],
    meta: {
      author: ctx.userName,
      version: 1,
      updatedAt: new Date().toISOString(),
      layoutMode: 'document',
      paperSize: 'A4',
      orientation: 'portrait',
    },
  };
}
