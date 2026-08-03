# ADR-009 — Git branching feature / release

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI + DevOps |
| **Features** | todos |

## Contexto
Múltiples recursos trabajan en paralelo (BE1–3, FE1–2, IA, QA). Una sola rama `main` genera conflictos y pierde contexto por feature.

## Decisión
Estrategia **trunk-based con ramas cortas**:
- `main` — producción estable
- `develop` — integración continua
- `feature/<slug>` — una funcionalidad = un SPEC
- `bugfix/<slug>` — correcciones
- `release/<version>` — gates R5/R6

Cada rama `feature/*` incluye `CONTEXT.md` con SPEC, ADRs y Definition of Done.

## Consecuencias
- Plantilla: `specs/templates/branch-context.template.md`
- GitHub Actions en PR hacia `main`/`develop`
