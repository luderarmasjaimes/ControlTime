# PLAN 019 — Integración RP (TimeTelemetry/Odoo)

| Campo | Valor |
|---|---|
| **Spec** | `specs/019-integracion-rp-timetelemetry/spec.md` (Aprobado) |
| **Autor** | Claude Code (sesión 2026-08-10, con Luder Armas) |
| **Fecha** | 2026-08-10 |

## 1. Enfoque técnico
Replicar el esqueleto ya probado de `thingsboard_sync.cpp` (peer en
`etl_sync_peer`, watermark en `etl_sync_state`, bitácora en `etl_sync_run`,
hilo de backfill + hilo incremental, upsert canónico) adaptado a Odoo
XML-RPC: sin JWT expirable (cada llamada reenvía `db/uid/password`), sin
WebSocket nativo del lado Odoo (el realtime se resuelve con poll corto +
webhook opcional de aceleración). Se agrega lo que `thingsboard_sync` no
tiene: TLS en el cliente HTTP, circuit breaker, backoff exponencial con
jitter, y un outbox de escritura durable con consumidor real (a diferencia
de `org_notification_outbox`, que no tiene uno).

## 2. Arquitectura / componentes afectados
```
backend/src/http/http_client.{hpp,cpp}        [nuevo] cliente HTTP(S) compartido
backend/src/mining/rp_odoo_sync.{hpp,cpp}     [nuevo] codec XML-RPC + backfill/incremental/webhook/outbox/circuit breaker
backend/src/mining/rp_gateway_routes.{hpp,cpp}[nuevo] REST para el frontend nuevo
backend/src/main.cpp                          [modificado] registerRoutes, startRpOdooSync, métricas
db_scripts/52_rp_timetelemetry_integracion.sql[nuevo] rp_equipment, rp_write_outbox, permisos RBAC
```

## 3. Modelo de datos
- **Reusadas**: `etl_sync_peer` (fila con `auth_config->>'kind'='timetelemetry'`),
  `etl_sync_state` (watermark por `stream_code='maintenance.equipment'`, usa
  `watermark_ts` — no `watermark_bigint`, a diferencia de TB), `etl_sync_run`
  (mode extendido con `'webhook_nudge'`).
- **`rp_equipment`** (nueva, tenant-scoped vía `tenant_id`): columnas
  promovidas (`codigo`, `name`, `category_id/name`, `project_id/name`,
  `state`, `serial_no`, `location`, `latitude/longitude`, `assigned_user`,
  `odoo_write_date`) + `raw_json JSONB` (registro Odoo completo) +
  `sync_status`. `UNIQUE (peer_id, external_id)`. Índices: `tenant_id`,
  `(tenant_id, codigo)`, GIN sobre `raw_json`.
- **`rp_write_outbox`** (nueva): cola durable — `idempotency_key UNIQUE`,
  `operation`, `payload_json`, `status`, `attempts`, `next_attempt_at`
  (backoff programado), `last_error`. Índice parcial
  `(status, next_attempt_at) WHERE status IN ('pending','failed')` para que
  el drenador no escanee filas ya resueltas.
- Aislamiento (Art. 1): toda fila de `rp_equipment`/`rp_write_outbox` lleva
  `tenant_id`; las rutas REST filtran siempre por `session->tenantId`
  verificado con `userHasRealTenantMembership`.

## 4. Contratos / interfaces
Ver `spec.md` §7. Auth: `resolveAuthSession` + `hasPermission` en todas las
rutas salvo `POST /api/rp/webhook/odoo` (API key de servicio, header
`X-RP-Webhook-Key`, comparación en tiempo constante).
Métricas (Art. 5): `mapas_backend_rpsync_{enabled,peers_configured,
backfill_runs_total,backfill_upserted_total,incremental_polls_total,
webhook_nudges_total,outbox_pending,outbox_sent_total,outbox_dead_total,
circuit_state,xmlrpc_errors_total,auth_failures_total}`.

## 5. Concurrencia / performance
- 1 hilo de backfill + 1 hilo de polling incremental + 1 hilo de drenado de
  outbox por peer activo (mismo criterio que `realtimeSupervisor` de TB:
  releído periódicamente, no requiere reinicio para agregar un peer).
- Lecturas del frontend nuevo siempre contra `storage::PgPool::replica()`
  (Art. 3) — nunca compiten con los hilos de escritura del sync.
- Upsert por lotes (`INSERT ... ON CONFLICT ... DO UPDATE`, tamaño de lote
  configurable, default 200 — mismo valor que `READ_BATCH_SIZE` del script
  de referencia) en vez de fila por fila.
- Circuit breaker por peer evita que un Odoo caído sature hilos/conexiones
  del backend con reintentos.

## 6. Seguridad
- Escritura solo vía XML-RPC (ver ADR-103) — nunca credenciales de BD de
  Odoo en este backend.
- RBAC: `rp.equipment.view` / `rp.equipment.edit` (patrón ADR-079).
- Webhook: API key de un solo propósito, nunca válida en otra ruta; payload
  tratado como no confiable (solo dispara relectura autoritativa por
  XML-RPC).
- Credenciales de TimeTelemetry: solo en `etl_sync_peer.auth_config`
  (columna JSONB en BD), nunca en el repo — ver hallazgo de seguridad en
  ADR-103 sobre los scripts de referencia.

## 7. Decisiones de arquitectura (ADR)
| ADR | Decisión | Estado |
|---|---|---|
| ADR-103 | Réplica local + escritura XML-RPC + JWT frontend + API key webhook + push WS | Aceptado |

## 8. Plan de pruebas (cómo se verifica cada CA)
| Criterio (spec) | Cómo se prueba | Evidencia esperada |
|---|---|---|
| CA-1 | Backfill contra `project_id` de prueba, comparar conteo vs `RP/*.py` | Conteo de filas igual |
| CA-2 | Editar un equipo en Odoo, esperar `BEEMETRY_RP_POLL_INTERVAL_MS` | `rp_equipment.odoo_write_date` actualizado |
| CA-3 | `POST /api/rp/equipment` sin sesión / sin permiso / válido | 401 / 403 / 202 + fila en outbox |
| CA-4 | Drenar outbox contra Odoo real de prueba | Registro visible en Odoo + `sync_status='synced'` |
| CA-5 | Apagar conectividad a TimeTelemetry | Circuit breaker abre, outbox → `dead` tras `max_attempts` |
| CA-6 | Cliente WS conectado, disparar cambio | Evento `rp_equipment_updated` ≤ 2 s |
| CA-7 | Verificar en código que las rutas GET usan `PgPool::replica()` | Revisión de código + logs de conexión |
| CA-8 | Webhook sin key / con key + id inexistente | 401 / 200 sin efecto |
| CA-9 | `grep` de la credencial real en el repo | Sin coincidencias |

## 9. Plan de despliegue / rollback
- Migración `db_scripts/52` es aditiva (solo `CREATE TABLE`/`ALTER ...
  CHECK`) — rollback = no aplicar o `DROP TABLE IF EXISTS rp_equipment,
  rp_write_outbox` (sin impacto en tablas existentes).
- Módulo gateado por `BEEMETRY_RP_SYNC_ENABLED=false` por defecto — desplegar
  sin activar no tiene efecto en producción; activar es un paso explícito
  posterior, con la fila de `etl_sync_peer` cargada aparte por el usuario/ops.
- Variables de entorno nuevas: `BEEMETRY_RP_SYNC_ENABLED`,
  `BEEMETRY_RP_POLL_INTERVAL_MS`, `BEEMETRY_RP_BACKFILL_INTERVAL_MS`,
  `BEEMETRY_RP_INITIAL_LOOKBACK_DAYS`, `BEEMETRY_RP_WEBHOOK_KEY`,
  `BEEMETRY_RP_OUTBOX_MAX_ATTEMPTS`, `BEEMETRY_RP_CIRCUIT_FAILURE_THRESHOLD`,
  `BEEMETRY_RP_CIRCUIT_COOLDOWN_MS`.

## 10. Costo / recursos
- Catálogo de equipos (no telemetría de alta tasa): volumen esperado de
  cientos a pocos miles de filas por tenant — sin impacto relevante de
  almacenamiento frente a `telemetry_raw`.
- 3 hilos adicionales por peer activo (backfill, incremental, outbox drain)
  — mismo orden de magnitud que los 2 hilos de `thingsboard_sync` por peer.
