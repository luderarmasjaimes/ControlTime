#include "whatsapp_client.hpp"
#include "../config/app_config.hpp"

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/json.hpp>

#include <iostream>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;
namespace ssl = boost::asio::ssl;
namespace json = boost::json;

using config::AppConfig;

#define gWhatsappApiBaseUrl        AppConfig::instance().gWhatsappApiBaseUrl
#define gWhatsappApiVersion        AppConfig::instance().gWhatsappApiVersion
#define gWhatsappPhoneNumberId     AppConfig::instance().gWhatsappPhoneNumberId
#define gWhatsappAccessToken       AppConfig::instance().gWhatsappAccessToken
#define gWhatsappTimeoutMs         AppConfig::instance().gWhatsappTimeoutMs

namespace support {

namespace {

// Mismo patron que igp_seismic_client.cpp -- unico cliente HTTPS de salida
// con headers custom (Authorization Bearer) del backend. Se duplica en vez
// de compartir con igp_seismic_client.cpp/text_spell_service.cpp porque cada
// archivo mantiene su propio helper minimo autocontenido (convencion ya
// existente en este codebase, ver comentario en igp_seismic_client.cpp).
struct HttpsPostResult {
  bool ok = false;
  int status = 0;
  std::string body;
  std::string error;
};

HttpsPostResult httpsPostJsonWithBearer(const std::string &host, const std::string &target,
                                         const std::string &bearerToken,
                                         const std::string &jsonBody, int timeoutMs) {
  HttpsPostResult out;
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
    if (ec) {
      out.error = "resolve_failed";
      return out;
    }

    beast::get_lowest_layer(stream).expires_after(std::chrono::milliseconds(timeoutMs));
    beast::get_lowest_layer(stream).connect(results, ec);
    if (ec) {
      out.error = "connect_failed";
      return out;
    }

    stream.handshake(ssl::stream_base::client, ec);
    if (ec) {
      out.error = "tls_handshake_failed: " + ec.message();
      return out;
    }

    http::request<http::string_body> req{http::verb::post, target, 11};
    req.set(http::field::host, host);
    req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
    req.set(http::field::content_type, "application/json");
    req.set(http::field::authorization, "Bearer " + bearerToken);
    req.body() = jsonBody;
    req.prepare_payload();

    http::write(stream, req, ec);
    if (ec) {
      out.error = "write_failed";
      return out;
    }

    beast::flat_buffer buffer;
    http::response_parser<http::string_body> parser;
    parser.body_limit(2U * 1024U * 1024U);
    http::read(stream, buffer, parser, ec);
    if (ec && ec != http::error::end_of_stream && ec != asio::ssl::error::stream_truncated) {
      out.error = "read_failed: " + ec.message();
      return out;
    }
    auto res = parser.release();
    out.status = static_cast<int>(res.result_int());
    out.body = res.body();
    out.ok = true;

    beast::get_lowest_layer(stream).expires_after(std::chrono::seconds(3));
    stream.shutdown(ec); // Graph API a veces cierra sin close_notify -- se ignora
  } catch (const std::exception &ex) {
    out.error = std::string("exception: ") + ex.what();
  }
  return out;
}

} // namespace

WhatsappSendResult sendWhatsappTemplateMessage(const std::string &toE164,
                                                const std::string &templateName,
                                                const std::string &languageCode,
                                                const std::vector<std::string> &bodyParams) {
  WhatsappSendResult out;
  if (gWhatsappAccessToken.empty() || gWhatsappPhoneNumberId.empty()) {
    out.error = "whatsapp_not_configured";
    return out;
  }
  if (toE164.empty()) {
    out.error = "missing_recipient";
    return out;
  }

  json::object tmpl;
  tmpl["name"] = templateName;
  tmpl["language"] = json::object{{"code", languageCode}};
  if (!bodyParams.empty()) {
    json::array params;
    for (const auto &p : bodyParams) {
      params.push_back(json::object{{"type", "text"}, {"text", p}});
    }
    tmpl["components"] = json::array{json::object{{"type", "body"}, {"parameters", params}}};
  }

  json::object body;
  body["messaging_product"] = "whatsapp";
  body["to"] = toE164;
  body["type"] = "template";
  body["template"] = tmpl;

  const std::string target =
      "/" + gWhatsappApiVersion + "/" + gWhatsappPhoneNumberId + "/messages";
  const auto hr = httpsPostJsonWithBearer(gWhatsappApiBaseUrl, target, gWhatsappAccessToken,
                                          json::serialize(json::value(body)), gWhatsappTimeoutMs);
  out.rawResponse = hr.body;
  out.httpStatus = hr.status;
  if (!hr.error.empty()) {
    out.error = hr.error;
    std::cerr << "[WHATSAPP] error de red: " << hr.error << std::endl;
    return out;
  }
  if (hr.status < 200 || hr.status >= 300) {
    out.error = "whatsapp_http_" + std::to_string(hr.status);
    std::cerr << "[WHATSAPP] HTTP status=" << hr.status << " body=" << hr.body << std::endl;
    return out;
  }
  out.ok = true;
  return out;
}

} // namespace support
