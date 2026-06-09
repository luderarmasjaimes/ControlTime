#pragma once

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <cstddef>
#include <string>
#include <memory>

namespace mining {

namespace asio = boost::asio;
namespace ssl  = asio::ssl;

struct MiningConfig {
    std::string bind_address = "0.0.0.0";
    unsigned short port = 8443;
    int idle_timeout_sec = 30;
    std::size_t max_line_size = 1024;
    std::string cert_path = "/etc/mining-gateway/certs/server.crt";
    std::string key_path = "/etc/mining-gateway/certs/server.key";
};

class MiningSession : public std::enable_shared_from_this<MiningSession> {
public:
    using tcp = asio::ip::tcp;
    MiningSession(tcp::socket socket, ssl::context& ssl_ctx, int timeout_sec, std::size_t max_line_size);
    void start();

private:
    void refresh_timeout();
    void read_line();
    void write_response(std::string response, bool close_after_write);

    ssl::stream<tcp::socket> stream_;
    asio::steady_timer timer_;
    asio::streambuf buffer_;
    int timeout_sec_;
    std::size_t max_line_size_;
};

class MiningServer {
public:
    using tcp = asio::ip::tcp;
    MiningServer(asio::io_context& io_context, const MiningConfig& config);
    void run();

private:
    void do_accept();

    asio::io_context& io_context_;
    ssl::context ssl_context_;
    tcp::acceptor acceptor_;
    MiningConfig config_;
};

} // namespace mining
