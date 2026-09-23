#include "sensor_formula_routes.hpp"
#include "sensor_formula_diagram.hpp"
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

#include "tinyexpr.h"

#include <cstdlib>
#include <sstream>
#include <string>
#include <vector>

using http_utils::makeJsonResponse;
using config::AppConfig;

namespace mining_iot {

namespace {

std::string jsonToStringSafe(const json::value &v) {
  if (v.is_string()) return std::string(v.as_string());
  if (v.is_int64()) return std::to_string(v.as_int64());
  if (v.is_uint64()) return std::to_string(v.as_uint64());
  if (v.is_double()) return std::to_string(v.as_double());
  if (v.is_bool()) return v.as_bool() ? "true" : "false";
  return std::string();
}

bool jsonToDoubleSafe(const json::value &v, double &out) {
  if (v.is_double()) { out = v.as_double(); return true; }
  if (v.is_int64()) { out = static_cast<double>(v.as_int64()); return true; }
  if (v.is_uint64()) { out = static_cast<double>(v.as_uint64()); return true; }
  if (v.is_string()) {
    try { out = std::stod(std::string(v.as_string())); return true; }
    catch (...) { return false; }
  }
  return false;
}

#if HAS_LIBPQ

// IDOR: toda sub-ruta de sensor confirma primero que sensor_id pertenece al
// tenant de la sesión -- mismo criterio que handleUpdateDevice/
// handleRevokeDevice en device_alarm_routes.cpp (un sensor_id de otro
// tenant nunca matchea, sin distinguir "no existe" de "es de otro tenant").
bool sensorBelongsToTenant(PGconn *conn, const std::string &sensorId, const std::string &tenantId) {
  const char *p[2] = {sensorId.c_str(), tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "SELECT 1 FROM sensors WHERE sensor_id = $1::uuid AND tenant_id = $2::uuid",
      2, nullptr, p, nullptr, nullptr, 0)};
  return res.okTuples() && PQntuples(res.get()) > 0;
}

// Compila (sin evaluar) la expresión contra las variables que existirían en
// tiempo real para este sensor (canales de telemetría + parámetros
// numéricos, todos ligados a un doble dummy) -- falla exactamente igual que
// el evaluador fallaría más tarde, pero en el momento de guardar la fórmula
// (400, nunca llega a persistirse una fórmula que el poller no podría
// compilar). ADR-189: si el sensor declara sensor_input_channel_def
// (Freq/Temp/Press...) esos son los nombres de telemetría disponibles, igual
// que en sensor_formula_evaluator.cpp::loadNamedInputChannelsForSensors()
// (fix N+1: batcheada por ciclo, pero el mismo criterio por sensor); si no
// declara ninguno, sigue siendo la única variable `value` de siempre.
bool validateExpression(PGconn *conn, const std::string &sensorId,
                        const std::string &expression, std::string &errorDetail) {
  const char *p[1] = {sensorId.c_str()};
  std::vector<std::string> telemetryNames;
  storage::PgResult chRes{PQexecParams(
      conn,
      "SELECT channel_code FROM sensor_input_channel_def "
      "WHERE sensor_id = $1::uuid ORDER BY sort_order",
      1, nullptr, p, nullptr, nullptr, 0)};
  if (chRes.okTuples()) {
    for (int i = 0; i < PQntuples(chRes.get()); ++i) telemetryNames.push_back(PQgetvalue(chRes.get(), i, 0));
  }
  if (telemetryNames.empty()) telemetryNames.push_back("value");

  storage::PgResult res{PQexecParams(
      conn,
      "SELECT param_key FROM sensor_input_parameter_def "
      "WHERE sensor_id = $1::uuid AND data_type = 'numeric'",
      1, nullptr, p, nullptr, nullptr, 0)};
  std::vector<std::string> keys;
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) keys.push_back(PQgetvalue(res.get(), i, 0));
  }
  std::vector<double> dummy(telemetryNames.size() + keys.size(), 1.0);
  std::vector<te_variable> vars;
  for (std::size_t i = 0; i < telemetryNames.size(); ++i) {
    vars.push_back({telemetryNames[i].c_str(), &dummy[i], TE_VARIABLE, nullptr});
  }
  for (std::size_t i = 0; i < keys.size(); ++i) {
    vars.push_back({keys[i].c_str(), &dummy[telemetryNames.size() + i], TE_VARIABLE, nullptr});
  }
  int err = 0;
  te_expr *compiled = te_compile(expression.c_str(), vars.data(),
                                 static_cast<int>(vars.size()), &err);
  if (!compiled) {
    std::string avail;
    for (const auto &n : telemetryNames) { if (!avail.empty()) avail += ", "; avail += n; }
    for (const auto &k : keys) { avail += ", "; avail += k; }
    errorDetail = "La expresión no compiló (posición " + std::to_string(err) +
                  "). Variables disponibles: " + avail;
    return false;
  }
  te_free(compiled);
  return true;
}

json::object formulaRowToJson(PGresult *r, int i) {
  auto getOrNull = [&](int col) -> json::value {
    return PQgetisnull(r, i, col) ? json::value(nullptr) : json::value(std::atof(PQgetvalue(r, i, col)));
  };
  return json::object{
      {"formula_id", PQgetvalue(r, i, 0)},
      {"formula_name", PQgetvalue(r, i, 1)},
      {"expression", PQgetvalue(r, i, 2)},
      {"output_channel_code", PQgetvalue(r, i, 3)},
      {"output_unit", PQgetisnull(r, i, 4) ? json::value("") : json::value(PQgetvalue(r, i, 4))},
      {"warning_low", getOrNull(5)},
      {"warning_high", getOrNull(6)},
      {"error_low", getOrNull(7)},
      {"error_high", getOrNull(8)},
      {"enabled", std::string(PQgetvalue(r, i, 9)) == "t"},
      {"created_at", PQgetvalue(r, i, 10)},
      {"updated_at", PQgetvalue(r, i, 11)},
  };
}

// ---------------------------------------------------------------------------
// GET .../{id}/parameters | .../{id}/formulas | .../{id}/formula-results
// ---------------------------------------------------------------------------
http::response<http::string_body>
handleGetDeviceSubResource(const http::request<http::string_body> &req,
                           const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  std::string rawTarget(req.target());
  static const std::string kPrefix = "/api/mining/devices/";
  std::string rest = rawTarget.substr(kPrefix.size());
  {
    auto q = rest.find('?');
    if (q != std::string::npos) rest = rest.substr(0, q);
  }
  const auto slash = rest.find('/');
  if (slash == std::string::npos) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  const std::string sensorId = rest.substr(0, slash);
  const std::string subpath = rest.substr(slash + 1);

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  if (!sensorBelongsToTenant(conn, sensorId, session->tenantId)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "device_not_found"}});
  }

  if (subpath == "parameters") {
    const char *p[1] = {sensorId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT d.param_key, d.data_type, d.default_value, d.is_required, "
        "d.sort_order, d.description_key, v.value "
        "FROM sensor_input_parameter_def d "
        "LEFT JOIN sensor_input_parameter_value v "
        "  ON v.sensor_id = d.sensor_id AND v.param_key = d.param_key "
        "WHERE d.sensor_id = $1::uuid ORDER BY d.sort_order, d.param_key",
        1, nullptr, p, nullptr, nullptr, 0)};
    json::array items;
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        items.push_back(json::object{
            {"param_key", PQgetvalue(res.get(), i, 0)},
            {"data_type", PQgetvalue(res.get(), i, 1)},
            {"default_value", PQgetisnull(res.get(), i, 2) ? json::value(nullptr) : json::parse(PQgetvalue(res.get(), i, 2))},
            {"is_required", std::string(PQgetvalue(res.get(), i, 3)) == "t"},
            {"sort_order", std::atoi(PQgetvalue(res.get(), i, 4))},
            {"description_key", PQgetisnull(res.get(), i, 5) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 5))},
            {"value", PQgetisnull(res.get(), i, 6) ? json::value(nullptr) : json::parse(PQgetvalue(res.get(), i, 6))},
        });
      }
    }
    return makeJsonResponse(http::status::ok, json::object{{"parameters", items}});
  }

  // ADR-189: canales de entrada crudos ya declarados para este sensor
  // (Freq/Temp/Press...) -- expuesto para que el frontend sepa, al reabrir
  // la pestaña de fórmulas en cualquier sesión futura, si corresponde
  // ofrecer "probar con datos reales" sin depender de un estado efímero que
  // solo existía justo después de aplicar una plantilla.
  if (subpath == "input-channels") {
    const char *p[1] = {sensorId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT channel_code FROM sensor_input_channel_def "
        "WHERE sensor_id = $1::uuid ORDER BY sort_order",
        1, nullptr, p, nullptr, nullptr, 0)};
    json::array items;
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) items.push_back(json::value(PQgetvalue(res.get(), i, 0)));
    }
    return makeJsonResponse(http::status::ok, json::object{{"channels", items}});
  }

  if (subpath == "formulas") {
    const char *p[1] = {sensorId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT f.formula_id::text, f.formula_name, f.expression, f.output_channel_code, "
        "c.unit, f.warning_low, f.warning_high, f.error_low, f.error_high, "
        "f.enabled, f.created_at::text, f.updated_at::text "
        "FROM sensor_formula_def f "
        "LEFT JOIN sensor_output_channel_def c "
        "  ON c.sensor_id = f.sensor_id AND c.channel_code = f.output_channel_code "
        "WHERE f.sensor_id = $1::uuid ORDER BY f.formula_name",
        1, nullptr, p, nullptr, nullptr, 0)};
    json::array items;
    if (res.okTuples()) {
      for (int i = 0; i < PQntuples(res.get()); ++i) items.push_back(formulaRowToJson(res.get(), i));
    }
    return makeJsonResponse(http::status::ok, json::object{{"formulas", items}});
  }

  if (subpath == "formula-results") {
    int limit = 50;
    if (auto it = query.find("limit"); it != query.end()) {
      try { limit = std::max(1, std::min(500, std::stoi(it->second))); } catch (...) {}
    }
    std::string channelFilter;
    if (auto it = query.find("channel"); it != query.end()) channelFilter = it->second;
    const std::string limitStr = std::to_string(limit);
    json::array items;
    // Ventana de 24h: mismo bugfix de ADR-186 (acotar captured_at para
    // constraint exclusion en TimescaleDB sobre telemetry_multivariate, que
    // sin cota fuerza al planner a considerar todos los chunks acumulados) --
    // mismo criterio ya usado para paneles de "últimos resultados" (no
    // historial completo) en sensor_service.cpp::handleGetTelemetrySummary y
    // simulation_status_routes.cpp. Este endpoint alimenta el panel de
    // resultados recientes de SensorManagementView.tsx (limit=20 por
    // defecto), no una vista de historial completo.
    if (channelFilter.empty()) {
      const char *p[2] = {sensorId.c_str(), limitStr.c_str()};
      storage::PgResult res{PQexecParams(
          conn,
          "SELECT channel_code, captured_at::text, value_numeric, status "
          "FROM telemetry_multivariate WHERE sensor_id = $1::uuid "
          "AND captured_at > NOW() - INTERVAL '24 hours' "
          "ORDER BY captured_at DESC LIMIT $2::int",
          2, nullptr, p, nullptr, nullptr, 0)};
      if (res.okTuples()) {
        for (int i = 0; i < PQntuples(res.get()); ++i) {
          items.push_back(json::object{
              {"channel_code", PQgetvalue(res.get(), i, 0)},
              {"captured_at", PQgetvalue(res.get(), i, 1)},
              {"value_numeric", PQgetisnull(res.get(), i, 2) ? json::value(nullptr) : json::value(std::atof(PQgetvalue(res.get(), i, 2)))},
              {"status", PQgetvalue(res.get(), i, 3)},
          });
        }
      }
    } else {
      const char *p[3] = {sensorId.c_str(), channelFilter.c_str(), limitStr.c_str()};
      storage::PgResult res{PQexecParams(
          conn,
          "SELECT channel_code, captured_at::text, value_numeric, status "
          "FROM telemetry_multivariate WHERE sensor_id = $1::uuid AND channel_code = $2 "
          "AND captured_at > NOW() - INTERVAL '24 hours' "
          "ORDER BY captured_at DESC LIMIT $3::int",
          3, nullptr, p, nullptr, nullptr, 0)};
      if (res.okTuples()) {
        for (int i = 0; i < PQntuples(res.get()); ++i) {
          items.push_back(json::object{
              {"channel_code", PQgetvalue(res.get(), i, 0)},
              {"captured_at", PQgetvalue(res.get(), i, 1)},
              {"value_numeric", PQgetisnull(res.get(), i, 2) ? json::value(nullptr) : json::value(std::atof(PQgetvalue(res.get(), i, 2)))},
              {"status", PQgetvalue(res.get(), i, 3)},
          });
        }
      }
    }
    return makeJsonResponse(http::status::ok, json::object{{"results", items}});
  }

  return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
}

// ---------------------------------------------------------------------------
// DELETE .../{id}/formulas/{formula_id}
// ---------------------------------------------------------------------------
http::response<http::string_body>
handleDeleteDeviceSubResource(const http::request<http::string_body> &req,
                              const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "dispositivos.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "dispositivos.manage"}});
  }
  std::string rawTarget(req.target());
  static const std::string kPrefix = "/api/mining/devices/";
  std::string rest = rawTarget.substr(kPrefix.size());
  {
    auto q = rest.find('?');
    if (q != std::string::npos) rest = rest.substr(0, q);
  }
  const auto slash = rest.find('/');
  if (slash == std::string::npos) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  const std::string sensorId = rest.substr(0, slash);
  const std::string subpath = rest.substr(slash + 1);
  static const std::string kFormulasPrefix = "formulas/";
  if (subpath.rfind(kFormulasPrefix, 0) != 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  const std::string formulaId = subpath.substr(kFormulasPrefix.size());

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const char *p[3] = {formulaId.c_str(), sensorId.c_str(), session->tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "DELETE FROM sensor_formula_def WHERE formula_id = $1::bigint "
      "AND sensor_id = $2::uuid AND tenant_id = $3::uuid",
      3, nullptr, p, nullptr, nullptr, 0)};
  const bool ok = res.okCommand() && std::string(PQcmdTuples(res.get())) != "0";
  if (!ok) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "formula_not_found"}});
  }
  try { deleteFormulaDiagram(conn, formulaId); } catch (...) {}
  return makeJsonResponse(http::status::ok, json::object{{"status", "deleted"}});
}

// ---------------------------------------------------------------------------
// GET /api/mining/formulas -- vista de nivel superior: TODAS las fórmulas
// del tenant en una sola consulta (sensor + fórmula + último resultado vía
// LATERAL join), para no tener que entrar sensor por sensor a
// SensorManagementView. Ruta exacta (no prefijo) -- sin colisión posible
// con /api/mining/devices/.
// ---------------------------------------------------------------------------
http::response<http::string_body>
handleListAllFormulas(const http::request<http::string_body> &req,
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
  const char *p[1] = {session->tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT f.formula_id::text, f.sensor_id::text, s.sensor_code, s.sensor_name, "
      "f.formula_name, f.expression, f.output_channel_code, c.unit, "
      "f.warning_low, f.warning_high, f.error_low, f.error_high, f.enabled, "
      "r.value_numeric, r.status, r.captured_at::text "
      "FROM sensor_formula_def f "
      "JOIN sensors s ON s.sensor_id = f.sensor_id "
      "LEFT JOIN sensor_output_channel_def c "
      "  ON c.sensor_id = f.sensor_id AND c.channel_code = f.output_channel_code "
      "LEFT JOIN LATERAL ( "
      "  SELECT value_numeric, status, captured_at FROM telemetry_multivariate tm "
      "  WHERE tm.sensor_id = f.sensor_id AND tm.channel_code = f.output_channel_code "
      "  ORDER BY tm.captured_at DESC LIMIT 1 "
      ") r ON TRUE "
      "WHERE f.tenant_id = $1::uuid "
      "ORDER BY s.sensor_code, f.formula_name",
      1, nullptr, p, nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "query_failed"}});
  }
  json::array items;
  for (int i = 0; i < PQntuples(res.get()); ++i) {
    auto getDoubleOrNull = [&](int col) -> json::value {
      return PQgetisnull(res.get(), i, col) ? json::value(nullptr) : json::value(std::atof(PQgetvalue(res.get(), i, col)));
    };
    items.push_back(json::object{
        {"formula_id", PQgetvalue(res.get(), i, 0)},
        {"sensor_id", PQgetvalue(res.get(), i, 1)},
        {"sensor_code", PQgetvalue(res.get(), i, 2)},
        {"sensor_name", PQgetvalue(res.get(), i, 3)},
        {"formula_name", PQgetvalue(res.get(), i, 4)},
        {"expression", PQgetvalue(res.get(), i, 5)},
        {"output_channel_code", PQgetvalue(res.get(), i, 6)},
        {"output_unit", PQgetisnull(res.get(), i, 7) ? json::value("") : json::value(PQgetvalue(res.get(), i, 7))},
        {"warning_low", getDoubleOrNull(8)},
        {"warning_high", getDoubleOrNull(9)},
        {"error_low", getDoubleOrNull(10)},
        {"error_high", getDoubleOrNull(11)},
        {"enabled", std::string(PQgetvalue(res.get(), i, 12)) == "t"},
        {"last_value", getDoubleOrNull(13)},
        {"last_status", PQgetisnull(res.get(), i, 14) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 14))},
        {"last_captured_at", PQgetisnull(res.get(), i, 15) ? json::value(nullptr) : json::value(PQgetvalue(res.get(), i, 15))},
    });
  }
  return makeJsonResponse(http::status::ok, json::object{{"formulas", items}});
}

#endif // HAS_LIBPQ

} // namespace

void registerFormulaRoutes(router::Router &r) {
#if HAS_LIBPQ
  r.get("/api/mining/devices/", handleGetDeviceSubResource);
  r.del("/api/mining/devices/", handleDeleteDeviceSubResource);
  r.get("/api/mining/formulas", handleListAllFormulas);
#endif
}

http::response<http::string_body>
handleUpdateSensorParameters(const http::request<http::string_body> &req,
                             const std::unordered_map<std::string, std::string> &query,
                             const std::string &sensorId) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "dispositivos.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "dispositivos.manage"}});
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
  if (!sensorBelongsToTenant(conn, sensorId, session->tenantId)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "device_not_found"}});
  }

  int count = 0;
  for (const auto &entry : body.as_object().at("parameters").as_array()) {
    if (!entry.is_object()) continue;
    const auto &eo = entry.as_object();
    if (!eo.if_contains("param_key")) continue;
    const std::string paramKey = jsonToStringSafe(eo.at("param_key"));
    if (paramKey.empty()) continue;

    const bool doDelete = eo.if_contains("delete") && eo.at("delete").is_bool() && eo.at("delete").as_bool();
    if (doDelete) {
      const char *dp[2] = {sensorId.c_str(), paramKey.c_str()};
      PQexecParams(conn,
          "DELETE FROM sensor_input_parameter_def WHERE sensor_id=$1::uuid AND param_key=$2",
          2, nullptr, dp, nullptr, nullptr, 0);
      ++count;
      continue;
    }

    const std::string dataType = eo.if_contains("data_type") ? jsonToStringSafe(eo.at("data_type")) : std::string("numeric");
    const bool isRequired = eo.if_contains("is_required") && eo.at("is_required").is_bool() && eo.at("is_required").as_bool();
    const char *defParams[4] = {sensorId.c_str(), paramKey.c_str(), dataType.c_str(),
                                isRequired ? "true" : "false"};
    storage::PgResult defRes{PQexecParams(
        conn,
        "INSERT INTO sensor_input_parameter_def (sensor_id, param_key, data_type, is_required) "
        "VALUES ($1::uuid, $2, $3, $4::boolean) "
        "ON CONFLICT (sensor_id, param_key) DO UPDATE SET data_type = EXCLUDED.data_type, "
        "is_required = EXCLUDED.is_required",
        4, nullptr, defParams, nullptr, nullptr, 0)};
    if (!defRes.okCommand()) continue;

    if (eo.if_contains("value")) {
      const std::string valueJson = json::serialize(eo.at("value"));
      const char *valParams[4] = {sensorId.c_str(), paramKey.c_str(), valueJson.c_str(),
                                  session->userId.c_str()};
      PQexecParams(conn,
          "INSERT INTO sensor_input_parameter_value (sensor_id, param_key, value, updated_by) "
          "VALUES ($1::uuid, $2, $3::jsonb, $4::uuid) "
          "ON CONFLICT (sensor_id, param_key) DO UPDATE SET value = EXCLUDED.value, "
          "updated_at = NOW(), updated_by = EXCLUDED.updated_by",
          4, nullptr, valParams, nullptr, nullptr, 0);
    }
    ++count;
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}, {"count", count}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleCreateSensorFormula(const http::request<http::string_body> &req,
                          const std::unordered_map<std::string, std::string> &query,
                          const std::string &sensorId) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "dispositivos.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "dispositivos.manage"}});
  }
  json::value body;
  try { body = json::parse(req.body()); } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  const auto &obj = body.as_object();
  if (!obj.if_contains("formula_name") || !obj.if_contains("expression") ||
      !obj.if_contains("output_channel_code")) {
    return makeJsonResponse(http::status::bad_request,
        json::object{{"error", "formula_name, expression y output_channel_code son requeridos"}});
  }
  const std::string formulaName = jsonToStringSafe(obj.at("formula_name"));
  const std::string expression = jsonToStringSafe(obj.at("expression"));
  const std::string channelCode = jsonToStringSafe(obj.at("output_channel_code"));
  if (formulaName.empty() || expression.empty() || channelCode.empty()) {
    return makeJsonResponse(http::status::bad_request,
        json::object{{"error", "formula_name, expression y output_channel_code no pueden estar vacíos"}});
  }
  const std::string displayKey = obj.if_contains("output_display_key") ? jsonToStringSafe(obj.at("output_display_key")) : formulaName;
  const std::string unit = obj.if_contains("output_unit") ? jsonToStringSafe(obj.at("output_unit")) : std::string();
  const bool enabled = !obj.if_contains("enabled") || (obj.at("enabled").is_bool() && obj.at("enabled").as_bool());

  double wLow = 0, wHigh = 0, eLow = 0, eHigh = 0;
  const bool hasWLow = obj.if_contains("warning_low") && jsonToDoubleSafe(obj.at("warning_low"), wLow);
  const bool hasWHigh = obj.if_contains("warning_high") && jsonToDoubleSafe(obj.at("warning_high"), wHigh);
  const bool hasELow = obj.if_contains("error_low") && jsonToDoubleSafe(obj.at("error_low"), eLow);
  const bool hasEHigh = obj.if_contains("error_high") && jsonToDoubleSafe(obj.at("error_high"), eHigh);

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  if (!sensorBelongsToTenant(conn, sensorId, session->tenantId)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "device_not_found"}});
  }
  std::string exprError;
  if (!validateExpression(conn, sensorId, expression, exprError)) {
    return makeJsonResponse(http::status::bad_request,
        json::object{{"error", "invalid_expression"}, {"detail", exprError}});
  }

  const char *chanParams[4] = {sensorId.c_str(), channelCode.c_str(), displayKey.c_str(), unit.c_str()};
  storage::PgResult chanRes{PQexecParams(
      conn,
      "INSERT INTO sensor_output_channel_def (sensor_id, channel_code, display_key, unit) "
      "VALUES ($1::uuid, $2, $3, $4) "
      "ON CONFLICT (sensor_id, channel_code) DO UPDATE SET "
      "display_key = COALESCE(NULLIF(EXCLUDED.display_key, ''), sensor_output_channel_def.display_key), "
      "unit = COALESCE(NULLIF(EXCLUDED.unit, ''), sensor_output_channel_def.unit)",
      4, nullptr, chanParams, nullptr, nullptr, 0)};
  if (!chanRes.okCommand()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "channel_upsert_failed"}});
  }

  const std::string wLowStr = std::to_string(wLow), wHighStr = std::to_string(wHigh);
  const std::string eLowStr = std::to_string(eLow), eHighStr = std::to_string(eHigh);
  const char *insParams[10] = {
      session->tenantId.c_str(), sensorId.c_str(), formulaName.c_str(), expression.c_str(),
      channelCode.c_str(),
      hasWLow ? wLowStr.c_str() : nullptr, hasWHigh ? wHighStr.c_str() : nullptr,
      hasELow ? eLowStr.c_str() : nullptr, hasEHigh ? eHighStr.c_str() : nullptr,
      session->userId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO sensor_formula_def "
      "(tenant_id, sensor_id, formula_name, expression, output_channel_code, "
      "warning_low, warning_high, error_low, error_high, enabled, created_by) "
      "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::double precision, $7::double precision, "
      "$8::double precision, $9::double precision, TRUE, $10::uuid) "
      "RETURNING formula_id::text",
      10, nullptr, insParams, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    const std::string errMsg = PQresultErrorMessage(res.get());
    const bool duplicate = errMsg.find("sensor_formula_def_sensor_id_formula_name_key") != std::string::npos;
    return makeJsonResponse(
        duplicate ? http::status::conflict : http::status::internal_server_error,
        json::object{{"error", duplicate ? "formula_name_already_exists" : "insert_failed"}});
  }
  const std::string formulaId = PQgetvalue(res.get(), 0, 0);
  if (!enabled) {
    const char *disParams[1] = {formulaId.c_str()};
    PQexecParams(conn, "UPDATE sensor_formula_def SET enabled = FALSE WHERE formula_id = $1::bigint",
                1, nullptr, disParams, nullptr, nullptr, 0);
  }
  // ADR-195: genera de una vez el diagrama del lienzo "Cálculo" para esta
  // fórmula -- ver sensor_formula_diagram.hpp. No es fatal si falla (el
  // usuario siempre puede regenerar manualmente desde el lienzo), así que no
  // se aborta la creación de la fórmula si esto lanza.
  try {
    regenerateFormulaDiagram(conn, formulaId, sensorId, formulaName, expression, channelCode, unit,
                             hasWLow, wLow, hasWHigh, wHigh, hasELow, eLow, hasEHigh, eHigh);
  } catch (...) {}
  return makeJsonResponse(http::status::created, json::object{{"formula_id", formulaId}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

http::response<http::string_body>
handleUpdateSensorFormula(const http::request<http::string_body> &req,
                          const std::unordered_map<std::string, std::string> &query,
                          const std::string &sensorId,
                          const std::string &formulaId) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "dispositivos.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "dispositivos.manage"}});
  }
  json::value body;
  try { body = json::parse(req.body()); } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  const auto &obj = body.as_object();

  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  if (!sensorBelongsToTenant(conn, sensorId, session->tenantId)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "device_not_found"}});
  }

  std::string expression;
  const char *exprParam = nullptr;
  if (const auto *v = obj.if_contains("expression"); v && !v->is_null()) {
    expression = jsonToStringSafe(*v);
    std::string exprError;
    if (!validateExpression(conn, sensorId, expression, exprError)) {
      return makeJsonResponse(http::status::bad_request,
          json::object{{"error", "invalid_expression"}, {"detail", exprError}});
    }
    exprParam = expression.c_str();
  }

  std::string formulaName;
  const char *nameParam = nullptr;
  if (const auto *v = obj.if_contains("formula_name"); v && !v->is_null()) {
    formulaName = jsonToStringSafe(*v); nameParam = formulaName.c_str();
  }
  std::string wLowStr, wHighStr, eLowStr, eHighStr;
  const char *wLowParam = nullptr, *wHighParam = nullptr, *eLowParam = nullptr, *eHighParam = nullptr;
  double tmp = 0;
  if (const auto *v = obj.if_contains("warning_low"); v && !v->is_null() && jsonToDoubleSafe(*v, tmp)) { wLowStr = std::to_string(tmp); wLowParam = wLowStr.c_str(); }
  if (const auto *v = obj.if_contains("warning_high"); v && !v->is_null() && jsonToDoubleSafe(*v, tmp)) { wHighStr = std::to_string(tmp); wHighParam = wHighStr.c_str(); }
  if (const auto *v = obj.if_contains("error_low"); v && !v->is_null() && jsonToDoubleSafe(*v, tmp)) { eLowStr = std::to_string(tmp); eLowParam = eLowStr.c_str(); }
  if (const auto *v = obj.if_contains("error_high"); v && !v->is_null() && jsonToDoubleSafe(*v, tmp)) { eHighStr = std::to_string(tmp); eHighParam = eHighStr.c_str(); }

  const bool hasEnabled = obj.if_contains("enabled") && obj.at("enabled").is_bool();
  const char *enabledParam = hasEnabled ? (obj.at("enabled").as_bool() ? "true" : "false") : nullptr;

  const char *params[10] = {formulaId.c_str(), sensorId.c_str(), session->tenantId.c_str(),
                            nameParam, exprParam, wLowParam, wHighParam, eLowParam, eHighParam, enabledParam};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE sensor_formula_def SET "
      "formula_name = COALESCE($4, formula_name), "
      "expression = COALESCE($5, expression), "
      "warning_low = COALESCE($6::double precision, warning_low), "
      "warning_high = COALESCE($7::double precision, warning_high), "
      "error_low = COALESCE($8::double precision, error_low), "
      "error_high = COALESCE($9::double precision, error_high), "
      "enabled = COALESCE($10::boolean, enabled), "
      "updated_at = NOW() "
      "WHERE formula_id = $1::bigint AND sensor_id = $2::uuid AND tenant_id = $3::uuid "
      "RETURNING formula_id",
      10, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "formula_not_found"}});
  }
  // ADR-195: releer la fila completa (los campos no enviados quedaron
  // COALESCE'd contra el valor previo) y regenerar el diagrama del lienzo
  // "Cálculo" desde el estado final -- así una edición hecha fuera del
  // lienzo (ej. SensorManagementView) también lo mantiene sincronizado.
  {
    const char *fp[1] = {formulaId.c_str()};
    storage::PgResult full{PQexecParams(
        conn,
        "SELECT f.formula_name, f.expression, f.output_channel_code, c.unit, "
        "f.warning_low, f.warning_high, f.error_low, f.error_high "
        "FROM sensor_formula_def f "
        "LEFT JOIN sensor_output_channel_def c "
        "  ON c.sensor_id = f.sensor_id AND c.channel_code = f.output_channel_code "
        "WHERE f.formula_id = $1::bigint",
        1, nullptr, fp, nullptr, nullptr, 0)};
    if (full.okTuples() && PQntuples(full.get()) > 0) {
      auto getOpt = [&](int col, double &out) -> bool {
        if (PQgetisnull(full.get(), 0, col)) return false;
        out = std::atof(PQgetvalue(full.get(), 0, col));
        return true;
      };
      double wLow = 0, wHigh = 0, eLow = 0, eHigh = 0;
      const bool hasWLow = getOpt(4, wLow), hasWHigh = getOpt(5, wHigh);
      const bool hasELow = getOpt(6, eLow), hasEHigh = getOpt(7, eHigh);
      try {
        regenerateFormulaDiagram(conn, formulaId, sensorId,
                                 PQgetvalue(full.get(), 0, 0), PQgetvalue(full.get(), 0, 1),
                                 PQgetvalue(full.get(), 0, 2),
                                 PQgetisnull(full.get(), 0, 3) ? std::string() : PQgetvalue(full.get(), 0, 3),
                                 hasWLow, wLow, hasWHigh, wHigh, hasELow, eLow, hasEHigh, eHigh);
      } catch (...) {}
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

// ---------------------------------------------------------------------------
// POST .../{id}/formulas/{formula_id}/diagram/regenerate -- ADR-195: dispara
// bajo demanda la misma reconstrucción del diagrama que corre automáticamente
// al crear/editar la fórmula. Sirve para: (a) el botón "Regenerar diagrama"
// del lienzo, y (b) backfill manual de fórmulas creadas antes de ADR-195,
// que todavía no tienen ningún diagram_id='formula_<id>' guardado.
// ---------------------------------------------------------------------------
http::response<http::string_body>
handleRegenerateSensorFormulaDiagram(const http::request<http::string_body> &req,
                                     const std::unordered_map<std::string, std::string> &query,
                                     const std::string &sensorId,
                                     const std::string &formulaId) {
#if HAS_LIBPQ
  // ADR-195: sin gate de "dispositivos.manage" a propósito -- a diferencia de
  // crear/editar/borrar una fórmula, esto no acepta ningún contenido del
  // caller: reconstruye determinísticamente el diagrama a partir de la fila
  // de sensor_formula_def que el usuario ya puede leer en "Fórmulas de
  // Sensores" (esa vista tampoco exige el permiso, ver
  // handleListAllFormulas/handleGetDeviceSubResource). Requerir un permiso de
  // escritura solo para ver el diagrama de algo que ya se puede leer hubiera
  // dejado a cualquier usuario sin ese permiso sin poder ver NINGÚN diagrama
  // -- confirmado en vivo: 403 al navegar desde la tabla con un usuario de
  // solo lectura.
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
  if (!sensorBelongsToTenant(conn, sensorId, session->tenantId)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "device_not_found"}});
  }
  const char *fp[2] = {formulaId.c_str(), sensorId.c_str()};
  storage::PgResult full{PQexecParams(
      conn,
      "SELECT f.formula_name, f.expression, f.output_channel_code, c.unit, "
      "f.warning_low, f.warning_high, f.error_low, f.error_high "
      "FROM sensor_formula_def f "
      "LEFT JOIN sensor_output_channel_def c "
      "  ON c.sensor_id = f.sensor_id AND c.channel_code = f.output_channel_code "
      "WHERE f.formula_id = $1::bigint AND f.sensor_id = $2::uuid",
      2, nullptr, fp, nullptr, nullptr, 0)};
  if (!full.okTuples() || PQntuples(full.get()) == 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "formula_not_found"}});
  }
  auto getOpt = [&](int col, double &out) -> bool {
    if (PQgetisnull(full.get(), 0, col)) return false;
    out = std::atof(PQgetvalue(full.get(), 0, col));
    return true;
  };
  double wLow = 0, wHigh = 0, eLow = 0, eHigh = 0;
  const bool hasWLow = getOpt(4, wLow), hasWHigh = getOpt(5, wHigh);
  const bool hasELow = getOpt(6, eLow), hasEHigh = getOpt(7, eHigh);
  regenerateFormulaDiagram(conn, formulaId, sensorId,
                           PQgetvalue(full.get(), 0, 0), PQgetvalue(full.get(), 0, 1),
                           PQgetvalue(full.get(), 0, 2),
                           PQgetisnull(full.get(), 0, 3) ? std::string() : PQgetvalue(full.get(), 0, 3),
                           hasWLow, wLow, hasWHigh, wHigh, hasELow, eLow, hasEHigh, eHigh);
  return makeJsonResponse(http::status::ok, json::object{{"status", "regenerated"}, {"diagram_id", "formula_" + formulaId}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace mining_iot
