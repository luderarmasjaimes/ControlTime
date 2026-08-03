# ADR-013 — Editor: Tiptap/ProseMirror para texto + Konva para layout de página

**Status**: implemented, alcance corregido (ver Actualización 2026-07-17 abajo)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Actualización 2026-07-17 — corrección de auditoría: Tiptap no se usa en ReportStudioV2

La verificación original (2026-07-06) confirmó Tiptap contra `RichTextEditor.tsx`, pero
ese componente pertenece al módulo **"Report" v1** (`frontend/src/App.tsx`), un módulo
distinto y anterior a **ReportStudioV2** ("Report v2", el módulo activo de `reports` que
gobiernan estos ADR). `PageCanvas.tsx` de ReportStudioV2 sí usa `react-konva` como aquí
se documenta (esa mitad del ADR es correcta), pero el bloque de texto de Report v2
**nunca usó Tiptap** — usa un `<textarea>` propio con medición cacheada, autosize,
guardia de composición IME, y (desde el 2026-07-17) formato por selección vía spans
sobre string plano. Ver ADR-050 para el mecanismo completo y el razonamiento de por qué
no se migró a Tiptap para cumplir este ADR tal cual (costo de reescribir toda la
maquinaria de rendimiento ya construida, sin beneficio adicional real).

**Decisión confirmada por el negocio**: para ReportStudioV2, "Konva para layout de
página" permanece vigente; "Tiptap/ProseMirror para texto" queda reemplazado por el
modelo de ADR-050 (string plano + spans). La sección de Konva de este ADR no cambia.

## Contexto

ReportStudio necesita dos capacidades distintas: edición de texto rico (estilos, listas, encabezados, corrección) y layout de página tipo "documento/presentación" con posicionamiento de bloques (texto, tablas, widgets, imágenes, mapas). El código existente ya resuelve esto con Tiptap (texto) y Konva (canvas de página, `PageCanvas.jsx`), consistente con el modelo de bloques de ADR-010.

## Decisión

El **texto rico se edita con Tiptap/ProseMirror** (serializado como ProseMirror-JSON dentro del bloque `text`). El **layout de página y el posicionamiento de bloques se manejan con Konva** (`react-konva`) sobre un `PageCanvas`. Cada bloque es un nodo Konva posicionado; el bloque `text` embebe un editor Tiptap.

### Reglas duras
- El estado del texto es ProseMirror-JSON, nunca HTML (coherente con ADR-010).
- El posicionamiento (x/y/width/height/zIndex) lo gestiona Konva y se persiste en el bloque.
- El modo de layout (`document` | `presentation`) vive en `document.meta`.

## Consecuencias

### Positivas
- Cada herramienta en lo suyo: Tiptap es excelente en texto rico; Konva da control de canvas/posición.
- Reutiliza componentes ya escritos (`PageCanvas`, `RichTextEditor`).

### Negativas / Trade-offs
- Coordinar dos motores (DOM/Tiptap dentro de canvas/Konva) tiene fricción técnica — ya resuelta en el código actual con `react-konva-utils`.
- El render de export debe reproducir el layout Konva fielmente (ver ADR-016).

### Neutras
- Ata el frontend a Tiptap 2.x y Konva 9.x (ya en `package.json`).

## Alternativas descartadas

### Editor único (Slate / Lexical) sin canvas
Más simple para texto, pero no da layout absoluto de página ni posicionamiento de widgets; rompe el WYSIWYG de informe. Rechazado.

### DOM puro con CSS (sin Konva)
Posible para layout fluido, pero el posicionamiento preciso de página (márgenes, grilla, capas) y el export determinista son más difíciles que con un canvas dedicado.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/components/document/PageCanvas.jsx`
- `Referencias/frontend/src/components/Editor/RichTextEditor.jsx`
- ADR-010 (modelo de bloques), ADR-016 (export)
