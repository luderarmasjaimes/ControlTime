#include "kpi_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <string>

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using auth::resolveAuthSession;
using auth::pqEscapeLiteral;

#define gAuthStorageMode  AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl      AppConfig::instance().gDatabaseUrl
#define gKpiExternalDatabaseUrl AppConfig::instance().gKpiExternalDatabaseUrl
#define gKpiExternalQuery AppConfig::instance().gKpiExternalQuery

namespace mining {

// ── GET /api/mining/kpis ─────────────────────────────────────────────
http::response<http::string_body>
handleGetKpis(const http::request<http::string_body>& req,
              const std::unordered_map<std::string, std::string>& query) {
  json::array rows;
  const std::string category =
      (query.count("category") && !query.at("category").empty()) ? query.at("category") : "";
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
    if (PQstatus(conn) == CONNECTION_OK) {
      bool hasRuntimeTable = false;
      PGresult *resCheck =
          PQexec(conn, "SELECT to_regclass('public.mining_runtime_kpis')::text");
      if (resCheck && PQresultStatus(resCheck) == PGRES_TUPLES_OK && PQntuples(resCheck) > 0 &&
          !PQgetisnull(resCheck, 0, 0)) {
        hasRuntimeTable = true;
      }
      if (resCheck) PQclear(resCheck);

      if (hasRuntimeTable) {
        std::string sql =
            "SELECT code, category, title, COALESCE(description,''), unit, "
            "current_value::double precision, target_value::double precision, trend_direction, "
            "trend_percent::double precision, status_color, updated_at::text "
            "FROM mining_runtime_kpis WHERE active = TRUE";
        if (!category.empty()) {
          sql += " AND category = " + pqEscapeLiteral(conn, category);
        }
        sql += " ORDER BY category ASC, sort_order ASC, title ASC";

        PGresult *res = PQexec(conn, sql.c_str());
        if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
          for (int i = 0; i < PQntuples(res); ++i) {
            json::object item;
            item["code"] = std::string(PQgetvalue(res, i, 0));
            item["category"] = std::string(PQgetvalue(res, i, 1));
            item["title"] = std::string(PQgetvalue(res, i, 2));
            item["description"] = std::string(PQgetvalue(res, i, 3));
            item["unit"] = std::string(PQgetvalue(res, i, 4));
            item["current_value"] = std::atof(PQgetvalue(res, i, 5));
            if (PQgetisnull(res, i, 6)) {
              item["target_value"] = nullptr;
            } else {
              item["target_value"] = std::atof(PQgetvalue(res, i, 6));
            }
            item["trend_direction"] = std::string(PQgetvalue(res, i, 7));
            item["trend_percent"] = std::atof(PQgetvalue(res, i, 8));
            item["status_color"] = std::string(PQgetvalue(res, i, 9));
            item["updated_at"] =
                PQgetisnull(res, i, 10) ? std::string() : std::string(PQgetvalue(res, i, 10));
            rows.push_back(std::move(item));
          }
        }
        if (res) PQclear(res);
      }

      if (rows.empty()) {
        PGresult *resFallback = PQexec(
            conn,
            "SELECT name, value::double precision, unit, trend, trend_value::double precision "
            "FROM dashboard_kpis ORDER BY name ASC");
        if (resFallback && PQresultStatus(resFallback) == PGRES_TUPLES_OK) {
          for (int i = 0; i < PQntuples(resFallback); ++i) {
            json::object item;
            item["code"] = std::string(PQgetvalue(resFallback, i, 0));
            item["category"] = std::string("general");
            item["title"] = std::string(PQgetvalue(resFallback, i, 0));
            item["description"] = std::string();
            item["unit"] = std::string(PQgetvalue(resFallback, i, 2));
            item["current_value"] = std::atof(PQgetvalue(resFallback, i, 1));
            item["target_value"] = nullptr;
            item["trend_direction"] = std::string(PQgetvalue(resFallback, i, 3));
            item["trend_percent"] = std::atof(PQgetvalue(resFallback, i, 4));
            item["status_color"] = std::string("green");
            item["updated_at"] = std::string();
            rows.push_back(std::move(item));
          }
        }
        if (resFallback) PQclear(resFallback);
      }
      PQfinish(conn);
      return makeJsonResponse(http::status::ok, json::object{{"kpis", rows}});
    }
    PQfinish(conn);
#endif
  }
  return makeJsonResponse(http::status::ok, json::object{{"kpis", rows}});
}

// ── POST /api/mining/kpis/upsert ─────────────────────────────────────
http::response<http::string_body>
handleUpsertKpis(const http::request<http::string_body>& req,
                 const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "postgres_required"}});
  }
#if HAS_LIBPQ
  try {
    const auto body = json::parse(req.body()).as_object();
    if (!body.if_contains("items") || !body.at("items").is_array()) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "items_array_required"}});
    }

    PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
    if (PQstatus(conn) != CONNECTION_OK) {
      PQfinish(conn);
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "db_unavailable"}});
    }

    PGresult *beginRes = PQexec(conn, "BEGIN");
    if (beginRes) PQclear(beginRes);

    int upserted = 0;
    const auto &arr = body.at("items").as_array();
    for (const auto &v : arr) {
      if (!v.is_object()) {
        continue;
      }
      const auto &it = v.as_object();
      if (!it.if_contains("code") || !it.if_contains("category") || !it.if_contains("title") ||
          !it.if_contains("unit") || !it.if_contains("current_value")) {
        continue;
      }
      const std::string code = json::value_to<std::string>(it.at("code"));
      const std::string cat = json::value_to<std::string>(it.at("category"));
      const std::string title = json::value_to<std::string>(it.at("title"));
      const std::string unit = json::value_to<std::string>(it.at("unit"));
      const std::string description =
          it.if_contains("description") ? json::value_to<std::string>(it.at("description")) : "";
      const double currentValue = json::value_to<double>(it.at("current_value"));
      const bool hasTarget = it.if_contains("target_value") && !it.at("target_value").is_null();
      const double targetValue = hasTarget ? json::value_to<double>(it.at("target_value")) : 0.0;
      const std::string trendDirection =
          it.if_contains("trend_direction") ? json::value_to<std::string>(it.at("trend_direction"))
                                            : "flat";
      const double trendPercent =
          it.if_contains("trend_percent") ? json::value_to<double>(it.at("trend_percent")) : 0.0;
      const std::string statusColor =
          it.if_contains("status_color") ? json::value_to<std::string>(it.at("status_color"))
                                         : "green";
      const int sortOrder =
          it.if_contains("sort_order") ? static_cast<int>(json::value_to<int64_t>(it.at("sort_order")))
                                       : 100;
      const bool active = it.if_contains("active") ? json::value_to<bool>(it.at("active")) : true;

      std::string sql =
          "INSERT INTO mining_runtime_kpis "
          "(code, category, title, description, unit, current_value, target_value, trend_direction, "
          "trend_percent, status_color, active, sort_order, updated_at) VALUES (" +
          pqEscapeLiteral(conn, code) + "," + pqEscapeLiteral(conn, cat) + "," +
          pqEscapeLiteral(conn, title) + "," + pqEscapeLiteral(conn, description) + "," +
          pqEscapeLiteral(conn, unit) + "," + pqEscapeLiteral(conn, std::to_string(currentValue)) +
          "::double precision, " +
          (hasTarget ? pqEscapeLiteral(conn, std::to_string(targetValue)) + "::double precision"
                     : std::string("NULL::double precision")) +
          ", " + pqEscapeLiteral(conn, trendDirection) + ", " +
          pqEscapeLiteral(conn, std::to_string(trendPercent)) + "::double precision, " +
          pqEscapeLiteral(conn, statusColor) + ", " + (active ? "TRUE" : "FALSE") + ", " +
          pqEscapeLiteral(conn, std::to_string(sortOrder)) + "::int, NOW()) "
          "ON CONFLICT (code) DO UPDATE SET "
          "category = EXCLUDED.category, "
          "title = EXCLUDED.title, "
          "description = EXCLUDED.description, "
          "unit = EXCLUDED.unit, "
          "current_value = EXCLUDED.current_value, "
          "target_value = EXCLUDED.target_value, "
          "trend_direction = EXCLUDED.trend_direction, "
          "trend_percent = EXCLUDED.trend_percent, "
          "status_color = EXCLUDED.status_color, "
          "active = EXCLUDED.active, "
          "sort_order = EXCLUDED.sort_order, "
          "updated_at = NOW()";

      PGresult *res = PQexec(conn, sql.c_str());
      if (!res || PQresultStatus(res) != PGRES_COMMAND_OK) {
        if (res) PQclear(res);
        PGresult *rbRes = PQexec(conn, "ROLLBACK");
        if (rbRes) PQclear(rbRes);
        PQfinish(conn);
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "kpi_upsert_failed"}, {"code", code}});
      }
      PQclear(res);
      const std::string pointSql =
          "INSERT INTO mining_runtime_kpi_points(kpi_code, point_label, point_value, point_ts) VALUES (" +
          pqEscapeLiteral(conn, code) + ", " + pqEscapeLiteral(conn, "runtime") + ", " +
          pqEscapeLiteral(conn, std::to_string(currentValue)) + "::double precision, NOW())";
      PGresult *ptRes = PQexec(conn, pointSql.c_str());
      if (ptRes) PQclear(ptRes);
      upserted += 1;
    }

    PGresult *commitRes = PQexec(conn, "COMMIT");
    if (commitRes) PQclear(commitRes);
    PQfinish(conn);
    return makeJsonResponse(http::status::ok, json::object{{"status", "ok"}, {"upserted", upserted}});
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  } catch (...) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_payload"}});
  }
#else
  return makeJsonResponse(http::status::bad_request, json::object{{"error", "postgres_not_compiled"}});
#endif
}

// ── POST /api/mining/kpis/sync-from-dashboard ────────────────────────
http::response<http::string_body>
handleSyncFromDashboard(const http::request<http::string_body>& req,
                        const std::unordered_map<std::string, std::string>& query) {
  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "postgres_required"}});
  }
#if HAS_LIBPQ
  PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
  if (PQstatus(conn) != CONNECTION_OK) {
    PQfinish(conn);
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  PGresult *beginRes = PQexec(conn, "BEGIN");
  if (beginRes) PQclear(beginRes);
  bool hasDashboardKpis = false;
  PGresult *checkRes = PQexec(conn, "SELECT to_regclass('public.dashboard_kpis')::text");
  if (checkRes && PQresultStatus(checkRes) == PGRES_TUPLES_OK && PQntuples(checkRes) > 0 &&
      !PQgetisnull(checkRes, 0, 0)) {
    hasDashboardKpis = true;
  }
  if (checkRes) PQclear(checkRes);
  if (!hasDashboardKpis) {
    int runtimeCount = 0;
    int touched = 0;
    PGresult *touchRes = PQexec(
        conn,
        "WITH moved AS ("
        "  INSERT INTO mining_runtime_kpi_points(kpi_code, point_label, point_value, point_ts) "
        "  SELECT code, 'sync_runtime_touch', current_value::double precision, NOW() "
        "  FROM mining_runtime_kpis WHERE active = TRUE RETURNING 1"
        ") SELECT COUNT(*)::int FROM moved");
    if (touchRes && PQresultStatus(touchRes) == PGRES_TUPLES_OK && PQntuples(touchRes) > 0) {
      touched = std::atoi(PQgetvalue(touchRes, 0, 0));
    }
    if (touchRes) PQclear(touchRes);
    PGresult *updRes = PQexec(conn, "UPDATE mining_runtime_kpis SET updated_at = NOW() WHERE active = TRUE");
    if (updRes) PQclear(updRes);
    PGresult *cntRes = PQexec(conn, "SELECT COUNT(*)::int FROM mining_runtime_kpis WHERE active = TRUE");
    if (cntRes && PQresultStatus(cntRes) == PGRES_TUPLES_OK && PQntuples(cntRes) > 0) {
      runtimeCount = std::atoi(PQgetvalue(cntRes, 0, 0));
    }
    if (cntRes) PQclear(cntRes);
    PGresult *commitRes = PQexec(conn, "COMMIT");
    if (commitRes) PQclear(commitRes);
    PQfinish(conn);
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"},
                                         {"synced", touched},
                                         {"existing_runtime", runtimeCount},
                                         {"message", "Origen dashboard no configurado; se mantienen KPI runtime"}});
  }
  PGresult *src =
      PQexec(conn,
             "SELECT name, value::double precision, unit, trend, trend_value::double precision "
             "FROM dashboard_kpis ORDER BY name ASC");
  if (!src || PQresultStatus(src) != PGRES_TUPLES_OK) {
    if (src) PQclear(src);
    int runtimeCount = 0;
    int touched = 0;
    PGresult *touchRes = PQexec(
        conn,
        "WITH moved AS ("
        "  INSERT INTO mining_runtime_kpi_points(kpi_code, point_label, point_value, point_ts) "
        "  SELECT code, 'sync_runtime_touch', current_value::double precision, NOW() "
        "  FROM mining_runtime_kpis WHERE active = TRUE RETURNING 1"
        ") SELECT COUNT(*)::int FROM moved");
    if (touchRes && PQresultStatus(touchRes) == PGRES_TUPLES_OK && PQntuples(touchRes) > 0) {
      touched = std::atoi(PQgetvalue(touchRes, 0, 0));
    }
    if (touchRes) PQclear(touchRes);
    PGresult *updRes = PQexec(conn, "UPDATE mining_runtime_kpis SET updated_at = NOW() WHERE active = TRUE");
    if (updRes) PQclear(updRes);
    PGresult *cntRes = PQexec(conn, "SELECT COUNT(*)::int FROM mining_runtime_kpis WHERE active = TRUE");
    if (cntRes && PQresultStatus(cntRes) == PGRES_TUPLES_OK && PQntuples(cntRes) > 0) {
      runtimeCount = std::atoi(PQgetvalue(cntRes, 0, 0));
    }
    if (cntRes) PQclear(cntRes);
    PGresult *commitRes = PQexec(conn, "COMMIT");
    if (commitRes) PQclear(commitRes);
    PQfinish(conn);
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"},
                                         {"synced", touched},
                                         {"existing_runtime", runtimeCount},
                                         {"message", "Origen dashboard sin datos; se mantienen KPI runtime"}});
  }
  int synced = 0;
  for (int i = 0; i < PQntuples(src); ++i) {
    const std::string name = PQgetvalue(src, i, 0);
    const double value = std::atof(PQgetvalue(src, i, 1));
    const std::string unit = PQgetisnull(src, i, 2) ? std::string() : std::string(PQgetvalue(src, i, 2));
    const std::string trend = PQgetisnull(src, i, 3) ? std::string("flat") : std::string(PQgetvalue(src, i, 3));
    const double trendValue = PQgetisnull(src, i, 4) ? 0.0 : std::atof(PQgetvalue(src, i, 4));
    std::string cat = "produccion";
    std::string lowered = name;
    std::transform(lowered.begin(), lowered.end(), lowered.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (lowered.find("cost") != std::string::npos || lowered.find("aisc") != std::string::npos ||
        lowered.find("cash") != std::string::npos) {
      cat = "costos_operativos";
    } else if (lowered.find("accident") != std::string::npos || lowered.find("safety") != std::string::npos ||
               lowered.find("water") != std::string::npos || lowered.find("dust") != std::string::npos) {
      cat = "seguridad_ambiente";
    }
    std::string upsertSql =
        "INSERT INTO mining_runtime_kpis "
        "(code, category, title, description, unit, current_value, target_value, trend_direction, trend_percent, "
        "status_color, active, sort_order, updated_at) VALUES (" +
        pqEscapeLiteral(conn, name) + ", " + pqEscapeLiteral(conn, cat) + ", " +
        pqEscapeLiteral(conn, name) + ", ''::text, " + pqEscapeLiteral(conn, unit) + ", " +
        pqEscapeLiteral(conn, std::to_string(value)) + "::double precision, NULL::double precision, " +
        pqEscapeLiteral(conn, trend) + ", " + pqEscapeLiteral(conn, std::to_string(trendValue)) +
        "::double precision, 'green', TRUE, 900, NOW()) "
        "ON CONFLICT (code) DO UPDATE SET "
        "category=EXCLUDED.category, title=EXCLUDED.title, unit=EXCLUDED.unit, current_value=EXCLUDED.current_value, "
        "trend_direction=EXCLUDED.trend_direction, trend_percent=EXCLUDED.trend_percent, updated_at=NOW()";
    PGresult *upRes = PQexec(conn, upsertSql.c_str());
    if (!upRes || PQresultStatus(upRes) != PGRES_COMMAND_OK) {
      if (upRes) PQclear(upRes);
      PQclear(src);
      PGresult *rbRes = PQexec(conn, "ROLLBACK");
      if (rbRes) PQclear(rbRes);
      PQfinish(conn);
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "sync_failed"}});
    }
    PQclear(upRes);
    const std::string pointSql =
        "INSERT INTO mining_runtime_kpi_points(kpi_code, point_label, point_value, point_ts) VALUES (" +
        pqEscapeLiteral(conn, name) + ", " + pqEscapeLiteral(conn, "sync_dashboard") + ", " +
        pqEscapeLiteral(conn, std::to_string(value)) + "::double precision, NOW())";
    PGresult *ptRes = PQexec(conn, pointSql.c_str());
    if (ptRes) PQclear(ptRes);
    synced += 1;
  }
  PQclear(src);
  PGresult *commitRes = PQexec(conn, "COMMIT");
  if (commitRes) PQclear(commitRes);
  PQfinish(conn);
  return makeJsonResponse(http::status::ok, json::object{{"status", "ok"}, {"synced", synced}});
#else
  return makeJsonResponse(http::status::bad_request, json::object{{"error", "postgres_not_compiled"}});
#endif
}

// ── POST /api/mining/kpis/sync-from-external ─────────────────────────
http::response<http::string_body>
handleSyncFromExternal(const http::request<http::string_body>& req,
                       const std::unordered_map<std::string, std::string>& query) {
  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"}, {"synced", 0}, {"message", "postgres_required"}});
  }
#if HAS_LIBPQ
  if (gKpiExternalDatabaseUrl.empty()) {
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"},
                                         {"synced", 0},
                                         {"message", "KPI_EXTERNAL_DATABASE_URL not configured"}});
  }

  PGconn *localConn = PQconnectdb(gDatabaseUrl.c_str());
  if (PQstatus(localConn) != CONNECTION_OK) {
    PQfinish(localConn);
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  PGconn *extConn = PQconnectdb(gKpiExternalDatabaseUrl.c_str());
  if (PQstatus(extConn) != CONNECTION_OK) {
    PQfinish(extConn);
    PQfinish(localConn);
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"},
                                         {"synced", 0},
                                         {"message", "external_db_unavailable"}});
  }

  const std::string querySql =
      gKpiExternalQuery.empty()
          ? "SELECT code, category, title, COALESCE(description,''), unit, "
            "current_value::double precision, target_value::double precision, "
            "COALESCE(trend_direction,'flat'), COALESCE(trend_percent,0)::double precision, "
            "COALESCE(status_color,'green'), COALESCE(sort_order,100)::int, COALESCE(active,true) "
            "FROM mining_runtime_kpis"
          : gKpiExternalQuery;
  PGresult *extRows = PQexec(extConn, querySql.c_str());
  if (!extRows || PQresultStatus(extRows) != PGRES_TUPLES_OK) {
    if (extRows) PQclear(extRows);
    PQfinish(extConn);
    PQfinish(localConn);
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"},
                                         {"synced", 0},
                                         {"message", "external_query_failed"}});
  }

  PGresult *beginRes = PQexec(localConn, "BEGIN");
  if (beginRes) PQclear(beginRes);

  int synced = 0;
  for (int i = 0; i < PQntuples(extRows); ++i) {
    const std::string code = PQgetvalue(extRows, i, 0);
    const std::string cat = PQgetvalue(extRows, i, 1);
    const std::string title = PQgetvalue(extRows, i, 2);
    const std::string description = PQgetvalue(extRows, i, 3);
    const std::string unit = PQgetvalue(extRows, i, 4);
    const double currentValue = std::atof(PQgetvalue(extRows, i, 5));
    const bool hasTarget = !PQgetisnull(extRows, i, 6);
    const double targetValue = hasTarget ? std::atof(PQgetvalue(extRows, i, 6)) : 0.0;
    const std::string trendDirection = PQgetvalue(extRows, i, 7);
    const double trendPercent = std::atof(PQgetvalue(extRows, i, 8));
    const std::string statusColor = PQgetvalue(extRows, i, 9);
    const int sortOrder = std::atoi(PQgetvalue(extRows, i, 10));
    const bool active =
        std::string(PQgetvalue(extRows, i, 11)) == "t" || std::string(PQgetvalue(extRows, i, 11)) == "true";

    std::string upsertSql =
        "INSERT INTO mining_runtime_kpis "
        "(code, category, title, description, unit, current_value, target_value, trend_direction, trend_percent, "
        "status_color, active, sort_order, updated_at) VALUES (" +
        pqEscapeLiteral(localConn, code) + ", " + pqEscapeLiteral(localConn, cat) + ", " +
        pqEscapeLiteral(localConn, title) + ", " + pqEscapeLiteral(localConn, description) + ", " +
        pqEscapeLiteral(localConn, unit) + ", " +
        pqEscapeLiteral(localConn, std::to_string(currentValue)) + "::double precision, " +
        (hasTarget ? (pqEscapeLiteral(localConn, std::to_string(targetValue)) + "::double precision")
                   : std::string("NULL::double precision")) +
        ", " + pqEscapeLiteral(localConn, trendDirection) + ", " +
        pqEscapeLiteral(localConn, std::to_string(trendPercent)) + "::double precision, " +
        pqEscapeLiteral(localConn, statusColor) + ", " + (active ? "TRUE" : "FALSE") + ", " +
        pqEscapeLiteral(localConn, std::to_string(sortOrder)) + "::int, NOW()) "
        "ON CONFLICT (code) DO UPDATE SET "
        "category = EXCLUDED.category, title = EXCLUDED.title, description = EXCLUDED.description, "
        "unit = EXCLUDED.unit, current_value = EXCLUDED.current_value, target_value = EXCLUDED.target_value, "
        "trend_direction = EXCLUDED.trend_direction, trend_percent = EXCLUDED.trend_percent, "
        "status_color = EXCLUDED.status_color, active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, "
        "updated_at = NOW()";
    PGresult *upRes = PQexec(localConn, upsertSql.c_str());
    if (!upRes || PQresultStatus(upRes) != PGRES_COMMAND_OK) {
      if (upRes) PQclear(upRes);
      PGresult *rbRes = PQexec(localConn, "ROLLBACK");
      if (rbRes) PQclear(rbRes);
      PQclear(extRows);
      PQfinish(extConn);
      PQfinish(localConn);
      return makeJsonResponse(http::status::ok,
                              json::object{{"status", "ok"}, {"synced", synced}, {"message", "sync_partial_failed"}});
    }
    PQclear(upRes);
    const std::string pointSql =
        "INSERT INTO mining_runtime_kpi_points(kpi_code, point_label, point_value, point_ts) VALUES (" +
        pqEscapeLiteral(localConn, code) + ", " + pqEscapeLiteral(localConn, "sync_external") + ", " +
        pqEscapeLiteral(localConn, std::to_string(currentValue)) + "::double precision, NOW())";
    PGresult *ptRes = PQexec(localConn, pointSql.c_str());
    if (ptRes) PQclear(ptRes);
    synced += 1;
  }

  PGresult *commitRes = PQexec(localConn, "COMMIT");
  if (commitRes) PQclear(commitRes);
  PQclear(extRows);
  PQfinish(extConn);
  PQfinish(localConn);
  return makeJsonResponse(http::status::ok, json::object{{"status", "ok"}, {"synced", synced}});
#else
  return makeJsonResponse(http::status::ok,
                          json::object{{"status", "ok"}, {"synced", 0}, {"message", "postgres_not_compiled"}});
#endif
}

// ── GET /api/mining/kpis/points ──────────────────────────────────────
http::response<http::string_body>
handleGetKpiPoints(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
  const std::string code = query.count("code") ? query.at("code") : "";
  if (code.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "code_required"}});
  }
  int days = 7;
  if (query.count("days")) {
    try {
      days = std::max(1, std::min(90, std::stoi(query.at("days"))));
    } catch (...) {
      days = 7;
    }
  }
  json::array points;
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
    if (PQstatus(conn) == CONNECTION_OK) {
      std::string sql =
          "SELECT point_label, point_value::double precision, point_ts::text "
          "FROM mining_runtime_kpi_points WHERE kpi_code = " +
          pqEscapeLiteral(conn, code) + " AND point_ts >= NOW() - INTERVAL '" +
          std::to_string(days) +
          " days' ORDER BY point_ts ASC LIMIT 240";
      PGresult *res = PQexec(conn, sql.c_str());
      if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
        for (int i = 0; i < PQntuples(res); ++i) {
          points.push_back(json::object{{"label", PQgetvalue(res, i, 0)},
                                        {"value", std::atof(PQgetvalue(res, i, 1))},
                                        {"ts", PQgetvalue(res, i, 2)}});
        }
      }
      if (res) PQclear(res);
      PQfinish(conn);
    } else {
      PQfinish(conn);
    }
#endif
  }
  return makeJsonResponse(http::status::ok, json::object{{"points", points}});
}

} // namespace mining
