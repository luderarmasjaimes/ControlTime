# ADR-178 — Operaciones de Campo queda fuera del alcance de este proyecto; implementación futura independiente

**Status**: accepted (decisión de alcance de negocio) — sin código, sin fecha, sin equipo asignado

**Fecha**: 2026-09-12

**Autores**: Luder Armas (decisión de negocio)

**Ámbito**: field-operations, plataforma

**Relación**: reemplaza, para efectos de alcance y seguimiento de riesgos, el
tratamiento que [ADR-110](110-operaciones-campo-offline-integracion-erp.md)
le venía dando a Operaciones de Campo como "proyecto derivado" dentro de la
órbita de seguimiento de este proyecto. No reabre ni contradice el contenido
técnico de ADR-110 (arquitectura propuesta, decisiones pendientes, directriz
de reutilizar el backend de Beemetry como servicios web) — ese documento
sigue siendo la referencia técnica de partida el día que esta iniciativa se
retome. Este ADR cambia únicamente el **alcance y la gobernanza de
seguimiento**: deja de ser un pendiente/riesgo de este proyecto.

## Contexto

Operaciones de Campo (SPEC-022) viene documentado desde el 18-ago (ADR-110)
como un "proyecto derivado" del cronograma v36.1 — separado del alcance
principal, pero todavía aparecía en el `tasks.md` de este repositorio (0/14
tareas, contando en las métricas consolidadas de `specs/BACKLOG.md`), en
`specs/REGISTRY.md`, y como un ítem recurrente en los reportes gerenciales de
este proyecto: en la diapositiva de riesgos, en las decisiones pendientes
solicitadas a Gerencia, y en el plan mes a mes.

El 11-sep, Gerencia aprobó el rebaseline de Operaciones de Campo como
proyecto derivado (actualización de ADR-110), pero eso todavía lo dejaba
"dentro de la órbita" de este proyecto — apareciendo en reportes y
solicitando asignación de equipo/presupuesto como si fuera parte del alcance
a resolver por este equipo.

Instrucción explícita de Gerencia (2026-09-12): **Operaciones de Campo NO es
alcance de este proyecto**, en ningún grado — ni como riesgo, ni como
decisión pendiente, ni como línea de seguimiento en el backlog de este
proyecto. Cualquier tema relacionado (la app de campo, la integración con el
ERP para captura en sitio, dispositivos/PDA, OCR/STT/EPP para operación de
campo) queda completamente fuera del backlog y de los reportes gerenciales
de la plataforma minera Beemetry/AURIXA actual. Su futura implementación,
si se decide, es una **iniciativa propia e independiente** — con su propio
proyecto, alcance, presupuesto y cronograma, sin heredar ni competir por
el de este proyecto.

## Decisión

1. **Operaciones de Campo (SPEC-022) se retira del seguimiento de este
   proyecto**: deja de contarse en las métricas consolidadas de
   `specs/BACKLOG.md`, deja de listarse en `specs/REGISTRY.md` como una fila
   de seguimiento activo, y deja de aparecer en cualquier reporte gerencial
   de este proyecto (riesgos, decisiones pendientes, plan mes a mes,
   dominios funcionales).
2. `specs/022-operaciones-campo-offline-erp/` (spec.md, plan.md, tasks.md)
   **se conserva en el repositorio sin cambios** — es el punto de partida
   técnico documentado si la iniciativa se retoma — pero se excluye
   explícitamente del cálculo de `scripts/project-status-metrics.ps1`
   (mismo mecanismo ya usado para los alias de SPEC-004/005, ver `$aliases`
   en el script), para que su 0/14 no siga arrastrando hacia abajo el
   porcentaje de avance de un proyecto del que ya no es alcance.
3. **ADR-110 no se reescribe** (norma del proyecto) — conserva su contenido
   técnico íntegro como referencia de arquitectura. Se le agrega una
   actualización fechada que remite a este ADR para el estado de alcance
   vigente.
4. Si en el futuro se decide retomar Operaciones de Campo, corresponde:
   (a) un proyecto propio con su propio registro de decisiones — puede
   reutilizar la numeración ADR de este repositorio o abrir uno nuevo, según
   decida Gerencia en su momento —, (b) resolver primero la lista de
   "Decisiones pendientes antes de aceptar" que ADR-110 ya dejó documentada
   (formato de PDF, dispositivos/MDM, matriz de datos ERP↔Beemetry, ventana
   offline, consentimiento/privacidad, piloto y KPIs), y (c) su propio
   product owner, equipo y presupuesto — nunca compartidos con este proyecto
   por defecto.

## Consecuencias

### Positivas
- Los reportes gerenciales de este proyecto dejan de cargar un riesgo/pendiente
  que no corresponde a su alcance — reduce ruido y confusión sobre qué
  bloquea o no los gates de R1-R6.
- El porcentaje de avance consolidado (`specs/BACKLOG.md`) refleja solo
  trabajo que es realmente alcance de este proyecto.
- El trabajo de análisis ya hecho (ADR-110, `specs/022-*`) no se pierde —
  queda archivado y disponible como punto de partida el día que se decida
  retomarlo.

### Negativas / Trade-offs
- Si alguien retoma Operaciones de Campo sin leer este ADR, podría asumir
  erróneamente que es parte del alcance actual (al ver `specs/022-*` en el
  repositorio) — mitigado con la nota explícita en `spec.md`/`plan.md`/
  `tasks.md` de esa carpeta (ver Referencias) y la actualización agregada a
  ADR-110.
- El script de métricas gana una excepción más (además de los alias de
  004/005) — aceptable, ya existe el mecanismo y es el mismo patrón.

## Referencias

- [ADR-110](110-operaciones-campo-offline-integracion-erp.md) (arquitectura
  propuesta original, decisiones pendientes, rebaseline 2026-09-11 — sigue
  vigente como referencia técnica)
- `specs/022-operaciones-campo-offline-erp/spec.md` / `plan.md` / `tasks.md`
  (conservados sin cambios, ahora fuera del cálculo de avance)
- `scripts/project-status-metrics.ps1` (`$aliases`, exclusión agregada)
- `specs/BACKLOG.md`, `specs/REGISTRY.md` (fila de SPEC-022 removida del
  seguimiento activo de este proyecto)
