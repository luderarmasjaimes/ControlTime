#pragma once

#include "../http/router.hpp"

namespace auth {
// Sub-namespace propio (no `auth::registerRoutes` a secas) para no colisionar
// con `auth::registerRoutes` de auth_routes.hpp -- mismo símbolo, misma firma,
// mismo namespace habría sido un choque de ODR en el link.
namespace org_access {

/** @brief Registra `/api/auth/org-access/*` — acceso cruzado explícito de
 * personal de empresas `company_type='organization'` (Beemetry/TimeTelemetry)
 * a tenants mineros clientes, sobre uno de los 7 roles ya existentes (sin
 * crear un 8vo rol). Ver db_scripts/72 y docs/decisions (ADR de esta
 * extensión). Todo endpoint exige `hasPermission(..., "org.cross_tenant.manage")`
 * **y** `isOrganizationTenant(session->tenantId)` — el doble guardia que
 * cierra la tensión documentada en ADR-086. */
void registerRoutes(router::Router &r);

} // namespace org_access
} // namespace auth
