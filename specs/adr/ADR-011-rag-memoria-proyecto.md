# ADR-011 — RAG: memoria del proyecto

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI + Especialista IA |
| **Features** | todos |

## Contexto
Enviar todo el repositorio en cada prompt agota tokens y diluye contexto. El proyecto tiene ~18 SPECs, 12 ADRs, 81 endpoints y miles de archivos fuente.

## Decisión
Construir **base de conocimiento RAG** (`ai_platform/rag/`) que indexe:
- `specs/adr/*.md`, `specs/*/spec.md`, `CONSTITUTION.md`
- `docs/02_Arquitectura/*.md` (extractos)
- Headers y APIs clave de `backend/`, `frontend/`, `db_scripts/`

Flujo:
```
Consulta → Embedding/búsqueda semántica → Top-K chunks → Prompt enriquecido → Modelo
```

Implementación MVP: índice SQLite FTS + TF-IDF (`ai_platform/rag/indexer.py`). Extensible a vectores (Chroma/pgvector) en Etapa 2.

## Consecuencias
- Comando: `python -m ai_platform.rag index` / `python -m ai_platform.rag query "login biométrico"`.
- Cada agente recibe solo contexto relevante (Art. 7 Constitución: una feature por sesión).
