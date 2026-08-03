# Portal de Desarrollo IA · Beemetry / AURIXA

> `docs/decisions/` es el log ADR vigente. `specs/adr/` y
> `specs/REGISTRY.md` conservan la trazabilidad SDD temprana por SPEC; el RAG
> indexa ambos y debe tratar `docs/decisions/` como autoridad cuando difieran.

## Instalación

```powershell
pip install -r ai_platform/requirements.txt
python -m ai_platform rag index
python scripts/sync_spec_adr_sections.py   # ADRs en cada spec.md
```

## Módulos

| Módulo | Paso | Función |
|--------|------|---------|
| `registry_parser.py` | 3 | ADR ↔ SPEC desde REGISTRY |
| `decision_engine.py` | 8 | Motor de decisión pre-código |
| `router.py` | 4 | Enruta agente + modelo |
| `orchestrator.py` | 7 | Tareas + context bundle |
| `github_analyzer.py` | 5 | Analiza paths/diff |
| `branch_manager.py` | 6 | Rama feature + CONTEXT.md |
| `generator.py` | 9 | Generación código (LLM) |
| `reviewer.py` | 10 | Revisión reglas + LLM |
| `llm_client.py` | — | OpenAI / Anthropic / Ollama / mock |
| `learning.py` | 11 | Métricas router |
| `rag/` | 12 | FTS + TF-IDF vectorial |

## CLI

```powershell
python -m ai_platform decide "SPEC-014 offline" --files backend/
python -m ai_platform route "..." --files backend/
python -m ai_platform task "..."
python -m ai_platform generate "SPEC-008 biometria" -o out/
python -m ai_platform branch "SPEC-016" --create
python -m ai_platform review --body "SPEC-008" --diff-file pr.diff
python -m ai_platform pipeline "SPEC-014 offline" --files backend/
python -m ai_platform metrics
```

## Variables de entorno

| Variable | Uso |
|----------|-----|
| `OPENAI_API_KEY` | GPT / revisión |
| `ANTHROPIC_API_KEY` | Claude / backend |
| `OLLAMA_URL` | LLM local |
| `AURIXA_LLM_MODE=mock` | CI sin APIs |
| `AURIXA_LLM_REVIEW=0` | Solo reglas en review |

## CI

- `adr-spec-validation.yml` — ADR + RAG + pytest
- `ai-review.yml` — comentario PR
- `ai-pipeline.yml` — pipeline en PR

Ver [`AGENTS.md`](../AGENTS.md).
