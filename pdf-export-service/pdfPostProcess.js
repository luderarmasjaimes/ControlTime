'use strict';
/**
 * Post-proceso del PDF ya fusionado (todas las páginas en un solo
 * `PDFDocument` de pdf-lib, antes de `encryptPdf`): agrega un índice REAL,
 * con la misma paridad que el campo TOC nativo de Word --
 *
 *  1. `addPdfOutline`: árbol de marcadores real (panel de navegación de
 *     Adobe Acrobat/Chrome), uno por encabezado, numerado igual que
 *     `generateTocData` (reportSharedHelpers.js) ya numera el TOC de
 *     pantalla/Word. `pdf-lib` no tiene una API de alto nivel para esto (a
 *     diferencia de `docx`::TableOfContents) -- se arma a mano con su API
 *     de bajo nivel (`context.obj`/`register`/`assign`, encadenando
 *     `/First`/`/Last`/`/Next`/`/Prev`/`/Parent` por nivel de anidamiento).
 *
 *  2. `addTocLinkAnnotations`: hace clickeable cada fila VISIBLE del bloque
 *     `toc` dentro del documento -- una anotación `/Subtype /Link` con una
 *     acción `/GoTo` real, posicionada con la MISMA matemática de layout
 *     que ya usa `reportDocxBuilder.js`/pantalla (`tocRowRectsForElement`).
 *     Deliberadamente NO se usan anchors HTML (`<a href="#pagina-N">`): cada
 *     worker de `/render-pdf` renderiza su PROPIO rango de páginas como un
 *     PDF aislado antes de fusionarse (ver `server.js`), así que un ancla
 *     del DOM no sobreviviría ese corte -- el enlace se resuelve acá,
 *     DESPUÉS del merge, contra el índice de página YA fusionado.
 *
 * Ambas funciones son NO-OP silencioso si el informe no tiene encabezados/
 * bloques `toc` -- nunca hacen fallar el export por esto.
 */
const { PDFName, PDFString } = require('pdf-lib');
const { generateTocData, tocRowRectsForElement, pxToPt } = require('./reportSharedHelpers');

/** `page.page_number` (1-based, puede tener huecos) -> índice 0-based en el
 * `PDFDocument` YA fusionado. `mergedPageNumbers` es la MISMA lista, en el
 * MISMO orden, que `server.js` usó para copiar cada página al documento
 * final (ver `allPageNumbers` en `/render-pdf`) -- una página que falló en
 * todos los workers y quedó como hueco simplemente no aparece acá, y
 * cualquier heading/entrada de TOC que apuntara a ella se omite más abajo
 * en vez de romper el resto del índice. */
function buildPageIndexByNumber(mergedPageNumbers) {
  const map = new Map();
  mergedPageNumbers.forEach((pageNumber, index) => map.set(pageNumber, index));
  return map;
}

function addPdfOutline(pdfDoc, reportDocument, mergedPageNumbers) {
  const headings = generateTocData(reportDocument);
  if (headings.length === 0) return;
  const pageIndexByNumber = buildPageIndexByNumber(mergedPageNumbers);
  const pages = pdfDoc.getPages();
  const ctx = pdfDoc.context;

  // Jerarquía por NIVEL (1-6): cada heading es hijo del heading de nivel
  // inmediatamente MENOR más reciente visto hasta ahora -- mismo criterio
  // de anidamiento que ya usa `numberHeadings()` para la numeración 1.2.3.
  const parentIndex = new Array(headings.length).fill(-1);
  const lastIndexAtLevel = new Array(7).fill(-1);
  headings.forEach((h, i) => {
    for (let lvl = h.level - 1; lvl >= 1; lvl -= 1) {
      if (lastIndexAtLevel[lvl] !== -1) { parentIndex[i] = lastIndexAtLevel[lvl]; break; }
    }
    lastIndexAtLevel[h.level] = i;
    for (let lvl = h.level + 1; lvl <= 6; lvl += 1) lastIndexAtLevel[lvl] = -1;
  });
  const childrenOf = new Map(); // índice de padre (-1 = raíz) -> [índices hijos] en orden
  headings.forEach((_, i) => {
    const p = parentIndex[i];
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(i);
  });
  function countDescendants(i) {
    const kids = childrenOf.get(i) || [];
    return kids.reduce((sum, k) => sum + 1 + countDescendants(k), 0);
  }

  const rootRef = ctx.nextRef();
  const itemRefs = headings.map(() => ctx.nextRef());
  const refFor = (idx) => (idx === -1 ? rootRef : itemRefs[idx]);

  headings.forEach((h, i) => {
    const kids = childrenOf.get(i) || [];
    const siblings = childrenOf.get(parentIndex[i]) || [];
    const myPos = siblings.indexOf(i);
    const dict = { Title: PDFString.of(`${h.number}  ${h.text}`.trim()), Parent: refFor(parentIndex[i]) };
    if (myPos > 0) dict.Prev = itemRefs[siblings[myPos - 1]];
    if (myPos < siblings.length - 1) dict.Next = itemRefs[siblings[myPos + 1]];
    if (kids.length > 0) {
      dict.First = itemRefs[kids[0]];
      dict.Last = itemRefs[kids[kids.length - 1]];
      // Negativo = rama colapsada por defecto (un informe con cientos de
      // encabezados no debería abrir el panel entero de una); Acrobat/Chrome
      // igual dejan expandir cada rama a mano.
      dict.Count = -countDescendants(i);
    }
    const pageIndex = pageIndexByNumber.get(h.pageNumber);
    if (pageIndex != null && pages[pageIndex]) {
      dict.Dest = [pages[pageIndex].ref, PDFName.of('XYZ'), null, null, null];
    }
    ctx.assign(itemRefs[i], ctx.obj(dict));
  });

  const rootChildren = childrenOf.get(-1) || [];
  if (rootChildren.length === 0) return; // todos los headings quedaron huérfanos de página (raro) -- no hay nada que enlazar.
  ctx.assign(rootRef, ctx.obj({
    Type: PDFName.of('Outlines'),
    First: itemRefs[rootChildren[0]],
    Last: itemRefs[rootChildren[rootChildren.length - 1]],
    Count: countDescendants(-1),
  }));
  pdfDoc.catalog.set(PDFName.of('Outlines'), rootRef);
}

function addTocLinkAnnotations(pdfDoc, reportDocument, mergedPageNumbers) {
  const pageIndexByNumber = buildPageIndexByNumber(mergedPageNumbers);
  const pages = pdfDoc.getPages();
  const ctx = pdfDoc.context;

  (reportDocument.pages || []).forEach((docPage) => {
    (docPage.elements || []).forEach((el) => {
      if (el.type !== 'toc') return;
      const tocPageIndex = pageIndexByNumber.get(docPage.page_number);
      if (tocPageIndex == null || !pages[tocPageIndex]) return;
      const pdfPage = pages[tocPageIndex];
      const pageHeightPt = pdfPage.getHeight();

      const newAnnotRefs = [];
      tocRowRectsForElement(reportDocument, el).forEach(({ entry, x, y, width, height }) => {
        const targetPageIndex = pageIndexByNumber.get(entry.pageNumber);
        if (targetPageIndex == null || !pages[targetPageIndex]) return;
        const xPt = pxToPt(x);
        const wPt = pxToPt(width);
        const hPt = pxToPt(height);
        // El lienzo mide Y desde ARRIBA de la página; PDF lo mide desde
        // ABAJO -- se invierte con la altura real de ESTA página fusionada.
        const rectTop = pageHeightPt - pxToPt(y);
        const rectBottom = rectTop - hPt;
        newAnnotRefs.push(ctx.register(ctx.obj({
          Type: PDFName.of('Annot'),
          Subtype: PDFName.of('Link'),
          Rect: [xPt, rectBottom, xPt + wPt, rectTop],
          Border: [0, 0, 0],
          A: { S: PDFName.of('GoTo'), D: [pages[targetPageIndex].ref, PDFName.of('XYZ'), null, null, null] },
        })));
      });
      if (newAnnotRefs.length === 0) return;

      const existing = pdfPage.node.get(PDFName.of('Annots'));
      const existingRefs = existing ? existing.asArray() : [];
      pdfPage.node.set(PDFName.of('Annots'), ctx.obj([...existingRefs, ...newAnnotRefs]));
    });
  });
}

module.exports = { addPdfOutline, addTocLinkAnnotations };
