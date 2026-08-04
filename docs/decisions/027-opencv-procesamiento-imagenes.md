# ADR-027 — OpenCV / procesamiento de imágenes en v0.1 (visión EPP diferida)

## Actualización 2026-07-27 — reconciliación con biometría activa

ADR-074 supersede solo la regla histórica “nada de clasificadores
biométricos activos”: el código real ya usa OpenCV/MediaPipe en
captura/calidad/login y avatar, como ADR-025 reconoció el 2026-07-24. La visión
EPP continúa diferida; esta corrección no habilita casco/chaleco ni elimina el
gate legal, consentimiento, retención y protección de datos.

**Status**: implemented, alcance v0.1 (verificado 2026-07-06: `find_package(OpenCV REQUIRED)` en `CMakeLists.txt`; `vision/opencv_raii.cpp` envuelve `cv::Mat`/`cv::VideoCapture`; uso real limitado a detección/recorte/calidad facial en `face_analysis.cpp`, sin visión EPP — coincide con el alcance declarado)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: core-iot

## Contexto

El backend usa OpenCV (`vision/opencv_raii.cpp`, `vision_pipeline.hpp`) y hay un `image_optimizer.py`. Parte del uso de OpenCV estaba ligado a visión EPP/biometría, que se difiere (ADR-025). Hay que definir qué cubre OpenCV en v0.1 sin arrastrar lo diferido.

## Decisión

En **v0.1, OpenCV se usa para procesamiento de imágenes del informe**: optimización/compresión de imágenes embebidas, composición y la **captura de mapa→imagen** (snapshot del bloque `map`, ADR-020). Se mantienen los wrappers RAII (`opencv_raii`) para gestión segura de recursos. La **visión EPP/biométrica** (clasificadores, liveness, `vision_pipeline` completo) **se difiere** junto con ADR-025. La inferencia en ONNX C++ se evalúa en hardening.

### Reglas duras
- OpenCV en v0.1 = imágenes de informe + captura de mapa; nada de clasificadores EPP/biométricos activos.
- Uso de OpenCV vía wrappers RAII (sin manejo manual de `Mat`/buffers que filtre memoria).
- El procesamiento pesado de imagen no bloquea el hot path (sidecar/worker o thread pool, ADR-004).

## Consecuencias

### Positivas
- Imágenes de informe optimizadas (peso/calidad) → export más rápido (O3) y `.miningreport` más liviano.
- Mantiene la capacidad de visión latente sin activarla.

### Negativas / Trade-offs
- OpenCV es una dependencia pesada para un uso acotado en v0.1 — aceptable: ya está en el build y se amplía a EPP en el futuro.

### Neutras
- `image_optimizer.py` (script utilitario Python) coexiste como herramienta batch (ADR-004).

## Alternativas descartadas

### Quitar OpenCV de v0.1
Posible (optimizar imágenes con libs JS/ligeras), pero perderíamos la base de visión ya construida que se reactiva con EPP. Se mantiene.

### Activar visión EPP en v0.1
Bloqueado por ADR-025 (legal/hardening). Rechazado.

## Referencias
- `Referencias/backend/src/vision/opencv_raii.cpp`, `src/vision_pipeline.hpp`, `backend/image_optimizer.py`
- ADR-004 (sidecars), ADR-020 (mapa/captura), ADR-025 (biometría/EPP diferidas), ADR-016 (export)
