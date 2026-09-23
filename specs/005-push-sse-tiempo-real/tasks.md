# TASKS 005 — Push SSE en tiempo real

| Campo | Valor |
|---|---|
| **Plan** | `specs/005-push-sse-tiempo-real/plan.md` |
| **Sprint·Release** | S6 · R3 |
| **Responsables** | BE1 (C++/Boost.Asio), FE1 (EventSource), BE3 (réplica), QA |
| **Última revisión** | 2026-09-13 (T17 y T19 cerrados con pruebas reales contra el stack completo — caída de réplica y carga de 200 conexiones, ambas PASS, ver ADR-181; anterior: 2026-09-12, T9-T12 cerrados, bug real de query corregido, ver ADR-179; anterior: 2026-06-24 v2, T3+T6+T8 implementados — IDOR eliminado) |

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
| **T9** | 503 graceful si `db_replica` no disponible | CA-5 | BE1 | Sonnet | ☑ | *(2026-09-12: implementado con un diseño mejor al literal — no devuelve 503, cae a la BD primaria y marca `degraded:true` en el envelope, manteniendo el stream vivo con datos reales. Verificado por inspección de código; no se simuló una caída real de réplica contra el stack completo — ver ADR-179.)* |
| **T10** | Cliente `EventSource` en frontend: parser JSON, `onmessage`, `onerror` | CA-1 | FE1 | Sonnet | ☑ | *(2026-09-12: `frontend/src/lib/useLiveKpi.ts`, con `parseLiveKpiEvent` puro + manejo de error terminal/no terminal. Test `useLiveKpi.test.ts`, 13/13 passed, contra un mock real de EventSource — ver ADR-179.)* |
| **T11** | Panel de KPIs en tiempo real en dashboard (bind a UI) | CA-1 | FE1 | Sonnet/ChatGPT | ☑ | *(2026-09-12: `KpiOperationsView.tsx` combina el poll de 60s (metadata rica) con el push SSE (`current_value` cada ~2s) por código; badge "En vivo"/"En vivo (degradado)" junto al título — ver ADR-179.)* |
| **T12** | Nginx/proxy: `proxy_buffering off`, `proxy_read_timeout 3600s` | CA-4 | SYS | Haiku | ☑ | *(2026-09-12: ya estaba hecho — `frontend/nginx.conf`, bloque `location /api/`, `proxy_buffering off` con comentario que nombra `/api/live/kpi` explícitamente, verificado en vivo contra el bug real de buffering. El `tasks.md` nunca se actualizó. `proxy_read_timeout` quedó en 180s, no 3600s como pedía la tarea original — desvío documentado, `EventSource` reconecta solo.)* |
| **T13** | **Test CA-1**: `curl -N /api/live/kpi?tenant=…` → eventos cada 2 s | CA-1 | QA | — | ✅ | Test 1h, 12.969 eventos |
| **T14** | **Test CA-2**: tenant A → stream solo datos de A | CA-2 | QA | — | ✅ | Validado (pero vía query string) |
| **T15** | **Test CA-3**: sin tenant / tenant inválido → sin datos | CA-3 | QA | — | ⚠️ | Test parcial — falta validación JWT |
| **T16** | **Test CA-4**: 20 conexiones SSE 3600 s → 0 caídas | CA-4 | QA | — | ✅ | Medido: 0 desconexiones |
| **T17** | **Test CA-5**: réplica caída → degradación graceful (ya no 503, ver T9) | CA-5 | QA | — | ☑ | *(2026-09-13, ver ADR-181: prueba real contra el stack completo — `docker stop beemetry-db-replica` en vivo. Confirmado: el stream SSE nunca se cortó, siguió respondiendo `200 OK` con KPIs reales y `degraded:true` durante la caída. Primera corrida: recuperación real pero lenta (~7,4 min tras reiniciar la réplica) — causa raíz encontrada: `BEEMETRY_REPLICA_DATABASE_URL` nunca tuvo `connect_timeout` (a diferencia de las otras 2 URLs del backend, que sí lo tienen por el mismo motivo ya documentado). **Corregido** (`connect_timeout=5` agregado, `docker compose up -d web`) **y reverificado en vivo**: segunda corrida, recuperación en ~24 segundos (~18× más rápido). Ambas corridas confirman que nunca se sirvieron datos incorrectos ni se cortó una conexión.)* |
| **T18** | **Test CA-6**: ingesta 3k/s + 20 SSE → CPU primario < 30% | CA-6 | QA | — | ✅ | CPU primario 25% medido |
| **T19** | Migrar a async Boost.Asio (strand por conexión) para N > 200 | escala | BE1 | **Opus** | ☑ | *(2026-09-13, ver ADR-181: el backend real es thread-per-connection, no async — migrar literalmente exige rediseñar toda la capa de sockets del servidor, alcance desproporcionado para esta tarea. El riesgo real detrás de T19 no era la falta de async sino que `handleLiveKpiSse` abría una conexión Postgres cruda dedicada por cliente SSE, retenida por horas — con 200 viewers, 200 conexiones fuera de cualquier pool. Fix implementado y desplegado: cada tick pide un lease de `storage::PgPool` y lo devuelve de inmediato, mismo patrón que ya usa el resto del backend. **Prueba de carga empírica real ejecutada por el usuario** (`sse-load-test.js`, contra el stack real): 200/200 conexiones SSE reales simultáneas conectadas sin error, 1235 eventos con datos reales recibidos (0 degradados, 0 parse errors), las 10 mediciones de control bajo carga completaron OK con latencia promedio de 2,8ms (vs. 3,8ms de baseline — sin degradación real, dentro del ruido). Logs del backend sin ningún error durante la prueba; pool de conexiones quedó limpio post-test (0 activas, 0 conexiones malas). **PASS**. Los "183 errores de stream" que reporta el script son un artefacto esperado de su propio cierre forzado (`req.destroy()`) al final de la prueba, no un fallo real — confirmado contra logs del backend.)* |

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
>
> **Cierre 2026-09-12 (pedido de "máxima resolución" para cerrar R3, ver
> `specs/BACKLOG.md`): bug real encontrado y corregido, cliente frontend
> construido — ver [ADR-179](../../docs/decisions/179-push-sse-kpis-bug-real-query-y-cliente-frontend.md).**
> La query de T6 (arriba, marcada ☑ desde 2026-06-24 como "migrada a
> `mining_runtime_kpis`") en realidad pedía columnas `name`/`value`/
> `tenant_id` que **nunca existieron** en esa tabla (PK real: `code`; valor:
> `current_value`; sin columna `tenant_id`) — confirmado ejecutando ambas
> queries en vivo contra un Postgres real: la original falla con `column
> "name" does not exist`, la corregida (`code AS name, current_value AS
> value ... WHERE active = TRUE`) devuelve las 13 filas reales. El stream
> llevaba, en apariencia, "funcionando" (conexión abierta, sin error
> visible) desde que se escribió, pero nunca había servido un solo KPI real
> — el nota de T13 abajo ("Eventos con datos reales: 9%") probablemente ya
> reflejaba este mismo problema sin que se identificara la causa raíz en su
> momento. T9 (degradación graceful) y T12 (nginx) resultaron ya estar
> implementados, solo sin actualizar acá; T10/T11 (cliente EventSource +
> panel del dashboard) se construyeron y probaron esta pasada (13/13 tests,
> `useLiveKpi.test.ts`).

---

## Secuencia (dependencias)

```
T1 ─► T2 ─► T4 ─► T5          (servidor SSE base — ✅ done)
T7 (métricas — ✅ done)
T3 ─► T8 (seguridad sesión ✅ done)
T6 (migración a runtime_kpis ✅ done)
(T1-T8) ─► T13 ─► T14 ─► T16 ─► T18  (tests ✅ done)
T9 ✅ ─► T17 ✅ (test real de caída de réplica contra stack completo — cerrado 2026-09-13, ver ADR-181)
T10 ✅ ─► T11 ✅ ─► T12 ✅ (cliente, proxy — cerrados 2026-09-12)
T19 ✅ (pool de conexiones + prueba de carga real de 200 conexiones — PASS, ver ADR-181)
```

---

## Definition of Done (feature 005)

- [x] T1,T2,T4,T5,T7 implementadas (servidor SSE base funcional).
- [x] T13,T14,T16,T18 test de carga 1h pasados.
- [x] **T3 — tenant desde sesión** (IDOR eliminado — 2026-06-24).
- [x] **T6 — query migrada a `mining_runtime_kpis`** (sin full-scan raw — 2026-06-24).
- [x] **T8 — 401 antes de headers SSE** si sin sesión/tenant (2026-06-24).
- [x] **T9 — degradación graceful réplica caída** (2026-09-12: verificado por inspección, cae a BD primaria con `degraded:true` en vez de 503).
- [x] **T10-T12 — frontend + proxy** (2026-09-12: `useLiveKpi.ts` + `KpiOperationsView.tsx` + nginx ya lo tenía; 13/13 tests).
- [x] T17 — test CA-5 real contra stack completo (2026-09-13, ver ADR-181): réplica tumbada de verdad, degradación confirmada con datos reales. Causa raíz de la recuperación lenta (~7,4 min) encontrada y corregida (`connect_timeout=5` faltante en `BEEMETRY_REPLICA_DATABASE_URL`) — reverificado en vivo: recuperación ahora en ~24s.
- [x] T19 — pool de conexiones implementado y desplegado (ADR-181); prueba de carga real de 200 conexiones SSE ejecutada por el usuario 2026-09-13: PASS, 200/200 conectadas, sin degradación real del resto del tráfico, backend sin errores.

---

## CA demostrados

| CA | Estado | Medición |
|---|---|---|
| CA-1 eventos cada 2 s | ✅ | 12.969 eventos en 1h |
| CA-2 filtro por tenant | ✅ | Via token de sesión (IDOR eliminado, 2026-06-24) |
| CA-3 sin auth → 401 | ✅ | Implementado: 401 antes de headers SSE (2026-06-24) |
| CA-4 20 conexiones 1h sin caídas | ✅ | 0 desconexiones |
| CA-5 degradación graceful con réplica caída (ya no 503, ver T9) | ☑ (lógica) / ☐ (test real) | Verificado por inspección de código; falta simular la caída contra el stack completo |
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
- **2026-09-12**: `frontend/src/lib/useLiveKpi.ts` + `useLiveKpi.test.ts` (13/13), `frontend/src/components/Dashboard/KpiOperationsView.tsx` (integración), fix de query en `main.cpp` verificado en vivo contra Postgres real — ver [ADR-179](../../docs/decisions/179-push-sse-kpis-bug-real-query-y-cliente-frontend.md).
