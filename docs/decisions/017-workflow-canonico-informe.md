# ADR-017 — Workflow canónico del informe (front ↔ BD unificados)

**Status**: implemented (verificado 2026-07-06: `report_workflow.hpp` valida transiciones server-side con lock antes de aplicar; enum idéntico a `WorkflowPanel.tsx`)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

El informe pasa por un ciclo de vida con aprobación. La validación detectó una **desalineación crítica**: el frontend (`WorkflowPanel.jsx`) usa los estados `draft → review → approved → signed (+ rejected)`, mientras que la BD (manual `administracion_informes_tecnicos_grabados.rtf` §5.2) usa `draft, in_review, approved, archived` — sin `signed` ni `rejected`, y con claves distintas (`review` vs `in_review`). Esto rompe la trazabilidad y produce estados imposibles de reconciliar.

## Decisión

Definimos una **máquina de estados canónica única**, idéntica en frontend y BD, con autoridad en el servidor (ADR-015):

```
Borrador (draft) → En Revisión (in_review) → Aprobado (approved) → Firmado (signed) → Archivado (archived)
                          ↘ Rechazado (rejected) → (vuelve a draft)
```

| Estado | Clave canónica | Transiciones permitidas |
|---|---|---|
| Borrador | `draft` | → `in_review` |
| En Revisión | `in_review` | → `approved`, `rejected` |
| Rechazado | `rejected` | → `draft` |
| Aprobado | `approved` | → `signed`, `in_review` |
| Firmado | `signed` | → `archived` |
| Archivado | `archived` | terminal |

### Reglas duras
- Una sola enum de estados, compartida (constante única, no duplicada en front y back con claves distintas).
- Las transiciones se validan en el servidor; el cliente solo propone.
- Cada transición genera entrada de auditoría con hash encadenado (ADR-030).

## Consecuencias

### Positivas
- Elimina la desalineación front↔BD; estados reconciliables y auditables.
- Incluye `signed` y `archived` (firma + retención), que la BD no tenía.

### Negativas / Trade-offs
- Requiere migración de datos/estados existentes (`review`→`in_review`) — tarea de Sprint acotada.

### Neutras
- La bitácora de workflow (`auditLog` del `.miningreport`) refleja esta máquina.

## Alternativas descartadas

### Mantener dos vocabularios y mapear
Un mapa front↔BD parchea, pero perpetúa la fuente de bugs y deja estados sin equivalente (`signed`/`archived`). Rechazado: la fuente del problema es tener dos vocabularios.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/components/document/WorkflowPanel.jsx`
- `Referencias/docs/09_Manuales_Operativos/administracion_informes_tecnicos_grabados.rtf` § 5.2
- ADR-015 (versionado server), ADR-018 (firma), ADR-030 (auditoría)
