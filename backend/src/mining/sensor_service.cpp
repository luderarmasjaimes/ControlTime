#include "sensor_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

#include <mutex>
#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using auth::extractAuthTokenFromRequest;
using auth::AuthSession;
using auth::gAuthMutex;
using auth::gAuthSessions;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl     AppConfig::instance().gDatabaseUrl
// Lecturas de sensores (dashboard) → réplica read-only si está configurada.
#define gReadUrl         AppConfig::instance().readUrl()

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
    // Lectura de sensores para dashboard → pool de RÉPLICA (offload primario).
    auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      const auto itTenant = query.find("tenant_id");
      const bool scoped = itTenant != query.end() && !itTenant->second.empty();
      // Filtro por tenant como parámetro $1 (reutilizado en cada query scoped).
      const std::string tenantVal = scoped ? itTenant->second : std::string();
      const std::string scopeWhere =
          scoped ? " AND s.tenant_id = $1::uuid " : std::string();
      // Ejecuta una query pasando el tenant como $1 cuando hay scope.
      const auto runScoped = [&](const std::string &q) -> PGresult * {
        if (scoped) {
          const char *p[1] = {tenantVal.c_str()};
          return PQexecParams(conn, q.c_str(), 1, nullptr, p, nullptr, nullptr,
                              0);
        }
        return PQexec(conn, q.c_str());
      };

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

      storage::PgResult res_cat{runScoped(sqlCategories)};
      json::array categories;
      if (res_cat.okTuples()) {
        for (int i = 0; i < PQntuples(res_cat.get()); ++i) {
          categories.push_back(json::object{{"id", std::stoi(PQgetvalue(res_cat.get(), i, 0))},
                                            {"name", PQgetvalue(res_cat.get(), i, 1)},
                                            {"description", PQgetvalue(res_cat.get(), i, 2)}});
        }
      }
      data["categories"] = categories;

      const std::string sqlZones =
          scoped ? ("SELECT id, code, name_es, sort_order, tenant_id::text FROM mining_sensor_zones "
                    "WHERE tenant_id = $1::uuid ORDER BY sort_order ASC, id ASC")
                 : ("SELECT id, code, name_es, sort_order, tenant_id::text FROM mining_sensor_zones "
                    "ORDER BY tenant_id ASC, sort_order ASC, id ASC");
      storage::PgResult res_zones{runScoped(sqlZones)};
      json::array zones;
      if (res_zones.okTuples()) {
        for (int zi = 0; zi < PQntuples(res_zones.get()); ++zi) {
          zones.push_back(json::object{{"id", std::stoi(PQgetvalue(res_zones.get(), zi, 0))},
                                        {"code", PQgetvalue(res_zones.get(), zi, 1)},
                                        {"name_es", PQgetvalue(res_zones.get(), zi, 2)},
                                        {"sort_order", std::stoi(PQgetvalue(res_zones.get(), zi, 3))},
                                        {"tenant_id", PQgetvalue(res_zones.get(), zi, 4)}});
        }
      }
      data["zones"] = zones;

      storage::PgResult res_types{runScoped(sqlTypes)};
      json::array sensor_types;
      if (res_types.okTuples()) {
        for (int i = 0; i < PQntuples(res_types.get()); ++i) {
          sensor_types.push_back(
              json::object{{"id", std::stoi(PQgetvalue(res_types.get(), i, 0))},
                           {"category_id", std::stoi(PQgetvalue(res_types.get(), i, 1))},
                           {"name", PQgetvalue(res_types.get(), i, 2)},
                           {"unit", PQgetvalue(res_types.get(), i, 3)}});
        }
      }
      data["sensor_types"] = sensor_types;

      storage::PgResult res_sensors{runScoped(sqlSensors)};
      json::array sensors;
      if (res_sensors.okTuples()) {
        for (int i = 0; i < PQntuples(res_sensors.get()); ++i) {
          json::object so{{"id", std::stoi(PQgetvalue(res_sensors.get(), i, 0))},
                          {"type_id", std::stoi(PQgetvalue(res_sensors.get(), i, 1))},
                          {"name", PQgetvalue(res_sensors.get(), i, 2)},
                          {"lat", std::stod(PQgetvalue(res_sensors.get(), i, 3))},
                          {"lng", std::stod(PQgetvalue(res_sensors.get(), i, 4))},
                          {"status", PQgetvalue(res_sensors.get(), i, 5)},
                          {"current_value", std::stod(PQgetvalue(res_sensors.get(), i, 6))},
                          {"tenant_id", PQgetvalue(res_sensors.get(), i, 7)}};
          if (!PQgetisnull(res_sensors.get(), i, 8)) {
            so["zone_id"] = std::stoi(PQgetvalue(res_sensors.get(), i, 8));
            so["zone_code"] = std::string(PQgetvalue(res_sensors.get(), i, 9));
            so["zone_name"] = std::string(PQgetvalue(res_sensors.get(), i, 10));
          }
          sensors.push_back(so);
        }
      }
      data["sensors"] = sensors;

      storage::PgResult res_history{runScoped(sqlHistory)};
      json::array history;
      if (res_history.okTuples()) {
        for (int i = 0; i < PQntuples(res_history.get()); ++i) {
          history.push_back(json::object{
              {"sensor_id", std::stoi(PQgetvalue(res_history.get(), i, 0))},
              {"value", std::stod(PQgetvalue(res_history.get(), i, 1))},
              {"timestamp", PQgetvalue(res_history.get(), i, 2)}});
        }
      }
      data["history"] = history;

      return makeJsonResponse(http::status::ok, data);
    }
#endif
  }
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
}

} // namespace mining
