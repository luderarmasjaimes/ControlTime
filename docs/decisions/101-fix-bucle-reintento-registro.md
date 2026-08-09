# ADR-101 — Detener el auto-reintento de registro tras un rechazo confirmado del servidor

**Status**: implemented, verificado (2026-08-08)
**Fecha**: 2026-08-08
**Autores**: EC
**Ámbito**: plataforma
**Relación**: consumidor final del aislamiento de sesión de ADR-098 (mismo
componente, `AuthGateway.tsx`).

## Contexto

Tras completar exitosamente la captura de 3/3 muestras faciales, el
usuario reportó que el registro "no lo hace, tampoco sale error, solo la
pantalla parpadea como que quiere hacer algo pero no puede continuar".

Diagnóstico con logs del backend (`[AUTH_REGISTER] ... pre_db_insert`,
sin ningún `db_insert_ok` posterior) y de PostgreSQL (`pg_stat_activity`
limpio, sin locks ni transacciones colgadas) descartó un cuelgue real:
el usuario ya tenía una cuenta registrada exitosamente en un intento
anterior (`dni=78166927, username=larmas1, company_name=Alpayana`,
verificado con `SELECT` directo contra `auth_users`), y el segundo
intento (`dni=09637531`, mismo `username`) violaba la restricción única
`auth_users_company_name_username_key` — un rechazo `409` **rápido y
correcto** del servidor, no un cuelgue.

El verdadero problema estaba en `AuthGateway.tsx`: el `useEffect` que
dispara el envío automático de registro (cuando `captureCount>=3` y la
cámara sigue activa) se re-arma después de **cualquier** error del
servidor, vía `releaseRegisterAutoTrigger('api_error')` en el bloque
`catch`. Como `captureCount` permanece en 3/3 mientras la cámara sigue
transmitiendo, el efecto se disparaba de nuevo cada ~2.7 segundos —
reenviando los **mismos datos ya rechazados**, indefinidamente. Cada
intento nuevo ejecutaba `setError('')` al arrancar, borrando el mensaje
de error casi al instante: visualmente, la pantalla parpadeaba sin que
el usuario alcanzara a leer ningún error.

Logs con marca de tiempo confirmaron el patrón: intentos a intervalos de
~2.5-3s, demasiado regular para ser clics manuales del usuario.

## Decisión

En el bloque `catch` de `handleCaptureForRegistration` (rama
`isUserRegisterCapture`), se elimina la llamada a
`releaseRegisterAutoTrigger('api_error')`. El mensaje de error
(`setError(localizeMessage(err.message))`) se mantiene y ahora **persiste**
en pantalla, ya que ningún reintento automático posterior lo sobrescribe.
El guard `registerAutoSubmitTriggeredRef` permanece armado hasta que el
usuario salga del paso de captura (cambiando de usuario/DNI, por
ejemplo), momento en el que el propio `useEffect` ya lo resetea
(`inRegisterCapture` pasa a `false`).

Los otros llamadores de `releaseRegisterAutoTrigger` (cámara no lista,
rostro no detectado, calidad insuficiente) **no se tocan** — representan
condiciones pre-vuelo que legítimamente pueden resolverse en el
siguiente frame, a diferencia de un rechazo ya confirmado por el
servidor con los mismos datos.

## Verificación

- Reproducido el patrón exacto en logs de producción del mismo día
  (intentos cada ~2.7s con `dni=09637531`, todos fallando en el mismo
  punto).
- Frontend reconstruido y desplegado; verificación de humo (`curl -o
  /dev/null -w "%{http_code}"` sobre el sitio servido) confirmó `200`.
  La reproducción completa del flujo de UI (captura + submit fallido +
  verificar que el error persiste) requiere cámara real y queda
  pendiente de prueba manual — no simulable en este entorno de trabajo.

## Consecuencias

- Cualquier rechazo de registro (usuario duplicado, DNI duplicado,
  validación de datos, error de red durante el POST) ahora deja un
  mensaje de error legible y estable en pantalla, en vez de reintentar
  ciegamente.
- El usuario debe corregir sus datos (o reiniciar el flujo de captura)
  para volver a intentar — ya no hay reintento silencioso en segundo
  plano. Es un cambio de comportamiento intencional: un reintento
  automático solo tiene sentido para errores transitorios, no para
  rechazos deterministas del servidor.

## Alternativas descartadas

- **Distinguir códigos de error retryables vs. terminales** (ej. solo
  desarmar el guard en errores 5xx/red, mantenerlo armado en 409/422):
  más preciso en teoría, pero requiere que `registerUser()` propague el
  status HTTP hasta este punto (hoy solo propaga `err.message`) y
  clasificar cada mensaje de error del backend — más superficie de
  cambio para un beneficio marginal sobre la solución simple. Queda
  como mejora futura si se identifica un caso real de error transitorio
  que sí debería reintentarse solo.

## Referencias

- `frontend/src/components/Auth/AuthGateway.tsx`
  (`handleCaptureForRegistration`, `useEffect` de auto-envío)
- `backend/src/auth/auth_storage_pg.cpp` (`registerUserPg`, restricción
  única `auth_users_company_name_username_key`)
- ADR-098 (`aislamiento-sesion-captura-biometrica`)
