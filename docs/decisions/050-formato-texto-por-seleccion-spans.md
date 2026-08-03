# ADR-050 — Formato de texto por selección: modelo de spans sobre string plano (reemplaza la premisa ProseMirror-JSON de ADR-010/013)

## Corrección de auditoría 2026-07-27 (2) — QA de certificación, TC-FMT-05

Los botones del ribbon "Crear lista con viñetas" / "Crear lista numerada"
(`RibbonToolbar.tsx`) NO tenían `onClick` — eran decorativos, no hacían
nada al hacer clic. La única forma real de aplicar una lista era un atajo
de teclado oculto y no documentado (`Ctrl+Shift+7`/`8`/`0` dentro de
`PageCanvas.tsx`, función local `applyListToText`), inalcanzable desde la
UI visible. Además, el `<select>` de "Lista" en `RightInspector.tsx` sí
tenía `onChange`, pero solo guardaba `props.listType` sin mutar el texto
— no insertaba ni quitaba los marcadores "• "/"1. " —, y el atajo de
teclado para quitar la lista (`Ctrl+Shift+0`) tenía el mismo defecto
(dejaba los marcadores viejos como texto literal).

**Corrección**: se extrajo la lógica a `lib/listFormatting.ts`
(`applyListToText`/`stripListMarkers`, reutilizada por `PageCanvas.tsx`,
`RightInspector.tsx` y el nuevo handler del ribbon), se conectó
`onSetListStyle`/`currentListStyle` en `RibbonToolbar.tsx` → `App.tsx`
(mismo patrón que `onSetAlignment`, aplica a todo el bloque vía
`handleUpdateSelectedProps`), y se corrigió el atajo `Ctrl+Shift+0` para
quitar los marcadores en vez de solo cambiar el flag. El marcador es
texto literal (no `::before` CSS) porque el bloque puede renderizarse
como `<Text>` de Konva, que no soporta pseudo-elementos por línea.
Verificado en vivo (rebuild + redeploy de `beemetry-web`): viñetas →
numerada → sin lista, cada cambio reemplaza limpiamente el marcador
anterior sin dejar residuos, sobre un bloque de 3 líneas.

## Corrección de auditoría 2026-07-27 (QA de certificación, TC-FMT-01)

Durante la certificación QA del módulo de reportabilidad (catálogo
`Catalogo_Casos_Prueba_QA_2026-07-21.md`, TC-FMT-01) se encontró y corrigió
un defecto real en `applyStyleToRange` (`lib/textSpans.ts`): la lógica de
toggle de `bold`/`italic`/`underline` (pensada para los botones Negrita/
Cursiva/Subrayado, que siempre piden `{ propiedad: true }` con intención de
"alternar") se disparaba para CUALQUIER valor definido de esas claves —
incluido `false` — porque la condición era `patch[key] === undefined`, no
"¿es un toggle real?". Como `applyHeadingStyleToSelection` (`PageCanvas.tsx`)
reutiliza la misma función pasando los valores LITERALES del preset de
encabezado (p.ej. H2 = `{ bold:true, italic:false, underline:false }`, ver
`lib/headingStyles.ts`), el toggle ignoraba el `false` solicitado y lo
invertía a `true` si el rango no estaba ya activo — en la práctica, aplicar
cualquier encabezado (H1-H6/Título) a una selección de texto SIEMPRE dejaba
esa selección en cursiva y subrayado, sin importar que el preset pidiera
explícitamente lo contrario.

Reproducido de forma 100% determinista en un elemento de texto recién
creado (sin historial previo): aplicar "Heading 2" a la selección "TC-TXT"
producía `font-style: italic; text-decoration: underline` en el span,
verificado inspeccionando el `style` inline del `<span>` del overlay
fantasma (no solo el CSS computado, para descartar herencia/artefactos de
render) — confirmando que la corrupción vivía en los datos (`props.spans`),
no en el renderizado.

**Corrección**: `applyStyleToRange` acepta ahora un parámetro opcional
`options?: { toggle?: boolean }`; con `toggle: false` usa los valores del
`patch` de forma literal, sin la heurística de alternancia. `PageCanvas.tsx`
propaga esta opción a través de `applyFormatToSelection`, y
`applyHeadingStyleToSelection` la invoca con `{ toggle: false }`. Los
botones directos de Negrita/Cursiva/Subrayado (`applyFormatToSelection({
bold: true })` etc.) no pasan `options`, por lo que conservan el
comportamiento de alternancia original — verificado sin regresión: negrita
sobre una palabra, luego cursiva+subrayado sobre otra palabra no adyacente,
sin ningún cruce de estilos entre rangos.

Corregido, reconstruido (`docker compose build frontend`) y verificado en
vivo contra el contenedor `beemetry-web` recién desplegado (no contra un
servidor de desarrollo con HMR — este proyecto sirve `beemetry-web` como
build de producción vía nginx, sin `@vite/client`; un cambio de código solo
se refleja tras rebuild + `--force-recreate` del contenedor `frontend`).

---

**Status**: implemented (verificado 2026-07-17: `lib/textSpans.ts`, `PageCanvas.tsx`, `activeTextFormatBridge.ts`, `RightInspector.tsx`, `RibbonToolbar.tsx`)
**Fecha**: 2026-07-17
**Autores**: EC
**Ámbito**: reports
**Relación**: corrige la premisa de ADR-010/013 (ver bloque de actualización agregado a ambos el 2026-07-17); no las revierte por completo — ver más abajo.

## Contexto

El negocio pidió explícitamente poder seleccionar una porción de texto dentro de un bloque (ej. una sola palabra) con el mouse y aplicarle negrita/cursiva/subrayado/color/tamaño/fuente **sin afectar el resto del bloque** — comportamiento estándar de Word. El modelo real de `text.props` en `useEditorStore.ts` es (y ya era, desde antes de esta sesión) un **string plano** (`text: string`) más un único juego de props de estilo por bloque (`bold`, `italic`, `fontColor`, `fontSize`, `fontFamily`) — no ProseMirror-JSON como documenta ADR-010/013. Migrar a Tiptap/ProseMirror en este punto habría significado descartar toda la maquinaria de rendimiento ya construida sobre el modelo de string plano (medidor de texto cacheado, autosize, guardia de composición IME, debounce de tecleo, motor de ajuste de texto alrededor de objetos de ADR-049) — un costo desproporcionado frente al pedido real del negocio.

## Decisión

Se agrega una capa de **spans** — rangos `[start, end)` de carácter sobre el MISMO string plano — cada uno con su propio parche de estilo (`bold?`, `italic?`, `underline?`, `color?`, `fontSize?`, `fontFamily?`). Rangos sin span cubriéndolos heredan el estilo "base" del bloque (las props de siempre) — datos guardados antes de este ADR renderizan idéntico (spans vacío = comportamiento histórico, retrocompatible sin migración).

### Mecanismo (todo en `lib/textSpans.ts` + `PageCanvas.tsx`)
- **Edición**: el `<textarea>` existente (invisible en texto, con `caretColor` visible) sigue siendo la única superficie de tecleo/IME/dictado — sin cambios ahí. Un overlay "fantasma" (`div` posicionado exactamente encima, `pointer-events:none`) pinta el texto real con el estilo de cada span, para que la edición se vea WYSIWYG con formato mixto.
- **Selección**: se lee `textarea.selectionStart/selectionEnd` (nativo del navegador, sin reinventar hit-testing) al aplicar un formato.
- **Aplicar formato**: `applyStyleToRange()` particiona el texto en segmentos de estilo uniforme, aplica el parche a los segmentos dentro del rango (con lógica de toggle para negrita/cursiva/subrayado: si TODO el rango ya tiene la propiedad activa, se desactiva; si no, se activa para todo el rango — igual que Word), y reconstruye una lista de spans limpia (sin solapes, sin tramos redundantes iguales al estilo base).
- **Recolocación al escribir/dictar/corregir con IA**: `remapSpansForTextChange()` usa diff de prefijo/sufijo común entre el texto viejo y el nuevo para desplazar/recortar spans cuando el texto cambia — cubre correctamente el caso dominante (edición de una zona acotada) sin un motor de OT/CRDT real.
- **Render estático** (bloque no en edición, sin objeto solapado forzando ajuste de texto): un `Html` overlay con los mismos segmentos de estilo — WYSIWYG idéntico entre edición y vista estática.
- **Render con ajuste de texto activo** (ADR-049): el motor de wrap se extendió para fragmentar cada palabra en los límites de un span y medir cada fragmento con su estilo efectivo — ver Extensión 2026-07-17 en ADR-049.
- **Puente Ribbon↔selección** (`activeTextFormatBridge.ts`): los botones de la barra superior (Negrita/Cursiva/Subrayado/Color/Tamaño/Fuente, en `App.tsx`/`RibbonToolbar.tsx`) intentan primero aplicar a la selección activa dentro del editor de texto abierto; si no hay editor abierto o la selección está colapsada, caen al comportamiento histórico de "todo el bloque" (`handleUpdateSelectedProps`) — sin este puente, el ribbon SIEMPRE aplicaba a todo el bloque sin importar qué tuviera seleccionado el usuario (bug real encontrado y corregido en esta misma sesión).

### Reglas duras
- `props.spans` es **opcional y aditivo** — su ausencia es 100% equivalente al comportamiento pre-ADR-050.
- El formato por selección requiere una selección real (`start !== end`); con el cursor colapsado, los controles de formato siguen aplicando a todo el bloque (comportamiento histórico), igual que un editor sin nada resaltado.
- El interlineado (`lineHeight`) sigue siendo una propiedad de bloque/párrafo, NO un span — es coherente con cualquier procesador de texto (el espaciado entre líneas no es una propiedad de carácter).

## Reconciliación con ADR-010 / ADR-013

ADR-010 y ADR-013 (ambos "verificado 2026-07-06") declaran como regla dura que el texto rico se guarda como ProseMirror-JSON vía Tiptap. Esto **nunca reflejó el código real** de `ReportStudioV2` — el módulo "Report v2" (`useEditorStore.ts`, el store activo desde el inicio del proyecto de reportabilidad) usa string plano desde su primera versión; Tiptap (`RichTextEditor.tsx`, gobernado por esos ADR) es un componente de un módulo **distinto y anterior** ("Report" v1, `frontend/src/App.tsx`, fuera del ámbito de ReportStudioV2) que nunca se integró a Report Studio v2. ADR-011 (verificado un día después, 2026-07-07) ya reconocía de pasada el esquema real (`el.props.text`) sin marcar la contradicción explícitamente.

Se agregó un bloque de "Actualización 2026-07-17" a ADR-010 y ADR-013 (sin borrar el texto original, según la convención de este log) documentando que, **para ReportStudioV2 específicamente**, el modelo vigente es string plano + spans (este ADR), no ProseMirror-JSON — decisión confirmada explícitamente por el negocio tras plantearse la contradicción.

## Consecuencias

### Positivas
- Cumple el pedido de negocio (formato por palabra/selección) sin descartar meses de trabajo de rendimiento sobre el modelo de string plano.
- Cero migración de datos: informes guardados antes de este ADR siguen funcionando sin cambios.
- El código y la documentación quedan alineados (antes divergían silenciosamente).

### Negativas / Trade-offs
- `remapSpansForTextChange` es un diff de prefijo/sufijo, no un motor de transformación operacional real — en ediciones muy complejas y simultáneas (fuera de alcance real: un solo usuario edita un bloque de texto a la vez) podría, en un caso extremo, reubicar un span de forma subóptima. No observado en pruebas.
- El auto-tamaño del cuadro de texto no considera tamaños de fuente por span (ver limitación documentada en ADR-049).

### Neutras
- La paleta de color se amplió de 20 a 40 colores con mejor contraste (`ColorPalette.tsx`, `REPORT_COLOR_SWATCHES`) como parte del mismo trabajo — la usan tanto el editor de texto como las celdas de tabla (ADR-053) y el selector de color del ribbon.
- El interlineado ganó presets rápidos (Sencillo/1.15/1.35/1.5/Doble) tanto en el panel derecho como en el ribbon — antes el botón del ribbon no tenía `onClick` (bug real, corregido).

## Alternativas descartadas

### Migrar el bloque `text` a Tiptap/ProseMirror-JSON real (cumplir ADR-010/013 tal cual)
Habría dado formato por selección "gratis" (Tiptap lo soporta nativamente), pero exige reescribir desde cero: medición/autosize, guardia IME, debounce de tecleo, y el motor de ajuste de texto alrededor de objetos (ADR-049) — todo eso asume hoy un string plano, no un doc ProseMirror. Costo de varios días, sin beneficio adicional para el pedido real del negocio. Rechazado.

### `contentEditable` + `document.execCommand` para el bloque de texto completo (no solo celdas de tabla)
Es lo que se usa en las celdas de tabla (ADR-053, más simple por ser celdas cortas sin ajuste-de-texto-alrededor-de-objetos ni autosize de página). Para el bloque de texto principal se descartó porque debía convivir con el motor de wrap-around-imagen (ADR-049) y el autosize de página — mezclar `contentEditable` con el cálculo de rangos permitidos por línea habría sido más frágil que extender el motor de string+spans ya existente.

## Referencias
- `frontend/src/components/ReportStudioV2/lib/textSpans.ts`
- `frontend/src/components/ReportStudioV2/lib/activeTextFormatBridge.ts`
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx`
- `frontend/src/components/ReportStudioV2/components/shared/ColorPalette.tsx`
- ADR-010, ADR-013 (premisa corregida vía bloque de actualización), ADR-049 (motor de wrap extendido), ADR-053 (mismo mecanismo aplicado a celdas de tabla)
