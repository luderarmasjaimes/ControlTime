#include "sensor_type_catalog_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/permissions.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <string>
#include <unordered_map>
#include <vector>

using http_utils::makeJsonResponse;
using config::AppConfig;

namespace mining_iot {

namespace {

#if HAS_LIBPQ

// GET /api/mining/sensor-types -- catálogo completo + parámetros habilitados
// por tipo (ADR-188). Sin gate de permiso más allá de sesión válida, misma
// paridad que GET /api/mining/formulas (vista de solo lectura).
http::response<http::string_body>
handleListSensorTypes(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  storage::PgResult res{PQexec(conn,
      "SELECT t.type_code, t.display_name, t.description, "
      "p.param_key, p.data_type, p.is_enabled, p.sort_order, p.description "
      "FROM sensor_type_def t "
      "LEFT JOIN sensor_type_parameter_def p ON p.type_code = t.type_code "
      "ORDER BY t.type_code ASC, p.sort_order ASC, p.param_key ASC")};
  if (!res.okTuples()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "query_failed"}});
  }
  struct TypeAcc {
    std::string displayName;
    json::value description{nullptr};
    json::array parameters;
  };
  std::vector<std::string> order;
  std::unordered_map<std::string, TypeAcc> byCode;
  const int n = PQntuples(res.get());
  for (int i = 0; i < n; ++i) {
    const std::string typeCode = PQgetvalue(res.get(), i, 0);
    auto it = byCode.find(typeCode);
    if (it == byCode.end()) {
      TypeAcc acc;
      acc.displayName = PQgetvalue(res.get(), i, 1);
      acc.description = PQgetisnull(res.get(), i, 2) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 2));
      it = byCode.emplace(typeCode, std::move(acc)).first;
      order.push_back(typeCode);
    }
    if (!PQgetisnull(res.get(), i, 3)) {
      it->second.parameters.push_back(json::object{
          {"param_key", PQgetvalue(res.get(), i, 3)},
          {"data_type", PQgetvalue(res.get(), i, 4)},
          {"is_enabled", std::string(PQgetvalue(res.get(), i, 5)) == "t"},
          {"sort_order", std::atoi(PQgetvalue(res.get(), i, 6))},
          {"description", PQgetisnull(res.get(), i, 7) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 7))},
      });
    }
  }
  json::array items;
  for (const auto &code : order) {
    const auto &acc = byCode.at(code);
    items.push_back(json::object{
        {"type_code", code},
        {"display_name", acc.displayName},
        {"description", acc.description},
        {"parameters", acc.parameters},
    });
  }
  return makeJsonResponse(http::status::ok, json::object{{"sensor_types", items}});
}

// PUT /api/mining/sensor-types/{type_code}/parameters -- upsert/enable-disable
// de la plantilla de parámetros de un tipo. Gateado por `formula.edit`: es el
// "admin de plataforma" que decide qué parámetros están disponibles por tipo,
// distinto de `dispositivos.manage` (que administra sensores individuales).
http::response<http::string_body>
handleUpdateSensorTypeParameters(const http::request<http::string_body> &req,
                                 const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "formula.edit")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "formula.edit"}});
  }
  std::string rawTarget(req.target());
  static const std::string kPrefix = "/api/mining/sensor-types/";
  std::string rest = rawTarget.substr(kPrefix.size());
  {
    auto q = rest.find('?');
    if (q != std::string::npos) rest = rest.substr(0, q);
  }
  static const std::string kSuffix = "/parameters";
  if (rest.size() <= kSuffix.size() || rest.compare(rest.size() - kSuffix.size(), kSuffix.size(), kSuffix) != 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  const std::string typeCode = rest.substr(0, rest.size() - kSuffix.size());
  if (typeCode.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_type_code"}});
  }

  json::value body;
  try { body = json::parse(req.body()); } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object() || !body.as_object().if_contains("parameters") ||
      !body.as_object().at("parameters").is_array()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "parameters_array_required"}});
  }

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  const std::string displayName = typeCode;
  const char *typeParams[2] = {typeCode.c_str(), displayName.c_str()};
  PQexecParams(conn,
      "INSERT INTO sensor_type_def (type_code, display_name) VALUES ($1, $2) "
      "ON CONFLICT (type_code) DO NOTHING",
      2, nullptr, typeParams, nullptr, nullptr, 0);

  int count = 0;
  for (const auto &entry : body.as_object().at("parameters").as_array()) {
    if (!entry.is_object()) continue;
    const auto &eo = entry.as_object();
    if (!eo.if_contains("param_key")) continue;
    const auto &pkVal = eo.at("param_key");
    const std::string paramKey = pkVal.is_string() ? std::string(pkVal.as_string()) : std::string();
    if (paramKey.empty()) continue;

    const std::string dataType = eo.if_contains("data_type") && eo.at("data_type").is_string()
        ? std::string(eo.at("data_type").as_string()) : std::string("numeric");
    const bool enabled = !eo.if_contains("is_enabled") ||
        (eo.at("is_enabled").is_bool() && eo.at("is_enabled").as_bool());
    const int sortOrder = eo.if_contains("sort_order") && eo.at("sort_order").is_int64()
        ? static_cast<int>(eo.at("sort_order").as_int64()) : 0;
    const std::string sortOrderStr = std::to_string(sortOrder);

    const char *p[6] = {typeCode.c_str(), paramKey.c_str(), dataType.c_str(),
                        enabled ? "true" : "false", sortOrderStr.c_str(),
                        session->userId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "INSERT INTO sensor_type_parameter_def "
        "(type_code, param_key, data_type, is_enabled, sort_order, updated_by) "
        "VALUES ($1, $2, $3, $4::boolean, $5::int, $6::uuid) "
        "ON CONFLICT (type_code, param_key) DO UPDATE SET "
        "data_type = EXCLUDED.data_type, is_enabled = EXCLUDED.is_enabled, "
        "sort_order = EXCLUDED.sort_order, updated_at = NOW(), updated_by = EXCLUDED.updated_by",
        6, nullptr, p, nullptr, nullptr, 0)};
    if (res.okCommand()) ++count;
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}, {"count", count}});
}

#endif // HAS_LIBPQ

} // namespace

void registerSensorTypeCatalogRoutes(router::Router &r) {
#if HAS_LIBPQ
  r.get("/api/mining/sensor-types", handleListSensorTypes);
  r.put("/api/mining/sensor-types/", handleUpdateSensorTypeParameters);
#endif
}

} // namespace mining_iot
