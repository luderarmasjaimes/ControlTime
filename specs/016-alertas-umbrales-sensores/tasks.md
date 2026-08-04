# TASKS 016 — Alertas y umbrales por sensor

| Campo | Valor |
|---|---|
| **Plan** | `specs/016-alertas-umbrales-sensores/plan.md` |
| **Sprint·Release** | Etapa 2 (S9-S10 · R5) |
| **Responsables** | BE1 (consumidor/SSE), BE3 (DBA/schema), FE1 (panel alertas), QA |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Schema SQL: `alert_rules` (condición, umbrales, debounce, tenant_id) | CA-2,CA-4 | BE3 | Sonnet | ☐ |
| **T2** | Schema SQL: `alert_events` (historial con ack_by/ack_at) | CA-5 | BE3 | Sonnet | ☐ |
| **T3** | Cache LRU de reglas en consumidor (`loadRules` con TTL 60 s) | CA-1 | BE1 | **Opus** (concurrencia) | ☐ |
| **T4** | `evaluateRules(msg, rules)` → `[]Alert` (condiciones: above_max, below_min, rate) | CA-1,CA-6 | BE1 | **Opus** | ☐ |
| **T5** | Debounce en memoria por `rule_id` (anti-tormenta, Art. 9) | CA-6 | BE1 | Sonnet | ☐ |
| **T6** | `INSERT INTO alert_events` si alerta pasa debounce | CA-1,CA-5 | BE1 | Sonnet | ☐ |
| **T7** | Canal SSE de alertas: `AlertChannel` compartido con consumidor | CA-3 | BE1 | **Opus** | ☐ |
| **T8** | `GET /api/live/alerts` — SSE stream (reutiliza patrón de spec 005) | CA-3 | BE1 | Sonnet | ☐ |
| **T9** | `GET /api/alert/rules` + `POST/PUT/DELETE` (CRUD, admin/supervisor) | CA-2,CA-4 | BE1 | Sonnet | ☐ |
| **T10** | `GET /api/alert/events` — historial paginado | CA-5 | BE1 | Sonnet | ☐ |
| **T11** | `POST /api/alert/events/{id}/ack` — reconocimiento de alerta | CA-5 | BE1 | Sonnet | ☐ |
| **T12** | Invalidación cache: `POST /api/alert/rules` llama `ruleCache.invalidate(tenant)` | CA-2 | BE1 | Sonnet | ☐ |
| **T13** | Frontend: panel de alertas activas + historial + reconocimiento | CA-3,CA-5 | FE1 | Sonnet | ☐ |
| **T14** | Frontend: badge contador en navbar cuando hay alertas activas | CA-3 | FE1 | Sonnet | ☐ |
| **T15** | **Test CA-1**: lectura cruza umbral → alerta en < 2 s | CA-1 | QA | — | ☐ |
| **T16** | **Test CA-2**: CRUD reglas → umbral activo/inactivo funciona | CA-2 | QA | — | ☐ |
| **T17** | **Test CA-3**: alerta llega por SSE `/api/live/alerts` | CA-3 | QA | — | ☐ |
| **T18** | **Test CA-4**: empresa A no ve alertas de empresa B | CA-4 | QA | — | ☐ |
| **T19** | **Test CA-5**: historial auditado con ack | CA-5 | QA | — | ☐ |
| **T20** | **Test CA-6**: 100 cruces en 5 s → max 1 alerta por debounce | CA-6 | QA | — | ☐ |

## Secuencia

```
T1 ─► T2                         (schemas BD)
T3 ─► T4 ─► T5 ─► T6            (evaluador: cache→eval→debounce→insert)
T7 ─► T8                         (SSE canal de alertas)
T9 ─► T10 ─► T11 ─► T12         (CRUD + historial + ack + cache-invalidation)
(T1-T12) ─► T15-T20 (tests)
T13, T14 (frontend, post-backend)
```

## Definition of Done

- [ ] T1-T12 completadas.
- [ ] CA-1..6 demostrados con evidencia.
- [ ] ADR-016-1..5 registrados.
- [ ] Sin violar Constitución (Art. 1, 2, 5, 9).
- [ ] Gate R5: demo alerta en tiempo real en dashboard.

## Métricas

| KPI | Meta | Cómo medir |
|---|---|---|
| Latencia alerta | < 2 s desde ingesta | timestamp telemetría vs ts alert_events |
| Anti-tormenta | máx 1/debounce_secs por regla | test de carga T20 |
| Aislamiento multitenant | 0 cross-tenant | T18 |
| Historial auditado | 100% eventos | COUNT alert_events vs COUNT triggered |
