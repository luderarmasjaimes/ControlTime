# ADR-007 — SDD: especificaciones como fuente de verdad

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI + PMO |
| **Features** | todos (001–018) |

## Contexto
Proyecto de 10 recursos, 6 meses, múltiples modelos IA. Sin spec aprobado, el código diverge del SOW y los gates R1–R6 fallan.

## Decisión
Metodología **Spec-Driven Development** (`specs/`): ningún merge sin referencia a SPEC + evidencia de criterios de aceptación. Flujo: Constitution → Spec → Plan → Tasks → Implement → Verify.

## Consecuencias
- `specs/README.md`, `CONSTITUTION.md`, `BACKLOG.md`
- CI valida referencias SPEC en PR (`.github/workflows/adr-spec-validation.yml`)
