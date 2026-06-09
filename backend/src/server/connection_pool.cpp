#include "connection_pool.hpp"
#include <iostream>
#include <algorithm>
#include <chrono>

namespace server {

// Implementación de WebSocketConnection
WebSocketConnection::WebSocketConnection(tcp::socket&& socket, size_t id) 
    : ws_(std::move(socket)), is_closed_(false), connection_id_(id) {
    last_activity_ = std::chrono::steady_clock::now();
}

WebSocketConnection::~WebSocketConnection() {
    if (!is_closed()) {
        close();
    }
}

void WebSocketConnection::start() {
    // Configurar timeouts para conexiones concurrentes
    ws_.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));
    ws_.set_option(websocket::stream_base::decorator(
        [](websocket::response_type& res) {
            res.set(beast::http::field::server, "MiningPlatform/1.0");
        }));
    
    ws_.async_accept(
        beast::bind_front_handler(
            &WebSocketConnection::on_accept,
            shared_from_this()));
}

void WebSocketConnection::on_accept(beast::error_code ec) {
    if(ec) {
        fail(ec, "accept");
        return;
    }
    
    last_activity_ = std::chrono::steady_clock::now();
    do_read();
}

void WebSocketConnection::do_read() {
    ws_.async_read(
        buffer_,
        beast::bind_front_handler(
            &WebSocketConnection::on_read,
            shared_from_this()));
}

void WebSocketConnection::on_read(beast::error_code ec, std::size_t bytes_transferred) {
    boost::ignore_unused(bytes_transferred);
    
    if(ec == websocket::error::closed) {
        close();
        return;
    }
    
    if(ec) {
        fail(ec, "read");
        return;
    }
    
    last_activity_ = std::chrono::steady_clock::now();
    
    // Procesar mensaje
    std::string message = beast::buffers_to_string(buffer_.data());
    buffer_.consume(buffer_.size());
    
    on_message(message);
    
    do_read();
}

void WebSocketConnection::send_message(const std::string& message) {
    if (is_closed()) return;
    
    last_activity_ = std::chrono::steady_clock::now();
    
    ws_.text(true);
    ws_.async_write(
        boost::asio::buffer(message),
        beast::bind_front_handler(
            &WebSocketConnection::on_write,
            shared_from_this()));
}

void WebSocketConnection::on_write(beast::error_code ec, std::size_t bytes_transferred) {
    boost::ignore_unused(bytes_transferred);
    
    if(ec) {
        fail(ec, "write");
        return;
    }
}

void WebSocketConnection::close() {
    if (is_closed_.exchange(true)) return;
    
    do_close();
}

void WebSocketConnection::do_close() {
    // Enviar frame de cierre
    ws_.async_close(websocket::close_code::normal,
        beast::bind_front_handler(
            [](beast::error_code ec) {
                if(ec) {
                    // Silenciar errores en cierre
                }
            }));
}

void WebSocketConnection::fail(beast::error_code ec, const char* what) {
    std::cerr << "[WebSocketConnection] " << what << ": " << ec.message() << std::endl;
    close();
}

// Implementación abstracta - debe ser implementada por clases derivadas
void WebSocketConnection::on_message(const std::string& message) {
    // Esta función debe ser implementada por clases derivadas
    // Para el propósito del pool, podemos reenviar al ConnectionPool
}

// Implementación de ConnectionPool
ConnectionPool::ConnectionPool(size_t max_connections, std::chrono::seconds idle_timeout)
    : next_connection_id_(1), active_connections_(0), max_connections_(max_connections), idle_timeout_(idle_timeout) {
    std::cout << "[ConnectionPool] Initialized with max " << max_connections_ << " connections, " 
              << idle_timeout_.count() << "s idle timeout" << std::endl;
}

ConnectionPool::~ConnectionPool() {
    // Limpiar todas las conexiones
    {
        std::unique_lock<std::shared_mutex> lock(connections_mutex_);
        for (auto& conn : connections_) {
            if (conn && !conn->is_closed()) {
                conn->close();
            }
        }
        connections_.clear();
    }
    active_connections_.store(0);
}

std::shared_ptr<WebSocketConnection> ConnectionPool::add_connection(tcp::socket&& socket) {
    if (is_full()) {
        std::cerr << "[ConnectionPool] Rejecting connection - pool is full" << std::endl;
        return nullptr;
    }
    
    size_t id = next_connection_id_++;
    auto connection = std::make_shared<WebSocketConnection>(std::move(socket), id);
    
    {
        std::unique_lock<std::shared_mutex> lock(connections_mutex_);
        connections_.push_back(connection);
    }
    
    active_connections_.fetch_add(1);
    
    std::cout << "[ConnectionPool] Connection " << id << " added. Active: " 
              << active_connections() << "/" << max_connections_ << std::endl;
    
    connection->start();
    return connection;
}

bool ConnectionPool::remove_connection(size_t connection_id) {
    std::unique_lock<std::shared_mutex> lock(connections_mutex_);
    
    auto it = std::find_if(connections_.begin(), connections_.end(),
        [connection_id](const std::shared_ptr<WebSocketConnection>& conn) {
            return conn && conn->connection_id() == connection_id;
        });
    
    if (it != connections_.end()) {
        if ((*it) && !(*it)->is_closed()) {
            (*it)->close();
        }
        connections_.erase(it);
        active_connections_.fetch_sub(1);
        return true;
    }
    
    return false;
}

void ConnectionPool::broadcast_message(const std::string& message) {
    std::shared_lock<std::shared_mutex> lock(connections_mutex_);
    
    for (auto& conn : connections_) {
        if (conn && !conn->is_closed()) {
            conn->send_message(message);
        }
    }
}

void ConnectionPool::send_to_connections(const std::vector<size_t>& connection_ids, const std::string& message) {
    if (connection_ids.empty()) return;
    
    std::shared_lock<std::shared_mutex> lock(connections_mutex_);
    
    for (size_t id : connection_ids) {
        auto it = std::find_if(connections_.begin(), connections_.end(),
            [id](const std::shared_ptr<WebSocketConnection>& conn) {
                return conn && conn->connection_id() == id;
            });
        
        if (it != connections_.end() && (*it) && !(*it)->is_closed()) {
            (*it)->send_message(message);
        }
    }
}

size_t ConnectionPool::cleanup_inactive_connections() {
    auto now = std::chrono::steady_clock::now();
    size_t cleaned = 0;
    
    std::unique_lock<std::shared_mutex> lock(connections_mutex_);
    
    connections_.erase(
        std::remove_if(connections_.begin(), connections_.end(),
            [this, &now, &cleaned](const std::shared_ptr<WebSocketConnection>& conn) {
                if (!conn || conn->is_closed()) {
                    cleaned++;
                    active_connections_.fetch_sub(1);
                    return true;
                }
                
                if (now - conn->last_activity() > idle_timeout_) {
                    conn->close();
                    cleaned++;
                    active_connections_.fetch_sub(1);
                    return true;
                }
                
                return false;
            }),
        connections_.end());
    
    if (cleaned > 0) {
        std::cout << "[ConnectionPool] Cleaned " << cleaned << " inactive connections. Active: " 
                  << active_connections() << std::endl;
    }
    
    return cleaned;
}

void ConnectionPool::set_message_handler(MessageHandler handler) {
    message_handler_ = handler;
}

// Implementación de ConnectionManager
std::unique_ptr<ConnectionPool> ConnectionManager::instance_ = nullptr;

ConnectionPool& ConnectionManager::get_instance() {
    if (!instance_) {
        throw std::runtime_error("ConnectionManager not initialized");
    }
    return *instance_;
}

void ConnectionManager::initialize(size_t max_connections, std::chrono::seconds idle_timeout) {
    if (!instance_) {
        instance_ = std::make_unique<ConnectionPool>(max_connections, idle_timeout);
    }
}

void ConnectionManager::shutdown() {
    instance_.reset();
}

} // namespace server