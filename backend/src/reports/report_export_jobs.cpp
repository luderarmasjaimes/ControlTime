#include "report_export_jobs.hpp"
#include "report_service.hpp"
#include "../config/app_config.hpp"

#include <regex>

#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/json.hpp>

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
                      const std::string &sessionToken) {
  auto &cfg = config::AppConfig::instance();
  std::string statusError;
  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "running", "", "", statusError);

  const std::string printUrl = cfg.gFrontendInternalOrigin + "/print-report.html?id=" +
                               urlEncode(reportId) + "&token=" + urlEncode(sessionToken);

  const auto sidecarResult =
      postJsonToSidecar(cfg.gPdfExportUrl, "/render-docx",
                        json::object{{"url", printUrl}, {"job_id", jobId}},
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
                     const std::string &sessionToken, const std::string &watermarkText) {
  auto &cfg = config::AppConfig::instance();
  std::string statusError;
  updateExportJobStatusPg(cfg.gDatabaseUrl, jobId, "running", "", "", statusError);

  const std::string printUrl = cfg.gFrontendInternalOrigin + "/print-report.html?id=" +
                               urlEncode(reportId) + "&token=" + urlEncode(sessionToken);

  // Endpoint DEDICADO del job async (`/render-pdf`, sidecar) -- separado del
  // `/render` síncrono que sigue usando `exportReportPdf`
  // (report_pdf_export.cpp) para informes chicos, sin cambios. Mismo
  // criterio de cifrado (ADR-080, siempre activo) que el pipeline síncrono.
  const auto sidecarResult = postJsonToSidecar(
      cfg.gPdfExportUrl, "/render-pdf",
      json::object{{"url", printUrl},
                  {"job_id", jobId},
                  {"watermark", json::object{{"text", watermarkText}}},
                  {"encrypt", true}},
      cfg.gPdfExportTimeoutMs);

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

}  // namespace reports
