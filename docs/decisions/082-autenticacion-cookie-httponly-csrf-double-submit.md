# ADR-082 — Access token en cookie HttpOnly y protección CSRF double-submit

> **Actualización 2026-08-27**: [ADR-132](132-bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend.md)
> revisita conscientemente la decisión de este ADR — un hallazgo real de
> convivencia multi-frontend en el mismo host (dos apps en el mismo dominio,
> distinto puerto, se pisan la cookie de sesión entre sí; el puerto no
> participa en la identidad de una cookie por RFC 6265) obligó a volver el
> `access_token` a memoria de JS como vía primaria (con TTL bajado a 15 min
> para acotar la ventana de exposición ante XSS). El `refresh_token` sigue
> siendo exclusivamente cookie `HttpOnly` — la mitigación central de este
> ADR permanece vigente para la credencial de mayor vida. No se edita el
> texto original de este ADR-082 (convención de este log); ver ADR-132 para
> el detalle completo, el trade-off aceptado y la verificación en vivo.

**Status**: implemented (verificado 2026-08-02; pruebas unitarias frontend 32/32 y validación de build/type-check repetidas 2026-08-03)
**Fecha**: 2026-08-02
**Autores**: EC
**Ámbito**: auth, security, plataforma
**Relación**: endurece ADR-029/043 y complementa ADR-076/077/081.

## Contexto

La SPA persistía el access token en `localStorage`. Ese mecanismo permitía
que cualquier XSS leyera y exfiltrara la credencial para reutilizarla fuera
del navegador. El backend ya concentraba autenticación y autorización en la
sesión y el router, por lo que era posible retirar el token del alcance de
JavaScript sin cambiar el modelo RBAC ni los clientes API existentes.

Al trasladar la credencial a una cookie, el navegador la adjunta
automáticamente. Esto reduce la exposición ante exfiltración por XSS, pero
hace necesario mitigar CSRF en toda operación que cambie estado.

## Decisión

1. El access token de la SPA se entrega en la cookie `access_token` con
   `HttpOnly`, `SameSite=Strict`, `Path=/`, TTL alineado con el JWT y
   `Secure` obligatorio en producción.
2. El frontend no persiste ni reconstruye el access token en
   `localStorage`; las llamadas same-origin usan `credentials: include`.
3. Toda petición mutante autenticada mediante cookie debe incluir el header
   `X-CSRF-Token`, cuyo valor debe coincidir con la cookie legible
   `csrf_token_v2` (patrón double-submit).
4. La validación CSRF vive en `router::Router::dispatch`, punto común de las
   rutas, para que las rutas nuevas queden protegidas por defecto.
5. `Authorization: Bearer` se conserva para integraciones y clientes API.
   Al no ser agregado automáticamente por el navegador, ese flujo no exige
   el token CSRF.
6. El cambio de tenant reemite la cookie de access token con el nuevo
   contexto. El WebSocket same-origin usa la cookie en el handshake y deja
   de incluir credenciales en la URL.
7. El render headless de exportación, que no comparte el cookie jar del
   usuario, mantiene un bearer explícito solo en memoria del módulo; nunca
   lo escribe en `localStorage`.

## Implementación

- Backend: `backend/src/http/router.cpp`, `backend/src/http/http_utils.*`,
  `backend/src/auth/auth_session.*`, `backend/src/auth/auth_routes.cpp` y
  `backend/src/main.cpp`.
- Frontend: `frontend/src/auth/authStorage.ts`, `authApi.ts`, consumidores
  de APIs, WebSocket de alarmas y entrada de `print-report`.
- Operación: `BEEMETRY_AUTH_COOKIE_SECURE=true` en producción; el modo HTTP
  local puede fijarlo en `false` de forma explícita.

## Consecuencias

### Positivas

- Un XSS ya no puede leer y reutilizar el access token fuera de la sesión.
- Las credenciales dejan de aparecer en URLs, historial y access logs.
- El control CSRF se aplica centralmente a las rutas mutantes.
- Se conserva compatibilidad con integraciones Bearer.

### Riesgos y límites

- Una inyección XSS todavía puede actuar con la sesión abierta; este ADR
  reduce exfiltración persistente, no sustituye sanitización ni CSP.
- Configurar `Secure=false` fuera de desarrollo degradaría la protección.
- Los flujos WebSocket, cambio de tenant y render headless requieren pruebas
  de regresión específicas porque no comparten exactamente el mismo canal
  de credenciales.

## Verificación

- `frontend/src/auth/authApi.test.js` comprueba ausencia de Bearer en los
  flujos de navegador, envío de CSRF y ausencia del token en la URL WS.
- `backend/tests/test_http_utils.cpp` cubre helpers HTTP relacionados.
- `RUNBOOK.md`, sección ADR-082, documenta la configuración y los flujos de
  regresión que deben comprobarse antes de producción.

