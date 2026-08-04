#include "kpi_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using auth::resolveAuthSession;

#define gAuthStorageMode  AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl      AppConfig::instance().gDatabaseUrl
// URL de lecturas (dashboards/KPIs): réplica read-only si está configurada.
#define gReadUrl          AppConfig::instance().readUrl()
#define gKpiExternalDatabaseUrl AppConfig::instance().gKpiExternalDatabaseUrl
#define gKpiExternalQuery AppConfig::instance().gKpiExternalQuery

namespace mining {

// ── GET /api/mining/kpis ─────────────────────────────────────────────
http::response<http::string_body>
handleGetKpis(const http::request<http::string_body>& req,
              const std::unordered_map<std::string, std::string>& query) {
  // Fix (auditoría de seguridad 2026-07-13): sin auth.
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  json::array rows;
  const std::string category =
      (query.count("category") && !query.at("category").empty()) ? query.at("category") : "";
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    // Lectura de dashboard → pool de RÉPLICA (offload del primario).
    auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      bool hasRuntimeTable = false;
      storage::PgResult resCheck{
          PQexec(conn, "SELECT to_regclass('public.mining_runtime_kpis')::text")};
      if (resCheck.okTuples() && PQntuples(resCheck.get()) > 0 &&
          !PQgetisnull(resCheck.get(), 0, 0)) {
        hasRuntimeTable = true;
      }

      if (hasRuntimeTable) {
        // Filtro opcional por categoría: $1 vacío = sin filtro (cortocircuito
        // en SQL), evitando construir dos variantes de la consulta.
        static const char *kListKpisSql =
            "SELECT code, category, title, COALESCE(description,''), unit, "
            "current_value::double precision, target_value::double precision, "
            "trend_direction, trend_percent::double precision, status_color, "
            "updated_at::text "
            "FROM mining_runtime_kpis WHERE active = TRUE "
            "AND ($1 = '' OR category = $1) "
            "ORDER BY category ASC, sort_order ASC, title ASC";
        const char *listParams[1] = {category.c_str()};
        storage::PgResult res{PQexecParams(conn, kListKpisSql, 1, nullptr,
                                           listParams, nullptr, nullptr, 0)};
        if (res.okTuples()) {
          for (int i = 0; i < PQntuples(res.get()); ++i) {
            json::object item;
            item["code"] = std::string(PQgetvalue(res.get(), i, 0));
            item["category"] = std::string(PQgetvalue(res.get(), i, 1));
            item["title"] = std::string(PQgetvalue(res.get(), i, 2));
            item["description"] = std::string(PQgetvalue(res.get(), i, 3));
            item["unit"] = std::string(PQgetvalue(res.get(), i, 4));
            item["current_value"] = std::atof(PQgetvalue(res.get(), i, 5));
            if (PQgetisnull(res.get(), i, 6)) {
              item["target_value"] = nullptr;
            } else {
              item["target_value"] = std::atof(PQgetvalue(res.get(), i, 6));
            }
            item["trend_direction"] = std::string(PQgetvalue(res.get(), i, 7));
            item["trend_percent"] = std::atof(PQgetvalue(res.get(), i, 8));
            item["status_color"] = std::string(PQgetvalue(res.get(), i, 9));
            item["updated_at"] =
                PQgetisnull(res.get(), i, 10) ? std::string() : std::string(PQgetvalue(res.get(), i, 10));
            rows.push_back(std::move(item));
          }
        }
      }

      if (rows.empty()) {
        storage::PgResult resFallback{PQexec(
            conn,
            "SELECT name, value::double precision, unit, trend, trend_value::double precision "
            "FROM dashboard_kpis ORDER BY name ASC")};
        if (resFallback.okTuples()) {
          for (int i = 0; i < PQntuples(resFallback.get()); ++i) {
            json::object item;
            item["code"] = std::string(PQgetvalue(resFallback.get(), i, 0));
            item["category"] = std::string("general");
            item["title"] = std::string(PQgetvalue(resFallback.get(), i, 0));
            item["description"] = std::string();
            item["unit"] = std::string(PQgetvalue(resFallback.get(), i, 2));
            item["current_value"] = std::atof(PQgetvalue(resFallback.get(), i, 1));
            item["target_value"] = nullptr;
            item["trend_direction"] = std::string(PQgetvalue(resFallback.get(), i, 3));
            item["trend_percent"] = std::atof(PQgetvalue(resFallback.get(), i, 4));
            item["status_color"] = std::string("green");
            item["updated_at"] = std::string();
            rows.push_back(std::move(item));
          }
        }
      }
      return makeJsonResponse(http::status::ok, json::object{{"kpis", rows}});
    }
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

    auto __pg_lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "db_unavailable"}});
    }

    { storage::PgResult beginRes{PQexec(conn, "BEGIN")}; }

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

      // Upsert parametrizado: los numéricos viajan como texto y Postgres los
      // castea al tipo de columna; target_value nullable → nullptr = SQL NULL.
      // Los std::string locales mantienen vivos los c_str() hasta el exec.
      const std::string currentValueStr = std::to_string(currentValue);
      const std::string targetValueStr = std::to_string(targetValue);
      const std::string trendPercentStr = std::to_string(trendPercent);
      const std::string sortOrderStr = std::to_string(sortOrder);
      const char *kpiParams[12] = {
          code.c_str(),
          cat.c_str(),
          title.c_str(),
          description.c_str(),
          unit.c_str(),
          currentValueStr.c_str(),
          hasTarget ? targetValueStr.c_str() : nullptr,
          trendDirection.c_str(),
          trendPercentStr.c_str(),
          statusColor.c_str(),
          active ? "true" : "false",
          sortOrderStr.c_str()};
      static const char *kUpsertKpiSql =
          "INSERT INTO mining_runtime_kpis "
          "(code, category, title, description, unit, current_value, "
          "target_value, trend_direction, trend_percent, status_color, "
          "active, sort_order, updated_at) "
          "VALUES ($1, $2, $3, $4, $5, $6::double precision, "
          "$7::double precision, $8, $9::double precision, $10, "
          "$11::boolean, $12::int, NOW()) "
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

      storage::PgResult res{PQexecParams(conn, kUpsertKpiSql, 12, nullptr, kpiParams,
                                         nullptr, nullptr, 0)};
      if (!res.okCommand()) {
        storage::PgResult rbRes{PQexec(conn, "ROLLBACK")};
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "kpi_upsert_failed"}, {"code", code}});
      }
      const char *pointParams[2] = {code.c_str(), currentValueStr.c_str()};
      static const char *kInsertKpiPointSql =
          "INSERT INTO mining_runtime_kpi_points"
          "(kpi_code, point_label, point_value, point_ts) "
          "VALUES ($1, 'runtime', $2::double precision, NOW())";
      storage::PgResult ptRes{PQexecParams(conn, kInsertKpiPointSql, 2, nullptr,
                                           pointParams, nullptr, nullptr, 0)};
      upserted += 1;
    }

    { storage::PgResult commitRes{PQexec(conn, "COMMIT")}; }
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
  // Fix (auditoría de seguridad 2026-07-13): endpoint de ESCRITURA (fuerza un
  // resync de KPIs) sin ningún chequeo de auth.
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "postgres_required"}});
  }
#if HAS_LIBPQ
  auto __pg_lease = storage::PgPool::instance().acquire(gDatabaseUrl);
  PGconn *conn = __pg_lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  { storage::PgResult beginRes{PQexec(conn, "BEGIN")}; }
  bool hasDashboardKpis = false;
  {
    storage::PgResult checkRes{PQexec(conn, "SELECT to_regclass('public.dashboard_kpis')::text")};
    if (checkRes.okTuples() && PQntuples(checkRes.get()) > 0 &&
        !PQgetisnull(checkRes.get(), 0, 0)) {
      hasDashboardKpis = true;
    }
  }
  if (!hasDashboardKpis) {
    int runtimeCount = 0;
    int touched = 0;
    {
      storage::PgResult touchRes{PQexec(
          conn,
          "WITH moved AS ("
          "  INSERT INTO mining_runtime_kpi_points(kpi_code, point_label, point_value, point_ts) "
          "  SELECT code, 'sync_runtime_touch', current_value::double precision, NOW() "
          "  FROM mining_runtime_kpis WHERE active = TRUE RETURNING 1"
          ") SELECT COUNT(*)::int FROM moved")};
      if (touchRes.okTuples() && PQntuples(touchRes.get()) > 0) {
        touched = std::atoi(PQgetvalue(touchRes.get(), 0, 0));
      }
    }
    { storage::PgResult updRes{PQexec(conn, "UPDATE mining_runtime_kpis SET updated_at = NOW() WHERE active = TRUE")}; }
    {
      storage::PgResult cntRes{PQexec(conn, "SELECT COUNT(*)::int FROM mining_runtime_kpis WHERE active = TRUE")};
      if (cntRes.okTuples() && PQntuples(cntRes.get()) > 0) {
        runtimeCount = std::atoi(PQgetvalue(cntRes.get(), 0, 0));
      }
    }
    { storage::PgResult commitRes{PQexec(conn, "COMMIT")}; }
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"},
                                         {"synced", touched},
                                         {"existing_runtime", runtimeCount},
                                         {"message", "Origen dashboard no configurado; se mantienen KPI runtime"}});
  }
  storage::PgResult src{
      PQexec(conn,
             "SELECT name, value::double precision, unit, trend, trend_value::double precision "
             "FROM dashboard_kpis ORDER BY name ASC")};
  if (!src.okTuples()) {
    int runtimeCount = 0;
    int touched = 0;
    {
      storage::PgResult touchRes{PQexec(
          conn,
          "WITH moved AS ("
          "  INSERT INTO mining_runtime_kpi_points(kpi_code, point_label, point_value, point_ts) "
          "  SELECT code, 'sync_runtime_touch', current_value::double precision, NOW() "
          "  FROM mining_runtime_kpis WHERE active = TRUE RETURNING 1"
          ") SELECT COUNT(*)::int FROM moved")};
      if (touchRes.okTuples() && PQntuples(touchRes.get()) > 0) {
        touched = std::atoi(PQgetvalue(touchRes.get(), 0, 0));
      }
    }
    { storage::PgResult updRes{PQexec(conn, "UPDATE mining_runtime_kpis SET updated_at = NOW() WHERE active = TRUE")}; }
    {
      storage::PgResult cntRes{PQexec(conn, "SELECT COUNT(*)::int FROM mining_runtime_kpis WHERE active = TRUE")};
      if (cntRes.okTuples() && PQntuples(cntRes.get()) > 0) {
        runtimeCount = std::atoi(PQgetvalue(cntRes.get(), 0, 0));
      }
    }
    { storage::PgResult commitRes{PQexec(conn, "COMMIT")}; }
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"},
                                         {"synced", touched},
                                         {"existing_runtime", runtimeCount},
                                         {"message", "Origen dashboard sin datos; se mantienen KPI runtime"}});
  }
  int synced = 0;
  for (int i = 0; i < PQntuples(src.get()); ++i) {
    const std::string name = PQgetvalue(src.get(), i, 0);
    const double value = std::atof(PQgetvalue(src.get(), i, 1));
    const std::string unit = PQgetisnull(src.get(), i, 2) ? std::string() : std::string(PQgetvalue(src.get(), i, 2));
    const std::string trend = PQgetisnull(src.get(), i, 3) ? std::string("flat") : std::string(PQgetvalue(src.get(), i, 3));
    const double trendValue = PQgetisnull(src.get(), i, 4) ? 0.0 : std::atof(PQgetvalue(src.get(), i, 4));
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
    const std::string valueStr = std::to_string(value);
    const std::string trendValueStr = std::to_string(trendValue);
    const char *syncParams[6] = {name.c_str(),     cat.c_str(),
                                 unit.c_str(),     valueStr.c_str(),
                                 trend.c_str(),    trendValueStr.c_str()};
    static const char *kSyncKpiSql =
        "INSERT INTO mining_runtime_kpis "
        "(code, category, title, description, unit, current_value, "
        "target_value, trend_direction, trend_percent, status_color, active, "
        "sort_order, updated_at) "
        "VALUES ($1, $2, $1, ''::text, $3, $4::double precision, "
        "NULL::double precision, $5, $6::double precision, 'green', TRUE, "
        "900, NOW()) "
        "ON CONFLICT (code) DO UPDATE SET "
        "category=EXCLUDED.category, title=EXCLUDED.title, "
        "unit=EXCLUDED.unit, current_value=EXCLUDED.current_value, "
        "trend_direction=EXCLUDED.trend_direction, "
        "trend_percent=EXCLUDED.trend_percent, updated_at=NOW()";
    storage::PgResult upRes{PQexecParams(conn, kSyncKpiSql, 6, nullptr, syncParams,
                                         nullptr, nullptr, 0)};
    if (!upRes.okCommand()) {
      storage::PgResult rbRes{PQexec(conn, "ROLLBACK")};
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "sync_failed"}});
    }
    const char *pointParams[2] = {name.c_str(), valueStr.c_str()};
    static const char *kSyncPointSql =
        "INSERT INTO mining_runtime_kpi_points"
        "(kpi_code, point_label, point_value, point_ts) "
        "VALUES ($1, 'sync_dashboard', $2::double precision, NOW())";
    storage::PgResult ptRes{PQexecParams(conn, kSyncPointSql, 2, nullptr,
                                         pointParams, nullptr, nullptr, 0)};
    synced += 1;
  }
  { storage::PgResult commitRes{PQexec(conn, "COMMIT")}; }
  return makeJsonResponse(http::status::ok, json::object{{"status", "ok"}, {"synced", synced}});
#else
  return makeJsonResponse(http::status::bad_request, json::object{{"error", "postgres_not_compiled"}});
#endif
}

// ── POST /api/mining/kpis/sync-from-external ─────────────────────────
http::response<http::string_body>
handleSyncFromExternal(const http::request<http::string_body>& req,
                       const std::unordered_map<std::string, std::string>& query) {
  // Fix (auditoría de seguridad 2026-07-13): endpoint de ESCRITURA sin auth.
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
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

  auto __local_lease = storage::PgPool::instance().acquire(gDatabaseUrl);
  PGconn *localConn = __local_lease.get();
  if (PQstatus(localConn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  // extConn usa una URL externa diferente → fuera del pool (pool keyed por una sola URL).
  storage::PgConn extConnGuard{PQconnectdb(gKpiExternalDatabaseUrl.c_str())};
  PGconn *extConn = extConnGuard.get();
  if (PQstatus(extConn) != CONNECTION_OK) {
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
  storage::PgResult extRows{PQexec(extConn, querySql.c_str())};
  if (!extRows.okTuples()) {
    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "ok"},
                                         {"synced", 0},
                                         {"message", "external_query_failed"}});
  }

  { storage::PgResult beginRes{PQexec(localConn, "BEGIN")}; }

  int synced = 0;
  for (int i = 0; i < PQntuples(extRows.get()); ++i) {
    const std::string code = PQgetvalue(extRows.get(), i, 0);
    const std::string cat = PQgetvalue(extRows.get(), i, 1);
    const std::string title = PQgetvalue(extRows.get(), i, 2);
    const std::string description = PQgetvalue(extRows.get(), i, 3);
    const std::string unit = PQgetvalue(extRows.get(), i, 4);
    const double currentValue = std::atof(PQgetvalue(extRows.get(), i, 5));
    const bool hasTarget = !PQgetisnull(extRows.get(), i, 6);
    const double targetValue = hasTarget ? std::atof(PQgetvalue(extRows.get(), i, 6)) : 0.0;
    const std::string trendDirection = PQgetvalue(extRows.get(), i, 7);
    const double trendPercent = std::atof(PQgetvalue(extRows.get(), i, 8));
    const std::string statusColor = PQgetvalue(extRows.get(), i, 9);
    const int sortOrder = std::atoi(PQgetvalue(extRows.get(), i, 10));
    const bool active =
        std::string(PQgetvalue(extRows.get(), i, 11)) == "t" || std::string(PQgetvalue(extRows.get(), i, 11)) == "true";

    const std::string currentValueStr = std::to_string(currentValue);
    const std::string targetValueStr = std::to_string(targetValue);
    const std::string trendPercentStr = std::to_string(trendPercent);
    const std::string sortOrderStr = std::to_string(sortOrder);
    const char *upsertParams[12] = {
        code.c_str(),
        cat.c_str(),
        title.c_str(),
        description.c_str(),
        unit.c_str(),
        currentValueStr.c_str(),
        hasTarget ? targetValueStr.c_str() : nullptr,
        trendDirection.c_str(),
        trendPercentStr.c_str(),
        statusColor.c_str(),
        active ? "true" : "false",
        sortOrderStr.c_str()};
    static const char *kUpsertExtKpiSql =
        "INSERT INTO mining_runtime_kpis "
        "(code, category, title, description, unit, current_value, "
        "target_value, trend_direction, trend_percent, status_color, active, "
        "sort_order, updated_at) "
        "VALUES ($1, $2, $3, $4, $5, $6::double precision, "
        "$7::double precision, $8, $9::double precision, $10, $11::boolean, "
        "$12::int, NOW()) "
        "ON CONFLICT (code) DO UPDATE SET "
        "category = EXCLUDED.category, title = EXCLUDED.title, "
        "description = EXCLUDED.description, unit = EXCLUDED.unit, "
        "current_value = EXCLUDED.current_value, "
        "target_value = EXCLUDED.target_value, "
        "trend_direction = EXCLUDED.trend_direction, "
        "trend_percent = EXCLUDED.trend_percent, "
        "status_color = EXCLUDED.status_color, active = EXCLUDED.active, "
        "sort_order = EXCLUDED.sort_order, updated_at = NOW()";
    storage::PgResult upRes{PQexecParams(localConn, kUpsertExtKpiSql, 12, nullptr,
                                         upsertParams, nullptr, nullptr, 0)};
    if (!upRes.okCommand()) {
      storage::PgResult rbRes{PQexec(localConn, "ROLLBACK")};
      return makeJsonResponse(http::status::ok,
                              json::object{{"status", "ok"}, {"synced", synced}, {"message", "sync_partial_failed"}});
    }
    const char *extPointParams[2] = {code.c_str(), currentValueStr.c_str()};
    static const char *kInsertExtPointSql =
        "INSERT INTO mining_runtime_kpi_points"
        "(kpi_code, point_label, point_value, point_ts) "
        "VALUES ($1, 'sync_external', $2::double precision, NOW())";
    storage::PgResult ptRes{PQexecParams(localConn, kInsertExtPointSql, 2, nullptr,
                                         extPointParams, nullptr, nullptr, 0)};
    synced += 1;
  }

  { storage::PgResult commitRes{PQexec(localConn, "COMMIT")}; }
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
  // Fix (auditoría de seguridad 2026-07-13): sin auth.
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
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
    // Lectura de serie de puntos → pool de RÉPLICA.
    auto __pg_lease = storage::PgPool::replica().acquire(gReadUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      // El intervalo se calcula con make_interval(days => $2::int) en lugar
      // de interpolar el número dentro del literal INTERVAL.
      const std::string daysStr = std::to_string(days);
      const char *ptsParams[2] = {code.c_str(), daysStr.c_str()};
      static const char *kKpiPointsSql =
          "SELECT point_label, point_value::double precision, point_ts::text "
          "FROM mining_runtime_kpi_points WHERE kpi_code = $1 "
          "AND point_ts >= NOW() - make_interval(days => $2::int) "
          "ORDER BY point_ts ASC LIMIT 240";
      storage::PgResult res{PQexecParams(conn, kKpiPointsSql, 2, nullptr, ptsParams,
                                         nullptr, nullptr, 0)};
      if (res.okTuples()) {
        for (int i = 0; i < PQntuples(res.get()); ++i) {
          points.push_back(json::object{{"label", PQgetvalue(res.get(), i, 0)},
                                        {"value", std::atof(PQgetvalue(res.get(), i, 1))},
                                        {"ts", PQgetvalue(res.get(), i, 2)}});
        }
      }
    } else {
    }
#endif
  }
  return makeJsonResponse(http::status::ok, json::object{{"points", points}});
}

} // namespace mining
