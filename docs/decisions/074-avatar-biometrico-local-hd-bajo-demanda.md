# ADR-074 — Avatar biométrico local HD bajo demanda

**Status**: implemented y verificado (2026-07-27)
**Fecha**: 2026-07-27
**Autores**: EC
**Ámbito**: ia
**Relación**: refina ADR-004/025/027/029/037/041; no habilita visión EPP.

## Contexto

El registro facial ya genera un avatar ilustrado desde la fotografía capturada
durante el enrolamiento. La cabecera solo mostraba una miniatura circular sin
una acción visible de ampliación. Guardar una imagen 4K como base64 dentro de
la sesión o `localStorage` aumentaría cada login en varios MiB, acercaría la
SPA al límite habitual de almacenamiento del navegador y ampliaría
innecesariamente la exposición de un derivado de la captura facial.

También existía una contradicción documental: ADR-004 y ADR-027 conservaban
frases históricas según las cuales toda función biométrica estaba latente,
mientras ADR-025 (actualización 2026-07-24), ADR-029 y el runtime ya reconocen
que el login facial está activo, sujeto al gate legal y de privacidad.

## Decisión

1. La generación del avatar sigue siendo **local y asíncrona** al registro:
   el sidecar Python usa MediaPipe/OpenCV para segmentación, estilización y
   composición. Se preserva hasta 1600 px de la captura disponible antes de
   componer salidas. Si el sidecar falla, el backend intenta el modelo local
   ONNX/AnimeGAN configurado. No se envía la fotografía a servicios cloud.
2. Se separan dos representaciones:
   - miniatura PNG `768 × 1024`, persistida con el usuario y enviada en la
     sesión para render inmediato;
   - maestro vertical `2880 × 3840`, persistido fuera del JSON de sesión en
     `auth/avatars_hd/{userId}.png` y servido solo bajo demanda.
3. `GET /api/auth/avatar/hd` no acepta `user_id`: resuelve exclusivamente el
   usuario de la sesión autenticada. Esto evita IDOR. El archivo se entrega
   como `image/png`, `nosniff` y caché privada. Para usuarios históricos sin
   maestro, se genera una ampliación Lanczos con realce suave desde la
   miniatura y se guarda una sola vez.
4. La interfaz muestra un indicador de ampliación. Doble clic abre un modal
   de alto contraste; `Esc`, el botón cerrar o clic en cualquier zona distinta
   de la imagen lo cierra. Teclado `Enter`/espacio ofrece alternativa accesible.
5. “4K” describe las dimensiones de salida, no detalle biométrico inventado.
   La fidelidad máxima está limitada por la resolución y calidad de la captura.
   Reenrolar con una mejor cámara es la única forma de recuperar detalle real
   que nunca estuvo en la fuente.
6. Se conserva la minimización: la fotografía cruda del enrolamiento no se
   añade a sesión ni se retiene por esta decisión. El avatar es un derivado
   visual y no sustituye la plantilla facial usada para autenticación.

## Compatibilidad y conflictos resueltos

- **ADR-004**: se mantiene la arquitectura C++ + sidecar local; queda
  supersedida únicamente la frase histórica “función biométrica latente”.
- **ADR-025**: no se amplía a EPP ni se elimina el gate legal. La activación
  en producción requiere consentimiento/base legal, retención, control de
  acceso y protección del volumen de datos según país.
- **ADR-027**: OpenCV ya tenía uso biométrico real. Este ADR supersede solo la
  prohibición histórica absoluta de ese uso y limita el alcance a
  captura/calidad/avatar/login existentes; EPP continúa diferida.
- **ADR-029/041**: el endpoint usa la sesión JWT y el `authFetch` canónico con
  refresh; no crea un segundo mecanismo de identidad ni de red.
- **ADR-037**: usuarios creados por administración pueden seguir sin avatar;
  la cabecera mantiene un placeholder y el endpoint devuelve `404` sin
  convertir la biometría en requisito universal.

## Consecuencias

### Positivas

- Avatar legible para operadores, ampliable sin aumentar el alto de cabecera.
- Procesamiento soberano/local y sin dependencia de Internet.
- El peso 4K no penaliza el login ni cada render de la SPA.
- Aislamiento por sesión y ausencia de parámetros de identidad controlados por
  el cliente.

### Riesgos y controles

- PNG 4K puede superar 8 MiB: el cliente interno Beast eleva a 64 MiB el límite
  **solo** para la respuesta del generador de avatar.
- La composición 4K consume CPU/memoria: ocurre en el hilo asíncrono posterior
  al registro, no bloquea la respuesta de alta.
- El build C++ en Docker queda limitado de forma configurable a dos trabajos
  (`BACKEND_BUILD_JOBS=2` por defecto); compilar con todos los núcleos
  disponibles provocó dos caídas del motor Docker por presión de recursos.
- El maestro es dato personal derivado: directorio no público, archivo `0600`
  (solo propietario), acceso únicamente por endpoint autenticado y volumen
  protegido. Su política de borrado debe seguir la baja/retención del usuario;
  el gate legal de ADR-025 sigue vigente.
- Usuarios históricos reciben mejora visual por interpolación, no nueva
  información facial. Para máxima calidad deben reenrolarse voluntariamente.

## Alternativas descartadas

- **Base64 4K en sesión/localStorage**: exceso de transferencia, memoria y
  riesgo de superar cuota del navegador.
- **Generador cloud**: contradice soberanía on-prem y expone una captura facial.
- **Generar 4K en cada render**: desperdicia CPU y degrada la operación.
- **Inventar detalle con superresolución generativa**: podría alterar rasgos y
  confundir identidad visual; se prioriza una estilización estable y fiel.

## Evidencia y referencias

- `ai_engine/eye_analyzer.py`
- `backend/src/biometric/ai_engine_client.cpp`
- `backend/src/auth/auth_routes.cpp`
- `backend/src/main.cpp`
- `backend/Dockerfile`
- `frontend/src/App.tsx`, `frontend/src/auth/authApi.ts`,
  `frontend/src/index.css`
- Python `py_compile`: OK.
- Frontend: TypeScript y build de producción OK; Vitest 20/20 OK, incluido
  doble clic, permanencia al pulsar la imagen y cierre exterior.
- Backend: `docker compose build web` OK; CMake/GNU 13.3 compiló y enlazó
  `beemetry_backend` al 100 %, incluidos `main.cpp`, `auth_routes.cpp`,
  `ai_engine_client.cpp` y OpenCV.
