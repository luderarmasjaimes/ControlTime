# REGISTRO MAESTRO ADR ↔ SPEC · Beemetry

> **Registro histórico de trazabilidad SDD.** Esta matriz mantiene la relación
> de las 18 SPEC iniciales con los 12 ADR globales tempranos de `specs/adr/`.
> El log arquitectónico vigente y único es
> [`docs/decisions/`](../docs/decisions/README.md). Ante cualquier diferencia,
> prevalece ese log; no se agregan decisiones nuevas a esta numeración.
>
> Para conservar trazabilidad operativa sin mezclar ambas numeraciones, cada
> `spec.md` puede declarar una sección **Decisiones vigentes
> complementarias**. `ai_platform.registry_parser` combina esa sección con
> esta matriz histórica para Router, motor de decisión, generador y revisor.

Trazabilidad entre **decisiones de arquitectura (ADR)** y **especificaciones funcionales (SPEC)**.
Antes de generar código, el motor de decisión IA consulta este registro.

## Matriz ADR → SPEC

| ADR | Decisión | SPECs que la usan |
|-----|----------|-------------------|
| ADR-001 | Microservicios + gateway C++ | 001, 006, 010, 012, 013 |
| ADR-002 | TimescaleDB capas datos | 001, 002, 003, 004, 015, 016 |
| ADR-003 | Redpanda ingesta durable | 001, 014, 016 |
| ADR-004 | IA multi-modelo router | 008, 011, 017, 018 |
| ADR-005 | Biometría InsightFace+ONNX | 008, 017 |
| ADR-006 | Multitenancy tenant_id | 002, 006, 007, 009, 010 |
| ADR-007 | SDD specs fuente de verdad | **001–018** |
| ADR-008 | Ollama + LanguageTool on-prem | 011, 018 |
| ADR-009 | Git branching feature/release | **001–018** |
| ADR-010 | AI routing por tarea | **001–018** |
| ADR-011 | RAG memoria proyecto | **001–018** |
| ADR-012 | Revisión PR ADR+SPEC | **001–018** |

## Matriz SPEC → ADR (inverso)

| SPEC | Feature | ADRs aplicables |
|------|---------|-----------------|
| SPEC-001 | Ingesta telemetría durable | ADR-001, 002, 003, 006, 007 |
| SPEC-002 | Dashboards tiempo real | ADR-001, 002, 004, 006, 007 |
| SPEC-003 | Tier frío histórico | ADR-002, 007 |
| SPEC-004 | Réplica HA | ADR-001, 002, 007 |
| SPEC-005 | Push SSE tiempo real | ADR-001, 007 |
| SPEC-006 | Auth RBAC multitenant | ADR-001, 006, 007, 009 |
| SPEC-007 | ReportStudio + export | ADR-001, 006, 007, 009 |
| SPEC-008 | Biometría facial login | ADR-004, 005, 006, 007 |
| SPEC-009 | GIS mapas | ADR-001, 006, 007 |
| SPEC-010 | Motor fórmulas | ADR-001, 006, 007 |
| SPEC-011 | IA texto local | ADR-004, 008, 007 |
| SPEC-012 | GDAL geoespacial | ADR-001, 007 |
| SPEC-013 | Videovigilancia | ADR-001, 007 |
| SPEC-014 | Modo offline + sync | ADR-003, 007, 009 |
| SPEC-015 | DR + continuidad | ADR-002, 007 |
| SPEC-016 | Alertas sensores | ADR-002, 003, 007 |
| SPEC-017 | Visión IA EPP | ADR-004, 005, 007 |
| SPEC-018 | Dictado voz STT | ADR-004, 008, 007 |

## Motor de decisión (checklist pre-código)

Antes de implementar, la IA debe responder:

1. **¿Qué SPEC?** → ID y criterios de aceptación
2. **¿Qué ADRs?** → fila de la tabla anterior
3. **¿Qué Constitución?** → artículos citados en el spec
4. **¿Qué agente?** → `agents/registry.yaml`
5. **¿Qué rama?** → `feature/<slug>` según ADR-009

## Convención de ramas (ADR-009)

| Prefijo | Ejemplo | SPEC |
|---------|---------|------|
| `feature/` | `feature/biometria-login` | 008 |
| `feature/` | `feature/offline-sync` | 014 |
| `bugfix/` | `bugfix/template-export` | 007 |
| `release/` | `release/2.3` | gate R5 |

Cada rama debe incluir `CONTEXT.md` (plantilla en `specs/templates/branch-context.template.md`).
