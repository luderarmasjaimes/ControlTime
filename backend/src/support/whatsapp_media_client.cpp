#include "whatsapp_media_client.hpp"

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/json.hpp>

#include <iostream>
#include <regex>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;
namespace ssl = boost::asio::ssl;
namespace json = boost::json;

using config::AppConfig;

#define gWhatsappApiBaseUrl AppConfig::instance().gWhatsappApiBaseUrl
#define gWhatsappApiVersion AppConfig::instance().gWhatsappApiVersion
#define gWhatsappTimeoutMs  AppConfig::instance().gWhatsappTimeoutMs

namespace support {

namespace {

struct HttpsGetResult {
  bool ok = false;
  int status = 0;
  std::string body;
  std::string error;
};

/** @brief GET HTTPS con Authorization: Bearer y tope de tamaño de respuesta
 * -- mismo patrón TLS que whatsapp_client.cpp::httpsPostJsonWithBearer
 * (duplicado a propósito, convención ya establecida: cada archivo mantiene
 * su propio cliente HTTP mínimo autocontenido), pero GET y con
 * `body_limit(maxBytes)` para que una respuesta más grande de lo esperado
 * corte la descarga en vez de bufferizarla entera primero. */
HttpsGetResult httpsGetWithBearer(const std::string &host, const std::string &target,
                                   const std::string &bearerToken, int timeoutMs,
                                   std::size_t maxBytes) {
  HttpsGetResult out;
  try {
    asio::io_context ioc;
    ssl::context ctx{ssl::context::tls_client};
    ctx.set_default_verify_paths();
    ctx.set_verify_mode(ssl::verify_peer);

    beast::ssl_stream<beast::tcp_stream> stream{ioc, ctx};
    if (!SSL_set_tlsext_host_name(stream.native_handle(), host.c_str())) {
      out.error = "sni_set_failed";
      return out;
    }

    beast::error_code ec;
    asio::ip::tcp::resolver resolver{ioc};
    auto const results = resolver.resolve(host, "443", ec);
    if (ec) { out.error = "resolve_failed"; return out; }

    beast::get_lowest_layer(stream).expires_after(std::chrono::milliseconds(timeoutMs));
    beast::get_lowest_layer(stream).connect(results, ec);
    if (ec) { out.error = "connect_failed"; return out; }

    stream.handshake(ssl::stream_base::client, ec);
    if (ec) { out.error = "tls_handshake_failed: " + ec.message(); return out; }

    http::request<http::string_body> req{http::verb::get, target, 11};
    req.set(http::field::host, host);
    req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
    req.set(http::field::authorization, "Bearer " + bearerToken);
    req.prepare_payload();

    http::write(stream, req, ec);
    if (ec) { out.error = "write_failed"; return out; }

    beast::flat_buffer buffer;
    http::response_parser<http::string_body> parser;
    parser.body_limit(maxBytes);
    http::read(stream, buffer, parser, ec);
    if (ec && ec != http::error::end_of_stream && ec != asio::ssl::error::stream_truncated) {
      out.error = (ec == http::error::body_limit) ? "body_too_large"
                                                            : ("read_failed: " + ec.message());
      return out;
    }
    auto res = parser.release();
    out.status = static_cast<int>(res.result_int());
    out.body = res.body();
    out.ok = true;

    beast::get_lowest_layer(stream).expires_after(std::chrono::seconds(3));
    stream.shutdown(ec); // Graph API/CDN a veces cierra sin close_notify -- se ignora
  } catch (const std::exception &ex) {
    out.error = std::string("exception: ") + ex.what();
  }
  return out;
}

struct ParsedHttpsUrl {
  std::string host;
  std::string target = "/";
};

bool parseHttpsUrl(const std::string &url, ParsedHttpsUrl &out) {
  static const std::regex kRe(R"(^https://([^/]+)(/.*)?$)", std::regex::icase);
  std::smatch m;
  if (!std::regex_match(url, m, kRe)) return false;
  out.host = m[1].str();
  if (m.size() > 2 && m[2].matched && !m[2].str().empty()) out.target = m[2].str();
  return !out.host.empty();
}

std::string jsonGetStr(const json::object &o, const char *key) {
  return o.contains(key) && o.at(key).is_string() ? json::value_to<std::string>(o.at(key)) : "";
}

} // namespace

WhatsappMediaDownloadResult downloadWhatsappMedia(const config::WhatsappLine &line,
                                                   const std::string &mediaId,
                                                   std::size_t maxBytes) {
  WhatsappMediaDownloadResult out;
  if (line.accessToken.empty()) {
    out.error = "whatsapp_not_configured";
    return out;
  }
  if (mediaId.empty()) {
    out.error = "missing_media_id";
    return out;
  }

  // Paso 1: media-info -- URL firmada de corta duración + tamaño/mime reales
  // (no confiar en lo que dijo el webhook, ver whatsapp_bot_engine.cpp).
  const std::string infoTarget = "/" + gWhatsappApiVersion + "/" + mediaId;
  const auto infoRes =
      httpsGetWithBearer(gWhatsappApiBaseUrl, infoTarget, line.accessToken, gWhatsappTimeoutMs,
                        64U * 1024U);
  if (!infoRes.ok || infoRes.status < 200 || infoRes.status >= 300) {
    out.error = infoRes.error.empty() ? ("media_info_http_" + std::to_string(infoRes.status))
                                      : infoRes.error;
    return out;
  }

  std::string mediaUrl;
  std::string mimeType;
  std::size_t reportedSize = 0;
  try {
    const auto parsed = json::parse(infoRes.body);
    if (!parsed.is_object()) { out.error = "media_info_invalid_json"; return out; }
    const auto &obj = parsed.as_object();
    mediaUrl = jsonGetStr(obj, "url");
    mimeType = jsonGetStr(obj, "mime_type");
    if (obj.contains("file_size")) {
      const auto &fs = obj.at("file_size");
      if (fs.is_int64()) reportedSize = static_cast<std::size_t>(fs.as_int64());
      else if (fs.is_string()) {
        try { reportedSize = static_cast<std::size_t>(std::stoull(json::value_to<std::string>(fs))); }
        catch (...) { reportedSize = 0; }
      }
    }
  } catch (...) {
    out.error = "media_info_parse_failed";
    return out;
  }
  if (mediaUrl.empty()) {
    out.error = "media_info_no_url";
    return out;
  }
  // Chequeo de tamaño ANTES de descargar (evita gastar ancho de banda en un
  // documento que de todos modos se va a rechazar, ver ADR-122).
  if (reportedSize > 0 && reportedSize > maxBytes) {
    out.error = "file_too_large";
    return out;
  }

  // Paso 2: descarga real -- mismo bearer token (Meta exige repetirlo aquí).
  ParsedHttpsUrl ep;
  if (!parseHttpsUrl(mediaUrl, ep)) {
    out.error = "media_url_invalid";
    return out;
  }
  const auto dlRes = httpsGetWithBearer(ep.host, ep.target, line.accessToken, gWhatsappTimeoutMs,
                                        maxBytes + 4096);
  if (!dlRes.ok || dlRes.status < 200 || dlRes.status >= 300) {
    out.error = dlRes.error.empty() ? ("media_download_http_" + std::to_string(dlRes.status))
                                    : dlRes.error;
    return out;
  }
  // Segundo chequeo de tamaño, ahora sobre los bytes reales -- nunca se
  // confía en un solo control (defensa en profundidad, ver ADR-122).
  if (dlRes.body.size() > maxBytes) {
    out.error = "file_too_large";
    return out;
  }

  out.bytes.assign(dlRes.body.begin(), dlRes.body.end());
  out.mimeType = mimeType;
  out.ok = true;
  return out;
}

} // namespace support
