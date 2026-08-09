# Architecture Decision Records (ADR) · AURIXA

> ⚠️ **Log histórico, no vigente.** Este directorio (`specs/adr/`, 12 registros,
> metodología SDD temprana bajo la marca "AURIXA") no recibe decisiones nuevas
> desde el rebrand a Beemetry. **El log de arquitectura vigente y único es
> [`docs/decisions/`](../../docs/decisions/README.md)** — log cronológico único
> (000–042 y creciendo), con nomenclatura de dominio (`Ámbito`) en vez de esta
> tabla por SPEC. Toda decisión de arquitectura desde entonces (identidad/RBAC,
> multitenancy real, auditoría, plataforma enterprise LATAM, etc.) vive ahí.
>
> Esta carpeta se conserva por trazabilidad histórica del razonamiento SDD
> original — no la uses como referencia de "cómo funciona hoy" el sistema.
> Confirmado en auditoría de arquitectura, 2026-07-13.

Registro de decisiones técnicas **irreversibles o costosas de revertir** para la plataforma minera AURIXA.

| ID | Título | Estado | SPECs relacionados |
|----|--------|--------|-------------------|
| [ADR-001](ADR-001-microservicios-gateway-cpp.md) | Microservicios con gateway C++ central | Aceptado | 001, 006, 010 |
| [ADR-002](ADR-002-timescale-capas-datos.md) | TimescaleDB y capas caliente/templado/frío | Aceptado | 001, 003, 004, 015 |
| [ADR-003](ADR-003-redpanda-ingesta-durable.md) | Redpanda/Kafka ingesta durable | Aceptado | 001, 014 |
| [ADR-004](ADR-004-ia-multi-modelo-router.md) | IA multi-modelo con router inteligente | Aceptado | 008, 011, 017, 018 |
| [ADR-005](ADR-005-biometria-local-insightface-onnx.md) | Biometría local InsightFace + ONNX | Aceptado | 008, 017 |
| [ADR-006](ADR-006-multitenancy-tenant-id.md) | Multitenancy obligatorio por tenant_id | Aceptado | 006, 002, 007 |
| [ADR-007](ADR-007-sdd-specs-fuente-verdad.md) | SDD: specs como fuente de verdad | Aceptado | todos |
| [ADR-008](ADR-008-ia-on-premise-ollama-languagetool.md) | IA on-premise Ollama + LanguageTool | Aceptado | 011, 018 |
| [ADR-009](ADR-009-git-branching-feature-release.md) | Ramas feature/release por funcionalidad | Aceptado | todos |
| [ADR-010](ADR-010-ai-routing-por-tarea.md) | AI Routing por tipo de tarea | Aceptado | todos |
| [ADR-011](ADR-011-rag-memoria-proyecto.md) | RAG sobre ADR, SPEC y código | Aceptado | todos |
| [ADR-012](ADR-012-revision-pr-adr-spec.md) | Revisión automática PR vs ADR/SPEC | Aceptado | todos |

**Trazabilidad completa:** [`../REGISTRY.md`](../REGISTRY.md)

**Plantilla:** [`../templates/adr.template.md`](../templates/adr.template.md)
