#include "formula_routes.hpp"
#include "formula_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

using http_utils::makeJsonResponse;
using config::AppConfig;
using auth::resolveAuthSession;
using auth::trimCompanyName;
using auth::pqEscapeLiteral;
using auth::ensureAuthSchemaPg;

namespace formula {

// ── GET /api/formula/dictionary ─────────────────────────────────────
static http::response<http::string_body>
handleFormulaDictionary(const http::request<http::string_body> &req,
                        const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  auto &cfg = AppConfig::instance();

#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
  if (PQstatus(conn) == CONNECTION_OK) {
    if (ensureAuthSchemaPg(conn)) {
      PGresult *res = PQexec(conn,
          "SELECT code, display_name, category, data_type, unit, description, "
          "example_value, sort_order FROM formula_data_dictionary "
          "WHERE is_active = TRUE ORDER BY sort_order, display_name");
      if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
        json::array items;
        for (int i = 0; i < PQntuples(res); ++i) {
          items.push_back(json::object{
            {"code", PQgetvalue(res, i, 0)},
            {"display_name", PQgetvalue(res, i, 1)},
            {"category", PQgetvalue(res, i, 2)},
            {"data_type", PQgetvalue(res, i, 3)},
            {"unit", PQgetisnull(res, i, 4) ? "" : std::string(PQgetvalue(res, i, 4))},
            {"description", PQgetvalue(res, i, 5)},
            {"example_value", PQgetisnull(res, i, 6) ? "" : std::string(PQgetvalue(res, i, 6))},
            {"sort_order", std::atoi(PQgetvalue(res, i, 7))}
          });
        }
        PQclear(res);
        PQfinish(conn);
        return makeJsonResponse(http::status::ok, json::object{{"items", items}});
      }
      if (res) PQclear(res);
    }
  }
  if (conn) PQfinish(conn);
#endif

  return makeJsonResponse(http::status::ok, json::object{{"items", json::array()}});
}

// ── GET /api/analysis/catalogos ─────────────────────────────────────
static http::response<http::string_body>
handleAnalysisCatalogos(const http::request<http::string_body> &req,
                        const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  const std::string formulaCompany = trimCompanyName(session->company);
  auto &cfg = AppConfig::instance();

#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
  if (PQstatus(conn) == CONNECTION_OK && ensureFormulaSchemaPg(conn, formulaCompany)) {
    std::string sql =
        "SELECT empresa_id, empresa_codigo, empresa_nombre, mina_id, mina_codigo, mina_nombre, zona_tipo, "
        "umbral_temp_alerta, sensor_id, sensor_codigo, sensor_nombre, variable_id, variable_codigo, variable_nombre, unidad "
        "FROM v_mineria_catalogos WHERE empresa_nombre = " + pqEscapeLiteral(conn, formulaCompany) +
        " ORDER BY mina_codigo";
    PGresult *res = PQexec(conn, sql.c_str());
    if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
      json::array rows;
      for (int i = 0; i < PQntuples(res); ++i) {
        rows.push_back(json::object{
            {"empresa_id", std::atoi(PQgetvalue(res, i, 0))},
            {"empresa_codigo", PQgetvalue(res, i, 1)},
            {"empresa_nombre", PQgetvalue(res, i, 2)},
            {"mina_id", std::atoi(PQgetvalue(res, i, 3))},
            {"mina_codigo", PQgetvalue(res, i, 4)},
            {"mina_nombre", PQgetvalue(res, i, 5)},
            {"zona_tipo", PQgetisnull(res, i, 6) ? "" : std::string(PQgetvalue(res, i, 6))},
            {"umbral_temp_alerta", std::atof(PQgetvalue(res, i, 7))},
            {"sensor_id", std::atoi(PQgetvalue(res, i, 8))},
            {"sensor_codigo", PQgetvalue(res, i, 9)},
            {"sensor_nombre", PQgetvalue(res, i, 10)},
            {"variable_id", std::atoi(PQgetvalue(res, i, 11))},
            {"variable_codigo", PQgetvalue(res, i, 12)},
            {"variable_nombre", PQgetvalue(res, i, 13)},
            {"unidad", PQgetisnull(res, i, 14) ? "" : std::string(PQgetvalue(res, i, 14))}
        });
      }
      PQclear(res);

      std::string usersSql =
          "SELECT username FROM auth_users WHERE TRIM(company_name) = " +
          pqEscapeLiteral(conn, formulaCompany) + " ORDER BY username";
      PGresult *uRes = PQexec(conn, usersSql.c_str());
      json::array usuarios;
      if (uRes && PQresultStatus(uRes) == PGRES_TUPLES_OK) {
        for (int i = 0; i < PQntuples(uRes); ++i) {
          usuarios.push_back(PQgetvalue(uRes, i, 0));
        }
      }
      if (uRes) PQclear(uRes);
      PQfinish(conn);
      return makeJsonResponse(http::status::ok, json::object{{"rows", rows}, {"usuarios", usuarios}});
    }
    if (res) PQclear(res);
  }
  if (conn) PQfinish(conn);
#endif

  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "analysis_catalog_error"}});
}

// ── POST /api/analysis/temperaturas ─────────────────────────────────
static http::response<http::string_body>
handleAnalysisTemperaturas(const http::request<http::string_body> &req,
                           const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  try {
    auto body = json::parse(req.body()).as_object();
    int minaId = body.if_contains("mina_id")
                     ? static_cast<int>(json::value_to<int64_t>(body.at("mina_id")))
                     : 0;
    int sensorId = body.if_contains("sensor_id")
                       ? static_cast<int>(json::value_to<int64_t>(body.at("sensor_id")))
                       : 0;
    std::string usuario = body.if_contains("usuario")
                              ? json::value_to<std::string>(body.at("usuario"))
                              : "";
    std::string fechaInicio = body.if_contains("fecha_inicio")
                                  ? json::value_to<std::string>(body.at("fecha_inicio"))
                                  : "";
    std::string fechaFin = body.if_contains("fecha_fin")
                               ? json::value_to<std::string>(body.at("fecha_fin"))
                               : "";

    if (minaId <= 0 || sensorId <= 0 || usuario.empty() ||
        fechaInicio.empty() || fechaFin.empty()) {
      return makeJsonResponse(http::status::bad_request,
          json::object{{"error", "mina_id, sensor_id, usuario, fecha_inicio y fecha_fin son requeridos"}});
    }

    const std::string formulaCompany = trimCompanyName(session->company);
    auto &cfg = AppConfig::instance();

#if HAS_LIBPQ
    PGconn *conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
    if (PQstatus(conn) == CONNECTION_OK && ensureFormulaSchemaPg(conn, formulaCompany)) {
      const std::string findEmpresa =
          "SELECT id::text FROM mineria_empresas WHERE nombre = " +
          pqEscapeLiteral(conn, formulaCompany) + " LIMIT 1";
      PGresult *empresaRes = PQexec(conn, findEmpresa.c_str());
      if (!empresaRes || PQresultStatus(empresaRes) != PGRES_TUPLES_OK ||
          PQntuples(empresaRes) < 1) {
        if (empresaRes) PQclear(empresaRes);
        PQfinish(conn);
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "empresa_not_found"}});
      }
      const std::string empresaId = PQgetvalue(empresaRes, 0, 0);
      PQclear(empresaRes);

      const std::string findVariableSql =
          "SELECT variable_id::text FROM mineria_sensores WHERE id = " +
          pqEscapeLiteral(conn, std::to_string(sensorId)) +
          " AND empresa_id = " + pqEscapeLiteral(conn, empresaId) +
          " AND mina_id = " + pqEscapeLiteral(conn, std::to_string(minaId)) +
          " LIMIT 1";
      PGresult *varRes = PQexec(conn, findVariableSql.c_str());
      if (!varRes || PQresultStatus(varRes) != PGRES_TUPLES_OK ||
          PQntuples(varRes) < 1) {
        if (varRes) PQclear(varRes);
        PQfinish(conn);
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "sensor_no_valido_para_empresa_y_mina"}});
      }
      const std::string variableId = PQgetvalue(varRes, 0, 0);
      PQclear(varRes);

      std::string sql =
          "SELECT timestamp_lectura::text, valor_original::double precision, calidad, "
          "umbral_alerta::double precision, condicion_resultado, "
          "valor_procesado::double precision, descripcion "
          "FROM sp_proceso_temperatura(" +
          pqEscapeLiteral(conn, empresaId) + "::integer," +
          pqEscapeLiteral(conn, std::to_string(minaId)) + "::integer," +
          pqEscapeLiteral(conn, variableId) + "::integer," +
          pqEscapeLiteral(conn, fechaInicio) + "::timestamptz," +
          pqEscapeLiteral(conn, fechaFin) + "::timestamptz)";
      PGresult *res = PQexec(conn, sql.c_str());
      if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
        json::array data;
        int totalSi = 0;
        for (int i = 0; i < PQntuples(res); ++i) {
          const std::string cond = PQgetvalue(res, i, 4);
          if (cond == "SI") totalSi++;
          data.push_back(json::object{
            {"timestamp_lectura", PQgetvalue(res, i, 0)},
            {"valor_original", std::atof(PQgetvalue(res, i, 1))},
            {"calidad", std::atoi(PQgetvalue(res, i, 2))},
            {"umbral_alerta", std::atof(PQgetvalue(res, i, 3))},
            {"condicion_resultado", cond},
            {"valor_procesado", std::atof(PQgetvalue(res, i, 5))},
            {"descripcion", PQgetvalue(res, i, 6)}
          });
        }
        int total = PQntuples(res);
        PQclear(res);
        PQfinish(conn);
        double pctAlertas = total > 0
            ? (100.0 * static_cast<double>(totalSi) / static_cast<double>(total))
            : 0.0;
        return makeJsonResponse(http::status::ok, json::object{
          {"rows", data},
          {"summary", json::object{
            {"usuario", usuario},
            {"total_lecturas", total},
            {"total_si", totalSi},
            {"total_no", total - totalSi},
            {"pct_alertas", pctAlertas}
          }}
        });
      }
      if (res) PQclear(res);
    }
    if (conn) PQfinish(conn);
#endif

    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "analysis_execution_error"}});
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_payload"}});
  }
}

// ── Route registration ──────────────────────────────────────────────

void registerRoutes(router::Router &r) {
  r.get("/api/formula/dictionary", handleFormulaDictionary);
  r.get("/api/analysis/catalogos", handleAnalysisCatalogos);
  r.post("/api/analysis/temperaturas", handleAnalysisTemperaturas);
}

} // namespace formula
