#include "http_client.hpp"

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/version.hpp>

#include <chrono>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
namespace ssl = boost::asio::ssl;

namespace http_client {

namespace {

struct ParsedUrl {
    bool tls{false};
    std::string host;
    std::string port;
    std::string target;  // path + query, "/" si vacío
};

bool parseUrl(const std::string &url, ParsedUrl &out) {
    std::string rest = url;
    if (rest.rfind("https://", 0) == 0) { out.tls = true; rest = rest.substr(8); }
    else if (rest.rfind("http://", 0) == 0) { out.tls = false; rest = rest.substr(7); }
    else return false;

    const auto slashPos = rest.find('/');
    std::string hostport = (slashPos == std::string::npos) ? rest : rest.substr(0, slashPos);
    out.target = (slashPos == std::string::npos) ? "/" : rest.substr(slashPos);
    if (out.target.empty()) out.target = "/";

    const auto colonPos = hostport.find(':');
    if (colonPos == std::string::npos) {
        out.host = hostport;
        out.port = out.tls ? "443" : "80";
    } else {
        out.host = hostport.substr(0, colonPos);
        out.port = hostport.substr(colonPos + 1);
    }
    return !out.host.empty();
}

template <typename Stream>
HttpResult doRequestOnStream(Stream &stream, const ParsedUrl &u,
                             http::verb method, const std::string &body,
                             const std::vector<std::pair<std::string, std::string>> &headers) {
    HttpResult out;
    beast::error_code ec;

    http::request<http::string_body> req{method, u.target, 11};
    req.set(http::field::host, u.host);
    req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
    for (const auto &h : headers) req.set(h.first, h.second);
    if (!body.empty()) {
        if (req.find(http::field::content_type) == req.end()) {
            req.set(http::field::content_type, "application/json");
        }
        req.body() = body;
        req.prepare_payload();
    }

    http::write(stream, req, ec);
    if (ec) { out.error = "write_failed: " + ec.message(); return out; }

    beast::flat_buffer buffer;
    http::response<http::string_body> res;
    http::read(stream, buffer, res, ec);
    if (ec && ec != http::error::end_of_stream && ec != asio::ssl::error::stream_truncated
           && ec != beast::errc::not_connected) {
        out.error = "read_failed: " + ec.message();
        return out;
    }

    out.status = static_cast<int>(res.result_int());
    out.body = std::move(res.body());
    out.ok = out.status >= 200 && out.status < 300;
    return out;
}

} // namespace

HttpResult request(const std::string &url, http::verb method, const std::string &body,
                   const std::vector<std::pair<std::string, std::string>> &headers,
                   int timeoutMs) {
    HttpResult out;
    ParsedUrl u;
    if (!parseUrl(url, u)) {
        out.error = "invalid_url";
        return out;
    }

    try {
        asio::io_context ioc;
        asio::ip::tcp::resolver resolver{ioc};
        beast::error_code ec;
        const auto results = resolver.resolve(u.host, u.port, ec);
        if (ec) { out.error = "resolve_failed: " + ec.message(); return out; }

        if (u.tls) {
            ssl::context ctx{ssl::context::tlsv12_client};
            ctx.set_default_verify_paths();
            ctx.set_verify_mode(ssl::verify_peer);

            beast::ssl_stream<beast::tcp_stream> stream{ioc, ctx};
            if (!SSL_set_tlsext_host_name(stream.native_handle(), u.host.c_str())) {
                out.error = "sni_set_failed";
                return out;
            }
            beast::get_lowest_layer(stream).expires_after(std::chrono::milliseconds(timeoutMs));
            beast::get_lowest_layer(stream).connect(results, ec);
            if (ec) { out.error = "connect_failed: " + ec.message(); return out; }

            stream.handshake(ssl::stream_base::client, ec);
            if (ec) { out.error = "tls_handshake_failed: " + ec.message(); return out; }

            out = doRequestOnStream(stream, u, method, body, headers);

            beast::get_lowest_layer(stream).expires_after(std::chrono::seconds(3));
            stream.shutdown(ec);  // muchos servidores cierran abrupto -- ignorar error de shutdown
        } else {
            beast::tcp_stream stream{ioc};
            stream.expires_after(std::chrono::milliseconds(timeoutMs));
            stream.connect(results, ec);
            if (ec) { out.error = "connect_failed: " + ec.message(); return out; }

            out = doRequestOnStream(stream, u, method, body, headers);

            stream.socket().shutdown(asio::ip::tcp::socket::shutdown_both, ec);
        }
    } catch (const std::exception &e) {
        out.ok = false;
        out.error = std::string("exception: ") + e.what();
    }
    return out;
}

} // namespace http_client
