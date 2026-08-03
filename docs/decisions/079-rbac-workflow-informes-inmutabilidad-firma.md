# ADR-079 — RBAC real en el módulo de informes: permisos por transición de workflow + inmutabilidad documental post-firma

**Status**: implemented (backend), 2026-08-02
**Fecha**: 2026-08-02
**Autores**: EC
**Ámbito**: plataforma (reportabilidad — Informe Técnico Minero)
**Relación**: cierra una brecha de autorización dejada abierta por ADR-029/036/063 (definición y asignación de los 7 roles) y ADR-017/018 (workflow y firma documental); reutiliza `auth::hasPermission` (ya usado en `auth_routes.cpp`, `device_alarm_routes.cpp`, `notification_routes.cpp`) y el endpoint `GET /api/auth/permissions` (ya existente en `notification_routes.cpp::handleMyPermissions`, sin consumir hasta hoy).

## Contexto

Auditoría de código (2026-08-02, ver memoria de proyecto
`project_rbac_gap_reportabilidad_2026-08-02`) encontró que `backend/src/reports/report_routes.cpp` y `report_service.cpp` **nunca llamaban `auth::hasPermission`**, pese a incluir su header. Todos los endpoints de `/api/reports/*` — crear, actualizar (incluidas TODAS las transiciones de workflow: `draft→in_review→approved→signed→archived` y `rechazado`), eliminar, exportar — solo verificaban **pertenencia al tenant** (`userHasRealTenantMembership`, `resolveAllowedReportTenant`), nunca rol ni permiso. `session->role` se pasaba a `updateReportPg` únicamente para **registrar** quién firmó (`signed_by_role`), no para **autorizar** la firma.

Consecuencia concreta: cualquier usuario autenticado del tenant — `operator`, `geologist`, `safety`, incluso `viewer` — podía aprobar y firmar cualquier informe técnico minero, o eliminarlo.

Las claves de permiso granulares ya existían, seedeadas por rol desde `db_scripts/42` y `43`, sin que ningún código las leyera:
- `informes.view` — los 7 roles.
- `informes.edit` — todos excepto `viewer`.
- `informes.sign` ("Firmar/aprobar informes") — solo `admin`, `manager`, `supervisor`.

Es decir, **la política de negocio ya estaba modelada en la base de datos** desde ADR-036/043; la brecha era exclusivamente de capa de aplicación (idéntico patrón al que ADR-063 corrigió para la matriz de permisos, pero en un módulo distinto y sin ADR propio hasta ahora).

Adicionalmente, se encontró un hueco de integridad documental no relacionado con roles: la regla `from == to` de `isValidReportTransition` ("sin cambio de estado siempre se permite") dejaba sin ninguna barrera un `PUT` que reenviara `status="signed"` junto con `content_json` modificado — cualquier miembro del tenant con acceso de escritura podía reescribir silenciosamente el contenido de un informe ya firmado, socavando la garantía de integridad que ADR-018 asume para la firma documental.

Del lado del frontend, no existía ningún hook (`usePermissions`, `useHasPermission`) para consumir el permiso del usuario — cada pantalla comparaba `session.role` contra strings hardcodeados de forma inconsistente (`ReportsAdminModal.tsx`, `App.tsx`), repitiendo el mismo patrón de drift que ADR-036/063 ya habían señalado como riesgo.

## Decisión

### Backend

1. **Permiso por transición, resuelto por el estado ACTUAL del informe** (bajo el mismo lock de fila `SELECT ... FOR UPDATE` que ya usa `updateReportPg` para la máquina de estados — sin round-trip adicional ni ventana de carrera):
   - `draft` / `rejected` → requiere `informes.edit` (el autor edita, envía a revisión, o retoma un rechazo).
   - `in_review` / `approved` → requiere `informes.sign` (solo quien puede aprobar/firmar puede tocar el contenido o mover el workflow desde ahí — evita que el autor original edite tras enviar a revisión).
   - Aplica tanto a transiciones reales como a guardados de contenido sin cambio de estado (autosave), porque el permiso depende únicamente de `currentStatus`, no de si hay transición.
2. **Inmutabilidad absoluta de `signed`/`archived`**, sin excepción de rol (ni `admin`, que normalmente tiene bypass total en `hasPermission`): ningún `PUT` — ni de contenido ni de estado — puede alterar un informe en esos estados. Corregir un informe firmado exige un informe nuevo, no editarlo.
3. **Crear** (`POST /api/reports`) e **importar** (`POST /api/reports/import/portable`) requieren `informes.edit`.
4. **Eliminar** (`DELETE /api/reports/{id}`) requiere `informes.sign` (misma autoridad elevada que aprobar/firmar) y además queda bloqueado — sin excepción de rol — si el informe está `signed` (mismo criterio de inmutabilidad que el punto 2; `archived` sí puede eliminarse por quien tenga `informes.sign`, como limpieza de un ciclo de vida ya cerrado).
5. **Leer/exportar** (`GET /api/reports`, `GET /api/reports/{id}`, `/revisions`, `/export/pdf`, `/export/portable`) requieren `informes.view`, resuelto contra el **tenant objetivo** de la petición (`targetTenant`, no necesariamente `session.tenantId`) porque un usuario multitenant puede tener rol distinto por unidad.
6. Todos los rechazos de permiso devuelven `403 {"error":"forbidden","need":"<código>"}` — mismo formato que `device_alarm_routes.cpp`/`notification_routes.cpp`, sin inventar una forma nueva. La inmutabilidad devuelve `409 {"error":"report_immutable","status":"signed"|"archived"}`.

No se creó ninguna clave de permiso nueva ni migración SQL: `informes.view/edit/sign` ya cubrían exactamente esta granularidad; el fix es enteramente de capa de aplicación (ver "Alternativas descartadas").

Implementación: `backend/src/reports/report_service.cpp` (`updateReportPg` recibe `userId` nuevo, gate de permiso + inmutabilidad dentro del lock de fila; `deleteReportPg` gate de inmutabilidad), `backend/src/reports/report_routes.cpp` (gates de `hasPermission` en los 6 handlers mutables/lectores, mapeo de los nuevos prefijos de error `forbidden:`/`report_immutable:` a HTTP), `backend/src/reports/report_service.hpp` (firma y documentación actualizadas).

### Frontend (reutilización cross-módulo)

7. **Nuevo hook `frontend/src/auth/usePermissions.ts`**, consumiendo el endpoint ya existente y sin uso `GET /api/auth/permissions` (`handleMyPermissions` en `notification_routes.cpp`, que ya devolvía `{role, is_admin, permissions[]}` resuelto server-side vía `effectiveRole`/`permissionsForRole` — nunca llamado desde el frontend hasta hoy salvo por el editor de matriz de administración). Expone `{ role, isAdmin, hasPermission(code), loading }`, con una caché a nivel de módulo compartida entre instancias (evita refetch duplicado si varios componentes lo usan a la vez) invalidada por cambio de `userId`/`tenantId` — el cambio de unidad (`TenantSwitcher`) ya fuerza `window.location.reload()`, así que no requiere invalidación explícita adicional.
8. Este hook es la **pieza reutilizable entre módulos** que pide gerencia: cualquier vista de la plataforma (reportes, alarmas, dispositivos, administración) importa el mismo hook en vez de repetir comparaciones de `session.role` — un solo mecanismo de "login, permisos, accesos" en toda la SPA, alineado con el diseño de plataforma compartida de ADR-031.
9. `WorkflowPanel.tsx` recibe `hasPermission` y filtra `availableTransitions` con la misma regla que el backend (`draft`/`rejected` → `informes.edit`; el resto → `informes.sign`) — el botón "Firmar"/"Aprobar" deja de mostrarse a quien no tiene autoridad, en vez de mostrarse a cualquiera y fallar recién al hacer clic.
10. `ReportsAdminModal.tsx` (`canEdit`/`canDelete`) reemplaza el hardcode `session.role === 'admin'` por `hasPermission('informes.sign')` (+ excepción de autor-en-borrador con `informes.edit` para editar), reflejando exactamente la regla que el backend ya exige — el backend sigue siendo la autoridad real, esto solo evita mostrar una acción que el servidor rechazará.
11. `frontend/src/App.tsx`: `canMaintain` (que decide si se ve el grupo de navegación "mantenimiento" — Usuarios/Permisos/Alarmas) deja de comparar `session.role` contra los strings `'admin'`/`'supervisor'` y pasa a `isAdmin || hasPermission('usuarios.manage') || hasPermission('permisos.manage') || hasPermission('alarmas.manage')` — desacopla la regla de un nombre de rol específico (el mismo tipo de drift que ADR-036/063 corrigieron) y la ata a la capacidad real otorgada en `role_permissions`. Se añade además un guard de render explícito (`canMaintain &&`) alrededor de `UserManagementView`/`PermissionsManagementView`/`AlarmConfigView` — antes solo se ocultaban del menú lateral, sin una segunda barrera en el punto donde el componente realmente se monta.

## Consecuencias

### Positivas
- Cierra el hallazgo más severo de la auditoría 2026-08-02: ningún rol sin `informes.sign` puede ya aprobar, firmar o eliminar un informe técnico minero, verificado en el mismo lock de fila que la máquina de estados (sin ventana de carrera entre chequeo y aplicación).
- Un informe firmado es inmutable de verdad — ni un `PUT` de "mismo estado" ni `admin` pueden alterarlo o borrarlo — cerrando un hueco de integridad documental independiente del RBAC que la auditoría también encontró.
- Cero migraciones SQL nuevas: la política de negocio ya vivía en `role_permissions` desde ADR-036/043; el fix es puramente de aplicación, con el menor blast radius posible.
- El hook `usePermissions` es la primera pieza de RBAC del frontend reutilizable entre módulos por diseño (no solo entre pantallas de reportes) — sienta el patrón para que futuros módulos (dispositivos, alarmas, cartografía) no vuelvan a repetir comparaciones de rol hardcodeadas.
- El backend sigue siendo la única autoridad real (defensa en profundidad): el frontend ahora refleja la misma regla, pero un bypass del cliente (llamada directa a la API) sigue siendo rechazado igual que antes de este fix, no depende de que el frontend tenga razón.

### Negativas / Trade-offs
- `updateReportPg` gana un parámetro (`userId`) y una consulta lógica adicional de permiso por request de escritura — costo despreciable frente al `SELECT ... FOR UPDATE` que ya hacía la misma función.
- La inmutabilidad de `signed`/`archived` es intencionalmente sin excepción de rol: si en el futuro surge un caso de uso legítimo de "corregir un informe firmado" (p.ej. anulación regulatoria), requiere un ADR propio con su propio flujo (no reabrir el `PUT` genérico).
- El hook de frontend depende de una llamada de red adicional al montar el árbol de la aplicación (una vez por sesión/tenant, cacheada) — no paginado ni con invalidación fina por cambio de permisos en caliente (un cambio de permisos hecho por un admin en `PermissionsManagementView` no se refleja para otros usuarios ya logueados hasta su próximo refresh de token o recarga; aceptable, mismo criterio de "los permisos cambian rara vez" que documenta `permissions.hpp`).

### Neutras
- No se modela un permiso `informes.approve` separado de `informes.sign`: el propio seed de `db_scripts/42` ya describe `informes.sign` como "Firmar/**aprobar** informes", así que ambas acciones comparten el mismo umbral de autoridad — consistente con el patrón ya usado por `alarmas.manage`/`dispositivos.manage` (una sola clave "manage" cubre varias acciones elevadas del mismo recurso, sin una clave por verbo).
- `archived` puede eliminarse por quien tenga `informes.sign` (a diferencia de `signed`, que no puede eliminarse por nadie) — es un cierre de ciclo de vida ya consumado, no un documento con validez legal activa.

## Alternativas descartadas

### Middleware centralizado de autorización en el router
Habría sido la solución de mediano plazo más limpia (un único punto que resuelva permiso por ruta+método), pero el permiso requerido en `PUT /api/reports/{id}` **depende del estado actual del recurso**, no solo de la ruta — un middleware genérico no puede resolver eso sin ya conocer el dominio de reportes, así que se prefirió el gate explícito dentro de `updateReportPg`, en el mismo punto donde el estado ya se lee bajo lock. Se revisita si aparece un tercer módulo con la misma necesidad de permiso-dependiente-de-estado (ver razonamiento equivalente en ADR-036 sobre diferir una constante C++ compartida de roles).

### Nueva clave de permiso `informes.approve` distinta de `informes.sign`
Descartada: el seed original de `informes.sign` ya declara explícitamente cubrir "firmar/aprobar" como una sola capacidad, y separar ambas habría exigido una migración SQL y una decisión de negocio nueva (¿puede alguien aprobar sin poder firmar?) sin que la auditoría haya encontrado un caso de uso real que lo pida hoy.

### Permitir que `admin` edite/elimine informes firmados (bypass habitual de `hasPermission`)
Descartada deliberadamente: la inmutabilidad de `signed` es una garantía de integridad documental (ADR-018), no un control de acceso — el cinturón de seguridad de "`admin` siempre tiene todo" en `hasPermission` existe para que un tenant nunca quede sin administrador efectivo, no para permitir reescribir un documento ya firmado. Se implementó como chequeo independiente de `hasPermission`, no bypasseable por rol.

## Referencias
- `backend/src/reports/report_routes.cpp`, `report_service.{hpp,cpp}` (gates de permiso e inmutabilidad)
- `backend/src/auth/permissions.{hpp,cpp}` (`hasPermission`, `effectiveRole`, `permissionsForRole` — sin cambios, reutilizados)
- `backend/src/mining/notification_routes.cpp::handleMyPermissions` (`GET /api/auth/permissions`, endpoint preexistente ahora consumido por el frontend)
- `frontend/src/auth/usePermissions.ts` (nuevo)
- `frontend/src/components/ReportStudioV2/components/document/WorkflowPanel.tsx`, `components/modals/ReportsAdminModal.tsx`, `frontend/src/App.tsx`
- `db_scripts/42_notifications_rbac_multitenant.sql`, `43_rbac_six_roles_reconcile.sql` (seeds de `informes.view/edit/sign`, sin cambios)
- ADR-017 (workflow canónico), ADR-018 (firma documental), ADR-029 (RBAC/JWT), ADR-036/063 (7 roles unificados y asignables)
