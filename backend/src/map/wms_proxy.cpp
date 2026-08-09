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

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace ssl = asio::ssl;

namespace map_mod {
namespace {
constexpr const char *kDefaultHosts =
    "geocatmin.ingemmet.gob.pe,geoportal.minem.gob.pe,www.idep.gob.pe,"
    "idesep.senamhi.gob.pe,basemap.nationalmap.gov";

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

        const auto timeoutMs = envSize("BEEMETRY_WMS_PROXY_TIMEOUT_MS", 12000, 1000, 30000);
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
