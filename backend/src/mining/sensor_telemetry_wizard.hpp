#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <string>
#include <unordered_map>

namespace beast = boost::beast;
namespace http  = beast::http;
namespace json  = boost::json;

namespace mining {

/** @brief GET /api/mining/telemetry/wizard/catalog?sensor_type=
 * Catálogo para el wizard de inserción de gráficos ECharts multi-sensor
 * (ReportStudioV2): tipos de sensor disponibles (paso 1), zonas geográficas
 * (db_scripts/54_sensor_zones_and_grouping.sql) y, si se pasa `sensor_type`,
 * los sensores de ese tipo agrupados por zona y por dispositivo físico
 * (`device_key = COALESCE(serial_number, external_id, sensor_code)` — un
 * dispositivo con más de una magnitud aparece como varias filas hermanas
 * con el mismo device_key, cada una con su propia unidad). Mismo guard
 * anti-IDOR que handleGetSensorData/handleGetTelemetrySummary. Lectura vía
 * réplica. */
http::response<http::string_body>
handleGetTelemetryWizardCatalog(const http::request<http::string_body>& req,
                                const std::unordered_map<std::string, std::string>& query);

/** @brief GET /api/mining/telemetry/wizard/query?sensor_ids=&from=&to=&agg=
 * Series históricas para el bloque `sensor_multi_chart` ya configurado:
 * `sensor_ids` es una lista separada por comas de UUIDs de `sensors`;
 * `from`/`to` son timestamps ISO 8601 (a diferencia de
 * handleGetTelemetrySummary, que solo acepta una ventana relativa en
 * horas). `agg` (`raw`|`hourly`|`daily`, default `hourly`) controla el
 * downsampling; si se pide `raw` sobre un rango de más de 7 días se
 * degrada a `hourly` automáticamente para no devolver un payload
 * desproporcionado. Rango máximo 90 días. El tenant efectivo de la sesión
 * acota tanto `sensors` como `telemetry_raw`, así que un `sensor_id` de
 * otro tenant simplemente no devuelve filas (no hace falta una
 * verificación de pertenencia aparte). Lectura vía réplica. */
http::response<http::string_body>
handleQueryTelemetrySeries(const http::request<http::string_body>& req,
                           const std::unordered_map<std::string, std::string>& query);

} // namespace mining
