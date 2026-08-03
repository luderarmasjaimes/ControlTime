#include "igp_seismic_client.hpp"
#include "../config/app_config.hpp"

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/beast/ssl.hpp>

#include <iostream>
#include <regex>
#include <string>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;
namespace ssl = boost::asio::ssl;

using config::AppConfig;

#define gIgpApiBaseUrl config::AppConfig::instance().gIgpApiBaseUrl
#define gIgpTimeoutMs  config::AppConfig::instance().gIgpTimeoutMs

namespace mining {

namespace {

struct HttpsEndpoint {
  std::string host;
  std::string port = "443";
  std::string target = "/";
};

// A diferencia de biometric::parseHttpEndpoint (solo http://), este parser es
// para el unico cliente HTTPS de salida del backend -- exige esquema https.
bool parseHttpsEndpoint(const std::string &url, HttpsEndpoint &out) {
  static const std::regex kHttpsRegex(
      R"(^https://([A-Za-z0-9\.\-_]+)(?::([0-9]{1,5}))?(\/.*)?$)",
      std::regex::icase);
  std::smatch m;
  if (!std::regex_match(url, m, kHttpsRegex)) {
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

// GET simple sobre TLS -- unico caso de uso de este cliente (endpoints
// publicos de solo lectura del IGP), por eso no hay soporte de otros verbos.
std::string httpsGet(const HttpsEndpoint &endpoint, int timeoutMs, bool &ok) {
  ok = false;
  try {
    asio::io_context ioc;
    ssl::context ctx{ssl::context::tls_client};
    ctx.set_default_verify_paths();
    ctx.set_verify_mode(ssl::verify_peer);

    beast::ssl_stream<beast::tcp_stream> stream{ioc, ctx};
    if (!SSL_set_tlsext_host_name(stream.native_handle(), endpoint.host.c_str())) {
      return {};
    }

    asio::ip::tcp::resolver resolver{ioc};
    beast::error_code ec;
    auto const results = resolver.resolve(endpoint.host, endpoint.port, ec);
    if (ec) return {};

    beast::get_lowest_layer(stream).expires_after(std::chrono::milliseconds(timeoutMs));
    beast::get_lowest_layer(stream).connect(results, ec);
    if (ec) return {};

    stream.handshake(ssl::stream_base::client, ec);
    if (ec) return {};

    http::request<http::string_body> req{http::verb::get, endpoint.target, 11};
    req.set(http::field::host, endpoint.host);
    req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
    req.set(http::field::accept, "application/json");

    http::write(stream, req, ec);
    if (ec) return {};

    beast::flat_buffer buffer;
    http::response<http::string_body> res;
    http::response_parser<http::string_body> parser;
    parser.body_limit(8U * 1024U * 1024U);
    http::read(stream, buffer, parser, ec);
    if (ec && ec != http::error::end_of_stream) return {};
    res = parser.release();

    beast::get_lowest_layer(stream).expires_after(std::chrono::seconds(2));
    stream.shutdown(ec); // el IGP a veces cierra sin close_notify; se ignora ese error puntual

    if (res.result() != http::status::ok) {
      return {};
    }
    ok = true;
    return res.body();
  } catch (const std::exception &e) {
    std::cerr << "[IGP_SEISMIC] excepcion en httpsGet: " << e.what() << std::endl;
    return {};
  }
}

} // namespace

json::array fetchIgpYearEvents(int year) {
  HttpsEndpoint endpoint;
  const std::string url =
      gIgpApiBaseUrl + "/api/ultimo-sismo/ajaxb/" + std::to_string(year);
  if (!parseHttpsEndpoint(url, endpoint)) {
    return {};
  }
  bool ok = false;
  const std::string body = httpsGet(endpoint, gIgpTimeoutMs, ok);
  if (!ok || body.empty()) {
    return {};
  }
  try {
    auto parsed = json::parse(body);
    if (parsed.is_array()) {
      return parsed.as_array();
    }
    // Algunas respuestas envuelven el array en {data: [...]}.
    if (parsed.is_object() && parsed.as_object().if_contains("data") &&
        parsed.as_object().at("data").is_array()) {
      return parsed.as_object().at("data").as_array();
    }
  } catch (const std::exception &e) {
    std::cerr << "[IGP_SEISMIC] JSON invalido (year): " << e.what() << std::endl;
  }
  return {};
}

json::value fetchIgpLatestEvent() {
  HttpsEndpoint endpoint;
  const std::string url = gIgpApiBaseUrl + "/api/ultimo-sismo";
  if (!parseHttpsEndpoint(url, endpoint)) {
    return nullptr;
  }
  bool ok = false;
  const std::string body = httpsGet(endpoint, gIgpTimeoutMs, ok);
  if (!ok || body.empty()) {
    return nullptr;
  }
  try {
    return json::parse(body);
  } catch (const std::exception &e) {
    std::cerr << "[IGP_SEISMIC] JSON invalido (latest): " << e.what() << std::endl;
    return nullptr;
  }
}

} // namespace mining
