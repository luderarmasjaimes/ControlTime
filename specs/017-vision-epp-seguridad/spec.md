# SPEC 017 — Visión IA: detección de EPP (equipo de protección)

| Campo | Valor |
|---|---|
| **ID** | 017 · **Estado** | **Borrador (a construir — Etapa 2, S11/R5)** |
| **SOW** | IA avanzada: visión EPP (casco, chaleco, etc.) — Etapa 2; IA local |
| **Constitución** | Art. 6 (seguridad), Art. 1 (multitenant) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-017**; fuente ADR: `docs/decisions/`.

- **ADR-025** — [`025-biometria-vision-epp-diferidas.md`](../../docs/decisions/025-biometria-vision-epp-diferidas.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-105** — [`105-deepface-silentface-proveedor-biometrico-primario.md`](../../docs/decisions/105-deepface-silentface-proveedor-biometrico-primario.md)
- **ADR-110** — [`110-operaciones-campo-offline-integracion-erp.md`](../../docs/decisions/110-operaciones-campo-offline-integracion-erp.md)


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
