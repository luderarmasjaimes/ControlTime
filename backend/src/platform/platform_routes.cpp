#include "platform_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../auth/auth_session.hpp"

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <cstdlib>

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
            "phone_prefix, region, default_locale "
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
                o["default_locale"] = std::string(PQgetvalue(res.get(), i, 4));
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

// ADR-009: dispara el job de archivado Parquet (telemetry_raw → MinIO) que
// ya existe como script real (scripts/archive_telemetry_to_parquet.sh,
// probado manualmente contra datos reales antes de exponerlo por HTTP).
// Solo admin: es una operación que borra filas del plano HOT tras archivar
// (verificado internamente por el propio script antes de cada DELETE).
// Síncrono con timeout largo (30 min) — aceptable para una acción admin
// infrecuente en un servidor thread-per-request (no bloquea otras sesiones).
static http::response<http::string_body>
handleRunArchiveJob(const http::request<http::string_body> &req,
                    const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
    if (session->role != "admin") {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "admin_only"}});
    }
#ifdef _WIN32
    return makeJsonResponse(
        http::status::not_implemented,
        json::object{{"error", "archive_job_not_available_on_windows_dev"}});
#else
    const int rc = std::system(
        "timeout 1800 /app/scripts/archive_telemetry_to_parquet.sh "
        "> /tmp/archive_job_last_run.log 2>&1");
    const bool ok = (rc == 0);
    return makeJsonResponse(
        ok ? http::status::ok : http::status::internal_server_error,
        json::object{{"status", ok ? "completed" : "failed"},
                     {"exit_code", rc}});
#endif
}

void registerRoutes(router::Router &r) {
    r.get("/api/platform/countries", handleCountries);
    r.get("/api/platform/ui-languages", handleUiLanguages);
    r.post("/api/platform/archive/run", handleRunArchiveJob);
}

} // namespace platform
