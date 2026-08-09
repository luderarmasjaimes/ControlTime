# ADR-053 — Estilos visuales de tabla (galería de temas, filas alternadas, bordes, título) y formato por selección en celdas

## Corrección de auditoría 2026-07-27 — QA de certificación, TC-FMT-07/TC-RPT-06

Al certificar el workflow completo de un informe (borrador → firmado →
archivado) con una tabla que tenía negrita aplicada a una celda
(`TableBlock.tsx` guarda el contenido de celda como HTML enriquecido y
saneado — `sanitizeRichHtml`, `el.innerHTML = safe` —, no texto plano; así
es como Word/Excel manejan negrita por celda), el visor de solo lectura
(`ReadOnlyViewer.tsx`, usado también como base del export PDF) mostraba el
texto literal `<b>Dato 1.1</b>` en vez de "Dato 1.1" en negrita: la celda
se renderizaba como `{cell}` (children de React, que escapa HTML) en vez
de interpretar el HTML ya saneado. Cualquier informe con formato por celda
en una tabla se veía roto en modo lectura y en el PDF exportado — defecto
real, no visto antes porque el QA previo de tablas (ver arriba) solo
verificó el editor en vivo, nunca el visor de solo lectura.

**Corrección**: la celda ahora se renderiza con
`dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(String(cell ?? '')) }}`
— se vuelve a sanear en el render (no solo confiar en lo que ya se guardó)
por defensa en profundidad, mismo criterio que ya usa `TableBlock.tsx` al
escribir. Verificado en vivo: reconstruido y redesplegado `beemetry-web`,
confirmado en el visor de solo lectura de un informe real (archivado
durante el mismo QA, ver ADR-017/018) que "Dato 1.1" ahora se ve en
negrita real, no como texto con etiquetas.

De paso, esta misma prueba confirmó TC-RPT-06 (un informe `archived` ya no
admite edición): el modal de administración deshabilita el botón "Editar"
para informes archivados (solo quedan "Leer"/"Enviar"/"Eliminar"), y un
intento de guardar contenido igualmente fue rechazado por el backend
(`PUT /api/reports/:id` → 400, `invalid_workflow_transition`) — el dato
mostrado en el visor de solo lectura nunca reflejó el intento de edición.

## Actualización 2026-07-25 (retroactiva) — control funcional de tabla y dos bugs reales cerrados

Este ADR documentaba solo el *estilo* de la tabla; el *control* funcional
(redimensionar columnas a mano, autoajuste al ancho del texto, insertar/
eliminar filas y columnas, crecimiento automático de ancho/alto al agregar
contenido, auto-alto por celda con varias líneas) se implementó después
(2026-07-22) a pedido explícito del usuario ("no deja modificar manualmente
el ancho... debe de incrementarse automáticamente... en un momento
determinado se bloqueo la tabla") y nunca quedó documentado — brecha cerrada
retroactivamente aquí, mismo `TableBlock.tsx`, mismo tipo `table`, sin
decisión nueva de arquitectura.

**Qué se agregó**: `element.props.colWidths?: number[]` (anchos persistidos
por columna); tiradores de resize por columna (arrastrar redistribuye entre
columnas adyacentes; el último tirador cambia el ancho total); `autoFitColumns()`
(mide con `<canvas>`/`measureText` y ajusta cada columna al texto más ancho);
botones Insertar/Eliminar Fila/Columna; `ResizeObserver` que reporta el
tamaño natural (`totalWidth` de `colWidths` + `scrollHeight`) para que la
tabla crezca sola cuando el contenido no cabe.

**Bug 1 — bucle de versión descontrolado (v1→v103)**: `colWidths` no se
persistía (se recalculaba cada render desde `containerWidth`) y el reporte de
tamaño natural usaba `Math.max(totalWidth, el.scrollWidth)` — el ancho medido
del DOM realimentaba `element.width`, que realimentaba `containerWidth`, que
realimentaba `colWidths` recalculado, divergiendo hasta topar con el borde de
página. Cerrado: `colWidths` se persiste una sola vez a `props` (efecto
guardado con ref), desacoplándose de `containerWidth` tras el primer render;
el reporte de tamaño usa `totalWidth` (suma de `colWidths` ya persistidos),
nunca una medición del DOM. Verificado: versión estable (sin incrementar) en
una espera de 2s tras el fix, donde antes subía sin parar.

**Bug 2 — "se bloqueó la tabla, no dejó editar ni mover ni borrar"**: la regla
CSS `.report-canvas-html-shield * { pointer-events: none !important; }`
(preexistente, fuerza clic-a-través a Konva salvo en modo edición por doble
clic) bloqueaba *cualquier* `pointerEvents:'auto'` inline no-`!important` en
los controles nuevos (tiradores, botones de fila/columna) — la misma regla ya
explicaba por qué editar el texto de una celda siempre había requerido doble
clic. Cerrado con una regla más específica con `!important` que "perfora" el
shield solo para esos controles nuevos, sin tocar la regla general. Esto da
una vía de escape funcional independientemente del estado de
`canvasTableEditId`, aunque no se pudo reproducir a voluntad el bloqueo total
original para confirmar la causa exacta al 100%.

Ambos hallazgos y los controles nuevos se verificaron en navegador real (sin
errores de consola, versión de documento estable tras el fix).

## Actualización 2026-07-24 — semántica y tamaño natural (ADR-070)

Las tablas ahora persisten anchos de columna, crecen hasta su tamaño natural
y comparten un coloreado semántico determinístico entre editor y visor. Las
plantillas mineras de ADR-070 reutilizan el mismo tipo `table`; no se agrega
HTML como formato canónico ni una familia paralela de tablas.

**Status**: implemented (verificado 2026-07-17)
**Fecha**: 2026-07-17
**Autores**: EC
**Ámbito**: reports

## Contexto

El bloque `table` solo exponía color de borde, fondo de cabecera, padding y tamaño de texto — sin título, sin filas alternadas, sin control de grosor/estilo de borde, y sin poder aplicar negrita/color/subrayado a una porción del texto dentro de una celda (todo el contenido de la celda usaba un único estilo).

## Decisión

### Estilos visuales
`table.props` gana: `title` (leyenda opcional sobre la tabla), `borderWidth`/`borderStyle` (antes solo color), `headerTextColor`/`headerBold` (independiente del cuerpo), `cellAlign`, y `bandedRows`/`bandColor` (filas alternadas). Se agrega una **galería de 6 temas de color** con vista previa en miniatura (3 barras: cabecera + 2 filas) que aplica de un clic un conjunto coherente de `borderColor`/`headerBg`/`headerTextColor`/`bandColor` — equivalente a la galería "Diseño de tabla" de Word.

### Formato por selección en celdas
Cada celda es un `contentEditable` (no un `<textarea>` como el bloque de texto principal — las celdas son cortas y no participan del motor de ajuste de texto alrededor de objetos de ADR-049, así que no hace falta el mecanismo de spans+overlay de ADR-050). Una barra flotante de formato aparece sobre la celda enfocada y aplica negrita/cursiva/subrayado/tamaño/color a la selección real dentro de la celda vía `document.execCommand` sobre el `contentEditable` — técnica estándar y probada para texto enriquecido acotado a un contenedor corto, coherente con el enfoque de ONLYOffice para edición de celda.

El contenido de la celda se gestiona **imperativamente vía ref**, no como prop controlada de React: un `contentEditable` cuyo `innerHTML` se reaplica desde props en cada render pierde la posición del cursor y colapsa la selección al escribir/formatear (bug clásico y bien documentado de `contentEditable` en React). El DOM es la fuente de verdad mientras se edita; el valor externo solo se siembra al montar la celda y se lee hacia afuera en `input`/`blur`.

### Reglas duras
- El HTML de cada celda (con los `<b>`/`<i>`/`<u>`/`<font>` que produce `execCommand`) se guarda tal cual en `rows[ri][ci]` — es el único bloque del documento donde se persiste HTML en vez de estructura tipada, una excepción consciente y acotada (ver Alternativas descartadas).
- La paleta de color de la barra de celda reutiliza `REPORT_COLOR_SWATCHES` (ADR-050) — una sola fuente de verdad de colores en toda la aplicación.

## Consecuencias

### Positivas
- Cierra la brecha completa entre lo que el negocio pedía (tablas visualmente configurables, con texto enriquecido por celda) y lo que había.
- Reutiliza patrones ya probados (paleta de color, técnica de formato por selección) en vez de inventar un tercer mecanismo.

### Negativas / Trade-offs
- El HTML de celda es una excepción real al principio de "nunca HTML como formato canónico" (ADR-010) — se acota explícitamente a **solo el contenido de celdas de tabla**, no al documento en general, y se documenta aquí como excepción consciente, no como precedente para extenderlo a otros bloques.
- `document.execCommand` está formalmente deprecado en el estándar web, aunque sigue implementado y funcional en todos los navegadores evergreen (Chrome/Edge/Firefox/Safari) — riesgo bajo pero real a largo plazo si algún navegador lo retira. Alternativa (una librería de edición rica dedicada) se evaluó y se descartó por ahora, ver abajo.

## Alternativas descartadas

### Modelo de spans (igual que ADR-050) también para celdas de tabla
Más consistente arquitectónicamente (un solo mecanismo de formato por selección en toda la app), pero las celdas no necesitan el motor de wrap-around-objetos ni el autosize de página que justifican la complejidad de spans+overlay fantasma en el bloque de texto principal — `contentEditable`+`execCommand` es sencillo, probado, y suficiente para el caso de uso (texto corto, sin envolver alrededor de nada). Se prefirió no pagar la complejidad de spans donde no aporta valor real.

### Librería de edición rica dedicada (TipTap/ProseMirror/Slate) para celdas
Evita la dependencia de `execCommand`, pero introduce una dependencia nueva, bundle más pesado, y una curva de integración con el modelo de `rows: string[][]` existente — desproporcionado para el alcance de "texto corto dentro de una celda". Queda como opción a futuro si `execCommand` se retira de los navegadores.

## Referencias
- `frontend/src/components/ReportStudioV2/components/document/TableBlock.tsx`
- `frontend/src/components/ReportStudioV2/components/shared/ColorPalette.tsx` (`REPORT_COLOR_SWATCHES`)
- `frontend/src/components/ReportStudioV2/components/layout/RightInspector.tsx` (`TableInspector`, galería de temas)
- ADR-010 (excepción documentada al modelo de bloques tipados), ADR-050 (mismo origen de paleta de color)
