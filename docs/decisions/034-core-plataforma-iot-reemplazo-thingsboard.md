# ADR-034 — Core C++ como plataforma IoT propia (reemplazo de ThingsBoard)

**Corrección de auditoría (2026-07-13)**: este ADR afirmaba en dos lugares (ver
párrafos "Status" y "Sigue fuera de alcance" más abajo, sin editar, para dejar
trazabilidad del error) que los adaptadores de protocolo Modbus/OPC-UA/MQTT
"siguen diferidos por diseño" / "fuera de alcance". Era **falso** al momento de
esta revisión — los tres adaptadores están implementados
(`backend/src/mining/protocol_adapters.cpp`, 523 líneas), compilados y **enlazados
en el arranque real** (`main.cpp::startAdapters`), y verificados corriendo en el
contenedor `beemetry-api` en vivo:
```
[ADAPTERS] mqtt=on modbus=on opcua=on
[MQTT] adaptador iniciado → mqtt:1883
[MQTT] conectado, suscrito a 'beemetry/telemetry/#'
```
con `BEEMETRY_MQTT_ENABLED=true`, `BEEMETRY_MODBUS_ENABLED=true`,
`BEEMETRY_OPCUA_ENABLED=true` en el entorno real del contenedor, y un broker
Mosquitto propio (`beemetry-mqtt`) corriendo como servicio del stack. Cada
adaptador normaliza al evento canónico de telemetría y lo entrega a
`TelemetryIngestor::ingestLine()`, exactamente como este ADR especifica en su
diagrama de arquitectura — la implementación coincide con la decisión, solo el
texto de status había quedado desactualizado tras una sesión de trabajo
posterior que sí las completó. HTTP (push) se cubre por separado en
`device_alarm_routes.cpp` (`POST /api/mining/telemetry`), tal como este ADR ya
indicaba. CoAP es el único protocolo del diagrama original que **sigue sin
implementar** — no se encontró código ni configuración para él; si hay un caso
de uso real, amerita su propio ADR de detalle (mismo criterio ya establecido
más abajo).

**Actualización 2026-07-13**: cerrada la brecha de UI que este ADR dejaba abierta —
el motor de alarmas (párrafo siguiente) tenía backend completo pero ninguna interfaz
para que un administrador registrara reglas de umbral o canales de notificación
(email/webhook) sin tocar SQL directamente. Se agregó `AlarmConfigView.tsx`
(`frontend/src/components/ReportStudioV2/components/views/AlarmConfigView.tsx`), CRUD
completo sobre `/api/mining/alarms/rules` y `/api/mining/notifications/channels`,
verificado contra el backend real (crear/listar/eliminar reglas y canales). No
introduce decisiones arquitectónicas nuevas — cierra la superficie de UI de una
capacidad ya decidida aquí.

**Actualización 2026-07-13**: los adaptadores de protocolo que la nota de
abajo (2026-07-09) daba por "diferidos por diseño, sin caso de uso pendiente"
**sí se implementaron** en una sesión posterior — logs reales del backend
confirman `[ADAPTERS] mqtt=on modbus=on opcua=on` en arranque, y la
verificación de ADR-043 (endurecimiento de seguridad) re-confirmó que siguen
arrancando correctamente sin regresión. **Status real: implemented al 100%
de las 5 capacidades que pide este ADR** (ingesta básica, motor de fórmulas,
gestión de dispositivos, motor de alarmas, y ahora también adaptadores
Modbus/OPC-UA/MQTT). Se deja la nota de 2026-07-09 íntegra abajo por
trazabilidad — en su momento la lectura de "sin caso de uso pendiente" era
razonable, el trabajo posterior simplemente adelantó esa capacidad futura.

**Status**: implemented al 100% de las 5 capacidades (2026-07-13, ver corrección de auditoría arriba). Reconciliado 2026-08-08: este campo seguía diciendo "parcial" pese a que el cuerpo del ADR ya documentaba el cierre completo — `mining::protocols::startAdapters()` sigue enlazado en `main.cpp` y `protocol_adapters.cpp` presente en el árbol actual, sin regresión. Se deja el resto de esta sección (histórico 2026-07-09) íntegro por trazabilidad:

**Gestión de dispositivos** (`db_scripts/38_adr034_device_management_alarm_engine.sql` + `backend/src/mining/device_alarm_routes.cpp`): se extendió la tabla `sensors` real (la de ingesta de producción, ADR-007/008) con `device_api_key_hash`, `protocol`, `last_seen_at`, `connection_status`, `revoked_at` — deliberadamente NO se creó una tercera tabla de sensores (ya existían `mining_sensors` y `sensors` por separado). `POST /api/mining/devices/register` (admin) genera una API key cruda devuelta UNA sola vez (mismo patrón que `auth_refresh_tokens` de ADR-029 — solo se persiste el hash SHA-256), `GET /api/mining/devices` (tenant-scoped, IDOR-safe) y `POST /api/mining/devices/{id}` (revocación) completan el CRUD básico de identidad.

**Motor de alarmas event-driven** (`platform_alarm_rules` + `platform_alarms`): hilo de fondo (`AlarmEngine`, patrón singleton igual a `TelemetryIngestor`) evalúa reglas cada `BEEMETRY_ALARM_EVAL_INTERVAL_MS` (default 10s) contra el último valor real de `telemetry_raw`/`mining_sensors.current_value` — decisión deliberada de polling en vez de evaluación síncrona en el hot path de `telemetry_ingest.cpp::copyBatch()` (que debe seguir optimizado para 10K/seg, no cargarlo con lógica de reglas). Deduplicación vía índice único parcial (`idx_alarms_one_open_per_rule`, una alarma abierta por regla), auto-resolución cuando la condición deja de cumplirse, y cada alarma disparada genera una entrada real en `platform_audit_log` (hash-encadenado desde ADR-030).

**Bugs reales encontrados y corregidos durante la verificación de esta pieza** (no cosméticos — sin corregirlos, nada de esto habría funcionado en producción pese a compilar sin errores):
1. `HAS_LIBPQ` no se propaga entre translation units; el archivo nuevo no definía la macro, así que TODO el código bajo `#if HAS_LIBPQ` se compilaba silenciosamente a nada (macro indefinida = 0), sin ningún error de compilación ni de link. El hilo del evaluador nunca llegaba a imprimir su log de arranque — encontrado exactamente por eso, no por revisión de código.
2. Al corregir lo anterior, apareció un problema más profundo y preexistente en el proyecto: `libpq-fe.h` vive en `/usr/include/postgresql/` en esta imagen, no en la ruta "desnuda" que asume `storage/pg_pool.hpp`. Los 4 archivos que ya usaban `pg_pool.hpp` solo compilaban por una dependencia FRÁGIL del orden de `#include` (alguna otra cabecera incluida antes hacía el include calificado primero). Corregido de raíz agregando `PQ_INCLUDE_DIR` a `CMakeLists.txt` (no un parche local a este archivo) — beneficia a cualquier archivo futuro que use `pg_pool.hpp`/`pg_result.hpp`, sin depender de qué otra cabecera se incluyó antes.
3. `jsonb_build_object('message', $3)` con un parámetro de `PQexecParams` sin cast explícito falla en runtime con `could not determine data type of parameter $3` (Postgres no puede inferir el tipo de un parámetro dentro de una función variádica polimórfica sin contexto). Esto pasó silenciosamente desapercibido en una primera verificación manual con `psql` porque `PREPARE ... AS` (usado para probar) SÍ declara tipos explícitos, ocultando el bug — se detectó solo al agregar logging de errores y probar el ciclo completo real. Corregido con `$3::text` explícito en las 2 llamadas de auditoría de este archivo.

**Verificado end-to-end contra `beemetry-db`/`beemetry-api` reales** (no simulado):
- Regla real insertada (sensor id=1, `mining_sensors.current_value=12.4`, condición `gt 10`) → alarma creada automáticamente por el hilo de fondo en el siguiente ciclo (~10s), con mensaje y severidad correctos.
- Auto-resolución: umbral subido a 999 (condición deja de cumplirse) → `resolved_at` poblado automáticamente en el siguiente ciclo.
- Deduplicación: umbral vuelto a bajar, esperados 2+ ciclos completos → exactamente 1 alarma abierta (no duplicados).
- Auditoría real: `platform_audit_log` muestra la entrada `alarm_triggered` con `entity_id`/`detail` correctos, en la cadena de hash de ADR-030.
- Registro de dispositivo probado directamente a nivel SQL (mismo patrón exacto que usa el endpoint): `INSERT INTO sensors (...)` con hash de API key, `RETURNING sensor_id` correcto.
- Gating de autorización confirmado contra el backend real: los 4 endpoints nuevos devuelven `401 unauthorized` sin sesión. No se pudo probar el camino admin autenticado completo vía HTTP en esta sesión (requiere usuario admin con biometría enrolada, no reproducible por `curl`) — la lógica de negocio ya está probada por separado a nivel SQL/evaluador.
- Build real (`docker compose build web`) con 0 errores tras las 3 correcciones; desplegado en `beemetry-api` real.

**Sigue fuera de alcance, tal como el propio ADR ya lo scopea ("Futuro, por demanda")**: adaptadores Modbus/OPC-UA/CoAP/MQTT. Ninguno de los protocolos adicionales tiene un caso de uso concreto pendiente hoy (el gateway TLS custom de ADR-007/008 es "el protocolo en uso", que es exactamente lo que v0.1 pide). Si se decide adoptar alguno, amerita su propio ADR de detalle con la librería/dependencia elegida y pruebas contra un broker/dispositivo real — no algo para agregar apurado al final de esta sesión.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: core-iot

> Reencuadra la familia de datos/ingesta (ADR-007/008) y se apoya en ADR-002 (gateway),
> ADR-003 (servidor) y ADR-031 (plataforma compartida).

## Contexto

Hoy parte de las capacidades IoT de la operación —ingesta desde múltiples protocolos, colas, motor de reglas, gestión de dispositivos y alarmas— las provee una **instancia de ThingsBoard** externa. La intención del producto es que el **core C++ las reemplace progresivamente**, integrándolas al gateway soberano (ADR-002) con el rendimiento del hot path C++ (ADR-003). Esto cambia la naturaleza del core: no es "un gateway de telemetría para reportes", es una **plataforma IoT propia**. El módulo `formula/` ya cumple el rol de motor de reglas/fórmulas, y el gateway ya hace ingesta WS — son la base sobre la que se construye el reemplazo.

## Decisión

El core C++ se construye como **plataforma IoT propia que reemplaza a ThingsBoard**, cubriendo cinco capacidades, todas bajo el gateway soberano y el modelo de plataforma compartida (ADR-031):

1. **Ingesta multi-protocolo** — MQTT, CoAP, HTTP, WebSocket, Modbus, OPC-UA… mediante **adaptadores** desacoplados.
2. **Colas / bus** — directo libpq en Etapa 1 (ADR-007); Redpanda + librdkafka en Etapa 2 (ADR-008).
3. **Motor de reglas / fórmulas** — módulo `formula/` (análogo al rule engine de ThingsBoard), versionado.
4. **Gestión de dispositivos** — registro, identidad/credenciales de dispositivo, estado, asociación a tenant/zona.
5. **Alarmas y eventos** — generación, ruteo y persistencia de alarmas a partir de reglas.

### Arquitectura de ingesta por adaptadores

Cada protocolo es un **adaptador** que normaliza su entrada a un **evento de telemetría canónico** (el mismo contrato versionado de ADR-007), de modo que colas, reglas y persistencia no conocen el protocolo de origen.

```
[MQTT|CoAP|HTTP|WS|Modbus|OPC-UA] → adaptador → evento canónico → cola → reglas/fórmulas → persistencia/alarmas
```

### Reglas duras
- Cada protocolo nuevo = un adaptador que normaliza al evento canónico; nada de lógica de protocolo regada en el core.
- La **identidad/gestión de dispositivos es del core** (plataforma), no de un componente del frontend (ADR-031).
- Las reglas/fórmulas viven en el motor `formula/`, versionadas; no se hardcodean en handlers.
- El reemplazo de ThingsBoard es **progresivo (estrangulamiento)**, no big-bang: se migra capacidad por capacidad detrás del gateway.

### Alcance por etapa
- **v0.1**: los protocolos en uso hoy + motor de fórmulas + ingesta básica; ThingsBoard puede convivir detrás del gateway mientras se estrangula.
- **Futuro (por demanda)**: protocolos adicionales, device management avanzado y alarmas complejas — cada uno puede tener su ADR de detalle bajo el ámbito `core-iot`.

## Consecuencias

### Positivas
- **Soberanía total** del subsistema IoT (sin dependencia de una plataforma externa) y rendimiento C++ en el hot path.
- Integración nativa con el resto de la plataforma (identidad, auditoría, almacenamiento) — un solo stack, no dos.
- El core crece de forma ordenada por adaptadores y reglas, no por parches.

### Negativas / Trade-offs
- Reimplementar capacidades **maduras** de ThingsBoard (device mgmt, rule engine, conectores) es **esfuerzo y riesgo grandes** — mitigado por estrangulamiento progresivo, por reusar lo ya hecho (`formula/`, gateway WS) y por priorizar solo los protocolos realmente usados.
- Riesgo de sobre-alcance del core — acotado por "incorporar por demanda", cada capacidad con su ADR.

### Neutras
- Define un subsistema grande dentro del core; justifica el ámbito `core-iot` en el índice de ADRs.

## Alternativas descartadas

### Mantener ThingsBoard
Rápido y maduro, pero es una dependencia externa (otro stack/lenguaje), con menos control de latencia y de integración con la identidad/auditoría de la plataforma, y no del todo soberano. Se descarta como destino final; puede convivir en transición.

### ThingsBoard Edge / híbrido permanente
Reduce esfuerzo, pero perpetúa dos plataformas y dos modelos de identidad/datos. Contradice ADR-031 (plataforma única) y la soberanía.

### Reescritura big-bang
Reemplazar todo de golpe es alto riesgo. Se prefiere estrangulamiento progresivo detrás del gateway.

## Referencias
- `Referencias/backend/src/formula/` (motor de fórmulas), `src/mining/` (gateway/ingesta)
- ADR-002 (gateway), ADR-003 (servidor), ADR-007/008 (ingesta/bus), ADR-031 (plataforma compartida), ADR-033 (nombres)
