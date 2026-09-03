# ADR-136 — Telemetría calculada por lectura (`telemetry_fact_calc`) + dashboard de monitoreo de simulación

**Status**: implemented (esquema + endpoint de lectura; el cómputo lo puebla un script externo, ver Alternativas descartadas)
**Fecha**: 2026-08-29
**Autores**: EC (con Luder Armas)
**Ámbito**: datos / core-iot / frontend

> Contexto operativo: hay una simulación de comportamiento de producción de 1
> hora corriendo contra `board.beemetry.com` real vía un contenedor standalone
> (`tb-sync-sim-1h`), separada del sync de ThingsBoard permanente
> (`thingsboard_sync.cpp`/`etl_sync_peer`, fuera de alcance de este ADR). Se
> necesitaba una forma de visualizar, además de la telemetría cruda que ya
> ingresa, un conjunto de métricas *derivadas* por lectura (nivel de alerta,
> tasa de cambio, delta contra umbral) sin inventar una tabla de negocio que
> no encaje con el modelo ya consolidado por ADR-131.

## Contexto

Extiende ADR-131 (`dim_tenant`/`dim_site`/`dim_sensor`/`telemetry_fact*`).
Antes de este ADR no existía ninguna tabla que persistiera una métrica
**calculada, con grano de lectura individual de sensor**:

- `mining_runtime_kpis` (ver `kpi_service.cpp`) es de grano **KPI de negocio**
  (por tenant/periodo), no por lectura de sensor — no sirve para "¿cuál fue
  el nivel de alerta de ESTA lectura de ESTE sensor?".
- El motor `formula_engine` (`formula_service.cpp`, `sp_proceso_temperatura`
  y procedimientos análogos) calcula reglas de negocio **al vuelo**, sobre
  `telemetry_fact_formula`, sin persistir el resultado — cada consulta
  recalcula, no hay histórico de "qué se calculó y cuándo".

Ninguna de las dos era el lugar correcto para una métrica derivada 1:1 de una
fila de `telemetry_fact` (la vía de ingesta real de 25k/s, ADR-131) que se
quiere poder graficar en el tiempo igual que la telemetría cruda.

## Decisión

### 1. Nueva hypertable `telemetry_fact_calc` (`87_telemetry_fact_calc.sql`)

Mismo patrón dimensional que el resto de `telemetry_fact*` (ADR-131): claves
surrogate (`tenant_id_sk`/`sensor_id_sk` contra `dim_tenant`/`dim_sensor`),
`value_numeric REAL`, `quality_code SMALLINT`.

```
tenant_id_sk    SMALLINT NOT NULL REFERENCES dim_tenant(tenant_id_sk)
sensor_id_sk    INTEGER  NOT NULL REFERENCES dim_sensor(sensor_id_sk)
metric_code     TEXT     NOT NULL   -- 'alert_level' | 'rate_of_change' | 'threshold_delta' | ...
captured_at     TIMESTAMPTZ NOT NULL  -- timestamp de la fila telemetry_fact origen
value_numeric   REAL
quality_code    SMALLINT NOT NULL DEFAULT 0
alert_level     TEXT NOT NULL DEFAULT 'normal' CHECK (alert_level IN ('normal','warning','critical'))
PRIMARY KEY (sensor_id_sk, metric_code, captured_at)
```

Diferencias deliberadas frente a `telemetry_fact`/`telemetry_fact_formula`:

- **`channel_id` no aplica** — las métricas calculadas no vienen de un canal
  multivariado de sensor, son un resultado derivado; `metric_code` cumple el
  rol de discriminador de la PK en su lugar.
- **`tenant_id_sk` se desnormaliza en la fila** aunque no es parte de la PK
  (igual de innecesario para la identidad de la fila que en `telemetry_fact`,
  donde tampoco es PK) — es puramente para servir los dos patrones de
  consulta del endpoint nuevo ("últimas N filas de un tenant", "conteo de un
  tenant en la última hora") sin depender de un JOIN a `dim_sensor` en el hot
  path de lectura. Índice `(tenant_id_sk, captured_at DESC)`.
- **`alert_level` con CHECK enumerado** — a diferencia de `metric_code`
  (texto libre, sin catálogo `dim_` dedicado: el volumen de códigos
  distintos hoy no lo justifica), `alert_level` sí se restringe porque es lo
  que la UI usa para colorear (normal/warning/critical), y un valor fuera de
  ese dominio sería un bug silencioso en el color mostrado.
- **Chunk interval de 1 hora** (igual que `telemetry_fact`, no los 7 días de
  `telemetry_fact_formula`) — se deriva 1:1 de `telemetry_fact`, mismo ritmo
  de llegada esperado.
- **Sin retención agresiva** — igual que `telemetry_fact_formula`: volumen
  bajo/derivado, no la vía caliente de 25k/s que sí necesita
  `retention=190d` (ADR-131 Decisión 1). No se agregó política de
  compresión en esta sesión (bajo volumen esperado del script externo de
  simulación; se puede sumar después con el mismo patrón de
  `75_telemetry_fact_compression_retention.sql` si el volumen lo justifica).

### 2. Cómputo: script externo, NO el backend C++ (interino, explícito)

El backend **no** gana un hilo/scheduler de cómputo de fórmulas en esta
sesión — decisión explícita del usuario, fuera de alcance. Un script externo
(fuera de este repo de backend) hace `INSERT` directo en
`telemetry_fact_calc` a partir de lo que lee de `telemetry_fact`. El backend
sólo expone lectura. Si esto deja de ser interino (el negocio quiere el
cómputo dentro del backend, con garantías de a-lo-sumo-una-vez y reintentos),
es un ADR de seguimiento, no una extensión silenciosa de este.

### 3. Endpoint de lectura: `GET /api/mining/simulation/live-status?tenant_id=<uuid>`

Nuevo archivo `backend/src/mining/simulation_status_routes.cpp`/`.hpp`,
registrado desde `mining::registerRoutes` (`mining_routes.cpp`) junto al
resto de rutas de minería — mismo lugar que `handleGetSensorData`/
`handleGetTelemetrySummary`.

Sigue exactamente el patrón de seguridad/lectura ya establecido en
`sensor_service.cpp`:

- **Anti-IDOR**: sesión obligatoria + `resolveAllowedSensorTenant` (mismo
  guard que usan `handleGetSensorData`/`handleGetTelemetrySummary`/
  `sensor_telemetry_wizard.cpp` — el tenant efectivo siempre se deriva de la
  sesión, un `tenant_id` de query distinto sólo se acepta si
  `userBelongsToTenant` lo autoriza).
- **Lectura por réplica**: `storage::PgPool::replica().acquire(AppConfig::instance().readUrl())`
  — cae al primario automáticamente si no hay réplica configurada
  (`AppConfig::readUrl()`).
- **Sin lógica de cómputo** — el handler sólo hace `SELECT` agregados
  (`COUNT(*)`, `COUNT(*) WHERE captured_at > NOW() - INTERVAL '1 hour'`) y
  las últimas 20 filas de `telemetry_fact`/`telemetry_fact_calc` (join a
  `dim_sensor`/`dim_tenant` por `sensor_id_sk`/`tenant_id_sk`, igual que
  `sensor_service.cpp`).

Forma de la respuesta:

```json
{
  "tenant_id": "...",
  "generated_at": "2026-08-30T04:35:00Z",
  "raw":  { "count_total": 12345, "count_last_hour": 890, "latest": [ {"sensor_code","sensor_type","value_numeric","captured_at"} ] },
  "calc": { "count_total": 0, "count_last_hour": 0, "latest": [ {"sensor_code","metric_code","value_numeric","alert_level","captured_at"} ] }
}
```

### 4. Frontend: `SimulationMonitor.tsx`

Panel nuevo bajo `frontend/src/components/Dashboard/`, siguiendo el patrón
de `AdvancedSensors.tsx` (ECharts vía `echarts-for-react`,
`fetchWithAuthRetry`, polling con `setInterval`) pero a **5s** en vez de los
15s de `AdvancedSensors.tsx` — la simulación se mueve más rápido que la
telemetría normal y el objetivo es observarla en vivo durante la ventana de
1 hora. Reutiliza los widgets de `widgets/SensorWidgets.tsx` en vez de
reinventar gauges/cards. Registrado en el enrutamiento/nav igual que el
resto de tabs de `MiningDashboard.tsx`/`App.tsx`.

## Consecuencias

- Hay, por primera vez, un lugar único donde una métrica calculada por
  lectura de sensor queda persistida con historial — antes sólo existían
  "KPI agregado de negocio" (`mining_runtime_kpis`) o "cálculo al vuelo sin
  persistir" (`formula_engine`).
- El backend gana un endpoint de sólo lectura, sin nueva superficie de
  escritura ni nuevo hilo de trabajo — riesgo operativo mínimo sobre
  `beemetry-api`, que sigue sirviendo tráfico real durante la simulación.
- `telemetry_fact_calc` queda vacía hasta que el script externo de
  simulación empiece a escribir en ella — el endpoint devuelve `calc.count_total=0`
  legítimamente hasta ese momento, no es un bug.
- No se tocó `thingsboard_sync.cpp`, `etl_sync_peer`, ni el contenedor
  `tb-sync-sim-1h` — están activos y fuera de alcance por decisión explícita.

## Trabajo pendiente (explícito, no asumido como hecho)

1. Si el cómputo de métricas se vuelve permanente (no sólo para esta
   simulación de 1h), decidir si migra al backend C++ (con las garantías de
   entrega que eso implica) o queda como script externo programado — ADR de
   seguimiento.
2. Catálogo `dim_metric` si el número de `metric_code` distintos crece lo
   suficiente para justificar dejar de ser texto libre.
3. Política de compresión/retención para `telemetry_fact_calc` si el volumen
   del script externo termina siendo mayor al esperado (mismo patrón que
   `75_telemetry_fact_compression_retention.sql`).

## Alternativas descartadas

- **Calcular las métricas dentro del backend C++ con un scheduler/thread
  propio**: descartada explícitamente para esta sesión — el usuario pidió
  mantener el cómputo en un script externo mientras dura este approach
  interino; añadir un hilo de cómputo agregado a `main.cpp` sin ese pedido
  habría sido alcance no autorizado sobre un proceso que sirve tráfico real.
- **Reusar `mining_runtime_kpis` para esto**: descartada — grano incompatible
  (KPI de negocio agregado por tenant/periodo, no por lectura de sensor).
- **Persistir el resultado de `formula_engine`/`sp_proceso_temperatura`
  directamente**: descartada — ese motor ya tiene su propio modelo
  (`telemetry_fact_formula`, sin retención, decisión de negocio distinta) y
  mezclar ambos habría reintroducido el problema que ADR-131 ya resolvió
  (modelos paralelos con semántica distinta compartiendo tabla).

## Referencias

- ADR-131 (consolidación del modelo de telemetría, `dim_*`/`telemetry_fact*`)
- ADR-034 (gestión de dispositivos, motor de alarmas)
- `db_scripts/74_telemetry_fact_dimensions.sql`
- `db_scripts/87_telemetry_fact_calc.sql`
- `backend/src/mining/sensor_service.cpp` (patrón de guard anti-IDOR y lectura por réplica reutilizado)
- `backend/src/mining/simulation_status_routes.cpp`/`.hpp`
- `frontend/src/components/Dashboard/SimulationMonitor.tsx`
