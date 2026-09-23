# ADR-172 — Motor de tablas tipo Excel: fórmulas, formato condicional/numérico y alcance explícito

**Status**: implemented, alcance v1 acotado a propósito (formalizado retroactivamente 2026-09-12 — el código ya existía sin ADR)
**Fecha**: 2026-09-12
**Autores**: Luder Armas (formalización retroactiva, con Claude Code)
**Ámbito**: reports

## Contexto

`TableBlock.tsx` (bajo `components/document/InsertBlocks/`) llegó al
repositorio con un motor de hoja de cálculo embebido — fórmulas, formato
condicional, formato numérico, portapapeles compatible con Excel/Sheets/
Word, y "crear gráfico desde tabla" — sin ningún ADR propio. Una auditoría
de conformidad (2026-09-11) lo señaló como la pieza de mayor superficie
nueva sin documentar: el único ADR previo sobre tablas, [ADR-053](053-estilos-visuales-tabla.md),
cubre solo estilo visual (temas de color, filas alternadas, bordes,
formato por selección en celdas) — nunca contempló cálculo.

Este ADR formaliza **qué existe** (con precisión suficiente para servir de
referencia de implementación) y **qué NO existe todavía**, a pedido
explícito: dejar claro el alcance real antes de seguir construyendo encima,
y como insumo para decidir si algo de lo faltante se prioriza a futuro.

## Decisión

### 1. Fórmulas (`lib/tableFormulas.ts`)

Parser propio (tokenizer + descenso recursivo), no una librería de terceros.

**Funciones soportadas (7), con alias ES↔EN intercambiables**
(`FUNC_ALIASES`):

| Español | Inglés | Comportamiento |
|---|---|---|
| `SUMA` | `SUM` | Suma un rango o lista de argumentos; ignora celdas no numéricas |
| `PROMEDIO` | `AVERAGE` | Ídem; con 0 valores numéricos da `#DIV/0!` |
| `CONTAR` | `COUNT` | Cuenta solo celdas numéricas del rango |
| `MAX` | `MAXIMO` | Máximo; rango vacío da `0` (no error) |
| `MIN` | `MINIMO` | Mínimo; mismo criterio que `MAX` |
| `ABS` | `ABS` | Exactamente 1 argumento; si no, `#VALUE!` |
| `REDONDEAR` | `ROUND` | 1 o 2 argumentos (decimales opcional, default 0) |

**Operadores**: `+ - * / ^` con precedencia estándar (`^` más apretado,
asociativo a la derecha), unario `-`/`+`, paréntesis.
**Sin** operadores de comparación (`>`, `<`, `=`, `<>`) dentro de una
fórmula — esos solo existen como *condición* del formato condicional.

**Referencias**: estilo `A1` y rangos rectangulares `A1:B3` (orden de
esquinas indistinto), siempre dentro de la **misma tabla**. Sin referencias
entre tablas/hojas distintas, sin `$` absolutas, sin rangos con nombre.

**Errores tipo Excel replicados**: `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`,
`#CIRC!` (ciclos directos e indirectos, detectados con memo + set de
"resolving"), `#ERROR!` (genérico: sintaxis inválida, fórmula vacía,
resultado no finito).

**Diferencia deliberada frente a Excel real**: una referencia directa a una
celda vacía da `#VALUE!` (Excel real daría `0`) — documentado en el propio
código, no es un defecto.

**Recalculo**: `useMemo(() => computeTableFormulas(rows), [rows])` en cada
render de `TableBlock.tsx`, y de forma independiente en `ReadOnlyViewer.tsx`,
`exportEngine.ts` y `docx/buildReportDocx.ts` (que exporta el **valor**
calculado a Word, nunca la fórmula cruda). El resultado **no se persiste**
en ningún punto — solo el texto crudo (`=SUMA(A1:A3)`) vive en `rows`. Ver
"Punto pendiente de decisión" más abajo.

### 2. Formato condicional (`lib/tableConditionalFormat.ts`)

Dos mecanismos reales de Excel, ambos sobre el **valor efectivo** de la
celda (el resultado de la fórmula si es fórmula, o el literal si no):

- **Reglas de umbral** (`ConditionType`): `greaterThan`, `lessThan`,
  `greaterOrEqual`, `lessOrEqual`, `equal`, `notEqual`, `between`,
  `textContains` (case-insensitive, substring). Pintan con un color fijo.
- **Escalas de color**: 2 puntos (mín/máx) o 3 puntos (mín/medio/máx),
  interpolación RGB continua, con interpolación opcional del color de texto
  por separado del fondo. Más 4 plantillas rápidas de 3 franjas fijas
  (semáforo rojo-amarillo-verde y variantes) — generan reglas de umbral, no
  una escala real.
- **Sin** barras de datos ni conjuntos de iconos.

**Alcance (`scope`)**: `undefined` (default, toda la tabla), `cells`
(selección fija tomada al crear la regla), `row`/`column` (**dinámicos** —
una columna nueva agregada después queda cubierta automáticamente si hay
una regla de tipo `row`, igual que "aplicar formato a toda la fila" en
Excel). El encabezado (fila 0) se excluye automáticamente si `hasHeader`.

**Composición**: varias reglas/escalas pueden aplicar a la misma celda; se
evalúan en orden — escalas primero como capa base, reglas de umbral
encima — y una regla posterior pisa las propiedades que choquen con una
anterior. **Sin** "detener si es verdad" ni prioridad reordenable (a
diferencia de Excel real).

### 3. Formato numérico (`lib/tableNumberFormat.ts`)

Solo 3 tipos: `general` (entero tal cual; decimal redondeado suave a 6
posiciones para evitar arrastres de coma flotante), `percent:N` (×100 + `%`,
N decimales), `decimal:N` (decimales fijos, 0–10). Botón `%` alterna
conservando decimales; botones subir/bajar decimales. **Sin** moneda, fecha,
notación científica, separador de miles, ni formato personalizado tipo
`#,##0.00`.

### 4. Funciones de hoja de cálculo más allá de fórmulas/formato

- **Fusionar/dividir celdas**: sí, con reajuste automático de referencias de
  fórmula (`shiftFormulaRefs`) y de alcance de formato condicional
  (`shiftScopedItems`).
- **Redimensionar/autoajustar columnas**: sí — arrastre manual de bordes de
  columna/fila, botón "Autoajustar" (`computeAutoFitColumnWidths`), ajuste
  adaptativo de padding al pegar/importar.
- **Insertar/eliminar fila o columna**: parcial — agregar solo al final,
  eliminar una fila/columna puntual por botón; **sin** "insertar arriba/
  abajo" en una posición arbitraria como comando directo.
- **Portapapeles de tabla** (`lib/tableClipboard.ts`): parsea HTML de
  portapapeles de Excel/Sheets/Word (rowspan/colspan, fondo, alineación,
  color de texto por celda, tamaño de fuente), con fallback a TSV.
- **Crear gráfico desde tabla** (`lib/chartFromTable.ts` +
  `CreateChartFromTableModal.tsx`): detecta columnas numéricas (resolviendo
  fórmulas) y crea un bloque `chart` **estático** (`live: false`) con los
  datos copiados una sola vez — no se re-sincroniza si la tabla cambia
  después (mismo comportamiento que el resto de gráficos estáticos de
  ADR-070, consistente, no es una regresión).
- **Sin** congelar filas/columnas, ordenar, filtrar, validación de datos
  (listas desplegables por celda), ni autocompletado de fórmulas.

### 5. Explícitamente fuera de alcance en esta versión (no son bugs)

Para que quede negro sobre blanco qué NO intenta cubrir este motor:

- `BUSCARV`/`VLOOKUP`, `INDICE`+`COINCIDIR`/`INDEX`+`MATCH`
- `SI`/`IF`, `SI.ERROR`/`IFERROR`, `Y`/`O`/`NO` (`AND`/`OR`/`NOT`)
- `SUMAR.SI`/`CONTAR.SI`/`PROMEDIO.SI` (`SUMIF`/`COUNTIF`/`AVERAGEIF` — ninguna agregación condicional)
- Funciones de texto (`CONCATENAR`, `IZQUIERDA`, `DERECHA`, `EXTRAE`, `MAYUSC`/`MINUSC`, `ESPACIOS`)
- Funciones de fecha (`HOY`, `AHORA`, `FECHA`)
- Referencias absolutas `$A$1` y rangos con nombre
- Referencias entre tablas o "hojas" distintas dentro del mismo informe
- Fórmulas de array / matriciales
- Barras de datos y conjuntos de iconos (formato condicional)
- Formato numérico de moneda, fecha, científico, separador de miles, o personalizado
- Congelar filas/columnas, ordenar, filtrar, validación de datos, autocompletado de fórmulas

### Punto pendiente de decisión (no resuelto por este ADR)

El resultado de una fórmula nunca se congela — es una vista siempre
derivada del texto crudo guardado. Si la lógica de `tableFormulas.ts`
cambiara en el futuro (fix de redondeo, nueva función, cambio de
constantes internas), un informe **ya firmado** mostraría un número
distinto al reabrirse o reexportarse, sin ningún registro de versión —
en espíritu, el mismo riesgo que [ADR-012](012-binding-dato-widget-referencia-versionada.md)
ya resolvió para `sensor`/`kpi`/`chart` con un snapshot al firmar.

Diferencia real a favor de dejarlo como está: las fuentes de una fórmula de
tabla son siempre celdas del propio documento (nunca telemetría externa ni
una API de terceros), así que no hay "dato que cambió en el mundo real y ya
no se puede reproducir" en el mismo sentido que ADR-012 — solo hay riesgo si
el propio motor de cálculo cambia de versión entre el momento de firmar y el
de reabrir. Se deja pendiente de decisión explícita (no resuelta
unilateralmente por este ADR): ¿aceptar ese riesgo residual tal cual, o
extender `captureLiveSnapshotsForSigning` (que ya congela `sensor`/`kpi`/
`chart` al firmar, ver ADR-012) para que también congele el valor calculado
de cada celda-fórmula en `props` al momento de la firma?

## Consecuencias

### Positivas
- Cubre de sobra el caso de uso real dentro de un informe técnico minero:
  sumar/promediar/contar columnas de mediciones, resaltar filas fuera de
  rango, pegar tablas de Excel/Word sin que se rompan.
- Motor propio y liviano (parser + evaluador de ~500 líneas), sin traer una
  librería de hoja de cálculo completa (con su peso de bundle y su propia
  superficie de mantenimiento) para un alcance que no la necesita.
- Errores tipo Excel y detección de ciclos dan una experiencia familiar sin
  comportamientos silenciosos raros.

### Negativas / Trade-offs
- No sirve para modelos de negocio con lógica condicional (`SI`), cruces de
  datos entre tablas (`BUSCARV`/`INDICE`), limpieza de texto, cálculos de
  fecha, ni el flujo típico de análisis de datos (ordenar, filtrar, validar,
  congelar paneles) — es una calculadora de columnas con estética
  condicional, no una herramienta de análisis.
- El resultado de una fórmula no sobrevive a un cambio futuro del motor de
  cálculo sin quedar potencialmente desalineado con lo firmado (ver punto
  pendiente arriba).
- "Insertar fila/columna en posición arbitraria" y "congelar filas/columnas"
  son huecos reales frente a la expectativa de un usuario que ya conoce
  Excel.

## Alternativas descartadas

### Integrar una librería de hoja de cálculo completa (ej. HyperFormula, Handsontable)
Habría dado de entrada `BUSCARV`/`SI`/funciones de texto/fecha y
referencias absolutas, pero a costa de un bundle mucho más pesado y una
superficie de API/mantenimiento que excede el caso de uso real (columnas de
mediciones dentro de un informe, no una hoja de cálculo de propósito
general). Queda como opción a reevaluar solo si el negocio pide
explícitamente alguna de las funciones de "fuera de alcance" de arriba con
volumen suficiente para justificar el costo.

## Referencias
- `frontend/src/components/ReportStudioV2/lib/tableFormulas.ts` (+ `tableFormulas.test.ts`)
- `frontend/src/components/ReportStudioV2/lib/tableConditionalFormat.ts` (+ test)
- `frontend/src/components/ReportStudioV2/lib/tableNumberFormat.ts` (+ test)
- `frontend/src/components/ReportStudioV2/lib/tableClipboard.ts` (+ test)
- `frontend/src/components/ReportStudioV2/lib/tableCellSelectionBridge.ts`
- `frontend/src/components/ReportStudioV2/lib/chartFromTable.ts`
- `frontend/src/components/ReportStudioV2/components/layout/ConditionalFormatEditor.tsx`
- `frontend/src/components/ReportStudioV2/components/modals/CreateChartFromTableModal.tsx`
- `frontend/src/components/ReportStudioV2/components/document/InsertBlocks/TableBlock.tsx`
- ADR-053 (estilos visuales de tabla — precedente directo, alcance distinto)
- ADR-010, ADR-070 (modelo de documento/bloques)
- ADR-012 (snapshot versionado al firmar — referencia para el punto pendiente)
