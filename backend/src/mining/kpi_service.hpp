#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <string>
#include <unordered_map>

namespace beast = boost::beast;
namespace http  = beast::http;
namespace json  = boost::json;

namespace mining {

/** @brief GET /api/mining/kpis — lista KPIs runtime (con fallback a `dashboard_kpis` legacy si la tabla runtime no existe/está vacía), lectura vía réplica. Filtro opcional por `category`. */
http::response<http::string_body>
handleGetKpis(const http::request<http::string_body>& req,
              const std::unordered_map<std::string, std::string>& query);

/** @brief POST /api/mining/kpis/upsert — upsert masivo de KPIs runtime desde `items[]` del body; cada KPI también agrega un punto histórico en `mining_runtime_kpi_points`. Requiere sesión autenticada y Postgres. */
http::response<http::string_body>
handleUpsertKpis(const http::request<http::string_body>& req,
                 const std::unordered_map<std::string, std::string>& query);

/** @brief POST /api/mining/kpis/sync-from-dashboard — sincroniza `mining_runtime_kpis` desde la tabla legacy `dashboard_kpis`; si esta no existe o está vacía, solo "toca" (re-timestampa) los KPIs runtime existentes. */
http::response<http::string_body>
handleSyncFromDashboard(const http::request<http::string_body>& req,
                        const std::unordered_map<std::string, std::string>& query);

/** @brief POST /api/mining/kpis/sync-from-external — sincroniza KPIs runtime desde una base de datos externa (KPI_EXTERNAL_DATABASE_URL), fuera del pool de conexiones (una sola URL externa por despliegue). No-op silencioso si no está configurada o la conexión externa falla. */
http::response<http::string_body>
handleSyncFromExternal(const http::request<http::string_body>& req,
                       const std::unordered_map<std::string, std::string>& query);

/** @brief GET /api/mining/kpis/points — serie histórica de un KPI (`code`) en los últimos `days` (1-90, default 7), lectura vía réplica, máximo 240 puntos. */
http::response<http::string_body>
handleGetKpiPoints(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query);

} // namespace mining
