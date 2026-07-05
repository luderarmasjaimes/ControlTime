#include "mining_gateway.hpp"

#include <filesystem>
#include <iostream>

// Incondicional: el header se auto-protege con #if HAS_LIBPQ y, vía __has_include,
// DEFINE HAS_LIBPQ para esta TU (necesario para que el bloque de ingesta en
// read_line no se compile fuera).
#include "telemetry_ingest.hpp"

namespace fs = std::filesystem;

namespace mining {

// --- MiningSession ---

MiningSession::MiningSession(tcp::socket socket, ssl::context& ssl_ctx, int timeout_sec, std::size_t max_line_size, bool ingest_enabled)
    : stream_(std::move(socket), ssl_ctx),
      timer_(stream_.get_executor()),
      timeout_sec_(timeout_sec),
      max_line_size_(max_line_size),
      ingest_enabled_(ingest_enabled) {}

void MiningSession::start() {
    refresh_timeout();
    stream_.async_handshake(ssl::stream_base::server,
        [self = shared_from_this()](const boost::system::error_code& ec) {
            if (ec) return;
            self->read_line();
        });
}

void MiningSession::refresh_timeout() {
    timer_.expires_after(std::chrono::seconds(timeout_sec_));
    timer_.async_wait([self = shared_from_this()](const boost::system::error_code& ec) {
        if (ec == asio::error::operation_aborted) return;
        boost::system::error_code ignored;
        self->stream_.lowest_layer().shutdown(tcp::socket::shutdown_both, ignored);
        self->stream_.lowest_layer().close(ignored);
    });
}

void MiningSession::read_line() {
    refresh_timeout();
    asio::async_read_until(stream_, buffer_, '\n',
        [self = shared_from_this()](const boost::system::error_code& ec, std::size_t bytes) {
            if (ec) return;
            if (bytes > self->max_line_size_) {
                self->write_response("ERR payload too large\n", true);
                return;
            }
            std::istream stream(&self->buffer_);
            std::string line;
            std::getline(stream, line);
            // Quitar posible '\r' (clientes que envían CRLF)
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty()) {
#if HAS_LIBPQ
                if (self->ingest_enabled_) {
                    // Ingesta de alta tasa: parse + enqueue (no bloqueante,
                    // sin log por mensaje para no contender stdout a 10K/s).
                    bool ok = TelemetryIngestor::instance().ingestLine(line);
                    self->write_response(ok ? "OK\n" : "ERR\n", false);
                    return;
                }
#endif
                std::cout << "[MINING-GATEWAY] RECEIVED: " << line << "\n";
            }
            self->write_response("OK\n", false);
        });
}

void MiningSession::write_response(std::string response, bool close_after_write) {
    refresh_timeout();
    asio::async_write(stream_, asio::buffer(response),
        [self = shared_from_this(), close_after_write](const boost::system::error_code& ec, std::size_t) {
            if (ec) return;
            if (close_after_write) {
                boost::system::error_code ignored;
                self->stream_.lowest_layer().shutdown(tcp::socket::shutdown_both, ignored);
                self->stream_.lowest_layer().close(ignored);
                return;
            }
            self->read_line();
        });
}

// --- MiningServer ---

MiningServer::MiningServer(asio::io_context& io_context, const MiningConfig& config)
    : io_context_(io_context),
      ssl_context_(ssl::context::tls_server),
      acceptor_(io_context),
      config_(config) {
    ssl_context_.set_options(ssl::context::default_workarounds | ssl::context::no_sslv2 | ssl::context::no_sslv3 | ssl::context::single_dh_use);
    if (fs::exists(config_.cert_path) && fs::exists(config_.key_path)) {
        ssl_context_.use_certificate_chain_file(config_.cert_path);
        ssl_context_.use_private_key_file(config_.key_path, ssl::context::pem);
    }
    auto endpoint = tcp::endpoint(asio::ip::make_address(config_.bind_address), config_.port);
    acceptor_.open(endpoint.protocol());
    acceptor_.set_option(asio::socket_base::reuse_address(true));
    acceptor_.bind(endpoint);
    acceptor_.listen(asio::socket_base::max_listen_connections);
}

void MiningServer::run() { do_accept(); }

void MiningServer::do_accept() {
    acceptor_.async_accept([this](const boost::system::error_code& ec, tcp::socket socket) {
        if (!ec) {
            std::make_shared<MiningSession>(std::move(socket), ssl_context_, config_.idle_timeout_sec, config_.max_line_size, config_.ingest_enabled)->start();
        }
        do_accept();
    });
}

} // namespace mining
