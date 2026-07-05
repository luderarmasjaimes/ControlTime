#include "report_routes.hpp"
#include "report_service.hpp"
#include "report_pdf_export.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_types.hpp"

using config::AppConfig;
using http_utils::makeJsonResponse;
using http_utils::makePdfResponse;
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
          {"createdAt", r.createdAt}, {"updatedAt", r.updatedAt}, {"company", r.company},
          {"signed_by_name", r.signedByName}, {"signed_by_role", r.signedByRole},
          {"signed_at", r.signedAt}
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
  // ── GET /api/reports/{id}/revisions — historial de versiones (ADR-015) ──
  static const std::string kRevisionsSuffix = "/revisions";
  if (rest.size() > kRevisionsSuffix.size() &&
      rest.compare(rest.size() - kRevisionsSuffix.size(), kRevisionsSuffix.size(),
                   kRevisionsSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kRevisionsSuffix.size());
    std::string error;
    auto revisions = listReportRevisionsPg(gDatabaseUrl, reportId, session->company, error);
    return makeJsonResponse(http::status::ok, json::object{{"revisions", revisions}});
  }
  // ── GET /api/reports/{id}/export/pdf — export PDF server-side (ADR-016) ──
  static const std::string kExportPdfSuffix = "/export/pdf";
  if (rest.size() > kExportPdfSuffix.size() &&
      rest.compare(rest.size() - kExportPdfSuffix.size(), kExportPdfSuffix.size(),
                   kExportPdfSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kExportPdfSuffix.size());
    // Verifica tenant/existencia ANTES de pedirle al sidecar que renderice
    // (evita gastar un ciclo de Chromium en un id ajeno o inexistente).
    std::string error;
    Report r;
    if (!getReportByIdPg(gDatabaseUrl, reportId, session->company, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    const std::string sessionToken = extractAuthTokenFromRequest(req, query);
    auto pdfResult = exportReportPdf(reportId, sessionToken);
    if (!pdfResult.ok) {
      return makeJsonResponse(http::status::bad_gateway,
                              json::object{{"error", pdfResult.error}});
    }
    // Sanitiza el título para el header Content-Disposition: comillas o
    // CRLF en el título del informe no deben poder romper el header HTTP
    // (inyección de headers) ni el nombre de archivo sugerido al navegador.
    std::string safeName;
    safeName.reserve(r.title.size());
    for (char c : r.title) {
      if (c == '"' || c == '\\' || c == '\r' || c == '\n') continue;
      safeName += c;
    }
    if (safeName.empty()) safeName = "informe";
    return makePdfResponse(safeName + ".pdf", std::move(pdfResult.pdfBytes));
  }
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
                       {"company", r.company},
                       {"signed_by_name", r.signedByName},
                       {"signed_by_role", r.signedByRole},
                       {"signed_at", r.signedAt}});
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
      if (error.rfind("invalid_workflow_transition:", 0) == 0) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", error}});
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
      // Comentario de transición (p.ej. motivo de rechazo, ADR-030): viaja
      // aparte del contenido del informe, solo se usa para la entrada de
      // auditoría de esta transición — nunca se persiste en `reports`.
      const std::string workflowComment =
          obj.contains("workflow_comment")
              ? json::value_to<std::string>(obj.at("workflow_comment"))
              : std::string();

      std::string error;
      if (updateReportPg(gDatabaseUrl, id, session->company, r, error, session->username,
                         session->company, authTokReportPut, session->role, workflowComment)) {
          return makeJsonResponse(http::status::ok, json::object{{"status", "updated"}});
      }
      // ADR-017: distinguir el rechazo de negocio (transición de workflow
      // inválida / informe inexistente) de un fallo real de servidor, para
      // que el frontend pueda mostrar un mensaje claro en vez de un 500.
      if (error.rfind("invalid_workflow_transition:", 0) == 0) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", error}});
      }
      if (error == "report_not_found") {
        return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
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
