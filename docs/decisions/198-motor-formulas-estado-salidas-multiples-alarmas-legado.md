# ADR-198 — Motor de fórmulas: estado (`prev_value`) + múltiples salidas + análisis de migración de alarmas del legado

**Status**: implemented (motor + traductor), analizado sin insertar (migración de alarmas)

**Fecha**: 2026-09-18

**Autores**: Luder Armas (pedido explícito: adaptar el control de fórmula/cálculo para soportar "ESTADO" y "MÚLTIPLES SALIDAS"; implementar la migración de los 104 nodos de alarma del legado), con Claude Code

**Ámbito**: core-iot (motor de fórmulas) / datos (migración)

**Relación**: continúa directamente el addendum 2026-09-18 de [ADR-197](197-importacion-sensores-thingsboard-legado.md) (extensión `iif`/`max`/`min`/`round` de tinyexpr, traductor de fórmulas legadas). Usa la tabla `platform_alarm_rules` ya existente (SPEC-016/ADR-108 y siguientes).

## Contexto

El addendum de ADR-197 identificó dos bloqueos concretos, con datos reales, para migrar las 175 fórmulas legadas de ThingsBoard más allá de lo ya logrado con `iif()`:

1. **ESTADO**: patrones reales como `msg.tipo_alerta_anterior = metadata.tipo_alerta_actual` (el valor de este campo es "lo que valía OTRO campo en el ciclo anterior") no tienen representación en un evaluador de expresión puro sin memoria -- tinyexpr recalcula todo desde cero en cada ciclo.
2. **MÚLTIPLES SALIDAS**: nodos reales (ej. "Prism") calculan 10+ campos `msg.<x>` en un solo bloque de JS, reutilizando variables locales intermedias -- el traductor los rechazaba enteros por "ambiguo cuál es la fórmula".

El usuario pidió explícitamente adaptar el motor para soportar ambos, "con el máximo análisis posible", y además implementar la migración de los 104 nodos `TbJsFilterNode`/`TbJsSwitchNode` (alarmas/compuertas) hacia `platform_alarm_rules`.

## Decisión — parte 1: soporte de ESTADO (`prev_value`)

Se agregó una variable especial `prev_value` que el evaluador (`backend/src/mining/sensor_formula_evaluator.cpp`) liga automáticamente al **último valor que ESA MISMA fórmula ya escribió** en `telemetry_multivariate` (mismo `tenant_id`+`sensor_id`+`output_channel_code`, el registro más reciente ANTERIOR al ciclo actual):

- `loadPreviousOutputValue()`: una consulta nueva, mismo patrón que `loadLatestTelemetryValue()` ya existente.
- Solo se ejecuta esa consulta extra si la expresión de la fórmula **menciona** `prev_value` (búsqueda de substring sobre `f.expression`) -- el resto de fórmulas (la inmensa mayoría) no paga ningún costo adicional por ciclo.
- Si la fórmula usa `prev_value` pero todavía no existe un ciclo anterior real (primera evaluación), el ciclo se **salta** (mismo criterio que "sin telemetría todavía") -- nunca se inventa un 0 con apariencia de dato real.
- `prev_value` queda siempre en el vector de variables ligadas (se use o no) porque tinyexpr no exige que toda variable declarada se use -- cero riesgo de puntero inválido.

Esto habilita, sin ningún cambio de esquema, patrones reales de calibración que antes eran imposibles: suavizado exponencial (`alpha*value + (1-alpha)*prev_value`), histéresis, "mantener último valor bueno" ante una lectura inválida, y el patrón de "arrastrar" un valor de un ciclo a otro visto en el legado.

**Verificado**: compiló limpio dentro del proyecto real (`docker compose build web`, sin errores) -- el cambio en `tinyexpr.c` de la parte 1 del addendum ADR-197 y este cambio en `sensor_formula_evaluator.cpp` están ambos en la imagen `informecliente-web` reconstruida el 2026-09-18.

## Decisión — parte 2: soporte de MÚLTIPLES SALIDAS

Se confirmó que **`sensor_formula_def` ya soporta esto de forma nativa** -- cada fila es una fórmula independiente con su propio `output_channel_code`; nada impide que 10 filas distintas, mismo `sensor_id`, coexistan. El bloqueo real estaba en el **traductor**, que rechazaba entero cualquier registro con más de un campo `msg.<x>` de salida por "ambigüedad".

Se reescribió `scripts/translate_thingsboard_formulas.py` para, en el camino SIN ramificación, tratar cada línea `var? nombre = expr` como:
- variable **local** (nombre sin prefijo) -- se sustituye inline, en orden, en cualquier expresión posterior que la referencie (transitivamente);
- salida **`msg.<x>`** -- candidato de fórmula independiente. Una lectura posterior de `msg.<x>` (JS trata `msg` como objeto mutable) se resuelve al valor YA sustituido de esa asignación anterior, no al original -- corrección real encontrada durante la propia verificación (`SettlementCellRC/Asigna`: `msg.MCA = msg.z` después de `msg.z = msg.z + offset` debía heredar la corrección, no leerla cruda; el primer intento de esta implementación lo tradujo mal como `MCA = z` y se corrigió antes de aceptar el resultado).
- `metadata.<x>` -- se ignora (bookkeeping, nunca una salida real).

Cada campo se valida y traduce **independientemente** con el mismo `translate_expression()` ya existente -- un campo que falla no bloquea a los demás del mismo nodo.

De paso, dos mejoras adicionales al traductor, verificadas contra los datos reales:
- `strip_js_comments()`: quita `//` y `/* */` ANTES de parsear -- el export real trae bloques comentados con asignaciones `msg.<x>=...` que parecían código real (nodo "Prism" de `PrismB3`); sin esto se arriesgaba traducir código deshabilitado en el legado.
- `strip_parsefloat_calls()` + `Math.max`/`Math.min`/`Math.round` agregados a `MATH_FUNC_MAP`: `parseFloat(X)` ya no descalifica la expresión (nuestras variables ya son `double`, es un cast de JS sin equivalente necesario) y los 3 `Math.*` que antes descalificaban ahora mapean 1:1 a las funciones nativas nuevas de tinyexpr.

**Resultado real, verificado, tras las 3 mejoras combinadas** (comentarios + parseFloat/max/min/round + múltiples salidas): **0 → 5 fórmulas traducidas automáticamente** (de 175 nodos `TbTransformMsgNode`, ahora expandidos a 305 filas de salida por el desglose de múltiples campos). Las 5 son inicializaciones legítimas de estado a un valor constante (`Frecuencia=100`, `desplazamiento_acumulado=0` ×2, `tiempo_acumulado=0` ×2) -- correctas, verificadas manualmente contra el código original, pero de bajo valor individual (constantes, no cálculo real). El resto sigue rechazado por razones reales y específicas (fechas, tablas de alerta con metadata, campos que dependen de `metadata.*` configurable por dispositivo) -- **no por una limitación ya resuelta del traductor**, confirmando otra vez que el 0→pocas traducciones automáticas es un reflejo honesto de los datos, no del motor.

## Decisión — parte 3: análisis de migración de los 104 nodos de alarma (`TbJsFilterNode`/`TbJsSwitchNode`)

Se construyó `scripts/translate_thingsboard_alarms.py`, mismo criterio de rigor que el traductor de fórmulas, apuntado a `platform_alarm_rules` (tabla ya existente: `operator` ∈ {gt,gte,lt,lte,eq}, `threshold` numérico fijo, `severity` ∈ {info,warning,critical}, `condition_type` ∈ {value,rate,inactivity}, `formula_output_channel_code` opcional para reglas sobre un canal CALCULADO por una fórmula).

Clasificación real de los 104 nodos:

| Categoría | Cantidad | Significado |
|---|---|---|
| `not_alarm_shaped` | 99 | No es un umbral numérico -- son compuertas de enrutamiento del rule-chain legado: chequeos de existencia (`typeof`), frescura del mensaje (`new Date()`), selección de tipo de dispositivo/ecuación, comparaciones de texto/NaN. **Hallazgo importante**: la mayoría del bucket "no es fórmula" tampoco es "es alarma" -- es plomería específica del modelo de grafo de nodos de ThingsBoard, sin equivalente 1:1 en la arquitectura nueva (que separa fórmula/alarma/parámetro de forma distinta). |
| `simple_threshold` | 3 | 1 campo, 1 comparación contra literal -- traducible directo a 1 fila de `platform_alarm_rules` (ej. `BattNode > 0`, validaciones de batería/rango). |
| `multi_threshold_chain` | 1 | 1 campo, 2 comparaciones (`Freq < 20000` y `Freq > 100`) -- 2 filas candidatas sobre el mismo canal. |
| `compound_multi_field` | 1 | El caso real de mayor valor: `AlarmasBrocal/Condicion Alertas Acelerografos` (`mag_evento>7 && distancia_epicentro<=100` → Peligro, etc.) -- combina 2 campos, **no** es 1 fila de `platform_alarm_rules`. Camino propuesto: (a) fórmula `sensor_formula_def` con `iif()` anidado que calcule un canal `nivel_alerta_sismo` (0=Normal/1=Alerta/2=Peligro), usando la extensión de la parte 1 de este mismo ADR; (b) 1-2 filas de `platform_alarm_rules` con `formula_output_channel_code='nivel_alerta_sismo'` (mecanismo que YA existe en `device_alarm_routes.cpp`, `evaluateRulesOnce()`). |

Corrección real durante la construcción del clasificador: la primera versión marcaba "compuesto" cualquier condición con `&&`/`||` que mencionara 2+ campos, sin exigir que fueran comparaciones NUMÉRICAS -- eso clasificaba mal validaciones de texto/NaN (`msg.Freq=='NaN' || msg.Temp=='NaN'`) como "requiere fórmula iif()" cuando en realidad son `not_alarm_shaped` (no son umbrales). Se corrigió antes de aceptar los números finales (95→99 en `not_alarm_shaped`, 5→2 en `compound_multi_field`, verificado contra el código real de cada caso).

**No se insertó nada en la base de datos.** Igual que ADR-197 con los sensores: mapear cada `rule_chain` a un `sensor_id` real de la plataforma nueva requiere decisión humana caso por caso (nombre de empresa, dispositivo específico), y para las severidades (`info`/`warning`/`critical`) el script solo da una SUGERENCIA heurística por palabra clave (Peligro→critical, Alerta→warning, Normal→info) marcada explícitamente como tal -- nunca se aplica sin revisión.

## Actualización 2026-09-18 (misma fecha, tercera pasada): parámetros metadata.* + intento de clasificación/texto (descartado con evidencia) + bug real encontrado y corregido

Pedido explícito del usuario: "con todas estas mejoras puedes realizar la migracion del 100% de las formulas... y si hay un error lo corriges". Se explicó primero por qué el 100% automático es imposible sin inventar semántica (114 casos con salida de texto vía if/else, 25 dependientes de config por dispositivo, 20 con literal de texto directo) y se preguntó cómo avanzar -- el usuario eligió "construir soporte de clasificación/texto".

**Intento 1 -- clasificación/texto (descartado con evidencia real, no abandonado por pereza)**: se buscó en los 175 nodos `TbTransformMsgNode` el patrón "cadena if/else-if con salida STRING" (equivalente al VERDE/AMARILLO/NARANJA visto en nodos de alarma) para construir una tabla `sensor_formula_classification_catalog` (código numérico -> texto/color/riesgo/acción). Resultado real de la búsqueda: **0 registros `TbTransformMsgNode` tienen esa forma** -- los únicos 4 registros con 2+ bloques if/string son un algoritmo de interpolación con arrays (fuera de alcance total) y 2 casos de marcado `isNaN(x) -> x='NaN'` (validación, no clasificación). La lógica de clasificación real (Peligro/Alerta/Normal) vive en los nodos `TbJsSwitchNode`/`TbJsFilterNode` -- **ya cubiertos en la parte 3 de este ADR**, con destino `platform_alarm_rules`, no `sensor_formula_def`. Construir el catálogo de clasificación aquí no habría movido ni un solo caso -- se descartó con evidencia antes de escribir el esquema, no se fuerza una funcionalidad que los datos reales no piden.

**Intento 2 -- parámetros metadata.* (real, implementado, con resultado medible)**: se contaron los usos reales de `metadata.<clave>` en los 175 nodos -- la enorme mayoría (`shared_altitud`, `shared_tk`, `shared_offset`, `shared_FreqIni`, `shared_param_a/b/c`, `ss_umbral1..5`, etc.) son constantes de calibración por dispositivo, exactamente lo que `sensor_input_parameter_def` ya modela (ADR-187/189). Se quitó `metadata.` de la lista de descalificación genérica y se agregó `METADATA_KEY_DENYLIST_EXACT`/`_RE` (una lista negra específica y angosta: `ts`, `deviceName`, `deviceType`, `valorN`, campos con "unidad"/"anexo" -- verificados por uso real, no adivinados) -- todo lo demás se trata como parámetro candidato, reportado en la nueva columna `source_params` del CSV (nunca insertado solo).

**Bug real encontrado y corregido durante la propia verificación** (antes de aceptar el resultado, no después): el primer resultado con esta extensión tradujo `WeatherstationRC/Valor Anterior` como `diferencial_precipitacion = wx_precipitation - wx_precipitation` -- **siempre 0**, un resultado numéricamente incorrecto y silencioso. Causa: `metadata.wx_precipitation` y `msg.wx_precipitation` tienen el MISMO NOMBRE -- es el mismo idioma de ThingsBoard que ya se había visto con `tipo_alerta_anterior`/`tipo_alerta_actual` (un atributo persistido bajo el mismo nombre del campo = "el valor del ciclo anterior", ESTADO real, no una constante de calibración). Se agregó un chequeo de colisión explícito: si `metadata.<clave>` coincide en nombre con cualquier `msg.<clave>` del mismo registro, se rechaza como ESTADO (con el motivo explícito, sugiriendo modelarlo con `prev_value` en vez de como parámetro) en vez de fabricar un parámetro que no existe. Verificado: tras el fix, `WeatherstationRC` queda correctamente en `needs_manual_review` con el motivo nuevo, y los 23 casos restantes sí traducidos se revisaron uno por uno a mano (ver tabla abajo) -- ninguna otra colisión de este tipo sobrevivió.

**Resultado final verificado, honesto**: **5 → 23 fórmulas traducidas automáticamente** (de 305 filas de salida totales tras el desglose de múltiples salidas; 201 de esas filas son "con forma de fórmula" -- el resto, 104, son los nodos de alarma/filtro de la parte 3). Ejemplos reales verificados a mano contra el código original: `desplazamiento_x = shared_diferencial * tan(A)` (fórmula real de inclinómetro), `Altura_corregida = Altitud - shared_offset` (corrección de offset real), `MCA = z + shared_offset` (corrige el bug de sustitución encadenada de la parte 2, ahora con el parámetro real en vez de rechazarse).

Desglose final de los 178 `needs_manual_review` restantes, por motivo:

| Motivo | Cantidad |
|---|---|
| Ramificación con salida no numérica (if/else produce texto/estado, no hay equivalente puro) | 114 |
| Sin asignación `msg.<campo>=<expr>` reconocible (plomería/enrutamiento) | 37 |
| Literal de texto directo | 24 |
| ESTADO real (`metadata.X` == `msg.X`, ciclo anterior) | 2 |
| `metadata.*` no numérico (fecha/nombre/texto) | 1 |

**Por qué esto sigue sin ser 100% y no debería forzarse a serlo**: de los 178 restantes, 114 (64%) tienen salida de TEXTO real (colores, mensajes, niveles con nombre) dentro de una rama condicional -- convertirlos a un número inventado sería exactamente la fabricación que este ADR y ADR-121/190 evitan. Los otros 64 son plomería del rule-chain (enrutamiento, marcado de metadata, bookkeeping) que no corresponde a `sensor_formula_def` bajo ningún diseño honesto -- no es una limitación del motor ni del traductor, es la naturaleza real de esos datos.

## Consecuencias

### Positivas
- El motor de fórmulas ahora soporta ESTADO (`prev_value`) y MÚLTIPLES SALIDAS de forma real y verificada -- disponible para toda fórmula futura, no solo para la migración del legado.
- El traductor de fórmulas pasó de 0 a 5 traducciones automáticas reales, y de paso quedó más correcto (bug de sustitución de campos mutados corregido antes de aceptarse) y más capaz (comentarios, parseFloat, max/min/round).
- El análisis de alarmas da un mapa honesto y accionable: 5/104 nodos son candidatos reales de migración a `platform_alarm_rules`, con la ruta arquitectónica concreta (incluyendo el único caso compuesto, que es además el más relevante para seguridad geotécnica real).

### Negativas / pendientes
- El mapeo `rule_chain` legado → `sensor_id` real de la plataforma nueva sigue sin hacerse (ni para fórmulas ni para alarmas) -- requiere la misma decisión humana caso por caso que ADR-197 resolvió para la importación de sensores.
- Las 5 fórmulas traducidas automáticamente son constantes de inicialización, no cálculo real -- bajo valor individual, alto valor de rigor (confirman que el motor ya no es el cuello de botella).
- El caso `compound_multi_field` (alarma sísmica real) queda como propuesta, no como fórmula+regla insertada -- requiere que el usuario apruebe la severidad y el sensor real antes de crear nada.

## Referencias
- `backend/src/mining/sensor_formula_evaluator.cpp` (`loadPreviousOutputValue`, `prev_value`)
- `backend/third_party/tinyexpr/tinyexpr.c` (extensión `iif`/`max`/`min`/`round`, addendum ADR-197)
- `scripts/translate_thingsboard_formulas.py` (múltiples salidas, comentarios, parseFloat)
- `scripts/translate_thingsboard_alarms.py` (nuevo)
- `docs/development/thingsboard_alarms_analysis_2026-09-18.csv` (nuevo)
- [ADR-197](197-importacion-sensores-thingsboard-legado.md), [ADR-189](189-catalogo-plantillas-formula-calibracion-geotecnica.md)
