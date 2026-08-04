# ADR-055 — Editor de texto: indicador de selección propio (no nativo del navegador)

**Status**: implemented (2026-07-18). Verificado en vivo end-to-end
(interacción real de mouse/teclado, no solo eventos sintéticos): indicador
de selección escalando correctamente de 16px a 26px+, resaltado del ribbon
aplicado a bloque completo, ciclo de mayúsculas aplicado a selección y a
bloque completo, Tabla de Contenidos sigue detectando encabezados por
selección tras estos cambios.
**Fecha**: 2026-07-18
**Autores**: EC
**Ámbito**: reports

## Contexto

Bug real reportado: el área resaltada/seleccionada "se perdía" visualmente
al agrandar el tamaño de fuente de una porción seleccionada del texto (con
los botones A+/A- de la barra flotante de ReportStudioV2).

Causa raíz: el editor de texto de `PageCanvas.tsx` usa una técnica de doble
capa — un `<textarea>` invisible que captura la interacción nativa del
navegador (cursor, selección, teclado) y un `<div>` superpuesto que pinta el
formato real por tramo (spans, ver ADR-050). El `<textarea>` HTML solo
admite **un** tamaño de fuente uniforme para todo su contenido. En cuanto
una porción seleccionada tenía su propio tamaño de fuente (distinto al del
resto del bloque), el rectángulo de selección **nativo** del navegador —
atado al tamaño uniforme/pequeño del `<textarea>` — quedaba desalineado y
diminuto respecto al texto real (mucho más grande) que se veía en la capa
de encima. El usuario veía el texto grande sin ninguna selección visible
sobre él.

Este bug expuso además una asimetría de diseño: negrita/cursiva/subrayado/
color/tamaño/fuente ya seguían el criterio "aplicar a la selección si existe,
si no a todo el bloque" (ADR-050), pero el resaltado (highlight) y el ciclo
de mayúsculas/minúsculas ("Aa", estilo Word Mayús+F3) todavía no estaban
disponibles bajo ese mismo criterio.

## Decisión

**Reemplazar la selección nativa del navegador por un indicador de
selección propio**, calculado dentro del mismo overlay que ya resuelve el
tamaño real por tramo — por lo que hereda el escalado correcto
automáticamente sin duplicar lógica de medición. La selección nativa se
oculta con `::selection { background: transparent }` (`styles.css`); el
indicador real lo dibuja `getLiveSelectionRange` + split de segmentos del
overlay (`PageCanvas.tsx`). El `<textarea>` sigue siendo la fuente de verdad
para la posición del cursor/selección lógica (offsets de caracteres); solo
el **dibujado** visual de esa selección deja de depender de su render nativo.

**Resaltado y ciclo de mayúsculas llevados al mismo criterio "selección si
existe, si no todo el bloque"** que ya usaban el resto de controles de
formato de texto:
- Nuevo campo persistido `TextProps.highlightColor` (resaltado BASE de todo
  el bloque cuando no hay selección activa) — distinto del ya existente
  `TextStyleSpan.highlightColor` (resaltado de una porción seleccionada) y
  distinto de `props.backgroundColor` (fondo de todo el cuadro de texto).
- Nuevo canal de puente ribbon↔selección
  (`registerActiveCaseHandler`/`tryApplyCaseToActiveTextSelection` en
  `activeTextFormatBridge.ts`) específico para el botón "Aa": a diferencia
  de negrita/color/tamaño (que solo cambian un atributo de estilo,
  `Partial<BaseTextStyle>`), el ciclo de mayúsculas **muta el texto en sí**
  — el puente de estilo existente no transporta cambios de contenido, así
  que hizo falta un canal aparte en vez de reusar el mismo tipo de mensaje.

De paso se encontró y corrigió un byte nulo (`\0`) real dentro de una
plantilla de cadena de `PageCanvas.tsx` (`measureWordCached`) — corrupción
de una edición anterior sin efecto funcional visible, reemplazada por el
espacio correcto.

## Consecuencias

### Positivas
- El indicador de selección ahora es visualmente correcto en cualquier
  combinación de tamaños de fuente por tramo, sin caso especial.
- Resaltado y mayúsculas/minúsculas quedan consistentes con el resto de los
  controles de formato (mismo modelo mental para el usuario: "actúa sobre lo
  que tengo seleccionado, o sobre todo el bloque si no seleccioné nada").

### Negativas / Trade-offs
- Un segundo canal de puente (`activeTextFormatBridge.ts`) además del ya
  existente para parches de estilo — más superficie de código a mantener
  que si mayúsculas hubiera podido reusar el canal de estilo, pero mutar
  texto y parchear estilo son operaciones de forma distinta y forzarlas al
  mismo canal habría sido más frágil.
- El `<textarea>` invisible sigue siendo la única fuente de verdad para la
  posición lógica de la selección — este ADR no cambia esa dependencia,
  solo el dibujado visual sobre ella.

## Alternativas descartadas

### Forzar un único tamaño de fuente por `<textarea>` (limitar el bug en vez de arreglarlo)
Habría evitado el desalineamiento visual pero elimina la posibilidad de
formato mixto de tamaño por selección (ADR-050), un requisito de negocio ya
entregado y verificado — se descarta.

### Reusar el canal de estilo existente para el botón "Aa"
Mutar el contenido del texto (mayúsculas/minúsculas) no es un
`Partial<BaseTextStyle>` — forzar ese contrato habría requerido un caso
especial dentro del mismo tipo de mensaje, más frágil que un canal separado
con su propio contrato explícito.

## Referencias
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx`
  (`getLiveSelectionRange`, `measureWordCached`)
- `frontend/src/components/ReportStudioV2/styles.css` (`::selection`)
- `frontend/src/components/ReportStudioV2/lib/activeTextFormatBridge.ts`
- ADR-050 (formato de texto por selección — spans; el criterio "selección si
  existe, si no todo el bloque" que este ADR extiende a resaltado/mayúsculas)
- ADR-049 (ajuste de texto alrededor de objetos, mismo módulo de edición)
