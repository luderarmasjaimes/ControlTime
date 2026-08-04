/**
 * Coloreado semántico (tipo "semáforo") de celdas de tabla — reproduce las
 * tablas de estado/condición/TARP/calidad del modelo corporativo minero
 * (docs/Modelo_Informe_Tecnico_Monitoreo_Sensores_Mineros_LATAM.docx), donde
 * las celdas con estados como VERDE / AMARILLO / CONFORME / NO CONFORME /
 * CRÍTICA / ALTA se pintan con los mismos tintes del documento.
 *
 * Se aplica por AUTO-DETECCIÓN del texto exacto de la celda (no requiere que
 * el usuario elija color a mano ni un modelo de datos nuevo): si el contenido
 * plano de la celda coincide EXACTAMENTE (sin distinguir mayúsculas/acentos
 * triviales) con un estado conocido, se le aplica el tinte. Coincidencia
 * exacta a propósito — nunca por subcadena — para no pintar un párrafo que
 * apenas contenga la palabra "alta".
 */
export interface SemanticStyle {
  bg: string;
  color: string;
}

// Tintes idénticos a las celdas del documento:
//   verde   #E2F0D9 / texto #375623  (conforme, cerrado, bajo)
//   amarillo#FFF2CC / texto #7F6000  (observación, medio, parcial, abierto)
//   azul    #DDEBF7 / texto #1F4E79  (en curso / informativo)
//   naranja #FCE4D6 / texto #843C0C  (naranja, alta)
//   rojo    #F4CCCC / texto #843434  (no conforme, crítico, inoperativo)
const GREEN: SemanticStyle = { bg: '#E2F0D9', color: '#375623' };
const AMBER: SemanticStyle = { bg: '#FFF2CC', color: '#7F6000' };
const BLUE: SemanticStyle = { bg: '#DDEBF7', color: '#1F4E79' };
const ORANGE: SemanticStyle = { bg: '#FCE4D6', color: '#843C0C' };
const RED: SemanticStyle = { bg: '#F4CCCC', color: '#843434' };

const STATUS_MAP: Record<string, SemanticStyle> = {
  // Verde
  VERDE: GREEN, CONFORME: GREEN, CERRADA: GREEN, CERRADO: GREEN,
  BAJA: GREEN, BAJO: GREEN, OPERATIVO: GREEN, ADECUADA: GREEN, CUMPLE: GREEN, OK: GREEN,
  // Amarillo
  AMARILLO: AMBER, OBSERVACION: AMBER, MEDIA: AMBER, MEDIO: AMBER,
  MODERADO: AMBER, PARCIAL: AMBER, ABIERTA: AMBER, ABIERTO: AMBER,
  DEGRADADO: AMBER, ATENCION: AMBER,
  // Azul (informativo / en proceso)
  'EN CURSO': BLUE, TECNICA: BLUE,
  // Naranja
  NARANJA: ORANGE, ALTA: ORANGE, ALTO: ORANGE,
  // Rojo
  ROJO: RED, 'NO CONFORME': RED, CRITICA: RED, CRITICO: RED,
  INOPERATIVO: RED, INMINENTE: RED, 'NO APTO': RED,
};

/** Normaliza el texto de la celda: quita etiquetas HTML, entidades comunes,
 * acentos, y recorta — para comparar contra las claves del mapa. */
function normalizeCellText(raw: string): string {
  const noTags = raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
  const noAccents = noTags.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return noAccents.trim().toUpperCase();
}

/** Devuelve el estilo semántico del estado de una celda, o null si su texto
 * no es un estado conocido. `isHeader` evita colorear la fila de cabecera. */
export function semanticStatusStyle(raw: string, isHeader = false): SemanticStyle | null {
  if (isHeader || !raw) return null;
  const txt = normalizeCellText(raw);
  if (!txt || txt.length > 14) return null; // los estados son cortos
  return STATUS_MAP[txt] || null;
}
