# ADR-057 — Widgets de dashboard estilo ThingsBoard en Monitoreo → Sensores

**Status**: implemented (2026-07-19). Verificado E2E en vivo: gauge + donut
+ gráfico renderizando con datos reales del inclinómetro INC-TAJO-01 (mín
11.66° · prom 12.42° · máx 13.11° · último 12.53°).
**Fecha**: 2026-07-19
**Autores**: EC
**Ámbito**: realtime

> Primer ADR del ámbito `realtime` (componente de visualización de datos en
> tiempo real sobre el mismo backend, ver ADR-031) — reservado en el índice
> de `docs/decisions/README.md` desde el 2026-07-13 sin haber tenido ADR
> propio todavía.

## Contexto

Se analizó una instalación de referencia real de ThingsBoard
(`C:\thingsboard-master`, 522 `widget_types` del sistema + la librería
`ui-ngx`) para identificar qué familias de widgets tienen valor minero real
**y** cuentan con datos de respaldo ya disponibles en `/api/sensors/data` —
en vez de portar widgets genéricos sin verificar si el esquema `sensors`
real de la plataforma los puede alimentar con datos reales.

## Decisión

Se identificaron y portaron **tres** familias de widget como módulo
reutilizable `Dashboard/widgets/SensorWidgets.tsx`, integrado en la vista ya
existente Monitoreo → Sensores (`AdvancedSensors.tsx`) — no una vista nueva:

1. **Gauge radial con zonas** (equivalente a `analogue_radial_gauge` /
   `digital_speedometer` de ThingsBoard): lectura actual del sensor
   seleccionado con arco verde/ámbar/rojo. El esquema `sensors` todavía no
   tiene umbrales configurables por sensor, así que las zonas se derivan del
   rango observado en el propio historial de 7 días del sensor (verde
   <75%, ámbar <90% — mismo criterio por defecto que usa ThingsBoard).
2. **Tarjetas de agregación** (equivalente a value/aggregation cards):
   mínimo, promedio, máximo y último valor del historial del sensor, con su
   unidad real.
3. **Doughnut de distribución por estado**: sensores del ámbito visible
   agrupados online/warning/critical/offline, con el total al centro.

**Familias evaluadas y descartadas deliberadamente** por falta de datos de
respaldo reales en el esquema `sensors` (verificado contra la base de
datos, no supuesto): tanques de líquido, `battery_level`,
`signal_strength`/RSSI, gateway/edge. Regla aplicada: un widget sobre datos
inventados es peor que no tener el widget — se implementarán cuando la
telemetría real transporte esos campos. Por el mismo criterio,
`TelemetryDashboard` (spec 002, "Dashboards tiempo real") no se amplió con
estos widgets porque hoy corre sobre telemetría **simulada** (mock), no
sobre `/api/sensors/data` real.

Al preparar los datos de demo para verificar los widgets se encontró que
`mining_sensor_history` tenía su última muestra fechada 2026-04-15 — fuera
de la ventana de 7 días que usa el endpoint, por lo que el gráfico
"Historial reciente" ya existente llevaba meses mostrando "Sin historial"
en cualquier demo (y los widgets nuevos habrían nacido vacíos por el mismo
motivo, sin ser un bug de ellos). Se re-sembró la historia demo
desplazando las muestras a la ventana actual (+336 filas) para que la
demo sea representativa.

## Consecuencias

### Positivas
- Monitoreo → Sensores gana valor visual inmediato (gauge, agregación,
  distribución) sin depender de telemetría simulada ni de widgets con datos
  inventados.
- Al descartar explícitamente las familias sin datos de respaldo, queda
  documentado qué falta en el esquema `sensors` (battery_level,
  signal_strength, etc.) para ampliarlo a futuro, en vez de que la decisión
  de no implementarlas se pierda como contexto tácito de la sesión.
- Inaugura el ámbito `realtime` reservado desde ADR-031, dándole su primer
  ADR real en vez de quedar como una categoría vacía en el índice.

### Negativas / Trade-offs
- Los umbrales de zona del gauge (verde/ámbar/rojo) son heurísticos
  (rango observado en 7 días), no umbrales de negocio configurados por
  sensor — quedan sujetos a que el esquema `sensors` gane esa columna a
  futuro; hasta entonces, dos sensores con comportamiento normal muy
  distinto entre sí tendrán zonas de "normal" calculadas de forma
  independiente, lo cual es razonable pero no configurable hoy.
- `TelemetryDashboard` (spec 002) queda deliberadamente sin estos widgets
  mientras corra sobre datos simulados — una futura migración de esa vista
  a telemetría real debe revisar si extenderla con este mismo módulo.

## Alternativas descartadas

### Portar las ~10+ familias de widget más comunes de ThingsBoard sin filtrar por datos disponibles
Habría dado más variedad visual de entrada, pero varias de esas familias
(tanques de líquido, batería, señal) no tienen ningún dato real detrás en
el esquema actual — se habrían mostrado con valores inventados o vacíos,
lo cual es peor que no tener el widget. Se descarta por integridad de los
datos mostrados al usuario final (operador minero tomando decisiones).

### Crear una vista nueva de dashboard en vez de integrar en Monitoreo → Sensores
Habría fragmentado dónde el usuario espera ver el estado de sus sensores.
Se descarta: la vista `AdvancedSensors.tsx` ya es el lugar natural y
existente para esto.

## Referencias
- `frontend/src/components/Dashboard/widgets/SensorWidgets.tsx`
- `frontend/src/components/Dashboard/AdvancedSensors.tsx`
- `/api/sensors/data` (fuente de datos real de estos widgets)
- ADR-031 (backend = plataforma compartida — reserva original del ámbito
  `realtime`)
- specs/002-dashboards-tiempo-real (`TelemetryDashboard`, deliberadamente
  fuera de alcance de este ADR por correr sobre datos simulados)
