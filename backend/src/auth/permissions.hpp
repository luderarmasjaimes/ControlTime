// --------------------------------------------------------------------------
// permissions.hpp — RBAC multitenant (roles por tenant + matriz de permisos)
// --------------------------------------------------------------------------
// Resuelve el ROL EFECTIVO de un usuario en un tenant concreto: el rol de
// auth_user_tenant.role (por tenant) tiene prioridad sobre auth_users.role
// (global). Luego expande ese rol a su conjunto de permisos usando
// role_permissions, con override por tenant (ver db_scripts/42).
//
// Diseñado para ser barato en el hot path de autorización: una consulta a la
// BD por chequeo, sin caché (los permisos cambian rara vez y la consulta es
// trivial sobre índices). Si el volumen lo exigiera, se puede añadir una
// caché con invalidación por versión — no necesario a la escala actual.
// --------------------------------------------------------------------------
#pragma once

#include <optional>
#include <set>
#include <string>

namespace auth {

/** @brief Rol efectivo del usuario en el tenant (auth_user_tenant.role o el global). */
std::string effectiveRole(const std::string& userId, const std::string& tenantId,
                          const std::string& globalRole);

/** @brief Departamento de soporte del usuario en el tenant (auth_user_tenant.department,
 * ver db_scripts/62 y ADR-115) -- `std::nullopt` si no tiene uno asignado (sin
 * restricción de departamento; sigue dependiendo de soporte.view/soporte.manage).
 * Mismo criterio sin caché que `effectiveRole`. */
std::optional<std::string> effectiveDepartment(const std::string& userId,
                                               const std::string& tenantId);

/** @brief Conjunto de códigos de permiso para un rol en un tenant (con override). */
std::set<std::string> permissionsForRole(const std::string& tenantId,
                                         const std::string& role);

/** @brief true si el usuario tiene `permissionCode` en el tenant dado. */
bool hasPermission(const std::string& userId, const std::string& tenantId,
                   const std::string& globalRole, const std::string& permissionCode);

/** @brief true si `userId` tiene una fila real en `auth_user_tenant` para `tenantId`
 * (o si `tenantId` es exactamente el tenant activo de su sesión — chequeo rápido sin
 * consulta). Usar SIEMPRE antes de honrar un `tenant_id` de query/body en un endpoint
 * que no sea el propio tenant activo de la sesión — nunca confiar en un tenant_id
 * de cliente sin esta verificación (mismo criterio que ADR-038/039). */
bool userBelongsToTenant(const std::string& userId, const std::string& sessionTenantId,
                         const std::string& requestedTenantId);

/** @brief true si existe una fila REAL en `auth_user_tenant` para (`userId`,
 * `tenantId`) — a diferencia de `userBelongsToTenant`, NO acepta como válido
 * el atajo "tenantId == tenant de sesión" sin consultar la BD. Necesario
 * porque `AuthSession.tenantId`/el JWT pueden traer un tenant_id de
 * *fallback* (`kMiningTelemetryDemoTenantId`, ver
 * `resolveTelemetryTenantIdPg` en `auth_storage_pg.cpp`) para usuarios sin
 * ninguna fila real en `auth_user_tenant` — ese fallback existe para que el
 * dashboard de telemetría muestre datos demo a un usuario legacy sin
 * tenant, pero NO debe alcanzar para crear/editar informes (ADR-039,
 * migración completa 2026-07-13: tenant_id debe ser real y asignado, nunca
 * inventado/por defecto). Usar esto — no solo `!tenantId.empty()` — antes
 * de honrar la creación/edición de un informe. */
bool userHasRealTenantMembership(const std::string& userId, const std::string& tenantId);

/** @brief true si `tenantId` es de tipo `company_type = 'organization'`
 * (Beemetry/TimeTelemetry) — ver db_scripts/72. Es el guardia que cierra la
 * tensión documentada en ADR-086 ("permiso de plataforma evaluado contra un
 * tenant_id de tenant"): cualquier endpoint que otorgue/revoque acceso
 * cruzado (org_tenant_access) debe exigir ESTO además de
 * `hasPermission(..., "org.cross_tenant.manage")` — así, aunque un tenant
 * minero se autoinserte ese permission_code en su propia matriz (posible por
 * el diseño de override completo por tenant, db_scripts/42), el chequeo de
 * tipo de tenant bloquea su uso igual. */
bool isOrganizationTenant(const std::string& tenantId);

} // namespace auth
