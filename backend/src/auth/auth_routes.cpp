#include "auth_routes.hpp"
#include "auth_types.hpp"
#include "auth_session.hpp"
#include "auth_storage_pg.hpp"
#include "auth_storage_file.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <cctype>
#include <cstdlib>
#include <mutex>
#include <string>

using http_utils::makeJsonResponse;
using http_utils::routePathOnly;
using config::AppConfig;
using config::AuthStorageMode;

namespace auth {

static std::string trimAuthParam(std::string s) {
  const char *ws = " \t\n\r";
  const auto a = s.find_first_not_of(ws);
  if (a == std::string::npos) return {};
  const auto b = s.find_last_not_of(ws);
  return s.substr(a, b - a + 1);
}

static http::response<http::string_body> buildAuthLoginCheckIdentityResponse(
    std::string companyRaw, std::string identityRaw) {
  auto &cfg = AppConfig::instance();

  std::string company = trimAuthParam(std::move(companyRaw));
  std::string identity = trimAuthParam(std::move(identityRaw));
  if (company.empty() || identity.empty()) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{
            {"ok", false},
            {"reason", "bad_request"},
            {"error",
             "Indique empresa e identificador (Usuario, DNI o RUC)."}});
  }

  AuthLoginIdentityLookupResult lu;
  {
    std::scoped_lock lk(gAuthMutex);
    if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
      lu = authLookupIdentityForCompanyPg(cfg.gDatabaseUrl, company, identity);
#else
      lu.kind = AuthLoginIdentityLookupResult::Kind::DbError;
      lu.diagnostic = "postgres support is not compiled";
#endif
    } else {
      const std::string dataRoot =
          config::getenvOr("MAPAS_DATA_ROOT", "/data");
      lu = authLookupIdentityForCompanyFs(dataRoot, company, identity);
    }
  }

  using ILKind = AuthLoginIdentityLookupResult::Kind;
  if (lu.kind == ILKind::DbError) {
    return makeJsonResponse(
        http::status::internal_server_error,
        json::object{
            {"ok", false},
            {"reason", "server_error"},
            {"error", lu.diagnostic.empty()
                          ? "No se pudo comprobar el usuario."
                          : lu.diagnostic}});
  }
  if (lu.kind == ILKind::NotFound) {
    return makeJsonResponse(
        http::status::ok,
        json::object{{"ok", false},
                     {"reason", "not_found"},
                     {"error", std::string(AppConfig::kAuthUserNotFoundMsg)}});
  }
  if (lu.kind == ILKind::Ambiguous) {
    return makeJsonResponse(
        http::status::ok,
        json::object{
            {"ok", false},
            {"reason", "ambiguous"},
            {"error", std::string(AppConfig::kAuthAmbiguousIdentityMsg)}});
  }
  return makeJsonResponse(
      http::status::ok,
      json::object{{"ok", true}, {"username", lu.resolvedUsername}});
}

void registerRoutes(router::Router &r) {
  auto &cfg = AppConfig::instance();

  // GET /api/auth/companies
  r.get("/api/auth/companies",
        [&cfg](const http::request<http::string_body> &,
               const std::unordered_map<std::string, std::string> &) {
          json::array companies;
          bool loadedFromDb = false;
          if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
            PGconn *conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
            if (PQstatus(conn) == CONNECTION_OK) {
              (void)ensureAuthSchemaPg(conn);
              PGresult *res = PQexec(
                  conn,
                  "SELECT name FROM auth_companies WHERE active=true "
                  "ORDER BY name ASC");
              if (res && PQresultStatus(res) == PGRES_TUPLES_OK) {
                for (int i = 0; i < PQntuples(res); ++i) {
                  companies.push_back(
                      json::value(std::string(PQgetvalue(res, i, 0))));
                }
                loadedFromDb = PQntuples(res) > 0;
              }
              if (res) PQclear(res);
            }
            PQfinish(conn);
#endif
          }
          if (!loadedFromDb) {
            for (const auto &c : config::kMiningCompanies) {
              companies.push_back(json::value(c));
            }
          }
          return makeJsonResponse(http::status::ok,
                                  json::object{{"companies", companies}});
        });

  // GET /api/auth/login/check-identity
  r.get("/api/auth/login/check-identity",
        [](const http::request<http::string_body> &,
           const std::unordered_map<std::string, std::string> &query) {
          const std::string company =
              query.count("company") ? query.at("company") : "";
          const std::string identity =
              query.count("identity") ? query.at("identity") : "";
          return buildAuthLoginCheckIdentityResponse(company, identity);
        });

  // POST /api/auth/login/check-identity
  r.post("/api/auth/login/check-identity",
         [](const http::request<http::string_body> &req,
            const std::unordered_map<std::string, std::string> &) {
           try {
             auto val = json::parse(req.body());
             if (!val.is_object()) {
               return makeJsonResponse(
                   http::status::bad_request,
                   json::object{{"ok", false},
                                {"reason", "bad_request"},
                                {"error", "invalid JSON body"}});
             }
             const auto &obj = val.as_object();
             std::string company;
             std::string identity;
             if (obj.if_contains("company") &&
                 obj.at("company").is_string()) {
               company = json::value_to<std::string>(obj.at("company"));
             }
             if (obj.if_contains("identity") &&
                 obj.at("identity").is_string()) {
               identity = json::value_to<std::string>(obj.at("identity"));
             } else if (obj.if_contains("username") &&
                        obj.at("username").is_string()) {
               identity = json::value_to<std::string>(obj.at("username"));
             }
             return buildAuthLoginCheckIdentityResponse(std::move(company),
                                                        std::move(identity));
           } catch (const std::exception &) {
             return makeJsonResponse(
                 http::status::bad_request,
                 json::object{{"ok", false},
                              {"reason", "bad_request"},
                              {"error", "invalid JSON body"}});
           }
         });

  // GET /api/auth/validate-company
  r.get("/api/auth/validate-company",
        [](const http::request<http::string_body> &,
           const std::unordered_map<std::string, std::string> &query) {
          std::string company =
              query.count("company") ? query.at("company") : "";
          std::string ruc = query.count("ruc") ? query.at("ruc") : "";

          bool valid = false;
          if (ruc.length() == 11) {
            bool isNumeric = true;
            for (char c : ruc) {
              if (!std::isdigit(static_cast<unsigned char>(c))) {
                isNumeric = false;
                break;
              }
            }
            if (isNumeric) {
              std::string prefix = ruc.substr(0, 2);
              if (prefix == "10" || prefix == "15" || prefix == "17" ||
                  prefix == "20") {
                int factor[] = {5, 4, 3, 2, 7, 6, 5, 4, 3, 2};
                int sum = 0;
                for (int i = 0; i < 10; ++i) {
                  sum += (ruc[i] - '0') * factor[i];
                }
                int remainder = sum % 11;
                int check_digit = 11 - remainder;
                if (check_digit == 10) check_digit = 0;
                if (check_digit == 11) check_digit = 1;
                if (check_digit == (ruc[10] - '0')) {
                  valid = true;
                }
              }
            }
          }
          return makeJsonResponse(http::status::ok,
                                  json::object{{"valid", valid}});
        });

  // GET /api/auth/users
  r.get("/api/auth/users",
        [&cfg](const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &query) {
          const auto session = resolveAuthSession(req, query);
          if (!session)
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "unauthorized"}});
          std::string company =
              query.count("company") ? query.at("company") : session->company;
#if HAS_LIBPQ
          return makeJsonResponse(
              http::status::ok,
              json::object{
                  {"users", listCompanyUsersPg(cfg.gDatabaseUrl, company)}});
#else
          return makeJsonResponse(http::status::ok,
                                  json::object{{"users", json::array()}});
#endif
        });

  // POST /api/auth/users/maintenance
  r.post("/api/auth/users/maintenance",
         [&cfg](const http::request<http::string_body> &req,
                const std::unordered_map<std::string, std::string> &query) {
           const auto session = resolveAuthSession(req, query);
           if (!session)
             return makeJsonResponse(http::status::unauthorized,
                                     json::object{{"error", "unauthorized"}});
           try {
             auto payload = json::parse(req.body()).as_object();
             json::object audit;
             std::string error;
#if HAS_LIBPQ
             if (executeUserMaintenancePg(cfg.gDatabaseUrl, payload, audit,
                                          error)) {
               return makeJsonResponse(
                   http::status::ok,
                   json::object{{"status", "ok"}, {"audit", audit}});
             }
             return makeJsonResponse(http::status::bad_request,
                                     json::object{{"error", error}});
#else
             return makeJsonResponse(
                 http::status::bad_request,
                 json::object{
                     {"error", "postgres support is not compiled"}});
#endif
           } catch (const std::exception &ex) {
             return makeJsonResponse(http::status::bad_request,
                                     json::object{{"error", ex.what()}});
           }
         });

  // GET /api/auth/users/maintenance/audit
  r.get("/api/auth/users/maintenance/audit",
        [&cfg](const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &query) {
          const auto session = resolveAuthSession(req, query);
          if (!session)
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "unauthorized"}});
          std::string company =
              query.count("company") ? query.at("company") : session->company;
          int page = query.count("page")
                         ? std::atoi(query.at("page").c_str())
                         : 1;
          int pageSize = query.count("page_size")
                             ? std::atoi(query.at("page_size").c_str())
                             : 20;
#if HAS_LIBPQ
          return makeJsonResponse(
              http::status::ok,
              json::object{{"logs", listUserMaintenanceAuditPg(
                                        cfg.gDatabaseUrl, company, page,
                                        pageSize)}});
#else
          return makeJsonResponse(http::status::ok,
                                  json::object{{"logs", json::array()}});
#endif
        });
}

} // namespace auth
