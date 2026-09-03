#include "simulation_status_routes.hpp"
#include "sensor_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"

#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using http_utils::safeStod;
using http_utils::safeStoi;
using auth::resolveAuthSession;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
// Lectura de estado de simulación (dashboard) -> réplica read-only, igual que
// sensor_service.cpp.
#define gReadUrl AppConfig::instance().readUrl()

namespace mining {

http::response<http::string_body>
handleGetSimulationLiveStatus(const http::request<http::string_body>& req,
                              const std::unordered_map<std::string, std::string>& query) {
  // --- SECURITY: mismo guard anti-IDOR que handleGetSensorData/
  //     handleGetTelemetrySummary (sensor_service.cpp) -- sesión obligatoria,
  //     tenant efectivo derivado de la sesión, un tenant_id de query distinto
  //     sólo se acepta si userBelongsToTenant lo autoriza. ---
  const auto session = resolveAuthSession(req, query);
  if (!session.has_value()) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  bool tenantOk = true;
  const std::string effectiveTenant = resolveAllowedSensorTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }
  // --- END SECURITY ---

  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  const std::string tenantVal = effectiveTenant;
  const auto runScoped = [&](const std::string &q) -> PGresult * {
    const char *p[1] = {tenantVal.c_str()};
    return PQexecParams(conn, q.c_str(), 1, nullptr, p, nullptr, nullptr, 0);
  };

  // ADR-136: telemetry_fact/telemetry_fact_calc no tienen PK con
  // tenant_id_sk, se filtra vía JOIN a dim_tenant (mismo patrón que
  // sensor_service.cpp). NOTA de performance: COUNT(*) sobre telemetry_fact
  // sin filtro de tiempo escanea todos los chunks del tenant -- aceptable
  // hoy (retención de 190 días, volumen de este entorno muy por debajo de
  // los 25k/s de diseño, ADR-131) pero sería el primer punto a optimizar
  // (índice dedicado o continuous aggregate) si telemetry_fact crece a
  // escala de producción real.
  const std::string sqlRawCounts =
      "SELECT "
      "  COUNT(*) AS count_total, "
      "  COUNT(*) FILTER (WHERE tf.captured_at > NOW() - INTERVAL '1 hour') AS count_last_hour "
      "FROM telemetry_fact tf "
      "JOIN dim_tenant dt ON dt.tenant_id_sk = tf.tenant_id_sk "
      "WHERE dt.tenant_id = $1::uuid";

  const std::string sqlRawLatest =
      "SELECT ds.sensor_code, ds.sensor_type, tf.value_numeric, tf.captured_at::text "
      "FROM telemetry_fact tf "
      "JOIN dim_tenant dt ON dt.tenant_id_sk = tf.tenant_id_sk "
      "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
      "WHERE dt.tenant_id = $1::uuid "
      "ORDER BY tf.captured_at DESC LIMIT 20";

  const std::string sqlCalcCounts =
      "SELECT "
      "  COUNT(*) AS count_total, "
      "  COUNT(*) FILTER (WHERE tfc.captured_at > NOW() - INTERVAL '1 hour') AS count_last_hour "
      "FROM telemetry_fact_calc tfc "
      "JOIN dim_tenant dt ON dt.tenant_id_sk = tfc.tenant_id_sk "
      "WHERE dt.tenant_id = $1::uuid";

  const std::string sqlCalcLatest =
      "SELECT ds.sensor_code, tfc.metric_code, tfc.value_numeric, tfc.alert_level, tfc.captured_at::text "
      "FROM telemetry_fact_calc tfc "
      "JOIN dim_tenant dt ON dt.tenant_id_sk = tfc.tenant_id_sk "
      "JOIN dim_sensor ds ON ds.sensor_id_sk = tfc.sensor_id_sk "
      "WHERE dt.tenant_id = $1::uuid "
      "ORDER BY tfc.captured_at DESC LIMIT 20";

  json::object raw;
  {
    storage::PgResult resCounts{runScoped(sqlRawCounts)};
    int countTotal = 0, countLastHour = 0;
    if (resCounts.okTuples() && PQntuples(resCounts.get()) > 0) {
      countTotal = safeStoi(PQgetvalue(resCounts.get(), 0, 0));
      countLastHour = safeStoi(PQgetvalue(resCounts.get(), 0, 1));
    }
    raw["count_total"] = countTotal;
    raw["count_last_hour"] = countLastHour;

    storage::PgResult resLatest{runScoped(sqlRawLatest)};
    json::array latest;
    if (resLatest.okTuples()) {
      for (int i = 0; i < PQntuples(resLatest.get()); ++i) {
        json::object row{
            {"sensor_code", PQgetvalue(resLatest.get(), i, 0)},
            {"sensor_type", PQgetvalue(resLatest.get(), i, 1)},
            {"captured_at", PQgetvalue(resLatest.get(), i, 3)}};
        if (!PQgetisnull(resLatest.get(), i, 2)) {
          row["value_numeric"] = safeStod(PQgetvalue(resLatest.get(), i, 2));
        }
        latest.push_back(row);
      }
    }
    raw["latest"] = latest;
  }

  json::object calc;
  {
    storage::PgResult resCounts{runScoped(sqlCalcCounts)};
    int countTotal = 0, countLastHour = 0;
    if (resCounts.okTuples() && PQntuples(resCounts.get()) > 0) {
      countTotal = safeStoi(PQgetvalue(resCounts.get(), 0, 0));
      countLastHour = safeStoi(PQgetvalue(resCounts.get(), 0, 1));
    }
    calc["count_total"] = countTotal;
    calc["count_last_hour"] = countLastHour;

    storage::PgResult resLatest{runScoped(sqlCalcLatest)};
    json::array latest;
    if (resLatest.okTuples()) {
      for (int i = 0; i < PQntuples(resLatest.get()); ++i) {
        json::object row{
            {"sensor_code", PQgetvalue(resLatest.get(), i, 0)},
            {"metric_code", PQgetvalue(resLatest.get(), i, 1)},
            {"alert_level", PQgetvalue(resLatest.get(), i, 3)},
            {"captured_at", PQgetvalue(resLatest.get(), i, 4)}};
        if (!PQgetisnull(resLatest.get(), i, 2)) {
          row["value_numeric"] = safeStod(PQgetvalue(resLatest.get(), i, 2));
        }
        latest.push_back(row);
      }
    }
    calc["latest"] = latest;
  }

  json::object data{
      {"tenant_id", effectiveTenant},
      {"generated_at", http_utils::nowIso8601()},
      {"raw", raw},
      {"calc", calc}};

  return makeJsonResponse(http::status::ok, data);
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace mining
