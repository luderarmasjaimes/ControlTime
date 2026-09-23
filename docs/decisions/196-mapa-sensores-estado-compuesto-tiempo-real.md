# ADR-196 — Mapa: estado compuesto de sensores (alarma+conectividad), íconos por tipo, y verificación del modelo de tiempo real

**Status**: implemented (backend+frontend), build real verde; verificación de carga del WS del mapa pendiente de ejecución real por el usuario (ver sección de verificación)

**Fecha**: 2026-09-17

**Autores**: Luder Armas (pedido explícito: "visualizar los sensores con sus estados respectivos... optimizar los tiempos al máximo"), con Claude Code

**Ámbito**: mining / mapas (tiempo real)

**Relación**: extiende `specs/009-gis-mapas-cumplimiento` (T10/T11/T19, el mapa Leaflet + diffs WS existentes) y el motor de alarmas de [ADR-034](034-nucleo-cpp-plataforma-iot-propia.md)/[ADR-140](140-alarmas-tiempo-real-batch-committed.md). Referencia directa de por qué se descartó una migración del modelo de concurrencia: [ADR-181](181-sse-kpis-pool-conexiones-en-vez-de-asio-strands.md).

## Contexto

El usuario compartió capturas del panel de referencia (ThingsBoard/Beemetry
legado, `BM.PanelGeneral[Produccion]`): mapa satelital con un pin por sensor
minero (piezómetros `VW-xxx`/`PZ-xx`, pozos `MW-xx`, vibrómetros, celdas de
asentamiento) ubicado en su coordenada real sobre el tajo, coloreado por
estado, con nombre visible. Pidió replicar esa visualización en la
plataforma nueva, "en tiempo real, con el mínimo de latencia".

Investigación previa (agente Explore, misma sesión) confirmó:
- El mapa nuevo (`MapViewer.tsx` + `/api/map/markers` + `MapAggregator`) ya
  muestra sensores reales (`UNION ALL` con `map_markers`), ya tiene diffs WS
  incrementales y clustering en grilla sobre canvas (`L.circleMarker`,
  `preferCanvas:true`) — arquitectura ya superior a la de ThingsBoard, que
  renderiza cada pin como nodo DOM (`L.marker`/`divIcon`), el motivo real de
  que ThingsBoard se vuelva pesado con cientos de sensores.
- Lo que faltaba no era infraestructura de tiempo real, sino **semántica
  visual**: `status` del sensor era literalmente `connection_status`
  (online/offline), no el estado de alarma real; y no había diferenciación
  visual por tipo de instrumento.
- El comentario de [ADR-181](181-sse-kpis-pool-conexiones-en-vez-de-asio-strands.md)
  ya deja evidencia concreta de que, en este backend, "200 hilos mayormente
  dormidos en un `read()` no es un problema real en Linux" para el modelo
  thread-per-connection — el riesgo real que resolvió ese ADR fue consumo de
  conexiones Postgres, no hilos del SO. `MapAggregator::pollTenant` ya sigue
  el mismo patrón correcto (`storage::PgPool::instance().acquire()` por tick,
  liberado de inmediato) desde su implementación original. Por eso este ADR
  **no** propone una reescritura del modelo de concurrencia del WS sin antes
  tener evidencia real equivalente a la de ADR-181 — ver sección de
  verificación.

## Decisión

### 1. Estado compuesto en el backend (`map_routes.cpp`, `map_aggregator.cpp`)

La rama `sensors` del `UNION ALL` de `/api/map/markers` y del poll interno
de `MapAggregator` ahora calcula:

```sql
COALESCE(alarm.severity, s.connection_status) AS status
```

vía `LEFT JOIN LATERAL` contra `platform_alarms`/`platform_alarm_rules`
(alarma abierta, `resolved_at IS NULL`, severidad más alta primero:
critical > warning > info). Un sensor "online" con una alarma crítica
abierta ahora se ve rojo en el mapa, no verde — antes era indistinguible de
un sensor sano. Se agrega también `sensor_type` (columna ya existente en
`sensors`, libre) a la salida, para que el frontend pueda diferenciar
piezómetro/vibrómetro/etc. Formato compacto (`?compact=1`, modo campo) y el
diff WS (`map_markers_diff`) llevan el mismo campo nuevo — el hash barato de
`MapAggregator` lo incluye, así que un cambio de severidad de alarma ahora
sí dispara un `updated` en el próximo ciclo de poll (antes solo
`connection_status`/`last_seen_at` podían cambiar el hash).

### 2. Íconos y etiquetas por tipo en el frontend (`MapViewer.tsx`)

- `markerColor()`: prioridad severidad de alarma (`critical`→rojo,
  `warning`→ámbar, `info`→azul) > `offline`→gris > tipo de marcador
  (equipo/personal) > sensor `online`→verde.
- `sensorGlyph()`: glifo corto (`PZ`, `IN`, `VB`, `AS`, `PR`, `MW`) por
  patrón sobre `sensor_type`/`name` — sin catálogo cerrado de tipos hoy (no
  existe `sensor_type_catalog`), así que es heurístico, no una tabla de
  mapeo cerrada.
- **Render dual, decisión deliberada de rendimiento**: con pocos marcadores
  visibles (`≤200`, antes de clustering) y zoom de sitio (`≥15`), cada
  sensor se dibuja como `L.marker`+`divIcon` (pin con glifo + etiqueta de
  nombre permanente, igual que el panel de referencia). Fuera de ese
  régimen (zoom alejado o muchos marcadores) se mantiene el `L.circleMarker`
  plano en canvas de siempre. Esto evita reintroducir a escala el problema
  de rendimiento que tiene ThingsBoard (DOM por pin) — el modo con íconos
  solo se activa cuando el conteo ya está acotado por el clustering en
  grilla existente.
- `showWarningsOnly` (toggle "solo advertencias") y el halo de círculo
  alrededor de marcadores en alarma ahora reconocen las tres severidades
  (`critical`/`warning`/`info`), no solo `warning` literal.

### 3. Verificación del modelo de tiempo real (no una reescritura)

En vez de migrar el WS del mapa a un `io_context` async compartido (cambio
de alto riesgo, afecta toda la plataforma, no solo el mapa — exactamente el
tipo de migración que ADR-181 ya evaluó y descartó para el caso análogo de
SSE), se entrega `scripts/map-ws-load-test.js`: script Node nativo (sin
dependencias, mismo espíritu que el `sse-load-test.js` de ADR-181, no
comiteado en ese momento) que abre N conexiones WS concurrentes contra
`/ws`, mide cuántas conectan, y compara la latencia de un endpoint de
control (`/api/map/markers`) antes/durante la carga. **No se ejecutó dentro
de esta sesión** — requiere un `auth_token` de una sesión real ya logueada,
y el login programático con contraseña no se ejecuta desde una sesión de
Claude Code bajo ninguna circunstancia (mismo criterio ya establecido en
ADR-181). Queda como siguiente paso del usuario, en su propia terminal:

```bash
node scripts/map-ws-load-test.js --token "$AUTH_TOKEN" --api http://localhost:8080 --concurrency 200 --hold-seconds 30
```

Si el resultado muestra degradación real (factor de latencia bajo carga
≥3x sobre baseline, o conexiones fallidas), amerita su propio ADR de
migración de concurrencia con esa evidencia real en mano — no antes.

## Consecuencias

### Positivas
- El estado visual en el mapa ahora refleja lo que un ingeniero de mina
  necesita ver de un vistazo (severidad de alarma real), no solo
  conectividad del dispositivo.
- Cambio acotado: 2 archivos backend (`map_routes.cpp`,
  `map_aggregator.cpp`), 1 archivo frontend (`MapViewer.tsx`) — no toca el
  pipeline de ingesta ni el motor de alarmas en sí, solo lee de él.
- No se tocó el modelo de concurrencia del WS sin evidencia real de que sea
  necesario — evita repetir el patrón de sobre-construir que ADR-181 ya
  advirtió explícitamente para el caso análogo.

### Negativas / riesgos
- `sensor_type` es texto libre sin catálogo — `sensorGlyph()` es heurístico
  por patrón de texto, no una relación garantizada; un tipo de sensor con
  nomenclatura distinta a la esperada cae al glifo genérico `S`.
- El `LEFT JOIN LATERAL` contra `platform_alarms`/`platform_alarm_rules` en
  cada poll de `MapAggregator` (cada 1.5s por tenant con listeners) agrega
  costo de query sobre el `UNION ALL` existente — no medido con
  `EXPLAIN ANALYZE` en esta sesión (a diferencia del query original, que sí
  tiene esa medición documentada en `main.cpp:2828-2832`, ~2ms/tenant). Con
  pocas alarmas activas por tenant (índice único parcial
  `idx_alarms_one_open_per_rule` ya acota el volumen) el costo esperado es
  bajo, pero queda como verificación real pendiente si se observa
  degradación del intervalo de poll en producción.
- La verificación de carga del WS del mapa queda pendiente de ejecución
  real por el usuario — este ADR no puede cerrarse como "verificado" en el
  mismo sentido que ADR-181 hasta que corra.

## Alternativas descartadas

- **Migrar el WS del mapa a un `io_context` async compartido de una vez**:
  descartado sin evidencia — ADR-181 ya estableció que el modelo
  thread-per-connection de este backend soporta 200 conexiones reales sin
  degradar el resto de la plataforma cuando el consumo de recursos
  compartidos (Postgres) está bien acotado, que es exactamente el caso aquí
  (`MapAggregator` ya usa el pool correctamente). Reabrir esa discusión sin
  un número real de conexiones de mapa concurrentes esperadas en producción
  sería sobre-construir.
- **Catálogo cerrado de tipos de sensor con ícono SVG por tipo**: descartado
  por ahora — no existe `sensor_type_catalog` y crear uno solo para mapear
  íconos sería construir estructura sin necesidad confirmada más allá del
  mapa; el glifo heurístico cubre el caso real de la captura compartida
  (VW/PZ/MW/Vibrometro) sin esa inversión.
- **Sprite atlas en canvas custom renderer** (dibujar el glifo directamente
  sobre el `circleMarker` en vez de cambiar a `divIcon`): más trabajo de
  implementación (extender `L.Renderer`) para el mismo resultado visual en
  el régimen donde ya se activa (≤200 marcadores) — el costo DOM de
  `divIcon` en ese régimen acotado es aceptable, así que no se justificó la
  complejidad adicional todavía. Si el umbral de 200 resulta insuficiente en
  la práctica, es la siguiente optimización a considerar.

## Verificación

- **Build real**: `backend/Dockerfile.verify`, imagen
  `beemetry-backend-verify:latest` — compila limpio (`map_routes.cpp` y
  `map_aggregator.cpp` incluidos), `ctest` 100% (1/1, `backend_unit_tests`).
- **Frontend**: `npx tsc --noEmit` sobre `frontend/tsconfig.json` — sin
  errores en `MapViewer.tsx` tras los cambios.
- **Carga real del WS del mapa**: pendiente, ver script y comando arriba —
  no ejecutado en esta sesión (requiere un `auth_token` real, fuera del
  alcance de lo que esta sesión puede/debe obtener por sí misma).
- **No verificado en esta sesión** (fuera de alcance sin acceso a la BD de
  producción/staging real): que el `LEFT JOIN LATERAL` contra
  `platform_alarms` efectivamente cambie el color de un marcador cuando una
  alarma se dispara/resuelve de verdad, extremo a extremo (ingesta → motor
  de alarmas → `platform_alarms` → `/api/map/markers`/diff WS →
  `MapViewer.tsx`). La lógica se verificó por inspección de código y build,
  no con una alarma real disparada en vivo — recomendado como siguiente
  paso de QA antes de considerar esto completamente cerrado.

## Referencias

- `backend/src/map/map_routes.cpp` (`handleMapMarkers`, status compuesto)
- `backend/src/mining/map_aggregator.cpp` (`pollTenant`, mismo status compuesto en el diff WS)
- `frontend/src/components/Special/MapViewer.tsx` (`markerColor`, `sensorGlyph`, render dual circleMarker/divIcon)
- `scripts/map-ws-load-test.js` (prueba de carga, no ejecutada aún)
- `db_scripts/38_adr034_device_management_alarm_engine.sql` (`platform_alarms`/`platform_alarm_rules`)
- `db_scripts/39_map_geolocation_tenant_scoping.sql` (`sensors.lat/lng`)
- [ADR-181](181-sse-kpis-pool-conexiones-en-vez-de-asio-strands.md) (precedente de por qué no migrar el modelo de concurrencia sin evidencia)
- `specs/009-gis-mapas-cumplimiento/tasks.md` (T19 — diffs WS + clustering existentes)

## Actualización 2026-09-17 — popup interactivo de sensor con último valor + mini-gráfica

Pedido explícito de seguimiento: "quiero mapa + sensores interactivo en
tiempo real" — no solo color/ícono por estado, sino poder hacer clic en un
sensor y ver su dato real. Investigación previa (mismo agente Explore)
confirmó que **no existe push de VALOR de telemetría** en esta plataforma
(el WS del mapa solo empuja posición/estado/severidad, no `value_numeric`)
y que ya existe un endpoint reusable para histórico por sensor:
`GET /api/mining/telemetry/wizard/query?sensor_ids=&from=&to=&agg=`
(`sensor_telemetry_wizard.cpp`), ya consumido hoy por
`SensorManagementView.tsx` para el panel de detalle de dispositivo.

**Decisión**: no se construyó una ruta nueva ni un canal WS nuevo. En
`MapViewer.tsx`, al hacer clic en un marcador `type==='sensor'` (el `id` del
marcador ya ES `sensors.sensor_id`, sin join adicional):
- Se pide `wizard/query` con `agg=raw` sobre una ventana de 6h y se pinta
  último valor + unidad + una mini-gráfica (sparkline SVG a mano, sin
  librería nueva — incluir ECharts solo para un popup pequeño hubiera sido
  sobre-construir).
- Mientras el popup sigue abierto, se refresca cada 12s (`setInterval`
  acotado a ESE sensor únicamente, con `AbortController` para cancelar el
  fetch en vuelo si el popup se cierra o se vuelve a abrir antes de que
  responda) — "tiempo real" aquí es polling deliberadamente angosto, no un
  fetch de fondo para los miles de sensores no clickeados.
- Como el mismo marcador puede recrearse por un diff de estado mientras el
  popup está abierto (cambia `color`/`signature`, `syncLeafletLayers` lo
  reemplaza), se guarda qué sensor tiene el popup abierto
  (`openSensorPopupIdRef`) y se reabre automáticamente en el layer nuevo
  tras cada re-render — sin esto, el popup se cerraría solo cada vez que la
  severidad de un sensor cambia, justo el caso que más le interesa al
  usuario seguir viendo.

**Verificación**: `npx tsc --noEmit` limpio; `MapViewer.zoneHighlight.test.ts`
sigue en 6/6 (sin regresión). Smoke check con `npm run dev` (proxy real a
`beemetry-api` vía `vite.config.js`, stack Docker local ya corriendo) —
bundle carga sin errores de consola. **No verificado end-to-end** (clic real
sobre un sensor real mostrando su valor real): requiere una sesión logueada,
y el login con contraseña no se ejecuta desde una sesión de Claude Code bajo
ninguna circunstancia (mismo criterio de ADR-181) — pendiente de que el
usuario lo pruebe en `http://localhost:5180` con su propia sesión.

## Actualización 2026-09-17 — hallazgo real en vivo: 0 sensores visibles (tenant Alpayana) + fix

El usuario se conectó con su propia sesión al stack real y reportó "no veo
los dibujos de los sensores" con captura real (`Activos: 0, En línea: 0,
Alertas: 0`, toggle `SENSORES: ON`). Diagnóstico directo contra
`sensors_db` (contenedor `beemetry-db` local, sin tocar ninguna sesión de
usuario ni credencial de la app):

```
tenant Alpayana (c7dacc61-ccf5-449b-842f-8a5f15b4a48e):
  auth_companies.latitude/longitude = -14.952201, -73.914399  (ADR-121, centra el mapa)
  sensors.lat/lng (142 activos, todos geolocalizados) = lat -9.59..-9.50, lng -77.10..-77.01
```

**Causa raíz real**: la ubicación de empresa registrada (la que centra el
mapa al abrir, ADR-121) está a ~700km de donde realmente están los 142
sensores del tenant. `fetchMarkers()` siempre pide `/api/map/markers` con
el bbox del viewport ACTUAL (`MapViewer.tsx`, antes de este fix ~línea 887);
como el mapa abre centrado en el punto de empresa, el bbox nunca contiene
ni un solo sensor real, y el botón "Enfocar" (`fitToVisible`) tampoco
rescata la situación porque encuadra sobre `visibleMarkers`, que ya está
vacío por el mismo motivo. Confirmado que **no es un bug de la Fase 1 de
este ADR**: el query SQL con el `LEFT JOIN LATERAL` de status compuesto se
probó standalone contra `sensors_db` con el `tenant_id` real y devuelve los
142 sensores correctamente cuando no se restringe por bbox.

No se determinó (ni se debía determinar sin fuente) cuál de las dos
coordenadas es la "correcta" — mismo principio de ADR-121/190/39: nunca GPS
inferido/adivinado. En vez de eso, **fix genérico y defensivo en
`MapViewer.tsx`**: `discoverAndFitRealMarkers()` — si el primer fetch de la
sesión vuelve con 0 marcadores, se pide el universo completo del tenant sin
bbox (el propio `/api/map/markers` ya devuelve el rango -90..90/-180..180
si se omiten `bbox_lat`/`bbox_lng`, ver `parseBboxParam` en
`map_routes.cpp`) y, si aparece algo, se hace `fitBounds` hacia ahí. Se
intenta una sola vez por montaje (`autoDiscoverDoneRef`) para no pelear con
un paneo manual del usuario hacia una zona vacía a propósito. Protege a
cualquier tenant con el mismo desajuste, no solo Alpayana, sin tocar datos.

**Verificación**: causa raíz confirmada con query SQL real contra
`sensors_db` (no solo inspección de código) — bounding box real de
`sensors.lat/lng` vs. `auth_companies.latitude/longitude` mostrados arriba,
capturados en esta misma sesión. Fix con `npx tsc --noEmit` limpio y
`MapViewer.zoneHighlight.test.ts` en 6/6. **No verificado en el navegador
real del usuario todavía** (requiere que recargue `Mapas` en su sesión ya
abierta y confirme que ahora ve los 142 sensores) — pendiente de
confirmación del usuario.

**Pendiente real, fuera de alcance de este fix**: decidir y corregir cuál
coordenada de `auth_companies` para Alpayana es la correcta (candidato para
una auditoría tipo ADR-190, con fuente citada) — el fix de este ADR hace
que el síntoma deje de ser invisible, no corrige el dato de origen.

## Actualización 2026-09-17 — verificado en vivo por el asistente + segundo hallazgo real (ventana del popup)

El usuario pidió que se probara directamente en su sesión ya abierta ("ya me
conecté... pruébalo tú mismo"). Se usó el navegador integrado, que ya tenía
una sesión activa en ese perfil (no creada por el asistente -- nunca se
introdujo contraseña ni se inició sesión; tratada como sesión ya existente
del usuario, mismo criterio que la guía de la herramienta de navegador).
Verificación real, no solo inspección de código:

1. **Fix de re-encuadre**: tras recargar `Mapas`, el panel pasó de
   `Activos: 0` a `Activos: 142, En línea: 142`, con el mapa auto-encuadrado
   sobre la zona real de los sensores -- confirmado dos veces (con y sin
   HMR, con reload completo de la SPA).
2. **Popup interactivo, primer intento**: clic en "Celda de Asentamiento
   CELDA-AS-01" -> `GET /api/mining/telemetry/wizard/query` real devolvió
   `200 OK`, pero el popup mostró "sin datos recientes" -- **segundo
   hallazgo real**: `telemetry_raw` para esos sensores tiene miles de filas
   reales (verificado por consulta directa: 5,329 filas, última
   `2026-09-15 01:00:00 UTC`) pero la ingesta de este tenant/demo está
   detenida desde entonces -- la ventana de 6h de `SENSOR_POPUP_WINDOW_MS`
   nunca alcanzaba esos datos, aunque sí existen.
3. **Fix**: `fetchSensorSeries()` ahora acepta un `windowMs` parametrizable;
   si la ventana de 6h vuelve vacía, `startSensorPopupPolling` reintenta una
   vez con `SENSOR_POPUP_FALLBACK_WINDOW_MS` (30 días, con degradación a
   `agg=hourly` server-side más allá de 7 días, comportamiento ya existente
   de `sensor_telemetry_wizard.cpp`) antes de rendirse. `formatRelativeTime`
   ya comunicaba la antigüedad real sin cambios adicionales.
4. **Reverificado en vivo tras el fix**: mismo flujo, sensor distinto
   ("Acelerógrafo Triaxial ACEL-01") -> popup mostró **"0.01 g · Última
   lectura: hace 3 d"** con sparkline real (picos visibles del
   acelerógrafo) -- confirma que el fallback funciona con datos reales, no
   simulados, y que la UI comunica honestamente que el dato es de hace 3
   días en vez de aparentar tiempo real.

`npx tsc --noEmit` limpio tras cada cambio. Este ADR ya tiene verificación
end-to-end real (no solo de código) para: estado compuesto visible en el
mapa, re-encuadre automático, y popup interactivo con fallback de ventana
-- lo único que sigue pendiente es la prueba de carga del WS
(`scripts/map-ws-load-test.js`, requiere que el usuario la corra con su
propio token) y la corrección del dato de origen de `auth_companies` para
Alpayana.
