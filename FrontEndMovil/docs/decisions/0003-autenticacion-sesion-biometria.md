# ADR-0003 — Autenticación, sesión y biometría: replicar el contrato del backend, no la implementación del navegador

**Status**: accepted
**Fecha**: 2026-09-20
**Autores**: Claude Code (análisis técnico), revisado por Luder Armas
**Ámbito**: frontend-movil, autenticación

## Contexto

El backend Beemetry (`backend/`, repo principal) ya expone un contrato de
autenticación diseñado explícitamente para convivir con múltiples frontends
en el mismo dominio
([ADR-132](../../../docs/decisions/132-bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend.md)
del repo principal). Un análisis exhaustivo del código del backend
(`backend/src/auth/`, `backend/src/http/router.cpp`) y del frontend web
(`frontend/src/auth/*.ts`) da el contrato exacto que este proyecto debe
replicar — **no la implementación del navegador**, que depende de APIs
(cookies same-origin, `navigator.mediaDevices`, MediaPipe WASM) que no
existen en Flutter.

Hallazgos que determinan esta decisión:

1. El backend **prefiere `Authorization: Bearer <token>`** sobre cualquier
   cookie — es la única vía exenta de CSRF, y es la vía "siempre preferente"
   documentada en el propio código
   (`backend/src/auth/auth_session.cpp::extractAuthTokenFromRequest`). Un
   cliente nativo puede usar Bearer exclusivamente para todas las llamadas
   normales — no tiene el problema de colisión de cookies entre puertos que
   motivó ADR-132 para el navegador.
2. El **refresh token nunca se expone fuera de una cookie HttpOnly**
   (`beemetry_refresh_token`, `Path=/api/auth`) — es una restricción dura del
   backend, no una elección del frontend web. `POST /api/auth/refresh` y
   `POST /api/auth/logout` además exigen, siempre, el header `X-CSRF-Token`
   igual al valor de la cookie `beemetry_csrf_token` (doble submit).
3. El **desafío de vida activa biométrico (liveness challenge) es 100%
   decidido por el servidor** — el campo `challenge` de cada respuesta de
   `POST /api/process_frame` indica qué gesto pedir (girar la cabeza,
   acercarse, etc.) y si ya se completó; el cliente nunca decide
   aprobación/rechazo localmente, solo refleja ese estado en la UI.
4. Los **formatos de payload de biometría son estrictos y distintos por
   endpoint**: bytes JPEG crudos (`Content-Type: image/jpeg`) para
   `POST /api/process_frame` y `POST /api/track_frame_fast`; JSON con
   base64 **sin** el prefijo `data:` para `POST /api/auth/login/face` y
   `POST /api/auth/register`. El header `X-Capture-Session-Id` (un UUID
   estable por intento de captura) es obligatorio en ambos casos.
5. El seguimiento facial local con MediaPipe Tasks Vision (478 puntos, WASM)
   que hace el frontend web es **solo una guía visual** (el óvalo en
   pantalla) — el backend es la autoridad real. Un detector facial distinto
   en el celular (Google ML Kit) es válido siempre que la calidad del
   encuadre sea "suficientemente buena", sin necesidad de portar la
   topología exacta de 478 puntos.

## Decisión

### Transporte de credenciales
- El **access token JWT vive únicamente en memoria** (una variable/provider
  Riverpod, nunca en `shared_preferences` ni `flutter_secure_storage`) —
  mismo principio que `authStorage.ts::inMemoryAccessToken` del frontend web,
  aplicado en Flutter aunque el motivo original (colisión de cookies entre
  frontends del navegador) no aplique aquí; se mantiene por higiene de
  seguridad (ventana de exposición corta ante cualquier fuga de memoria).
- `Authorization: Bearer <token>` se agrega a **toda** llamada autenticada
  vía un interceptor de Dio (`core/network/auth_interceptor.dart`).
- Un `CookieJar` (`dio_cookie_manager`, `PersistCookieJar` en el directorio
  de soporte de la app) se usa **exclusivamente** para transportar
  `beemetry_refresh_token`/`beemetry_csrf_token` entre login → refresh →
  logout. Ninguna otra llamada depende de este cookie jar.
- En `401`, el interceptor dispara un refresh (deduplicado con un `Future`
  compartido para no rotar el refresh token dos veces en una carrera) y
  reintenta la request original una sola vez — mismo patrón que
  `authApi.ts::authFetch`.
- Refresh proactivo: un `Timer.periodic(30s)` + un listener de
  `AppLifecycleState.resumed` revisan si el access token expira en menos de
  120s y lo renuevan antes de que ocurra un 401 reactivo — mismo disparador
  que `authSessionManager.ts`.
- Al arrancar en frío: si existe un "shell" de sesión persistido (usuario,
  tenant, rol — todo menos el token), se muestra una pantalla de carga y se
  intenta un refresh silencioso antes de decidir login vs. dashboard.

### Biometría
- `camera` (plugin oficial) captura el video; `google_mlkit_face_detection`
  da la guía visual local (óvalo, centrado) — no autoritativa.
- `image` (paquete Dart) codifica JPEG a la calidad exacta que cada endpoint
  espera, recorta/enmascara en óvalo cuando corresponda, y produce tanto
  bytes crudos como base64 según el endpoint de destino.
- `X-Capture-Session-Id` se genera una vez por intento de captura
  (`uuid` package) y viaja en headers de `/api/process_frame`,
  `/api/track_frame_fast`, `/api/reset_capture`, `/api/status`,
  `/api/auth/login/face`, `/api/auth/register`.
- El controlador de desafío de vida activa (`liveness_challenge_controller.dart`)
  **solo lee** el campo `challenge` de cada respuesta del servidor y
  actualiza la UI (qué gesto pedir, si ya se cumplió) — cero lógica de
  aprobación local, replicando el hallazgo de que esto reduce
  significativamente el riesgo de portar la biometría.
- `geolocator` para ubicación best-effort (no bloqueante, igual semántica
  que `geolocation.ts`: se envía si está disponible, nunca se exige).
- `flutter_tts` para la guía de voz del desafío (best-effort, nunca bloquea
  el flujo si no está disponible).

### Permisos (RBAC)
`GET /api/auth/permissions` se llama justo después de login/refresh y
alimenta un `hasPermission(code)` que **solo** oculta/muestra UI — el
backend vuelve a validar cada permiso de forma independiente en cada
endpoint, igual que ya documenta el propio backend; el cliente nunca es la
fuente de verdad de autorización.

## Consecuencias

### Positivas
- El cliente móvil es, en varios aspectos, **más simple** que el frontend
  web: no tiene el problema de colisión de cookies entre puertos (ADR-132
  del repo principal existe por eso), y puede usar `Authorization: Bearer`
  incluso en el stream SSE de KPIs en vivo (`/api/live/kpi`), algo que el
  navegador no puede hacer con `EventSource` nativo.
- Al no depender de la topología exacta de MediaPipe ni de `getUserMedia`,
  el riesgo de portar la biometría es mucho menor de lo que parecía en un
  análisis superficial.
- El contrato de wire (formatos JPEG/base64, headers) es el mismo para
  cualquier cliente — no hay negociación de API adicional con el backend.

### Negativas / Trade-offs
- Dart no tiene `EventSource` nativo — el consumo de `/api/live/kpi` y del
  chat SSE de soporte requiere un parser manual sobre un `http.Client` en
  modo streaming (`core/network/sse_client.dart`), incluyendo su propia
  lógica de reconexión/backoff (el navegador se la da gratis con
  `EventSource`).
- Un detector facial distinto (ML Kit vs. MediaPipe) implica que el
  "look and feel" del óvalo/guía visual no será pixel-idéntico al frontend
  web — aceptado porque es solo una ayuda de encuadre, no una decisión de
  seguridad.

## Referencias
- `backend/src/auth/auth_session.cpp`, `backend/src/http/router.cpp` (repo
  principal — contrato real verificado en código, no inferido)
- `frontend/src/auth/authApi.ts`, `authStorage.ts`, `authSessionManager.ts`,
  `livenessChallenge.ts`, `bestBiometricFrame.ts` (repo principal —
  referencia de comportamiento, no de código a portar)
- `docs/decisions/132-bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend.md`
  (repo principal)
- `lib/core/network/`, `lib/core/auth/` (este proyecto)
