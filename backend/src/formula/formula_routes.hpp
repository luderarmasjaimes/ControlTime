#pragma once

#include "../http/router.hpp"

namespace formula {

/** @brief Registra las rutas HTTP del motor de fórmulas (diccionario de datos, catálogos y ejecución de análisis) en el router. */
void registerRoutes(router::Router& r);

} // namespace formula
