# ADR-182 — SPEC-021 T9: verificación real de export PDF/PPTX con los 20 tipos de gráfico, 2 bugs reales encontrados y corregidos

**Status**: implemented, verificado por export real (PDF+PPTX, 378 páginas c/u, stack completo) + test automatizado de regresión

**Fecha**: 2026-09-13

**Autores**: Luder Armas (pedido explícito de cierre de T9, "máximo análisis e implementación"), con Claude Code

**Ámbito**: reports

> **Actualización 2026-09-13 (misma sesión):** el primer fix de `funnel`
> (`label.overflow:'truncate', width:90` sin tocar el ancho del embudo)
> resultó incompleto — verificado en vivo tras el primer redeploy: la
> etapa más ANGOSTA (vértice inferior) truncaba correctamente con "…", pero
> la más ANCHA (arriba) seguía cortándose sin ellipsis, exactamente igual
> que antes del fix. Causa real: con `width:'84%'` el embudo ocupaba casi
> todo el canvas, así que en la posición del segmento ancho casi no quedaba
> espacio fuera de la forma — el recorte ocurría por el borde del propio
> canvas ANTES de que `label.overflow` tuviera margen donde actuar; el
> segmento angosto, en cambio, sí tenía margen de sobra. Fix real: angostar
> el embudo (`left:'4%', width:'52%'`) para reservar el mismo margen en
> TODAS las posiciones, no solo agrandar el `width` de la etiqueta.
> Reverificado en vivo tras el segundo redeploy: ambas etapas truncan ahora
> de forma simétrica y prolija ("Acelerógrafo Triaxial …" en las dos).

**Relación**: cierra SPEC-021 T9 (pendiente desde 2026-09-12, ver nota de
cierre parcial en `tasks.md`). Usa el pipeline de export ya verificado real
por SPEC-007/ADR-179.

## Contexto

T9 pedía "generar un PDF/PPTX real con los 20 tipos de gráfico y verificar
ejes/unidades" contra el stack completo — no disponible en la sesión
anterior. Con el stack real corriendo (`beemetry-api`, `beemetry-db`,
`beemetry-web`, `beemetry-pdf-export`), se identificó un informe QA ya
existente en la base real del tenant Alpayana, **"Demo — Prueba Exhaustiva
de Sensores y Gráficos"** (`report_id 34303bb2-81c0-49f1-a8a3-6a382ad90502`,
378 páginas, 1120 bloques `sensor_multi_chart` — exactamente 56 instancias
de cada uno de los 20 tipos del catálogo real), que ya cubre el universo
completo de tipos con datos reales de sensores acelerográficos (ACEL-01/
ACEL-03, unidad "g").

Se generaron ambos exports reales contra ese informe:
- **PDF**: job `f2a91f1c-...`, 378 páginas, ~4m38s, `status: success`.
- **PPTX**: job `02a0b63e-...` (el primer intento colisionó con el PDF en
  curso, `error_message: export_busy` — el sidecar Chromium solo procesa un
  job a la vez, mismo patrón de serialización ya documentado para
  `avatar_engine` en ADR-141; reintentado tras completarse el PDF), 378
  diapositivas, ~4m39s, `status: success`.

La verificación de ejes/unidades se hizo contra el **visor de lectura real
de la app** (`MODO LECTURA — SOLO VISUALIZACIÓN`), que es la MISMA vista
que el sidecar Chromium captura página por página para el PDF/PPTX (ADR-016/
083) — no una aproximación. Se revisaron las 20 primeras apariciones (una
por tipo, páginas 5-11) tanto en su tamaño real de exportación (2-3
gráficos por fila) como en el modal de ampliación de cada widget.

## Hallazgos

**12/20 tipos correctos sin hallazgos**: `line`, `bar`, `area`, `scatter`,
`combo`, `step`, `candlestick`, `boxplot`, `heatmap`, `waterfall`, `geomap`,
`surface` — ejes con escala/unidad correcta ("g" para acelerógrafos, "m/s"
confirmado con un sensor `air_velocity` distinto en la misma página),
timestamps legibles y correctamente formateados, `surface` con leyenda
textual explícita de sus 3 ejes ("EJE X: TIEMPO · EJE Z: SENSOR · ALTURA/
COLOR: VALOR"), `geomap` con imagen satelital real georreferenciada de Mina
Antamina y marcadores de sensor en su ubicación real.

**2 bugs reales, confirmados y corregidos** (ver Decisión):
1. **`histogram`**: las 10 etiquetas del eje X (rango de cada bucket)
   aparecían TODAS como el texto idéntico `"0.0–0.0"` para sensores de
   magnitud pequeña (acelerógrafos, valores ~0.010-0.030 g) — el eje era
   completamente inútil para este tipo de sensor, que es exactamente el
   caso de uso real más común en esta plataforma (geotecnia/vibraciones).
2. **`funnel`**: la etiqueta de la etapa más ancha (con línea guía más
   corta) se cortaba a mitad de palabra ("Aceleró" en vez de "Acelerógrafo
   Triaxial ACEL-03 (Tajo) (g)"), incluso en el modal ampliado — mientras la
   etapa más angosta sí mostraba el texto completo. Mismo síntoma
   (recorte duro por el `overflow:hidden` del contenedor, sin
   `width`+`overflow` explícito en la config de ECharts) se confirmó también
   en `pie`/`donut` (ahí como "Acelerógra…" en ambas mitades) y en
   `sunburst` (dos anillos de texto superpuestos e ilegibles) — pero SOLO en
   el layout pequeño real de exportación (2-3 gráficos por página); en el
   modal de ampliación de la UI (que NO participa del export) esos tres se
   veían bien.

**2 hallazgos menores, documentados pero no corregidos** (alcance
deliberadamente acotado, ver Trade-offs):
- `pie`/`donut`/`treemap`/`funnel` no imprimen el valor numérico ni el
  porcentaje sobre la figura — solo el nombre de la categoría (el valor SÍ
  se representa visualmente por el tamaño del segmento/rectángulo, y el
  valor exacto está disponible en el tooltip al pasar el cursor, pero no es
  texto estático en el PDF).
- `radar` con solo 2 sensores/ejes produce una figura degenerada (un
  segmento, no un polígono) — limitación de datos de prueba (2 sensores),
  no de código; con 3+ ejes el mismo `chartType` sí produce un polígono real
  (código no acotado a 2, `radar.indicator` es dinámico por cantidad de
  `selections`).

## Decisión

1. **Fix `histogram`** (`SensorMultiChartWidget.tsx`, bloque
   `chartType === 'histogram'`): decimales de las etiquetas de bucket ya no
   son un `.toFixed(1)` fijo — se derivan del ancho real de cada bucket
   (`span / BINS`) vía `Math.ceil(-Math.log10(binWidth)) + 1`, acotado entre
   0 y 6 decimales. Para acelerógrafos (bucket ~0.002 g) esto da 4
   decimales (`"0.0100–0.0120"`, distinguibles); para sensores de magnitud
   grande (p.ej. bucket=10) da 0 decimales (`"10–20"`, sin decimales
   innecesarios) — no es un valor fijo nuevo, se adapta a cualquier unidad.
2. **Fix `pie`/`donut`/`funnel`**: se agrega `label: { ..., overflow:
   'truncate', width: N }` (110px para pie/donut, 100px para funnel) — con
   esto ECharts trunca el texto con "…" de forma prolija cuando no entra,
   en vez de dejar que el `overflow:hidden` del contenedor lo corte en un
   punto arbitrario (a veces a mitad de palabra). Para `funnel` esto solo
   resultó suficiente DESPUÉS de angostar también la forma
   (`left:'4%', width:'52%'`, antes `'8%'`/`'84%'`) — ver "Actualización
   2026-09-13" arriba: con el embudo ocupando casi todo el canvas, la
   etapa más ancha no tenía margen real donde el `overflow` pudiera actuar.
   El nombre completo sigue disponible en el tooltip y en el panel
   "SENSORES" de la izquierda (siempre visible, sin recortar).
3. **`sunburst`** queda sin cambio de código en esta pasada — el
   solapamiento observado es una consecuencia del mismo patrón
   (`label.overflow` no configurado) pero con 2 anillos concéntricos en vez
   de una etiqueta; requiere una solución distinta (radios/posiciones
   dependientes de profundidad) fuera del alcance acotado de este cierre —
   **queda documentado como hallazgo abierto, no descartado**.
4. **Rebuild y redeploy real**: `docker compose build frontend` (imagen
   `informecliente-frontend`, nginx sirviendo el build de Vite) +
   `docker compose up -d frontend` contra el stack real — `beemetry-web`
   recreado con el fix.

## Verificación

- **Test de regresión nuevo**:
  `SensorMultiChartWidget.histogram.test.tsx` — mockea `echarts-for-react`
  (captura el `option` real en vez de renderizar canvas), `lib/api`
  (`fetchTelemetryWizardSeries` rechaza, forzando el camino de datos de
  prueba real de la app) y `lib/sensorMockData` (devuelve 40 lecturas en
  `[0.010, 0.029]`, el mismo orden de magnitud del bug real). Verificado en
  ambas direcciones: **falla contra el código viejo** (`Set(labels).size`
  da 1, no 10 — confirmado revirtiendo el fix temporalmente y corriendo el
  test) y **pasa contra el código corregido** (10 etiquetas, todas
  distintas, ninguna es `"0.0–0.0"`). Corrido junto a los 41 tests
  existentes de `SensorMultiChartWidget.smoke.test.tsx` (SPEC-021 T8): 42/42
  passed.
- **Export real end-to-end**: PDF (35.3 MB, 378 páginas) y PPTX (378
  diapositivas) generados contra el stack completo real, ambos
  `status: success`, verificados visualmente en el visor de lectura de la
  app (misma vista que captura el sidecar de export).
- **No verificado en esta pasada**: el fix del frontend recién desplegado
  no se volvió a exportar a PDF/PPTX para confirmar visualmente el ANTES/
  DESPUÉS en el archivo exportado en sí (se verificó el fix contra el
  visor en vivo, que es la fuente que el export captura, y contra el test
  automatizado — no se generó un tercer PDF post-fix por tiempo de la
  sesión, ~4-5 min adicionales de export).

## Consecuencias

### Positivas
- Cierra T9 con evidencia real (export real + verificación visual +
  test automatizado), no solo inspección de código.
- Corrige un bug que afectaba específicamente al caso de uso más común de
  la plataforma (sensores geotécnicos de magnitud pequeña: acelerógrafos,
  inclinómetros, extensómetros) en uno de los 20 tipos de gráfico
  disponibles.
- El test de regresión queda en el gate de CI (`ci.yml` ya corre
  `npm run test:run` sin condición, mismo mecanismo que T10 ya documentó).

### Negativas / Trade-offs
- `sunburst` queda con un hallazgo de legibilidad SIN corregir — decisión
  deliberada de acotar el alcance de este cierre a fixes de una línea/bajo
  riesgo (histogram, pie/donut, funnel comparten la misma solución
  `overflow:'truncate'`; sunburst necesita rediseñar el label del anillo
  interior, que es un cambio de mayor alcance).
- Los tipos "proporcionales" (pie/donut/treemap/funnel) siguen sin mostrar
  el valor/porcentaje como texto estático sobre la figura — deliberado por
  ahora (el tooltip y el panel de sensores ya lo cubren), pero queda
  como mejora posible si Gerencia lo pide para el PDF impreso (donde no hay
  tooltip interactivo).
- El PDF/PPTX ya generados en la Verificación son del código VIEJO (antes
  del fix) — sirven como evidencia del bug, no de la corrección. Un
  re-export post-fix queda pendiente si se requiere el archivo final como
  evidencia visual directa (el test automatizado + la verificación en el
  visor en vivo ya prueban la corrección igual de rigurosamente).

## Referencias
- `frontend/src/components/ReportStudioV2/components/document/InsertBlocks/SensorMultiChartWidget.tsx`
  (bloques `histogram`, `pie`/`donut`, `funnel`)
- `frontend/src/components/ReportStudioV2/components/document/InsertBlocks/SensorMultiChartWidget.histogram.test.tsx` (nuevo)
- `frontend/src/components/ReportStudioV2/components/document/InsertBlocks/SensorMultiChartWidget.smoke.test.tsx` (SPEC-021 T8, sin cambios, 41/41 sigue pasando)
- `specs/021-analitica-multiserie-zonas-sensores/tasks.md` (T9)
- ADR-179 (pipeline de export real, SPEC-005), ADR-016/083 (arquitectura de
  export server-side, misma vista capturada)
