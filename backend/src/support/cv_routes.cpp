#include "cv_routes.hpp"
#include "cv_storage_pg.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/permissions.hpp"

#include <boost/json.hpp>

#include <algorithm>
#include <optional>
#include <string>

using http_utils::makeJsonResponse;
using config::AppConfig;

namespace support_mod {

namespace {

/** @brief Igual criterio que ticketPathSegments en support_routes.cpp
 * (duplicado a propósito -- rutas que no tienen por qué evolucionar
 * juntas), aplicado al prefijo de candidatos. */
std::vector<std::string> candidatePathSegments(const http::request<http::string_body> &req) {
  static const std::string kPrefix = "/api/support/admin/candidates/";
  const std::string pathOnly = http_utils::routePathOnly(std::string(req.target()));
  if (!pathOnly.starts_with(kPrefix)) return {};
  const std::string rest = pathOnly.substr(kPrefix.size());
  std::vector<std::string> segments;
  std::size_t start = 0;
  while (start <= rest.size()) {
    const std::size_t slash = rest.find('/', start);
    const std::string seg =
        rest.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
    if (!seg.empty()) segments.push_back(seg);
    if (slash == std::string::npos) break;
    start = slash + 1;
  }
  return segments;
}

/** @brief Autorización compartida por los 3 endpoints de este archivo: un
 * candidato de CV es siempre del dominio rrhh (ADR-122) -- a diferencia de
 * `handleSearchTickets` (soporte.view global sin filtro adicional), acá
 * basta con soporte.view/soporte.manage O department == 'rrhh'; no hay
 * variante "global sin restricción de departamento" porque no aplica (todo
 * este endpoint YA es rrhh). */
bool authorizedForCandidates(const http::request<http::string_body> &req,
                             const std::unordered_map<std::string, std::string> &query,
                             http::response<http::string_body> &errorOut) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    errorOut = makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
    return false;
  }
  const bool globalView =
      auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.view") ||
      auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.manage");
  if (globalView) return true;
  const auto dept = auth::effectiveDepartment(session->userId, session->tenantId);
  if (dept && *dept == "rrhh") return true;
  errorOut = makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "forbidden"}, {"need", "soporte.view"}});
  return false;
}

// GET /api/support/admin/candidates -- búsqueda/filtro paginado (ADR-122),
// mismo patrón de paginación que handleSearchTickets en support_routes.cpp.
http::response<http::string_body>
handleSearchCandidates(const http::request<http::string_body> &req,
                       const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  http::response<http::string_body> authError{http::status::unauthorized, req.version()};
  if (!authorizedForCandidates(req, query, authError)) return authError;

  auto qv = [&](const char *key) -> std::optional<std::string> {
    auto it = query.find(key);
    if (it == query.end() || it->second.empty()) return std::nullopt;
    return it->second;
  };

  support::CvCandidateSearchFilter filter;
  filter.q = qv("q");
  filter.status = qv("status");
  filter.dateFrom = qv("date_from");
  filter.dateTo = qv("date_to");
  try {
    if (auto s = qv("score_min")) filter.scoreMin = std::stoi(*s);
  } catch (...) {
  }
  try {
    if (auto s = qv("score_max")) filter.scoreMax = std::stoi(*s);
  } catch (...) {
  }

  int page = 1;
  int pageSize = 20;
  try {
    if (auto p = qv("page")) page = std::max(1, std::stoi(*p));
  } catch (...) {
  }
  try {
    if (auto ps = qv("page_size")) pageSize = std::stoi(*ps);
  } catch (...) {
  }
  pageSize = std::max(1, std::min(pageSize, 100));
  filter.limit = pageSize;
  filter.offset = (page - 1) * pageSize;

  const auto result = support::searchCvCandidatesPg(AppConfig::instance().gDatabaseUrl, filter);
  const long pages = pageSize > 0 ? (result.total + pageSize - 1) / pageSize : 0;
  return makeJsonResponse(http::status::ok,
                          json::object{{"items", result.items},
                                       {"total", result.total},
                                       {"page", page},
                                       {"page_size", pageSize},
                                       {"pages", pages}});
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

// GET /api/support/admin/candidates/{id} -- detalle completo (sin el
// archivo -- ver handleDownloadCandidateFile).
// GET /api/support/admin/candidates/{id}/file -- descarga del CV original.
http::response<http::string_body>
handleCandidateDetailOrFile(const http::request<http::string_body> &req,
                            const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  http::response<http::string_body> authError{http::status::unauthorized, req.version()};
  if (!authorizedForCandidates(req, query, authError)) return authError;

  const auto segments = candidatePathSegments(req);
  if (segments.empty()) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "missing_id"}});
  }
  const std::string &submissionId = segments[0];
  const bool wantsFile = segments.size() == 2 && segments[1] == "file";

  if (wantsFile) {
    std::vector<unsigned char> fileBytes;
    std::string mimeType;
    std::string filename;
    if (!support::getCvSubmissionFilePg(AppConfig::instance().gDatabaseUrl, submissionId,
                                        fileBytes, mimeType, filename)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", "file_not_found"}});
    }
    std::string body(reinterpret_cast<const char *>(fileBytes.data()), fileBytes.size());
    http::response<http::string_body> res{http::status::ok, req.version()};
    res.set(http::field::content_type, mimeType.empty() ? "application/octet-stream" : mimeType);
    res.set(http::field::content_disposition, "attachment; filename=\"" + filename + "\"");
    res.body() = std::move(body);
    res.prepare_payload();
    return res;
  }

  json::object detail;
  if (!support::getCvCandidateDetailPg(AppConfig::instance().gDatabaseUrl, submissionId, detail)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "candidate_not_found"}});
  }
  return makeJsonResponse(http::status::ok, detail);
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

} // namespace

void registerCvRoutes(router::Router &r) {
  r.get("/api/support/admin/candidates", handleSearchCandidates);
  // Prefijo (path termina en '/'): handleCandidateDetailOrFile resuelve el
  // id (y el sufijo /file opcional) desde el propio target de la request
  // -- ver candidatePathSegments.
  r.get("/api/support/admin/candidates/", handleCandidateDetailOrFile);
}

} // namespace support_mod
