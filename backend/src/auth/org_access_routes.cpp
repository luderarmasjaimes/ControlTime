// --------------------------------------------------------------------------
// org_access_routes.cpp — acceso cruzado de personal de organización
// (Beemetry/TimeTelemetry, company_type='organization') a tenants mineros
// clientes. Ver db_scripts/72 y permissions.hpp (isOrganizationTenant). NO
// crea un 8vo rol: la concesión opera sobre uno de los 7 roles ya existentes
// (auth_routes.cpp::kValidPlatformRoles).
// --------------------------------------------------------------------------
#include "org_access_routes.hpp"
#include "auth_session.hpp"
#include "auth_storage_pg.hpp"
#include "permissions.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

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
#include <algorithm>
#include <optional>
#include <set>
#include <string>

namespace json = boost::json;
using http_utils::makeJsonResponse;
using config::AppConfig;

namespace auth {
namespace org_access {
namespace {

// Mismo set que auth_routes.cpp::kValidPlatformRoles / notification_routes.cpp
// ::kValidRoles -- deliberadamente NO se comparte una constante entre los
// cuatro puntos (mismo trade-off ya documentado en ADR-036: solo dos
// archivos tenían el allowlist hardcodeado y no ameritó un header compartido
// para dos consumidores; ahora son cuatro, revisitar si aparece un quinto).
const std::set<std::string> &validRoles() {
  static const std::set<std::string> kRoles = {
      "admin", "manager", "supervisor", "geologist", "safety", "operator", "viewer"};
  return kRoles;
}

/** @brief Guardia doble para cualquier operación de gestión de acceso
 * cruzado: el actor debe (1) tener `org.cross_tenant.manage` y (2) operar
 * desde un tenant `company_type='organization'`. Cierra la tensión de
 * ADR-086 -- ver comentario en permissions.hpp::isOrganizationTenant. */
bool canManageOrgAccess(const std::optional<AuthSession> &session) {
  return session.has_value() &&
         hasPermission(session->userId, session->tenantId, session->role,
                       "org.cross_tenant.manage") &&
         isOrganizationTenant(session->tenantId);
}

/** @brief Allowlist de IP OPCIONAL, solo para grant/revoke (la capacidad de
 * mayor privilegio de este módulo) -- BEEMETRY_ORG_ACCESS_IP_ALLOWLIST vacía
 * (default) desactiva el chequeo. nginx ya reenvía X-Real-IP (frontend/
 * nginx.conf) delante de este backend. */
bool clientIpAllowed(const http::request<http::string_body> &req) {
  const std::string allowlist =
      config::getenvOr("BEEMETRY_ORG_ACCESS_IP_ALLOWLIST", "");
  if (allowlist.empty()) return true;
  // http_utils::getClientIp centraliza X-Real-IP/X-Forwarded-For (ADR-130) --
  // reutilizado aquí en vez de duplicar el parseo.
  const std::string clientIp = http_utils::getClientIp(req);
  if (clientIp.empty()) return false;
  std::size_t start = 0;
  while (start <= allowlist.size()) {
    const auto comma = allowlist.find(',', start);
    const std::string entry =
        allowlist.substr(start, comma == std::string::npos ? std::string::npos
                                                            : comma - start);
    if (entry == clientIp) return true;
    if (comma == std::string::npos) break;
    start = comma + 1;
  }
  return false;
}

} // namespace

/** GET /api/auth/org-access/candidates — tenants mineros activos (para el
 * selector de la UI). Requiere el guardia doble de canManageOrgAccess. */
http::response<http::string_body>
handleOrgAccessCandidates(const http::request<http::string_body> &req,
                          const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!canManageOrgAccess(session)) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "org.cross_tenant.manage"}});
  }
#if HAS_LIBPQ
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  json::array items;
  if (PQstatus(conn) == CONNECTION_OK) {
    // EXISTS en vez de JOIN a propósito: se detectó en vivo que auth_companies
    // puede tener más de una fila apuntando al mismo tenant_id (dato sucio
    // preexistente, no introducido por esta migración -- p.ej. "Ares" y
    // "Compania Minera Ares" comparten tenant_id). Un JOIN habría duplicado
    // la fila del tenant en la lista; EXISTS es inmune a cuántas filas de
    // auth_companies matcheen.
    storage::PgResult res{PQexec(
        conn,
        "SELECT t.tenant_id::text, t.tenant_name, COALESCE(t.country_code,''), "
        "COALESCE(t.region,'') "
        "FROM tenants t "
        "WHERE t.company_type = 'mining_client' "
        "AND EXISTS (SELECT 1 FROM auth_companies c WHERE c.tenant_id = t.tenant_id AND c.active = TRUE) "
        "ORDER BY t.tenant_name")};
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        items.push_back(json::object{
            {"tenant_id", PQgetvalue(res.get(), i, 0)},
            {"tenant_name", PQgetvalue(res.get(), i, 1)},
            {"country_code", PQgetvalue(res.get(), i, 2)},
            {"region", PQgetvalue(res.get(), i, 3)}});
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"tenants", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"tenants", json::array()}});
#endif
}

/** POST /api/auth/org-access/grant — body {username, tenant_id, role}. */
http::response<http::string_body>
handleOrgAccessGrant(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!canManageOrgAccess(session)) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "org.cross_tenant.manage"}});
  }
  if (!clientIpAllowed(req)) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "ip_no_autorizada"}});
  }
#if HAS_LIBPQ
  std::string username, tenantId, role;
  try {
    const auto body = json::parse(req.body()).as_object();
    if (const auto *v = body.if_contains("username")) if (v->is_string()) username = json::value_to<std::string>(*v);
    if (const auto *v = body.if_contains("tenant_id")) if (v->is_string()) tenantId = json::value_to<std::string>(*v);
    if (const auto *v = body.if_contains("role")) if (v->is_string()) role = json::value_to<std::string>(*v);
  } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (username.empty() || tenantId.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "username_y_tenant_id_requeridos"}});
  }
  if (role.empty()) role = "viewer";
  if (validRoles().find(role) == validRoles().end()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "rol_invalido"}});
  }

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  // El destino debe ser un tenant minero (nunca otra empresa de organización
  // -- este mecanismo es exclusivamente organización -> minera cliente).
  {
    const char *p[1] = {tenantId.c_str()};
    storage::PgResult t{PQexecParams(conn,
        "SELECT 1 FROM tenants WHERE tenant_id = $1::uuid AND company_type = 'mining_client'",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (!t.okTuples() || PQntuples(t.get()) == 0) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "tenant_destino_no_es_minera_cliente"}});
    }
  }

  const char *p[4] = {username.c_str(), tenantId.c_str(), role.c_str(), session->userId.c_str()};
  storage::PgResult ins{PQexecParams(conn,
      "INSERT INTO org_tenant_access (user_id, tenant_id, role, granted_by) "
      "SELECT u.id, $2::uuid, $3, $4::uuid FROM auth_users u WHERE u.username = $1 "
      "ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role, "
      "active = TRUE, revoked_at = NULL, revoked_by = NULL, "
      "granted_by = EXCLUDED.granted_by, granted_at = NOW() "
      "RETURNING user_id",
      4, nullptr, p, nullptr, nullptr, 0)};
  if (!ins.okTuples() || PQntuples(ins.get()) == 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "usuario_no_encontrado"}});
  }

  appendAuthAuditLogPg(conn, "org_access_grant", session->company, session->username, true,
                       "target=" + username + " tenant_id=" + tenantId + " role=" + role,
                       std::nullopt, std::nullopt, std::nullopt, http_utils::getClientIp(req));
  return makeJsonResponse(http::status::ok,
      json::object{{"ok", true}, {"username", username}, {"tenant_id", tenantId}, {"role", role}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

/** POST /api/auth/org-access/revoke — body {username, tenant_id}. */
http::response<http::string_body>
handleOrgAccessRevoke(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!canManageOrgAccess(session)) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "org.cross_tenant.manage"}});
  }
  if (!clientIpAllowed(req)) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "ip_no_autorizada"}});
  }
#if HAS_LIBPQ
  std::string username, tenantId;
  try {
    const auto body = json::parse(req.body()).as_object();
    if (const auto *v = body.if_contains("username")) if (v->is_string()) username = json::value_to<std::string>(*v);
    if (const auto *v = body.if_contains("tenant_id")) if (v->is_string()) tenantId = json::value_to<std::string>(*v);
  } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (username.empty() || tenantId.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "username_y_tenant_id_requeridos"}});
  }

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const char *p[3] = {username.c_str(), tenantId.c_str(), session->userId.c_str()};
  storage::PgResult res{PQexecParams(conn,
      "UPDATE org_tenant_access oa SET active = FALSE, revoked_at = NOW(), revoked_by = $3::uuid "
      "FROM auth_users u WHERE oa.user_id = u.id AND u.username = $1 AND oa.tenant_id = $2::uuid "
      "AND oa.active = TRUE",
      3, nullptr, p, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  if (ok) {
    appendAuthAuditLogPg(conn, "org_access_revoke", session->company, session->username, true,
                         "target=" + username + " tenant_id=" + tenantId,
                         std::nullopt, std::nullopt, std::nullopt, http_utils::getClientIp(req));
  }
  return makeJsonResponse(ok ? http::status::ok : http::status::not_found,
      json::object{{"status", ok ? "revoked" : "not_found"}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

/** GET /api/auth/org-access/audit[?limit=&offset=] — historial dedicado
 * (esta es la capacidad de mayor privilegio nueva; no se mezcla con el log
 * general). */
http::response<http::string_body>
handleOrgAccessAudit(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!canManageOrgAccess(session)) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "org.cross_tenant.manage"}});
  }
#if HAS_LIBPQ
  int limit = 50, offset = 0;
  try {
    if (query.count("limit")) limit = std::clamp(std::stoi(query.at("limit")), 1, 200);
    if (query.count("offset")) offset = std::max(0, std::stoi(query.at("offset")));
  } catch (...) {}

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  json::array items;
  if (PQstatus(conn) == CONNECTION_OK) {
    const std::string limitStr = std::to_string(limit);
    const std::string offsetStr = std::to_string(offset);
    const char *p[3] = {session->company.c_str(), limitStr.c_str(), offsetStr.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT event_time::text, event_action, username, success, detail, "
        "COALESCE(source_ip, '') "
        "FROM auth_audit_logs "
        "WHERE event_action IN ('org_access_grant','org_access_revoke') AND company_name = $1 "
        "ORDER BY event_time DESC LIMIT $2::int OFFSET $3::int",
        3, nullptr, p, nullptr, nullptr, 0)};
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        items.push_back(json::object{
            {"event_time", PQgetvalue(res.get(), i, 0)},
            {"action", PQgetvalue(res.get(), i, 1)},
            {"actor_username", PQgetvalue(res.get(), i, 2)},
            {"success", std::string(PQgetvalue(res.get(), i, 3)) == "t"},
            {"detail", PQgetvalue(res.get(), i, 4)},
            {"source_ip", PQgetvalue(res.get(), i, 5)}});
      }
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"items", items}});
#else
  return makeJsonResponse(http::status::ok, json::object{{"items", json::array()}});
#endif
}

void registerRoutes(router::Router &r) {
  r.get("/api/auth/org-access/candidates", handleOrgAccessCandidates);
  r.post("/api/auth/org-access/grant", handleOrgAccessGrant);
  r.post("/api/auth/org-access/revoke", handleOrgAccessRevoke);
  r.get("/api/auth/org-access/audit", handleOrgAccessAudit);
}

} // namespace org_access
} // namespace auth
