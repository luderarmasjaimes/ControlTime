# ADR-049 — Ajuste de texto alrededor de objetos (7 modos estilo Word)

**Status**: implemented, extendido (verificado 2026-07-17 contra `PageCanvas.tsx::computeWrappedTextLines`, `RightInspector.tsx::WRAP_MODE_OPTIONS`)
**Fecha**: 2026-07-14 (aprox., a partir de comentarios de código; formalizado + extendido el 2026-07-17)
**Autores**: EC
**Ámbito**: reports

## Contexto

El negocio pidió replicar el comportamiento de "Opciones de diseño" de Word al insertar una imagen/tabla/gráfico/KPI/sensor/mapa sobre un bloque de texto ya existente: el texto debe fluir alrededor del objeto en vez de quedar tapado o forzar el objeto a una página nueva. Se analizaron las fuentes de ONLYOffice (`sdkjs`, `WrapManager.js`/`Paragraph_Recalculate.js`) como referencia de un motor de layout real con esta capacidad.

## Decisión

Cada bloque insertable no-texto gana un campo `wrapMode` con las 7 opciones de Word: `inline`, `square`, `tight`, `through`, `topbottom`, `behind`, `infront` (`'none'` legado se interpreta como `infront`). Se porta el mecanismo de **rangos permitidos por línea** de sdkjs (`computeWrappedTextLines` en `PageCanvas.tsx`): cada objeto con `wrapMode` activo aporta una exclusión rectangular; los huecos entre exclusiones fusionadas son los sub-rangos X donde el texto puede fluir en esa banda vertical — una línea puede partirse en varios tramos (texto a la izquierda Y a la derecha del objeto).

Solo se implementan los dos modos de exclusión geométricamente distintos para un rectángulo simple (sin polígono de silueta): **`square`-family** (`square`/`tight`/`through`, con margen decreciente 12/4/0px) y **`topbottom`** (la línea completa salta el tramo vertical del objeto). `behind`/`infront`/`inline` no excluyen nada — el objeto flota libremente; `behind`/`infront` solo cambian el z-order visual vía `divProps.style.zIndex` del wrapper `Html` (`react-konva-utils` fija `z-index:10` por defecto; se sobreescribe a 5 para `behind`, 15 para el resto).

### Reglas duras
- Sin exclusiones activas para un bloque de texto: se usa un único `<Text>` de Konva auto-ajustable (más barato) — el motor de rangos solo se invoca cuando hace falta.
- El picker de modo está disponible en dos lugares con la misma fuente de verdad (`WRAP_MODE_OPTIONS`, `normalizeWrapMode`): el panel derecho (`RightInspector`) y el menú contextual (clic derecho) del objeto — pedido explícito para que el cambio sea rápido sin tener que abrir el panel.

## Extensión 2026-07-17 — formato mixto dentro del wrap

El motor original asumía **un solo estilo uniforme** para todo el bloque de texto que envuelve. Con la llegada del formato por selección (ADR-050 — negrita/color/tamaño/fuente por rango dentro del mismo bloque), `computeWrappedTextLines` se extendió para que **cada palabra se fragmente en los límites de un span de estilo**, midiendo cada fragmento con su fuente/tamaño/negrita efectivos (no los del bloque base), y agrupando fragmentos contiguos de igual estilo en un solo segmento Konva (`WrappedSegment` ahora incluye `style: EffectiveTextStyle`, no solo texto/posición). El alto de línea (`lineH`) usa el tamaño de fuente **más grande** presente (base o algún span) para mantener líneas parejas sin recalcular alto línea a línea.

### Limitación conocida y aceptada
El auto-tamaño del cuadro de texto (`getAutoSizedTextBox`) sigue midiendo solo con el tamaño de fuente **base** del bloque — un span con un tamaño mucho mayor al del bloque podría, en casos extremos, desbordar visualmente el cuadro calculado. No reportado como problema real a la fecha; se documenta como trade-off consciente en vez de resolver con un motor de layout multi-tamaño completo (costo desproporcionado para el caso de uso).

## Consecuencias

### Positivas
- Replica fielmente el comportamiento esperado de Word sin la maquinaria pesada de `CWrapPolygon` de sdkjs (innecesaria para rectángulos simples).
- El formato por selección (ADR-050) y el ajuste de texto conviven correctamente — texto en negrita/color/tamaño distinto sigue fluyendo alrededor de imágenes.

### Negativas / Trade-offs
- `tight`/`through` no difieren visualmente de `square` para un rectángulo simple (sin polígono de silueta) — se exponen como opciones separadas solo por fidelidad de menú con Word, no por comportamiento geométrico distinto.

## Alternativas descartadas

### Motor de polígono de silueta completo (como sdkjs `CWrapPolygon`)
Permitiría ajuste de texto siguiendo el contorno real de una imagen no rectangular (ej. un logo recortado), pero es una cantidad de código y complejidad desproporcionada frente al beneficio para informes técnicos, donde los objetos insertados son siempre rectangulares (fotos, tablas, gráficos, mapas). Rechazado.

## Referencias
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx` (`computeWrappedTextLines`, `WrapExclusion`, `WrappedSegment`)
- `frontend/src/components/ReportStudioV2/components/layout/RightInspector.tsx` (`WRAP_MODE_OPTIONS`, `normalizeWrapMode`)
- ADR-010 (modelo de bloques), ADR-050 (formato de texto por selección)
