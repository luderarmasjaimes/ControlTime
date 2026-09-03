# ADR-140 — Alertas por umbral: cache de reglas, tasa de cambio y debounce

**Status**: implemented, verificado E2E en vivo contra `beemetry-api`/`beemetry-db` reales
**Fecha**: 2026-09-02
**Autores**: EC
**Ámbito**: core-iot, plataforma

> Nota de numeración: SPEC-016 (`specs/016-alertas-umbrales-sensores/`) su
> propio Definition of Done cita "ADR-016-1..5" como plantilla genérica de
> spec — ese número (016) ya está tomado en el log global por
> `016-export-server-side-asincrono.md` (ámbito `reports`, sin relación).
> Este documento es el ADR real de SPEC-016 bajo la numeración global
> correcta (siguiente libre: 140). `specs/016-alertas-umbrales-sensores/tasks.md`
> se actualiza para referenciar este archivo, no para reclamar el número 016.

## Contexto

SPEC-016 pedía un motor de alertas por umbral con evaluación embebida en el
consumidor Kafka, cache LRU de reglas, condiciones `above_max`/`below_min`/
`rate`, debounce por ventana, canal SSE dedicado y CRUD completo. La
auditoría del 2026-09-02 (ver `README.md`) encontró que **ADR-034** ya
documentaba un motor de alarmas real y funcionando desde 2026-06-24
(`platform_alarm_rules`/`platform_alarms`, hilo de fondo por polling, push
WebSocket, deduplicación por índice único parcial) — arquitectura distinta a
la que SPEC-016 describía, pero cubriendo la misma necesidad de negocio. De
los 20 ítems de la tabla de SPEC-016, T1/T2/T6/T11/T13/T14 ya estaban
satisfechos por esa implementación (ver actualización de ADR-034); T3, T4,
T5, T9 y T10 tenían brechas reales, cerradas por este ADR. T7/T8 (canal SSE
específico) y T15-T20 (suite QA completa contra un entorno con Postgres/WS
reales) no se cierran acá — ver Consecuencias.

## Decisión

1. **Cache de reglas (T3, cierra T12)**: `getCachedEnabledRules()` en
   `device_alarm_routes.cpp` sirve la lista de reglas habilitadas desde un
   cache en memoria (TTL 60s) en vez de re-consultar `platform_alarm_rules`
   en cada ciclo del evaluador (antes: 1 query cada 10s = 8640/día; ahora:
   como máximo 1 query/60s salvo invalidación). `invalidateRuleCache()` se
   llama desde `handleCreateAlarmRule`/`handleUpdateAlarmRule`/
   `handleDeleteAlarmRule` — una regla nueva o editada se ve en el siguiente
   ciclo, no hasta que expire el TTL. No es una LRU en sentido estricto (no
   hay entradas individuales que desalojar): hay un único conjunto cacheable
   (todas las reglas habilitadas), así que TTL + invalidación por escritura
   es el diseño correcto para este caso, no una simplificación de una LRU
   real.
2. **Condición por tasa de cambio (T4)**: `platform_alarm_rules.condition_type`
   nuevo (`'value'` default — comportamiento original sin cambios; `'rate'` —
   compara la tasa de cambio en unidades/minuto contra `threshold`, con el
   mismo operador `gt`/`gte`/`lt`/`lte`/`eq`). `computeRatePerMinute()` (pura,
   `alarm_rule_evaluator.hpp/cpp`) calcula la tasa entre la lectura actual y
   la anterior guardada en memoria de proceso (`RuleRuntimeState`, por
   `rule_id`); la primera lectura de una regla `rate` en el proceso no puede
   evaluar todavía (no hay ventana), se difiere al siguiente ciclo en vez de
   inventar un falso "0/min". No se implementaron `above_max`/`below_min`
   como condiciones separadas de SPEC-016 — ya eran `gt`/`lt` sobre valor
   absoluto en el diseño de ADR-034, redundante con lo pedido.
3. **Debounce por ventana de tiempo (T5)**: `platform_alarm_rules.debounce_secs`
   nuevo (default 0 = desactivado, compatible con reglas ya existentes).
   `isWithinDebounceWindow()` (pura) bloquea un nuevo disparo (sin insert, sin
   notificación) si el último disparo REAL (no solo evaluación) de esa regla
   fue hace menos de `debounce_secs`. Complementa, no reemplaza,
   `idx_alarms_one_open_per_rule` de ADR-034: ese índice evita alarmas
   ABIERTAS duplicadas mientras la condición se mantiene; el debounce nuevo
   evita RE-notificar en ráfaga si la alarma se resuelve y la condición
   vuelve a cumplirse casi de inmediato. El timestamp de "último disparo" solo
   se actualiza tras un `INSERT` real (`PQntuples(ins) > 0`), no en cada
   ciclo de evaluación — de lo contrario un ciclo que no insertó nada (porque
   ya había una alarma abierta) arrancaría igual la ventana de debounce sin
   necesidad.
4. **`PUT /api/mining/alarms/rules/{id}` (T9)**: reemplazo completo de la
   regla (no PATCH parcial, mismo criterio simple que el resto del archivo),
   gateado por `alarmas.manage` e IDOR-safe (`WHERE ... AND tenant_id = $2`).
   Antes, pausar una regla exigía borrarla y perder el historial de alarmas
   asociado (`platform_alarms.rule_id` es FK con `ON DELETE CASCADE`); ahora
   `enabled=false` la pausa sin tocar su historial.
5. **Paginación e historial (T10)**: `GET /api/mining/alarms` acepta
   `limit` (1-500, default 50), `offset` (≥0, default 0) y `severity`
   (`info`/`warning`/`critical`); responde `total` (COUNT con el mismo
   filtro, sin LIMIT/OFFSET) además de `alarms`. Antes: `LIMIT 200` fijo sin
   offset, sin filtro de severidad, sin forma de saber si había más filas.
6. **Extracción a unidad de compilación pura (T15/T20 parcial)**:
   `evaluateThresholdCondition`, `computeRatePerMinute` e
   `isWithinDebounceWindow` viven en `alarm_rule_evaluator.hpp/cpp`, sin
   dependencia de libpq/red/reloj real — mismo patrón que
   `sensor_tenant_resolver.cpp` (ver ADR-109, actualización 2026-09-02).
   `backend/tests/test_alarm_rule_evaluator.cpp` (Catch2, en el target
   liviano `beemetry_backend_tests`) cubre los 5 operadores de umbral, el
   fail-closed ante operador desconocido, cálculo de tasa (positiva/negativa/
   ventana inválida) y las 4 combinaciones de la ventana de debounce.

## Verificación E2E en vivo (2026-09-02, misma sesión)

`docker compose build web` + redeploy de `beemetry-api` con este código
(sin `--no-cache`, pero forzando la capa de `COPY . /app` a invalidarse por
contenido). **`db_scripts/89` no se auto-aplicaba** (esperado — solo corre
en `docker-entrypoint-initdb.d` sobre un volumen nuevo, y `beemetry-db` ya
tenía horas corriendo): aplicado a mano con
`psql -U sensors -d sensors_db < db_scripts/89_alarm_rules_rate_debounce.sql`,
igual que el resto de scripts >30 de este proyecto. Sesión real vía
`POST /api/auth/login/password` (usuario demo `demo_beemetry_admin`, seed
`db_scripts/51`, ver ese archivo para la contraseña compartida de demo).

- **T3/T4/T9/T12** — `POST /api/mining/alarms/rules` con
  `condition_type=rate`/`debounce_secs=30` → creada; `GET` la devuelve con
  ambos campos persistidos; `PUT` cambia nombre/threshold/severidad/
  condition_type/debounce_secs/enabled → confirmado en el siguiente `GET`.
- **Ciclo del evaluador en vivo**: regla `condition_type=value`,
  `mining_sensor_id=1` (valor real en BD: 12.4), `threshold=10`, `gt` →
  alarma real creada en el siguiente ciclo (~10-15s, cache invalidado por
  `invalidateRuleCache()` al crear, no esperó el TTL de 60s), mensaje
  `"Live trigger test: valor 12.4 gt 10"` correcto.
- **T11 (ack)**: `POST /api/mining/alarms/{id}` → `acknowledged=true`
  confirmado en el siguiente `GET`.
- **T10 (paginación)**: `GET /api/mining/alarms?limit=5&offset=0&severity=warning`
  → responde `{alarms, total, limit, offset}` con la forma esperada.
- **T18 (aislamiento multitenant, con DOS tenants reales)**: regla creada
  como `demo_beemetry_admin` (tenant Beemetry); logueado aparte como
  `demo_timetelemetry_admin` (tenant TimeTelemetry, seed distinto) →
  `GET /api/mining/alarms/rules` no devuelve la regla ajena (`{"rules":[]}`);
  `DELETE` sobre el `id` ajeno → `404 rule_not_found` (no `403` ni `200`) —
  el filtro `WHERE tenant_id = $2` la trata como inexistente, comportamiento
  correcto anti-IDOR.
- **Reglas y alarma de prueba borradas al terminar** — no queda test data
  colgando en `beemetry-db` salvo la fila histórica de `platform_alarms`
  (esperado, es auditoría, no se borra por diseño).

**Pendiente real, no cerrado por esta verificación**: T16 (CRUD, verificado
arriba) y T19 (historial auditado, ack confirmado arriba) tienen evidencia
en vivo pero no como suite automatizada QA formal. T20 (carga real de 100
cruces/5s) sigue sin probarse a esa escala.

## Actualización 2026-09-02 (segunda pasada, mismo día): evaluación en tiempo real — cierra T15/CA-1

A pedido explícito del developer, tras el hallazgo de arriba ("la SLA <2s es
incompatible con el polling de 10s"), se implementó la **opción de
evaluación por evento** (la que el propio SPEC-016 pedía originalmente,
descartada al principio de este ADR por simplicidad — reconsiderada acá por
decisión explícita, no un cambio de opinión unilateral).

### Decisión

`TelemetryIngestor` (`telemetry_ingest.hpp/cpp`) gana un hook
`setOnBatchCommitted(std::function<void(const std::vector<TelemetryRow>&)>)`,
invocado desde `copyBatch()` inmediatamente después del `COMMIT` exitoso
(nunca antes — evaluar contra un lote que todavía pudiera hacer `ROLLBACK`
produciría alarmas fantasma), envuelto en `try/catch` para que una excepción
en el callback jamás tumbe la ingesta. `device_alarm_routes.cpp` registra
`handleRealtimeTelemetryBatch()` en ese hook desde `startAlarmEvaluator()`
(antes de que `main.cpp` llame a `TelemetryIngestor::start()`, mismo orden
que ya exigía `configureKafka()`).

Por cada lote committeado: para cada fila, busca en el índice en memoria
`sensor_id -> reglas` (construido junto con el cache de reglas de T3) si hay
alguna regla de `sensor_id` real asociada — la gran mayoría de sensores no
tienen ninguna, así que el caso común es una consulta hash sin abrir
conexión a Postgres. Si hay coincidencia, evalúa con
`evaluateRuleAgainstValue()` (la MISMA función que ya usaba el polling,
extraída como pieza compartida) usando el `value_numeric` que YA está en
memoria del lote — sin volver a leer `telemetry_fact`. El polling de 10s
(`evaluateRulesOnce`/`evaluatorLoop`) **sigue existiendo sin cambios**, como
red de seguridad y como única vía real para reglas de `mining_sensor_id`
(el dashboard de simulación no pasa por `TelemetryIngestor`).

**Bug real encontrado y corregido en la misma pasada**: la primera versión
leía el índice `sensor_id -> reglas` sin verificar si estaba vigente — una
regla recién creada invalidaba el cache (`invalidateRuleCache()`, T12) pero
el camino en tiempo real seguía viendo el índice viejo hasta que el
PRÓXIMO ciclo del polling (hasta 10s después) lo refrescara, exactamente la
misma latencia que se estaba tratando de eliminar. Corregido: se agregó
`ruleCacheIsFresh()` (lectura sin efectos secundarios del mismo TTL/dirty
que ya usaba `getCachedEnabledRules()`) — si el cache está obsoleto o
invalidado, el camino en tiempo real fuerza un refresh contra Postgres
ANTES de mirar el índice. En régimen estable (sin cambios de reglas
recientes) esto no cuesta ninguna conexión extra; el costo solo aparece
justo después de crear/editar/borrar una regla, que es exactamente cuando
hace falta.

### Verificación en vivo (evidencia con timestamp exacto, no aproximada)

Contra `beemetry-api`/`beemetry-db` reales, con un sensor real
(`sensors.sensor_code`, tenant Alpayana) y una clave de dispositivo real:
regla creada (`threshold=1000`, `gt`) → 1s después, `POST
/api/mining/telemetry` con `value=9999` en `2026-09-02T23:24:03.167577Z` →
fila en `platform_alarms` con `triggered_at = 2026-09-02
23:24:03.346579+00`. **Diferencia: 179 ms** — bien por debajo del `<2s` que
pedía CA-1/T15, y sin el bug de cache frío del primer intento (verificado
también: ese primer intento, con el bug todavía presente, tardó ~14s,
capturado por el polling, no por el camino en tiempo real — confirma que el
fix realmente importaba, no era solo una precaución teórica).

### T20 cerrado: prueba de carga real (tercera pasada, mismo día)

100 lecturas concurrentes cruzando el umbral (`ThreadPoolExecutor`, 20
workers, `urllib` stdlib) empujadas contra `beemetry-api` real en **1.31s**,
sobre una regla con `debounce_secs=5`. Resultado: **exactamente 1 alarma**
creada (`id` único, `platform_alarms`) — confirma que el índice único
parcial (`idx_alarms_one_open_per_rule`, ADR-034) y el debounce nuevo (T5)
funcionan juntos como diseñado bajo carga real, no solo en el test unitario
de la lógica pura (`test_alarm_rule_evaluator.cpp`). Cierra CA-6/T20 de
SPEC-016 — con esto, los 5 CA aplicables (CA-1/2/4/5/6; CA-3 no aplica, sin
canal SSE) quedan con evidencia en vivo.

### Consecuencias adicionales de este cambio

- **T15 cierra**: la SLA `<2s` de CA-1 ya no es estructuralmente
  incompatible con la arquitectura — se cumple para reglas de `sensor_id`
  real. Las de `mining_sensor_id` (dashboard de simulación) siguen atadas al
  polling de 10s, sin cambios; no había forma de evitarlo sin que
  `mining_sensors.current_value` pasara por algún hook equivalente, fuera de
  alcance de esta pasada.
- **Riesgo nuevo, mitigado**: el callback corre en el hilo de flush/consumo
  de telemetría (no en una request HTTP), así que un bug ahí podría, en el
  peor caso, agregar latencia al pipeline de ingesta — mitigado por ser
  `try/catch`-eado (nunca tumba la ingesta) y por ser barato en el caso
  común (sin match, sin conexión a Postgres).
- No se tocó el protocolo `COPY` binario de `copyBatch()` en sí ni su
  rendimiento de 25k/s — el hook se dispara DESPUÉS del `COMMIT`, fuera de
  la ruta crítica de escritura.

## Consecuencias

### Positivas
- Cierra 5 de las 6 brechas reales que la auditoría encontró (T3/T4/T5/T9/T10)
  con evidencia de build real, no solo diseño.
- Reutiliza el motor ya probado en producción de ADR-034 (deduplicación,
  auditoría encadenada, notificación multicanal) en vez de construir un
  segundo motor de alarmas paralelo — evita el riesgo que el propio SPEC-016
  quería evitar (dos sistemas de alarmas divergentes).

### Negativas / Trade-offs
- **T7/T8 (canal SSE dedicado) no se implementan**: la plataforma ya empuja
  alarmas en tiempo real por WebSocket (`alarm_notifier.cpp`); agregar SSE
  en paralelo sería un segundo transporte para el mismo evento, sin pedido
  de negocio que lo justifique. Se documenta como decisión consciente, no
  como pendiente — si en el futuro un cliente necesita SSE específicamente
  (p. ej. un consumidor que no puede mantener WS), amerita su propio ADR.
- **T15-T19 (pruebas QA contra Postgres/WS reales) sin cerrar**: la
  evaluación con datos reales (`evaluateRulesOnce` contra `telemetry_fact`/
  `mining_sensors`, notificación WS end-to-end, aislamiento multitenant con
  filas reales) sigue sin una suite automatizada — requiere un entorno con
  Postgres vivo, fuera del target liviano de Catch2. Verificado solo por
  lectura de código + el comportamiento ya probado de ADR-034 (regla real
  insertada → alarma creada en el siguiente ciclo, auto-resolución,
  deduplicación — ver esa sección de ADR-034).
- El cache de reglas (T3) introduce hasta 60s de latencia entre crear una
  regla y que el evaluador la use SI la invalidación fallara silenciosamente
  — mitigado porque la invalidación es explícita en los 3 handlers de
  escritura, no depende de que el TTL expire por sí solo en el camino feliz.

## Alternativas descartadas

### Agregar el canal SSE que SPEC-016 pedía literalmente
Duplicaría el transporte de tiempo real sin necesidad — WS ya cubre el
mismo caso de uso (push de alarmas al frontend) y ya está integrado
(`alarmStream.ts`). Se prioriza no tener dos mecanismos de push
compitiendo por la misma responsabilidad.

### Cache LRU real (por regla, con desalojo por uso)
Sobre-ingeniería para este caso: el evaluador necesita SIEMPRE el conjunto
completo de reglas habilitadas en cada ciclo (no hace lookups individuales
por clave), así que no hay "menos usadas" que desalojar — cachear la
colección completa con TTL logra el mismo objetivo (reducir carga a
Postgres) con una estructura mucho más simple.

### Debounce reemplazando el índice único parcial existente
Se consideró unificar ambos mecanismos en uno solo. Descartado: el índice
único parcial es una garantía a nivel de base de datos (nunca hay 2 filas
abiertas para la misma regla, ni siquiera ante una condición de carrera
entre dos instancias del evaluador); el debounce en memoria de proceso no
sobrevive un reinicio del backend ni se comparte entre réplicas. Mantenerlos
separados preserva la garantía dura del índice mientras el debounce resuelve
un problema distinto (ruido de notificaciones, no duplicación de filas).

## Referencias
- `backend/src/mining/alarm_rule_evaluator.hpp/cpp` (nuevo — lógica pura)
- `backend/tests/test_alarm_rule_evaluator.cpp` (nuevo)
- `backend/src/mining/device_alarm_routes.cpp` (cache, PUT, paginación,
  integración de tasa/debounce en `evaluateRulesOnce`)
- `db_scripts/89_alarm_rules_rate_debounce.sql` (nuevo — `condition_type`,
  `debounce_secs`)
- ADR-034 (motor de alarmas original, ver su actualización 2026-09-02),
  ADR-109/`sensor_tenant_resolver.cpp` (mismo patrón de extracción a unidad
  de compilación pura para testabilidad)
