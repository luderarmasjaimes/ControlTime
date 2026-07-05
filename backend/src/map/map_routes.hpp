#pragma once

#include "../http/router.hpp"

namespace map_mod {

/** @brief Registra las rutas HTTP de mapas (marcadores, zonas oficiales, intersecciones de cumplimiento) en el router. */
void registerRoutes(router::Router &r);

} // namespace map_mod
