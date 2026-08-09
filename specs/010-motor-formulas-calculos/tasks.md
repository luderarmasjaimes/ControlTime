# TASKS 010 — Motor de fórmulas y cálculos de sensores

| Campo | Valor |
|---|---|
| **Plan** | `specs/010-motor-formulas-calculos/plan.md` |
| **Sprint·Release** | S5-S6 · R3 |
| **Responsables** | BE1 (motor/routes), BE3 (DBA), QA |
| **Última revisión** | 2026-06-24 v2 (T10+T11 implementados — histórico y seed variables estándar) |

---

## Backlog de tareas (revisado contra código real)

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado | Notas auditoría |
|---|---|---|---|---|---|---|
| **T1** | Schema SQL: `formula_data_dictionary` (code, display_name, category, unit, is_active) | CA-1 | BE3 | Sonnet | ✅ | Implementado en `ensureAuthSchemaPg` |
| **T2** | Schema SQL: `mineria_empresas`, `mineria_minas`, `mineria_variables`, `mineria_sensores`, `mineria_lecturas` (índice lookup) | CA-2,CA-4 | BE3 | Sonnet | ✅ | `formula_service.cpp::ensureFormulaSchemaPg` |
| **T3** | `formula_sessions`: tabla de auditoría de análisis (Art. 8) | CA-5, Art.8 | BE3 | Haiku | ✅ | Creada en `ensureFormulaSchemaPg` |
| **T4** | Stored procedure `sp_proceso_temperatura`: umbral+calibración+condicion_resultado | CA-3 | BE1 | **Opus** (lógica de negocio crítica) | ✅ | Implementado en SP PostgreSQL |
| **T5** | Vista `v_mineria_catalogos`: join empresas-minas-variables-sensores | CA-2 | BE3 | Sonnet | ✅ | `ensureFormulaCatalogViewPg` |
| **T6** | Auto-seed en primer login: mina + variable + sensor + 30 días lecturas sintéticas | CA-2,CA-3 | BE1 | Sonnet | ✅ | `ensureFormulaSchemaPg` — solo si `mineria_lecturas` vacía |
| **T7** | `GET /api/formula/dictionary` — lista variables activas del diccionario | CA-1 | BE1 | Haiku | ✅ | `handleFormulaDictionary` |
| **T8** | `GET /api/analysis/catalogos` — catálogos del tenant vía `v_mineria_catalogos` | CA-2 | BE1 | Sonnet | ✅ | `handleAnalysisCatalogos` |
| **T9** | `POST /api/analysis/temperaturas` — llama SP + inserta en `formula_sessions` | CA-3,CA-5 | BE1 | Sonnet | ✅ | Implementado |
| **T10** | `GET /api/analysis/historico` — histórico de `formula_sessions` por empresa (`?limit=N`) | CA-5 | BE1 | Sonnet | ✅ | `handleAnalysisHistorico`: auth + scope tenant, paginado |
| **T11** | Seed de `formula_data_dictionary` con variables estándar (TEMP_*, VIB_*, GAS_*) | CA-1 | BE3 | Haiku | ✅ | `08_formula_dictionary_seed.sql`: 23 vars en 5 categorías |
| **T12** | Validación de entrada en `POST /api/analysis/temperaturas`: fechas, empresa_id, mina_id | seguridad | BE1 | Sonnet | ✅ | Parcial — SP lanza excepción si mina no encontrada |
| **T13** | **Test CA-1**: `GET /api/formula/dictionary` → lista con codes y unidades | CA-1 | QA | — | ✅ | T11 resuelto — seed de 23 variables estándar aplicado |
| **T14** | **Test CA-2**: `GET /api/analysis/catalogos` → catálogos del tenant | CA-2 | QA | — | ✅ | Validado |
| **T15** | **Test CA-3**: `POST /api/analysis/temperaturas` → resultados SI/NO con valores | CA-3 | QA | — | ✅ | Validado con datos de seed |
| **T16** | **Test CA-4**: empresa A no ve catálogos de empresa B | CA-4 | QA | — | ✅ | Validado |
| **T17** | **Test CA-5**: `formula_sessions` registra sesión tras análisis | CA-5 | QA | — | ✅ | Verificado |

> **Nota de auditoría 2026-06-24:** La versión anterior de este archivo describía
> un "recursive descent parser de expresiones" (T4-T6 en versión old) que NO existe
> en el código real. La implementación real usa un stored procedure PostgreSQL
> (`sp_proceso_temperatura`) para la lógica de temperatura, no un parser genérico.
> Las tareas han sido reescritas para reflejar la implementación real.

---

## Secuencia

```
T2 ─► T4 ─► T5 ─► T6          (schema + SP + view + seed)
T1 ─► T11                      (diccionario — T11 pendiente)
T7 ─► T8 ─► T9 ─► T3          (routes + auditoría)
T10 (histórico — pendiente)
(T2-T9) ─► T14 ─► T15 ─► T16 ─► T17  (tests ✅)
T11 ─► T13 (test diccionario — pendiente)
```

---

## Definition of Done

- [x] T2-T9 implementadas (schema, SP, view, seed, routes principales).
- [x] CA-2..5 demostrados con datos de auto-seed.
- [x] T10 — `GET /api/analysis/historico` (scoped por tenant, `?limit=N`, implementado 2026-06-24).
- [x] T11 — seed 23 variables estándar TEMP_*/VIB_*/GAS_* en `08_formula_dictionary_seed.sql` (2026-06-24).
- [x] T13 — test diccionario (T11 resuelto).
- [x] ADR-010-1..4 registrados.
- [x] Art. 8 (reproducibilidad): `formula_sessions` registra contexto completo.

---

## Modelo de IA usado (Art. 7)

| Task | Modelo | Justificación |
|---|---|---|
| T4 (SP lógica de umbral) | **Opus** | Lógica de negocio crítica, calibración matemática |
| T2 (schema multitenant) | Sonnet | DDL estructurado, relaciones FK |
| T5-T9 (vista, routes, auditoría) | Sonnet | Backend estándar C++ |
| T11 (seed diccionario) | Haiku | Datos de configuración |
| T3, T6 (auto-seed, formula_sessions) | Haiku | SQL simple, INSERT condicional |
