# ADR-021 — Ownership de metadatos de ciclo de vida (`document.meta` vs BD)

**Status**: implemented (completado 2026-07-07). El solapamiento de `version` está resuelto: `document.meta.version` y `version_number` (BD) nunca fueron el mismo concepto — el primero es un contador local que se incrementa en CADA acción de edición (útil como señal de "hay cambios sin guardar"), el segundo es la revisión confirmada server-side (ADR-015). El problema real no era el solapamiento en sí, sino que la UI mostraba el contador local (`v${doc.meta.version}`) haciéndolo pasar por la versión real, sin que el cliente tuviera forma de conocer el `version_number` verdadero.

Cerrado en ambos lados:
- **Backend**: `POST /api/reports`, `PUT /api/reports/{id}` y `GET /api/reports/{id}` ahora devuelven `version_number` (antes ninguno de los tres lo incluía en su respuesta JSON — el cliente literalmente no tenía forma de saberlo salvo consultando `report_content_revision` directamente).
- **Frontend**: nuevo estado `currentReportVersionNumber` en `useEditorStore.ts` (independiente de `doc.meta`, mismo patrón que `currentReportId`/`currentReportTitle`), hidratado desde la respuesta del servidor en cada load/save/autosave/transición de workflow. `versionLabel` en la UI ahora muestra este valor (con `doc.meta.version` solo como fallback antes del primer guardado).
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

Los metadatos del informe (autor, versión, fecha, `project_id`, `created_by`, `reviewed_by`, estado) hoy están repartidos: algunos en `document.meta` (dentro del `.miningreport`, portátil), otros solo en la BD/API (`content_json`, `project_id`, `status`, `version_number`, `created_by`, `reviewed_by`). Sin un dueño claro, se duplican y divergen (p.ej. `meta.version` vs `version_number` de BD).

## Decisión

Definimos **ownership explícito** de cada metadato según si debe viajar offline o ser autoritativo:

- **`document.meta` (portátil / offline, dentro del `.miningreport`)**: `author`, `title`, `company`, `unit`, `documentId`, `version` (etiqueta), `updatedAt`, `layoutMode`. Es lo mínimo para abrir y mostrar el informe sin servidor.
- **BD/API (autoritativo)**: `project_id`, `created_by`, `reviewed_by`, `status` de workflow (ADR-017), `version_number` autoritativo (ADR-015), permisos/compartición, auditoría.

### Reglas duras
- El número de versión **autoritativo** es el de BD (`version_number`); `meta.version` es una etiqueta de display que se hidrata desde BD.
- Identidades (`created_by`/`reviewed_by`) y `project_id` viven en BD; el `.miningreport` puede llevar copias de display, marcadas como no autoritativas.
- Al reconciliar offline (ADR-022), la BD gana en los campos autoritativos.

## Consecuencias

### Positivas
- Elimina la divergencia `meta.version` vs `version_number`.
- El `.miningreport` sigue siendo portátil (abre offline) sin pretender ser la autoridad de negocio.

### Negativas / Trade-offs
- Hay duplicación controlada (copias de display) — aceptable y marcada como tal.

### Neutras
- Define un contrato claro para la reconciliación offline y el versionado.

## Alternativas descartadas

### Todo en `document.meta`
Portátil, pero no autoritativo ni multi-usuario; `reviewed_by`/permisos no pueden vivir solo en el archivo. Rechazado.

### Todo en BD (nada en el archivo)
Rompe la portabilidad offline del `.miningreport` (no abriría sin servidor). Rechazado.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/lib/miningReportFormat.js`, `useEditorStore.js`
- `Referencias/docs/09_Manuales_Operativos/administracion_informes_tecnicos_grabados.rtf`
- ADR-015 (versionado), ADR-017 (workflow), ADR-022 (offline)
