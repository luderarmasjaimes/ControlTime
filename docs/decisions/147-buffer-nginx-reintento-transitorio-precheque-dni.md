# ADR-147 — Buffer de nginx en /api/, reintento tras error transitorio, y pre-chequeo de DNI antes de la cámara

**Status**: implemented

**Fecha**: 2026-09-04

**Ámbito**: plataforma / ia

**Relación**: encontrado depurando una sesión de prueba real de ADR-146
(validación biométrica en producción) — tres hallazgos independientes, todos
confirmados con logs reales antes de corregirlos.

## Contexto

Reporte del usuario tras una prueba real de registro: (1) mucha demora
pasando de la etapa 1 (lecturas ICAO + parpadeo) a la etapa 2 (desafío
activo); (2) un error de timeout dejó la pantalla trabada sin poder
reintentar; (3) el registro terminó rechazado con "DNI ya existe" **después**
de completar toda la captura facial, y el usuario señaló correctamente que
una restricción de unicidad de DNI no depende de nada biométrico — debería
bloquear la operación ANTES de pedir la cámara, no después.

## Hallazgo 1 — nginx bufereaba cada frame a disco

`docker logs beemetry-web` mostraba, para CADA `POST /api/process_frame`
(sin excepción): `"a client request body is buffered to a temporary file"`.
`client_body_buffer_size` nunca se había configurado en `frontend/nginx.conf`
— nginx usa su default de fábrica (8k/16k según arquitectura), muy por
debajo del tamaño de un JPEG a 1280x960 (ADR-145/146). Cada frame de la
captura biométrica en vivo (cadencia ~175ms) pagaba una escritura+lectura de
disco antes de que nginx pudiera reenviarlo al backend — I/O real en el
camino crítico de un endpoint de tiempo real, exactamente el tipo de demora
que se sentía como "tarda mucho en avanzar de etapa".

**Fix**: `client_body_buffer_size 2m;` agregado a `location /api/` en
`frontend/nginx.conf`, junto al `client_max_body_size 64m` ya existente —
2MB cubre de sobra un frame JPEG a esta resolución y el payload de registro
(imagen + óvalo + busto).

## Hallazgo 2 — un timeout de red dejaba el registro trabado sin reintento

`postJson` (`authApi.ts`) atrapa `AbortError` (timeout del `AbortController`)
y lo relanza como un `Error` genérico con mensaje "intente de nuevo" — pero
`handleCaptureForRegistration` (`AuthGateway.tsx`) trataba TODO error de
`registerUser` igual: nunca liberaba `registerAutoSubmitTriggeredRef`,
a propósito, para no reintentar en bucle con datos que el servidor ya
rechazó de forma determinística (ej. "username already exists" — fix
anterior, documentado en el propio comentario del código). Un timeout de
red NUNCA llegó a tener respuesta del servidor, así que sí tiene sentido
reintentar con los mismos datos — pero quedaba atrapado en la misma regla
"no reintentar", contradiciendo el propio mensaje de error.

**Fix**: `postJson` marca los errores que nunca tuvieron respuesta del
servidor (`AbortError` / falla de red) con `.transient = true`.
`handleCaptureForRegistration` libera el trigger de auto-reintento
(`releaseRegisterAutoTrigger('transient_error')`) sólo cuando `err.transient`
es verdadero — los rechazos reales del servidor siguen sin auto-reintentar.

## Hallazgo 3 — el DNI es único GLOBALMENTE, no por empresa

`registerUserPg` (`auth_storage_pg.cpp`) rechaza con "dni already exists" via
`SELECT 1 FROM auth_users WHERE dni = $1` — sin `company_name` en el WHERE.
El esquema lo confirma: `dni VARCHAR(12) NOT NULL UNIQUE` es una constraint
de tabla completa, deliberada (una persona = una cuenta en toda la
plataforma, sin importar la empresa). Esto se descubrió al intentar
reutilizar `checkLoginIdentity` (que SÍ es por-empresa, pensado para login)
como pre-chequeo: devolvía `ok:false, reason:"not_found"` para un DNI que
**sí** estaba duplicado, sólo que bajo otra empresa — confirmado en vivo
contra la base real (`SELECT` directo) antes de descartar ese approach.

**Fix**: nuevo endpoint `POST /api/auth/register/check-dni` (sin sesión,
como `check-identity`) → `checkDniExistsPg` (`auth_storage_pg.cpp/.hpp`),
misma query EXACTA que el chequeo real de `registerUserPg` para que nunca
diverja del resultado final del registro. Frontend: `checkDniAvailable(dni)`
(`authApi.ts`, nunca lanza — una falla de red no bloquea, el backend
igual rechaza duplicados al final como red de seguridad) llamado en
`startRegisterUserFaceCapture` ANTES de `setRegisterUserBiometricStep('capture')`
— un DNI duplicado ahora se rechaza en menos de un segundo, sin abrir la
cámara ni pedir ninguna lectura biométrica.

## Consecuencias

- Los tres hallazgos son independientes entre sí; se agrupan en este ADR
  porque surgieron de la misma sesión de depuración, no porque compartan
  mecanismo.
- El pre-chequeo de DNI es best-effort (una falla de red no bloquea) — el
  backend sigue siendo la fuente de verdad final vía la constraint UNIQUE
  real; esto es sólo para no hacerle perder 1-2 minutos al usuario en un
  caso que ya se sabía de antemano que iba a fallar.
- **Resuelto en el mismo día** (2026-09-04, misma sesión): las pantallas de
  re-verificación biométrica de administración (`UserManagementView.tsx`'s
  `IntegratedBiometricModal`, `MaintenanceBiometricModal.tsx`) no
  implementaban UI para el desafío activo de 1 gesto de ADR-146, así que con
  `BEEMETRY_LIVENESS_CHALLENGE_REQUIRED=true` nunca podían completar la
  verificación biométrica (rechazo silencioso, sin mostrar nunca el gesto
  pedido). Fix: se extrajo la lógica de sincronización de
  `AuthGateway.tsx::syncChallengeFromServer` a un hook compartido
  `useLivenessChallengeSync` (`frontend/src/auth/useLivenessChallengeSync.ts`)
  — AuthGateway.tsx queda sin tocar (su implementación inline ya probada no
  se tocó, para no arriesgar el flujo principal); las dos pantallas de admin
  ahora llaman `syncChallengeFromServer(status.challenge)` en su polling
  existente, gatean el auto-submit con `challengesPassedRef.current`, y
  muestran el mismo overlay de instrucción del gesto pedido.
- Referencias: `frontend/nginx.conf`, `frontend/src/auth/authApi.ts`
  (`postJson`, `checkDniAvailable`), `frontend/src/components/Auth/AuthGateway.tsx`
  (`handleCaptureForRegistration`, `startRegisterUserFaceCapture`),
  `backend/src/auth/auth_storage_pg.cpp/.hpp` (`checkDniExistsPg`),
  `backend/src/auth/auth_routes.cpp` (`POST /api/auth/register/check-dni`),
  `frontend/src/auth/useLivenessChallengeSync.ts`,
  `frontend/src/components/ReportStudioV2/components/views/UserManagementView.tsx`,
  `frontend/src/components/ReportStudioV2/components/modals/MaintenanceBiometricModal.tsx`.
