# ADR-070 — Bloques técnicos y plantillas semánticas por composición

**Status**: implemented, verificado por tipos/build (2026-07-24)
**Fecha**: 2026-07-23
**Autores**: EC
**Ámbito**: reports
**Relación**: extiende ADR-010/050/053 sin agregar tipos canónicos nuevos.

## Contexto

El editor ya soportaba bloques genéricos, pero preparar un informe minero
formal exigía construir manualmente cajas de hallazgo, matrices, KPI y
gráficos repetitivos. Crear un tipo JSON nuevo por variante multiplicaría
renderizadores, exportadores y migraciones.

## Decisión

Las ayudas técnicas se construyen por **composición de tipos existentes**:

- cinco callouts semánticos (nota, conforme, observación, crítico y dictamen),
  tira KPI y pie de figura sobre bloques `text` + spans;
- diez plantillas de sección como encabezado H2 + tabla especializada;
- tres gráficos estáticos con datos (`line`, `hbar`, `combo`) sobre `chart`;
- coloreado semántico automático de estados en tablas, compartido por editor
  y visor de solo lectura;
- anchos de columna y tamaño natural de tabla persistidos en `props`.

Las plantillas insertan estructura y datos demostrativos editables; nunca se
presentan como telemetría real. Un bloque generado sigue teniendo el mismo
contrato, versionado, export y portabilidad que su tipo base.

## Consecuencias

- No cambia la enum del documento ni requiere migración de informes previos.
- Editor, PDF/visor y export reutilizan las rutas ya probadas.
- El estilo semántico mejora lectura, pero no sustituye el estado de negocio:
  se deriva del texto de la celda y debe mantenerse determinístico.
- Las plantillas son aceleradores, no una taxonomía cerrada del dominio.

## Alternativas descartadas

- **Tipo nuevo por callout/matriz/gráfico**: explosión de esquema y lógica.
- **Guardar HTML de plantilla**: rompe ADR-010 y la portabilidad estructurada.
- **Imágenes estáticas**: no editables ni trazables.

## Evidencia y referencias

- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts`
- `frontend/src/components/ReportStudioV2/lib/semanticStatus.ts`
- `TableBlock.tsx`, `LiveChartBlock.tsx`, `ReadOnlyViewer.tsx`
- `npm run type-check` y `npm run build`: OK (2026-07-24).

