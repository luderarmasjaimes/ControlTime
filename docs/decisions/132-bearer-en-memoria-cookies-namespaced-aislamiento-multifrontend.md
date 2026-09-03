# ADR-132 — Bearer en memoria + cookies namespaced: aislamiento entre frontends en el mismo host

**Status**: implemented, verificado E2E en vivo (build Docker real + login por navegador +
prueba de colisión de cookies con dos usuarios simultáneos, ver Verificación)
**Fecha**: 2026-08-27
**Autores**: EC
**Ámbito**: plataforma

> Revisita ADR-082 (auditoría de seguridad 2026-08-02, cookie HttpOnly para el access token) tras
> un hallazgo real en pruebas: dos frontends distintos corriendo en el mismo host (mismo dominio,
> distinto puerto) se pisan la sesión entre sí, porque las cookies HTTP se comparten por dominio,
> no por puerto (RFC 6265). Referencia ADR-029 (JWT híbrido access/refresh).

## Contexto

Se probó en vivo el escenario que el negocio necesita soportar: la aplicación minera real
(ReportStudioV2) logueada en una pestaña, y un frontend externo distinto (otro equipo/proveedor)
logueado simultáneamente en otra pestaña del mismo navegador, ambos apuntando al mismo backend.

**Hallazgo verificado, no supuesto**: con el diseño de ADR-082 (access token únicamente en cookie
HttpOnly `access_token`, `Path=/`), el login del segundo frontend sobrescribe silenciosamente la
cookie del primero — Domain+Path+Name identifican de forma única una cookie en el navegador,
**el puerto no participa** en esa identidad. Se confirmó con `GET /api/auth/permissions`: la
pestaña de la app real, tras el segundo login, devolvía el `tenant_id` de la OTRA sesión, mientras
su UI (cacheada en `localStorage`, no revalidada) seguía mostrando el tenant original — un
desfase real entre lo que el operador ve en pantalla y la sesión con la que en realidad está
operando el backend.

Esto es relevante para el negocio porque, en producción, no hay garantía de que la plataforma vaya
a ser el único frontend en la estación de un cliente minero — pueden convivir con aplicaciones de
otros proveedores en el mismo equipo, y no hay control sobre en qué dominio/puerto corran esas
otras aplicaciones.

## Decisión

### 1. Bearer en memoria vuelve a ser la vía primaria de autenticación
El `access_token` se guarda **únicamente en una variable de módulo de JS**
(`frontend/src/auth/authStorage.ts::inMemoryAccessToken`) — nunca en `localStorage`, nunca en el
objeto `Session` persistido (`session.token` se mantiene en `''`, igual que en ADR-082). Cada
petición autenticada agrega `Authorization: Bearer <token>` (`authHeaders()`). Al vivir en el
contexto de JS de cada aplicación (no en un cajón de cookies compartido por host), dos frontends
distintos en el mismo dominio no se pisan entre sí: cada uno mantiene su propio token en su propia
memoria de proceso.

### 2. El refresh token JAMÁS se expone por Bearer
Para no revertir por completo la mitigación de ADR-082, el `refresh_token` (7 días de vida) sigue
siendo **exclusivamente una cookie HttpOnly** — invisible a JS incluso bajo un XSS exitoso. Un
atacante que robe el access token de memoria (vía XSS) solo obtiene una credencial utilizable por
la ventana de vida del access token, no puede renovarla indefinidamente sin esa cookie.

### 3. TTL del access token: 60 → 15 minutos
`BEEMETRY_JWT_ACCESS_TTL_MINUTES` vuelve a su valor original (bajado a 60 el 2026-08-19 porque el
refresh silencioso ya era transparente y un TTL corto "se sentía frágil" — razonamiento válido
mientras el token vivía solo en cookie HttpOnly). Con el token también en memoria de JS, la
ventana de exposición ante un XSS pesa más que la frecuencia de renovación, que sigue siendo
transparente (refresh proactivo + reintento automático en 401,
`frontend/src/auth/authApi.ts::authFetch`).

### 4. Las 3 cookies pasan a nombres namespaced `beemetry_*`
`access_token`→`beemetry_access_token`, `refresh_token`→`beemetry_refresh_token`,
`csrf_token_v2`→`beemetry_csrf_token`. Cierra un vector de colisión adicional e independiente del
punto 1: si dos aplicaciones distintas en el mismo host usaran, por coincidencia, el mismo nombre
genérico de cookie (`refresh_token` es un nombre común), colisionarían igual que el access token
lo hacía, incluso con Bearer ya resuelto para las peticiones normales — el flujo de
`/api/auth/refresh`/`/api/auth/logout` seguiría dependiendo de una cookie compartida por nombre.
Un nombre propio de la plataforma hace esa colisión accidental con una app de terceros
extremadamente improbable. `clearAuthCookies()` también limpia los 4 nombres viejos
(`access_token`, `refresh_token`, `csrf_token_v2`, `csrf_token`) para que sesiones activas desde
antes de esta migración se autoreparen en el próximo logout.

### 5. Restauración de sesión al recargar (`App.tsx`)
El token en memoria se pierde en cada recarga de página, a propósito (nunca se persiste). Al
montar, si existe una `Session` guardada en `localStorage` (usuario logueado antes), la app llama
a `refreshAccessToken()` (que solo necesita la cookie HttpOnly de refresh) **antes** de renderizar
el dashboard, mostrando una pantalla mínima de "Restaurando sesión…" mientras tanto. Si el refresh
falla (cookie ausente/vencida/revocada), se limpia la sesión y se muestra el login — igual que
antes de este cambio, sin regresión de UX en el caso normal.

## Consecuencias

### Positivas
- Dos o más frontends distintos pueden operar simultáneamente en el mismo host sin pisarse la
  sesión — verificado en el escenario real que originó este ADR.
- El robo de token vía XSS queda acotado a una ventana de ~15 min en vez de indefinida (60 min
  antes, y el refresh token de 7 días nunca estuvo expuesto por Bearer).
- Los nombres de cookie namespaced reducen further el riesgo de colisión accidental con
  aplicaciones de terceros que nunca se probaron explícitamente contra esta plataforma.

### Negativas / Trade-offs
- Se reabre parcialmente el riesgo que ADR-082 cerró: un XSS exitoso en la SPA real ahora SÍ puede
  leer el access token de memoria (antes no podía leer nada). Mitigado por el TTL corto, la CSP ya
  vigente (defensa principal contra que el XSS ocurra en primer lugar), y que el refresh token
  sigue sin exponerse — pero no es una reversión completa a "sin riesgo", es un trade-off
  explícito, pedido y aceptado conscientemente para resolver el problema de convivencia
  multi-frontend.
- Toda sesión activa antes de este despliegue queda invalidada (las cookies viejas no namespaced
  se limpian, pero mientras tanto un usuario con sesión vieja abierta necesita volver a loguearse
  una vez).

### Neutras
- Los ~15 puntos de código que hacían `session?.token ? {...} : {}` (mencionados en el comentario
  original de ADR-082) siguen funcionando sin tocarlos: `session.token` sigue siendo `''` siempre;
  el Bearer real se arma en `authHeaders()`, no leyendo ese campo.

## Alternativas descartadas

### No tocar el frontend real, dejar Bearer solo para frontends nuevos
Era la opción de menor riesgo (no reabre nada de ADR-082), pero no resuelve el problema tal como
se planteó: la app real seguiría dependiendo de la cookie genérica y podría seguir siendo pisada
por CUALQUIER otra app en el mismo host, sin importar qué mecanismo use esa otra app. Se descartó
porque el pedido explícito fue garantizar máxima seguridad ante convivencia multi-frontend
también para la plataforma real, con el trade-off de XSS entendido y aceptado.

### Persistir el refresh token también en JS (localStorage) para eliminar cookies por completo
Habría cerrado el vector de colisión de forma más simple (cero cookies de sesión), pero expone la
credencial de MÁS larga vida (7 días) a un XSS, un downgrade de seguridad mucho mayor que el del
access token de 15 min. Descartado explícitamente.

## Verificación (2026-08-27, en vivo)

Con el stack reconstruido (`docker compose build web frontend`, exit 0) y recreado
(`docker compose up -d --force-recreate --no-deps web frontend`):

1. **Nombres de cookie**: `POST /api/auth/register` real devuelve `Set-Cookie` con los 3 nombres
   `beemetry_access_token` (HttpOnly, `Path=/`, `Max-Age=900`), `beemetry_refresh_token` (HttpOnly,
   `Path=/api/auth`, `Max-Age=604800`), `beemetry_csrf_token` (`Path=/`, `Max-Age=604800`, no
   HttpOnly). Confirmado con `curl -i`.
2. **TTL de 15 min**: se detectó que `.env` (no `.env.example`) seguía fijado en `60` desde el
   cambio del 2026-08-19, sobrescribiendo el default de `docker-compose.yml`. Corregido a `15` y
   recreado el contenedor — confirmado en el JWT emitido (`exp - iat = 900s`).
3. **Bearer-only, cero cookies**: `GET /api/auth/permissions` con solo
   `Authorization: Bearer <token>` (sin ninguna cookie) → `200 OK`. Sin ningún header/cookie →
   `401`.
4. **Refresh**: `POST /api/auth/refresh` con solo la cookie `beemetry_refresh_token` + CSRF header
   → `200`, rota el refresh token, devuelve `access_token`/`expires_in: 900`/`token_type: Bearer`
   en el body — exactamente lo que consume `refreshAccessToken()` del frontend en el arranque.
5. **Login real por navegador**: login por contraseña desde la UI real (Chrome headless vía
   herramienta de automatización) contra `Minera Raura` → `200`, dashboard cargado,
   `POST /api/auth/refresh` de arranque → `200`.
6. **Prueba decisiva de colisión cross-frontend**: con dos pestañas del mismo navegador/origen
   (mismo *cookie jar*), se logueó el Usuario A (tenant Minera Raura) en la pestaña 1 y,
   después, el Usuario B (tenant Ferreyros) en la pestaña 2 — el login de B sobreescribió
   efectivamente las 3 cookies compartidas (confirmado). Repitiendo la petición
   `GET /api/auth/permissions` con el token de A por `Authorization: Bearer` **y**, a la vez, las
   cookies ya pisadas por B en el mismo request, la respuesta resuelve como **A**
   (`tenant_id=9f3dcf35…`), no como B — confirmando que `extractAuthTokenFromRequest`
   (`backend/src/auth/auth_session.cpp:76-91`) efectivamente prioriza el header `Authorization`
   sobre la cookie cuando ambos están presentes, tal como está documentado en el propio código
   ("El header Authorization es SIEMPRE la vía preferente"). Este es el mecanismo concreto que
   resuelve el problema que originó este ADR.

## Referencias
- `frontend/src/auth/authStorage.ts` (`inMemoryAccessToken`, `setInMemoryAccessToken`, `authHeaders`)
- `frontend/src/auth/authApi.ts` (`authFetch`, `refreshAccessToken`, `csrfHeaders`)
- `frontend/src/App.tsx` (restauración de sesión al montar)
- `backend/src/http/http_utils.cpp` / `.hpp` (`setAuthCookies`, `setAccessTokenCookie`, `clearAuthCookies`)
- `backend/src/auth/auth_session.cpp` (`csrfTokenMatches`, lectura de `beemetry_access_token`)
- `backend/src/main.cpp` (`csrfHeaderMatchesCookie`, `handleLogout`, `handleTokenRefresh`)
- `backend/src/config/app_config.cpp` (`BEEMETRY_JWT_ACCESS_TTL_MINUTES` default 15)
- `docs/integration/LOGIN_API_COMPLETE_GUIDE.md` §1.2 (documentación para integradores)
- ADR-029 (JWT híbrido access/refresh), ADR-082 (cookie HttpOnly, auditoría de seguridad que este ADR revisita conscientemente)
