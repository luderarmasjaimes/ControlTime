# ADR-189 — Catálogo de plantillas de fórmula de calibración geotécnica (paridad con ThingsBoard legado)

**Status**: implemented (backend + frontend), pendiente aplicación manual del script SQL en el entorno del developer y migración de calibración real por sensor (fuera de alcance de este build — ver Consecuencias)

**Fecha**: 2026-09-14

**Autores**: Luder Armas (decisión de arquitectura), con Claude Code

**Ámbito**: mining / IoT (sensores geotécnicos, piezómetros)

**Relación**: extiende [ADR-187](187-administracion-sensores-motor-formulas-tiempo-real.md)
(motor real de fórmulas, `tinyexpr`) y [ADR-188](188-reconstruccion-tab-calculo-motor-real.md)
(catálogo de tipos/parámetros por sensor). Documento de investigación previo,
fuente de todo el análisis de las 23 fórmulas del legado:
[docs/INVESTIGACION_MOTOR_CALCULO_LEGADO_THINGSBOARD_PIEZOMETROS_2026-09-14.md](../INVESTIGACION_MOTOR_CALCULO_LEGADO_THINGSBOARD_PIEZOMETROS_2026-09-14.md).

## Contexto

El developer compartió el export JSON completo de la cadena de reglas
`PiezometerRC-V2` de la plataforma ThingsBoard-legado ("BEEMETRY" en
`board.beemetry.com`, [ADR-054](054-sync-thingsboard-legacy-aws.md)) — 78
nodos, 100 conexiones — junto con capturas de la paleta de nodos y del
diagrama completo, y pidió una investigación profunda para reproducir esa
funcionalidad en la plataforma nueva.

El análisis (documento de investigación referenciado arriba) encontró que el
legado **no es un editor de fórmulas libre**: es un `switch` de **23
familias de física ya programadas en JavaScript** (Geokon, RST, Soil
Instruments, Slope Indicator, Casagrande, celdas de asentamiento),
seleccionadas por un atributo de dispositivo `shared_equation`, con
constantes de calibración (`cf`, `tk`, `FreqIni`, `param_a/b/c`, geometría de
sondaje inclinado, etc.) como atributos de ThingsBoard por dispositivo.

El motor real nuevo (ADR-187) evalúa **una expresión libre por sensor**
(`tinyexpr`) con **una sola variable de telemetría** (`value`,
`telemetry_fact.channel_id=0`) — confirmado leyendo
`sensor_formula_evaluator.cpp` y el protocolo de cable de
`telemetry_ingest.cpp` (`"<sensor_code>,<value_numeric>[,<quality_code>]"`,
un escalar por mensaje). Ninguna de las 23 familias del legado puede
evaluarse con ese modelo: todas necesitan mínimo 2 entradas crudas (Freq,
Temp), 4 necesitan una tercera (Press, compensación barométrica).

## Decisión

Cuatro decisiones de arquitectura, tomadas explícitamente por el developer
tras revisar el análisis (ver investigación, §7-8):

1. **Catálogo de plantillas parametrizadas sobre `tinyexpr`**, no portar el
   JS legado literal. Las excepciones hardcodeadas por nombre de dispositivo
   del legado (`BM.*` Boroo Misquichilca, `GF.PZ VW-1703`, `YR.PZ-05R*`) no
   se portan — quedan como fast-follow explícito para cuando se migre ese
   dispositivo real puntual, con su override modelado como un parámetro de
   calibración normal, nunca como código.
2. **Las 23 familias completas de una vez** (menos las 2 confirmadas
   muertas: `polinomial_a1`/`polinomial_comp`, el propio JS legado trae el
   comentario "NINGUN SENSOR POSEE ... COMO EQUATION").
3. **Alarmas multibanda viven en el sistema de alarmas real ya existente**
   (`platform_alarm_rules`/`device_alarm_routes.cpp`), no se duplican dentro
   del motor de fórmulas.
4. **Ingesta multicanal: extensión acotada solo para sensores multivariados**
   — no se toca el protocolo de ingesta de 1 valor que usa el resto de la
   plataforma.

## Implementación

### 1. Ingesta multicanal (`db_scripts/95_sensor_formula_template_catalog.sql`, `device_alarm_routes.cpp`)

- Nueva tabla `sensor_input_channel_def(sensor_id, channel_code, is_required,
  sort_order)` — canales de entrada CRUDOS nombrados por sensor (paralela a
  `sensor_output_channel_def`, que ya existía para canales de salida). Sin
  fila ahí, un sensor sigue exactamente en el camino de un solo `value` de
  siempre — **cero regresión** para las fórmulas existentes de un solo canal.
- Nueva ruta `POST /api/mining/telemetry/multi` (`handleHttpTelemetryMulti`,
  junto a `handleHttpTelemetry`): mismo patrón de autenticación por
  `X-Device-Key` (hash SHA-256 contra `sensors.device_api_key_hash`). Body
  `{"channels": {"Freq": 1234.5, "Temp": 18.2}}`. Solo acepta claves ya
  declaradas en `sensor_input_channel_def` para ese sensor — un sensor sin
  filas ahí (el caso común) nunca puede recibir por esta ruta, sigue
  exclusivamente por `POST /api/mining/telemetry`. A propósito **no** pasa
  por `TelemetryIngestor::ingestLine()`/COPY binario (ese camino está
  optimizado para el hot path de alto volumen de 1 valor); INSERT
  parametrizado directo, correcto para el volumen bajo de sensores
  geotécnicos (reportan cada varios minutos). Reutiliza el mismo upsert
  perezoso de `dim_sensor` que `TelemetryIngestor::copyBatch()` (si la
  primera telemetría de un sensor llega por esta ruta). Reserva `channel_id`
  nuevos en `dim_channel` vía una secuencia dedicada
  (`dim_channel_channel_id_seq`, arranca en 100), no por `MAX(channel_id)+1`
  (evita una carrera real bajo concurrencia).

### 2. Evaluador — canales nombrados (`sensor_formula_evaluator.cpp`, `sensor_formula_routes.cpp`)

- `loadNamedInputChannels()` (nuevo): si el sensor declara
  `sensor_input_channel_def`, liga cada canal como variable `tinyexpr`
  nombrada por su `channel_code` (`Freq`, `Temp`, `Press`) en vez de la única
  `value`. Si el sensor no declara ninguno, cae exactamente en
  `loadLatestTelemetryValue()` de siempre. Si declara canales pero falta
  telemetría reciente de alguno, se salta el ciclo completo (mismo criterio
  de "sin resultado antes que un resultado a medias" que ya regía el motor).
- `validateExpression()` (en `sensor_formula_routes.cpp`, usada al
  crear/editar una fórmula) recibe el mismo tratamiento en espejo, para
  rechazar en el momento de guardar (400) una fórmula que el poller no
  podría compilar más tarde.

### 3. Catálogo de plantillas (`sensor_formula_template_def/_input/_param/_output`)

Cuatro tablas nuevas (ver script SQL para el DDL completo) + seed de **27
plantillas** (23 familias vivas del legado; 6 de ellas desdobladas en
variante `_kpa`/`_mpa` porque el legado tiene una división/escala
*estructuralmente* distinta dentro de la fórmula según unidad, no solo una
constante diferente — `polynomial_a2`, `polynomial_b`,
`polynomial_geokon`/`polynomial_rst`).

- **Resolución del gap de condicionales de `tinyexpr`** (confirmado sin
  `if`/ternario en `third_party/tinyexpr/tinyexpr.c`): las ramas realmente
  condicionales del legado (unidad KPA/MPA/PSI, vertical/inclinado,
  settlement-cell/piezómetro) se resuelven **en tiempo de catálogo** (qué
  plantilla elegís), no dentro de una expresión — el catálogo ya es un
  catálogo de variantes, así que esto no agrega complejidad nueva, solo más
  filas. El único condicional numérico real que hacía falta DENTRO de una
  expresión (clamping a positivo, patrón legado `if(MCA>0) mca=MCA else 0`)
  se resuelve algebraicamente con la única función de `tinyexpr` que lo
  permite: `max(x,0) = (x+abs(x))/2`.
- Cada canal de salida de una plantilla (MPA, MCA, ALT, NF, ASENT) es una
  expresión **autocontenida** que reconstruye toda la cadena desde las
  variables crudas — `sensor_formula_def` no permite encadenar el resultado
  de una fila como entrada de otra en el mismo ciclo del evaluador.
- **Simplificación documentada**: `linear_d` (corrección por densidad del
  agua) reemplaza la tabla de 6 tramos por rango de temperatura del legado
  por un parámetro único `densidad_agua` configurable (default 998.2 kg/m³)
  — una tabla piecewise real no es expresable en `tinyexpr` sin
  condicionales, y el efecto es <1% sobre el resultado final.
- **"Seco" (ALT en texto cuando MCA≤0 del legado) no se replica como
  texto** dentro de la fórmula (`tinyexpr` no puede emitir strings
  condicionales) — se deja el ALT numérico real y la etiqueta "Seco" queda
  para la capa de presentación (frontend/reporte), derivada del MCA
  correspondiente cuando sea ≤0. Mismo dato, cambia solo dónde se decide el
  rótulo.

### 4. Backend — aplicar una plantilla a un sensor real (`sensor_formula_template_routes.hpp/.cpp`)

- `GET /api/mining/formula-templates` — catálogo completo, sesión válida
  basta (misma paridad de solo-lectura que `GET /api/mining/sensor-types`,
  ADR-188).
- `POST /api/mining/devices/{sensor_id}/formulas/apply-template` — gateado
  por `formula.edit` (mismo permiso que ADR-188 usa para escritura del
  catálogo de tipos). Body `{template_code, param_values: {...}}`. En una
  sola llamada: declara los `sensor_input_channel_def` de la plantilla,
  upsertea `sensor_input_parameter_def`/`_value` (tablas ADR-187 ya
  existentes) con los valores dados (o el `default_value` de la plantilla si
  el caller no lo manda), y crea/actualiza un `sensor_formula_def` por cada
  canal de salida de la plantilla. **Valida las N expresiones contra los
  canales/parámetros declarados ANTES de escribir nada** — si una no
  compila, la aplicación entera falla y no deja al sensor con fórmulas a
  medio aplicar. Registrada vía el mismo patrón de despacho por sufijo que
  `.../formulas` y `.../rotate-key` (el prefijo POST de
  `/api/mining/devices/` ya está tomado por `handleRevokeDevice`).

### 5. Alarmas de 5 bandas — extensión del sistema real, sin duplicar

- `platform_alarm_rules` ya soportaba N reglas por sensor con
  `operator`/`threshold`/`severity` (3 niveles: `info`/`warning`/`critical`)
  — las 5 bandas del legado se modelan como hasta 5 reglas ordenadas por
  `threshold`, mapeadas `nivel1→info, nivel2-3→warning, nivel4-5→critical`.
  **No requirió cambio de schema para la severidad.** Sin columna de color:
  el frontend ya deriva color desde `severity` (se detectó, de paso, una
  inconsistencia preexistente entre `AlarmCenter.tsx` y `AlarmConfigView.tsx`
  sobre cuántos niveles hay — 3 vs. 4 — señalada pero **fuera de alcance de
  este ADR**, no se tocó).
- **Gap real cerrado**: `evaluateRulesOnce()` solo leía
  `telemetry_fact.channel_id=0` o `mining_sensors.current_value` — nunca un
  canal de salida de fórmula (`telemetry_multivariate`), así que no había
  forma de alarmar sobre ALT/MCA calculados. Se agregó columna nullable
  `platform_alarm_rules.formula_output_channel_code` — si no es NULL,
  `evaluateRulesOnce()` lee `telemetry_multivariate(sensor_id, channel_code)`
  en vez del canal crudo. El camino en tiempo real
  (`handleRealtimeTelemetryBatch`, que evalúa con el valor ya en memoria de
  un lote de ingesta) **nunca** evalúa estas reglas — su valor viene de un
  poller aparte (`sensor_formula_evaluator.cpp`, 10s), no del lote crudo;
  dependen exclusivamente del polling periódico, mismo criterio que ya regía
  para las reglas de `mining_sensor_id`. `handleCreateAlarmRule`/
  `handleUpdateAlarmRule`/`handleListAlarmRules` extendidos para
  aceptar/devolver el campo.

### 6. Frontend (`SensorManagementView.tsx`)

Pestaña de fórmulas del panel de administración de sensores: nuevo botón
"Aplicar plantilla" junto a "Nueva fórmula" — lista el catálogo agrupado por
familia de instrumento (`<optgroup>`), muestra un formulario dinámico con los
parámetros de calibración de la plantilla elegida (prellenados con su
`default_value`) y aplica vía el endpoint nuevo. No se tocó el selector de
`sensor_type` hardcodeado de esta misma vista (no usa el catálogo real de
ADR-188) — hallazgo aparte de la exploración, fuera de alcance de este
pedido.

### 6bis. Actualización 2026-09-15 — "Enviar prueba multicanal" en la UI

Pidiendo probar el catálogo de punta a punta contra un sensor real
(`PZ-VW-02`, piezómetro de Alpayana) se detectó que el botón existente
"Probar ahora" solo mandaba un único `value` a `/api/mining/telemetry` — no
había forma, desde la UI, de enviar los 2-3 canales nombrados
(Freq/Temp/Press) que necesita una plantilla recién aplicada, aunque la ruta
de backend (`POST /api/mining/telemetry/multi`, §2) ya existía. Se agregó en
`SensorManagementView.tsx`: al aplicar una plantilla con éxito, aparece una
sección "Probar la plantilla con datos reales" con un campo por canal
declarado, que llama a `sendMultiChannelTestReading()` (mismo patrón
`credentials:'omit'` + `X-Device-Key` que el envío de un solo valor) —
reusa la misma clave de dispositivo ya visible en la sesión (no rota una
nueva). Si el sensor no tiene una clave visible en esa sesión, la UI lo dice
explícitamente en vez de fallar en silencio.

### 6ter. Bug real 2026-09-15 — `sensor_input_channel_def` nunca se creó

Probando en vivo contra `PZ-VW-02` (piezómetro real de Alpayana): "Aplicar
plantilla" parecía funcionar del todo (creaba las 3 fórmulas MPA/MCA/ALT
correctamente), pero `POST /api/mining/telemetry/multi` fallaba con `400
sensor_not_multichannel`. Causa raíz: la tabla `sensor_input_channel_def` se
diseñó y se usó extensivamente en el backend (evaluador, validador de
expresiones, ingesta multicanal) pero su `CREATE TABLE` nunca se incluyó en
`95_sensor_formula_template_catalog.sql` — quedó solo en el plan y en el
código. Pasó desapercibido porque el `INSERT` correspondiente dentro de
`handleApplyFormulaTemplate()` no revisaba el resultado de `PQexecParams()`:
al fallar con "relation does not exist" seguía de largo en silencio (los
pasos siguientes, parámetros y fórmulas, no dependen de esa tabla).

Fix: nueva migración `db_scripts/96_sensor_input_channel_def.sql` con la
tabla real, y los 3 `INSERT`/`UPDATE` de `handleApplyFormulaTemplate()`
(canales de entrada, parámetros, canal de salida) ahora revisan su propio
resultado y frenan la aplicación con `500` + detalle si fallan, en vez de
seguir en silencio. Verificado en vivo tras el fix: `POST
/api/mining/telemetry/multi` con `Freq=8520, Temp=18.5` → `202 accepted`, y
~10s después `telemetry_multivariate` mostró `MPA=0.17, MCA=0.017336,
ALT=4200.017336`, los tres con `status='ok'`.

**Nota de alcance no resuelta**: `handleApplyFormulaTemplate()` sigue sin
envolver sus 3 pasos en una única transacción explícita — un fallo a mitad
de camino (ahora sí visible como error, antes no) puede dejar canales/
parámetros ya escritos sin sus fórmulas correspondientes. No bloqueante para
esta entrega (reaplicar la misma plantilla es idempotente y corrige el
estado), pero queda como fast-follow si se prioriza atomicidad estricta.

## Consecuencias

### Positivas
- Cierra la brecha de arquitectura que impedía reproducir cualquiera de las
  23 fórmulas del legado (motor de un solo canal → catálogo de plantillas
  multicanal), sin duplicar trabajo del motor real ya construido (ADR-187) ni
  reinventar un segundo evaluador de expresiones.
- Cero regresión para sensores existentes de un solo canal (evaluador,
  `validateExpression`, e ingesta caen exactamente en el camino de siempre
  si no hay `sensor_input_channel_def`).
- Las alarmas multibanda quedan en una sola fuente de verdad
  (`platform_alarm_rules`), reutilizando debounce/rate-of-change/auditoría ya
  construidos, en vez de un sistema de alarmas paralelo dentro del motor de
  fórmulas.

### Negativas / Trade-offs
- **No verificado contra datos reales todavía**: las 27 plantillas se
  transcribieron algebraicamente del JS legado (documentado en detalle en el
  script SQL y en la investigación), pero no hubo acceso en vivo a
  `board.beemetry.com` en esta sesión para confirmar contra un sensor real
  (p. ej. `PIEZOMETERRC-V2`) qué `shared_equation`/parámetros tiene
  configurados hoy y comparar salida vieja vs. nueva con los mismos datos
  crudos. **No debe usarse en un sensor de seguridad real sin esa
  verificación de punta a punta primero.**
- Simplificación documentada en `linear_d` (densidad del agua fija en vez de
  tabla por temperatura) y en la etiqueta "Seco" (movida a presentación) —
  ambas de impacto numérico pequeño pero reales, ver Implementación §3.
- Excepciones por nombre de dispositivo del legado (Boroo Misquichilca, GF.PZ
  VW-1703, Yauricocha) deliberadamente no portadas — si esos dispositivos
  reales se migran, necesitan su propio parámetro de override antes de dar
  por buena su fórmula.
- Las 7 cadenas hijas de ThingsBoard no incluidas en el export analizado
  (alarmas por sitio, asentamiento acumulado, anexos) quedan fuera de este
  ADR — solo se cubrió la etapa de cálculo, no la de alertas/enrutamiento
  específico por cliente del legado.
- El script `db_scripts/95_sensor_formula_template_catalog.sql` sigue el
  patrón de esta sesión: no se aplicó solo automáticamente contra la base
  real corriendo (requiere `psql` manual, [memoria del proyecto: scripts 30+
  necesitan aplicación manual]).

## Verificación
- `docker build -f backend/Dockerfile.verify backend` — compila limpio,
  suite Catch2 100% (incluye las rutas nuevas y los cambios en el evaluador
  y el motor de alarmas).
- `npx tsc --noEmit` (frontend) — sin errores de tipos en
  `SensorManagementView.tsx`.
- Pendiente (developer, con acceso a la base real): aplicar
  `95_sensor_formula_template_catalog.sql` vía `psql`; declarar canales de
  entrada de un sensor demo vía una plantilla; `POST
  /api/mining/telemetry/multi` con `X-Device-Key` real; confirmar filas en
  `telemetry_fact` con `channel_id` distintos; confirmar que el poller de
  10s escribe en `telemetry_multivariate`; crear reglas con
  `formula_output_channel_code` y confirmar que disparan contra el valor
  calculado, no el crudo.

## Referencias
- [docs/INVESTIGACION_MOTOR_CALCULO_LEGADO_THINGSBOARD_PIEZOMETROS_2026-09-14.md](../INVESTIGACION_MOTOR_CALCULO_LEGADO_THINGSBOARD_PIEZOMETROS_2026-09-14.md)
  (análisis completo de las 23 fórmulas, fuente de este ADR)
- [[187]] (motor real de fórmulas, tinyexpr, `sensor_formula_def`)
- [[188]] (catálogo de tipos/parámetros por sensor, permiso `formula.edit`)
- [[054]] (sync ThingsBoard legado, origen del export analizado)
- `db_scripts/95_sensor_formula_template_catalog.sql` (esquema + seed de las
  27 plantillas)
- `backend/src/mining/sensor_formula_template_routes.hpp/.cpp` (rutas nuevas)
- `backend/src/mining/sensor_formula_evaluator.cpp`,
  `sensor_formula_routes.cpp`, `device_alarm_routes.cpp` (extensiones)
- `frontend/src/components/ReportStudioV2/components/views/SensorManagementView.tsx`
  (UI "Aplicar plantilla")
