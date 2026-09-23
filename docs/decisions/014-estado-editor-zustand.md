# ADR-014 — Estado del editor: Zustand store único (`useEditorStore`)

> **Actualización 2026-09-12 (aclaración de la regla dura, no una decisión
> nueva)**: una auditoría de conformidad (2026-09-11) encontró
> `useDragPreviewStore` — un SEGUNDO store Zustand, además de
> `useEditorStore` — que guarda la posición visual del fantasma de arrastre
> mientras el usuario reordena diapositivas (`DragPreviewOverlay.tsx`,
> formalizado en [ADR-174](174-capacidades-avanzadas-editor-store-navegacion-diapositivas.md)).
> Tomada aislada, la frase "un solo store para el editor" de la regla dura
> de abajo se leería como que lo prohíbe. Pero esa misma regla, completa,
> ya dice "no múltiples stores **paralelos que dupliquen el documento**" —
> y `useDragPreviewStore` no lo hace: no contiene `doc` ni ninguna
> proyección de él, solo `{x, y, visible}` de un fantasma efímero que se
> descarta al soltar el mouse, nunca se persiste (ni offline ni al
> servidor) y nunca se lee como fuente de verdad de nada del documento —
> existe únicamente para que la posición del fantasma no dispare
> re-renders del árbol completo del editor en cada `pointermove` del
> arrastre.
>
> **Análisis**: el riesgo real que esta regla dura buscaba prevenir es
> "verdades divergentes" sobre el documento (dos stores que puedan
> desincronizarse sobre qué dice un informe) — no la existencia de
> cualquier `create()` de Zustand adicional en el código. Un store de
> estado de UI puramente efímero, sin ninguna superficie de datos de
> negocio, no crea ese riesgo.
>
> **Solución adoptada**: se aclara la regla dura de abajo (sin retirarla,
> sin crear un ADR nuevo — es la MISMA regla, solo escrita sin
> ambigüedad) agregando el criterio explícito que ya cumplía
> `useDragPreviewStore` de facto, para que futuras piezas de estado de UI
> efímero no tengan que releer el código existente para saber si están
> permitidas.

**Status**: implemented (verificado 2026-07-06: `useEditorStore.ts` usa `create` de `zustand`); regla dura aclarada 2026-09-12, ver arriba
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

ReportStudio maneja un estado de UI complejo: documento (páginas, bloques), selección, herramientas activas, modales, paneles (inspector, biblioteca), workflow. El código ya centraliza esto en un store Zustand (`store/useEditorStore.js`). Hay que decidir el límite entre lo que vive en el store (cliente) y lo autoritativo en el servidor.

## Decisión

El estado del editor vive en un **único store Zustand** (`useEditorStore`). El store es la fuente de verdad **de la sesión de edición en curso**; el servidor es autoritativo del **documento persistido, versiones y workflow** (ADR-015). El store no inventa datos de negocio: snapshots de widgets, versiones y auditoría se hidratan desde el servidor/`.miningreport`.

### Por qué Zustand (no Redux)

1. **Continuidad (rescate híbrido)**: el código existente ya usa Zustand (`useEditorStore.js`); migrar a Redux sería reescritura sin beneficio.
2. **Engines fuera de React**: `autosaveEngine`, `offlineSyncEngine` y `exportEngine` viven en `lib/` y **no son componentes**. El store Zustand es un **módulo importable** al que esos engines acceden directamente; con Redux habría que inyectar el store o pasar por Provider/middleware. Es la razón técnica más fuerte dada la arquitectura actual.
3. **Re-renders selectivos por selector** sin Context Provider → ayuda al presupuesto <20 ms (ADR-023) en un canvas con muchos bloques.
4. **Menos boilerplate** (sin actions/reducers/dispatch) y **bundle ~1KB** vs Redux Toolkit + react-redux — relevante para tablet de campo.

### Límite store ↔ servidor
- **Store (cliente)**: documento en edición, selección, UI (paneles/modales), cola offline pendiente (ADR-022).
- **Servidor (autoritativo)**: documento persistido, `report_content_revision`, workflow, auditoría, metadatos de ciclo de vida (ADR-021).

### Reglas duras
- Un solo store para **el documento y la sesión de edición** (`useEditorStore`); no múltiples stores paralelos que dupliquen el documento, su selección, o cualquier dato que el servidor deba poder auditar/versionar.
- El store no es la autoridad de versionado/workflow: refleja lo que el servidor confirma.
- **Excepción explícita (aclarada 2026-09-12)**: un store Zustand adicional SÍ está permitido cuando cumple las tres condiciones a la vez — (1) nunca contiene `doc` ni una proyección/copia de su contenido, (2) nunca se persiste (ni caché offline ADR-022/045/127, ni servidor), y (3) su ciclo de vida está acotado a una sola interacción transitoria de UI (ej. un gesto de arrastrar-soltar), descartado al terminar esa interacción. `useDragPreviewStore` (ADR-174) es el caso que motivó esta aclaración y el primero en cumplirla. Cualquier store nuevo que NO cumpla las tres condiciones sigue prohibido por la regla anterior sin excepción.

## Consecuencias

### Positivas
- Estado predecible y simple (Zustand es ligero, sin boilerplate).
- Límite claro con el servidor evita "verdades divergentes".

### Negativas / Trade-offs
- Un store grande puede crecer en complejidad — mitigado con slices por dominio dentro del mismo store.

### Neutras
- Ata el frontend a Zustand 4.x (ya en uso).

## Alternativas descartadas

### Redux (+ toolkit)
Maduro, con devtools y time-travel debugging, y convenciones fuertes para equipos grandes. Se descartó porque para este caso pesa en contra: más boilerplate (actions/reducers/dispatch/Provider), bundle mayor, y —lo decisivo— los engines de `lib/` (autosave/offline/export) que no son componentes React accederían al estado con más fricción que con un store-módulo de Zustand. Además Zustand ya está integrado (rescate híbrido). Redux sería preferible si necesitáramos time-travel debugging o un ecosistema de middleware amplio, que hoy no es el caso.

### Estado local disperso (useState/context)
No escala a la complejidad del editor (selección global, undo, offline). Rechazado.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/store/useEditorStore.js`
- ADR-015 (versionado server), ADR-021 (metadatos), ADR-022 (offline)
- ADR-174 (`useDragPreviewStore` — caso real de la excepción aclarada 2026-09-12)
