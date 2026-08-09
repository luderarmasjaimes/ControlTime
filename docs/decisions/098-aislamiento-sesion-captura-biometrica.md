# ADR-098 — Aislamiento por sesión en captura biométrica en vivo (X-Capture-Session-Id)

**Status**: implemented, verificado (2026-08-08)
**Fecha**: 2026-08-08
**Autores**: EC
**Ámbito**: ia
**Relación**: corrige un supuesto arquitectónico de ADR-089 (biometría
Dermalog CLI / InsightFace) que nunca se hizo explícito; interactúa con
ADR-100 (mismo flujo, cuello de botella de rendimiento en la misma capa).

## Contexto

Diagnosticando un reporte del usuario ("sin lentes"/"ojos abiertos" con
falsos negativos persistentes), se encontró que el estado de la captura
facial en vivo era **global de proceso**, no por sesión, en dos capas:

1. **Backend C++**: `gBiometricCaptureState`/`gBiometricCapturedImages`
   (`biometric_types.hpp`) eran una única struct/vector globales,
   compartidas por `/api/process_frame` y `/api/status` sin importar
   quién las llamara.
2. **`ai_engine/eye_analyzer.py`**: la histéresis de detección de lentes
   (`glasses_state_prev`, `glasses_score_hist`), el historial de EAR
   (`left_ear_hist`/`right_ear_hist`) y el estado de boca
   (`mouth_closed_prev`) eran variables globales de módulo, compartidas
   por **todas** las peticiones concurrentes a `/analyze_eyes` (Flask
   corre con `threaded=True`).

En la práctica esto significaba que una segunda pestaña, un usuario
distinto registrándose al mismo tiempo, o incluso tráfico de pruebas
(`curl` manual durante este mismo diagnóstico) podía resetear o
contaminar la captura de otra sesión en curso, sin ningún error visible
— exactamente el síntoma reportado.

## Decisión

1. **Frontend** (`authApi.ts`): se genera un `X-Capture-Session-Id`
   (UUID, `crypto.randomUUID()` con fallback) una vez por carga de
   página, y se envía en cada llamada a `/api/process_frame` y
   `/api/status`.
2. **Backend C++**: `gBiometricCaptureState` pasa a
   `gBiometricCaptureSessions`, un `unordered_map<string,
   BiometricCaptureSessionSlot>` protegido por el mismo mutex de
   siempre, con `getOrCreateBiometricCaptureSession()` haciendo
   limpieza perezosa de sesiones sin actividad por más de 10 minutos
   cuando el mapa supera 200 entradas. Si el header falta, se usa una
   clave fija (`kBiometricCaptureDefaultSessionId`) para no romper
   compatibilidad con llamadores que no lo envíen.
3. **Backend → ai_engine**: el mismo id se reenvía como campo
   `session_id` en el multipart de `/analyze_eyes` (reutilizando el
   parámetro `glassesSessionKey` que ya existía para el EMA de lentes en
   C++, pero que nunca se transmitía al lado Python).
4. **`eye_analyzer.py`**: se reemplazan los globales por un diccionario
   `_sessions: Dict[str, _SessionState]` con la misma limpieza por TTL
   (2 minutos), llave `session_id` del form (o una clave por defecto si
   falta). El lock de cómputo CV (`_glasses_lock`) se mantiene, pero
   ahora solo serializa el cálculo en sí, no el estado de sesión.

## Verificación

- Prueba de aislamiento con `curl`: sesión A recibe una imagen con
  rostro (`state:4`, óvalo calculado); sesión B recibe una imagen sin
  rostro (logo, `state:1`, `detected:false`) cinco veces seguidas;
  se vuelve a consultar A → **estado idéntico al original**, sin
  ninguna contaminación de B. Antes del fix, esa segunda petición
  sobrescribía el único estado global.
- Confirmado en logs de producción durante el mismo día: múltiples
  frames reales de una sesión de usuario mostraban `cv:60.0` idéntico
  en cada petición — la firma exacta de una histéresis compartida
  atascada — hasta desplegar este fix.

## Consecuencias

- `/api/reset_capture`, `/api/captured_images` y `handleEnroll` (flujo
  legacy de registro en `main.cpp`) también se actualizaron para leer
  el mismo header, ya que consumían el struct global directamente.
- Sesiones abandonadas (pestaña cerrada sin captura completa) se
  limpian solas por TTL en ambos lados — no requieren intervención
  manual ni crecen el mapa indefinidamente.
- El parámetro `glassesSessionKey`/`session_id` ahora cumple una doble
  función (EMA de lentes en C++ + clave de estado en Python) — mismo
  identificador, dos consumidores.

## Alternativas descartadas

- **Cookie de sesión de autenticación como clave**: descartado — el
  flujo de captura ocurre en autoregistro/login, **antes** de que
  exista una sesión autenticada; no hay token disponible en ese punto.
- **Sesión basada en IP/User-Agent**: descartado — rompe con NAT
  compartido (varias personas en la misma red probando a la vez, un
  escenario real dado el contexto de pruebas de esta sesión).

## Referencias

- `frontend/src/auth/authApi.ts`
- `backend/src/biometric/biometric_types.{hpp,cpp}`
- `backend/src/biometric/biometric_routes.{hpp,cpp}`
- `backend/src/biometric/ai_engine_client.cpp`
- `backend/src/main.cpp`
- `ai_engine/eye_analyzer.py`
- ADR-089 (`biometria-dermalog-cli-integration`)
- ADR-100 (`onnxruntime-thread-limit-insightface`)
