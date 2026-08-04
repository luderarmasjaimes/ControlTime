#include "formula_routes.hpp"
#include "formula_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using http_utils::makeJsonResponse;
using config::AppConfig;
using auth::resolveAuthSession;
using auth::trimCompanyName;
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
  auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) == CONNECTION_OK) {
    if (ensureAuthSchemaPg(conn)) {
      storage::PgResult res{PQexec(conn,
          "SELECT code, display_name, category, data_type, unit, description, "
          "example_value, sort_order FROM formula_data_dictionary "
          "WHERE is_active = TRUE ORDER BY sort_order, display_name")};
      if (res.okTuples()) {
        json::array items;
        for (int i = 0; i < PQntuples(res.get()); ++i) {
          items.push_back(json::object{
            {"code", PQgetvalue(res.get(), i, 0)},
            {"display_name", PQgetvalue(res.get(), i, 1)},
            {"category", PQgetvalue(res.get(), i, 2)},
            {"data_type", PQgetvalue(res.get(), i, 3)},
            {"unit", PQgetisnull(res.get(), i, 4) ? "" : std::string(PQgetvalue(res.get(), i, 4))},
            {"description", PQgetvalue(res.get(), i, 5)},
            {"example_value", PQgetisnull(res.get(), i, 6) ? "" : std::string(PQgetvalue(res.get(), i, 6))},
            {"sort_order", std::atoi(PQgetvalue(res.get(), i, 7))}
          });
        }
        return makeJsonResponse(http::status::ok, json::object{{"items", items}});
      }
    }
  }
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
  auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) == CONNECTION_OK && ensureFormulaSchemaPg(conn, formulaCompany)) {
    const char *catParams[1] = {formulaCompany.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT empresa_id, empresa_codigo, empresa_nombre, mina_id, "
        "mina_codigo, mina_nombre, zona_tipo, umbral_temp_alerta, sensor_id, "
        "sensor_codigo, sensor_nombre, variable_id, variable_codigo, "
        "variable_nombre, unidad "
        "FROM v_mineria_catalogos WHERE empresa_nombre = $1 "
        "ORDER BY mina_codigo",
        1, nullptr, catParams, nullptr, nullptr, 0)};
    if (res.okTuples()) {
      json::array rows;
      for (int i = 0; i < PQntuples(res.get()); ++i) {
        rows.push_back(json::object{
            {"empresa_id", std::atoi(PQgetvalue(res.get(), i, 0))},
            {"empresa_codigo", PQgetvalue(res.get(), i, 1)},
            {"empresa_nombre", PQgetvalue(res.get(), i, 2)},
            {"mina_id", std::atoi(PQgetvalue(res.get(), i, 3))},
            {"mina_codigo", PQgetvalue(res.get(), i, 4)},
            {"mina_nombre", PQgetvalue(res.get(), i, 5)},
            {"zona_tipo", PQgetisnull(res.get(), i, 6) ? "" : std::string(PQgetvalue(res.get(), i, 6))},
            {"umbral_temp_alerta", std::atof(PQgetvalue(res.get(), i, 7))},
            {"sensor_id", std::atoi(PQgetvalue(res.get(), i, 8))},
            {"sensor_codigo", PQgetvalue(res.get(), i, 9)},
            {"sensor_nombre", PQgetvalue(res.get(), i, 10)},
            {"variable_id", std::atoi(PQgetvalue(res.get(), i, 11))},
            {"variable_codigo", PQgetvalue(res.get(), i, 12)},
            {"variable_nombre", PQgetvalue(res.get(), i, 13)},
            {"unidad", PQgetisnull(res.get(), i, 14) ? "" : std::string(PQgetvalue(res.get(), i, 14))}
        });
      }

      const char *usersParams[1] = {formulaCompany.c_str()};
      storage::PgResult uRes{PQexecParams(
          conn,
          "SELECT username FROM auth_users WHERE TRIM(company_name) = $1 "
          "ORDER BY username",
          1, nullptr, usersParams, nullptr, nullptr, 0)};
      json::array usuarios;
      if (uRes.okTuples()) {
        for (int i = 0; i < PQntuples(uRes.get()); ++i) {
          usuarios.push_back(PQgetvalue(uRes.get(), i, 0));
        }
      }
      return makeJsonResponse(http::status::ok, json::object{{"rows", rows}, {"usuarios", usuarios}});
    }
  }
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
    auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK && ensureFormulaSchemaPg(conn, formulaCompany)) {
      const char *empParams[1] = {formulaCompany.c_str()};
      storage::PgResult empresaRes{PQexecParams(
          conn,
          "SELECT id::text FROM mineria_empresas WHERE nombre = $1 LIMIT 1", 1,
          nullptr, empParams, nullptr, nullptr, 0)};
      if (!empresaRes.okTuples() || PQntuples(empresaRes.get()) < 1) {
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "empresa_not_found"}});
      }
      const std::string empresaId = PQgetvalue(empresaRes.get(), 0, 0);

      const std::string sensorIdStr = std::to_string(sensorId);
      const std::string minaIdStr = std::to_string(minaId);
      const char *varParams[3] = {sensorIdStr.c_str(), empresaId.c_str(),
                                  minaIdStr.c_str()};
      storage::PgResult varRes{PQexecParams(
          conn,
          "SELECT variable_id::text FROM mineria_sensores "
          "WHERE id = $1::int AND empresa_id = $2::int AND mina_id = $3::int "
          "LIMIT 1",
          3, nullptr, varParams, nullptr, nullptr, 0)};
      if (!varRes.okTuples() || PQntuples(varRes.get()) < 1) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "sensor_no_valido_para_empresa_y_mina"}});
      }
      const std::string variableId = PQgetvalue(varRes.get(), 0, 0);

      const char *spParams[5] = {empresaId.c_str(), minaIdStr.c_str(),
                                 variableId.c_str(), fechaInicio.c_str(),
                                 fechaFin.c_str()};
      storage::PgResult res{PQexecParams(
          conn,
          "SELECT timestamp_lectura::text, valor_original::double precision, "
          "calidad, umbral_alerta::double precision, condicion_resultado, "
          "valor_procesado::double precision, descripcion "
          "FROM sp_proceso_temperatura($1::integer, $2::integer, "
          "$3::integer, $4::timestamptz, $5::timestamptz)",
          5, nullptr, spParams, nullptr, nullptr, 0)};
      if (res.okTuples()) {
        json::array data;
        int totalSi = 0;
        for (int i = 0; i < PQntuples(res.get()); ++i) {
          const std::string cond = PQgetvalue(res.get(), i, 4);
          if (cond == "SI") totalSi++;
          data.push_back(json::object{
            {"timestamp_lectura", PQgetvalue(res.get(), i, 0)},
            {"valor_original", std::atof(PQgetvalue(res.get(), i, 1))},
            {"calidad", std::atoi(PQgetvalue(res.get(), i, 2))},
            {"umbral_alerta", std::atof(PQgetvalue(res.get(), i, 3))},
            {"condicion_resultado", cond},
            {"valor_procesado", std::atof(PQgetvalue(res.get(), i, 5))},
            {"descripcion", PQgetvalue(res.get(), i, 6)}
          });
        }
        int total = PQntuples(res.get());
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
    }
#endif

    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "analysis_execution_error"}});
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_payload"}});
  }
}

// ── GET /api/analysis/historico ─────────────────────────────────────
// Historial de sesiones de análisis del tenant (CA-5 spec 010).
static http::response<http::string_body>
handleAnalysisHistorico(const http::request<http::string_body> &req,
                        const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  const std::string formulaCompany = trimCompanyName(session->company);
  auto &cfg = AppConfig::instance();

  int limit = 50;
  if (auto it = query.find("limit"); it != query.end()) {
    try { limit = std::max(1, std::min(500, std::stoi(it->second))); } catch (...) {}
  }

#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) == CONNECTION_OK) {
    const char *histEmpParams[1] = {formulaCompany.c_str()};
    storage::PgResult eRes{PQexecParams(
        conn,
        "SELECT id::text FROM mineria_empresas WHERE nombre = $1 LIMIT 1", 1,
        nullptr, histEmpParams, nullptr, nullptr, 0)};
    if (eRes.okTuples() && PQntuples(eRes.get()) == 1) {
      const std::string empresaId = PQgetvalue(eRes.get(), 0, 0);
      const std::string limitStr = std::to_string(limit);
      const char *sessParams[2] = {empresaId.c_str(), limitStr.c_str()};
      storage::PgResult res{PQexecParams(
          conn,
          "SELECT id, usuario_nombre, accion, empresa_nombre, mina_nombre, "
          "variable_nombre, fecha_inicio::text, fecha_fin::text, "
          "total_lecturas, total_si, total_no, pct_alertas, created_at::text "
          "FROM formula_sessions "
          "WHERE empresa_id = $1::int "
          "ORDER BY created_at DESC LIMIT $2::int",
          2, nullptr, sessParams, nullptr, nullptr, 0)};
      if (res.okTuples()) {
        json::array rows;
        for (int i = 0; i < PQntuples(res.get()); ++i) {
          rows.push_back(json::object{
            {"id",               std::atoll(PQgetvalue(res.get(), i, 0))},
            {"usuario_nombre",   PQgetvalue(res.get(), i, 1)},
            {"accion",           PQgetvalue(res.get(), i, 2)},
            {"empresa_nombre",   PQgetvalue(res.get(), i, 3)},
            {"mina_nombre",      PQgetisnull(res.get(), i, 4) ? "" : std::string(PQgetvalue(res.get(), i, 4))},
            {"variable_nombre",  PQgetisnull(res.get(), i, 5) ? "" : std::string(PQgetvalue(res.get(), i, 5))},
            {"fecha_inicio",     PQgetisnull(res.get(), i, 6) ? "" : std::string(PQgetvalue(res.get(), i, 6))},
            {"fecha_fin",        PQgetisnull(res.get(), i, 7) ? "" : std::string(PQgetvalue(res.get(), i, 7))},
            {"total_lecturas",   PQgetisnull(res.get(), i, 8) ? 0 : std::atoi(PQgetvalue(res.get(), i, 8))},
            {"total_si",         PQgetisnull(res.get(), i, 9) ? 0 : std::atoi(PQgetvalue(res.get(), i, 9))},
            {"total_no",         PQgetisnull(res.get(), i, 10) ? 0 : std::atoi(PQgetvalue(res.get(), i, 10))},
            {"pct_alertas",      PQgetisnull(res.get(), i, 11) ? 0.0 : std::atof(PQgetvalue(res.get(), i, 11))},
            {"created_at",       PQgetvalue(res.get(), i, 12)}
          });
        }
        return makeJsonResponse(http::status::ok,
                                json::object{{"rows", rows}, {"empresa", formulaCompany}});
      }
    }
  }
#endif

  return makeJsonResponse(http::status::ok,
                          json::object{{"rows", json::array()}, {"empresa", formulaCompany}});
}

// ── Route registration ──────────────────────────────────────────────

void registerRoutes(router::Router &r) {
  r.get("/api/formula/dictionary", handleFormulaDictionary);
  r.get("/api/analysis/catalogos", handleAnalysisCatalogos);
  r.post("/api/analysis/temperaturas", handleAnalysisTemperaturas);
  r.get("/api/analysis/historico", handleAnalysisHistorico);
}

} // namespace formula
