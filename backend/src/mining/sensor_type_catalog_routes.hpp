// --------------------------------------------------------------------------
// sensor_type_catalog_routes.hpp — ADR-188: catálogo gobernado de "tipo de
// sensor -> parámetros disponibles" (sensor_type_def/sensor_type_parameter_def,
// db_scripts/94). Es la plantilla que un admin de plataforma (permiso
// `formula.edit`, sembrado desde db_scripts/42 pero sin usar hasta ahora)
// activa/desactiva por tipo; no reemplaza sensor_input_parameter_def/_value
// (ADR-187, valor real configurado por sensor individual).
// --------------------------------------------------------------------------
#pragma once

#include "../http/router.hpp"

namespace mining_iot {

/** @brief Registra GET /api/mining/sensor-types y
 * PUT /api/mining/sensor-types/{type_code}/parameters. */
void registerSensorTypeCatalogRoutes(router::Router &r);

} // namespace mining_iot
