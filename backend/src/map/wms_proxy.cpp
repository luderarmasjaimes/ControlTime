#include "wms_proxy.hpp"
#include "wms_proxy_security.hpp"
#include "../auth/auth_session.hpp"
#include "../http/http_utils.hpp"

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/beast/ssl.hpp>
#include <openssl/ssl.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace ssl = asio::ssl;

namespace map_mod {
namespace {
constexpr const char *kDefaultHosts =
    "geocatmin.ingemmet.gob.pe,geoportal.minem.gob.pe,www.idep.gob.pe,"
    "idesep.senamhi.gob.pe,basemap.nationalmap.gov";

// geocatmin.ingemmet.gob.pe (verificado 2026-08-21) no envía su certificado
// intermedio durante el handshake TLS -- solo el hoja *.ingemmet.gob.pe,
// emitido por "Sectigo Public Server Authentication CA OV R36". Los otros
// hosts del allowlist usan la MISMA CA intermedia y sí la envían
// correctamente (confirmado con `openssl s_client -showcerts`), así que el
// problema es una omisión de configuración de ese servidor puntual, no de
// nuestro trust store. set_default_verify_paths() no hace AIA chasing
// (RFC 5280 §4.2.2.1 es opcional y OpenSSL no lo implementa por defecto),
// así que sin este certificado la verificación falla con "unable to get
// local issuer certificate" y la petición completa se cae con
// wms_upstream_unavailable/502, para ESTE host únicamente.
//
// Se añade explícitamente como CA de confianza (no se relaja
// verify_peer/verify_fail_if_no_peer_cert en ningún host) -- es el
// certificado intermedio público real de Sectigo, vigente hasta 2036,
// verificado contra <https://crt.sh/?d=4267304698> antes de incluirlo aquí.
constexpr const char *kIngemmetMissingIntermediatePem =
    "-----BEGIN CERTIFICATE-----\n"
    "MIIGTDCCBDSgAwIBAgIQLBo8dulD3d3/GRsxiQrtcTANBgkqhkiG9w0BAQwFADBf\n"
    "MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD\n"
    "Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw\n"
    "HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY\n"
    "MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp\n"
    "YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgT1YgUjM2MIIBojANBgkqhkiG9w0B\n"
    "AQEFAAOCAY8AMIIBigKCAYEApkMtJ3R06jo0fceI0M52B7K+TyMeGcv2BQ5AVc3j\n"
    "lYt76TvHIu/nNe22W/RJXX9rWUD/2GE6GF5x0V4bsY7K3IeJ8E7+KzG/TGboySfD\n"
    "u+F52jqQBbY62ofhYjMeiAbLI02+FqwHeM8uIrUtcX8b2RCxF358TB0NHVccAXZc\n"
    "FYgZndZCeXxjuca7pJJ20LLUnXtgXcjAE1vY4WvbReW0W6mkeZyNGdmpTcFs5Y+s\n"
    "yy6LtE5Zocji9J9NlNnReox2RWVyEXpA1ChZ4gqN+ZpVSIQ0HBorVFbBKyhdZyEX\n"
    "gZgNSNtBRwxqwIzJePJhYd4ZUhO1vk+/uP3nwDk0p95q/j7naXNCSvESnrHPypaB\n"
    "WRK066nKfPRPi9m9kIOhMdYfS8giFRTcdgL24Ycilj7ecAK9Trh0VbjwouJ4WH+x\n"
    "bt47u68ZFCD/ac55I0DNHkCpaPruj6e9Rmr7K46wZDAYXuEAqB7tGG/jd6JAA+H2\n"
    "O44CV98NRsU213f1kScIZntNAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk\n"
    "lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQU42Z0u3BojSxdTg6mSo+bNyKcgpIw\n"
    "DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI\n"
    "KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgIw\n"
    "VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv\n"
    "UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH\n"
    "AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp\n"
    "Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF\n"
    "BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA\n"
    "BZXWDHWC3cubb/e1I1kzi8lPFiK/ZUoH09ufmVOrc5ObYH/XKkWUexSPqRkwKFKr\n"
    "7r8OuG+p7VNB8rifX6uopqKAgsvZtZsq7iAFw04To6vNcxeBt1Eush3cQ4b8nbQR\n"
    "MQLChgEAqwhuXp9P48T4QEBSksYav7+aFjNySsLYlPzNqVM3RNwvBdvp6vgDtGwc\n"
    "xlKQZVuuNVIaoYyls8swhxDeSHKpRdxRauTLZ+pl+wGvy0pnrLEJGSz9mOEmfbod\n"
    "e/XopR2NGqaHJ6bIjyxPu6UtyQGI26En7UAEozACrHz06Nx2jTAY9E6NeB6XuobE\n"
    "wLK025ZRmvglcURG1BrV24tGHHTgxCe8M3oGlpUSMTKQ2dkgljZVYt+gKdFtWELZ\n"
    "MuRdi+X3XsrR8LFz+aLUiDRfQqhmw3RxjIyVKvvu9UPYY1nsvxYmFnUSeM+2q1z/\n"
    "iPUry+xDY9MC6+IhleKT094VKdFVp7LXH42+wvU+17lRolQ2mK2N/nBLVBwaIhib\n"
    "QXw4VYKwB86Bc6eS6iqsc94KEgD/U4VsjmgfhK+Xp4NM+VYzTTa3QeV3p8xOM0cw\n"
    "q1p8oZFA+OBcz3FYWpDIe5j0NWKlw9hXsTyPY/HeZUV59akskSOSRSmDfe8wJDPX\n"
    "58uB9/7lud0G3x0pxQAcffP0ayKavNwDTw4UfJ34cEw=\n"
    "-----END CERTIFICATE-----\n";

std::string envString(const char *name, const char *fallback) {
    const char *value = std::getenv(name);
    return value && *value ? value : fallback;
}

std::size_t envSize(const char *name, std::size_t fallback, std::size_t min, std::size_t max) {
    try {
        const auto value = static_cast<std::size_t>(std::stoull(envString(name, "")));
        return std::clamp(value, min, max);
    } catch (...) { return fallback; }
}

http::response<http::string_body> failure(http::status status, const char *code) {
    return http_utils::makeJsonResponse(status, json::object{{"error", code}});
}
} // namespace

WmsProxyStats &wmsProxyStats() {
    static WmsProxyStats stats;
    return stats;
}

http::response<http::string_body> handleWmsProxy(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
    auto &stats = wmsProxyStats();
    stats.requests.fetch_add(1, std::memory_order_relaxed);
    const auto started = std::chrono::steady_clock::now();
    const auto finish = [&stats, started]() {
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count();
        stats.durationMs.fetch_add(static_cast<std::uint64_t>(elapsed), std::memory_order_relaxed);
    };

    if (!auth::resolveAuthSession(req, query)) {
        stats.blocked.fetch_add(1, std::memory_order_relaxed); finish();
        return failure(http::status::unauthorized, "unauthorized");
    }
    const auto sourceIt = query.find("source");
    WmsEndpoint endpoint;
    if (sourceIt == query.end() || !parseHttpsWmsEndpoint(sourceIt->second, endpoint)
        || endpoint.port != "443"
        || !isAllowedWmsHost(endpoint.host, envString("BEEMETRY_WMS_ALLOWED_HOSTS", kDefaultHosts))) {
        stats.blocked.fetch_add(1, std::memory_order_relaxed); finish();
        return failure(http::status::bad_request, "wms_source_not_allowed");
    }

    std::string target, validationError;
    if (!buildWmsTarget(endpoint, query, target, validationError)) {
        stats.blocked.fetch_add(1, std::memory_order_relaxed); finish();
        return failure(http::status::bad_request, validationError.c_str());
    }

    try {
        asio::io_context ioc;
        ssl::context context{ssl::context::tls_client};
        context.set_default_verify_paths();
        // Ver comentario junto a kIngemmetMissingIntermediatePem: completa la
        // cadena para geocatmin.ingemmet.gob.pe, que no manda su intermedio.
        // No afecta la verificación de los demás hosts del allowlist -- solo
        // agrega una CA de confianza más, verify_peer sigue exigido igual.
        {
            beast::error_code caEc;
            context.add_certificate_authority(
                asio::buffer(kIngemmetMissingIntermediatePem, std::strlen(kIngemmetMissingIntermediatePem)),
                caEc);
        }
        context.set_verify_mode(ssl::verify_peer);
        beast::ssl_stream<beast::tcp_stream> stream{ioc, context};
        if (!SSL_set_tlsext_host_name(stream.native_handle(), endpoint.host.c_str())) {
            throw std::runtime_error("sni_failed");
        }
        stream.set_verify_callback(ssl::host_name_verification(endpoint.host));

        asio::ip::tcp::resolver resolver{ioc};
        beast::error_code ec;
        const auto results = resolver.resolve(endpoint.host, endpoint.port, ec);
        if (ec || results.empty()) throw std::runtime_error("dns_failed");
        for (const auto &result : results) {
            if (isPrivateOrReserved(result.endpoint().address())) {
                stats.blocked.fetch_add(1, std::memory_order_relaxed); finish();
                return failure(http::status::bad_request, "wms_private_address_blocked");
            }
        }

        // 8s (antes 12s): medido en vivo contra los hosts del allowlist
        // (2026-08-21) -- fuentes sanas responden en 200ms-2s (USGS ~0.2s,
        // INGEMMET ~1.4s vía curl directo); 8s deja margen amplio sin hacer
        // esperar al usuario más de lo necesario cuando una fuente externa
        // está caída/lenta (el proxy corta y el frontend muestra el error de
        // tesela casi 4s antes que con el timeout viejo). Sigue configurable
        // por variable de entorno para geoservidores puntuales más lentos.
        const auto timeoutMs = envSize("BEEMETRY_WMS_PROXY_TIMEOUT_MS", 8000, 1000, 30000);
        beast::get_lowest_layer(stream).expires_after(std::chrono::milliseconds(timeoutMs));
        beast::get_lowest_layer(stream).connect(results, ec);
        if (ec) throw std::runtime_error("connect_failed");
        stream.handshake(ssl::stream_base::client, ec);
        if (ec) throw std::runtime_error("tls_failed");

        http::request<http::empty_body> outbound{http::verb::get, target, 11};
        outbound.set(http::field::host, endpoint.host);
        outbound.set(http::field::user_agent, "Beemetry-WMS-Proxy/1.0");
        outbound.set(http::field::accept, "image/png,image/jpeg,image/webp");
        http::write(stream, outbound, ec);
        if (ec) throw std::runtime_error("write_failed");

        beast::flat_buffer buffer;
        http::response_parser<http::string_body> parser;
        parser.body_limit(envSize("BEEMETRY_WMS_PROXY_MAX_BYTES", 8U * 1024U * 1024U,
                                  256U * 1024U, 16U * 1024U * 1024U));
        http::read(stream, buffer, parser, ec);
        if (ec && ec != http::error::end_of_stream) throw std::runtime_error("read_failed");
        auto upstream = parser.release();
        // Boost.Beast recientes (Ubuntu 24.04 trae 1.83+) quitaron
        // string_view::to_string() -- construcción explícita en su lugar,
        // sin cambiar de comportamiento.
        const std::string contentType = std::string(upstream[http::field::content_type]);
        if (upstream.result_int() < 200 || upstream.result_int() >= 300
            || contentType.rfind("image/", 0) != 0) {
            throw std::runtime_error("invalid_upstream_response");
        }

        http::response<http::string_body> response{http::status::ok, req.version()};
        response.set(http::field::content_type, contentType);
        response.set(http::field::cache_control, "private, max-age=300, stale-while-revalidate=600");
        response.set("X-Content-Type-Options", "nosniff");
        response.set("X-Beemetry-WMS-Proxy", "1");
        response.body() = std::move(upstream.body());
        response.prepare_payload();
        stats.successes.fetch_add(1, std::memory_order_relaxed);
        stats.bytes.fetch_add(response.body().size(), std::memory_order_relaxed);
        finish();
        return response;
    } catch (...) {
        stats.errors.fetch_add(1, std::memory_order_relaxed); finish();
        return failure(http::status::bad_gateway, "wms_upstream_unavailable");
    }
}
} // namespace map_mod
