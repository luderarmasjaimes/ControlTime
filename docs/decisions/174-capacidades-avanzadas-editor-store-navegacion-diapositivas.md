# ADR-174 — Capacidades avanzadas del editor: historial, auto-flujo, grupos vinculados, configuración de página y navegación de diapositivas

**Status**: implemented (formalizado retroactivamente 2026-09-12 — el código ya existía sin ADR)
**Fecha**: 2026-09-12
**Autores**: Luder Armas (formalización retroactiva, con Claude Code)
**Ámbito**: reports

## Contexto

`store/useEditorStore.ts` llegó con varias capacidades nuevas de edición sin
ADR propio, además del portapapeles del sistema (ya formalizado en la
actualización 2026-09-11 de [ADR-051](051-copiar-pegar-objetos-lienzo.md) —
**no se repite acá**). Sumado a eso, la navegación de diapositivas
(`SlideThumbnailRail.tsx`, `DragPreviewOverlay.tsx`, `slideLayouts.ts`) es
UX nueva construida sobre infraestructura ya decidida (ADR-083/128) que
tampoco tenía ADR. Este documento formaliza ambos grupos juntos porque
comparten la misma naturaleza: mejoras reales de productividad del editor,
sin tocar el modelo de datos del documento (ADR-010) ni ningún contrato de
backend.

## Decisión

### 1. Historial de deshacer/rehacer con agrupación temporal

`historyPast`/`historyFuture` (pilas de snapshots profundos del documento),
con `HISTORY_COALESCE_WINDOW_MS = 600`: ediciones que ocurren dentro de esa
ventana desde el último cambio se agrupan en un solo paso de Undo, en vez de
generar una entrada por cada tecla/arrastre. `createNewDocument`/
`loadDocument` vacían el historial al cambiar de informe — no hay forma de
deshacer hacia un documento distinto al que está abierto. Probado en
`useEditorStore.history.test.ts`.

**Guardia de integridad** (ver actualización 2026-09-11 de ADR-051): el
propio `undoAction`/`redoAction`, junto con `addElement`/`updateElement`/
`removeElement(s)`/`pasteSelection`, respeta `documentLocked` — no permite
deshacer ni editar cuando el informe cargado está `signed`/`archived`
(ADR-018/079). Esa parte de la historia de este ADR ya quedó resuelta ahí;
se referencia acá solo para que quede completo el catálogo de la capacidad.

### 2. AutoFlow — auto-colocación de bloques nuevos

`computeAutoFlowPosition` evita que dos objetos insertados sin posición
explícita queden superpuestos: coloca el nuevo bloque a la derecha del
elemento/fila de referencia si hay espacio (con `INSERT_GAP = 12` px de
separación), o abre una fila nueva debajo si no alcanza; si ninguna página
existente tiene lugar, reutiliza la primera página con espacio libre antes
de crear una página nueva. Probado en `useEditorStore.autoFlow.test.ts`.

### 3. LinkedGroup — fragmentos vinculados entre páginas

`linkedGroupId` enlaza los fragmentos de un mismo bloque de texto o tabla
que la paginación automática partió entre páginas (por desborde, típico al
pegar contenido largo de Word/Docs). Fragmentos con el mismo
`linkedGroupId`:
- se **mueven juntos** si se desplaza uno de ellos,
- se **seleccionan juntos**,
- y `reflowLinkedTableFragments` puede **fusionar de vuelta** una tabla
  partida en el momento en que el usuario le hace espacio suficiente a mano
  en una sola página.

Probado en `useEditorStore.linkedGroup.test.ts`.

### 4. PageSetup — reescalado proporcional al cambiar tamaño/orientación

`applyPageSetup` (función de módulo, reutilizada por `setLayoutMode`,
`setPaperSize` y `setOrientation` — antes el mismo cálculo estaba
duplicado en 4 sitios distintos) reescala proporcionalmente `x`/`y`/
`width`/`height` de los bloques normales de una página al cambiar tamaño de
hoja u orientación (documento↔presentación, A4↔A3), mientras que
`header`/`footer`/`cover` se reposicionan directamente a la geometría fija
de la hoja nueva en vez de reescalarse (son elementos de plataforma con
tamaño fijo, ADR-046/048). `setPagePaperSetup` permite el mismo ajuste
acotado a una sola página (override individual, ya referenciado en
[ADR-052](052-navegacion-zoom-tamano-pagina.md)). Probado en
`useEditorStore.pageSetup.test.ts`.

### 5. Navegación de diapositivas

Tres piezas nuevas de UX sobre infraestructura ya decidida (ADR-083 export
PPTX, ADR-128 `layoutMode: 'presentation'`) — no introducen ningún concepto
nuevo de modelo de datos:

- **`SlideThumbnailRail.tsx`**: panel de miniaturas de diapositiva con
  clic-para-ir y arrastrar-para-reordenar. Reutiliza `reorderPages`
  (acción del store que ya existía antes de este ADR) en vez de duplicar
  lógica de reordenamiento.
- **`DragPreviewOverlay.tsx`**: fantasma flotante que sigue al cursor
  durante el arrastre — apoyado en `useDragPreviewStore` (store Zustand
  SEPARADO, deliberadamente efímero: solo guarda la posición visual del
  fantasma durante el drag, nunca duplica `doc`; ver el punto pendiente
  de actualizar [ADR-014](014-estado-editor-zustand.md) para reconocer
  esta excepción, listado en la auditoría de conformidad de 2026-09-11,
  no resuelto por este ADR).
- **`lib/slideLayouts.ts`**: galería de 12 diseños de diapositiva
  (`title-executive`, `title-corporate`, `section-dark`, `section-vivid`,
  `content-formal`, `content-minimal`, `two-column-corporate`,
  `agenda-executive`, `quote-highlight`, `stat-highlight`,
  `image-caption-light`, `closing-executive`), cada uno mapeado a uno de
  10 `kind` de layout con paleta propia; `buildSlideLayoutDeckSpecs` genera
  además un mini-deck de 5 diapositivas de ejemplo con placeholders.
  **Nota de alcance**: la paleta de estos 12 diseños es propia del
  editor, todavía no la identidad visual oficial de
  `Plantilla Telemetry.potx` (naranja `#EF6535`, Roboto, 26 layouts reales)
  que [ADR-092](092-plantilla-corporativa-timetelemetry-referencia-diseno.md)
  documentó como referencia pendiente de aplicar — sigue pendiente, este
  ADR no lo resuelve.

### Pendiente — no resuelto por este ADR (hallazgo de la auditoría de conformidad 2026-09-11)

La reorganización de `components/document/InsertBlocks/` (que movió
`MiningKpiWidget`, `SeismicReportWidget`, `SensorGeoMapPanel`,
`SensorMultiChartWidget`, `SensorSurface3DPanel`, `SensorWidget`,
`TableBlock` a una carpeta propia, en el mismo movimiento que trajo la
navegación de diapositivas) **no fue una reorganización pura**: de paso,
`MiningKpiWidget.tsx` ganó una optimización real (polling compartido vía
`useSharedPoll`, un solo timer para todos los widgets KPI en vez de uno por
widget) y `TableBlock.tsx` creció de 596 a 2716 líneas (todo el motor de
tablas de [ADR-172](172-motor-tablas-excel-formulas-formato-condicional.md))
en el mismo commit que movió el archivo de carpeta. Ningún dato ni
funcionalidad se perdió en el movimiento — verificado — pero mezclar
"mover archivos" con "cambiar comportamiento" en el mismo paso dificulta
auditar cada cambio por separado hacia atrás. Se deja pendiente de revisión
(sin acción correctiva por este ADR): a futuro, separar reorganizaciones de
carpeta de cambios funcionales reales en commits/PRs distintos.

## Consecuencias

### Positivas
- AutoFlow y LinkedGroup resuelven fricciones reales de edición (bloques
  superpuestos, tablas partidas por paginación) sin requerir intervención
  manual del usuario.
- PageSetup centraliza un cálculo que antes estaba duplicado en 4 lugares —
  menos superficie de bugs de reescalado inconsistente.
- La navegación de diapositivas reutiliza infraestructura ya decidida
  (`reorderPages`, `layoutMode`) en vez de construir un camino paralelo.

### Negativas / Trade-offs
- `useDragPreviewStore` sigue siendo, en la letra, una segunda fuente de
  estado Zustand fuera de ADR-014 — excepción razonable (nunca duplica el
  documento) pero no reconocida formalmente todavía en ese ADR.
- La paleta de `slideLayouts.ts` diverge de la identidad visual corporativa
  real, pendiente desde ADR-092.
- La mezcla de reorganización de carpetas con cambios funcionales reales
  (ver "Pendiente" arriba) queda como deuda de trazabilidad, no de
  funcionalidad.

## Alternativas descartadas

No aplica de forma directa — estas capacidades resuelven fricciones de
edición puntuales encontradas en uso real, sin que se haya identificado una
alternativa de diseño distinta considerada y descartada en el código o sus
comentarios. Se documenta así, con honestidad, en vez de inventar
alternativas retroactivamente.

## Referencias
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (`computeAutoFlowPosition`, `applyPageSetup`, `reflowLinkedTableFragments`, `historyPast`/`historyFuture`, `reorderPages`)
- `frontend/src/components/ReportStudioV2/store/useEditorStore.autoFlow.test.ts`
- `frontend/src/components/ReportStudioV2/store/useEditorStore.history.test.ts`
- `frontend/src/components/ReportStudioV2/store/useEditorStore.linkedGroup.test.ts`
- `frontend/src/components/ReportStudioV2/store/useEditorStore.pageSetup.test.ts`
- `frontend/src/components/ReportStudioV2/store/useDragPreviewStore.ts`
- `frontend/src/components/ReportStudioV2/components/document/SlideThumbnailRail.tsx`
- `frontend/src/components/ReportStudioV2/components/document/DragPreviewOverlay.tsx`
- `frontend/src/components/ReportStudioV2/lib/slideLayouts.ts` (+ test)
- ADR-051 (actualización 2026-09-11 — `documentLocked`, portapapeles del sistema)
- ADR-014 (store único — pendiente de actualizar para reconocer `useDragPreviewStore`)
- ADR-052 (tamaño/orientación de página), ADR-083/128 (export PPTX, plantillas de presentación)
- ADR-092 (identidad visual corporativa pendiente de aplicar a `slideLayouts.ts`)
- ADR-172 (motor de tablas — creció dentro de `TableBlock.tsx` en el mismo movimiento que esta reorganización)
