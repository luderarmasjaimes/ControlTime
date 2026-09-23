# SPEC 016 — Alertas y umbrales por sensor

| Campo | Valor |
|---|---|
| **ID** | 016 · **Estado** | **Implementado, verificado E2E en vivo (ADR-140, 2026-09-02/13) — ver notas de alcance en CA-3** |
| **SOW** | Respuesta ordenada ante alarmas/incidentes (valor de negocio §1.2); O1 |
| **Constitución** | Art. 1 (multitenant), Art. 2 (tiempo real), Art. 5 (observabilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-016**; fuente ADR: `docs/decisions/`.

- **ADR-002** — [`002-backend-cpp-gateway-central.md`](../../docs/decisions/002-backend-cpp-gateway-central.md)
- **ADR-008** — [`008-bus-eventos-redpanda-etapa2.md`](../../docs/decisions/008-bus-eventos-redpanda-etapa2.md)
- **ADR-031** — [`031-backend-plataforma-compartida-multicomponente.md`](../../docs/decisions/031-backend-plataforma-compartida-multicomponente.md)
- **ADR-034** — [`034-core-plataforma-iot-reemplazo-thingsboard.md`](../../docs/decisions/034-core-plataforma-iot-reemplazo-thingsboard.md)
- **ADR-057** — [`057-dashboard-widgets-estilo-thingsboard.md`](../../docs/decisions/057-dashboard-widgets-estilo-thingsboard.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)


## 1. Problema
Los valores de sensores fuera de rango (vibración, gas, temperatura) representan
riesgos de seguridad de mina. El operador debe ser **alertado en tiempo real**
cuando un sensor cruza un umbral, sin revisar manualmente miles de lecturas.

## 2. Objetivo
Motor de reglas de umbral por sensor/tipo/empresa que genera alertas en tiempo
real sobre el flujo de ingesta y las notifica al dashboard.

## 3. Usuarios y contexto
- **Roles:** operador, supervisor de seguridad. **Multitenant:** reglas por empresa.
- **Tiempo real:** evaluar contra el stream de ingesta (no por polling).

## 4. Alcance
**Incluye:** definición de umbrales (min/max/tasa de cambio) por sensor/tipo,
evaluación en tiempo real, generación y entrega de alerta (push), historial de
alertas. **NO incluye:** acciones automáticas de control (solo notifica).

## 5. Criterios de aceptación
- [x] **CA-1:** Una lectura que cruza un umbral genera una alerta en **< 2 s** desde su ingesta. *Verificado en vivo con timestamp exacto: **179 ms** vía hook `TelemetryIngestor::setOnBatchCommitted` (ADR-140, actualización 2026-09-02). El polling de 10s original sigue existiendo como red de seguridad y como única vía para reglas de `mining_sensor_id` (dashboard de simulación).*
- [x] **CA-2:** Las reglas son configurables por sensor/tipo/empresa (CRUD). *`GET/POST/PUT/DELETE /api/mining/alarms/rules`, verificado en vivo (ADR-140).*
- [x] **CA-3 (con desviación de diseño deliberada):** La alerta se entrega al dashboard por push sin recargar. *No se construyó el canal SSE que este CA pedía literalmente — la plataforma ya empujaba alarmas en tiempo real por **WebSocket** (`alarm_notifier.cpp`/`alarmStream.ts`, ADR-034), y agregar SSE en paralelo hubiera sido un segundo transporte para el mismo evento sin pedido de negocio. Decisión consciente, documentada en ADR-140 §"Alternativas descartadas" — no es evidencia faltante.*
- [x] **CA-4:** (multitenant) Reglas y alertas aisladas por empresa. *Verificado en vivo con DOS tenants demo reales: regla de un tenant no aparece en el listado del otro; `DELETE` cross-tenant → `404`, no `200`/`403` (ADR-140).*
- [x] **CA-5:** Toda alerta queda en historial auditable (quién, cuándo, valor, regla). *Paginación (`limit`/`offset`/`severity` + `total`) y `ack` (`acknowledged_by`/`acknowledged_at`) verificados en vivo (ADR-140).*
- [x] **CA-6:** Evitar tormenta de alertas: debounce/agrupación configurable. *Prueba de carga real: 100 lecturas concurrentes cruzando el umbral en 1.31s → exactamente 1 alarma creada (ADR-140, tercera pasada).*

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Latencia alerta | < 2 s |
| Evaluación | sobre el flujo (consumidor Kafka o trigger) |

## 7. Plan técnico (implementado — ver ADR-140)
- Reglas en `platform_alarm_rules`, alertas en `platform_alarms` (esquema de
  ADR-034, extendido por `db_scripts/89` con `condition_type`/`debounce_secs`).
- Evaluación por **dos caminos combinados**, no uno solo: hilo de polling cada
  10s (`evaluateRulesOnce`, red de seguridad y única vía para
  `mining_sensor_id`) + hook en tiempo real sobre `TelemetryIngestor::copyBatch()`
  para reglas de `sensor_id` real (179 ms medido, cierra CA-1).
- Alertas a tabla + push por **WebSocket** (`alarm_notifier.cpp`), no SSE — ver
  nota de CA-3 arriba.
- Agrupación por ventana: `debounce_secs` por regla (`isWithinDebounceWindow()`).

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Tormenta de alertas | debounce + agrupación por ventana |
| Evaluación añade latencia a la ingesta | evaluar en consumidor aparte, no en el COPY |
