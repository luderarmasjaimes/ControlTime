# ADR-090 — Depreciación de ADRs Tempranos (`specs/adr`) para el Router de IA

**Status**: implemented (corrección completada 2026-08-18)

**Ámbito**: plataforma, metodología IA

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-08-05 |
| **Decisor(es)** | Arquitecto TI |

## Contexto
Durante la Fase 0 del proyecto, se crearon los documentos `ADR-001` al `ADR-012` en el directorio `specs/adr/`. A medida que el proyecto evolucionó y se migró al formato de "decisiones ligeras" en `docs/decisions/`, se generó una duplicidad: el agente de Inteligencia Artificial (`agents/registry.yaml`) estaba inyectando ambos directorios en el contexto, causando alucinaciones arquitectónicas y conflictos (por ejemplo, entre el ADR-001 original de microservicios y el ADR-002 de Gateway Central C++ en `docs/decisions/`).

## Decisión
- **El único log arquitectónico válido y vigente es `docs/decisions/`.**
- El directorio `specs/adr/` queda formalmente **depreciado** para uso como contexto principal de los agentes de programación.
- El parser de la plataforma IA (`ai_platform/registry_parser.py`) resuelve
  exclusivamente `docs/decisions/` (`NNN-*.md`) y expande rangos del registro.
- Se elimina `specs/adr/` de los `paths` de todos los agentes en `registry.yaml`.
- Se elimina `specs/adr/` del índice RAG; conservar archivos históricos no
  implica inyectarlos al contexto.

## Consecuencias
- Los Agentes IA ya no alucinarán con las arquitecturas de la Fase 0.
- Cualquier modificación a los 12 ADRs iniciales debe hacerse reescribiendo o referenciando sus contrapartes en `docs/decisions/`.
