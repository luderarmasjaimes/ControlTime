# ADR-071 — TOC en página 2 con continuaciones automáticas

## Actualización 2026-07-25 — el botón del ribbon seguía sin insertar de verdad

Este ADR ya afirmaba "Ribbon y biblioteca llaman al mismo `addTocElement()`"
(línea de Decisión abajo), pero **eso no era cierto en el runtime**: se
verificó en vivo (clic real en el botón "Insertar tabla de contenidos
automática" del ribbon, confirmado por ausencia del bloque `toc` vía DOM y
Konva) que ese botón solo alternaba un panel de navegación flotante
(`showToc`/`<TableOfContents>`), sin llamar nunca a `addTocElement()`. Solo el
botón "Índice" de la biblioteca lateral insertaba el bloque real — una
divergencia entre lo documentado y el código, no detectada por `tsc`/build
porque ambos caminos compilan y ninguno lanza error, solo hacen cosas
distintas.

Corregido: `App.tsx` ahora pasa `onInsertTOC={handleAddToc}` (la misma acción
que ya usaba la biblioteca), reemplazando el toggle de `showToc`. El panel de
navegación flotante queda sin disparador — no se eliminó su código por
alcance, pero ya no es alcanzable desde la UI; si se quiere recuperar como
funcionalidad aparte, necesita su propio botón con un título que no prometa
"insertar". Verificado en vivo tras rebuild/redeploy: clic real en el botón
del ribbon ahora sí agrega el bloque TOC a la página 2 (confirmado por
DOM/Konva), consistente con lo que el título del botón siempre dijo.

**Status**: implemented, verificado por tipos/build (2026-07-24)
**Fecha**: 2026-07-24
**Autores**: EC
**Ámbito**: reports
**Relación**: refina ADR-011/019; mantiene el modelo plano `pages[].elements[]`.

## Contexto

El índice podía insertarse en cualquier página y un bloque único truncaba
documentos con más encabezados que su capacidad visual. Además, el botón del
ribbon decía insertar TOC pero solo abría navegación, mientras la biblioteca
lateral sí insertaba el bloque real.

## Decisión

- El TOC original vive siempre en la página 2; si no existe, esa página se
  crea. La página 1 queda reservada a carátula.
- Insertar nuevamente no duplica el índice: selecciona el existente.
- La capacidad se calcula con el alto real del bloque.
- Si las entradas exceden la capacidad, se crean páginas dedicadas con
  bloques `toc` de continuación (`tocContinuationIndex`); al reducirse las
  entradas, esas páginas se reconcilian automáticamente.
- Editor y visor usan `tocSliceForElementId()` como fuente única.
- Ribbon y biblioteca llaman al mismo `addTocElement()`.

Esto no afirma que exista un árbol `sections[]`: la jerarquía continúa
derivándose de `headingStyle` sobre páginas planas, como reconoce ADR-011.

## Consecuencias

- El índice no invade la carátula ni trunca documentos extensos.
- Las continuaciones forman parte del JSON y del render de solo lectura.
- Las páginas de continuación son propiedad del motor TOC; no deben contener
  contenido manual ajeno.
- Las referencias cruzadas automáticas siguen fuera del alcance de ADR-019.

## Alternativas descartadas

- **Un bloque TOC con scroll**: no sirve para PDF/impresión.
- **Paginación solo en export**: diverge del WYSIWYG.
- **Crear `sections[]` ahora**: migración de modelo mayor, innecesaria para
  resolver paginación.

## Evidencia y referencias

- `useEditorStore.ts`: `addTocElement`, `syncTocPages`,
  `tocSliceForElementId`
- `App.tsx`, `PageCanvas.tsx`, `ReadOnlyViewer.tsx`
- `npm run type-check` y `npm run build`: OK (2026-07-24).
