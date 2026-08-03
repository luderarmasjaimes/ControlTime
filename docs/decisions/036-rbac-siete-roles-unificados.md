# ADR-036 — Reconciliación RBAC: 7 roles unificados en una única fuente de verdad

**Status**: accepted (implementado y verificado end-to-end 2026-07-13)
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: plataforma

> Refina ADR-029 (identidad de plataforma, RBAC multitenant + JWT) y se apoya en el RBAC
> por tenant ya soportado por `db_scripts/42` (citado en ADR-035).

## Contexto

La plataforma llegó a tener **dos taxonomías de roles divergentes** creadas en momentos distintos del proyecto:

1. Un RBAC genérico de **4 roles** (`admin`, `manager`, `operator`, `viewer`) sembrado por `db_scripts/42_notifications_rbac_multitenant.sql`, usado como `CHECK` constraint de `auth_user_tenant.role`/`role_permissions.role` y como allowlist hardcodeada en al menos un endpoint (`notification_routes.cpp::handleUpdateMatrix`).
2. Una taxonomía real de **6 roles** (`admin`, `manager`, `supervisor`, `geologist`, `safety`, `operator`) definida en `frontend/src/auth/roleConstants.ts`, que el propio archivo declara en su comentario de cabecera como **"fuente de verdad única para AuthGateway, UserManagement y Permissions"** — es decir, la UI ya ofrecía roles que el backend no reconocía.

La divergencia no era teórica: un intento de asignar el rol `supervisor` (u otro de los 3 roles ausentes del set de 4) a través de `PermissionsManagementView` fallaba en el backend con `400 invalid_role`, porque `notification_routes.cpp` validaba contra un `if` con 4 comparaciones de string hardcodeadas, no contra la lista real de roles que la UI ya mostraba desde `roleConstants.ts`.

Además, ninguno de los dos sets modelaba un rol de **solo lectura para permisos de consulta backend** (distinto de `operator`, que sí puede operar equipos/formularios) — necesario para integraciones o auditores externos sin capacidad de creación de usuarios.

## Decisión

Se reconcilian ambas taxonomías a **7 roles**, tomando los 6 de `roleConstants.ts` (la fuente de verdad ya declarada) y sumando `viewer` como séptimo rol backend-only de solo lectura:

`admin`, `manager`, `supervisor`, `geologist`, `safety`, `operator`, `viewer`

### Cambios aplicados
- **`db_scripts/43_rbac_six_roles_reconcile.sql`**: amplía los `CHECK` de `auth_user_tenant.role` y `role_permissions.role` de 4 a 7 valores. Siembra permisos por defecto para los 3 roles nuevos:
  - `supervisor` (9 permisos — equivalente a `manager` menos gestión de canales de notificación).
  - `geologist` (7 permisos — mapas/informes/telemetría/fórmula; sin gestión de dispositivos/alarmas).
  - `safety` (7 permisos — foco pesado en alarmas: `alarmas.view`, `alarmas.manage`, más vistas de informes/mapas/telemetría/dispositivos).
  - Verificado en vivo: `SELECT role, count(*) FROM role_permissions WHERE tenant_id IS NULL GROUP BY role` — admin=13, manager=11, supervisor=9, operator=7, geologist=7, safety=7, viewer=6.
- **`backend/src/mining/notification_routes.cpp`**: el `if` de 4 comparaciones se reemplaza por un `std::set<std::string>` de 7 roles, único punto de verdad de validación en este archivo.
- **`frontend/src/components/ReportStudioV2/components/views/PermissionsManagementView.tsx`**: el array `ROLES` local (que duplicaba/desalineaba la lista) se reemplaza por un `import` directo de `USER_ROLES` desde `roleConstants.ts`, añadiendo `viewer` como entrada backend-only sin formulario de alta propio.

### Reglas duras
- `frontend/src/auth/roleConstants.ts` sigue siendo la **única fuente de verdad** de nombres/labels/colores de rol para toda la UI — ningún componente nuevo define su propio array de roles.
- Cualquier validación backend de rol debe usar la lista completa de 7 roles (idealmente importada de una única constante C++, ver "Alternativas descartadas"), nunca un subconjunto hardcodeado local por endpoint.
- `viewer` no tiene formulario de alta de usuario en la UI de administración (no es un rol que un admin asigne activamente hoy) pero es un valor válido a nivel de esquema/backend para integraciones futuras.

## Consecuencias

### Positivas
- Elimina una clase entera de bug (`400 invalid_role` en producción) para 3 de los 7 roles que la propia UI ya ofrecía.
- Un solo lugar (`roleConstants.ts`) define qué roles existen; el backend converge a esa misma lista.
- Los permisos por defecto de los 3 roles nuevos siguen el mismo patrón de "override por tenant" que ya soporta `role_permissions` (ADR-035), sin cambios de esquema adicionales.

### Negativas / Trade-offs
- El backend C++ sigue sin tener una única constante compartida de 7 roles (`kValidPlatformRoles` se declaró de forma local en `auth_routes.cpp` y `notification_routes.cpp` por separado, cada uno con su propio `std::set` idéntico) — riesgo de que un tercer endpoint futuro repita el mismo bug de esta ADR si define su propio subconjunto. Ver "Alternativas descartadas".
- `viewer` no tiene aún ningún flujo de UI que lo asigne activamente; existe solo a nivel de esquema/backend hasta que haya un caso de uso concreto (auditor externo, integración read-only).

### Neutras
- No se modela jerarquía entre roles (p.ej. `admin` no "incluye" automáticamente los permisos de `manager`) — cada rol tiene su propia fila explícita en `role_permissions`, consistente con el diseño ya existente antes de este ADR.

## Alternativas descartadas

### Reducir a los 4 roles originales (eliminar supervisor/geologist/safety de la UI)
Habría sido el cambio de menor esfuerzo, pero la UI ya estaba construida y en uso alrededor de los 6 roles de `roleConstants.ts` — retirarlos habría sido una regresión de producto, no una corrección técnica.

### Definir una constante C++ compartida (`backend/src/auth/roles.hpp`) en vez de `std::set` locales duplicados
Es la solución correcta a mediano plazo (elimina el riesgo residual señalado en "Negativas"), pero se difiere deliberadamente: solo dos archivos tenían el allowlist hardcodeado hoy, y crear un header compartido para dos consumidores es una abstracción prematura frente al beneficio inmediato de desbloquear los 3 roles faltantes. Se revisita si aparece un tercer punto de validación de rol en el backend.

## Referencias
- `frontend/src/auth/roleConstants.ts` (fuente de verdad de roles de UI)
- `db_scripts/42_notifications_rbac_multitenant.sql` (RBAC original de 4 roles), `db_scripts/43_rbac_six_roles_reconcile.sql` (esta reconciliación)
- `backend/src/mining/notification_routes.cpp::handleUpdateMatrix`
- `frontend/src/components/ReportStudioV2/components/views/PermissionsManagementView.tsx`
- ADR-029 (identidad/RBAC), ADR-035 (RBAC por tenant multi-unidad)
