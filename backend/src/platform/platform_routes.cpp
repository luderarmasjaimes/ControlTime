#include "platform_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_storage_pg.hpp"

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using http_utils::makeJsonResponse;
using config::AppConfig;

namespace platform {

static http::response<http::string_body>
handleCountries(const http::request<http::string_body> & /*req*/,
                const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    json::array items;
#if HAS_LIBPQ
    auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
        storage::PgResult res{PQexec(
            conn,
            "SELECT iso2, "
            "COALESCE(NULLIF(TRIM(name_es), ''), name_en) AS disp, "
            "phone_prefix, region "
            "FROM ref_country "
            "WHERE region IN ('latam', 'north_america', 'caribbean') "
            "ORDER BY disp ASC")};
        if (res.okTuples()) {
            for (int i = 0; i < PQntuples(res.get()); ++i) {
                json::object o;
                o["iso2"] = std::string(PQgetvalue(res.get(), i, 0));
                o["label"] = std::string(PQgetvalue(res.get(), i, 1));
                o["phone_prefix"] = std::string(PQgetvalue(res.get(), i, 2));
                o["region"] = std::string(PQgetvalue(res.get(), i, 3));
                items.push_back(std::move(o));
            }
        }
    }
#endif
    return makeJsonResponse(http::status::ok,
                            json::object{{"countries", items}});
}

static http::response<http::string_body>
handleUiLanguages(const http::request<http::string_body> & /*req*/,
                  const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    json::array items;
#if HAS_LIBPQ
    auto __pg_lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) == CONNECTION_OK) {
        storage::PgResult res{
            PQexec(conn,
                   "SELECT code, label_es, label_native, sort_order "
                   "FROM ref_ui_language "
                   "ORDER BY sort_order ASC, code ASC")};
        if (res.okTuples()) {
            for (int i = 0; i < PQntuples(res.get()); ++i) {
                json::object o;
                o["code"] = std::string(PQgetvalue(res.get(), i, 0));
                o["label_es"] = std::string(PQgetvalue(res.get(), i, 1));
                o["label_native"] = std::string(PQgetvalue(res.get(), i, 2));
                int sortOrder = 0;
                try {
                    const char *so = PQgetvalue(res.get(), i, 3);
                    if (so && *so) sortOrder = std::stoi(so);
                } catch (...) {
                    sortOrder = 0;
                }
                o["sort_order"] = sortOrder;
                items.push_back(std::move(o));
            }
        }
    }
#endif
    return makeJsonResponse(http::status::ok,
                            json::object{{"languages", items}});
}

void registerRoutes(router::Router &r) {
    r.get("/api/platform/countries", handleCountries);
    r.get("/api/platform/ui-languages", handleUiLanguages);
}

} // namespace platform
