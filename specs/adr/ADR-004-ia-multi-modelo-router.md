# ADR-004 — IA multi-modelo con router inteligente

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI + Especialista IA |
| **Features** | `specs/008-*`, `011-*`, `017-*`, `018-*` |

## Contexto
Ningún modelo LLM/ML es óptimo para todas las tareas (C++ concurrente, React UX, SQL tuning, documentación gerencial, debugging). El costo de tokens y la calidad mejoran si cada tarea va al modelo/agente adecuado.

## Opciones consideradas
1. **Un solo modelo para todo** — simple; calidad y costo subóptimos.
2. **Selección manual por desarrollador** — inconsistente en equipos grandes.
3. **Router IA central** — clasifica tarea y enruta a modelo/agente especializado.

## Decisión
Implementar **AI Router** (`ai_platform/router.py`) que clasifica solicitudes por:
- tipo (backend C++, frontend, SQL, documentación, QA, arquitectura),
- rutas de archivos afectados (`/backend` → Claude, `/frontend` → GPT, `/docs` → Gemini, `/db_scripts` → DeepSeek),
- agente especializado según `agents/registry.yaml`.

Modelos preferidos (configurables en `ai_platform/config/models.yaml`):
| Especialidad | Modelo preferido | Uso |
|---|---|---|
| Arquitectura / ADR | GPT-5 / Claude Opus | decisiones irreversibles |
| Backend C++ / OpenCV | Claude | código largo, concurrencia |
| Frontend React | GPT-5 / Cursor | UI/UX, componentes |
| SQL / ETL / tuning | DeepSeek | optimización queries |
| Documentación | Gemini | redacción clara no técnica |
| Refactoring | Codex / Cursor | cambios acotados |
| Revisión PR | modelo distinto al generador | evitar sesgo |

## Consecuencias
- **Positivas:** mejor calidad por dominio, trazabilidad de qué modelo generó qué, aprendizaje de preferencias (`ai_platform/learning/metrics.json`).
- **Negativas:** requiere orquestador y política de API keys.
- **Impacto:** ver ADR-010, ADR-011 y `AGENTS.md`.
