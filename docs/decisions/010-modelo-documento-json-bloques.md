# ADR-010 — Modelo del documento de informe: JSON tipado de bloques

**Status**: implemented, premisa de texto corregida (ver Actualización 2026-07-17 abajo)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Actualización 2026-07-17 — corrección de auditoría: el texto NO es ProseMirror-JSON en ReportStudioV2

Al auditar el código real para documentar ADR-050 (formato de texto por selección), se
confirmó que la afirmación de este ADR ("el texto rico vive como ProseMirror/Tiptap-JSON
dentro del bloque `text`") **nunca reflejó `useEditorStore.ts`** — el store de
ReportStudioV2 (el que gobierna `reports`, este mismo ámbito) usa y siempre usó
`text.props = { text: string, fontFamily, fontSize, fontColor, bold, italic, underline,
textAlign, lineHeight, listType, ... }`, un string plano con propiedades de estilo por
bloque — nunca un documento ProseMirror. El componente Tiptap (`RichTextEditor.tsx`)
que sí existe en el repo pertenece a un módulo **"Report" v1, distinto y anterior**
(`frontend/src/App.tsx`), fuera de ReportStudioV2 y por lo tanto fuera del ámbito
`reports` que declara este ADR — nunca se integró a Report Studio v2.

La verificación original (2026-07-06) fue incorrecta o verificó contra el módulo
equivocado. ADR-011 (verificado un día después, 2026-07-07) ya reconocía de pasada el
esquema real (`el.props.text`) sin marcar la contradicción explícitamente.

**Decisión confirmada por el negocio**: para `reports`/ReportStudioV2, el modelo vigente
de `text.props` es **string plano + spans de estilo por rango de carácter** (ver
ADR-050), no ProseMirror-JSON. El resto de este ADR (JSON tipado de bloques para
`table`/`sensor`/`kpi`/`chart`/`image`/`map`/`cover`/`toc`, la regla de "nunca HTML como
formato canónico" a nivel documento) permanece vigente sin cambios — la corrección es
específica al campo de texto del bloque `text`. Ver ADR-053 para la única excepción
documentada a "nunca HTML" (contenido de celdas de tabla, acotado).

## Contexto

El informe técnico es el núcleo de valor del producto y debe sostener tres promesas: trazabilidad (cada dato citado linkea a su fuente), WYSIWYG determinista y export reproducible. La representación interna del documento es la decisión más estructural: todo ReportStudio cuelga de ella. El código existente combina Tiptap (texto rico) + Konva (layout/posicionamiento de página) + componentes de bloque (TableBlock, SensorWidget, MiningKpiWidget, etc.), y serializa a un formato `.miningreport`. El análisis del formato real confirmó un esquema por elemento (`id`, `type`, `x/y/width/height`, `zIndex`, `locked`, `props`).

## Decisión

El documento de informe se representa como **JSON tipado de bloques**: un árbol/lista de bloques tipados con posición y propiedades. El **texto rico vive como ProseMirror/Tiptap-JSON dentro del bloque `text`**; los demás bloques (`table`, `sensor`, `kpi`, `chart`, `image`, `map`, `cover`, `toc`) tienen un `props` tipado por tipo. No se usa HTML como formato canónico.

### Tipos de bloque (enum cerrada v0.1)

```jsonc
// elemento base
{ "id": "uuid", "type": "text|table|sensor|kpi|chart|image|map|cover|toc",
  "x": 0, "y": 0, "width": 0, "height": 0, "zIndex": 0, "locked": false,
  "props": { /* tipado por type */ } }
```

- `text.props`: `{ doc: <ProseMirror-JSON>, headingStyle?, listType }` (ver ADR-011 para `headingStyle`).
- `sensor.props` / `kpi.props` / `chart.props`: referencia + snapshot (ver ADR-012).
- `image.props`: `src` (`@ref:binary_N` al exportar), `objectFit`, `alt`.

### Reglas duras
- El `type` de cada bloque pertenece a una enum cerrada; un tipo desconocido se rechaza con error explícito, no se ignora en silencio.
- El texto rico NUNCA se guarda como HTML serializado; siempre como ProseMirror-JSON.
- El esquema del documento está versionado (`manifest.version`); migraciones explícitas entre versiones.

## Consecuencias

### Positivas
- Trazabilidad por-bloque: cada dato citado es un bloque con referencia (ADR-012).
- WYSIWYG determinista y export reproducible (el render parte de datos tipados, no de HTML libre).
- Coincide con lo que el código ya insinúa → menos reescritura.

### Negativas / Trade-offs
- Requiere un esquema tipado y validación (más disciplina que "guardar HTML"). Mitigado: el esquema ya existe parcialmente.
- Edición de texto rico dentro de un bloque exige integrar Tiptap como node/editor embebido (ADR-013).

### Neutras
- El layout absoluto (x/y) lo gestiona Konva (ADR-013); el modelo lo soporta con campos de posición.

## Alternativas descartadas

### Árbol Tiptap/ProseMirror único con node-views
Todo el documento como un solo doc Tiptap, con widgets como node-views. Más simple de editar, pero pierde la capa de layout de página/posicionamiento y complica la paginación WYSIWYG y la trazabilidad por-bloque.

### HTML como formato canónico
Guardar el informe como HTML y exportar por print. Más rápido a corto plazo, pero rompe trazabilidad estructurada, reproducibilidad y WYSIWYG determinista. Inaceptable para un informe firmable/auditable.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/store/useEditorStore.js`
- `Referencias/frontend/src/components/ReportStudioV2/lib/miningReportFormat.js`
- ADR-011 (estructura formal), ADR-012 (binding dato→widget), ADR-013 (Tiptap+Konva)
