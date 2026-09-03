# Guía completa del API de Login y Control de Accesos — referencia para un nuevo frontend

> **Audiencia**: equipo de desarrollo TI que va a implementar un frontend nuevo (o un cliente
> externo) contra este backend. Este documento es **autocontenido y completo**: cubre TODO el
> ciclo de vida de autenticación y autorización — registro, login (contraseña y biometría),
> sesión, multitenancy, permisos, gestión de usuarios/empresas, y acceso cruzado de organización.
>
> No asume acceso al código fuente de la plataforma. Consolida y reemplaza como punto de entrada
> único a [`BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md`](BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md) (detalle
> extendido de captura biométrica) y [`ACCESS_CONTROL_API_GUIDE.md`](ACCESS_CONTROL_API_GUIDE.md)
> (detalle extendido de empresas/permisos/acceso cruzado) — ambos siguen vigentes para
> profundizar, pero este documento ya trae todo lo esencial de los tres.
>
> **Página de prueba de referencia**: [`external-api-test-page/index.html`](../../external-api-test-page/index.html)
> implementa en vivo el 100% de los flujos descritos aquí — ver §12.

---

## 0. Mapa completo del API (índice rápido)

| # | Área | Endpoints | Sección |
|---|---|---|---|
| 1 | Catálogos previos al login | `GET /api/platform/countries`, `GET /api/auth/companies` | §2 |
| 2 | Identidad / validación fiscal | `GET·POST /api/auth/login/check-identity`, `GET /api/auth/validate-company` | §3 |
| 3 | Registro (alta con biometría) | `POST /api/auth/register` | §4 |
| 4 | Login | `POST /api/auth/login/password`, `POST /api/auth/login/face` | §5 |
| 5 | Sesión | `POST /api/auth/refresh`, `POST /api/auth/logout` | §6 |
| 6 | Multitenancy | `GET /api/auth/tenants`, `POST /api/auth/tenants/switch` | §7 |
| 7 | Permisos | `GET /api/auth/permissions`, `GET·POST /api/auth/permissions/matrix` | §8 |
| 8 | Usuarios (admin) | `POST /api/auth/users/create`, `GET /api/auth/users`, `POST /api/auth/users/maintenance`, `GET·POST /api/auth/users/{u}/tenants[/remove]` | §9 |
| 9 | Empresas | `GET /api/auth/companies[/manage]`, `POST/PUT/DELETE /api/auth/companies[/{id}]` | §10 |
| 10 | Acceso cruzado de organización | `GET /api/auth/org-access/candidates`, `POST /api/auth/org-access/grant`, `POST /api/auth/org-access/revoke`, `GET /api/auth/org-access/audit` | §11 |
| 11 | Auditoría | `GET /api/auth/audit`, `GET /api/auth/audit/export.csv` | §11.6 |

---

## 1. Convenciones comunes (leer antes de integrar)

### 1.1 Origen permitido (CORS)
El backend solo acepta peticiones cross-origin desde orígenes en `BEEMETRY_CORS_ALLOWED_ORIGIN`
(lista separada por comas, configurada del lado de la plataforma). **Antes de integrar un
frontend nuevo**, coordine con el equipo de la plataforma para agregar su origen exacto (esquema +
host + puerto). Sin esto, el navegador bloquea toda petición sin dar información útil del error
real (`TypeError: Failed to fetch`).

### 1.2 Credenciales de sesión: Bearer en memoria (recomendado) + cookies de respaldo

**Use `Authorization: Bearer <access_token>` como vía principal.** El valor viene en
`user.access_token` de la respuesta de login/registro/refresh — guárdelo **solo en una variable de
JS (memoria), nunca en `localStorage`/`sessionStorage`**, y adjúntelo en cada petición. Es la única
vía inmune a un problema real y verificado: dos frontends distintos corriendo en el mismo host
(mismo dominio, distinto puerto — típico durante pruebas en una misma laptop) **comparten el mismo
cajón de cookies del navegador**, porque las cookies HTTP se comparten por dominio, no por puerto
(RFC 6265). Un login en una app puede pisar silenciosamente la cookie de sesión de otra. Bearer en
memoria no tiene ese problema: cada aplicación mantiene su propio token en su propio contexto de
JS, sin depender de un recurso compartido por host.

El servidor también sigue emitiendo 3 cookies (`beemetry_access_token` HttpOnly, `beemetry_refresh_token`
HttpOnly `Path=/api/auth`, `beemetry_csrf_token` legible por JS) por compatibilidad con clientes que
aún dependan de ellas — nombres **namespaced** (`beemetry_*`, no genéricos) para minimizar el riesgo
de colisión con una cookie de igual nombre de otra aplicación en el mismo host. Si su frontend usa
Bearer de punta a punta, estas cookies son irrelevantes para usted salvo por **`/api/auth/refresh`
y `/api/auth/logout`**, que siguen dependiendo de `beemetry_refresh_token` (nunca expuesto por
Bearer, a propósito — ver más abajo) y por lo tanto siguen exigiendo el header CSRF.

**Regla dura**: toda petición autenticada que mute estado (POST/PUT/DELETE) enviada por **cookie**
(incluido `/api/auth/refresh`/`/api/auth/logout`, aunque el resto de su tráfico use Bearer) debe
incluir el header `X-CSRF-Token` con el valor de la cookie legible `beemetry_csrf_token` (patrón
double-submit). Las peticiones autenticadas por **Bearer** están exentas de CSRF.

**TTL corto y por qué**: el access token vive **15 minutos** (`BEEMETRY_JWT_ACCESS_TTL_MINUTES`).
Es corto a propósito: al vivir en memoria de JS (no solo en una cookie HttpOnly invisible),
la ventana de exposición ante un XSS importa más que la frecuencia de renovación — que debe ser
transparente para el usuario (refresh proactivo antes de vencer, y reintento automático tras un
401, ver `frontend/src/auth/authApi.ts::authFetch` como referencia de implementación). El
`refresh_token` (7 días) nunca se expone por Bearer — solo por la cookie HttpOnly — precisamente
para que un token de acceso robado de memoria tenga una vida útil corta y no pueda renovarse solo.

### 1.3 Rate limiting de red
- Zona general: `20 req/s` en `/api/*`.
- Zona de login: `15 req/min` en `/api/auth/login/*` (más estricta).
- Zona de acceso cruzado: `10 req/min` en `/api/auth/org-access/*` (la capacidad de mayor
  privilegio, ver §11).
- Además, rate limiting **por cuenta** a nivel de aplicación: 5 intentos fallidos / 5 min por
  `company|username` — devuelve `429 too_many_failed_attempts`.

### 1.4 Multitenancy — el concepto central
Un usuario puede pertenecer a **más de un tenant** (unidad minera/empresa). El JWT lleva un
`tenant_id` — el tenant **activo** de esa sesión concreta. Todo endpoint que dependa de "mi
empresa" (permisos, usuarios, informes) usa este tenant activo, nunca uno que el cliente pase por
body/query. Ver §7 para listar y cambiar de tenant sin recerrar sesión.

### 1.5 Los 7 roles reales
`admin`, `manager`, `supervisor`, `geologist`, `safety`, `operator`, `viewer` — sin jerarquía entre
ellos (cada uno tiene su propio conjunto de permisos, editable vía §8.2). No traducir/derivar
lógica de negocio de estos strings más allá de comparaciones exactas.

---

## 2. Catálogos previos al login

### `GET /api/platform/countries`
Público. Catálogo de países (ISO2, nombre, idioma por defecto — ADR-075) para poblar un selector
país→idioma→empresa antes del login.

### `GET /api/auth/companies[?country=XX]`
Público. Nombres de empresas activas. Sin `country`, devuelve todas; con `country` (ISO2), filtra.
Alimenta el `<select>` de empresa del formulario de login/registro.

```jsonc
{ "companies": ["Minera Raura", "Ferreyros S.A.A.", "..."] }
```

---

## 3. Identidad y validación fiscal (antes de loguear)

### `GET/POST /api/auth/login/check-identity?company=...&identity=...`
Público. Resuelve si un identificador (usuario/DNI/RUC) corresponde a exactamente un usuario en
esa empresa — útil para UX de "verificar antes de pedir contraseña".

```jsonc
// éxito
{ "ok": true, "username": "jsmith" }
// no encontrado
{ "ok": false, "reason": "not_found", "error": "..." }
// ambiguo (coincide con más de un usuario)
{ "ok": false, "reason": "ambiguous", "error": "..." }
```

### `GET /api/auth/validate-company?ruc=...&country=...[&company=...]`
Público. Valida el checksum del identificador fiscal según el país (RUC 11 dígitos Perú, CNPJ
Brasil, EIN/SSN-like EE.UU./Canadá, Ecuador/Chile/Costa Rica — ADR-075/102). Si se define
`BEEMETRY_TAX_REGISTRY_ENABLED=true`, además consulta un padrón externo de terceros (nunca
bloquea el flujo si no responde a tiempo — cae al checksum local).

---

## 4. Registro (alta con biometría obligatoria)

### `POST /api/auth/register`
Público. Autoregistro de un usuario nuevo — **exige biometría facial** (a diferencia del alta
admin-driven de §9.1, que no la exige). Provisiona un tenant real para la empresa indicada si no
existía (ADR-078/067).

```jsonc
// Request
{
  "company": "Minera Raura",       // razón social EXACTA (ADR-066: la de la minera, no un contratista)
  "first_name": "John", "last_name": "Smith",
  "dni": "12345678", "username": "jsmith", "password": "mínimo 6 caracteres",
  // Biometría: EXACTAMENTE una de estas dos vías —
  "face_template": [0.123, -0.045, /* ...vector numérico del motor local... */],
  // — o —
  "face_image_base64": "<jpeg en base64, sin prefijo data:>",
  // Opcionales:
  "role": "operator",              // si se omite, se resuelve heurísticamente
  "email": "...", "phone": "...", "mobile": "...", "ruc": "..."
}
```

**Éxito** — `201 Created`:
```jsonc
{
  "status": "registered",
  "biometric_provider": "insightface_onnx",  // o "deepface_silentface" | motor legacy
  "quality_score": 0.92,
  "user": { /* objeto de sesión — ver §5.3 */ }
}
```

**Errores** — `400`: `dni must be numeric`, `username or password length is invalid`,
`face not detected` (con `issues: string[]` explicando por qué), `face_template is too short`.
`409`: `dni already exists` / `username already exists in this company`.

---

## 5. Login

### 5.1 Login por contraseña
```
POST /api/auth/login/password
Content-Type: application/json

{ "company": "Minera Raura", "username": "jsmith", "password": "...",
  "location": { /* opcional, ver §5.4 */ } }
```
**Éxito** `200`: `{ "status": "authenticated", "method": "password", "user": { ... } }` (§5.3).

**Errores** `401` salvo el de bloqueo: `user_not_found`, `ambiguous_identity`, `wrong_password`,
cuenta `blocked`/`suspended`/`deleted` (mensaje descriptivo). `429 too_many_failed_attempts` tras
5 fallos en 5 min para esa cuenta.

### 5.2 Login facial
```
POST /api/auth/login/face
Content-Type: application/json

{ "company": "Minera Raura", "identity_login": "jsmith",
  "face_image_base64": "...", "location": { /* opcional */ } }
```
Acepta `face_template` (numérico, solo para pruebas de contrato — nunca se usa en producción real
sin imagen: el motor local exige imagen de cámara real para el chequeo de vida/anti-spoofing).
Mismo objeto `user` de éxito que §5.1; mismos códigos de error, más específicos del motor
biométrico (`no_match`, `template_too_short`, `probe_build_failed`, etc. — ver
[`BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md`](BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md) para el detalle
completo de captura ICAO/checklist en vivo).

### 5.3 Objeto de sesión `user` (idéntico en login/registro)
```jsonc
{
  "id": "uuid", "company": "Minera Raura", "username": "jsmith", "role": "operator",
  "access_token": "eyJ...", "expires_in": 900, "token_type": "Bearer",
  "full_name": "John Smith", "tenant_id": "uuid",
  "avatar_cartoon_base64": "...",   // opcional, si tiene avatar generado
  "department": "..."               // opcional, ADR-115, solo si el tenant lo usa
}
```
Guarde `access_token` **solo en memoria de JS** (nunca en `localStorage`) — ver §1.2. El refresh
token **nunca** viaja en este body — llega en la cookie `HttpOnly` `beemetry_refresh_token`
(`Path=/api/auth`), junto con `beemetry_csrf_token` (legible, para el patrón double-submit de §1.2).

### 5.4 Ubicación del cliente (opcional, ADR-107)
`location: { latitude, longitude, accuracy }` — best-effort, nunca bloquea el login. Se persiste
en columnas dedicadas de auditoría (ver §11.6) junto con la IP real del cliente (capturada
server-side vía `X-Real-IP`, no depende de que el cliente la reporte).

---

## 6. Sesión: refresh y logout

### `POST /api/auth/refresh`
Sin body — el `refresh_token` viaja en la cookie. Requiere `X-CSRF-Token` (double-submit, §1.2).
**De un solo uso**: reintentar con el mismo refresh token después de esta llamada siempre falla
(rotación anti-replay). Éxito `200`: mismo objeto `user` con un `access_token` nuevo; setea cookies
nuevas. Error `401 invalid_or_expired_refresh_token` (limpia las cookies viejas también).

### `POST /api/auth/logout`
Requiere sesión válida (cookie o Bearer). Revoca el `access_token` (por `jti`) y el
`refresh_token` si vino por cookie. Éxito `200 { "status": "logged_out" }`, limpia todas las
cookies de auth.

---

## 7. Multitenancy: listar y cambiar de tenant activo

### `GET /api/auth/tenants`
Requiere sesión. Lista las unidades a las que el usuario tiene acceso — tanto membresía real como
concesiones de acceso cruzado (§11), distinguidas por `via`:
```jsonc
{ "tenants": [
  { "tenant_id": "uuid", "tenant_name": "Minera Raura", "role": "operator",
    "is_default": true, "active": true, "via": "membership" },
  { "tenant_id": "uuid", "tenant_name": "Minera Yanacocha", "role": "supervisor",
    "is_default": false, "active": false, "via": "org_grant" }
]}
```

### `POST /api/auth/tenants/switch` — `{ "tenant_id": "uuid" }`
Reemite la sesión (access + refresh) apuntando al tenant destino, **verificando membresía real**
(nunca confía en el `tenant_id` del body sin esa verificación — protección anti-IDOR). Éxito `200`:
`{ "ok": true, "access_token": "...", "expires_in": ..., "tenant_id": "...", "role": "..." }`
(setea cookies nuevas igual que login). Error `403 no_pertenece_al_tenant` si no hay membresía ni
concesión válida para ese tenant.

**Importante para el frontend**: tras un switch exitoso, recargar el estado de la SPA por completo
(o al menos invalidar toda caché de permisos/datos scopeados a tenant) — el `tenant_id` del JWT
cambió y todo dato ya cargado corresponde al tenant anterior.

---

## 8. Permisos

### `GET /api/auth/permissions`
Requiere sesión. Introspección del propio usuario en su tenant activo:
```jsonc
{
  "role": "admin", "tenant_id": "uuid", "is_admin": true,
  "is_organization_tenant": false,   // true solo si el tenant es Beemetry/TimeTelemetry — ver §11
  "permissions": ["mapas.view", "informes.edit", "usuarios.manage", "..."]
}
```
Úsese para decidir qué mostrar/ocultar en la UI — el backend **siempre** revalida el permiso real
en cada endpoint, esto es solo para evitar parpadeo de acciones que el servidor rechazaría.

### `GET /api/auth/permissions/matrix` (requiere `permisos.manage`)
Catálogo completo de permisos + la matriz rol→permiso del tenant activo.

### `POST /api/auth/permissions/matrix` (requiere `permisos.manage`)
`{ "role": "supervisor", "permissions": ["mapas.view", "..."] }` — **reemplaza por completo** los
permisos de ese rol para el tenant activo (no es un patch incremental: reenviar el set completo
deseado).

**Semántica de override**: si el tenant activo tiene al menos una fila propia para un rol, esas
filas **reemplazan entero** el default global de ese rol (no se mezclan).

---

## 9. Usuarios (administración)

### 9.1 `POST /api/auth/users/create` (requiere `usuarios.manage`)
Alta administrada **sin biometría** (a diferencia del autoregistro de §4) — el usuario enrola su
rostro en su primer login.
```jsonc
{ "username": "jsmith", "password": "mínimo 8 caracteres", "first_name": "John",
  "last_name": "Smith", "dni": "12345678", "role": "operator", "email": "..." }
```
Se crea en la empresa/tenant activo de quien lo da de alta, con membresía real ya vinculada.

### 9.2 `GET /api/auth/users` (requiere sesión)
Lista usuarios de la empresa/tenant activo de la sesión (nunca de un tenant arbitrario).

### 9.3 `POST /api/auth/users/maintenance` (requiere sesión)
Acciones sobre un usuario existente: `block` / `unblock` / `suspend` / `delete` /
`change_profile` / `edit_data` / `reset_password`. Exige motivo (`reason`) y confirmación de
operador (contraseña o biometría) según la acción.

### 9.4 Membresía multitenant de OTRO usuario (requiere `usuarios.manage`)
- `GET /api/auth/users/{username}/tenants` — tenants del usuario objetivo (con `via`, igual que §7).
- `POST /api/auth/users/{username}/tenants` — `{ "role": "operator" }`, otorga acceso **al tenant
  activo de quien llama** (nunca uno arbitrario — anti-IDOR). Para dar acceso a OTRA empresa desde
  una cuenta de organización, ver §11.
- `POST /api/auth/users/{username}/tenants/remove` — revoca esa membresía.

---

## 10. Empresas

### `GET /api/auth/companies/manage[?include_inactive=true]` (requiere `empresas.view`)
Catálogo administrativo completo. El RUC viene enmascarado si el solicitante no tiene además
`empresas.manage`.

### `POST /api/auth/companies` (requiere `empresas.manage`)
```jsonc
{ "name": "Minera Ejemplo S.A.", "ruc": "20123456789", "country": "PE",
  "domicilio_fiscal": "...", "company_type": "mining_client",
  "latitude": -10.5, "longitude": -76.3, "location_zoom": 12 }
```
`company_type`: `"mining_client"` (default) | `"organization"` (Beemetry/TimeTelemetry — ver §11).
Provisiona un tenant real automáticamente. Dedup case-insensitive por nombre.

### `PUT /api/auth/companies/{company_id}` / `DELETE /api/auth/companies/{company_id}[?reactivate=true]`
Editar RUC/país/domicilio/coordenadas/`company_type` (nunca `name`), o dar de baja/reactivar
(soft delete). Ver [`ACCESS_CONTROL_API_GUIDE.md`](ACCESS_CONTROL_API_GUIDE.md) §1 para el detalle
completo campo por campo.

---

## 11. Acceso cruzado de organización

Mecanismo para que personal de una empresa `company_type='organization'` (Beemetry/TimeTelemetry)
opere en tenants mineros clientes con uno de los 7 roles existentes — sin ser membresía real y con
auditoría propia (ADR-130). **Requisito para TODOS estos endpoints**: el actor debe tener el
permiso `org.cross_tenant.manage` **y** operar desde un tenant `company_type='organization'`
(el guardia no se puede eludir aunque el permission_code aparezca en la matriz de un tenant
minero — ver ACCESS_CONTROL_API_GUIDE.md §6.1 para el detalle de por qué).

- `GET /api/auth/org-access/candidates` — tenants mineros disponibles.
- `POST /api/auth/org-access/grant` — `{ "username", "tenant_id", "role" }`.
- `POST /api/auth/org-access/revoke` — `{ "username", "tenant_id" }`.
- `GET /api/auth/org-access/audit[?limit=&offset=]` — historial dedicado, incluye `source_ip`.

Ver [`ACCESS_CONTROL_API_GUIDE.md`](ACCESS_CONTROL_API_GUIDE.md) §6 para el contrato completo con
ejemplos de cada respuesta y todos los códigos de error.

### 11.6 Auditoría general
- `GET /api/auth/audit?page=&page_size=&company=&username=&action=&success=` (requiere rol admin)
  — cada fila incluye `event_time, event_action, company_name, username, success, detail,
  source_ip, latitude, longitude, accuracy_m`.
- `GET /api/auth/audit/export.csv` — mismos filtros, exporta CSV con las mismas columnas.

---

## 12. Página de prueba de referencia

[`external-api-test-page/index.html`](../../external-api-test-page/index.html) implementa en vivo:
login (contraseña/facial) con selector país→empresa, sección **Sesión/Multitenancy** (listar y
cambiar de tenant), y sección **Control de Accesos/Organización** (empresas, matriz de permisos,
acceso cruzado). Se sirve en un origen distinto al backend (mismo patrón que usaría un frontend
real) para validar CORS de forma realista — ver
[`EXTERNAL_API_TEST_PAGE.md`](EXTERNAL_API_TEST_PAGE.md) para cómo levantarla y exponerla en la LAN.

[`external-api-test-page/api-test-harness.html`](../../external-api-test-page/api-test-harness.html)
complementa con el flujo completo de **registro** (`POST /api/auth/register`) y captura biométrica
endpoint-por-endpoint (checklist ICAO en vivo) — usarla quien necesite implementar la pantalla de
autoregistro, no solo login.

---

## 13. Tabla resumen — todos los endpoints de este documento

| Método | Ruta | Auth | Permiso | Sección |
|---|---|---|---|---|
| GET | `/api/platform/countries` | — | — | §2 |
| GET | `/api/auth/companies` | — | — | §2 |
| GET/POST | `/api/auth/login/check-identity` | — | — | §3 |
| GET | `/api/auth/validate-company` | — | — | §3 |
| POST | `/api/auth/register` | — | — | §4 |
| POST | `/api/auth/login/password` | — | — | §5.1 |
| POST | `/api/auth/login/face` | — | — | §5.2 |
| POST | `/api/auth/refresh` | cookie+CSRF | — | §6 |
| POST | `/api/auth/logout` | sesión | — | §6 |
| GET | `/api/auth/tenants` | sesión | — | §7 |
| POST | `/api/auth/tenants/switch` | sesión | — | §7 |
| GET | `/api/auth/permissions` | sesión | — | §8 |
| GET | `/api/auth/permissions/matrix` | sesión | `permisos.manage` | §8 |
| POST | `/api/auth/permissions/matrix` | sesión | `permisos.manage` | §8 |
| POST | `/api/auth/users/create` | sesión | `usuarios.manage` | §9.1 |
| GET | `/api/auth/users` | sesión | — | §9.2 |
| POST | `/api/auth/users/maintenance` | sesión | — | §9.3 |
| GET | `/api/auth/users/{u}/tenants` | sesión | `usuarios.manage` | §9.4 |
| POST | `/api/auth/users/{u}/tenants` | sesión | `usuarios.manage` | §9.4 |
| POST | `/api/auth/users/{u}/tenants/remove` | sesión | `usuarios.manage` | §9.4 |
| GET | `/api/auth/companies/manage` | sesión | `empresas.view` | §10 |
| POST | `/api/auth/companies` | sesión | `empresas.manage` | §10 |
| PUT | `/api/auth/companies/{id}` | sesión | `empresas.manage` | §10 |
| DELETE | `/api/auth/companies/{id}` | sesión | `empresas.manage` | §10 |
| GET | `/api/auth/org-access/candidates` | sesión | `org.cross_tenant.manage` + tenant organización | §11 |
| POST | `/api/auth/org-access/grant` | sesión | `org.cross_tenant.manage` + tenant organización | §11 |
| POST | `/api/auth/org-access/revoke` | sesión | `org.cross_tenant.manage` + tenant organización | §11 |
| GET | `/api/auth/org-access/audit` | sesión | `org.cross_tenant.manage` + tenant organización | §11 |
| GET | `/api/auth/audit` | sesión | rol `admin` | §11.6 |
| GET | `/api/auth/audit/export.csv` | sesión | rol `admin` | §11.6 |

---

## 14. Códigos de error comunes (transversales)

| HTTP | `error` / `code` | Significado |
|---|---|---|
| 400 | `invalid_json` / `invalid_*_payload` | Body mal formado o campo faltante/inválido |
| 401 | `unauthorized` | Sesión ausente, expirada o inválida |
| 403 | `forbidden` (con `need: "<permiso>"`) | Falta el permiso indicado |
| 403 | `csrf_token_mismatch` | Falta o no coincide `X-CSRF-Token` en una petición por cookie |
| 403 | `no_pertenece_al_tenant` | El usuario no tiene membresía ni concesión para el tenant solicitado |
| 404 | `*_not_found` | El recurso referenciado no existe |
| 409 | `*_already_exists` | Conflicto de unicidad (dni/username/empresa/ruc) |
| 429 | `too_many_failed_attempts` / `rate_limited` | Límite de intentos superado |
| 500 | `db_unavailable` / `server_error` | Falla interna — reintentar más tarde, reportar si persiste |
