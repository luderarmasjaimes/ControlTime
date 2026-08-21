# SPEC 019 — Integración RP (TimeTelemetry/Odoo): réplica, escritura XML-RPC y realtime para frontend externo

| Campo | Valor |
|---|---|
| **ID** | 019 · **Estado** | **Aprobado** |
| **SOW** | ampliación de integraciones externas / soporte a nuevo frontend |
| **Constitución** | Art. 1 (multitenancy), Art. 2 (tiempo real sin pérdida — aplicado a escritura vía outbox durable), Art. 3 (aislamiento R/W), Art. 5 (observabilidad), Art. 6 (seguridad/RBAC), Art. 7 (excepción documentada — ver abajo), Art. 8 (sin credenciales hardcodeadas) |
| **ADR** | ADR-103 |
| **Última revisión** | 2026-08-18 |

## Excepción al Art. 7 ("una feature por sesión")
El usuario pidió explícitamente implementar lectura + escritura + realtime +
resiliencia en una sola sesión, tras ser informado del tamaño y de la
alternativa de fasearlo. Se documenta aquí porque la Constitución exige que
cualquier excepción quede registrada, no silenciosamente omitida.

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-019**; fuente ADR: `docs/decisions/`.

- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-103** — [`103-integracion-rp-timetelemetry-replica-xmlrpc.md`](../../docs/decisions/103-integracion-rp-timetelemetry-replica-xmlrpc.md)
- **ADR-110** — [`110-operaciones-campo-offline-integracion-erp.md`](../../docs/decisions/110-operaciones-campo-offline-integracion-erp.md)

## 1. Problema
El catálogo de equipos mineros vive en TimeTelemetry (Odoo 17, XML-RPC),
fuera de esta plataforma. Hoy solo existen scripts de un solo uso, de solo
lectura, con credenciales en texto plano, sin réplica ni resiliencia. Un
frontend nuevo (distinto al de InformeCliente) necesita leer y escribir ese
catálogo con baja latencia, y la única forma segura de integrarlo es a
través del backend de InformeCliente — nunca con acceso directo a una base
de datos desde el frontend (ver ADR-103, sección de alternativas
descartadas).

## 2. Objetivo
Sincronizar `maintenance.equipment` de TimeTelemetry hacia una réplica local
(`rp_equipment`), servirla al frontend nuevo con lecturas de latencia local
y push en tiempo real, y propagar sus escrituras hacia Odoo por XML-RPC de
forma durable y resiliente (nunca SQL directo contra la BD de Odoo).

## 3. Usuarios y contexto
- **Roles:** usuarios del frontend nuevo (mismos tenants/mineras, sesión JWT
  igual que InformeCliente); Odoo/TimeTelemetry como peer de sync (webhook
  opcional, API key de servicio).
- **Escala:** catálogo de equipos por tenant (cientos–pocos miles de
  registros, no telemetría de alta tasa) — no requiere el pipeline de
  10K/seg de `TelemetryIngestor`.

## 4. Alcance
**Incluye:**
- Backfill + polling incremental (`write_date`) desde `maintenance.equipment`
  hacia `rp_equipment`, reusando `etl_sync_peer`/`etl_sync_state`/`etl_sync_run`.
- Webhook `POST /api/rp/webhook/odoo` (API key de servicio) que dispara una
  relectura puntual por XML-RPC — nunca confía en el payload como dato.
- Escritura: `POST`/`PUT /api/rp/equipment*` (JWT/sesión) → `rp_write_outbox`
  (durable, idempotente) → drenado por XML-RPC (`create`/`write`) con
  backoff exponencial + jitter y circuit breaker por peer.
- Push WebSocket real (`WsRegistry::broadcastToTenant`) de
  `rp_equipment_updated` tras cada upsert/confirmación de escritura.
- Métricas Prometheus (`mapas_backend_rpsync_*`) y permisos RBAC
  (`rp.equipment.view`, `rp.equipment.edit`).

**NO incluye:**
- Sincronización de otros modelos de Odoo además de `maintenance.equipment`
  (extensible después — la tabla `raw_json` y el diseño de peer/mapeo ya lo
  soportan sin cambio estructural).
- Migrar `thingsboard_sync.cpp` al nuevo circuit breaker/backoff (se deja
  como mejora futura, fuera de alcance).
- UI del frontend nuevo (fuera del backend de InformeCliente).

## 5. Criterios de aceptación
- [x] **CA-1:** Backfill inicial replica en `rp_equipment` el mismo conjunto
  de equipos que devuelven los scripts de referencia (`RP/*.py`) para un
  `project_id`/`codigo` de prueba — mismo conteo de filas.
- [x] **CA-2:** Polling incremental refleja un cambio hecho directamente en
  Odoo dentro de `BEEMETRY_RP_POLL_INTERVAL_MS` (default 30 s) sin
  intervención manual.
- [x] **CA-3:** `POST /api/rp/equipment` sin sesión válida → 401; sin
  `rp.equipment.edit` → 403; con datos válidos → 202 inmediato (sin esperar
  a Odoo) y aparece en `rp_write_outbox` con `status='pending'`.
- [ ] **CA-4:** Una escritura encolada llega a Odoo (verificable en su UI +
  chatter) y `rp_equipment.sync_status` pasa a `'synced'`.
- [x] **CA-5:** Con TimeTelemetry inalcanzable: el circuit breaker abre tras
  N fallos consecutivos, `rp_write_outbox` reintenta con backoff creciente y
  pasa a `'dead'` tras `max_attempts`, sin bloquear otras rutas del backend.
- [x] **CA-6:** Una conexión WS autenticada recibe `rp_equipment_updated` sin
  hacer polling, dentro de los 2 s posteriores al cambio.
- [x] **CA-7:** `GET /api/rp/equipment` lee de `storage::PgPool::replica()`
  (verificable: no hay locks/latencia compartida con el hilo de backfill que
  escribe en la primaria).
- [x] **CA-8:** `POST /api/rp/webhook/odoo` sin la API key correcta → 401;
  con key correcta pero payload con un `id` inexistente → no revienta,
  responde 200 y no aplica nada.
- [x] **CA-9:** Ningún archivo del repo contiene la credencial real de
  TimeTelemetry — vive solo en `etl_sync_peer.auth_config` (BD).

> **Corte 2026-08-18:** CA-1/2/6/7 fueron contrastados con el peer real
> (2.108 equipos y cambio incremental); CA-3/5/8/9 cuentan con prueba de
> contrato/harness. **CA-4 permanece abierta**: el write productivo
> `create/write` requiere una ventana autorizada en Odoo. Por tanto la
> integración es funcional para réplica/lectura y técnicamente preparada para
> escritura, pero no se declara escritura productiva aceptada.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Latencia de lectura (frontend nuevo) | réplica local, sin round-trip a Odoo |
| Latencia de push realtime | ≤ 2 s desde el cambio aplicado |
| Latencia de escritura confirmada | mejor esfuerzo, asíncrona — outbox con backoff hasta `max_attempts` (default 8) |
| Aislamiento primaria/réplica | lecturas del frontend nuevo nunca compiten con el hilo de sync (Art. 3) |
| Disponibilidad ante caída de TimeTelemetry | el backend y el frontend nuevo siguen operando sobre la réplica; solo se degrada la frescura de datos y la confirmación de escrituras |

## 7. Contratos
- `GET /api/rp/equipment` (Bearer/sesión, `rp.equipment.view`) → lista paginada.
- `GET /api/rp/equipment/{id}` → detalle (columnas promovidas + `raw_json`).
- `POST /api/rp/equipment` (`rp.equipment.edit`) → 202, encola `create`.
- `PUT /api/rp/equipment/{id}` (`rp.equipment.edit`) → 202, encola `update`.
- `GET /api/rp/equipment/{id}/sync-status` → `{sync_status, last_error}`.
- `POST /api/rp/webhook/odoo` (header `X-RP-Webhook-Key`) → `{model, id}` → 200/401.
- WS: evento `{"channel":"rp","type":"rp_equipment_updated","equipment_id":...}` por tenant.
- Métricas: `mapas_backend_rpsync_*` (backfill, incremental, webhook, outbox por estado, circuit breaker).

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Password de TimeTelemetry filtrada (hallazgo previo, scripts en texto plano) | Rotar credencial; vivir solo en `etl_sync_peer.auth_config` |
| Webhook de Odoo no configurado/no dispara | Polling incremental es el camino garantizado; el webhook es solo aceleración de latencia, nunca la única vía |
| Odoo rechaza una escritura por validación de negocio | `rp_write_outbox` guarda `last_error`, pasa a `dead` tras `max_attempts`, expuesto por métricas — requiere intervención manual, no se pierde silenciosamente |
| Circuit breaker abre y oculta una caída real más allá del cooldown | Métricas + `etl_sync_run.status='failed'` visibles en `/api/metrics` y en la tabla de auditoría |
| Esquema de `maintenance.equipment` cambia en un upgrade de Odoo | XML-RPC es el contrato estable; `raw_json` absorbe campos nuevos sin migración; campos promovidos ausentes quedan `NULL`, no rompen el sync |
