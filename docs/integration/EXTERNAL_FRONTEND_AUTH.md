# Contrato de auth y permisos para un frontend externo

> Para quien construya la nueva aplicación frontend (repo separado) que
> consumirá este mismo backend para login (password y facial) y para los
> módulos de permisos/accesos. Ver [ADR-081](../decisions/081-cors-multiorigen-frontend-externo.md)
> para el porqué del cambio de CORS que habilita esto, y
> [ADR-029](../decisions/029-rbac-identidad-plataforma-jwt.md) para el diseño original de sesión/JWT.
>
> Todo lo descrito acá ya existe en el backend actual — este documento no
> introduce endpoints nuevos, solo documenta el contrato para un cliente
> distinto del frontend actual (`frontend/src/auth/authApi.ts`,
> `authStorage.ts`, `usePermissions.ts`, que implementan exactamente este
> mismo contrato y son la referencia de implementación más directa).

## 0. Requisito de despliegue: CORS

El origen exacto de la nueva app (esquema+host+puerto) debe estar en
`BEEMETRY_CORS_ALLOWED_ORIGIN` del backend (lista separada por comas, ver
`.env.example`). Sin eso, el navegador bloquea toda petición aunque las
credenciales sean correctas. Recomendado: desplegar la nueva app como
subdominio del mismo dominio registrable que el backend (same-site), para
que las cookies de sesión (ver §2) funcionen sin ningún cambio adicional.

## 1. Endpoints de autenticación

Base: mismo host/puerto que el backend (`/api/auth/...`).

| Método | Ruta | Body / Query | Devuelve |
|---|---|---|---|
| POST | `/api/auth/login/password` | `{company, username, password}` | `{status:"authenticated", method:"password", user:{...}}` (§3) |
| POST | `/api/auth/login/face` | `{company, identity_login, face_image_base64}` (o `face_template: number[]` si ya se tiene un template compatible) | `{status:"authenticated", method:"face", biometric_provider, score, user:{...}}` |
| POST | `/api/auth/register` | `{company, first_name, last_name, dni, username, password, role?, ...}` + `face_image_base64` o `face_template` | `{status:"registered", user:{...}}` |
| POST | `/api/auth/refresh` | sin body; requiere cookie `refresh_token` + header `X-CSRF-Token` | nuevo `access_token` (mismo shape que `user` en login) |
| POST | `/api/auth/logout` | sin body; requiere `Authorization: Bearer` y, si hay cookie `refresh_token`, header `X-CSRF-Token` | `{status:"logged_out"}` |
| GET/POST | `/api/auth/login/check-identity` | `{company, identity_login}` | resuelve username/DNI/RUC a un username canónico antes de abrir la cámara |
| GET | `/api/auth/validate-company` | query `?ruc=...` | valida RUC/CNPJ/EIN (sin auth) |
| GET | `/api/auth/companies` | — | catálogo de empresas/tenants |
| GET | `/api/auth/tenants` | requiere sesión | tenants a los que pertenece el usuario |
| POST | `/api/auth/tenants/switch` | `{tenant_id}`, requiere sesión | re-emite tokens para otro tenant (verifica membresía real server-side) |

Referencia de implementación: `backend/src/main.cpp` (`handleLoginPassword`
línea 891, `handleLoginFace` línea ~950, `handleTokenRefresh` línea 845) y
`backend/src/auth/auth_routes.cpp` (tenants, companies, check-identity).

### Login facial — qué mandar exactamente
El backend hace todo el trabajo pesado (extracción de embedding, comparación
contra el template guardado); el cliente solo necesita:
1. Capturar un frame de cámara como JPEG.
2. (Opcional pero recomendado durante la captura en vivo) llamar
   `POST /api/process_frame` con los bytes del JPEG para feedback ICAO en
   vivo (ojos abiertos, boca cerrada, pose frontal, anteojos) — ver
   `backend/src/biometric/ai_engine_client.cpp::analyzeFrameWithAiEngine`.
3. Convertir el frame final a base64 y mandarlo como `face_image_base64` en
   `company` + `identity_login` (username/DNI/RUC) a
   `POST /api/auth/login/face`.

No hace falta que el cliente calcule ningún embedding — mandar
`face_template` directamente solo tiene sentido si el cliente puede generar
un template con la misma dimensionalidad que el guardado en el backend
(poco práctico para una app nueva).

## 2. Manejo de tokens y sesión

- **Access token**: JWT, TTL 15 min (`gJwtAccessTtlMinutes`), viaja en el
  body JSON (`user.access_token`) y se reenvía en cada petición autenticada
  como header `Authorization: Bearer <access_token>`.
- **Refresh token**: opaco, TTL 7 días, **nunca** en el body — viaja
  únicamente en la cookie HttpOnly `refresh_token` (`Path=/api/auth`,
  `SameSite=Strict`, `Secure` si `BEEMETRY_AUTH_COOKIE_SECURE=true`). El
  cliente no necesita (ni puede) leerlo — el navegador lo adjunta solo en
  peticiones a `/api/auth/*` del mismo sitio.
- **CSRF double-submit**: cookie `csrf_token_v2` (`Path=/`, legible por JS)
  — el cliente debe leerla (`document.cookie`) y repetirla en el header
  `X-CSRF-Token` al llamar `/api/auth/refresh` o `/api/auth/logout`.
- **Flujo típico**: al recibir 401 en cualquier petición autenticada, llamar
  `POST /api/auth/refresh` (con `credentials: 'include'` para mandar la
  cookie) para obtener un `access_token` nuevo y reintentar la petición
  original una vez. Si el refresh también falla, tratar como sesión
  expirada (logout local).
- Todas las peticiones autenticadas deben usar `fetch(..., {credentials:
  'include'})` (o equivalente) para que el navegador adjunte las cookies —
  aunque el access token vaya en el header, el refresh depende de la cookie.

Implementación de referencia (mismo patrón, mismo backend):
`frontend/src/auth/authApi.ts` (`authFetch`, `refreshAccessToken`,
`loginWithPassword`, `loginWithFace`) y `frontend/src/auth/authStorage.ts`
(`Session`, `readCookie`).

### Shape de `user` (mismo objeto en login/register/refresh)
```jsonc
{
  "id": "...",
  "company": "...",
  "username": "...",
  "role": "admin|manager|supervisor|geologist|safety|operator|viewer",
  "access_token": "...",
  "expires_in": 900,
  "token_type": "Bearer",
  "full_name": "...",
  "tenant_id": "uuid",
  "avatar_cartoon_base64": "..." // opcional, si ya tiene avatar generado
}
```
(`backend/src/auth/auth_storage_file.cpp::authUserSessionJson`, reutilizado
por todos los backends de storage.)

## 3. Permisos / RBAC

- `GET /api/auth/permissions` (requiere sesión) →
  `{role, tenant_id, is_admin, permissions: string[]}` — usar esto para
  gatear la UI de la nueva app (mostrar/ocultar acciones).
- `GET /api/auth/permissions/matrix` / `POST .../matrix` — matriz completa
  rol×permiso, requiere el permiso `permisos.manage` (pantalla de
  administración, no necesaria para un frontend operativo normal).
- **Cualquier endpoint nuevo del backend** que la nueva app necesite debe
  seguir el mismo patrón que ya usa todo el código existente (no hay
  middleware automático — cada handler lo hace explícito):
  ```cpp
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, ...);
  if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                           "codigo.permiso"))
      return makeJsonResponse(http::status::forbidden, ...);
  ```
  (`backend/src/auth/permissions.hpp/cpp`; ejemplos reales en
  `report_routes.cpp`, `auth_routes.cpp`, `notification_routes.cpp`.)
  `admin` siempre pasa cualquier check. Nunca confiar en un `tenant_id`
  mandado por el cliente — siempre usar `session->tenantId` (resuelto
  server-side, ver `auth::resolveAuthSession`).

Implementación de referencia en el frontend actual:
`frontend/src/auth/usePermissions.ts` (hook con cache en memoria por
`userId:tenantId`, expone `hasPermission(code)`/`isAdmin`/`role`).

## 4. Multi-tenancy

`company` en login/registro es el nombre de la empresa MINERA (no del
contratista — ver ADR-066); el backend resuelve el `tenant_id` real a
partir de ahí (o del tenant por defecto del usuario si ya tiene cuenta). Un
usuario puede pertenecer a varios tenants (`/api/auth/tenants` +
`/tenants/switch`). No hay forma de que el cliente fuerce un `tenant_id`
arbitrario — todo pasa por membresía verificada server-side.
