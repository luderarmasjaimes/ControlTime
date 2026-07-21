# ADR-063 — Corrección: los 7 roles RBAC asignables en todos los módulos de administración

**Status**: implemented, verificado (2026-07-21). Backend recompilado y `ctest` corrido dos veces contra Docker real tras el cambio — sin errores.
**Fecha**: 2026-07-21
**Autores**: EC
**Ámbito**: plataforma

## Contexto

El catálogo de casos de prueba QA (ADR-061, caso TC-RBAC-05) había marcado como defecto a confirmar: `frontend/src/auth/roleConstants.ts` define solo **6** roles en `USER_ROLES`, mientras que el backend valida **7** (`kValidPlatformRoles`, `auth_routes.cpp`, incluye `viewer`). Gerencia pidió corregir esto a los 7 roles en **todos** los módulos y componentes.

Al auditar cada punto de uso se encontró que el diseño original de `USER_ROLES` **era intencional para el autoregistro** (el propio código ya documentaba: "`viewer` queda fuera... nadie se autoasigna ese rol") — no era un olvido total, sino un olvido parcial: la exclusión de `viewer` del selector de **autoregistro** tiene sentido (es un rol de solo lectura para auditores externos, no algo que un usuario operativo se autoasigne), pero esa misma lista de 6 roles se reutilizaba **también** en pantallas donde un **administrador** asigna el rol de **otro** usuario — ahí sí faltaba `viewer`, sin ninguna razón de diseño que lo justifique:

- `UserManagementView.tsx` (gestión de usuarios) — selector "Cambio de perfil" solo ofrecía 6 roles.
- `UserMaintenanceModal.tsx` (mantenimiento de usuario) — mismo selector, mismo problema.
- `getRoleLabel`/`getRoleColor` — un usuario con rol `viewer` ya asignado (por API directa, no por UI) se mostraba con el string crudo `"viewer"` en vez de una etiqueta legible, porque ambas funciones solo buscaban en la lista de 6.

Además, se encontró un **bug real independiente** en el backend: `notification_routes.cpp` (`handlePermissionMatrix`, endpoint `GET /api/auth/permissions/matrix`) construía la matriz de permisos iterando solo `{"admin", "manager", "operator", "viewer"}` — **4 roles**, dejando `supervisor`, `geologist` y `safety` completamente ausentes de la matriz que ve `PermissionsManagementView.tsx`, pese a que esa pantalla frontend ya esperaba y sabía mostrar los 7 (tenía su propio parche local agregando `viewer` a mano). El comentario del código en `handleUpdateMatrix` (mismo archivo) decía además "Los 6 roles reales" mientras el arreglo debajo ya tenía 7 — comentario desactualizado, también corregido.

## Decisión

**Nueva constante `ADMIN_ASSIGNABLE_ROLES`** en `roleConstants.ts` (los 7 roles reales, `USER_ROLES` + `viewer`) — fuente de verdad única para **cualquier pantalla donde un administrador asigna o cambia el rol de otro usuario**. `USER_ROLES` (6) se mantiene sin cambios, documentado explícitamente como "solo para el selector de autoregistro".

Reemplazos:
- `PermissionsManagementView.tsx`: su parche local (`[...USER_ROLES, {value:'viewer',...}]` duplicado inline) se reemplaza por `ADMIN_ASSIGNABLE_ROLES` — mismo resultado, sin duplicación.
- `UserManagementView.tsx` y `UserMaintenanceModal.tsx`: `ROLE_OPTIONS` pasa de `USER_ROLES` a `ADMIN_ASSIGNABLE_ROLES` — ahora un admin sí puede asignar `viewer`.
- `getRoleLabel`/`getRoleColor`: buscan en `ADMIN_ASSIGNABLE_ROLES` en vez de `USER_ROLES` — un usuario con rol `viewer` ya no muestra el string crudo.
- `notification_routes.cpp` (`handlePermissionMatrix`): el arreglo de 4 roles se corrige a los 7 reales — la matriz de permisos ahora incluye `supervisor`/`geologist`/`safety`. Comentario desactualizado corregido de "6" a "7" roles.

Se verificó además que el esquema de base de datos ya tenía todo lo necesario para esto (nada de la corrección requirió migración nueva): `db_scripts/43_rbac_six_roles_reconcile.sql` ya seedea permisos por defecto para `supervisor`/`geologist`/`safety`, y `db_scripts/42_notifications_rbac_multitenant.sql` ya seedea permisos para `viewer` — la brecha era exclusivamente de capa de aplicación (frontend + un endpoint backend), no de datos.

## Consecuencias

### Positivas
- Un administrador ahora puede asignar el rol `viewer` (auditor externo, solo lectura) a un usuario desde la UI — antes solo era posible vía API directa, sin ninguna pantalla que lo soportara.
- La matriz de permisos (`PermissionsManagementView.tsx`) ahora muestra y permite editar los permisos reales de `supervisor`/`geologist`/`safety` — antes esas filas llegaban vacías del backend pese a que la UI ya las esperaba.
- Una sola fuente de verdad (`ADMIN_ASSIGNABLE_ROLES`) para las 3 pantallas de administración, en vez de un parche duplicado en una de ellas.

### Negativas / Trade-offs
- Ninguna identificada — es una corrección de un defecto real sin alcance nuevo ni cambio de comportamiento para los 6 roles ya soportados.

### Neutras
- `USER_ROLES` (autoregistro) se mantiene deliberadamente en 6 — no se agregó `viewer` ahí, porque sigue sin tener sentido que un usuario se autoasigne un rol de auditor externo. Si esa decisión cambia a futuro, es un ADR aparte.

## Alternativas descartadas

### Agregar 'viewer' directamente a USER_ROLES (una sola lista de 7 para todo)
Se descarta: habría expuesto `viewer` también en el selector de autoregistro, contradiciendo la razón de diseño ya documentada en el código ("nadie se autoasigna ese rol"). Mantener dos constantes explícitas (`USER_ROLES` vs `ADMIN_ASSIGNABLE_ROLES`) deja la intención clara en el tipo, no solo en un comentario.

## Referencias
- `frontend/src/auth/roleConstants.ts` (`ADMIN_ASSIGNABLE_ROLES`, nueva)
- `frontend/src/components/ReportStudioV2/components/views/{UserManagementView,PermissionsManagementView}.tsx`
- `frontend/src/components/ReportStudioV2/components/modals/UserMaintenanceModal.tsx`
- `backend/src/mining/notification_routes.cpp` (`handlePermissionMatrix`, `handleUpdateMatrix`)
- `backend/src/auth/auth_routes.cpp` (`kValidPlatformRoles`, fuente de verdad backend)
- `db_scripts/42_notifications_rbac_multitenant.sql`, `db_scripts/43_rbac_six_roles_reconcile.sql`
- ADR-036 (RBAC de 7 roles unificados — este ADR cierra la brecha de aplicación que quedaba abierta tras esa decisión)
- ADR-061 (catálogo de casos QA, caso TC-RBAC-05 que originó esta corrección)
