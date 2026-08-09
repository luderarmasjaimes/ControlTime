# ADR-052 — Navegación de teclado, zoom 10%-400% y tamaño de hoja/orientación por página

**Status**: implemented (verificado 2026-07-17)
**Fecha**: 2026-07-17
**Autores**: EC
**Ámbito**: reports

## Contexto

Tres quejas de negocio distintas sobre la navegación del lienzo, agrupadas en un solo ADR por ser todas decisiones de "cómo se recorre/encuadra el documento" (no de contenido de bloques):
1. Avanzar/retroceder de página dependía de arrastrar el mouse sobre la barra de scroll — sin atajos de teclado.
2. El zoom existía pero limitado a 60%-180%, con solo botones +/- (sin salto directo a un valor ni indicador prominente).
3. El tamaño de hoja (A4/A3) y orientación (vertical/horizontal) eran una sola configuración para **todo el documento** — no se podía tener, por ejemplo, una página de plano en A3 horizontal dentro de un informe A4 vertical.

## Decisión

### Navegación de teclado
`PageUp`/`PageDown` saltan a la página completa anterior/siguiente (calculado por posición real de cada `.multipage-page-shell` en el contenedor de scroll); las flechas ↑↓←→ desplazan el lienzo en pasos pequeños (mismo criterio que un lector de PDF); `Home`/`End` van al principio/fin del documento. Se desactiva automáticamente si el foco está en un campo editable (input/textarea/contentEditable) — no debe interceptar la edición de texto normal.

### Zoom
Rango ampliado a 10%-400% (antes 60%-180%). El control pasa de ser solo dos botones +/- a un chip clickeable que abre un panel con slider, 10 presets (10/25/50/75/100/125/150/200/300/400%) y entrada numérica personalizada.

### Tamaño de hoja/orientación por página
`ReportPage` gana campos opcionales `paperSize`/`orientation` que, si están presentes, **sobreescriben** el valor del documento (`doc.meta`) solo para esa página — ausentes, la página hereda el valor global (retrocompatible, sin migración). Un control por página (`setPagePaperSetup`) permite elegir el alcance del cambio: **"solo esta página"** o **"esta página y las siguientes"** (no "todo el documento" — eso sigue siendo el control de tamaño de hoja ya existente a nivel documento, que además limpia cualquier override de página al aplicarse, para que "todo el documento" sea realmente todo). Encabezado/pie/carátula de cada página afectada recalculan su geometría con las métricas de ESA página, no las del documento.

### Reglas duras
- Cambiar el tamaño de hoja/orientación a nivel documento (control ya existente en el ribbon) limpia cualquier override por página — es una operación de "todo uniforme", no debe convivir con excepciones fantasma de una sesión anterior.
- El zoom es puramente visual (`viewportScale`/escala de Konva) — nunca afecta el tamaño real de página/exportación.

## Consecuencias

### Positivas
- Navegación y zoom alineados con la expectativa de cualquier editor de documentos moderno (Word, lectores de PDF).
- Permite el caso de uso real de "un plano A3 horizontal dentro de un informe A4 vertical" sin duplicar el documento en dos archivos.

### Negativas / Trade-offs
- Una página con tamaño distinto al resto del documento cambia el ancho de contenido disponible para bloques ya posicionados — si el usuario reduce el tamaño de una página que ya tenía bloques anchos, estos pueden quedar fuera de los márgenes nuevos (mismo comportamiento aceptado que un cambio de tamaño a nivel documento, ADR ya existente: el usuario ajusta manualmente, no hay reflow automático).

## Alternativas descartadas

### Reflow automático de bloques al cambiar tamaño de página
Reposicionar/redimensionar automáticamente todo el contenido de una página al cambiar su tamaño evitaría el trade-off de arriba, pero es un comportamiento sorpresivo (el usuario pierde el control fino de layout que ya había ajustado) — mismo criterio ya aceptado para el cambio de tamaño a nivel documento; se mantiene consistente.

## Referencias
- `frontend/src/components/ReportStudioV2/components/document/MultipageView.tsx` (navegación de teclado, control de página)
- `frontend/src/components/ReportStudioV2/components/layout/RibbonToolbar.tsx` (control de zoom)
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (`setPagePaperSetup`, `resolvePagePaperSetup`)
- `frontend/src/components/ReportStudioV2/lib/reportLayoutMetrics.ts`
