// --------------------------------------------------------------------------
// notification_routes.cpp — canales de notificación (CRUD) + RBAC/permisos
// --------------------------------------------------------------------------
#include "notification_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/permissions.hpp"
#include "alarm_notifier.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <boost/json.hpp>
#include <set>
#include <string>

namespace json = boost::json;
using http_utils::makeJsonResponse;
using config::AppConfig;

namespace mining_iot {
namespace {

std::string jsonStr(const json::object& o, const char* k, const std::string& def = "") {
    if (const auto* v = o.if_contains(k))
        if (v->is_string()) return std::string(v->as_string());
    return def;
}

// ─────────────────────── Permisos: introspección propia ─────────────────────
// GET /api/auth/permissions — el frontend usa esto para pintar/ocultar
// funciones según lo que el usuario realmente puede hacer en el tenant activo.
http::response<http::string_body>
handleMyPermissions(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    const std::string role =
        auth::effectiveRole(session->userId, session->tenantId, session->role);
    const auto perms = auth::permissionsForRole(session->tenantId, role);
    json::array arr;
    for (const auto& p : perms) arr.push_back(json::string(p));
    // admin: además del set explícito, marcar el flag para el cliente.
    // is_organization_tenant (db_scripts/72): el frontend lo usa para decidir
    // si muestra el panel de acceso cruzado (UserManagementView.tsx) -- solo
    // tiene sentido para personal cuyo tenant activo es Beemetry/TimeTelemetry.
    return makeJsonResponse(http::status::ok,
        json::object{{"role", role},
                     {"tenant_id", session->tenantId},
                     {"is_admin", role == "admin"},
                     {"is_organization_tenant", auth::isOrganizationTenant(session->tenantId)},
                     {"permissions", arr}});
}

// GET /api/auth/permissions/matrix — matriz completa (rol×permiso) del tenant,
// para la pantalla de administración. Requiere permisos.manage.
http::response<http::string_body>
handlePermissionMatrix(const http::request<http::string_body>& req,
                       const std::unordered_map<std::string, std::string>& query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                             "permisos.manage"))
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "forbidden"}});
#if HAS_LIBPQ
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    json::array catalog;
    storage::PgResult cat{PQexec(conn,
        "SELECT code, module, description FROM platform_permissions ORDER BY module, code")};
    if (cat.okTuples())
        for (int i = 0; i < PQntuples(cat.get()); ++i)
            catalog.push_back(json::object{
                {"code", PQgetvalue(cat.get(), i, 0)},
                {"module", PQgetvalue(cat.get(), i, 1)},
                {"description", PQgetvalue(cat.get(), i, 2)}});

    // Los 7 roles reales de la plataforma (kValidPlatformRoles, auth_routes.cpp
    // / ADMIN_ASSIGNABLE_ROLES en el frontend) -- antes solo devolvía 4
    // (admin/manager/operator/viewer), dejando supervisor/geologist/safety sin
    // fila en la matriz que ve PermissionsManagementView.tsx.
    json::object matrix;
    for (const char* role : {"admin", "manager", "supervisor", "geologist",
                             "safety", "operator", "viewer"}) {
        const auto perms = auth::permissionsForRole(session->tenantId, role);
        json::array arr;
        for (const auto& p : perms) arr.push_back(json::string(p));
        matrix[role] = arr;
    }
    return makeJsonResponse(http::status::ok,
        json::object{{"catalog", catalog}, {"matrix", matrix}});
#else
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
#endif
}

// POST /api/auth/permissions/matrix — reemplaza los permisos de un rol para
// el tenant activo (override completo). Body: {role, permissions:[...]}.
http::response<http::string_body>
handleUpdateMatrix(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                             "permisos.manage"))
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "forbidden"}});
#if HAS_LIBPQ
    std::string role;
    std::set<std::string> codes;
    try {
        const auto body = json::parse(req.body()).as_object();
        role = jsonStr(body, "role");
        if (const auto* arr = body.if_contains("permissions"))
            for (const auto& v : arr->as_array())
                if (v.is_string()) codes.insert(std::string(v.as_string()));
    } catch (...) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid_json"}});
    }
    // Los 7 roles reales de la plataforma (ADMIN_ASSIGNABLE_ROLES en
    // roleConstants.ts del frontend es la fuente de verdad para pantallas de
    // administración) — antes solo 4 genéricos, ver db_scripts/43.
    static const std::set<std::string> kValidRoles = {
        "admin", "manager", "supervisor", "geologist", "safety", "operator", "viewer"};
    if (kValidRoles.find(role) == kValidRoles.end())
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid_role"}});

    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK)
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "db_unavailable"}});

    storage::PgResult begin{PQexec(conn, "BEGIN")};
    const char* del[2] = {session->tenantId.c_str(), role.c_str()};
    storage::PgResult d{PQexecParams(conn,
        "DELETE FROM role_permissions WHERE tenant_id = $1::uuid AND role = $2",
        2, nullptr, del, nullptr, nullptr, 0)};
    if (!d.okCommand()) { PQexec(conn, "ROLLBACK");
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "db_error"}}); }
    for (const auto& code : codes) {
        const char* ins[3] = {session->tenantId.c_str(), role.c_str(), code.c_str()};
        storage::PgResult i{PQexecParams(conn,
            "INSERT INTO role_permissions (tenant_id, role, permission_code) "
            "VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING",
            3, nullptr, ins, nullptr, nullptr, 0)};
        if (!i.okCommand()) { PQexec(conn, "ROLLBACK");
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "permiso_invalido"},
                                                 {"code", code}}); }
    }
    // Auditar el cambio (cadena de hash ADR-030).
    const char* aud[2] = {session->tenantId.c_str(), role.c_str()};
    storage::PgResult a{PQexecParams(conn,
        "SELECT fn_platform_audit_insert($1::uuid, NULL, 'rbac', "
        "'permissions_updated', 'role', $2::text, NULL, NULL, NULL, TRUE, NULL)",
        2, nullptr, aud, nullptr, nullptr, 0)};
    (void)a;
    PQexec(conn, "COMMIT");
    return makeJsonResponse(http::status::ok,
        json::object{{"status", "updated"}, {"role", role},
                     {"count", static_cast<std::int64_t>(codes.size())}});
#else
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
#endif
}

// ──────────────────────── Canales de notificación (CRUD) ────────────────────
http::response<http::string_body>
handleListChannels(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                             "alarmas.view"))
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "forbidden"}});
#if HAS_LIBPQ
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    const char* p[1] = {session->tenantId.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT channel_id, channel_type, label, config::text, min_severity, enabled "
        "FROM notification_channels WHERE tenant_id = $1::uuid ORDER BY created_at",
        1, nullptr, p, nullptr, nullptr, 0)};
    json::array items;
    if (res.okTuples())
        for (int i = 0; i < PQntuples(res.get()); ++i) {
            json::value cfg;
            try { cfg = json::parse(PQgetvalue(res.get(), i, 3)); } catch (...) { cfg = json::object{}; }
            items.push_back(json::object{
                {"channel_id", PQgetvalue(res.get(), i, 0)},
                {"channel_type", PQgetvalue(res.get(), i, 1)},
                {"label", PQgetvalue(res.get(), i, 2)},
                {"config", cfg},
                {"min_severity", PQgetvalue(res.get(), i, 4)},
                {"enabled", std::string(PQgetvalue(res.get(), i, 5)) == "t"}});
        }
    return makeJsonResponse(http::status::ok, json::object{{"channels", items}});
#else
    return makeJsonResponse(http::status::ok, json::object{{"channels", json::array()}});
#endif
}

http::response<http::string_body>
handleCreateChannel(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                             "alarmas.manage"))
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "forbidden"}});
#if HAS_LIBPQ
    std::string type, label, configJson, minSev;
    try {
        const auto body = json::parse(req.body()).as_object();
        type = jsonStr(body, "channel_type");
        label = jsonStr(body, "label");
        minSev = jsonStr(body, "min_severity", "warning");
        if (const auto* c = body.if_contains("config"))
            configJson = json::serialize(*c);
    } catch (...) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid_json"}});
    }
    if (type != "email" && type != "webhook")
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "tipo_invalido"}});
    if (label.empty() || configJson.empty())
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "faltan_campos"}});

    // Validar el DESTINO antes de persistirlo (auditoría de seguridad
    // 2026-08-02). Hasta ahora la config se guardaba tal cual y solo se
    // comprobaba en el momento del envío: eso permitía dejar registrado un
    // webhook apuntando a la red interna (metadatos cloud, db, el propio
    // backend) y que el servidor lo solicitara en cada alarma — SSRF a
    // petición de un admin de tenant. Rechazarlo aquí además le da al
    // operador un error inmediato en vez de un canal que falla en silencio.
    {
        std::string targetError;
        if (!mining_iot::validateChannelTarget(type, configJson, targetError))
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", targetError}});
    }

    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    const char* p[5] = {session->tenantId.c_str(), type.c_str(), label.c_str(),
                        configJson.c_str(), minSev.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "INSERT INTO notification_channels (tenant_id, channel_type, label, config, min_severity) "
        "VALUES ($1::uuid, $2, $3, $4::jsonb, $5) RETURNING channel_id",
        5, nullptr, p, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0)
        return makeJsonResponse(http::status::bad_request,
            json::object{{"error", "insert_fallo"},
                         {"detail", PQresultErrorMessage(res.get())}});
    return makeJsonResponse(http::status::ok,
        json::object{{"channel_id", PQgetvalue(res.get(), 0, 0)}});
#else
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleDeleteChannel(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    if (!auth::hasPermission(session->userId, session->tenantId, session->role,
                             "alarmas.manage"))
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "forbidden"}});
#if HAS_LIBPQ
    std::string rawTarget(req.target());
    static const std::string kPrefix = "/api/mining/notifications/channels/";
    std::string channelId = rawTarget.substr(kPrefix.size());
    if (auto q = channelId.find('?'); q != std::string::npos)
        channelId = channelId.substr(0, q);
    if (channelId.empty())
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid_id"}});
    auto lease = storage::PgPool::instance().acquire(AppConfig::instance().gDatabaseUrl);
    PGconn* conn = lease.get();
    const char* p[2] = {channelId.c_str(), session->tenantId.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "DELETE FROM notification_channels "
        "WHERE channel_id = $1::uuid AND tenant_id = $2::uuid",
        2, nullptr, p, nullptr, nullptr, 0)};
    const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
    return makeJsonResponse(ok ? http::status::ok : http::status::not_found,
        json::object{{"status", ok ? "deleted" : "not_found"}});
#else
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace

void registerNotificationRoutes(router::Router& r) {
    // RBAC / permisos
    r.get("/api/auth/permissions", handleMyPermissions);
    r.get("/api/auth/permissions/matrix", handlePermissionMatrix);
    r.post("/api/auth/permissions/matrix", handleUpdateMatrix);
    // Canales de notificación
    r.get("/api/mining/notifications/channels", handleListChannels);
    r.post("/api/mining/notifications/channels", handleCreateChannel);
    r.post("/api/mining/notifications/channels/", handleDeleteChannel);
}

} // namespace mining_iot
