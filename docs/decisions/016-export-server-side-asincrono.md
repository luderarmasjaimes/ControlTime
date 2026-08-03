# ADR-016 — Export de informes: server-side asíncrono con worker

## Actualización 2026-08-03 — corrección de auditoría: el PDF nunca persistió a MinIO; ADR-083/084 fijan disco local confinado como el patrón real

Este ADR declaraba "almacenado en MinIO (ADR-009)" como destino del export.
Verificado contra el código real (`report_pdf_export.cpp`,
`report_routes.cpp`) al implementar ADR-083 (PPTX) y ADR-084 (PPTX→MP4): el
PDF **nunca pasó por MinIO** — es un proxy síncrono puro (el sidecar
devuelve los bytes en la respuesta HTTP del propio `POST /render`, el
backend los reenvía directo al cliente); no existe ni existió un paso de
persistencia a ningún almacenamiento de objetos para el PDF. La frase
"MinIO" de este ADR fue aspiracional y nunca se implementó — divergencia
real entre ADR y runtime, del mismo tipo que este log ya cerró antes
(ADR-053/068/071), encontrada aquí al construir el primer flujo de export
que sí necesita persistir un artefacto (un job PPTX/MP4 asíncrono no puede
devolver bytes en la misma respuesta que lo crea).

ADR-083/084 son los primeros en persistir de verdad un artefacto de export
— y usan **disco local confinado por variable de entorno**
(`BEEMETRY_EXPORT_DATA_ROOT`, bind-mount compartido backend↔sidecar), **no
MinIO**. Esto no es una decisión nueva en el vacío: es el mismo patrón que
ya usan, en la práctica, la galería de imágenes por tenant (ADR-047) y la
conversión GDAL a MBTiles (ADR-072, `BEEMETRY_MAPAS_DATA_ROOT`) — es decir,
**ningún flujo real de `reports`/`geo` usa MinIO hoy**, pese a que ADR-009
lo declara implemented para otro propósito (archivado Parquet de
telemetría histórica, ámbito `datos`). Se documenta la divergencia en vez
de forzar una integración real de MinIO para este caso sin que el negocio
la haya pedido explícitamente — si el volumen de artefactos exportados
(PDF/PPTX/MP4/narración) crece al punto de justificarlo, migrar
`BEEMETRY_EXPORT_DATA_ROOT` a MinIO es un cambio de infraestructura
localizado (un solo punto de escritura/lectura por servicio), no una
reescritura del modelo de jobs.

**Status**: implemented (verificado 2026-07-06: sidecar `pdf-export-service` Node/Puppeteer, invocado por `report_pdf_export.cpp` vía HTTP sin bloquear el gateway)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

El KPI O3 exige exportar informes a PDF/Word en <5 s. El export es CPU-intensivo y no debe bloquear la ruta caliente del gateway C++ (telemetría, WS). El código tiene `exportEngine.js` con un endpoint `/api/export` más un fallback cliente (`window.print()` / html2canvas). Hay que definir cuál es la fuente de verdad del WYSIWYG y del export.

## Decisión

El **export canónico es server-side, como job asíncrono con un worker dedicado**. El cliente envía el documento (modelo de bloques, ADR-010) al endpoint `/api/export`; un worker renderiza el WYSIWYG y produce PDF/DOCX, almacenado en MinIO (ADR-009). El **fallback cliente** (print/html2canvas) **no es canónico**: queda solo como degradación de emergencia offline, claramente marcado como "borrador no oficial".

### Reglas duras
- El export oficial (firmable/archivable) siempre pasa por el worker server-side.
- El export no corre en el thread del gateway: es un job (cola) con worker, para no bloquear telemetría.
- El render del worker debe reproducir el layout Konva (ADR-013) fielmente; flags `includePageNumbers/includeHeaders/includeFooters` resuelven elementos diferidos (ADR-019).

## Consecuencias

### Positivas
- WYSIWYG determinista y reproducible (mismo render para todos), no dependiente del navegador del usuario.
- No penaliza la ruta caliente C++; cumple O3 sin sacrificar telemetría.

### Negativas / Trade-offs
- Un worker/cola más que operar — justificado por la criticidad del informe oficial.
- El fallback cliente puede divergir del oficial — por eso se marca como borrador no oficial y no se usa para firmar.

### Neutras
- El worker puede compartir runtime con otros jobs (p.ej. raster diferido) sin afectar el gateway.

## Alternativas descartadas

### Export 100% cliente (html2canvas / print)
Es el fallback actual. Depende del navegador, no es determinista ni fiable para un documento firmable; el resultado varía por máquina. Rechazado como canónico.

### Export síncrono en el gateway C++
Bloquearía el hot path bajo carga de telemetría; viola el presupuesto de latencia. Rechazado.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/lib/exportEngine.js`
- `Referencias/docs/02_Arquitectura/Optimizacion_TiempoReal_CPP_AURIXA_v36.md` § 2.5
- ADR-009 (MinIO), ADR-010 (modelo), ADR-013 (Konva), ADR-019 (resolución diferida), ADR-023 (SLAs)
