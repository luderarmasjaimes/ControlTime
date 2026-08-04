#ifndef CONNECTION_POOL_HPP
#define CONNECTION_POOL_HPP

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio.hpp>
#include <memory>
#include <vector>
#include <deque>
#include <mutex>
#include <shared_mutex>
#include <atomic>
#include <chrono>
#include <functional>

namespace server {

using tcp = boost::asio::ip::tcp;
namespace beast = boost::beast;
namespace websocket = beast::websocket;

// Clase para manejar conexiones WebSocket individuales con gestión de recursos
class WebSocketConnection : public std::enable_shared_from_this<WebSocketConnection> {
private:
    websocket::stream<beast::tcp_stream> ws_;
    beast::flat_buffer buffer_;
    std::atomic<bool> is_closed_;
    std::chrono::steady_clock::time_point last_activity_;
    size_t connection_id_;
    
public:
    explicit WebSocketConnection(tcp::socket&& socket, size_t id);
    ~WebSocketConnection();
    
    void start();
    void send_message(const std::string& message);
    void close();
    
    bool is_closed() const { return is_closed_.load(); }
    std::chrono::steady_clock::time_point last_activity() const { return last_activity_; }
    size_t connection_id() const { return connection_id_; }
    
private:
    void on_accept(beast::error_code ec);
    void do_read();
    void on_read(beast::error_code ec, std::size_t bytes_transferred);
    void on_write(beast::error_code ec, std::size_t bytes_transferred);
    void do_close();
    void fail(beast::error_code ec, const char* what);
    
    // Handler para mensajes entrantes
    virtual void on_message(const std::string& message);
};

// Pool de conexiones optimizado para alta concurrencia
class ConnectionPool {
private:
    mutable std::shared_mutex connections_mutex_;
    std::vector<std::shared_ptr<WebSocketConnection>> connections_;
    std::atomic<size_t> next_connection_id_;
    std::atomic<size_t> active_connections_;
    
    // Configuración de pool
    const size_t max_connections_;
    const std::chrono::seconds idle_timeout_;
    
public:
    ConnectionPool(size_t max_connections = 15000, std::chrono::seconds idle_timeout = std::chrono::seconds(300));
    ~ConnectionPool();
    
    // Crear y añadir nueva conexión
    std::shared_ptr<WebSocketConnection> add_connection(tcp::socket&& socket);
    
    // Eliminar conexión por ID
    bool remove_connection(size_t connection_id);
    
    // Enviar mensaje a todas las conexiones activas
    void broadcast_message(const std::string& message);
    
    // Enviar mensaje a conexiones específicas (por tenant, sensor, etc.)
    void send_to_connections(const std::vector<size_t>& connection_ids, const std::string& message);
    
    // Limpiar conexiones inactivas
    size_t cleanup_inactive_connections();
    
    // Obtener estadísticas
    size_t active_connections() const { return active_connections_.load(); }
    size_t total_connections() const { return connections_.size(); }
    bool is_full() const { return active_connections() >= max_connections_; }
    
    // Callback para manejo de mensajes
    using MessageHandler = std::function<void(size_t connection_id, const std::string& message)>;
    void set_message_handler(MessageHandler handler);
    
private:
    MessageHandler message_handler_;
};

// Clase singleton para gestión global del pool
class ConnectionManager {
private:
    static std::unique_ptr<ConnectionPool> instance_;
    
public:
    static ConnectionPool& get_instance();
    static void initialize(size_t max_connections = 15000, std::chrono::seconds idle_timeout = std::chrono::seconds(300));
    static void shutdown();
};

} // namespace server

#endif