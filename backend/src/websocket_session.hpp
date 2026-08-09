#ifndef WEBSOCKET_SESSION_HPP
#define WEBSOCKET_SESSION_HPP

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/dispatch.hpp>
#include <boost/asio/strand.hpp>
#include <algorithm>
#include <cstdlib>
#include <deque>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "ws_broadcast.hpp"

namespace beast = boost::beast;         // from <boost/beast.hpp>
namespace http = beast::http;           // from <boost/beast/http.hpp>
namespace websocket = beast::websocket; // from <boost/beast/websocket.hpp>
namespace net = boost::asio;            // from <boost/asio.hpp>
using tcp = boost::asio::ip::tcp;       // from <boost/asio/ip/tcp.hpp>

// WebSocketSession: además de eco (comportamiento original, preservado para
// no romper clientes/tests que dependan de él), ahora soporta push del
// servidor hacia el cliente (broadcast diferencial por tenant, ver
// ws_broadcast.hpp / map_aggregator.hpp). Se registra en WsRegistry al
// aceptar el handshake (bajo el tenant_id resuelto de la sesión HTTP antes
// del upgrade, ver main.cpp) y se da de baja al cerrarse.
//
// async_write en un mismo websocket::stream NO se puede invocar
// concurrentemente (violación documentada de Beast: solo una escritura en
// vuelo por stream). Como sendAsync() puede ser llamado desde el hilo del
// agregador de mapa mientras potencialmente hay una escritura en curso, se
// usa una cola FIFO protegida por mutex + un flag "writing_" -- si ya hay
// una escritura en vuelo, el mensaje nuevo solo se encola y se despacha
// cuando termine la actual (patrón estándar de Beast para escritura
// serializada desde múltiples orígenes).
class WebSocketSession : public std::enable_shared_from_this<WebSocketSession> {
    websocket::stream<beast::tcp_stream> ws_;
    beast::flat_buffer buffer_;
    std::string tenantId_;
    bool registered_ = false;

    std::mutex writeMutex_;
    std::deque<std::string> writeQueue_;
    bool writing_ = false;

public:
    explicit WebSocketSession(tcp::socket&& socket, std::string tenantId = std::string())
        : ws_(std::move(socket)), tenantId_(std::move(tenantId)) {}

    ~WebSocketSession() {
        if (registered_) {
            WsRegistry::instance().remove(tenantId_, this);
        }
    }

    const std::string &tenantId() const { return tenantId_; }

    /**
     * @brief Arranca el handshake sin request previamente leído (uso: el
     * socket es virgen, nadie llamó a http::read todavía). No usado por el
     * flujo actual de main.cpp (que sí lee el upgrade primero para poder
     * resolver el tenant vía auth::resolveAuthSession antes de construir la
     * sesión), pero se conserva por compatibilidad con quien construya la
     * sesión directamente sobre un socket recién aceptado.
     */
    void run() {
        ws_.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));
        ws_.async_accept(
            beast::bind_front_handler(
                &WebSocketSession::on_accept,
                shared_from_this()));
    }

    /**
     * @brief Arranca el handshake reusando un `http::request` ya leído del
     * socket (caso real de main.cpp: `http::read()` se invoca una sola vez
     * para poder inspeccionar la request -- headers/query -- y resolver auth
     * ANTES de decidir si es un upgrade WS o una ruta HTTP normal). Si se
     * usa el `async_accept()` sin argumentos sobre un socket cuyo upgrade ya
     * fue consumido del buffer TCP, Beast intenta releer el handshake desde
     * el socket, no encuentra más bytes (el peer ya envió todo lo que iba a
     * enviar) y falla con "gracefully closed" -- confirmado en pruebas
     * reales contra el stack (curl con -N se colgaba y luego cerraba sin
     * handshake). Pasarle el `req` ya parseado evita esa re-lectura.
     */
    template <class Body, class Fields>
    void run(const http::request<Body, Fields> &req) {
        ws_.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));
        ws_.async_accept(
            req,
            beast::bind_front_handler(
                &WebSocketSession::on_accept,
                shared_from_this()));
    }

    void on_accept(beast::error_code ec) {
        if(ec) return fail(ec, "accept");
        if (!tenantId_.empty()) {
            WsRegistry::instance().add(tenantId_, shared_from_this());
            registered_ = true;
        }
        do_read();
    }

    void do_read() {
        ws_.async_read(
            buffer_,
            beast::bind_front_handler(
                &WebSocketSession::on_read,
                shared_from_this()));
    }

    void on_read(beast::error_code ec, std::size_t bytes_transferred) {
        boost::ignore_unused(bytes_transferred);
        if(ec == websocket::error::closed) return;
        if(ec) return fail(ec, "read");

        // Comportamiento original preservado: eco del mensaje recibido. Los
        // mensajes reales de "push" (diffs de mapa) salen por sendAsync(),
        // no por este camino -- el cliente puede seguir usando esta misma
        // conexión para enviar comandos simples (p.ej. ack/ping) sin que se
        // pierda esa capacidad.
        ws_.text(ws_.got_text());
        ws_.async_write(
            buffer_.data(),
            beast::bind_front_handler(
                &WebSocketSession::on_write,
                shared_from_this()));
    }

    void on_write(beast::error_code ec, std::size_t bytes_transferred) {
        boost::ignore_unused(bytes_transferred);
        if(ec) return fail(ec, "write");
        buffer_.consume(buffer_.size());
        do_read();
    }

    /**
     * @brief Encola `payload` para envío al cliente (mensaje no solicitado,
     * p.ej. un diff de marcadores de mapa). Seguro de llamar desde
     * cualquier hilo (p.ej. el hilo de MapAggregator). Si ya hay una
     * escritura de push en vuelo, el mensaje se encola y se despacha en
     * orden una vez libere.
     */
    void sendAsync(std::string payload) {
        auto self = shared_from_this();
        net::post(ws_.get_executor(), [self, payload = std::move(payload)]() mutable {
            bool shouldStart = false;
            {
                std::lock_guard<std::mutex> lock(self->writeMutex_);
                self->writeQueue_.push_back(std::move(payload));
                if (!self->writing_) {
                    self->writing_ = true;
                    shouldStart = true;
                }
            }
            if (shouldStart) self->doPushWrite();
        });
    }

private:
    // Invocado ya en el executor del stream (post()'eado por sendAsync, o
    // encadenado desde el completion handler de la escritura anterior), y
    // SIN el mutex tomado por el llamador -- toma su propio lock interno
    // para extraer el siguiente mensaje de la cola.
    void doPushWrite() {
        std::string next;
        {
            std::lock_guard<std::mutex> lock(writeMutex_);
            if (writeQueue_.empty()) {
                writing_ = false;
                return;
            }
            next = std::move(writeQueue_.front());
            writeQueue_.pop_front();
        }
        auto self = shared_from_this();
        auto bufPtr = std::make_shared<std::string>(std::move(next));
        ws_.text(true);
        ws_.async_write(
            net::buffer(*bufPtr),
            [self, bufPtr](beast::error_code ec, std::size_t) {
                if (ec) {
                    self->fail(ec, "push_write");
                    std::lock_guard<std::mutex> lock(self->writeMutex_);
                    self->writing_ = false;
                    return;
                }
                self->doPushWrite();
            });
    }

    void fail(beast::error_code ec, char const* what) {
        std::cerr << what << ": " << ec.message() << "\n";
    }
};

#endif
