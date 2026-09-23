> **Actualización 2026-09-18 (misma fecha, segunda pasada): investigación
> profunda del bloqueo de traducción de fórmulas + extensión real del motor
> tinyexpr.** A pedido explícito del usuario ("necesito un trabajo de
> investigación profundo para lograr un avance en la migración de las
> fórmulas... si es necesario realiza cambios en la implementación"), se
> hizo lo siguiente (nunca se borra la nota original de abajo, ver
> convención del índice):
>
> 1. **Extensión real del motor** (`backend/third_party/tinyexpr/tinyexpr.c`):
>    tinyexpr ya soportaba comparaciones (`>`,`<`,`>=`,`<=`,`==`,`!=`) y
>    lógicos (`&&`,`||`,`!`) -- confirmado por inspección del código
>    vendoreado -- pero le faltaba una forma de SELECCIONAR entre dos
>    valores según una condición. Se agregaron 4 funciones nativas nuevas:
>    `iif(cond, a, b)`, `max(a,b)`, `min(a,b)`, `round(x)`. `iif` evalúa
>    ambas ramas de forma eager (tinyexpr no tiene short-circuit de
>    funciones) y selecciona el resultado ya calculado -- seguro para
>    fórmulas puras sin efectos secundarios, un NaN en la rama descartada
>    nunca se propaga porque no se usa. Probado end-to-end: compiló limpio
>    (`gcc -Wall -Wextra -std=c99`, 0 warnings) y se verificó en runtime
>    contra 7 casos, incluyendo un `iif` anidado de 2 niveles reproduciendo
>    exactamente el patrón de umbral por rangos visto en el legado
>    (`mag_evento>7 && dist<=100 -> 3`). No requiere ningún cambio en
>    `sensor_formula_routes.cpp`/`sensor_formula_evaluator.cpp`: la
>    validación de expresiones ya delega 100% en `te_compile()` real
>    (sin whitelist propia), así que las funciones nuevas quedan
>    disponibles automáticamente en toda fórmula nueva o existente.
> 2. **Bug real encontrado y corregido en el traductor**: `ASSIGN_RE` (el
>    regex que extrae `msg.<campo> = <expresión>;`) exigía un `;` literal
>    como terminador. El legado usa mayormente ASI (JavaScript sin punto y
>    coma, típico del export de rule-chain de ThingsBoard) -- en la
>    práctica, en muchos registros sin `;` cercano el regex capturaba TODO
>    el resto del bloque como si fuera una sola expresión gigante,
>    inflando artificialmente el rechazo por "token descalificante". Se
>    corrigió para aceptar `;` O salto de línea como terminador (ambos
>    válidos en JS real). Efecto medido: la clasificación interna cambió
>    (rechazos por "token descalificante" bajaron de 20→13, rechazos por
>    "más de un campo de salida" subieron de 4→11 -- clasificación más
>    precisa), pero el resultado final de fórmulas traducibles automáticamente
>    **se mantuvo en 0/175** -- confirma que el 0 original no era un
>    artefacto del bug, es el reflejo real de los datos.
> 3. **Nuevo detector: "selector de N vías"** (`try_integer_selector_chain`
>    en el script) -- reconoce el único patrón de ramificación que aparece
>    repetido en el export con forma segura de traducir: una cadena
>    `if (msg.<selector> == N) { <var_local> = <referencia_simple>; }`
>    (sin lógica propia por rama, ramas mutuamente excluyentes por
>    construcción). Se probó contra las 175 fórmulas: el único caso real
>    que calzaba la forma (`PrismB3`/`PrismRC`, nodo "Prism", selector de 9
>    vías `msg.umbralactivo==1..9` eligiendo un umbral `metadata.cs_umbralNalerta`)
>    **también asigna un segundo campo de salida** (`msg.tipo_alerta_anterior`,
>    que arrastra el valor del ciclo anterior vía metadata -- estado, no
>    cálculo puro) -- descalificado correctamente por la misma regla de
>    "más de un campo de salida = ambiguo" que protege el resto del
>    sistema. Yield real: **0 traducciones nuevas**, honesto y verificado
>    (no es que no se intentó -- se intentó, se depuró con casos reales
>    extraídos directamente del PSV por índice de registro, y el resultado
>    es genuinamente 0).
> 4. **Hallazgo colateral importante, fuera de alcance de "fórmulas"**: los
>    104 nodos `TbJsFilterNode`/`TbJsSwitchNode` (categoría `not_a_formula`,
>    sin cambios) sí tienen forma de **clasificación de alarma por
>    umbral** (`if (mag_evento>7 && dist<=100) return "Peligro"; else if
>    (mag_evento>6 && dist<=200) return "Alerta"; else return "Normal";` --
>    caso real de `AlarmasBrocal/Condicion Alertas Acelerografos`). Se
>    verificó con el `iif` nuevo que esa lógica exacta SÍ es expresable en
>    tinyexpr hoy. Pero el destino correcto de esa lógica no es
>    `sensor_formula_def` (produce una etiqueta de severidad para
>    enrutamiento de alarma, no un valor de telemetría calculado) sino
>    `platform_alarm_rules` (ya existe en la plataforma nueva, ver
>    ADR-196). Migrar esos 104 nodos a reglas de alarma reales es un
>    trabajo real y factible, pero es una migración DISTINTA (modelo de
>    datos distinto, tabla distinta, UI distinta) que no fue pedida en
>    este mensaje y por disciplina de alcance **no se implementó sin
>    confirmación explícita** -- queda anotado aquí como el siguiente paso
>    de mayor valor real si el usuario decide continuar la migración del
>    legado hacia el subsistema de alarmas.
>
> **Conclusión honesta de la investigación**: el motor de fórmulas SÍ se
> mejoró de forma real y duradera (4 funciones nuevas, disponibles para
> toda fórmula futura -- clamps, umbrales, clasificación por rango -- sin
> tocar ninguna otra parte del backend). El traductor SÍ se corrigió (bug
> real de ASI) y SÍ se extendió (detector de selector de N vías). El
> resultado de la migración de las 175 fórmulas legadas específicas sigue
> siendo 0 automáticas -- no por limitación del motor (ya no la tiene) sino
> porque los datos reales codifican estado y salidas múltiples que ninguna
> fórmula pura de una sola pasada puede representar sin inventar semántica.
> Ver `scripts/translate_thingsboard_formulas.py` (columna nueva
> `tinyexpr_suggested`, vacía en esta corrida pero lista para futuros
> patrones) y prueba del motor en
> `backend/third_party/tinyexpr/tinyexpr.c` (comentario inline).

# ADR-197 — Importación real de 2,269 sensores del ThingsBoard legado + traductor de fórmulas (no automatizable)

**Status**: implemented, verificado en vivo contra la BD real del legado (2026-09-18)

**Fecha**: 2026-09-18

**Autores**: Luder Armas (pedido explícito: importar todos los sensores del servidor backup de producción, inscritos en su tenant real; traducir las fórmulas legadas), con Claude Code

**Ámbito**: mining / datos (migración)

**Relación**: usa la investigación de `docs/INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md` y los exports de `docs/development/thingsboard_formulas_export_2026-09-17.psv`. Complementa [ADR-190](190-auditoria-coordenadas-gps-oficiales-empresas.md) (mismo principio: nunca coordenadas GPS inventadas).

## Contexto

El usuario dio credenciales reales de conexión directa a la base Postgres del ThingsBoard legado (`10.244.49.159:5432/beemetrydb`, usuario `beemetry`) y pidió dos cosas:
1. Traducir las 175 fórmulas de transformación legadas (JS de rule-chain) a expresiones tinyexpr del motor nuevo.
2. Importar todos los sensores reales del legado a `sensors`, inscritos en su tenant (empresa minera) real.

## Decisión — parte 1: traductor de fórmulas (`scripts/translate_thingsboard_formulas.py`)

Se implementó un traductor real (parsea el PSV, clasifica cada nodo, traduce cuando hay confianza) — **no un traductor cosmético**. Resultado real contra las 279 filas del export: **0 de 175 nodos `TbTransformMsgNode` se tradujeron automáticamente con confianza**. Causa raíz confirmada por inspección de los datos reales (no supuesta): la gran mayoría son reglas de negocio completas (tablas de clasificación de alertas con metadata rica, formateo de fecha con padding, guardas `isNaN`, concatenación de strings) — no aritmética pura sobre un valor de sensor. Forzar una traducción de control de flujo a una expresión tinyexpr (que no tiene `if`/`else`) habría sido inventar semántica que no existe en el original, exactamente el tipo de fabricación que ADR-121/190 ya prohíben para GPS y que aquí aplica igual a fórmulas de seguridad geotécnica.

El script SÍ queda como herramienta reusable, produce `docs/development/thingsboard_formulas_translated_2026-09-18.csv` con cada fórmula + el motivo exacto de por qué no se tradujo (worklist de revisión manual real, entregado al usuario). Si en el futuro aparece un patrón de fórmula real que sí sea aritmética pura, el script ya la traduciría (mapeo `Math.*`→tinyexpr y `msg.<campo>`→variable ya implementado y probado).

## Decisión — parte 2: importación de sensores

**Mecanismo**: `dblink` (instalado en `sensors_db` local) para hacer `INSERT INTO sensors SELECT ... FROM dblink(<conexión remota>, <query remota>)` en una sola transacción por lote, sin archivos intermedios ni CSVs — auditable como una sola sentencia SQL por lote.

**Fuente real de agrupación por empresa**: no es `device.customer_id`/`customer` (solo 1 dispositivo mapeado ahí, prácticamente huérfano) — es ThingsBoard PE `entity_group` (type='DEVICE') + `relation` (`relation_type_group='FROM_ENTITY_GROUP'`, `relation_type='Contains'`), 28 grupos reales (2,270 dispositivos, excluyendo el grupo sintético "All").

**Mapeo empresa legado → tenant real**, resuelto en 3 rondas con el usuario (nunca adivinado sin confirmar):
- 6 empresas con nombre exacto/evidente: Antapaccay→Minera Antapaccay, Boroo Misquichilca→Minera Boroo Misquichilca, El Brocal→El Brocal, GoldFields→Gold Fields La Cima, Volcan→Compania Minera Volcan, Nexa Cajamarquilla→Nexa Resources Peru.
- **Raura** tenía DOS tenants candidatos (`Compania Minera Raura` / `Minera Raura`, posible duplicado real de datos) — se preguntó explícitamente, usuario confirmó `Compania Minera Raura`.
- **San Rafael** (513 dispositivos, el segundo grupo más grande) y **Huaron** no tenían tenant. Se identificó que la mina San Rafael (estaño) es una unidad real de Minsur (ya tenant existente) — confirmado con el usuario antes de usar ese tenant en vez de crear uno nuevo. Huaron sí requirió tenant nuevo.
- **17 empresas sin tenant real** (Southern Cuajone, Tajo Mina, Quebrada Honda, Pucamarca, Marcobre*, Camposol, CMC Tantahuatay, Tambomayo, Yaros, Metro Lima, ElToro, La Zanja, Kolpa, Norcobre, GP Coricancha, Minera Crc, Uchucchacua): usuario autorizó explícitamente crear tenant nuevo para cada una (`company_type='mining_client'` default, `country_code='PE'`, `metadata` con `imported_from`/`tb_entity_group` para trazabilidad). *Marcobre ya existía como tenant antes de este ADR (guard `WHERE NOT EXISTS` lo detectó, no se duplicó.
- **Beemetry** (9 dispositivos) → tenant `Beemetry` existente (coincidencia exacta, es el tenant propio de la plataforma).
- **`thermostat devices`** (1 dispositivo, nombre genérico de prueba) → descartado explícitamente, no se creó tenant para basura.
- **Nota sin resolver, dejada explícita**: "Tajo Mina" (241 sensores) es un nombre de grupo ambiguo — los dispositivos tienen prefijo `SJ.` (no `TM.`), sugiriendo que el nombre real de la empresa podría ser otro. Se creó el tenant con ese nombre literal (autorizado por el usuario) pero se dejó la ambigüedad anotada en `tenants.metadata.note` para revisión futura.

**Fix de seguridad real encontrado en el primer intento**: el primer INSERT falló contra el `CHECK (lat BETWEEN -90 AND 90)` de `sensors` — varios dispositivos (22 de El Brocal, y otros dispersos) tienen coordenadas **UTM** (ej. `8807303.91, 359071.43`, zona 19S de Perú) guardadas bajo los mismos atributos `latitude`/`longitude` que el resto usa para WGS84. Se corrigió filtrando por rango válido y dejando `lat`/`lng` en `NULL` (no una conversión UTM→WGS84 inventada) para esos casos, con `raw_lat`/`raw_lng` preservados en `metadata` para que alguien con la zona/datum correcto los convierta después — mismo principio de ADR-121/190: nunca inventar una coordenada.

## Resultado verificado

**2,269 sensores reales importados** (2,270 dispositivos del legado − 1 basura descartada), en 27 tenants, con `metadata.imported_from='thingsboard_legacy'` + `tb_device_id`/`tb_company` para trazabilidad completa hacia el origen. Desglose completo por tenant (sensores / con GPS válido):

| Tenant | Sensores | Con GPS |
|---|---|---|
| Minsur (San Rafael) | 513 | 454 |
| Southern Cuajone | 379 | 366 |
| Gold Fields La Cima | 279 | 251 |
| Tajo Mina | 241 | 0 |
| Quebrada Honda | 162 | 101 |
| Minera Antapaccay | 149 | 148 |
| Pucamarca | 102 | 91 |
| Compania Minera Raura | 96 | 89 |
| El Brocal | 57 | 28 |
| Camposol | 48 | 25 |
| Marcobre | 48 | 43 |
| Minera Boroo Misquichilca | 47 | 47 |
| Huaron | 25 | 23 |
| CMC Tantahuatay | 24 | 21 |
| Tambomayo | 19 | 7 |
| Yaros | 14 | 14 |
| Compania Minera Volcan | 12 | 10 |
| Metro Lima | 11 | 11 |
| ElToro | 11 | 2 |
| Beemetry | 9 | 3 |
| La Zanja | 8 | 4 |
| Kolpa | 6 | 0 |
| Nexa Resources Peru | 3 | 2 |
| GP Coricancha | 2 | 1 |
| Norcobre | 2 | 2 |
| Uchucchacua | 1 | 1 |
| Minera Crc | 1 | 1 |

## Consecuencias

### Positivas
- Datos reales, no inventados: cada sensor trae su `sensor_type` real del legado (piezometer/prism/accelerograph/tiltmeter/etc.), su código real, y GPS real donde existía en formato correcto.
- Reversible/auditable: `metadata.imported_from` permite identificar y, si hace falta, borrar en bloque todo lo importado por este ADR.
- `ON CONFLICT (tenant_id, sensor_code) DO NOTHING` en todos los INSERTs — reejecutar el mismo lote no duplica nada.

### Negativas / pendientes
- Los sensores importados **no tienen credencial de ingesta real** (`device_api_key_hash` queda NULL, `protocol='legacy_tls'` como default) — son registros históricos/de catálogo, no empiezan a recibir telemetría real hasta que alguien los reprovisione con una credencial real de este sistema.
- `sensor_type` es el string crudo del legado en minúsculas (`piezometer_equation`, `settlementcelldp`, `prisma` vs `prism`, etc.) — no normalizado contra ningún catálogo (`sensor_type_def`). Fast-follow si se necesita reporting consistente por tipo.
- Devices sin `latitude`/`longitud` en el legado, o con coordenadas UTM sin convertir, quedan con `lat`/`lng = NULL` — visibles en el mapa solo cuando alguien complete esa coordenada (mismo patrón ya usado en el resto de la plataforma, ver ADR-196).
- La ambigüedad de "Tajo Mina" (nombre real de empresa incierto) queda sin resolver, anotada en `tenants.metadata`.

## Referencias
- `scripts/translate_thingsboard_formulas.py`
- `docs/development/thingsboard_formulas_translated_2026-09-18.csv`
- `docs/INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md`
- [ADR-190](190-auditoria-coordenadas-gps-oficiales-empresas.md), [ADR-196](196-mapa-sensores-estado-compuesto-tiempo-real.md)
