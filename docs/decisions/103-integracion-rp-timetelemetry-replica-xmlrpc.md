# ADR-103 — Integración RP (TimeTelemetry/Odoo): réplica local, escritura por XML-RPC, push realtime para frontend externo

**Status**: implemented (2026-08-10)
**Fecha**: 2026-08-10
**Autores**: EC (con Luder Armas)
**Ámbito**: backend, integraciones externas
**Relación**: reusa el patrón de ADR-034 (`thingsboard_sync`, sync ETL desde
plataforma externa), las tablas `etl_sync_peer`/`etl_sync_state`/`etl_sync_run`
(`db_scripts/18`), `storage::PgPool` (primaria/réplica, SPEC-004) y `WsRegistry`
(push WS, ver `alarm_notifier.cpp`/`map_aggregator.cpp`).

## Contexto

El cliente opera TimeTelemetry, una instancia Odoo 17 (`https://sistema.
timetelemetry.com`, db `telemetry17`) donde vive el catálogo de equipos
(`maintenance.equipment`) de sus operaciones mineras. Existían dos scripts de
un solo uso (`RP/descargar_dispositivo_por_codigo (1).py`,
`RP/descargar_dispositivos_por_proyecto.py`) que leen ese catálogo por
XML-RPC con **credenciales hardcodeadas en texto plano** — solo lectura, sin
reintentos, sin réplica, pensados para ejecutarse manualmente.

Se requiere que un **frontend nuevo, distinto al de InformeCliente**, pueda
leer y escribir ese catálogo de equipos con baja latencia, sin depender de
round-trips síncronos a Odoo, y que el **backend de InformeCliente sea el
único punto de integración** (nunca un frontend con acceso directo a una base
de datos). El usuario pidió explícitamente el máximo análisis y la mejor
implementación posible en resiliencia, performance, ampliación y soporte a
tiempo real, y aceptó implementar todo (lectura + escritura + realtime +
resiliencia) en una sola sesión — excepción documentada al Art. 7 de la
Constitución ("una feature por sesión"), justificada por ser una única
integración coherente que no tiene un punto de corte intermedio útil sin
dejar el sistema a medio construir (una réplica de solo lectura sin camino de
escritura no cumple el pedido original del usuario).

## Decisión

1. **Réplica local, no proxy.** El backend sincroniza `maintenance.equipment`
   hacia una tabla propia (`rp_equipment`) vía backfill + polling incremental
   por `write_date`, más un webhook opcional de aceleración. El frontend
   nuevo lee siempre de `storage::PgPool::replica()` — nunca espera un
   round-trip a Odoo (Art. 3 de la Constitución).
2. **Escritura por XML-RPC (`execute_kw create/write`), nunca SQL directo a
   la BD de Odoo.** Decisión tomada tras exponer al usuario los riesgos
   concretos de escribir SQL crudo contra la base de un sistema de terceros
   que no se opera (bypass de validaciones/reglas de negocio de Odoo, sin
   auditoría en su chatter, acoplamiento a un esquema interno frágil ante
   upgrades, credenciales de alto privilegio sobre un servidor ajeno,
   contención de locks con las propias transacciones de Odoo). Las
   escrituras del frontend nuevo se encolan en `rp_write_outbox` (outbox
   durable, idempotente, con backoff+jitter y dead-letter) y un hilo
   consumidor las aplica por XML-RPC.
3. **Frontend nuevo autentica con sesión/JWT, reusando
   `auth::resolveAuthSession`** — mismo mecanismo que usa InformeCliente
   hoy, con RBAC (`hasPermission`) y aislamiento multi-tenant
   (`userHasRealTenantMembership`) ya probados en producción. Se agregan dos
   permisos nuevos (`rp.equipment.view`, `rp.equipment.edit`), mismo patrón
   de ADR-079.
4. **Excepción puntual: el webhook `POST /api/rp/webhook/odoo` usa API key de
   servicio, no JWT.** El emisor es el propio servidor de Odoo, sin usuario
   humano detrás — forzarlo a "iniciar sesión" contaminaría el modelo de
   usuarios con una cuenta ficticia. La API key solo desbloquea ese único
   endpoint. Además, el payload del webhook **nunca se trata como dato de
   negocio confiable**: solo dispara una relectura por XML-RPC del registro
   referenciado (`handleWebhookNudge`), así que una key filtrada, en el peor
   caso, provoca relecturas redundantes e inofensivas — no aplica datos
   falsos. Por la misma razón no hace falta HMAC/firma de payload.
5. **Push real por WebSocket, no polling disfrazado de SSE.** Se reusa
   `WsRegistry::broadcastToTenant` (ya en uso por `alarm_notifier.cpp` y
   `map_aggregator.cpp`) para emitir `rp_equipment_updated` apenas se aplica
   un cambio en `rp_equipment` — a diferencia de `/api/live/kpi`, que
   re-consulta la BD cada 2s y no es push genuino.
6. **Réplica híbrida (columnas promovidas + `raw_json JSONB`).** Se guarda el
   registro completo de Odoo en `raw_json` para que un campo nuevo esté
   disponible sin migración (pedido explícito de "ampliación... soporte a
   nuevas funcionalidades"), y se promueven a columna los campos que ya se
   sabe que se filtran/ordenan (código, proyecto, estado, ubicación).
7. **Resiliencia construida desde cero — no había nada reusable.** Se
   verificó por exploración que `thingsboard_sync.cpp` reintenta con delay
   fijo (`sleep_for(5s|10s|30s)`), sin backoff ni jitter, y que
   `org_notification_outbox` (patrón de outbox ya en el schema) **no tiene
   consumidor en C++** — es una tabla poblada por triggers SQL y nunca leída.
   Este ADR introduce: circuit breaker por peer (closed/open/half-open),
   backoff exponencial con jitter en el drenado del outbox, e idempotencia
   por `idempotency_key` — mejoras que además quedan disponibles como
   referencia para endurecer `thingsboard_sync` en el futuro (fuera de
   alcance de este ADR).
8. **Cliente HTTP compartido con TLS (`http/http_client.hpp`).**
   `thingsboard_sync.cpp` documenta explícitamente que su cliente HTTP no
   soporta TLS, y TimeTelemetry es `https://`. Se extrae un cliente
   compartido (modelado en el `beast::ssl_stream` ya probado de
   `tax_registry_client.cpp`) en vez de duplicar por cuarta vez el mismo
   patrón de conectar/handshake/escribir/leer.

## Verificación

- Backfill de un `project_id`/`codigo` de prueba conocido, comparado en
  conteo de filas contra el JSON que producen los scripts de referencia en
  `RP/`.
- `POST /api/rp/equipment` de prueba, confirmado en la UI de Odoo (valores
  correctos + entrada en el chatter de auditoría).
- Corte de conectividad a TimeTelemetry: circuit breaker abre,
  `etl_sync_run.status='failed'`, `rp_write_outbox` reintenta con backoff
  creciente y pasa a `dead` sin tumbar el backend ni bloquear otras rutas.
- Conexión WS autenticada recibe `rp_equipment_updated` sin polling.
- `/api/metrics` expone `mapas_backend_rpsync_*`.
- El módulo se entrega gateado por `BEEMETRY_RP_SYNC_ENABLED=false` por
  defecto (mismo criterio que ThingsBoard) — el camino de escritura contra
  datos productivos reales de TimeTelemetry se prueba de forma controlada
  por el usuario, no automáticamente por el agente que implementó esto.

## Consecuencias

- El frontend nuevo obtiene lecturas de latencia local (réplica) en vez de
  depender de la latencia/disponibilidad de Odoo en cada request.
- Las escrituras son asíncronas (202 + `sync_status`): el frontend debe
  manejar un estado "pendiente de sincronizar", no una confirmación
  síncrona — trade-off aceptado a cambio de que el frontend nunca bloquee
  esperando a Odoo y de que una caída de TimeTelemetry no tumbe la
  experiencia del frontend nuevo (solo demora la confirmación).
- Nueva superficie de credenciales a administrar: la fila de
  `etl_sync_peer.auth_config` para TimeTelemetry y la API key del webhook —
  ambas **fuera del repo**, cargadas directamente en BD/variables de entorno
  por el usuario/ops.
- Hallazgo de seguridad independiente de este ADR: la contraseña de
  TimeTelemetry usada en los scripts de referencia estaba en texto plano en
  disco (`RP/*.py`) y fue pegada en la sesión que originó este ADR — se
  recomendó al usuario rotarla y que la credencial productiva viva solo en
  `etl_sync_peer.auth_config`, nunca en un script versionado.

## Alternativas descartadas

- **SQL directo a la BD de Odoo para escritura**: descartado tras explicar
  los riesgos al usuario (ver Decisión #2) — tentador por ser más rápido por
  escritura individual, pero el radio de daño y la fragilidad ante upgrades
  de Odoo no lo justifican para una integración productiva de largo plazo.
- **Frontend nuevo con acceso directo a una base de datos (cualquiera:
  réplica propia u Odoo)**: descartado de plano — credenciales de BD en un
  cliente no se pueden proteger (extraíbles de cualquier app/navegador), no
  hay forma de aplicar RBAC/aislamiento por tenant sin backend, y es
  exactamente la garantía que toda la arquitectura actual (`resolveAuthSession`
  + `PgPool` + rutas REST) existe para dar.
- **API key de servicio para todo el tráfico del frontend nuevo**: descartado
  — habría que diseñar desde cero scope/rotación/revocación de keys cuando
  `resolveAuthSession` ya resuelve sesión, RBAC y aislamiento multi-tenant de
  forma probada; se reserva la API key exclusivamente al webhook, donde no
  hay usuario humano.
- **SSE por polling (`/api/live/kpi`) para el realtime del frontend nuevo**:
  descartado por pedido explícito del usuario de tiempo real genuino —
  `WsRegistry` ya resuelve push real sin trabajo adicional de
  infraestructura.
- **Reusar `org_notification_outbox` para las escrituras salientes**:
  descartado — se confirmó que no tiene consumidor en C++ (tabla muerta,
  solo poblada por triggers SQL); acoplarse a una tabla sin dueño hubiera
  significado construir su consumidor de todos modos, sin ganar nada sobre
  una tabla propia con la forma exacta que este flujo necesita.

## Referencias

- `RP/descargar_dispositivo_por_codigo (1).py`,
  `RP/descargar_dispositivos_por_proyecto.py` (scripts de referencia
  reemplazados por este módulo)
- `backend/src/mining/thingsboard_sync.{hpp,cpp}` (ADR-034, patrón de sync
  ETL del que este módulo deriva)
- `backend/src/mining/rp_odoo_sync.{hpp,cpp}`,
  `backend/src/mining/rp_gateway_routes.{hpp,cpp}`,
  `backend/src/http/http_client.{hpp,cpp}` (este ADR)
- `db_scripts/18_tb_sensor_model_notify_etl_triggers.sql` (`etl_sync_peer`,
  `etl_sync_state`, `etl_sync_run`, reusadas)
- `db_scripts/52_rp_timetelemetry_integracion.sql` (`rp_equipment`,
  `rp_write_outbox`, este ADR)
- `specs/019-integracion-rp-timetelemetry/spec.md`
- `specs/004-replica-lectura-ha/spec.md`, `specs/005-push-sse-tiempo-real/spec.md`
- ADR-034 (sync ThingsBoard), ADR-079 (RBAC por permiso)
- `docs/integration/RP_TIMETELEMETRY_API_GUIDE.md` (contrato REST+WS para integradores externos,
  agregado 2026-08-10 tras verificar el módulo en vivo contra TimeTelemetry real — ver §Verificación)
- `external-api-test-page/rp-test-harness.html` (página de referencia funcional, mismo patrón que
  `api-test-harness.html`)

## Verificación en vivo contra TimeTelemetry real (2026-08-10, post-implementación)

Además de la verificación con peer falso descrita arriba, el módulo se probó contra la instancia
real de TimeTelemetry (credenciales rotadas por el usuario, cargadas en `etl_sync_peer` — nunca en
el repo):

- Backfill completo: **2108 equipos** replicados sin errores; datos verificados campo a campo
  contra el registro de referencia (`PZ18-R4.5`) que ya usaban los scripts originales.
- **2 bugs reales encontrados y corregidos**, ninguno detectable con pruebas sintéticas: (1) el
  watermark leído de Postgres llevaba sufijo de zona horaria que el parser de dominios de Odoo
  rechaza; (2) `execute_kw`'s `args` se pasaba como el dominio directo en vez de `[dominio]` —
  con dominio vacío (backfill inicial) el bug quedaba invisible, y solo se manifestó al ejercitar
  el polling incremental con un filtro real.
- Verificación en navegador real (`rp-test-harness.html`, origen cross-origin genuino): login,
  WebSocket recibiendo `rp_equipment_updated` real, lista y detalle — sin errores de consola.
- Camino de escritura (create/write) **no** se ejecutó contra datos productivos reales durante esta
  sesión — ver §Verificación arriba, mismo criterio.
