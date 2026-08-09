# ADR-011 — Estructura formal del informe: árbol de `sections[]` + `cover`/`toc` serializables + `headingStyle`

## Actualización 2026-07-24 — TOC paginado sin afirmar `sections[]`

ADR-071 fija el índice en página 2 y crea/retira páginas de continuación según
su capacidad real. Editor y visor comparten la misma función de partición.
Esto no implementa el árbol `sections[]`: el modelo vigente continúa siendo
`pages[].elements[]` + `headingStyle`, como ya reconoce el bloque de alcance
revisado de este ADR.

**Status**: implemented, alcance revisado (completado 2026-07-07). El vínculo `headingStyle` que estaba roto ya está cerrado:

1. **`RibbonToolbar` → `onApplyHeadingStyle` (App.tsx)**: al aplicar Título/H1/H2/H3 ahora tagea `props.headingStyle = style.id` en el bloque de texto seleccionado (antes solo cambiaba fontSize/bold/color visualmente, nunca marcaba semánticamente qué era un encabezado). Aplicar "Normal"/"Cita" limpia el tag.
2. **`TableOfContents.tsx::extractHeadings`** tenía un bug independiente descubierto en la verificación: leía `el.content`/`el.text`/`el.headingStyle` — campos que **nunca existieron** en el esquema real (`useEditorStore.ts` guarda el texto en `el.props.text`) — la función estaba efectivamente muerta contra datos reales. Corregido a `el.props?.text`/`el.props?.headingStyle`.
3. **Mismo bug en `exportEngine.ts`** (export DOCX): leía `el.headingStyle` en vez de `el.props?.headingStyle` — los encabezados nunca se exportaban como `<h1>/<h2>/<h3>` reales en Word, solo como párrafos. Corregido.
4. **Unificación**: `PageCanvas.tsx` tenía una SEGUNDA implementación de TOC completamente independiente (listaba la primera línea de CADA bloque de texto, sin distinguir encabezados) que divergía de `TableOfContents.tsx::generateTocData`. Ahora ambas usan la misma función — una sola fuente de verdad para la numeración jerárquica.

**Alcance que sigue sin implementar** (decisión consciente, no bug): no existe un árbol `sections[]` real — el modelo sigue siendo `pages[].elements[]` planas con `headingStyle` como tag plano sobre bloques de texto. Esto alcanza para TOC + numeración jerárquica (que es lo que ADR-019 pedía), pero no da una estructura de árbol navegable/reordenable por sección. Si eso se necesita, requiere una revisión de modelo de datos más profunda (fuera de este fix).
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

La validación del formato real (`.miningreport`) contra los manuales operativos reveló que el modelo de bloques (ADR-010) cubre el cuerpo multipágina pero **no la estructura formal** de un informe técnico minero. Hallazgos concretos: no hay árbol de secciones (`sections[]`), solo páginas planas + texto libre; `cover` (carátula) y `toc` (índice) existen en UI pero **no se serializan** al JSON; y el vínculo `headingStyle` **todavía no está implementado**: la TOC busca `el.headingStyle` pero el store aún guarda el estilo solo en `props`, así que —tal como está hoy— la TOC no detecta secciones. No es un error a corregir sino **funcionalidad pendiente de implementar**.

## Decisión

Extendemos el modelo de ADR-010 con la estructura formal del informe:

1. **Árbol semántico de secciones** (`sections[]`): el documento tiene un árbol de secciones (Capítulo → Subsección → Anexo) que ordena las páginas/bloques y alimenta numeración y TOC.
2. **`cover` y `toc` como tipos de bloque serializables**: la carátula corporativa (código doc, clasificación, logo, autor, fecha) y el índice se persisten en el JSON, no son solo overlay de UI.
3. **`headingStyle` en bloques `text`**: los bloques de texto que actúan como encabezado llevan un campo `headingStyle` (h1/h2/h3) en su esquema tipado. La TOC y la numeración se calculan desde este campo + el árbol de secciones.

### Reglas duras
- `cover` y `toc` se cablean en `App.jsx` para entrar al JSON (hoy `onInsertCoverPage` no está conectado).
- La TOC se genera desde `sections[]` + `headingStyle`, no escaneando estilo dentro de `props` sin contrato.
- Test obligatorio: insertar headings → la TOC los detecta y numera (valida la funcionalidad pendiente).

## Consecuencias

### Positivas
- El informe exportado tiene carátula, índice y secciones reales, como exige el manual operativo.
- Implementa el vínculo `headingStyle`↔TOC que aún no existe, habilitando la detección de secciones.

### Negativas / Trade-offs
- Más complejidad en el modelo (árbol + tipos nuevos). Justificada: es la estructura mínima de un informe formal.

### Neutras
- Numeración, refs cruzadas y "Página X de Y" se resuelven en render/export sobre esta estructura (ver ADR-019).

## Alternativas descartadas

### Mantener páginas planas + texto libre
Es el estado actual; no soporta numeración global, TOC fiable ni anexos. Rechazado por los gaps detectados.

### TOC/cover solo como overlay de UI
Es lo que hay hoy: no viaja en el `.miningreport` ni en el export. Rompe reproducibilidad. Rechazado.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/components/document/TableOfContents.jsx`, `CoverPage.jsx`
- `Referencias/docs/09_Manuales_Operativos/informe_minero_uso_herramientas_dinamico_word.rtf`
- ADR-010 (modelo de bloques), ADR-019 (resolución diferida)
