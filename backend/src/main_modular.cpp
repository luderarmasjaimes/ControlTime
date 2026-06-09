#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio.hpp>
#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include <signal.h>

// Nuevos módulos
#include "security/api_auth.hpp"
#include "server/connection_pool.hpp"
#include "vision/opencv_raii.hpp"

// Módulos existentes
#include "map_geo_intersect.hpp"
#include "text_spell_service.hpp"

namespace beast = boost::beast;
namespace http = beast::http;
namespace websocket = beast::websocket;
namespace net = boost::asio;
using tcp = net::ip::tcp;

// Configuración global
static volatile bool shutdown_requested = false;

void signal_handler(int signal) {
    std::cout << "\n[MAIN] Shutdown signal received (" << signal << "). Graceful shutdown initiated..." << std::endl;
    shutdown_requested = true;
}

// Servidor HTTP básico con autenticación
class HttpServer {
private:
    tcp::acceptor acceptor_;
    
public:
    explicit HttpServer(net::io_context& ioc, tcp::endpoint endpoint) 
        : acceptor_(ioc) {
        beast::error_code ec;
        acceptor_.open(endpoint.protocol(), ec);
        if(ec) {
            std::cerr << "[HttpServer] Failed to open acceptor: " << ec.message() << std::endl;
            return;
        }
        
        acceptor_.set_option(tcp::acceptor::reuse_address(true), ec);
        if(ec) {
            std::cerr << "[HttpServer] Failed to set reuse_address: " << ec.message() << std::endl;
            return;
        }
        
        acceptor_.bind(endpoint, ec);
        if(ec) {
            std::cerr << "[HttpServer] Failed to bind to endpoint: " << ec.message() << std::endl;
            return;
        }
        
        acceptor_.listen(net::socket_base::max_listen_connections, ec);
        if(ec) {
            std::cerr << "[HttpServer] Failed to listen: " << ec.message() << std::endl;
            return;
        }
        
        std::cout << "[HttpServer] Listening on " << endpoint << std::endl;
    }
    
    void run() {
        do_accept();
    }
    
private:
    void do_accept() {
        acceptor_.async_accept(
            [this](beast::error_code ec, tcp::socket socket) {
                if (!ec) {
                    std::thread([this, sock = std::move(socket)]() mutable {
                        handle_request(std::move(sock));
                    }).detach();
                }
                
                if (!shutdown_requested) {
                    do_accept();
                }
            });
    }
    
    void handle_request(tcp::socket socket) {
        beast::flat_buffer buffer;
        http::request<http::string_body> req;
        
        beast::error_code ec;
        http::read(socket, buffer, req, ec);
        
        if (ec) {
            std::cerr << "[HttpServer] Failed to read request: " << ec.message() << std::endl;
            return;
        }
        
        http::response<http::string_body> res;
        
        // Autenticación API Key
        if (!security::authenticateRequest(req, res)) {
            // authenticateRequest ya configuró la respuesta de error
            http::write(socket, res, ec);
            return;
        }
        
        // Manejar endpoints
        std::string target = req.target();
        
        if (req.method() == http::verb::get && target == "/health") {
            res.result(http::status::ok);
            res.set(http::field::content_type, "application/json");
            res.body() = "{\"status\":\"healthy\",\"active_connections\":" + 
                        std::to_string(server::ConnectionManager::get_instance().active_connections()) + "}";
        }
        else if (req.method() == http::verb::get && target.rfind("/ws", 0) == 0) {
            // Upgrade a WebSocket
            if (!shutdown_requested) {
                auto& pool = server::ConnectionManager::get_instance();
                if (!pool.is_full()) {
                    pool.add_connection(std::move(socket));
                    return; // La conexión WebSocket manejará la comunicación
                } else {
                    res.result(http::status::service_unavailable);
                    res.body() = "{\"error\":\"Server at maximum capacity\"}";
                }
            } else {
                res.result(http::status::service_unavailable);
                res.body() = "{\"error\":\"Server shutting down\"}";
            }
        }
        else {
            res.result(http::status::not_found);
            res.body() = "{\"error\":\"Endpoint not found\"}";
        }
        
        res.set(http::field::content_type, "application/json");
        res.set(http::field::server, "MiningPlatform/1.0");
        res.prepare_payload();
        
        http::write(socket, res, ec);
    }
};

int main() {
    // Configuración inicial
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);
    
    // Inicializar gestión de recursos OpenCV
    vision::VisionResourceManager::set_max_resources(5000); // Límite seguro para 10K sensores
    vision::VisionResourceManager::log_resource_usage();
    
    // Inicializar pool de conexiones WebSocket
    server::ConnectionManager::initialize(15000, std::chrono::seconds(300)); // Soporta 15K conexiones
    
    // Configuración del servidor
    const char* port_env = std::getenv("MAPAS_PORT");
    unsigned short port = port_env ? std::atoi(port_env) : 8081;
    
    std::cout << "[MAIN] Starting Mining Platform Backend v2.0" << std::endl;
    std::cout << "[MAIN] API authentication: " 
              << (security::ApiKeyAuth().isEnabled() ? "ENABLED" : "DISABLED (development)") << std::endl;
    std::cout << "[MAIN] Max WebSocket connections: 15000" << std::endl;
    std::cout << "[MAIN] OpenCV resource limit: 5000" << std::endl;
    
    try {
        net::io_context ioc{1};
        
        HttpServer server(ioc, tcp::endpoint{tcp::v4(), port});
        server.run();
        
        std::cout << "[MAIN] Server started on port " << port << std::endl;
        
        // Hilo para limpieza periódica de conexiones inactivas
        std::thread cleanup_thread([&ioc]() {
            while (!shutdown_requested) {
                std::this_thread::sleep_for(std::chrono::seconds(30));
                if (!shutdown_requested) {
                    auto cleaned = server::ConnectionManager::get_instance().cleanup_inactive_connections();
                    vision::VisionResourceManager::cleanup_resources();
                }
            }
        });
        
        ioc.run();
        
        if (cleanup_thread.joinable()) {
            cleanup_thread.join();
        }
        
        std::cout << "[MAIN] Server shutdown complete" << std::endl;
        
    } catch (const std::exception& e) {
        std::cerr << "[MAIN] Exception: " << e.what() << std::endl;
        return EXIT_FAILURE;
    }
    
    // Limpieza final
    server::ConnectionManager::shutdown();
    vision::OpenCVResourceGuard::log_stats();
    
    return EXIT_SUCCESS;
}