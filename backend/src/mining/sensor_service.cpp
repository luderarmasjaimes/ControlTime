#include "sensor_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

#include <mutex>
#include <string>

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using auth::extractAuthTokenFromRequest;
using auth::AuthSession;
using auth::gAuthMutex;
using auth::gAuthSessions;
using auth::pqEscapeLiteral;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl     AppConfig::instance().gDatabaseUrl

namespace mining {

http::response<http::string_body>
handleGetSensorData(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
  // --- SECURITY VALIDATION: Prevent IDOR (Insecure Direct Object Reference) ---
  std::string token = extractAuthTokenFromRequest(req, query);
  AuthSession* session = nullptr;
  {
    std::lock_guard<std::mutex> lock(gAuthMutex);
    if (auto it = gAuthSessions.find(token); it != gAuthSessions.end()) {
      session = &it->second;
    }
  }
  const auto itTenant = query.find("tenant_id");
  const bool scoped = itTenant != query.end() && !itTenant->second.empty();
  if (scoped && session == nullptr) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "Auth token required for tenant-scoped requests"}});
  }
  // --- END SECURITY VALIDATION ---

  json::object data;
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
    if (PQstatus(conn) == CONNECTION_OK) {
      const auto itTenant = query.find("tenant_id");
      const bool scoped = itTenant != query.end() && !itTenant->second.empty();
      std::string scopeWhere;
      std::string scopeTenantLit;
      if (scoped) {
        try {
          scopeTenantLit = pqEscapeLiteral(conn, itTenant->second);
          scopeWhere = std::string(" AND s.tenant_id = ") + scopeTenantLit + "::uuid ";
        } catch (...) {
          PQfinish(conn);
          return makeJsonResponse(http::status::bad_request,
                                  json::object{{"error", "invalid_scope_params"}});
        }
      }

      const std::string sqlCategories =
          scoped ? ("SELECT DISTINCT c.id, c.name, c.description FROM mining_sensor_categories c "
                    "INNER JOIN mining_sensor_types t ON t.category_id = c.id "
                    "INNER JOIN mining_sensors s ON s.type_id = t.id "
                    "WHERE 1=1 " +
                    scopeWhere + "ORDER BY c.id ASC")
                 : "SELECT id, name, description FROM mining_sensor_categories ORDER BY id ASC";
      const std::string sqlTypes =
          scoped ? ("SELECT DISTINCT t.id, t.category_id, t.name, t.unit FROM mining_sensor_types t "
                    "INNER JOIN mining_sensors s ON s.type_id = t.id "
                    "WHERE 1=1 " +
                    scopeWhere + "ORDER BY t.id ASC")
                 : "SELECT id, category_id, name, unit FROM mining_sensor_types ORDER BY id ASC";
      const std::string sqlSensors =
          scoped ? ("SELECT s.id, s.type_id, s.name, s.lat, s.lng, s.status, s.current_value, "
                    "s.tenant_id::text AS tenant_id_txt, "
                    "z.id AS zone_pk, z.code AS zone_code, z.name_es AS zone_name_es "
                    "FROM mining_sensors s "
                    "LEFT JOIN mining_sensor_zones z ON z.id = s.zone_id AND "
                    "z.tenant_id = s.tenant_id "
                    "WHERE 1=1 " +
                    scopeWhere + "ORDER BY s.id ASC")
                 : "SELECT s.id, s.type_id, s.name, s.lat, s.lng, s.status, s.current_value, "
                   "s.tenant_id::text AS tenant_id_txt, "
                   "z.id AS zone_pk, z.code AS zone_code, z.name_es AS zone_name_es "
                   "FROM mining_sensors s "
                   "LEFT JOIN mining_sensor_zones z ON z.id = s.zone_id AND "
                   "z.tenant_id = s.tenant_id "
                   "ORDER BY s.id ASC";
      const std::string sqlHistory =
          scoped ? ("SELECT h.sensor_id, h.value, h.timestamp FROM mining_sensor_history h "
                    "INNER JOIN mining_sensors s ON s.id = h.sensor_id "
                    "WHERE h.timestamp > NOW() - INTERVAL '7 DAYS' " +
                    scopeWhere + "ORDER BY h.sensor_id ASC, h.timestamp ASC")
                 : "SELECT sensor_id, value, timestamp FROM mining_sensor_history WHERE timestamp > "
                   "NOW() - INTERVAL '7 DAYS' ORDER BY sensor_id ASC, timestamp ASC";

      PGresult *res_cat = PQexec(conn, sqlCategories.c_str());
      json::array categories;
      if (res_cat && PQresultStatus(res_cat) == PGRES_TUPLES_OK) {
        for (int i = 0; i < PQntuples(res_cat); ++i) {
          categories.push_back(json::object{{"id", std::stoi(PQgetvalue(res_cat, i, 0))},
                                            {"name", PQgetvalue(res_cat, i, 1)},
                                            {"description", PQgetvalue(res_cat, i, 2)}});
        }
      }
      if (res_cat) PQclear(res_cat);
      data["categories"] = categories;

      const std::string sqlZones =
          scoped ? ("SELECT id, code, name_es, sort_order, tenant_id::text FROM mining_sensor_zones "
                    "WHERE tenant_id = " +
                    scopeTenantLit + "::uuid ORDER BY sort_order ASC, id ASC")
                 : ("SELECT id, code, name_es, sort_order, tenant_id::text FROM mining_sensor_zones "
                    "ORDER BY tenant_id ASC, sort_order ASC, id ASC");
      PGresult *res_zones = PQexec(conn, sqlZones.c_str());
      json::array zones;
      if (res_zones && PQresultStatus(res_zones) == PGRES_TUPLES_OK) {
        for (int zi = 0; zi < PQntuples(res_zones); ++zi) {
          zones.push_back(json::object{{"id", std::stoi(PQgetvalue(res_zones, zi, 0))},
                                        {"code", PQgetvalue(res_zones, zi, 1)},
                                        {"name_es", PQgetvalue(res_zones, zi, 2)},
                                        {"sort_order", std::stoi(PQgetvalue(res_zones, zi, 3))},
                                        {"tenant_id", PQgetvalue(res_zones, zi, 4)}});
        }
      }
      if (res_zones) PQclear(res_zones);
      data["zones"] = zones;

      PGresult *res_types = PQexec(conn, sqlTypes.c_str());
      json::array sensor_types;
      if (res_types && PQresultStatus(res_types) == PGRES_TUPLES_OK) {
        for (int i = 0; i < PQntuples(res_types); ++i) {
          sensor_types.push_back(
              json::object{{"id", std::stoi(PQgetvalue(res_types, i, 0))},
                           {"category_id", std::stoi(PQgetvalue(res_types, i, 1))},
                           {"name", PQgetvalue(res_types, i, 2)},
                           {"unit", PQgetvalue(res_types, i, 3)}});
        }
      }
      if (res_types) PQclear(res_types);
      data["sensor_types"] = sensor_types;

      PGresult *res_sensors = PQexec(conn, sqlSensors.c_str());
      json::array sensors;
      if (res_sensors && PQresultStatus(res_sensors) == PGRES_TUPLES_OK) {
        for (int i = 0; i < PQntuples(res_sensors); ++i) {
          json::object so{{"id", std::stoi(PQgetvalue(res_sensors, i, 0))},
                          {"type_id", std::stoi(PQgetvalue(res_sensors, i, 1))},
                          {"name", PQgetvalue(res_sensors, i, 2)},
                          {"lat", std::stod(PQgetvalue(res_sensors, i, 3))},
                          {"lng", std::stod(PQgetvalue(res_sensors, i, 4))},
                          {"status", PQgetvalue(res_sensors, i, 5)},
                          {"current_value", std::stod(PQgetvalue(res_sensors, i, 6))},
                          {"tenant_id", PQgetvalue(res_sensors, i, 7)}};
          if (!PQgetisnull(res_sensors, i, 8)) {
            so["zone_id"] = std::stoi(PQgetvalue(res_sensors, i, 8));
            so["zone_code"] = std::string(PQgetvalue(res_sensors, i, 9));
            so["zone_name"] = std::string(PQgetvalue(res_sensors, i, 10));
          }
          sensors.push_back(so);
        }
      }
      if (res_sensors) PQclear(res_sensors);
      data["sensors"] = sensors;

      PGresult *res_history = PQexec(conn, sqlHistory.c_str());
      json::array history;
      if (res_history && PQresultStatus(res_history) == PGRES_TUPLES_OK) {
        for (int i = 0; i < PQntuples(res_history); ++i) {
          history.push_back(json::object{
              {"sensor_id", std::stoi(PQgetvalue(res_history, i, 0))},
              {"value", std::stod(PQgetvalue(res_history, i, 1))},
              {"timestamp", PQgetvalue(res_history, i, 2)}});
        }
      }
      if (res_history) PQclear(res_history);
      data["history"] = history;

      PQfinish(conn);
      return makeJsonResponse(http::status::ok, data);
    }
    PQfinish(conn);
#endif
  }
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
}

} // namespace mining
