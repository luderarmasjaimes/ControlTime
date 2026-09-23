# ADR-184 — SPEC-007 T15/O3: dos optimizaciones reales del export (sin afectar documentos grandes), medidas con instrumentación real

**Status**: implemented, verificado en vivo con instrumentación de timing real contra 4 informes reales (11, 56, 63 y 378 páginas)

**Fecha**: 2026-09-13

**Autores**: Luder Armas (pedido explícito: "analizar si es factible mejorar estos tiempos sin perjudicar el procesamiento de documentos muy grandes... revisa si hay algún BUG o alguna mejora que podamos realizar"), con Claude Code

**Ámbito**: reports

**Relación**: profundiza ADR-183 (benchmark real de O3, que documentó el
techo de arquitectura pero no intentó optimizarlo). Este ADR SÍ investiga
y corrige, con evidencia medida antes/después.

## Contexto

ADR-183 había atribuido el costo fijo de ~3,5-4s por worker principalmente
al arranque de Chromium. Para decidir si valía la pena optimizar sin
arriesgar los documentos grandes (2104 páginas/6300 diagramas, ADR-170),
se instrumentó el sidecar (`pdf-export-service/server.js`) con timing real
por fase (`TIMING_DIAG`, temporal) contra jobs reales — no simulados.

## Hallazgo 1: el diagnóstico de ADR-183 estaba parcialmente equivocado

Medido en vivo contra el informe de 11 páginas: `launch` (arrancar el
proceso Chromium) es **~200-300ms**, no ~3,5-4s. El costo real estaba en
`page.goto(url, {waitUntil: 'networkidle0'})`, que tardaba **~3-3,6s**.

## Hallazgo 2 (bug real): `document.fonts` dependía de Google Fonts en un Chromium sin caché

`print-report.html` cargaba Inter/Barlow/Outfit/Rajdhani desde Google
Fonts. Cada worker es un proceso Chromium **completamente nuevo, sin
caché de disco** (decisión deliberada, ver ADR-183/comentario de
`launchDedicatedExportBrowser` — evita una serialización interna medida
en vivo al compartir un proceso entre workers) — así que cada uno pagaba
una descarga externa real de fuente en cada arranque, con un timeout de
respaldo de 4s ya documentado en el propio código
(`print-report/main.tsx`) para ese escenario de "arranque en frío".

**Fix**: auto-hospedar los mismos archivos `.woff2` que servía Google
(subset "latin", cubre español) en `frontend/public/fonts/`, generados
directamente desde la respuesta real de la API de Google Fonts (mismos
bytes, sin re-codificar). `print-report.html` ahora enlaza
`/fonts/local-fonts.css` en vez del `<link>` externo — cero cambio de
fidelidad visual (mismas fuentes, mismos pesos), solo sin la ida y vuelta
de red externa. **Medido: no fue el factor dominante** (`goto` no bajó
significativamente solo con este cambio) — ver Hallazgo 3.

## Hallazgo 3 (bug real, el dominante): `networkidle0` es una condición redundante y más estricta de lo necesario

Se instrumentó también `print-report/main.tsx` (timing interno por paso:
fetch del informe, prefetch de telemetría, espera de fuentes, 2 frames) y
se leyó desde el sidecar vía `page.evaluate()` justo al resolver `goto()`.
Resultado real (informe de 11 páginas, worker típico): la app señala estar
lista en **~370ms** desde que arranca su propio `useEffect` — pero
`goto()` seguía bloqueado **~1,6s MÁS** después de eso, esperando que la
red quedara en absoluto silencio (`networkidle0` exige cero peticiones en
vuelo por 500ms).

Esto es un desperdicio real y evitable: las 4 funciones que abren páginas
en el sidecar (`openReportPage`, el worker de PDF, y las páginas de
descubrimiento de PPTX/DOCX) **ya llaman `waitForReportRender(page)`
inmediatamente después de `goto()`** — esa función SÍ verifica la
condición real y completa (`window.__PDF_READY__`, widgets/gráficos
listos, fuentes, imágenes). `networkidle0` en `goto()` es una segunda
espera redundante, más estricta de lo que hace falta, y vulnerable a
cualquier actividad de red residual ajena a la lectura real (polling,
telemetría en curso, etc.).

**Fix**: bajar `waitUntil` de `'networkidle0'` a `'domcontentloaded'` en
las 4 funciones. `waitForReportRender` queda como la única fuente de
verdad de "listo" — ninguna garantía de fidelidad se debilita, solo se
deja de pagar una espera que no aportaba nada real.

## Verificación (antes → después, mismo informe, mismo método de medición)

| Informe | Antes (ADR-183) | Después (este ADR) | Mejora |
|---|---|---|---|
| 11 páginas (mayormente texto) | 6,32s | **4,57s** | -28% |
| 56 páginas (1 gráfico/página) | 29,38s | **26,77s** (26,23s en 2ª corrida) | -9% |
| 63 páginas (mixto: texto+tabla+imagen+gráficos) | 28,92s | **27,20s** | -6% |
| 378 páginas / 1120 gráficos (documento de stress-test real, ver ADR-182) | 278s (4m38s) | **272s (4m32s)** | -2%, sin regresión |

Desglose real por worker (informe de 11 páginas, vía `TIMING_DIAG`):
`launch` ~200-300ms (sin cambio, nunca fue el problema), `goto` bajó de
~3-3,6s a **~0,77-1,58s**, `waitRender` (la espera real) ahora absorbe
correctamente el tiempo que antes desperdiciaba `goto` (~0,6s) — el total
por worker bajó de ~3,3-3,9s a **~1,7-2,5s**.

**Ningún fallo de captura nuevo**: los 3 exports post-fix (11, 56, 63
páginas) terminaron `status: success`, `captureFailures: 0`,
`missingHandleCount: 0`. Se observaron 2 avisos `widgets_no_listos`
(páginas 20 y 40 del informe de 56 páginas) — **reproducidos de forma
IDÉNTICA en dos corridas distintas** (mismas páginas, mismos workers), lo
que confirma que es una característica real de esas páginas específicas
del documento (probablemente latencia real de un query de telemetría para
ese sensor/rango puntual), no una regresión de este cambio — el timeout de
15s por página (`PAGE_WIDGET_READY_TIMEOUT_MS`) que lo maneja es
independiente de `goto()` y no fue tocado. La exportación capturó esas 2
páginas "tal como estaban" (comportamiento ya diseñado) sin fallar el
export completo.

## Consecuencias

### Positivas
- Mejora real y medida para documentos chicos/medianos (hasta -28%),
  ayuda directa al caso de O3 sin resolverlo del todo (ver ADR-183 para el
  techo restante: arranque de Chromium + captura real por página).
- El fix de `domcontentloaded` beneficia TAMBIÉN a documentos grandes: el
  worker se reabre cada `PAGES_PER_BROWSER_PAGE` (40) hojas — un documento
  de 2000+ páginas paga este ahorro decenas de veces por worker a lo largo
  del export completo, no solo una vez.
- Cero riesgo para la garantía de fidelidad visual: `waitForReportRender`
  (widgets, fuentes, imágenes) sigue exactamente igual de estricto,
  solo dejó de estar duplicado por una condición de red redundante.
- Fuentes auto-hospedadas eliminan además una dependencia de red externa
  real durante el export (`fonts.gstatic.com`) — mejora de confiabilidad,
  no solo de velocidad.

### Negativas / Trade-offs
- No cierra el criterio O3 (<5s/50 páginas) — sigue por encima del umbral,
  ver ADR-183 para el análisis completo de por qué (costo fijo de
  arranque de Chromium + captura real por página con contenido de
  sensores). Este ADR mejora el tiempo real, no lo resuelve del todo.
- La instrumentación `TIMING_DIAG`/`__PRINT_TIMING__` cumplió su propósito
  y se retiró del código tras confirmar el fix (verificado: export de 11
  páginas post-limpieza sigue en ~4,6s, sin logs de diagnóstico).
- Los 2 avisos `widgets_no_listos` observados no se investigaron a fondo
  (causa exacta de la lentitud de esas 2 páginas puntuales) — quedan
  documentados como hallazgo menor, no bloqueante, para una futura
  revisión si se repiten con más frecuencia.

## Referencias
- `pdf-export-service/server.js` (`openReportPage`, `openExportWorkerPage`,
  y las 2 páginas de descubrimiento PPTX/DOCX — las 4 con `waitUntil`
  bajado a `domcontentloaded`)
- `frontend/print-report.html` (fuentes auto-hospedadas)
- `frontend/public/fonts/` (nuevo: `local-fonts.css` + 8 archivos `.woff2`)
- `frontend/src/print-report/main.tsx` (instrumentación temporal de timing)
- [[183]] (benchmark original, diagnóstico de arquitectura)
- [[170]] (evaluación de capacidad para documentos extensos, 2104 pág./6300 diagramas — el caso real que motivó la arquitectura que este ADR respeta)
