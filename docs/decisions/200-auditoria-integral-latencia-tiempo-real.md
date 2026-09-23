# ADR-200 — Auditoría integral de latencia en tiempo real: 16 hallazgos, batching de N+1, keepalive WS, migraciones de retención/índices

**Status**: implemented, verificado E2E en vivo contra `beemetry-db`/`beemetry-api`/`beemetry-pgbouncer` reales (2026-09-19, mismo día) — build real, redeploy real, 4 migraciones aplicadas y confirmadas, medición antes/después real, y un trigger de alarma en vivo end-to-end (ver "Verificación" abajo)

**Fecha**: 2026-09-19

**Autores**: Luder Armas (pedido: "revisión integral de toda la plataforma a
fin de optimizar todas las funcionalidades a tiempo real con la menor
latencia posible"), con Claude Code (3 agentes de auditoría en paralelo +
6 agentes de implementación en paralelo, cada uno con propiedad exclusiva de
un subconjunto de archivos para evitar conflictos de edición concurrente)

**Ámbito**: core-iot, plataforma, reports

**Relación**: continúa directamente el trabajo que [ADR-186](186-bug-real-timescaledb-chunk-scan-sin-cota-tiempo.md)
dejó explícitamente fuera de alcance ("no se auditaron otras consultas del
backend que pudieran tener el mismo patrón... una auditoría exhaustiva...
queda fuera del alcance de esta pasada") y extiende [ADR-140](140-alertas-umbral-cache-tasa-debounce-sensor.md)
(motor de alarmas) y [ADR-181](181-sse-kpis-pool-conexiones-en-vez-de-asio-strands.md)
(pool de conexiones SSE, SPEC-005).

## Contexto

Pedido explícito de revisión integral de latencia en tiempo real. En vez de
adivinar dónde mirar, se lanzaron 3 agentes de auditoría de solo lectura en
paralelo sobre (1) el camino caliente de ingesta/alarmas/mapa, (2) la
entrega SSE/WebSocket al frontend, y (3) índices/chunking/config de BD e
infraestructura. Encontraron 16 hallazgos reales, varios del mismo tipo de
bug que ADR-186 ya había corregido una vez — en código escrito o revisado
**después** de esa auditoría, por lo que nunca fue cubierto por ella.

## Decisión

Priorizados por severidad, implementados con 6 agentes en paralelo (cada
uno dueño exclusivo de un conjunto de archivos disjunto, sin build/commit
propio) más 2 fixes manuales de documentación:

### Crítico

1. **`sensor_formula_evaluator.cpp:184-186` / `sensor_formula_routes.cpp:255-257,273-276`** —
   mismo bug que ADR-186 (`ORDER BY captured_at DESC LIMIT 1` sin cota de
   tiempo sobre `telemetry_multivariate`), en código posterior a esa
   auditoría. Acotado a 15 min (`loadPreviousOutputValue`, mismo criterio
   que el resto del motor de fórmulas) y 24h (endpoint de navegación de
   resultados recientes, sin filtro de tiempo previo en el cliente).
2. **`TelemetryDashboard.tsx`** — generaba telemetría 100% falsa
   (`Math.random()`) rotulada como panel real ("Kinesis hot-path + Kafka
   cold-path"). Verificado que ni Kinesis ni QuestDB existen en este stack
   (real: TimescaleDB + Redpanda/Kafka). Sin endpoint real que exponga
   throughput/latencia de ingesta (`specs/002-dashboards-tiempo-real/spec.md`
   § Contratos no lo contempla), se optó por **no inventar un endpoint
   nuevo** (fuera de alcance de un pase de latencia) ni eliminar la vista
   unilateralmente (decisión de producto). En su lugar: banner visible
   "Datos simulados — no conectado a telemetría real" y copy corregido para
   no afirmar tecnología inexistente.
3. **`simulation_status_routes.cpp::sqlRawCounts`** — el propio comentario
   en el código ya documentaba el fix pendiente desde ADR-186
   ("sumar `telemetry_fact_hourly.sample_count`"). Implementado: `count_total`
   ahora lee el continuous aggregate (`db_scripts/76`), `count_last_hour`
   pasa de `FILTER` (nunca habilitaba constraint exclusion) a `WHERE` real.
   `sqlCalcCounts` (sin rollup equivalente) se acotó a 24h — cambio de
   semántica documentado explícitamente, no silencioso.

### Alto

4. **`db_scripts/107_telemetry_fact_tenant_index.sql`** — `telemetry_fact`
   no tenía índice `(tenant_id_sk, captured_at)`; solo la PK
   `(sensor_id_sk, channel_id, captured_at)`. `db_scripts/87` afirmaba
   falsamente que ese patrón "ya" existía en `telemetry_fact`. Índice nuevo
   agregado (no `CONCURRENTLY` — ningún índice de hypertable de este repo lo
   usa, y no corre dentro de una transacción de todos modos).
5. **WebSocket de alarmas sin keepalive ni resync** — `nginx.conf`
   `location /ws` sin `proxy_read_timeout` (default 60s, cerraba canales
   silenciosos); `websocket_session.hpp` usaba
   `timeout::suggested(server)` (`keep_alive_pings=false`). `alarmStream.ts`
   solo resincronizaba en el montaje inicial, nunca tras reconectar — una
   alarma disparada durante un corte se perdía de la UI hasta recargar la
   página. Corregido: `proxy_read_timeout 3600s` (mismo valor que
   `/formula-api/ws`), `keep_alive_pings=true` + `idle_timeout=30s` en el
   backend, y `resync()` en cada `ws.onopen` con un contador de secuencia
   (`resyncSeqRef`) para descartar respuestas HTTP obsoletas y un merge por
   `id` que trata `resolvedAt`/`acknowledged` como monótonos (un fetch
   atrasado no puede "des-resolver" una alarma que un evento WS más nuevo ya
   resolvió).
6. **`telemetry_raw` con `chunk_time_interval=1h`**, fuera del alcance de
   ADR-186 por completo — `db_scripts/108` lo vuelve a 6h (valor original
   antes de `db_scripts/67`), documentando ambos lados del trade-off
   (lectura vs. el motivo de escritura/ingesta que justificó achicarlo).
7. **`telemetry_fact_calc` y `telemetry_multivariate` sin política de
   compresión/retención** — `db_scripts/109` las agrega, mismas ventanas que
   `telemetry_fact` (`db_scripts/75`).
8. **Sin `statement_timeout` de red de seguridad** — el fix de ADR-186 fue
   puramente acotar 3 `WHERE`; nada impedía que una consulta futura (como el
   hallazgo #1 de este mismo documento) colgara un hilo indefinidamente.
   `db_scripts/110`: `ALTER ROLE sensors SET statement_timeout = '15s'`
   (rol confirmado en `docker-compose.yml`), sin afectar el `SET
   statement_timeout = 0` explícito de la conexión de ingesta
   (`telemetry_ingest.cpp:332`, precedencia de sesión). **No verificado en
   vivo** que `pgbouncer` en modo `transaction` respete el default de rol en
   cada conexión física nueva — semántica estándar de Postgres/pgbouncer,
   pero sin `pgbouncer.ini` propio en el repo para confirmarlo; recomendado
   un `SHOW statement_timeout` real post-deploy.

### Medio

9. **N+1 en `evaluateFormulasOnce`** (`sensor_formula_evaluator.cpp`) y
   `evaluateRulesOnce` (`device_alarm_routes.cpp`) — una query por
   fórmula/regla por ciclo de 10s. Ambos batcheados: se clasifican
   fórmulas/reglas por tipo de fuente y se hace como máximo una query por
   grupo (`= ANY($1::tipo[])`, mismo patrón de literal de arreglo que
   `sensor_telemetry_wizard.cpp`), resolviendo cada fila por lookup en
   memoria. **A propósito, solo se batcheó la LECTURA** — el
   INSERT/UPDATE de `platform_alarms` (debounce, dedup vía
   `idx_alarms_one_open_per_rule`) y `writeResult`/`loadPreviousOutputValue`
   de fórmulas siguen secuenciales, sin tocar: es la parte
   correctness-sensitive (falsos positivos/negativos en un contexto de
   seguridad minera), no valía el riesgo de reescribirla en la misma pasada.
10. **`FormulaOverviewView.tsx` nunca se auto-refrescaba** — solo botón
    manual, mientras el motor recalcula cada ~10s. Agregado
    `setInterval` de 12s junto al botón existente; se detectó y corrigió de
    paso una regresión que esto habría introducido (spinner de pantalla
    completa en cada refresh de fondo) con un guard `hasLoadedOnceRef`.
11. **`map_aggregator.cpp::MapAggregator::loop()`** sondeaba tenants
    secuencialmente cada 1.5s — un tenant lento demoraba el push de mapa de
    todos los demás. Paralelizado con `std::async` (mismo patrón que
    `main.cpp` ya usa para avatares), verificado que `PgPool::acquire()`,
    `snapshotMutex_` y `WsRegistry` son thread-safe para uso concurrente
    antes de aplicar el cambio.
12. **`protocol_adapters.cpp::pollThread`** sondeaba fuentes Modbus/OPC-UA
    debidas secuencialmente. Paralelizado igual que #11; se identificó y
    evitó un riesgo real de puntero colgante (`PollSource*` crudo hacia
    `g_sources`, que `refreshSources()` puede reemplazar) uniendo
    (`wait()`) el lote completo antes de la siguiente iteración, en vez de
    despacho "fire and forget".

### Bajo / documentación

13. Alarmas sobre métricas calculadas (techo combinado ~20s: 10s motor de
    fórmulas + 10s evaluador) — trade-off ya documentado en el código,
    **no modificado** en esta pasada (requeriría rearquitectura del motor de
    fórmulas para ser event-driven, fuera de alcance).
14. `AdvancedSensors.tsx` (poll fijo 15s) — revisado explícitamente el
    patrón híbrido poll+push de `KpiOperationsView`/`MapViewer`; **no
    aplica**: `MapViewer.tsx` tiene un comentario propio confirmando que su
    WS solo empuja posición/estado, no valores de telemetría por sensor, y
    `useLiveKpi` no es apto para datos por-sensor tenant-scoped. Se dejó el
    poll de 15s sin cambios — forzar un mal encaje habría sido peor que la
    solución actual.
15. `specs/002-dashboards-tiempo-real/spec.md` — checkboxes de CA
    desalineados con `tasks.md` (que ya declaraba las 6 CA cerradas con
    evidencia real, incl. 3-17ms de latencia CAGG medida). Sincronizado.
16. `docker-compose.prod.yml` — confirmado que es un *override* de
    `docker-compose.yml` (no standalone); el tuning de Postgres/pgbouncer se
    hereda correctamente. Comentario agregado para que quede explícito, sin
    cambio de comportamiento.

## Verificación

**Build real ejecutado** (`docker build -f backend/Dockerfile.verify .`,
mismo mecanismo que usa este proyecto para verificar cambios de C++, ver
memoria de proyecto): 100% de los objetos compilaron sin error, incluidos
los 6 archivos C++ tocados por esta pasada (`device_alarm_routes.cpp`,
`simulation_status_routes.cpp`, `map_aggregator.cpp`,
`protocol_adapters.cpp`, `sensor_formula_evaluator.cpp`,
`sensor_formula_routes.cpp`, `websocket_session.hpp`); `beemetry_backend`
linkeó y `ctest` corrió `backend_unit_tests`: **1/1 passed** (incluye
`test_alarm_rule_evaluator.cpp`, sin regresión en la lógica pura de
umbral/tasa/debounce que el batching de `evaluateRulesOnce` no tocó).
Frontend verificado con `npx tsc --noEmit` a nivel de proyecto completo:
limpio, sin errores, incluyendo los 5 archivos `.tsx`/`.ts` tocados.

**Verificación E2E en vivo (mismo día, contra el stack real corriendo)**:

1. **Redeploy real**: `docker compose build web frontend` + `docker compose up -d web frontend` sobre el stack completo ya corriendo (18 servicios activos, `beemetry-api`/`beemetry-web` sanos, 0 reinicios tras el redeploy).
2. **Migraciones aplicadas de verdad**: `docker compose --profile migrate run --rm db-migrate` corrió `107-110` con éxito (`CREATE INDEX`/`DO`/`add_compression_policy` (ids 1021-1023)/`add_retention_policy` (ids 1022-1024)/`ALTER ROLE`, todas con `COMMIT`). Confirmado por introspección directa post-aplicación: `idx_telemetry_fact_tenant_time` existe; `telemetry_raw` con `time_interval=06:00:00`; `telemetry_fact_calc` y `telemetry_multivariate` ahora aparecen en `timescaledb_information.compression_settings` (antes no); `pg_roles.rolconfig` de `sensors` = `{statement_timeout=15s}`.
   - **Hallazgo no anticipado, real, encontrado y corregido en esta misma verificación**: `SHOW statement_timeout` a través de `pgbouncer` (la ruta real de conexión de la app, `transaction` pooling) devolvía `0` (sin efecto) inmediatamente después de la `ALTER ROLE` — las conexiones servidor ya abiertas en el pool de `pgbouncer` no heredan retroactivamente un nuevo default de rol. Confirmado con `docker restart beemetry-pgbouncer` (fuerza conexiones nuevas): `SHOW statement_timeout` pasó a `15s` correctamente. **Nota operativa para cualquier deploy real futuro de este fix**: aplicar `db_scripts/110` requiere además reiniciar/reciclar `pgbouncer` (o esperar a que sus conexiones existentes se reciclen naturalmente) — de lo contrario el safety net queda inerte en silencio para la ruta de conexión real de la app.
3. **Medición antes/después real de `sqlRawCounts`** (hallazgo #3), misma metodología que ADR-186: la consulta VIEJA (`COUNT(*)` sin cota) se probó en vivo contra `beemetry-db` real con `statement_timeout=10s` — **cancelada por timeout, reproducible** (no hipotética). La consulta NUEVA (rollup + `WHERE` acotado) corrida en vivo contra los mismos datos: **220ms** de ejecución. De "nunca completa en 10s" a 220ms, medido, no estimado.
4. **`telemetry_multivariate` (hallazgo #1)**: medido en vivo con `EXPLAIN ANALYZE` — 1.36ms de ejecución hoy (la tabla solo tiene 2 chunks en este entorno, a diferencia de los ~11.034 de `telemetry_fact`/`telemetry_raw`). El patrón de bug es idéntico al de ADR-186, pero **honestamente**: en el volumen actual de este entorno el síntoma (hang real) todavía no se manifiesta ahí — el fix es preventivo/correcto igual, sin esperar a que la tabla acumule chunks como pasó con `telemetry_fact`.
5. **Trigger de alarma en vivo, end-to-end, sobre el camino batcheado (hallazgo #9)** — misma metodología que la "Live trigger test" de ADR-140: usando la única regla real habilitada del sistema (`id=10`, `rule_name='camino'`, `sensor_id` real, `threshold=2 gt`), se insertó una fila real en `telemetry_fact` (`value_numeric=9999`) a las `2026-09-19T21:07:48Z`. El evaluador (ya con el fetch batcheado por grupo, no 1-query-por-regla) generó la alarma a las `21:08:26Z`/`21:07:55Z` (dentro del mismo ciclo de polling de 10s), mensaje correcto: `"camino: valor 9999 gt 2"`. Confirma que el batching de lectura no rompió la lógica de evaluación real. **Datos de prueba borrados al terminar** (alarma y fila de telemetría) — no queda test data colgando, mismo estándar que ADR-140.
6. **Evaluador de fórmulas, post-redeploy, sin crashear**: métricas reales vía `/api/metrics` tras el redeploy — `beemetry_alarm_engine_rules_cached=1` (coincide con la BD), `beemetry_formula_engine_evaluations_total=72` tras 12 ciclos, `beemetry_formula_engine_skipped_no_value_total=72` (los sensores de fórmulas no tienen telemetría real fluyendo en este entorno ahora mismo — confirma que la ventana de 15 min nueva descarta correctamente en vez de fallar), `compile_errors_total=0`, `write_errors_total=0`. 0 reinicios del contenedor.
7. **`FormulaOverviewView.tsx` (hallazgo #10) confirmado en vivo en el navegador**: con la pestaña abierta y sin ninguna interacción del usuario, el conteo de requests a `/api/mining/formulas` subió solo (2→4→6) a lo largo de ~35s, consistente con el `setInterval` de 12s disparando por sí solo.
8. **Hallazgo nuevo durante esta verificación, honesto**: se intentó verificar visualmente el banner de `TelemetryDashboard.tsx` (hallazgo #2) navegando la UI real — **la pestaña "Telemetría" resultó ser inalcanzable hoy por cualquier camino de navegación real**: su único ítem de menú está comentado en `frontend/src/components/UI/NavBar.tsx:533-538`, y ningún otro botón/enlace del frontend llama a `setActiveTab('Telemetría')` (verificado por grep exhaustivo). Esto reduce la urgencia real de ese hallazgo específico (ningún operador ve hoy ese panel a través de la navegación normal) sin invalidar el fix — sigue siendo código correcto y listo para cuando/si ese ítem de menú se reactive.

**No verificado en vivo todavía**: el keepalive/resync del WebSocket de alarmas (hallazgo #5) — requeriría simular una caída de conexión real y medir el tiempo hasta el resync, no se hizo en esta pasada. La paralelización de `MapAggregator`/`protocol_adapters` (hallazgos #11/#12) tampoco se probó bajo carga real con múltiples tenants/dispositivos simultáneos — el entorno actual (según auditoría de SPEC-027) tiene muy pocos tenants/fuentes activas para ejercitar el escenario que motivó el fix.

## Consecuencias

### Positivas
- Cierra la brecha que ADR-186 dejó explícitamente documentada como fuera
  de alcance — el mismo patrón de bug (query sin cota de tiempo contra una
  hypertable con miles de chunks) ya no existe en ningún camino de
  evaluación de fórmulas/alarmas conocido a esta fecha.
- Primera vez que este proyecto agrega una defensa de `statement_timeout`
  a nivel de rol, no solo por-query — reduce el riesgo de que el PRÓXIMO
  bug de este tipo (inevitable en código futuro) cuelgue un hilo
  indefinidamente en vez de fallar rápido y visible.
- El hallazgo del dashboard con datos falsos (`TelemetryDashboard.tsx`) es,
  en sí mismo, más un hallazgo de integridad de producto que de latencia —
  documentado y corregido con honestidad (banner visible) en vez de
  ocultado u omitido del reporte.

### Negativas / Trade-offs
- **Dos caminos siguen sin verificación en vivo bajo carga real**: el
  keepalive/resync del WebSocket de alarmas (hallazgo #5, requeriría simular
  una caída de conexión real) y la paralelización de
  `MapAggregator`/`protocol_adapters` (hallazgos #11/#12, este entorno no
  tiene suficientes tenants/fuentes concurrentes para ejercitar el
  escenario que motivó el fix) — ver "Verificación" para el detalle de todo
  lo que sí se confirmó en vivo (redeploy real, 4 migraciones aplicadas y
  confirmadas por introspección, medición antes/después real de
  `sqlRawCounts` con timeout reproducido y luego resuelto, trigger de
  alarma end-to-end sobre el camino batcheado, métricas reales
  post-redeploy sin crashes).
- **Hallazgo operativo real, no anticipado**: el `statement_timeout` de rol
  (hallazgo #8) no se propaga a conexiones ya abiertas por `pgbouncer` en
  modo `transaction` — requiere reiniciar/reciclar `pgbouncer` tras aplicar
  `db_scripts/110` para que tenga efecto real en la ruta de conexión de la
  app. Sin ese paso, el fix queda instalado pero inerte en silencio.
- `sqlCalcCounts` de `simulation_status_routes.cpp` cambia de semántica
  ("total histórico" → "últimas 24h") por falta de un rollup equivalente a
  `telemetry_fact_hourly` para `telemetry_fact_calc` — documentado, no
  silencioso, pero es un cambio de comportamiento observable.
- El `ALTER ROLE ... SET statement_timeout` (hallazgo #8) no fue confirmado
  contra el `pgbouncer` real de este proyecto — ver nota de "no verificado"
  arriba.
- El batching de N+1 (#9) solo cubre lecturas; el motor de fórmulas y de
  alarmas conservan su cuello de botella de escritura secuencial — aceptado
  a propósito por ser la parte correctness-sensitive.
- `TelemetryDashboard.tsx` sigue sin datos reales — el trade-off elegido
  (etiquetar honestamente en vez de inventar un backend nuevo) dejó el
  problema de fondo sin resolver, solo lo hizo visible.
- 332 archivos ya estaban sin commitear en el árbol de trabajo antes de
  empezar esta auditoría (trabajo en curso preexistente, no relacionado) —
  los diffs de este ADR están entremezclados con ese WIP en el árbol; no se
  hizo ningún commit durante esta pasada.

## Alternativas descartadas

### Rearquitecturar el motor de fórmulas a event-driven (cerraría el hallazgo #13)
Reduciría el techo de latencia de alarmas sobre métricas calculadas de ~20s
a algo comparable a los ~179ms del camino event-driven de sensores reales
(ADR-140). Descartado para esta pasada: es un cambio arquitectónico mayor
(el motor de fórmulas no tiene hoy ningún hook equivalente a
`setOnBatchCommitted`), amerita su propio ADR con medición dedicada, no un
ítem más de una auditoría de 16 hallazgos ya extensa.

### Eliminar `TelemetryDashboard.tsx` del nav en vez de etiquetarlo
Más simple, pero es una decisión de producto (¿alguien depende visualmente
de esa pestaña aunque sea como demo?) que no corresponde tomar
unilateralmente dentro de un pase de latencia — se prefirió dejar la
decisión de negocio pendiente y visible (banner), no tomarla por el equipo.

### Batching completo de escritura en evaluateRulesOnce/evaluateFormulasOnce
Técnicamente posible (INSERT/UPDATE en lote), pero el debounce (T5,
ADR-140) y la dedup vía índice único parcial dependen de evaluar cada regla
en su propio contexto secuencial hoy — batchear las escrituras sin
rediseñar esa lógica habría sido el tipo de cambio "arriesgado sin necesidad
real" que este mismo pase evitó a propósito en otros puntos.

## Referencias
- [[186]] (ADR de origen del patrón de bug, define el estándar de
  verificación en vivo que este ADR todavía no alcanza)
- [[140]] (motor de alarmas, debounce, cache de reglas)
- `backend/src/mining/sensor_formula_evaluator.cpp`,
  `sensor_formula_routes.cpp` (fix #1, batching #9)
- `backend/src/mining/device_alarm_routes.cpp`,
  `simulation_status_routes.cpp` (fix #3, batching #9)
- `backend/src/websocket_session.hpp`, `frontend/nginx.conf`,
  `frontend/src/lib/alarmStream.ts` (fix #5)
- `frontend/src/components/Dashboard/TelemetryDashboard.tsx` (fix #2)
- `frontend/src/components/ReportStudioV2/components/views/FormulaOverviewView.tsx` (fix #10)
- `backend/src/mining/map_aggregator.cpp`, `protocol_adapters.cpp` (fix #11, #12)
- `db_scripts/107_telemetry_fact_tenant_index.sql`
- `db_scripts/108_telemetry_raw_chunk_widen.sql`
- `db_scripts/109_telemetry_calc_multivariate_retention.sql`
- `db_scripts/110_statement_timeout_role_default.sql`
- `specs/002-dashboards-tiempo-real/spec.md` (fix #15)
- `docker-compose.prod.yml` (fix #16)
