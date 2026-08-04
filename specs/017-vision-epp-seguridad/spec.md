# SPEC 017 — Visión IA: detección de EPP (equipo de protección)

| Campo | Valor |
|---|---|
| **ID** | 017 · **Estado** | **Borrador (a construir — Etapa 2, S11/R5)** |
| **SOW** | IA avanzada: visión EPP (casco, chaleco, etc.) — Etapa 2; IA local |
| **Constitución** | Art. 6 (seguridad), Art. 1 (multitenant) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-017**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
La seguridad minera exige verificar que el personal use su EPP (casco, chaleco,
lentes). La revisión manual por cámara no escala. Debe detectarse automáticamente,
**localmente** (soberanía), sobre el muro CCTV (013).

## 2. Objetivo
Detección por visión de EPP sobre frames de cámara, con modelos locales (ONNX),
generando alertas de incumplimiento.

## 3. Usuarios y contexto
- **Roles:** supervisor de seguridad, sistema (inferencia automática).
- **IA local:** modelo ONNX en `ai_engine` (sin nube — soberanía SOW).
- **Integración:** frames desde muro CCTV (013); alertas al motor (016).

## 4. Alcance
**Incluye:** inferencia de EPP sobre frames (casco/chaleco/lentes), alerta de
ausencia, integración con CCTV (013) y alertas (016). **NO incluye:**
identificación de la persona (eso es 008), tracking continuo.

## 5. Criterios de aceptación
- [ ] **CA-1:** Sobre un frame, detecta presencia/ausencia de cada EPP con score.
- [ ] **CA-2:** (soberanía) Inferencia **local** (`ai_engine`, ONNX), sin nube.
- [ ] **CA-3:** Una ausencia de EPP genera alerta (vía 016) con evidencia (frame).
- [ ] **CA-4:** (multitenant) Configuración de EPP requerido por empresa/zona.
- [ ] **CA-5:** Precisión objetivo afinada pre-UAT (S11); umbral configurable.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Procesamiento | local (ONNX), acotado en CPU/GPU |
| Latencia | acorde a cadencia de muestreo del muro |

## 7. Plan técnico (esbozo)
- Modelo de detección EPP en `ai_engine`; muestreo de frames del CCTV; resultado →
  motor de alertas (016); evidencia a MinIO.

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Falsos negativos (riesgo de seguridad) | umbral conservador + revisión humana de alertas |
| Carga de inferencia | muestreo (no todos los frames) + límites de recursos |
