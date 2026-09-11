# ADR-153 — Login facial deja de reintentar rechazos deterministas (lentes) + pre-chequeo de username duplicado

**Status**: implemented

**Fecha**: 2026-09-04

**Ámbito**: plataforma

**Relación**: mismo patrón ya aplicado al registro en ADR-147 (transient vs
determinista, pre-chequeo de DNI antes de la cámara); esta vez el mismo par
de hallazgos apareció en LOGIN facial y en el pre-chequeo de REGISTRO
(username, no sólo DNI).

## Contexto — hallazgo 1: reintento de login facial hasta agotar el rate limit

Reporte real del usuario, con captura de pantalla: login facial con lentes
puestos, llegó a 5/5 + reto completo, y la pantalla se quedó "sin salir por
ningún lado" con el error genérico "Demasiados intentos en poco tiempo."

Log real (`beemetry-api`) de la sesión:

```
17:33:33 [AUTH_FACE] postgres login failed: ... reason=Se detectaron lentes/gafas puestos. Retíreselos e intente de nuevo.
17:33:50 [AUTH_FACE] postgres login failed: ... reason=Se detectaron lentes/gafas puestos. ...
17:33:57 [AUTH_FACE] postgres login failed: ... reason=Se detectaron lentes/gafas puestos. ...
17:34:00 [AUTH_FACE] postgres login failed: ... reason=Se detectaron lentes/gafas puestos. ...
17:34:09 [AUTH_FACE] postgres login failed: ... reason=Se detectaron lentes/gafas puestos. ...
17:34:13 [AUTH_FACE] request: ...   (sin "postgres login failed" -- ya rate-limited)
```

Causa raíz: `handleFaceLogin` (`AuthGateway.tsx`) liberaba
`loginSubmitTriggeredRef.current` en **cualquier** error del catch, sin
distinguir un fallo transitorio (red/timeout, sí vale la pena reintentar) de
un rechazo DETERMINISTA del servidor (el rostro capturado tiene lentes; la
plantilla guardada no los tiene; ese mismo frame **nunca** va a coincidir
mientras la persona no se los quite). El `useEffect` de auto-login
reintentaba cada `LOGIN_FACE_RETRY_COOLDOWN_MS` (2.5s) con esencialmente el
mismo resultado, hasta agotar `loginRateCheck` (5 intentos por cuenta,
`main.cpp`) y devolver `too_many_failed_attempts` -- un mensaje genérico que
tapó el real ("quítese los lentes") en cuestión de segundos. Esto es
exactamente el mismo bug de clase que ADR-147 ya había corregido para el
**registro** (`releaseRegisterAutoTrigger` sólo en error transitorio) -- acá
faltaba aplicar el mismo criterio al **login**.

**Fix**: `handleFaceLogin` sólo libera el trigger cuando `err?.transient`
(mismo flag que ya pone `postJson` en `authApi.ts` ante un fallo de red/
timeout sin respuesta real del servidor). Cualquier otro rechazo -- lentes,
usuario no encontrado, cuenta bloqueada, lo que sea -- deja el trigger
armado: el mensaje real queda visible en pantalla y la persona corrige el
problema (sacarse los lentes) y reactiva la verificación facial a mano,
igual que ya hacía el registro desde ADR-147.

## Contexto — hallazgo 2: username duplicado, mismo patrón que el DNI de ADR-147

Reporte real, DNI de prueba distinto (09637601): captura completa (5/5 +
parpadeo + reto, ~1-2 minutos) y recién al final "username already exists
in this company" -- exactamente el mismo problema que ADR-147 ya había
resuelto para el DNI, pero el username (UNIQUE por empresa, no global, ver
`registerUserPg`) se había quedado sin su propio pre-chequeo.

**Fix**: mismo patrón exacto que `checkDniExistsPg`/`check-dni`:

- `checkUsernameExistsPg` (`auth_storage_pg.hpp/.cpp`) -- misma query que el
  chequeo real de `registerUserPg`
  (`WHERE company_name = $1 AND username = $2`).
- `POST /api/auth/register/check-username` (`auth_routes.cpp`,
  `buildAuthRegisterCheckUsernameResponse`), sibling de `check-dni`.
- `checkUsernameAvailable(company, username)` (`authApi.ts`) -- nunca lanza,
  mismo contrato que `checkDniAvailable`.
- `startRegisterUserFaceCapture` (`AuthGateway.tsx`) llama AMBOS chequeos en
  paralelo (`Promise.all`) antes de abrir la cámara -- un solo round-trip
  extra en vez de dos secuenciales.

Igual que en ADR-147, sin este pre-chequeo en `startRegisterCompanyFaceCapture`
(registro de empresa): una empresa nueva no puede chocar contra un
`company_name` que todavía no existe.

## Consecuencias

- Login facial: un rechazo real (lentes, cara no coincide, etc.) ahora se
  ve claramente en pantalla y no se pisa solo agotando el rate limit de la
  cuenta -- la persona sabe qué corregir en vez de terminar bloqueada 5
  minutos por un error que el sistema mismo generó reintentando.
- No se tocó la detección de lentes en sí (el checklist ICAO en vivo --
  `eye_analyzer.py`/histéresis -- y el chequeo real en `handleLoginFace` son
  intencionalmente distintos: el primero es una heurística rápida para la
  UI, deliberadamente tolerante para no generar falsos rechazos ICAO en
  cada frame; el segundo es la verificación real contra la plantilla
  guardada). Que el checklist muestre "SIN LENTES: OK" mientras la persona
  los tiene puestos es un gap de sensibilidad de esa heurística, no de este
  fix -- **queda pendiente de revisión aparte** si vuelve a reportarse.
- Registro: ahora se bloquean ANTES de la cámara los dos duplicados reales
  encontrados en producción (DNI global, username por empresa) -- ningún
  otro campo de `registerUserPg` tiene restricción UNIQUE own, así que no
  quedan más pre-chequeos pendientes de este tipo salvo que aparezca uno
  nuevo con evidencia real.
- Referencias: `frontend/src/components/Auth/AuthGateway.tsx`
  (`handleFaceLogin`, `startRegisterUserFaceCapture`),
  `frontend/src/auth/authApi.ts` (`checkUsernameAvailable`),
  `frontend/src/i18n/I18nProvider.tsx` (`error.usernameAlreadyRegistered`),
  `backend/src/auth/auth_storage_pg.hpp/.cpp` (`checkUsernameExistsPg`),
  `backend/src/auth/auth_routes.cpp`
  (`buildAuthRegisterCheckUsernameResponse`, ruta `check-username`).
