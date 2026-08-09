# ADR-096 — Backend C++: OpenCV 4.12.0 vía vcpkg (reemplaza apt 4.6.0)

**Status**: implemented, verificado (2026-08-08)
**Fecha**: 2026-08-08
**Autores**: EC
**Ámbito**: plataforma
**Relación**: complementa ADR-091 (composición OpenCV RAII); motivado por la
misma sesión de trabajo que produjo ADR-097/098/099/100/101.

## Contexto

El backend de producción (`beemetry-api`, Docker/Linux) compilaba contra
**OpenCV 4.6.0** vía `apt-get install libopencv-dev` (paquete de Ubuntu
24.04, congelado desde 2022 — sin relación con las actualizaciones propias
del proyecto). Mientras tanto, los builds locales de Windows (Visual Studio,
`backend/build-vcpkg/`) ya usaban vcpkg con **OpenCV 4.12.0**, y el usuario
acababa de instalar el mismo 4.12.0 vía el paquete oficial de opencv.org en
`C:\opencv` (el path que `CMakeLists.txt` usa por defecto para builds
nativos de Windows, línea 23). Es decir: tres instalaciones de OpenCV
distintas para el mismo proyecto, sin relación entre sí, y la que
realmente importa (producción) era la más vieja.

## Decisión

1. **`backend/vcpkg.json`** (manifiesto nuevo): fija `opencv4` a la versión
   resuelta por el baseline `2f8d9f7d3f041e70643c18954cee799459e7eb75`
   (4.12.0), con `default-features: false` y una lista explícita de
   features: `calib3d` (dependencia real de `objdetect`/`CascadeClassifier`,
   usado por el pipeline legacy de respaldo), `dnn`, `ffmpeg`, `jpeg`,
   `png`, `tiff`, `webp`, `thread`. Se excluyen a propósito `gapi`, `gtk`,
   `highgui`, `quirc` (default del puerto en Linux) — módulos de GUI/grafo
   sin uso en un servidor headless.
2. **`backend/Dockerfile`** (etapa `builder`): se agregan las
   herramientas que vcpkg necesita para compilar OpenCV+ffmpeg desde
   fuente (`git`, `curl`, `zip`, `unzip`, `nasm`, `ninja-build`), se
   clona vcpkg pineado al mismo baseline del manifiesto, y se agrega
   `-DCMAKE_TOOLCHAIN_FILE=/opt/vcpkg/scripts/buildsystems/vcpkg.cmake`
   a la invocación de `cmake -S . -B build`. Se quita `libopencv-dev` de
   la lista de apt de esa etapa (ya no se usa para compilar).
3. **Etapa `runtime` del Dockerfile: sin cambios deliberadamente.**
   Sigue instalando `libopencv-dev`/`opencv-data` por apt — no porque el
   binario los necesite (queda estático, ver Verificación), sino porque
   ese paquete es la fuente de los cascades Haar
   (`/usr/share/opencv4/haarcascades`) que usa el pipeline legacy de
   respaldo (`face_analysis.cpp`, `BEEMETRY_OPENCV_HAAR_DIR`). Cambiar
   la etapa runtime era un riesgo innecesario para el objetivo real
   (actualizar la versión de compilación).

## Verificación

- Build completo en Docker: 5 intentos hasta el éxito, con 3 causas
  raíz distintas encontradas y corregidas en el camino (documentado
  para que no se repitan):
  1. Faltaba `nasm` — requerido por el puerto `ffmpeg` de vcpkg para
     ensamblador x86, ausente en la imagen builder.
  2. Corte de red transitorio descargando `zlib` desde GitHub (sin
     relación con la configuración; reintento resolvió).
  3. `objdetect` se deshabilitaba en silencio por faltar `calib3d`
     como dependencia (OpenCV no falla el build, solo omite el módulo)
     — causaba `error: 'CascadeClassifier' in namespace 'cv' does not
     name a type` recién en la etapa de compilar el código propio, no
     durante la instalación de vcpkg.
  4. Docker Desktop se quedó sin responder (`_ping` 500 / EOF) al
     correr dos builds pesados en paralelo (este y el de `ai_engine`,
     ADR-097) — reiniciado manualmente por el usuario, sin pérdida de
     progreso relevante.
- `ldd /app/build/beemetry_backend | grep -i opencv` → sin salida:
  el binario final queda **estático** (comportamiento por defecto del
  triplet `x64-linux` de vcpkg), no depende de las `.so` de OpenCV en
  runtime.
- `/api/process_frame` + `/api/status` probados contra el binario
  recompilado con una imagen de rostro real: mismo resultado que antes
  del cambio (óvalo vía `cv::fitEllipse`, ICAO, detección) — sin
  regresión de comportamiento.

## Consecuencias

- El build del backend pasa de ~2-3 minutos a ~15-20 minutos (compila
  OpenCV+ffmpeg desde fuente en la etapa builder). Solo afecta a
  builds sin caché de esa capa; con caché de Docker no cambia.
- Las tres instalaciones de OpenCV del proyecto (backend Docker, local
  Windows vcpkg, `ai_engine` Python vía pip) quedan en la misma línea
  4.x, aunque no en la misma versión exacta — ver ADR-097 para el lado
  Python.
- `backend/build-vcpkg/` (build local de Windows) tenía 55 archivos de
  artefactos de CMake/MSBuild commiteados por error; se destrackearon y
  se agregó a `.gitignore` como parte del mismo trabajo de esta sesión
  (no es parte de esta decisión de arquitectura, pero se corrigió de
  paso).

## Alternativas descartadas

- **Actualizar también la etapa `runtime` a vcpkg** (eliminar
  `libopencv-dev`/`opencv-data` de esa etapa): descartado por ahora —
  el binario estático no lo necesita para linkear, pero mover también
  la fuente de los cascades Haar es un cambio con más superficie de
  riesgo (rutas, permisos, tamaño de imagen) para un beneficio menor;
  queda como mejora futura si se quiere reducir el tamaño de la imagen
  runtime.
- **Fijar OpenCV 5.0.0** (primera versión mayor desde 2018, liberada
  jun-2026): descartado — demasiado reciente para el resto del stack
  (mediapipe/insightface en `ai_engine` no están probados contra ella),
  ver ADR-097.

## Referencias

- `backend/vcpkg.json`
- `backend/Dockerfile`
- `backend/src/biometric/face_analysis.cpp` (uso de `cv::CascadeClassifier`)
- ADR-091 (`opencv-composicion-raii`)
- ADR-097 (`numpy2-onnxruntime-opencv-python-ai-engine`)
