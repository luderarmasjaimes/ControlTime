# SPEC 010 — Motor de fórmulas y cálculos sobre sensores

| Campo | Valor |
|---|---|
| **ID** | 010 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | Procesamiento de datos de sensores para visualización (S5-S6, R3) |
| **Constitución** | Art. 1 (multitenant), Art. 3 (lectura aislada), Art. 8 (reproducibilidad) |
| **Última revisión** | 2026-06-24 (auditado contra `formula_service.cpp` + `formula_routes.cpp`) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-010**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)


## 1. Problema
Los valores crudos de los sensores deben transformarse en indicadores de negocio
(índices de alerta de temperatura, KPIs de proceso) mediante **fórmulas aplicadas
sobre datos de sensores históricos** que alimentan dashboards e informes.

## 2. Objetivo
Motor que aplica lógica de procesamiento (umbral + calibración) sobre datos de
sensores de temperatura por empresa/mina/variable, con catálogos de empresa y
auditoría de sesiones de análisis.

## 3. Usuarios y contexto
- **Roles:** analista (ejecuta análisis), sistema (aplica la fórmula).
- **Multitenant:** cada empresa tiene su propio catálogo de minas/sensores/variables.
- **Motor embebido:** el motor está compilado **dentro del mismo binario** del backend
  C++ (`formula_routes.cpp` + `formula_service.cpp`). No existe servicio separado.
- **Base de datos:** usa la **misma BD principal** (no una `formula_db` separada).
  El schema de tablas `mineria_*` se crea automáticamente en el primer login.

## 4. Alcance
**Incluye:** catálogo empresa/mina/variable/sensor, análisis de temperatura con
stored procedure `sp_proceso_temperatura`, diccionario de variables de la plataforma,
auditoría de sesiones de análisis en `formula_sessions`.
**NO incluye:** lenguaje de scripting arbitrario, motor de expresiones genérico,
servicio microservicio separado.

## 5. Criterios de aceptación
- [x] **CA-1:** `GET /api/formula/dictionary` devuelve el diccionario de variables activo (auth requerida).
- [x] **CA-2:** `GET /api/analysis/catalogos` lista empresas/minas/variables disponibles del tenant.
- [x] **CA-3:** `POST /api/analysis/temperaturas` aplica `sp_proceso_temperatura` y devuelve resultados con condición (SI/NO alerta) y valor procesado.
- [x] **CA-4:** (multitenant) Cada análisis/catálogo respeta el scope de la empresa (filtra por `empresa_id`).
- [x] **CA-5:** Auditoría: cada sesión de análisis se registra en `formula_sessions` con usuario, empresa, mina, variable, fechas, totales y porcentaje de alertas.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Aislamiento | scope multitenant via `empresa_id` |
| Latencia | < O1 (20 ms) para catálogos; < 1 s para análisis histórico |
| Reproducibilidad | session_id → parámetros completos del análisis |
| Auto-seed | primer login crea mina + variable + sensor + 30 días de lecturas sintéticas |

## 7. Contratos (endpoints reales)
- `GET /api/formula/dictionary` — diccionario de variables (`formula_data_dictionary`)
- `GET /api/analysis/catalogos` — catálogos del tenant (vista `v_mineria_catalogos`)
- `POST /api/analysis/temperaturas` — ejecutar `sp_proceso_temperatura`

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| SP retorna datos de otra empresa | SP filtra por `empresa_id` + `mina_id` + `variable_id` |
| Datos de seed sintéticos en producción | Solo inserta si `mineria_lecturas` está vacía para esa empresa |
