// --------------------------------------------------------------------------
// sensor_formula_template_routes.hpp — ADR-189: catálogo de plantillas de
// fórmula de calibración geotécnica (23 familias del rule chain legado
// ThingsBoard "PiezometerRC-V2", ver
// docs/INVESTIGACION_MOTOR_CALCULO_LEGADO_THINGSBOARD_PIEZOMETROS_2026-09-14.md)
// sobre el motor real (tinyexpr, ADR-187). El catálogo en sí
// (sensor_formula_template_def/_input/_param/_output,
// db_scripts/95_sensor_formula_template_catalog.sql) es de solo lectura vía
// API -- se administra por migración SQL, no por esta ruta. Lo que esta ruta
// permite es "aplicar" una plantilla a un sensor real: genera
// sensor_input_channel_def + sensor_input_parameter_def/_value +
// sensor_formula_def de una vez, con las mismas garantías (tenant, validación
// de expresión) que sensor_formula_routes.cpp.
// --------------------------------------------------------------------------
#pragma once

#include "../http/router.hpp"
#include <string>

namespace mining_iot {

/** @brief Registra GET /api/mining/formula-templates (único prefijo GET
 * libre para esto -- no colisiona con nada de /api/mining/devices/). */
void registerFormulaTemplateRoutes(router::Router &r);

/** @brief POST /api/mining/devices/{id}/formulas/apply-template -- invocada
 * desde handleRevokeDevice (dispatcher POST de /api/mining/devices/, mismo
 * criterio que .../formulas y .../rotate-key, ver ese comentario). */
http::response<http::string_body>
handleApplyFormulaTemplate(const http::request<http::string_body> &req,
                           const std::unordered_map<std::string, std::string> &query,
                           const std::string &sensorId);

} // namespace mining_iot
