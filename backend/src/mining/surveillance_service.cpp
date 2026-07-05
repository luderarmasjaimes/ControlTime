#include "surveillance_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../security/validators.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

namespace fs = std::filesystem;

using config::AppConfig;
using config::AuthStorageMode;
using http_utils::makeJsonResponse;
using http_utils::makeJpegResponse;
using http_utils::makeId;
using auth::resolveAuthSession;

#define gAuthStorageMode AppConfig::instance().gAuthStorageMode
#define gDatabaseUrl     AppConfig::instance().gDatabaseUrl

// Quoting robusto para pasar rutas a un shell sin abrir vector de inyección.
// POSIX: comillas simples + escape de comilla simple embebida ('\'') → el shell
// trata TODO el contenido como literal (neutraliza $, `, \, ;, |, espacios...).
// Windows (cmd): comillas dobles; las rutas provienen de temp_directory_path()
// + tag alfanumérico (makeId()), sin metacaracteres.
//
// NOTA: la mitigación definitiva es evitar el shell (posix_spawn / CreateProcess
// con argv en arreglo). Ver seguimiento en MASTER_REFACTORING_AUDIT.md. El
// streamUrl del usuario NO viaja por línea de comando: se escribe a un archivo
// temporal y se pasa la ruta del archivo.
static std::string quotePath(const std::string &path) {
#ifdef _WIN32
    return "\"" + path + "\"";
#else
    std::string out;
    out.reserve(path.size() + 2);
    out.push_back('\'');
    for (const char c : path) {
        if (c == '\'') {
            out += "'\\''";  // cierra comilla, escapa ', reabre comilla
        } else {
            out.push_back(c);
        }
    }
    out.push_back('\'');
    return out;
#endif
}

// ── Embedded 1×1 mid-gray JFIF JPEG (331 bytes) ──────────────────────────
// Codificado manualmente desde la especificación JPEG (Annex K Huffman tables).
// DC=0 (pixel=128 tras level-shift), AC=EOB → 1×1 pixel gris #808080.
// Bytes verificados: SOI, APP0 JFIF 1.1, DQT all-ones, SOF0 grayscale,
// DHT DC/AC luma estándar, SOS, entropy 0x2B (DC diff=0, AC EOB), EOI.
static const uint8_t kOfflineJpeg[] = {
    0xFF,0xD8,                                          // SOI
    0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,      // APP0 marker+len+JFIF\0
    0x01,0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,      // v1.1, no-units, 1×1, no-thumb
    0xFF,0xDB,0x00,0x43,0x00,                           // DQT len=67, table-0
    0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,           // 64 quant values = 1 (lossless)
    0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,
    0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,
    0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,
    0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,
    0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,
    0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,
    0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,
    0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,0x00,0x01,      // SOF0 len=11, 8-bit, 1×1
    0x01,0x01,0x11,0x00,                                // 1 comp, gray, H1V1, qtable-0
    0xFF,0xC4,0x00,0x1F,0x00,                           // DHT DC luma len=31
    0x00,0x01,0x05,0x01,0x01,0x01,0x01,0x01,           // BITS[1..8]
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,           // BITS[9..16]
    0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,           // HUFFVAL[0..7]
    0x08,0x09,0x0A,0x0B,                                // HUFFVAL[8..11]
    0xFF,0xC4,0x00,0xB5,0x10,                           // DHT AC luma len=181
    0x00,0x02,0x01,0x03,0x03,0x02,0x04,0x03,           // BITS[1..8]
    0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7D,           // BITS[9..16]
    0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,           // HUFFVAL[0..7]
    0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,
    0x22,0x71,0x14,0x32,0x81,0x91,0xA1,0x08,
    0x23,0x42,0xB1,0xC1,0x15,0x52,0xD1,0xF0,
    0x24,0x33,0x62,0x72,0x82,0x09,0x0A,0x16,
    0x17,0x18,0x19,0x1A,0x25,0x26,0x27,0x28,
    0x29,0x2A,0x34,0x35,0x36,0x37,0x38,0x39,
    0x3A,0x43,0x44,0x45,0x46,0x47,0x48,0x49,
    0x4A,0x53,0x54,0x55,0x56,0x57,0x58,0x59,
    0x5A,0x63,0x64,0x65,0x66,0x67,0x68,0x69,
    0x6A,0x73,0x74,0x75,0x76,0x77,0x78,0x79,
    0x7A,0x83,0x84,0x85,0x86,0x87,0x88,0x89,
    0x8A,0x92,0x93,0x94,0x95,0x96,0x97,0x98,
    0x99,0x9A,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,
    0xA8,0xA9,0xAA,0xB2,0xB3,0xB4,0xB5,0xB6,
    0xB7,0xB8,0xB9,0xBA,0xC2,0xC3,0xC4,0xC5,
    0xC6,0xC7,0xC8,0xC9,0xCA,0xD2,0xD3,0xD4,
    0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xE1,0xE2,
    0xE3,0xE4,0xE5,0xE6,0xE7,0xE8,0xE9,0xEA,
    0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,
    0xF9,0xFA,
    0xFF,0xDA,0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00, // SOS len=8
    0x2B,                                               // entropy: DC=0 (mid-gray), EOB
    0xFF,0xD9                                           // EOI
};

// Devuelve respuesta JPEG de placeholder (cámara offline / script fallido).
// Prioridad: env SURVEILLANCE_OFFLINE_PLACEHOLDER → kOfflineJpeg embebido.
static http::response<http::string_body> makeCameraOfflinePlaceholder() {
    if (const char *p = std::getenv("SURVEILLANCE_OFFLINE_PLACEHOLDER"); p && *p) {
        std::ifstream pf(p, std::ios::binary);
        if (pf) {
            std::string bytes((std::istreambuf_iterator<char>(pf)), {});
            if (bytes.size() >= 64)
                return makeJpegResponse(std::move(bytes));
        }
    }
    return makeJpegResponse(
        std::string(reinterpret_cast<const char *>(kOfflineJpeg), sizeof(kOfflineJpeg)));
}

namespace mining {

// ── GET /api/surveillance/cameras ────────────────────────────────────
http::response<http::string_body>
handleGetCameras(const http::request<http::string_body>& req,
                 const std::unordered_map<std::string, std::string>& query) {
  json::array cameras;
  if (gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
    auto __pg_lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
      const auto itTenantCam = query.find("tenant_id");
      const bool scopedCam = itTenantCam != query.end() && !itTenantCam->second.empty();
      // Scoped: filtra por tenant con parámetro $1. No-scoped: sin filtro.
      storage::PgResult res;
      if (scopedCam) {
        const char *scopeParams[1] = {itTenantCam->second.c_str()};
        res = storage::PgResult{PQexecParams(
            conn,
            "SELECT id, name, location, rtmp_url, status, lat, lng, "
            "tenant_id::text FROM surveillance_cameras "
            "WHERE tenant_id = $1::uuid ORDER BY id ASC",
            1, nullptr, scopeParams, nullptr, nullptr, 0)};
      } else {
        res = storage::PgResult{PQexec(conn,
                     "SELECT id, name, location, rtmp_url, status, lat, lng, "
                     "tenant_id::text FROM surveillance_cameras "
                     "ORDER BY tenant_id ASC, id ASC")};
      }
      if (res.okTuples()) {
        int rows = PQntuples(res.get());
        for (int i = 0; i < rows; ++i) {
          cameras.push_back(json::object{
              {"id", std::stoi(PQgetvalue(res.get(), i, 0))},
              {"name", PQgetvalue(res.get(), i, 1)},
              {"location", PQgetvalue(res.get(), i, 2)},
              {"rtmp_url", PQgetvalue(res.get(), i, 3)},
              {"status", PQgetvalue(res.get(), i, 4)},
              {"lat", std::stod(PQgetvalue(res.get(), i, 5))},
              {"lng", std::stod(PQgetvalue(res.get(), i, 6))},
              {"tenant_id", PQgetvalue(res.get(), i, 7)}});
        }
      }
      return makeJsonResponse(http::status::ok, json::object{{"cameras", cameras}});
    }
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
    auto __pg_lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "db_unavailable"}});
    }
    std::string streamUrl;
    try {
      const std::string cameraIdStr = std::to_string(cameraId);
      const char *camParams[2] = {cameraIdStr.c_str(),
                                  itTenant->second.c_str()};
      storage::PgResult res{PQexecParams(
          conn,
          "SELECT rtmp_url FROM surveillance_cameras "
          "WHERE id = $1::int AND tenant_id = $2::uuid LIMIT 1",
          2, nullptr, camParams, nullptr, nullptr, 0)};
      if (!res.okTuples()) {
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "db_query_failed"}});
      }
      if (PQntuples(res.get()) == 0) {
        return makeJsonResponse(http::status::not_found,
                                json::object{{"error", "camera_not_found"}});
      }
      streamUrl = PQgetvalue(res.get(), 0, 0);
    } catch (...) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "invalid_tenant_id"}});
    }
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
    const std::string timeoutPrefix = "";  // no timeout wrapper on Windows dev
#else
    const std::string quietRedir = " > /dev/null 2>&1";
    // Timeout configurable: evita que un script colgado bloquee el hilo indefinidamente
    const int snapTimeout = []() {
        if (const char* e = std::getenv("SURVEILLANCE_SNAPSHOT_TIMEOUT_S")) {
            try { return std::max(1, std::stoi(e)); } catch (...) {}
        }
        return 15;
    }();
    const std::string timeoutPrefix = "timeout " + std::to_string(snapTimeout) + " ";
#endif
    const std::string cmd = timeoutPrefix + "python3 " +
                            quotePath(script) + " " +
                            quotePath(urlPath.string()) + " " +
                            quotePath(outPath.string()) + quietRedir;
    const int rc = std::system(cmd.c_str());
    fs::remove(urlPath);
    if (rc != 0 || !fs::exists(outPath)) {
      if (fs::exists(outPath))
        fs::remove(outPath);
      return makeCameraOfflinePlaceholder();
    }
    std::ifstream ifs(outPath, std::ios::binary);
    std::string content((std::istreambuf_iterator<char>(ifs)),
                        (std::istreambuf_iterator<char>()));
    fs::remove(outPath);
    if (content.size() < 64) {
      return makeCameraOfflinePlaceholder();
    }
    return makeJpegResponse(std::move(content));
  }
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}


// ── POST /api/surveillance/cameras ────────────────────────────────────
// Body: { name, location, rtmp_url, lat, lng, tenant_id }
http::response<http::string_body>
handleCreateCamera(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
#if HAS_LIBPQ
  json::value body;
  try { body = json::parse(req.body()); }
  catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  const auto& obj = body.as_object();
  const auto getStr = [&](const char* k, const char* def = "") -> std::string {
    if (auto it = obj.if_contains(k); it && it->is_string())
      return json::value_to<std::string>(*it);
    return def;
  };
  const std::string name     = getStr("name");
  const std::string location = getStr("location");
  const std::string rtmpUrl  = getStr("rtmp_url");
  const std::string tenantId = !session->tenantId.empty()
                                   ? session->tenantId
                                   : getStr("tenant_id");
  if (name.empty() || rtmpUrl.empty() || tenantId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "name, rtmp_url and tenant_id are required"}});
  }
  double lat = 0.0, lng = 0.0;
  if (auto it = obj.if_contains("lat"); it && it->is_double())
    lat = it->as_double();
  if (auto it = obj.if_contains("lng"); it && it->is_double())
    lng = it->as_double();
  // Rechaza NaN/Inf y coordenadas fuera de rango antes de tocar la BD.
  if (!security::Validator::isValidLatitude(lat) ||
      !security::Validator::isValidLongitude(lng)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_coordinates"}});
  }

  auto __pg = storage::PgPool::instance().acquire(gDatabaseUrl);
  PGconn* conn = __pg.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  try {
    // INSERT parametrizado: lat/lng viajan como texto y castean a la columna.
    const std::string latStr = std::to_string(lat);
    const std::string lngStr = std::to_string(lng);
    const char* camParams[6] = {name.c_str(),   location.c_str(),
                                rtmpUrl.c_str(), latStr.c_str(),
                                lngStr.c_str(),  tenantId.c_str()};
    static const char* kInsertCameraSql =
        "INSERT INTO surveillance_cameras "
        "(name, location, rtmp_url, lat, lng, status, tenant_id) "
        "VALUES ($1, $2, $3, $4::double precision, $5::double precision, "
        "'active', $6::uuid) "
        "RETURNING id, name, location, rtmp_url, status, lat, lng, "
        "tenant_id::text";
    storage::PgResult res{PQexecParams(conn, kInsertCameraSql, 6, nullptr, camParams,
                                       nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "insert_failed"}});
    }
    json::object cam{
        {"id",        std::stoi(PQgetvalue(res.get(), 0, 0))},
        {"name",      PQgetvalue(res.get(), 0, 1)},
        {"location",  PQgetvalue(res.get(), 0, 2)},
        {"rtmp_url",  PQgetvalue(res.get(), 0, 3)},
        {"status",    PQgetvalue(res.get(), 0, 4)},
        {"lat",       std::stod(PQgetvalue(res.get(), 0, 5))},
        {"lng",       std::stod(PQgetvalue(res.get(), 0, 6))},
        {"tenant_id", PQgetvalue(res.get(), 0, 7)}};
    return makeJsonResponse(http::status::created, cam);
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_params"}});
  }
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ── PUT /api/surveillance/cameras/<id> ────────────────────────────────
// Body: { name?, location?, rtmp_url?, status?, lat?, lng? }
// tenant_id del token (o query) se usa para verificar ownership.
http::response<http::string_body>
handleUpdateCamera(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
#if HAS_LIBPQ
  // Extraer ID desde la ruta: /api/surveillance/cameras/<id>
  std::string rawTarget(req.target());
  static const std::string kPrefix = "/api/surveillance/cameras/";
  int cameraId = 0;
  try {
    auto idStr = rawTarget.substr(kPrefix.size());
    auto q = idStr.find('?');
    if (q != std::string::npos) idStr = idStr.substr(0, q);
    cameraId = std::stoi(idStr);
  } catch (...) {}
  if (cameraId <= 0) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_camera_id"}});
  }

  json::value body;
  try { body = json::parse(req.body()); }
  catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  if (!body.is_object()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_json"}});
  }
  const auto& obj = body.as_object();
  const std::string tenantId = !session->tenantId.empty()
                                   ? session->tenantId
                                   : (query.count("tenant_id") ? query.at("tenant_id") : "");
  if (tenantId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "tenant_id required"}});
  }

  auto __pg = storage::PgPool::instance().acquire(gDatabaseUrl);
  PGconn* conn = __pg.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  try {
    // SET dinámico PARAMETRIZADO: cada campo presente añade "col = $N" y su
    // valor a paramValues; los dos últimos parámetros son id y tenant (WHERE).
    std::vector<std::string> setClauses;
    std::vector<std::string> paramValues;
    const auto addStr = [&](const char* col, const char* key) {
      if (auto it = obj.if_contains(key); it && it->is_string()) {
        paramValues.push_back(json::value_to<std::string>(*it));
        setClauses.push_back(std::string(col) + " = $" +
                             std::to_string(paramValues.size()));
      }
    };
    addStr("name",     "name");
    addStr("location", "location");
    addStr("rtmp_url", "rtmp_url");
    addStr("status",   "status");
    const auto addCoord = [&](const char* col, const char* key, bool isLat) {
      if (auto it = obj.if_contains(key); it && it->is_double()) {
        const double v = it->as_double();
        const bool valid = isLat ? security::Validator::isValidLatitude(v)
                                 : security::Validator::isValidLongitude(v);
        if (!valid) return;
        paramValues.push_back(std::to_string(v));
        setClauses.push_back(std::string(col) + " = $" +
                             std::to_string(paramValues.size()) +
                             "::double precision");
      }
    };
    addCoord("lat", "lat", true);
    addCoord("lng", "lng", false);

    if (setClauses.empty()) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "no_fields_to_update"}});
    }
    paramValues.push_back(std::to_string(cameraId));
    const std::size_t idIdx = paramValues.size();
    paramValues.push_back(tenantId);
    const std::size_t tenantIdx = paramValues.size();

    std::string setClause;
    for (std::size_t i = 0; i < setClauses.size(); ++i) {
      if (i) setClause += ", ";
      setClause += setClauses[i];
    }
    const std::string sql =
        "UPDATE surveillance_cameras SET " + setClause +
        " WHERE id = $" + std::to_string(idIdx) + "::int" +
        " AND tenant_id = $" + std::to_string(tenantIdx) + "::uuid "
        "RETURNING id, name, location, rtmp_url, status, lat, lng, tenant_id::text";
    std::vector<const char*> pv;
    pv.reserve(paramValues.size());
    for (const auto& p : paramValues) pv.push_back(p.c_str());
    storage::PgResult res{PQexecParams(conn, sql.c_str(),
                                       static_cast<int>(pv.size()), nullptr,
                                       pv.data(), nullptr, nullptr, 0)};
    if (!res.okTuples()) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "update_failed"}});
    }
    if (PQntuples(res.get()) == 0) {
      return makeJsonResponse(http::status::not_found,
                              json::object{{"error", "camera_not_found"}});
    }
    json::object cam{
        {"id",        std::stoi(PQgetvalue(res.get(), 0, 0))},
        {"name",      PQgetvalue(res.get(), 0, 1)},
        {"location",  PQgetvalue(res.get(), 0, 2)},
        {"rtmp_url",  PQgetvalue(res.get(), 0, 3)},
        {"status",    PQgetvalue(res.get(), 0, 4)},
        {"lat",       std::stod(PQgetvalue(res.get(), 0, 5))},
        {"lng",       std::stod(PQgetvalue(res.get(), 0, 6))},
        {"tenant_id", PQgetvalue(res.get(), 0, 7)}};
    return makeJsonResponse(http::status::ok, cam);
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_params"}});
  }
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

// ── DELETE /api/surveillance/cameras/<id> ─────────────────────────────
// tenant_id del token (o query) se usa para verificar ownership.
http::response<http::string_body>
handleDeleteCamera(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  }
  if (gAuthStorageMode != AuthStorageMode::Postgres) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
#if HAS_LIBPQ
  static const std::string kPrefix = "/api/surveillance/cameras/";
  int cameraId = 0;
  try {
    std::string rawTarget(req.target());
    auto idStr = rawTarget.substr(kPrefix.size());
    auto q = idStr.find('?');
    if (q != std::string::npos) idStr = idStr.substr(0, q);
    cameraId = std::stoi(idStr);
  } catch (...) {}
  if (cameraId <= 0) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_camera_id"}});
  }
  const std::string tenantId = !session->tenantId.empty()
                                   ? session->tenantId
                                   : (query.count("tenant_id") ? query.at("tenant_id") : "");
  if (tenantId.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "tenant_id required"}});
  }

  auto __pg = storage::PgPool::instance().acquire(gDatabaseUrl);
  PGconn* conn = __pg.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
  }
  try {
    const std::string cameraIdStr = std::to_string(cameraId);
    const char* delParams[2] = {cameraIdStr.c_str(), tenantId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "DELETE FROM surveillance_cameras "
        "WHERE id = $1::int AND tenant_id = $2::uuid",
        2, nullptr, delParams, nullptr, nullptr, 0)};
    const bool ok = res.okCommand()
                    && std::string(PQcmdTuples(res.get())) != "0";
    if (!ok) {
      return makeJsonResponse(http::status::not_found,
                              json::object{{"error", "camera_not_found"}});
    }
    return makeJsonResponse(http::status::ok,
                            json::object{{"deleted", cameraId}});
  } catch (...) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "invalid_params"}});
  }
#else
  return makeJsonResponse(http::status::internal_server_error,
                          json::object{{"error", "db_unavailable"}});
#endif
}

} // namespace mining
