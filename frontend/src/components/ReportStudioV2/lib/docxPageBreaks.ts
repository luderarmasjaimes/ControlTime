import JSZip from 'jszip';

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Los elementos booleanos de OOXML (`w:val` tipo ST_OnOff) son true tanto
 * si NO tienen atributo `w:val` (`<w:pageBreakBefore/>`) como si lo tienen
 * con un valor "verdadero" (`w:val="1"`/`"true"`/`"on"`) -- y FALSE si el
 * atributo está presente con `"0"`/`"false"`/`"off"`. Bug real encontrado
 * con un documento exportado desde Google Docs: ese exportador escribe
 * `<w:pageBreakBefore w:val="0"/>` EXPLÍCITO en TODOS los párrafos del
 * documento (parte de su estilo de serializar cada propiedad de forma
 * explícita, en vez de omitir las que están en `false` como sí hace Word) --
 * `expandParagraphPageBreaks` solo comprobaba si la ETIQUETA existía, sin
 * mirar su valor, así que trataba TODO párrafo del documento como si
 * tuviera un salto de página activado -- de ahí que cada línea (incluido
 * cada ítem de una lista con viñetas) terminara como su propio bloque de
 * texto en el lienzo. */
function isOnOffElementActive(element: Element): boolean {
  if (!element.hasAttribute('w:val')) return true;
  const val = element.getAttribute('w:val')?.trim().toLowerCase() ?? '';
  return val !== '0' && val !== 'false' && val !== 'off';
}

/**
 * Word/Google Docs guardan un salto de página "manual" de DOS formas
 * distintas en el XML del .docx, y mammoth.js (la librería que usamos para
 * convertir a HTML, ver App.tsx::handleImportDocx) solo entiende UNA de las
 * dos:
 *  - Ctrl+Enter / Insertar > Salto de página (Word y Docs) -- un carácter de
 *    salto (`<w:br w:type="page"/>`) DENTRO del texto de un párrafo. Esto SÍ
 *    lo reconoce mammoth (vía el `styleMap` que ya le pasamos).
 *  - "Agregar salto de página antes" (Formato > Estilos de párrafo en
 *    Google Docs; función equivalente en Word) -- una propiedad DEL PÁRRAFO
 *    (`<w:pageBreakBefore/>` dentro de `<w:pPr>`), no un carácter dentro del
 *    texto. mammoth.js NO tiene ningún soporte para esto -- ni lo expone a
 *    su modelo de documento interno, así que ni el `styleMap` ni
 *    `transformDocument` pueden verlo (confirmado leyendo su código fuente:
 *    `readParagraphProperties` en docx/body-reader.js jamás lee
 *    `w:pageBreakBefore`). Un documento que use esta opción (posible en
 *    cualquiera de los dos programas, pero la vía más directa de hacerlo en
 *    Google Docs desde 2021) se importaba SIN ningún corte -- exactamente
 *    el mismo síntoma reportado ("el texto de la página 1 y la página 2 se
 *    juntan en un solo bloque").
 *
 * Esta función NIVELA el campo de juego ANTES de pasarle el archivo a
 * mammoth: abre el .docx (es un .zip), busca cada párrafo con
 * `w:pageBreakBefore`, y le inserta ADELANTE un párrafo nuevo con el MISMO
 * carácter de salto manual (`w:br type="page"`) que el otro caso -- así
 * ambos mecanismos terminan viéndose exactamente igual para mammoth. El
 * párrafo original con `w:pageBreakBefore` se deja intacto (esa propiedad
 * simplemente sigue siendo ignorada, inofensivo).
 *
 * Nunca lanza: cualquier fallo al leer/parsear el archivo (no es un .docx
 * válido, XML corrupto, etc.) devuelve el buffer ORIGINAL sin tocar --
 * mammoth ya se encarga de reportar un error claro si el archivo en sí está
 * roto, esta función no debe ser la que rompa el flujo.
 */
export async function expandParagraphPageBreaks(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return arrayBuffer;
  }
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return arrayBuffer;

  let xmlText: string;
  try {
    xmlText = await documentFile.async('string');
  } catch {
    return arrayBuffer;
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return arrayBuffer;
  } catch {
    return arrayBuffer;
  }

  const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
  let injectedAny = false;
  paragraphs.forEach((paragraph) => {
    const properties = paragraph.getElementsByTagName('w:pPr')[0];
    if (!properties) return;
    const pageBreakBefore = properties.getElementsByTagName('w:pageBreakBefore')[0];
    if (!pageBreakBefore || !isOnOffElementActive(pageBreakBefore)) return;
    // Sin párrafo anterior -- es el primero del documento, ya "empieza" en
    // la página 1, un salto ahí no tiene sentido (y no hay dónde insertarlo).
    if (!paragraph.previousElementSibling) return;

    const breakParagraph = doc.createElementNS(WORD_NAMESPACE, 'w:p');
    const run = doc.createElementNS(WORD_NAMESPACE, 'w:r');
    const lineBreak = doc.createElementNS(WORD_NAMESPACE, 'w:br');
    lineBreak.setAttributeNS(WORD_NAMESPACE, 'w:type', 'page');
    run.appendChild(lineBreak);
    breakParagraph.appendChild(run);
    paragraph.parentNode?.insertBefore(breakParagraph, paragraph);
    injectedAny = true;
  });

  if (!injectedAny) return arrayBuffer;

  const newXml = new XMLSerializer().serializeToString(doc);
  zip.file('word/document.xml', newXml);
  return zip.generateAsync({ type: 'arraybuffer' });
}

/**
 * Alineación de párrafo (izquierda/centrado/derecha/justificado) -- pedido
 * explícito 2026-09-09: "que traiga también la disposición del texto... si
 * está centrado... justificación". mammoth.js SÍ lee `w:jc` del .docx
 * (queda en `paragraph.alignment`, confirmado leyendo documents.js/
 * body-reader.js) pero JAMÁS lo usa al convertir a HTML -- es un dato
 * muerto en su conversor por defecto, ni el `styleMap` normal (solo
 * reconoce estilos con NOMBRE, negrita/cursiva/etc., no esta propiedad de
 * párrafo) ni nada estándar de la librería lo expone.
 *
 * Se resuelve con `transformDocument` (recibe el árbol INTERNO de mammoth
 * antes de convertir a HTML, y puede modificarlo): para cada párrafo con
 * alineación, se ENVUELVEN sus hijos originales en un run SINTÉTICO nuevo
 * con un `styleName` marcador -- a propósito NO se toca el `styleId`/
 * `styleName` del PÁRRAFO en sí, que es justo lo que mammoth usa para
 * reconocer encabezados ("Heading 1", etc.) -- pisarlo ahí rompería la
 * detección de encabezados para cualquier título que además esté
 * centrado (caso común). Verificado en vivo que encabezados y listas
 * conviven sin problema con esto. `DOCX_ALIGNMENT_STYLE_MAP` es el
 * `styleMap` complementario que convierte ese run marcador en un
 * `<span class="docx-align-...">` -- `lib/richPaste.ts` lo reconoce y
 * descarta el envoltorio, quedándose solo con la alineación.
 */
type MammothAlignment = 'left' | 'right' | 'center' | 'both';
const ALIGNMENT_TO_CSS: Record<MammothAlignment, string> = {
  left: 'left', right: 'right', center: 'center', both: 'justify',
};

export function markParagraphAlignment(element: any): any {
  if (element && element.type === 'paragraph' && element.alignment) {
    const cssAlign = ALIGNMENT_TO_CSS[element.alignment as MammothAlignment];
    if (cssAlign && Array.isArray(element.children)) {
      element.children = [{
        type: 'run',
        children: element.children,
        styleId: null,
        styleName: `docx align ${cssAlign}`,
        isBold: false, isUnderline: false, isItalic: false, isStrikethrough: false,
        isAllCaps: false, isSmallCaps: false, verticalAlignment: 'baseline',
        font: null, fontSize: null, highlight: null,
      }];
    }
  }
  if (element && Array.isArray(element.children)) {
    element.children.forEach(markParagraphAlignment);
  }
  return element;
}

export const DOCX_ALIGNMENT_STYLE_MAP: string[] = [
  "r[style-name='docx align left'] => span.docx-align-left",
  "r[style-name='docx align center'] => span.docx-align-center",
  "r[style-name='docx align right'] => span.docx-align-right",
  "r[style-name='docx align justify'] => span.docx-align-justify",
  // Subrayado -- bug real reportado 2026-09-11 ("hay textos subrayados que
  // tampoco lo esta trayendo"), confirmado contra un .docx real: el HTML de
  // mammoth NUNCA contenía ningún `<u>`, ni uno. A diferencia de color/
  // tamaño/alineación, esto no es "mammoth nunca lo lee" -- SÍ lo lee
  // (confirmado en style-reader.js, `documentMatchers.underline` existe
  // como matcher de su propio DSL de `styleMap`, identificador `u`) pero su
  // `styleMap` POR DEFECTO no incluye una regla para él (a diferencia de
  // negrita/cursiva, que sí traen regla por defecto) -- alcanza con
  // agregarla acá, sin `transformDocument` ni preprocesado de XML de por
  // medio. `lib/richPaste.ts` ya reconocía `<u>` desde antes (caso
  // 'U' en `styleForTag`) -- nunca hacía falta tocarlo ahí.
  'u => u',
  // Estilo "Título"/"Title" (el que ADR-011 y HEADING_LEVEL_BY_STYLE.title
  // -- ver reportDocxBuilder.js/buildReportDocx.ts -- usan para exportar un
  // bloque con `headingStyle: 'title'`) -- gap real encontrado en la
  // auditoría 2026-09-22 de ida y vuelta export->import: mammoth SÍ lee
  // `w:pStyle` a su modelo interno, pero su `styleMap` por defecto solo
  // reconoce "Heading 1".."Heading 9" (mapeados a h1-h6), nunca el estilo
  // incorporado "Title" -- confirmado en vivo con un .docx generado por
  // este mismo builder: mammoth emitía la advertencia "Unrecognised
  // paragraph style: 'Title'" y el título llegaba como `<p>` PLANO (sin
  // ninguna de las propiedades -negrita/tamaño grande- que trae el estilo
  // con nombre, esas viven en la definición del estilo, no en el run). Se
  // mapea a `h1` (no hay un nivel "title" propio en `HEADING_TAG_TO_ID` de
  // richPaste.ts) -- se pierde la distinción visual title/h1 pero el
  // bloque SÍ vuelve a reconocerse como encabezado real (TOC, negrita,
  // tamaño grande) en vez de caer a texto de cuerpo sin ningún formato.
  "p[style-name='Title'] => h1:fresh",
];

/** Nombre de color de Word (`w:highlight`, `ST_HighlightColor` -- paleta
 * FIJA de 16 nombres, nunca un hex arbitrario) -> hex representativo. Gap
 * real encontrado en la misma auditoría 2026-09-22: `w:highlight` SÍ vive
 * en el modelo interno de mammoth (`run.highlight`, confirmado en
 * node_modules/mammoth/lib/docx/body-reader.js) y su DSL de `styleMap` trae
 * un matcher dedicado (`highlight`, document-matchers.js) -- a diferencia
 * de color/tamaño de fuente (que mammoth ni siquiera LEE, ver el
 * comentario grande más arriba sobre `injectColorCharacterStyles`), este
 * caso no necesita ningún preprocesado de XML: alcanza con una regla de
 * `styleMap` por color, sin tocar `word/styles.xml` para nada. Cada regla
 * emite una clase `beemetry-highlight-RRGGBB` -- `lib/richPaste.ts` ya
 * reconoce el patrón hermano `beemetry-color-RRGGBB` en
 * `styleForDocxSpanMarkers`, extendido acá para el resaltado. */
export const DOCX_HIGHLIGHT_COLOR_HEX: Record<string, string> = {
  yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF',
  blue: '0000FF', red: 'FF0000', darkBlue: '00008B', darkCyan: '008B8B',
  darkGreen: '006400', darkMagenta: '8B008B', darkRed: '8B0000', darkYellow: '808000',
  darkGray: 'A9A9A9', lightGray: 'D3D3D3', black: '000000', white: 'FFFFFF',
};
export const DOCX_HIGHLIGHT_STYLE_MAP: string[] = Object.entries(DOCX_HIGHLIGHT_COLOR_HEX).map(
  // Corchetes, no paréntesis -- `highlight(color='yellow')` es sintaxis
  // inválida para el DSL de mammoth (confirmado en vivo: "Expected
  // whitespace but got open-paren", las 16 reglas se ignoraban en
  // silencio, ninguna anduvo nunca). La forma real está en su propio
  // README: `highlight[color='yellow']`.
  ([name, hex]) => `highlight[color='${name}'] => mark.beemetry-highlight-${hex}`,
);

// ─────────────────────────────────────────────────────────────────────────
// Color de texto y tamaño de fuente (pedido explícito 2026-09-10, probado
// en vivo con un TDR real: "no se estan trayendo bien los colores del
// texto, tamaños").
//
// Tamaño de fuente: mammoth.js SÍ lee `w:sz` a su modelo interno
// (`run.fontSize`, en PUNTOS -- confirmado en node_modules/mammoth/lib/
// docx/body-reader.js, que ya divide el medio-punto de OOXML entre 2) pero
// JAMÁS lo usa al convertir a HTML -- mismo problema que la alineación de
// arriba, mismo remedio: `markRunFontSize` (más abajo) envuelve los hijos
// del RUN (no del párrafo, un párrafo puede mezclar tamaños) en un run
// sintético con un `styleName` marcador.
//
// Color de texto: a diferencia del tamaño, mammoth JAMÁS lee `w:color` en
// absoluto -- ni siquiera a su modelo interno (confirmado leyendo el mismo
// archivo: no hay ninguna referencia a "color" en todo `body-reader.js`).
// `transformDocument` no puede rescatar un dato que mammoth nunca capturó,
// así que acá no alcanza con envolver -- hay que metérselo ANTES, en el
// XML crudo, disfrazado de un mecanismo que mammoth SÍ sabe resolver: un
// estilo de caracter con NOMBRE (el mismo camino que ya usa para "Heading
// 1", `w:rStyle` -> `styles.xml` -> `run.styleName`). Ver
// `injectColorCharacterStyles` más abajo.
// ─────────────────────────────────────────────────────────────────────────

/** RRGGBB de 6 dígitos hex válidos. Colores de tema (`w:val` apuntando a un
 * color del tema en vez de RGB directo) o "auto" quedan fuera a propósito
 * -- resolverlos exigiría además leer `word/theme/theme1.xml`, y el color
 * directo (el que un usuario elige a mano desde el selector) es, por
 * lejos, el caso común que se está reportando. */
const HEX_COLOR_RE = /^[0-9A-Fa-f]{6}$/;

interface DocxTextStyleHints {
  colors: string[];
  fontSizesPt: number[];
}

/** Recorre cada `w:rPr` (propiedades de RUN) del documento por los colores
 * y tamaños de fuente DIRECTOS realmente usados -- se usa tanto para la
 * inyección de estilos de color (necesita saber qué colores sintetizar)
 * como para las reglas de `styleMap` de tamaño de fuente (mammoth exige
 * una regla por cada valor DISTINTO, su DSL no admite comodines/regex en
 * el nombre de estilo -- confirmado leyendo style-reader.js, el matcher de
 * `style-name` solo admite `=` o `^=` literal). Puede capturar de más un
 * `w:rPr` que en realidad describe la marca de párrafo (`w:pPr > w:rPr`,
 * sin texto visible asociado) -- inofensivo, en el peor caso agrega una
 * regla de más que nunca hace match en el HTML real. */
function scanTextStyleHints(doc: Document): DocxTextStyleHints {
  const colors = new Set<string>();
  const fontSizesPt = new Set<number>();
  Array.from(doc.getElementsByTagName('w:rPr')).forEach((rPr) => {
    const colorVal = rPr.getElementsByTagName('w:color')[0]?.getAttribute('w:val')?.trim();
    if (colorVal && HEX_COLOR_RE.test(colorVal)) colors.add(colorVal.toUpperCase());
    const szVal = rPr.getElementsByTagName('w:sz')[0]?.getAttribute('w:val')?.trim();
    if (szVal && /^[0-9]+$/.test(szVal)) {
      const pt = parseInt(szVal, 10) / 2;
      if (pt > 0) fontSizesPt.add(pt);
    }
  });
  return { colors: Array.from(colors), fontSizesPt: Array.from(fontSizesPt) };
}

/**
 * Sintetiza un estilo de caracter (`word/styles.xml`) por cada color de
 * texto directo distinto y lo referencia (`w:rStyle`) desde cada run de
 * `word/document.xml` que tenga ese color -- ver el porqué en el comentario
 * de la sección de arriba. Devuelve las reglas de `styleMap` que traducen
 * cada estilo sintético a un `<span class="beemetry-color-RRGGBB">` real en
 * el HTML de salida (lib/richPaste.ts ya sabe reconocer esa clase).
 *
 * Un run que YA tiene su propio `w:rStyle` (un estilo con nombre real de
 * Word, p.ej. "Strong", que además de negrita puede traer su propio color)
 * se deja intacto -- mammoth solo resuelve UN styleName por run, así que
 * agregarle el nuestro encima le haría perder el estilo real (y con él
 * cualquier negrita/cursiva que ese estilo aporte, ya que
 * `readStyleElement` solo guarda `{type, styleId, name}`, nunca el
 * `w:rPr` del estilo en sí -- confirmado en styles-reader.js). Limitación
 * aceptada: ese run en particular no importa su color directo.
 *
 * Nunca lanza ni modifica `doc`/`zip` a medias si algo falla -- si
 * `word/styles.xml` no existe o no se puede parsear, se omite el color por
 * completo (el resto del import sigue funcionando igual).
 */
async function injectColorCharacterStyles(zip: JSZip, doc: Document, colors: string[]): Promise<string[]> {
  if (colors.length === 0) return [];
  const stylesFile = zip.file('word/styles.xml');
  if (!stylesFile) return [];

  let stylesXml: string;
  try {
    stylesXml = await stylesFile.async('string');
  } catch {
    return [];
  }

  let stylesDoc: Document;
  try {
    stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml');
    if (stylesDoc.getElementsByTagName('parsererror').length > 0) return [];
  } catch {
    return [];
  }
  const stylesRoot = stylesDoc.documentElement;
  if (!stylesRoot || stylesRoot.tagName !== 'w:styles') return [];

  const styleIdFor = (hex: string) => `beemetryClr${hex}`;
  const styleNameFor = (hex: string) => `beemetry color ${hex}`;

  colors.forEach((hex) => {
    const style = stylesDoc.createElementNS(WORD_NAMESPACE, 'w:style');
    style.setAttributeNS(WORD_NAMESPACE, 'w:type', 'character');
    style.setAttributeNS(WORD_NAMESPACE, 'w:styleId', styleIdFor(hex));
    const name = stylesDoc.createElementNS(WORD_NAMESPACE, 'w:name');
    name.setAttributeNS(WORD_NAMESPACE, 'w:val', styleNameFor(hex));
    style.appendChild(name);
    stylesRoot.appendChild(style);
  });

  Array.from(doc.getElementsByTagName('w:r')).forEach((run) => {
    const rPr = Array.from(run.children).find((child) => child.tagName === 'w:rPr');
    if (!rPr || rPr.getElementsByTagName('w:rStyle')[0]) return; // sin rPr, o ya tiene un estilo con nombre -- no se toca
    const colorVal = rPr.getElementsByTagName('w:color')[0]?.getAttribute('w:val')?.trim().toUpperCase();
    if (!colorVal || !HEX_COLOR_RE.test(colorVal)) return;
    const rStyle = doc.createElementNS(WORD_NAMESPACE, 'w:rStyle');
    rStyle.setAttributeNS(WORD_NAMESPACE, 'w:val', styleIdFor(colorVal));
    // `w:rStyle` debe ir PRIMERO dentro de `w:rPr` según el orden que exige
    // el esquema OOXML (CT_RPr) -- mammoth es tolerante al leerlo, pero un
    // .docx re-serializado con el orden correcto es más sano igual.
    rPr.insertBefore(rStyle, rPr.firstChild);
  });

  zip.file('word/styles.xml', new XMLSerializer().serializeToString(stylesDoc));
  return colors.map((hex) => `r[style-name='${styleNameFor(hex)}'] => span.beemetry-color-${hex}`);
}

/** Ver el comentario de la sección de arriba -- mismo patrón que
 * `markParagraphAlignment`, un nivel más abajo (por RUN, no por párrafo:
 * un párrafo puede mezclar tamaños). Envuelve los hijos del run en un run
 * sintético nuevo con un `styleName` marcador, SIN tocar el `styleId`/
 * `styleName` del run original -- evita la misma colisión que se evita a
 * propósito con el color (un run con estilo real de por medio no pierde
 * ese estilo por esto). */
export function markRunFontSize(element: any): any {
  if (element && element.type === 'run' && typeof element.fontSize === 'number' && Array.isArray(element.children)) {
    element.children = [{
      type: 'run',
      children: element.children,
      styleId: null,
      styleName: `beemetry size ${element.fontSize}`,
      isBold: false, isUnderline: false, isItalic: false, isStrikethrough: false,
      isAllCaps: false, isSmallCaps: false, verticalAlignment: 'baseline',
      font: null, fontSize: null, highlight: null,
    }];
  }
  if (element && Array.isArray(element.children)) {
    element.children.forEach(markRunFontSize);
  }
  return element;
}

/**
 * Línea horizontal -- pedido explícito 2026-09-10 ("hay una linea en el
 * documento original, tambien deberiamos de traducirlo a nuestras lineas
 * que tenemos en nuestro bloque de formas"). Word representa una "línea
 * horizontal" bajo un párrafo (típicamente tecleando "---" + Enter, o a
 * mano desde Bordes y sombreado) como un borde de PÁRRAFO (`w:pBdr`, casi
 * siempre solo `w:bottom`) -- mammoth JAMÁS lee `w:pBdr` (sin ninguna
 * referencia en body-reader.js, igual que el color), así que tampoco se
 * puede rescatar vía `transformDocument`: hay que marcarlo en el XML crudo
 * antes de que mammoth lo parsee.
 *
 * Mismo mecanismo que el color (estilo de caracter sintetizado + `w:rStyle`
 * -> `styleMap` -> clase en el HTML), pero un solo valor fijo, no uno por
 * color distinto: se agrega un RUN marcador al FINAL del párrafo que tiene
 * el borde activo (no un párrafo nuevo aparte -- más simple, y la línea de
 * Word igual se dibuja pegada a ESE párrafo). `lib/richPaste.ts` reconoce
 * el `<span class="beemetry-hr">` resultante y lo traduce a un bloque de
 * forma tipo línea (`shapeType: 'line'`) en vez de tratarlo como texto --
 * el caracter marcador en sí (un guión largo, nunca visible) se descarta
 * ahí, no llega a mostrarse.
 */
const HR_STYLE_ID = 'beemetryHrMarker';
const HR_STYLE_NAME = 'beemetry hr marker';
export const HR_STYLE_MAP_RULE = `r[style-name='${HR_STYLE_NAME}'] => span.beemetry-hr`;

function hasActiveHorizontalBorder(paragraph: Element): boolean {
  const pPr = Array.from(paragraph.children).find((child) => child.tagName === 'w:pPr');
  if (!pPr) return false;
  const pBdr = Array.from(pPr.children).find((child) => child.tagName === 'w:pBdr');
  if (!pBdr) return false;
  return Array.from(pBdr.children).some((edge) => {
    if (edge.tagName !== 'w:bottom' && edge.tagName !== 'w:top') return false;
    const val = edge.getAttribute('w:val')?.trim().toLowerCase();
    return !!val && val !== 'none' && val !== 'nil';
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Color del ENCABEZADO de tabla vía estilo de tabla -- bug real reportado
// 2026-09-10 ("no esta trayendo el color de texto en los encabezados de
// las tablas"). `injectColorCharacterStyles` de arriba solo rescata un
// `w:color` DIRECTO por run -- pero cuando el encabezado viene de la
// galería de estilos de tabla de Word (lo más común: seleccionar la tabla
// y elegir un estilo con la fila de encabezado ya coloreada) ningún run
// individual tiene `w:color`; el color vive en el formato CONDICIONAL
// "primera fila" del estilo de TABLA (`w:style[type=table] >
// w:tblStylePr[type=firstRow] > w:rPr > w:color`), algo que
// `scanTextStyleHints` nunca mira porque solo recorre runs de
// `word/document.xml`, nunca definiciones de `word/styles.xml`.
//
// En vez de duplicar el mecanismo de inyección para este caso, esta
// función "materializa" ese color heredado como si fuera un `w:color`
// directo en cada run de la PRIMERA fila de la tabla -- ANTES de que
// corra `scanTextStyleHints` -- así el resto del pipeline ya existente
// (síntesis de estilo de caracter + `w:rStyle` + regla de `styleMap`) lo
// recoge solo, sin ningún camino nuevo. Respeta la misma regla de "nunca
// pisar" que `injectColorCharacterStyles`: un run que ya trae su propio
// `w:rStyle` o `w:color` se deja intacto.
// ─────────────────────────────────────────────────────────────────────────

/** `w:tblLook` decide si el formato condicional "primera fila" del estilo
 * de tabla se aplica a ESTA tabla en particular (una tabla puede usar un
 * estilo con banda de encabezado definida pero tenerla desactivada). Los
 * atributos booleanos (`w:firstRow="1"`) son los que Word 2007 SP2+ escribe
 * y los que manda cuando están presentes; `w:val` (bitmask hex, bit 0x0020
 * = primera fila) es el formato legado de respaldo. Sin `w:tblLook` en
 * absoluto, Word aplica la banda de encabezado por defecto -- se asume
 * habilitada. */
function isFirstRowBandingEnabled(tblPr: Element | undefined): boolean {
  if (!tblPr) return true;
  const tblLook = Array.from(tblPr.children).find((child) => child.tagName === 'w:tblLook');
  if (!tblLook) return true;
  const firstRowAttr = tblLook.getAttribute('w:firstRow');
  if (firstRowAttr != null) return firstRowAttr === '1' || firstRowAttr.toLowerCase() === 'true';
  const valAttr = tblLook.getAttribute('w:val');
  if (valAttr && /^[0-9A-Fa-f]+$/.test(valAttr)) return (parseInt(valAttr, 16) & 0x0020) !== 0;
  return true;
}

/** Busca el color de `w:tblStylePr[type=firstRow]` en el estilo de tabla
 * `styleId`, siguiendo hasta 8 saltos de `w:basedOn` si el estilo propio no
 * lo define directamente (varios estilos de tabla con nombre heredan de un
 * estilo base que sí trae el color) -- tope defensivo contra un ciclo
 * malformado, nunca debería alcanzarse en un .docx real. */
function findTableStyleFirstRowColor(stylesRoot: Element, styleId: string, visited: Set<string> = new Set()): string | undefined {
  if (visited.has(styleId) || visited.size > 8) return undefined;
  visited.add(styleId);
  const styleEl = Array.from(stylesRoot.children).find(
    (child) => child.tagName === 'w:style' && child.getAttribute('w:type') === 'table' && child.getAttribute('w:styleId') === styleId,
  );
  if (!styleEl) return undefined;
  const tblStylePr = Array.from(styleEl.children).find(
    (child) => child.tagName === 'w:tblStylePr' && child.getAttribute('w:type') === 'firstRow',
  );
  const rPr = tblStylePr && Array.from(tblStylePr.children).find((child) => child.tagName === 'w:rPr');
  const colorVal = rPr && Array.from(rPr.children).find((child) => child.tagName === 'w:color')?.getAttribute('w:val')?.trim().toUpperCase();
  if (colorVal && HEX_COLOR_RE.test(colorVal)) return colorVal;
  const basedOn = Array.from(styleEl.children).find((child) => child.tagName === 'w:basedOn')?.getAttribute('w:val');
  return basedOn ? findTableStyleFirstRowColor(stylesRoot, basedOn, visited) : undefined;
}

/** Nunca lanza -- cualquier fallo al leer/parsear `styles.xml` deja `doc`
 * sin tocar (mismo criterio que el resto de este archivo). Solo tablas de
 * NIVEL SUPERIOR cuentan (una tabla anidada no tiene su propia fila de
 * encabezado independiente en este editor). */
async function materializeTableHeaderRunColors(zip: JSZip, doc: Document): Promise<void> {
  const isNestedTable = (tbl: Element): boolean => {
    let ancestor = tbl.parentElement;
    while (ancestor) {
      if (ancestor.tagName === 'w:tbl') return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const tables = Array.from(doc.getElementsByTagName('w:tbl')).filter((tbl) => !isNestedTable(tbl));
  if (tables.length === 0) return;

  const stylesFile = zip.file('word/styles.xml');
  if (!stylesFile) return;
  let stylesXml: string;
  try {
    stylesXml = await stylesFile.async('string');
  } catch {
    return;
  }
  let stylesDoc: Document;
  try {
    stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml');
    if (stylesDoc.getElementsByTagName('parsererror').length > 0) return;
  } catch {
    return;
  }
  const stylesRoot = stylesDoc.documentElement;
  if (!stylesRoot || stylesRoot.tagName !== 'w:styles') return;

  tables.forEach((tbl) => {
    const tblPr = Array.from(tbl.children).find((child) => child.tagName === 'w:tblPr');
    const styleId = tblPr && Array.from(tblPr.children).find((child) => child.tagName === 'w:tblStyle')?.getAttribute('w:val');
    if (!styleId || !isFirstRowBandingEnabled(tblPr)) return;
    const color = findTableStyleFirstRowColor(stylesRoot, styleId);
    if (!color) return;

    const firstRow = Array.from(tbl.children).find((child) => child.tagName === 'w:tr');
    if (!firstRow) return;
    const cells = Array.from(firstRow.children).filter((child) => child.tagName === 'w:tc');
    cells.forEach((tc) => {
      const paragraphs = Array.from(tc.children).filter((child) => child.tagName === 'w:p');
      paragraphs.forEach((p) => {
        Array.from(p.getElementsByTagName('w:r')).forEach((run) => {
          const existingRPr = Array.from(run.children).find((child) => child.tagName === 'w:rPr');
          if (existingRPr && (existingRPr.getElementsByTagName('w:rStyle')[0] || existingRPr.getElementsByTagName('w:color')[0])) {
            return; // ya tiene color/estilo propio -- no se pisa
          }
          const rPr = existingRPr || doc.createElementNS(WORD_NAMESPACE, 'w:rPr');
          if (!existingRPr) run.insertBefore(rPr, run.firstChild);
          const colorEl = doc.createElementNS(WORD_NAMESPACE, 'w:color');
          colorEl.setAttributeNS(WORD_NAMESPACE, 'w:val', color);
          rPr.appendChild(colorEl);
        });
      });
    });
  });
}

/** Sintetiza el estilo de caracter marcador (una sola vez, reutilizado por
 * todos los párrafos con borde) y agrega el run marcador al final de cada
 * párrafo con borde horizontal activo. Devuelve `true` si tocó algo (el
 * caller decide si hace falta re-serializar `document.xml`). Mismas reglas
 * de "nunca romper el import" que `injectColorCharacterStyles`: cualquier
 * fallo al leer/parsear `styles.xml` deja todo sin tocar. */
async function markHorizontalRuleParagraphs(zip: JSZip, doc: Document): Promise<boolean> {
  const bordered = Array.from(doc.getElementsByTagName('w:p')).filter(hasActiveHorizontalBorder);
  if (bordered.length === 0) return false;

  const stylesFile = zip.file('word/styles.xml');
  if (!stylesFile) return false;
  let stylesXml: string;
  try {
    stylesXml = await stylesFile.async('string');
  } catch {
    return false;
  }
  let stylesDoc: Document;
  try {
    stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml');
    if (stylesDoc.getElementsByTagName('parsererror').length > 0) return false;
  } catch {
    return false;
  }
  const stylesRoot = stylesDoc.documentElement;
  if (!stylesRoot || stylesRoot.tagName !== 'w:styles') return false;

  const style = stylesDoc.createElementNS(WORD_NAMESPACE, 'w:style');
  style.setAttributeNS(WORD_NAMESPACE, 'w:type', 'character');
  style.setAttributeNS(WORD_NAMESPACE, 'w:styleId', HR_STYLE_ID);
  const name = stylesDoc.createElementNS(WORD_NAMESPACE, 'w:name');
  name.setAttributeNS(WORD_NAMESPACE, 'w:val', HR_STYLE_NAME);
  style.appendChild(name);
  stylesRoot.appendChild(style);

  bordered.forEach((paragraph) => {
    const run = doc.createElementNS(WORD_NAMESPACE, 'w:r');
    const rPr = doc.createElementNS(WORD_NAMESPACE, 'w:rPr');
    const rStyle = doc.createElementNS(WORD_NAMESPACE, 'w:rStyle');
    rStyle.setAttributeNS(WORD_NAMESPACE, 'w:val', HR_STYLE_ID);
    rPr.appendChild(rStyle);
    run.appendChild(rPr);
    const text = doc.createElementNS(WORD_NAMESPACE, 'w:t');
    text.textContent = '―';
    run.appendChild(text);
    paragraph.appendChild(run);
  });

  zip.file('word/styles.xml', new XMLSerializer().serializeToString(stylesDoc));
  return true;
}

/**
 * Punto de entrada único para color/tamaño de fuente de texto directo y
 * línea horizontal -- se llama DESPUÉS de `expandParagraphPageBreaks`
 * (mismo ArrayBuffer ya nivelado) y ANTES de `mammoth.convertToHtml` (ver
 * App.tsx::handleImportDocx). Nunca lanza: cualquier fallo devuelve el
 * buffer original sin tocar y sin reglas de `styleMap` extra -- mismo
 * criterio de "nunca romper el import" que `expandParagraphPageBreaks`.
 */
export async function enrichDocxTextStyles(arrayBuffer: ArrayBuffer): Promise<{ arrayBuffer: ArrayBuffer; styleMap: string[] }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return { arrayBuffer, styleMap: [] };
  }
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return { arrayBuffer, styleMap: [] };

  let xmlText: string;
  try {
    xmlText = await documentFile.async('string');
  } catch {
    return { arrayBuffer, styleMap: [] };
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return { arrayBuffer, styleMap: [] };
  } catch {
    return { arrayBuffer, styleMap: [] };
  }

  // Materializa el color de encabezado heredado del ESTILO de tabla como
  // si fuera un `w:color` directo -- tiene que correr ANTES de escanear
  // hints para que `scanTextStyleHints`/`injectColorCharacterStyles` lo
  // recojan como un color directo más, sin duplicar el mecanismo.
  try {
    await materializeTableHeaderRunColors(zip, doc);
  } catch {
    // nunca romper el import por esto -- el resto del color/tamaño sigue.
  }

  const hints = scanTextStyleHints(doc);
  const fontSizeStyleMap = hints.fontSizesPt.map((pt) => `r[style-name='beemetry size ${pt}'] => span.beemetry-size-${pt}`);

  let colorStyleMap: string[] = [];
  try {
    colorStyleMap = await injectColorCharacterStyles(zip, doc, hints.colors);
  } catch {
    colorStyleMap = [];
  }

  let hasHrMarkers = false;
  try {
    hasHrMarkers = await markHorizontalRuleParagraphs(zip, doc);
  } catch {
    hasHrMarkers = false;
  }
  const hrStyleMap = hasHrMarkers ? [HR_STYLE_MAP_RULE] : [];

  // El tamaño de fuente no toca el XML crudo en absoluto (viaja por
  // `transformDocument`, ver `markRunFontSize`) -- solo re-serializar/
  // re-zipear si de verdad se inyectó algún color o marcador de línea.
  if (colorStyleMap.length === 0 && !hasHrMarkers) {
    return { arrayBuffer, styleMap: fontSizeStyleMap };
  }
  try {
    zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
    const newArrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    return { arrayBuffer: newArrayBuffer, styleMap: [...fontSizeStyleMap, ...colorStyleMap, ...hrStyleMap] };
  } catch {
    return { arrayBuffer, styleMap: fontSizeStyleMap };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sombreado de celda/encabezado de tabla (`w:shd`) -- pedido explícito
// 2026-09-10 ("los colores en la tabla"). A diferencia del color de texto,
// mammoth NO tiene NINGÚN camino nativo para rescatar esto: `w:shd` es una
// propiedad de CELDA (`w:tcPr`), no de run, y los estilos de caracter que sí
// sabe resolver solo aplican a runs -- confirmado leyendo body-reader.js
// completo (sin ninguna referencia a "shd") y document-to-html.js (las
// celdas de tabla se arman con `Html.freshElement` directo, sin pasar
// nunca por el mecanismo de `styleMap`).
//
// Se extrae en un pase PARALELO, totalmente fuera de mammoth, replicando
// el MISMO algoritmo de colapso de fusiones que mammoth usa internamente
// (`calculateRowSpans` en docx/body-reader.js) para que las coordenadas
// (fila,columna) calculadas acá coincidan EXACTO con las que
// `tableClipboard.ts::parseHtmlClipboardTable` reconstruye del HTML que
// mammoth ya produjo -- el `cellIndex` que mammoth avanza por cada celda de
// una fila (incluidas las continuaciones de fusión vertical que luego
// descarta) cumple el mismo rol que el `Set` `occupied` que ya usa
// `parseHtmlClipboardTable` del lado HTML: ambos "reservan" el lugar de una
// celda fusionada para que la siguiente celda real de esa fila caiga en la
// columna visual correcta.
//
// Cuando la estructura de una tabla no calza con el patrón esperado
// (`w:tbl > w:tblPr?/w:tblGrid?/w:tr*`, `w:tr > w:trPr?/w:tc*`) se OMITE el
// sombreado de ESA tabla puntual (se sigue procesando el resto del
// documento) en vez de arriesgar una correlación incorrecta -- nunca
// asumir, nunca adivinar. Cobertura parcial, no 100%, aceptada a propósito.
// ─────────────────────────────────────────────────────────────────────────

export interface TableCellShading {
  row: number;
  col: number;
  fill: string;
}

interface RawShadingCell {
  colSpan: number;
  vMergeContinue: boolean;
  fill: string | undefined;
}

function readShadingFill(tcPr: Element | undefined): string | undefined {
  if (!tcPr) return undefined;
  const shd = Array.from(tcPr.children).find((child) => child.tagName === 'w:shd');
  const fill = shd?.getAttribute('w:fill')?.trim().toUpperCase();
  return fill && HEX_COLOR_RE.test(fill) ? fill : undefined;
}

/** `null` significa "estructura no reconocida, omitir esta tabla" -- nunca
 * lanza. Devuelve un array vacío (no `null`) para una tabla válida pero sin
 * ningún `w:shd` real (caso más común, sin costo de cómputo extra en el
 * caller). */
function extractTableShading(tbl: Element): TableCellShading[] | null {
  const directChildren = Array.from(tbl.children);
  const hasUnexpectedTableChild = directChildren.some(
    (child) => child.tagName !== 'w:tblPr' && child.tagName !== 'w:tblGrid' && child.tagName !== 'w:tr',
  );
  if (hasUnexpectedTableChild) return null;

  const trEls = directChildren.filter((child) => child.tagName === 'w:tr');
  if (trEls.length === 0) return [];

  const rows: RawShadingCell[][] = [];
  for (const tr of trEls) {
    const trChildren = Array.from(tr.children);
    const hasUnexpectedRowChild = trChildren.some((child) => child.tagName !== 'w:trPr' && child.tagName !== 'w:tc');
    if (hasUnexpectedRowChild) return null;

    const trPr = trChildren.find((child) => child.tagName === 'w:trPr');
    // Fila borrada (control de cambios, 17.13.5.12 del ECMA-376) -- mammoth
    // tampoco emite NADA por ella (readTableRow -> emptyResult()), ni
    // siquiera una fila vacía.
    const isDeleted = !!trPr && Array.from(trPr.children).some((child) => child.tagName === 'w:del');
    if (isDeleted) continue;

    const cells: RawShadingCell[] = trChildren
      .filter((child) => child.tagName === 'w:tc')
      .map((tc) => {
        const tcPr = Array.from(tc.children).find((child) => child.tagName === 'w:tcPr');
        const gridSpanVal = tcPr && Array.from(tcPr.children).find((child) => child.tagName === 'w:gridSpan')?.getAttribute('w:val');
        const colSpan = gridSpanVal && /^[0-9]+$/.test(gridSpanVal) ? parseInt(gridSpanVal, 10) : 1;
        const vMergeEl = tcPr && Array.from(tcPr.children).find((child) => child.tagName === 'w:vMerge');
        let vMergeContinue = false;
        if (vMergeEl) {
          const val = vMergeEl.getAttribute('w:val')?.trim().toLowerCase();
          vMergeContinue = val === 'continue' || !val;
        }
        return { colSpan: Math.max(1, colSpan), vMergeContinue, fill: readShadingFill(tcPr) };
      });
    rows.push(cells);
  }

  // Mismo algoritmo de una sola pasada que `calculateRowSpans` (mammoth):
  // `columns[cellIndex]` rastrea qué celda "posee" cada columna de inicio;
  // una celda de continuación vertical con dueño encontrado incrementa el
  // rowSpan de esa celda y queda descartada (nunca se emite en el HTML de
  // mammoth); cualquier otra celda se convierte en la nueva dueña de su
  // columna de inicio. `cellIndex` avanza por CADA celda (incluidas las
  // descartadas) -- ese avance es lo que hace que las coordenadas
  // resultantes coincidan con las que arma `parseHtmlClipboardTable` del
  // lado HTML (su `Set` `occupied` cumple el mismo rol).
  const columns = new Map<number, boolean>();
  const result: TableCellShading[] = [];
  rows.forEach((row, r) => {
    let cellIndex = 0;
    row.forEach((cell) => {
      const hasOwner = columns.get(cellIndex);
      if (!(cell.vMergeContinue && hasOwner)) {
        columns.set(cellIndex, true);
        if (cell.fill) result.push({ row: r, col: cellIndex, fill: cell.fill });
      }
      cellIndex += cell.colSpan;
    });
  });
  return result;
}

/**
 * Extrae el sombreado de TODAS las tablas del documento, en el MISMO orden
 * en que aparecen (una entrada del array por cada `w:tbl`, `null` si esa
 * tabla en particular se omitió por estructura no reconocida) -- el caller
 * (App.tsx::handleImportDocx) empareja cada entrada con el bloque `table`
 * en la misma posición ORDINAL entre los bloques que produce
 * `parseRichClipboardBlocks` (mammoth preserva el orden del documento, así
 * que la N-ésima tabla del XML es la N-ésima tabla entre los bloques).
 * Nunca lanza -- cualquier fallo al leer/parsear el .docx devuelve un array
 * vacío (ninguna tabla obtiene sombreado, el resto del import sigue igual).
 */
export async function extractDocxTableShading(arrayBuffer: ArrayBuffer): Promise<(TableCellShading[] | null)[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return [];
  }
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return [];

  let xmlText: string;
  try {
    xmlText = await documentFile.async('string');
  } catch {
    return [];
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return [];
  } catch {
    return [];
  }

  // Solo tablas de NIVEL SUPERIOR -- `walkNodeForBlocks` (lib/richPaste.ts)
  // NUNCA camina el contenido de una `<table>` (corta ahí, ver el `return`
  // tras `parseHtmlClipboardTable`), así que una tabla ANIDADA dentro de
  // una celda de otra nunca produce su propio bloque `table`: su HTML
  // termina aplanado como texto plano dentro de esa celda (`textContent`).
  // `getElementsByTagName('w:tbl')` sí devuelve TODOS los descendientes
  // (anidadas incluidas) -- hay que excluirlas acá, o el N-ésimo `w:tbl`
  // de este array dejaría de corresponder al N-ésimo bloque `table` real
  // apenas apareciera una tabla anidada, corriendo mal la correlación para
  // TODAS las tablas siguientes.
  const isNestedTable = (tbl: Element): boolean => {
    let ancestor = tbl.parentElement;
    while (ancestor) {
      if (ancestor.tagName === 'w:tbl') return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  };

  return Array.from(doc.getElementsByTagName('w:tbl'))
    .filter((tbl) => !isNestedTable(tbl))
    .map((tbl) => {
      try {
        return extractTableShading(tbl);
      } catch {
        return null;
      }
    });
}

// ─────────────────────────────────────────────────────────────────────────
// Tamaño de página / orientación / márgenes del .docx de origen -- gap real
// encontrado en la auditoría 2026-09-22 ("importación completa... máxima
// complejidad") comparando contra el import de PDF+OCR (ADR-199 §7, que SÍ
// configura `store.setPaperSize/setOrientation/setPageMargins` desde la
// geometría real de la primera página): el import de .docx nunca tocaba
// esos tres, así que un documento A3 u horizontal siempre aterrizaba en el
// A4 vertical por defecto del editor, con todo el contenido calculado
// (auto-paginado, auto-ajuste de tablas, `fullColumnWidth`) contra un ancho
// de página que no es el real del documento de origen -- el mismo síntoma
// de fondo que ya se corrigió del lado EXPORT (observaciones #1/#4 del
// reporte de Jhon Alvarez, ver reportDocxBuilder.js::fitToFlowBox), ahora
// del lado IMPORT.
// ─────────────────────────────────────────────────────────────────────────

export interface DocxPageSetup {
  paperSize: 'A4' | 'A3';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
}

// 1 twip = 1/20 pt = 1/1440 in; a 96dpi, 1px = 1/96 in = 15 twips exactos
// (mismo factor que PX_TO_TWIP en el pipeline export, reportDocxBuilder.js).
const TWIP_TO_PX = 1 / 15;

/** Tamaño de hoja EFECTIVO (siempre en orientación PORTRAIT, como pide
 * `setPaperSize`) más cercano al par w/h real del `w:pgSz` -- el editor
 * solo admite A4/A3, así que cualquier otro tamaño real (Carta/Legal/
 * personalizado, frecuentes en documentos que no son de Word en español)
 * se aproxima al más cercano por su lado MÁS LARGO, sin importar si el
 * documento está en vertical u horizontal. */
function classifyPaperSize(widthTwip: number, heightTwip: number): 'A4' | 'A3' {
  const longer = Math.max(widthTwip, heightTwip);
  const A4_LONGER_TWIP = 16838; // 297mm
  const A3_LONGER_TWIP = 23811; // 420mm
  return Math.abs(longer - A3_LONGER_TWIP) < Math.abs(longer - A4_LONGER_TWIP) ? 'A3' : 'A4';
}

/**
 * Primer `w:sectPr` del documento (ya sea el que cierra `w:body` -- la
 * sección "final"/por defecto que cubre toda la primera parte del texto si
 * no hay saltos de sección, el caso ampliamente más común -- o el primero
 * que aparezca anidado en un `w:pPr` por un salto de sección intermedio):
 * representa el papel/márgenes con el que arranca visualmente el
 * documento, que es lo único que este editor puede reflejar (un solo
 * `paperSize`/`orientation` GLOBAL por documento, ver `doc.meta` en
 * useEditorStore.ts -- no hay soporte de múltiples secciones con distinto
 * papel dentro de un mismo import). `null` si el .docx no tiene NINGÚN
 * `w:sectPr` (no debería pasar en un .docx válido, pero mejor no asumir) o
 * si falla la lectura del .docx -- nunca lanza, mismo criterio que el resto
 * de este archivo: la falta de esto no debe tumbar el resto del import.
 */
export async function extractDocxPageSetup(arrayBuffer: ArrayBuffer): Promise<DocxPageSetup | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return null;
  }
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return null;

  let xmlText: string;
  try {
    xmlText = await documentFile.async('string');
  } catch {
    return null;
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
  } catch {
    return null;
  }

  const sectPr = doc.getElementsByTagName('w:sectPr')[0];
  if (!sectPr) return null;

  const pgSz = Array.from(sectPr.children).find((child) => child.tagName === 'w:pgSz');
  const rawWidthTwip = pgSz ? parseInt(pgSz.getAttribute('w:w') || '', 10) : NaN;
  const rawHeightTwip = pgSz ? parseInt(pgSz.getAttribute('w:h') || '', 10) : NaN;
  if (!Number.isFinite(rawWidthTwip) || !Number.isFinite(rawHeightTwip) || rawWidthTwip <= 0 || rawHeightTwip <= 0) {
    return null;
  }
  // La FORMA real de la hoja (w vs h de `w:pgSz`) manda sobre el atributo
  // `w:orient` -- por spec OOXML ese atributo es solo descriptivo, nunca
  // autoritativo para el tamaño renderizado, y en la práctica puede venir
  // DESINCRONIZADO del par w/h real: confirmado generando un .docx de
  // prueba con la propia librería `docx` (pasando w=16838/h=11906 --
  // horizontal -- sin fijar `orientation: LANDSCAPE` explícito) y
  // encontrando `w:orient="portrait"` escrito igual, con w>h. Un visor que
  // confiara en el atributo ahí terminaría con una hoja marcada "vertical"
  // pero más ancha que alta -- exactamente el mismo tipo de descuadre que
  // ya se corrigió del lado export (ver comentario de `fitToFlowBox` en
  // reportDocxBuilder.js). `w:orient` solo desempata el caso borde w===h
  // (cuadrado, donde la comparación no dice nada).
  const orientAttr = pgSz?.getAttribute('w:orient')?.trim().toLowerCase();
  const orientation: 'portrait' | 'landscape' = rawWidthTwip === rawHeightTwip
    ? (orientAttr === 'landscape' ? 'landscape' : 'portrait')
    : (rawWidthTwip > rawHeightTwip ? 'landscape' : 'portrait');
  // `classifyPaperSize` espera el par en orientación PORTRAIT (lado más
  // largo = alto) -- si el `w:pgSz` real ya viene horizontal (w>h), se
  // deshace ese intercambio antes de clasificar.
  const portraitWidthTwip = orientation === 'landscape' ? rawHeightTwip : rawWidthTwip;
  const portraitHeightTwip = orientation === 'landscape' ? rawWidthTwip : rawHeightTwip;
  const paperSize = classifyPaperSize(portraitWidthTwip, portraitHeightTwip);

  const pgMar = Array.from(sectPr.children).find((child) => child.tagName === 'w:pgMar');
  const marginTwip = (attr: string, fallbackTwip: number) => {
    const raw = pgMar?.getAttribute(attr);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackTwip;
  };
  // 1440 twip = 1 pulgada -- mismo margen "Normal" por defecto de Word que
  // ya usa este editor para un documento nuevo, si el .docx no trae `w:pgMar`.
  const margins = {
    top: Math.round(marginTwip('w:top', 1440) * TWIP_TO_PX),
    right: Math.round(marginTwip('w:right', 1440) * TWIP_TO_PX),
    bottom: Math.round(marginTwip('w:bottom', 1440) * TWIP_TO_PX),
    left: Math.round(marginTwip('w:left', 1440) * TWIP_TO_PX),
  };

  return { paperSize, orientation, margins };
}
