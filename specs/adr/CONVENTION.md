# Convención de numeración ADR

## ADRs globales (proyecto)
`specs/adr/ADR-001.md` … `ADR-012.md` — decisiones de arquitectura del programa AURIXA.

## Decisiones locales por feature
En `specs/NNN-*/plan.md` se usan identificadores **DEC-NNN-N** (decisión local), por ejemplo:
- `DEC-001-1` — broker durable (spec 001)
- `DEC-004-1` — slot físico réplica (spec 004)

> **No confundir** con ADR-004 global (IA multi-modelo router).

Al crear nuevas decisiones locales, usar prefijo `DEC-` + número de spec.
