#include "report_routes.hpp"
#include "report_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_types.hpp"

using config::AppConfig;
using http_utils::makeJsonResponse;
using http_utils::routePathOnly;
using auth::resolveAuthSession;
using auth::extractAuthTokenFromRequest;
using auth::Report;
using auth::Project;

namespace reports {

static const auto &gDatabaseUrl = AppConfig::instance().gDatabaseUrl;

// ── GET /api/projects ────────────────────────────────────────────────
static http::response<http::string_body>
handleGetProjects(const http::request<http::string_body>& req,
                  const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  std::string error;
  auto projects = listProjectsPg(gDatabaseUrl, error);
  json::array arr;
  for (const auto &p : projects) {
      arr.push_back(json::object{{"id", p.id}, {"name", p.name}, {"description", p.description}});
  }
  return makeJsonResponse(http::status::ok, json::object{{"projects", arr}});
}

// ── GET /api/reports ─────────────────────────────────────────────────
static http::response<http::string_body>
handleGetReports(const http::request<http::string_body>& req,
                 const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  std::string error;
  auto reps = listReportsPg(gDatabaseUrl, session->company, error);
  json::array arr;
  for (const auto &r : reps) {
      arr.push_back(json::object{
          {"id", r.id}, {"project_id", r.projectId}, {"title", r.title},
          {"status", r.status}, {"created_at", r.createdAt}, {"updated_at", r.updatedAt},
          {"company_name", r.company},
          {"createdAt", r.createdAt}, {"updatedAt", r.updatedAt}, {"company", r.company}
      });
  }
  return makeJsonResponse(http::status::ok, json::object{{"reports", arr}});
}

// ── GET /api/reports/{id} ────────────────────────────────────────────
static http::response<http::string_body>
handleGetReportById(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  const std::string target = std::string(req.target());
  const std::string pathOnly = routePathOnly(target);
  std::string rest = pathOnly.substr(std::string("/api/reports/").size());
  if (!rest.empty() && rest.find('/') == std::string::npos) {
    std::string error;
    Report r;
    if (getReportByIdPg(gDatabaseUrl, rest, session->company, r, error)) {
      return makeJsonResponse(
          http::status::ok,
          json::object{{"id", r.id},
                       {"project_id",
                        r.projectId.empty() ? json::value(nullptr)
                                            : json::value(r.projectId)},
                       {"title", r.title},
                       {"content_json", r.contentJson},
                       {"status", r.status},
                       {"created_at", r.createdAt},
                       {"updated_at", r.updatedAt},
                       {"company_name", r.company},
                       {"createdAt", r.createdAt},
                       {"updatedAt", r.updatedAt},
                       {"company", r.company}});
    }
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", error}});
  }
  return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing report id"}});
}

// ── POST /api/reports ────────────────────────────────────────────────
static http::response<http::string_body>
handleCreateReport(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  const std::string authTokReports = extractAuthTokenFromRequest(req, query);

  try {
      auto val = json::parse(req.body());
      const auto &obj = val.as_object();
      Report r;
      r.title = json::value_to<std::string>(obj.at("title"));
      r.projectId = obj.contains("project_id") && !obj.at("project_id").is_null() ? json::value_to<std::string>(obj.at("project_id")) : "";
      r.contentJson = obj.contains("content_json") ? obj.at("content_json") : json::object{};
      r.status = obj.contains("status") ? json::value_to<std::string>(obj.at("status")) : "draft";
      r.createdBy = session->username;
      r.company = session->company;

      std::string error;
      std::string newId;
      if (createReportPg(gDatabaseUrl, r, newId, error, session->username, session->company,
                         authTokReports)) {
        return makeJsonResponse(http::status::created,
                                json::object{{"status", "created"}, {"id", newId}});
      }
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
  } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
}

// ── PUT /api/reports/{id} ────────────────────────────────────────────
static http::response<http::string_body>
handleUpdateReport(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  const std::string authTokReportPut = extractAuthTokenFromRequest(req, query);
  const std::string target = std::string(req.target());
  const std::string pathOnly = routePathOnly(target);
  std::string id = pathOnly.substr(std::string("/api/reports/").size());
  try {
      auto val = json::parse(req.body());
      const auto &obj = val.as_object();
      Report r;
      r.title = json::value_to<std::string>(obj.at("title"));
      r.contentJson = obj.contains("content_json") ? obj.at("content_json") : json::object{};
      r.status = obj.contains("status") ? json::value_to<std::string>(obj.at("status")) : "draft";

      std::string error;
      if (updateReportPg(gDatabaseUrl, id, session->company, r, error, session->username,
                         session->company, authTokReportPut)) {
          return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}});
      }
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
  } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
}

// ── DELETE /api/reports/{id} ─────────────────────────────────────────
static http::response<http::string_body>
handleDeleteReport(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  const std::string authTokReportDel = extractAuthTokenFromRequest(req, query);
  const std::string target = std::string(req.target());
  const std::string pathOnly = routePathOnly(target);
  std::string id = pathOnly.substr(std::string("/api/reports/").size());
  std::string error;
  if (deleteReportPg(gDatabaseUrl, id, session->company, error, session->username, session->company,
                     authTokReportDel)) {
      return makeJsonResponse(http::status::ok, json::object{{"status", "deleted"}});
  }
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
}

void registerRoutes(router::Router& r) {
  r.get("/api/projects", handleGetProjects);
  r.get("/api/reports", handleGetReports);
  r.get("/api/reports/", handleGetReportById);       // prefix match for /api/reports/{id}
  r.post("/api/reports", handleCreateReport);
  r.put("/api/reports/", handleUpdateReport);         // prefix match for /api/reports/{id}
  r.del("/api/reports/", handleDeleteReport);         // prefix match for /api/reports/{id}
}

} // namespace reports
