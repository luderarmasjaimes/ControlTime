# Agentes IA especializados · Beemetry (antes AURIXA)

| ID | Nombre | Función | Modelo preferido | Paths |
|----|--------|---------|------------------|-------|
| architect | Arquitecto IA | Define arquitectura, propone ADR | gpt-5 / claude-opus | docs/decisions/ (vigente), specs/adr/ (histórico) |
| functional_analyst | Analista Funcional | Requerimientos → SPEC | gemini | specs/, docs/00_SOW/ |
| planner | Planificador | Historias → tasks técnicas | gpt-5 | specs/*/tasks.md |
| backend_dev | Desarrollador Backend | C++ Boost.Asio, OpenCV, APIs | claude | backend/ |
| frontend_dev | Desarrollador Frontend | React, ReportStudio, UX | gpt-5 / cursor | frontend/ |
| dba | Especialista BD | Esquemas, SQL, ETL, recovery | deepseek | db_scripts/, formula_engine/db/ |
| ai_specialist | Especialista IA | RAG, ONNX, prompts, evaluación | claude | ai_engine/, ai_platform/ |
| code_reviewer | Revisor de Código | ADR, SPEC, calidad, seguridad | gpt-5 (≠ generador) | * (PR diff) |
| devops | DevOps | CI/CD, Docker, infra | gpt-5 | .github/, docker-compose*, scripts/ci/ |
| qa | QA | Tests funcionales, regresión, UAT | gpt-5-mini | frontend/tests/, scripts/*smoke* |
| documenter | Documentador | ADR, SPEC, manuales | gemini | docs/, specs/ |

## Flujo entre agentes

```
Cliente → functional_analyst → SPEC
       → architect → ADR
       → planner → tasks
       → router → backend_dev | frontend_dev | dba | ai_specialist
       → code_reviewer → merge
       → documenter → actualiza trazabilidad
```

Prompts detallados: `prompts/agents/*.md`
