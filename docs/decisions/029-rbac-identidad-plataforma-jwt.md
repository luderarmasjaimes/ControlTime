# ADR-029 — Identidad de plataforma: RBAC multitenant + JWT híbrido (access corto + refresh server-side)

**Status**: accepted (implemented 2026-07-06)
**Fecha**: 2026-06-24
**Revisado**: 2026-07-06
**Autores**: EC
**Ámbito**: plataforma

**Actualización 2026-07-19 (corrección de auditoría + cierre):** el texto
original de este ADR (abajo, sin editar, ver convención de
`docs/decisions/README.md`) describe el refresh token como "**server-side**"
(título) y "opaco... se persiste hasheado" — literalmente cierto del lado
servidor, pero incompleto: no documentaba dónde vivía en el **cliente**. La
auditoría de seguridad de esta semana (trabajo real, sin ADR formal propio
todavía — ver hallazgo de proceso en el informe de avance del 20-jul)
encontró que `frontend/src/auth/authStorage.ts` guardaba **tanto el access
token como el refresh token en `localStorage`**, el mismo store que
`ADR-058` (auditoría de seguridad, pendiente de formalizar) ya había
confirmado vulnerable a robo vía XSS en `TableBlock.tsx` (cerrado esa misma
semana). Un XSS exitoso contra ese vector (o cualquier otro futuro) no solo
robaba una sesión de 15 minutos (el access token) sino la capacidad de
renovarla indefinidamente durante hasta 7 días (`JWT_REFRESH_TTL_DAYS`) sin
volver a autenticarse — divergencia real entre lo documentado y el
comportamiento del sistema, ya identificada explícitamente como pendiente en
la auditoría y cerrada hoy con esta actualización:

- **Refresh token migrado a cookie `HttpOnly; Secure; SameSite=Strict`**,
  con `Path=/api/auth` (acotada a los dos únicos endpoints que la consumen:
  `POST /api/auth/refresh` y `POST /api/auth/logout`). Un script inyectado
  por XSS ya no puede leer el refresh token con `document.cookie` ni con
  ninguna API de JS — `HttpOnly` lo esconde incluso de código que corre en
  la misma página. Ya NO viaja en el body JSON de login/registro/refresh/
  tenant-switch (antes: campo `refresh_token`, ver `authUserSessionJson`).
- **Protección CSRF (double-submit cookie)**: mover el refresh a cookie
  reintroduce el riesgo inverso — el navegador manda la cookie sola en
  cualquier request al dominio, incluida una petición forjada desde un sitio
  de terceros. Mitigación: una segunda cookie `csrf_token` (NO HttpOnly, a
  propósito — el cliente legítimo la lee) que el cliente debe repetir en el
  header `X-CSRF-Token` en cada llamada a `/api/auth/refresh` o
  `/api/auth/logout`; el servidor exige que ambos coincidan
  (`csrfHeaderMatchesCookie` en `main.cpp`). Un sitio de terceros puede
  lograr que el navegador de la víctima **envíe** la cookie de
  `refresh_token`, pero no puede **leer** `csrf_token` (same-origin policy)
  para repetirlo en el header — sin eso, el servidor rechaza con
  `403 csrf_token_mismatch`.
- **`Secure` condicionado a `AppConfig::gAuthCookieSecure`** (default
  `true`, env `BEEMETRY_AUTH_COOKIE_SECURE`): un despliegue real sirve por
  HTTPS con TLS terminado por un balanceador delante (mismo supuesto que
  ADR-054), donde `Secure` debe quedar activo; `docker-compose.yml` (dev/
  staging por HTTP plano en el puerto expuesto) lo desactiva explícitamente
  para no perder la cookie silenciosamente.
- **Access token**: sigue como estaba (JWT corto, enviado por el cliente en
  `Authorization: Bearer` explícito, NO en cookie) — no es necesario
  moverlo: un XSS que ya puede ejecutar JS arbitrario en la página puede
  simplemente llamar a la API autenticada directamente con las cookies de
  sesión del usuario real (browser same-origin), así que mover SOLO el
  access token a cookie no habría cerrado nada; el activo que sí valía la
  pena esconder de JS era el refresh token de larga vida.

Implementación: `backend/src/http/http_utils.{hpp,cpp}` (`extractCookie`,
`setAuthCookies`, `clearAuthCookies`), `backend/src/main.cpp`
(`withAuthCookies`, `csrfHeaderMatchesCookie`, `handleTokenRefresh`,
`handleLogout`), `backend/src/auth/auth_routes.cpp` (`handleSwitchTenant`),
`backend/src/auth/auth_session.cpp` (`AuthTokenPair::csrfToken`). Frontend:
`frontend/src/auth/authStorage.ts` (ya no guarda `refreshToken`),
`frontend/src/auth/authApi.ts` (`refreshAccessToken()`/`logout()` con
`credentials: 'include'` + header `X-CSRF-Token` leído de la cookie legible),
`frontend/src/components/Auth/TenantSwitcher.tsx`.

No se re-emitió texto nuevo de "alternativas descartadas" — la decisión
original de este ADR (access JWT corto + refresh server-side rotado) sigue
vigente sin cambios; lo único corregido es **dónde** vive el refresh token
en el cliente y que ahora hay una defensa CSRF explícita para esa cookie.

## Contexto

El acceso, los perfiles y los permisos son **servicios de plataforma**, no de la app de reportes: la misma identidad debe servir a ReportStudio y a los futuros componentes (visualización en tiempo real y otros — ver ADR-031). Roles (`roleConstants.ts`), tenants/regiones (`platformCatalog.ts`, `PlatformRegionBar.tsx`) y vistas de gestión de usuarios/permisos ya existen. La biometría como factor está diferida (ADR-025).

**Corrección de auditoría (2026-07-06):** el texto original de este ADR afirmaba "el código ya tiene auth con sesiones JWT". Era falso — la implementación real (`auth_session.cpp`) usaba un **token opaco generado con dos UUID concatenados, guardado en un `std::unordered_map` en memoria del proceso del backend C++** (`gAuthSessions`). Sin firma, sin claims, sin validez fuera del proceso que lo emitió. Consecuencias concretas de ese diseño:
- La sesión no sobrevivía un reinicio/redeploy del backend (`aurixa-api`).
- No escalaba horizontalmente: dos instancias del backend detrás de un balanceador no habrían compartido el mapa de sesiones sin un store externo (Redis, etc., que no existía en el stack).
- Cualquier sidecar (`ai_engine`, `formula_engine`, `pdf_export`) que necesitara validar identidad tenía que llamar de vuelta al backend C++ — un salto de red por cada verificación, en una plataforma de telemetría de alto volumen donde eso pesa.

Este ADR revisado documenta el diseño **híbrido** implementado para cerrar esa brecha, evaluado explícitamente para el caso de uso de esta plataforma: telemetría en tiempo real, multitenant, con soporte a distribuidores de software que revenden la plataforma a distintas mineras.

## Decisión

La identidad es un **servicio de plataforma compartido**: **RBAC multitenant + esquema híbrido de tokens**. En v0.1 el login sigue siendo usuario/contraseña o biométrico facial (factor único; MFA no implementado); lo que cambia es el mecanismo de sesión emitido tras autenticar:

- **Access token**: JWT (HS256) de vida corta (`JWT_ACCESS_TTL_MINUTES`, default 15 min). Claims: `sub` (user id), `username`, `company`, `role`, `tenant_id`, `jti` (id único del token), `iat`, `exp`. Se valida **localmente** (verificación de firma + expiración, sin I/O) en cada request — este es el cambio que resuelve el problema de escalabilidad y el salto de red extra para los sidecars.
- **Refresh token**: opaco (aleatorio, sin estructura), de vida larga (`JWT_REFRESH_TTL_DAYS`, default 7 días). Se persiste **hasheado** (SHA-256) en `auth_refresh_tokens` (Postgres) — el valor crudo nunca se guarda, así que una fuga de la tabla no expone tokens utilizables. Rotación estricta: cada `POST /api/auth/refresh` revoca el refresh token usado y emite uno nuevo, de un solo uso — reutilizar un refresh token robado tras su primer uso legítimo falla siempre.
- **Revocación puntual**: dado que el access token es stateless, no se puede "borrar" antes de su expiración natural sin algo de estado. Se mantiene una denylist en memoria de `jti` revocados (`logout`, incidente de seguridad), del tamaño acotado por la ventana de TTL del access token (≤ 15 min de entradas simultáneas en el caso normal) — no es el mapa de sesiones completo que reemplaza este diseño, solo las revocaciones tempranas.

Implementación: `backend/src/auth/jwt.{hpp,cpp}` (firma/verificación HS256 vía OpenSSL, base64url, SHA-256), `backend/src/auth/auth_session.{hpp,cpp}` (emisión/revocación/refresh), tabla `auth_refresh_tokens` (`auth_storage_pg.cpp::ensureAuthSchemaPg`), endpoints `POST /api/auth/refresh` (recibe `refresh_token`, nunca un access token — ese es justamente el que puede haber expirado) y `POST /api/auth/logout` (revoca ambos). Frontend: `frontend/src/auth/authStorage.ts` (guarda el par de tokens + vencimiento estimado), `authApi.ts` (`refreshAccessToken()` con deduplicación de refrescos concurrentes, `authFetch()` con reintento automático tras 401, `logout()` real que notifica al servidor), interceptor de respuesta en `ReportStudioV2/lib/api.ts` (axios) con el mismo patrón de refresh-and-retry.

### Reglas duras
- El backend nunca vuelve a consultar una base de datos ni un mapa en memoria para validar un access token — solo verifica su firma y expiración. Esto es lo que permite que un sidecar futuro valide identidad sin llamar de vuelta al gateway C++ (comparte `JWT_SECRET` por variable de entorno, red interna de Docker).
- El refresh token es de un solo uso: se revoca en el mismo request que lo consume, se emita o no el nuevo con éxito.
- Los permisos son por recurso + rol + tenant; un componente nuevo reutiliza el mismo RBAC y las mismas claims del JWT.
- v0.1: sin persistencia biométrica adicional (ADR-025); el login sigue siendo usuario/contraseña o facial, esto solo cambia el token de sesión emitido después.
- No se modela `distributor_id`/multi-nivel-de-tenant en esta revisión — el modelo de datos actual (`tenant_id` plano en `auth_users`) no tiene ese concepto. Si el negocio de distribuidores de software revendiendo a mineras se formaliza, requiere un ADR propio (jerarquía distribuidor→tenant) antes de tocar las claims del JWT.

## Consecuencias

### Positivas
- Escalabilidad horizontal real: cualquier instancia del backend puede validar cualquier access token emitido por cualquier otra instancia (mismo `JWT_SECRET`), sin sesión compartida.
- Los sidecars pueden validar identidad localmente sin round-trip al gateway (aplica hoy en el propio backend; extensible a `ai_engine`/`formula_engine` si en el futuro exponen endpoints propios).
- Revocación instantánea real en logout e incidentes de seguridad (denylist de `jti` + revocación de refresh token), algo que un JWT puramente stateless no ofrece por sí solo.
- Identidad única reutilizable: el próximo componente (real-time viz) no reimplementa login/perfiles.

### Negativas / Trade-offs
- Un access token comprometido sigue siendo válido hasta su expiración natural (≤ 15 min) aunque se revoque el refresh token asociado — trade-off deliberado del diseño híbrido, mitigado por la ventana corta.
- `JWT_SECRET` fijo en `docker-compose.yml`: rotar la clave invalida todas las sesiones activas de golpe (aceptable, es una operación de emergencia poco frecuente). Si `JWT_SECRET` no se define, el backend genera una clave efímera por proceso con advertencia en log — válido para dev, no para producción.
- Diseñar APIs de identidad component-agnósticas exige disciplina (no meter lógica de reportes en auth) — cubierto por ADR-031.

### Neutras
- `auth_storage_file` y `auth_storage_pg` permiten arrancar sin PG (refresh tokens en memoria del proceso, sin persistencia real) y migrar a PG; en producción el autoritativo es PG.

## Alternativas descartadas

### Mantener el session-token opaco en memoria (estado anterior)
Es lo que había. Descartado por las tres razones de la sección "Contexto": no sobrevive reinicios, no escala horizontalmente, y obliga a los sidecars a un round-trip por cada verificación de identidad — inaceptable para una plataforma de telemetría de alto volumen.

### JWT puro sin refresh token server-side (stateless total)
Simple, pero sin revocación real: un access token robado o una sesión que se necesita matar de inmediato (dispositivo comprometido en el flujo biométrico, admin forzando logout) solo se resuelve esperando su expiración o manteniendo una blocklist — que es reintroducir estado por la puerta de atrás. Se prefirió reconocerlo explícitamente y diseñar esa pieza de estado (denylist de `jti`, acotada) en vez de fingir que no hace falta.

### Auth específico por componente
Cada frontend con su login → duplicación, inconsistencia de permisos y mala UX. Rechazado: la identidad es de plataforma.

### Biometría como factor en v0.1
Bloqueado por ADR-025 (legal). Login user/pass o facial en v0.1; esto no cambia con esta revisión.

## Referencias
- `backend/src/auth/jwt.hpp`, `jwt.cpp` (firma/verificación HS256)
- `backend/src/auth/auth_session.hpp`, `auth_session.cpp` (emisión/refresh/revocación)
- `backend/src/auth/auth_storage_pg.cpp` (tabla `auth_refresh_tokens`, `ensureAuthSchemaPg`)
- `frontend/src/auth/authStorage.ts`, `authApi.ts` (`refreshAccessToken`, `authFetch`, `logout`)
- `frontend/src/components/ReportStudioV2/lib/api.ts` (interceptor axios de refresh-and-retry)
- ADR-002 (gateway), ADR-025 (biometría diferida), ADR-030 (auditoría), ADR-031 (plataforma compartida)
