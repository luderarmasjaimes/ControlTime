#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <string>
#include <unordered_map>

#include "../auth/auth_types.hpp"

namespace beast = boost::beast;
namespace http  = beast::http;
namespace json  = boost::json;

namespace mining {

/** @brief Resuelve el tenant efectivo de una lectura de sensores/telemetría a
 * prueba de IDOR (auditoría 2026-07-19, ver definición en sensor_service.cpp):
 * el tenant SIEMPRE se deriva de la sesión; solo se acepta un `tenant_id` de
 * query distinto si `userBelongsToTenant` lo autoriza. `ok=false` → 403.
 * Compartida por todos los handlers de sensores/telemetría (incluye
 * sensor_telemetry_wizard.cpp) para no duplicar el guard de seguridad. */
std::string resolveAllowedSensorTenant(
    const auth::AuthSession &session,
    const std::unordered_map<std::string, std::string> &query, bool &ok);

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
