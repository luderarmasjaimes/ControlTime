#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <string>
#include <unordered_map>

namespace beast = boost::beast;
namespace http  = beast::http;
namespace json  = boost::json;

namespace mining {

/** @brief GET /api/mining/sensors — categorías, zonas, tipos, sensores y su historial de 7 días. Con `tenant_id` en query, cada consulta se filtra por tenant (requiere sesión autenticada); sin `tenant_id`, devuelve datos globales sin scope. Lectura vía réplica. */
http::response<http::string_body>
handleGetSensorData(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query);

} // namespace mining
