// --------------------------------------------------------------------------
// sensor_formula_routes.hpp — ADR-187 Entregable B: CRUD de parámetros de
// entrada y fórmulas por sensor, y lectura de resultados calculados.
//
// El router (router.hpp) permite un único handler por (verbo, prefijo) --
// `/api/mining/devices/` ya tiene prefijos PUT/POST tomados por
// handleUpdateDevice/handleRevokeDevice (device_alarm_routes.cpp, ver sus
// comentarios). Por eso las funciones de escritura de acá NO se registran
// directamente como rutas: se exponen para que esos dos dispatchers las
// invoquen por sufijo de path (`.../parameters`, `.../formulas`,
// `.../formulas/{id}`). Las lecturas (GET) sí se registran directo desde
// este archivo, porque ese prefijo GET estaba libre.
// --------------------------------------------------------------------------
#pragma once

#include "../http/router.hpp"
#include <string>

namespace mining_iot {

/** @brief Registra GET /api/mining/devices/{id}/parameters|formulas|formula-results
 * y DELETE /api/mining/devices/{id}/formulas/{formula_id} (únicos prefijos
 * libres en /api/mining/devices/ para esos verbos). */
void registerFormulaRoutes(router::Router &r);

/** @brief PUT .../{id}/parameters -- upsert de valores (y definiciones si
 * vienen nuevas) de parámetros de entrada del sensor. Invocada desde
 * handleUpdateDevice. */
http::response<http::string_body>
handleUpdateSensorParameters(const http::request<http::string_body> &req,
                             const std::unordered_map<std::string, std::string> &query,
                             const std::string &sensorId);

/** @brief POST .../{id}/formulas -- crea una fórmula nueva. Invocada desde
 * handleRevokeDevice (dispatcher POST del mismo prefijo). */
http::response<http::string_body>
handleCreateSensorFormula(const http::request<http::string_body> &req,
                          const std::unordered_map<std::string, std::string> &query,
                          const std::string &sensorId);

/** @brief PUT .../{id}/formulas/{formula_id} -- actualización parcial.
 * Invocada desde handleUpdateDevice. */
http::response<http::string_body>
handleUpdateSensorFormula(const http::request<http::string_body> &req,
                          const std::unordered_map<std::string, std::string> &query,
                          const std::string &sensorId,
                          const std::string &formulaId);

/** @brief ADR-195: POST .../{id}/formulas/{formula_id}/diagram/regenerate --
 * reconstruye bajo demanda el diagrama del lienzo "Cálculo" de esa fórmula.
 * Invocada desde handleRevokeDevice (dispatcher POST del mismo prefijo). */
http::response<http::string_body>
handleRegenerateSensorFormulaDiagram(const http::request<http::string_body> &req,
                                     const std::unordered_map<std::string, std::string> &query,
                                     const std::string &sensorId,
                                     const std::string &formulaId);

} // namespace mining_iot
