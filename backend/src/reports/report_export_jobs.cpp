#include "report_export_jobs.hpp"
#include "report_service.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../mining/alarm_notifier.hpp"

#include <fstream>
#include <regex>

#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/json.hpp>

// SO_RCVTIMEO/SO_SNDTIMEO -- ver comentario detallado junto a su uso en
// `postJsonToSidecar` más abajo: `beast::tcp_stream::expires_after()` NO
// aplica de forma confiable a las llamadas SÍNCRONAS que usa esta función
// (reproducido en vivo: un job DOCX de 2104 páginas quedó "running" en la
// base de datos 39+ minutos después de que el sidecar ya había terminado y
// escrito el .docx en disco -- el hilo del backend nunca se enteró). Estas
// dos opciones de socket son la única garantía POSIX real de que una
// llamada bloqueante (`::read`/`::write` por debajo de `http::read`/
// `http::write`) va a retornar con un error tras el plazo configurado, sin
// depender de ningún mecanismo interno de Beast/Asio.
#include <sys/socket.h>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;
namespace json = boost::json;

namespace reports {

namespace {

struct ParsedUrl {
  std::string host;
  std::string port = "80";
  std::string target = "/";
};

// Mismo parser mínimo que report_pdf_export.cpp (duplicado a propósito, no
// extraído a un helper compartido: ambos archivos solo direccionan URLs
// http:// internas simples del sidecar, y mantenerlos independientes evita
// acoplar el pipeline de PDF a cambios pensados solo para PPTX/MP4).
bool parseUrl(const std::string &url, ParsedUrl &out) {
  static const std::regex kHttpRegex(
      R"(^http://([A-Za-z0-9\.\-_]+)(?::([0-9]{1,5}))?(\/.*)?$)",
      std::regex::icase);
  std::smatch m;
  if (!std::regex_match(url, m, kHttpRegex)) return false;
  out.host = m[1].str();
  if (m.size() > 2 && m[2].matched) out.port = m[2].str();
  if (m.size() > 3 && m[3].matched && !m[3].str().empty()) out.target = m[3].str();
  return !out.host.empty();
}

std::string urlEncode(const std::string &value) {
  static const char *hex = "0123456789ABCDEF";
  std::string out;
  out.reserve(value.size());
  for (unsigned char c : value) {
    if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      out += static_cast<char>(c);
    } else {
      out += '%';
      out += hex[c >> 4];
      out += hex[c & 0x0F];
    }
  }
  return out;
}

struct SidecarResult {
  bool ok = false;
  json::object body;
  std::string error;
};

// POST JSON síncrono al sidecar — se llama siempre desde el hilo detached del
// worker, nunca desde el hilo que atiende el request HTTP original.
SidecarResult postJsonToSidecar(const std::string &baseUrl, const std::string &path,
                                const json::object &requestBody, int timeoutMs) {
  SidecarResult result;
  if (baseUrl.empty()) {
    result.error = "pptx_export_disabled";
    return result;
  }
  ParsedUrl endpoint;
  if (!parseUrl(baseUrl + path, endpoint)) {
    result.error = "pptx_export_invalid_url";
    return result;
  }

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(timeoutMs));

  auto const resolved = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) {
    result.error = "pptx_export_resolve_failed";
    return result;
  }
  stream.connect(resolved, ec);
  if (ec) {
    result.error = "pptx_export_connect_failed";
    return result;
  }
  // `stream.expires_after()` de arriba queda como defensa adicional, pero NO
  // es la garantía real -- ver comentario del include de <sys/socket.h> más
  // arriba. `SO_RCVTIMEO`/`SO_SNDTIMEO` acotan cada llamada bloqueante
  // individual (no una única cuenta regresiva acumulada desde el connect):
  // exactamente lo que hace falta acá, porque el render del sidecar (varios
  // minutos, todo ANTES de que empiece a escribir su respuesta) pasa
  // enteramente DENTRO de la espera del `http::read()` de abajo -- un solo
  // plazo acumulado desde el connect tendría que ser generoso para el peor
  // caso igual, así que no hay downside real en medir por-llamada.
  {
    struct timeval tv;
    tv.tv_sec = timeoutMs / 1000;
    tv.tv_usec = (timeoutMs % 1000) * 1000;
    setsockopt(stream.socket().native_handle(), SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(stream.socket().native_handle(), SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
  }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "application/json");
  req.body() = json::serialize(requestBody);
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) {
    result.error = "pptx_export_write_failed";
    return result;
  }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  // Ver comentario del mismo patrón en report_pdf_export.cpp::exportReportPdf
  // -- `shutdown()` NO debe reusar la `ec` que acaba de poner `http::read()`,
  // o un error real de lectura queda enmascarado por el resultado (casi
  // siempre benigno) del shutdown de un socket ya roto.
  const bool readFailed = static_cast<bool>(ec) && ec != beast::errc::not_connected;
  beast::error_code shutdownEc;
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, shutdownEc);
  if (readFailed) {
    result.error = "pptx_export_read_failed";
    return result;
  }

  json::value payload;
  try {
    payload = json::parse(res.body());
  } catch (...) {
    payload = json::object{};
  }

  if (res.result() != http::status::ok) {
    result.error = "pptx_export_render_failed";
    if (payload.is_object() && payload.as_object().if_contains("error")) {
      result.error = json::value_to<std::string>(payload.as_object().at("error"));
    }
    return result;
  }

  result.ok = true;
  if (payload.is_object()) result.body = payload.as_object();
  return result;
}

}  // namespace

void runPptxExportJob(const std::string &jobId, const std::string &reportId,
                      const std::string &sessionToken) {
  auto &cfg = config::AppConfig::instance();
  std::string statusError;
  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "running", "", "", statusError);

  // Misma URL interna que exportReportPdf: la página real que el usuario ve
  // (print-report.html -> ReadOnlyViewer), autenticada con el token de quien
  // pidió el export — el sidecar nunca recibe credenciales propias.
  const std::string printUrl = cfg.gFrontendInternalOrigin + "/print-report.html?id=" +
                               urlEncode(reportId) + "&token=" + urlEncode(sessionToken);

  const auto sidecarResult =
      postJsonToSidecar(cfg.gPdfExportUrl, "/render-pptx",
                        json::object{{"url", printUrl}, {"job_id", jobId}},
                        cfg.gPptxExportTimeoutMs);

  if (!sidecarResult.ok) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "", sidecarResult.error,
                            statusError);
    return;
  }

  std::string storagePath;
  if (sidecarResult.body.if_contains("storage_path") &&
      sidecarResult.body.at("storage_path").is_string()) {
    storagePath = json::value_to<std::string>(sidecarResult.body.at("storage_path"));
  }
  if (storagePath.empty()) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                            "pptx_export_missing_storage_path", statusError);
    return;
  }

  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "success", storagePath, "", statusError);
}

void runDocxExportJob(const std::string &jobId, const std::string &reportId,
                      const std::string &sessionToken, const std::string &layout) {
  auto &cfg = config::AppConfig::instance();
  std::string statusError;
  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "running", "", "", statusError);

  const std::string printUrl = cfg.gFrontendInternalOrigin + "/print-report.html?id=" +
                               urlEncode(reportId) + "&token=" + urlEncode(sessionToken);

  const auto sidecarResult =
      postJsonToSidecar(cfg.gPdfExportUrl, "/render-docx",
                        json::object{{"url", printUrl}, {"job_id", jobId}, {"layout", layout}},
                        cfg.gDocxExportTimeoutMs);

  if (!sidecarResult.ok) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "", sidecarResult.error,
                            statusError);
    return;
  }

  std::string storagePath;
  if (sidecarResult.body.if_contains("storage_path") &&
      sidecarResult.body.at("storage_path").is_string()) {
    storagePath = json::value_to<std::string>(sidecarResult.body.at("storage_path"));
  }
  if (storagePath.empty()) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                            "docx_export_missing_storage_path", statusError);
    return;
  }

  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "success", storagePath, "", statusError);
}

void runPdfExportJob(const std::string &jobId, const std::string &reportId,
                     const std::string &sessionToken, const std::string &watermarkText,
                     bool unprotected, bool noWatermark, const std::string &ownerEmail,
                     const std::vector<std::string> &extraRecipients,
                     const std::string &reportTitle, const std::string &username) {
  auto &cfg = config::AppConfig::instance();
  std::string statusError;
  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "running", "", "", statusError);

  const std::string printUrl = cfg.gFrontendInternalOrigin + "/print-report.html?id=" +
                               urlEncode(reportId) + "&token=" + urlEncode(sessionToken);

  // Endpoint DEDICADO del job async (`/render-pdf`, sidecar) -- separado del
  // `/render` síncrono que sigue usando `exportReportPdf`
  // (report_pdf_export.cpp) para informes chicos, sin cambios. Cifrado
  // (ADR-080) sigue siendo el default -- `unprotected` (permission code
  // `informes.export_sin_clave`, ya verificado por el caller) es la ÚNICA
  // forma de desactivarlo acá. `noWatermark` (ADR-204, permission code
  // `informes.export_sin_marca_agua`, también ya verificado por el caller):
  // manda `"watermark": false` explícito -- cualquier otro valor (el objeto
  // de texto de siempre) sigue dibujando el sello, ver server.js.
  json::object sidecarBody{
      {"url", printUrl}, {"job_id", jobId}, {"encrypt", !unprotected}};
  sidecarBody["watermark"] =
      noWatermark ? json::value(false) : json::value(json::object{{"text", watermarkText}});
  const auto sidecarResult =
      postJsonToSidecar(cfg.gPdfExportUrl, "/render-pdf", sidecarBody, cfg.gPdfExportTimeoutMs);

  if (!sidecarResult.ok) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "", sidecarResult.error,
                            statusError);
    return;
  }

  std::string storagePath;
  if (sidecarResult.body.if_contains("storage_path") &&
      sidecarResult.body.at("storage_path").is_string()) {
    storagePath = json::value_to<std::string>(sidecarResult.body.at("storage_path"));
  }
  if (storagePath.empty()) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                            "pdf_export_missing_storage_path", statusError);
    return;
  }

  // Contraseña de usuario (ADR-080) generada recién por el sidecar al
  // cifrar -- no existía todavía cuando se creó el job, así que se guarda
  // acá vía el merge de `options` de `updateExportJobStatusPg` (nunca pisa
  // el resto del objeto). El endpoint de descarga (report_routes.cpp) la
  // lee de ahí para devolverla igual que el pipeline síncrono
  // (`X-Pdf-User-Password`).
  std::string userPassword;
  if (sidecarResult.body.if_contains("user_password") &&
      sidecarResult.body.at("user_password").is_string()) {
    userPassword = json::value_to<std::string>(sidecarResult.body.at("user_password"));
  }
  const json::value mergeOptions = userPassword.empty()
      ? json::value()
      : json::value(json::object{{"user_password", userPassword}});

  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "success", storagePath, "", statusError,
                          mergeOptions);

  // ADR-204: envío por correo best-effort, ya corriendo en el hilo detached
  // de este job -- no hace falta un thread aparte acá (a diferencia del
  // pipeline síncrono, que sí necesita uno para no sumar latencia al
  // request). Un fallo de lectura/envío nunca revierte el "success" de
  // arriba: el PDF ya quedó generado y descargable por la vía normal.
  if (!ownerEmail.empty() || !extraRecipients.empty()) {
    std::ifstream ifs(storagePath, std::ios::binary);
    if (ifs) {
      std::string pdfBytes((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
      sendPdfExportEmails(reportTitle, username, pdfBytes, unprotected, noWatermark, userPassword,
                         ownerEmail, extraRecipients);
    }
  }
}

void sendPdfExportEmails(const std::string &reportTitle, const std::string &username,
                         const std::string &pdfBytes, bool unprotected, bool noWatermark,
                         const std::string &userPassword, const std::string &ownerEmail,
                         const std::vector<std::string> &extraRecipients) {
  std::vector<std::string> recipients;
  if (!ownerEmail.empty()) recipients.push_back(ownerEmail);
  for (const auto &e : extraRecipients) {
    if (e != ownerEmail) recipients.push_back(e);  // evita duplicar si el propio exportador se agregó a la lista
  }
  if (recipients.empty()) return;

  auto &cfg = config::AppConfig::instance();
  const std::string displayTitle = reportTitle.empty() ? "Informe" : reportTitle;
  const std::string subject = "[Beemetry] PDF exportado: " + displayTitle;

  std::string body = "Se generó el PDF del informe \"" + displayTitle + "\".\n\n";
  if (!unprotected && !userPassword.empty()) {
    body += "Contraseña de acceso: " + userPassword + "\n";
  }
  body += noWatermark ? "Este PDF NO lleva marca de agua (perfil avanzado).\n"
                      : "Este PDF lleva marca de agua de confidencialidad.\n";

  const std::size_t maxBytes =
      static_cast<std::size_t>(cfg.gPdfEmailMaxAttachmentMb) * 1024 * 1024;
  const bool attach = !pdfBytes.empty() && pdfBytes.size() <= maxBytes;
  if (!pdfBytes.empty() && !attach) {
    body += "\nEl PDF (" + std::to_string(pdfBytes.size() / (1024 * 1024)) +
            " MB) supera el límite de envío por correo -- descárguelo desde la plataforma.\n";
  }
  body += "\nGenerado el " + http_utils::nowIso8601().substr(0, 10) +
         (username.empty() ? "" : (" por " + username)) + ".\n";

  const std::vector<unsigned char> attachmentBytes =
      attach ? std::vector<unsigned char>(pdfBytes.begin(), pdfBytes.end())
             : std::vector<unsigned char>{};
  for (const auto &to : recipients) {
    std::string detail;
    if (attach) {
      mining_iot::sendEmailWithAttachment(to, subject, body, displayTitle + ".pdf",
                                          "application/pdf", attachmentBytes, detail);
    } else {
      mining_iot::sendPlainEmail(to, subject, body, detail);
    }
    // Best-effort a propósito -- ver comentario del .hpp: un SMTP caído no
    // debe borrar el resultado del export, que ya terminó bien.
  }
}

void runVideoExportJob(const std::string &jobId, const std::string &pptxStoragePath,
                       int slideDurationSeconds, const std::string &transition,
                       const json::array &narration) {
  auto &cfg = config::AppConfig::instance();
  std::string statusError;
  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "running", "", "", statusError);

  const auto sidecarResult = postJsonToSidecar(
      cfg.gPdfExportUrl, "/render-video",
      json::object{{"pptx_path", pptxStoragePath},
                  {"job_id", jobId},
                  {"slide_duration_seconds", slideDurationSeconds},
                  {"transition", transition},
                  {"narration", narration}},
      cfg.gVideoExportTimeoutMs);

  if (!sidecarResult.ok) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "", sidecarResult.error, statusError);
    return;
  }

  std::string storagePath;
  if (sidecarResult.body.if_contains("storage_path") &&
      sidecarResult.body.at("storage_path").is_string()) {
    storagePath = json::value_to<std::string>(sidecarResult.body.at("storage_path"));
  }
  if (storagePath.empty()) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                            "video_export_missing_storage_path", statusError);
    return;
  }

  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "success", storagePath, "", statusError);
}

void runXlsxExportJob(const std::string &jobId, const std::string &reportId,
                      const std::string &sessionToken) {
  auto &cfg = config::AppConfig::instance();
  std::string statusError;
  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "running", "", "", statusError);

  const std::string printUrl = cfg.gFrontendInternalOrigin + "/print-report.html?id=" +
                               urlEncode(reportId) + "&token=" + urlEncode(sessionToken);

  const auto sidecarResult =
      postJsonToSidecar(cfg.gPdfExportUrl, "/render-xlsx",
                        json::object{{"url", printUrl}, {"job_id", jobId}},
                        cfg.gXlsxExportTimeoutMs);

  if (!sidecarResult.ok) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "", sidecarResult.error,
                            statusError);
    return;
  }

  std::string storagePath;
  if (sidecarResult.body.if_contains("storage_path") &&
      sidecarResult.body.at("storage_path").is_string()) {
    storagePath = json::value_to<std::string>(sidecarResult.body.at("storage_path"));
  }
  if (storagePath.empty()) {
    updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                            "xlsx_export_missing_storage_path", statusError);
    return;
  }

  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "success", storagePath, "", statusError);
}

}  // namespace reports
