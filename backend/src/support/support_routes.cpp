#include "support_routes.hpp"
#include "mining_chatbot_service.hpp"
#include "support_storage_pg.hpp"
#include "cv_storage_pg.hpp"
#include "cv_extraction_client.hpp"
#include "image_analysis_client.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/permissions.hpp"
#include "../mining/alarm_notifier.hpp"

#include <algorithm>
#include <cstdlib>
#include <optional>
#include <set>
#include <string>
#include <vector>

using http_utils::makeJsonResponse;

namespace support_mod {

namespace {

/** @brief Extensiones aceptadas para un adjunto del chat web y su MIME type
 * canónico (ADR-129) -- validado por extensión del nombre de archivo, no por
 * el Content-Type que declara el cliente (no confiable): cualquier otro tipo
 * se rechaza con `unsupported_file_type` antes de tocar la base de datos. */
const std::unordered_map<std::string, std::string> &allowedChatAttachmentExtensions() {
  static const std::unordered_map<std::string, std::string> kMap = {
      {".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
      {".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
      {".pdf", "application/pdf"},
      {".jpg", "image/jpeg"},
      {".jpeg", "image/jpeg"},
      {".png", "image/png"},
  };
  return kMap;
}

/** @brief Igual criterio que sanitizeFilename() en tenant_assets_routes.cpp
 * (duplicado a propósito): solo alfanumérico/punto/guion/guion-bajo, evita
 * path traversal o inyección vía el nombre visible al descargar. */
std::string sanitizeAttachmentFilename(const std::string &raw) {
  std::string out;
  out.reserve(raw.size());
  for (char c : raw) {
    if (std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-' || c == '_') {
      out += c;
    }
  }
  if (out.empty()) out = "adjunto";
  return out.size() > 200 ? out.substr(0, 200) : out;
}

// POST /api/support/chat/attachment -- sube un archivo (docx/pptx/pdf/jpg/png)
// del widget de chat de soporte (ADR-129). Requiere sesión (a diferencia de
// handleCreateTicket): a diferencia de un visitante anónimo de WhatsApp, el
// widget web siempre corre dentro de una sesión autenticada -- se usa para
// escopar el archivo a tenant_id (descarga restringida, ver
// handleDownloadChatAttachment) igual que el resto de activos del tenant.
http::response<http::string_body>
handleUploadChatAttachment(const http::request<http::string_body> &req,
                           const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  auto qv = [&](const char *key) -> std::string {
    auto it = query.find(key);
    return it != query.end() ? it->second : "";
  };
  const std::string filenameRaw = qv("filename");
  const std::string conversationId = qv("conversation_id");
  if (filenameRaw.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_filename"}});
  }

  std::string lowerName = filenameRaw;
  std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(),
                 [](unsigned char c) { return std::tolower(c); });
  const auto dot = lowerName.find_last_of('.');
  const std::string ext = dot == std::string::npos ? "" : lowerName.substr(dot);
  const auto &allowed = allowedChatAttachmentExtensions();
  const auto extIt = allowed.find(ext);
  if (extIt == allowed.end()) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "unsupported_file_type"}, {"allowed", "docx, pptx, pdf, jpg, png"}});
  }

  // 20 MB: generoso para un informe/foto adjunto, evita que un upload
  // accidental (o malicioso) infle una fila de la tabla sin límite.
  constexpr std::size_t kMaxAttachmentBytes = 20 * 1024 * 1024;
  if (req.body().empty() || req.body().size() > kMaxAttachmentBytes) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "invalid_size"}, {"max_bytes", static_cast<int64_t>(kMaxAttachmentBytes)}});
  }
  const std::vector<unsigned char> fileBytes(req.body().begin(), req.body().end());
  const std::string safeFilename = sanitizeAttachmentFilename(filenameRaw);

  // ADR-129: jpg/png se pasan por ai_engine (QR + OCR, ver
  // image_analysis_client.hpp) ANTES de persistir -- el modelo de chat es de
  // solo texto, así que esta es la única forma de que el usuario pueda
  // "preguntar sobre la imagen" (QR, texto visible) en la misma conversación.
  // Best-effort: si ai_engine no responde, el adjunto igual se guarda (nunca
  // se pierde el archivo por un fallo de análisis, mismo criterio que
  // processCvSubmission en whatsapp_bot_engine.cpp).
  std::string ocrText;
  json::array qrCodes;
  const bool isImage = extIt->second == "image/jpeg" || extIt->second == "image/png";
  if (isImage) {
    const auto analysis = support::analyzeImageWithAiEngine(fileBytes, safeFilename, extIt->second);
    if (analysis.ok) {
      ocrText = analysis.ocrText;
      for (const auto &code : analysis.qrCodes) qrCodes.push_back(json::string(code));
    }
  }

  support::ChatAttachmentRecord record;
  std::string error;
  const bool ok = support::saveChatAttachmentPg(
      config::AppConfig::instance().gDatabaseUrl, conversationId, session->tenantId,
      session->userId, safeFilename, extIt->second, fileBytes, ocrText, qrCodes, record, error);
  if (!ok) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", error.empty() ? "attachment_save_failed" : error}});
  }
  return makeJsonResponse(http::status::created,
                          json::object{{"attachment_id", record.id},
                                       {"filename", record.filename},
                                       {"mime_type", record.mimeType},
                                       {"size_bytes", record.sizeBytes},
                                       {"ocr_text", record.ocrText},
                                       {"qr_codes", record.qrCodes}});
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

// GET /api/support/chat/attachment/{id} -- descarga, restringida al tenant_id
// de la sesión que pide (anti-IDOR, mismo criterio que tenant_assets_routes.cpp).
http::response<http::string_body>
handleDownloadChatAttachment(const http::request<http::string_body> &req,
                             const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  static const std::string kPrefix = "/api/support/chat/attachment/";
  const std::string pathOnly = http_utils::routePathOnly(std::string(req.target()));
  if (!pathOnly.starts_with(kPrefix) || pathOnly.size() == kPrefix.size()) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "missing_id"}});
  }
  const std::string attachmentId = pathOnly.substr(kPrefix.size());

  std::vector<unsigned char> fileBytes;
  std::string mimeType, filename;
  if (!support::getChatAttachmentPg(config::AppConfig::instance().gDatabaseUrl, attachmentId,
                                    session->tenantId, fileBytes, mimeType, filename)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "attachment_not_found"}});
  }
  std::string body(reinterpret_cast<const char *>(fileBytes.data()), fileBytes.size());
  http::response<http::string_body> res{http::status::ok, req.version()};
  res.set(http::field::content_type, mimeType.empty() ? "application/octet-stream" : mimeType);
  res.set(http::field::content_disposition, "attachment; filename=\"" + filename + "\"");
  res.body() = std::move(body);
  res.prepare_payload();
  return res;
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

/** @brief Extensiones aceptadas para un CV subido desde el widget web
 * (ADR-129) -- docx/pptx/pdf, mismos formatos que ya soporta ai_engine
 * (/extract_cv_text, eye_analyzer.py). A diferencia de
 * allowedChatAttachmentExtensions(), NO incluye jpg/png: un CV nunca es una
 * foto suelta. */
const std::unordered_map<std::string, std::string> &allowedCvExtensions() {
  static const std::unordered_map<std::string, std::string> kMap = {
      {".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
      {".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
      {".pdf", "application/pdf"},
  };
  return kMap;
}

// POST /api/support/cv/submit -- adjunta un CV (docx/pptx/pdf) desde el
// widget de chat (flujo Recursos Humanos, ADR-129), reusando el mismo
// pipeline que ya procesa los CV recibidos por WhatsApp (ADR-122): guarda el
// archivo, extrae texto (ai_engine), extrae campos+score (Ollama) y notifica
// a RRHH por correo -- en ese orden, sin abortar si algún paso falla (nunca
// se pierde una postulación en silencio). A diferencia del flujo de
// WhatsApp, acá corre síncrono dentro del propio request: el volumen
// esperado desde la web es bajo y el usuario ya está viendo el chat
// esperando una respuesta, no hace falta backgroundearlo.
http::response<http::string_body>
handleSubmitWebCv(const http::request<http::string_body> &req,
                  const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  auto qv = [&](const char *key) -> std::string {
    auto it = query.find(key);
    return it != query.end() ? it->second : "";
  };
  const std::string filenameRaw = qv("filename");
  if (filenameRaw.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_filename"}});
  }

  std::string lowerName = filenameRaw;
  std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(),
                 [](unsigned char c) { return std::tolower(c); });
  const auto dot = lowerName.find_last_of('.');
  const std::string ext = dot == std::string::npos ? "" : lowerName.substr(dot);
  const auto &allowed = allowedCvExtensions();
  const auto extIt = allowed.find(ext);
  if (extIt == allowed.end()) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "unsupported_file_type"}, {"allowed", "docx, pptx, pdf"}});
  }

  constexpr std::size_t kMaxCvBytes = 10 * 1024 * 1024; // espejo de BEEMETRY_WHATSAPP_CV_MAX_BYTES
  if (req.body().empty() || req.body().size() > kMaxCvBytes) {
    return makeJsonResponse(
        http::status::bad_request,
        json::object{{"error", "invalid_size"}, {"max_bytes", static_cast<int64_t>(kMaxCvBytes)}});
  }
  const std::vector<unsigned char> fileBytes(req.body().begin(), req.body().end());
  const std::string safeFilename = sanitizeAttachmentFilename(filenameRaw);
  auto &cfg = config::AppConfig::instance();

  support::CvSubmissionRecord submission;
  std::string error;
  if (!support::insertWebCvSubmissionPg(cfg.gDatabaseUrl, session->tenantId, session->userId,
                                        safeFilename, extIt->second,
                                        static_cast<int>(fileBytes.size()), fileBytes, submission,
                                        error)) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", error.empty() ? "cv_submission_failed" : error}});
  }

  // Extracción de texto (ai_engine) + campos/score (Ollama) -- best-effort,
  // el archivo ya quedó guardado pase lo que pase (ver comentario de la
  // función). El mismo criterio de "ninguna postulación se pierde en
  // silencio" que processCvSubmission (whatsapp_bot_engine.cpp).
  json::value profileJson = json::value(nullptr);
  const auto textResult = support::extractCvTextFromAiEngine(fileBytes, safeFilename, extIt->second);
  support::updateCvSubmissionTextPg(cfg.gDatabaseUrl, submission.id,
                                    textResult.ok ? textResult.text : "",
                                    textResult.ok ? "extracted" : "extraction_failed");
  if (textResult.ok) {
    const auto fieldsResult = support::extractCvFieldsWithOllama(textResult.text);
    if (fieldsResult.ok) {
      std::string profErr;
      if (support::insertCvCandidateProfilePg(cfg.gDatabaseUrl, submission.id, fieldsResult.profile,
                                              profErr)) {
        support::updateCvSubmissionStatusPg(cfg.gDatabaseUrl, submission.id, "scored");
        json::object p;
        p["cargo_postulado"] = fieldsResult.profile.cargoPostulado;
        p["score"] = fieldsResult.profile.score.has_value() ? json::value(*fieldsResult.profile.score)
                                                             : json::value(nullptr);
        profileJson = p;
      }
    }
  }

  if (!cfg.gHrCvEmailTo.empty()) {
    std::string emailDetail;
    const std::string subject = "Nueva postulación de CV (web) -- " + safeFilename;
    const std::string bodyText = "Postulante autenticado en la plataforma (tenant " +
                                 session->tenantId + ", usuario " + session->username +
                                 ") adjuntó un CV vía el widget de soporte.\nArchivo: " +
                                 safeFilename;
    bool emailOk = mining_iot::sendEmailWithAttachment(cfg.gHrCvEmailTo, subject, bodyText,
                                                       safeFilename, extIt->second, fileBytes,
                                                       emailDetail);
    support::updateCvSubmissionStatusPg(cfg.gDatabaseUrl, submission.id,
                                        emailOk ? "notified" : "notify_failed");
  }

  return makeJsonResponse(http::status::created,
                          json::object{{"submission_id", submission.id},
                                       {"filename", submission.originalFilename},
                                       {"status", submission.status},
                                       {"profile_preview", profileJson}});
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

/** @brief Segmento(s) tras el prefijo `/api/support/tickets/` -- p.ej. para
 * ".../RCL-20260818-0007/status" devuelve {"RCL-20260818-0007", "status"}. */
std::vector<std::string> ticketPathSegments(const http::request<http::string_body> &req) {
  static const std::string kPrefix = "/api/support/tickets/";
  const std::string pathOnly = http_utils::routePathOnly(std::string(req.target()));
  if (!pathOnly.starts_with(kPrefix)) return {};
  const std::string rest = pathOnly.substr(kPrefix.size());
  std::vector<std::string> segments;
  std::size_t start = 0;
  while (start <= rest.size()) {
    const std::size_t slash = rest.find('/', start);
    const std::string seg = rest.substr(start, slash == std::string::npos ? std::string::npos
                                                                          : slash - start);
    if (!seg.empty()) segments.push_back(seg);
    if (slash == std::string::npos) break;
    start = slash + 1;
  }
  return segments;
}

// POST /api/support/tickets -- creación directa (sin pasar por el bot de
// WhatsApp), reservado para uso futuro desde web (mismo motor que el bot:
// support::createTicketPg). No requiere sesión -- un visitante anónimo del
// sitio también debe poder abrir un reclamo, igual que por WhatsApp.
http::response<http::string_body>
handleCreateTicket(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &) {
#if HAS_LIBPQ
  json::value body;
  try {
    body = json::parse(req.body());
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
  if (!body.is_object()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_body"}});
  }
  const auto &obj = body.as_object();
  const std::string category =
      obj.contains("category") ? json::value_to<std::string>(obj.at("category")) : "";
  const std::string description =
      obj.contains("description") ? json::value_to<std::string>(obj.at("description")) : "";
  if (category.empty() || description.empty()) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "missing_category_or_description"}});
  }
  static const std::set<std::string> kValidCategories = {"soporte", "comercial", "reclamo",
                                                          "agenda", "rrhh"};
  if (!kValidCategories.count(category)) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_category"}});
  }
  const std::string contactName =
      obj.contains("contact_name") ? json::value_to<std::string>(obj.at("contact_name")) : "";
  const std::string subject =
      obj.contains("subject") ? json::value_to<std::string>(obj.at("subject")) : "";
  const std::string priority =
      obj.contains("priority") ? json::value_to<std::string>(obj.at("priority")) : "media";

  const auto session = auth::resolveAuthSession(req, {});
  const std::string tenantId = session ? session->tenantId : "";

  support::TicketRecord ticket;
  std::string error;
  const bool ok = support::createTicketPg(config::AppConfig::instance().gDatabaseUrl, "web",
                                          category, "", contactName, tenantId, subject,
                                          description, priority, ticket, error);
  if (!ok) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", error.empty() ? "ticket_create_failed" : error}});
  }
  return makeJsonResponse(http::status::created, ticket.toJson());
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

// GET /api/support/tickets/{code} -- consulta pública por código de
// seguimiento (sin sesión: quien escribe por WhatsApp no tiene una). Solo
// expone estado/categoría/fechas -- nunca teléfono/nombre de terceros.
http::response<http::string_body>
handleGetTicket(const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> &) {
#if HAS_LIBPQ
  const auto segments = ticketPathSegments(req);
  if (segments.empty()) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "missing_code"}});
  }
  support::TicketRecord ticket;
  if (!support::findTicketByCodePg(config::AppConfig::instance().gDatabaseUrl, segments[0],
                                   ticket)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "ticket_not_found"}});
  }
  return makeJsonResponse(http::status::ok, ticket.toJson());
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

// PUT /api/support/tickets/{code}/status -- gestión interna (RBAC
// soporte.manage, ver db_scripts/59). {"status":"...", "detail":"..."}
http::response<http::string_body>
handleUpdateTicketStatus(const http::request<http::string_body> &req,
                         const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  const auto segments = ticketPathSegments(req);
  if (segments.size() != 2 || segments[1] != "status") {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.manage")) {
    // Alternativa (ADR-115): un agente sin el permiso global puede gestionar
    // los tickets de SU PROPIO departamento -- hay que conocer la categoría
    // del ticket antes de decidir, así que se resuelve acá mismo.
    const auto dept = auth::effectiveDepartment(session->userId, session->tenantId);
    support::TicketRecord peek;
    const bool departmentMatch =
        dept && support::findTicketByCodePg(config::AppConfig::instance().gDatabaseUrl,
                                            segments[0], peek) &&
        peek.category == *dept;
    if (!departmentMatch) {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "forbidden"}, {"need", "soporte.manage"}});
    }
  }
  json::value body;
  try {
    body = json::parse(req.body());
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
  if (!body.is_object() || !body.as_object().contains("status")) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "missing_status"}});
  }
  const auto &obj = body.as_object();
  const std::string newStatus = json::value_to<std::string>(obj.at("status"));
  static const std::set<std::string> kValidStatuses = {"abierto", "en_proceso", "resuelto",
                                                        "cerrado"};
  if (!kValidStatuses.count(newStatus)) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_status"}});
  }
  const std::string detail =
      obj.contains("detail") ? json::value_to<std::string>(obj.at("detail")) : "";

  support::TicketRecord ticket;
  std::string error;
  const bool ok = support::updateTicketStatusPg(config::AppConfig::instance().gDatabaseUrl,
                                                segments[0], newStatus, session->username, detail,
                                                ticket, error);
  if (!ok) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", error.empty() ? "ticket_not_found" : error}});
  }
  return makeJsonResponse(http::status::ok, ticket.toJson());
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

/** @brief Segmento tras el prefijo `/api/support/whatsapp/contact-numbers/`
 * -- p.ej. "soporte" en ".../contact-numbers/soporte". Mismo patrón que
 * `ticketPathSegments`, duplicado a propósito para no acoplar dos rutas que
 * no tienen por qué evolucionar juntas. */
std::string contactNumberKeyFromPath(const http::request<http::string_body> &req) {
  static const std::string kPrefix = "/api/support/whatsapp/contact-numbers/";
  const std::string pathOnly = http_utils::routePathOnly(std::string(req.target()));
  if (!pathOnly.starts_with(kPrefix)) return "";
  return pathOnly.substr(kPrefix.size());
}

json::object contactNumberToJson(const std::string &key, const std::string &label,
                                 const std::string &effectivePhone, bool editedInPlatform,
                                 const std::string &updatedAt, const std::string &updatedBy) {
  return json::object{
      {"key", key},
      {"label", label},
      {"phone_e164", effectivePhone},
      {"edited_in_platform", editedInPlatform},
      {"updated_at", updatedAt.empty() ? json::value(nullptr) : json::value(updatedAt)},
      {"updated_by", updatedBy.empty() ? json::value(nullptr) : json::value(updatedBy)},
  };
}

// GET /api/support/whatsapp/contact-numbers -- números de escalamiento
// (soporte/comercial) que usa el bot, con su valor EFECTIVO (editado desde
// la plataforma si existe, si no el "de fábrica" de .env) -- RBAC
// soporte.manage: es configuración operativa, no un dato público.
http::response<http::string_body>
handleListContactNumbers(const http::request<http::string_body> &req,
                         const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "soporte.manage"}});
  }
  auto &cfg = config::AppConfig::instance();
  const struct { const char *key; const char *label; std::string envFallback; } kKnown[3] = {
      {"soporte", "Soporte técnico", cfg.gWhatsappSupportToE164},
      {"comercial", "Área comercial", cfg.gWhatsappComercialToE164},
      {"rrhh", "Recursos Humanos", cfg.gWhatsappRrhhToE164},
  };
  json::array items;
  for (const auto &known : kKnown) {
    const auto row = support::getContactNumberPg(cfg.gDatabaseUrl, known.key);
    if (row && !row->phoneE164.empty()) {
      items.push_back(contactNumberToJson(known.key, row->label.empty() ? known.label : row->label,
                                          row->phoneE164, true, row->updatedAt, row->updatedBy));
    } else {
      items.push_back(
          contactNumberToJson(known.key, known.label, known.envFallback, false, "", ""));
    }
  }
  return makeJsonResponse(http::status::ok, json::object{{"contact_numbers", items}});
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

// PUT /api/support/whatsapp/contact-numbers/{key} -- edita el número de
// escalamiento desde la plataforma (misma tabla que la opción
// "Administración" del bot por WhatsApp, ADR-114 -- ver db_scripts/61).
// {"phone_e164":"51...", "label":"..." (opcional)}
http::response<http::string_body>
handleSetContactNumber(const http::request<http::string_body> &req,
                       const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  const std::string key = contactNumberKeyFromPath(req);
  static const std::set<std::string> kValidKeys = {"soporte", "comercial", "rrhh"};
  if (!kValidKeys.count(key)) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "invalid_key"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.manage")) {
    // Alternativa (ADR-115): el agente de un departamento puede editar SU
    // PROPIO número de contacto sin el permiso global.
    const auto dept = auth::effectiveDepartment(session->userId, session->tenantId);
    if (!dept || *dept != key) {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "forbidden"}, {"need", "soporte.manage"}});
    }
  }
  json::value body;
  try {
    body = json::parse(req.body());
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
  if (!body.is_object() || !body.as_object().contains("phone_e164")) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "missing_phone_e164"}});
  }
  const auto &obj = body.as_object();
  const std::string phoneE164 = json::value_to<std::string>(obj.at("phone_e164"));
  if (phoneE164.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "empty_phone_e164"}});
  }
  const std::string defaultLabel = key == "soporte" ? "Soporte técnico"
                                   : key == "comercial" ? "Área comercial"
                                                        : "Recursos Humanos";
  const std::string label =
      obj.contains("label") ? json::value_to<std::string>(obj.at("label")) : defaultLabel;

  std::string error;
  const bool ok = support::setContactNumberPg(config::AppConfig::instance().gDatabaseUrl, key,
                                              label, phoneE164, session->username, error);
  if (!ok) {
    return makeJsonResponse(http::status::internal_server_error,
                            json::object{{"error", error.empty() ? "update_failed" : error}});
  }
  const auto row = support::getContactNumberPg(config::AppConfig::instance().gDatabaseUrl, key);
  return makeJsonResponse(
      http::status::ok,
      row ? contactNumberToJson(key, row->label, row->phoneE164, true, row->updatedAt,
                                row->updatedBy)
          : json::object{{"key", key}, {"phone_e164", phoneE164}});
#else
  return makeJsonResponse(http::status::service_unavailable,
                          json::object{{"error", "database_unavailable"}});
#endif
}

} // namespace

// GET /api/support/chat/config -- indica al frontend si el chatbot (Ollama)
// y el escalamiento (WhatsApp) estan configurados, sin exponer secretos.
static http::response<http::string_body>
handleChatConfig(const http::request<http::string_body> &req,
                 const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  return makeJsonResponse(http::status::ok,
                          json::object{
                              {"ollama_url_set", std::getenv("BEEMETRY_OLLAMA_URL") != nullptr},
                              {"whatsapp_configured",
                               !config::AppConfig::instance().gWhatsappAccessToken.empty() &&
                                   !config::AppConfig::instance().gWhatsappPhoneNumberId.empty()},
                          });
}

static http::response<http::string_body>
handleChatMessage(const http::request<http::string_body> &req,
                  const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  try {
    auto val = json::parse(req.body());
    if (!val.is_object()) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_body"}});
    }
    const auto &obj = val.as_object();

    // Canal (ADR-117): HomeMinero (plataforma web, default por compatibilidad
    // retro con clientes que no lo manden) | MovilMinero (terminal de campo,
    // app futura).
    std::string channel = "HomeMinero";
    if (obj.contains("channel") && obj.at("channel").is_string()) {
      channel = json::value_to<std::string>(obj.at("channel"));
    }
    static const std::set<std::string> kValidChannels = {"HomeMinero", "MovilMinero"};
    if (!kValidChannels.count(channel)) {
      return makeJsonResponse(http::status::bad_request, json::object{{"error", "invalid_channel"}});
    }
    std::string conversationId;
    if (obj.contains("conversation_id") && obj.at("conversation_id").is_string()) {
      conversationId = json::value_to<std::string>(obj.at("conversation_id"));
    }
    std::string intentRaw = "chat";
    if (obj.contains("intent") && obj.at("intent").is_string()) {
      intentRaw = json::value_to<std::string>(obj.at("intent"));
    }
    std::string userTurnContent;
    if (obj.contains("messages") && obj.at("messages").is_array()) {
      const auto &messages = obj.at("messages").as_array();
      if (!messages.empty() && messages.back().is_object()) {
        const auto &last = messages.back().as_object();
        if (last.contains("role") &&
            json::value_to<std::string>(last.at("role")) == "user" &&
            last.contains("content") && last.at("content").is_string()) {
          userTurnContent = json::value_to<std::string>(last.at("content"));
        }
      }
    }

    auto out = support::handleChatMessage(val, session->tenantId);
    if (out.contains("error")) {
      const std::string e = json::value_to<std::string>(out.at("error"));
      if (e == "ollama_not_configured" || e == "ollama_unavailable") {
        return makeJsonResponse(http::status::service_unavailable, out);
      }
      return makeJsonResponse(http::status::bad_request, out);
    }

    // Persistencia best-effort (ADR-116): un fallo acá nunca debe tumbar la
    // respuesta del chat, ya generada y lista para el usuario.
    auto &cfg = config::AppConfig::instance();
    if (!userTurnContent.empty()) {
      conversationId = support::persistChatMessagePg(cfg.gDatabaseUrl, conversationId,
                                                      session->tenantId, session->userId, channel,
                                                      "user", userTurnContent, intentRaw);
    }
    if (out.contains("reply")) {
      conversationId = support::persistChatMessagePg(
          cfg.gDatabaseUrl, conversationId, session->tenantId, session->userId, channel,
          "assistant", json::value_to<std::string>(out.at("reply")), intentRaw);
    }
    if (!conversationId.empty()) {
      out["conversation_id"] = conversationId;
    }
    return makeJsonResponse(http::status::ok, out);
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
}

// GET /api/support/admin/tickets -- búsqueda/filtro de tickets para el panel
// admin (ADR-116). Visibilidad global (no aislada por tenant, ver ADR-116:
// soporte/comercial/reclamo/rrhh son un dominio operativo de la EMPRESA, no
// del tenant minero) para quien tenga soporte.view/soporte.manage; un
// usuario solo con `department` (ADR-115) queda limitado a su categoría --
// forzada server-side, nunca confiada al query param.
static http::response<http::string_body>
handleSearchTickets(const http::request<http::string_body> &req,
                    const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  const bool globalView =
      auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.view") ||
      auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.manage");
  const auto dept = auth::effectiveDepartment(session->userId, session->tenantId);
  if (!globalView && !dept) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "soporte.view"}});
  }

  auto qv = [&](const char *key) -> std::optional<std::string> {
    auto it = query.find(key);
    if (it == query.end() || it->second.empty()) return std::nullopt;
    return it->second;
  };

  support::TicketSearchFilter filter;
  filter.category = qv("category");
  if (!globalView) {
    // Department-scoped: nunca se confía en el category pedido -- si pide
    // otro, se rechaza explícitamente (nunca se ignora en silencio).
    if (filter.category && *filter.category != *dept) {
      return makeJsonResponse(http::status::forbidden,
                              json::object{{"error", "forbidden_category"}});
    }
    filter.category = *dept;
  }
  filter.status = qv("status");
  filter.channel = qv("channel");
  filter.priority = qv("priority");
  filter.q = qv("q");
  filter.dateFrom = qv("date_from");
  filter.dateTo = qv("date_to");
  filter.tenantId = qv("tenant_id"); // narrowing opcional, no aislamiento (ver ADR-116)

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

  const auto result =
      support::searchTicketsPg(config::AppConfig::instance().gDatabaseUrl, filter);
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

// GET /api/support/admin/chat-messages -- búsqueda/filtro del historial del
// chat web (ADR-116). Requiere soporte.view/soporte.manage siempre -- el
// chat web no tiene categoría por mensaje, así que un usuario solo con
// `department` no tiene forma de acotar la vista y queda fuera (403).
static http::response<http::string_body>
handleSearchChatMessages(const http::request<http::string_body> &req,
                         const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.view") &&
      !auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "soporte.view"}});
  }

  auto qv = [&](const char *key) -> std::optional<std::string> {
    auto it = query.find(key);
    if (it == query.end() || it->second.empty()) return std::nullopt;
    return it->second;
  };

  support::ChatMessageSearchFilter filter;
  filter.conversationId = qv("conversation_id");
  filter.tenantId = qv("tenant_id");
  filter.q = qv("q");
  filter.dateFrom = qv("date_from");
  filter.dateTo = qv("date_to");

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

  const auto result =
      support::searchChatMessagesPg(config::AppConfig::instance().gDatabaseUrl, filter);
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

// GET /api/support/admin/chat-attachments -- panel admin (ADR-129), mismo
// RBAC que handleSearchChatMessages (soporte.view/soporte.manage). Devuelve
// solo metadatos (ocr_text/qr_codes incluidos) -- el binario se descarga
// aparte vía GET /api/support/chat/attachment/{id} (handleDownloadChatAttachment),
// que ya está gateado por tenant_id.
static http::response<http::string_body>
handleSearchChatAttachments(const http::request<http::string_body> &req,
                            const std::unordered_map<std::string, std::string> &query) {
#if HAS_LIBPQ
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  if (!auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.view") &&
      !auth::hasPermission(session->userId, session->tenantId, session->role, "soporte.manage")) {
    return makeJsonResponse(http::status::forbidden,
                            json::object{{"error", "forbidden"}, {"need", "soporte.view"}});
  }

  auto qv = [&](const char *key) -> std::optional<std::string> {
    auto it = query.find(key);
    if (it == query.end() || it->second.empty()) return std::nullopt;
    return it->second;
  };

  support::ChatAttachmentSearchFilter filter;
  filter.conversationId = qv("conversation_id");
  filter.tenantId = qv("tenant_id");
  filter.dateFrom = qv("date_from");
  filter.dateTo = qv("date_to");

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

  const auto result =
      support::searchChatAttachmentsPg(config::AppConfig::instance().gDatabaseUrl, filter);
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

static http::response<http::string_body>
handleEscalate(const http::request<http::string_body> &req,
              const std::unordered_map<std::string, std::string> &query) {
  const auto session = auth::resolveAuthSession(req, query);
  if (!session) {
    return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  }
  try {
    json::value val = json::object{};
    if (!req.body().empty()) {
      val = json::parse(req.body());
    }
    auto out = support::handleEscalateToWhatsapp(val);
    if (out.contains("error")) {
      const std::string e = json::value_to<std::string>(out.at("error"));
      if (e == "whatsapp_not_configured" || e == "support_number_not_configured") {
        return makeJsonResponse(http::status::service_unavailable, out);
      }
      return makeJsonResponse(http::status::bad_gateway, out);
    }
    return makeJsonResponse(http::status::ok, out);
  } catch (const std::exception &ex) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", ex.what()}});
  }
}

void registerRoutes(router::Router &r) {
  r.get("/api/support/chat/config", handleChatConfig);
  r.post("/api/support/chat/message", handleChatMessage);
  r.post("/api/support/whatsapp/escalate", handleEscalate);
  r.post("/api/support/tickets", handleCreateTicket);
  r.post("/api/support/chat/attachment", handleUploadChatAttachment);
  // Prefijo (path termina en '/'): handleDownloadChatAttachment resuelve el
  // id desde el propio target de la request.
  r.get("/api/support/chat/attachment/", handleDownloadChatAttachment);
  r.post("/api/support/cv/submit", handleSubmitWebCv);
  r.get("/api/support/admin/chat-attachments", handleSearchChatAttachments);
  // Prefijo (path termina en '/'): handleGetTicket/handleUpdateTicketStatus
  // resuelven el código (y el sufijo /status) desde el propio target de la
  // request -- ver ticketPathSegments.
  r.get("/api/support/tickets/", handleGetTicket);
  r.put("/api/support/tickets/", handleUpdateTicketStatus);
  r.get("/api/support/whatsapp/contact-numbers", handleListContactNumbers);
  r.put("/api/support/whatsapp/contact-numbers/", handleSetContactNumber);
  r.get("/api/support/admin/tickets", handleSearchTickets);
  r.get("/api/support/admin/chat-messages", handleSearchChatMessages);
}

} // namespace support_mod
