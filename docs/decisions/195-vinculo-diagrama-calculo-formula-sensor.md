# ADR-195 — Vínculo real entre "Fórmulas de Sensores" y el lienzo "Cálculo": diagrama autogenerado por fórmula

**Status**: implemented, verificado E2E en vivo contra el stack local (2026-09-17) — ver "Actualización" abajo

**Fecha**: 2026-09-17

> **Actualización 2026-09-17 (misma tarde, verificación en vivo): el endpoint
> de regeneración NO exige `dispositivos.manage`.** Primera versión lo
> gateaba igual que crear/editar/borrar una fórmula — reproducido en vivo con
> un usuario sin ese permiso: 403 tanto al entrar por "Ver en Cálculo" (el
> auto-generado silencioso, ver más abajo) como al apretar "Regenerar
> diagrama" a mano, dejando a cualquier usuario de solo lectura sin poder ver
> NINGÚN diagrama. Corregido: `handleRegenerateSensorFormulaDiagram` solo
> exige sesión autenticada + `sensorBelongsToTenant`, igual que
> `handleGetDeviceSubResource`/`handleListAllFormulas` (las rutas de lectura
> de fórmulas, que tampoco exigen ese permiso) — consistente con que esto no
> acepta contenido del caller, solo reconstruye determinísticamente desde una
> fila que el usuario ya puede leer.
>
> **Segunda corrección, misma verificación**: el primer diseño dejaba el
> diagrama vacío con un toast pidiendo un clic manual en "Regenerar
> diagrama" para cualquier fórmula preexistente a este cambio. En la prueba
> real esto se sintió como un callejón sin salida ("no muestra nada")
> viniendo del flujo esperado (clic en la tabla → ver el diagrama
> directamente). `refreshState()` ahora dispara la regeneración
> automáticamente la primera vez que detecta un diagrama vacío bajo
> `formula_<id>` en esa carga de página (con un `Set` para no reintentar en
> loop si falla), en vez de solo avisar. El botón manual "Regenerar
> diagrama" se mantiene para resincronizar después de una edición externa o
> forzar una reconstrucción.

**Autores**: Luder Armas, con Claude Code

**Ámbito**: core-iot

**Relación**: cierra un gap dejado documentado explícitamente por
[ADR-188](188-reconstruccion-tab-calculo-motor-real.md) ("el lienzo sigue
siendo puramente visual... no ejecuta la lógica de la fórmula... documentado
acá para que quede explícito"). Se apoya en el motor real de
[ADR-187](187-administracion-sensores-motor-formulas-tiempo-real.md)
(`sensor_formula_def`, `tinyexpr`, poller 10s) y en el esquema de canales
nombrados de [ADR-189](189-catalogo-plantillas-formula-calibracion-geotecnica.md)
(`sensor_input_channel_def`).

## Contexto

La vista **"Fórmulas de Sensores"** (`FormulaOverviewView.tsx`, `GET
/api/mining/formulas`) lista todas las fórmulas reales del tenant
(`sensor_formula_def`). El lienzo **"Cálculo"** (ADR-188) es un editor visual
de bloques/decisiones/conexiones, corriendo en un sidecar (`formula_engine`)
con sus propias tablas `blocks`/`connections`/`rules` — en la misma base
física (`sensors_db`) que `sensor_formula_def`, pero sin ninguna fila que las
relacione.

Se confirmó por lectura de código que **no existía ningún vínculo**: el
`diagram_id` del lienzo era una convención `sensor_<uuid>` (un diagrama por
**sensor**), mientras que un sensor puede tener varias fórmulas (ej. un
piezómetro con salidas `ALT`/`MCA`/`MPA` en 3 filas separadas de
`sensor_formula_def`) — ni siquiera existía cardinalidad 1:1 posible. Tampoco
había ninguna navegación desde la tabla de fórmulas hacia el lienzo.

## Decisión

### 1. El diagrama pasa a ser por FÓRMULA, no por sensor

Nuevo esquema de `diagram_id`: **`formula_<formula_id>`** (antes
`sensor_<uuid>`). Resuelve la ambigüedad de sensores con múltiples fórmulas.
No requiere migrar columnas — `blocks`/`connections` ya tenían `diagram_id
TEXT` genérico (ADR-188); solo cambia el valor que se le pone.

Se retira el hack de "variantes" (`FORMULA_DIAGRAM_VARIANTS`, botón "Nuevo
Diagrama" para abrir un canvas alternativo por sensor): ya no hace falta,
cada fórmula tiene su propio diagrama de forma natural.

`formula_engine/src/main.cpp::sensorIdFromDiagramId()` (usada por
`authorizeDiagram()` — el único punto de autorización multi-tenant de TODAS
las rutas del lienzo) se extiende para resolver el prefijo `formula_`
consultando `sensor_formula_def`, y **conserva** la rama `sensor_` vieja para
compatibilidad (ADR-188 seguía "pendiente de verificación E2E en vivo" al
momento de este cambio, así que no se esperan diagramas reales bajo el
esquema viejo, pero no cuesta nada dejarlo funcionando).

### 2. El diagrama se autogenera desde la fórmula real, y se regenera en cada cambio

Se investigó decodificar el árbol `tinyexpr` compilado (`te_expr*`) para
descomponer la expresión operador por operador. **Se descartó**: los
operadores (`add`, `sub`, `mul`, la tabla `functions[]` de `sin`/`sqrt`...)
son símbolos `static` de enlace interno en el `tinyexpr.c` vendoreado, no
recuperables desde otra unidad de compilación sin parchear una librería de
terceros. Además la UI del lienzo ya soporta que **un bloque contenga una
expresión `tinyexpr` completa como texto** (`meta.formula.expression`) — no
un token por bloque.

En su lugar, el diagrama generado replica el **pipeline real del evaluador**
(`sensor_formula_evaluator.cpp::evaluateFormulaRow()`/`computeStatus()`):

```
INICIO → [bloque de entrada por cada variable referenciada] → CÁLCULO (expresión completa)
       → ¿fuera de rango ERROR? (bloque Decisión) --SI--> ERROR
                                                   --NO--> ¿fuera de rango WARNING? (Decisión)
                                                             --SI--> WARNING
                                                             --NO--> OK (→ output_channel_code)
```

Las variables de entrada se determinan con un escaneo de palabra completa de
la expresión contra `sensor_input_channel_def`/`sensor_input_parameter_def`
del sensor (misma fuente que ya usa `validateExpression()`). Los bloques de
decisión y sus ramas usan exactamente el mismo `meta` que produce el editor
manual (`meta.blockType:'decision'`, `meta.direction:'backward'`,
`meta.backwardLabel:'SI'/'NO'`), confirmado byte a byte contra la lógica de
`app.js` que auto-asigna SI/NO al conectar un bloque de decisión a mano.

**Autogeneración total, sin merge**: cada regeneración reemplaza TODO lo que
hubiera bajo ese `diagram_id` (`DELETE` + `INSERT`). Se pierde cualquier
edición manual de layout — decisión de producto explícita, confirmada con el
developer: la fuente de verdad sigue siendo `sensor_formula_def`, el
diagrama es su visualización fiel, no un documento independiente.

**Regeneración automática**: el backend principal regenera el diagrama (en
la misma conexión/transacción) cada vez que la fórmula se crea o se edita
(`handleCreateSensorFormula`/`handleUpdateSensorFormula`,
`sensor_formula_routes.cpp`), y lo borra si la fórmula se borra. Nuevo
endpoint `POST .../{sensor_id}/formulas/{formula_id}/diagram/regenerate`
(`handleRegenerateSensorFormulaDiagram`) permite regenerar bajo demanda —
usado por el botón "Regenerar diagrama" del lienzo (reemplaza al viejo
"Nuevo Diagrama") y sirve de backfill manual para fórmulas creadas antes de
este cambio (que no tienen diagrama todavía; el lienzo lo avisa en vez de
mostrar un canvas en blanco sin explicación).

La generación y persistencia vive en el backend principal
(`backend/src/mining/sensor_formula_diagram.hpp/.cpp`), escribiendo
directamente en `blocks`/`connections` del sidecar por SQL — son la misma
base física (`sensors_db` vía pgbouncer, confirmado en `docker-compose.yml`),
así que no hace falta agregar un cliente HTTP nuevo hacia el sidecar ni
duplicar su lógica de autorización; se replica el `pg_notify('formula_changes',
...)` que el sidecar ya emite, para que un lienzo abierto en otra pestaña se
entere del cambio sin recargar. No se escribe nada en la tabla `rules` del
sidecar — confirmado código muerto (`rules.expr` nunca se evaluaba, comentario
explícito en `app.js`); el texto de condición de cada bloque de decisión vive
en `meta.formula.expression`, igual que un bloque de cálculo.

### 3. Navegación real desde la tabla hacia el lienzo

`FormulaOverviewView.tsx` agrega un botón por fila ("Ver en Cálculo") que
guarda el contexto (`sensor_id`, `formula_id`) en `localStorage` bajo
`formula_ctx_v2` — el mismo mecanismo que ya usan los combos internos del
lienzo — y navega a la pestaña "Cálculo" (`App.tsx`, `setActiveTab('Formula')`,
sin gate de permiso, igual que el resto del tab). `app.js` gana un tercer
combo (`#ctxFormula`, junto a tipo/sensor) para elegir manualmente qué
fórmula de un sensor ver cuando no se llega por ese deep-link.

Se corrigió, como parte de esto, un bug de inicialización preexistente en
`initContextSelectors()`: la carga silenciosa de la página (`resetChild:
false`) podía pisar el `ctx` persistido con `{sensor_type: null, sensor_id:
null}` apenas cargaba, si el tipo de sensor guardado no matcheaba ninguna
opción disponible — exactamente el caso de un deep-link (que no conoce
`sensor_type`). Ahora ese borrado solo ocurre en una interacción real del
usuario (`resetChild: true`).

## Consecuencias

- El lienzo "Cálculo" sigue **sin ejecutar nada por sí mismo** — el único
  motor de ejecución real sigue siendo `sensor_formula_evaluator.cpp` (poller
  10s). El diagrama es una **visualización fiel generada A PARTIR de**
  `sensor_formula_def`, no una segunda implementación. Esto no contradice
  ADR-188, lo completa: la limitación que ADR-188 documentaba era la falta
  de *cualquier* vínculo, no que el lienzo debiera ejecutar lógica.
- Cualquier edición manual de layout hecha directamente en el lienzo para una
  fórmula se pierde en la próxima regeneración automática (crear/editar esa
  fórmula, o "Regenerar diagrama"). Aceptado a propósito.
- Fórmulas creadas **antes** de este cambio no tienen diagrama bajo
  `formula_<id>` hasta que alguien presione "Regenerar diagrama" (o se edite
  la fórmula una vez, lo cual también regenera). No se corrió ningún backfill
  automático masivo al desplegar.
- Diagramas viejos bajo el esquema `sensor_<uuid>` (si existieran) quedan
  huérfanos — no migrados, no borrados. Bajo riesgo: ADR-188 seguía pendiente
  de verificación E2E en vivo, no se esperan diagramas reales de producción
  bajo ese esquema.

## Alternativas descartadas

- **Decodificar el árbol `te_expr` compilado por `tinyexpr`** para un bloque
  por operador: requiere parchear código vendoreado de terceros (símbolos
  `static` sin linkage externo) y no encaja con cómo el editor ya representa
  una fórmula (texto completo por bloque, no un token). Descartado.
- **Cliente HTTP backend→sidecar** para escribir el diagrama (simétrico al
  patrón `ai_engine_client.cpp`): descartado porque `blocks`/`connections`
  viven en la misma base física que `sensor_formula_def` — un cliente HTTP
  nuevo solo agregaría una fuente de fallo parcial (fórmula guardada, request
  al sidecar caído) sin necesidad.
- **Mantener el diagrama por-sensor** con un selector de "sub-diagrama" por
  fórmula dentro del mismo `diagram_id`: más complejo de autorizar (la
  autorización actual es 100% por `diagram_id`) y no resuelve la ambigüedad
  de fondo — se prefirió que la identidad primaria fuera la fórmula.

## Referencias

- `backend/src/mining/sensor_formula_diagram.hpp/.cpp` (generador + persistencia)
- `backend/src/mining/sensor_formula_routes.cpp` (hooks crear/editar/borrar + endpoint de regeneración manual)
- `formula_engine/src/main.cpp` (`sensorIdFromDiagramId`, autorización)
- `frontend/public/formula/app.js`, `frontend/public/formula/index.html`
- `frontend/src/components/ReportStudioV2/components/views/FormulaOverviewView.tsx`
- `frontend/src/App.tsx`
