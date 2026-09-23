# Plan de implementación: módulos faltantes para telemetría de sensores directos y gateways

**Fecha:** 2026-09-17
**Alcance:** capa de ingesta de telemetría — sensores que se conectan directo al servidor y gateways que agregan varios sub-dispositivos. No cubre UI de reportes/dashboards salvo donde es indispensable para una función de ingesta (ej. corrección manual).
**Basado en:** investigación de la réplica ThingsBoard ([INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md](../INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md)), catálogo de fórmulas/widgets ([REFERENCIA_REPLICACION_THINGSBOARD_FORMULAS_WIDGETS_2026-09-17.md](REFERENCIA_REPLICACION_THINGSBOARD_FORMULAS_WIDGETS_2026-09-17.md)) e inventario del código actual (`backend/src/mining/`).

## 0. Lo que YA existe (no reconstruir)

Antes de planear, confirmado por inventario del código real — esto **ya está implementado y no debe rehacerse**:

- **Adaptadores de protocolo** (ADR-034): MQTT push, Modbus TCP pull, OPC UA pull, gateway TLS de socket crudo (`protocol_adapters.cpp/hpp`, `mining_gateway.cpp/hpp`), más ingesta HTTP simple y multicanal (`device_alarm_routes.cpp`).
- **Registro/gestión de dispositivos**: alta con API key tipo `ACCESS_TOKEN`, rotación/revocación, listado, metadata (`sensor_service.cpp`, rutas en `device_alarm_routes.cpp`).
- **Motor de fórmulas de calibración** (ADR-187/189): 27 plantillas ya portadas desde la cadena `PiezometerRC-V2` real (Geokon, RST, Soil Instruments, CasaGrande, lineales y polinómicas) — `sensor_formula_evaluator.cpp`, `sensor_formula_template_routes.cpp`.
- **Motor de alarmas por valor/tasa de cambio**, con evaluación en tiempo real sobre cada batch ingerido (ADR-140) — `alarm_rule_evaluator.cpp`.
- **Canales multi-variable con nombre** (`sensor_input_channel_def`, `POST /api/mining/telemetry/multi`) — la plomería genérica para sensores de varios canales ya existe.
- **Frontend de gestión de sensores** (`SensorManagementView.tsx`, `TelemetryDashboard.tsx`, widgets multi-canal).

## 1. Gaps confirmados (por prioridad)

| # | Gap | Evidencia en ThingsBoard legado | Riesgo de no implementarlo |
|---|---|---|---|
| 1 | **Validación de sanidad en la ingesta cruda** (NaN/Inf, batería, rango freq/temp) | Nodos `Filtro NAN`, `Battery Validation`, `Freq and Temp Validation` presentes en TODAS las 70 rule chains legadas | Datos corruptos entran a `telemetry_raw`/`telemetry_fact` y contaminan fórmulas y reportes aguas abajo |
| 2 | **Alarma de inactividad** (dispositivo dejó de reportar) | 2,892 alarmas "Inactividad" activas sin reconocer en la réplica investigada — es el tipo de alarma más usado en producción real | Sin esto, un sensor de seguridad (piezómetro/prisma de talud) puede estar muerto días sin que nadie se entere |
| 3 | **Corrección manual de telemetría** (editar Freq/Temp de una fecha específica) | Widget `Elimina Registros` en `Beemetry Reportes` | Un valor corrupto puntual (glitch de RTC, ruido eléctrico) queda mal para siempre en reportes de seguridad |
| 4 | **Carga manual de archivo crudo** (CSV genérico + formato vendor `.IDFW` de acelerógrafo) | Widgets "Subir CSV" y "Acelerógrafo — Carga de archivo IDFW" en `Beemetry Desarrollo` | Sin respaldo cuando el enlace de campo cae, se pierde la ventana de datos hasta que vuelve la conexión |
| 5 | **Semántica de dominio para multicanal** (acelerógrafo triaxial con series derivadas ACC→VEL→DIS; inclinómetro/prisma incremental vs. acumulado) | Bundles `Beemetry Acelerografos`, `Beemetry Inclinometros`, `Prismas` | La plomería genérica ya existe, pero sin plantillas de dominio el usuario final tiene que armar cada fórmula a mano |
| 6 | Excepciones de calibración hardcodeadas por dispositivo (legado) | **Ya en progreso, no es un gap nuevo** — es `specs/027-integracion-sensores-directo-gateway/tasks.md` T16 (4 excepciones confirmadas: Boroo Misquichilca, GF.PZ VW-1703, Yaros YR.PZ-05R, más la ya documentada en ADR-189) | Bajo — seguir el avance de SPEC-027, no duplicar aquí |
| 7 | Protocolos de gateway adicionales (Sparkplug B, CoAP) | No confirmado que algún cliente actual los necesite | Bajo — no construir especulativamente sin un gateway real que lo requiera |

## 2. Plan por fases

### Fase 1 — Validación de sanidad en la ingesta (alta prioridad, bajo riesgo) — ✅ IMPLEMENTADO 2026-09-17
**Objetivo:** ningún valor `NaN`/`Inf`/fuera de rango físico llega a `telemetry_raw` sin marcarse.

**Estado:** el rechazo de NaN/Inf (equivalente al "Filtro NAN" legado) ya está implementado y verificado con build completo (`Dockerfile.verify`, `beemetry_backend_tests` en verde):
- `mining::isSaneTelemetryValue(double)` (`telemetry_ingest.hpp/cpp`) — función libre compartida.
- Aplicado en los 4 puntos reales donde un valor puede colarse: `TelemetryIngestor::enqueue()` (cubre `thingsboard_sync.cpp` y el fallthrough directo de `ingestLine()`), `TelemetryIngestor::ingestLine()` (cubre MQTT/Modbus/OPC-UA vía `protocol_adapters.cpp`, el gateway TLS `mining_gateway.cpp`, y HTTP single-value — antes de la rama Kafka, que si no se hubiera colado el chequeo), `consumerLoop()` (defensa en profundidad del lado consumidor de Kafka, para mensajes ya en el tópico antes de este cambio), y `handleHttpTelemetryMulti` (`device_alarm_routes.cpp`, la única ruta que inserta directo a `telemetry_fact` sin pasar por `TelemetryIngestor`).
- Nuevo contador `mapas_backend_telemetry_rejected_bad_value_total` en `/api/metrics`.
- `handleHttpTelemetry` ahora devuelve `400 invalid_value` (antes: `503 ingest_queue_full` genérico, engañoso para quien integra un gateway).
- **Validación de rango físico por tipo de sensor y filtro de batería**: quedaron **fuera de esta fase** a propósito — el plan original ya señalaba reusar el motor de alarmas existente (`platform_alarm_rules`, `condition_type='value'`) para batería en vez de código de filtro separado; el rango físico por tipo de sensor requeriría un campo de configuración que hoy no existe en `sensor_type_catalog` y se deja como fast-follow si se confirma necesidad real.

- Extender el punto único de entrada de todos los adaptadores (`protocol_adapters.cpp`, `device_alarm_routes.cpp::jsonToDoubleSafe`, `mining_gateway.cpp`) con una función compartida `isSaneTelemetryValue()` — mismo criterio que ya usa `thingsboard_sync.cpp::isSaneCapturedAt()` para timestamps, pero para el **valor**: `std::isfinite`, y opcionalmente un rango físico configurable por tipo de sensor (`sensor_type_catalog`).
- Reutilizar el patrón ya validado de `thingsboard_sync.cpp` (rechazar y loguear con contexto dispositivo+canal, no solo un contador agregado — lección aprendida documentada ahí mismo).
- Agregar contador Prometheus `mapas_backend_telemetry_rejected_bad_value_total` (mismo patrón que los contadores existentes en `handleMetrics`).
- **No** implementar el filtro de batería como regla fija: exponerlo como una condición más del motor de alarmas existente (`platform_alarm_rules`, `condition_type='value'` sobre el canal de batería) en vez de código separado — evita duplicar lógica de umbral que ya existe.
- Esfuerzo estimado: pequeño (1-2 días), toca 3 archivos existentes, sin tablas nuevas.

### Fase 2 — Alarma de inactividad (alta prioridad) — ✅ IMPLEMENTADO 2026-09-17 (ver [ADR-193](../decisions/193-alarma-inactividad-dispositivo-silencioso.md))
**Objetivo:** equivalente al tipo "Inactividad" de ThingsBoard — alarma cuando un sensor no reporta en N minutos/horas.

- Requiere una **decisión de diseño previa** (candidato a ADR propio, dado el patrón de este repo): ¿evaluación por polling periódico (barrido de `sensors.last_seen_at` cada N minutos) o por temporizador por dispositivo? Dado que `alarm_rule_evaluator.cpp` ya tiene un path de polling (`evaluateRulesOnce`), lo natural es extenderlo con un nuevo `condition_type='inactivity'` que compare `now() - last_seen_at` contra un umbral configurable por regla, reutilizando `platform_alarm_rules` en vez de crear una tabla paralela.
- `sensors.last_seen_at`/`connection_status` ya se trackean (confirmado en el inventario) — falta solo la regla que lea eso.
- Reusar `alarm_notifier.cpp` tal cual para la notificación (ya soporta WebSocket/email/webhook).
- Esfuerzo estimado: medio (3-5 días) — mayormente en `alarm_rule_evaluator.cpp` + migración SQL para el nuevo `condition_type`.

### Fase 3 — Corrección manual de telemetría (prioridad media)
**Objetivo:** permitir editar/anular un valor puntual de telemetría por dispositivo+canal+fecha, con auditoría.

- Nueva ruta `PUT /api/mining/telemetry/correct` (patrón igual a las rutas de `device_alarm_routes.cpp`): recibe sensor_id/channel, timestamp, nuevo valor, motivo obligatorio (texto), y usuario autenticado.
- **No** sobrescribir el dato crudo original — insertar como una corrección versionada (nueva fila con `is_correction=true` + referencia a la fila original, o una tabla `telemetry_corrections` separada) para no perder la trazabilidad — el hallazgo de auditoría de este mismo proyecto (ver `auth_audit`) ya establece el estándar de nunca borrar, solo agregar con motivo.
- UI: extender `SensorManagementView.tsx` o un panel nuevo dedicado, reusando el patrón de formulario que ya existe ahí para editar metadata del sensor.
- Esfuerzo estimado: medio (3-4 días backend + 2-3 días frontend).

### Fase 4 — Carga manual de archivo crudo (prioridad media/baja, solo si hay demanda real de acelerógrafos)
**Objetivo:** vía de respaldo cuando la ingesta en vivo falla.

- Endpoint genérico `POST /api/mining/telemetry/import-csv` (columnas: timestamp, canal, valor) — reutiliza el pipeline de validación de la Fase 1 y el motor de fórmulas existente (no un camino paralelo).
- Parser específico de `.IDFW` (formato Kinemetrics) **solo si el cliente sigue usando esa marca de acelerógrafo** — antes de construirlo, confirmar con el cliente si Kinemetrics/Guralp siguen en uso o si los acelerógrafos nuevos ya hablan un protocolo estándar (evitar construir un parser de formato propietario sin necesidad confirmada, ver principio de no sobre-construir).
- Esfuerzo estimado: CSV genérico, pequeño (2 días). Parser `.IDFW`, mediano, solo bajo demanda confirmada.

### Fase 5 — Plantillas de dominio para multicanal (prioridad media) — 🟡 PARCIAL 2026-09-17 (ver [ADR-194](../decisions/194-plantillas-multicanal-acelerografo-inclinometro.md): Parte A implementada, Parte B bloqueada por decisión pendiente del developer)
**Objetivo:** que un acelerógrafo triaxial o un inclinómetro no requieran armar 3 fórmulas a mano cada vez.

- Extender el catálogo de `sensor_formula_template_routes.cpp` (mismo mecanismo que las 27 plantillas de calibración ya portadas) con:
  - Plantilla **"acelerógrafo triaxial"**: 3 canales de entrada (X/Y/Z o N-S/E-O/Z) → derivar ACC/VEL/VEL por integración simple (tinyexpr no soporta integración real — evaluar si esto requiere una extensión puntual del motor o un post-proceso separado; **decisión técnica pendiente**, no asumir que tinyexpr alcanza).
  - Plantilla **"desplazamiento incremental→acumulado"**: canal incremental + suma acumulada respecto a una lectura base — esto sí es expresable con el motor actual si se permite referenciar el valor anterior de la misma serie (confirmar si `sensor_formula_evaluator.cpp` ya soporta auto-referencia temporal; si no, es la pieza faltante real de esta fase).
- Esfuerzo estimado: depende de la decisión técnica de integración numérica — pequeño si solo es plantillas nuevas sobre capacidad existente, mediano-alto si el motor necesita una función nueva (acumulador con estado).

### Backlog (no planear esfuerzo todavía)
- Excepciones de calibración por dispositivo específico (Fase 6 de la tabla) — atender caso por caso cuando un cliente lo pida, no en bloque.
- Sparkplug B / CoAP — solo si un gateway real de un cliente lo exige.

## 3. Orden recomendado de ejecución

1. **Fase 1** (validación) primero — es la base de calidad de datos para todo lo demás, y es la de menor riesgo/esfuerzo.
2. **Fase 2** (inactividad) — alto valor operacional/seguridad, esfuerzo acotado, reutiliza infraestructura de alarmas existente.
3. **Fase 3** (corrección manual) — depende de tener ya la Fase 1 (para saber qué valores marcar como sospechosos y priorizar la corrección).
4. **Fase 5** (plantillas de dominio) — requiere resolver primero la decisión técnica de integración/acumulación en el motor de fórmulas.
5. **Fase 4** (carga de archivo) — la más aplazable; solo ejecutar la parte CSV genérica salvo confirmación explícita de necesidad de `.IDFW`.

## 4. Siguiente paso

Antes de codear la Fase 2 y la Fase 5 (las que involucran decisiones de arquitectura del motor de alarmas/fórmulas), corresponde escribir un ADR corto para cada una siguiendo la convención de este repo (`docs/decisions/`), dado que ambas cambian el comportamiento de un motor ya en producción, no son solo un endpoint nuevo aislado.

**Hecho (2026-09-17)**:
- [ADR-193](../decisions/193-alarma-inactividad-dispositivo-silencioso.md) — alarma de inactividad (Fase 2). Status: `proposed`, con una pregunta abierta explícita para el developer antes de codear (umbral por tipo de sensor vs. siempre explícito por regla).
- [ADR-194](../decisions/194-plantillas-multicanal-acelerografo-inclinometro.md) — plantillas triaxiales/incremental-acumulado (Fase 5). Status: `proposed`, separa una Parte A ya construible ahora (magnitud triaxial pura) de una Parte B que requiere una decisión de arquitectura (SQL con función ventana vs. extender el motor) y confirmación de necesidad real antes de estimar la integración ACC→VEL→DIS.
- **Importante, descubierto al escribir estos ADR**: ya existe `specs/027-integracion-sensores-directo-gateway/` (abierto 2026-09-16, ADR-192) cubriendo en profundidad la verificación de las 27 plantillas de piezómetro y las excepciones por dispositivo — ver corrección en la fila 6 de la tabla de gaps arriba. Los ADR-193/194 se escribieron referenciándolo explícitamente para no duplicar ni contradecir ese trabajo.
