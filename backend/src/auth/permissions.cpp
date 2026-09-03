// --------------------------------------------------------------------------
// permissions.cpp — RBAC multitenant (ver permissions.hpp)
// --------------------------------------------------------------------------
#include "permissions.hpp"
#include "../config/app_config.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <iostream>

using config::AppConfig;

namespace auth {

std::string effectiveRole(const std::string& userId, const std::string& tenantId,
                          const std::string& globalRole) {
#if HAS_LIBPQ
    if (userId.empty() || tenantId.empty()) return globalRole;
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) return globalRole;
    const char* p[2] = {userId.c_str(), tenantId.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT role FROM auth_user_tenant "
        "WHERE user_id = $1::uuid AND tenant_id = $2::uuid AND role IS NOT NULL",
        2, nullptr, p, nullptr, nullptr, 0)};
    if (res.okTuples() && PQntuples(res.get()) == 1)
        return PQgetvalue(res.get(), 0, 0);
    // Sin membresía real: ¿tiene una concesión de acceso cruzado activa
    // (org_tenant_access, db_scripts/72 — personal de organización operando
    // en un tenant minero)? Se consulta DESPUÉS de auth_user_tenant a
    // propósito: una membresía real siempre gana sobre una concesión.
    storage::PgResult org{PQexecParams(conn,
        "SELECT role FROM org_tenant_access "
        "WHERE user_id = $1::uuid AND tenant_id = $2::uuid AND active = TRUE "
        "AND revoked_at IS NULL",
        2, nullptr, p, nullptr, nullptr, 0)};
    if (org.okTuples() && PQntuples(org.get()) == 1)
        return PQgetvalue(org.get(), 0, 0);
#endif
    return globalRole;
}

std::optional<std::string> effectiveDepartment(const std::string& userId,
                                               const std::string& tenantId) {
#if HAS_LIBPQ
    if (userId.empty() || tenantId.empty()) return std::nullopt;
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) return std::nullopt;
    const char* p[2] = {userId.c_str(), tenantId.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT department FROM auth_user_tenant "
        "WHERE user_id = $1::uuid AND tenant_id = $2::uuid AND department IS NOT NULL",
        2, nullptr, p, nullptr, nullptr, 0)};
    if (res.okTuples() && PQntuples(res.get()) == 1)
        return std::string(PQgetvalue(res.get(), 0, 0));
#endif
    return std::nullopt;
}

std::set<std::string> permissionsForRole(const std::string& tenantId,
                                         const std::string& role) {
    std::set<std::string> perms;
#if HAS_LIBPQ
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) return perms;

    // ¿El tenant tiene override para este rol? Si sí, sus filas reemplazan el
    // default global (semántica de override completo — ver db_scripts/42).
    const char* op[2] = {tenantId.c_str(), role.c_str()};
    storage::PgResult ov{PQexecParams(conn,
        "SELECT permission_code FROM role_permissions "
        "WHERE tenant_id = $1::uuid AND role = $2",
        2, nullptr, op, nullptr, nullptr, 0)};
    if (ov.okTuples() && PQntuples(ov.get()) > 0) {
        for (int i = 0; i < PQntuples(ov.get()); ++i)
            perms.insert(PQgetvalue(ov.get(), i, 0));
        return perms;
    }

    // Default global (tenant_id NULL).
    const char* gp[1] = {role.c_str()};
    storage::PgResult g{PQexecParams(conn,
        "SELECT permission_code FROM role_permissions "
        "WHERE tenant_id IS NULL AND role = $1",
        1, nullptr, gp, nullptr, nullptr, 0)};
    if (g.okTuples())
        for (int i = 0; i < PQntuples(g.get()); ++i)
            perms.insert(PQgetvalue(g.get(), i, 0));
#endif
    return perms;
}

bool hasPermission(const std::string& userId, const std::string& tenantId,
                   const std::string& globalRole, const std::string& permissionCode) {
    const std::string role = effectiveRole(userId, tenantId, globalRole);
    // admin siempre tiene todo (evita que un override mal configurado deje un
    // tenant sin ningún administrador efectivo — cinturón de seguridad).
    if (role == "admin") return true;
    const auto perms = permissionsForRole(tenantId, role);
    return perms.count(permissionCode) > 0;
}

bool userBelongsToTenant(const std::string& userId, const std::string& sessionTenantId,
                         const std::string& requestedTenantId) {
    if (requestedTenantId.empty()) return false;
    if (!sessionTenantId.empty() && sessionTenantId == requestedTenantId) return true;
#if HAS_LIBPQ
    if (userId.empty()) return false;
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) return false;
    const char* p[2] = {userId.c_str(), requestedTenantId.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT 1 FROM auth_user_tenant WHERE user_id = $1::uuid AND tenant_id = $2::uuid LIMIT 1",
        2, nullptr, p, nullptr, nullptr, 0)};
    return res.okTuples() && PQntuples(res.get()) > 0;
#else
    return false;
#endif
}

bool userHasRealTenantMembership(const std::string& userId, const std::string& tenantId) {
    if (userId.empty() || tenantId.empty()) return false;
#if HAS_LIBPQ
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) return false;
    const char* p[2] = {userId.c_str(), tenantId.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT 1 FROM auth_user_tenant WHERE user_id = $1::uuid AND tenant_id = $2::uuid LIMIT 1",
        2, nullptr, p, nullptr, nullptr, 0)};
    return res.okTuples() && PQntuples(res.get()) > 0;
#else
    return false;
#endif
}

bool isOrganizationTenant(const std::string& tenantId) {
    if (tenantId.empty()) return false;
#if HAS_LIBPQ
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) return false;
    const char* p[1] = {tenantId.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT 1 FROM tenants WHERE tenant_id = $1::uuid AND company_type = 'organization' LIMIT 1",
        1, nullptr, p, nullptr, nullptr, 0)};
    return res.okTuples() && PQntuples(res.get()) > 0;
#else
    return false;
#endif
}

} // namespace auth
