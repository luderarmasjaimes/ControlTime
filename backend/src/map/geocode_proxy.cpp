#include "geocode_proxy.hpp"
#include "geocode_proxy_security.hpp"
#include "wms_proxy_security.hpp"
#include "../auth/auth_session.hpp"
#include "../auth/permissions.hpp"
#include "../http/http_utils.hpp"

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/beast/ssl.hpp>
#include <openssl/ssl.h>

#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <sstream>
#include <iomanip>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace ssl = asio::ssl;

namespace map_mod {
namespace {

// Nominatim (OSM) exige un User-Agent identificable con medio de contacto en
// su politica de uso -- un User-Agent generico/de navegador hace que el
// servicio bloquee la IP. Ver https://operations.osmfoundation.org/policies/nominatim/
constexpr const char *kDefaultHost = "nominatim.openstreetmap.org";
constexpr const char *kDefaultUserAgent = "Beemetry-Mapas/1.0 (+https://beemetry.com)";

std::string envString(const char *name, const char *fallback) {
    const char *value = std::getenv(name);
    return value && *value ? value : fallback;
}

std::string urlEncode(const std::string &value) {
    std::ostringstream out;
    out << std::uppercase << std::hex;
    for (unsigned char c : value) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out << c;
        else out << '%' << std::setw(2) << std::setfill('0') << static_cast<int>(c);
    }
    return out.str();
}

http::response<http::string_body> failure(http::status status, const char *code) {
    return http_utils::makeJsonResponse(status, json::object{{"error", code}});
}

// Política de uso de Nominatim: máximo 1 request/segundo. Como este proxy
// solo se usa de forma interactiva (buscador de dirección en el alta/edición
// de empresa), un 429 inmediato en vez de encolar/dormir el hilo es
// suficiente -- el usuario simplemente reintenta la búsqueda.
std::atomic<std::int64_t> gLastRequestMs{0};

bool throttled() {
    const auto nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    const auto lastMs = gLastRequestMs.load(std::memory_order_relaxed);
    if (nowMs - lastMs < 1100) return true;
    gLastRequestMs.store(nowMs, std::memory_order_relaxed);
    return false;
}

} // namespace

GeocodeProxyStats &geocodeProxyStats() {
    static GeocodeProxyStats stats;
    return stats;
}

http::response<http::string_body> handleGeocodeProxy(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
    auto &stats = geocodeProxyStats();
    stats.requests.fetch_add(1, std::memory_order_relaxed);

    // ADR-121: defensa en profundidad -- el buscador solo aparece en el
    // formulario de alta/edición de empresa (gateado en el frontend por
    // `empresas.manage`), pero el endpoint también lo exige del lado del
    // servidor, no solo confía en que el frontend oculte el botón.
    const auto session = auth::resolveAuthSession(req, query);
    if (!session) {
        stats.blocked.fetch_add(1, std::memory_order_relaxed);
        return failure(http::status::unauthorized, "unauthorized");
    }
    if (!auth::hasPermission(session->userId, session->tenantId, session->role, "empresas.manage")) {
        stats.blocked.fetch_add(1, std::memory_order_relaxed);
        return failure(http::status::forbidden, "forbidden");
    }

    const auto qIt = query.find("q");
    std::string sanitizedQuery, queryError;
    if (qIt == query.end() || !sanitizeGeocodeQuery(qIt->second, sanitizedQuery, queryError)) {
        stats.blocked.fetch_add(1, std::memory_order_relaxed);
        return failure(http::status::bad_request, "invalid_geocode_query");
    }
    const auto limitIt = query.find("limit");
    const int limit = clampGeocodeLimit(limitIt != query.end() ? limitIt->second : "");

    if (throttled()) {
        stats.rateLimited.fetch_add(1, std::memory_order_relaxed);
        return failure(http::status::too_many_requests, "rate_limited");
    }

    const std::string host = envString("BEEMETRY_GEOCODE_HOST", kDefaultHost);
    const std::string userAgent = envString("BEEMETRY_GEOCODE_USER_AGENT", kDefaultUserAgent);
    const std::string target = "/search?q=" + urlEncode(sanitizedQuery) +
                               "&format=jsonv2&limit=" + std::to_string(limit) +
                               "&addressdetails=0";

    try {
        asio::io_context ioc;
        ssl::context context{ssl::context::tls_client};
        context.set_default_verify_paths();
        context.set_verify_mode(ssl::verify_peer);
        beast::ssl_stream<beast::tcp_stream> stream{ioc, context};
        if (!SSL_set_tlsext_host_name(stream.native_handle(), host.c_str())) {
            throw std::runtime_error("sni_failed");
        }
        stream.set_verify_callback(ssl::host_name_verification(host));

        asio::ip::tcp::resolver resolver{ioc};
        beast::error_code ec;
        const auto results = resolver.resolve(host, "443", ec);
        if (ec || results.empty()) throw std::runtime_error("dns_failed");
        for (const auto &result : results) {
            if (isPrivateOrReserved(result.endpoint().address())) {
                stats.blocked.fetch_add(1, std::memory_order_relaxed);
                return failure(http::status::bad_request, "geocode_private_address_blocked");
            }
        }

        beast::get_lowest_layer(stream).expires_after(std::chrono::milliseconds(8000));
        beast::get_lowest_layer(stream).connect(results, ec);
        if (ec) throw std::runtime_error("connect_failed");
        stream.handshake(ssl::stream_base::client, ec);
        if (ec) throw std::runtime_error("tls_failed");

        http::request<http::empty_body> outbound{http::verb::get, target, 11};
        outbound.set(http::field::host, host);
        outbound.set(http::field::user_agent, userAgent);
        outbound.set(http::field::accept, "application/json");
        http::write(stream, outbound, ec);
        if (ec) throw std::runtime_error("write_failed");

        beast::flat_buffer buffer;
        http::response_parser<http::string_body> parser;
        parser.body_limit(256U * 1024U);
        http::read(stream, buffer, parser, ec);
        if (ec && ec != http::error::end_of_stream) throw std::runtime_error("read_failed");
        auto upstream = parser.release();
        if (upstream.result_int() < 200 || upstream.result_int() >= 300) {
            throw std::runtime_error("invalid_upstream_response");
        }

        http::response<http::string_body> response{http::status::ok, req.version()};
        response.set(http::field::content_type, "application/json");
        response.set(http::field::cache_control, "no-store");
        response.set("X-Content-Type-Options", "nosniff");
        response.body() = std::move(upstream.body());
        response.prepare_payload();
        stats.successes.fetch_add(1, std::memory_order_relaxed);
        return response;
    } catch (...) {
        stats.errors.fetch_add(1, std::memory_order_relaxed);
        return failure(http::status::bad_gateway, "geocode_upstream_unavailable");
    }
}

} // namespace map_mod
