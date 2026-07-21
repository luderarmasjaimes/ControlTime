# ADR-062 — Inserción de video grabado (cámara web o pantalla/ventana) en el lienzo

**Status**: implemented (2026-07-21). Verificado en vivo contra el backend real (login, apertura de ReportStudioV2, ambas pestañas del modal renderizando correctamente, manejo de error sin crash cuando el sandbox de pruebas bloqueó el acceso a cámara). No se pudo verificar una grabación real completa por esa misma restricción de entorno.
**Fecha**: 2026-07-21
**Autores**: EC
**Ámbito**: reports

## Contexto

El catálogo de casos de prueba QA (ADR-061) había documentado la inserción de video como **G1 — no implementado**: ReportStudioV2 no tenía ningún tipo de bloque `video`, solo captura de webcam a **imagen fija** (`webrtcCapture.ts`, usado para biometría/fotos). Gerencia pidió explícitamente cerrar esta brecha con dos orígenes de grabación:
1. **Cámara web** — nueva capacidad, no existía ninguna grabación de video (solo foto) hasta hoy.
2. **Pantalla/ventana seleccionada** — ya existía un mecanismo parcial: el botón "Grabar" del `TopToolbar` (`handleExportVideo` en `App.tsx`) ya usaba `getDisplayMedia` + `MediaRecorder` para grabar hasta 30s, pero solo para **descargar** un archivo `.webm` — nunca insertaba el resultado en el lienzo.

## Decisión

**Nuevo tipo de elemento `video`** en el modelo de documento (`useEditorStore.ts`): mismo patrón que `image` (bloque libre, movible/redimensionable, con `wrapMode` para ajuste de texto), con `props.source` (`'webcam' | 'screen'`), `props.mimeType` y `props.durationSeconds` en vez de `alt`.

**Nuevo componente `VideoInsertModal.tsx`** (mismo estilo visual que `ImageInsertModal.tsx`), con dos pestañas:
- **Cámara web**: vista previa en vivo (`getUserMedia({video:true, audio:true})`), botón de grabar/detener.
- **Pantalla / Ventana**: `getDisplayMedia({video:{frameRate:30}, audio:false})` — el propio navegador muestra el selector nativo de qué compartir (ventana específica, pestaña, o pantalla completa); mismo mecanismo que ya usaba el botón "Grabar" existente, reutilizado acá para insertar en vez de descargar.

Al confirmar, el video grabado (blob `webm`) se convierte a **data URL base64** y se inserta como `props.src` del nuevo bloque — **mismo patrón de almacenamiento que las imágenes** (inline en el JSON del documento, sin endpoint de storage de blobs en el backend).

**El botón "Grabar" existente (`TopToolbar`, exportar video del informe, máx. 30s) NO se tocó** — sigue funcionando igual, es una feature distinta (exportar/descargar un video *del propio informe renderizado*, no insertar una grabación *de cámara/pantalla* como contenido). Ambas coexisten sin conflicto.

**Tope de grabación: 60 segundos** (`MAX_RECORDING_SECONDS`), mayor que los 30s del botón de exportar porque el caso de uso es distinto (contenido a insertar, no un GIF corto de demostración) — pero acotado deliberadamente para no generar data URLs excesivamente grandes dado el almacenamiento inline.

**Renderizado añadido en las 3 vistas** que ya manejaban `image` (evitando repetir el bug histórico de `sensor`/`kpi` faltantes en `ReadOnlyViewer`/`exportEngine` que motivó un fix documentado en el ADR-012):
- `PageCanvas.tsx` (editor): overlay `Html` con `<video controls>`, `pointerEvents: 'auto'` (a diferencia de `image`, que usa `'none'`) para que los controles nativos de reproducción respondan al click.
- `ReadOnlyViewer.tsx`: mismo `<video controls>`, de solo lectura.
- `exportEngine.ts` (DOCX): un video no es embebible en Word/PDF — se inserta un marcador explícito `[Video adjunto (Ns) — grabación de cámara web/pantalla — no reproducible en este formato de exportación]` en vez de omitir el bloque en silencio.

**Botones de inserción agregados** en los dos puntos donde ya existía "Imagen": `LeftLibrary.tsx` (barra lateral) y `RibbonToolbar.tsx` (grupo "Contenido", pestaña Insertar).

## Consecuencias

### Positivas
- Cierra la brecha G1 del catálogo QA con una implementación real, verificada contra el backend en vivo.
- Reutiliza al 100% el mecanismo de captura de pantalla que ya existía (`getDisplayMedia`) — no se duplicó lógica, se le agregó un segundo destino (insertar además de exportar).
- Sigue exactamente el patrón arquitectónico ya establecido para `image` (mismo almacenamiento, mismo estilo de modal, mismas 3 vistas a actualizar) — consistencia con el resto de la plataforma.

### Negativas / Trade-offs
- **Almacenamiento inline (base64) para video hereda la misma limitación que ya tienen las imágenes, agravada por el tamaño**: un video de 60s a la calidad por defecto de `MediaRecorder` puede pesar varios MB, inflando el JSON del documento, el autosave, y el tamaño de cada `report_content_revision` (ADR-015). Es aceptable para el alcance de hoy (grabaciones cortas de evidencia técnica), pero **si el uso real pide videos más largos o de mayor calidad, hace falta un endpoint de almacenamiento real (MinIO, mismo patrón que la galería de imágenes ADR-047) que devuelva una URL en vez de un data URL** — no implementado en este ADR, queda como mejora futura.
- El bloque de video en el lienzo necesita `pointerEvents: 'auto'` para que sus controles nativos respondan — esto significa que arrastrar el bloque debe hacerse por el marco/borde, no tocando el reproductor mismo (distinto de `image`, que se arrastra desde cualquier punto).
- No se pudo verificar una grabación real de punta a punta (el sandbox de este entorno bloquea el acceso a cámara/pantalla) — se verificó todo el camino de código hasta ese límite de hardware: apertura del modal, cambio de pestaña, manejo de error sin crash. La grabación real queda pendiente de una prueba manual con hardware real antes de considerarse 100% certificada para QA (ver ADR-061, Capa 5).

### Neutras
- El video exportado a DOCX/PDF queda como un marcador de texto, no una miniatura/poster — se podría mejorar capturando un frame como imagen de portada del bloque en una iteración futura, pero no era parte del pedido original.

## Alternativas descartadas

### Subir el video a un endpoint de almacenamiento real (MinIO) desde el día uno
Más correcto a largo plazo, pero es un alcance mayor (nuevo endpoint backend, bucket, políticas de acceso) no pedido explícitamente hoy — se prefirió el patrón ya existente (inline, igual que `image`) para entregar la funcionalidad pedida sin abrir un frente de trabajo backend no solicitado. Documentado como mejora futura arriba.

### Reemplazar el botón "Grabar" existente en vez de agregar uno nuevo
Se descarta: son dos casos de uso distintos (exportar un video del informe renderizado vs. insertar una grabación de cámara/pantalla como contenido) — fusionarlos habría confundido la intención de cada botón y arriesgado romper el flujo de exportación ya en uso.

## Referencias
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (tipo `video`, `defaultPropsByType`, `createElement`)
- `frontend/src/components/ReportStudioV2/components/modals/VideoInsertModal.tsx` (nuevo)
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx` (render editor)
- `frontend/src/components/ReportStudioV2/components/viewers/ReadOnlyViewer.tsx` (render solo lectura)
- `frontend/src/components/ReportStudioV2/lib/exportEngine.ts` (marcador en export DOCX)
- `frontend/src/components/ReportStudioV2/components/layout/{LeftLibrary,RibbonToolbar}.tsx` (botones de inserción)
- `frontend/src/components/ReportStudioV2/App.tsx` (`handleExportVideo` preexistente, sin modificar; `openVideoInsertForNew`/`handleVideoInsertComplete` nuevos)
- ADR-061 (hallazgo G1 que este ADR cierra)
- ADR-047 (galería de imágenes por tenant — patrón de storage real a seguir si se decide no usar inline a futuro)
- ADR-012 (snapshot de KPI/sensor al firmar — antecedente del bug de bloques faltantes en `ReadOnlyViewer`/`exportEngine` que este ADR evitó repetir)
