#include "map_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../map_geo_intersect.hpp"

#include <ctime>
#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using http_utils::makeJsonResponse;
using config::AppConfig;
using config::AuthStorageMode;

namespace map_mod {

static http::response<http::string_body>
handleMapMarkers(const http::request<http::string_body> & /*req*/,
                 const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    json::array markers;
    if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
        auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
        PGconn *conn = __pg_lease.get();
        if (PQstatus(conn) == CONNECTION_OK) {
            storage::PgResult res{PQexec(
                conn, "SELECT id, type, lat, lng, name, status, updated_at FROM map_markers")};
            if (res.okTuples()) {
                const int rows = PQntuples(res.get());
                const int nfields = PQnfields(res.get());
                for (int i = 0; i < rows; ++i) {
                    json::object mo{{"id", std::stoi(PQgetvalue(res.get(), i, 0))},
                                    {"type", PQgetvalue(res.get(), i, 1)},
                                    {"lat", std::stod(PQgetvalue(res.get(), i, 2))},
                                    {"lng", std::stod(PQgetvalue(res.get(), i, 3))},
                                    {"name", PQgetvalue(res.get(), i, 4)},
                                    {"status", PQgetvalue(res.get(), i, 5)}};
                    if (nfields >= 7 && !PQgetisnull(res.get(), i, 6))
                        mo["updated_at"] = PQgetvalue(res.get(), i, 6);
                    markers.push_back(std::move(mo));
                }
            }
            return makeJsonResponse(http::status::ok, json::object{{"markers", markers}});
        }
#endif
    }
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", "db_unavailable"}});
}

static http::response<http::string_body>
handleOfficialZones(const http::request<http::string_body> & /*req*/,
                    const std::unordered_map<std::string, std::string> & /*query*/) {
    const char *zoneOverride = std::getenv("OFFICIAL_ZONES_GEOJSON");
    std::string dataRoot = config::getenvOr("MAPAS_DATA_ROOT", "/data");
    const std::string zonePath =
        (zoneOverride && *zoneOverride) ? std::string(zoneOverride)
                                        : (dataRoot + "/map_official_polygons.geojson");
    std::string readErr;
    const std::string raw = mapgeo::readFileUtf8(zonePath, readErr);
    if (raw.empty()) {
        return makeJsonResponse(http::status::ok,
                                json::object{{"type", "FeatureCollection"}, {"features", json::array{}}});
    }
    try {
        json::value parsed = json::parse(raw);
        return makeJsonResponse(http::status::ok, parsed);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "invalid_geojson_file"},
                                             {"detail", ex.what()},
                                             {"path", zonePath}});
    }
}

static http::response<http::string_body>
handleComplianceIntersections(const http::request<http::string_body> & /*req*/,
                              const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    std::string dataRoot = config::getenvOr("MAPAS_DATA_ROOT", "/data");
    const char *zoneOverride = std::getenv("OFFICIAL_ZONES_GEOJSON");
    const std::string zonePath =
        (zoneOverride && *zoneOverride) ? std::string(zoneOverride)
                                        : (dataRoot + "/map_official_polygons.geojson");
    std::string readErr;
    const std::string raw = mapgeo::readFileUtf8(zonePath, readErr);
    std::vector<mapgeo::OfficialPolygon> zones;
    std::string parseErr;
    bool parsedOk = false;
    if (!raw.empty()) {
        parsedOk = mapgeo::parseOfficialGeoJson(raw, zones, parseErr);
        if (!parsedOk) zones.clear();
    }
    const bool zones_loaded = !raw.empty() && parsedOk;

    std::vector<mapgeo::MapMarkerRow> markerRows;
    if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
        auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
        PGconn *conn = __pg_lease.get();
        if (PQstatus(conn) == CONNECTION_OK) {
            storage::PgResult res{PQexec(
                conn, "SELECT id, type, lat, lng, name, status FROM map_markers")};
            if (res.okTuples()) {
                const int rows = PQntuples(res.get());
                markerRows.reserve(static_cast<size_t>(rows));
                for (int i = 0; i < rows; ++i) {
                    mapgeo::MapMarkerRow m;
                    m.id = std::stoi(PQgetvalue(res.get(), i, 0));
                    m.type = PQgetvalue(res.get(), i, 1);
                    m.lat = std::stod(PQgetvalue(res.get(), i, 2));
                    m.lng = std::stod(PQgetvalue(res.get(), i, 3));
                    m.name = PQgetvalue(res.get(), i, 4);
                    m.status = PQgetvalue(res.get(), i, 5);
                    markerRows.push_back(std::move(m));
                }
            }
        } else {
        }
#endif
    }

    std::time_t t = std::time(nullptr);
    std::tm tmBuf{};
#ifdef _WIN32
    gmtime_s(&tmBuf, &t);
#else
    gmtime_r(&t, &tmBuf);
#endif
    char timeStr[64];
    std::strftime(timeStr, sizeof timeStr, "%Y-%m-%dT%H:%M:%SZ", &tmBuf);

    json::object body = mapgeo::buildIntersectionsResponse(timeStr, zonePath, zones_loaded, zones, markerRows);
    if (!raw.empty() && !parsedOk) body["geojson_error"] = parseErr;
    return makeJsonResponse(http::status::ok, body);
}

void registerRoutes(router::Router &r) {
    r.get("/api/map/markers", handleMapMarkers);
    r.get("/api/map/official-zones", handleOfficialZones);
    r.get("/api/map/compliance-intersections", handleComplianceIntersections);
}

} // namespace map_mod
