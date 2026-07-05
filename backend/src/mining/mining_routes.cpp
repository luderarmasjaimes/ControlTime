#include "mining_routes.hpp"
#include "kpi_service.hpp"
#include "sensor_service.hpp"
#include "surveillance_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

#include <algorithm>
#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl     AppConfig::instance().gDatabaseUrl

namespace mining {

// ── GET /api/dashboard/metrics ───────────────────────────────────────
static http::response<http::string_body>
handleDashboardMetrics(const http::request<http::string_body>& req,
                       const std::unordered_map<std::string, std::string>& query) {
  json::object metrics;
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    auto __pg_lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      storage::PgResult res_kpi{PQexec(conn, "SELECT name, value, unit, trend, trend_value FROM dashboard_kpis")};
      json::object kpis;
      if (res_kpi.okTuples()) {
          for (int i = 0; i < PQntuples(res_kpi.get()); ++i) {
              std::string name = PQgetvalue(res_kpi.get(), i, 0);
              kpis[name] = json::object{{"value", std::stod(PQgetvalue(res_kpi.get(), i, 1))}, {"unit", PQgetvalue(res_kpi.get(), i, 2)}, {"trend", PQgetvalue(res_kpi.get(), i, 3)}, {"trend_value", std::stod(PQgetvalue(res_kpi.get(), i, 4))}};
          }
      }
      metrics["kpis"] = kpis;

      storage::PgResult res_heat{PQexec(conn, "SELECT day, level_name, x_coord, y_coord, intensity FROM dashboard_heatmap ORDER BY day ASC")};
      json::array heatmap;
      if (res_heat.okTuples()) {
          for (int i = 0; i < PQntuples(res_heat.get()); ++i) {
              heatmap.push_back(json::object{{"day", std::stoi(PQgetvalue(res_heat.get(), i, 0))}, {"level", PQgetvalue(res_heat.get(), i, 1)}, {"x", std::stoi(PQgetvalue(res_heat.get(), i, 2))}, {"y", std::stoi(PQgetvalue(res_heat.get(), i, 3))}, {"val", std::stod(PQgetvalue(res_heat.get(), i, 4))}});
          }
      }
      metrics["heatmap"] = heatmap;
      return makeJsonResponse(http::status::ok, metrics);
    }
#endif
  }
  return makeJsonResponse(http::status::ok, metrics);
}

// ── GET /api/config/mining-locations ─────────────────────────────────
static http::response<http::string_body>
handleMiningLocations(const http::request<http::string_body>& req,
                      const std::unordered_map<std::string, std::string>& query) {
  json::array locations;
  locations.push_back(json::object{{"company_name", "Minera Antamina"}, {"latitude", -9.549}, {"longitude", -77.054}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Compania Minera Antamina"}, {"latitude", -9.549}, {"longitude", -77.054}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Sociedad Minera Cerro Verde"}, {"latitude", -16.536}, {"longitude", -71.583}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Minera Cerro Verde"}, {"latitude", -16.536}, {"longitude", -71.583}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Las Bambas"}, {"latitude", -14.156}, {"longitude", -72.333}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Southern Peru Copper Corporation"}, {"latitude", -17.246}, {"longitude", -70.612}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Yanacocha"}, {"latitude", -6.983}, {"longitude", -78.508}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Anglo American Quellaveco"}, {"latitude", -17.112}, {"longitude", -70.625}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Buenaventura"}, {"latitude", -12.115}, {"longitude", -76.995}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Chinalco Peru"}, {"latitude", -11.595}, {"longitude", -76.195}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Volcan"}, {"latitude", -10.68}, {"longitude", -76.25}, {"zoom", 14}});
  locations.push_back(json::object{{"company_name", "Raura"}, {"latitude", -10.45}, {"longitude", -76.75}, {"zoom", 14}});
  return makeJsonResponse(http::status::ok, locations);
}

void registerRoutes(router::Router& r) {
  r.get("/api/dashboard/metrics", handleDashboardMetrics);
  r.get("/api/config/mining-locations", handleMiningLocations);

  r.get("/api/mining/kpis", handleGetKpis);
  r.post("/api/mining/kpis/upsert", handleUpsertKpis);
  r.post("/api/mining/kpis/sync-from-dashboard", handleSyncFromDashboard);
  r.post("/api/mining/kpis/sync-from-external", handleSyncFromExternal);
  r.get("/api/mining/kpis/points", handleGetKpiPoints);

  r.get("/api/sensors/data", handleGetSensorData);

  r.get("/api/surveillance/cameras", handleGetCameras);
  r.get("/api/surveillance/camera-snapshot", handleCameraSnapshot);
  r.post("/api/surveillance/cameras", handleCreateCamera);
  // prefix routes for /api/surveillance/cameras/<id>
  r.put("/api/surveillance/cameras/", handleUpdateCamera);
  r.del("/api/surveillance/cameras/", handleDeleteCamera);
}

} // namespace mining
