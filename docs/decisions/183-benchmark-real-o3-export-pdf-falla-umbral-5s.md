# ADR-183 — SPEC-007 T15: benchmark real de O3 (export PDF <5s) — medido contra el stack real, NO cumple el umbral

**Status**: measured, real (no simulado) — **criterio O3 actualmente NO se cumple**; causa raíz diagnosticada, fix de arquitectura NO implementado en esta pasada (fuera del alcance pedido: "implementar la prueba automatizada")

**Fecha**: 2026-09-13

**Autores**: Luder Armas (pedido explícito: "implementame esta prueba automatizadamente... para cerrar esto"), con Claude Code

**Ámbito**: reports

**Relación**: cierra SPEC-007 T15 (medición pendiente desde su `tasks.md`
original) — pero cerrar la TAREA (construir y correr la medición) no es lo
mismo que cerrar el CRITERIO (O3 sigue sin cumplirse). Ver `specs/BACKLOG.md`
para el estado consolidado.

## Contexto

El `tasks.md`/`spec.md` de SPEC-007 definen O3 como "exportación de un
informe a PDF/Word en **< 5 s**" y T15 como el test que mide ese criterio
contra un informe real de 50 páginas. Hasta esta sesión, T15 estaba abierto
por falta de una medición real (la arquitectura async del pipeline de
export ya estaba verificada, ADR-016, pero nunca se había cronometrado un
caso concreto de ese tamaño).

Con el stack completo corriendo, se buscó un informe REAL (no fabricado
para la prueba) cercano a 50 páginas, evitando tanto los casos triviales
(1-2 páginas) como los documentos de stress-test de esta misma sesión
(378 páginas / 1120 gráficos, ver ADR-182) que no representan un informe
típico. Se encontraron dos candidatos reales del tenant Alpayana:

| Informe | Páginas | Composición |
|---|---|---|
| "Prueba Integral de Sensores y Diagramas — Alpayana" | 56 | 1 `sensor_multi_chart` por página + header/footer |
| "Informe Técnico Integral — Catálogo Completo de Sensores y Diagramas" | 63 | carátula, TOC, texto (19 bloques), 1 tabla, 1 imagen, 56 `sensor_multi_chart` |

## Medición

Export PDF real (`POST /api/reports/{id}/export/pdf` → polling de
`GET .../export/jobs/{jobId}` hasta `status=success`), tiempo calculado con
`completed_at - started_at` **del reloj del servidor** (Postgres), no del
cliente — evita contaminar la medición con latencia de red del polling.
Script reutilizable: `scripts/benchmark-export-o3.browser.js`.

| Informe | Páginas | Tiempo real | ms/página | vs. umbral (5s) |
|---|---|---|---|---|
| 56 páginas | 56 | **29,38 s** | ~524 ms/pág | **5,9× por encima** |
| 63 páginas | 63 | **28,92 s** | ~459 ms/pág | **5,8× por encima** |

Extrapolado a exactamente 50 páginas (interpolando la tasa medida):
**~23-26 segundos** — sigue siendo **~5× el umbral de O3**, no un margen
menor que pudiera deberse a ruido de medición.

**Ambos exports terminaron con éxito** (`status: success`, sin errores) —
esto NO es un fallo funcional del pipeline, es un fallo de **tiempo**
contra un criterio de rendimiento específico.

## Diagnóstico (causa raíz real, no solo el síntoma)

`pdf-export-service/server.js` activa un modo "virtualizado" para
cualquier informe con más de `EXPORT_VIRTUALIZATION_PAGE_THRESHOLD = 25`
páginas (`frontend/src/components/ReportStudioV2/components/viewers/ReadOnlyViewer.tsx`).
**Un informe de 50 páginas cae directo en este régimen** — no es un caso
límite raro, es exactamente el tamaño que T15 pide medir.

En modo virtualizado, cada página se procesa así (`capturePdfPagesOnWorker`,
`waitForPageWidgetsReady`): monta SOLO esa página
(`setExportActivePage`, desmontando cualquier otra y liberando sus widgets
ECharts/Leaflet/WebGL), espera a que sus widgets reporten
`data-export-ready="true"` (polling real, sin sleep fijo — confirmado
leyendo el código, no hay un `setTimeout` arbitrario), y recién ahí llama
`page.pdf()` para esa hoja. Esto se repite página por página, **en serie
dentro de cada worker**, con `PDF_CAPTURE_PARALLELISM = 4` workers en
paralelo (4 procesos Chromium dedicados, cada uno con su propio tramo de
páginas).

La combinación real: ~2 s por página por worker (montar + esperar widgets
+ `page.pdf()`) ÷ 4 workers en paralelo ≈ 25-30 s de pared para 50-63
páginas — exactamente lo medido. El diseño virtualizado existe
DELIBERADAMENTE para documentos GRANDES (evita que Chromium tenga que
montar cientos/miles de páginas de gráficos simultáneamente, lo cual
directamente crashea o agota memoria — ver el propio comentario del código
sobre `PAGES_PER_BROWSER_PAGE=40` y el caso real de 378 páginas de ADR-182).
El problema es que el umbral de activación (25 páginas) es **mucho más
bajo** que el tamaño que O3 exige que sea rápido (50 páginas) — el informe
que O3 pide medir cae siempre en el camino lento, nunca en el rápido
(documento completo montado de una vez, sin esperas por página).

## Actualización 2026-09-13 (misma sesión) — ¿alcanzaría con solo texto?

Pregunta real del usuario: si el informe fuera SOLO texto (sin tablas,
imágenes, sensores ni mapas), ¿se cumpliría el umbral de 5s? Se separó,
con los logs reales del sidecar (`docker logs beemetry-pdf-export`), el
costo **fijo** (arrancar cada worker Chromium + primera página lista) del
costo **marginal** (cada página adicional, con el navegador ya
"caliente"), usando además un tercer informe real y liviano (11 páginas,
"Informe Técnico Integral de Monitoreo — Alpayana", solo 4
`sensor_multi_chart` en 11 páginas, mayormente `text`):

| Informe | Contenido | Arranque worker (1ª página) | Marginal por página adicional |
|---|---|---|---|
| 11 páginas | mayormente texto | ~3,26 s | **~627 ms/pág.** |
| 56 páginas | 1 gráfico/página | ~4,0 s | ~1,7-1,9 s/pág. |
| 63 páginas | mixto (texto+tabla+imagen+gráficos) | ~4,0 s | ~1,7-1,9 s/pág. |

**Respuesta con evidencia real: tampoco alcanzaría, pero se acerca mucho
más.** Extrapolando la tasa liviana a 50 páginas (÷4 workers ≈ 12-13
páginas/worker): ~3,5-4s de arranque + ~12 páginas × 0,6s ≈ **11-14
segundos totales** — sigue siendo ~2,5-3× el umbral de 5s (vs. ~5,9× con
gráficos), pero NO lo cumple.

**Causa estructural, no de contenido**: el costo fijo de arrancar cada uno
de los 4 procesos Chromium dedicados (`PDF_CAPTURE_PARALLELISM = 4`) por sí
solo (~3,5-4s) ya consume el 70-80% del presupuesto completo de 5
segundos, ANTES de renderizar una sola página — con o sin gráficos. Esto
cambia la opción 1 de la Decisión original ("subir el umbral de
virtualización a >50 no alcanza por sí sola"): incluso un documento que
nunca active el modo virtualizado sigue pagando el mismo arranque de
Chromium por worker. La opción real más prometedora para el rango
"documento liviano de 50 páginas" sería **reutilizar un pool de
instancias Chromium ya arrancadas** (en vez de lanzar 4 procesos nuevos
por cada job) — no evaluado en profundidad en esta pasada, queda como
la vía más concreta para una futura optimización.

## Actualización 2026-09-13 (misma sesión) — ¿por qué el tiempo de export creció con el tiempo?

Pregunta real del usuario: justificar el incremento de tiempo como
producto de (a) las mejoras del editor con funcionalidades básicas/
intermedias/avanzadas para Word/PowerPoint/PDF, y (b) el soporte agregado
para exportaciones muy grandes. Se verificó cada parte contra el código y
su historial real (`git log -p -S`, comentarios fechados en el propio
código) en vez de aceptar la hipótesis sin más:

**(b) Soporte para exportaciones muy grandes — CONFIRMADO, es la causa
dominante.** El propio código documenta, con fecha y evidencia real, por
qué existe el modo "virtualizado" que activa T15: sin él, un informe
grande "monta TODOS sus widgets de sensor (ECharts + Leaflet + Three.js/
WebGL) al mismo tiempo" y la contención de CPU/GPU resultante hacía que
"cada captura individual... empezara a expirar" — reproducido en vivo con
un informe real de **378 páginas / 1120 gráficos** (falló sin
virtualización) y, en una iteración posterior, con uno de **2104 páginas
/ 6300 diagramas** (ADR-170, ~145 min proyectados incluso CON
virtualización). El propio `EXPORT_VIRTUALIZATION_WINDOW` se subió de 1 a
6 tras encontrar que, con margen más chico, las peticiones de telemetría
de un widget se abortaban a mitad de vuelo (`net::ERR_ABORTED`) porque la
página se desmontaba antes de que la consulta completara bajo la carga de
"miles de peticiones concurrentes de un export grande". Esta arquitectura
(montar una página a la vez, reciclar el navegador cada 40 hojas, 4
workers dedicados) es exactamente lo que hace posible exportar documentos
de esa escala sin que Chromium crashee — y es también, medido en esta
sesión, la causa de que un documento de apenas 50 páginas pague un piso
fijo de ~3,5-4s de arranque de Chromium por worker antes de renderizar
nada. **Es un trade-off real y verificable, no una excusa**: la capacidad
de exportar 2104 páginas de forma confiable y la lentitud de un export de
50 páginas son la misma decisión de arquitectura vista desde dos lados.

**(a) Mejoras del editor (Word/PowerPoint/PDF) — matiz importante, NO
confirmado en la forma planteada.** Se verificó qué componentes participan
realmente en la espera que ejecuta cada captura de página
(`data-export-widget`/`data-export-chart`/`data-export-ready`, la señal
que `waitForPageWidgetsReady` espera antes de imprimir): **solo
`SensorMultiChartWidget`, `SensorGeoMapPanel` y `SensorSurface3DPanel`**
participan de ese gate. Tablas (incluido el motor de fórmulas de
ADR-172), KPIs, imágenes, video, texto con formato avanzado y las
capacidades de editor de ADR-174 **no** hacen esperar la captura ni un
milisegundo adicional — solo afectan la edición y los formatos DOCX/PPTX
propios, no el bucle de captura página-por-página del PDF. Lo que sí es
real y medible: el **catálogo de tipos de gráfico de sensor creció de 10 a
20** esta misma semana (SPEC-021, ver ADR-182) — incluyendo tipos con
inicialización más pesada (Superficie 3D vía Three.js/WebGL, Mapa vía
Leaflet con tiles, Sunburst/Treemap/Heatmap con layouts más complejos que
un simple line/bar) — y la diferencia real medida entre el informe liviano
(4 gráficos/11 páginas, ~627ms marginal/página) y los pesados (1
gráfico/página, ~1,7-1,9s marginal/página) es consistente con que
renderizar-y-confirmar-listo un gráfico de sensor cuesta bastante más que
una página sin ninguno. **No hay, sin embargo, una medición histórica
"antes del catálogo de 20 tipos" para cuantificar cuánto de esa diferencia
es específicamente atribuible al crecimiento del catálogo** — la
comparación liviano-vs-pesado de esta sesión es real, pero no aísla esa
variable de otras (p.ej. cuántos sensores por gráfico, rango de fechas).

**Conclusión honesta**: el soporte para exportaciones muy grandes explica
la arquitectura (y su costo fijo dominante) con evidencia directa y
fechada del propio código; el crecimiento de funcionalidades del editor
explica una parte real pero más chica del costo marginal por página, y
específicamente por el catálogo de GRÁFICOS DE SENSOR (no por Word/PPTX en
general, que no participan de este cuello de botella).

## Decisión

**Se implementa y deja funcionando el benchmark automatizado** (lo pedido
explícitamente esta sesión) — `scripts/benchmark-export-o3.browser.js`,
reutilizable contra cualquier informe real futuro, con salida PASS/FAIL
clara contra el umbral de 5 s.

**No se modifica la arquitectura de export en esta pasada.** Cerrar la
brecha real (~5× sobre el umbral) requeriría una de estas opciones, cada
una un cambio de diseño no trivial, fuera del alcance de "implementar la
prueba":
1. Subir `EXPORT_VIRTUALIZATION_PAGE_THRESHOLD` bien por encima de 50 (p.ej.
   100) — soluciona el caso de O3, pero reintroduce el riesgo de crash/OOM
   documentado que la virtualización existe para evitar, para el rango
   26-99 páginas.
2. Subir `PDF_CAPTURE_PARALLELISM` de 4 a un número mayor — reduce el
   tiempo de pared linealmente, pero multiplica el uso de CPU/RAM (4
   procesos Chromium dedicados ya corren simultáneos; duplicar/cuadruplicar
   eso en un host con recursos compartidos con el resto de la plataforma
   real es una decisión de capacidad, no solo de código).
3. Rediseñar el camino virtualizado para pre-cargar/pre-renderizar varias
   páginas en paralelo DENTRO de un mismo worker (pipeline en vez de
   estrictamente secuencial) — el cambio de mayor alcance, pero el que más
   ataca la causa real sin gastar más recursos por igual.
4. Redefinir qué significa "informe de 50 páginas real" para O3 — si el
   caso de negocio real casi siempre tiene MENOS gráficos por página que
   los informes de prueba usados acá (1 `sensor_multi_chart` por página),
   un documento de 50 páginas mayormente de texto podría no activar el
   mismo costo por widget. No verificado en esta pasada — los dos informes
   medidos SÍ tienen contenido con gráficos reales, que es el caso de uso
   real de la plataforma (informes técnicos de monitoreo), no un caso
   artificialmente pesado.

Cualquiera de estas requiere una decisión de Gerencia/arquitectura sobre
el trade-off (velocidad vs. riesgo de crash vs. costo de cómputo), no es
una corrección de una línea como los bugs de SPEC-021 T9 (ADR-182).

## Verificación

- **Medición real, dos veces** (informes de 56 y 63 páginas), ambas contra
  el stack completo corriendo (`beemetry-api`, `beemetry-pdf-export`,
  `beemetry-db` reales), tiempos tomados del reloj del servidor.
- **Diagnóstico verificado por lectura de código real**
  (`pdf-export-service/server.js`, `ReadOnlyViewer.tsx`), no por
  suposición — el umbral de virtualización (25) y el paralelismo (4) son
  constantes explícitas en el código, citadas con su valor real.
- **No se corrigió el problema de fondo** — sería una afirmación falsa
  marcar O3/CA-3 como cumplido; se documenta el hallazgo real para que
  Gerencia decida el trade-off antes de tocar la arquitectura de export.

## Consecuencias

### Positivas
- T15 (la TAREA: "medir") queda cerrada con una medición real, repetible,
  documentada — ya no es una incógnita.
- Se identifica la causa raíz exacta (no un síntoma vago) con una cita
  directa al código, lista para que cualquier desarrollador futuro decida
  entre las 4 opciones de la sección Decisión sin tener que re-investigar.
- El script de benchmark queda disponible para re-medir después de
  cualquier cambio futuro al pipeline de export, sin tener que reconstruir
  esta investigación desde cero.

### Negativas / Trade-offs
- **O3/CA-3 sigue sin cumplirse** — este ADR no cierra ese compromiso de
  negocio, solo lo cuantifica con precisión. Gerencia debe decidir si el
  umbral de 5s se ajusta, si se prioriza un rediseño del export, o si se
  acepta el tiempo actual para este rango de tamaño.
- Los dos informes medidos son reales pero no fueron construidos
  específicamente como "el informe de 50 páginas de referencia" oficial de
  la plataforma — si Gerencia tiene un caso de uso más liviano en mente
  para O3, el resultado podría variar (ver opción 4 de la Decisión).

## Referencias
- `scripts/benchmark-export-o3.browser.js` (nuevo, benchmark reutilizable)
- `pdf-export-service/server.js` (`EXPORT_VIRTUALIZATION_PAGE_THRESHOLD` uso,
  `PDF_CAPTURE_PARALLELISM`, `capturePdfPagesOnWorker`,
  `waitForPageWidgetsReady`)
- `frontend/src/components/ReportStudioV2/components/viewers/ReadOnlyViewer.tsx`
  (`EXPORT_VIRTUALIZATION_PAGE_THRESHOLD = 25`)
- `specs/007-editor-informes-reportstudio/tasks.md` (T15, O3/CA-3)
- [[182]] (benchmark real de export usado como referencia de metodología, 378 páginas)
- ADR-170 (evaluación previa de export de documentos extensos — mismo tipo
  de hallazgo, escala distinta)
