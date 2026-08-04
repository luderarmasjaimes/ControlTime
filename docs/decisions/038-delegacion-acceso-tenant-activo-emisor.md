# ADR-038 — Delegación de acceso multitenant escopeada siempre al tenant activo del emisor

**Status**: accepted (implementado y verificado end-to-end 2026-07-13)
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: plataforma

> Refina el modelo de sesión con `tenant_id` de ADR-029 y el RBAC por tenant de ADR-035.

## Contexto

Con RBAC multitenant, un administrador necesita poder **otorgar o revocar** el acceso
de otro usuario a una unidad minera (p.ej. un supervisor que pasa a apoyar
temporalmente otra faena). El riesgo de diseño es directo: si el endpoint acepta un
`tenant_id` arbitrario en el cuerpo de la request, un admin de la unidad **A**
comprometido (credenciales robadas, insider malicioso) podría otorgarse a sí mismo — o
a un cómplice — acceso a la unidad **B** sin pertenecer nunca a B. Esto es
exactamente la clase de escalación de privilegios entre tenants que el resto de la
plataforma ya previene explícitamente (ver el mismo principio aplicado a búsqueda de
informes en ADR-039).

## Decisión

Los endpoints de gestión de acceso multitenant — **otorgar** (`POST
/api/auth/users/{username}/tenants`) y **revocar** (`POST
/api/auth/users/{username}/tenants/remove`) — escopean **siempre** la operación al
`tenant_id` de la **sesión activa del emisor** (`session->tenantId`), nunca a un valor
del cuerpo de la request. Un admin solo puede conceder o quitar acceso a **su propia
unidad activa en ese momento**; para dar acceso a otra unidad, el admin debe primero
cambiar su propio tenant activo a esa unidad (`TenantSwitcher`, ya existente) — es
decir, debe demostrar pertenencia real antes de poder delegar.

### Comportamiento
- **Otorgar**: `INSERT ... ON CONFLICT (user_id, tenant_id) DO UPDATE SET
  role=EXCLUDED.role` sobre `auth_user_tenant`, con `tenant_id` fijo al de la sesión.
  Genera entrada de auditoría `tenant_access_granted` (`fn_platform_audit_insert`,
  hash-encadenado, ADR-030).
- **Revocar**: `DELETE` sobre la misma tabla, mismo scoping. Bloquea explícitamente
  la **auto-revocación** (`if targetUsername == session->username → 400
  no_puede_autorevocarse`) — un admin no puede quitarse su propio acceso a través de
  este endpoint (evita bloqueos accidentales sin vía de recuperación inmediata).
- **Consulta**: `GET /api/auth/users/{username}/tenants` (requiere `usuarios.manage`)
  lista las membresías reales del usuario objetivo — usada por la UI para mostrar
  "Unidades Mineras Asignadas" en `UserManagementView`.

### Limitación de enrutamiento documentada
El router C++ del proyecto (`router.hpp`/`router.cpp`) solo soporta coincidencia
exacta o por prefijo, sin wildcards con nombre en medio de una ruta. Registrar
`otorgar` y `revocar` como dos rutas separadas con el mismo prefijo
(`/api/auth/users/{username}/tenants` y `.../tenants/remove`) no es posible
directamente con un único prefijo POST — se resolvió registrando **un solo** prefijo
(`/api/auth/users/`) y despachando en código de aplicación (`handleUserTenantPost`)
según si el `target` termina en `/remove`. Es una limitación del router, no de este
endpoint en particular; si el router gana soporte de parámetros con nombre en rutas,
este despacho manual puede eliminarse sin cambiar el contrato HTTP externo.

### Reglas duras
- Ningún endpoint de gestión de acceso multitenant confía en un `tenant_id` provisto
  por el cliente para decidir **a qué unidad se concede o quita acceso** — siempre se
  deriva de la sesión del emisor.
- Toda concesión/revocación de acceso genera una entrada de auditoría real, nunca
  silenciosa.
- Un admin no puede auto-revocarse a través de este endpoint.

## Consecuencias

### Positivas
- Cierra una vía de escalación de privilegios entre tenants que habría sido trivial de
  explotar con un diseño ingenuo (`tenant_id` del body sin verificar).
- Coherente con el patrón ya usado por `handleSwitchTenant` (cambio de tenant activo) y
  por la búsqueda multitenant de informes (ADR-039): "nunca confiar en un tenant_id
  arbitrario del cliente, siempre derivar del contexto de sesión verificado".
- Auditoría real de cada cambio de acceso, consistente con ADR-030.

### Negativas / Trade-offs
- Un admin que necesita delegar acceso a varias unidades debe cambiar su tenant activo
  repetidamente (un ciclo de switch + grant por unidad) — más fricción de UX que un
  hipotético "otorgar a cualquier unidad de una lista", pero es el costo directo de no
  confiar en el `tenant_id` del cliente.
- El despacho manual grant/revoke por sufijo de URL (en vez de dos rutas registradas
  limpiamente) es una solución pragmática a una limitación del router, no la más
  elegante — documentado explícitamente para que no se lea como descuido si se audita
  el código más adelante.

### Neutras
- No cambia el esquema de `auth_user_tenant` — reutiliza la tabla y el índice único
  `(user_id, tenant_id)` ya existentes de `db_scripts/42`.

## Alternativas descartadas

### Permitir un `tenant_id` explícito en el body, validado contra una lista de "unidades administrables por este admin"
Habría requerido modelar una relación adicional ("qué unidades puede administrar cada
admin", distinta de "a qué unidades pertenece"), un concepto que el negocio no ha
pedido todavía. Descartado por sobre-ingeniería: la regla simple "solo tu tenant
activo" ya resuelve el caso de uso real sin introducir un modelo de permisos nuevo.

### Requerir aprobación de un segundo admin (four-eyes) para cambios de acceso entre tenants
Añadiría un flujo de aprobación asíncrona no solicitado por el negocio hoy; queda como
mejora futura si el volumen de operaciones multi-unidad lo justifica.

## Referencias
- `backend/src/auth/auth_routes.cpp` (`handleGrantUserTenant`, `handleRevokeUserTenant`,
  `handleUserTenantPost`, `handleListUserTenants`)
- `backend/src/http/router.hpp` (limitación de wildcards documentada arriba)
- `frontend/src/components/ReportStudioV2/components/views/UserManagementView.tsx`
  (sección "Unidades Mineras Asignadas")
- ADR-029 (identidad/sesión con tenant_id), ADR-030 (auditoría), ADR-035 (RBAC por
  tenant), ADR-036 (7 roles), ADR-039 (mismo principio aplicado a búsqueda de informes)
