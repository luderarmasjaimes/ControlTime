# ADR-086 — RBAC granular: `empresas.view` / `empresas.manage`

**Status**: implemented (backend + frontend; pendiente de verificación E2E — ver Fase 6 del plan de implementación)
**Fecha**: 2026-08-05
**Autores**: EC
**Ámbito**: plataforma
**Relación**: extiende el mecanismo de `platform_permissions`/`role_permissions` de ADR-029/036 (`db_scripts/42/43`) y el patrón `hasPermission('recurso.accion')` formalizado por ADR-079/063; habilita ADR-085 (CRUD de empresas).

## Contexto

El `POST /api/auth/companies` de ADR-078 gateaba con `session->role ==
"admin"` — una comparación de string hardcodeada, no una capacidad
granular de la matriz `role_permissions` que ya usa el resto de la
plataforma (`usuarios.manage`, `permisos.manage`, `alarmas.manage`, etc.,
`db_scripts/42`). Gerencia pidió explícitamente "uno o más perfiles
administrativos que tienen la facultad de visualizar las empresas y otras
para realizar labores de mantenimiento" — es decir, separar ver de
mantener, algo que un solo booleano `role=="admin"` no puede expresar.

**Hallazgo real que condicionó el diseño de la migración** (no un supuesto):
`role_permissions` tiene semántica de **override completo por tenant**
(`db_scripts/42`, comentario en el propio schema) — si un tenant tiene AL
MENOS UNA fila propia para un rol, esas filas reemplazan el default global
por completo para ese rol. Esto significa que:
1. Un `permission_code` nuevo **no llega solo a `admin`** — el default
   global de admin en `db_scripts/42` fue un `INSERT...SELECT` puntual
   sobre el catálogo *de ese momento*, no una regla viva.
2. Cualquier tenant que ya haya editado su propia matriz (vía `POST
   /api/auth/permissions/matrix`) **nunca vería** `empresas.*` a menos que
   se le inserte la fila explícitamente — el default global no lo alcanza.

## Decisión

1. **Catálogo nuevo** en `platform_permissions`: `empresas.view` ("ver el
   catálogo administrativo de empresas") y `empresas.manage` ("crear,
   editar y dar de baja empresas del catálogo").
2. **Default global**: `admin` recibe ambos códigos; `manager` recibe solo
   `empresas.view`. `supervisor`/`geologist`/`safety`/`operator`/`viewer`
   no reciben ninguno por defecto — igual criterio que el resto de la
   matriz (permisos administrativos de plataforma solo para roles de
   gestión).
3. **Propagación a overrides existentes** (cierra el hallazgo #2 de
   arriba): la migración inserta también `empresas.manage`+`empresas.view`
   para todo `tenant_id` que ya tenga una fila propia de `admin`, y
   `empresas.view` para todo el que ya tenga una fila propia de `manager`
   — sin esto, cualquier tenant con matriz personalizada quedaría sin el
   permiso nuevo de forma permanente y silenciosa.
4. **Gate de los endpoints** (`auth_routes.cpp`): `GET
   /api/auth/companies/manage` exige `empresas.view`; `POST`/`PUT`/`DELETE
   /api/auth/companies` exigen `empresas.manage` vía
   `hasPermission(session->userId, session->tenantId, session->role,
   "empresas.manage")` — reemplaza el `session->role != "admin"`
   hardcodeado original de ADR-078.
5. **Frontend**: `App.tsx` gana un flag propio `canViewCompanies = isAdmin
   || hasPermission('empresas.view')`, **deliberadamente separado** de
   `canMaintain` (que agrupa `usuarios.manage`/`permisos.manage`/
   `alarmas.manage`) — un manager con solo `empresas.view` no debe heredar
   acceso a Usuarios/Permisos/Alarmas. El ítem de menú vive en un grupo de
   navegación propio (`empresas`), no dentro de `mantenimiento`: si
   compartiera grupo, un usuario con solo `empresas.view` vería también las
   pestañas de Usuarios/Permisos/Alarmas (visibles por pertenecer al mismo
   grupo) sin poder abrirlas (esas exigen `canMaintain` en su propio punto
   de montaje) — una pestaña muerta en la UI. `CompanyManagementView.tsx`
   usa `usePermissions()` internamente para ocultar los controles de
   mantenimiento cuando `!canManage`, además del enmascarado de RUC que ya
   hace el backend.

**Tensión documentada, no resuelta acá**: `hasPermission` evalúa el permiso
contra `session->tenantId` — el tenant del propio operador — pero el
recurso (catálogo de empresas) es de plataforma, no de un tenant
específico. Un tenant que se autoconceda `empresas.manage` en su propia
matriz podría crear/editar empresas para toda la plataforma, no solo para
sí mismo. Mitigación mínima aplicada: toda mutación queda auditada con el
tenant del actor (`appendAuthAuditLogPg`). Una separación real entre
"permiso de tenant" y "permiso de plataforma" en el modelo de
`role_permissions` es un cambio mayor, fuera de alcance de este ADR —
queda como riesgo abierto para quien diseñe esa capa.

## Consecuencias

- Gerencia puede otorgar "solo ver" a un perfil y "mantenimiento completo"
  a otro sin tocar código — vía la matriz `role_permissions` ya existente,
  el mismo mecanismo que gobierna el resto de los permisos de plataforma.
- El seed de prueba (ADR-088) valida las 4 combinaciones reales:
  `admin` (ambos permisos), `manager` (solo view, RUC enmascarado),
  `supervisor`/`viewer` (ninguno, el ítem de menú no aparece).

### Negativas / Trade-offs
- La tensión "permiso de plataforma en una matriz tenant-scoped" (ver
  arriba) no queda cerrada — mitigada, no resuelta.

## Alternativas descartadas

- **Grant tenant-scoped explícito por tenant en vez de propagación
  automática**: descartado porque, por la semántica de override completo
  (hallazgo #1), insertar una sola fila nueva en un tenant con matriz
  propia habría *reemplazado* el resto de sus permisos de ese rol en vez
  de agregarse — la propagación automática (insertar junto a lo que ya
  tenía) es la única forma correcta de no romper permisos existentes.

## Referencias

- `db_scripts/50_companies_crud_rbac.sql` (Bloque D)
- `backend/src/auth/permissions.hpp` / `.cpp` (sin cambios de código — se
  reutiliza `hasPermission` tal cual)
- `backend/src/auth/auth_routes.cpp`
- `frontend/src/App.tsx` (`canViewCompanies`, grupo `empresas`)
- `frontend/src/auth/usePermissions.ts` (sin cambios — se reutiliza tal cual)
