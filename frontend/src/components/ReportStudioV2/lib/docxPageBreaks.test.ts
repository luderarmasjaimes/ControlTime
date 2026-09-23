import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import {
  expandParagraphPageBreaks, markParagraphAlignment, DOCX_ALIGNMENT_STYLE_MAP,
  markRunFontSize, enrichDocxTextStyles, extractDocxTableShading,
} from './docxPageBreaks';
import { parseHtmlClipboardTable } from './tableClipboard';

/**
 * Cubre `expandParagraphPageBreaks` -- pedido explícito 2026-09-09
 * ("¿esto también aplica a Google Docs?"): Google Docs (y Word) pueden
 * guardar un salto de página manual de DOS formas en el .docx -- un
 * carácter `w:br type="page"` dentro del texto, O la propiedad de párrafo
 * `w:pageBreakBefore` ("agregar salto de página antes", disponible en
 * Google Docs desde 2021) -- y mammoth.js solo entiende la primera. Estos
 * tests arman un .docx MÍNIMO a mano (mismo esqueleto real que produce
 * Word/Docs/la librería `docx`) para verificar que la segunda forma queda
 * convertida a la primera antes de llegarle a mammoth.
 */

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeMinimalDocxXml(bodyInnerXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${WORD_NS}"><w:body>${bodyInnerXml}</w:body></w:document>`;
}

async function makeDocxBuffer(bodyInnerXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeMinimalDocxXml(bodyInnerXml));
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function readDocumentXml(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  return zip.file('word/document.xml')!.async('string');
}

async function readStylesXml(arrayBuffer: ArrayBuffer): Promise<string | null> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const file = zip.file('word/styles.xml');
  return file ? file.async('string') : null;
}

/** `Packer.toBuffer` (paquete `docx`) devuelve un `Buffer` de Node -- las
 * funciones de este archivo trabajan en `ArrayBuffer` (el tipo que de
 * verdad recibe App.tsx::handleImportDocx vía `file.arrayBuffer()` en el
 * navegador real), así que hay que recortar el `ArrayBuffer` subyacente al
 * rango real del Buffer (que puede ser una VISTA parcial de uno más
 * grande, no necesariamente el buffer completo). */
async function docBufferToArrayBuffer(doc: Document): Promise<ArrayBuffer> {
  const buffer = await Packer.toBuffer(doc);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function makeDocxBufferWithStyles(bodyInnerXml: string, includeStyles = true): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeMinimalDocxXml(bodyInnerXml));
  if (includeStyles) {
    zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:styles xmlns:w="${WORD_NS}"></w:styles>`);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

/** Igual que `makeDocxBufferWithStyles`, pero con contenido de
 * `word/styles.xml` a medida (para probar `w:style[type=table]` con
 * `w:tblStylePr`, que `makeDocxBufferWithStyles` no permite inyectar). */
async function makeDocxBufferWithCustomStyles(bodyInnerXml: string, stylesInnerXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeMinimalDocxXml(bodyInnerXml));
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${WORD_NS}">${stylesInnerXml}</w:styles>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('expandParagraphPageBreaks', () => {
  it('inserta un párrafo con salto manual ANTES de un párrafo con w:pageBreakBefore', async () => {
    const body =
      '<w:p><w:r><w:t>Capitulo 1</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Capitulo 2</w:t></w:r></w:p>';
    const input = await makeDocxBuffer(body);
    const output = await expandParagraphPageBreaks(input);
    const xml = await readDocumentXml(output);
    expect(xml).toContain('w:type="page"');
    // El salto insertado debe quedar ANTES de "Capitulo 2".
    expect(xml.indexOf('w:type="page"')).toBeLessThan(xml.indexOf('Capitulo 2'));
    // El párrafo original con pageBreakBefore se conserva intacto.
    expect(xml).toContain('w:pageBreakBefore');
  });

  it('un documento SIN w:pageBreakBefore no se modifica en absoluto', async () => {
    const body = '<w:p><w:r><w:t>Solo un parrafo normal</w:t></w:r></w:p>';
    const input = await makeDocxBuffer(body);
    const output = await expandParagraphPageBreaks(input);
    expect(output).toBe(input); // mismo buffer, sin re-zipear nada
  });

  it('w:pageBreakBefore en el PRIMER párrafo del documento no inserta ningún salto (ya empieza en la página 1)', async () => {
    const body =
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Primero</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Segundo</w:t></w:r></w:p>';
    const input = await makeDocxBuffer(body);
    const output = await expandParagraphPageBreaks(input);
    const xml = await readDocumentXml(output);
    expect(xml).not.toContain('w:type="page"');
  });

  it('varios párrafos con w:pageBreakBefore -- uno insertado por cada uno', async () => {
    const body =
      '<w:p><w:r><w:t>uno</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>dos</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>tres</w:t></w:r></w:p>';
    const input = await makeDocxBuffer(body);
    const output = await expandParagraphPageBreaks(input);
    const xml = await readDocumentXml(output);
    expect(countOccurrences(xml, 'w:type="page"')).toBe(2);
  });

  it('un archivo que no es un .docx válido (zip corrupto/sin word/document.xml) devuelve el buffer original sin lanzar', async () => {
    const notADocx = new TextEncoder().encode('esto no es un zip').buffer;
    const output = await expandParagraphPageBreaks(notADocx);
    expect(output).toBe(notADocx);
  });

  // Bug real reportado 2026-09-09: un documento importado desde Google Docs
  // hacía que CADA párrafo (incluido cada ítem de una lista con viñetas)
  // apareciera como su propio bloque de texto separado en el lienzo. Causa:
  // el exportador de Google Docs escribe `<w:pageBreakBefore w:val="0"/>`
  // EXPLÍCITO en todos los párrafos (no solo en los que de verdad tienen el
  // salto activado) -- por spec OOXML, `w:val="0"` es FALSE, pero el código
  // solo comprobaba si la ETIQUETA existía, sin mirar su valor.
  describe('w:val explícito en w:pageBreakBefore (el bug real de Google Docs)', () => {
    it('w:val="0" NO es un salto activado -- no debe insertar nada (esta es la causa real del bug reportado)', async () => {
      const body =
        '<w:p><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr><w:r><w:t>uno</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr><w:r><w:t>dos</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr><w:r><w:t>tres</w:t></w:r></w:p>';
      const input = await makeDocxBuffer(body);
      const output = await expandParagraphPageBreaks(input);
      expect(output).toBe(input); // ningún párrafo tiene el salto REALMENTE activado -- sin cambios
    });

    it('w:val="false" y w:val="off" tampoco activan el salto', async () => {
      const body =
        '<w:p><w:r><w:t>uno</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="false"/></w:pPr><w:r><w:t>dos</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="off"/></w:pPr><w:r><w:t>tres</w:t></w:r></w:p>';
      const input = await makeDocxBuffer(body);
      const output = await expandParagraphPageBreaks(input);
      expect(output).toBe(input);
    });

    it('w:val="1" y w:val="true" SÍ activan el salto, igual que la etiqueta sin atributo', async () => {
      const body =
        '<w:p><w:r><w:t>uno</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="1"/></w:pPr><w:r><w:t>dos</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="true"/></w:pPr><w:r><w:t>tres</w:t></w:r></w:p>';
      const input = await makeDocxBuffer(body);
      const output = await expandParagraphPageBreaks(input);
      const xml = await readDocumentXml(output);
      expect(countOccurrences(xml, 'w:type="page"')).toBe(2);
    });

    it('una mezcla realista -- la mayoría en w:val="0" (Google Docs) y uno solo REALMENTE activado -- inserta un único salto', async () => {
      const body =
        '<w:p><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr><w:r><w:t>Un catalogo poco interesante.</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr><w:r><w:t>Falta de contenido exclusivo.</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr><w:r><w:t>Procesos no personalizados.</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Capitulo nuevo de verdad.</w:t></w:r></w:p>';
      const input = await makeDocxBuffer(body);
      const output = await expandParagraphPageBreaks(input);
      const xml = await readDocumentXml(output);
      expect(countOccurrences(xml, 'w:type="page"')).toBe(1);
      expect(xml.indexOf('w:type="page"')).toBeLessThan(xml.indexOf('Capitulo nuevo de verdad'));
    });
  });
});

/**
 * Cubre `markParagraphAlignment` + `DOCX_ALIGNMENT_STYLE_MAP` -- pedido
 * explícito 2026-09-09 ("que traiga también la disposición del texto...
 * si está centrado... justificación"). mammoth.js SÍ lee la alineación del
 * .docx (`w:jc`) pero nunca la traduce a HTML por su cuenta -- estos tests
 * usan mammoth DE VERDAD (no un mock) sobre un .docx armado con la
 * librería `docx`, para probar el `transformDocument`/`styleMap` reales
 * tal como los usa App.tsx::handleImportDocx.
 */
describe('markParagraphAlignment + DOCX_ALIGNMENT_STYLE_MAP (mammoth real)', () => {
  async function convertWithAlignment(doc: Document): Promise<string> {
    const buffer = await Packer.toBuffer(doc);
    const result = await mammoth.convertToHtml({ buffer }, {
      transformDocument: markParagraphAlignment,
      styleMap: DOCX_ALIGNMENT_STYLE_MAP,
    });
    return result.value;
  }

  it('un parrafo centrado queda envuelto en <span class="docx-align-center">', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('Titulo centrado')] }),
    ] }] });
    const html = await convertWithAlignment(doc);
    expect(html).toContain('<span class="docx-align-center">Titulo centrado</span>');
  });

  it('reconoce las 4 alineaciones (izquierda/centro/derecha/justificado)', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun('A')] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('B')] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('C')] }),
      new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun('D')] }),
    ] }] });
    const html = await convertWithAlignment(doc);
    expect(html).toContain('docx-align-left">A<');
    expect(html).toContain('docx-align-center">B<');
    expect(html).toContain('docx-align-right">C<');
    expect(html).toContain('docx-align-justify">D<');
  });

  it('un parrafo SIN alineacion explicita no se envuelve en ningun span', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun('Parrafo normal')] }),
    ] }] });
    const html = await convertWithAlignment(doc);
    expect(html).not.toContain('docx-align');
    expect(html).toContain('Parrafo normal');
  });

  it('un encabezado centrado SIGUE reconociéndose como encabezado (<h1>) -- no rompe la detección de estilos con nombre', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ text: 'Encabezado Centrado', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
    ] }] });
    const html = await convertWithAlignment(doc);
    expect(html).toContain('<h1>');
    expect(html).toContain('docx-align-center');
    expect(html).toContain('Encabezado Centrado');
  });

  it('una lista con viñetas convive sin problema con parrafos alineados alrededor', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('Titulo')] }),
      new Paragraph({ text: 'Item uno', bullet: { level: 0 } }),
      new Paragraph({ text: 'Item dos', bullet: { level: 0 } }),
    ] }] });
    const html = await convertWithAlignment(doc);
    expect(html).toContain('<ul><li>Item uno</li><li>Item dos</li></ul>');
    expect(html).toContain('docx-align-center');
  });

  it('negrita/formato de caracter dentro de un parrafo alineado se conserva', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'en negrita', bold: true })],
      }),
    ] }] });
    const html = await convertWithAlignment(doc);
    expect(html).toContain('<span class="docx-align-center"><strong>en negrita</strong></span>');
  });
});

/**
 * Cubre `enrichDocxTextStyles` (nivel XML crudo) -- pedido explícito
 * 2026-09-10 ("no se estan trayendo bien los colores del texto"). mammoth
 * JAMÁS lee `w:color` a su modelo interno (ni siquiera lo intenta), así
 * que hay que inyectar un estilo de caracter sintético y referenciarlo
 * ANTES de que mammoth parsee el documento -- estos tests verifican esa
 * inyección directamente sobre el XML resultante, sin pasar por mammoth
 * (el round-trip completo vía mammoth real está más abajo).
 */
describe('enrichDocxTextStyles -- inyección de estilos de color (nivel XML)', () => {
  it('sintetiza un w:style de caracter por cada color distinto y lo referencia desde el run', async () => {
    const body = '<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>Rojo</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);

    const stylesXml = await readStylesXml(arrayBuffer);
    expect(stylesXml).toContain('w:styleId="beemetryClrFF0000"');
    expect(stylesXml).toContain('w:val="beemetry color FF0000"');

    const documentXml = await readDocumentXml(arrayBuffer);
    expect(documentXml).toContain('w:rStyle w:val="beemetryClrFF0000"');

    expect(styleMap).toContain("r[style-name='beemetry color FF0000'] => span.beemetry-color-FF0000");
  });

  it('dos runs con el MISMO color comparten un solo w:style sintetizado (no uno por run)', async () => {
    const body =
      '<w:p><w:r><w:rPr><w:color w:val="00FF00"/></w:rPr><w:t>Uno</w:t></w:r>' +
      '<w:r><w:rPr><w:color w:val="00FF00"/></w:rPr><w:t>Dos</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);

    const stylesXml = await readStylesXml(arrayBuffer);
    expect(countOccurrences(stylesXml || '', 'w:styleId="beemetryClr00FF00"')).toBe(1);
    expect(styleMap.filter((rule) => rule.includes('00FF00'))).toHaveLength(1);
  });

  it('un run que YA tiene un w:rStyle (estilo con nombre real) no se toca -- no pierde ese estilo', async () => {
    const body = '<w:p><w:r><w:rPr><w:rStyle w:val="Strong"/><w:color w:val="0000FF"/></w:rPr><w:t>Fuerte y azul</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const { arrayBuffer } = await enrichDocxTextStyles(input);

    const documentXml = await readDocumentXml(arrayBuffer);
    // Sigue habiendo exactamente UN w:rStyle (el original, "Strong") -- no se agregó uno segundo.
    expect(countOccurrences(documentXml, '<w:rStyle')).toBe(1);
    expect(documentXml).toContain('w:rStyle w:val="Strong"');
  });

  it('sin word/styles.xml en el .docx, se omite el color por completo (sin lanzar)', async () => {
    const body = '<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>Rojo</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body, false);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);

    expect(styleMap.filter((rule) => rule.includes('color'))).toHaveLength(0);
    const documentXml = await readDocumentXml(arrayBuffer);
    expect(documentXml).not.toContain('w:rStyle');
  });

  it('colores de tema/auto (no RRGGBB de 6 dígitos) se ignoran', async () => {
    const body = '<w:p><w:r><w:rPr><w:color w:val="auto"/></w:rPr><w:t>Auto</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const { styleMap } = await enrichDocxTextStyles(input);
    expect(styleMap).toHaveLength(0);
  });

  it('genera una regla de styleMap por cada tamaño de fuente distinto (w:sz, en puntos)', async () => {
    const body =
      '<w:p><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>Catorce puntos</w:t></w:r>' +
      '<w:r><w:rPr><w:sz w:val="48"/></w:rPr><w:t>Veinticuatro puntos</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const { styleMap } = await enrichDocxTextStyles(input);
    expect(styleMap).toContain("r[style-name='beemetry size 14'] => span.beemetry-size-14");
    expect(styleMap).toContain("r[style-name='beemetry size 24'] => span.beemetry-size-24");
  });

  it('un .docx que no es un zip válido devuelve el buffer original sin lanzar', async () => {
    const notADocx = new TextEncoder().encode('no es un zip').buffer;
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(notADocx);
    expect(arrayBuffer).toBe(notADocx);
    expect(styleMap).toHaveLength(0);
  });
});

/** Pipeline COMPLETO (enrichDocxTextStyles + markRunFontSize + mammoth
 * real) tal como lo usa App.tsx::handleImportDocx -- a nivel de módulo
 * porque más de un `describe` de este archivo lo necesita (color/tamaño de
 * runs directos, y color de encabezado vía estilo de tabla más abajo). */
async function importDocxBuffer(rawBuffer: ArrayBuffer): Promise<string> {
  const { arrayBuffer, styleMap } = await enrichDocxTextStyles(rawBuffer);
  // mammoth en Node (este test) solo entiende `{buffer}` -- `{arrayBuffer}`
  // es exclusivo de su build de navegador, que es la que de verdad usa
  // App.tsx::handleImportDocx en el editor real.
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(arrayBuffer) }, {
    transformDocument: (element: any) => markRunFontSize(markParagraphAlignment(element)),
    styleMap: [...DOCX_ALIGNMENT_STYLE_MAP, ...styleMap],
  });
  return result.value;
}

/**
 * Cubre el pipeline COMPLETO (enrichDocxTextStyles + markRunFontSize +
 * mammoth real) tal como lo usa App.tsx::handleImportDocx -- verifica que
 * el color/tamaño de fuente realmente lleguen al HTML final como las
 * clases que lib/richPaste.ts sabe reconocer.
 */
describe('color + tamaño de fuente de principio a fin (mammoth real)', () => {
  it('un run con color directo produce un span.beemetry-color-RRGGBB en el HTML', async () => {
    const body = '<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>Rojo</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const html = await importDocxBuffer(input);
    expect(html).toContain('<span class="beemetry-color-FF0000">Rojo</span>');
  });

  it('un run con tamaño de fuente directo produce un span.beemetry-size-N en el HTML', async () => {
    const body = '<w:p><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>Grande</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const html = await importDocxBuffer(input);
    expect(html).toContain('<span class="beemetry-size-14">Grande</span>');
  });

  it('un run con color Y tamaño a la vez trae ambos, anidados', async () => {
    const body = '<w:p><w:r><w:rPr><w:color w:val="0000FF"/><w:sz w:val="36"/></w:rPr><w:t>Azul y grande</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const html = await importDocxBuffer(input);
    expect(html).toContain('class="beemetry-color-0000FF"');
    expect(html).toContain('class="beemetry-size-18"');
    expect(html).toContain('Azul y grande');
  });

  it('negrita real (bold) sobrevive junto con el color -- via la libreria docx real', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'Rojo y en negrita', bold: true, color: 'FF0000' })] }),
    ] }] });
    const rawBuffer = await docBufferToArrayBuffer(doc);
    const html = await importDocxBuffer(rawBuffer);
    expect(html).toContain('beemetry-color-FF0000');
    expect(html).toContain('<strong>');
    expect(html).toContain('Rojo y en negrita');
  });

  it('un run sin color ni tamaño explícitos no trae ningún marcador beemetry-*', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun('Parrafo normal, sin nada especial')] }),
    ] }] });
    const rawBuffer = await docBufferToArrayBuffer(doc);
    const html = await importDocxBuffer(rawBuffer);
    expect(html).not.toContain('beemetry-color');
    expect(html).not.toContain('beemetry-size');
    expect(html).toContain('Parrafo normal, sin nada especial');
  });

  /**
   * Bug real reportado 2026-09-11 ("hay textos subrayados que tampoco lo
   * esta trayendo"), confirmado contra un .docx real: el HTML de mammoth
   * nunca contenía ningún `<u>`. A diferencia de color/tamaño/alineación,
   * mammoth SÍ sabe leer `w:u` -- solo le faltaba la regla de `styleMap`
   * (`'u => u'`, agregada a `DOCX_ALIGNMENT_STYLE_MAP`) para emitirlo.
   */
  it('un run subrayado (w:u) produce un <u> real en el HTML', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'Subrayado', underline: {} })] }),
    ] }] });
    const rawBuffer = await docBufferToArrayBuffer(doc);
    const html = await importDocxBuffer(rawBuffer);
    expect(html).toContain('<u>Subrayado</u>');
  });
});

/**
 * Bug real reportado en vivo 2026-09-10 ("no esta trayendo el color de
 * texto en los encabezados de las tablas"): cuando el color del encabezado
 * viene del ESTILO de tabla (`w:tblStylePr[type=firstRow]`, la vía típica
 * al aplicar un estilo de la galería de Word) en vez de un `w:color`
 * directo por run, `injectColorCharacterStyles` nunca lo veía -- solo mira
 * runs de `document.xml`. `materializeTableHeaderRunColors` lo resuelve
 * ANTES, escribiendo el color heredado como si fuera directo.
 */
describe('enrichDocxTextStyles -- color de encabezado de tabla vía estilo de tabla (w:tblStylePr firstRow)', () => {
  const tableStylesXml =
    '<w:style w:type="table" w:styleId="TablaColor1">' +
    '<w:name w:val="Tabla con color 1"/>' +
    '<w:tblStylePr w:type="firstRow"><w:rPr><w:color w:val="FFFFFF"/></w:rPr></w:tblStylePr>' +
    '</w:style>';

  const tableBody = (tblPrExtra = '') =>
    '<w:tbl>' +
    `<w:tblPr><w:tblStyle w:val="TablaColor1"/>${tblPrExtra}</w:tblPr>` +
    '<w:tr><w:tc><w:p><w:r><w:t>Instrumento</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>Ubicacion</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>GB-InSAR</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>Muro</w:t></w:r></w:p></w:tc></w:tr>' +
    '</w:tbl>';

  it('materializa el color de w:tblStylePr[firstRow] como w:color directo en los runs de la PRIMERA fila', async () => {
    const input = await makeDocxBufferWithCustomStyles(tableBody(), tableStylesXml);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);

    const documentXml = await readDocumentXml(arrayBuffer);
    // Las dos celdas de la primera fila (Instrumento/Ubicacion) obtienen el color.
    expect(countOccurrences(documentXml, 'w:rStyle w:val="beemetryClrFFFFFF"')).toBe(2);
    expect(styleMap).toContain("r[style-name='beemetry color FFFFFF'] => span.beemetry-color-FFFFFF");
  });

  it('round-trip completo con mammoth real: el encabezado trae el span de color, la fila de datos NO', async () => {
    const input = await makeDocxBufferWithCustomStyles(tableBody(), tableStylesXml);
    const html = await importDocxBuffer(input);
    expect(html).toContain('<span class="beemetry-color-FFFFFF">Instrumento</span>');
    expect(html).toContain('<span class="beemetry-color-FFFFFF">Ubicacion</span>');
    expect(html).not.toContain('<span class="beemetry-color-FFFFFF">GB-InSAR</span>');
  });

  it('w:tblLook w:firstRow="0" desactiva la banda de encabezado -- no se materializa ningún color', async () => {
    const input = await makeDocxBufferWithCustomStyles(
      tableBody('<w:tblLook w:val="0000" w:firstRow="0"/>'),
      tableStylesXml,
    );
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);
    expect(styleMap.filter((rule) => rule.includes('FFFFFF'))).toHaveLength(0);
    const documentXml = await readDocumentXml(arrayBuffer);
    expect(documentXml).not.toContain('w:rStyle');
  });

  it('un run de la primera fila con SU PROPIO w:color directo no se pisa con el de la tabla', async () => {
    const body =
      '<w:tbl>' +
      '<w:tblPr><w:tblStyle w:val="TablaColor1"/></w:tblPr>' +
      '<w:tr><w:tc><w:p><w:r><w:rPr><w:color w:val="000000"/></w:rPr><w:t>Instrumento</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>';
    const input = await makeDocxBufferWithCustomStyles(body, tableStylesXml);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);
    const documentXml = await readDocumentXml(arrayBuffer);
    // Conserva SU color propio (negro), no el blanco de la tabla.
    expect(countOccurrences(documentXml, 'w:rStyle w:val="beemetryClr000000"')).toBe(1);
    expect(documentXml).not.toContain('beemetryClrFFFFFF');
    expect(styleMap.some((rule) => rule.includes('FFFFFF'))).toBe(false);
  });

  it('una tabla sin w:tblStyle (sin estilo con nombre aplicado) no rompe nada, sin color agregado', async () => {
    const body =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Sin estilo</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const input = await makeDocxBufferWithCustomStyles(body, tableStylesXml);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);
    expect(styleMap).toHaveLength(0);
    const documentXml = await readDocumentXml(arrayBuffer);
    expect(documentXml).not.toContain('w:rStyle');
  });
});

/**
 * Cubre la línea horizontal (`w:pBdr`) -- pedido explícito 2026-09-10 ("hay
 * una linea en el documento original, tambien deberiamos de traducirlo a
 * nuestras lineas"). mammoth JAMÁS lee `w:pBdr` (ni siquiera a su modelo
 * interno), así que necesita el mismo mecanismo de marcador vía estilo de
 * caracter sintetizado que el color -- estos tests lo verifican a nivel de
 * XML crudo y de punta a punta con mammoth real.
 */
describe('markHorizontalRuleParagraphs / enrichDocxTextStyles -- línea horizontal (w:pBdr)', () => {
  const bodyWithBottomBorder =
    '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr>' +
    '<w:r><w:t>Titulo con linea debajo</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Parrafo normal despues</w:t></w:r></w:p>';

  it('agrega el run marcador al final del párrafo con borde inferior activo', async () => {
    const input = await makeDocxBufferWithStyles(bodyWithBottomBorder);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);

    const documentXml = await readDocumentXml(arrayBuffer);
    expect(documentXml).toContain('w:rStyle w:val="beemetryHrMarker"');
    const stylesXml = await readStylesXml(arrayBuffer);
    expect(stylesXml).toContain('w:styleId="beemetryHrMarker"');
    expect(styleMap).toContain("r[style-name='beemetry hr marker'] => span.beemetry-hr");
  });

  it('w:val="none" o "nil" NO cuenta como borde activo -- no agrega ningún marcador', async () => {
    const body =
      '<w:p><w:pPr><w:pBdr><w:bottom w:val="none"/></w:pBdr></w:pPr><w:r><w:t>Sin linea</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pBdr><w:bottom w:val="nil"/></w:pBdr></w:pPr><w:r><w:t>Tampoco</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);
    expect(styleMap.filter((rule) => rule.includes('beemetry-hr'))).toHaveLength(0);
    const documentXml = await readDocumentXml(arrayBuffer);
    expect(documentXml).not.toContain('beemetryHrMarker');
  });

  it('un párrafo SIN w:pBdr no se toca', async () => {
    const input = await makeDocxBufferWithStyles('<w:p><w:r><w:t>Normal</w:t></w:r></w:p>');
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);
    expect(styleMap.filter((rule) => rule.includes('beemetry-hr'))).toHaveLength(0);
    expect(arrayBuffer).toBe(input);
  });

  it('varios párrafos con borde comparten UN solo estilo sintetizado (no uno por párrafo)', async () => {
    const body =
      '<w:p><w:pPr><w:pBdr><w:bottom w:val="single"/></w:pBdr></w:pPr><w:r><w:t>Uno</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pBdr><w:top w:val="single"/></w:pBdr></w:pPr><w:r><w:t>Dos</w:t></w:r></w:p>';
    const input = await makeDocxBufferWithStyles(body);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);
    const stylesXml = await readStylesXml(arrayBuffer);
    expect(countOccurrences(stylesXml || '', 'w:styleId="beemetryHrMarker"')).toBe(1);
    expect(styleMap.filter((rule) => rule.includes('beemetry-hr'))).toHaveLength(1);
    const documentXml = await readDocumentXml(arrayBuffer);
    expect(countOccurrences(documentXml, 'beemetryHrMarker')).toBe(2); // una referencia por párrafo
  });

  it('de punta a punta con mammoth real: produce <span class="beemetry-hr"> en el HTML', async () => {
    const input = await makeDocxBufferWithStyles(bodyWithBottomBorder);
    const { arrayBuffer, styleMap } = await enrichDocxTextStyles(input);
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(arrayBuffer) }, {
      transformDocument: (element: any) => markRunFontSize(markParagraphAlignment(element)),
      styleMap: [...DOCX_ALIGNMENT_STYLE_MAP, ...styleMap],
    });
    expect(result.value).toContain('class="beemetry-hr"');
    expect(result.value).toContain('Titulo con linea debajo');
    expect(result.value).toContain('Parrafo normal despues');
  });
});

/**
 * Cubre `extractDocxTableShading` -- la parte de MENOR confianza de todo
 * el plan (pedido explícito 2026-09-10, "los colores en la tabla"). mammoth
 * no tiene NINGÚN camino nativo para w:shd (ni de celda ni de tabla), así
 * que se extrae aparte replicando el algoritmo de colapso de fusiones de
 * mammoth (calculateRowSpans) -- estos tests verifican que las coordenadas
 * calculadas coinciden EXACTO con las que produce el HTML real de mammoth
 * (parseHtmlClipboardTable), incluyendo fusiones horizontales/verticales y
 * filas borradas, que son justo los casos donde una correlación por
 * posición podría desalinearse.
 */
function tcXml(text: string, opts?: { shd?: string; gridSpan?: number; vMerge?: 'restart' | 'continue' | 'bare' }): string {
  const tcPrParts: string[] = [];
  if (opts?.gridSpan) tcPrParts.push(`<w:gridSpan w:val="${opts.gridSpan}"/>`);
  if (opts?.vMerge === 'restart') tcPrParts.push('<w:vMerge w:val="restart"/>');
  if (opts?.vMerge === 'continue') tcPrParts.push('<w:vMerge w:val="continue"/>');
  if (opts?.vMerge === 'bare') tcPrParts.push('<w:vMerge/>');
  if (opts?.shd) tcPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${opts.shd}"/>`);
  const tcPr = tcPrParts.length > 0 ? `<w:tcPr>${tcPrParts.join('')}</w:tcPr>` : '';
  return `<w:tc>${tcPr}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}
function trXml(cellsXml: string, deleted = false): string {
  const trPr = deleted ? '<w:trPr><w:del w:id="1" w:author="x" w:date="2026-01-01T00:00:00Z"/></w:trPr>' : '';
  return `<w:tr>${trPr}${cellsXml}</w:tr>`;
}
function tblXml(rowsXml: string): string {
  return `<w:tbl><w:tblPr/><w:tblGrid/>${rowsXml}</w:tbl>`;
}

describe('extractDocxTableShading', () => {
  it('extrae el color de una celda con w:shd (tabla simple 2x2)', async () => {
    const body = tblXml(
      trXml(tcXml('A1', { shd: 'FFFF00' }) + tcXml('B1')) +
      trXml(tcXml('A2') + tcXml('B2')),
    );
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    expect(shading).toEqual([[{ row: 0, col: 0, fill: 'FFFF00' }]]);
  });

  it('extrae varias celdas sombreadas (fila de encabezado completa)', async () => {
    const body = tblXml(
      trXml(tcXml('H1', { shd: '0F172A' }) + tcXml('H2', { shd: '0F172A' })) +
      trXml(tcXml('D1') + tcXml('D2')),
    );
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    expect(shading[0]).toEqual(expect.arrayContaining([
      { row: 0, col: 0, fill: '0F172A' },
      { row: 0, col: 1, fill: '0F172A' },
    ]));
    expect(shading[0]).toHaveLength(2);
  });

  it('w:val="auto" (sin color RGB directo) se ignora', async () => {
    const body = tblXml(trXml(`<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="auto"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>`));
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    expect(shading).toEqual([[]]);
  });

  it('celda fusionada horizontalmente (gridSpan): la celda sombreada cae en la columna de INICIO de la fusión', async () => {
    // Fila 0: una celda que ocupa 2 columnas (fusión horizontal), sombreada.
    // Fila 1: dos celdas normales -- confirma que la columna 1 de la fila 1
    // NO se confunde con la fusión de la fila 0 (son fusiones independientes).
    const body = tblXml(
      trXml(tcXml('Titulo fusionado', { gridSpan: 2, shd: 'DBEAFE' })) +
      trXml(tcXml('A2') + tcXml('B2', { shd: 'FEE2E2' })),
    );
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    expect(shading[0]).toEqual(expect.arrayContaining([
      { row: 0, col: 0, fill: 'DBEAFE' },
      { row: 1, col: 1, fill: 'FEE2E2' },
    ]));
    expect(shading[0]).toHaveLength(2);
  });

  it('celda fusionada verticalmente (vMerge): la continuación NO genera una entrada propia ni duplica la del origen', () => {
    return (async () => {
      const body = tblXml(
        trXml(tcXml('Fusionada verticalmente', { vMerge: 'restart', shd: 'D1FAE5' }) + tcXml('B1')) +
        trXml(tcXml('', { vMerge: 'continue' }) + tcXml('B2')),
      );
      const input = await makeDocxBuffer(body);
      const shading = await extractDocxTableShading(input);
      // Solo UNA entrada -- la celda de origen (fila 0). La continuación de
      // la fila 1 nunca llega a emitirse como <td> en el HTML de mammoth,
      // así que tampoco debe generar su propia entrada de sombreado.
      expect(shading[0]).toEqual([{ row: 0, col: 0, fill: 'D1FAE5' }]);
    })();
  });

  it('w:vMerge SIN w:val (forma "bare") también cuenta como continuación (default OOXML)', async () => {
    const body = tblXml(
      trXml(tcXml('Origen', { vMerge: 'restart', shd: 'FCE7F3' })) +
      trXml(tcXml('', { vMerge: 'bare' })),
    );
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    expect(shading[0]).toEqual([{ row: 0, col: 0, fill: 'FCE7F3' }]);
  });

  it('una fila borrada (control de cambios, w:trPr>w:del) no se cuenta -- la fila siguiente no se desalinea', async () => {
    const body = tblXml(
      trXml(tcXml('Fila 0') + tcXml('X')) +
      trXml(tcXml('Fila borrada') + tcXml('X'), true) + // w:del -- mammoth no emite NADA por esta
      trXml(tcXml('Fila 1 real', { shd: 'FEF3C7' }) + tcXml('X')),
    );
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    // La fila borrada no cuenta -- "Fila 1 real" debe quedar en índice 1, no 2.
    expect(shading[0]).toEqual([{ row: 1, col: 0, fill: 'FEF3C7' }]);
  });

  it('una tabla con estructura inesperada (hijo directo que no es w:tr/w:tblPr/w:tblGrid) se omite -- devuelve null para ESA tabla', async () => {
    const body = '<w:tbl><w:tblPr/><w:tblGrid/><w:bookmarkStart w:id="0" w:name="x"/>' +
      trXml(tcXml('A', { shd: 'FFFFFF' })) + '</w:tbl>';
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    expect(shading).toEqual([null]);
  });

  it('varias tablas en un documento -- cada una obtiene su propio sombreado, en el orden correcto', async () => {
    const table1 = tblXml(trXml(tcXml('T1', { shd: 'FF0000' })));
    const table2 = tblXml(trXml(tcXml('T2', { shd: '00FF00' })));
    const body = `<w:p><w:r><w:t>Entre medio</w:t></w:r></w:p>${table1}<w:p/>${table2}`;
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    expect(shading).toEqual([
      [{ row: 0, col: 0, fill: 'FF0000' }],
      [{ row: 0, col: 0, fill: '00FF00' }],
    ]);
  });

  it('una tabla sin ningún w:shd real devuelve un array vacío para esa tabla (no null)', async () => {
    const body = tblXml(trXml(tcXml('A') + tcXml('B')));
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);
    expect(shading).toEqual([[]]);
  });

  it('un documento sin ninguna tabla devuelve un array vacío', async () => {
    const input = await makeDocxBuffer('<w:p><w:r><w:t>Sin tablas</w:t></w:r></w:p>');
    expect(await extractDocxTableShading(input)).toEqual([]);
  });

  it('un .docx que no es un zip válido devuelve un array vacío sin lanzar', async () => {
    const notADocx = new TextEncoder().encode('no es un zip').buffer;
    expect(await extractDocxTableShading(notADocx)).toEqual([]);
  });

  // Verificación cruzada de punta a punta: arma una tabla con fusión
  // horizontal Y vertical a la vez, la pasa por mammoth REAL, y confirma
  // que la coordenada (fila,columna) que calcula extractDocxTableShading
  // apunta exactamente a la MISMA celda que parseHtmlClipboardTable
  // reconstruye del HTML real -- la prueba más fuerte de que ambos
  // esquemas de indexación (el cellIndex de mammoth y el `occupied` de
  // parseHtmlClipboardTable) de verdad coinciden, no solo en teoría.
  it('de punta a punta: la coordenada calculada coincide con la celda real que ve mammoth (fusión horizontal + vertical combinadas)', async () => {
    const body = tblXml(
      trXml(tcXml('Encabezado fusionado', { gridSpan: 2, shd: '1E3A8A' })) +
      trXml(tcXml('Fusionada vertical', { vMerge: 'restart', shd: 'F59E0B' }) + tcXml('B2')) +
      trXml(tcXml('', { vMerge: 'continue' }) + tcXml('B3', { shd: '10B981' })),
    );
    const input = await makeDocxBuffer(body);
    const shading = await extractDocxTableShading(input);

    const result = await mammoth.convertToHtml({ buffer: Buffer.from(input) }, { styleMap: [] });
    const tableHtmlMatch = result.value.match(/<table>[\s\S]*<\/table>/);
    expect(tableHtmlMatch).toBeTruthy();
    const parsed = parseHtmlClipboardTable(tableHtmlMatch![0]);
    expect(parsed).toBeTruthy();

    // Cada coordenada calculada debe apuntar a la celda con el texto
    // esperado en la reconstrucción REAL del HTML de mammoth.
    const byFill = (fill: string) => shading[0]!.find((s) => s.fill === fill)!;
    expect(parsed!.rows[byFill('1E3A8A').row][byFill('1E3A8A').col]).toBe('Encabezado fusionado');
    expect(parsed!.rows[byFill('F59E0B').row][byFill('F59E0B').col]).toBe('Fusionada vertical');
    expect(parsed!.rows[byFill('10B981').row][byFill('10B981').col]).toBe('B3');
  });
});
