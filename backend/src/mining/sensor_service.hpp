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

/** @brief GET /api/mining/telemetry/summary — resumen de lectura de los
 * dispositivos IoT/ThingsBoard de la tabla `sensors` + `telemetry_raw`
 * (ADR-034/ADR-054): por sensor, último valor y su timestamp, muestras en
 * la ventana, y serie horaria promedio. `hours` acota la ventana (1-720,
 * default 168). Con `tenant_id` requiere sesión (mismo guard IDOR que
 * handleGetSensorData). Lectura vía réplica. Complementa el POST de
 * ingesta /api/mining/telemetry — hasta ahora telemetry_raw no tenía
 * NINGÚN endpoint de lectura y los sensores sincronizados eran invisibles
 * para el frontend. */
http::response<http::string_body>
handleGetTelemetrySummary(const http::request<http::string_body>& req,
                          const std::unordered_map<std::string, std::string>& query);

} // namespace mining
