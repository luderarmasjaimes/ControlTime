# ADR-064 — Grabación de video desde cámara web, insertable en el lienzo

**Status**: implemented (2026-07-21). **Actualización 2026-08-17**: la verificación pendiente destapó un bug real de causa raíz distinta a lo grabado por la cámara — ver "Corrección 2026-08-17" en Consecuencias. El modal/`MediaRecorder`/`videoDurationFix.ts` funcionan correctamente; lo que fallaba era el `Content-Security-Policy` servido por nginx en producción, que bloqueaba la carga del video insertado (`data:`/`blob:`) sin generar ningún error visible para el usuario — el bloque mostraba igual "Duración: Xs" (tomado del timer de grabación, no del `<video>`) pero en negro. Corregido agregando `media-src 'self' data: blob:;` al CSP (`frontend/nginx.conf` y, por defensa en profundidad, `backend/src/http/router.cpp`). Verificado de punta a punta detrás de nginx reconstruido usando una grabación sintética real (`canvas.captureStream()` + `MediaRecorder`, mismo mecanismo exacto que usa este modal) que pasó por el pipeline completo (Blob → data URL → `<video src>` → `fixRecordedVideoElement`) y pintó un frame real, no negro — el sandbox de esta verificación seguía sin cámara física, así que la grabación real de cámara (a diferencia del pipeline de guardado/reproducción, ya confirmado) sigue pendiente de una prueba manual puntual con hardware real, pero de bajo riesgo dado que el resto del pipeline ya quedó probado.
**Fecha**: 2026-07-21
**Autores**: EC
**Ámbito**: reports
**Supersedes**: parte de ADR-062 (`insercion-video-grabado-webcam-pantalla`), separado por pedido de Gerencia en dos ADR independientes — ver ADR-065 para el origen "pantalla/ventana".

## Contexto

El catálogo de casos de prueba QA (ADR-061) documentó la inserción de video como **G1 — no implementado**. Hasta hoy, ReportStudioV2 solo tenía captura de webcam a **imagen fija** (`webrtcCapture.ts`, usado para biometría/fotos de perfil) — ninguna grabación de **video** por cámara existía en ningún punto de la plataforma.

Esta es, de las dos capacidades pedidas, la que parte de **cero código previo** — a diferencia de la grabación de pantalla (ADR-065), que ya reutilizaba un mecanismo existente.

## Decisión

**Pestaña "Cámara web" de `VideoInsertModal.tsx`**: al abrir esa pestaña (y mientras no haya un video ya grabado en el modal), se adquiere una vista previa en vivo con `navigator.mediaDevices.getUserMedia({ video: true, audio: true })` — mismo patrón de adquisición que la pestaña "camera" de `ImageInsertModal.tsx` (una sola llamada, sin el parpadeo de doble adquisición que ese componente ya tuvo que resolver en su momento).

Al presionar "Iniciar grabación (cámara web)": se crea un `MediaRecorder` sobre ese mismo stream de preview (reutilizado, sin volver a pedir permiso), con el primer `mimeType` soportado de `['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']` (`MediaRecorder.isTypeSupported`). Se corta automáticamente a los **60 segundos** (`MAX_RECORDING_SECONDS`) o al presionar "Detener grabación". Al detener, el blob resultante se muestra en un `<video controls>` de revisión antes de insertar — el usuario puede "Descartar y grabar de nuevo" o "Insertar en el informe".

Al confirmar, el blob se convierte a **data URL base64** y se inserta como `props.src` de un nuevo bloque `type: 'video'` (`props.source: 'webcam'`) — mismo patrón de almacenamiento inline que usan las imágenes (`ImageInsertModal.tsx`), sin depender de un endpoint de storage de blobs que hoy no existe en el backend.

### Reglas duras
- La vista previa se detiene (`getTracks().forEach(t => t.stop())`) al cerrar el modal, cambiar de pestaña, o desmontar el componente — nunca debe quedar la cámara encendida en segundo plano.
- Si el usuario cambia a la pestaña "Pantalla/Ventana" (ADR-065) mientras la de cámara está en preview (sin grabar todavía), el stream de cámara se detiene — nunca ambas fuentes activas a la vez.

## Consecuencias

### Positivas
- Primera capacidad de grabación de video por cámara de toda la plataforma — cierra la mitad del hallazgo G1 de ADR-061 que dependía 100% de trabajo nuevo (a diferencia de la pantalla, que ya tenía una base).
- Reutiliza el patrón de almacenamiento y de modal ya validados para imágenes — no introduce un mecanismo de persistencia nuevo que aprender/mantener.

### Negativas / Trade-offs
- **Almacenamiento inline (base64)**: un video de cámara de hasta 60s puede pesar varios MB — infla el JSON del documento, el autosave, y cada `report_content_revision` (ADR-015). Aceptable para evidencia técnica corta; si el uso real pide grabaciones más largas o de mayor calidad, hace falta un endpoint de almacenamiento real (MinIO, mismo patrón que la galería de imágenes, ADR-047) — no implementado aquí, mejora futura.
- Requiere permiso de cámara **y micrófono** del navegador (audio incluido, a diferencia de la captura de foto fija que no lo pedía) — un usuario que solo había autorizado cámara para biometría deberá autorizar de nuevo para esta función.
- No se pudo verificar una grabación real completa en esta sesión (sandbox de pruebas sin cámara física) — pendiente de prueba manual antes de certificación QA plena (ver ADR-061, Capa 5).

### Corrección 2026-08-17 — bug real encontrado al intentar cerrar la verificación pendiente
Al fin poder probar el flujo (usuario reportó "genera un video con duración pero se ve en negro"), la causa NO estaba en `MediaRecorder`, en el modal, ni en `videoDurationFix.ts` (el fix de duración/seek-index ya presente desde esta misma sesión de implementación funciona correctamente cuando el recurso llega a cargar). La causa real: el `Content-Security-Policy` que sirve nginx en producción (`frontend/nginx.conf`) no declaraba `media-src` — por la spec de CSP, un `<video>`/`<audio>` sin `media-src` propio cae al `default-src 'self'`, que **no** incluye `data:` ni `blob:`. Como el video insertado se guarda como data URL base64 (mismo patrón que las imágenes, cuyo `img-src` sí lista `data: blob:` explícito) y la vista previa usa un `blob:` de `URL.createObjectURL`, el navegador rechazaba la carga del recurso con `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check` — sin ningún mensaje visible en la UI. El bloque igual mostraba "Duración: Xs" porque ese texto sale del timer de grabación (estado de React), no del propio `<video>`, lo que hacía parecer que "grabó algo" cuando en realidad el navegador nunca llegó a decodificar un solo frame.

Fix: agregar `media-src 'self' data: blob:;` al CSP en `frontend/nginx.conf` (las tres locations que lo declaran) y, por defensa en profundidad, a `kCspValue` en `backend/src/http/router.cpp` (mismo valor replicado ahí, ver comentario en ese archivo). Este bug **no existía en el dev server de Vite** (no manda CSP) — solo se manifestaba detrás de nginx (build de producción/Docker), que es exactamente donde QA/el usuario final prueba la app. Esto también explica por qué nunca se detectó en la sesión de implementación original (ADR-064/065 se probaron contra el sandbox sin nginx real).

Verificación de punta a punta tras el fix (sin cámara física disponible en el sandbox, igual que en la sesión original): se generó un webm real client-side con `canvas.captureStream()` + `MediaRecorder` — mismo mecanismo exacto que usa `webrtcCapture.ts`/`VideoInsertModal.tsx`, solo que la fuente del stream es un canvas en vez de la cámara — se pasó por el pipeline completo (Blob → data URL vía `FileReader`, igual que `blobToDataUrl()` → `<video src>` → `fixRecordedVideoElement()`) detrás del nginx reconstruido en `localhost:5173`, y el frame central del video resultante dio un píxel no-negro (`RGBA [254,1,1,255]`, el color pintado en el canvas), con `duration` numérica finita y sin errores — confirma que el pipeline de guardado/reproducción ya no depende de nada que solo la cámara real pudiera revelar. Lo único que sigue sin poder probarse en este entorno es la adquisición de `getUserMedia` en sí (permiso de cámara/micrófono real), que requiere hardware físico — pendiente de una prueba manual puntual, pero de bajo riesgo dado que el resto del pipeline ya está confirmado.

### Neutras
- El bloque de video en el lienzo requiere `pointerEvents: 'auto'` en su overlay `Html` (a diferencia de `image`, que usa `'none'`) para que los controles nativos de reproducción respondan al click — el bloque debe arrastrarse por el marco/borde, no tocando el reproductor.

## Alternativas descartadas

### Subir el video a un endpoint de almacenamiento real (MinIO) desde el día uno
Más correcto a largo plazo, pero es alcance mayor (nuevo endpoint backend, bucket, políticas de acceso) no pedido explícitamente — se prefirió el patrón ya existente (inline, igual que `image`) para entregar la funcionalidad pedida sin abrir un frente de trabajo backend no solicitado.

### Grabar sin audio por defecto
Se descarta: una explicación técnica narrada en video sin audio pierde la mayor parte de su valor como evidencia — se acepta el permiso adicional de micrófono como costo necesario.

## Referencias
- `frontend/src/components/ReportStudioV2/components/modals/VideoInsertModal.tsx` (pestaña "Cámara web")
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (tipo `video`, compartido con ADR-065)
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx`, `components/viewers/ReadOnlyViewer.tsx`, `lib/exportEngine.ts` (render, compartido con ADR-065)
- ADR-061 (hallazgo G1 que este ADR cierra, junto con ADR-065)
- ADR-065 (grabación de pantalla/ventana — la otra mitad de esta decisión, separada por pedido de Gerencia)
- ADR-047 (galería de imágenes por tenant — patrón de storage real a seguir si se decide no usar inline a futuro)
- ADR-062 (decisión original, superseded — conservada por trazabilidad)
