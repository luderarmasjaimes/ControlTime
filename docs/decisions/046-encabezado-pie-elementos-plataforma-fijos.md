# ADR-046 — Encabezado y pie de página como elementos de plataforma fijos (datos en vivo, no en props)

**Status**: implemented (verificado 2026-07-17 contra `useEditorStore.ts`, `PageCanvas.tsx`, `RightInspector.tsx`)
**Fecha**: 2026-07-10 (aprox., a partir de comentarios de código; formalizado retroactivamente el 2026-07-17)
**Autores**: EC
**Ámbito**: reports

## Contexto

Los bloques `header`/`footer` de cada página necesitan mostrar empresa, unidad minera y usuario conectado. La primera implementación guardaba esos textos como `props` normales del bloque — lo que producía datos **congelados en el momento de creación de la página**: si el usuario cambiaba de tenant/unidad o el nombre de usuario de sesión cambiaba, páginas ya creadas seguían mostrando el dato viejo, y duplicar/cargar un informe de otro usuario arrastraba datos ajenos.

## Decisión

`header`/`footer` son **elementos de plataforma fijos**: se agregan automáticamente a toda página (nueva o cargada desde un informe guardado antes de que este bloque existiera) sin que el usuario presione ningún botón, y **sus datos de empresa/unidad/usuario se calculan en vivo desde la sesión activa en cada render** (`PageCanvas.tsx`) — nunca se leen ni se escriben en `props`. El pie muestra además `"BEEMETRY"` (marca, izquierda) y `"Página X / Total"` (numeración resuelta en render, ver ADR-019).

### Reglas duras
- `header.props`/`footer.props` no contienen texto de empresa/unidad/usuario — esos campos se resuelven en cada render desde `getSession()`/`resolveMiningUnitName()`.
- `locked: true` por defecto: no editables, no movibles, no borrables desde la UI estándar (mismo criterio que la carátula, ADR-048).
- `createHeaderFooterPair()` es el único punto que crea estos bloques — se invoca desde `addPage`, `loadDocument` y el documento inicial, para que un informe cargado desde antes de este ADR también los reciba.

## Consecuencias

### Positivas
- Nunca hay desincronización entre "lo que dice el pie" y la sesión real activa — imposible que un informe muestre un usuario/empresa incorrectos por dato congelado.
- Duplicar o cargar un informe de otro tenant no arrastra branding ajeno.

### Negativas / Trade-offs
- Si el negocio pidiera "encabezado histórico congelado al momento de la firma" (auditoría), este modelo no lo soporta tal cual — habría que snapshot-ear en el momento de firma (mismo patrón que ADR-012 para KPI/sensor). No solicitado a la fecha.

### Neutras
- El tamaño/posición de header/footer sí se recalcula y persiste al cambiar tamaño de hoja/orientación (ver `applyPageSetup`/`applyPagePaperSetup` en `useEditorStore.ts`).

## Alternativas descartadas

### Snapshot de empresa/usuario al crear la página
Consistente con el patrón de ADR-012, pero el negocio nunca pidió "congelar" el encabezado — al contrario, el caso de uso real es "el usuario corrige su nombre y todas las páginas ya escritas deben reflejarlo". Rechazado.

## Referencias
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (`createHeaderFooterPair`, `defaultPropsByType('header'|'footer')`)
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx`
- ADR-019 (numeración diferida), ADR-048 (carátula, mismo criterio de bloqueo)
