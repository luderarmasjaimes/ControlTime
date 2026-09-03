# Guía de integración — API de control de accesos (usuarios, permisos, empresas, acceso cruzado)

> **Audiencia**: equipo de integración de un sistema externo, o un desarrollador de este mismo
> equipo que necesita administrar programáticamente usuarios, roles, permisos, el catálogo de
> empresas (mineras clientes y de organización) y el acceso cruzado de personal de organización
> (Beemetry/TimeTelemetry) a empresas mineras — ver ADR-130.
>
> Este documento es autocontenido: no asume acceso al código fuente. Complementa
> [`BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md`](BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md) (login/sesión,
> léalo primero si aún no tiene una sesión autenticada) — todo lo de acá exige sesión válida.
>
> Página de prueba funcional: [`external-api-test-page/index.html`](../../external-api-test-page/index.html)
> — sección "Control de Accesos / Organización" (ver §7).

---

## 0. Convenciones comunes

- **Preferido**: header `Authorization: Bearer <access_token>` guardado en memoria de JS (nunca
  `localStorage`) — ver [`LOGIN_API_COMPLETE_GUIDE.md`](LOGIN_API_COMPLETE_GUIDE.md) §1.2 para el
  motivo (evita colisión de cookies con otro frontend en el mismo host). La cookie HttpOnly
  `beemetry_access_token` (`credentials: 'include'`, ADR-082) sigue funcionando como respaldo.
  Para verbos que mutan estado enviados por **cookie** (POST/PUT/DELETE), agregar el header
  `X-CSRF-Token` con el valor de la cookie legible `beemetry_csrf_token` (double-submit CSRF) —
  las peticiones autenticadas por Bearer están exentas de CSRF.
- Todo permiso se evalúa contra el **tenant activo de la sesión**, nunca contra uno que el cliente
  pase por body/query — el backend siempre deriva el tenant del token verificado.
- Rate limiting de red: zona general `20r/s` (`/api/`), zona de login `15r/m`
  (`/api/auth/login/`), zona dedicada `10r/m` para `/api/auth/org-access/*` (la capacidad de mayor
  privilegio de este documento — ver §6).
- Los 7 roles reales de la plataforma: `admin, manager, supervisor, geologist, safety, operator,
  viewer` (ADR-036). No hay jerarquía entre ellos — cada uno tiene su propio set de permisos.

---

## 1. Empresas (`/api/auth/companies*`)

### 1.1 `GET /api/auth/companies[?country=XX]`
Público (sin sesión). Catálogo de nombres de empresas activas — alimenta el `<select>` de
login/registro. Sin filtro devuelve todas; `country` (ISO2) filtra por país.

```jsonc
{ "companies": ["Minera Raura", "Ferreyros S.A.A.", "..."] }
```

### 1.2 `GET /api/auth/companies/manage[?include_inactive=true]`
Requiere permiso `empresas.view`. Catálogo administrativo completo (incluye inactivas si se pide).
El RUC viene enmascarado (`""`) si el solicitante no tiene además `empresas.manage`.

```jsonc
{
  "companies": [{
    "company_id": "uuid", "name": "Minera Raura", "ruc": "20500000016",
    "country_code": "PE", "domicilio_fiscal": "...", "tenant_id": "uuid",
    "active": true, "demo_data": false, "created_at": "...", "updated_at": "...",
    "updated_by": "admin", "latitude": -10.5, "longitude": -76.3, "location_zoom": 12,
    "company_type": "mining_client"
  }],
  "can_manage": true
}
```

`company_type` (ADR-130, `db_scripts/72`): `"mining_client"` (default, empresa minera cliente) |
`"organization"` (Beemetry/TimeTelemetry — habilita el mecanismo de acceso cruzado de §6).

### 1.3 `POST /api/auth/companies`
Requiere `empresas.manage`. Da de alta una empresa y provisiona su tenant real.

```jsonc
// Request
{
  "name": "Minera Ejemplo S.A.",
  "ruc": "20123456789",           // opcional, valida checksum por país
  "country": "PE",                // default "PE"
  "domicilio_fiscal": "...",       // opcional
  "company_type": "mining_client", // opcional, default "mining_client"
  "latitude": -10.5, "longitude": -76.3, "location_zoom": 12  // opcionales, viajan juntas o ninguna
}
```
`201 Created` → `{ "company": "...", "tenant_id": "uuid", "active": true, "company_type": "mining_client" }`.
Errores: `409 company_already_exists` / `409 ruc_already_exists` (dedup case-insensitive).

### 1.4 `PUT /api/auth/companies/{company_id}`
Requiere `empresas.manage`. Edita RUC/país/domicilio/coordenadas/`company_type`. **Nunca** edita
`name` (ADR-085). Cualquier campo omitido preserva su valor actual — `company_type` vacío/omitido
significa "no cambiar" (no hay que reenviar el actual si no se quiere tocar).

### 1.5 `DELETE /api/auth/companies/{company_id}[?reactivate=true]`
Requiere `empresas.manage`. Soft delete (`active=false`) o reactivación con `?reactivate=true`.
Devuelve `active_users_affected` (cuántos usuarios activos de esa empresa quedan sin acceso).

---

## 2. Usuarios (`/api/auth/users*`)

### 2.1 `POST /api/auth/users/create`
Requiere `usuarios.manage`. Alta de usuario sin biometría (se enrola en su primer login).

```jsonc
// Request
{ "username": "jsmith", "password": "mínimo 8 caracteres", "first_name": "John",
  "last_name": "Smith", "dni": "12345678", "role": "operator", "email": "..." }
```

### 2.2 `GET /api/auth/users/{username}/tenants`
Requiere `usuarios.manage`. Lista las unidades/tenants a las que el usuario objetivo tiene acceso
— tanto membresía real (`auth_user_tenant`) como concesiones de acceso cruzado (§6), distinguidas
por el campo `via`:

```jsonc
{ "tenants": [
  { "tenant_id": "uuid", "tenant_name": "Minera Raura", "role": "operator", "is_default": true, "via": "membership" },
  { "tenant_id": "uuid", "tenant_name": "Minera Yanacocha", "role": "supervisor", "is_default": false, "via": "org_grant" }
]}
```

### 2.3 `POST /api/auth/users/{username}/tenants` — otorgar acceso (membresía)
Requiere `usuarios.manage`. Body `{ "role": "operator" }`. Otorga acceso **al tenant activo de la
sesión del que llama** (nunca uno arbitrario — anti-IDOR, ADR-038). Para acceso a OTRA empresa
minera desde una cuenta de organización, ver §6.

### 2.4 `POST /api/auth/users/{username}/tenants/remove`
Requiere `usuarios.manage`. Revoca la membresía del usuario en el tenant activo del que llama.

---

## 3. Permisos (`/api/auth/permissions*`)

### 3.1 `GET /api/auth/permissions`
Cualquier sesión válida. Introspección del propio usuario:

```jsonc
{
  "role": "admin", "tenant_id": "uuid", "is_admin": true,
  "is_organization_tenant": false,
  "permissions": ["mapas.view", "informes.edit", "usuarios.manage", "..."]
}
```

`is_organization_tenant` (ADR-130): true si el tenant activo es `company_type='organization'` —
úsese para decidir si mostrar el panel de acceso cruzado (§6) en una UI propia.

### 3.2 `GET /api/auth/permissions/matrix`
Requiere `permisos.manage`. Catálogo completo de `platform_permissions` + la matriz rol→permiso
del tenant activo (con override, ver §3.4).

### 3.3 `POST /api/auth/permissions/matrix`
Requiere `permisos.manage`. Body `{ "role": "supervisor", "permissions": ["mapas.view", "..."] }`
— **reemplaza por completo** los permisos de ese rol para el tenant activo.

### 3.4 Semántica de override por tenant
`role_permissions` tiene override COMPLETO por tenant: si el tenant activo tiene al menos una fila
propia para un rol, esas filas reemplazan el default global entero para ese rol (no se mezclan).
Un tenant que edita por primera vez la matriz de un rol debe reenviar el set completo deseado, no
solo el permiso que quiere agregar/quitar.

---

## 4. Modelo de roles y empresas (contexto para diseñar integraciones)

| Concepto | Tabla | Notas |
|---|---|---|
| Tenant / unidad | `tenants` | `company_type`: `mining_client` \| `organization` (ADR-130); `region`: metadata `north_america`\|`central_america`\|`south_america`, sin implicar infraestructura desplegada por región (ADR-035 sigue en F0) |
| Usuario global | `auth_users` | `role` es el fallback global si no hay override por tenant |
| Membresía real | `auth_user_tenant` | usuario↔tenant con rol propio; base de todo chequeo anti-IDOR |
| Concesión cruzada | `org_tenant_access` | solo relevante si el usuario pertenece a un tenant `organization` — ver §6 |
| Catálogo de empresas | `auth_companies` | 1:1 con `tenants` vía `tenant_id`; `company_type` se lee/escribe ahí pero vive físicamente en `tenants` |

---

## 5. Autorización efectiva (para entender los códigos 403)

```
effectiveRole(user, tenant) = auth_user_tenant.role
                            → si no hay fila: org_tenant_access.role (activa, no revocada)
                            → si tampoco: auth_users.role (global)

hasPermission(user, tenant, code) = (effectiveRole == "admin") OR (code ∈ permissionsForRole(tenant, effectiveRole))
```

`admin` siempre tiene todos los permisos (cinturón de seguridad contra una matriz mal configurada
que deje un tenant sin ningún administrador efectivo) — **excepto** para el guardia adicional de
§6.2, que exige además que el tenant activo sea `organization`.

---

## 6. Acceso cruzado de personal de organización (`/api/auth/org-access/*`) — ADR-130

Mecanismo para que personal de Beemetry/TimeTelemetry (tenant `company_type='organization'`) opere
en tenants mineros clientes con uno de los 7 roles existentes, sin ser membresía real y con
auditoría propia. **No crea un 8vo rol.**

### 6.1 Requisito para TODOS los endpoints de esta sección
El actor debe, simultáneamente:
1. Tener el permiso de plataforma `org.cross_tenant.manage` (`hasPermission`), **y**
2. Operar desde un tenant activo `company_type='organization'`.

Si falta cualquiera de las dos condiciones: `403 forbidden` con `"need": "org.cross_tenant.manage"`.
La condición 2 no se puede eludir aunque el permission_code aparezca en la matriz de un tenant
minero — es el guardia que cierra la tensión de ADR-086.

### 6.2 `GET /api/auth/org-access/candidates`
Lista los tenants `company_type='mining_client'` activos, para el selector de la UI:

```jsonc
{ "tenants": [{ "tenant_id": "uuid", "tenant_name": "Minera Raura", "country_code": "PE", "region": "south_america" }] }
```

### 6.3 `POST /api/auth/org-access/grant`
```jsonc
// Request
{ "username": "jsmith", "tenant_id": "uuid-de-minera-cliente", "role": "supervisor" }
```
`role` debe ser uno de los 7 válidos (default `viewer` si se omite). El `tenant_id` destino debe
ser `company_type='mining_client'` (`400 tenant_destino_no_es_minera_cliente` en otro caso) — este
mecanismo es exclusivamente organización→minera, nunca organización→organización.
`200 OK` → `{ "ok": true, "username": "...", "tenant_id": "...", "role": "supervisor" }`.
Re-otorgar a la misma pareja (usuario, tenant) actualiza el rol (no crea una fila duplicada).

### 6.4 `POST /api/auth/org-access/revoke`
```jsonc
{ "username": "jsmith", "tenant_id": "uuid-de-minera-cliente" }
```
`200 { "status": "revoked" }` o `404 { "status": "not_found" }`.

### 6.5 `GET /api/auth/org-access/audit[?limit=50&offset=0]`
Historial dedicado (no mezclado con el log general de auditoría):
```jsonc
{ "items": [{ "event_time": "...", "action": "org_access_grant", "actor_username": "admin",
              "success": true, "detail": "target=jsmith tenant_id=... role=supervisor" }] }
```

### 6.6 Hardening de red específico de esta sección
- Rate limit dedicado: zona `org_access`, `10r/m` (`frontend/nginx.conf`).
- Allowlist de IP opcional: variable `BEEMETRY_ORG_ACCESS_IP_ALLOWLIST` (CSV de IPs), vacía por
  defecto (sin restricción). Si se define y la IP de origen no está en la lista: `403 ip_no_autorizada`.

---

## 7. Página de prueba

[`external-api-test-page/index.html`](../../external-api-test-page/index.html) — sección "Control
de Accesos / Organización" cubre empresas (alta/edición con `company_type`), matriz de permisos y
los tres endpoints de `org-access`. Se sirve en un origen distinto al backend (mismo patrón que el
resto de la página) para validar CORS real; ver `serve_http.py`/`serve_https.py` y
`actualizar-red-lan.ps1` en esa misma carpeta para exponerla a otras PCs de la LAN.
