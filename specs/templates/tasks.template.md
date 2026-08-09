# TASKS NNN — <Nombre de la feature>

> Descomposición en unidades **pequeñas y verificables independientemente**.
> Cada task se enlaza a un commit/PR y a el/los criterio(s) de aceptación que ayuda a cumplir.
> Se exportan a `docs/08_Tareas_ClickUp/`.

| Campo | Valor |
|---|---|
| **Plan** | `specs/NNN-*/plan.md` |
| **Sprint** | |

## Tareas

| # | Tarea | Cubre CA | Estimación | Responsable | Estado | Commit/PR |
|---|---|---|---|---|---|---|
| T1 | … | CA-1 | | | ☐ | |
| T2 | … | CA-2 | | | ☐ | |
| T3 | (pruebas) Verificar CA-… | CA-… | | | ☐ | |
| T4 | (observabilidad) Exponer métricas | CA-4 | | | ☐ | |
| T5 | (docs) Actualizar manual operativo | — | | | ☐ | |

## Definition of Done (de esta feature)
- [ ] Todas las tasks cerradas.
- [ ] **Cada criterio de aceptación del spec demostrado con evidencia.**
- [ ] Sin violar `CONSTITUTION.md`.
- [ ] Métricas y seguridad verificadas.
- [ ] `plan.md` actualizado si hubo cambios; ADR(s) registrados.

## Modelo de IA sugerido por task (disciplina de costo · Art. 7)
| Tipo de task | Modelo |
|---|---|
| Diseño / concurrencia C++ / debugging difícil | Claude Opus |
| CRUD, edición, SQL rutinario, tests | Sonnet / Haiku / ChatGPT |
| Redacción de docs / specs | ChatGPT / Haiku |
