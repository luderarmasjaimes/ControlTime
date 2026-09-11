#include "tax_registry_client.hpp"
#include "../config/app_config.hpp"
#include "tax_id.hpp"

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/version.hpp>
#include <boost/json.hpp>

#include <chrono>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
namespace ssl = boost::asio::ssl;
namespace json = boost::json;

namespace auth {

namespace {

std::string replaceAll(std::string s, const std::string &from,
                       const std::string &to) {
  if (from.empty()) return s;
  std::size_t pos = 0;
  while ((pos = s.find(from, pos)) != std::string::npos) {
    s.replace(pos, from.size(), to);
    pos += to.size();
  }
  return s;
}

/** Toma el primer campo presente entre varios nombres alternativos (los
 * proveedores de consulta RUC no comparten esquema de respuesta). */
std::string firstStringField(const json::object &obj,
                             std::initializer_list<const char *> keys) {
  for (const char *k : keys) {
    if (const auto *v = obj.if_contains(k); v && v->is_string()) {
      return json::value_to<std::string>(*v);
    }
  }
  return "";
}

} // namespace

TaxRegistryLookup lookupPeruRuc(const std::string &ruc) {
  TaxRegistryLookup out;
  auto &cfg = config::AppConfig::instance();
  if (!cfg.gTaxRegistryEnabled || cfg.gTaxRegistryHost.empty() ||
      cfg.gTaxRegistryPathTemplate.empty()) {
    // Deshabilitado o mal configurado: "sin dato", no un error -- el
    // llamador cae al checksum local sin que esto bloquee nada.
    return out;
  }
  const std::string rucDigits = normalizeTaxId(ruc);
  if (rucDigits.length() != 11) {
    out.error = "ruc_shape_invalid";
    return out;
  }

  std::string target = replaceAll(cfg.gTaxRegistryPathTemplate, "{ruc}", rucDigits);
  target = replaceAll(target, "{token}", cfg.gTaxRegistryToken);
  const std::string &host = cfg.gTaxRegistryHost;
  const int timeoutMs = cfg.gTaxRegistryTimeoutMs;

  try {
    asio::io_context ioc;
    // tls_client (no tlsv12_client, que fija el handshake EXCLUSIVAMENTE a
    // TLS 1.2): Chequea (Cloudflare) rechaza TLS 1.2 con un alert fatal
    // "protocol_version" y solo acepta TLS 1.3 -- verificado en vivo con
    // openssl s_client -tls1_2 contra api.chequea.pe (2026-09-11, ADR-087).
    // Mismo patrón ya usado por los demás clientes HTTPS de este backend
    // (geocode_proxy.cpp, wms_proxy.cpp, whatsapp_client.cpp).
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
      out.error = "tls_handshake_failed";
      return out;
    }

    http::request<http::string_body> req{http::verb::get, target, 11};
    req.set(http::field::host, host);
    req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
    req.set(http::field::accept, "application/json");
    if (!cfg.gTaxRegistryToken.empty()) {
      req.set(http::field::authorization, "Bearer " + cfg.gTaxRegistryToken);
    }
    req.prepare_payload();

    http::write(stream, req, ec);
    if (ec) {
      out.error = "write_failed";
      return out;
    }

    beast::flat_buffer buffer;
    http::response<http::string_body> res;
    http::read(stream, buffer, res, ec);
    if (ec && ec != http::error::end_of_stream && ec != asio::ssl::error::stream_truncated) {
      out.error = "read_failed";
      return out;
    }

    beast::get_lowest_layer(stream).expires_after(std::chrono::seconds(3));
    stream.shutdown(ec); // muchos servidores cierran abrupto -- ignorar el error de shutdown

    if (res.result_int() != 200) {
      // available=true: el proveedor SÍ respondió -- un 404/expired token no
      // es "servicio caído", es "sin dato" para este RUC/config.
      out.available = true;
      out.error = "http_" + std::to_string(res.result_int());
      return out;
    }

    const auto parsed = json::parse(res.body());
    if (!parsed.is_object()) {
      out.available = true;
      out.error = "unexpected_response_shape";
      return out;
    }
    const auto &obj = parsed.as_object();
    out.available = true;
    out.razonSocial = firstStringField(
        obj, {"razonSocial", "razon_social", "nombre_o_razon_social", "nombre"});
    out.estado = firstStringField(obj, {"estado"});
    out.condicion = firstStringField(obj, {"condicion"});
    out.domicilioFiscal = firstStringField(
        obj, {"domicilioFiscal", "direccion", "domicilio_fiscal"});
    out.found = !out.razonSocial.empty();
  } catch (const std::exception &ex) {
    // Cualquier excepción (parse, red, TLS) se traduce a "no disponible" --
    // este cliente nunca debe propagar una excepción hacia el handler HTTP.
    out.available = false;
    out.error = std::string("exception: ") + ex.what();
  }
  return out;
}

} // namespace auth
