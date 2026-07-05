#include "report_pdf_export.hpp"
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

// Parser mínimo local (en vez de reusar biometric::parseHttpEndpoint, que
// viviría en un dominio no relacionado): el sidecar de PDF export solo se
// direcciona por URLs http:// internas simples (sin query ni auth en el
// host), el mismo patrón que ya usa el cliente del AI engine.
bool parseUrl(const std::string &url, ParsedUrl &out) {
  static const std::regex kHttpRegex(
      R"(^http://([A-Za-z0-9\.\-_]+)(?::([0-9]{1,5}))?(\/.*)?$)",
      std::regex::icase);
  std::smatch m;
  if (!std::regex_match(url, m, kHttpRegex)) {
    return false;
  }
  out.host = m[1].str();
  if (m.size() > 2 && m[2].matched) {
    out.port = m[2].str();
  }
  if (m.size() > 3 && m[3].matched && !m[3].str().empty()) {
    out.target = m[3].str();
  }
  return !out.host.empty();
}

// Percent-encoding mínimo para valores de query string (id UUID y token hex
// ya son URL-safe, pero se codifica de todas formas por robustez/defensa).
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

}  // namespace

PdfExportResult exportReportPdf(const std::string &reportId, const std::string &sessionToken) {
  PdfExportResult result;
  auto &cfg = config::AppConfig::instance();
  if (cfg.gPdfExportUrl.empty()) {
    result.error = "pdf_export_disabled";
    return result;
  }

  ParsedUrl endpoint;
  if (!parseUrl(cfg.gPdfExportUrl + "/render", endpoint)) {
    result.error = "pdf_export_invalid_url";
    return result;
  }

  // URL interna que Chromium (dentro del sidecar) va a navegar: la MISMA
  // página que el usuario ve en modo lectura (ver print-report.html /
  // src/print-report/main.jsx), autenticada con el token de la sesión que
  // pidió el export — nunca credenciales nuevas ni bypass de auth.
  const std::string printUrl = cfg.gFrontendInternalOrigin + "/print-report.html?id=" +
                               urlEncode(reportId) + "&token=" + urlEncode(sessionToken);
  const std::string requestBody = json::serialize(json::object{{"url", printUrl}});

  beast::error_code ec;
  asio::io_context ioc;
  asio::ip::tcp::resolver resolver{ioc};
  beast::tcp_stream stream{ioc};
  stream.expires_after(std::chrono::milliseconds(cfg.gPdfExportTimeoutMs));

  auto const resolved = resolver.resolve(endpoint.host, endpoint.port, ec);
  if (ec) {
    result.error = "pdf_export_resolve_failed";
    return result;
  }
  stream.connect(resolved, ec);
  if (ec) {
    result.error = "pdf_export_connect_failed";
    return result;
  }

  http::request<http::string_body> req{http::verb::post, endpoint.target, 11};
  req.set(http::field::host, endpoint.host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "application/json");
  req.body() = requestBody;
  req.prepare_payload();

  http::write(stream, req, ec);
  if (ec) {
    result.error = "pdf_export_write_failed";
    return result;
  }

  beast::flat_buffer buffer;
  http::response<http::string_body> res;
  http::read(stream, buffer, res, ec);
  stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);

  if (ec && ec != beast::errc::not_connected) {
    result.error = "pdf_export_read_failed";
    return result;
  }
  if (res.result() != http::status::ok) {
    result.error = "pdf_export_render_failed";
    // El sidecar devuelve {"error": "...", "detail": "..."} en JSON en caso
    // de fallo; se propaga si el content-type lo confirma.
    auto it = res.find(http::field::content_type);
    if (it != res.end() && it->value().find("application/json") != std::string::npos) {
      try {
        auto payload = json::parse(res.body());
        if (payload.is_object() && payload.as_object().if_contains("error")) {
          result.error = json::value_to<std::string>(payload.as_object().at("error"));
        }
      } catch (...) {
      }
    }
    return result;
  }

  result.ok = true;
  result.pdfBytes = std::move(res.body());
  return result;
}

}  // namespace reports
