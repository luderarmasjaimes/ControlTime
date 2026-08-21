// --------------------------------------------------------------------------
// ai_engine_conn_pool.hpp — Pool in-process de conexiones TCP hacia ai_engine
// --------------------------------------------------------------------------
// Mismo problema que resolvía storage::PgPool (pg_pool.hpp) para Postgres,
// pero para el HTTP síncrono hacia ai_engine: antes, analyzeFrameWithAiEngine
// (el endpoint más caliente del pipeline biométrico -- un POST por cada
// verify-frame, cada VERIFY_SYNC_MS=175ms mientras dura una captura) abría
// una conexión TCP nueva (resolve + connect, handshake completo) y la cerraba
// con shutdown() en CADA llamada. disableNagleForLowLatency() ya evitaba el
// retraso de ~40ms de Nagle por paquete chico, pero el propio round-trip de
// TCP handshake (SYN/SYN-ACK/ACK) se seguía pagando en cada frame -- overhead
// puro sobre la red interna del bridge de Docker, sin ganar nada a cambio
// (mismo destino siempre: gAiEngineUrl).
//
// Diseño (deliberadamente simple, sin io_context compartido entre threads):
//   - Cada conexión pooled es dueña de SU PROPIO io_context + tcp_stream
//     (igual que el patrón previo de "un io_context por llamada", solo que
//     ahora el io_context sobrevive junto con el stream entre llamadas en
//     vez de crearse/destruirse en cada una).
//   - Pool por destino (host:port) con un límite de conexiones idle.
//   - reuse "optimista": si el servidor no ofrece keep-alive (HTTP/1.0, o
//     Connection: close en la respuesta), o si escribir/leer sobre una
//     conexión reusada falla (el peer la cerró entre medio -- keep-alive
//     idle timeout del lado servidor), el llamador simplemente descarta esa
//     conexión y reintenta una vez con una nueva -- nunca se cae por debajo
//     del comportamiento anterior (conexión nueva por request), solo mejora
//     cuando la reutilización funciona.
// --------------------------------------------------------------------------
#pragma once

#include <boost/asio.hpp>
#include <boost/beast.hpp>

#include <deque>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

namespace biometric {

namespace beast_ = boost::beast;
namespace asio_ = boost::asio;

struct PooledAiConn {
  std::shared_ptr<asio_::io_context> ioc;
  std::shared_ptr<beast_::tcp_stream> stream;

  bool valid() const noexcept {
    return stream && stream->socket().is_open();
  }
};

class AiEngineConnPool {
public:
  static AiEngineConnPool &instance() {
    static AiEngineConnPool inst;
    return inst;
  }

  /** @brief Conexión idle ya conectada a host:port, si hay alguna disponible (no bloquea; std::nullopt si no hay). */
  std::optional<PooledAiConn> tryAcquire(const std::string &host,
                                          const std::string &port) {
    std::lock_guard<std::mutex> lk(mtx_);
    auto it = pools_.find(host + ":" + port);
    if (it == pools_.end()) return std::nullopt;
    auto &dq = it->second;
    while (!dq.empty()) {
      PooledAiConn c = std::move(dq.front());
      dq.pop_front();
      if (c.valid()) return c;
      // Socket ya cerrado (peer lo tumbó mientras esperaba idle) -- descartar y seguir buscando.
    }
    return std::nullopt;
  }

  /** @brief Devuelve una conexión sana al pool para reutilizar en la próxima llamada al mismo destino. */
  void release(const std::string &host, const std::string &port,
               PooledAiConn conn) {
    if (!conn.valid()) return;
    std::lock_guard<std::mutex> lk(mtx_);
    auto &dq = pools_[host + ":" + port];
    if (dq.size() >= kMaxIdlePerTarget) {
      return;  // pool lleno -- conn se destruye (cierra el socket) al salir del scope.
    }
    dq.push_back(std::move(conn));
  }

private:
  static constexpr std::size_t kMaxIdlePerTarget = 16;

  AiEngineConnPool() = default;
  AiEngineConnPool(const AiEngineConnPool &) = delete;
  AiEngineConnPool &operator=(const AiEngineConnPool &) = delete;

  std::mutex mtx_;
  std::unordered_map<std::string, std::deque<PooledAiConn>> pools_;
};

}  // namespace biometric
