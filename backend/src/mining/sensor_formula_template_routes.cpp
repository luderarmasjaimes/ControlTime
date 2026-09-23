#include "sensor_formula_template_routes.hpp"
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

#include <string>
#include <unordered_map>
#include <vector>

using http_utils::makeJsonResponse;
using config::AppConfig;

namespace mining_iot {

namespace {

#if HAS_LIBPQ

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

// Mismo criterio de IDOR que sensor_formula_routes.cpp::sensorBelongsToTenant
// -- duplicado a propósito (helper de 4 líneas, no vale la pena exportarlo
// solo para esto, mismo precedente que csvEscape en ADR-134).
bool sensorBelongsToTenant(PGconn *conn, const std::string &sensorId, const std::string &tenantId) {
  const char *p[2] = {sensorId.c_str(), tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "SELECT 1 FROM sensors WHERE sensor_id = $1::uuid AND tenant_id = $2::uuid",
      2, nullptr, p, nullptr, nullptr, 0)};
  return res.okTuples() && PQntuples(res.get()) > 0;
}

// Compila (sin evaluar) contra una lista de nombres YA CONOCIDA (canales de
// entrada + parámetros de la plantilla que se está por aplicar) -- mismo
// criterio que sensor_formula_routes.cpp::validateExpression, sin volver a
// consultar sensor_input_channel_def/sensor_input_parameter_def: acá el
// caller ya sabe exactamente qué filas va a dejar la aplicación.
bool compileCheckExpression(const std::string &expression,
                             const std::vector<std::string> &telemetryNames,
                             const std::vector<std::string> &paramNames,
                             std::string &errorDetail) {
  std::vector<double> dummy(telemetryNames.size() + paramNames.size(), 1.0);
  std::vector<te_variable> vars;
  for (std::size_t i = 0; i < telemetryNames.size(); ++i) {
    vars.push_back({telemetryNames[i].c_str(), &dummy[i], TE_VARIABLE, nullptr});
  }
  for (std::size_t i = 0; i < paramNames.size(); ++i) {
    vars.push_back({paramNames[i].c_str(), &dummy[telemetryNames.size() + i], TE_VARIABLE, nullptr});
  }
  int err = 0;
  te_expr *compiled = te_compile(expression.c_str(), vars.data(), static_cast<int>(vars.size()), &err);
  if (!compiled) {
    errorDetail = "La expresión de la plantilla no compiló (posición " + std::to_string(err) + ")";
    return false;
  }
  te_free(compiled);
  return true;
}

struct TemplateInput { std::string channelCode; };
struct TemplateParam { std::string paramKey; bool isRequired; json::value defaultValue{nullptr}; };
struct TemplateOutput { std::string outputChannelCode; std::string expression; };

struct TemplateDef {
  bool found{false};
  std::string displayName;
  std::string outputUnit;
  std::vector<TemplateInput> inputs;
  std::vector<TemplateParam> params;
  std::vector<TemplateOutput> outputs;
};

TemplateDef loadTemplate(PGconn *conn, const std::string &templateCode) {
  TemplateDef t;
  const char *p[1] = {templateCode.c_str()};
  storage::PgResult defRes{PQexecParams(
      conn, "SELECT display_name, output_unit FROM sensor_formula_template_def WHERE template_code = $1",
      1, nullptr, p, nullptr, nullptr, 0)};
  if (!defRes.okTuples() || PQntuples(defRes.get()) == 0) return t;
  t.found = true;
  t.displayName = PQgetvalue(defRes.get(), 0, 0);
  t.outputUnit = PQgetvalue(defRes.get(), 0, 1);

  storage::PgResult inRes{PQexecParams(
      conn, "SELECT channel_code FROM sensor_formula_template_input WHERE template_code = $1 ORDER BY sort_order",
      1, nullptr, p, nullptr, nullptr, 0)};
  if (inRes.okTuples()) {
    for (int i = 0; i < PQntuples(inRes.get()); ++i) t.inputs.push_back({PQgetvalue(inRes.get(), i, 0)});
  }

  storage::PgResult paramRes{PQexecParams(
      conn, "SELECT param_key, is_required, default_value FROM sensor_formula_template_param "
            "WHERE template_code = $1 ORDER BY sort_order",
      1, nullptr, p, nullptr, nullptr, 0)};
  if (paramRes.okTuples()) {
    for (int i = 0; i < PQntuples(paramRes.get()); ++i) {
      TemplateParam tp;
      tp.paramKey = PQgetvalue(paramRes.get(), i, 0);
      tp.isRequired = std::string(PQgetvalue(paramRes.get(), i, 1)) == "t";
      if (!PQgetisnull(paramRes.get(), i, 2)) {
        try { tp.defaultValue = json::parse(PQgetvalue(paramRes.get(), i, 2)); } catch (...) {}
      }
      t.params.push_back(std::move(tp));
    }
  }

  storage::PgResult outRes{PQexecParams(
      conn, "SELECT output_channel_code, expression FROM sensor_formula_template_output "
            "WHERE template_code = $1 ORDER BY sort_order",
      1, nullptr, p, nullptr, nullptr, 0)};
  if (outRes.okTuples()) {
    for (int i = 0; i < PQntuples(outRes.get()); ++i) {
      t.outputs.push_back({PQgetvalue(outRes.get(), i, 0), PQgetvalue(outRes.get(), i, 1)});
    }
  }
  return t;
}

// GET /api/mining/formula-templates -- catálogo completo, sesión válida
// basta (paridad de solo-lectura con GET /api/mining/sensor-types, ADR-188).
http::response<http::string_body>
handleListFormulaTemplates(const http::request<http::string_body> &req,
                           const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  auto &cfg = AppConfig::instance();
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  storage::PgResult defRes{PQexec(conn,
      "SELECT template_code, display_name, instrument_family, description, "
      "requires_geometry, output_unit FROM sensor_formula_template_def "
      "ORDER BY instrument_family, display_name")};
  if (!defRes.okTuples()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "query_failed"}});
  }
  json::array items;
  const int n = PQntuples(defRes.get());
  for (int i = 0; i < n; ++i) {
    const std::string templateCode = PQgetvalue(defRes.get(), i, 0);
    const TemplateDef t = loadTemplate(conn, templateCode);
    json::array inputs, params, outputs;
    for (const auto &in : t.inputs) inputs.push_back(json::value(in.channelCode));
    for (const auto &pr : t.params) {
      params.push_back(json::object{
          {"param_key", pr.paramKey},
          {"is_required", pr.isRequired},
          {"default_value", pr.defaultValue.is_null() ? json::value(nullptr) : pr.defaultValue},
      });
    }
    for (const auto &out : t.outputs) {
      outputs.push_back(json::object{{"output_channel_code", out.outputChannelCode}});
    }
    items.push_back(json::object{
        {"template_code", templateCode},
        {"display_name", PQgetvalue(defRes.get(), i, 1)},
        {"instrument_family", PQgetvalue(defRes.get(), i, 2)},
        {"description", PQgetisnull(defRes.get(), i, 3) ? json::value(nullptr) : json::value(PQgetvalue(defRes.get(), i, 3))},
        {"requires_geometry", std::string(PQgetvalue(defRes.get(), i, 4)) == "t"},
        {"output_unit", PQgetvalue(defRes.get(), i, 5)},
        {"input_channels", inputs},
        {"parameters", params},
        {"output_channels", outputs},
    });
  }
  return makeJsonResponse(http::status::ok, json::object{{"templates", items}});
}

#endif // HAS_LIBPQ

} // namespace

http::response<http::string_body>
handleApplyFormulaTemplate(const http::request<http::string_body> &req,
                           const std::unordered_map<std::string, std::string> &query,
                           const std::string &sensorId) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "formula.edit")) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "forbidden"}, {"need", "formula.edit"}});
  }
  json::value body;
  try { body = json::parse(req.body()); } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object() || !body.as_object().if_contains("template_code")) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "template_code_required"}});
  }
  const auto &obj = body.as_object();
  const std::string templateCode = jsonToStringSafe(obj.at("template_code"));
  if (templateCode.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "template_code_required"}});
  }
  std::unordered_map<std::string, json::value> paramValues;
  if (const auto *pv = obj.if_contains("param_values")) {
    if (!pv->is_object()) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "param_values_must_be_object"}});
    }
    for (const auto &kv : pv->as_object()) paramValues[std::string(kv.key())] = kv.value();
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
  const TemplateDef tmpl = loadTemplate(conn, templateCode);
  if (!tmpl.found) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "template_not_found"}});
  }
  if (tmpl.outputs.empty()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "template_has_no_outputs"}});
  }

  // Resuelve el valor final de cada parámetro (lo que mandó el caller, si no
  // default_value de la plantilla) y rechaza si falta uno requerido sin
  // default -- antes de escribir nada.
  std::vector<std::string> paramNames;
  std::unordered_map<std::string, double> resolvedParams;
  for (const auto &p : tmpl.params) {
    paramNames.push_back(p.paramKey);
    auto it = paramValues.find(p.paramKey);
    double v = 0.0;
    if (it != paramValues.end()) {
      if (!jsonToDoubleSafe(it->second, v)) {
        return makeJsonResponse(http::status::bad_request,
            json::object{{"error", "invalid_param_value"}, {"param_key", p.paramKey}});
      }
    } else if (!p.defaultValue.is_null()) {
      if (!jsonToDoubleSafe(p.defaultValue, v)) v = 0.0;
    } else if (p.isRequired) {
      return makeJsonResponse(http::status::bad_request,
          json::object{{"error", "missing_required_param"}, {"param_key", p.paramKey}});
    }
    resolvedParams[p.paramKey] = v;
  }

  std::vector<std::string> telemetryNames;
  for (const auto &in : tmpl.inputs) telemetryNames.push_back(in.channelCode);

  // Valida las N expresiones de la plantilla ANTES de escribir nada -- si
  // una sola no compila contra sus propios canales/parámetros declarados
  // (no debería pasar con el catálogo seedeado, pero una plantilla mal
  // editada a mano no debe dejar al sensor con fórmulas a medio aplicar),
  // la aplicación entera falla.
  for (const auto &out : tmpl.outputs) {
    std::string err;
    if (!compileCheckExpression(out.expression, telemetryNames, paramNames, err)) {
      return makeJsonResponse(http::status::internal_server_error,
          json::object{{"error", "template_expression_invalid"}, {"detail", err},
                       {"output_channel_code", out.outputChannelCode}});
    }
  }

  // 1) Canales de entrada declarados para este sensor (ADR-189). El
  // resultado SÍ se revisa -- un fallo acá (p.ej. esquema desactualizado sin
  // esta tabla, bug real encontrado 2026-09-15: la aplicación de plantilla
  // "funcionaba" creando las 3 fórmulas igual, mientras el sensor nunca
  // quedaba declarado como multicanal, y el síntoma solo aparecía después,
  // como 400 sensor_not_multichannel en /api/mining/telemetry/multi) debe
  // frenar la aplicación entera, no seguir de largo en silencio.
  for (std::size_t i = 0; i < tmpl.inputs.size(); ++i) {
    const std::string sortStr = std::to_string(i);
    const char *p[3] = {sensorId.c_str(), tmpl.inputs[i].channelCode.c_str(), sortStr.c_str()};
    storage::PgResult chRes{PQexecParams(conn,
        "INSERT INTO sensor_input_channel_def (sensor_id, channel_code, sort_order) "
        "VALUES ($1::uuid, $2, $3::int) ON CONFLICT (sensor_id, channel_code) DO NOTHING",
        3, nullptr, p, nullptr, nullptr, 0)};
    if (!chRes.okCommand()) {
      return makeJsonResponse(http::status::internal_server_error,
          json::object{{"error", "input_channel_declare_failed"}, {"detail", chRes.error()}});
    }
  }

  // 2) Definición + valor de cada parámetro de calibración (tablas ADR-187,
  // ya existentes -- la plantilla solo decide QUÉ parámetros y CON QUÉ
  // valor, reusa el mismo mecanismo que la edición manual de parámetros).
  for (const auto &pdef : tmpl.params) {
    const char *dp[2] = {sensorId.c_str(), pdef.paramKey.c_str()};
    storage::PgResult defRes{PQexecParams(conn,
        "INSERT INTO sensor_input_parameter_def (sensor_id, param_key, data_type, is_required) "
        "VALUES ($1::uuid, $2, 'numeric', TRUE) "
        "ON CONFLICT (sensor_id, param_key) DO NOTHING",
        2, nullptr, dp, nullptr, nullptr, 0)};
    if (!defRes.okCommand()) {
      return makeJsonResponse(http::status::internal_server_error,
          json::object{{"error", "param_def_failed"}, {"detail", defRes.error()}, {"param_key", pdef.paramKey}});
    }
    const std::string valueJson = std::to_string(resolvedParams[pdef.paramKey]);
    const char *vp[3] = {sensorId.c_str(), pdef.paramKey.c_str(), valueJson.c_str()};
    storage::PgResult valRes{PQexecParams(conn,
        "INSERT INTO sensor_input_parameter_value (sensor_id, param_key, value, updated_by) "
        "VALUES ($1::uuid, $2, $3::jsonb, NULL) "
        "ON CONFLICT (sensor_id, param_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        3, nullptr, vp, nullptr, nullptr, 0)};
    if (!valRes.okCommand()) {
      return makeJsonResponse(http::status::internal_server_error,
          json::object{{"error", "param_value_failed"}, {"detail", valRes.error()}, {"param_key", pdef.paramKey}});
    }
  }

  // 3) Un sensor_formula_def por canal de salida de la plantilla (mismo
  // upsert de sensor_output_channel_def que
  // sensor_formula_routes.cpp::handleCreateSensorFormula). formula_name
  // deriva de la plantilla + el canal, para que reaplicar la misma
  // plantilla actualice (UPSERT) en vez de duplicar.
  json::array createdFormulaIds;
  for (const auto &out : tmpl.outputs) {
    const char *chanParams[3] = {sensorId.c_str(), out.outputChannelCode.c_str(), tmpl.outputUnit.c_str()};
    storage::PgResult chanRes{PQexecParams(conn,
        "INSERT INTO sensor_output_channel_def (sensor_id, channel_code, display_key, unit) "
        "VALUES ($1::uuid, $2, $2, $3) "
        "ON CONFLICT (sensor_id, channel_code) DO UPDATE SET "
        "unit = COALESCE(NULLIF(EXCLUDED.unit, ''), sensor_output_channel_def.unit)",
        3, nullptr, chanParams, nullptr, nullptr, 0)};
    if (!chanRes.okCommand()) {
      return makeJsonResponse(http::status::internal_server_error,
          json::object{{"error", "output_channel_declare_failed"}, {"detail", chanRes.error()}, {"output_channel_code", out.outputChannelCode}});
    }

    const std::string formulaName = templateCode + "_" + out.outputChannelCode;
    const char *insParams[6] = {
        session->tenantId.c_str(), sensorId.c_str(), formulaName.c_str(),
        out.expression.c_str(), out.outputChannelCode.c_str(), session->userId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "INSERT INTO sensor_formula_def "
        "(tenant_id, sensor_id, formula_name, expression, output_channel_code, enabled, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, TRUE, $6::uuid) "
        "ON CONFLICT (sensor_id, formula_name) DO UPDATE SET "
        "expression = EXCLUDED.expression, updated_at = NOW() "
        "RETURNING formula_id::text",
        6, nullptr, insParams, nullptr, nullptr, 0)};
    if (res.okTuples() && PQntuples(res.get()) > 0) {
      createdFormulaIds.push_back(json::value(PQgetvalue(res.get(), 0, 0)));
    }
  }

  return makeJsonResponse(http::status::ok,
      json::object{{"status", "applied"}, {"template_code", templateCode}, {"formula_ids", createdFormulaIds}});
#else
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

void registerFormulaTemplateRoutes(router::Router &r) {
#if HAS_LIBPQ
  r.get("/api/mining/formula-templates", handleListFormulaTemplates);
#endif
}

} // namespace mining_iot
