# ADR-084 — Conversión de PPTX a video narrado (ffmpeg) por diapositiva

**Status**: implemented (verificado 2026-08-03: build Docker del backend 100% con tests passed; build Docker del sidecar con `ffmpeg`/`adm-zip` instalados; pipeline completo probado con ffmpeg real — extracción de imágenes desde un `.pptx` real, video de duración variable por diapositiva, pista de audio compuesta y mezcla final, con verificación por color de píxel en frames extraídos a `t=1s/3s/5s`, no solo por duración reportada)
**Fecha**: 2026-08-03
**Autores**: EC
**Ámbito**: reports
**Relación**: depende de ADR-083 (reutiliza las imágenes de fondo que produce `/render-pptx`, mismo job `report_export_job`); mismo patrón de contenedor sidecar que ADR-080 (ffmpeg agregado junto a `qpdf`); activa `report_export_job_asset`, tabla nueva de esta misma familia; **no relacionado con ADR-062/064/065** pese a compartir la palabra "video" — ver Contexto para el deslinde explícito; corrige una brecha RBAC real encontrada durante esta misma implementación (ver Decisión); refina el alcance de O3 de ADR-023, igual que ADR-083 (ver actualización agregada a ese ADR).

## Contexto

`report_export_job.export_format` ya incluía `'mp4'` desde el diseño
original del schema (`db_scripts/19`), sin código que lo usara — misma
situación que `'pptx'` antes de ADR-083.

**Deslinde de nombres, explícito y deliberado**: `RibbonToolbar.tsx` ya
tenía un grupo "Video" con un botón "Grabar" (`onExportVideo` →
`handleRecordScreenToCanvas`, ADR-062/064/065) que **inserta** una grabación
de cámara/pantalla como bloque de contenido en el lienzo — una capacidad
completamente distinta a "convertir el informe ya exportado a PPTX en un
archivo de video". Para no repetir el tipo de ambigüedad que ese mismo ADR
ya gestionó con cuidado (dos orígenes de grabación bajo un mismo botón,
luego separados en ADR-064/065 por pedido de Gerencia), este ADR usa nombres
de handler/prop **distintos y no superpuestos**: `onExportPptxVideo`/
`handleConvertPptxToVideo` (nuevo) conviven con `onExportVideo`/
`handleRecordScreenToCanvas` (sin tocar, ADR-062) en el mismo componente,
en el mismo grupo "Video" del ribbon, como dos botones separados
("Grabar" vs. "Convertir a MP4").

El usuario pidió explícitamente, tras una ronda de preguntas de
clarificación, que la conversión a video incluyera narración (audio grabado
o notas del orador por diapositiva) en vez de solo un video mudo con
duración fija — la opción de mayor alcance de las presentadas.

## Decisión

### Reutilizar imágenes ya generadas, no re-renderizar
`POST /render-video` extrae los PNG de fondo directamente del `.pptx` que ya
generó `/render-pptx` (`ppt/media/image-{slideIndex}-{n}.png`, vía
`adm-zip`) en vez de volver a invocar Puppeteer — garantiza fidelidad
visual idéntica al `.pptx` de origen (literalmente los mismos bytes de
imagen) y es más barato. **Hallazgo real durante la implementación**: la
suposición inicial (`image1.png`, `image2.png`... secuencial) era
incorrecta — inspeccionar un `.pptx` real generado mostró que `pptxgenjs`
nombra los archivos `image-{índiceDeSlide}-{índiceEnLaSlide}.ext`. El código
se escribió y quedó documentado contra el nombre real verificado, no contra
la suposición inicial.

### Dos transiciones, una de ellas condicionada por la narración
`'cut'` (demuxer `concat` de ffmpeg, verificado con `ffprobe` contra
duración/resolución esperadas) y `'crossfade'` (cadena de filtros `xfade`,
offsets acumulados verificados a mano contra ffmpeg real). **Con narración
presente, `'crossfade'` se degrada automáticamente a `'cut'`**: no hay una
forma simple de mantener el audio sincronizado con el solapamiento visual
entre diapositivas del fundido — se documenta la limitación en vez de
entregar un resultado desincronizado.

### Narración: adjunta al job PPTX, no al job de video
`POST .../export/jobs/{jobId}/narration/{pageNumber}` (`{jobId}` = el job
`pptx`, la identidad estable del "mazo de diapositivas") acepta **audio
grabado** (cuerpo binario, `Content-Type audio/*`, escrito a
`BEEMETRY_EXPORT_DATA_ROOT/narration/{jobId}/{page}.<ext>`,
`report_export_job_asset.kind='recorded_audio'`) o **notas del orador**
(JSON `{"speaker_notes":"..."}`, `kind='tts_from_notes'`, texto sin audio —
sin proveedor TTS integrado todavía, deliberadamente diferido y documentado,
no ignorado en silencio). Al crear el job de video
(`POST .../export/pptx/{jobId}/video`), el backend lee
`report_export_job_asset` de ESE job pptx y se los pasa al sidecar; el
sidecar usa lo que puede (`recorded_audio` con `storage_uri`) y silencia el
resto (incluidas las `tts_from_notes` sin audio) — la página queda muda,
nunca falla el job completo por narración incompleta.

### Duración por diapositiva, extendida para no cortar audio
Cada diapositiva dura al menos la duración base configurada; si tiene
narración grabada, se extiende a `max(base, duración_audio + 0.5s)`.
Verificado de punta a punta con un mux real: 3 diapositivas
(`[1.5, 2.5, 1.5]`s, la del medio narrada con 2s de audio) → video final de
duración correcta, con el color de píxel correcto extraído en `t=1s`
(diapositiva 1), `t=3s` (diapositiva 2, dentro de su narración) y `t=5s`
(diapositiva 3) — no solo la duración reportada por `ffprobe`.

### Bug real encontrado y corregido, no solo diseñado alrededor
Mezclar el video mudo (VFR — pocos paquetes reales, uno por diapositiva, con
duraciones de presentación largas entre ellos) con la pista de audio usando
`-c:v copy -shortest` **truncaba contenido visual real** (~4s de un video de
5.5s) pese a que `ffprobe` reportaba la duración del contenedor como
correcta (5.5s) — solo se detectó extrayendo el frame real en varios
timestamps y confirmando que no había contenido después de los ~4s
(`ffmpeg` devolvía "Output file is empty" al buscar más allá). Corregido
recodificando a framerate constante (`-r 25 -c:v libx264`) en el paso de
mezcla en vez de copiar el stream — verificado de nuevo con el mismo método
de extracción de frame + color de píxel, ahora correcto en los tres
timestamps. El comentario en `muxVideoWithAudio` (`server.js`) documenta el
motivo exacto para que un refactor futuro no reintroduzca `-c:v copy` ahí
por parecer una optimización obvia.

### Brecha RBAC encontrada y cerrada en este mismo ADR
La subida de narración inicialmente reutilizaba el mismo gate
`informes.view` que la generación/descarga de export (precedente de
ADR-080/083 para artefactos de solo lectura). Pero adjuntar narración
**contribuye contenido nuevo** al informe (audio o notas que terminan
horneados en el video final) — categóricamente más cerca de `informes.edit`
que de una acción de solo-vista, mismo criterio que ADR-079 ya aplica a
todo lo que no es lectura pura. Un rol con solo `informes.view` (p.ej.
`viewer`) podía narrar un informe que no puede editar de ninguna otra forma.
**Corregido en el mismo cambio** (siguiendo el precedente de ADR-079/063 de
cerrar la brecha encontrada dentro del propio ADR que la detecta, no dejarla
como TODO): `POST .../narration/{page}` ahora exige además `informes.edit`;
la generación/descarga del PPTX y del video permanecen en `informes.view`,
sin cambios, consistentes con el PDF.

## Consecuencias

### Positivas
- Cierra el pedido original completo: PPTX con estilo real + conversión a
  video + funcionalidad "importante" adicional (narración), no solo el
  camino mínimo.
- Activa los dos últimos valores de `export_format` que quedaban sin usar
  desde el diseño original del schema (`pptx` en ADR-083, `mp4` aquí).
- Dos defectos reales encontrados y corregidos durante la verificación (la
  convención de nombres de `pptxgenjs`, el truncamiento de video por
  `-c:v copy`), no descubiertos después en producción.
- Una brecha RBAC real encontrada y cerrada en el mismo cambio, con la misma
  disciplina que ADR-079 ya estableció para el resto del módulo de informes.

### Negativas / Trade-offs
- `crossfade` + narración es incompatible por diseño (se degrada a `cut`) —
  limitación documentada, no un resultado silenciosamente desincronizado.
- Mismo trade-off de infraestructura que ADR-072 ya acepta para GDAL: ffmpeg
  comparte CPU/memoria del contenedor `pdf_export` con Puppeteer
  (`docker-compose.yml`: 1 CPU / 1024M) — sin worker/cola dedicado; si el
  volumen de conversión de video se vuelve significativo, separar a un
  `video-export-service` liviano (sin Chromium) es un cambio de
  infraestructura después, no una reescritura (`gVideoExportUrl`/
  `gPptxExportTimeoutMs` ya están separados de `gPdfExportUrl` en la
  configuración, precisamente para dejar esa puerta abierta).
- Sin proveedor TTS: las notas de orador quedan como texto guardado, no como
  audio, hasta que se decida un proveedor (Piper u otro on-premise, en línea
  con la preferencia de soberanía de datos de ADR-001/004) — diferido
  explícitamente, mismo patrón que ADR-025 (EPP) o ADR-028→072 (GDAL) usaron
  para capacidades anunciadas pero no construidas todavía.
- Tensión con O3 (ADR-023), más pronunciada que en ADR-083: el timeout
  configurado del job de video (`BEEMETRY_VIDEO_EXPORT_TIMEOUT_MS`, hasta
  180s) es un orden de magnitud mayor que la ventana de 5s — ver la
  actualización agregada a ADR-023.
- Tope de grabación de narración: 180s por diapositiva
  (`MAX_RECORDING_SECONDS` en `NarrationModal.tsx`), escalado desde el
  precedente de 60s de ADR-062 (caso de uso distinto: narración de una
  diapositiva completa, no un clip corto de inserción) — sin un análisis de
  tamaño de almacenamiento más allá de ese precedente.

### Neutras
- `adm-zip` se fijó en la versión parcheada `0.6.0` (no la última menor
  `0.5.x`): `npm audit` durante la implementación reveló una vulnerabilidad
  alta real y publicada (GHSA-xcpc-8h2w-3j85, "crafted ZIP triggers 4GB
  memory allocation", corregida en `0.6.0`) — encontrada por control real de
  dependencias, no por suerte. El riesgo práctico era bajo (el `.pptx` que
  se descomprime siempre lo generó este mismo servicio, nunca un cliente),
  pero se corrigió de todas formas por ser gratis hacerlo.

## Alternativas descartadas

### Re-renderizar cada diapositiva vía Puppeteer para el paso de video
Duplicaría el costo de render y arriesgaría una divergencia visual entre el
`.pptx` y el `.mp4` del "mismo" export — reutilizar las imágenes ya
embebidas en el `.pptx` garantiza identidad byte-a-byte.

### Fundido cruzado sincronizado con audio
No existe una forma simple de mantener el audio alineado con el
solapamiento visual entre diapositivas de un `xfade` — se prefirió
priorizar la corrección de la narración sobre una transición más vistosa;
queda como mejora futura si el negocio lo pide explícitamente.

### Servicio de video separado (sin Chromium) desde el día uno
Correcto a mediano plazo para escalar el procesamiento de video
independientemente de la huella de memoria de Chromium, pero sin evidencia
todavía de que el volumen lo justifique — misma postura de "no ahora, pero
sin bloquear el camino" que ADR-072 adoptó para un worker raster dedicado.

## Referencias
- `pdf-export-service/server.js` (`/render-video`, `buildCutVideo`,
  `buildCrossfadeVideo`, `buildNarrationAudioTrack`, `muxVideoWithAudio`),
  `Dockerfile` (`ffmpeg`), `package.json` (`adm-zip@^0.6.0`)
- `backend/src/reports/report_routes.cpp` (`POST .../export/pptx/{jobId}/video`,
  `POST .../export/jobs/{jobId}/narration/{pageNumber}`)
- `backend/src/reports/report_export_jobs.hpp/cpp` (`runVideoExportJob`)
- `backend/src/reports/report_service.hpp/cpp` (`ExportJobAsset`,
  `upsertExportJobAssetPg`/`listExportJobAssetsPg`)
- `db_scripts/65_report_export_narration.sql` (`report_export_job_asset`, nueva; renumerado desde `44` el 2026-08-20 al resolver una colisión real de numeración, ver `docs/decisions/README.md`)
- `frontend/src/components/ReportStudioV2/components/modals/NarrationModal.tsx` (nuevo)
- `frontend/src/components/ReportStudioV2/lib/api.ts`
  (`createVideoExportJob`/`uploadSlideNarration`)
- `frontend/src/components/ReportStudioV2/components/layout/RibbonToolbar.tsx`
  (botón "Convertir a MP4", grupo "Video" — `onExportVideo` de ADR-062 sin
  modificar)
- `frontend/src/components/ReportStudioV2/App.tsx`
  (`handleConvertPptxToVideo`, `handleUploadNarrationPage`)
- `docker-compose.yml` (límites de recursos de `pdf_export`)
- ADR-023 (presupuestos de rendimiento, actualizado por este ADR), ADR-062
  (deslinde de nombres explícito), ADR-072 (trade-off de recursos
  compartidos, mismo criterio), ADR-079 (RBAC — brecha cerrada aquí con el
  mismo criterio), ADR-080 (patrón de post-procesado en el sidecar), ADR-083
  (dependencia directa — mismo job pptx, mismas imágenes)
