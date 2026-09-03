#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <string>
#include <unordered_map>

namespace beast = boost::beast;
namespace http  = beast::http;
namespace json  = boost::json;

namespace mining {

/**
 * @brief GET /api/mining/simulation/live-status?tenant_id=<uuid> — ADR-136.
 *
 * Panel de monitoreo read-only sobre `telemetry_fact` (crudo, ADR-131) y la
 * nueva `telemetry_fact_calc` (métricas calculadas por lectura, poblada por
 * un script externo -- ver ADR-136, `db_scripts/87_telemetry_fact_calc.sql`).
 * No hace ningún cálculo: sólo agrega conteos y trae las últimas 20 filas de
 * cada hypertable.
 *
 * Mismo guard anti-IDOR que `handleGetSensorData`/`handleGetTelemetrySummary`
 * (`resolveAllowedSensorTenant`, `sensor_service.hpp`): el tenant efectivo
 * siempre se deriva de la sesión, sólo se acepta un `tenant_id` de query
 * distinto si `userBelongsToTenant` lo autoriza. Lectura vía réplica
 * (`storage::PgPool::replica()`, cae al primario si no hay réplica
 * configurada).
 */
http::response<http::string_body>
handleGetSimulationLiveStatus(const http::request<http::string_body>& req,
                              const std::unordered_map<std::string, std::string>& query);

} // namespace mining
