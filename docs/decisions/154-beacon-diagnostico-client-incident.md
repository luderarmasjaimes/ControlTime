# ADR-154 — Beacon `/api/client-incident`: el logging del frontend nunca llegaba al servidor

**Status**: implemented

**Fecha**: 2026-09-04

**Ámbito**: plataforma

**Relación**: infraestructura de diagnóstico transversal, motivada por varios
reportes reales sobre el flujo de captura biométrica (ADR-142/143/147/148/
149/153) que no se lograban cerrar con evidencia server-side.

## Contexto

Varios reportes reales del usuario a lo largo de esta sesión describían la
captura biométrica de registro/login "cerrándose sola" y volviendo al
formulario, sin llegar nunca a completar el registro/login. Cada vez que se
investigaba con `docker logs beemetry-api`, no aparecía absolutamente ningún
rastro del intento fallido -- ni una llamada a `/api/auth/register`, ni un
error, nada. Esa ausencia se venía interpretando (razonablemente, con la
información disponible) como "el fallo es puramente del lado del cliente,
antes de llegar a la red" -- una conclusión que llevó a corregir una carrera
real (`resetBiometricCapture()` sin `await`, ADR-147/149) pero el síntoma
siguió reapareciendo después de desplegado ese fix.

Al revisar `frontend/src/lib/logger.ts` se encontró la causa de fondo: **todo
el logging de diagnóstico del flujo (`log.info`/`log.warn` en
`AuthGateway.tsx`, decenas de líneas `[AUTH_REGISTER_FLOW]`/`[AUTH_FACE_UI]`
ya escritas específicamente para depurar este tipo de problema) sólo
imprime en la consola del navegador**, y sólo si `import.meta.env.DEV` es
`true` o se activó `localStorage.setItem('beemetry:debug','1')` a mano --
ninguna de las dos condiciones se cumple en un build de producción normal.
Es decir: la ausencia de rastro en el backend nunca fue evidencia de que el
fallo ocurriera "antes de la red" -- era que el ÚNICO logging que hubiera
podido explicar la causa real estaba estructuralmente bloqueado de llegar a
un lugar donde se pudiera revisar.

## Decisión

Nuevo endpoint `POST /api/client-incident` (`auth_routes.cpp`), público
(sin sesión -- puede dispararse desde la pantalla de registro/login, antes
de autenticarse), que recibe cualquier payload JSON y lo imprime tal cual a
`std::cout` con el tag `[CLIENT_INCIDENT]` (acotado a 4096 bytes para no
poder usarse para llenar el log del servidor). Nunca puede fallar el
request del cliente -- cualquier excepción se traga y responde 200 igual.

`reportClientIncident(tag, detail)` (`authApi.ts`) -- fire-and-forget, nunca
lanza, wrapper mínimo sobre `postJson`.

Tres watchdogs en `AuthGateway.tsx`, cada uno observando la transición de
estado que indicaría un aborto ANORMAL (no un éxito real, que cambia `mode`
o muestra un mensaje de autorización en el mismo tick, así que ese caso
legítimo queda excluido solo por la propia condición):

- `registerUserBiometricStep`: `'capture' → 'form'` mientras `mode` sigue
  en `'register'`.
- `registerCompanyBiometricStep`: mismo criterio.
- `loginBiometricSession`: `true → false` mientras `mode` sigue en
  `'login'` y el mensaje no contiene "Ingreso autorizado".

Cada uno reporta contexto completo: pestaña activa, tiempo transcurrido
desde que arrancó la sesión de captura, `captureCount`/
`qualityGateReached` del servidor, si el reto se cumplió
(`challengesPassedRef`), si había una petición HTTP en curso, y el
`error`/`message` visible en pantalla en ese momento -- todo lo que hacía
falta para diagnosticar la PRÓXIMA vez que esto ocurra, sin depender de que
alguien tenga la consola del navegador abierta en el instante exacto.

## Consecuencias

- No resuelve por sí mismo ningún bug reportado -- es infraestructura de
  observación. El próximo reporte de "se cerró sola" (si vuelve a ocurrir
  pese a los fixes de ADR-147/149/153) va a aparecer en
  `docker logs beemetry-api` con contexto real, en vez de dejar al
  desarrollador reconstruyendo la causa a ciegas.
- Cubre CUALQUIER camino que produzca la transición observada -- timeout de
  sesión, el efecto de cambio de modo/pestaña, o una causa todavía no
  identificada -- sin necesidad de instrumentar cada callsite por separado.
- Genera algo de ruido esperado: un cancelado manual explícito ("Cancelar
  verificación facial") también dispara el watchdog, aunque distinguible en
  el reporte por `captureCount` bajo/nulo y `elapsedMs` corto.
- Referencias: `backend/src/auth/auth_routes.cpp` (ruta
  `/api/client-incident`), `frontend/src/auth/authApi.ts`
  (`reportClientIncident`), `frontend/src/components/Auth/AuthGateway.tsx`
  (los tres watchdogs), `frontend/src/lib/logger.ts` (causa raíz de por qué
  hacía falta este canal).
