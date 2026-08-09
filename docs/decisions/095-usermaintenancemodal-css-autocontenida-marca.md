# ADR-095 — UserMaintenanceModal: hoja de estilos autocontenida + marca corporativa

**Status**: implemented, verificado (2026-08-07)
**Fecha**: 2026-08-07
**Autores**: EC
**Ámbito**: plataforma
**Relación**: extiende ADR-073 (`modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon`) al mismo modal; corrige un bug real de code-splitting de Vite, no un cambio visual cosmético.

## Contexto

`UserMaintenanceModal` se dispara desde `App.tsx` (el shell externo, justo
tras el login) pero sus clases (`rum-*`/`ra-*`) solo vivían en
`ReportStudioV2/styles.css`, que Vite solo carga como parte del chunk
lazy del módulo ReportStudioV2 (`App.tsx:64`, `import()` dinámico). Fuera de
ese contexto — es decir, la primera vez que aparece, justo tras el login,
antes de que el usuario haya entrado nunca al editor de informes — el modal
renderizaba controles HTML nativos sin ningún estilo: tabla sin bordes,
botones de navegador, radios nativos. No era un problema de diseño, era un
bug real de code-splitting: un componente montado desde fuera de un chunk
lazy no puede depender del CSS de ese chunk.

## Decisión

1. **Hoja de estilos propia y autocontenida**:
   `UserMaintenanceModal.css`, importada directamente por
   `UserMaintenanceModal.tsx` (no por `styles.css`), para que cargue sin
   importar desde dónde se monte el componente.
2. **Marca corporativa vigente** (`#F07E41`, ver `index.css --primary`) en
   vez del azul que tenía la versión duplicada en `styles.css` —
   consistente con el rebrand de `project_telemetry_rebrand_2026-08-02`.
3. Se conserva la estructura/nombres de clase (`rum-*`) para no romper
   ningún selector existente; el fix es de origen de la hoja, no de
   nomenclatura.

## Verificación

- Reproducido en navegador real: login → modal de mantenimiento aparece sin
  estilo (antes del fix) → aplicado el fix → estilos de marca correctos
  confirmados por inspección de estilo computado (`getComputedStyle`) sobre
  `.rum-overlay`/`.rum-btn-primary`, sin depender de haber entrado antes al
  editor de informes.
- Bug de build encontrado durante la implementación: un comentario CSS con
  un `*/` literal dentro del texto cerraba el comentario antes de tiempo y
  rompía el build de `lightningcss` — corregido redactando el comentario sin
  esa secuencia.

## Consecuencias

- El modal de mantenimiento de usuarios se ve correctamente la primera vez
  que aparece (justo tras el login), no solo tras haber navegado antes al
  editor de informes.
- Cualquier otro componente montado desde `App.tsx` fuera del chunk de
  ReportStudioV2 que dependa hoy de `ReportStudioV2/styles.css` para su
  estilo tiene el mismo riesgo — no se auditó el resto de esos componentes
  en este trabajo, queda como posible hallazgo futuro.

## Alternativas descartadas

- **Mover `UserMaintenanceModal` a fuera de `ReportStudioV2/`**: descartado
  — reorganizaría carpetas sin necesidad; el problema es de origen del CSS,
  no de ubicación del componente en el árbol de archivos.
- **Precargar `styles.css` en el shell externo**: descartado — cargaría
  ~7KB+ de CSS del editor de informes en cada sesión aunque el usuario nunca
  entre a ese módulo, solo para un modal que se usa una vez tras login.

## Referencias

- `frontend/src/components/ReportStudioV2/components/modals/UserMaintenanceModal.tsx`
- `frontend/src/components/ReportStudioV2/components/modals/UserMaintenanceModal.css`
- `frontend/src/App.tsx` (línea 64, `import()` dinámico de ReportStudioV2)
- ADR-073 (`modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon`)
