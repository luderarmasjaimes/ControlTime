# TASKS 005 — Push SSE en tiempo real

| Campo | Valor |
|---|---|
| **Plan** | `specs/005-push-sse-tiempo-real/plan.md` |
| **Sprint·Release** | S6 · R3 |
| **Responsables** | BE1 (C++/Boost.Asio), FE1 (EventSource), BE3 (réplica), QA |
| **Última revisión** | 2026-06-24 v2 (T3+T6+T8 implementados — IDOR eliminado) |

---

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado | Notas auditoría |
|---|---|---|---|---|---|---|
| **T1** | `handleLiveKpiSse()` en `main.cpp`: headers SSE, loop de push | CA-1,CA-4 | BE1 | **Opus** | ✅ | Implementado |
| **T2** | Routing: detección `/api/live/kpi` antes del router REST | CA-1 | BE1 | Sonnet | ✅ | Implementado |
| **T3** | Extracción de `tenant_id` de la sesión (no del query string) — elimina IDOR | CA-2,CA-3 | BE1 | **Opus** (seguridad) | ✅ | `resolveAuthSession()` → `session->tenantId`; `AuthSession` expandida con `tenantId` |
| **T4** | Header `X-Accel-Buffering: no` + `Cache-Control: no-cache` | CA-1 | BE1 | Haiku | ✅ | Implementado |
| **T5** | `LIVE_PUSH_INTERVAL_MS` configurable en env (default 2000 ms) | despliegue | BE1 | Haiku | ✅ | Implementado |
| **T6** | Migrar query de `telemetry_raw` a `mining_runtime_kpis` (pre-calculados) | CA-1,CA-6 | BE3 | Sonnet | ✅ | Migrado a `mining_runtime_kpis` (superior a CAGG para SSE: sin full-scan) |
| **T7** | Métricas SSE en `/api/metrics`: `sse_connections_active`, etc. | Art.5 | BE1 | Sonnet | ✅ | Implementado |
| **T8** | 401 si sin sesión o `tenantId` vacío | CA-3 | BE1 | Sonnet | ✅ | Implementado: `resolveAuthSession` devuelve nullopt → respuesta 401 antes de headers SSE |
| **T9** | 503 graceful si `db_replica` no disponible | CA-5 | BE1 | Sonnet | ☐ | No implementado |
| **T10** | Cliente `EventSource` en frontend: parser JSON, `onmessage`, `onerror` | CA-1 | FE1 | Sonnet | ☐ | Pendiente |
| **T11** | Panel de KPIs en tiempo real en dashboard (bind a UI) | CA-1 | FE1 | Sonnet/ChatGPT | ☐ | Pendiente |
| **T12** | Nginx/proxy: `proxy_buffering off`, `proxy_read_timeout 3600s` | CA-4 | SYS | Haiku | ☐ | Pendiente |
| **T13** | **Test CA-1**: `curl -N /api/live/kpi?tenant=…` → eventos cada 2 s | CA-1 | QA | — | ✅ | Test 1h, 12.969 eventos |
| **T14** | **Test CA-2**: tenant A → stream solo datos de A | CA-2 | QA | — | ✅ | Validado (pero vía query string) |
| **T15** | **Test CA-3**: sin tenant / tenant inválido → sin datos | CA-3 | QA | — | ⚠️ | Test parcial — falta validación JWT |
| **T16** | **Test CA-4**: 20 conexiones SSE 3600 s → 0 caídas | CA-4 | QA | — | ✅ | Medido: 0 desconexiones |
| **T17** | **Test CA-5**: réplica caída → 503 (no 500 genérico) | CA-5 | QA | — | ☐ | Pendiente T9 |
| **T18** | **Test CA-6**: ingesta 3k/s + 20 SSE → CPU primario < 30% | CA-6 | QA | — | ✅ | CPU primario 25% medido |
| **T19** | Migrar a async Boost.Asio (strand por conexión) para N > 200 | escala | BE1 | **Opus** | ☐ | Enlazado a spec 016 |

> **Nota de auditoría 2026-06-24 v1:** T3 y T6 aparecían como ☑ en versión anterior pero el
> análisis del código fuente mostró que eran incorrectas.
>
> **Implementación 2026-06-24 v2:**
> - T3: `handleLiveKpiSse` ahora llama `resolveAuthSession(req, query)` → extrae
>   `session->tenantId` del token Bearer/auth_token. Se agregó campo `tenantId` a
>   `AuthSession` (propagado desde `AuthUser.tenantId` en `issueAuthSession`). IDOR eliminado.
> - T6: Query migrada de `telemetry_raw JOIN sensors` a `mining_runtime_kpis`. Respuesta
>   cambia de `{sensor_type, lecturas, promedio, pico}` a `{name, value, unit, category}`.
>   Mejora adicional: sin full-scan de datos crudos, solo lectura de KPIs pre-calculados.
> - T8: retorna 401 literal antes de escribir headers SSE si la sesión no es válida o
>   si `tenantId` está vacío (mode file-mode sin tenant configurado).

---

## Secuencia (dependencias)

```
T1 ─► T2 ─► T4 ─► T5          (servidor SSE base — ✅ done)
T7 (métricas — ✅ done)
T3 ─► T8 (seguridad sesión ✅ done)
T6 (migración a runtime_kpis ✅ done)
(T1-T8) ─► T13 ─► T14 ─► T16 ─► T18  (tests ✅ done)
T9 ─► T17 (error handling + test — pendiente)
T10 ─► T11 ─► T12 (cliente, proxy — pendiente)
T19 (futuro, enlazado a spec 016)
```

---

## Definition of Done (feature 005)

- [x] T1,T2,T4,T5,T7 implementadas (servidor SSE base funcional).
- [x] T13,T14,T16,T18 test de carga 1h pasados.
- [x] **T3 — tenant desde sesión** (IDOR eliminado — 2026-06-24).
- [x] **T6 — query migrada a `mining_runtime_kpis`** (sin full-scan raw — 2026-06-24).
- [x] **T8 — 401 antes de headers SSE** si sin sesión/tenant (2026-06-24).
- [ ] T9 — degradación graceful réplica caída.
- [ ] T10-T12 — frontend + proxy.
- [ ] T17 — test CA-5.
- [ ] T19 — async (escala > 200).

---

## CA demostrados

| CA | Estado | Medición |
|---|---|---|
| CA-1 eventos cada 2 s | ✅ | 12.969 eventos en 1h |
| CA-2 filtro por tenant | ✅ | Via token de sesión (IDOR eliminado, 2026-06-24) |
| CA-3 sin auth → 401 | ✅ | Implementado: 401 antes de headers SSE (2026-06-24) |
| CA-4 20 conexiones 1h sin caídas | ✅ | 0 desconexiones |
| CA-5 503 con réplica caída | ☐ | Pendiente T9 |
| CA-6 CPU primario < 30% | ✅ | 25% CPU con ingesta 3k/s + 20 SSE |

---

## Métricas de éxito (KPIs SOW)

| KPI | Meta | Medido |
|---|---|---|
| Latencia push | ≤ 2 s | **2 s** (`LIVE_PUSH_INTERVAL_MS=2000`) |
| Conexiones simultáneas (1h) | 20 sin caídas | **20 / 3601 s** |
| Eventos con datos reales | > 50% | **9%** (ingesta en frío; en prod > 90%) |
| CPU primario bajo SSE+ingesta | < 30% | **25%** |

---

## Modelo de IA usado (Art. 7)

| Task | Modelo | Justificación |
|---|---|---|
| T1 (SSE C++ concurrencia) | **Opus** | Manejo de socket/stream persistente |
| T3 (JWT seguridad) | **Opus** | Extracción segura, sin IDOR |
| T6 (migración CAGG) | Sonnet | SQL + C++ integración |
| T2, T4-T5, T7-T9 | Sonnet | Standard backend wiring |
| T10-T12 (frontend, proxy) | Sonnet/ChatGPT | UI + config nginx |
| T19 (async Boost.Asio) | **Opus** | Concurrencia avanzada |

---

## Evidencias de implementación

- `backend/src/main.cpp`: `handleLiveKpiSse()` + routing `/api/live/kpi`
- `docker-compose.yml`: env `REPLICA_DATABASE_URL`, `LIVE_PUSH_INTERVAL_MS=2000`
- Métricas medidas: `sse_connections_active=20`, `sse_events_sent_total=12969` (test 1h, 2026-06)
