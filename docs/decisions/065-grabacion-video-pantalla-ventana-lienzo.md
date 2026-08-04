# ADR-065 — Grabación de video de pantalla/ventana, insertable en el lienzo

**Status**: implemented (2026-07-21). Verificado en vivo contra el backend real hasta el límite del sandbox de pruebas (el modal abre, la pestaña "Pantalla / Ventana" muestra el flujo correcto, el botón cambia de rótulo según el estado) — una grabación real de punta a punta queda pendiente de una prueba manual (el sandbox de este entorno no permite compartir pantalla).
**Fecha**: 2026-07-21
**Autores**: EC
**Ámbito**: reports
**Supersedes**: parte de ADR-062 (`insercion-video-grabado-webcam-pantalla`), separado por pedido de Gerencia en dos ADR independientes — ver ADR-064 para el origen "cámara web".

## Contexto

A diferencia de la grabación por cámara web (ADR-064), que partía de cero, la grabación de pantalla/ventana **ya tenía una base de código parcial**: el botón "Grabar" del `TopToolbar` (`handleExportVideo` en `App.tsx`) ya usaba `getDisplayMedia({video:{frameRate:30}, audio:false})` + `MediaRecorder` para grabar hasta 30 segundos — pero el resultado solo se **descargaba** como archivo `.webm` al disco del usuario, nunca se insertaba en el lienzo del informe. El catálogo de casos de prueba QA (ADR-061) documentó esto como parte del hallazgo **G1 — no implementado** (inserción de video, no exportación).

## Decisión

**Pestaña "Pantalla / Ventana" de `VideoInsertModal.tsx`**: al presionar "Iniciar grabación (pantalla/ventana)", se llama `navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })` — el propio navegador muestra su selector nativo de qué compartir (una ventana específica, una pestaña, o la pantalla completa); no hay forma de preseleccionarlo desde código, ni falta hacerlo. Se corta a los **60 segundos** o al detener manualmente, o si el usuario detiene el compartir desde el control nativo del navegador (evento `ended` del track de video, capturado explícitamente para cerrar la grabación igual).

El resultado se muestra en un `<video controls>` de revisión (mismo flujo de confirmación que la cámara web, ADR-064) y, al confirmar, se inserta como bloque `type: 'video'` (`props.source: 'screen'`), mismo almacenamiento inline base64 que el resto de los bloques multimedia.

**El botón "Grabar" original del `TopToolbar` (exportar/descargar) NO se modificó ni se eliminó** — sigue funcionando exactamente igual que antes. Son dos casos de uso deliberadamente distintos:
- **"Grabar" (TopToolbar, preexistente)**: graba un video **del propio informe renderizado** (para compartir/demostrar el documento) y lo **descarga** al disco.
- **"Video" → "Pantalla/Ventana" (nuevo, este ADR)**: graba **cualquier cosa que el usuario elija compartir** (puede ser otra aplicación, otra ventana, cualquier contenido de pantalla) y lo **inserta como evidencia dentro del informe**.

Fusionarlos habría confundido ambas intenciones y arriesgado romper el flujo de exportación ya en uso — se mantienen como dos entradas de UI separadas que comparten el mismo mecanismo de captura subyacente (`getDisplayMedia`/`MediaRecorder`), sin duplicar esa lógica de bajo nivel.

## Consecuencias

### Positivas
- Cierra la otra mitad del hallazgo G1 (ADR-061), reutilizando al 100% un mecanismo de captura ya probado en producción por el botón "Grabar" existente — riesgo técnico bajo, es la misma API del navegador ya en uso.
- El usuario puede documentar evidencia de **cualquier pantalla/aplicación** (no solo del propio informe) directamente dentro del informe técnico, sin pasos manuales de grabar-descargar-volver a subir.

### Negativas / Trade-offs
- Mismo trade-off de almacenamiento inline que ADR-064 (base64, sin endpoint de storage real) — ver esa sección para el detalle; aplica igual aquí.
- El tope de 60s en este modal es **el doble** del tope de 30s del botón "Grabar" original — son límites independientes, elegidos para casos de uso distintos (evidencia a insertar vs. clip corto de demostración); no hay inconsistencia, pero vale aclarar que no es el mismo número por descuido.
- No se pudo verificar una grabación real completa en esta sesión (el sandbox de pruebas no permite compartir pantalla) — pendiente de prueba manual antes de certificación QA plena (ver ADR-061, Capa 5).

### Neutras
- Mismo trade-off de `pointerEvents: 'auto'` en el bloque de video del lienzo que ADR-064 (necesario para que los controles de reproducción respondan al click).

## Alternativas descartadas

### Reemplazar el botón "Grabar" existente en vez de agregar una pestaña nueva
Se descarta explícitamente: son dos casos de uso distintos (exportar un video del informe renderizado vs. insertar una grabación de pantalla como contenido). Fusionarlos habría confundido la intención de cada botón y arriesgado romper el flujo de exportación ya en uso por el equipo.

### Permitir grabar audio del sistema junto con la pantalla
`getDisplayMedia` permite pedir `audio: true` para capturar el audio del sistema/pestaña en navegadores que lo soportan. Se descarta por ahora: el soporte de audio de sistema vía `getDisplayMedia` es inconsistente entre navegadores/plataformas (notoriamente limitado en macOS), y el caso de uso principal (evidencia técnica de pantalla) no depende de audio — se puede agregar como mejora incremental si se pide.

## Referencias
- `frontend/src/components/ReportStudioV2/components/modals/VideoInsertModal.tsx` (pestaña "Pantalla / Ventana")
- `frontend/src/components/ReportStudioV2/App.tsx` (`handleExportVideo` preexistente, sin modificar — mecanismo de captura que este ADR reutiliza)
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts` (tipo `video`, compartido con ADR-064)
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx`, `components/viewers/ReadOnlyViewer.tsx`, `lib/exportEngine.ts` (render, compartido con ADR-064)
- ADR-061 (hallazgo G1 que este ADR cierra, junto con ADR-064)
- ADR-064 (grabación de cámara web — la otra mitad de esta decisión, separada por pedido de Gerencia)
- ADR-062 (decisión original, superseded — conservada por trazabilidad)
