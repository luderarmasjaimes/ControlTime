#include "sensor_telemetry_wizard.hpp"
#include "sensor_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"

#include <cctype>
#include <string>
#include <vector>

// HAS_LIBPQ no se propaga entre translation units (se define localmente por
// archivo, ver el mismo bloque en auth_storage_pg.hpp / device_alarm_routes.cpp).
#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using http_utils::safeStod;
using http_utils::safeStoi;
using http_utils::splitCsvLower;
using auth::resolveAuthSession;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gReadUrl         AppConfig::instance().readUrl()

namespace mining {

namespace {

// Construye el literal de arreglo Postgres `{a,b,c}` a partir de una lista
// de UUIDs ya validados con formato básico (36 chars, hex + guiones) —
// valores que no calzan ese formato se descartan en vez de romper el
// literal (nunca se concatenan directo en el SQL: solo entran como texto
// de un único bind param `$N::uuid[]`, así que no hay superficie de
// inyección, pero sí queremos evitar que un valor absurdo tumbe la query
// entera con un error de cast).
bool looksLikeUuid(const std::string &s) {
  if (s.size() != 36) return false;
  for (size_t i = 0; i < s.size(); ++i) {
    const char c = s[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else if (!std::isxdigit(static_cast<unsigned char>(c))) {
      return false;
    }
  }
  return true;
}

std::string toPgUuidArrayLiteral(const std::vector<std::string> &ids) {
  std::string out = "{";
  bool first = true;
  for (const auto &id : ids) {
    if (!looksLikeUuid(id)) continue;
    if (!first) out += ",";
    out += id;
    first = false;
  }
  out += "}";
  return out;
}

}  // namespace

http::response<http::string_body>
handleGetTelemetryWizardCatalog(const http::request<http::string_body>& req,
                                const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session.has_value()) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  bool tenantOk = true;
  const std::string effectiveTenant = resolveAllowedSensorTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }

  std::string sensorTypeFilter;
  const auto itType = query.find("sensor_type");
  if (itType != query.end()) sensorTypeFilter = itType->second;

  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  // --- Paso 1 del wizard: tipos de sensor disponibles para el tenant ---
  const std::string sqlTypes =
      "SELECT sensor_type, COALESCE(unit,'') AS unit, COUNT(*) AS n "
      "FROM sensors "
      "WHERE tenant_id = $1::uuid AND is_active AND sensor_type <> 'load_test' "
      "GROUP BY sensor_type, unit ORDER BY sensor_type ASC, unit ASC";
  {
    const char *p[1] = {effectiveTenant.c_str()};
    storage::PgResult res{PQexecParams(conn, sqlTypes.c_str(), 1, nullptr, p, nullptr, nullptr, 0)};
    if (!res.okTuples()) {
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "query_failed"}});
    }
    json::array sensorTypes;
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      sensorTypes.push_back(json::object{
          {"type", PQgetvalue(res.get(), i, 0)},
          {"unit", PQgetvalue(res.get(), i, 1)},
          {"count", safeStoi(PQgetvalue(res.get(), i, 2))}});
    }

    // --- Zonas geográficas del tenant (db_scripts/54) ---
    const std::string sqlZones =
        "SELECT zone_id, code, name_es, sort_order FROM sensor_zones "
        "WHERE tenant_id = $1::uuid ORDER BY sort_order ASC, zone_id ASC";
    storage::PgResult resZones{PQexecParams(conn, sqlZones.c_str(), 1, nullptr, p, nullptr, nullptr, 0)};
    json::array zones;
    if (resZones.okTuples()) {
      for (int i = 0; i < PQntuples(resZones.get()); ++i) {
        zones.push_back(json::object{
            {"id", safeStoi(PQgetvalue(resZones.get(), i, 0))},
            {"code", PQgetvalue(resZones.get(), i, 1)},
            {"name_es", PQgetvalue(resZones.get(), i, 2)},
            {"sort_order", safeStoi(PQgetvalue(resZones.get(), i, 3))}});
      }
    }

    json::array sensorsArr;
    // --- Paso 2/3: sensores del tipo elegido, agrupados por zona +
    //     device_key (dispositivo físico) para el árbol zona→dispositivo→unidad.
    if (!sensorTypeFilter.empty()) {
      const std::string sqlSensors =
          "SELECT s.sensor_id::text, s.sensor_code, s.sensor_name, s.sensor_type, "
          "COALESCE(s.unit,'') AS unit, s.zone_id, COALESCE(z.code,''), COALESCE(z.name_es,''), "
          "COALESCE(NULLIF(s.serial_number,''), NULLIF(s.external_id,''), s.sensor_code) AS device_key, "
          "s.lat, s.lng, COALESCE(s.connection_status,'') "
          "FROM sensors s "
          "LEFT JOIN sensor_zones z ON z.zone_id = s.zone_id "
          "WHERE s.tenant_id = $1::uuid AND s.is_active AND s.sensor_type = $2 "
          "ORDER BY z.sort_order ASC NULLS LAST, device_key ASC, s.sensor_code ASC";
      const char *ps[2] = {effectiveTenant.c_str(), sensorTypeFilter.c_str()};
      storage::PgResult resSensors{
          PQexecParams(conn, sqlSensors.c_str(), 2, nullptr, ps, nullptr, nullptr, 0)};
      if (resSensors.okTuples()) {
        for (int i = 0; i < PQntuples(resSensors.get()); ++i) {
          json::object so{
              {"id", PQgetvalue(resSensors.get(), i, 0)},
              {"code", PQgetvalue(resSensors.get(), i, 1)},
              {"name", PQgetvalue(resSensors.get(), i, 2)},
              {"type", PQgetvalue(resSensors.get(), i, 3)},
              {"unit", PQgetvalue(resSensors.get(), i, 4)},
              {"zone_code", PQgetvalue(resSensors.get(), i, 6)},
              {"zone_name", PQgetvalue(resSensors.get(), i, 7)},
              {"device_key", PQgetvalue(resSensors.get(), i, 8)},
              {"connection_status", PQgetvalue(resSensors.get(), i, 11)}};
          if (!PQgetisnull(resSensors.get(), i, 5)) {
            so["zone_id"] = safeStoi(PQgetvalue(resSensors.get(), i, 5));
          }
          if (!PQgetisnull(resSensors.get(), i, 9)) so["lat"] = safeStod(PQgetvalue(resSensors.get(), i, 9));
          if (!PQgetisnull(resSensors.get(), i, 10)) so["lng"] = safeStod(PQgetvalue(resSensors.get(), i, 10));
          sensorsArr.push_back(so);
        }
      }
    }

    return makeJsonResponse(http::status::ok, json::object{
        {"sensor_types", sensorTypes}, {"zones", zones}, {"sensors", sensorsArr}});
  }
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleQueryTelemetrySeries(const http::request<http::string_body>& req,
                           const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session.has_value()) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  bool tenantOk = true;
  const std::string effectiveTenant = resolveAllowedSensorTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }

  const auto itIds = query.find("sensor_ids");
  const auto itFrom = query.find("from");
  const auto itTo = query.find("to");
  if (itIds == query.end() || itIds->second.empty() ||
      itFrom == query.end() || itFrom->second.empty() ||
      itTo == query.end() || itTo->second.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "sensor_ids_from_to_required"}});
  }

  const std::vector<std::string> rawIds = splitCsvLower(itIds->second);
  if (rawIds.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "sensor_ids_required"}});
  }
  if (rawIds.size() > 50) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "too_many_sensors"}});
  }
  const std::string idsLiteral = toPgUuidArrayLiteral(rawIds);
  if (idsLiteral == "{}") {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "sensor_ids_invalid"}});
  }

  std::string agg = "hourly";
  const auto itAgg = query.find("agg");
  if (itAgg != query.end() &&
      (itAgg->second == "raw" || itAgg->second == "hourly" || itAgg->second == "daily")) {
    agg = itAgg->second;
  }

  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }

  // Valida el rango (from < to, <= 90 días) reutilizando el mismo cast que
  // usará la query principal — si `from`/`to` no son timestamps válidos,
  // esto falla con PGRES_FATAL_ERROR y se traduce en 400, sin llegar a la
  // query pesada sobre telemetry_raw.
  const std::string sqlValidate =
      "SELECT ($2::timestamptz < $1::timestamptz) AS inverted, "
      "EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 86400.0 AS span_days";
  const char *pv[2] = {itFrom->second.c_str(), itTo->second.c_str()};
  storage::PgResult resValidate{
      PQexecParams(conn, sqlValidate.c_str(), 2, nullptr, pv, nullptr, nullptr, 0)};
  if (!resValidate.okTuples() || PQntuples(resValidate.get()) != 1) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_from_to"}});
  }
  const bool inverted = std::string(PQgetvalue(resValidate.get(), 0, 0)) == "t";
  const double spanDays = safeStod(PQgetvalue(resValidate.get(), 0, 1));
  if (inverted) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "from_after_to"}});
  }
  if (spanDays > 90.0) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "range_too_wide_max_90_days"}});
  }
  // Rango histórico crudo demasiado amplio: degrada a promedio horario para
  // no devolver un payload desproporcionado (mismo espíritu que el tope de
  // handleGetTelemetrySummary sobre la ventana en horas).
  if (agg == "raw" && spanDays > 7.0) {
    agg = "hourly";
  }

  const std::string tenantVal = effectiveTenant;
  const char *ps[4] = {tenantVal.c_str(), idsLiteral.c_str(), itFrom->second.c_str(), itTo->second.c_str()};

  // ADR-131: telemetry_raw -> telemetry_fact (vía dim_sensor/dim_tenant).
  // hourly/daily leen directo de telemetry_fact_hourly/_daily (ya
  // materializados por TimescaleDB) en vez de GROUP BY date_trunc sobre la
  // hypertable cruda -- la agregación ya está pagada. "raw" (acotado a <=7
  // días por el degrade de arriba) sigue siendo resolución exacta sobre
  // telemetry_fact.
  const std::string sqlSeries =
      agg == "raw"
          ? ("SELECT ds.sensor_id::text, tf.captured_at::text AS t, tf.value_numeric AS v "
             "FROM telemetry_fact tf "
             "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
             "WHERE tf.tenant_id_sk = (SELECT tenant_id_sk FROM dim_tenant WHERE tenant_id = $1::uuid) "
             "AND ds.sensor_id = ANY($2::uuid[]) AND tf.channel_id = 0 "
             "AND tf.captured_at >= $3::timestamptz AND tf.captured_at <= $4::timestamptz "
             "ORDER BY ds.sensor_id ASC, tf.captured_at ASC")
          : ("SELECT ds.sensor_id::text, h.bucket::text AS t, h.avg_value AS v "
             "FROM telemetry_fact_" + (agg == "daily" ? std::string("daily") : std::string("hourly")) + " h "
             "JOIN dim_sensor ds ON ds.sensor_id_sk = h.sensor_id_sk "
             "WHERE h.tenant_id_sk = (SELECT tenant_id_sk FROM dim_tenant WHERE tenant_id = $1::uuid) "
             "AND ds.sensor_id = ANY($2::uuid[]) AND h.channel_id = 0 "
             "AND h.bucket >= $3::timestamptz AND h.bucket <= $4::timestamptz "
             "ORDER BY ds.sensor_id ASC, h.bucket ASC");

  storage::PgResult resSeries{PQexecParams(conn, sqlSeries.c_str(), 4, nullptr, ps, nullptr, nullptr, 0)};
  if (!resSeries.okTuples()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "query_failed"}});
  }
  json::array series;
  for (int i = 0; i < PQntuples(resSeries.get()); ++i) {
    if (PQgetisnull(resSeries.get(), i, 2)) continue;
    series.push_back(json::object{
        {"sensor_id", PQgetvalue(resSeries.get(), i, 0)},
        {"t", PQgetvalue(resSeries.get(), i, 1)},
        {"v", safeStod(PQgetvalue(resSeries.get(), i, 2))}});
  }

  const char *pm[2] = {tenantVal.c_str(), idsLiteral.c_str()};
  const std::string sqlMeta =
      "SELECT s.sensor_id::text, s.sensor_code, s.sensor_name, COALESCE(s.unit,''), s.sensor_type, "
      "COALESCE(NULLIF(s.serial_number,''), NULLIF(s.external_id,''), s.sensor_code) AS device_key "
      "FROM sensors s WHERE s.tenant_id = $1::uuid AND s.sensor_id = ANY($2::uuid[])";
  storage::PgResult resMeta{PQexecParams(conn, sqlMeta.c_str(), 2, nullptr, pm, nullptr, nullptr, 0)};
  json::array sensorsArr;
  if (resMeta.okTuples()) {
    for (int i = 0; i < PQntuples(resMeta.get()); ++i) {
      sensorsArr.push_back(json::object{
          {"id", PQgetvalue(resMeta.get(), i, 0)},
          {"code", PQgetvalue(resMeta.get(), i, 1)},
          {"name", PQgetvalue(resMeta.get(), i, 2)},
          {"unit", PQgetvalue(resMeta.get(), i, 3)},
          {"type", PQgetvalue(resMeta.get(), i, 4)},
          {"device_key", PQgetvalue(resMeta.get(), i, 5)}});
    }
  }

  return makeJsonResponse(http::status::ok, json::object{
      {"sensors", sensorsArr}, {"series", series},
      {"from", itFrom->second}, {"to", itTo->second}, {"agg", agg}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace mining
