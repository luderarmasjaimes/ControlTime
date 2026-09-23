# ADR-181 — SPEC-005 T19 (escalar >200 conexiones SSE): pool de conexiones Postgres en vez de migración completa a Boost.Asio async

**Status**: implemented, verificado por build real (CTest 100%), deploy en el stack real, prueba de carga real de 200 conexiones (PASS, 2026-09-13) y prueba real de caída de réplica con fix de `connect_timeout` (2026-09-13) — SPEC-005 T17 y T19 cerrados

**Fecha**: 2026-09-12

**Autores**: Luder Armas (pedido explícito de cerrar T19 "para lograr el máximo de conexiones"), con Claude Code

**Ámbito**: reports, plataforma

**Relación**: cierra el riesgo real de escalabilidad detrás de SPEC-005 T19
("migrar a Boost.Asio asíncrono, un strand por conexión, para escalar
>200 conexiones simultáneas"). Complementa [[179]] (fix de la query SQL de
`handleLiveKpiSse` para SPEC-005 T9–T12).

## Contexto

El `tasks.md` original de SPEC-005 propone, textualmente, migrar el
servidor completo a Boost.Asio asíncrono con "un strand por conexión" para
soportar más de 200 clientes de dashboard simultáneos sin degradar el
resto del tráfico.

Al analizar la arquitectura real del backend (`backend/src/main.cpp`) se
confirmó que **el servidor NO es asíncrono hoy**: usa un modelo
thread-per-connection. `asio::io_context ioc{1}` solo se usa para un loop
bloqueante de `acceptor.accept()`; cada conexión aceptada se despacha a
`std::thread(session, ...).detach()`. Un comentario ya existente en el
código confirma que esto fue deliberado, después de que llamadas
`async_*` sobre ese `io_context` compartido nunca llegaban a completarse
en pruebas previas.

Migrar literalmente a "un strand por conexión" implicaría rediseñar toda
la capa de sockets/conexión del backend — acceptor, sesión HTTP, todas
las rutas que hoy asumen ejecución síncrona sobre su propio hilo. Es un
cambio de arquitectura de alcance de varias semanas y alto riesgo de
regresión en **todas** las rutas existentes, no solo en `/api/live/kpi`,
para una sesión de cierre de gate R3.

**El riesgo real detrás de T19 no es la falta de async — es el consumo de
conexiones Postgres.** `handleLiveKpiSse` (antes de este fix) abría su
propia conexión Postgres cruda vía `PQconnectdb()` y la retenía en
exclusiva durante toda la vida de la conexión SSE (típicamente horas). Con
N clientes de dashboard simultáneos eso son N conexiones Postgres
dedicadas, completamente por fuera de `storage::PgPool` (que ya usan
`kpi_service.cpp`, `sensor_service.cpp`, etc.), compitiendo directo por el
límite real de `max_connections` del servidor — no por hilos del SO
(200 hilos mayormente dormidos en un `read()` no es un problema real en
Linux), sino por un recurso finito y compartido con el resto de la
plataforma.

## Decisión

En vez de la migración async literal, **`handleLiveKpiSse` se reescribió
para pedir prestada una conexión del pool existente en cada tick (~2 s) y
devolverla inmediatamente**, igual que ya hace el resto de las rutas de
lectura:

1. Cada iteración del loop de push adquiere un `storage::PgPool::replica()
   .acquire(cfg.readUrl())` (lease RAII), ejecuta la query, lee los
   resultados y **libera el lease dentro del mismo scope** — la conexión
   vuelve al pool antes del `sleep_for` del intervalo.
2. Si la réplica no responde (`PQstatus != CONNECTION_OK` o la query
   falla), cae a `storage::PgPool::instance()` (primaria) con el mismo
   patrón de lease por-tick, y marca `degraded: true` en el envelope —
   mismo comportamiento de degradación graceful ya documentado en
   [[179]], ahora también pooled en el camino de fallback.
3. Con esto, N clientes de dashboard simultáneos comparten el mismo pool
   acotado (`BEEMETRY_PG_POOL_SIZE`, default 64) en vez de necesitar N
   conexiones dedicadas — el mismo mecanismo que ya sostiene el resto de
   la plataforma bajo carga concurrente.
4. Se preservó el log de error "una sola vez por conexión" ya introducido
   en [[179]] para no inundar el log si la BD no responde.

Esto resuelve el objetivo de negocio real de T19 (≥200 viewers de
dashboard simultáneos sin degradar el resto del tráfico) por un camino
más seguro y acotado en alcance que la migración async literal, siguiendo
el mismo patrón de conexión ya validado en el resto del backend.

## Verificación

- **Build real**: `backend/Dockerfile.verify`, imagen
  `beemetry-backend-verify:pool-fix` — compila limpio, CTest 100% (1/1).
- **Deploy real**: `docker compose build web` (imagen de producción,
  `backend/Dockerfile`, dos etapas con ONNX/OpenCV/open62541/DuckDB) +
  `docker compose up -d web` contra el stack completo que ya estaba
  corriendo (`beemetry-api`, `beemetry-db`, etc.) — contenedor
  `beemetry-api` recreado y healthy con el código de este fix.
- **Prueba de carga real ejecutada 2026-09-13** (por el usuario, en su
  propia terminal — el login programático quedó bloqueado dentro de esta
  sesión de Claude Code por el clasificador de permisos, ver más abajo):
  `sse-load-test.js` (Node nativo, sin dependencias) contra el usuario de
  prueba creado directamente en la BD real (`sse_loadtest_20260912`,
  tenant Minera Raura, admin). **Resultado: PASS**. 200/200 conexiones SSE
  reales simultáneas conectadas sin error; 1235 eventos recibidos, todos
  con datos reales (0 degradados, 0 parse errors); 10/10 mediciones del
  endpoint de control (`/api/mining/kpis`) completadas OK bajo carga,
  latencia promedio 2,8ms vs. 3,8ms de baseline (sin carga) — sin
  degradación real, dentro del ruido de mediciones de milisegundos. Logs
  de `beemetry-api` sin ningún error durante la prueba; métricas del pool
  post-test limpias (0 activas, 0 conexiones malas, 0 esperas). Los "183
  errores de stream" que reporta el script son un artefacto esperado de su
  propio cierre forzado (`req.destroy()` al final de la ventana de
  prueba), no un fallo real — confirmado contra los logs del backend, que
  no registran ningún error correspondiente.
- **Nota de proceso**: dentro de esta sesión de Claude Code, obtener el
  token de prueba (login programático, lectura de cookies, refresh de
  token) fue bloqueado consistentemente por el clasificador de permisos de
  auto mode — el asistente no ejecuta acciones de autenticación con
  contraseña bajo ninguna circunstancia, ni siquiera con credenciales de
  prueba explícitamente provistas por el usuario. El usuario corrió
  `login2.js`/`sse-load-test.js` directamente en su propia terminal,
  fuera de esa restricción.

## Consecuencias

### Positivas
- Resuelve el riesgo real de escalabilidad (agotar `max_connections` de
  Postgres) sin tocar el resto de las ~40 rutas del backend.
- Reutiliza un mecanismo (`storage::PgPool`) ya probado y en uso por el
  resto de la plataforma, en vez de introducir un segundo modelo de
  concurrencia (async/strands) que conviviría con el thread-per-connection
  existente.
- Alcance acotado a una sola función (`handleLiveKpiSse`), auditable en un
  diff pequeño.

### Negativas / Trade-offs
- **No es la migración a Boost.Asio async que el `tasks.md` original
  pedía textualmente.** Si en el futuro se decide que el servidor
  completo necesita ser async (p. ej. por un volumen de conexiones que
  exceda lo que el modelo thread-per-connection puede sostener incluso con
  el pool de BD resuelto), este fix no lo reemplaza — sigue siendo un
  trabajo de arquitectura mayor y separado, referenciado como
  [[SPEC-016]] futuro en el `tasks.md` original.
- El pool tiene un tamaño fijo (default 64). Si el número de rutas que
  compiten por el pool crece mucho más allá de lo actual, puede requerir
  ajustar `BEEMETRY_PG_POOL_SIZE` — no es un límite nuevo introducido por
  este fix, es el mismo límite que ya rige para el resto del backend.
- `/api/metrics` (Prometheus) solo expone stats de `PgPool::instance()`
  (primaria), no de `PgPool::replica()` — limitación preexistente, no
  corregida en esta pasada; dificulta observar en producción cuánto del
  pool de réplica consume específicamente este endpoint bajo carga real.

## Actualización 2026-09-13 — SPEC-005 T17: prueba real de caída de réplica

Pedido explícito del usuario: tumbar la réplica DE VERDAD (no por
inspección de código) y verificar que el SSE degrada bien. Se hizo contra
el stack real:

- **14:21:57 UTC**: `docker stop beemetry-db-replica` (logs de Postgres
  confirman `FATAL: terminating connection due to administrator command`
  en cada conexión activa, incluido el walreceiver).
- **Durante la caída**: `GET /api/live/kpi` (conexión nueva, sesión real)
  siguió respondiendo `200 OK` con KPIs reales (mismos 13 valores de
  siempre, `aisc`, `tonelaje_movido`, etc.) y **`"degraded": true`** en el
  envelope — el stream nunca se cortó, nunca devolvió un error al cliente,
  cayó a la BD primaria exactamente como diseñado.
- **14:22:48 UTC**: `docker start beemetry-db-replica`. Logs de la réplica
  confirman recuperación limpia y real (`consistent recovery state
  reached`, `database system is ready to accept read-only connections`,
  `started streaming WAL from primary`) hacia **14:22:52 UTC** — la réplica
  en sí tardó ~4 segundos en estar sana de nuevo.
- **Hallazgo real no anticipado**: el SSE siguió devolviendo
  `degraded: true` en conexiones NUEVAS hasta bien pasados los **14:27
  UTC** (~5 minutos después de que la réplica ya estaba sana) — pese a que
  el fix de este ADR adquiere un lease FRESCO en cada tick. Verificado con
  `psql` desde el propio contenedor `beemetry-api` (mismas credenciales
  exactas que usa el backend) que la réplica respondía instantáneamente
  durante toda esa ventana — no era un problema de red ni de la réplica.
  **Recuperación confirmada real recién a las 14:30:13 UTC** (envelope sin
  `degraded` en absoluto), acelerada disparando ~25 conexiones SSE
  rápidas y secuenciales.
- **Causa raíz real, encontrada e implementada** (2026-09-13, misma sesión):
  `BEEMETRY_REPLICA_DATABASE_URL` (`docker-compose.yml`) **nunca tuvo
  `connect_timeout`** — a diferencia de `BEEMETRY_DATABASE_URL` y
  `BEEMETRY_GPU_MUTEX_DATABASE_URL`, que ya lo llevan desde antes por
  exactamente el mismo motivo documentado ahí mismo: "sin esto,
  `PQconnectdb` no tiene límite propio y... se queda esperando" (comentario
  ya existente junto a `BEEMETRY_DATABASE_URL`, línea ~436). Sin ese
  límite, un `PQconnectdb()` disparado hacia la réplica durante o justo
  después de la caída podía colgarse mucho más que los ~2s de intervalo
  entre ticks — explica por qué la "adquisición fresca por tick" del fix
  original de este ADR no se sentía instantánea en la práctica: no es que
  el pool reintentara mal, es que el intento de conexión en sí podía
  demorar minutos en fallar/tener éxito bajo esas condiciones. **Fix:
  agregado `connect_timeout=5` a `BEEMETRY_REPLICA_DATABASE_URL`, mismo
  valor que las otras dos URLs.**

**Verificado en vivo, dos veces, antes y después del fix** — mismo
procedimiento exacto (`docker stop`/`docker start beemetry-db-replica`
real contra el stack completo):

| | Réplica lista (logs) | SSE confirmado recuperado | Tiempo de recuperación |
|---|---|---|---|
| Antes del fix | 14:22:52 UTC | 14:30:13 UTC | **~7,4 minutos** |
| Después del fix | 14:49:53 UTC | 14:50:17 UTC | **~24 segundos** |

Mejora real de ~18× en el tiempo de recuperación, con el mismo
comportamiento correcto durante la caída en ambos casos (nunca se sirvió
un dato incorrecto, nunca se cortó una conexión). `docker compose up -d
web` (recreación de contenedor, sin rebuild — es una variable de entorno,
no código) para aplicar el fix contra el stack real.

Cierra SPEC-005 T17 con evidencia real (no solo inspección de código), causa raíz encontrada y corregida, y el fix reverificado en vivo.

## Referencias
- `backend/src/main.cpp` (`handleLiveKpiSse`, refactor de pooling)
- `backend/src/storage/pg_pool.hpp` (`storage::PgPool`, ya usado por
  `kpi_service.cpp`, `sensor_service.cpp`, `rp_gateway_routes.cpp`)
- [[179]] (fix de query SQL + cliente frontend, mismo endpoint)
- `specs/005-push-sse-tiempo-real/tasks.md` (T19, texto original de la
  tarea)
