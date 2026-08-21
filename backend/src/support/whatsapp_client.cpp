#include "whatsapp_client.hpp"
#include "../config/app_config.hpp"

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/json.hpp>

#include <iostream>
#include <memory>
#include <mutex>
#include <vector>

namespace beast = boost::beast;
namespace http = beast::http;
namespace asio = boost::asio;
namespace ssl = boost::asio::ssl;
namespace json = boost::json;

using config::AppConfig;

// gWhatsappApiBaseUrl/gWhatsappApiVersion/gWhatsappTimeoutMs son compartidos
// entre todas las lineas (una sola App de Meta, ver ADR-113); phone_number_id
// y access_token en cambio vienen de la `WhatsappLine` de cada llamada, no de
// un global -- por eso no tienen macro aqui.
#define gWhatsappApiBaseUrl        AppConfig::instance().gWhatsappApiBaseUrl
#define gWhatsappApiVersion        AppConfig::instance().gWhatsappApiVersion
#define gWhatsappTimeoutMs         AppConfig::instance().gWhatsappTimeoutMs

namespace support {

namespace {

// Mismo patron que igp_seismic_client.cpp -- unico cliente HTTPS de salida
// con headers custom (Authorization Bearer) del backend. Se duplica en vez
// de compartir con igp_seismic_client.cpp/text_spell_service.cpp porque cada
// archivo mantiene su propio helper minimo autocontenido (convencion ya
// existente en este codebase, ver comentario en igp_seismic_client.cpp).
struct HttpsPostResult {
  bool ok = false;
  int status = 0;
  std::string body;
  std::string error;
};

// ── Pool de conexiones TLS persistentes hacia la Graph API ─────────────────
// Antes, cada envío (plantilla/texto/interactivo) abría una conexión
// TCP+TLS nueva a graph.facebook.com y la cerraba al terminar -- el
// handshake completo (~100-300ms de red) se pagaba en CADA mensaje, incluso
// cuando un mismo turno del bot manda dos seguidos (confirmación al usuario
// + aviso al agente humano, ver finalizeCollectingFlow en
// whatsapp_bot_engine.cpp). El servidor atiende cada conexión HTTP entrante
// en su propio hilo desprendido (`std::thread(session, ...).detach()` en
// main.cpp) -- una caché thread_local no serviría porque ese hilo vive solo
// lo que dura ESA conexión entrante (normalmente 1-2 envíos salientes antes
// de morir). Este pool es a nivel de PROCESO (compartido entre hilos,
// protegido por mutex) para que la conexión que abrió un turno del bot la
// reutilice el siguiente turno, venga del hilo que venga.
struct PooledConnection {
  asio::io_context ioc;
  ssl::context ctx{ssl::context::tls_client};
  beast::ssl_stream<beast::tcp_stream> stream{ioc, ctx};
};

class WhatsappConnectionPool {
public:
  static WhatsappConnectionPool &instance() {
    static WhatsappConnectionPool inst;
    return inst;
  }

  std::unique_ptr<PooledConnection> acquire() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (idle_.empty()) return nullptr;
    auto conn = std::move(idle_.back());
    idle_.pop_back();
    return conn;
  }

  // Tope de conexiones ociosas guardadas -- evita crecer sin límite ante una
  // ráfaga de mensajes; una conexión de más simplemente se descarta (RAII
  // cierra el socket al destruir el unique_ptr).
  void release(std::unique_ptr<PooledConnection> conn) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (idle_.size() < kMaxIdle) idle_.push_back(std::move(conn));
  }

private:
  static constexpr std::size_t kMaxIdle = 4;
  std::mutex mutex_;
  std::vector<std::unique_ptr<PooledConnection>> idle_;
};

std::unique_ptr<PooledConnection> connectFresh(const std::string &host, int timeoutMs,
                                               std::string &error) {
  auto conn = std::make_unique<PooledConnection>();
  conn->ctx.set_default_verify_paths();
  conn->ctx.set_verify_mode(ssl::verify_peer);
  if (!SSL_set_tlsext_host_name(conn->stream.native_handle(), host.c_str())) {
    error = "sni_set_failed";
    return nullptr;
  }

  beast::error_code ec;
  asio::ip::tcp::resolver resolver{conn->ioc};
  auto const results = resolver.resolve(host, "443", ec);
  if (ec) { error = "resolve_failed"; return nullptr; }

  beast::get_lowest_layer(conn->stream).expires_after(std::chrono::milliseconds(timeoutMs));
  beast::get_lowest_layer(conn->stream).connect(results, ec);
  if (ec) { error = "connect_failed"; return nullptr; }

  conn->stream.handshake(ssl::stream_base::client, ec);
  if (ec) { error = "tls_handshake_failed: " + ec.message(); return nullptr; }
  return conn;
}

// Un solo intento de request/response sobre `conn` ya conectado. No hace
// shutdown -- decide el llamador si la conexión vuelve al pool (éxito +
// `keepAliveOk`) o se descarta (RAII cierra el socket abruptamente, sin
// close_notify -- aceptable para una conexión que de todos modos no se
// vuelve a usar, mismo criterio que el shutdown "best effort" que ya tenía
// este cliente).
bool sendOverConnection(PooledConnection &conn, const std::string &host, const std::string &target,
                        const std::string &bearerToken, const std::string &jsonBody, int timeoutMs,
                        HttpsPostResult &out, bool &keepAliveOk) {
  keepAliveOk = false;
  beast::error_code ec;
  beast::get_lowest_layer(conn.stream).expires_after(std::chrono::milliseconds(timeoutMs));

  http::request<http::string_body> req{http::verb::post, target, 11};
  req.set(http::field::host, host);
  req.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
  req.set(http::field::content_type, "application/json");
  req.set(http::field::authorization, "Bearer " + bearerToken);
  req.body() = jsonBody;
  req.prepare_payload();

  http::write(conn.stream, req, ec);
  if (ec) { out.error = "write_failed"; return false; }

  beast::flat_buffer buffer;
  http::response_parser<http::string_body> parser;
  parser.body_limit(2U * 1024U * 1024U);
  http::read(conn.stream, buffer, parser, ec);
  if (ec && ec != http::error::end_of_stream && ec != asio::ssl::error::stream_truncated) {
    out.error = "read_failed: " + ec.message();
    return false;
  }
  auto res = parser.release();
  out.status = static_cast<int>(res.result_int());
  out.body = res.body();
  out.ok = true;
  keepAliveOk = res.keep_alive();
  return true;
}

HttpsPostResult httpsPostJsonWithBearer(const std::string &host, const std::string &target,
                                         const std::string &bearerToken,
                                         const std::string &jsonBody, int timeoutMs) {
  HttpsPostResult out;
  auto &pool = WhatsappConnectionPool::instance();

  // Paso 1: si hay una conexión reusable en el pool, mandar por ahí primero
  // -- se ahorra el handshake TCP+TLS completo. Si Meta ya la cerró de su
  // lado (timeout de inactividad, muy común en conexiones ociosas), el
  // write/read falla -- se descarta esa conexión y se cae al camino normal
  // (conexión nueva) sin propagar el error al llamador, mismo criterio de
  // "nunca fallar por una optimización" que el resto de este cliente.
  if (auto conn = pool.acquire()) {
    bool keepAliveOk = false;
    HttpsPostResult reused;
    try {
      if (sendOverConnection(*conn, host, target, bearerToken, jsonBody, timeoutMs, reused,
                            keepAliveOk)) {
        if (keepAliveOk) pool.release(std::move(conn));
        return reused;
      }
    } catch (const std::exception &) {
      // La conexión pooled murió de forma inesperada -- se descarta (no se
      // vuelve a acquire) y se sigue al camino de conexión nueva abajo.
    }
  }

  // Paso 2: conexión nueva (primer uso del proceso, pool vacío, o la
  // conexión reusada del paso 1 falló).
  std::string connectError;
  auto conn = connectFresh(host, timeoutMs, connectError);
  if (!conn) {
    out.error = connectError;
    return out;
  }
  try {
    bool keepAliveOk = false;
    if (!sendOverConnection(*conn, host, target, bearerToken, jsonBody, timeoutMs, out,
                           keepAliveOk)) {
      return out;
    }
    if (keepAliveOk) pool.release(std::move(conn));
  } catch (const std::exception &ex) {
    out.error = std::string("exception: ") + ex.what();
  }
  return out;
}

// Común a las 4 funciones de envío: postea `body` a .../messages y traduce
// la respuesta cruda a WhatsappSendResult -- factorizado tras agregar texto
// libre/interactivos (antes solo existía la plantilla, sin nada que compartir).
WhatsappSendResult postWhatsappMessage(const config::WhatsappLine &line, const json::object &body) {
  WhatsappSendResult out;
  const std::string target =
      "/" + gWhatsappApiVersion + "/" + line.phoneNumberId + "/messages";
  const auto hr = httpsPostJsonWithBearer(gWhatsappApiBaseUrl, target, line.accessToken,
                                          json::serialize(json::value(body)), gWhatsappTimeoutMs);
  out.rawResponse = hr.body;
  out.httpStatus = hr.status;
  if (!hr.error.empty()) {
    out.error = hr.error;
    std::cerr << "[WHATSAPP] error de red: " << hr.error << std::endl;
    return out;
  }
  if (hr.status < 200 || hr.status >= 300) {
    out.error = "whatsapp_http_" + std::to_string(hr.status);
    std::cerr << "[WHATSAPP] HTTP status=" << hr.status << " body=" << hr.body << std::endl;
    return out;
  }
  out.ok = true;
  return out;
}

/** @brief Valida linea/destinatario antes de armar cualquier mensaje -- si
 * falla, devuelve el WhatsappSendResult de error ya listo (out param). */
bool preflightOk(const config::WhatsappLine &line, const std::string &toE164,
                 WhatsappSendResult &out) {
  if (line.accessToken.empty() || line.phoneNumberId.empty()) {
    out.error = "whatsapp_not_configured";
    return false;
  }
  if (toE164.empty()) {
    out.error = "missing_recipient";
    return false;
  }
  return true;
}

} // namespace

WhatsappSendResult sendWhatsappTemplateMessage(const config::WhatsappLine &line,
                                                const std::string &toE164,
                                                const std::string &templateName,
                                                const std::string &languageCode,
                                                const std::vector<std::string> &bodyParams) {
  WhatsappSendResult pre;
  if (!preflightOk(line, toE164, pre)) return pre;

  json::object tmpl;
  tmpl["name"] = templateName;
  tmpl["language"] = json::object{{"code", languageCode}};
  if (!bodyParams.empty()) {
    json::array params;
    for (const auto &p : bodyParams) {
      params.push_back(json::object{{"type", "text"}, {"text", p}});
    }
    tmpl["components"] = json::array{json::object{{"type", "body"}, {"parameters", params}}};
  }

  json::object body;
  body["messaging_product"] = "whatsapp";
  body["to"] = toE164;
  body["type"] = "template";
  body["template"] = tmpl;
  return postWhatsappMessage(line, body);
}

WhatsappSendResult sendWhatsappTextMessage(const config::WhatsappLine &line,
                                            const std::string &toE164,
                                            const std::string &bodyText) {
  WhatsappSendResult pre;
  if (!preflightOk(line, toE164, pre)) return pre;

  json::object body;
  body["messaging_product"] = "whatsapp";
  body["to"] = toE164;
  body["type"] = "text";
  body["text"] = json::object{{"body", bodyText}, {"preview_url", false}};
  return postWhatsappMessage(line, body);
}

WhatsappSendResult sendWhatsappInteractiveListMessage(
    const config::WhatsappLine &line,
    const std::string &toE164, const std::string &headerText,
    const std::string &bodyText, const std::string &footerText,
    const std::string &buttonLabel,
    const std::vector<WhatsappListSection> &sections) {
  WhatsappSendResult pre;
  if (!preflightOk(line, toE164, pre)) return pre;

  json::array sectionsJson;
  for (const auto &section : sections) {
    json::array rowsJson;
    for (const auto &row : section.rows) {
      json::object rowObj{{"id", row.id}, {"title", row.title}};
      if (!row.description.empty()) rowObj["description"] = row.description;
      rowsJson.push_back(rowObj);
    }
    sectionsJson.push_back(json::object{{"title", section.title}, {"rows", rowsJson}});
  }

  json::object interactive;
  interactive["type"] = "list";
  if (!headerText.empty()) {
    interactive["header"] = json::object{{"type", "text"}, {"text", headerText}};
  }
  interactive["body"] = json::object{{"text", bodyText}};
  if (!footerText.empty()) {
    interactive["footer"] = json::object{{"text", footerText}};
  }
  interactive["action"] = json::object{{"button", buttonLabel}, {"sections", sectionsJson}};

  json::object body;
  body["messaging_product"] = "whatsapp";
  body["to"] = toE164;
  body["type"] = "interactive";
  body["interactive"] = interactive;
  return postWhatsappMessage(line, body);
}

WhatsappSendResult
sendWhatsappInteractiveButtonsMessage(const config::WhatsappLine &line,
                                      const std::string &toE164,
                                      const std::string &bodyText,
                                      const std::vector<WhatsappButton> &buttons) {
  WhatsappSendResult pre;
  if (!preflightOk(line, toE164, pre)) return pre;

  json::array buttonsJson;
  std::size_t n = 0;
  for (const auto &btn : buttons) {
    if (n++ >= 3) break; // limite duro de Meta -- se trunca en vez de fallar
    buttonsJson.push_back(json::object{
        {"type", "reply"},
        {"reply", json::object{{"id", btn.id}, {"title", btn.title}}}});
  }

  json::object interactive;
  interactive["type"] = "button";
  interactive["body"] = json::object{{"text", bodyText}};
  interactive["action"] = json::object{{"buttons", buttonsJson}};

  json::object body;
  body["messaging_product"] = "whatsapp";
  body["to"] = toE164;
  body["type"] = "interactive";
  body["interactive"] = interactive;
  return postWhatsappMessage(line, body);
}

} // namespace support
