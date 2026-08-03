# ADR-019 — Resolución diferida: numeración jerárquica, TOC, refs cruzadas, "Página X de Y"

## Actualización 2026-07-24 — paginación de TOC (ADR-071)

El TOC ya no se trunca en un bloque único: se divide en página 2 +
continuaciones serializadas. La numeración sigue derivándose de
`headingStyle` sobre páginas planas. Las referencias cruzadas automáticas
continúan fuera de alcance y no deben contarse como implementadas.

**Status**: partial (actualizado 2026-07-24). "Página X de Y" ya estaba implementado (`PageCanvas.tsx::pageLabel`). La numeración jerárquica y detección automática de secciones dependía de `headingStyle` — cerrado junto con ADR-011 (ver esa nota: `onApplyHeadingStyle` ahora tagea el bloque, `extractHeadings` ya lee el campo correcto). Con eso, TOC + numeración (1, 1.1, 1.1.1) funcionan de extremo a extremo desde el botón de estilo de encabezado hasta el panel de TOC y el bloque `toc` embebido en el lienzo (unificados a una sola función).

**Pendiente real**: referencias cruzadas (refs) tipo "ver sección 2.3" con resolución automática de número — no existen en el código; requeriría un tipo de campo nuevo (`{ type: 'ref', targetElementId }`) resuelto en render, no solo el fix de headingStyle. Fuera del alcance de este cierre.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

Un informe formal tiene elementos que no se pueden fijar al editar porque dependen del documento completo: numeración jerárquica de secciones (1, 1.1, 1.1.1), tabla de contenidos, referencias cruzadas ("ver Figura 3", "Sección 2.1") y "Página X de Y". Hoy estos se calculan al vuelo en UI o se ponen como texto estático; no hay un modelo persistido de anclas, y las refs cruzadas no existen.

## Decisión

Estos elementos se modelan con **anclas estables** y se **resuelven en render/export**, no se guardan como texto fijo:

- **Numeración jerárquica**: se computa desde el árbol de `sections[]` + `headingStyle` (ADR-011); cada sección/figura/tabla tiene un `anchorId` estable.
- **TOC**: se genera desde el árbol de secciones (bloque `toc`, ADR-011), no escaneando estilos sin contrato.
- **Referencias cruzadas**: se guardan como referencia a un `anchorId` (no como texto "Figura 3"); el número se resuelve al render.
- **"Página X de Y"**: lo resuelve el worker de export (ADR-016) con flags, no texto estático en el bloque.

### Reglas duras
- Ninguna numeración ni ref cruzada se persiste como texto literal: siempre como ancla resuelta en render.
- Mover/insertar una sección re-numera y re-resuelve refs automáticamente (sin edición manual).
- Test obligatorio: insertar sección en el medio → numeración y refs se actualizan.

## Consecuencias

### Positivas
- Numeración, TOC y refs siempre coherentes ante edición; cero "Figura 3" que quedó apuntando mal.
- Export determinista reproduce la misma numeración.

### Negativas / Trade-offs
- Requiere un paso de resolución en render/export (más lógica) — costo necesario para corrección.

### Neutras
- Se apoya en la estructura formal (ADR-011) y el export server-side (ADR-016).

## Alternativas descartadas

### Numeración/refs como texto estático
Es el estado actual. Se desincroniza al editar; las refs cruzadas quedan mal. Rechazado.

### Resolver solo en UI (no en export)
La TOC overlay actual no viaja al export ni al `.miningreport`. Rompe reproducibilidad. Rechazado.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/components/document/TableOfContents.jsx`
- ADR-011 (estructura formal), ADR-016 (export), ADR-010 (modelo)
