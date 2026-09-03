#include "platform_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../auth/auth_session.hpp"
#include "../security/validators.hpp"
#include "../mining/sensor_service.hpp"

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <vector>

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

// ADR-131: lectura on-demand del tier frío (Parquet/MinIO, ADR-009). Hasta
// ahora solo existía el job de escritura (handleRunArchiveJob arriba) —
// sin esto, "dashboards con históricos de 5 años" no podía servir drill-down
// crudo más allá de la ventana HOT de 190 días. Un sensor + rango de fechas
// por request (no bulk export), payload acotado a 100k filas.
namespace {

bool looksLikeUuidStrict(const std::string &s) {
    if (s.size() != 36) return false;
    for (size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') return false;
        } else if (!std::isxdigit(static_cast<unsigned char>(c))) {
            return false;
        }
    }
    return true;
}

std::string runCommandCapture(const std::string &cmd) {
#ifdef _WIN32
    FILE *pipe = _popen(cmd.c_str(), "r");
#else
    FILE *pipe = popen(cmd.c_str(), "r");
#endif
    if (!pipe) return {};
    std::string output;
    char buffer[1024];
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) output += buffer;
#ifdef _WIN32
    _pclose(pipe);
#else
    pclose(pipe);
#endif
    return output;
}

// Parser CSV minimalista: seguro para las 4 columnas de esta query
// (uuid/timestamptz-texto/double/smallint), ninguna puede contener comas ni
// comillas -- no es un parser CSV general.
std::vector<std::string> splitCsvLineSimple(const std::string &line) {
    std::vector<std::string> out;
    std::stringstream ss(line);
    std::string field;
    while (std::getline(ss, field, ',')) {
        if (!field.empty() && field.back() == '\r') field.pop_back();
        out.push_back(field);
    }
    return out;
}

} // namespace

static http::response<http::string_body>
handleQueryArchive(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session) {
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    }
    bool tenantOk = true;
    const std::string effectiveTenant =
        mining::resolveAllowedSensorTenant(*session, query, tenantOk);
    if (!tenantOk) {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "no_pertenece_a_esa_unidad"}});
    }

    const auto itSensor = query.find("sensor_id");
    const auto itFrom = query.find("from");
    const auto itTo = query.find("to");
    if (itSensor == query.end() || !looksLikeUuidStrict(itSensor->second) ||
        itFrom == query.end() || itFrom->second.empty() ||
        itTo == query.end() || itTo->second.empty()) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "sensor_id_from_to_required"}});
    }

#if HAS_LIBPQ
    auto &cfg = AppConfig::instance();
    auto __pg_lease = storage::PgPool::replica().acquire(cfg.readUrl());
    PGconn *conn = __pg_lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "db_unavailable"}});
    }

    // Valida ownership del sensor + castea/canonicaliza from/to, TODO vía
    // Postgres parametrizado -- el input crudo del cliente nunca llega al
    // shell; solo el texto ya re-derivado por ::text (charset seguro
    // garantizado por el formato canónico de timestamptz de Postgres).
    const char *pv[4] = {itSensor->second.c_str(), itFrom->second.c_str(),
                         itTo->second.c_str(), effectiveTenant.c_str()};
    storage::PgResult resValidate{PQexecParams(
        conn,
        "SELECT EXISTS(SELECT 1 FROM sensors WHERE sensor_id = $1::uuid AND tenant_id = $4::uuid) AS owned, "
        "($3::timestamptz < $2::timestamptz) AS inverted, "
        "EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz)) / 86400.0 AS span_days, "
        "$2::timestamptz::text AS from_canon, $3::timestamptz::text AS to_canon",
        4, nullptr, pv, nullptr, nullptr, 0)};
    if (!resValidate.okTuples() || PQntuples(resValidate.get()) != 1) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "invalid_sensor_id_from_to"}});
    }
    const bool owned = std::string(PQgetvalue(resValidate.get(), 0, 0)) == "t";
    const bool inverted = std::string(PQgetvalue(resValidate.get(), 0, 1)) == "t";
    const double spanDays = std::atof(PQgetvalue(resValidate.get(), 0, 2));
    const std::string fromCanon = PQgetvalue(resValidate.get(), 0, 3);
    const std::string toCanon = PQgetvalue(resValidate.get(), 0, 4);
    if (!owned) {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "sensor_no_pertenece_al_tenant"}});
    }
    if (inverted) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "from_after_to"}});
    }
    if (spanDays > 366.0) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "range_too_wide_max_366_days"}});
    }

#ifdef _WIN32
    return makeJsonResponse(
        http::status::not_implemented,
        json::object{{"error", "archive_query_not_available_on_windows_dev"}});
#else
    const char *endpointEnv = std::getenv("BEEMETRY_MINIO_ENDPOINT");
    const char *accessKeyEnv = std::getenv("BEEMETRY_MINIO_ACCESS_KEY");
    const char *secretKeyEnv = std::getenv("BEEMETRY_MINIO_SECRET_KEY");
    const char *bucketEnv = std::getenv("BEEMETRY_MINIO_ARCHIVE_BUCKET");
    const std::string endpoint = endpointEnv ? endpointEnv : "minio:9000";
    const std::string accessKey = accessKeyEnv ? accessKeyEnv : "minioadmin";
    const std::string secretKey = secretKeyEnv ? secretKeyEnv : "minioadmin123";
    const std::string bucket = bucketEnv ? bucketEnv : "beemetry-archive";

    // Cada valor interpolado ya pasó por validación estricta (UUID de 36
    // chars hex+guiones, o texto re-derivado por Postgres ::text) y además
    // se cita con shellQuote() -- mismo patrón que face_analysis.cpp/
    // conversion_service.cpp para invocaciones de CLI externas.
    using security::Validator;
    std::string duckSql =
        "INSTALL httpfs; LOAD httpfs; "
        "SET s3_endpoint=" + Validator::shellQuote(endpoint) + "; "
        "SET s3_access_key_id=" + Validator::shellQuote(accessKey) + "; "
        "SET s3_secret_access_key=" + Validator::shellQuote(secretKey) + "; "
        "SET s3_use_ssl=false; SET s3_url_style='path'; "
        "SELECT sensor_id, captured_at, value_numeric, quality_code "
        "FROM read_parquet('s3://" + bucket + "/telemetry_raw/*/*/*.parquet', union_by_name=true) "
        "WHERE sensor_id = '" + itSensor->second + "' AND tenant_id = '" + effectiveTenant + "' "
        "AND captured_at >= TIMESTAMP '" + fromCanon + "' AND captured_at <= TIMESTAMP '" + toCanon + "' "
        "ORDER BY captured_at ASC LIMIT 100000;";

    const std::string cmd = "/usr/local/bin/duckdb -csv -c " +
                            Validator::shellQuote(duckSql) + " 2>/tmp/archive_query_last_err.log";
    const std::string output = runCommandCapture(cmd);

    json::array rows;
    std::istringstream iss(output);
    std::string line;
    bool firstLine = true;
    while (std::getline(iss, line)) {
        if (firstLine) { firstLine = false; continue; }  // header
        if (line.empty()) continue;
        auto cols = splitCsvLineSimple(line);
        if (cols.size() != 4) continue;
        json::object row{
            {"sensor_id", cols[0]},
            {"captured_at", cols[1]},
            {"quality_code", http_utils::safeStoi(cols[3].c_str())}};
        try {
            row["value_numeric"] = std::stod(cols[2]);
        } catch (...) {
            row["value_numeric"] = nullptr;
        }
        rows.push_back(row);
    }

    return makeJsonResponse(http::status::ok,
                            json::object{{"sensor_id", itSensor->second},
                                         {"from", fromCanon},
                                         {"to", toCanon},
                                         {"source", "cold_parquet_archive"},
                                         {"rows", rows}});
#endif
#else
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
}

void registerRoutes(router::Router &r) {
    r.get("/api/platform/countries", handleCountries);
    r.get("/api/platform/ui-languages", handleUiLanguages);
    r.post("/api/platform/archive/run", handleRunArchiveJob);
    r.get("/api/platform/archive/query", handleQueryArchive);
}

} // namespace platform
