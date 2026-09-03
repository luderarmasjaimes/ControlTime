# ADR-130 — RBAC: empresa minera vs. empresa de organización + acceso cruzado

**Status**: implemented, verificado E2E en vivo (2026-09-02)
**Fecha**: 2026-08-23
**Autores**: EC
**Ámbito**: plataforma

> **Actualización 2026-09-02**: verificación E2E pendiente, cerrada. Contra
> `beemetry-api`/`beemetry-db` reales, con los dos tenants `organization`
> reales de `db_scripts/51` (Beemetry, TimeTelemetry) y un tenant
> `mining_client` real (`Telemetría Minera Plataforma`):
> 1. `POST /api/auth/org-access/grant` (admin de Beemetry → `demo_motored_admin`,
>    rol `supervisor`) → `200 ok`, entrada real en `GET
>    /api/auth/org-access/audit` (`action=org_access_grant`).
> 2. `GET /api/auth/tenants` como `demo_motored_admin` muestra el tenant
>    otorgado con `"via":"org_grant"` y `"role":"supervisor"` — el mecanismo
>    de doble fuente (`membership` vs `org_grant`) funciona con datos reales,
>    no solo por lectura de código.
> 3. **Guardia confirmado**: el mismo usuario (tenant `mining_client`, sin
>    `org.cross_tenant.manage`) intenta llamar `POST
>    /api/auth/org-access/grant` → `403 forbidden`, `need:
>    "org.cross_tenant.manage"` — un tenant minero no puede auto-otorgarse la
>    capacidad.
> 4. `POST /api/auth/tenants/switch` al tenant otorgado → JWT nuevo con
>    `role: "supervisor"`, `tenant_id` correcto.
> 5. `POST /api/auth/org-access/revoke` → `200`; `GET /api/auth/tenants`
>    inmediatamente después ya no incluye el tenant revocado.
>
> Sin cambios de código — el ADR ya estaba implementado correctamente, solo
> faltaba la verificación en vivo (el audit log ya mostraba un grant/revoke
> anterior del 2026-08-26, de una verificación previa que nunca actualizó
> este campo `Status`).

> Formaliza el caso de uso que ADR-029 anticipó y descartó explícitamente por
> falta de necesidad de negocio en su momento, y cierra la tensión documentada
> en ADR-086 sobre permisos de plataforma evaluados contra un tenant_id de
> tenant. Extiende ADR-036/063 (7 roles unificados) y ADR-085/086 (CRUD de
> empresas y RBAC granular).

## Contexto

La plataforma no distinguía entre "empresa minera" (cliente) y "empresa de la
organización" (Beemetry/TimeTelemetry) — ambas son tenants idénticos en el
esquema (`db_scripts/51_seed_companies_distribuidores_demo.sql` siembra
Beemetry y TimeTelemetry como tenants normales, sin ningún flag distintivo).
ADR-029 ya lo señaló explícitamente:

> "No se modela `distributor_id`/multi-nivel-de-tenant en esta revisión...
> Si el negocio de distribuidores de software revendiendo a mineras se
> formaliza, requiere un ADR propio (jerarquía distribuidor→tenant) antes de
> tocar las claims del JWT."

El pedido de negocio que motiva este ADR formaliza exactamente ese caso: el
personal de Beemetry/TimeTelemetry necesita un acceso elevado, cross-tenant,
auditado aparte del acceso normal, para dar soporte a varias mineras clientes
— sin que eso signifique que cualquier tenant minero pueda auto-otorgarse la
misma capacidad.

**Tensión que este ADR cierra** (ADR-086, líneas 68-77, documentada como
riesgo abierto): `hasPermission` evalúa el permiso contra `session->tenantId`
— el tenant del propio operador — pero un permiso de plataforma (como el que
se necesita para gestionar acceso cruzado) no debería depender solo de una
matriz `role_permissions` que cualquier tenant puede editar para sí mismo
(semántica de override completo por tenant, `db_scripts/42`).

## Decisión

### 1. `tenants.company_type` (fuente de verdad única)
`'mining_client'` (default) | `'organization'`. Vive en `tenants`, no en
`auth_companies` — evita un dual-write nuevo (lección de ADR-039): el
catálogo administrado (`CompanyManagementView.tsx`) lo lee/escribe vía una
subquery correlacionada en `kCompanySelectCols`
(`backend/src/auth/auth_storage_pg.cpp`), gateado por el mismo permiso
`empresas.manage` que ya protege el resto del CRUD de empresas (ADR-085/086).
Beemetry y TimeTelemetry se marcan `organization` en la propia migración.

### 2. Sin 8vo rol — tabla de concesión explícita
Se descartó deliberadamente crear un rol nuevo (`org_admin` o similar), que
habría exigido tocar los 3 puntos donde hoy viven los 7 roles
(`auth_routes.cpp::kValidPlatformRoles`, `notification_routes.cpp::kValidRoles`,
`roleConstants.ts`) — el mismo tipo de triplicación que ya causó un bug real
documentado en ADR-036. En su lugar, `org_tenant_access`
(`user_id, tenant_id, role, granted_by, revoked_at, active`) es una concesión
separada de `auth_user_tenant` (que sigue siendo "membresía real", sin
tocarse): un usuario de un tenant `organization` puede operar en un tenant
minero con uno de los 7 roles **ya existentes**.

`auth::effectiveRole` se extiende con un fallback quirúrgico: si no hay fila
en `auth_user_tenant`, consulta `org_tenant_access` antes de caer al rol
global. `handleListMyTenants`/`handleListUserTenants`/`handleSwitchTenant`
(auth_routes.cpp) se extienden para reconocer ambas fuentes, marcando cada
tenant con `via: "membership" | "org_grant"`.

### 3. El guardia doble que cierra la tensión de ADR-086
Todo endpoint de `/api/auth/org-access/*` (grant/revoke/candidates/audit,
`backend/src/auth/org_access_routes.cpp`) exige:

```
hasPermission(session, "org.cross_tenant.manage") AND isOrganizationTenant(session->tenantId)
```

`isOrganizationTenant` es la pieza nueva: aunque un tenant minero se
autoinserte `org.cross_tenant.manage` en su propia matriz (posible hoy por el
diseño de override completo, `db_scripts/42`), el chequeo de
`company_type='organization'` del tenant activo bloquea su uso igual. El
permiso por sí solo ya no es suficiente para esta capacidad — es la
separación real entre "permiso de tenant" y "permiso de plataforma" que
ADR-086 dejó pendiente, acotada a este caso concreto (no un rediseño general
de `role_permissions`).

### 4. Frontend
`CompanyManagementView.tsx` gana el campo/badge `company_type` (select
"Empresa minera (cliente)" / "Empresa de organización"). `UserManagementView.tsx`
gana un panel "Acceso a otras empresas mineras", visible solo si
`isOrganizationTenant && hasPermission('org.cross_tenant.manage')` — ambos
expuestos por `usePermissions()`/`GET /api/auth/permissions` (que ahora
también devuelve `is_organization_tenant`). Reutiliza el layout lista+detalle
y la paleta `access-*` ya existentes (naranja/ámbar) — se agregan dos badges
de clase explícita (`access-badge-sky`/`access-badge-neutral`) en vez de
depender de los selectores posicionales `td:nth-child(N)` que ya usa la tabla
de usuarios, para no acoplar el nuevo dato a la posición de columna de otra
vista.

**Nota de diseño explícita**: la paleta `access-*` (naranja) de este módulo y
la paleta `ra-*` (índigo) del módulo de informes técnicos ya eran
visualmente distintas antes de este ADR — no se unifican aquí (sería un ADR
de design system aparte); esta extensión usa consistentemente `access-*`, sin
introducir una tercera paleta.

### 5. Seguridad de red (VPS expuesto a estaciones mineras externas)
- Zona de rate limit dedicada `org_access` (10r/m, `frontend/nginx.conf`) para
  `/api/auth/org-access/*` — misma técnica que la zona `api_login` ya
  existente, más estricta que el límite general por ser la capacidad de mayor
  privilegio nueva.
- Allowlist de IP **opcional** (`BEEMETRY_ORG_ACCESS_IP_ALLOWLIST`), verificada
  en el propio handler contra `X-Real-IP`/`X-Forwarded-For` — deliberadamente
  acotada a `grant`/`revoke` de este módulo, no a toda la API pública (que debe
  seguir siendo alcanzable desde cualquier estación minera cliente).
- Auditoría dedicada (`GET /api/auth/org-access/audit`, tabla
  `auth_audit_logs`) — esta capacidad no comparte trazado con el log general.
- Plantilla de terminación TLS pública opcional
  (`frontend/nginx-tls-server.conf.example` + `include` con comodín al final
  de `nginx.conf`, seguro si no se activa) — cierra el hallazgo de que ningún
  compose que corre hoy sirve HTTPS público (solo el blueprint no desplegado
  `docker-compose.scale.yml` lo hace, vía Traefik).

## Consecuencias

### Positivas
- Beemetry/TimeTelemetry pueden operar como organización real (no como una
  minera más) sin reabrir el modelo de RBAC ni crear un rol nuevo.
- La tensión de ADR-086 queda cerrada para este caso concreto con un guardia
  de dos condiciones, auditado y documentado.
- `auth_user_tenant` (membresía real, anti-IDOR, ADR-038/039) no se toca —
  el mecanismo nuevo es aditivo y completamente separable (se puede revocar
  `org_tenant_access` en bloque sin afectar ninguna membresía real).

### Negativas / Trade-offs
- Cuarto punto en el backend con un `std::set` de los 7 roles hardcodeado
  (`org_access_routes.cpp::validRoles()`), sumado a los 3 que ya señalaba
  ADR-036 — se acepta el mismo trade-off documentado ahí (no ameritó una
  constante compartida para cuatro consumidores); revisitar si aparece un
  quinto punto de validación de rol.
- `frontend/nginx-tls-server.conf.example` es una plantilla, no un servidor
  HTTPS completo listo para producción — duplicar las locations del server
  puerto 80 queda como paso manual documentado, no automatizado.

### Neutras
- `region`/metadata multi-región (`tenants.region`, América Norte/Centro/Sur)
  se agrega como cimiento de datos en la misma migración, pero **no** implica
  infraestructura desplegada por región — ADR-035 sigue en fase F0 y una
  topología regional real requiere descubrimiento de requisitos legales/de
  hosting/presupuesto que está fuera de alcance de este ADR.

## Alternativas descartadas

### Rol nuevo `org_admin`/`distributor` en vez de tabla de concesión
Habría requerido tocar los 3 (ahora 4) puntos de validación de rol y el
esquema de `auth_user_tenant`/`role_permissions` — mayor superficie de riesgo
por un beneficio equivalente al de la tabla de concesión, que además preserva
la separación semántica entre "membresía real" y "concesión cruzada" que ya
existe en el diseño (ADR-038/039).

### Resucitar el esquema `sec_role`/`sec_permission`/`auth_user_role` (`db_scripts/16`)
Ese esquema paralelo, más "enterprise", nunca fue adoptado por ningún código
del backend (confirmado por grep — cero referencias). Construir sobre él
habría significado migrar todo el RBAC vigente (`role_permissions` +
`auth_user_tenant.role`) en el mismo cambio que esta extensión, sin necesidad
real: el mecanismo de concesión nuevo es perfectamente expresable sobre el
esquema de texto plano ya vigente.

### Implementar la infraestructura multi-región completa (ADR-035) en este mismo cambio
Descartado explícitamente: ADR-035 sigue en fase F0 (solo propuesta), sin
decisión de proveedor/nube por región ni marco legal de residencia de datos
por país — construirla junto con el RBAC habría sido irresponsable sin ese
descubrimiento previo. Este ADR solo entrega la metadata de región como
cimiento reutilizable.

## Referencias
- `db_scripts/72_org_tenant_type_cross_access.sql`
- `backend/src/auth/permissions.hpp` / `.cpp` (`isOrganizationTenant`, `effectiveRole` extendido con fallback a `org_tenant_access`)
- `backend/src/auth/org_access_routes.hpp` / `.cpp`
- `backend/src/auth/auth_routes.cpp` (`handleListMyTenants`, `handleListUserTenants`, `handleSwitchTenant`, endpoints de empresas)
- `backend/src/auth/auth_storage_pg.hpp` / `.cpp` (`AuthCompanyRecord::companyType`, `kCompanySelectCols`)
- `frontend/src/components/ReportStudioV2/components/views/{CompanyManagementView,UserManagementView}.tsx`
- `frontend/src/auth/{authApi.ts,usePermissions.ts}`
- `frontend/nginx.conf`, `frontend/nginx-tls-server.conf.example`
- `docs/integration/ACCESS_CONTROL_API_GUIDE.md`
- ADR-029 (RBAC multitenant + JWT, anticipa y descarta este caso), ADR-035 (multi-región, F0), ADR-036 (7 roles unificados), ADR-038/039 (anti-IDOR de tenant), ADR-085/086 (CRUD de empresas y RBAC granular)
