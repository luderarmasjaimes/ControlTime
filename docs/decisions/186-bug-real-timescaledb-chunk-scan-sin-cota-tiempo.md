# ADR-186 — Bug real: consultas de "último valor" sin cota de tiempo colapsan contra TimescaleDB con ~10.900 chunks

**Status**: implemented, verificado en vivo antes/después contra la BD y el stack reales (2026-09-13)

**Fecha**: 2026-09-13

**Autores**: Luder Armas (pedido: "implementar los pendientes con el máximo
análisis posible para lograr los mejores resultados", en el marco de cerrar
SPEC-016 T15/demo de gate R5), con Claude Code

**Ámbito**: core-iot, plataforma, reports

**Relación**: encontrado al intentar ejecutar el demo en vivo de SPEC-016
(ver [ADR-140](140-alertas-umbral-cache-tasa-debounce-sensor.md)); el mismo
patrón de bug aparece en 3 lugares distintos del backend, dos de ellos sin
relación con alertas.

## Contexto

Para cerrar el único ítem realmente pendiente de SPEC-016 (demo en vivo:
crear una regla real y verla dispararse en el dashboard), se intentó medir
el camino de polling del evaluador de alarmas
(`device_alarm_routes.cpp::evaluateRulesOnce`) contra un sensor real. La
consulta de "último valor" para reglas con `sensor_id` real:

```sql
SELECT tf.value_numeric FROM telemetry_fact tf
JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk
WHERE ds.sensor_id = $1::uuid AND tf.channel_id = 0
  AND tf.value_numeric IS NOT NULL ORDER BY tf.captured_at DESC LIMIT 1
```

**no completó ni con un `statement_timeout` de 10 segundos**, medido en vivo
contra `beemetry-db` real — tampoco un `EXPLAIN` sin `ANALYZE` (es decir, ni
siquiera **planificar** la consulta terminaba a tiempo). Esta conexión no
tiene ningún `statement_timeout` configurado en el código, así que en
producción esta consulta puede bloquear el hilo del evaluador
indefinidamente, no solo tardar unos segundos.

## Causa raíz

`telemetry_fact` es una hypertable de TimescaleDB con `chunk_time_interval
= 1 hora` (`db_scripts/74_telemetry_fact_dimensions.sql`, decisión
deliberada para que la compresión pueda actuar sobre chunks ya cerrados
poco después, ver `db_scripts/75_telemetry_fact_compression_retention.sql`).
Verificado en vivo: **~10.900 chunks acumulados** al día de hoy
(`timescaledb_information.hypertables`).

Un `ORDER BY captured_at DESC LIMIT N` **sin** una condición sobre
`captured_at` obliga al planner a considerar el historial completo de
chunks (`ChunkAppend` sobre los ~10.900), en vez de poder excluir por
constraint exclusion los que quedan fuera de una ventana reciente. El costo
de planificación/ejecución crece con la CANTIDAD DE CHUNKS acumulados con
el tiempo, **no con el volumen de filas por segundo** — un matiz real que
un comentario preexistente en el código (`simulation_status_routes.cpp`)
tenía equivocado: asumía que el riesgo era "aceptable hoy" por el volumen
bajo de este entorno frente a los 25k/s de diseño (ADR-131), cuando en
realidad el número de chunks ya es alto HOY, independientemente del volumen
de filas, simplemente por el tiempo transcurrido con `chunk_time_interval`
tan chico. El riesgo no era futuro: ya estaba materializado.

**El mismo patrón exacto se encontró en 2 lugares más**, sin relación con
alertas:

1. `sensor_service.cpp::handleGetTelemetrySummary` (`GET
   /api/mining/telemetry/summary`, consumido por `KpiOperationsView.tsx`) —
   un `LEFT JOIN LATERAL` con el mismo `ORDER BY captured_at DESC LIMIT 1`
   ejecutado **una vez por sensor** (142+ filas). Medido en vivo contra el
   stack real: **no respondía ni en 45 segundos reales** (límite del propio
   cliente de prueba).
2. `simulation_status_routes.cpp::handleGetSimulationLiveStatus` (`GET
   /api/mining/simulation/live-status`, consumido por
   `SimulationMonitor.tsx`) — mismo patrón en `sqlRawLatest`/`sqlCalcLatest`
   (`ORDER BY captured_at DESC LIMIT 20`, sobre `telemetry_fact` y
   `telemetry_fact_calc` respectivamente, ambas con `chunk_time_interval=1h`
   también).

## Decisión (fix real, 3 archivos)

Acotar `captured_at` a una ventana reciente en las 3 consultas — permite
que TimescaleDB excluya por constraint exclusion casi todos los chunks
históricos, tocando solo 1-2 chunks recientes:

| Archivo · función | Ventana elegida | Motivo |
|---|---|---|
| `device_alarm_routes.cpp::evaluateRulesOnce` | 15 minutos | Amplio margen frente al ciclo de evaluación (10s por defecto, `BEEMETRY_ALARM_EVAL_INTERVAL_MS`) sin acercarse al costo de escanear el historial completo. Efecto secundario correcto: ya no evalúa una alarma contra un valor viejo de un sensor que dejó de reportar. |
| `sensor_service.cpp::handleGetTelemetrySummary` | 24 horas | Panel de resumen de sensores — margen generoso para sensores con cadencia de reporte más lenta, sigue acotado a ~24 chunks en el peor caso. |
| `simulation_status_routes.cpp` (`sqlRawLatest`/`sqlCalcLatest`) | 24 horas | Mismo criterio — "últimas lecturas" de un panel de estado en vivo, no historial completo. |

**No se acotó** `sqlRawCounts`/`sqlCalcCounts` (los `COUNT(*)` de "total
histórico" del mismo `simulation_status_routes.cpp`) porque acotarlos
cambiaría su significado real (de "todo el historial" a "últimas 24h") — se
actualizó el comentario existente para corregir la premisa equivocada
("volumen bajo" en vez de "cantidad de chunks por tiempo transcurrido") y
se dejó documentado que el arreglo correcto sin cambiar el significado es
sumar `telemetry_fact_hourly.sample_count` (mismo patrón que
`samples_window` en `sensor_service.cpp`), pendiente de implementación
futura si ese panel se vuelve prioritario.

## Verificación (antes → después, medido en vivo)

| Consulta | Antes | Después |
|---|---|---|
| `evaluateRulesOnce`, 1 sensor real | `EXPLAIN` (sin `ANALYZE`) no completa en 10s | `EXPLAIN ANALYZE` real: 0,04ms ejecución, 2,6ms planificación |
| `GET /api/mining/telemetry/summary?hours=168` (142 sensores) | No responde en 45s reales (límite del cliente de prueba) | **1179ms** reales, 142 sensores, contra el stack real desplegado |

Build real verificado: `docker compose build web` exitoso, CTest 1/1
passed, deploy real (`beemetry-api` healthy), medición repetida contra el
stack corriendo tras el deploy — no son números de laboratorio.

## Consecuencias

### Positivas
- Corrige un bloqueo real y ya materializado (no hipotético) de un
  endpoint de dashboard de uso general (`/api/mining/telemetry/summary`) y
  de la red de seguridad de polling del motor de alarmas — ambos en
  producción desde hace semanas sin que el síntoma (panel vacío,
  "0 categorías") se hubiera diagnosticado hasta ahora.
- El fix es puramente aditivo (una condición `WHERE` más) — no cambia el
  contrato de ninguna API ni requiere migración de datos.
- Documenta correctamente, para el resto del proyecto, que el riesgo real
  de estas hypertables con `chunk_time_interval` chico es la CANTIDAD DE
  CHUNKS acumulados con el tiempo, no el volumen de filas por segundo — un
  matiz que corrige la premisa de un comentario preexistente y que aplica
  a cualquier consulta futura similar sobre `telemetry_fact`/
  `telemetry_fact_calc`.

### Negativas / Trade-offs
- Un sensor que deja de reportar por más de la ventana elegida (15 min o
  24h según el caso) deja de mostrar su último valor conocido — se
  considera correcto para el propósito de cada panel (no evaluar/mostrar
  datos viejos como si fueran actuales), pero es un cambio de comportamiento
  observable frente al código anterior.
- `sqlRawCounts`/`sqlCalcCounts` de `simulation_status_routes.cpp` quedan
  con el mismo riesgo real sin corregir — documentado explícitamente como
  pendiente, no resuelto en esta pasada (panel secundario de diagnóstico,
  no prioritario frente a los otros dos).
- No se auditaron otras consultas del backend que pudieran tener el mismo
  patrón fuera de los 3 puntos encontrados durante la investigación de
  SPEC-016 — una auditoría exhaustiva de todo el código que consulta
  `telemetry_fact`/`telemetry_fact_calc` queda fuera del alcance de esta
  pasada.

## Referencias
- `backend/src/mining/device_alarm_routes.cpp` (`evaluateRulesOnce`)
- `backend/src/mining/sensor_service.cpp` (`handleGetTelemetrySummary`)
- `backend/src/mining/simulation_status_routes.cpp` (`sqlRawLatest`,
  `sqlCalcLatest`, comentario corregido de `sqlRawCounts`)
- `db_scripts/74_telemetry_fact_dimensions.sql` (chunk_time_interval=1h)
- [[140]] (ADR de origen — motor de alarmas, SPEC-016)
- [[131]] (consolidación del modelo de telemetría — contexto de por qué
  existe `telemetry_fact` con este particionado)
