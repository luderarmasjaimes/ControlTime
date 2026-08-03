#ifndef WS_BROADCAST_HPP
#define WS_BROADCAST_HPP

// ws_broadcast.hpp — Registro de conexiones WebSocket activas, escalado por
// tenant, con push de mensajes no solicitados (broadcast/pub-sub).
//
// Por qué existe: `websocket_session.hpp` original era un echo server puro
// (acepta, lee, escribe lo mismo de vuelta, repite) -- no había forma de que
// el servidor empujara un mensaje a un cliente que no lo pidió. Para
// "push diferencial por capa" (mapa en vivo con hasta 10k sensores) hace
// falta un registro real de sesiones activas por tenant + un método para
// escribirles JSON de forma asíncrona sin bloquear el hilo que detecta el
// cambio (típicamente el hilo de MapAggregator, ver map_aggregator.hpp).
//
// Diseño deliberadamente simple: un mutex + un mapa tenant_id -> set de
// weak_ptr<WebSocketSession>. weak_ptr evita mantener con vida sesiones ya
// cerradas (el shared_ptr real vive en la cadena de callbacks asíncronos de
// Beast, ver WebSocketSession::run()); al hacer broadcast simplemente se
// descartan los weak_ptr que ya no resuelven (limpieza perezosa, no hace
// falta un hilo de garbage collection separado).

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/dispatch.hpp>
#include <boost/asio/strand.hpp>

#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace beast = boost::beast;
namespace websocket = beast::websocket;
using tcp = boost::asio::ip::tcp;

class WebSocketSession;

/** @brief Registro global de sesiones WS activas, escalado por tenant_id. Thread-safe. */
class WsRegistry {
public:
    static WsRegistry &instance();

    /** @brief Registra una sesión bajo un tenant (llamado al aceptar el handshake). */
    void add(const std::string &tenantId, std::shared_ptr<WebSocketSession> session);

    /** @brief Da de baja una sesión explícitamente (llamado en el destructor/close de la sesión). */
    void remove(const std::string &tenantId, WebSocketSession *rawPtr);

    /**
     * @brief Empuja `payload` (ya serializado a texto JSON) a todas las
     * sesiones vivas suscritas al tenant dado. Descarta perezosamente
     * weak_ptr ya expirados encontrados durante el recorrido.
     * @return Cantidad de sesiones a las que efectivamente se envió.
     */
    std::size_t broadcastToTenant(const std::string &tenantId, const std::string &payload);

    /** @brief Cantidad de sesiones activas registradas para un tenant (uso: no hacer trabajo de diff si nadie escucha). */
    std::size_t activeCount(const std::string &tenantId);

    /** @brief Todos los tenant_id con al menos una sesión activa (uso: el agregador solo calcula diffs para tenants con oyentes). */
    std::vector<std::string> tenantsWithListeners();

private:
    WsRegistry() = default;
    std::mutex mutex_;
    std::unordered_map<std::string, std::vector<std::weak_ptr<WebSocketSession>>> byTenant_;
};

#endif
