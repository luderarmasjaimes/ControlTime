# ADR-015 — Versionado y auditoría del informe: servidor autoritativo

**Status**: implemented (verificado 2026-07-06: `report_service.cpp` inserta en `report_content_revision` en creación y en cada autosave; `GET /api/reports/{id}/revisions` expone el historial. Pendiente: sin política de retención/archivado)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

El informe es un documento técnico con consecuencias de seguridad operativa: exige versionado e historial confiables y auditoría 100% (KPI O7). El frontend ya tiene `VersionHistory.jsx` y `VersionComparator.jsx`, y el modelo de datos v36 define `report_content_revision` (revisiones) y tablas de auditoría (`platform_audit_log`, `report_sensitive_action_log`). La pregunta es la autoridad: ¿cliente o servidor?

## Decisión

El **versionado y la auditoría son autoritativos en el servidor**. Cada cambio confirmado del documento genera una revisión en `report_content_revision` (retención indefinida, revisiones pequeñas en el plano histórico); las acciones sensibles y de workflow se registran en las tablas de auditoría. El historial/comparador del cliente es una **vista** de lo que el servidor guardó, no la fuente de verdad. El autosave del cliente (ADR-023) persiste contra el servidor.

### Reglas duras
- Ninguna versión "vive solo en el cliente": una versión existe cuando el servidor la confirma.
- Refrescar un widget (ADR-012), firmar, o cambiar de estado de workflow (ADR-017) generan entradas de auditoría.
- La resolución de conflictos de edición concurrente/offline se rige por ADR-022 (no por last-write-wins silencioso).

## Consecuencias

### Positivas
- Cumple O7 (trazabilidad 100%) y soporta compliance/auditoría.
- Historial inmutable y confiable, independiente del cliente.

### Negativas / Trade-offs
- Cada confirmación toca el servidor — mitigado: las revisiones son pequeñas y el autosave es incremental.
- Requiere reconciliación cuidadosa con el modo offline (ADR-022).

### Neutras
- El comparador de versiones del cliente sigue siendo útil como UI sobre los datos del servidor.

## Alternativas descartadas

### Versionado autoritativo en el cliente
Es parcialmente el estado actual (historial client-side). No es auditable ni confiable para un informe firmable; un cliente comprometido o desincronizado corrompería el historial. Rechazado.

### Sin versionado (solo última versión)
Inaceptable para un documento técnico con aprobación/firma y auditoría.

## Referencias
- `Referencias/docs/02_Arquitectura/Modelo_Datos_AURIXA_v36.md` § 3.2
- `Referencias/frontend/src/components/ReportStudioV2/components/document/VersionHistory.jsx`, `VersionComparator.jsx`
- ADR-012 (snapshot), ADR-017 (workflow), ADR-022 (offline), ADR-030 (auditoría)
