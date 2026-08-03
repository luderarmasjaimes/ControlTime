# ADR-081 — CORS multiorigen para habilitar un segundo frontend externo

**Status**: accepted (implementado 2026-08-02)
**Fecha**: 2026-08-02
**Autores**: EC
**Ámbito**: auth, plataforma

> Se planea una segunda aplicación frontend (repositorio propio, aún no
> creado) que reutilizará el login (password y facial) y los módulos de
> permisos/accesos de este mismo backend. `http_utils::corsAllowedOrigin()`
> solo admitía un origen fijo — endurecido a propósito en la auditoría
> 2026-07-13 (antes era wildcard `*`) porque el único frontend real era
> same-origin vía nginx. Ese único-origen es incompatible con una segunda
> app en otro origen. Este ADR agrega soporte para múltiples orígenes
> permitidos sin reabrir el wildcard ni tocar el mecanismo de sesión/CSRF.

## Contexto

Investigación previa del código de auth confirmó que los endpoints
(`/api/auth/login/password`, `/login/face`, `/refresh`, `/logout`,
`/register`, `/tenants`, `/tenants/switch`, `/permissions`) y el helper de
permisos `auth::hasPermission()` (`backend/src/auth/permissions.cpp`) ya son
genéricos — no están acoplados al frontend actual. El único bloqueador real
para que una segunda app los consuma desde el navegador es CORS.

El equipo decidió que la nueva app se desplegará **same-site** (p.ej. como
subdominio del mismo dominio registrable que el backend, detrás de un
reverse proxy), no cross-site con cookies `SameSite=None`. Esto es
relevante porque las cookies de sesión actuales
(`refresh_token`/`csrf_token_v2`, `http_utils::buildCookieHeader`,
`http_utils.cpp`) son *host-only* (sin `Domain=` explícito) y
`SameSite=Strict`. `SameSite=Strict` restringe peticiones **cross-site**,
no cross-*origin*: una petición entre subdominios del mismo dominio
registrable (`app2.midominio.com` → `api.midominio.com`) sigue siendo
same-site, así que esas cookies viajan igual que hoy sin tocar nada. Lo
único que faltaba era que el navegador reciba un
`Access-Control-Allow-Origin` que coincida con el origen exacto de la
petición.

## Decisión

### Allowlist en el mismo env var, un solo choke point para reflejarlo

`BEEMETRY_CORS_ALLOWED_ORIGIN` (`http_utils.cpp`) pasa a admitir una lista
separada por comas — retrocompatible, un solo valor sigue funcionando
exactamente igual que antes. `http_utils::parseCorsOriginsList()` (función
pura, testeada en `backend/tests/test_http_utils.cpp`) hace el parseo
(recorta espacios, ignora entradas vacías, nunca produce una lista vacía —
cae al default local seguro). `corsAllowedOrigins()` cachea el resultado en
un `static` de proceso, igual que el `corsAllowedOrigin()` original.

Reflejar el origen correcto por request requiere el header `Origin` de la
petición entrante, que **no** está disponible en los cientos de call sites
que arman respuestas vía `makeJsonResponse`/`makePdfResponse`/etc. — esas
funciones no reciben la request. En vez de tocar cada handler, se agregó un
único punto de control: `router::Router::dispatch()` ya es el paso
obligatorio de **toda** respuesta (ahí vive `applySecurityHeaders()`,
aplicado en las 4 salidas: OPTIONS, ruta exacta, ruta prefijo, 404). Se
agregó `applyCorsOriginOverride(res, req)` justo al lado: si el header
`Origin` de la request coincide exactamente con una entrada de la
allowlist (`http_utils::resolveCorsOrigin()`), sobrescribe
`Access-Control-Allow-Origin`/`Access-Control-Allow-Credentials`/`Vary` en
la respuesta ya construida por el handler. Si no matchea (o no hay header
`Origin`, caso same-origin normal), no toca nada — queda el default actual
(primer origen de la lista), que el navegador rechaza igual que hoy si no
coincide con su propio origen.

Esto cubre también los 2-3 call sites que arman su respuesta manualmente
sin pasar por `makeJsonResponse` (`gdal_routes.cpp:262`,
`tenant_assets_routes.cpp:156,283`), porque igual pasan por
`Router::dispatch()` antes de llegar al cliente.

### Qué NO cambió, y por qué

- **Cookies/CSRF**: sin cambios. El despliegue same-site decidido por el
  equipo hace innecesario tocar `SameSite`/`Domain` — ver Contexto.
- **No se agregó client-id/API-key por app**: no se pidió, y no aporta nada
  en este modelo — cada app se autentica igual que la actual (usuario o
  facial, contra un tenant real vía `resolveTelemetryTenantIdPg`). Si en el
  futuro se necesita distinguir qué app llama (rate-limiting o auditoría por
  app, por ejemplo), `security::ApiKeyAuth` (`backend/src/security/api_auth.cpp`)
  ya existe pero solo está enlazado a `main_modular.cpp` (no es el binario de
  producción) — sería el punto de partida natural.

## Consecuencias

### Positivas
- Ninguna app frontend nueva necesita tocar el backend más allá de agregar
  su origen a `BEEMETRY_CORS_ALLOWED_ORIGIN` — el resto del contrato de auth
  y permisos ya es reutilizable (ver
  `docs/integration/EXTERNAL_FRONTEND_AUTH.md`).
- Cambio acotado a 2 archivos de lógica (`http_utils.hpp/cpp`,
  `router.cpp`) — cero cambios en los handlers existentes.
- El wildcard `*` sigue sin ser una opción; cada origen debe listarse
  explícitamente.

### Negativas / Trade-offs
- Si la nueva app termina desplegándose en un dominio realmente distinto
  (no same-site), habrá que revisar `SameSite`/`Domain` de las cookies en
  ese momento — deliberadamente fuera de alcance de este ADR.
- `corsAllowedOrigins()` sigue siendo un `static` de proceso (igual que
  antes): cambiar el env var requiere reiniciar el proceso, no hay reload
  en caliente.

## Alternativas descartadas

### Wildcard `*` de nuevo
Revertiría la auditoría de seguridad 2026-07-13 sin necesidad — la
allowlist explícita cubre el caso real (número acotado de frontends
conocidos) sin abrir la API a cualquier origen.

### Cookies `SameSite=None; Secure` + CORS cross-site completo
Evaluado y descartado por decisión explícita del equipo: reabre la
superficie CSRF que la auditoría 2026-07-13 cerró a propósito, y exige TLS
obligatorio en ambos lados. El despliegue same-site (subdominio + reverse
proxy) logra el mismo resultado sin ese riesgo.

## Referencias
- `backend/src/http/http_utils.hpp/cpp` (`corsAllowedOrigins`,
  `parseCorsOriginsList`, `resolveCorsOrigin`)
- `backend/src/http/router.cpp` (`applyCorsOriginOverride`,
  `Router::dispatch`)
- `backend/tests/test_http_utils.cpp` (casos `[http_utils][cors]`)
- `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`
  (`BEEMETRY_CORS_ALLOWED_ORIGIN`)
- `docs/integration/EXTERNAL_FRONTEND_AUTH.md` (nuevo — contrato de auth y
  permisos para la app frontend externa)
- Auditoría 2026-07-13 (CORS de `*` a origen único), ADR-029/ADR-029
  "Actualización 2026-07-19" (cookies `refresh_token`/`csrf_token_v2`,
  double-submit CSRF), ADR-067 (resolución de tenant en login/registro)
