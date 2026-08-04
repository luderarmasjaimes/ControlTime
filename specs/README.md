# SDD — Spec-Driven Development · Plataforma Minera AURIXA

> Guía maestra de la metodología **Spec-Driven Development** adaptada a la
> plataforma de telemetría minera multitenant en tiempo real.
> La **especificación es la fuente de verdad**: el código se *deriva de* y se
> *valida contra* ella. No se escribe una línea de código sin un spec aprobado.

---

## 1. Por qué SDD en este proyecto

La plataforma maneja **10.000+ sensores en tiempo real, 5+ empresas mineras
(multitenant), ingesta durable, dashboards en vivo y datos históricos > 1 año**.
A esa escala, el código exploratorio "probar→fallar→arreglar" genera retrabajo
caro (en horas y en tokens de IA). SDD ataca eso:

- **Una decisión, una vez.** Se define el *qué* y los criterios de aceptación
  antes de codificar → menos ciclos.
- **Verificable.** Cada feature se prueba **contra su spec**, no contra
  ocurrencias del momento.
- **Multi-actor.** Backend C++, frontend, DBA, DevOps y la IA trabajan
  alineados sobre el mismo documento.
- **Económico en IA.** Pensar en barato (spec/plan), ejecutar fino (código).

## 2. El flujo SDD (5 etapas)

```
  CONSTITUTION ──► SPEC ──► PLAN ──► TASKS ──► IMPLEMENT ──► VERIFY
  (principios)    (QUÉ)    (CÓMO)  (unidades)  (código)    (vs spec)
```

| Etapa | Pregunta que responde | Artefacto | Quién aprueba |
|---|---|---|---|
| **Constitution** | ¿Qué reglas nunca se rompen? | `CONSTITUTION.md` | Arquitecto TI |
| **Spec** | ¿QUÉ y POR QUÉ? + criterios de aceptación | `specs/NNN-*/spec.md` | Producto + Arquitecto |
| **Plan** | ¿CÓMO técnicamente? | `specs/NNN-*/plan.md` | Arquitecto + DBA |
| **Tasks** | ¿En qué unidades verificables? | `specs/NNN-*/tasks.md` | Tech Lead |
| **Implement** | Código que cumple cada task | PR / commit | Revisor |
| **Verify** | ¿Cumple los criterios del spec? | Reporte de aceptación | QA |

> **Regla dura:** ningún PR se mergea si no referencia un spec y no demuestra
> sus criterios de aceptación.

## 3. Estructura del repo (capa SDD)

```
specs/
  README.md                      ← este archivo (guía maestra)
  CONSTITUTION.md                ← principios no negociables del proyecto
  templates/
    spec.template.md             ← plantilla de especificación (QUÉ)
    plan.template.md             ← plantilla de plan técnico (CÓMO)
    tasks.template.md            ← plantilla de descomposición en tareas
    adr.template.md              ← Architecture Decision Record
  001-ingesta-telemetria-durable/   ← EJEMPLO REAL trabajado
    spec.md  ·  plan.md  ·  tasks.md
  NNN-<feature-slug>/            ← una carpeta por feature
docs/                            ← documentación de gestión existente (SOW, etc.)
```

### Cómo se relaciona con lo que YA tienes en `docs/`
SDD **no reemplaza** tu documentación de gestión; la **conecta**:

| Documento existente | Rol en SDD |
|---|---|
| `docs/00_SOW/` (SOW) | Fuente de los **specs de nivel producto** |
| `docs/02_Arquitectura/` | Insumo del **plan técnico** + ADRs |
| `docs/08_Tareas_ClickUp/` | Las **tasks** se exportan/sincronizan a ClickUp |
| `docs/01_Planificacion/` (cronograma) | Cada sprint = un conjunto de specs aprobados |

## 4. Convención de numeración

`specs/NNN-<slug>/` con NNN incremental de 3 dígitos (`001`, `002`…). El slug en
kebab-case y en español del dominio: `001-ingesta-telemetria-durable`,
`002-dashboards-tiempo-real`, `003-tier-frio-historico`.

## 5. Disciplina de IA / tokens (parte del método)

SDD también es una **política de costo de IA**:

1. **Genera el spec/plan con un modelo económico** (ChatGPT / Claude Sonnet o
   Haiku). Pensar no requiere el modelo premium.
2. **Usa Claude Opus solo para**: decisiones de arquitectura difíciles,
   debugging complejo, código C++/concurrencia delicado.
3. **Una feature por sesión.** No arrastres contexto de features anteriores.
4. **El spec acota el alcance** → menos turnos exploratorios = menos tokens.

Ver `CONSTITUTION.md §7` (Disciplina de IA).

## 6. Definition of Done (global)

Una feature está **terminada** sólo si:
- [ ] Tiene `spec.md` aprobado con criterios de aceptación medibles.
- [ ] Tiene `plan.md` y, si aplica, ADR(s) para decisiones irreversibles.
- [ ] Todas las tasks cerradas y enlazadas a commits.
- [ ] **Cada criterio de aceptación demostrado** (prueba/medición adjunta).
- [ ] Sin violar la `CONSTITUTION.md`.
- [ ] Multitenant, observabilidad (`/api/metrics`) y seguridad verificadas.

## 7. Metodología IA Multi-Agente (2026)

Beemetry (antes AURIXA) adopta **IA multi-modelo con ADR + SPEC + Router + RAG** (ver `AGENTS.md`):

```
Requerimiento → Analista (SPEC) → Arquitecto (ADR) → Planificador (tasks)
             → Router IA → Agente especializado → Código → Revisión PR → Merge
```

| Artefacto | Ubicación |
|---|---|
| ADRs vigentes | `docs/decisions/000 … NNN` |
| ADRs históricos del programa inicial | `specs/adr/ADR-001 … ADR-012` |
| Trazabilidad ADR↔SPEC | `specs/REGISTRY.md` |
| Agentes | `agents/registry.yaml` + `prompts/agents/` |
| Router / Orquestador / RAG | `ai_platform/` |
| CI revisión ADR+SPEC | `.github/workflows/adr-spec-validation.yml`, `ai-review.yml` |

**Comandos:**
```bash
pip install -r ai_platform/requirements.txt
python -m ai_platform rag index
python -m ai_platform route "Implementar SPEC-014 offline" --files backend/
python -m ai_platform task "Alertas sensores SPEC-016"
```

## 8. Ramas feature y contexto

Cada rama `feature/*` incluye `CONTEXT.md` (plantilla: `specs/templates/branch-context.template.md`) con SPEC, ADRs y Definition of Done. Ver ADR-009.
