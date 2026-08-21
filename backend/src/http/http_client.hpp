#pragma once

// --------------------------------------------------------------------------
// http_client.hpp — Cliente HTTP(S) síncrono compartido (ADR-103)
// --------------------------------------------------------------------------
// Antes de este archivo, tres módulos reimplementaban el mismo boilerplate
// de Boost.Beast (resolver/connect/handshake/write/read) por separado:
// biometric/ai_engine_client.cpp (plano, sin TLS), auth/tax_registry_client.cpp
// (TLS vía beast::ssl_stream) y mining/thingsboard_sync.cpp (plano, con un
// comentario explícito de que TLS "no está implementado"). Este último es
// justo el problema: TimeTelemetry (RP/Odoo) es https://, así que hacía
// falta TLS sí o sí — se extrae aquí en vez de duplicar un cuarto cliente,
// modelado en el patrón ya probado de tax_registry_client.cpp.
//
// No migra los tres clientes existentes (fuera de alcance de ADR-103) — solo
// lo usan los módulos nuevos de la integración RP/TimeTelemetry.
// --------------------------------------------------------------------------

#include <boost/beast/http.hpp>

#include <string>
#include <vector>
#include <utility>

namespace http_client {

struct HttpResult {
    bool ok{false};
    int status{0};
    std::string body;
    std::string error;  // motivo si !ok (resolve_failed, connect_failed, tls_handshake_failed, timeout, exception:...)
};

/**
 * @brief Request HTTP(S) síncrono, bloqueante. Resuelve TLS o texto plano
 * según el esquema de `url` ("https://" u "http://"). Nunca lanza excepción
 * hacia el llamador — cualquier fallo (resolución, conexión, TLS, timeout)
 * se traduce a `HttpResult::ok=false` con `error` descriptivo.
 * @param url URL completa (con esquema, host, puerto opcional y path).
 * @param method Verbo HTTP (`http::verb::get`, `::post`, ...).
 * @param body Cuerpo de la request (vacío si no aplica).
 * @param headers Pares (nombre, valor) adicionales — ya se setean Host,
 *        User-Agent y Content-Type si `body` no está vacío.
 * @param timeoutMs Timeout de conexión + operación.
 */
HttpResult request(const std::string &url, boost::beast::http::verb method,
                   const std::string &body,
                   const std::vector<std::pair<std::string, std::string>> &headers,
                   int timeoutMs);

} // namespace http_client
