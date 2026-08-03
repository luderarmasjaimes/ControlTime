# AGENTS.md — Plataforma Minera Beemetry (antes AURIXA) · Metodología IA Multi-Agente

Portal de desarrollo IA: **ADR + SPEC + Router + RAG + Orquestador + CI**.

## Instalación

```powershell
cd C:\InformeCliente
pip install -r ai_platform/requirements.txt
python -m ai_platform rag index
```

Variables opcionales:
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — modelos cloud
- `OLLAMA_URL=http://localhost:11434` — LLM local
- `AURIXA_LLM_MODE=mock` — CI sin APIs
- `AURIXA_LLM_REVIEW=0` — desactivar revisor LLM en PR

## Comandos CLI

| Comando | Paso metodología |
|---------|------------------|
| `python -m ai_platform decide "SPEC-014 offline"` | 8 — Motor de decisión |
| `python -m ai_platform route "..." --files backend/` | 4 — Router IA |
| `python -m ai_platform task "..."` | 7 — Contexto automático |
| `python -m ai_platform generate "SPEC-008 ..."` | 9 — Generación código |
| `python -m ai_platform branch "..." --create` | 6 — Rama + CONTEXT.md |
| `python -m ai_platform review --body "SPEC-008" --diff-file pr.diff` | 10 — Revisión |
| `python -m ai_platform rag query "tenant_id"` | 12 — Memoria RAG |
| `python -m ai_platform pipeline "SPEC-016 alertas"` | 13 — Pipeline completo |
| `python -m ai_platform metrics` | 11 — Aprendizaje |

## Estructura

```
specs/adr/           ADR-001 … ADR-012
specs/REGISTRY.md    Trazabilidad ADR ↔ SPEC
docs/decisions/      Log ADR vigente y único (000 … NNN)
specs/NNN-*/spec.md  SPECs + sección ADRs globales
agents/registry.yaml 11 agentes
prompts/agents/      Prompts por rol
ai_platform/         Router, orchestrator, RAG, LLM, generator, reviewer
.github/workflows/   adr-spec-validation.yml, ai-review.yml, ai-pipeline.yml
```

## Flujo completo

```
Cliente → SPEC (functional_analyst) → ADR (architect)
       → tasks (planner) → Router → Agente + Modelo
       → RAG context → generate → branch feature/*
       → PR → review (reglas + LLM) → merge → metrics
```

## Agentes y modelos

Ver `agents/registry.yaml` y ADR-004, ADR-010.

## CI GitHub

- **adr-spec-validation.yml** — log ADR vigente + ADR histórico, REGISTRY, RAG, router smoke
- **ai-review.yml** — comentario PR con veredicto ADR/SPEC
- **ai-pipeline.yml** — pipeline decide→generate→review en PR

## Constitución

`specs/CONSTITUTION.md` Art. 1–11. Ningún merge sin SPEC referenciado.
