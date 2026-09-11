#include "report_routes.hpp"
#include "report_service.hpp"
#include "report_pdf_export.hpp"
#include "report_export_jobs.hpp"
#include "report_document_settings.hpp"
#include "report_portable.hpp"
#include "report_share_links.hpp"
#include "offline_template_data.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/auth_types.hpp"
#include "../auth/auth_storage_pg.hpp"
#include "../auth/permissions.hpp"
#include "../notify/notify_service.hpp"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <thread>

// HAS_LIBPQ no se propaga entre translation units (ver el mismo bloque en
// otros .cpp del proyecto, p.ej. device_alarm_routes.cpp).
#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

using config::AppConfig;
using http_utils::makeJsonResponse;
using http_utils::makePdfResponse;
using http_utils::makeOctetResponse;
using http_utils::makeInlinePdfResponse;
using http_utils::routePathOnly;
using auth::resolveAuthSession;
using auth::extractAuthTokenFromRequest;
using auth::userBelongsToTenant;
using auth::userHasRealTenantMembership;
using auth::hasPermission;
using auth::findUserByIdPg;
using auth::issueEphemeralAccessToken;
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

// Búsqueda multitenant (ADR-039, migración completa 2026-07-13): `reports`
// ya se aísla por `tenant_id` (UUID) como el resto de la plataforma — este
// helper solo decide, dado un `?tenant_id=X` de query param, si el usuario
// de la sesión realmente pertenece a esa unidad antes de honrarlo (reusa
// `auth::userBelongsToTenant`, la misma verificación de ADR-043). Sin esto,
// pasar `?tenant_id=<otro-uuid>` sería un IDOR directo.
static std::string resolveAllowedReportTenant(
    const auth::AuthSession &session,
    const std::unordered_map<std::string, std::string> &query, bool &ok) {
  ok = true;
  auto it = query.find("tenant_id");
  if (it == query.end() || it->second.empty() || it->second == session.tenantId) {
    return session.tenantId;
  }
  if (userBelongsToTenant(session.userId, session.tenantId, it->second)) {
    return it->second;
  }
  ok = false;
  return session.tenantId;
}

/** @brief Lee el progreso (captured/total) de un job de export DOCX/PPTX/PDF
 * desde el archivo que el sidecar (pdf-export-service/server.js,
 * `saveJobProgress`) va escribiendo periódicamente en
 * `EXPORT_DATA_ROOT/progress/<jobId>.json` -- mismo volumen compartido
 * (`./data:/data`) que este backend ya monta para leer el archivo final del
 * export, así que no hace falta ningún endpoint HTTP nuevo en el sidecar ni
 * credenciales cruzadas: solo una lectura de disco. Devuelve `null` (no un
 * error) si el archivo no existe todavía -- normal antes de la primera
 * escritura periódica, o después de que el job ya terminó y el sidecar lo
 * borró. */
static json::value readExportJobProgress(const std::string &jobId) {
  const std::filesystem::path progressPath =
      std::filesystem::path(AppConfig::instance().gExportDataRoot) / "progress" / (jobId + ".json");
  std::ifstream ifs(progressPath, std::ios::binary);
  if (!ifs) return nullptr;
  std::string raw((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  try {
    return json::parse(raw);
  } catch (...) {
    return nullptr;
  }
}

// ── GET /api/reports ─────────────────────────────────────────────────
static http::response<http::string_body>
handleGetReports(const http::request<http::string_body>& req,
                 const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  bool tenantOk = true;
  const std::string targetTenant = resolveAllowedReportTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }
  // ADR-079: el rol se resuelve en el tenant OBJETIVO (no necesariamente el
  // tenant activo de la sesión), porque un usuario multitenant puede tener
  // un rol distinto en cada unidad a la que pertenece.
  if (!hasPermission(session->userId, targetTenant, session->role, "informes.view")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "informes.view"}});
  }

  std::string error;
  auto reps = listReportsPg(gDatabaseUrl, targetTenant, error);
  json::array arr;
  for (const auto &r : reps) {
      arr.push_back(json::object{
          {"id", r.id}, {"project_id", r.projectId}, {"title", r.title},
          {"status", r.status}, {"created_at", r.createdAt}, {"updated_at", r.updatedAt},
          {"company_name", r.company}, {"tenant_id", r.tenantId},
          {"createdAt", r.createdAt}, {"updatedAt", r.updatedAt}, {"company", r.company},
          {"signed_by_name", r.signedByName}, {"signed_by_role", r.signedByRole},
          {"signed_at", r.signedAt},
          // ADR-079 canEdit() en ReportsAdminModal.tsx compara esto contra
          // session.username — sin created_by, el propio dueño de un
          // borrador nunca podía reabrirlo para editar.
          {"created_by", r.createdBy}, {"created_by_name", r.createdByName},
          {"reviewed_by", r.reviewedBy}, {"reviewed_by_name", r.reviewedByName},
          {"reviewed_at", r.reviewedAt},
          {"last_modified_by", r.lastModifiedBy}, {"last_modified_by_name", r.lastModifiedByName},
          {"page_count", r.pageCount}, {"layout_mode", r.layoutMode}
      });
  }
  return makeJsonResponse(http::status::ok, json::object{{"reports", arr}});
}

// ── GET /api/reports/{id} ────────────────────────────────────────────
static http::response<http::string_body>
handleGetReportById(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query) {
  const std::string target = std::string(req.target());
  const std::string pathOnly = routePathOnly(target);
  std::string rest = pathOnly.substr(std::string("/api/reports/").size());

  // ── GET /api/reports/share/{token}/pdf — enlace de acceso directo
  // (ADR-138), SIN sesión: el token en sí es la credencial. Se resuelve ANTES
  // de resolveAuthSession a propósito — quien escanea el QR desde el celular
  // no tiene (ni debe necesitar) una sesión logueada en esta app. ──────────
  static const std::string kSharePrefix = "share/";
  static const std::string kSharePdfSuffix = "/pdf";
  if (rest.rfind(kSharePrefix, 0) == 0 && rest.size() > kSharePrefix.size() + kSharePdfSuffix.size() &&
      rest.compare(rest.size() - kSharePdfSuffix.size(), kSharePdfSuffix.size(), kSharePdfSuffix) == 0) {
    const std::string shareToken = rest.substr(
        kSharePrefix.size(), rest.size() - kSharePrefix.size() - kSharePdfSuffix.size());
    const auto link = resolveReportShareLinkPg(gDatabaseUrl, shareToken);
    if (!link) {
      return makeJsonResponse(http::status::not_found,
                              json::object{{"error", "share_link_invalid_or_expired"}});
    }
    Report r;
    std::string error;
    if (!getReportByIdPg(gDatabaseUrl, link->reportId, link->tenantId, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    // Sesión interna de corta vida SOLO para que el sidecar (vía
    // print-report.html) pueda leer el informe — nunca se devuelve al
    // cliente que escaneó el QR, se descarta apenas termina este request.
    auto internalUser = findUserByIdPg(gDatabaseUrl, link->createdByUserId);
    if (!internalUser) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "share_link_owner_not_found"}});
    }
    internalUser->tenantId = link->tenantId;
    const std::string internalAccessToken = issueEphemeralAccessToken(*internalUser);
    const std::string watermarkText =
        resolveWatermarkText(gDatabaseUrl, link->reportId, link->tenantId, link->createdByUsername);
    // encrypt=false (ADR-138): el token ya validado arriba ES la protección
    // -- este PDF sale sin contraseña propia para que el navegador del
    // celular lo muestre directo, sin ningún diálogo.
    auto pdfResult = exportReportPdf(link->reportId, internalAccessToken, watermarkText, /*encrypt=*/false);
    if (!pdfResult.ok) {
      return makeJsonResponse(http::status::bad_gateway, json::object{{"error", pdfResult.error}});
    }
    std::string safeName;
    safeName.reserve(r.title.size());
    for (char c : r.title) {
      if (c == '"' || c == '\\' || c == '\r' || c == '\n') continue;
      safeName += c;
    }
    if (safeName.empty()) safeName = "informe";
#if HAS_LIBPQ
    {
      auto lease = storage::PgPool::instance().acquire(gDatabaseUrl);
      if (PQstatus(lease.get()) == CONNECTION_OK) {
        auth::appendAuthAuditLogPg(lease.get(), "report.export.pdf.share_link", r.company,
                                   link->createdByUsername, true,
                                   "report_id=" + link->reportId + " token_prefix=" + shareToken.substr(0, 8));
      }
    }
#endif
    return makeInlinePdfResponse(safeName + ".pdf", std::move(pdfResult.pdfBytes));
  }

  const auto session = resolveAuthSession(req, query);
  if (!session)
    return makeJsonResponse(http::status::unauthorized,
                            json::object{{"error", "unauthorized"}});
  // Igual que en handleGetReports: la búsqueda multitenant (task #59) puede
  // devolver informes de OTRA unidad a la que el usuario pertenece pero que
  // no es su tenant activo — sin esto, abrir un resultado cross-tenant
  // fallaba con "report_not_found" porque filtraba solo por session->tenantId.
  bool tenantOk = true;
  const std::string targetTenant = resolveAllowedReportTenant(*session, query, tenantOk);
  if (!tenantOk) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }
  // ADR-079: cubre GET por id, /revisions y /export/* — antes ninguno de
  // estos endpoints de lectura verificaba permiso, solo tenant.
  if (!hasPermission(session->userId, targetTenant, session->role, "informes.view")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "informes.view"}});
  }
  // ── GET /api/reports/{id}/revisions — historial de versiones (ADR-015) ──
  static const std::string kRevisionsSuffix = "/revisions";
  if (rest.size() > kRevisionsSuffix.size() &&
      rest.compare(rest.size() - kRevisionsSuffix.size(), kRevisionsSuffix.size(),
                   kRevisionsSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kRevisionsSuffix.size());
    std::string error;
    auto revisions = listReportRevisionsPg(gDatabaseUrl, reportId, targetTenant, error);
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
    if (!getReportByIdPg(gDatabaseUrl, reportId, targetTenant, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    // Token dedicado de vida larga para el sidecar (ver
    // auth::issueExportAccessToken) -- no el access token normal del
    // usuario (15 min), que puede expirar a mitad de un export grande.
    const std::string sessionToken = auth::issueExportAccessToken(
        session->userId, session->username, session->company, session->role, session->tenantId);
    // ADR-080: watermark resuelto server-side (tenant/usuario/fecha reales)
    // antes de pedirle al sidecar que renderice — el sidecar solo dibuja.
    const std::string watermarkText =
        resolveWatermarkText(gDatabaseUrl, reportId, targetTenant, session->username);
    auto pdfResult = exportReportPdf(reportId, sessionToken, watermarkText);
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
#if HAS_LIBPQ
    // Auditoría best-effort del export protegido — nunca la contraseña, solo
    // el evento (ADR-080, mismo mecanismo que login/registro en auth_storage_pg).
    {
      auto lease = storage::PgPool::instance().acquire(gDatabaseUrl);
      if (PQstatus(lease.get()) == CONNECTION_OK) {
        auth::appendAuthAuditLogPg(lease.get(), "report.export.pdf", session->company,
                                   session->username, true, "report_id=" + reportId);
      }
    }
#endif
    return makePdfResponse(safeName + ".pdf", std::move(pdfResult.pdfBytes), pdfResult.userPassword);
  }
  // ── GET /api/reports/{id}/export/portable — .mreport cifrado (traslado
  // entre terminales de la misma unidad minera) ───────────────────────────
  static const std::string kExportPortableSuffix = "/export/portable";
  if (rest.size() > kExportPortableSuffix.size() &&
      rest.compare(rest.size() - kExportPortableSuffix.size(), kExportPortableSuffix.size(),
                   kExportPortableSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kExportPortableSuffix.size());
    std::string error;
    Report r;
    if (!getReportByIdPg(gDatabaseUrl, reportId, targetTenant, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    const auto exportResult = reports::portable::exportReport(r, session->username);
    if (!exportResult.ok) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", exportResult.error}});
    }
    std::string safeName;
    safeName.reserve(r.title.size());
    for (char c : r.title) {
      if (c == '"' || c == '\\' || c == '\r' || c == '\n') continue;
      safeName += c;
    }
    if (safeName.empty()) safeName = "informe";
    return makeOctetResponse(safeName + ".mreport", exportResult.bytes);
  }
  // ── GET /api/reports/{id}/export/jobs/{jobId}[/download] ──────────────
  // Dos segmentos dinámicos (report id + job id) — no se puede resolver con
  // el mismo comparador de sufijo simple que usan los bloques de arriba.
  static const std::string kExportJobsMarker = "/export/jobs/";
  const auto jobsMarkerPos = rest.find(kExportJobsMarker);
  if (jobsMarkerPos != std::string::npos) {
    const std::string reportId = rest.substr(0, jobsMarkerPos);
    std::string jobPart = rest.substr(jobsMarkerPos + kExportJobsMarker.size());
    static const std::string kDownloadSuffix = "/download";
    bool wantsDownload = false;
    if (jobPart.size() > kDownloadSuffix.size() &&
        jobPart.compare(jobPart.size() - kDownloadSuffix.size(), kDownloadSuffix.size(),
                        kDownloadSuffix) == 0) {
      wantsDownload = true;
      jobPart = jobPart.substr(0, jobPart.size() - kDownloadSuffix.size());
    }
    if (reportId.empty() || jobPart.empty() || jobPart.find('/') != std::string::npos) {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "missing_job_id"}});
    }
    std::string error;
    ExportJob job;
    if (!getExportJobPg(gDatabaseUrl, jobPart, targetTenant, job, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    // El job pertenece al tenant (ya filtrado por getExportJobPg) pero podría
    // ser de OTRO informe del mismo tenant — el id de la URL debe coincidir.
    if (job.reportId != reportId) {
      return makeJsonResponse(http::status::not_found,
                              json::object{{"error", "export_job_not_found"}});
    }
    if (!wantsDownload) {
      // Progreso (barra visible al usuario, ver `readExportJobProgress`)
      // solo tiene sentido mientras el job sigue activo -- para un job ya
      // terminado el sidecar ya borró su archivo (o nunca aplica, p.ej.
      // 'mp4' no lo escribe), así que `null` es el resultado normal y
      // esperado en esos casos.
      const json::value progress = (job.status == "queued" || job.status == "running")
          ? readExportJobProgress(job.jobId)
          : nullptr;
      return makeJsonResponse(
          http::status::ok,
          json::object{{"job_id", job.jobId},
                       {"report_id", job.reportId},
                       {"export_format", job.exportFormat},
                       {"status", job.status},
                       {"error_message", job.errorMessage},
                       {"created_at", job.createdAt},
                       {"started_at", job.startedAt},
                       {"completed_at", job.completedAt},
                       {"progress", progress}});
    }
    if (job.status != "success" || job.storageUri.empty()) {
      return makeJsonResponse(http::status::conflict,
                              json::object{{"error", "export_job_not_ready"}});
    }
    std::ifstream ifs(job.storageUri, std::ios::binary);
    if (!ifs) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "export_file_missing"}});
    }
    std::string bytes((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
    // PDF (job async, `runPdfExportJob`): mismo `makePdfResponse` que ya usa
    // el GET síncrono (ADR-016/080) -- Content-Type correcto + el header
    // X-Pdf-Password si el sidecar cifró el archivo. La contraseña quedó
    // guardada en `report_export_job.options` al terminar el job (ver
    // comentario de `runPdfExportJob`, report_export_jobs.cpp), no existía
    // todavía cuando se creó el job.
    if (job.exportFormat == "pdf") {
      std::string userPassword;
      try {
        if (job.options.is_object()) {
          const auto &opts = job.options.as_object();
          if (opts.if_contains("user_password") && opts.at("user_password").is_string()) {
            userPassword = json::value_to<std::string>(opts.at("user_password"));
          }
        }
      } catch (...) {
        userPassword.clear();
      }
      return makePdfResponse("informe.pdf", std::move(bytes), userPassword);
    }
    const std::string ext = job.exportFormat == "mp4" ? ".mp4"
                            : job.exportFormat == "docx" ? ".docx"
                            : ".pptx";
    return makeOctetResponse("informe" + ext, std::move(bytes));
  }
  if (!rest.empty() && rest.find('/') == std::string::npos) {
    std::string error;
    Report r;
    if (getReportByIdPg(gDatabaseUrl, rest, targetTenant, r, error)) {
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
                       {"tenant_id", r.tenantId},
                       {"createdAt", r.createdAt},
                       {"updatedAt", r.updatedAt},
                       {"company", r.company},
                       {"signed_by_name", r.signedByName},
                       {"signed_by_role", r.signedByRole},
                       {"signed_at", r.signedAt},
                       {"version_number", r.versionNumber},
                       {"created_by", r.createdBy}, {"created_by_name", r.createdByName},
                       {"reviewed_by", r.reviewedBy}, {"reviewed_by_name", r.reviewedByName},
                       {"reviewed_at", r.reviewedAt},
                       {"last_modified_by", r.lastModifiedBy},
                       {"last_modified_by_name", r.lastModifiedByName}});
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
  // ADR-039 (migración completa): un informe SIEMPRE necesita un tenant_id
  // REAL y asignado — no basta con que session->tenantId no esté vacío:
  // resolveTelemetryTenantIdPg (auth_storage_pg.cpp) rellena el tenant_id de
  // sesión con un tenant DEMO (kMiningTelemetryDemoTenantId) para cualquier
  // usuario sin fila en auth_user_tenant, pensado para que el dashboard de
  // telemetría muestre datos de ejemplo — ese fallback NUNCA debe alcanzar
  // para crear informes reales (se descubrió durante la verificación de esta
  // migración: sin este chequeo, un usuario legacy sin tenant real creaba
  // informes silenciosamente atribuidos al tenant demo, mezclando datos de
  // unidades no relacionadas). Se verifica la membresía real en BD.
  if (session->tenantId.empty() ||
      !userHasRealTenantMembership(session->userId, session->tenantId)) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "tenant_required"},
                     {"detail", "Tu usuario no esta vinculado a ninguna unidad minera (tenant) real; no se puede crear un informe."}});
  }
  // ADR-079: crear un informe requiere 'informes.edit' — antes cualquier
  // miembro del tenant podía crear informes sin ninguna verificación de rol.
  if (!hasPermission(session->userId, session->tenantId, session->role, "informes.edit")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "informes.edit"}});
  }
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
      r.tenantId = session->tenantId;

      std::string error;
      std::string newId;
      int versionNumber = 0;
      if (createReportPg(gDatabaseUrl, r, newId, error, session->username, session->company,
                         authTokReports, versionNumber)) {
        return makeJsonResponse(http::status::created,
                                json::object{{"status", "created"}, {"id", newId},
                                             {"version_number", versionNumber}});
      }
      if (error.rfind("invalid_workflow_transition:", 0) == 0) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", error}});
      }
      if (error == "tenant_required") {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", error}});
      }
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
  } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
}

// ── GET /api/reports/offline-template ────────────────────────────────
// Plantilla SQLite (solo esquema, sin datos) que el navegador descarga UNA
// vez y cachea localmente (Cache API) para el motor de edición offline del
// Informe Técnico — ver offlineSqlite.ts. Bytes embebidos en
// offline_template_data.hpp (generados con sql.js, no requieren libsqlite3
// en el backend ni gestionar un archivo estático en el runtime del
// contenedor).
static http::response<http::string_body>
handleGetOfflineTemplate(const http::request<http::string_body>& req,
                         const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  std::string bytes(reinterpret_cast<const char *>(reports::offline_template::kBytes),
                    reports::offline_template::kBytesLen);
  return makeOctetResponse("report_offline_template.sqlite", std::move(bytes));
}

// ── POST /api/reports/import/portable ────────────────────────────────
// El cuerpo crudo de la petición ES el archivo .mreport (Content-Type
// application/octet-stream) — no JSON ni multipart. La clave de cifrado solo
// vive en este backend, así que descifrar (y decidir la redacción por
// tenant) tiene que pasar por aquí; nunca en el cliente.
static http::response<http::string_body>
handleImportPortableReport(const http::request<http::string_body>& req,
                           const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  // ADR-079: importar un .mreport crea/reemplaza contenido de informe — misma
  // autorización que crear uno desde cero.
  if (!hasPermission(session->userId, session->tenantId, session->role, "informes.edit")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "informes.edit"}});
  }

  const auto importResult =
      reports::portable::importReport(req.body(), session->tenantId, session->company);
  if (!importResult.ok) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", importResult.error}});
  }
  return makeJsonResponse(
      http::status::ok,
      json::object{{"document", importResult.document},
                   {"title", importResult.title},
                   {"source_company", importResult.sourceCompany},
                   {"tenant_match", importResult.tenantMatch},
                   {"redacted", importResult.redacted}});
}

// ── PUT /api/reports/{id} ────────────────────────────────────────────
static http::response<http::string_body>
handleUpdateReport(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  // Ver comentario equivalente en handleCreateReport: no basta con
  // tenantId no vacío, tiene que ser una membresía real (no el fallback
  // demo de resolveTelemetryTenantIdPg).
  if (session->tenantId.empty() ||
      !userHasRealTenantMembership(session->userId, session->tenantId)) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "tenant_required"}});
  }
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
      // ADR-022: concurrencia optimista para la reconciliación offline — el
      // cliente envía la versión de la que partió (base_version_number del
      // snapshot local); vacío/ausente = sin chequeo, comportamiento normal
      // de guardado en línea (autosave/manual), donde no hay riesgo real de
      // conflicto porque siempre se parte de la versión recién confirmada.
      const std::string expectedVersion =
          obj.contains("expected_version") && !obj.at("expected_version").is_null()
              ? json::value_to<std::string>(obj.at("expected_version"))
              : std::string();

      std::string error;
      int versionNumber = 0;
      if (updateReportPg(gDatabaseUrl, id, session->tenantId, r, error, session->username,
                         session->company, authTokReportPut, versionNumber, session->userId,
                         session->role, workflowComment, expectedVersion)) {
          return makeJsonResponse(http::status::ok,
                                  json::object{{"status", "updated"},
                                               {"version_number", versionNumber}});
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
      // ADR-079: el rol de la sesión no tiene el permiso requerido para el
      // estado actual del informe (p.ej. operator intentando firmar).
      if (error.rfind("forbidden:", 0) == 0) {
        return makeJsonResponse(
            http::status::forbidden,
            json::object{{"error", "forbidden"},
                         {"need", error.substr(std::string("forbidden:").size())}});
      }
      // ADR-079: informe firmado/archivado — inmutable, sin excepción de rol.
      if (error.rfind("report_immutable:", 0) == 0) {
        return makeJsonResponse(
            http::status::conflict,
            json::object{{"error", "report_immutable"},
                         {"status", error.substr(std::string("report_immutable:").size())}});
      }
      // ADR-022: 409 Conflict — el cliente debe decidir (pull servidor o
      // forzar/guardar como nuevo), nunca reintentar ciegamente.
      if (error.rfind("version_conflict:", 0) == 0) {
        const std::string serverVersion = error.substr(std::string("version_conflict:").size());
        return makeJsonResponse(http::status::conflict,
                                json::object{{"error", "version_conflict"},
                                             {"server_version", std::atoi(serverVersion.c_str())}});
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
  if (session->tenantId.empty() ||
      !userHasRealTenantMembership(session->userId, session->tenantId)) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "tenant_required"}});
  }
  // ADR-079: eliminar (soft-delete) requiere 'informes.sign' — la misma
  // autoridad elevada que aprobar/firmar. Antes cualquier miembro del
  // tenant podía eliminar cualquier informe.
  if (!hasPermission(session->userId, session->tenantId, session->role, "informes.sign")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "informes.sign"}});
  }
  const std::string authTokReportDel = extractAuthTokenFromRequest(req, query);
  const std::string target = std::string(req.target());
  const std::string pathOnly = routePathOnly(target);
  std::string id = pathOnly.substr(std::string("/api/reports/").size());
  std::string error;
  if (deleteReportPg(gDatabaseUrl, id, session->tenantId, error, session->username, session->company,
                     authTokReportDel)) {
      return makeJsonResponse(http::status::ok, json::object{{"status", "deleted"}});
  }
  if (error == "report_not_found") {
    return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
  }
  // ADR-079: informe firmado — inmutable, ni admin puede eliminarlo.
  if (error.rfind("report_immutable:", 0) == 0) {
    return makeJsonResponse(
        http::status::conflict,
        json::object{{"error", "report_immutable"},
                     {"status", error.substr(std::string("report_immutable:").size())}});
  }
  return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
}

// ── POST /api/reports/{id}/export/pptx ───────────────────────────────
// Encola un job asíncrono (report_export_job) que un hilo detached procesa
// pidiéndole al sidecar Chromium (mismo servicio de /export/pdf) que
// capture el informe en modo presentación y componga el .pptx. Nunca
// renderiza de forma síncrona dentro del request (ADR-023: el presupuesto de
// latencia de un endpoint síncrono no alcanza para Chromium + composición).
static http::response<http::string_body>
handlePostReportSubAction(const http::request<http::string_body>& req,
                          const std::unordered_map<std::string, std::string>& query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  if (session->tenantId.empty() ||
      !userHasRealTenantMembership(session->userId, session->tenantId)) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "tenant_required"}});
  }
  // Mismo permiso que /export/pdf (ADR-079) — no existe un código dedicado
  // 'informes.export' y no hace falta uno nuevo para este alcance.
  if (!hasPermission(session->userId, session->tenantId, session->role, "informes.view")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "informes.view"}});
  }

  const std::string target = std::string(req.target());
  const std::string pathOnly = routePathOnly(target);
  std::string rest = pathOnly.substr(std::string("/api/reports/").size());

  // ── POST /api/reports/{id}/share — enviar el informe a otro usuario de la
  // empresa (ADR pendiente: antes ShareReportModal.tsx llamaba a un mock que
  // ni siquiera tocaba el backend — `shareReportAsync` en reportsStorage.ts
  // hacía un `setTimeout` y devolvía `true` sin persistir nada ni notificar
  // a nadie). `report_shares` (db_scripts/05_reports_admin.sql) existía
  // desde hace tiempo sin ningún endpoint que la usara. ─────────────────────
  static const std::string kShareSuffix = "/share";
  if (rest.size() > kShareSuffix.size() &&
      rest.compare(rest.size() - kShareSuffix.size(), kShareSuffix.size(), kShareSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kShareSuffix.size());
    // Extra sobre el 'informes.view' genérico de arriba — mismo patrón que
    // el bloque de narración más abajo (permiso adicional por acción, no
    // solo el blanket de lectura).
    if (!hasPermission(session->userId, session->tenantId, session->role, "informes.share")) {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "forbidden"}, {"need", "informes.share"}});
    }
    std::string toUserId, message;
    try {
      const auto val = json::parse(req.body());
      const auto &obj = val.as_object();
      if (obj.contains("to_user_id")) toUserId = json::value_to<std::string>(obj.at("to_user_id"));
      if (obj.contains("message")) message = json::value_to<std::string>(obj.at("message"));
    } catch (const std::exception &ex) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
    }
    if (toUserId.empty()) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "to_user_id_requerido"}});
    }
    std::string error;
    Report r;
    if (!getReportByIdPg(gDatabaseUrl, reportId, session->tenantId, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    // Rechazar en vez de truncar a ciegas: cortar un std::string en un byte
    // arbitrario puede caer en medio de un carácter UTF-8 multibyte (tildes,
    // ñ) y dejar bytes inválidos que Postgres rechaza en el INSERT. 2000
    // bytes es margen generoso para el límite de 500 CARACTERES que ya
    // impone el textarea del cliente (hasta 4 bytes/carácter en UTF-8).
    if (message.size() > 2000) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "mensaje_muy_largo"}});
    }
#if HAS_LIBPQ
    auto lease = storage::PgPool::instance().acquire(gDatabaseUrl);
    PGconn *conn = lease.get();
    if (PQstatus(conn) != CONNECTION_OK) {
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
    }
    // Guardia IDOR: el destinatario debe ser de la MISMA empresa que quien
    // envía — sin esto, un to_user_id adivinado de otra empresa dejaría
    // compartir (y notificar) a un desconocido fuera de la unidad.
    const char *recipientParams[2] = {toUserId.c_str(), session->company.c_str()};
    storage::PgResult recipientRes{PQexecParams(conn,
        "SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), username), "
        "COALESCE(email,''), COALESCE(phone,''), COALESCE(mobile,'') "
        "FROM auth_users WHERE id = $1::uuid AND company_name = $2",
        2, nullptr, recipientParams, nullptr, nullptr, 0)};
    if (!recipientRes.okTuples() || PQntuples(recipientRes.get()) < 1) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", "destinatario_no_encontrado"}});
    }
    const std::string recipientName = PQgetvalue(recipientRes.get(), 0, 0);
    const std::string recipientEmail = PQgetvalue(recipientRes.get(), 0, 1);
    const std::string recipientPhone = PQgetvalue(recipientRes.get(), 0, 2);
    const std::string recipientMobileRaw = PQgetvalue(recipientRes.get(), 0, 3);
    const std::string recipientMobile = recipientMobileRaw.empty() ? recipientPhone : recipientMobileRaw;

    const char *shareParams[4] = {reportId.c_str(), session->userId.c_str(), toUserId.c_str(),
                                  message.empty() ? nullptr : message.c_str()};
    storage::PgResult shareRes{PQexecParams(conn,
        "INSERT INTO report_shares (report_id, sent_by, sent_to, message) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4)",
        4, nullptr, shareParams, nullptr, nullptr, 0)};
    if (!shareRes.okCommand()) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "share_insert_fallo"},
                                           {"detail", PQresultErrorMessage(shareRes.get())}});
    }

    notify::NotifyRequest nreq;
    nreq.recipientUserId = toUserId;
    nreq.recipientEmail = recipientEmail;
    nreq.recipientPhoneE164 = recipientPhone;
    nreq.recipientMobileE164 = recipientMobile;
    nreq.title = "Informe compartido: " + r.title;
    nreq.body = session->username + " te compartió el informe «" + r.title + "»" +
               (message.empty() ? "" : (": " + message));
    nreq.channels = {"in_app", "email", "whatsapp", "sms"};
    nreq.sourceApp = "reports";
    nreq.relatedType = "report";
    nreq.relatedId = reportId;
    const auto results = notify::dispatch(gDatabaseUrl, nreq);
    json::array channelResults;
    for (const auto &cr : results)
      channelResults.push_back(json::object{{"channel", cr.channel}, {"ok", cr.ok}, {"detail", cr.detail}});

    return makeJsonResponse(http::status::ok,
                            json::object{{"status", "shared"},
                                         {"recipient_name", recipientName},
                                         {"channels", channelResults}});
#else
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
#endif
  }

  // ── POST /api/reports/{id}/share-link — enlace de acceso directo a PDF
  // (ADR-138): a diferencia de /export/pdf (ADR-080, PDF cifrado con una
  // contraseña que el usuario tiene que pegar a mano) esto genera un token
  // opaco con expiración; el QR de ese link abre el PDF directo al
  // escanearlo, sin ningún cuadro de diálogo -- la protección pasa a ser el
  // token en sí (largo, aleatorio, vence), no el archivo. ─────────────────
  static const std::string kShareLinkSuffix = "/share-link";
  if (rest.size() > kShareLinkSuffix.size() &&
      rest.compare(rest.size() - kShareLinkSuffix.size(), kShareLinkSuffix.size(), kShareLinkSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kShareLinkSuffix.size());
    // Mismo permiso que /share (compartir HACIA AFUERA, no solo ver) --
    // extra sobre el 'informes.view' genérico ya verificado arriba.
    if (!hasPermission(session->userId, session->tenantId, session->role, "informes.share")) {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "forbidden"}, {"need", "informes.share"}});
    }
    std::string error;
    Report r;
    if (!getReportByIdPg(gDatabaseUrl, reportId, session->tenantId, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    // Ventana fija de 48h -- suficiente para el flujo real (exportar,
    // enviar por WhatsApp/correo, que lo abran) sin quedar circulando
    // indefinidamente. Sin UI de configuración todavía.
    constexpr int kShareLinkTtlHours = 48;
    const std::string token = createReportShareLinkPg(gDatabaseUrl, reportId, session->tenantId,
                                                       session->userId, session->username,
                                                       kShareLinkTtlHours, error);
    if (token.empty()) {
      return makeJsonResponse(http::status::internal_server_error,
                              json::object{{"error", "share_link_create_failed"}, {"detail", error}});
    }
    // Respuesta deliberadamente same-origin y relativa. El frontend la
    // convierte a absoluta usando window.location.origin antes de crear el
    // QR. No usar corsAllowedOrigin(): en despliegues LAN suele conservar el
    // default localhost y el celular terminaria intentando abrir SU propio
    // localhost, no el servidor que genero el QR.
    const std::string url = "/api/reports/share/" + token + "/pdf";
#if HAS_LIBPQ
    {
      auto lease = storage::PgPool::instance().acquire(gDatabaseUrl);
      if (PQstatus(lease.get()) == CONNECTION_OK) {
        auth::appendAuthAuditLogPg(lease.get(), "report.export.pdf.share_link.create", session->company,
                                   session->username, true, "report_id=" + reportId);
      }
    }
#endif
    return makeJsonResponse(http::status::created,
                            json::object{{"url", url}, {"expires_in_hours", kShareLinkTtlHours}});
  }

  static const std::string kExportPptxSuffix = "/export/pptx";
  if (rest.size() > kExportPptxSuffix.size() &&
      rest.compare(rest.size() - kExportPptxSuffix.size(), kExportPptxSuffix.size(),
                  kExportPptxSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kExportPptxSuffix.size());
    if (AppConfig::instance().gPdfExportUrl.empty()) {
      return makeJsonResponse(http::status::service_unavailable,
                              json::object{{"error", "pptx_export_disabled"}});
    }
    std::string error;
    Report r;
    if (!getReportByIdPg(gDatabaseUrl, reportId, session->tenantId, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    // Antes el PPTX se rechazaba fuera del lienzo 16:9 de modo presentación
    // (reportLayoutMetrics.ts) -- ya no: /render-pptx (pdf-export-service)
    // ahora arma el tamaño del deck a partir del papel real del informe
    // (A4/A3, retrato/paisaje) cuando layoutMode es 'document', igual que ya
    // hace /render-docx, así que cualquier informe puede exportarse a PPTX
    // sin importar su modo de lienzo.
    // Token dedicado de vida larga para el sidecar (ver
    // auth::issueExportAccessToken) -- no el access token normal del
    // usuario (15 min), que puede expirar a mitad de un export grande.
    const std::string sessionToken = auth::issueExportAccessToken(
        session->userId, session->username, session->company, session->role, session->tenantId);
    std::string jobId;
    if (!createExportJobPg(gDatabaseUrl, reportId, session->tenantId, "pptx", json::object{},
                           session->userId, /*contentRevisionId=*/"", jobId, error)) {
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
    }
    std::thread(runPptxExportJob, jobId, reportId, sessionToken).detach();
    return makeJsonResponse(http::status::accepted,
                            json::object{{"job_id", jobId}, {"status", "queued"}});
  }

  // ── POST /api/reports/{id}/export/docx ─────────────────────────────
  // Mismo patrón asíncrono que /export/pptx arriba. DOCX sigue exclusivo de
  // layoutMode 'document' (A4/A3) -- a diferencia de PPTX (que ya acepta
  // ambos modos, ver comentario arriba), un informe en modo presentación
  // (16:9) no tiene páginas A4/A3 que mapear a secciones de Word. Pipeline
  // "servidor" del export DOCX (alternativa al pipeline 100% cliente de
  // exportEngine.ts::exportDOCX, que no depende de esta ruta ni de que el
  // informe esté guardado).
  static const std::string kExportDocxSuffix = "/export/docx";
  if (rest.size() > kExportDocxSuffix.size() &&
      rest.compare(rest.size() - kExportDocxSuffix.size(), kExportDocxSuffix.size(),
                  kExportDocxSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kExportDocxSuffix.size());
    if (AppConfig::instance().gPdfExportUrl.empty()) {
      return makeJsonResponse(http::status::service_unavailable,
                              json::object{{"error", "docx_export_disabled"}});
    }
    std::string error;
    Report r;
    if (!getReportByIdPg(gDatabaseUrl, reportId, session->tenantId, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    std::string layoutMode;
    try {
      if (r.contentJson.is_object()) {
        const auto &docObj = r.contentJson.as_object();
        if (docObj.if_contains("meta") && docObj.at("meta").is_object()) {
          const auto &metaObj = docObj.at("meta").as_object();
          if (metaObj.if_contains("layoutMode") && metaObj.at("layoutMode").is_string()) {
            layoutMode = json::value_to<std::string>(metaObj.at("layoutMode"));
          }
        }
      }
    } catch (...) {
      layoutMode.clear();
    }
    if (layoutMode == "presentation") {
      return makeJsonResponse(http::status::bad_request,
                              json::object{{"error", "layout_mode_not_document"}});
    }

    // Token dedicado de vida larga para el sidecar (ver
    // auth::issueExportAccessToken) -- no el access token normal del
    // usuario (15 min), que puede expirar a mitad de un export grande.
    const std::string sessionToken = auth::issueExportAccessToken(
        session->userId, session->username, session->company, session->role, session->tenantId);
    std::string jobId;
    if (!createExportJobPg(gDatabaseUrl, reportId, session->tenantId, "docx", json::object{},
                           session->userId, /*contentRevisionId=*/"", jobId, error)) {
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
    }
    std::thread(runDocxExportJob, jobId, reportId, sessionToken).detach();
    return makeJsonResponse(http::status::accepted,
                            json::object{{"job_id", jobId}, {"status", "queued"}});
  }

  // ── POST /api/reports/{id}/export/pdf ──────────────────────────────
  // Mismo patrón asíncrono que /export/pptx y /export/docx arriba --
  // variante de job del PDF, que sigue teniendo además su GET síncrono
  // (ADR-016, arriba en handleGetReportSubAction) para informes chicos
  // donde el render entra sobrado en el presupuesto de un request HTTP.
  // Para documentos de miles de páginas ese presupuesto no alcanza aunque
  // el render termine bien -- de ahí este endpoint, que delega en
  // `runPdfExportJob` (llama al sidecar en `/render-pdf`, NO `/render`) y
  // se consulta/descarga vía el mismo `GET /export/jobs/{jobId}[/download]`
  // que ya usan PPTX/DOCX. Watermark (ADR-080) resuelto server-side igual
  // que el GET síncrono -- el cifrado queda siempre activo, la contraseña
  // vuelve en `report_export_job.options` (ver `runPdfExportJob`) y el
  // download la expone vía el mismo header `X-Pdf-User-Password` de siempre.
  static const std::string kExportPdfJobSuffix = "/export/pdf";
  if (rest.size() > kExportPdfJobSuffix.size() &&
      rest.compare(rest.size() - kExportPdfJobSuffix.size(), kExportPdfJobSuffix.size(),
                  kExportPdfJobSuffix) == 0) {
    const std::string reportId = rest.substr(0, rest.size() - kExportPdfJobSuffix.size());
    if (AppConfig::instance().gPdfExportUrl.empty()) {
      return makeJsonResponse(http::status::service_unavailable,
                              json::object{{"error", "pdf_export_disabled"}});
    }
    std::string error;
    Report r;
    if (!getReportByIdPg(gDatabaseUrl, reportId, session->tenantId, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    const std::string sessionToken = auth::issueExportAccessToken(
        session->userId, session->username, session->company, session->role, session->tenantId);
    const std::string watermarkText =
        resolveWatermarkText(gDatabaseUrl, reportId, session->tenantId, session->username);
    std::string jobId;
    if (!createExportJobPg(gDatabaseUrl, reportId, session->tenantId, "pdf", json::object{},
                           session->userId, /*contentRevisionId=*/"", jobId, error)) {
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
    }
    std::thread(runPdfExportJob, jobId, reportId, sessionToken, watermarkText).detach();
#if HAS_LIBPQ
    {
      auto lease = storage::PgPool::instance().acquire(gDatabaseUrl);
      if (PQstatus(lease.get()) == CONNECTION_OK) {
        auth::appendAuthAuditLogPg(lease.get(), "report.export.pdf.job.create", session->company,
                                   session->username, true, "report_id=" + reportId);
      }
    }
#endif
    return makeJsonResponse(http::status::accepted,
                            json::object{{"job_id", jobId}, {"status", "queued"}});
  }

  // ── POST /api/reports/{id}/export/pptx/{jobId}/video ──────────────────
  // Convierte un job PPTX ya exitoso en un MP4 (sin narración todavía) —
  // requiere el job referenciado, no vuelve a renderizar el informe.
  static const std::string kExportPptxVideoMarker = "/export/pptx/";
  static const std::string kVideoSuffix = "/video";
  const auto pptxVideoPos = rest.find(kExportPptxVideoMarker);
  if (pptxVideoPos != std::string::npos && rest.size() >= kVideoSuffix.size() &&
      rest.compare(rest.size() - kVideoSuffix.size(), kVideoSuffix.size(), kVideoSuffix) == 0) {
    const std::string reportId = rest.substr(0, pptxVideoPos);
    const std::string afterMarker = rest.substr(pptxVideoPos + kExportPptxVideoMarker.size());
    const std::string pptxJobId = afterMarker.substr(0, afterMarker.size() - kVideoSuffix.size());
    if (reportId.empty() || pptxJobId.empty() || pptxJobId.find('/') != std::string::npos) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_job_id"}});
    }
    if (AppConfig::instance().gPdfExportUrl.empty()) {
      return makeJsonResponse(http::status::service_unavailable,
                              json::object{{"error", "video_export_disabled"}});
    }
    std::string error;
    Report r;
    if (!getReportByIdPg(gDatabaseUrl, reportId, session->tenantId, r, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    ExportJob pptxJob;
    if (!getExportJobPg(gDatabaseUrl, pptxJobId, session->tenantId, pptxJob, error)) {
      return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
    }
    // El job existe y pertenece al tenant, pero podría ser de OTRO informe
    // (mismo chequeo que la ruta GET de jobs) o de otro formato/estado.
    if (pptxJob.reportId != reportId || pptxJob.exportFormat != "pptx" ||
        pptxJob.status != "success" || pptxJob.storageUri.empty()) {
      return makeJsonResponse(http::status::conflict, json::object{{"error", "pptx_job_not_ready"}});
    }

    int slideDurationSeconds = 4;
    std::string transition = "cut";
    try {
      if (!req.body().empty()) {
        auto val = json::parse(req.body());
        if (val.is_object()) {
          const auto &obj = val.as_object();
          if (obj.if_contains("slide_duration_seconds")) {
            const auto &dv = obj.at("slide_duration_seconds");
            if (dv.is_int64()) slideDurationSeconds = static_cast<int>(dv.as_int64());
            else if (dv.is_double()) slideDurationSeconds = static_cast<int>(dv.as_double());
          }
          if (obj.if_contains("transition") && obj.at("transition").is_string()) {
            transition = json::value_to<std::string>(obj.at("transition"));
          }
        }
      }
    } catch (...) {
      // Body inválido -> se usan los defaults (mismo criterio permisivo que
      // aplica el sidecar del lado suyo para estas mismas opciones).
    }
    slideDurationSeconds = std::clamp(slideDurationSeconds, 1, 30);
    if (transition != "crossfade") transition = "cut";

    // Narración (Stage 4): filas ya cargadas para ESTE job pptx (si el
    // usuario grabó audio o dejó notas por página antes de pedir el video).
    // Se serializan tal cual a JSON — el sidecar decide qué puede usar
    // (solo 'recorded_audio' con storage_uri; el resto queda mudo).
    json::array narration;
    {
      std::string assetError;
      auto assets = listExportJobAssetsPg(gDatabaseUrl, pptxJobId, assetError);
      for (const auto &a : assets) {
        narration.push_back(json::object{{"page_number", a.pageNumber},
                                         {"kind", a.kind},
                                         {"storage_uri", a.storageUri},
                                         {"speaker_notes", a.speakerNotes},
                                         {"duration_seconds", a.durationSeconds}});
      }
    }

    std::string jobId;
    json::object optionsJson{{"transition", transition},
                             {"slide_duration_seconds", slideDurationSeconds},
                             {"source_job_id", pptxJobId},
                             {"narrated", !narration.empty()}};
    if (!createExportJobPg(gDatabaseUrl, reportId, session->tenantId, "mp4", optionsJson,
                           session->userId, /*contentRevisionId=*/"", jobId, error)) {
      return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
    }
    std::thread(runVideoExportJob, jobId, pptxJob.storageUri, slideDurationSeconds, transition,
               narration)
        .detach();
    return makeJsonResponse(http::status::accepted,
                            json::object{{"job_id", jobId}, {"status", "queued"}});
  }

  // ── POST /api/reports/{id}/export/jobs/{jobId}/narration/{pageNumber} ──
  // Adjunta la narración de UNA página de un job pptx: cuerpo binario
  // (Content-Type audio/*) = audio grabado; Content-Type application/json
  // {"speaker_notes": "..."} = notas para una futura conversión TTS (sin
  // proveedor integrado todavía — se guardan como texto, sin audio). El
  // job referenciado debe ser un pptx del mismo informe/tenant.
  static const std::string kExportJobsNarrationMarker = "/export/jobs/";
  static const std::string kNarrationMarker = "/narration/";
  const auto jobsNarrationPos = rest.find(kExportJobsNarrationMarker);
  if (jobsNarrationPos != std::string::npos) {
    const std::string afterJobsMarker = rest.substr(jobsNarrationPos + kExportJobsNarrationMarker.size());
    const auto narrationPos = afterJobsMarker.find(kNarrationMarker);
    if (narrationPos != std::string::npos) {
      const std::string reportId = rest.substr(0, jobsNarrationPos);
      const std::string targetJobId = afterJobsMarker.substr(0, narrationPos);
      const std::string pageNumberStr =
          afterJobsMarker.substr(narrationPos + kNarrationMarker.size());
      const bool pageNumberValid = !pageNumberStr.empty() &&
          std::all_of(pageNumberStr.begin(), pageNumberStr.end(),
                     [](unsigned char c) { return std::isdigit(c) != 0; });
      if (reportId.empty() || targetJobId.empty() || !pageNumberValid) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", "missing_page_number"}});
      }
      const int pageNumber = std::atoi(pageNumberStr.c_str());
      std::string error;
      ExportJob targetJob;
      if (!getExportJobPg(gDatabaseUrl, targetJobId, session->tenantId, targetJob, error)) {
        return makeJsonResponse(http::status::not_found, json::object{{"error", error}});
      }
      if (targetJob.reportId != reportId || targetJob.exportFormat != "pptx") {
        return makeJsonResponse(http::status::not_found, json::object{{"error", "export_job_not_found"}});
      }
      // ADR-084: a diferencia de generar/descargar un export (informes.view,
      // igual que PDF/PPTX — ADR-079/080), adjuntar narración CONTRIBUYE
      // contenido nuevo al informe (audio o notas que terminan en el video
      // final) — mismo criterio de ADR-079 para todo lo que no es solo
      // lectura. Un rol con únicamente informes.view (p.ej. 'viewer') puede
      // exportar pero no narrar.
      if (!hasPermission(session->userId, session->tenantId, session->role, "informes.edit")) {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "forbidden"}, {"need", "informes.edit"}});
      }

      std::string contentType;
      if (auto ctIt = req.find(http::field::content_type); ctIt != req.end()) {
        contentType = std::string(ctIt->value());
      }
      const bool isJsonBody = contentType.find("application/json") != std::string::npos;

      if (isJsonBody) {
        std::string speakerNotes;
        try {
          auto val = json::parse(req.body());
          if (val.is_object() && val.as_object().if_contains("speaker_notes") &&
              val.as_object().at("speaker_notes").is_string()) {
            speakerNotes = json::value_to<std::string>(val.as_object().at("speaker_notes"));
          }
        } catch (...) {
          return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_json"}});
        }
        if (!upsertExportJobAssetPg(gDatabaseUrl, targetJobId, pageNumber, "tts_from_notes", "",
                                    speakerNotes, 0.0, error)) {
          return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
        }
        return makeJsonResponse(http::status::ok,
                                json::object{{"status", "saved"}, {"kind", "tts_from_notes"}});
      }

      if (AppConfig::instance().gExportDataRoot.empty()) {
        return makeJsonResponse(http::status::service_unavailable,
                                json::object{{"error", "narration_upload_disabled"}});
      }
      if (req.body().empty()) {
        return makeJsonResponse(http::status::bad_request, json::object{{"error", "empty_audio_body"}});
      }
      double durationSeconds = 0.0;
      auto durIt = query.find("duration_seconds");
      if (durIt != query.end()) {
        try { durationSeconds = std::stod(durIt->second); } catch (...) { durationSeconds = 0.0; }
      }
      const std::string ext = contentType.find("ogg") != std::string::npos ? ".ogg"
          : contentType.find("mp4") != std::string::npos || contentType.find("m4a") != std::string::npos ? ".m4a"
          : ".webm";
      const std::filesystem::path narrationDir =
          std::filesystem::path(AppConfig::instance().gExportDataRoot) / "narration" / targetJobId;
      std::error_code fsError;
      std::filesystem::create_directories(narrationDir, fsError);
      const std::string audioPath = (narrationDir / (std::to_string(pageNumber) + ext)).string();
      std::ofstream ofs(audioPath, std::ios::binary | std::ios::trunc);
      if (!ofs) {
        return makeJsonResponse(http::status::internal_server_error,
                                json::object{{"error", "narration_write_failed"}});
      }
      ofs.write(req.body().data(), static_cast<std::streamsize>(req.body().size()));
      ofs.close();
      if (!upsertExportJobAssetPg(gDatabaseUrl, targetJobId, pageNumber, "recorded_audio", audioPath,
                                  "", durationSeconds, error)) {
        return makeJsonResponse(http::status::internal_server_error, json::object{{"error", error}});
      }
      return makeJsonResponse(http::status::ok,
                              json::object{{"status", "saved"}, {"kind", "recorded_audio"}});
    }
  }

  return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
}

void registerRoutes(router::Router& r) {
  r.get("/api/projects", handleGetProjects);
  r.get("/api/reports", handleGetReports);
  r.get("/api/reports/", handleGetReportById);       // prefix match for /api/reports/{id}
  r.post("/api/reports", handleCreateReport);
  r.post("/api/reports/import/portable", handleImportPortableReport);
  r.get("/api/reports/offline-template", handleGetOfflineTemplate);
  r.put("/api/reports/", handleUpdateReport);         // prefix match for /api/reports/{id}
  r.del("/api/reports/", handleDeleteReport);         // prefix match for /api/reports/{id}
  r.post("/api/reports/", handlePostReportSubAction); // prefix match for /api/reports/{id}/export/...
}

} // namespace reports
