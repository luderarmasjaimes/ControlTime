# ADR-161 — OTP de validación de contacto (email/SMS) antes del registro biométrico

**Status**: implemented en código; pendiente verificación E2E en vivo (requiere rebuild del backend C++ y, para el canal SMS, `BEEMETRY_TWILIO_*` configurado)
**Fecha**: 2026-09-07
**Autores**: EC
**Ámbito**: plataforma

> Relacionado con [ADR-135](135-mfa-totp-alertas-seguridad-ruc-bootstrap.md) (MFA/TOTP) y
> [ADR-147](147-buffer-nginx-reintento-transitorio-precheque-dni.md) (pre-chequeos antes de
> abrir la cámara). Ninguno de los dos resuelve lo que pide este ADR: ambos asumen que el
> email/celular ingresados en el formulario de registro son datos reales del usuario — nunca
> se comprobó que le pertenecieran.

## Contexto

El registro (persona y empresa) pasaba del formulario directo al paso biométrico facial sin
confirmar que el email y el celular ingresados fueran alcanzables y le pertenecieran al
usuario. Esto permite registrar cuentas con contacto ajeno o inventado — el dato queda "bien
formado" (pasa la validación de longitud mínima que ya existía) pero nunca se prueba que el
canal exista de verdad.

## Decisión

**Opción A** (backend real, no un mock de frontend): un OTP de 6 dígitos por canal, generado y
verificado en el servidor, enviado antes de habilitar la cámara.

- `backend/src/auth/contact_otp_routes.{hpp,cpp}` — dos rutas públicas (sin sesión, se llaman
  antes de que exista una cuenta):
  - `POST /api/auth/contact-otp/send` — genera un OTP numérico de 6 dígitos
    (`std::mt19937`/`std::random_device`), lo guarda **en memoria** (`gOtpStore`, TTL 10 min,
    clave `"<channel>:<contact>"`) y lo envía por `notify::dispatch` (canal `email`) o
    `notify::sendSms` (Twilio, canal `sms`) — ambos ya existentes, reutilizados sin cambios.
    Rate limit de envío: 3 por IP+canal cada 15 min (`gRateStore`, separado del rate-limit de
    login).
  - `POST /api/auth/contact-otp/verify` — compara el código; 3 intentos fallidos consecutivos
    bloquean ese OTP y responden `invalid_data: true` para que el frontend reactive el campo de
    contacto (mismo criterio de "reactivar para corregir el dato" que ya usa
    `checkDniAvailable`/`checkUsernameAvailable` de ADR-147).
- `frontend/src/auth/authApi.ts::sendContactOtp/verifyContactOtp` — llaman a esas rutas.
- `frontend/src/components/Auth/AuthGateway.tsx` — nuevo estado `contactOtp` + componente
  `ContactOtpPanel`: una fila por canal (persona: email y celular; empresa: solo celular, ese
  formulario no tiene campo de email) con botón "Validar"/"Reenviar" y, tras enviar, un input de
  6 dígitos + "Verificar". El campo de contacto (`email`/`mobile`) se bloquea mientras el canal
  esté `sent && !verified`, y se reactiva automáticamente si el usuario edita el dato después de
  haber enviado un código. `startRegisterUserFaceCapture`/`startRegisterCompanyFaceCapture` no
  abren la cámara si falta algún canal por verificar — mismo punto de gating que el chequeo de
  DNI/username duplicado de ADR-147 (bloquear ANTES de la captura biométrica, más larga y
  costosa, no después).

### Alternativa descartada: Opción B (mock de frontend únicamente)

Simular el envío/verificación con `setTimeout` sin backend real. Se descartó porque no verifica
nada: cualquier dato de contacto "pasaría" la validación, dejando el problema original intacto.
Se usó como paso transitorio de desarrollo (un fallback en `authApi.ts` que trataba cualquier
error de red como "código válido"), pero quedaba como una puerta trasera real una vez que el
backend existiera — ver "Hallazgo de seguridad" abajo.

## Hallazgo de seguridad corregido en esta misma entrega

`sendContactOtp`/`verifyContactOtp` (`authApi.ts`) tenían un fallback de desarrollo: si el
`fetch` fallaba con "Failed to fetch"/"NetworkError", `sendContactOtp` devolvía `{sent:true}` y
`verifyContactOtp` aceptaba **cualquier código de 6 dígitos**. Con el backend real ya escrito
(este ADR), ese fallback dejaba de ser un atajo de desarrollo para convertirse en un bypass de
seguridad: un backend caído (o una URL mal configurada) habría hecho que la validación de
contacto pasara sola, sin que el servidor emitiera ni comprobara nada. Se eliminó — ambas
funciones ahora fallan **cerrado** ante cualquier error de red.

## Hallazgo de build corregido en esta misma entrega

`backend/CMakeLists.txt` no incluía `src/auth/contact_otp_routes.cpp` en `AUTH_MODULES`, pese a
que `main.cpp` ya incluía su header y llamaba a `auth::contact_otp::registerRoutes(gRouter)` — el
backend no habría compilado (símbolo sin definición en el enlazado). Corregido agregando la
entrada junto a `mfa_routes.cpp`.

## Consecuencias

### Positivas
- Cierra el registro de cuentas con email/celular ajenos o inventados sin bloquear el caso
  legítimo (el dato correcto recibe el código y se valida en segundos).
- Reutiliza infraestructura ya existente y probada (`notify::dispatch`, `notify::sendSms`,
  patrón de rate-limit en memoria de `mfa_routes.cpp`) — no se agregó ningún cliente ni
  dependencia nueva.

### Negativas / Trade-offs
- El almacén de OTP es **en memoria del proceso**: un reinicio del backend invalida todos los
  códigos pendientes. Aceptado por el TTL corto (10 min) — el peor caso es pedirle al usuario
  que reenvíe el código, no una brecha de seguridad.
- El canal SMS depende de `BEEMETRY_TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER`. Si no está
  configurado, `sendBySms` falla y el endpoint responde `invalid_data: true` — el frontend lo
  interpreta como "el celular ingresado está mal" en vez de "el proveedor SMS no está
  configurado en este entorno". Riesgo conocido, no resuelto en este ADR: revisar que Twilio
  esté activo antes de dar por probado el canal SMS en un entorno nuevo.
- Pendiente de verificación E2E en vivo: requiere reconstruir el backend C++ (el fix de
  CMakeLists no se había desplegado antes de este ADR) y, para SMS, confirmar Twilio activo.

## Fuera de alcance de este ADR

El escáner de DNI/QR (`DocumentScanCapture.tsx`, `ai_engine/dni_scan.py`) reportado en la misma
sesión como fallando ("No se pudo leer automáticamente") ya tenía, en el working tree, todas las
mejoras de UX pedidas (timeout 45s, reintento, captura manual, indicador de progreso) —
confirmado por lectura directa del código, sin cambios necesarios. El propio ADR-094 ya
documentaba como riesgo abierto que el pipeline nunca se probó contra un DNI físico real. Si el
fallo persiste, la causa más probable es que el contenedor `ai_engine` desplegado no se haya
reconstruido desde que `libzbar0`/`tesseract-ocr` se agregaron a `Dockerfile.ai` — verificar con
`docker compose build ai_engine` y reintentar contra el documento físico.

## Referencias
- `backend/src/auth/contact_otp_routes.{hpp,cpp}`
- `backend/src/notify/notify_service.{hpp,cpp}`, `backend/src/notify/sms_client.{hpp,cpp}`
- `backend/CMakeLists.txt` (`AUTH_MODULES`)
- `frontend/src/auth/authApi.ts` (`sendContactOtp`, `verifyContactOtp`)
- `frontend/src/components/Auth/AuthGateway.tsx` (`ContactOtpPanel`, `contactOtp`,
  `handleSendContactOtp`, `handleVerifyContactOtp`)
- [ADR-135](135-mfa-totp-alertas-seguridad-ruc-bootstrap.md) (MFA/TOTP post-login, patrón de
  rate-limit en memoria)
- [ADR-147](147-buffer-nginx-reintento-transitorio-precheque-dni.md) (gating antes de abrir la
  cámara)
- [ADR-094](094-lectura-dni-camara-pdf417-mrz.md) (escáner DNI, sin cambios en este ADR)
