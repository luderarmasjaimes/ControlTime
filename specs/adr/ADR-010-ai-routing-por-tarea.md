# ADR-010 — AI Routing por tipo de tarea

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI |
| **Features** | todos |

## Contexto
El equipo usa múltiples herramientas IA (Cursor, Claude, GPT, Gemini). Sin reglas, se duplica contexto, se violan ADR/SPEC y se mezclan estilos de código.

## Decisión
Toda solicitud de desarrollo pasa por el **Router IA** antes de invocar un modelo:

```
Solicitud → Clasificador (tipo + paths) → Agente → Modelo → Contexto (ADR+SPEC+RAG) → Salida
```

Reglas mínimas:
| Señal | Agente | Modelo |
|---|---|---|
| `backend/`, `.cpp`, `.hpp` | `backend_dev` | claude |
| `frontend/`, `.jsx`, `.tsx` | `frontend_dev` | gpt |
| `db_scripts/`, `.sql` | `dba` | deepseek |
| `specs/`, `docs/` | `documenter` / `functional_analyst` | gemini |
| `ai_engine/`, ONNX, embeddings | `ai_specialist` | claude |
| PR review | `code_reviewer` | distinto al autor |
| Arquitectura nueva | `architect` | gpt / opus |

## Consecuencias
- Implementación en `ai_platform/router.py` + CLI `python -m ai_platform route "..."`.
- GitHub Action `.github/workflows/ai-review.yml` usa el mismo router para revisiones.
