# ADR-193 — Alarma de inactividad (dispositivo dejó de reportar)

**Status**: implemented (2026-09-17) — ver "Actualización 2026-09-17" al final

**Fecha**: 2026-09-17

**Autores**: Luder Armas (decisión de arquitectura pendiente), con Claude Code

**Ámbito**: mining / IoT (motor de alarmas)

**Relación**: extiende [ADR-140](140-alarmas-tiempo-real-batch-committed.md) (motor de
alarmas en tiempo real) y [ADR-034](034-nucleo-cpp-plataforma-iot-propia.md) (núcleo de
ingesta). Complementa, sin solaparse, a [ADR-192](192-auditoria-integracion-sensores-directo-gateway-cierre-spec027.md)
y `specs/027-integracion-sensores-directo-gateway/` — SPEC-027 Fase 4 (T17/T18) trata
de **portar cadenas de alarma de VALOR específicas de un cliente** (Cuajone/Huarón/
Brocal) ya existentes en el legado; este ADR es distinto: propone un **tipo de alarma
de infraestructura genérico** ("el sensor dejó de hablar") que hoy no existe en
`platform_alarm_rules` para ningún tenant, y que en ThingsBoard es nativo de la
plataforma, no una cadena de reglas por cliente.

## Contexto

La investigación de la réplica de desarrollo de ThingsBoard (
[INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md](../INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md),
sección 5) encontró **2,892 alarmas de tipo "Inactividad" (severidad MAJOR) en
estado `ACTIVE_UNACK`**, y un historial de **2.65 millones de alarmas de
inactividad ya resueltas desde febrero 2025** — es, con diferencia, el tipo de
alarma más usado en la operación real de ese sistema. Es una alarma **nativa
de ThingsBoard** (no vive en ninguna rule chain de cliente), disparada cuando
un dispositivo deja de enviar telemetría por más de un umbral configurado.

En el core nuevo (auditado en código y confirmado por ADR-192 contra
`sensors_db` real):
- `sensors.last_seen_at` y `sensors.connection_status` **ya se actualizan** en
  cada ingesta HTTP (`handleHttpTelemetry`/`handleHttpTelemetryMulti`,
  `device_alarm_routes.cpp`).
- `platform_alarm_rules` soporta hoy `condition_type IN ('value','rate')` —
  ambos comparan un **valor de telemetría entrante** contra un umbral.
  Ninguno de los dos puede expresar "no llegó nada en N minutos", porque
  ambos solo se evalúan cuando SÍ llega un dato nuevo (evaluación en
  `TelemetryIngestor::setOnBatchCommitted`, ADR-140) o en el polling
  `evaluateRulesOnce` sobre el ÚLTIMO valor conocido — ninguno de los dos
  caminos dispara nada si el flujo de datos simplemente se detiene.
- ADR-192 confirma que, a fecha de la auditoría, **hay 1 sola regla de alarma
  en todo el sistema** y ninguna usa un canal calculado de fórmula — el motor
  de alarmas está, en la práctica, casi sin configurar todavía para
  telemetría real. Es el momento correcto para agregar este tipo de alarma
  antes de que haya muchas reglas value/rate que migrar.

Para una plataforma de monitoreo de seguridad de taludes/presas de relaves
(piezómetros, prismas, inclinómetros — confirmado por el catálogo de
dispositivos de la investigación de ThingsBoard), un sensor de seguridad que
deja de reportar silenciosamente durante días **sin que nadie se entere** es
un riesgo operacional mayor que un valor fuera de rango puntual.

## Decisión (propuesta — requiere confirmación antes de codear)

1. Extender `platform_alarm_rules` con un nuevo `condition_type = 'inactivity'`:
   - No compara un valor entrante; compara `now() - sensors.last_seen_at` (o
     `dim_sensor`/última fila de `telemetry_fact` si se prefiere no depender
     de `last_seen_at`, a decidir) contra un `threshold_seconds` propio de la
     regla.
   - Se evalúa en el **path de polling existente** (`evaluateRulesOnce`,
     `alarm_rule_evaluator.cpp`) con un ciclo adicional o el mismo ciclo ya
     existente — NO requiere el path de tiempo real de ADR-140 (no hay batch
     que dispare la evaluación cuando el sensor está, precisamente, callado).
   - Reutiliza `alarm_notifier.cpp` sin cambios (WebSocket/email/webhook ya
     soportados).
2. **Auto-clear**: cuando el sensor vuelve a reportar (`last_seen_at` se
   actualiza), la alarma abierta por inactividad debe cerrarse sola — mismo
   comportamiento que ThingsBoard (`CLEARED_UNACK`). Requiere que
   `evaluateRulesOnce` (o el flujo de ingesta) chequee alarmas de inactividad
   abiertas para ese sensor al recibir un dato nuevo.
3. **Pregunta abierta para el developer, antes de implementar**: ¿el umbral
   de inactividad debe tener un default global configurable por tipo de
   sensor (ej. piezómetro cada 15 min → alarma a los 60 min; estación
   meteorológica cada hora → alarma a las 4h), o siempre una regla explícita
   por sensor/tenant sin default? ThingsBoard legado no distinguía por tipo
   (un solo umbral de inactividad genérico) — no se asume aquí cuál conviene
   sin confirmar con el developer.

## Consecuencias

- **Positivas**: cierra el gap operacional más usado del sistema legado real
  (2,892 alarmas activas hoy en esa base), con cambios acotados a
  `alarm_rule_evaluator.cpp` + una migración SQL para el nuevo
  `condition_type` — no toca el pipeline de ingesta ni el motor de fórmulas.
- **Negativas / riesgo**: si el umbral por defecto queda mal calibrado
  (demasiado sensible), puede generar ruido de alarmas similar al volumen
  legado (2.65M históricas) — el `debounce_secs` ya existente en
  `platform_alarm_rules` ayuda pero no resuelve completamente esto; conviene
  partir con umbrales conservadores y ajustar con datos reales.
- No resuelve las alarmas específicas de cliente (Cuajone/Huarón/Brocal) que
  SPEC-027 T17/T18 sigue tratando por separado — son decisiones independientes.

## Alternativas descartadas

- **Poller/temporizador dedicado por dispositivo** (un hilo o timer por
  sensor): descartado por complejidad operacional (miles de sensores =
  miles de timers) sin beneficio real sobre extender el polling ya
  existente de `evaluateRulesOnce`, que ya barre todas las reglas
  periódicamente.
- **Trigger/cron a nivel SQL** (pg_cron sobre `sensors.last_seen_at`):
  descartado por consistencia arquitectónica — toda la lógica de negocio de
  alarmas ya vive en `alarm_rule_evaluator.cpp` (C++), no en la capa SQL;
  mezclar ambas complicaría el mantenimiento y la trazabilidad de por qué se
  disparó una alarma.

## Referencias

- `docs/INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md` (sección 5 — 2,892 alarmas Inactividad reales)
- `docs/development/PLAN_IMPLEMENTACION_TELEMETRIA_SENSORES_GATEWAYS_2026-09-17.md` (Fase 2)
- `backend/src/mining/alarm_rule_evaluator.cpp`, `device_alarm_routes.cpp` (`platform_alarm_rules`, `last_seen_at`/`connection_status`)
- `docs/decisions/140-alarmas-tiempo-real-batch-committed.md`
- `docs/decisions/192-auditoria-integracion-sensores-directo-gateway-cierre-spec027.md`
- `specs/027-integracion-sensores-directo-gateway/tasks.md` (Fase 4, T17/T18 — alarmas de cliente, trabajo relacionado pero distinto)

## Actualización 2026-09-17 — implementado, decisiones tomadas, 1 contradicción encontrada y corregida

**Decisión sobre la pregunta abierta** (umbral por tipo de sensor vs. explícito por
regla): se implementó **siempre explícito por regla, sin default por tipo de
sensor** — no existe hoy ningún campo de "intervalo de reporte esperado" en
`sensor_type_def`/`sensor_type_catalog`, y agregar uno sin confirmar la
necesidad real habría sido construir de más (mismo criterio aplicado en todo
este plan: no anticipar estructura sin un caso real que la requiera). Queda
como fast-follow explícito si el volumen de reglas de inactividad lo justifica.

**Cambios reales**:
- `db_scripts/104_alarm_rule_inactivity.sql` — agrega `'inactivity'` al
  `CHECK` de `condition_type` (aplicado y verificado en `sensors_db` local).
  Sin columnas nuevas: reutiliza `threshold` (segundos de silencio) y
  `operator` (debe ser `'gt'`, validado en backend).
- `handleCreateAlarmRule`/`handleUpdateAlarmRule` (`device_alarm_routes.cpp`):
  validan `condition_type='inactivity'` ⇒ requiere `sensor_id` real (rechaza
  `mining_sensor_id`) y `operator='gt'`. El UPDATE valida contra la fila
  existente (sensor_id es inmutable tras crear la regla).
- `evaluateRulesOnce()`: nueva rama que calcula
  `EXTRACT(EPOCH FROM (NOW() - sensors.last_seen_at))` y lo pasa a
  `evaluateRuleAgainstValue()` **sin modificar esa función** — hereda gratis
  debounce, auto-resolución al volver a reportar, notificación y auditoría
  (mismo mecanismo que `condition_type='value'`).
- Mensaje de alarma diferenciado ("sin reportar hace Xs") en vez del genérico
  "valor X gt Y", para que la notificación sea legible.

**Contradicción real encontrada y corregida durante la implementación** (esto
es precisamente lo que se pidió verificar): `handleRealtimeTelemetryBatch()`
(el camino en tiempo real de ADR-140) indexa las reglas por `sensor_id` sin
filtrar por `condition_type` — ya excluía `formula_output_channel_code`, pero
**no** excluía `inactivity`. Sin corregirlo, la llegada de telemetría real
habría evaluado el VALOR crudo entrante (p.ej. una lectura de 42.5) como si
fuera "segundos de silencio" contra el umbral de inactividad — una
contradicción directa con el diseño de este ADR (que especifica evaluación
exclusiva por polling). Se agregó `if (rule.conditionType == "inactivity")
continue;` al camino en tiempo real, mismo patrón que el filtro ya existente
de `formulaOutputChannelCode`. Verificado con build completo
(`Dockerfile.verify`) y `ctest` en verde tras el fix.
