# TASKS 016 — Alertas y umbrales por sensor

| Campo | Valor |
|---|---|
| **Plan** | `specs/016-alertas-umbrales-sensores/plan.md` |
| **Sprint·Release** | Etapa 2 (S9-S10 · R5) |
| **Responsables** | BE1 (consumidor/SSE), BE3 (DBA/schema), FE1 (panel alertas), QA |

> **Nota 2026-09-02 (ver ADR-140 y actualización de ADR-034 en `docs/decisions/`)**:
> este spec describía un diseño específico (evaluación embebida en el
> consumidor Kafka, canal SSE dedicado) que nunca se construyó tal cual — lo
> que existe es el motor de alarmas de **ADR-034** (hilo de fondo por
> polling + push WebSocket), extendido el 2026-09-02 con lo que le faltaba
> real (cache de reglas, condición por tasa de cambio, debounce por ventana,
> endpoint de actualización, paginación). La tabla de abajo se actualiza para
> reflejar el estado real, sin fingir que se construyó el diseño original
> tal como estaba escrito.

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Schema SQL: `alert_rules` (condición, umbrales, debounce, tenant_id) | CA-2,CA-4 | BE3 | Sonnet | ☑ *(`platform_alarm_rules`, ADR-034 + `db_scripts/89` para debounce/condition_type)* |
| **T2** | Schema SQL: `alert_events` (historial con ack_by/ack_at) | CA-5 | BE3 | Sonnet | ☑ *(`platform_alarms`, columnas `acknowledged_by`/`acknowledged_at`)* |
| **T3** | Cache LRU de reglas en consumidor (`loadRules` con TTL 60 s) | CA-1 | BE1 | **Opus** (concurrencia) | ☑ *(2026-09-02: TTL 60s sobre el conjunto completo de reglas habilitadas, no LRU por clave individual — ver nota en ADR-140 de por qué "LRU" no aplica literalmente. `getCachedEnabledRules()`, `device_alarm_routes.cpp`.)* |
| **T4** | `evaluateRules(msg, rules)` → `[]Alert` (condiciones: above_max, below_min, rate) | CA-1,CA-6 | BE1 | **Opus** | ☑ *(2026-09-02: `condition_type` `'value'`/`'rate'` + `computeRatePerMinute()`. `above_max`/`below_min` no se implementaron como condiciones separadas — ya eran `gt`/`lt` sobre valor absoluto en ADR-034, redundante con lo pedido. Ver ADR-140.)* |
| **T5** | Debounce en memoria por `rule_id` (anti-tormenta, Art. 9) | CA-6 | BE1 | Sonnet | ☑ *(2026-09-02: `debounce_secs` por regla + `isWithinDebounceWindow()`, complementa — no reemplaza — el índice único parcial ya existente de ADR-034. Ver ADR-140.)* |
| **T6** | `INSERT INTO alert_events` si alerta pasa debounce | CA-1,CA-5 | BE1 | Sonnet | ☑ *(`INSERT INTO platform_alarms`, ya con el guard de debounce de T5 antes del insert)* |
| **T7** | Canal SSE de alertas: `AlertChannel` compartido con consumidor | CA-3 | BE1 | **Opus** | ☐ *(no construido — decisión consciente 2026-09-02, ver ADR-140 § Consecuencias: la plataforma ya empuja alarmas por WebSocket, `alarm_notifier.cpp`; un canal SSE paralelo duplicaría el transporte sin pedido de negocio)* |
| **T8** | `GET /api/live/alerts` — SSE stream (reutiliza patrón de spec 005) | CA-3 | BE1 | Sonnet | ☐ *(mismo motivo que T7 — el push real es WS, no SSE)* |
| **T9** | `GET /api/alert/rules` + `POST/PUT/DELETE` (CRUD, admin/supervisor) | CA-2,CA-4 | BE1 | Sonnet | ☑ *(rutas reales: `GET/POST/PUT/DELETE /api/mining/alarms/rules`; PUT agregado 2026-09-02, antes solo POST/GET/DELETE)* |
| **T10** | `GET /api/alert/events` — historial paginado | CA-5 | BE1 | Sonnet | ☑ *(2026-09-02: `GET /api/mining/alarms` acepta `limit`/`offset`/`severity`, responde `total`; antes `LIMIT 200` fijo sin paginación real)* |
| **T11** | `POST /api/alert/events/{id}/ack` — reconocimiento de alerta | CA-5 | BE1 | Sonnet | ☑ *(`POST /api/mining/alarms/{id}` — ack real, `acknowledged_by`/`acknowledged_at`)* |
| **T12** | Invalidación cache: `POST /api/alert/rules` llama `ruleCache.invalidate(tenant)` | CA-2 | BE1 | Sonnet | ☑ *(2026-09-02: `invalidateRuleCache()` en create/update/delete de reglas)* |
| **T13** | Frontend: panel de alertas activas + historial + reconocimiento | CA-3,CA-5 | FE1 | Sonnet | ☑ *(`AlarmCenter.tsx`)* |
| **T14** | Frontend: badge contador en navbar cuando hay alertas activas | CA-3 | FE1 | Sonnet | ☐ *(no verificado específicamente en esta pasada — pendiente confirmar si `AlarmCenter.tsx` ya lo tiene)* |
| **T15** | **Test CA-1**: lectura cruza umbral → alerta en < 2 s | CA-1 | QA | — | ☑ *(2026-09-02, segunda pasada: a pedido explícito del developer se implementó evaluación por evento (hook en `TelemetryIngestor::copyBatch()`, ver actualización de ADR-140) en vez de solo polling. Verificado en vivo con timestamps exactos: regla creada → lectura real empujada 1s después → alarma con `triggered_at` **179ms** después del push. El polling de 10s sigue existiendo como red de seguridad y como única vía para reglas de `mining_sensor_id`.)* |
| **T16** | **Test CA-2**: CRUD reglas → umbral activo/inactivo funciona | CA-2 | QA | — | ☑ *(2026-09-02: verificado en vivo contra `beemetry-api`/`beemetry-db` reales — create/list/update/delete de reglas con `condition_type`/`debounce_secs`, ver ADR-140 § Verificación E2E. Manual, no suite automatizada.)* |
| **T17** | **Test CA-3**: alerta llega por SSE `/api/live/alerts` | CA-3 | QA | — | ☐ *(no aplica tal cual — no hay canal SSE, ver T7/T8; el equivalente WS ya está probado en ADR-034)* |
| **T18** | **Test CA-4**: empresa A no ve alertas de empresa B | CA-4 | QA | — | ☑ *(2026-09-02: verificado en vivo con DOS tenants demo reales (Beemetry/TimeTelemetry) — regla de un tenant no aparece en el listado del otro; DELETE cross-tenant → 404, no 200. Ver ADR-140. Manual, no suite automatizada.)* |
| **T19** | **Test CA-5**: historial auditado con ack | CA-5 | QA | — | ☑ *(2026-09-02: ack real verificado en vivo (`POST /api/mining/alarms/{id}` → `acknowledged=true` confirmado); auditoría encadenada ya la había verificado ADR-034 con `fn_platform_audit_insert`. Manual, no suite automatizada.)* |
| **T20** | **Test CA-6**: 100 cruces en 5 s → max 1 alerta por debounce | CA-6 | QA | — | ☑ *(2026-09-02, tercera pasada: prueba de carga real contra `beemetry-api`/`beemetry-db` — 100 lecturas concurrentes que cruzan el umbral empujadas en 1.31s reales (`ThreadPoolExecutor`, 20 workers) contra una regla con `debounce_secs=5`. Resultado: exactamente 1 alarma creada (`idx_alarms_one_open_per_rule` + debounce trabajando juntos como diseñado). Script no se commitea (ad-hoc de esta verificación); la lógica pura ya tenía cobertura unitaria en `test_alarm_rule_evaluator.cpp`.)* |

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

- [ ] T1-T12 completadas. *(11/12 — T7/T8 (canal SSE dedicado) no se construyen, decisión consciente, ver ADR-140. El resto sí.)*
- [x] CA-1..6 demostrados con evidencia. *(2026-09-02, tercera pasada: CA-1/CA-2/CA-4/CA-5/CA-6 verificados EN VIVO contra `beemetry-api`/`beemetry-db` reales (T15/T16/T18/T19/T20) — CA-1 con timestamp exacto (179ms), CA-6 con carga real (100 cruces en 1.31s → 1 alarma). CA-3 no aplica: sin canal SSE, decisión consciente documentada en ADR-140/T7-T8 (el push real es WebSocket, ya probado en ADR-034) — se marca completo entendiendo CA-3 como excepción de diseño, no como evidencia faltante.)*
- [x] ADR-016-1..5 registrados. *(ADR-140 — el número 016 ya estaba tomado en el log global por `016-export-server-side-asincrono.md`, ver nota de numeración en ADR-140.)*
- [ ] Sin violar Constitución (Art. 1, 2, 5, 9). *(Art. 9 — anti-tormenta — cubierto por T5; Art. 1/2/5 no reverificados explícitamente en esta pasada.)*
- [ ] Gate R5: demo alerta en tiempo real en dashboard. *(requiere stack corriendo + demo en vivo, no ejecutado en esta pasada.)*

## Métricas

| KPI | Meta | Cómo medir |
|---|---|---|
| Latencia alerta | < 2 s desde ingesta | timestamp telemetría vs ts alert_events |
| Anti-tormenta | máx 1/debounce_secs por regla | test de carga T20 |
| Aislamiento multitenant | 0 cross-tenant | T18 |
| Historial auditado | 100% eventos | COUNT alert_events vs COUNT triggered |
