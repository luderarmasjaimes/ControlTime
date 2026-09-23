# ADR-051 — Copiar/pegar de objetos en el lienzo (portapapeles interno, no del sistema operativo)

> **Actualización 2026-09-11**: se retira la regla dura "no se integra con
> el portapapeles del sistema operativo" — pedido explícito del usuario de
> la aplicación, que necesita copiar objetos fácilmente **entre informes
> técnicos distintos** (pestañas/sesiones separadas), no solo dentro del
> mismo lienzo. El diseño original de este ADR quedaba corto para ese caso
> real de uso; se prioriza la facilidad pedida sobre la simplicidad de
> implementación que motivó la decisión original.
>
> `lib/elementsClipboard.ts` ahora serializa la selección a HTML real y la
> escribe con `navigator.clipboard.write`/`ClipboardItem`, con dos capas:
> (1) un comentario HTML invisible con los elementos originales completos en
> JSON (`{ ownerUserId, groups }`, base64) que permite reconstruir el bloque
> EXACTO (spans de texto, fórmulas de tabla, binding de sensor/KPI incluido)
> al pegar de vuelta dentro de Beemetry; (2) markup visual real (`<p>`/`<table>`/
> `<img>`) para que el pegado en Word/Excel/PowerPoint/Google Docs se vea
> razonablemente fiel — esa es la única capa que una app externa ve.
>
> **Regla dura nueva, para no perder la garantía que este ADR protegía**: un
> bloque de datos EN VIVO (`sensor`/`kpi`/`sensor_multi_chart`/`chart`) solo
> se reconstruye "vivo" (con su binding real, jalando telemetría) cuando
> **la sesión que pega es la misma que copió** (`ownerUserId` del marcador
> coincide con `getSession().userId`) **y** el informe destino está
> editable (`useEditorStore.documentLocked === false`, ver más abajo). En
> cualquier otro caso — otro usuario, u otro informe ya firmado/archivado —
> se degrada a una nota de texto estática sin binding
> (`stripLiveBindingForCrossUserPaste`), exactamente el mismo trato que ya
> recibía al copiar hacia una app externa: el sistema nunca compone ni
> inventa un valor de sensor por su cuenta, y un widget vivo de un informe
> ajeno no debe aparecer mezclado "en vivo" en el informe de otro autor sin
> que nadie lo pida explícitamente. Verificado con test
> (`elementsClipboard.test.ts`).
>
> De paso, y motivado por el mismo pedido, se agregó un guard de defensa en
> profundidad que no existía: `useEditorStore.documentLocked` bloquea
> edición/deshacer/pegado cuando el informe cargado está `signed`/`archived`
> (ver ADR-018/079) — antes esa regla solo la aplicaba el backend
> (`409 report_immutable`), el cliente dejaba editar sin aviso.
>
> No se edita el texto original de este ADR más abajo (convención de este
> log) — la "Alternativa descartada" de integrar la Clipboard API queda
> superada por esta actualización; el resto de las reglas duras originales
> (no copiar `header`/`footer`/`cover`) sigue vigente sin cambios.

**Status**: implemented — actualizado 2026-09-11 (integración con el portapapeles del sistema operativo, ver arriba)
**Fecha**: 2026-07-17
**Autores**: EC
**Ámbito**: reports

## Contexto

El negocio pidió poder seleccionar un objeto del lienzo (texto, imagen, tabla, gráfico, KPI, sensor, mapa), copiarlo, y pegarlo de nuevo en el mismo informe — un flujo básico de edición que no existía: seleccionar un bloque y presionar Ctrl+C/Ctrl+V no producía ningún efecto.

## Decisión

Se implementa copiar/pegar **dentro del lienzo** (un "portapapeles" propio de la aplicación, en memoria/estado del editor) — no se integra con el portapapeles real del sistema operativo ni permite copiar entre pestañas/ventanas del navegador. Al pegar, el bloque se clona con un `id` nuevo y se desplaza levemente respecto al original (mismo patrón visual que `duplicatePage`/duplicar página) para que sea evidente que es una copia y no quede exactamente superpuesto al original.

Disponible por atajo de teclado (Ctrl+C/Ctrl+V, con el bloque seleccionado y foco fuera de un campo de texto) y desde el menú contextual (clic derecho sobre el objeto seleccionado) — mismo criterio de "doble acceso rápido" que el selector de ajuste de texto (ADR-049).

### Reglas duras
- ~~Copiar/pegar no cruza el límite del informe abierto — no hay portapapeles persistente entre informes distintos ni entre sesiones.~~ **Retirada 2026-09-11, ver actualización arriba.**
- Los bloques de plataforma fijos (`header`/`footer`/`cover`, ADR-046/048) no son copiables — no tiene sentido duplicar un elemento que ya se genera automáticamente por página.

## Consecuencias

### Positivas
- Cubre el flujo de edición esperado sin la complejidad de integrar con la Clipboard API del navegador (que además requiere permisos y tiene soporte inconsistente para tipos de dato ricos como "un bloque JSON de este editor").

### Negativas / Trade-offs
- ~~No se puede copiar un objeto de un informe y pegarlo en otro informe distinto (abrir otra pestaña/ventana) — limitación aceptada, no pedida por el negocio a la fecha.~~ **Ya no aplica, ver actualización 2026-09-11.**

## Alternativas descartadas

> **Nota 2026-09-11**: la alternativa de abajo ("Integración con la Clipboard
> API del sistema operativo") queda **adoptada**, no descartada — ver la
> actualización al inicio de este ADR. Se conserva el texto original sin
> editar por trazabilidad (convención de este log).

### Integración con la Clipboard API del sistema operativo (`navigator.clipboard`)
Permitiría copiar/pegar entre informes distintos (pestañas separadas), pero exige serializar el bloque a un formato que el sistema operativo entienda (o usar `ClipboardItem` con un MIME type custom, soporte limitado entre navegadores) y gestionar permisos de portapapeles — complejidad no justificada por el pedido real ("copiar y pegar en el mismo lienzo").

## Referencias
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (`documentLocked`, `pasteSelection`, `undoAction`/`redoAction`, `addElement`/`updateElement`/`removeElement(s)`)
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx` (menú contextual, atajos de teclado, `onSystemPaste`)
- `frontend/src/components/ReportStudioV2/lib/elementsClipboard.ts` (serialización al portapapeles del sistema, `ownerUserId`, `stripLiveBindingForCrossUserPaste`) — agregado 2026-09-11
- ADR-046, ADR-048 (elementos de plataforma fijos, no copiables)
- ADR-018, ADR-079 (inmutabilidad de informes `signed`/`archived` — `documentLocked` la replica en el cliente)
