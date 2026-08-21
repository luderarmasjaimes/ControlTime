#include "map_routes.hpp"
#include "wms_proxy.hpp"
#include "geocode_proxy.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../auth/auth_session.hpp"
#include "../map_geo_intersect.hpp"

#include <cstdlib>
#include <ctime>
#include <string>

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using http_utils::makeJsonResponse;
using config::AppConfig;
using config::AuthStorageMode;

namespace map_mod {

namespace {

// Límite duro: el mapa debe escalar a 10k sensores por unidad minera sin
// que un cliente (o un bug de zoom-out) pida el mundo entero de una vez.
constexpr int kDefaultMarkerLimit = 2000;
constexpr int kMaxMarkerLimit = 5000;

bool parseBboxParam(const std::unordered_map<std::string, std::string> &query,
                    const std::string &key, double defMin, double defMax,
                    double &outMin, double &outMax) {
    outMin = defMin;
    outMax = defMax;
    auto it = query.find(key);
    if (it == query.end() || it->second.empty()) return false;
    // Formato esperado: "min,max" (p.ej. bbox_lat=-17.3,-17.2).
    const std::string &v = it->second;
    const auto comma = v.find(',');
    if (comma == std::string::npos) return false;
    try {
        double a = std::stod(v.substr(0, comma));
        double b = std::stod(v.substr(comma + 1));
        outMin = std::min(a, b);
        outMax = std::max(a, b);
        return true;
    } catch (...) {
        return false;
    }
}

int parseLimitParam(const std::unordered_map<std::string, std::string> &query) {
    auto it = query.find("limit");
    if (it == query.end() || it->second.empty()) return kDefaultMarkerLimit;
    try {
        int v = std::stoi(it->second);
        if (v <= 0) return kDefaultMarkerLimit;
        return std::min(v, kMaxMarkerLimit);
    } catch (...) {
        return kDefaultMarkerLimit;
    }
}

} // namespace

// Marcadores del mapa, filtrados por tenant de la sesión (ADR de seguridad:
// antes de este cambio, esta ruta hacía SELECT * FROM map_markers sin WHERE
// alguno -- IDOR real de lectura cross-tenant, confirmado por grep, cero
// llamadas a auth::resolveAuthSession en todo el archivo). Ahora exige
// sesión válida y filtra por session->tenantId, igual que
// device_alarm_routes.cpp. También acepta bbox (bbox_lat=min,max &
// bbox_lng=min,max) + limit, para no forzar al cliente a traer 10k puntos
// cuando solo necesita el viewport visible.
static http::response<http::string_body>
handleMapMarkers(const http::request<http::string_body> &req,
                 const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }

    auto &cfg = AppConfig::instance();
    json::array markers;
    if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
        double latMin, latMax, lngMin, lngMax;
        parseBboxParam(query, "bbox_lat", -90.0, 90.0, latMin, latMax);
        parseBboxParam(query, "bbox_lng", -180.0, 180.0, lngMin, lngMax);
        const int limit = parseLimitParam(query);

        auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
        PGconn *conn = __pg_lease.get();
        if (PQstatus(conn) == CONNECTION_OK) {
            const std::string tenantId = session->tenantId;
            const std::string latMinS = std::to_string(latMin);
            const std::string latMaxS = std::to_string(latMax);
            const std::string lngMinS = std::to_string(lngMin);
            const std::string lngMaxS = std::to_string(lngMax);
            const std::string limitS = std::to_string(limit);

            // UNION de dos fuentes: (a) map_markers (equipo/personal/marcadores
            // manuales) y (b) sensors con lat/lng poblados (la tabla real de
            // ingesta, ver telemetry_ingest.cpp) para marcadores tipo "sensor" a
            // escala real de 10k filas. Ambas ramas filtran por tenant_id.
            // El bbox SIEMPRE se aplica (params 3-6 se rellenan con el rango
            // completo -90..90 / -180..180 si el cliente no pidió recorte) --
            // PQexecParams exige que la cantidad de params enviados coincida
            // EXACTO con los placeholders realmente presentes en el SQL, así
            // que no se puede omitir $3..$6 condicionalmente sin también
            // omitirlos del arreglo `params` (ver bug encontrado en pruebas:
            // "bind message supplies 6 parameters, but prepared statement
            // requires 2").
            std::string sql =
                "SELECT * FROM ("
                "  SELECT id::text AS id, type, lat, lng, name, status, "
                "         updated_at::text AS updated_at "
                "  FROM map_markers WHERE tenant_id = $1::uuid "
                "    AND lat BETWEEN $3::float8 AND $4::float8 "
                "    AND lng BETWEEN $5::float8 AND $6::float8 "
                "  UNION ALL "
                "  SELECT sensor_id::text AS id, 'sensor' AS type, lat, lng, "
                "         sensor_name AS name, connection_status AS status, "
                "         last_seen_at::text AS updated_at "
                "  FROM sensors "
                "  WHERE tenant_id = $1::uuid AND is_active = true "
                "    AND lat IS NOT NULL AND lng IS NOT NULL "
                "    AND lat BETWEEN $3::float8 AND $4::float8 "
                "    AND lng BETWEEN $5::float8 AND $6::float8 "
                ") u LIMIT $2::int";

            const char *params[6] = {tenantId.c_str(), limitS.c_str(),
                                     latMinS.c_str(),  latMaxS.c_str(),
                                     lngMinS.c_str(),  lngMaxS.c_str()};
            storage::PgResult res{PQexecParams(conn, sql.c_str(), 6, nullptr, params,
                                               nullptr, nullptr, 0)};
            if (!res.okTuples()) {
                return makeJsonResponse(
                    http::status::internal_server_error,
                    json::object{{"error", "query_failed"},
                                 {"detail", PQresultErrorMessage(res.get())}});
            }
            // "Modo campo" (ver frontend/src/lib/mapFieldMode.ts): con
            // conectividad DEGRADADA/recuperando de OFFLINE, el cliente pide
            // ?compact=1 -- formato tabla (claves una sola vez + filas de
            // valores posicionales) en vez de un array de objetos JSON
            // completos, para ahorrar bytes sobre un enlace 3G/satelital.
            const auto compactIt = query.find("compact");
            const bool wantCompact = compactIt != query.end() &&
                                     (compactIt->second == "1" || compactIt->second == "true");

            static const char *kFields[7] = {"id", "type",   "lat",        "lng",
                                             "name", "status", "updated_at"};
            json::array compactRows;

            {
                const int rows = PQntuples(res.get());
                const int nfields = PQnfields(res.get());
                for (int i = 0; i < rows; ++i) {
                    if (PQgetisnull(res.get(), i, 2) || PQgetisnull(res.get(), i, 3))
                        continue; // lat/lng nulos (sensor sin geolocalizar): no renderizable
                    const double lat = std::stod(PQgetvalue(res.get(), i, 2));
                    const double lng = std::stod(PQgetvalue(res.get(), i, 3));
                    const bool hasUpdatedAt = nfields >= 7 && !PQgetisnull(res.get(), i, 6);
                    if (wantCompact) {
                        json::array row{PQgetvalue(res.get(), i, 0), PQgetvalue(res.get(), i, 1),
                                        lat,                          lng,
                                        PQgetvalue(res.get(), i, 4), PQgetvalue(res.get(), i, 5)};
                        row.push_back(hasUpdatedAt ? json::value(PQgetvalue(res.get(), i, 6))
                                                   : json::value(nullptr));
                        compactRows.push_back(std::move(row));
                        continue;
                    }
                    json::object mo{{"id", PQgetvalue(res.get(), i, 0)},
                                    {"type", PQgetvalue(res.get(), i, 1)},
                                    {"lat", lat},
                                    {"lng", lng},
                                    {"name", PQgetvalue(res.get(), i, 4)},
                                    {"status", PQgetvalue(res.get(), i, 5)}};
                    if (hasUpdatedAt) mo["updated_at"] = PQgetvalue(res.get(), i, 6);
                    markers.push_back(std::move(mo));
                }
            }

            if (wantCompact) {
                json::array keys(std::begin(kFields), std::end(kFields));
                return makeJsonResponse(http::status::ok,
                                        json::object{{"k", keys}, {"v", compactRows}});
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
    const char *zoneOverride = std::getenv("BEEMETRY_OFFICIAL_ZONES_GEOJSON");
    std::string dataRoot = config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
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
handleComplianceIntersections(const http::request<http::string_body> &req,
                              const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
    auto &cfg = AppConfig::instance();
    std::string dataRoot = config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
    const char *zoneOverride = std::getenv("BEEMETRY_OFFICIAL_ZONES_GEOJSON");
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
            const std::string tenantId = session->tenantId;
            const char *params[1] = {tenantId.c_str()};
            storage::PgResult res{PQexecParams(
                conn,
                "SELECT id, type, lat, lng, name, status FROM map_markers "
                "WHERE tenant_id = $1::uuid",
                1, nullptr, params, nullptr, nullptr, 0)};
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

// GET /api/map/company-location — resuelve el tenant de la SESIÓN actual (no
// admite tenant_id por query, a diferencia de /api/map/markers no hace falta:
// cada usuario solo puede ver la ubicación de su propia empresa) y devuelve
// las coordenadas guardadas en auth_companies (ADR-121). Reemplaza el
// INITIAL_VIEW hardcodeado de MapViewer.tsx en el centrado inicial.
static http::response<http::string_body>
handleCompanyLocation(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
    auto &cfg = AppConfig::instance();
    if (cfg.gAuthStorageMode != AuthStorageMode::Postgres || session->tenantId.empty()) {
        return makeJsonResponse(http::status::ok, json::object{{"has_location", false}});
    }
#if HAS_LIBPQ
    auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "db_unavailable"}});
    }
    const std::string tenantId = session->tenantId;
    const char *params[1] = {tenantId.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT latitude, longitude, location_zoom FROM auth_companies "
        "WHERE tenant_id = $1::uuid AND latitude IS NOT NULL "
        "AND longitude IS NOT NULL LIMIT 1",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) {
        return makeJsonResponse(http::status::ok, json::object{{"has_location", false}});
    }
    const double lat = std::stod(PQgetvalue(res.get(), 0, 0));
    const double lng = std::stod(PQgetvalue(res.get(), 0, 1));
    const int zoom = PQgetisnull(res.get(), 0, 2) ? 13 : std::stoi(PQgetvalue(res.get(), 0, 2));
    return makeJsonResponse(http::status::ok,
                            json::object{{"has_location", true},
                                        {"latitude", lat},
                                        {"longitude", lng},
                                        {"zoom", zoom}});
#else
    return makeJsonResponse(http::status::ok, json::object{{"has_location", false}});
#endif
}

void registerRoutes(router::Router &r) {
    r.get("/api/map/markers", handleMapMarkers);
    r.get("/api/map/official-zones", handleOfficialZones);
    r.get("/api/map/compliance-intersections", handleComplianceIntersections);
    r.get("/api/map/company-location", handleCompanyLocation);
    r.get("/api/map/wms-proxy", handleWmsProxy);
    r.get("/api/map/geocode", handleGeocodeProxy);
}

} // namespace map_mod
