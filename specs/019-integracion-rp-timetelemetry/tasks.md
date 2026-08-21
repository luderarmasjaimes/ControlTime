# TASKS 019 — Integración RP (TimeTelemetry/Odoo)

| Campo | Valor |
|---|---|
| **Plan** | `specs/019-integracion-rp-timetelemetry/plan.md` |
| **Responsables** | BE1 (C++/Boost.Beast/libpq), QA |
| **Última revisión** | 2026-08-18 |

---

## Backlog de tareas

| # | Tarea | Cubre CA | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|
| **T1** | ADR-103 + SPEC-019 (spec/plan/tasks) | — | Sonnet | ✅ |
| **T2** | `db_scripts/52`: `rp_equipment`, `rp_write_outbox`, `ALTER` CHECK `etl_sync_run.mode`, seeds RBAC | CA-1..9 (base) | Sonnet | ✅ |
| **T3** | `http/http_client.{hpp,cpp}`: cliente HTTP(S) compartido (TLS vía `beast::ssl_stream`) | CA-1 | Sonnet | ✅ |
| **T4** | `rp_odoo_sync.{hpp,cpp}`: codec XML-RPC (`authenticate`, `execute_kw`) | CA-1 | **Opus**-nivel (protocolo nuevo) | ✅ |
| **T5** | `rp_odoo_sync.cpp`: `backfillLoop()` paginado + upsert por lotes | CA-1 | Sonnet | ✅ |
| **T6** | `rp_odoo_sync.cpp`: `incrementalLoop()` por `write_date` | CA-2 | Sonnet | ✅ |
| **T7** | `rp_odoo_sync.cpp`: `handleWebhookNudge()` (relectura autoritativa, no confía en payload) | CA-8 | Sonnet | ✅ |
| **T8** | `rp_odoo_sync.cpp`: `writeOutboxDrainLoop()` con backoff exponencial + jitter + dead-letter | CA-3,CA-4,CA-5 | Sonnet | ✅ |
| **T9** | `rp_odoo_sync.cpp`: circuit breaker por peer (closed/open/half-open) | CA-5 | Sonnet | ✅ |
| **T10** | `rp_odoo_sync.cpp`: push WS (`WsRegistry::broadcastToTenant`) tras cada upsert/confirmación | CA-6 | Sonnet | ✅ |
| **T11** | `rp_odoo_sync.cpp`: `OdooSyncStats` + `odooSyncStats()` | Art.5 | Sonnet | ✅ |
| **T12** | `rp_gateway_routes.{hpp,cpp}`: GET lista/detalle (réplica) | CA-7 | Sonnet | ✅ |
| **T13** | `rp_gateway_routes.cpp`: POST/PUT (outbox, 202) + GET sync-status | CA-3,CA-4 | Sonnet | ✅ |
| **T14** | `rp_gateway_routes.cpp`: webhook con API key de servicio | CA-8 | Sonnet | ✅ |
| **T15** | `main.cpp`: `registerRoutes`, `startRpOdooSync`, bloque de métricas | — | Sonnet | ✅ |
| **T16** | Build del backend, corregir errores de compilación | — | Sonnet | ✅ build verificado 2026-08-18 |
| **T17** | **Test CA-1**: backfill vs scripts de referencia | CA-1 | QA | ✅ 2108 equipos, 0 errores, dato de referencia PZ18-R4.5 verificado campo a campo |
| **T18** | **Test CA-2..CA-9**: resto de criterios de aceptación | CA-2..9 | QA | ✅ (CA-4/escritura solo con peer falso, no productivo — ver ADR-103) |
| **T19-doc** | `RP_TIMETELEMETRY_API_GUIDE.md` + `rp-test-harness.html` para integradores externos | — | Sonnet | ✅ Verificado en navegador real, cross-origin, contra backend con peer real |
| **T20** | 2 bugs reales encontrados en vivo contra TimeTelemetry (watermark con TZ, `execute_kw` args sin envolver el dominio) — corregidos | CA-2 | Sonnet | ✅ Ver ADR-103 §Verificación en vivo |

> Nota de cierre 2026-08-18: T17 y la lectura/incremental de T18 sí se
> ejecutaron con el peer real. La única evidencia productiva pendiente es
> CA-4 (`create/write` en Odoo), que requiere una ventana autorizada; las
> credenciales siguen fuera del repositorio.

---

## Secuencia (dependencias)
```
T1 ─► T2 ─► T3 ─► T4 ─► T5 ─► T6 ─► T7 ─► T8 ─► T9 ─► T10 ─► T11
                                                              │
T12 ─► T13 ─► T14 ────────────────────────────────────────────┤
                                                              ▼
                                                            T15 ─► T16 ─► T17 ─► T18
```

## Definition of Done (feature 019)
- [x] T1–T15 implementadas.
- [x] T16 — build limpio.
- [x] T17 — backfill y referencia real verificados.
- [ ] T18 — cierre parcial: CA-4 escritura productiva sigue pendiente de
  autorización; el resto tiene evidencia real o de contrato.

## Modelo de IA usado (Art. 7)
| Task | Modelo | Justificación |
|---|---|---|
| T4 (codec XML-RPC) | Sonnet, con atención de "protocolo nuevo" | Sin precedente en el repo (los módulos existentes son JSON/REST) |
| T8, T9 (outbox, circuit breaker) | Sonnet | Concurrencia moderada, patrón bien acotado |
| Resto | Sonnet | Wiring estándar de backend, mismo patrón que módulos existentes |
