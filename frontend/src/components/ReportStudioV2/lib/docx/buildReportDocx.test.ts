import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildReportDocx } from './buildReportDocx';
import type { ReportDocument, ReportElement } from '../../store/useEditorStore';

// PNG 1x1 transparente — suficiente para validar que `ImageRun` acepta los
// bytes y que el .docx resultante sigue siendo un ZIP/XML válido; el
// contenido visual real se prueba aparte (captura real del navegador).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function tinyPng(): Uint8Array {
  const bin = atob(TINY_PNG_BASE64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** jsdom no siempre implementa `Blob.prototype.arrayBuffer` -- se usa
 * `FileReader` como respaldo, que jsdom sí soporta completo. */
function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof (blob as any).arrayBuffer === 'function') {
    return (blob as any).arrayBuffer().then((buf: ArrayBuffer) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function el(partial: Partial<ReportElement> & Pick<ReportElement, 'id' | 'type' | 'x' | 'y' | 'width' | 'height'>): ReportElement {
  return {
    zIndex: 0,
    locked: false,
    props: {},
    ...partial,
  } as ReportElement;
}

/** Documento sintético de cobertura total: al menos un bloque de cada tipo
 * soportado por el mapeo de `buildReportDocx.ts`, con una página A3
 * horizontal mezclada con A4 vertical, y una tabla TOC con headings H1-H3
 * reales (bloque + spans) para ejercitar `tocSliceForElementId`. */
function buildSyntheticDocument(): ReportDocument {
  return {
    document_id: 'test-doc',
    meta: { author: 'QA', version: 1, updatedAt: new Date().toISOString(), layoutMode: 'document', paperSize: 'A4', orientation: 'portrait' },
    pages: [
      {
        page_number: 1,
        elements: [
          el({ id: 'cover-1', type: 'cover', x: 0, y: 0, width: 793, height: 1122, props: { title: 'Informe de Cobertura Total', date: '2026-08-29', classification: 'CONFIDENCIAL', docCode: 'QA-001', coverTemplate: 'corporate' } }),
        ],
      },
      {
        page_number: 2,
        elements: [
          el({ id: 'header-2', type: 'header', x: 36, y: 10, width: 720, height: 40, locked: true, props: { showLogo: false } }),
          el({ id: 'footer-2', type: 'footer', x: 36, y: 1070, width: 720, height: 30, locked: true, props: { showPageNumber: true } }),
          el({ id: 'h1-2', type: 'text', x: 36, y: 60, width: 720, height: 40, props: { text: 'Sección 1: Introducción', headingStyle: 'h1', fontFamily: 'Calibri', fontSize: 22, bold: true } }),
          el({
            id: 'text-mixed-2', type: 'text', x: 36, y: 110, width: 720, height: 80,
            props: {
              text: 'Texto normal, luego negrita y cursiva, y una línea nueva.\nSegunda línea con subrayado.',
              fontSize: 14, fontFamily: 'Arial', fontColor: '#0f172a',
              spans: [
                { start: 13, end: 28, bold: true },
                { start: 30, end: 37, italic: true },
                { start: 58, end: 68, underline: true },
              ],
            },
          }),
          el({ id: 'h2-2', type: 'text', x: 36, y: 200, width: 720, height: 30, props: { text: 'Subsección 1.1', headingStyle: 'h2', fontFamily: 'Calibri', fontSize: 18, bold: true } }),
          el({
            id: 'table-2', type: 'table', x: 36, y: 240, width: 500, height: 120,
            props: {
              rows: [['Columna A', 'Columna B'], ['<b>Negrita</b> y normal', 'Fila 1'], ['Fila 2 col A', 'Fila 2 col B']],
              hasHeader: true, headerBg: '#17365D', headerTextColor: '#FFFFFF', headerBold: true,
              fontSize: 12, cellPadding: 6, bandedRows: true, bandColor: '#F5F8FA',
              borderColor: '#94a3b8', borderWidth: 1, borderStyle: 'solid',
            },
          }),
          el({ id: 'image-2', type: 'image', x: 36, y: 380, width: 200, height: 120, src: 'placeholder', props: { alt: 'Figura de prueba' } }),
          el({ id: 'kpi-2', type: 'kpi', x: 260, y: 380, width: 160, height: 100, props: { title: 'Tonelaje movido', snapshot: { value: 12345, unit: 't' } } }),
          el({ id: 'sensor-2', type: 'sensor', x: 440, y: 380, width: 160, height: 100, props: { title: 'Temperatura', snapshot: { value: 23.5, unit: '°C' } } }),
          el({
            id: 'seismic-2', type: 'seismic-report', x: 36, y: 500, width: 700, height: 220,
            props: {
              title: 'Reporte Sismográfico', source: 'both', startDate: '2026-08-01', endDate: '2026-08-29',
              snapshot: { igpEvents: [{ fecha_local: '2026-08-15 10:00', magnitud: 4.2, profundidad: 60, referencia: '10km SE de Lima' }], companyCount: 7 },
            },
          }),
          el({ id: 'chart-2', type: 'chart', x: 36, y: 730, width: 340, height: 200, props: { title: 'Disponibilidad mensual', live: false, chartKind: 'line', categories: ['Ene', 'Feb'], series: [95, 97] } }),
          el({ id: 'smc-2', type: 'sensor_multi_chart', x: 390, y: 730, width: 340, height: 200, props: { title: 'Gráfico de sensores', selections: [{ name: 'Radar 1' }], chartType: 'line' } }),
          el({ id: 'video-2', type: 'video', x: 36, y: 940, width: 260, height: 140, src: 'blob:fake', props: { source: 'webcam', durationSeconds: 12 } }),
          el({ id: 'toc-2', type: 'toc', x: 320, y: 940, width: 400, height: 140, props: { title: 'Tabla de Contenidos', autoGenerate: true } }),
        ],
      },
      {
        page_number: 3,
        paperSize: 'A3',
        orientation: 'landscape',
        elements: [
          el({ id: 'h3-3', type: 'text', x: 36, y: 40, width: 1000, height: 30, props: { text: 'Anexo A3 horizontal', headingStyle: 'h3', fontFamily: 'Calibri', fontSize: 15, bold: true } }),
        ],
      },
    ],
  } as unknown as ReportDocument;
}

describe('buildReportDocx', () => {
  it('genera un .docx (ZIP) válido con todas las partes OOXML bien formadas', async () => {
    const doc = buildSyntheticDocument();
    const png = tinyPng();
    const rasterAssets = new Map<string, Uint8Array>([
      ['cover-1', png], ['chart-2', png], ['smc-2', png],
    ]);
    const imageAssets = new Map<string, Uint8Array>([['image-2', png]]);

    const blob = await buildReportDocx(doc, {
      session: { company: 'Minera QA S.A.', fullName: 'Auditor QA', tenantId: 'tenant-qa', miningUnit: 'Unidad Norte' },
      imageAssets,
      rasterAssets,
    });

    expect(blob.size).toBeGreaterThan(1000);

    const buf = await blobToUint8Array(blob);
    const zip = await JSZip.loadAsync(buf);

    // Partes obligatorias de un .docx válido -- si faltan, Word lo rechaza o
    // lo abre en modo "reparado" (exactamente lo que este pipeline debe
    // evitar).
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('word/document.xml')).toBeTruthy();
    expect(zip.file('_rels/.rels')).toBeTruthy();

    const domParser = new DOMParser();
    const xmlFiles = Object.keys(zip.files).filter((name) => name.endsWith('.xml') || name.endsWith('.rels'));
    expect(xmlFiles.length).toBeGreaterThan(3);
    for (const name of xmlFiles) {
      const content = await zip.file(name)!.async('string');
      const parsed = domParser.parseFromString(content, 'application/xml');
      const parserError = parsed.getElementsByTagName('parsererror');
      expect(parserError.length, `${name} debe ser XML bien formado`).toBe(0);
    }

    const documentXml = await zip.file('word/document.xml')!.async('string');
    // 3 secciones (3 páginas) -> al menos 2 `sectPr` explícitos de salto de
    // sección intermedios + las propiedades finales del cuerpo.
    expect((documentXml.match(/<w:sectPr/g) || []).length).toBeGreaterThanOrEqual(3);
    // Texto de cada tipo de bloque presente literalmente en el XML (prueba
    // de contenido, no solo de estructura).
    // El título de carátula NO debe aparecer como texto nativo separado
    // cuando SÍ hubo captura raster de fondo (caso de este test: 'cover-1'
    // está en rasterAssets) -- ya queda horneado en la imagen capturada
    // (mismo contenido que el lienzo, sin duplicarlo con un segundo texto
    // flotante potencialmente desalineado). Ver segundo test más abajo
    // para el caso contrario (sin captura -> sí aparece como texto).
    expect(documentXml).not.toContain('Informe de Cobertura Total');
    expect(documentXml).toContain('Sección 1: Introducción');
    expect(documentXml).toContain('Subsección 1.1');
    expect(documentXml).toContain('Negrita');
    expect(documentXml).toContain('12345');
    expect(documentXml).toContain('23.5');
    expect(documentXml).toContain('Reporte Sismográfico');
    expect(documentXml).toContain('10km SE de Lima');
    expect(documentXml).toContain('Video adjunto');
    expect(documentXml).toContain('Tabla de Contenidos');
    expect(documentXml).toContain('Anexo A3 horizontal');
    // Estilos de encabezado con nombre real de Word (Heading1/2/3) --
    // condición necesaria para que el panel de navegación/TOC de Word los
    // reconozca.
    expect(documentXml).toContain('Heading1');
    expect(documentXml).toContain('Heading2');
    expect(documentXml).toContain('Heading3');
    // Imagen embebida como media real del paquete (no un <img> HTML). El
    // mismo PNG de prueba se reutiliza en varios bloques (cover/image/chart/
    // sensor_multi_chart) y `docx` deduplica bytes idénticos en un solo
    // archivo de media referenciado por varias relaciones -- se verifica la
    // presencia de al menos un media file real, no un conteo exacto.
    const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));
    expect(mediaFiles.length).toBeGreaterThanOrEqual(1);

    // ── Encabezado/pie NATIVOS de Word (no párrafos flotantes) ────────────
    // Deben existir como PARTES separadas del paquete, referenciadas desde
    // sectPr vía headerReference/footerReference -- exactamente lo que hace
    // que Word los trate como encabezado/pie real (doble clic para editar,
    // franja gris propia), no como más texto del cuerpo.
    const headerFiles = Object.keys(zip.files).filter((n) => /^word\/header\d+\.xml$/.test(n));
    const footerFiles = Object.keys(zip.files).filter((n) => /^word\/footer\d+\.xml$/.test(n));
    expect(headerFiles.length).toBeGreaterThanOrEqual(1);
    expect(footerFiles.length).toBeGreaterThanOrEqual(1);
    expect(documentXml).toMatch(/<w:headerReference/);
    expect(documentXml).toMatch(/<w:footerReference/);
    const footerXml = await zip.file(footerFiles[0])!.async('string');
    expect(footerXml).toContain('BEEMETRY');
    // Campo PAGE/NUMPAGES real (no un número literal calculado en build) --
    // el runtime de Word lo evalúa página por página.
    expect(footerXml).toMatch(/PAGE/);
    expect(footerXml).toMatch(/NUMPAGES/);

    // ── Campo TOC nativo (instrText "TOC \h \o "1-6"") ─────────────────────
    expect(documentXml).toMatch(/<w:instrText[^>]*>TOC\b/);
    expect(documentXml).toContain('fldCharType="begin"');
    expect(documentXml).toContain('fldCharType="end"');
    // `features.updateFields` a nivel de documento -- Word recalcula el
    // campo TOC (y PAGE/NUMPAGES del pie) al abrir, sin que el usuario
    // tenga que presionar F9 a mano.
    const settingsXml = await zip.file('word/settings.xml')!.async('string');
    expect(settingsXml).toMatch(/<w:updateFields/);
  });

  it('usa texto nativo de carátula SOLO cuando no hay captura de fondo (respaldo con gracia)', async () => {
    const doc = buildSyntheticDocument();
    // Sin 'cover-1' en rasterAssets -- simula una captura fallida/omitida.
    const blob = await buildReportDocx(doc, {
      session: { company: 'Minera QA S.A.' },
      imageAssets: new Map(),
      rasterAssets: new Map(),
    });
    const buf = await blobToUint8Array(blob);
    const zip = await JSZip.loadAsync(buf);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('Informe de Cobertura Total');
  });

  it('convierte <a href> de celdas de tabla en hipervínculos nativos reales', async () => {
    const doc: ReportDocument = {
      document_id: 'link-test',
      meta: { author: 'QA', version: 1, updatedAt: new Date().toISOString(), layoutMode: 'document', paperSize: 'A4', orientation: 'portrait' },
      pages: [{
        page_number: 1,
        elements: [
          el({
            id: 'table-link', type: 'table', x: 36, y: 36, width: 400, height: 80,
            props: { rows: [['Enlace', 'Peligroso'], ['<a href="https://beemetry.net">Ver sitio</a>', '<a href="javascript:alert(1)">no debe ser link</a>']], hasHeader: true },
          }),
        ],
      }],
    } as unknown as ReportDocument;
    const blob = await buildReportDocx(doc, { session: {}, imageAssets: new Map(), rasterAssets: new Map() });
    const buf = await blobToUint8Array(blob);
    const zip = await JSZip.loadAsync(buf);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('<w:hyperlink ');
    expect(documentXml).toContain('Ver sitio');
    // El esquema javascript: no debe convertirse en hipervínculo navegable.
    const relsXml = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(relsXml).not.toContain('javascript:');
    expect(relsXml).toContain('https://beemetry.net');
  });
});
