# SPEC NNN — <Nombre de la feature>

> **Plantilla de ESPECIFICACIÓN.** Responde QUÉ y POR QUÉ — NUNCA el cómo.
> Si te descubres escribiendo nombres de tablas, librerías o endpoints, eso va
> en el `plan.md`, no aquí.

| Campo | Valor |
|---|---|
| **ID** | NNN |
| **Estado** | Borrador · En revisión · **Aprobado** · Obsoleto |
| **Autor** | |
| **Aprobado por** | (Producto + Arquitecto TI) |
| **Fecha** | |
| **Sprint / Cronograma** | (enlace a `docs/01_Planificacion/`) |
| **SOW relacionado** | (enlace a `docs/00_SOW/`) |

## 1. Problema / Oportunidad
*¿Qué necesidad de negocio minero resuelve? ¿A quién afecta (rol/empresa)?*

## 2. Objetivo
*Una frase. El resultado esperado, medible.*

## 3. Usuarios y contexto
- **Rol(es):** (operador de mina, gerente, analista, sensor/dispositivo…)
- **Multitenant:** ¿aplica a todas las empresas? ¿aislamiento especial?
- **Volumen/escala esperada:** (sensores, req/s, filas, concurrencia)

## 4. Alcance
**Incluye:**
- …

**NO incluye (explícito):**
- …

## 5. Criterios de aceptación (medibles y verificables)
> Formato Given/When/Then. Cada uno se demostrará con evidencia en la fase Verify.

- [ ] **CA-1:** Dado … cuando … entonces … *(métrica objetivo: p.ej. latencia < X ms)*
- [ ] **CA-2:** …
- [ ] **CA-3:** (multitenant) Un tenant nunca ve datos de otro.
- [ ] **CA-4:** (observabilidad) Expone métricas …
- [ ] **CA-5:** (resiliencia) Ante caída de …, no se pierde …

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Latencia | |
| Throughput | |
| Disponibilidad / pérdida | |
| Seguridad / RBAC | |
| Retención / almacenamiento | |

## 7. Restricciones y supuestos
- Cumple `CONSTITUTION.md` (lista artículos relevantes).
- Supuestos: …

## 8. Riesgos
| Riesgo | Impacto | Mitigación |
|---|---|---|

## 9. Preguntas abiertas
- …
