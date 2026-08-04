# ADR-012 — Revisión automática de PR contra ADR y SPEC

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI + QA |
| **Features** | todos |

## Contexto
Revisiones manuales no escalan con 10 recursos y asistencia IA. Se necesita gate objetivo antes del merge.

## Decisión
Pipeline CI en cada PR:
1. Leer ADRs referenciados en `CONTEXT.md` o cuerpo del PR
2. Leer SPEC y criterios de aceptación
3. Ejecutar `ai_platform/reviewer.py` (reglas + opcional LLM)
4. Verificar: cumple ADR, cumple SPEC, no rompe Constitución, sin secretos, multitenant OK

Salida: **approve** / **request changes** con informe Markdown adjunto.

## Consecuencias
- Workflow `.github/workflows/ai-review.yml`
- Script local: `python -m ai_platform review --pr-diff ...`
