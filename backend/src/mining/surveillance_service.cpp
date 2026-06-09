#include "surveillance_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using http_utils::makeJpegResponse;
using http_utils::makeId;
using auth::resolveAuthSession;
using auth::pqEscapeLiteral;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl     AppConfig::instance().gDatabaseUrl

static std::string quotePath(const std::string &path) {
    return "\"" + path + "\"";
}

namespace mining {

// ── GET /api/surveillance/cameras ────────────────────────────────────
http::response<http::string_body>
handleGetCameras(const http::request<http::string_body>& req,
                 const std::unordered_map<std::string, std::string>& query) {
  json::array cameras;
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
    if (PQstatus(conn) == CONNECTION_OK) {
      const auto itTenantCam = query.find("tenant_id");
      const bool scopedCam = itTenantCam != query.end() && !itTenantCam->second.empty();
      std::string sql;
      if (scopedCam) {
        try {
          const std::string litT = pqEscapeLiteral(conn, itTenantCam->second);
          sql = "SELECT id, name, location, rtmp_url, status, lat, lng, tenant_id::text FROM "
                "surveillance_cameras WHERE tenant_id = " +
                litT + "::uuid ORDER BY id ASC";
        } catch (...) {
          PQfinish(conn);
          return makeJsonResponse(http::status::bad_request,
                                  json::object{{"error", "invalid_scope_params"}});
        }
      } else {
        sql = "SELECT id, name, location, rtmp_url, status, lat, lng, tenant_id::text FROM "
              "surveillance_cameras ORDER BY tenant_id ASC, id ASC";
      }
      PGresult *res = PQexec(conn, sql.c_str());
      if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
        int rows = PQntuples(res);
        for (int i = 0; i < rows; ++i) {
          cameras.push_back(json::object{
              {"id", std::stoi(PQgetvalue(res, i, 0))},
              {"name", PQgetvalue(res, i, 1)},
              {"location", PQgetvalue(res, i, 2)},
              {"rtmp_url", PQgetvalue(res, i, 3)},
              {"status", PQgetvalue(res, i, 4)},
              {"lat", std::stod(PQgetvalue(res, i, 5))},
              {"lng", std::stod(PQgetvalue(res, i, 6))},
              {"tenant_id", PQgetvalue(res, i, 7)}});
        }
      }
      if (res) PQclear(res);
      PQfinish(conn);
      return makeJsonResponse(http::status::ok, json::object{{"cameras", cameras}});
    }
    PQfinish(conn);
#endif
  }
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
}

// ── GET /api/surveillance/camera-snapshot ─────────────────────────────
http::response<http::string_body>
handleCameraSnapshot(const http::request<http::string_body>& req,
                     const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  const auto itCam = query.find("camera_id");
  const auto itTenant = query.find("tenant_id");
  if (itCam == query.end() || itTenant == query.end() ||
      itCam->second.empty() || itTenant->second.empty()) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "camera_id and tenant_id are required"}});
  }
  int cameraId = 0;
  try {
    cameraId = std::stoi(itCam->second);
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid camera_id"}});
  }
  if (cameraId <= 0) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid camera_id"}});
  }
  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
#if HAS_LIBPQ
  {
    const char *scriptEnv = std::getenv("SURVEILLANCE_SNAPSHOT_SCRIPT");
    const std::string script =
        (scriptEnv && scriptEnv[0]) ? std::string(scriptEnv)
                                  : std::string("/app/scripts/surveillance_camera_snapshot.py");
    if (!fs::exists(script)) {
      return makeJsonResponse(http::status::service_unavailable,
                              json::object{{"error", "snapshot_tool_missing"}});
    }
    PGconn *conn = PQconnectdb(gDatabaseUrl.c_str());
    if (PQstatus(conn) != CONNECTION_OK) {
      PQfinish(conn);
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "db_unavailable"}});
    }
    std::string streamUrl;
    try {
      const std::string litT = pqEscapeLiteral(conn, itTenant->second);
      const std::string sql =
          "SELECT rtmp_url FROM surveillance_cameras WHERE id = " +
          std::to_string(cameraId) + " AND tenant_id = " + litT +
          "::uuid LIMIT 1";
      PGresult *res = PQexec(conn, sql.c_str());
      if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
        if (res)
          PQclear(res);
        PQfinish(conn);
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "db_query_failed"}});
      }
      if (PQntuples(res) == 0) {
        PQclear(res);
        PQfinish(conn);
        return makeJsonResponse(http::status::not_found,
                                json::object{{"error", "camera_not_found"}});
      }
      streamUrl = PQgetvalue(res, 0, 0);
      PQclear(res);
    } catch (...) {
      PQfinish(conn);
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "invalid_tenant_id"}});
    }
    PQfinish(conn);

    while (!streamUrl.empty() &&
           std::isspace(static_cast<unsigned char>(streamUrl.front()))) {
      streamUrl.erase(streamUrl.begin());
    }
    while (!streamUrl.empty() &&
           std::isspace(static_cast<unsigned char>(streamUrl.back()))) {
      streamUrl.pop_back();
    }
    if (streamUrl.empty()) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "empty_stream_url"}});
    }
    const bool httpOk =
        streamUrl.size() >= 8 &&
        (streamUrl.compare(0, 7, "http://") == 0 ||
         streamUrl.compare(0, 8, "https://") == 0);
    if (!httpOk) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "stream_url_not_http"}});
    }

    const auto tmpDir = fs::temp_directory_path();
    const std::string tag = makeId();
    const fs::path urlPath = tmpDir / ("ic_snap_url_" + tag + ".txt");
    const fs::path outPath = tmpDir / ("ic_snap_out_" + tag + ".jpg");
    {
      std::ofstream ofs(urlPath, std::ios::binary | std::ios::trunc);
      if (!ofs) {
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "temp_write_failed"}});
      }
      ofs << streamUrl;
    }
#ifdef _WIN32
    const std::string quietRedir = " > nul 2>&1";
#else
    const std::string quietRedir = " > /dev/null 2>&1";
#endif
    const std::string cmd = std::string("python3 ") + quotePath(script) + " " +
                            quotePath(urlPath.string()) + " " +
                            quotePath(outPath.string()) + quietRedir;
    const int rc = std::system(cmd.c_str());
    fs::remove(urlPath);
    if (rc != 0 || !fs::exists(outPath)) {
      if (fs::exists(outPath))
        fs::remove(outPath);
      return makeJsonResponse(http::status::bad_gateway,
                              json::object{{"error", "snapshot_failed"}});
    }
    std::ifstream ifs(outPath, std::ios::binary);
    std::string content((std::istreambuf_iterator<char>(ifs)),
                        (std::istreambuf_iterator<char>()));
    fs::remove(outPath);
    if (content.size() < 64) {
      return makeJsonResponse(http::status::bad_gateway,
                              json::object{{"error", "snapshot_empty"}});
    }
    return makeJpegResponse(std::move(content));
  }
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace mining
